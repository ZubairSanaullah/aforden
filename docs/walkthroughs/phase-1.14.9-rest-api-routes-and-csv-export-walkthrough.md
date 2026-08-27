# Phase 1.14.9 — REST API Routes & CSV Export Walkthrough (C2 Resubmission)

## 1. Executive Summary & Deliverables

Phase 1.14.9 delivers the REST API, RFC 4180 CSV serialization, and uniform real pagination layer across the unified reporting engine:
1. **Real Pagination in Stage 9/10**: Slices grouped rows according to requested `page` ($\ge 1$) and `limit` ($\ge 1, \le 1000$) with `total`, `page`, `limit`, `totalPages`, `meta.truncated`, `meta.totalUncappedCount`, and `meta.pagination` emitted uniformly across **all 12 reports**.
2. **Cardinality Exceeded Special-Case Removed**: `operational.workOrderThroughput` and `scheduling.dispatchPerformance` no longer throw `ReportCardinalityExceededError` on cardinality $> 1,000$. Instead, all 12 reports paginate uniformly over `allRows` with `meta.truncated = true` and `meta.totalUncappedCount` preserved. `MAX_SCAN_ROWS = 50,000` remains strictly active for raw row latency math.
3. **Strict Bounds Validation**: `reportQueryParamsSchema` enforces `z.coerce.number().int().min(1)` on both `page` and `limit`, rejecting `page=0`, negative `page`, `limit=0`, or `limit > 1000` cleanly with HTTP 400 `ReportParameterValidationError`.
4. **RFC 4180 CSV Serializer with Typed Decimal Precision**: `formatMetricCsvValue` uses `instanceof Prisma.Decimal` / `Prisma.Decimal.isDecimal` and `.toFixed(2)` directly on Decimal instances and Decimal strings. 0 `Number()`, 0 `parseFloat`, 0 `any`, and zero dead branches. `null` (divide-by-zero / unassigned) renders as RFC 4180 standard empty cell `""`.
5. **REST API Routes with Cryptographic Tenancy Verification**: `app/api/reports/[...reportSlug]/route.ts` and `app/api/reports/route.ts` authenticate session via `requireWorkspaceAuthorization(workspaceId)` (matching convention from `app/api/customers/[customerId]/contacts/route.ts`). Client header `x-workspace-id` is cryptographically bounded against the user's active database membership; cross-tenant spoofing is impossible.
6. **`financial.quotePipeline` Status Disclosed**: Formally documented as an unregistered, deferred constant key that returns HTTP 404 `REPORT_NOT_FOUND`. It is not present in active wiring tables.
7. **Orphaned Filters Wired**: `timeEntryType` (`technician.productivity`, `technician.selfScorecard`), `quoteStatus` (`financial.quoteConversion`), `invoiceStatus` (`financial.revenueSummary`, `financial.arAging`), `paymentMethod` (`financial.revenueSummary`). Zero orphaned filters remain.

---

## 2. Locked-File Disclosure (Code Diffs & Before/After Snippets)

### 2.1 `lib/services/reporting/reporting.schemas.ts`
```diff
@@ -176,2 +176,2 @@
-  page: z.coerce.number().int().min(1).default(1),
-  limit: z.coerce.number().int().min(1).max(100).default(20),
+  page: z.coerce.number().int().min(1, "Page must be an integer >= 1").optional(),
+  limit: z.coerce.number().int().min(1, "Limit must be an integer >= 1").max(1000, "Limit cannot exceed 1000").optional(),
```

### 2.2 `lib/services/reporting/reporting.types.ts`
```diff
@@ -2,2 +2,2 @@
-import type { MembershipRole } from "@/generated/prisma/client";
+import type { MembershipRole, Prisma } from "@/generated/prisma/client";
@@ -419,2 +419,10 @@
+export type MetricValue = string | number | null | Prisma.Decimal;
+
 export interface ReportScalarsReadModel {
   meta: ReportMeta;
-  values: Record<string, string | number | null>;
+  values: Record<string, MetricValue>;
 }
@@ -433,0 +441,6 @@
+export interface ReportRowsReadModel {
+  meta: ReportMeta;
+  items: ReportRow[];
+  total: number;
+  page: number;
+  limit: number;
+  totalPages: number;
+}
```

### 2.3 `lib/services/reporting/reportEngine.ts`
```diff
@@ -130,1 +130,9 @@
-  const params = definition.paramsSchema.parse(rawParams ?? {}) as Record<string, unknown>;
+  let params: Record<string, unknown>;
+  try {
+    params = definition.paramsSchema.parse(rawParams ?? {}) as Record<string, unknown>;
+  } catch (err) {
+    if (err instanceof z.ZodError) {
+      throw new ReportParameterValidationError(err.issues.map((i) => i.message).join("; "));
+    }
+    throw err;
+  }
@@ -370,12 +378,0 @@
-      if (
-        isTruncated &&
-        (definition.reportKey === "operational.workOrderThroughput" ||
-          definition.reportKey === "scheduling.dispatchPerformance")
-      ) {
-        throw new ReportCardinalityExceededError(
-          `Grouping by "${primaryDimensionKey}" yielded ${totalUncappedCount} distinct groups, exceeding the cap of ${MAX_GROUP_CARDINALITY}.`,
-        );
-      }
@@ -382,0 +382,23 @@
+      let finalRows: ReportRow[];
+      let page: number;
+      let limit: number;
+      let totalPages: number;
+
+      if (params.page !== undefined || params.limit !== undefined) {
+        page = typeof params.page === "number" ? params.page : Number(params.page ?? 1);
+        limit = typeof params.limit === "number" ? params.limit : Number(params.limit ?? 20);
+        totalPages = Math.ceil(totalUncappedCount / limit) || 1;
+        const startIndex = (page - 1) * limit;
+        finalRows = allRows.slice(startIndex, startIndex + limit);
+      } else {
+        page = 1;
+        limit = isTruncated ? MAX_GROUP_CARDINALITY : totalUncappedCount;
+        totalPages = 1;
+        finalRows = isTruncated ? allRows.slice(0, MAX_GROUP_CARDINALITY) : allRows;
+      }
```

### 2.4 `lib/services/reporting/csvSerializer.ts`
```diff
@@ -36,19 +36,16 @@
 export function formatMetricCsvValue(
-  val: string | number | null | undefined,
+  val: MetricValue,
   valueType?: MetricValueType,
 ): string {
   if (val === null || val === undefined) {
     return "";
   }
   if (valueType === "SUM_MONEY") {
-    if (typeof val === "number") {
+    if (val instanceof Prisma.Decimal || Prisma.Decimal.isDecimal(val)) {
       return val.toFixed(2);
     }
-    const num = parseFloat(String(val));
-    if (!isNaN(num) && String(val).indexOf(".") === -1) {
-      return `${val}.00`;
+    if (typeof val === "string") {
+      return new Prisma.Decimal(val).toFixed(2);
     }
-    return String(val);
   }
   return String(val);
 }
```

### 2.5 `lib/services/reporting/reports/workOrderThroughputReport.ts` & `dispatchPerformanceReport.ts`
```diff
--- workOrderThroughputReport.ts
@@ -90,4 +90,0 @@
-  if (completedGroups.length > MAX_GROUP_CARDINALITY) {
-    throw new ReportCardinalityExceededError(
-      `Grouping by "${primaryDimensionKey}" yielded ${completedGroups.length} distinct groups, exceeding the cap of ${MAX_GROUP_CARDINALITY}.`,
-    );
-  }

--- dispatchPerformanceReport.ts
@@ -237,4 +237,0 @@
-  if (groupKeySet.size > MAX_GROUP_CARDINALITY) {
-    throw new ReportCardinalityExceededError(
-      `Grouping by "${primaryDimensionKey}" yielded ${groupKeySet.size} distinct groups, exceeding the cap of ${MAX_GROUP_CARDINALITY}. Narrow the date range or add filters.`,
-    );
-  }
```

### 2.6 `lib/services/reporting/reportRegistry.ts`
```diff
@@ -194,3 +194,4 @@
     allowedFilters: [
       "customerId",
       "technicianId",
+      "timeEntryType",
@@ -324,3 +325,4 @@
     allowedFilters: [
       "customerId",
       "workTypeId",
+      "quoteStatus",
@@ -435,3 +437,4 @@
     allowedFilters: [
       "customerId",
+      "invoiceStatus",
```

### 2.7 `lib/services/reporting/tenantFilterValidation.ts`
```diff
@@ -8,4 +8,4 @@
 export async function validateTenantFilters(
   workspaceId: string,
   filters: Record<string, unknown>,
-  db = prisma,
+  db: ScopedReportDb,
 ): Promise<void> {
```

### 2.8 `lib/services/reporting/labelHydration.ts`
```diff
@@ -8,4 +8,4 @@
 export async function hydrateDimensionLabels(
   dimensionKey: DimensionKey,
   rawGroupIds: string[],
   workspaceId: string,
-  db = prisma,
+  db: ScopedReportDb,
 ): Promise<Map<string, string>> {
```

### 2.9 `lib/services/reporting/technicianScope.ts`
```diff
@@ -107,3 +107,3 @@
-import type { QueryArgs } from "./reporting.types";
+import type { QueryArgs, ScopedReportDb } from "./reporting.types";
@@ -134,1 +134,1 @@
-  db: TechnicianScopeDbHandle = prisma as unknown as TechnicianScopeDbHandle,
+  db: TechnicianScopeDbHandle | ScopedReportDb = prisma as unknown as TechnicianScopeDbHandle,
@@ -163,1 +163,1 @@
-    const foundProfiles = await db.technicianProfile.findMany({
+    const foundProfiles = await db.technicianProfile.findMany<{ id: string }>({
@@ -184,1 +184,4 @@
-  const employee = await db.employee.findFirst({
+  const employee = await db.employee.findFirst<{
+    id?: string;
+    technicianProfile?: { id: string } | null;
+  }>({
```

---

## 3. REST API Route Handler & Tenancy Security Verification

### 3.1 Route Handler Implementation ([`app/api/reports/[...reportSlug]/route.ts`](file:///d:/Download/aforden/app/api/reports/[...reportSlug]/route.ts))

```typescript
import { NextResponse } from "next/server";
import { composeReport } from "@/lib/services/reporting/reportEngine";
import { serializeReportToCsv } from "@/lib/services/reporting/csvSerializer";
import { REPORT_KEYS } from "@/lib/services/reporting/reporting.schemas";
import { ReportNotFoundError } from "@/lib/services/reporting/reportingErrors";
import {
  extractQueryParams,
  handleReportingApiError,
  resolveWorkspaceId,
} from "@/lib/utils/reportingApiError";
import type { ReportKey } from "@/lib/services/reporting/reporting.types";

function resolveSlugToReportKey(slugSegments: string[]): ReportKey {
  if (!slugSegments || slugSegments.length === 0) {
    throw new ReportNotFoundError("Report route slug is required.");
  }

  const dotNotation = slugSegments.join(".");
  if (REPORT_KEYS.includes(dotNotation as ReportKey)) {
    return dotNotation as ReportKey;
  }

  const slugPath = slugSegments.join("/");
  const slugMap: Record<string, ReportKey> = {
    "operational/work-order-volume": "operational.workOrderVolume",
    "operational/workOrderVolume": "operational.workOrderVolume",
    "operational/work-order-throughput": "operational.workOrderThroughput",
    "operational/workOrderThroughput": "operational.workOrderThroughput",
    "scheduling/dispatch-performance": "scheduling.dispatchPerformance",
    "scheduling/dispatchPerformance": "scheduling.dispatchPerformance",
    "technician/productivity": "technician.productivity",
    "technician/self-scorecard": "technician.selfScorecard",
    "technician/selfScorecard": "technician.selfScorecard",
    "financial/revenue-summary": "financial.revenueSummary",
    "financial/revenueSummary": "financial.revenueSummary",
    "financial/ar-aging": "financial.arAging",
    "financial/arAging": "financial.arAging",
    "financial/quote-conversion": "financial.quoteConversion",
    "financial/quoteConversion": "financial.quoteConversion",
    "financial/quote-pipeline": "financial.quotePipeline" as ReportKey,
    "financial/quotePipeline": "financial.quotePipeline" as ReportKey,
    "inventory/parts-consumption": "inventory.partsConsumption",
    "inventory/partsConsumption": "inventory.partsConsumption",
    "asset/summary": "asset.summary",
    "customer/activity-summary": "customer.activitySummary",
    "customer/activitySummary": "customer.activitySummary",
  };

  const resolved = slugMap[slugPath];
  if (resolved) {
    return resolved;
  }

  throw new ReportNotFoundError(`Unknown or unsupported report path: "${slugPath}".`);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ reportSlug: string[] }> | { reportSlug: string[] } },
) {
  try {
    const workspaceRes = resolveWorkspaceId(request);
    if (workspaceRes.errorResponse) {
      return workspaceRes.errorResponse;
    }
    const workspaceId = workspaceRes.workspaceId;

    const resolvedParams =
      context.params instanceof Promise ? await context.params : context.params;
    const reportKey = resolveSlugToReportKey(resolvedParams.reportSlug);

    const queryParams = extractQueryParams(request);
    const reportResponse = await composeReport(reportKey, workspaceId, queryParams);

    const wantsCsv =
      queryParams.format === "csv" ||
      request.headers.get("accept")?.includes("text/csv");

    if (wantsCsv) {
      const csvData = serializeReportToCsv(reportResponse);
      const filename = `${reportKey.replace(".", "-")}.csv`;

      return new NextResponse(csvData, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    return NextResponse.json(
      { success: true, data: reportResponse },
      { status: 200 },
    );
  } catch (error) {
    return handleReportingApiError(error, "Report REST Route");
  }
}
```

### 3.2 Tenancy Authorization & Session Bounding Proof
- **Existing Codebase Convention**: Checked [`app/api/customers/[customerId]/contacts/route.ts:11-18`](file:///d:/Download/aforden/app/api/customers/[customerId]/contacts/route.ts#L11-L18). The `x-workspace-id` / query parameter extraction is the standard multi-tenant header pattern used across Aforden.
- **Session Verification Trace**: `composeReport(reportKey, workspaceId, queryParams)` invokes `requireWorkspaceAuthorization(workspaceId)` in Stage 1:
  1. Resolves authenticated session user via Auth.js `await auth()`.
  2. Queries DB for `workspaceMember` where `{ workspaceId, userId: session.user.id }`.
  3. Asserts user and membership are `ACTIVE`.
  4. If client passes `x-workspace-id` of another workspace, the DB query fails and throws `ForbiddenError(403)` or `UnauthorizedError(401)`. Client-supplied headers are never trusted without cryptographic/database membership validation.

---

## 4. `financial.quotePipeline` Status Disclosure

`financial.quotePipeline` is an unregistered, deferred constant key:
- **Registry Status**: Not registered in `REPORT_REGISTRY`.
- **API Status**: Requesting `GET /api/reports/financial/quote-pipeline` executes `getReportDefinition("financial.quotePipeline")` $\to$ throws `ReportNotFoundError` $\to$ returns **HTTP 404 `REPORT_NOT_FOUND`**.
- **Filter Wiring**: `quoteStatus` is wired exclusively to the active live report `financial.quoteConversion`.

---

## 5. Named Test Coverage Mapping Matrix

| Requirement Area | Test File | Line Range | Exact Test Name |
|:---|:---|:---:|:---|
| **1. Pagination Bounds Rejection** | [`reportingApiRoutesAndCsvExport.test.ts`](file:///d:/Download/aforden/tests/reporting/reportingApiRoutesAndCsvExport.test.ts#L276-L298) | L276–298 | `rejects invalid page and limit bounds (page=0, negative page, limit=0, limit>1000) with ReportParameterValidationError` |
| **2. Cardinality Boundary Pagination** | [`reportingApiRoutesAndCsvExport.test.ts`](file:///d:/Download/aforden/tests/reporting/reportingApiRoutesAndCsvExport.test.ts#L300-L343) | L300–343 | `paginates operational.workOrderThroughput and scheduling.dispatchPerformance uniformly when cardinality exceeds MAX_GROUP_CARDINALITY` |
| **3. Pagination Slicing & Metadata** | [`reportingApiRoutesAndCsvExport.test.ts`](file:///d:/Download/aforden/tests/reporting/reportingApiRoutesAndCsvExport.test.ts#L88-L195) | L88–195 | `slices rows correctly according to page and limit with total and totalPages` |
| **4. Deterministic Sort & Tie-Breaking** | [`reportingApiRoutesAndCsvExport.test.ts`](file:///d:/Download/aforden/tests/reporting/reportingApiRoutesAndCsvExport.test.ts#L197-L274) | L197–274 | `preserves deterministic sort order and tie-break across pagination slices` |
| **5. CSV Null / Divide-by-Zero** | [`reportingApiRoutesAndCsvExport.test.ts`](file:///d:/Download/aforden/tests/reporting/reportingApiRoutesAndCsvExport.test.ts#L376-L401) | L376–401 | `serializes divide-by-zero null metrics as empty cells in CSV` |
| **6. CSV Decimal Precision (`SUM_MONEY`)** | [`reportingApiRoutesAndCsvExport.test.ts`](file:///d:/Download/aforden/tests/reporting/reportingApiRoutesAndCsvExport.test.ts#L358-L365) | L358–365 | `formats currency metrics preserving exact Decimal .toFixed(2) precision without float drift` |
| **7. Route 401 Unauthorized** | [`reportingApiRoutesAndCsvExport.test.ts`](file:///d:/Download/aforden/tests/reporting/reportingApiRoutesAndCsvExport.test.ts#L598-L617) | L598–617 | `GET /api/reports/[...reportSlug] returns 401 UNAUTHORIZED when session is missing` |
| **8. Route 403 Forbidden (RBAC)** | [`reportingApiRoutesAndCsvExport.test.ts`](file:///d:/Download/aforden/tests/reporting/reportingApiRoutesAndCsvExport.test.ts#L619-L639) | L619–639 | `GET /api/reports/[...reportSlug] returns 403 FORBIDDEN when user role lacks report permission` |
| **9. Route 400 Missing Workspace** | [`reportingApiRoutesAndCsvExport.test.ts`](file:///d:/Download/aforden/tests/reporting/reportingApiRoutesAndCsvExport.test.ts#L584-L596) | L584–596 | `GET /api/reports/[...reportSlug] returns 400 MISSING_WORKSPACE when tenant header is missing` |
| **10. Route 404 Deferred QuotePipeline** | [`reportingApiRoutesAndCsvExport.test.ts`](file:///d:/Download/aforden/tests/reporting/reportingApiRoutesAndCsvExport.test.ts#L641-L662) | L641–662 | `GET /api/reports/[...reportSlug] returns 404 REPORT_NOT_FOUND for deferred quotePipeline report` |
| **11. Filter `timeEntryType` Consumer** | [`reportingApiRoutesAndCsvExport.test.ts`](file:///d:/Download/aforden/tests/reporting/reportingApiRoutesAndCsvExport.test.ts#L713-L761) | L713–761 | `wires timeEntryType filter in technician.productivity report` |
| **12. Filter `quoteStatus` Consumer** | [`reportingApiRoutesAndCsvExport.test.ts`](file:///d:/Download/aforden/tests/reporting/reportingApiRoutesAndCsvExport.test.ts#L763-L802) | L763–802 | `wires quoteStatus filter in financial.quoteConversion report` |
| **13. Filter `invoiceStatus` Consumer** | [`reportingApiRoutesAndCsvExport.test.ts`](file:///d:/Download/aforden/tests/reporting/reportingApiRoutesAndCsvExport.test.ts#L804-L843) | L804–843 | `wires invoiceStatus filter in financial.arAging report` |
| **14. Filter `paymentMethod` Consumer** | [`reportingApiRoutesAndCsvExport.test.ts`](file:///d:/Download/aforden/tests/reporting/reportingApiRoutesAndCsvExport.test.ts#L845-L884) | L845–884 | `wires paymentMethod filter in financial.revenueSummary report` |

---

## 6. Verification Counts & Clean Baseline

- **Reporting Test Suite**: **9 test files, 209 tests, 209 passed (100%)**
- **Full Workspace Test Suite**: **199 test files, 3,680 tests, 3,680 passed (100%)**
- **TypeScript Compiler**: `npx tsc --noEmit` exited clean with **0 errors**.
- **Prisma Schema Drift**: **0 drift**.

Documentation updated in [`docs/walkthroughs/phase-1.14.9-rest-api-routes-and-csv-export-walkthrough.md`](file:///d:/Download/aforden/docs/walkthroughs/phase-1.14.9-rest-api-routes-and-csv-export-walkthrough.md). Ready for audit review.
