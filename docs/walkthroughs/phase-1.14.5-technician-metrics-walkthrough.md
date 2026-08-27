# Phase 1.14.5 — Technician Productivity Metrics & Self-Scoping Engine Walkthrough (Phase 1.14.5-C3)

---

## 1. Leading Requirements

### 1.1 Verbatim Head of `lib/services/reporting/technicianScope.ts`
```typescript
import { prisma } from "@/lib/prisma";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { roleHasPermission } from "@/lib/services/authorization/permissionService";
import { ReportScopeViolationError } from "./reportingErrors";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Unexported unique symbol brand.
 * Makes EffectiveTechnicianScope nominal and completely unforgeable outside this module.
 */
const effectiveScopeBrand: unique symbol = Symbol("EffectiveTechnicianScope");

/**
 * Branded nominal type for an effective technician scope.
 * Guarantees that query builders cannot bypass scope resolution or fabricate unscoped queries.
 */
export type EffectiveTechnicianScope = {
  readonly [effectiveScopeBrand]: true;
  readonly workspaceId: string;
  readonly isAll: boolean;
  readonly technicianIds: readonly string[];
  
  /** Query helper: generates WorkOrder where clause */
  toWorkOrderWhere(): Prisma.WorkOrderWhereInput;
  /** Query helper: generates ScheduleAppointment where clause */
  toScheduleWhere(): Prisma.ScheduleAppointmentWhereInput;
  /** Query helper: generates TechnicianTimeEntry where clause */
  toTimeEntryWhere(): Prisma.TechnicianTimeEntryWhereInput;
  /** Query helper: generates TechnicianProfile where clause */
  toTechnicianProfileWhere(): Prisma.TechnicianProfileWhereInput;
  /** Query helper: generates WorkOrderHistory where clause scoped to reassigned-away (oldValue) */
  toWorkOrderHistoryOldValueWhere(): Prisma.WorkOrderHistoryWhereInput;
};

/**
 * Internal factory to create a branded EffectiveTechnicianScope.
 * Not exported outside this file.
 */
function createEffectiveScope(
  workspaceId: string,
  isAll: boolean,
  technicianIds: readonly string[],
): EffectiveTechnicianScope {
  return {
    [effectiveScopeBrand]: true,
    workspaceId,
    isAll,
    technicianIds: Object.freeze([...technicianIds]),
    toWorkOrderWhere() {
      return {
        workspaceId,
        ...(isAll ? {} : { assignedTechnicianId: { in: [...technicianIds] } }),
      };
    },
    toScheduleWhere() {
      return {
        workspaceId,
        ...(isAll ? {} : { technicianId: { in: [...technicianIds] } }),
      };
    },
    toTimeEntryWhere() {
      return {
        workspaceId,
        ...(isAll ? {} : { technicianProfileId: { in: [...technicianIds] } }),
      };
    },
    toTechnicianProfileWhere() {
      return {
        employee: { workspaceId },
        ...(isAll ? {} : { id: { in: [...technicianIds] } }),
      };
    },
    toWorkOrderHistoryOldValueWhere() {
      return {
        workspaceId,
        ...(isAll ? {} : { oldValue: { in: [...technicianIds] } }),
      };
    },
  };
}
```

### 1.2 `technicians.onTimeArrivalRate` Corrected Definition & 501 Deferral
- **Metric Key**: `technicians.onTimeArrivalRate`
- **Grace Constant**: `ON_TIME_ARRIVAL_GRACE_MINUTES = 15`
- **Denominator**: All expected scheduled appointments for the technician within the reporting period.
- **Accurate 501 Rationale**:
  In `prisma/schema.prisma` lines 192–200, `ScheduleHistoryEventType` contains only: `CREATED`, `RESCHEDULED`, `CANCELLED`, `COMPLETED`, `DISPATCHED`, `UNDISPATCHED`, `UPDATED`. It **lacks an `ARRIVED` event member**, and `ScheduleAppointment.fieldExecutionStartedAt` is a mutable column. Measuring arrival timing without an immutable `ARRIVED` history row is an approximation, so `technicians.onTimeArrivalRate` throws 501 `ReportMetricUnavailableError`:
  > `Metric "technicians.onTimeArrivalRate" cannot be computed: ScheduleHistoryEventType lacks an ARRIVED event member and ScheduleAppointment.fieldExecutionStartedAt is a mutable column rather than an immutable history table (Phase 1.8 dependency gap).`

### 1.3 B3 Reassignment Test Output (Three-Technician Chain $X \rightarrow Y \rightarrow Z$)
```
 ✓ tests/reporting/technicianProductivityReports.test.ts (14 tests) 57ms
   ✓ B3: five history rows across X->Y->Z asserts away-count 2/1/0, ASSIGNED excluded, UNASSIGNED counted, and foreign workspace invisible
```
**Test Code from [`tests/reporting/technicianProductivityReports.test.ts`](file:///d:/Download/aforden/tests/reporting/technicianProductivityReports.test.ts#L198-L270)**:
```typescript
it("B3: five history rows across X->Y->Z asserts away-count 2/1/0, ASSIGNED excluded, UNASSIGNED counted, and foreign workspace invisible", async () => {
  const mockDb = createPredicateEvaluatingDb({
    technicianProfiles: [
      { id: "tech_X", employee: { workspaceId: "ws_alpha", displayName: "Tech X" } },
      { id: "tech_Y", employee: { workspaceId: "ws_alpha", displayName: "Tech Y" } },
      { id: "tech_Z", employee: { workspaceId: "ws_alpha", displayName: "Tech Z" } },
    ],
    workOrderHistories: [
      // Row 1: Hop 1 (X -> Y) in ws_alpha (Reassigned away from X)
      { id: "h_1", workspaceId: "ws_alpha", eventType: "REASSIGNED", field: "assignedTechnicianId", oldValue: "tech_X", newValue: "tech_Y", createdAt: new Date("2026-08-10T10:00:00Z") },
      // Row 2: Hop 2 (Y -> Z) in ws_alpha (Reassigned away from Y)
      { id: "h_2", workspaceId: "ws_alpha", eventType: "REASSIGNED", field: "assignedTechnicianId", oldValue: "tech_Y", newValue: "tech_Z", createdAt: new Date("2026-08-12T14:00:00Z") },
      // Row 3: Initial assignment (ASSIGNED) to X — must be EXCLUDED from away-count
      { id: "h_3", workspaceId: "ws_alpha", eventType: "ASSIGNED", field: "assignedTechnicianId", oldValue: null, newValue: "tech_X", createdAt: new Date("2026-08-05T09:00:00Z") },
      // Row 4: Unassignment (UNASSIGNED) from X — must be COUNTED for X
      { id: "h_4", workspaceId: "ws_alpha", eventType: "UNASSIGNED", field: "assignedTechnicianId", oldValue: "tech_X", newValue: null, createdAt: new Date("2026-08-15T11:00:00Z") },
      // Row 5: Foreign workspace reassignment from X — must be EXCLUDED by workspaceId predicate
      { id: "h_5", workspaceId: "ws_foreign", eventType: "REASSIGNED", field: "assignedTechnicianId", oldValue: "tech_X", newValue: "tech_Y", createdAt: new Date("2026-08-18T10:00:00Z") },
    ],
  });

  const res = await getTechnicianProductivityReport("ws_alpha", { preset: "THIS_MONTH", sortBy: "technician", sortOrder: "asc" }, mockAdminContext, "technician.productivity", mockDb);

  const rows = (res as any).items;
  const xRow = rows.find((r: any) => r.dimensions.technician.key === "tech_X");
  const yRow = rows.find((r: any) => r.dimensions.technician.key === "tech_Y");
  const zRow = rows.find((r: any) => r.dimensions.technician.key === "tech_Z");

  expect(xRow.values["technicians.reassignmentAwayCount"]).toBe(2); // 1 REASSIGNED + 1 UNASSIGNED (ASSIGNED & foreign excluded)
  expect(yRow.values["technicians.reassignmentAwayCount"]).toBe(1); // 1 REASSIGNED
  expect(zRow.values["technicians.reassignmentAwayCount"]).toBe(0); // 0 away events
});
```

---

## 2. Point-by-Point Responses to Corrections (Phase 1.14.5-C3)

### 1. Verbatim Verification of `TechnicianTimeEntry` $\rightarrow$ `WorkOrder` Relation
Verified verbatim in [`prisma/schema.prisma`](file:///d:/Download/aforden/prisma/schema.prisma):
- `TechnicianTimeEntry.workOrderId: String` (line 1295)
- `TechnicianTimeEntry.workOrder: WorkOrder @relation(fields: [workOrderId], references: [id], onDelete: Restrict)` (line 1314)
- `WorkOrder.technicianTimeEntries: TechnicianTimeEntry[]` (line 1010)
- `@@index([workOrderId])` (line 1320)
- `@@index([workspaceId, workOrderId])` (line 1322)
The relation is explicit, foreign-keyed, and indexed. `avgJobDurationMinutes` calculates completed `ON_SITE` duration minutes attached to completed work orders divided by `completedWorkOrderCount`.

### 2. Dropped Test Accounting & Restored Suite
- **Dropped Test Accounting**: During C1 test consolidation, the standalone in-query WHERE assertion and report registry definition assertion were merged into the B3 and 501 test blocks.
- **Restoration**: Both were split back out into explicit, standalone tests in `tests/reporting/technicianProductivityReports.test.ts`:
  1. `it("proves scoping is applied in the database query (WHERE clause) rather than post-filtered")`
  2. `it("verifies report registry definition for technician.productivity and technician.selfScorecard")`
- **Resulting Test Counts**:
  - `tests/reporting/technicianProductivityReports.test.ts`: **14 tests** (up from 11/12).
  - Reporting test suite: **122 passed tests** (up from 119/120).
  - Workspace test suite: **3,593 passed tests** across **195 test files** (up from 3,590/3,591).

### 3. Minute Metrics Typing, Status Filters & Tracked Minutes Semantics
- **Typing**: Added `"SUM_DURATION_MINUTES"` to `MetricValueType` in `reporting.types.ts`. `onSiteMinutes`, `travelMinutes`, and `trackedMinutes` are all typed `SUM_DURATION_MINUTES`.
- **Status Filter**: All three metrics filter strictly on `status: "COMPLETED"` (`baseWhere: () => ({ status: "COMPLETED" })`), guaranteeing consistency with `avgJobDurationMinutes`.
- **Tracked Minutes Scope**: Description explicitly states that `trackedMinutes` includes completed minutes across all four entry types: `ON_SITE`, `TRAVEL`, `BREAK`, and `ADMIN`.

### 4. Dead Branch Deletion
In `technicianProductivityReport.ts`, with `status: "COMPLETED"` filtering on `TechnicianTimeEntry`, the duration calculation is strictly:
```typescript
const dur = entry.durationMinutes ?? (entry.startedAt && entry.endedAt ? Math.max(0, Math.round((new Date(entry.endedAt).getTime() - new Date(entry.startedAt).getTime()) / (60 * 1000))) : 0);
```
All unreachable `else { dur = 0; }` heuristic branches were deleted.

### 5. Header Alignment for Part A Rules
Section 2.2 of the walkthrough and `technicianScope.ts` align to the **9 Part A Authorization & Scoping Rules**:
1. Deny by default.
2. Read-all, no filter $\rightarrow$ all technicians in workspace.
3. Read-all, valid filter $\rightarrow$ validated workspace technician IDs.
4. Read-all, foreign filter $\rightarrow$ 403 `ReportScopeViolationError`.
5. Read-self, no filter $\rightarrow$ narrows to caller's own technician profile ID.
6. Read-self, requesting own ID $\rightarrow$ allowed.
7. Read-self, requesting other ID $\rightarrow$ 403 `ReportScopeViolationError`.
8. Read-self with no technician profile $\rightarrow$ 403 `ReportScopeViolationError`.
9. Cross-tenant isolation (cannot reach technician in another workspace).

### 6. B3 Test Renamed to 2/1/0
The test name in `tests/reporting/technicianProductivityReports.test.ts` line 198 is verbatim:
`it("B3: five history rows across X->Y->Z asserts away-count 2/1/0, ASSIGNED excluded, UNASSIGNED counted, and foreign workspace invisible", ...)`

### 7. Index Coverage for WorkOrderHistory Query Path
- Current indexes in `schema.prisma`: `@@index([workspaceId])` (line 1113), `@@index([eventType])` (line 1116), and `@@index([workspaceId, workOrderId, createdAt])` (line 1118).
- Access path queried: `workspaceId + field + eventType + oldValue + createdAt`.
- **Status**: Partially covered by `@@index([workspaceId])` and `@@index([eventType])`. The optimal composite index `@@index([workspaceId, field, eventType, oldValue, createdAt])` is **unverified and deferred to Phase 1.14.10 Index Optimization & Query Hardening** (0 schema changes allowed in 1.14.5).

### 8. Authoritative Scope Resolution vs `selfScopedRoles`
`ReportDefinition.selfScopedRoles` is purely descriptive metadata in the report registry. The **sole authoritative engine** for scoping is `resolveEffectiveTechnicianScope()` in [`lib/services/reporting/technicianScope.ts`](file:///d:/Download/aforden/lib/services/reporting/technicianScope.ts), which enforces RBAC capabilities by checking `roleHasPermission(role, PERMISSIONS.REPORTS_VIEW_TECHNICIAN)` and `role === "TECHNICIAN"` (never failing open).

---

## 3. Test Suite Verification

### 3.1 Reporting Test Suite Output
```
 RUN  v4.1.10 D:/Download/aforden

 ✓ tests/reporting/schedulingMetricsAndReports.test.ts (18 tests) 118ms
 ✓ tests/reporting/operationalMetricsAndReports.test.ts (18 tests) 157ms
 ✓ tests/reporting/reportingFoundation.test.ts (63 tests) 164ms
 ✓ tests/reporting/technicianSelfScoping.test.ts (9 tests) 12ms
 ✓ tests/reporting/technicianProductivityReports.test.ts (14 tests) 57ms

 Test Files  5 passed (5)
      Tests  122 passed (122)
   Duration  2.51s
```

### 3.2 Full Workspace Test Suite Output
```
 Test Files  195 passed (195)
      Tests  3593 passed (3593)
   Duration  56.04s
```
Zero regressions across all 195 test files; baseline cleanly advanced to **3,593 passed tests**.

### 3.3 TypeScript Type-Check
```
npx tsc --noEmit
Exit code: 0 (Zero type errors)
```
