# Phase 1.14 Reporting & Analytics — Architecture Specification

> **Document Status**: LOCKED FOR IMPLEMENTATION (Phase 1.14 Architecture Standard)
> **Domain**: Reporting & Analytics — Metric Registry, Dimension Registry, Report Composition, Canonical Date-Range Resolution, Aggregation Read Models, CSV Export
> **Dependencies**: Phase 1.1 (Multi-Tenancy & Workspace Partitioning), Phase 1.2 (Authentication & RBAC), Phase 1.3 (Organization & Team), Phase 1.4 (Customers & Service Locations), Phase 1.5 (Service Catalog & Work Types — *pricing pending*), Phase 1.6 (Work Orders), Phase 1.7 (Assets & Equipment), Phase 1.8 (Scheduling & Dispatch), Phase 1.9 (Technician Operations), Phase 1.10 (Inventory & Parts), Phase 1.11 (Quotes & Estimates), Phase 1.12 (Invoicing & Payments), Phase 1.13 (Notifications & Communications)
> **Target Service & API Implementation**: Phase 1.14.2 – Phase 1.14.10
> **Out of Scope (Named Explicitly)**: Phase 1.15 (SaaS Billing & Subscriptions), Phase 1.16 (Automation & Workflows), Phase 1.17 (Integrations), Phase 1.23 (Web App UI/UX)

---

## Executive Summary

Phases 1.1 through 1.13 established every operational system of record in Aforden: tenancy and RBAC, customers and service locations, the service catalog, work orders, assets, scheduling and dispatch, technician field execution, inventory movements, quotes, invoices and payments, and the multi-channel notification layer.

Phase 1.14 adds the **Reporting & Analytics** domain: the layer that answers operational, financial, and historical questions **across** those domains **without ever mutating any of them**.

This document is the binding architectural contract for Phase 1.14. Ten decisions define it:

1. **Reporting is a strictly read-only consumer.** It owns no operational state, no business rules, and no pricing logic. It aggregates what other domains already computed and stored.
2. **Phase 1.14 introduces zero Prisma models and zero data migrations.** The only DDL it produces is an **index-only migration** against prior-phase tables (§10.3) — no new columns, no new tables, no row writes.
3. **Every metric and every dimension is registered in a closed, compile-time allowlist** (`METRIC_REGISTRY`, `DIMENSION_REGISTRY`) modeled directly on the Phase 1.13 `EVENT_CATALOG_REGISTRY` pattern. No metric is ever computed inline in a route handler.
4. **Reports are parametrized, code-registered query specifications — not a persisted entity.** No `ReportDefinition` table in Phase 1.14 (§3).
5. **Query strategy is (A) live aggregation**, executed in PostgreSQL via Prisma `aggregate` / `groupBy` / `count`. No materialized read models, no ETL, and therefore **no new scheduler dependency** (§4). A named register of future materialization candidates and their numeric trigger thresholds is locked in §4.5.
6. **One canonical date-range resolver.** `resolveReportDateRange()` is the single permitted source of date boundaries, with half-open `[startUtc, endUtc)` semantics, workspace-timezone anchoring, and explicit DST disambiguation rules (§5).
7. **Tenant isolation is structural**, expressed inside every `where` clause — never as a post-query filter (§6).
8. **Money is read from stored snapshots only.** Reporting never invokes a calculation engine and never reads a current catalog or current part cost to derive a historical total (§11).
9. **Every metric declares its temporality** — `PERIOD` (anchored to one explicit timestamp column) or `POINT_IN_TIME` (as-of query time) — so a range filter can never be silently applied to a metric that has no meaningful date anchor (§2.4).
10. **CSV export is in scope for 1.14.9. XLSX and PDF are out of scope for all of Phase 1.14** (§13).

---

```
+-----------------------------------------------------------------------------------------------------------+
|                                          WORKSPACE (Tenant)                                               |
|                                                                                                           |
|  OPERATIONAL SYSTEMS OF RECORD (Phases 1.4 - 1.13)  —  OWNED ELSEWHERE, READ-ONLY HERE                     |
|  +-------------+ +-------------+ +-------------+ +-------------+ +-------------+ +---------------------+   |
|  | WorkOrder   | | Schedule    | | TimeEntry   | | Quote       | | Invoice     | | Inventory / Asset   |   |
|  | (1.6/1.9)   | | Appointment | | (1.9)       | | LineItem    | | LineItem    | | Balance / Movement  |   |
|  |             | | (1.8)       | |             | | (1.11)      | | Payment     | | WorkOrderPart       |   |
|  |             | |             | |             | |             | | (1.12)      | | (1.7/1.10)          |   |
|  +------+------+ +------+------+ +------+------+ +------+------+ +------+------+ +----------+----------+   |
|         |               |               |               |               |                   |              |
|         |  SELECT / COUNT / SUM / AVG / GROUP BY  — no INSERT, no UPDATE, no DELETE, ever    |              |
|         +---------------+---------------+-------+-------+---------------+-------------------+              |
|                                                 |                                                          |
|         ==============================================================================================     |
|         |                        REPORTING & ANALYTICS DOMAIN (Phase 1.14)                           |     |
|         |                                                                                            |     |
|         |  [1] REQUEST VALIDATION                                                                    |     |
|         |      reportKey -> REPORT_REGISTRY   metrics[] -> METRIC_REGISTRY                            |     |
|         |      dimensions[] -> DIMENSION_REGISTRY   filters/sort -> per-report allowlist              |     |
|         |      Anything not in a registry is REJECTED (400/422). No arbitrary field access.           |     |
|         |                                    |                                                        |     |
|         |  [2] AUTHORIZATION                 v                                                        |     |
|         |      requireWorkspaceAuthorization(workspaceId)  ->  assertPermission(role, perm)           |     |
|         |      TECHNICIAN self-scope injected structurally; foreign technicianId -> 403                |     |
|         |                                    |                                                        |     |
|         |  [3] CANONICAL DATE RANGE          v                                                        |     |
|         |      resolveReportDateRange({ workspaceTimezone, preset | from/to, granularity })           |     |
|         |      -> { startUtc (incl), endUtc (excl), timezone, granularity }                           |     |
|         |      The ONLY permitted source of date boundaries in this domain.                            |     |
|         |                                    |                                                        |     |
|         |  [4] AGGREGATION EXECUTION         v                                                        |     |
|         |      Prisma count / aggregate / groupBy, batched with Promise.all (no per-row loops)          |     |
|         |      where: { workspaceId, <anchorField>: { gte: startUtc, lt: endUtc }, ...filters }        |     |
|         |      Time-bucketed series: single documented parameterized $queryRaw exception (§8.4)        |     |
|         |                                    |                                                        |     |
|         |  [5] READ MODEL ASSEMBLY           v                                                        |     |
|         |      Typed DTO only — NO persisted reporting table (§12)                                    |     |
|         |      { meta: {...}, rows | series | scalars, pagination? }                                  |     |
|         ==============================================================================================     |
|                                                 |                                                          |
|                          +----------------------+----------------------+                                   |
|                          v                                             v                                   |
|         +--------------------------------+          +--------------------------------------+                |
|         |  REST API (Phase 1.14.9)       |          |  CSV Export (Phase 1.14.9)           |                |
|         |  GET /api/workspaces/[wsId]/   |          |  text/csv, RFC4180, injection-safe,  |                |
|         |      reports/[reportKey]       |          |  row-capped, reports.export required |                |
|         |  { success: true, data: {...} } |          |  XLSX / PDF: OUT OF SCOPE            |                |
|         +--------------------------------+          +--------------------------------------+                |
+-----------------------------------------------------------------------------------------------------------+
```

---

## 1. Reporting Domain Boundaries

### 1.1 Ownership Matrix

| Domain | Owns | Does NOT Own / Consumes |
| :--- | :--- | :--- |
| **Reporting & Analytics** (Phase 1.14) | `METRIC_REGISTRY`, `DIMENSION_REGISTRY`, `REPORT_REGISTRY`, `resolveReportDateRange()`, aggregation service functions, report read-model DTOs, CSV serialization, report REST route handlers, reporting error taxonomy, reporting-specific composite indexes on prior-phase tables (index DDL only — §10.3). | Owns **no entity state**. Owns **no business rules**. Owns **no pricing or tax logic**. Owns **no tables**. Consumes every operational model strictly via `SELECT`. |
| **Work Orders** (1.6 / 1.9) | `WorkOrder`, `WorkOrderHistory`, `TechnicianTimeEntry`, status machine, `completedAt` / `cancelledAt` semantics. | Reporting reads these; reporting never writes them and never redefines what "completed" means. |
| **Scheduling & Dispatch** (1.8) | `ScheduleAppointment`, `ScheduleAppointmentHistory`, dispatch lifecycle. | Reporting reads; reporting does not add lifecycle timestamps to satisfy a metric (§17.2). |
| **Quotes & Estimates** (1.11) | `Quote`, `QuoteLineItem`, `quoteCalculationEngine`, `quotePricingSnapshots`. | Reporting reads stored `subtotal` / `discountAmount` / `taxAmount` / `total`. Reporting **never calls** `quoteCalculationEngine`. |
| **Invoicing & Payments** (1.12) | `Invoice`, `InvoiceLineItem`, `Payment`, `invoiceCalculationEngine`, `invoiceSnapshots`, balance reconciliation (`amountPaid` / `amountDue`). | Reporting reads stored snapshot columns. Reporting **never calls** `invoiceCalculationEngine` and never recomputes a total. **Phase 1.12's stored snapshot is the sole source of truth for money.** |
| **Inventory & Parts** (1.10) | `Part`, `InventoryBalance`, `StockMovement`, `WorkOrderPart` (incl. `unitCostAtTimeOfUse`). | Reporting reads. Cost-of-parts metrics use `WorkOrderPart.unitCostAtTimeOfUse`, never `Part.unitCost`. |
| **Assets** (1.7) / **Customers** (1.4) | `Asset`, `AssetHistory`, `Customer`, `CustomerContact`, `ServiceLocation`. | Reporting reads. |

### 1.2 The Non-Negotiable Read-Only Invariant

**No code in the Reporting domain — in Phase 1.14 or in any future 1.14.x sub-phase — may execute an `INSERT`, `UPDATE`, `UPSERT`, or `DELETE` against any operational table**, specifically including: `WorkOrder`, `WorkOrderHistory`, `Customer`, `CustomerContact`, `ServiceLocation`, `Employee`, `TechnicianProfile`, `TechnicianTimeEntry`, `TechnicianAssignment`, `Asset`, `AssetHistory`, `Part`, `InventoryBalance`, `StockMovement`, `WorkOrderPart`, `Quote`, `QuoteLineItem`, `QuoteHistory`, `Invoice`, `InvoiceLineItem`, `InvoiceHistory`, `Payment`, `ScheduleAppointment`, `ScheduleAppointmentHistory`, `ServiceCatalog`, `WorkType`, `Workspace`, `WorkspaceMember`, and every notification table.

Concretely forbidden, and to be raised as a **blocker** if proposed in any later sub-phase:

- ❌ "Compute the KPI once and cache it back onto the `WorkOrder` row" — a reporting query producing a side effect on operational data.
- ❌ "Backfill `WorkOrder.completedAt` where it is null so the completion report looks right" — data repair is an operational-domain concern, not a reporting concern.
- ❌ "Add `ScheduleAppointment.acknowledgedAt` because the dispatch-latency metric needs it" — a reporting requirement may **surface** a data-model gap, but the column is owned by Phase 1.8 and requires an operational-domain decision. Phase 1.14 defers the metric instead (§17.2).
- ❌ "Mark the invoice `OVERDUE` while reporting on AR aging" — `evaluateInvoiceOverdue()` is a Phase 1.12 write-path service. Reporting derives aging arithmetically from stored `dueDate` / `amountDue` and does not transition status.
- ❌ Passing a `Prisma.TransactionClient` into any reporting service. Reporting functions take `prisma` (read client) only, and there is no reporting call site inside an operational `$transaction`.

The single, explicitly bounded exception is **index-only DDL** (`CREATE INDEX`) against prior-phase tables, specified in §10.3. Indexes change no row and no schema shape; they are the physical-access-path complement to a read-only consumer. Column additions, type changes, and data backfills remain forbidden.

### 1.3 What This Domain Does NOT Define

- **Business rules.** Reporting does not decide when a work order is complete, when an invoice is overdue, or when a quote expires. It reads the state those domains recorded.
- **Financial recalculation.** Reporting does not re-derive pricing, discounts, or tax. Phase 1.12's snapshot invariant governs money; reporting aggregates the stored snapshots (§11.1).
- **Thresholds and targets.** Reporting returns measured values. It does not encode SLA targets, quotas, or "good/bad" judgments — those belong to a UI (1.23) or an automation rule (1.16).

### 1.4 Explicit Scope Exclusions

| Excluded | Owning Phase | Why it is not here |
| :--- | :--- | :--- |
| Automation rules, conditional workflows, scheduled triggers, alerting on a metric crossing a threshold | **1.16** | Phase 1.14 produces values; acting on values is automation. |
| SaaS billing, subscription plans, seat counting, usage metering for invoicing Aforden's own customers | **1.15** | Platform revenue is a different tenant model from workspace operational revenue. Do not conflate `Invoice` (customer billing) with subscription billing. |
| External BI connectors, data warehouse sync, webhook push of report results, third-party analytics SDKs | **1.17** | Reporting exposes an internal REST surface only. |
| Dashboard UI, chart rendering, widget layout, saved-view UX | **1.23** | Phase 1.14 is backend services and APIs only (§14). |
| Cross-workspace / platform-wide analytics for Aforden staff | **1.19** | Every Phase 1.14 query is single-workspace-scoped by construction (§6). |
| Immutable period-close / accounting-restatement ledger | Future | Acknowledged limitation, documented in §11.4. |

---

## 2. Analytics Terminology — Metrics vs. Dimensions

### 2.1 Definitions (Locked)

**Metric** — a *computed numeric aggregate* over a set of rows. A metric is always the result of an aggregate function: `COUNT`, `SUM`, `AVG`, or a `RATE` derived from two of those. A metric is never a raw column value of a single row, and never a string.

**Dimension** — a *grouping or filtering axis*: the categorical or temporal attribute a metric is broken down by. A dimension is always a discrete, low-to-bounded-cardinality attribute reachable from the metric's source model (a column on it, a directly related entity's identity, or a time bucket).

| | Metric | Dimension |
| :--- | :--- | :--- |
| Answers | "How many / how much / how long / what rate" | "Broken down by what" |
| Type | numeric (integer, `Prisma.Decimal`, minutes, percent) | string key + display label |
| SQL role | `SELECT COUNT(*)`, `SUM(total)`, `AVG(...)` | `GROUP BY` / `WHERE` |
| Examples | `workOrders.completedCount`, `payments.collectedTotal`, `workOrders.avgCycleTimeMinutes`, `quotes.winRate` | `customer`, `technician`, `workType`, `status`, `priority`, `time.month` |

A **report** combines them (§3). `workOrders.completedCount` grouped by `technician` and `time.month` is one metric, two dimensions.

### 2.2 The Metric Registry (Mandatory Allowlist)

Modeled directly on `EVENT_CATALOG_REGISTRY` (`lib/services/notification/eventCatalogRegistry.ts`). Target file: `lib/services/reporting/metricRegistry.ts`.

**No metric may be computed anywhere except through a registry entry.** A route handler that computes an aggregate inline is a specification violation.

```typescript
// lib/services/reporting/reporting.types.ts

/** Prisma models the Reporting domain is permitted to read. Closed set. */
export type ReportSourceModel =
  | "WorkOrder"
  | "ScheduleAppointment"
  | "TechnicianTimeEntry"
  | "Quote"
  | "Invoice"
  | "Payment"
  | "WorkOrderPart"
  | "StockMovement"
  | "InventoryBalance"
  | "Asset"
  | "Customer";

export type MetricCategory =
  | "OPERATIONAL"   // work orders, scheduling, dispatch
  | "FINANCIAL"     // quotes, invoices, payments, AR
  | "TECHNICIAN"    // per-technician productivity & time
  | "INVENTORY"     // parts, stock, cost of parts consumed
  | "ASSET"
  | "CUSTOMER";

export type MetricValueType =
  | "COUNT"                 // integer
  | "SUM_MONEY"             // Prisma.Decimal, serialized as a fixed-2 string
  | "SUM_QUANTITY"          // Prisma.Decimal, serialized as a fixed-4 string
  | "AVG_DURATION_MINUTES"  // number, minutes
  | "RATE_PERCENT";         // number, 0..100, 2dp

/**
 * PERIOD        — the metric is meaningful over [startUtc, endUtc) and MUST declare a dateAnchor.
 * POINT_IN_TIME — the metric describes current state ("as of now"). It has NO dateAnchor, ignores
 *                 the requested range, reports meta.asOfUtc, and CANNOT be used in a time series.
 */
export type MetricTemporality = "PERIOD" | "POINT_IN_TIME";

/** The single timestamp column a PERIOD metric is filtered on. Closed set per source model. */
export interface MetricDateAnchor {
  model: ReportSourceModel;
  field: string;   // literal Prisma field name, e.g. "completedAt", "issueDate", "paymentDate"
}

export interface MetricDefinition {
  key: MetricKey;
  category: MetricCategory;
  valueType: MetricValueType;
  temporality: MetricTemporality;
  sourceModel: ReportSourceModel;

  /** Required iff temporality === "PERIOD". Null iff "POINT_IN_TIME". */
  dateAnchor: MetricDateAnchor | null;

  /**
   * Non-negotiable predicate applied on top of workspace scope and the date range.
   * Expressed as a factory so it can never be mutated by a caller.
   * Example: workOrders.completedCount => () => ({ status: "COMPLETED" })
   */
  baseWhere: () => Record<string, unknown>;

  /** Aggregate pushed to PostgreSQL. */
  aggregation:
    | { kind: "COUNT" }
    | { kind: "SUM"; field: string }
    | { kind: "AVG_DATE_DIFF_MINUTES"; fromField: string; toField: string }
    | { kind: "SUM_PRODUCT"; leftField: string; rightField: string } // requires in-memory Decimal reduce (§8.3)
    | { kind: "RATE"; numerator: MetricKey; denominator: MetricKey };

  requiredPermission: Permission;
  supportedDimensions: readonly DimensionKey[];

  /** true => the metric reads stored snapshot columns and must never re-derive pricing (§11.1). */
  isSnapshotDerived: boolean;

  /** null => live aggregation is sufficient indefinitely. Non-null => flagged in §4.5. */
  materializationTrigger: MaterializationTrigger | null;

  description: string;
}

export type MetricRegistry = Readonly<Record<MetricKey, MetricDefinition>>;
```

`MetricKey` is a string-literal union, so an unknown key is a **compile-time** error internally and a **400 `UnknownMetricError`** at the API boundary:

```typescript
export type MetricKey =
  // --- OPERATIONAL (1.14.3) ---
  | "workOrders.createdCount"
  | "workOrders.completedCount"
  | "workOrders.cancelledCount"
  | "workOrders.openBacklogCount"          // POINT_IN_TIME
  | "workOrders.completionRate"
  | "workOrders.avgCycleTimeMinutes"
  // --- SCHEDULING (1.14.4) ---
  | "schedule.appointmentsScheduledCount"
  | "schedule.appointmentsCompletedCount"
  | "schedule.appointmentsCancelledCount"
  | "schedule.dispatchedCount"
  | "schedule.avgDispatchLatencyMinutes"
  // --- TECHNICIAN (1.14.5) ---
  | "technicians.completedWorkOrderCount"
  | "technicians.onSiteMinutes"
  | "technicians.travelMinutes"
  | "technicians.trackedMinutes"
  | "technicians.onSiteShareOfTrackedTime"
  // --- FINANCIAL (1.14.6) ---
  | "quotes.createdCount"
  | "quotes.approvedCount"
  | "quotes.rejectedCount"
  | "quotes.approvedTotal"
  | "quotes.winRate"
  | "invoices.issuedCount"
  | "invoices.issuedTotal"
  | "invoices.voidedCount"
  | "invoices.voidedTotal"
  | "invoices.outstandingBalance"          // POINT_IN_TIME
  | "invoices.avgDaysToPayment"
  | "payments.collectedCount"
  | "payments.collectedTotal"
  // --- INVENTORY / ASSET / CUSTOMER (1.14.7) ---
  | "inventory.partsConsumedCost"
  | "inventory.partsConsumedQuantity"
  | "inventory.quantityOnHand"             // POINT_IN_TIME
  | "inventory.belowMinimumStockPartCount" // POINT_IN_TIME
  | "assets.count"                         // POINT_IN_TIME
  | "assets.warrantyExpiringCount"         // POINT_IN_TIME
  | "customers.newCount"
  | "customers.activeCount";               // POINT_IN_TIME
```

The registry is **populated incrementally across 1.14.3 – 1.14.7**. Its *shape* is locked now; each sub-phase adds entries without touching the composition engine. This is the Open–Closed property that made `EVENT_CATALOG_REGISTRY` work in Phase 1.13.

### 2.3 The Dimension Registry (Mandatory Allowlist)

```typescript
export type DimensionKey =
  | "time.day" | "time.week" | "time.month" | "time.quarter" | "time.year"
  | "customer" | "technician" | "workType" | "serviceCatalog"
  | "workOrderStatus" | "workOrderPriority"
  | "appointmentStatus" | "dispatchStatus"
  | "quoteStatus" | "invoiceStatus" | "paymentMethod"
  | "assetStatus" | "assetCategory"
  | "part" | "inventoryLocation" | "timeEntryType";

export interface DimensionDefinition {
  key: DimensionKey;
  kind: "COLUMN" | "RELATION_ID" | "DATE_BUCKET";

  /**
   * Literal Prisma field name on the source model, resolved from THIS registry only.
   * Never assembled from, influenced by, or concatenated with request input.
   */
  groupByField: string | null;   // null for DATE_BUCKET

  /** Where the human-readable label comes from when the grouped value is an opaque id. */
  labelSource:
    | { kind: "ENUM" }
    | { kind: "SELF" }
    | { kind: "RELATION"; model: ReportSourceModel | "TechnicianProfile" | "WorkType" | "Part" | "InventoryLocation" | "AssetCategory"; labelFields: readonly string[] }
    | { kind: "DATE_BUCKET" };

  /** Governs the cardinality guard in §9.4. */
  cardinalityClass: "LOW" | "MEDIUM" | "HIGH";

  /** Source models this dimension is reachable from without a synthetic join. */
  applicableModels: readonly ReportSourceModel[];

  description: string;
}
```

**Reachability rule.** A dimension is registered for a source model only when it is a column on that model or a direct `RELATION_ID` foreign key on it. `serviceArea` and `department` are deliberately **absent**: neither is reachable from `WorkOrder` without a multi-hop join (`WorkOrder → TechnicianProfile → TechnicianServiceArea`), and inventing that join would produce silently ambiguous fan-out. Dimensions are added only when a direct path exists.

Cardinality classes, from the current schema: `workOrderStatus` / `workOrderPriority` / `timeEntryType` / `quoteStatus` / `invoiceStatus` / `paymentMethod` / `assetStatus` = `LOW`; `technician` / `workType` / `serviceCatalog` / `inventoryLocation` / `assetCategory` / `time.*` = `MEDIUM`; `customer` / `part` = `HIGH`.

### 2.4 Temporality — Why It Is a First-Class Field

Applying a date range to a metric that has no date anchor produces a confidently wrong number. "Open backlog for last month" is not a filtered count of last month's rows; it is the *current* count of open work orders. Encoding temporality in the registry makes that class of error impossible:

- A `PERIOD` metric **must** declare exactly one `dateAnchor`. The resolver's `[startUtc, endUtc)` is applied to that field and no other.
- A `POINT_IN_TIME` metric **must** declare `dateAnchor: null`. The composition engine ignores the requested range for it, sets `meta.asOfUtc`, and rejects any request combining it with a `time.*` dimension (`422 UnsupportedMetricDimensionCombinationError`).
- Mixing both temporalities in one request is permitted; `meta` reports both `range` and `asOfUtc`, and each row is annotated with the temporality of the metric that produced it, so a UI can never label a point-in-time value with a period caption.

---

## 3. Report Definitions

### 3.1 Structural Definition (Locked)

A **report** is:

```
report = 1..N metrics
       + 0..N dimensions
       + exactly 1 resolved date range        (ignored by POINT_IN_TIME metrics)
       + 0..N allowlisted filters
       + 1 sort specification                 (allowlisted key + order + mandatory tie-breaker)
       + pagination                           (grouped results only)
```

### 3.2 Decision: Reports Are Parametrized Query Specs Registered in Code — **No `ReportDefinition` Table in Phase 1.14**

**Decision.** A report is a `REPORT_REGISTRY` entry addressed by a stable `reportKey`. Its parameters arrive per-request and are Zod-validated. **Nothing about a report is persisted.** Phase 1.14 adds no `ReportDefinition` model, no `SavedReport` model, and no migration for either.

```typescript
export type ReportKey =
  | "operational.workOrderVolume"
  | "operational.workOrderThroughput"
  | "scheduling.dispatchPerformance"
  | "technician.productivity"
  | "financial.revenueSummary"
  | "financial.arAging"
  | "financial.quotePipeline"
  | "inventory.partsConsumption"
  | "customer.activitySummary";

export interface ReportDefinition {
  reportKey: ReportKey;
  category: MetricCategory;
  title: string;

  metrics: readonly MetricKey[];
  allowedDimensions: readonly DimensionKey[];
  allowedFilters: readonly FilterKey[];
  allowedSortKeys: readonly (MetricKey | DimensionKey)[];
  defaultSort: { key: MetricKey | DimensionKey; order: "asc" | "desc" };

  requiredPermission: Permission;
  /** Roles for which the viewer's own technician scope is injected structurally (§7.3). */
  selfScopedRoles: readonly MembershipRole[];

  supportsTimeSeries: boolean;
  supportsCsvExport: boolean;

  paramsSchema: z.ZodType<unknown>;
  description: string;
}
```

**Justification against what 1.14.9 and 1.23 actually need.**

1. **1.14.9 (REST API) needs nothing persisted.** The endpoint is `GET /api/workspaces/[workspaceId]/reports/[reportKey]?from=&to=&dimensions=&metrics=&…`. A report is fully specified by its URL. Persistence would add a write path, an ownership model, and a lifecycle to a phase whose defining invariant is that it writes nothing.
2. **A saved report is a UI preference, and the UI does not exist.** "Save this view and name it" is meaningless without a place to list and open saved views. Building the table now means designing sharing semantics (private / workspace-visible / role-visible), rename and delete authorization, and orphan handling when a `reportKey` is retired — all with zero consumers. That is precisely the over-build the specification forbids.
3. **The definition belongs in code, not in data.** A report's metric composition is executable logic bound to a compile-time registry. Persisting it as JSON would create a second, drift-prone source of truth and would reintroduce the arbitrary-field-selection risk §8.2 closes: a stored definition is data, and data can be edited to reference an unregistered field.
4. **Forward compatibility is preserved, and the future table is additive.** Because every report is addressed by a stable `reportKey` plus a validated params object, a future saved-view feature needs only:

```prisma
// NOT part of Phase 1.14. Sketch only, to demonstrate that deferring costs nothing.
model SavedReport {
  id            String   @id @default(cuid())
  workspaceId   String
  ownerMemberId String
  name          String
  reportKey     String   @db.VarChar(64)   // validated against REPORT_REGISTRY at read time
  params        Json                        // re-validated through paramsSchema on every load
  visibility    String   @db.VarChar(16)    // PRIVATE | WORKSPACE
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  @@unique([workspaceId, ownerMemberId, name])
  @@index([workspaceId, ownerMemberId])
}
```

   This is purely additive: it stores a *saved parameter set*, not a definition. No Phase 1.14 service signature changes. The name is deliberately `SavedReport`, not `ReportDefinition`, to keep the distinction permanent — **the definition lives in code; only a user's chosen parameters could ever be persisted.**

5. **Retirement safety.** With definitions in code, removing or renaming a metric is a compile error caught in CI. With definitions in rows, it is a runtime failure discovered by a user.

**Consequence, stated plainly:** a user cannot save a named report in Phase 1.14. They can bookmark or share a URL, which covers the realistic need until 1.23 exists.

---

## 4. THE Critical Architectural Decision: Query Strategy

### 4.1 Decision

**Strategy (A) — live aggregation on demand.** Every Phase 1.14 metric is computed at query time by pushing `COUNT` / `SUM` / `AVG` / `GROUP BY` into PostgreSQL through Prisma's `count`, `aggregate`, and `groupBy` APIs, filtered by `workspaceId` and the metric's declared date anchor. There are **no reporting tables, no projections, no ETL, and no refresh jobs.** Phase 1.14 introduces **no dependency on scheduled-job infrastructure**.

Strategy (C) is the designated evolution path. It is **not** adopted now, and §4.5 records exactly which metrics would move first and at what measured trigger.

### 4.2 Why Live Aggregation Is Sufficient — Reasoned, Not Asserted

**(a) The working set is one tenant, not the table.** Every query is `WHERE "workspaceId" = $1` against a `workspaceId`-leading composite index. Total platform row count affects index size, not rows examined per query. Reporting scale is therefore governed by *per-workspace* volume, which is bounded by the physical reality of field service work.

**(b) Per-workspace volume, derived from the domain.** A field service workspace with 20 technicians completing ~6 jobs per technician per working day over ~250 working days generates ≈ **30,000 `WorkOrder` rows per year**. A monthly operational report therefore examines ≈ 2,500 rows; an annual report ≈ 30,000. `TechnicianTimeEntry` is the highest-volume operational table at roughly 3–5 rows per work order — ≈ 100k–150k rows/year for the same workspace. A PostgreSQL `COUNT` or `SUM` over 30k rows on a covering composite index is single-digit to low-tens of milliseconds. These are not sizes that require precomputation.

**(c) Aggregation happens in the database, not in Node.** `groupBy` and `aggregate` push the reduction into PostgreSQL, so the network and heap cost is proportional to the *number of result groups* (bounded by the cardinality guard in §9.4), not to the number of matched rows. The two exceptions that must scan rows into memory — `SUM_PRODUCT` and per-row bucket arithmetic — are explicitly enumerated and row-capped in §8.3.

**(d) The scheduler does not exist, and inventing one here would be the largest thing in this phase.** Verified against the current tree: there is no `setInterval`, no `node-cron`, no `vercel.json` cron block, and no worker runtime anywhere in `lib/`, `app/`, or `scripts/`. Phase 1.13 wrote worker *functions* (`outboxProcessorService`, `retryDeliveryService`, `reconciliationWorker`) but deliberately shipped **no runtime that drives them**, and deferred `SCHEDULE_APPOINTMENT_APPROACHING` for exactly that reason. Choosing (B) or (C) now would make "build a scheduler" a hidden prerequisite of a reporting phase. That is the wrong phase to introduce durable background infrastructure; it belongs with 1.16 (Automation) or 1.22 (Production Deployment), where its own failure modes, observability, and idempotency can be designed properly rather than as a side effect.

**(e) The alternative refresh mechanism is architecturally worse than the query.** Without a scheduler, a materialized summary table can only be refreshed by hooking the operational write path — "when a `WorkOrder` is completed, also update `WorkOrderDailySummary`." That would:
   - couple every operational service to the reporting domain, inverting the dependency this document establishes;
   - put reporting writes inside operational transactions, so a reporting-table failure could roll back a work order completion — the precise blast-radius problem Phase 1.13's outbox pattern was built to avoid;
   - sit one inch from the forbidden pattern in §1.2 (a reporting concern causing a side effect on an operational write).
   A fast read query has none of these properties.

**(f) Live is *more correct*, not merely simpler.** A dispatcher looking at today's open backlog needs the current number. A materialized read model is stale by construction, and its staleness window becomes a support question ("why does the dashboard say 14 when the list shows 15?"). For an operational FSM tool, freshness is a functional requirement, not a nice-to-have.

**(g) (A) → (C) is additive; (B) → (A) is not.** Every metric is reached through `METRIC_REGISTRY` and a service-function boundary. A caller asks for `workOrders.completedCount`; whether that resolves via `prisma.workOrder.count()` or a summary-table lookup is an implementation detail *behind* the registry. Migrating one metric to materialization later changes one resolver and adds one table — no caller, no route, no DTO, and no other metric is touched. Starting at (B) would mean building and maintaining the projection infrastructure first and never writing the live path, which forfeits that optionality. **Choosing (A) preserves the ability to choose (C) later; choosing (B) does not preserve the ability to choose (A).**

### 4.3 The Honest Counter-Argument, and Its Mitigation

Live aggregation means a dashboard re-queries on every load. A 12-widget dashboard is 12+ aggregate queries per page view, and a workspace with several concurrent dispatchers multiplies that. Recorded mitigations, all inside Phase 1.14 and none requiring new infrastructure:

1. **Batch, never loop.** One service call issues all of a report's aggregates through a single `Promise.all`, following the established precedent in `getAssetOperationalSummary()` (five parallel aggregates, one round trip's worth of latency). Per-row query loops are forbidden (§10.1).
2. **Composite reports over widget-per-request.** 1.14.8 provides pre-composed report keys (e.g. `operational.workOrderVolume` returning several related metrics at once), so a dashboard section is one HTTP request, not eight.
3. **Transport-layer caching, not a materialized table.** Report `GET` responses carry `Cache-Control: private, max-age=60`. Sixty seconds of caching removes the repeated-reload cost without introducing a stale persisted read model or a refresh job. Caching is reversible and stateless; materialization is neither.
4. **Guards, not silence.** Range width caps (§5.5), group cardinality caps (§9.4), and scan-row caps (§8.3) fail loudly with a 422 rather than degrading quietly, so a pathological query is surfaced as a bug instead of a slow page.
5. **Measured triggers.** §4.5 defines when to stop mitigating and start materializing.

### 4.4 Rejected Alternatives

| Strategy | Rejected because |
| :--- | :--- |
| **(B) Periodic ETL → dedicated reporting tables, queried directly** | Requires a scheduler that does not exist (§4.2d); introduces staleness as a functional regression (§4.2f); adds tables, migrations, and backfill to a phase whose defining property is writing nothing; forfeits the live path (§4.2g). Unjustified at the volumes in §4.2b. |
| **(C) Hybrid — live for most, materialized for specific expensive metrics** | Correct destination, premature now. Adopting it today means paying for scheduler infrastructure to serve a materialization need that no measurement has yet demonstrated. Deferred with explicit, numeric triggers in §4.5. |
| **PostgreSQL materialized views** | Same scheduler dependency for `REFRESH MATERIALIZED VIEW`; additionally invisible to Prisma's type generator, so it would push the domain toward raw SQL — the opposite of §8's direction. |
| **Application-level in-memory cache of computed metrics** | Multi-tenant cache-key correctness and invalidation-on-write are strictly harder than the query being cached, and Next.js server instances are not a coherent cache tier. HTTP caching (§4.3.3) achieves the realistic benefit with none of the correctness risk. |

### 4.5 Materialization Trigger Register (Flagged, Not Built)

Locked constants (`lib/services/reporting/reportingConstants.ts`):

```typescript
export const MATERIALIZATION_TRIGGERS = {
  /** Any single workspace exceeding this WorkOrder row count. */
  WORK_ORDER_ROWS_PER_WORKSPACE: 250_000,
  /** Any single workspace exceeding this TechnicianTimeEntry row count. */
  TIME_ENTRY_ROWS_PER_WORKSPACE: 500_000,
  /** Any single workspace exceeding this Invoice row count. */
  INVOICE_ROWS_PER_WORKSPACE: 200_000,
  /** Observed p95 latency for any single report endpoint. */
  REPORT_P95_LATENCY_MS: 1_500,
} as const;
```

Reaching any trigger opens a materialization decision for the metrics below — it does not authorize one silently.

| Metric | Why it materializes first | Trigger | Future home |
| :--- | :--- | :--- | :--- |
| `technicians.onSiteMinutes`, `technicians.travelMinutes`, `technicians.trackedMinutes` | Scans the highest-volume operational table (`TechnicianTimeEntry`) and is the natural multi-year "trend" report. | `TIME_ENTRY_ROWS_PER_WORKSPACE` | Daily per-technician summary table, refreshed by 1.16+ scheduler |
| `workOrders.avgCycleTimeMinutes` | `AVG(completedAt − createdAt)` over multi-year ranges; no index can reduce the scanned set below the matching rows. | `WORK_ORDER_ROWS_PER_WORKSPACE` | Daily completion summary |
| `invoices.arAging` bucket distribution | Per-row `dueDate` arithmetic against `now` across all open invoices; not expressible as a single pushed-down aggregate (§8.3). | `INVOICE_ROWS_PER_WORKSPACE` | Nightly AR snapshot |
| `inventory.partsConsumedCost` | `SUM_PRODUCT` — requires scanning matched rows into memory for `Decimal` multiplication (§8.3). | `REPORT_P95_LATENCY_MS` | Daily consumption summary |
| Daily time series beyond 92 buckets | Bucket count multiplies work; already capped in §5.5. | `REPORT_P95_LATENCY_MS` | Pre-bucketed daily fact table |

Every entry above carries `materializationTrigger: { ... }` in its registry definition, so the register is machine-readable and cannot drift from this document.

---

## 5. Date/Time Handling

### 5.1 Storage Reality (Verified, Not Assumed)

Verified against `prisma/schema.prisma` and the generated migration SQL: **every** `DateTime` column in the platform is emitted as PostgreSQL **`TIMESTAMP(3)` — `timestamp without time zone`**. No column uses `@db.Timestamptz`. Prisma Client (via `@prisma/adapter-pg`) writes JavaScript `Date` values as UTC instants and reads them back as UTC. Therefore:

> **All operational timestamps are UTC instants stored in timezone-naive `timestamp(3)` columns.**

Two consequences bind this domain:

1. **Boundary arithmetic must happen in JavaScript**, converting workspace-local wall clock to a UTC instant before it reaches Prisma. The comparison in the database is a naive comparison against a UTC value.
2. **`date_trunc` on a bare column would bucket by UTC, not by workspace-local calendar.** Any SQL-side bucketing must explicitly round-trip through the target zone (§8.4). A December 31 23:30 local event in `Asia/Karachi` (UTC+5) is an 18:30 UTC event *on the same day*; but the same wall clock in `America/Los_Angeles` (UTC−8) is 07:30 UTC on **January 1** — silently landing in the wrong fiscal year if the zone is ignored.

### 5.2 Decision: Workspace Timezone Is the Sole Reporting Calendar

**Decision.** All date bucketing and all boundary computation use **`Workspace.timezone`** (schema default `"Asia/Karachi"`, per-workspace configurable, already surfaced on `WorkspaceAuthorizationContext.workspace.timezone`).

- The viewer's browser timezone is **never** used. Two members of the same workspace must see identical numbers for "last month"; a viewer-relative calendar would make shared financial reports non-reconcilable.
- Per-entity timezones are **never** consulted. `ScheduleAppointment.timezone` exists for appointment display, and Phase 1.8 has a fallback path that reads a service-location timezone; reporting ignores both so that every metric across every domain shares one calendar.
- Phase 1.14 exposes **no `timezone` request parameter**. The resolved zone is echoed in `meta.timezone` on every response so a consumer always knows the calendar a number was computed in.

### 5.3 Decision: Half-Open `[startUtc, endUtc)` Range Semantics

**Decision.** Internally, every range is **inclusive of start, exclusive of end**: `{ gte: startUtc, lt: endUtc }`. `lte` on a date boundary is forbidden in this domain.

Rationale: `lte` on an end boundary is a correctness trap with `TIMESTAMP(3)` precision. `lte: 2026-08-31T23:59:59.999Z` silently drops events in the final millisecond, and `lte: <next midnight>` double-counts the boundary instant across adjacent periods, so monthly totals no longer sum to the annual total. Half-open ranges tile exactly.

At the **API boundary**, callers supply *inclusive calendar dates* (`from=2026-08-01&to=2026-08-31`), because that is what humans mean. The resolver performs the inclusive→exclusive conversion by advancing `to` to the **next local midnight** — never by adding 24 hours, which is wrong on DST transition days.

### 5.4 The One Canonical Resolver

**Every report and every metric MUST obtain its boundaries from `resolveReportDateRange()`. No report may compute its own date boundary logic.** This mirrors the single-canonical-definition principle applied to completion time in §11.3. A service that constructs `new Date(...)` boundary arithmetic inline is a specification violation, enforced in review and by the 1.14.10 test suite.

```typescript
// lib/services/reporting/dateRange.ts

export type DateRangePreset =
  | "TODAY" | "YESTERDAY"
  | "THIS_WEEK" | "LAST_WEEK"
  | "THIS_MONTH" | "LAST_MONTH"
  | "THIS_QUARTER" | "LAST_QUARTER"
  | "THIS_YEAR" | "LAST_YEAR"
  | "LAST_7_DAYS" | "LAST_30_DAYS" | "LAST_90_DAYS" | "LAST_12_MONTHS";

export type DateBucketGranularity = "DAY" | "WEEK" | "MONTH" | "QUARTER" | "YEAR";

export interface ResolvedReportDateRange {
  readonly startUtc: Date;   // INCLUSIVE  [
  readonly endUtc: Date;     // EXCLUSIVE  )
  readonly timezone: string; // Workspace.timezone — the calendar these boundaries were computed in
  readonly granularity: DateBucketGranularity;
  readonly preset: DateRangePreset | null;
  readonly startLocalDate: string; // "2026-08-01" — inclusive first local day
  readonly endLocalDate: string;   // "2026-08-31" — inclusive LAST local day (display label)
  readonly bucketCount: number;
}

export function resolveReportDateRange(input: {
  workspaceTimezone: string;
  preset?: DateRangePreset;
  fromLocalDate?: string;  // "YYYY-MM-DD", inclusive
  toLocalDate?: string;    // "YYYY-MM-DD", INCLUSIVE as supplied by the caller
  granularity?: DateBucketGranularity;
  now?: Date;              // injectable for deterministic tests; defaults to new Date()
}): ResolvedReportDateRange;
```

Locked rules:

1. `preset` and (`fromLocalDate`, `toLocalDate`) are mutually exclusive. Supplying both → `422 InvalidReportDateRangeError`.
2. Supplying neither defaults to `THIS_MONTH`.
3. `fromLocalDate` / `toLocalDate` must match `^\d{4}-\d{2}-\d{2}$` and must be real calendar dates. Time-of-day components are rejected, not truncated — a caller passing an instant is making an assumption about the calendar that only the workspace timezone may make.
4. `startUtc` = the UTC instant of local `00:00:00.000` on `fromLocalDate`.
5. `endUtc` = the UTC instant of local `00:00:00.000` on the **day after** `toLocalDate`.
6. `fromLocalDate > toLocalDate` → `422 InvalidReportDateRangeError`.
7. Week boundaries use **Monday as the first day of week**, consistent with `AvailabilityDay` starting at `MONDAY` in the existing schema. Quarters are calendar quarters (Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec); no fiscal-year offset exists in the schema, and none is invented.
8. `granularity` defaults to the coarsest bucket that keeps `bucketCount` within the §5.5 caps for the resolved span.

### 5.5 Range Width and Bucket Caps

```typescript
export const MAX_BUCKETS_BY_GRANULARITY: Record<DateBucketGranularity, number> = {
  DAY: 92,      // ~1 quarter of daily points
  WEEK: 53,     // ~1 year
  MONTH: 36,    // 3 years
  QUARTER: 20,  // 5 years
  YEAR: 10,
} as const;

/** Absolute span ceiling for any single report request. */
export const MAX_RANGE_DAYS = 1_100; // ~3 years
```

Exceeding a bucket cap → `422 ReportDateRangeTooLargeError`, naming the requested granularity, the resulting bucket count, the cap, and the coarser granularity that would succeed. Exceeding `MAX_RANGE_DAYS` → the same error. **The range is never silently narrowed and the granularity is never silently coarsened** — a truncated result presented as complete is worse than a rejection.

### 5.6 DST Handling — Explicit Disambiguation

There is no date library in this project (verified: `package.json` has no `date-fns`, `luxon`, or `dayjs`). The established convention is `Intl.DateTimeFormat` offset probing, already used by `getZonedTimeParts()` in `lib/services/technicianProfile/availabilityIntervalUtils.ts`. Phase 1.14 follows it rather than adding a dependency.

```typescript
/** Offset, in ms, of `timeZone` at instant `at`. (localWallClockAsUtc − actualInstant) */
function zoneOffsetMs(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const hour = get("hour") === 24 ? 0 : get("hour"); // Intl may emit "24" for midnight
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return asUtc - at.getTime();
}

/** Converts a wall clock in `timeZone` to the corresponding UTC instant. */
export function zonedWallClockToUtc(
  y: number, mo: number, d: number, h: number, mi: number, s: number, timeZone: string,
): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);      // treat wall clock as if it were UTC
  const off1 = zoneOffsetMs(new Date(guess), timeZone);
  let utc = guess - off1;

  const off2 = zoneOffsetMs(new Date(utc), timeZone);   // re-probe at the corrected instant
  if (off2 !== off1) {
    utc = guess - off2;
    if (zoneOffsetMs(new Date(utc), timeZone) !== off2) {
      // Neither offset round-trips: the requested wall clock does not exist (spring-forward gap).
      // Resolve FORWARD using the pre-transition (smaller) offset.
      utc = guess - Math.min(off1, off2);
    }
  }
  return new Date(utc);
}
```

Locked disambiguation rules:

- **Non-existent local time** (spring forward; e.g. a zone whose DST transition lands at 00:00, where local midnight is skipped): resolve **forward** to the first instant that exists. A day's range never collapses to zero width.
- **Ambiguous local time** (fall back; the wall clock occurs twice): resolve to the **earlier** occurrence. The offset probe returns this naturally, and it keeps `[startUtc, endUtc)` tiling exact — the extra hour of a 25-hour local day belongs to that day, not to the next.
- **A DST-transition day is 23 or 25 hours long, and the resolver reflects that.** Boundaries are always computed as "UTC instant of local midnight on day D" and "UTC instant of local midnight on day D+1" — never as `startUtc + 86_400_000`.

`resolveReportDateRange()` and `zonedWallClockToUtc()` ship with a fixed-fixture unit suite in **Phase 1.14.2** covering: a zone with no DST (`Asia/Karachi`, the schema default), northern-hemisphere spring-forward and fall-back (`America/New_York`), southern-hemisphere transitions (`Australia/Sydney`), a sub-hour offset zone (`Asia/Kathmandu`, UTC+05:45), and a zone whose transition occurs at midnight. Tests inject `now` and never read the host clock.

> **Forward-looking note (not a Phase 1.14 dependency):** when `Temporal.ZonedDateTime` is available in the project's Node baseline, it is the preferred replacement for `zonedWallClockToUtc`. The swap is contained to one file precisely because §5.4 mandates a single resolver.

---

## 6. Tenant Isolation

**Non-negotiable and structural.** Every reporting query is scoped inside the query itself. There is no exception, no admin bypass, and no cross-workspace report in Phase 1.14.

1. **`workspaceId` is a mandatory first argument** to every reporting service function, and it originates from `requireWorkspaceAuthorization(workspaceId)` — never from an unvalidated request body.
2. **`workspaceId` appears in the `where` clause of every query**, including nested relation filters. Filtering after the fact is forbidden:

```typescript
// ✅ REQUIRED — scoped in the query
const completed = await prisma.workOrder.count({
  where: {
    workspaceId,                                     // structural tenant boundary
    status: "COMPLETED",
    completedAt: { gte: range.startUtc, lt: range.endUtc },
  },
});

// ❌ FORBIDDEN — post-query filtering; leaks via count/skip/take and loads foreign rows into memory
const all = await prisma.workOrder.findMany({ where: { status: "COMPLETED" } });
const mine = all.filter((w) => w.workspaceId === workspaceId);
```

3. **Relation filters carry the boundary too.** Where a model is reachable only through a parent, the scope is expressed on the parent, following the Phase 1.13 recipient-resolution precedent (`{ customer: { workspaceId } }` for `CustomerContact`). Every model in `ReportSourceModel` except `CustomerContact`-style children carries `workspaceId` directly, so this case is rare by design.
4. **Filter values are re-validated against the tenant.** A `customerId`, `technicianId`, `workTypeId`, `partId`, or `inventoryLocationId` filter is resolved with a workspace-scoped `findFirst` before use. An id belonging to another workspace yields `403 ReportScopeViolationError` — not an empty result set, which would leak existence-by-timing and confuse the caller.
5. **Every composite index this phase adds leads with `workspaceId`** (§10.3), so the tenant boundary is the physical access path, not merely a logical predicate.
6. **No raw SQL may interpolate `workspaceId`.** In the one permitted raw-SQL case (§8.4) it is a bound parameter.

---

## 7. Authorization / RBAC

### 7.1 New Permissions (Added in Phase 1.14.2)

Following the existing `PERMISSIONS` const-object and `ROLE_PERMISSIONS` map in `lib/services/authorization/`:

```typescript
// Additions to lib/services/authorization/permissions.ts (Phase 1.14)
REPORTS_VIEW_OPERATIONAL: "reports.view_operational",
REPORTS_VIEW_FINANCIAL:   "reports.view_financial",
REPORTS_VIEW_TECHNICIAN:  "reports.view_technician",
REPORTS_EXPORT:           "reports.export",
```

`OWNER` receives all four automatically (`ROLE_PERMISSIONS.OWNER = Object.values(PERMISSIONS)`).

### 7.2 Role → Report Category Matrix

| Role | Operational | Financial | Technician | Export (CSV) |
| :--- | :---: | :---: | :---: | :---: |
| **OWNER** | ✅ | ✅ | ✅ workspace-wide | ✅ |
| **ADMIN** | ✅ | ✅ | ✅ workspace-wide | ✅ |
| **MANAGER** | ✅ | ✅ | ✅ workspace-wide | ✅ |
| **DISPATCHER** | ✅ | ❌ | ✅ workspace-wide | ❌ |
| **TECHNICIAN** | ❌ | ❌ | ✅ **own data only** | ❌ |
| **ACCOUNTANT** | ✅ | ✅ | ❌ | ✅ |

Reasoning for each non-obvious cell:

- **MANAGER holds `reports.view_financial`.** The existing matrix already grants `MANAGER` `invoices.view`, `invoices.void`, `payments.view`, and `payments.create`. A role that can read and void every invoice can reconstruct any revenue aggregate from the list endpoint; withholding the aggregate adds friction without adding confidentiality. Consistency with the established permission set wins over a stricter-looking table.
- **DISPATCHER is excluded from financial reports** even though it currently holds `invoices.view` / `invoices.create` / `invoices.issue` / `payments.view`. Those grants are *transactional* — issue the invoice for the job in front of you. A workspace-wide revenue aggregate is a distinct disclosure surface. This is deliberately stricter than the row-level grant, and it is disclosed as an assumption in §18.3 along with the pre-existing observation that `DISPATCHER`'s `invoices.view` grant makes the boundary imperfect regardless. **Phase 1.14 does not modify any existing permission grant** — that is a Phase 1.20 (Security Hardening) question.
- **ACCOUNTANT is excluded from technician reports.** The role's existing grants are financial and read-only-operational; individual technician productivity is a people-management concern, not an accounting one. `ACCOUNTANT` retains operational reports because it already holds `work_orders.view`.
- **TECHNICIAN is restricted to its own data** and holds no export permission. Bulk CSV egress of workspace data is a supervisory capability.

### 7.3 Technician Self-Scoping Is Structural

Self-scope is injected into the `where` clause by the service, from the session — never taken from the request.

```typescript
/**
 * For roles in ReportDefinition.selfScopedRoles, resolves the viewer's own TechnicianProfile
 * and returns the technicianId that MUST be injected into the query.
 * Chain: WorkspaceMember -> Employee -> TechnicianProfile.
 */
async function resolveSelfTechnicianScope(
  workspaceId: string,
  auth: WorkspaceAuthorizationContext,
): Promise<string> {
  const employee = await prisma.employee.findFirst({
    where: { workspaceId, workspaceMemberId: auth.membership.id },
    select: { technicianProfile: { select: { id: true } } },
  });
  if (!employee?.technicianProfile) {
    throw new ReportScopeViolationError(
      "Viewer has no technician profile in this workspace and cannot view technician reports.",
    );
  }
  return employee.technicianProfile.id;
}
```

Locked rules:

1. If the viewer's role is in `selfScopedRoles`, the resolved id is injected into the query unconditionally.
2. If such a viewer supplies a `technicianId` filter that is **not** their own, the request is **rejected** with `403 ReportScopeViolationError`. It is **not** silently coerced to their own id — a caller who asked for another technician's numbers and received their own without being told would draw a false conclusion from a correct-looking response.
3. If such a viewer supplies no `technicianId`, the injected scope still applies. There is no unscoped path.
4. `meta.scope` on every response states `"WORKSPACE"` or `"SELF"`, so a consumer always knows which population a number describes.

### 7.4 Authorization Order (Every Reporting Service)

Matching the established service shape (`listInvoices`, `getAssetOperationalSummary`, `getCustomerOutstandingBalance`):

```
1. requireWorkspaceAuthorization(workspaceId)              -> WorkspaceAuthorizationContext
2. assertPermission(auth.membership.role, definition.requiredPermission)
3. Zod-validate params through definition.paramsSchema
4. resolveReportDateRange({ workspaceTimezone: auth.workspace.timezone, ... })
5. Apply self-scope injection (§7.3) if applicable
6. Validate every filter id against the tenant (§6.4)
7. Execute batched aggregation
8. Assemble and return the typed read model
```

Steps 1–2 precede all input parsing, so an unauthorized caller never reaches validation logic and cannot use error-shape differences to probe the registry.

---

## 8. Aggregation Strategy & Query Architecture

### 8.1 Prisma Aggregates Are the Default and Near-Exclusive Mechanism

Permitted: `prisma.<model>.count()`, `prisma.<model>.aggregate({ _count, _sum, _avg, _min, _max })`, `prisma.<model>.groupBy({ by, where, _count, _sum, _avg, orderBy, having })`, and `findMany` with an explicit narrow `select` where a derived value requires row-level arithmetic (§8.3).

```typescript
// Scalar PERIOD metric — workOrders.completedCount
await prisma.workOrder.count({
  where: { workspaceId, status: "COMPLETED", completedAt: { gte: startUtc, lt: endUtc } },
});

// Grouped metric — payments.collectedTotal by paymentMethod
await prisma.payment.groupBy({
  by: ["paymentMethod"],
  where: { workspaceId, status: "RECORDED", paymentDate: { gte: startUtc, lt: endUtc } },
  _sum: { amount: true },   // Prisma.Decimal — full precision, no float coercion
  _count: { _all: true },
});
```

Single-column money and quantity sums always use `_sum` so the reduction is pushed to PostgreSQL and returned as `Prisma.Decimal`.

### 8.2 Forbidden Input Surfaces (Structural, Not Advisory)

The following are **impossible by construction**, because the only path from request input to a query is through a registry lookup:

- ❌ **Arbitrary field selection.** `metrics` is `z.array(z.enum(METRIC_KEYS))`. An unregistered key → `400 UnknownMetricError`. There is no `fields=` parameter.
- ❌ **Arbitrary `groupBy`.** `dimensions` is `z.array(z.enum(DIMENSION_KEYS))`, further intersected with `definition.allowedDimensions` and with the metric's `supportedDimensions`. The literal column name passed to Prisma comes from `DIMENSION_REGISTRY[key].groupByField` — a compile-time constant. Request input selects *which registry entry*; it never supplies a field name.
- ❌ **Arbitrary filtering.** `filters` keys are validated against `definition.allowedFilters`; each `FilterKey` maps to a typed builder that emits a fixed `where` fragment. No key/value pair from the request is ever spread into a `where` object.
- ❌ **Arbitrary sorting.** See §9.3.
- ❌ **Any field outside the registries.** Reporting cannot read `Customer.notes`, `WorkOrder.internalNotes`, `Invoice.internalNotes`, `passwordHash`, `tokenHash`, or any other unregistered column, because no registry entry references them and `select` clauses are explicit.
- ❌ **String-interpolated SQL.** Absolutely, in every case, including the §8.4 exception.

### 8.3 Row-Scanning Metrics — Enumerated and Capped

Three metric shapes cannot be pushed down as a single PostgreSQL aggregate. They are enumerated here so no fourth appears without amending this document.

| Shape | Why | Approach | Guard |
| :--- | :--- | :--- | :--- |
| `SUM_PRODUCT` — e.g. `inventory.partsConsumedCost` = `Σ (quantity × unitCostAtTimeOfUse)` | Prisma `_sum` takes a single column, not an expression. | `findMany` with `select: { quantity, unitCostAtTimeOfUse }`, reduced with `Prisma.Decimal.mul/add`. Follows the established `getCustomerOutstandingBalance()` precedent, which reduces `Decimal` in JS rather than risking float coercion. | `MAX_SCAN_ROWS` |
| Bucketed arithmetic against `now` — e.g. AR aging buckets from `dueDate` | Bucket membership is a per-row computed predicate. | `findMany` with `select: { dueDate, amountDue }`, bucketed in memory with `Decimal` accumulators. | `MAX_SCAN_ROWS` |
| `AVG_DATE_DIFF_MINUTES` — e.g. `avgCycleTimeMinutes` | `AVG(completedAt − createdAt)` is not a Prisma `_avg`. | `findMany` with `select: { createdAt, completedAt }`, averaged in memory. Both fields non-null-filtered in `where`. | `MAX_SCAN_ROWS` |

```typescript
export const MAX_SCAN_ROWS = 50_000;
```

Exceeding it → `422 ReportCardinalityExceededError` naming the metric, the matched row count, the cap, and a narrower range suggestion. **Never a partial result presented as complete.** Each of these three metrics carries a non-null `materializationTrigger` (§4.5): they are the first candidates for precomputation precisely because they scan.

### 8.4 The Single Documented Raw-SQL Exception: Timezone-Correct Time Bucketing

**Scope of the exception: time-series bucketing only.** Nothing else in this domain may use raw SQL.

**Why it is required.** Prisma `groupBy` can group by a column, not by an expression, so there is no way to `GROUP BY <local month of completedAt>` through the typed API. Two alternatives were considered and rejected:

- *One aggregate query per bucket* (up to 92 parallel queries for a daily series): correct, but multiplies round trips and connection-pool pressure with no correctness gain over a single grouped query.
- *Scan all matched rows and bucket in memory*: correct for small ranges, but makes every time series an `MAX_SCAN_ROWS`-capped operation, converting the most commonly requested report shape into the most fragile one.

PostgreSQL does this correctly and cheaply, and — critically — it is the only participant that owns the IANA timezone database and therefore handles historical DST rules without the application encoding them.

**The permitted form.** `prisma.$queryRaw` with a tagged template. Values are bound parameters. The only non-parameter substitutions are identifiers and the granularity token, and both come from the compile-time registries:

```typescript
const GRANULARITY_SQL_TOKEN: Record<DateBucketGranularity, string> = {
  DAY: "day", WEEK: "week", MONTH: "month", QUARTER: "quarter", YEAR: "year",
} as const;

const SQL_IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]*$/;

/** Registry-sourced identifiers only. Throws before any value can reach Prisma.raw. */
function assertRegistryIdentifier(value: string, allowed: readonly string[]): string {
  if (!allowed.includes(value) || !SQL_IDENTIFIER.test(value)) {
    throw new ReportingIdentifierViolationError(`Illegal SQL identifier: ${value}`);
  }
  return value;
}

// table/column originate from METRIC_REGISTRY constants — never from the request.
const table  = Prisma.raw(`"${assertRegistryIdentifier(tableName,  REGISTERED_TABLES)}"`);
const anchor = Prisma.raw(`"${assertRegistryIdentifier(anchorField, REGISTERED_ANCHOR_FIELDS)}"`);
const trunc  = Prisma.raw(`'${GRANULARITY_SQL_TOKEN[range.granularity]}'`);

const rows = await prisma.$queryRaw<Array<{ bucket: Date; value: bigint }>>`
  SELECT
    (date_trunc(${trunc}, (${anchor} AT TIME ZONE 'UTC') AT TIME ZONE ${range.timezone})
      AT TIME ZONE ${range.timezone}) AS bucket,
    COUNT(*) AS value
  FROM ${table}
  WHERE "workspaceId" = ${workspaceId}
    AND ${anchor} >= ${range.startUtc}
    AND ${anchor} <  ${range.endUtc}
    AND "status" = ${statusFilter}
  GROUP BY 1
  ORDER BY 1 ASC
`;
```

Note the double `AT TIME ZONE`: the first reinterprets the naive `timestamp(3)` as the UTC instant it actually holds; the second projects it into the workspace calendar so `date_trunc` cuts on local boundaries; the third converts the bucket start back to a UTC instant for transport. This is the §5.1 storage reality handled explicitly rather than hoped away.

Mandatory conditions on this exception, all enforced in 1.14.8 and tested in 1.14.10:

1. Every **value** — timezone, `workspaceId`, boundaries, filter values — is a bound parameter via the tagged template. Zero exceptions.
2. Every **identifier** passes `assertRegistryIdentifier` against a closed registry-derived list before reaching `Prisma.raw`. The regex is a second line of defence, not the primary one.
3. The granularity token is looked up from `GRANULARITY_SQL_TOKEN` by an already-validated enum value. A request string never reaches the SQL.
4. Empty buckets are back-filled to zero **in application code** from `resolveReportDateRange`, so a sparse `GROUP BY` result cannot be mistaken for a gap in the timeline.
5. Any future proposal to widen this exception requires amending this document.

### 8.5 `Decimal` and `BigInt` Serialization

- Money and quantity aggregates stay `Prisma.Decimal` end to end and are serialized as **fixed-precision strings** (`.toFixed(2)` for money, `.toFixed(4)` for quantity), matching the existing invoice/quote read-model convention. Never a JavaScript `number` — float coercion of currency is a correctness bug.
- `COUNT` results from `$queryRaw` arrive as `BigInt` and are converted with `Number(...)` only after an explicit `<= Number.MAX_SAFE_INTEGER` assertion.
- Every monetary metric response carries `currencyCode`, resolved from `Workspace.defaultCurrencyCode`. Where a workspace holds invoices in mixed currencies, monetary metrics are **grouped by `currencyCode`** and never summed across currencies. A single number spanning currencies would be meaningless, and no FX table exists in the schema.

---

## 9. Pagination, Filtering, Sorting

### 9.1 Pagination — Match the Established Convention

Phase 1.14 adopts the existing offset pagination convention verbatim (`listInvoices`, `listQuotes`, notification list services). **No new convention is invented.**

```typescript
export interface PaginatedReportRows<TRow> {
  items: TRow[];
  total: number;      // total distinct groups matching the query
  page: number;       // 1-based
  limit: number;
  totalPages: number; // Math.ceil(total / limit) || 1
}
```

- `page` defaults to `1`; `limit` defaults to `20`, maximum `100` (`ReportQueryParams` Zod schema).
- **Pagination applies only to grouped (dimensional) results.** Scalar KPI responses and time-series responses are **not paginated** — both are bounded by construction (metric count; §5.5 bucket caps). A response states its shape in `meta.shape` (`"SCALARS" | "ROWS" | "SERIES"`) so a consumer never looks for a missing `pagination` block.
- Cursor pagination is deliberately not introduced. Grouped result sets are small by design (§9.4) and consistency with five prior domains is worth more than the deep-page efficiency reporting does not need.

### 9.2 Filtering — Allowlisted `FilterKey`s Only

```typescript
export type FilterKey =
  | "customerId" | "technicianId" | "workTypeId" | "serviceCatalogId"
  | "workOrderStatus" | "workOrderPriority"
  | "appointmentStatus" | "dispatchStatus"
  | "quoteStatus" | "invoiceStatus" | "paymentMethod"
  | "assetStatus" | "assetCategoryId"
  | "partId" | "inventoryLocationId" | "timeEntryType";

export interface FilterDefinition {
  key: FilterKey;
  valueType: "CUID" | "ENUM" | "CUID_ARRAY" | "ENUM_ARRAY";
  enumValues?: readonly string[];          // for ENUM kinds — validated by Zod
  applicableModels: readonly ReportSourceModel[];
  /** Returns a fixed `where` fragment. Request input supplies the VALUE only, never a field name. */
  buildWhere: (value: unknown) => Record<string, unknown>;
  /** true => the id must be tenant-validated before use (§6.4). */
  requiresTenantValidation: boolean;
}
```

Rules: an unregistered filter key → `400`. A key not in `definition.allowedFilters` → `422`. An enum value outside `enumValues` → `400`. Every id-valued filter with `requiresTenantValidation` is resolved workspace-scoped before use; a foreign id → `403 ReportScopeViolationError`. Free-text search is **not** a reporting filter — searching entities is the operational list endpoints' job, and a `contains` predicate would defeat the composite indexes §10.3 adds.

### 9.3 Sorting — Allowlisted, With a Mandatory Tie-Breaker

- `sortBy` must be a member of `definition.allowedSortKeys`, itself a subset of the report's own metrics and dimensions. **No arbitrary field sorting.** An unlisted key → `422`.
- `sortOrder ∈ { "asc", "desc" }`, default from `definition.defaultSort`.
- **A deterministic secondary tie-breaker is mandatory**, matching the `{ id: "asc" }` convention in `listInvoices`. For grouped results the tie-breaker is the primary dimension's group key ascending. Without it, equal-valued groups reorder between pages and rows are silently duplicated or skipped across page boundaries.
- **Sorting by an aggregate:** where Prisma `groupBy` cannot `orderBy` the requested aggregate together with `skip`/`take`, the service materializes the complete grouped set — bounded by §9.4 — then sorts and paginates in memory. `meta.sortedInMemory: true` records which path executed, so a performance investigation does not have to guess.

### 9.4 Group Cardinality Guard

```typescript
export const MAX_GROUP_CARDINALITY = 1_000;
```

Before returning, the composition engine counts distinct groups. Exceeding the cap → `422 ReportCardinalityExceededError` naming the dimension, the observed cardinality, the cap, and a suggestion (add a filter, or group by a `LOW`-cardinality dimension). **No top-N truncation.** A silently truncated "revenue by customer" table reads as complete and produces a wrong total; an explicit rejection does not. Combining two `HIGH`-cardinality dimensions (e.g. `customer` × `part`) is rejected up front, before executing the query, since its product is predictably over cap.

---

## 10. Performance Strategy

### 10.1 N+1 Avoidance

1. **Batch, never loop.** All of a report's aggregates issue concurrently through a single `Promise.all`, per the `getAssetOperationalSummary()` precedent. A per-row query loop — "for each customer, count their work orders" — is a specification violation; that is one `groupBy`.
2. **Label hydration is one batched query per dimension.** `groupBy` returns opaque ids. Labels are fetched with **one** `findMany({ where: { workspaceId, id: { in: ids } }, select: { id, <labelFields> } })` per dimension and joined in memory. Never one lookup per row.
3. **Narrow `select` everywhere.** Row-scanning metrics (§8.3) select only the two or three columns they reduce. No `include`, no full-row fetch, no `_count` on relations that are not being reported.
4. **Bounded fan-out.** The number of queries per report request is a function of `metrics.length + dimensions.length`, both capped by the report definition — never a function of matched row count.

### 10.2 Index Audit — Verified Against the Current Schema

Verified by reading `prisma/schema.prisma` at the time of writing. **Confirmed, not assumed.**

| Reporting access pattern | Required index | Status |
| :--- | :--- | :--- |
| WOs **completed** in range | `WorkOrder([workspaceId, status, completedAt])` | ❌ **GAP** — `completedAt` has **no index at all** |
| WOs **created** in range, tenant-scoped | `WorkOrder([workspaceId, createdAt])` | ⚠️ **PARTIAL** — only a global `@@index([createdAt])` |
| WOs **cancelled** in range | `WorkOrder([workspaceId, status, cancelledAt])` | ❌ **GAP** — `cancelledAt` unindexed |
| WOs by technician × status | `WorkOrder([workspaceId, assignedTechnicianId, status])` | ⚠️ **PARTIAL** — separate single-column indexes only |
| WO status distribution | `WorkOrder([workspaceId, status])` | ✅ **CONFIRMED** |
| Invoices **issued** in range | `Invoice([workspaceId, status, issueDate])` | ❌ **GAP** — `issueDate` has **no index at all** |
| Invoices created, tenant-scoped | `Invoice([workspaceId, createdAt])` | ⚠️ **PARTIAL** — global `createdAt` only |
| Invoice status distribution / AR | `Invoice([workspaceId, status])`, `Invoice([dueDate])` | ✅ **CONFIRMED** |
| Payments **collected** in range | `Payment([workspaceId, status, paymentDate])` | ⚠️ **PARTIAL** — single-column `paymentDate` only |
| Quotes created, tenant-scoped | `Quote([workspaceId, createdAt])` | ⚠️ **PARTIAL** — global `createdAt` only |
| Quote decision latency | `Quote([workspaceId, approvedAt])`, `Quote([workspaceId, convertedAt])` | ❌ **GAP** — `sentAt` / `approvedAt` / `rejectedAt` / `convertedAt` all unindexed |
| Time entries by technician in range | `TechnicianTimeEntry([workspaceId, technicianProfileId, startedAt])` | ⚠️ **PARTIAL** — single-column `startedAt` only |
| Parts consumed in range | `WorkOrderPart([workspaceId, consumedAt])` | ⚠️ **PARTIAL** — single-column `consumedAt` only |
| Appointments in range | `ScheduleAppointment([workspaceId, scheduledStart, scheduledEnd])` | ✅ **CONFIRMED** (Phase 1.8) |
| Appointment / dispatch status distribution | `ScheduleAppointment([workspaceId, status])`, `([workspaceId, dispatchStatus])` | ✅ **CONFIRMED** |
| Appointment history by event in range | `ScheduleAppointmentHistory([workspaceId, eventType, createdAt])` | ❌ **GAP** — `eventType` indexed alone |
| Stock movements by type in range | `StockMovement([workspaceId, movementType])`, `([workspaceId, partId, locationId, createdAt])` | ✅ **CONFIRMED** |
| Inventory balances by part | `InventoryBalance([workspaceId, partId])` | ✅ **CONFIRMED** |
| Asset status distribution | `Asset([workspaceId, status])` | ✅ **CONFIRMED** |
| Customer status distribution | `Customer([workspaceId, status])` | ✅ **CONFIRMED** |

**The scheduling and inventory domains index well for reporting; the work-order and financial domains do not.** The recurring pattern is a *global* single-column timestamp index where a **`workspaceId`-leading composite** is needed. A global `@@index([createdAt])` is close to useless for a tenant-scoped range scan: PostgreSQL must either scan the whole date range across all tenants and filter, or use the `workspaceId` index and filter by date. Neither is a covering path.

The single most consequential finding: **`WorkOrder.completedAt` is not indexed at all**, and `workOrders.completedCount` is the most-requested metric in any FSM reporting suite.

### 10.3 Decision: Index-Only Migration in Phase 1.14.2

Phase 1.14.2 adds these indexes to prior-phase models. **Index DDL only** — no column added, no type changed, no row written. This is the bounded exception in §1.2, and it does not weaken the read-only invariant: an index changes the physical access path, not the data.

```prisma
// WorkOrder — Phase 1.6 model, reporting index additions only
@@index([workspaceId, status, completedAt])
@@index([workspaceId, createdAt])
@@index([workspaceId, status, cancelledAt])
@@index([workspaceId, assignedTechnicianId, status])

// Invoice — Phase 1.12
@@index([workspaceId, status, issueDate])
@@index([workspaceId, createdAt])

// Payment — Phase 1.12
@@index([workspaceId, status, paymentDate])

// Quote — Phase 1.11
@@index([workspaceId, createdAt])
@@index([workspaceId, status, approvedAt])

// TechnicianTimeEntry — Phase 1.9
@@index([workspaceId, technicianProfileId, startedAt])
@@index([workspaceId, entryType, startedAt])

// WorkOrderPart — Phase 1.10
@@index([workspaceId, consumedAt])

// ScheduleAppointmentHistory — Phase 1.8
@@index([workspaceId, eventType, createdAt])
```

Column ordering follows the standard equality-then-range rule: `workspaceId` (equality) → `status`/`entryType` (equality) → timestamp (range). Reversing it forfeits the range seek.

**Deferred to Phase 1.22 (Production Deployment):** `CREATE INDEX CONCURRENTLY` for zero-downtime application on populated tables. Prisma Migrate wraps a migration in a transaction and `CONCURRENTLY` cannot run inside one, so this needs a deliberate deployment procedure. Flagged here; not solved here. At current data volumes a plain `CREATE INDEX` is acceptable.

### 10.4 Non-Goals

No query-plan hints, no read replicas, no connection-pool retuning, no `EXPLAIN`-driven micro-optimization in this phase. Phase 1.14.10 records measured p95 latency per report endpoint so the §4.5 triggers can be evaluated against evidence rather than intuition.

---

## 11. Historical Reporting Behavior — Snapshot vs. Live

### 11.1 Financial Metrics: Stored Snapshots Only — Non-Negotiable

**Every monetary value in every report is read from a stored snapshot column written by Phase 1.11 / 1.12 at the time of the transaction.**

**Permitted money sources** (all snapshot columns):

| Model | Columns |
| :--- | :--- |
| `Invoice` | `subtotal`, `discountAmount`, `taxAmount`, `total`, `amountPaid`, `amountDue`, `currencyCode` |
| `InvoiceLineItem` | `quantity`, `unitPrice`, `unitCost`, `discountAmount`, `subtotal`, `taxAmount`, `total`, plus the `workTypeName` / `partName` / `partSku` denormalized snapshots |
| `Quote` / `QuoteLineItem` | the equivalent stored totals and line snapshots |
| `Payment` | `amount`, `currencyCode` |
| `WorkOrderPart` | `unitCostAtTimeOfUse`, `quantity`, `partName`, `partSku` |
| `StockMovement` | `unitCostSnapshot` |

**Forbidden money sources — a report reading any of these is a blocker:**

- ❌ `Part.unitCost` — the *current* cost, mutable at any time. Using it makes last quarter's parts cost change when someone edits a part record today.
- ❌ Any future `WorkType` price field. *(Verified: `WorkType` currently has no price column — Phase 1.5 pricing is pending. The prohibition is stated now so it is already binding when pricing lands, rather than becoming a retrofit.)*
- ❌ `invoiceCalculationEngine` / `quoteCalculationEngine` — write-path engines. Reporting must never invoke them. Recomputation would produce a *different* number from the stored one whenever tax rates, discount rules, or engine logic have changed since the transaction, and the stored value is the one the customer was actually billed.
- ❌ Reconstructing `amountDue` as `total − Σ payments`. Phase 1.12 already stores and reconciles `amountPaid` / `amountDue`; recomputing creates a second source of truth that can disagree with the invoice the customer holds.

> **"Q1 revenue" must reflect what was actually invoiced and paid in Q1, at Q1's prices.** That is what the snapshot columns record, and it is the only correct answer.

### 11.2 Financial Metric Semantics (Locked)

| Metric | Anchor | Inclusion rule |
| :--- | :--- | :--- |
| `invoices.issuedCount` / `issuedTotal` | `Invoice.issueDate` | `status notIn [DRAFT, VOID]`. Draft invoices are not revenue; voided invoices are excluded from revenue and reported separately. |
| `invoices.voidedCount` / `voidedTotal` | `Invoice.voidedAt` | `status = VOID`. Reported separately so a void is visible, not merely absent. |
| `payments.collectedCount` / `collectedTotal` | `Payment.paymentDate` | `status = RECORDED`. `VOIDED` payments excluded. |
| `invoices.outstandingBalance` | **POINT_IN_TIME** | `Σ amountDue` where `status notIn [DRAFT, VOID]` — mirrors the existing `getCustomerOutstandingBalance()` semantics exactly, so a report and the AR endpoint can never disagree. |
| `invoices.avgDaysToPayment` | `Invoice.paidAt` | `paidAt` and `issuedAt` both non-null; measured as `paidAt − issuedAt`. |
| `quotes.winRate` | `Quote.createdAt` | `approvedCount / (approvedCount + rejectedCount)`; `EXPIRED` excluded from the denominator (no decision was made), and reported as its own count. |

Currency is never summed across `currencyCode` values (§8.5).

### 11.3 Operational Metrics: Current State at Query Time — and Why

**Decision.** Operational metrics read the entity's **current state at query time**. They do not replay `WorkOrderHistory`, `QuoteHistory`, `InvoiceHistory`, or `ScheduleAppointmentHistory`.

Reasoning: an operational lifecycle timestamp is written once at the moment the transition occurs and is not restated. `WorkOrder.completedAt` is set when the work order is completed and does not change if the record is later edited. So the current row *is* the historical record for these fields — unlike money, where a stored total can legitimately differ from what today's pricing rules would produce. Adding a history-replay path would create a second source of truth for the same question with no accuracy gain.

**The one asymmetry, and its mandatory guard.** A `COMPLETED` work order can subsequently be `CANCELLED`, which sets `cancelledAt` while leaving `completedAt` populated. Therefore:

> **Every completion metric MUST filter on both `status = "COMPLETED"` AND `completedAt` in range. Filtering on `completedAt` alone is a defect.**

This is encoded structurally: `METRIC_REGISTRY["workOrders.completedCount"].baseWhere()` returns `{ status: "COMPLETED" }`, and the composition engine always applies `baseWhere` alongside the date anchor. A metric author cannot forget it. The symmetric rule applies to `cancelledAt` + `status = "CANCELLED"`.

**Canonical completion-time definition (single source, mirroring §5.4's single-resolver principle):**

> **`WorkOrder.completedAt` is THE completion timestamp for all reporting.** Not `updatedAt`. Not `MAX(TechnicianTimeEntry.endedAt)`. Not `ScheduleAppointment` completion. Not a `WorkOrderHistory` `STATUS_CHANGED` row.

Derived definitions, locked so 1.14.3–1.14.5 cannot diverge:

- **Cycle time** = `completedAt − createdAt` (calendar elapsed time), both non-null, `status = COMPLETED`.
- **On-site duration** = `Σ TechnicianTimeEntry.durationMinutes` where `entryType = "ON_SITE"` **and** `status = "COMPLETED"` **and** `durationMinutes != null`. *(Verified: `durationMinutes` is nullable and is null while an entry is `ACTIVE`. Omitting the status filter would silently under-count open entries as zero.)*
- **Travel duration** = the same, with `entryType = "TRAVEL"`.
- **Tracked time** = the same across all `entryType` values; `technicians.onSiteShareOfTrackedTime` = on-site ÷ tracked.

### 11.4 Accepted Limitation: Reports Are Current-Truth About Historical Amounts

Stated explicitly so no consumer is surprised:

> A Phase 1.14 report is **current truth about historical amounts** — it reads snapshot values (so amounts reflect the original transaction) but a *live* row set (so today's inclusion rules apply).

The practical consequence: an invoice issued in Q1 and voided in Q3 will appear in a Q1 revenue report run in Q2, and will be absent from the same Q1 report re-run in Q4. This is intentional and correct for operational reporting — "what do we currently consider Q1 revenue to be" is the operationally useful question — but it is **not** an accounting-grade immutable restatement.

An immutable period-close ledger (frozen period snapshots, restatement tracking, audit trail of changes to a closed period) is **out of scope for Phase 1.14** and would require a persisted snapshot table and a close process — i.e. exactly the materialization and scheduling infrastructure §4 defers. Every report response carries `meta.generatedAt` so a printed or exported report is self-dating, and CSV exports include it in a header comment row. Flagged for a future accounting phase.

---

## 12. Read-Model Strategy

### 12.1 Decision: A Read Model Is a Typed DTO Returned by an Aggregation Service. There Is No Persisted Reporting Table.

Given the live-aggregation decision in §4, "read model" in this codebase means exactly what it means in `AssetOperationalSummary`, `CustomerOutstandingBalanceReadModel`, and `PaginatedInvoicesReadModel`: **a well-typed return DTO from a service function.** Phase 1.14 adds no Prisma model, and its only migration is index DDL (§10.3).

```typescript
export interface ReportMeta {
  reportKey: ReportKey;
  title: string;
  generatedAt: string;                 // ISO-8601 UTC — self-dates the result (§11.4)
  timezone: string;                    // Workspace.timezone — the calendar used
  shape: "SCALARS" | "ROWS" | "SERIES";
  scope: "WORKSPACE" | "SELF";         // §7.3
  range: {
    startUtc: string; endUtc: string;  // half-open [startUtc, endUtc)
    startLocalDate: string; endLocalDate: string; // inclusive local labels
    preset: DateRangePreset | null;
    granularity: DateBucketGranularity;
  } | null;                            // null when every requested metric is POINT_IN_TIME
  asOfUtc: string | null;              // set when any POINT_IN_TIME metric is present
  metrics: Array<{
    key: MetricKey; label: string; valueType: MetricValueType;
    temporality: MetricTemporality; currencyCode?: string;
  }>;
  dimensions: Array<{ key: DimensionKey; label: string }>;
  appliedFilters: Array<{ key: FilterKey; value: string | string[] }>;
  sort: { key: string; order: "asc" | "desc" };
  sortedInMemory: boolean;             // §9.3 — which sort path executed
  truncated: false;                    // ALWAYS false; over-cap requests throw instead (§9.4)
}

export interface ReportScalarsReadModel {
  meta: ReportMeta;
  values: Record<MetricKey, string | number | null>;  // money/quantity as fixed strings (§8.5)
}

export interface ReportRow {
  dimensions: Record<DimensionKey, { key: string; label: string }>;
  values: Record<MetricKey, string | number | null>;
}

export interface ReportRowsReadModel {
  meta: ReportMeta;
  items: ReportRow[];
  total: number; page: number; limit: number; totalPages: number;
}

export interface ReportSeriesReadModel {
  meta: ReportMeta;
  series: Array<{
    bucketStartUtc: string;
    bucketLocalLabel: string;                        // e.g. "2026-08" / "2026-08-27"
    values: Record<MetricKey, string | number | null>;
  }>;                                                // zero-filled, contiguous, ascending (§8.4.4)
}
```

`truncated` is permanently `false` and typed as the literal `false`. It exists as a self-documenting contract: this domain rejects over-cap requests rather than silently truncating, and the field makes that promise visible to a consumer instead of implicit.

### 12.2 Service Function Shape

Every metric resolver and every report service follows the established signature and step order (§7.4):

```typescript
export async function getWorkOrderVolumeReport(
  workspaceId: string,
  rawParams?: unknown,
  actor?: WorkspaceAuthorizationContext,
): Promise<ReportRowsReadModel | ReportSeriesReadModel | ReportScalarsReadModel>;
```

No reporting function accepts a `Prisma.TransactionClient` (§1.2). Directory layout mirrors the existing one-service-per-file convention:

```
lib/services/reporting/
  reporting.types.ts          reportingErrors.ts        reporting.schemas.ts
  metricRegistry.ts           dimensionRegistry.ts      filterRegistry.ts
  reportRegistry.ts           reportingConstants.ts
  dateRange.ts                reportComposer.ts         csvSerializer.ts
  metrics/operationalMetrics.ts   metrics/schedulingMetrics.ts
  metrics/technicianMetrics.ts    metrics/financialMetrics.ts
  metrics/inventoryMetrics.ts     metrics/customerMetrics.ts
  reports/*.ts                index.ts
lib/utils/reportingApiError.ts   // mirrors lib/utils/invoiceApiError.ts
```

---

## 13. Export Strategy Boundaries

### 13.1 In Scope: CSV (Phase 1.14.9)

- `GET /api/workspaces/[workspaceId]/reports/[reportKey]/export?format=csv&…` — identical parameters to the JSON endpoint plus `format`.
- `Content-Type: text/csv; charset=utf-8`; `Content-Disposition: attachment; filename="<reportKey>_<startLocalDate>_<endLocalDate>.csv"`.
- Requires **`reports.export`** *in addition to* the report's own view permission.
- RFC 4180 quoting: fields containing `"`, `,`, `\r`, or `\n` are double-quoted with `"` doubled. UTF-8 BOM prefixed for spreadsheet compatibility.
- Header rows: a leading comment row carrying `reportKey`, `generatedAt`, `timezone`, resolved range, applied filters, and scope — so an exported file is self-describing and reconcilable later (§11.4). Then the column header row: dimension labels followed by metric labels.
- Money and quantity are emitted as the same fixed-precision strings the JSON API returns. No locale formatting, no thousands separators, no currency symbols — a CSV is a data interchange format, not a presentation format.
- **CSV injection defence (mandatory).** Any cell whose first character is `=`, `+`, `-`, `@`, TAB, or CR is prefixed with a single quote (`'`) before quoting. Customer names, part names, and work order titles are user-controlled and flow into exports; without this, opening the file in Excel or Sheets can execute a formula. This is a security control, not a formatting preference.
- **Row cap.**

```typescript
export const MAX_EXPORT_ROWS = 50_000;
```

  Exceeding it → `422 ReportExportTooLargeError` naming the row count, the cap, and a narrower-range suggestion. **Never a truncated file** — a CSV that looks complete but is not is the worst possible failure mode for a financial export.
- Exports are generated per-request and streamed in the response. No file is persisted, no object storage is introduced, and no email delivery path is added.

### 13.2 Explicitly Out of Scope for All of Phase 1.14

- ❌ **XLSX.** Requires a spreadsheet-generation dependency, styling decisions, and multi-sheet layout.
- ❌ **PDF.** Requires a rendering engine, page layout, fonts, and branding — a document-generation project, not a reporting one.
- ❌ Scheduled or emailed report delivery (needs the §4 scheduler; belongs to 1.16+).
- ❌ Persisted or downloadable export artifacts, signed URLs, object storage.
- ❌ Async export jobs with polling.

Future consideration, not blocking, and **not** to be introduced by a later 1.14.x sub-phase without amending this document. **Phase 1.14 does not become a document-generation project.**

---

## 14. Future Dashboard Compatibility

**Phase 1.14 produces backend services and REST APIs only. There is no dashboard UI, no chart component, and no page — that is Phase 1.23.**

The API shape is nonetheless designed so a future dashboard can consume it without a breaking rework:

1. **Existing response envelope.** `{ success: true, data: { ... } }` with the established `handle*ApiError` mapping — identical to the invoice, quote, and notification routes. No new envelope.
2. **Self-describing responses.** `meta` carries labels, value types, temporality, currency, the resolved range, the timezone, and the scope. A dashboard can render axis labels, value formatting, and captions from the response alone, without hardcoding a client-side copy of the registry — the failure mode that makes analytics APIs brittle.
3. **Three explicit shapes, declared.** `SCALARS` (KPI tiles), `ROWS` (tables and bar charts), `SERIES` (line and area charts) cover the widget vocabulary a dashboard needs, and `meta.shape` tells the client which it received.
4. **Contiguous, zero-filled series.** A time series is always a complete, ascending, gap-free bucket array (§8.4.4), so a chart library can plot it directly without client-side gap reconstruction — where an omitted bucket would otherwise render as a misleading straight line.
5. **Composite report keys.** A dashboard section is one request, not one request per tile (§4.3.2).
6. **Additive-only evolution policy.** Adding a metric, a dimension, a report key, or a `meta` field is non-breaking. Removing or renaming any of them is breaking and requires a deliberate versioning decision. Consumers must ignore unknown `meta` fields.

**Deliberately not built for a UI that does not exist:** no widget layout persistence, no user-configurable dashboards, no drill-down link metadata, no realtime/websocket push, no chart-type hints in the API, no client-side aggregation contract, no saved views (§3.2). Each is a guess about a UI whose requirements are unknown.

---

## 15. Explicitly Prevented — Blocker List

Any later sub-phase proposing one of these must be **stopped and escalated**, not accommodated.

| # | Forbidden design | Why it is a blocker | Guarded by |
| :-- | :--- | :--- | :--- |
| 1 | Any write path from reporting into an operational table (`INSERT` / `UPDATE` / `UPSERT` / `DELETE`) | Inverts the domain dependency; a read concern mutating a system of record is unauditable | §1.2, review, no `tx` parameter in any signature |
| 2 | Caching a computed metric back onto an operational row | A reporting query producing an operational side effect | §1.2 |
| 3 | Reporting-driven schema change to an operational model (new column, type change, backfill) | Operational models are owned by their phase; reporting defers the metric instead | §1.2, §17.2 |
| 4 | Arbitrary user-supplied field selection, `groupBy`, filter, or sort field | Unbounded query surface, data exposure beyond registered fields, index-defeating plans | §8.2, §9.2, §9.3 |
| 5 | String-interpolated SQL, in any form, including in the §8.4 exception | SQL injection | §8.4 conditions 1–3, `assertRegistryIdentifier` |
| 6 | Raw SQL outside the §8.4 time-bucketing exception | Bypasses the registry allowlist and Prisma's type safety | §8.1, §8.4 |
| 7 | Recomputing a financial total from current catalog or current part cost | Historical reports change retroactively when prices change | §11.1 |
| 8 | Calling `invoiceCalculationEngine` / `quoteCalculationEngine` from reporting | Write-path engine in a read-only domain; produces numbers that disagree with what was billed | §11.1 |
| 9 | Introducing a background job, cron, worker runtime, or materialized table without flagging it as new infrastructure | Hides a major infrastructure dependency inside a reporting phase | §4.1, §4.5 |
| 10 | Silent truncation — top-N, capped rows, sampled data, dropped buckets — presented as a complete result | A wrong number that looks right is worse than an error | §5.5, §8.3, §9.4, §13.1, `meta.truncated: false` |
| 11 | Post-query workspace filtering, or any unscoped query | Cross-tenant leakage | §6 |
| 12 | Silently coercing a technician's out-of-scope request to their own data | Caller draws a false conclusion from a correct-looking response | §7.3.2 |
| 13 | A date boundary computed anywhere but `resolveReportDateRange()` | Divergent period definitions; monthly totals stop summing to annual | §5.4 |
| 14 | Viewer-timezone or per-entity-timezone bucketing | Two users see different numbers for the same period | §5.2 |
| 15 | Summing money across `currencyCode` values | Meaningless aggregate; no FX table exists | §8.5 |
| 16 | Floating-point money | Precision loss on currency | §8.5 |
| 17 | XLSX or PDF generation in Phase 1.14 | Scope balloon into document generation | §13.2 |
| 18 | Cross-workspace or platform-wide reporting | Tenant isolation breach; belongs to Phase 1.19 | §1.4, §6 |
| 19 | A metric filtered on a range it has no anchor for (e.g. "backlog last month") | Confidently wrong number | §2.4 temporality |
| 20 | A completion metric filtered on `completedAt` alone, without `status = COMPLETED` | Counts work orders later cancelled | §11.3, `baseWhere` |

---

## 16. Error Taxonomy (Convention B — Pure Domain Errors)

Following the established convention: pure `Error` subclasses with `readonly code`, `readonly statusCode`, `readonly httpStatus`. Target file `lib/services/reporting/reportingErrors.ts`; HTTP mapping in `lib/utils/reportingApiError.ts`, mirroring `invoiceApiError.ts`.

```typescript
export class ReportNotFoundError extends Error {
  readonly code = "REPORT_NOT_FOUND";
  readonly statusCode = 404;
  readonly httpStatus = 404;
  constructor(message = "Report definition not found.") {
    super(message); this.name = "ReportNotFoundError";
  }
}

export class UnknownMetricError extends Error {
  readonly code = "UNKNOWN_METRIC";
  readonly statusCode = 400;
  readonly httpStatus = 400;
  constructor(message = "Unknown or unregistered metric key.") {
    super(message); this.name = "UnknownMetricError";
  }
}

export class UnknownDimensionError extends Error {
  readonly code = "UNKNOWN_DIMENSION";
  readonly statusCode = 400;
  readonly httpStatus = 400;
  constructor(message = "Unknown or unregistered dimension key.") {
    super(message); this.name = "UnknownDimensionError";
  }
}

export class UnknownFilterError extends Error {
  readonly code = "UNKNOWN_FILTER";
  readonly statusCode = 400;
  readonly httpStatus = 400;
  constructor(message = "Unknown or unregistered filter key.") {
    super(message); this.name = "UnknownFilterError";
  }
}

export class UnsupportedMetricDimensionCombinationError extends Error {
  readonly code = "UNSUPPORTED_METRIC_DIMENSION_COMBINATION";
  readonly statusCode = 422;
  readonly httpStatus = 422;
  constructor(message = "The requested metric cannot be grouped by the requested dimension.") {
    super(message); this.name = "UnsupportedMetricDimensionCombinationError";
  }
}

export class InvalidReportDateRangeError extends Error {
  readonly code = "INVALID_REPORT_DATE_RANGE";
  readonly statusCode = 422;
  readonly httpStatus = 422;
  constructor(message = "The requested reporting date range is invalid.") {
    super(message); this.name = "InvalidReportDateRangeError";
  }
}

export class ReportDateRangeTooLargeError extends Error {
  readonly code = "REPORT_DATE_RANGE_TOO_LARGE";
  readonly statusCode = 422;
  readonly httpStatus = 422;
  constructor(message = "The requested range exceeds the maximum span or bucket count for this granularity.") {
    super(message); this.name = "ReportDateRangeTooLargeError";
  }
}

export class ReportCardinalityExceededError extends Error {
  readonly code = "REPORT_CARDINALITY_EXCEEDED";
  readonly statusCode = 422;
  readonly httpStatus = 422;
  constructor(message = "The requested grouping or scan exceeds the maximum permitted size. Narrow the range or add a filter.") {
    super(message); this.name = "ReportCardinalityExceededError";
  }
}

export class ReportExportTooLargeError extends Error {
  readonly code = "REPORT_EXPORT_TOO_LARGE";
  readonly statusCode = 422;
  readonly httpStatus = 422;
  constructor(message = "The requested export exceeds the maximum permitted row count.") {
    super(message); this.name = "ReportExportTooLargeError";
  }
}

export class ReportScopeViolationError extends Error {
  readonly code = "REPORT_SCOPE_VIOLATION";
  readonly statusCode = 403;
  readonly httpStatus = 403;
  constructor(message = "The requested scope is outside your authorization for this report.") {
    super(message); this.name = "ReportScopeViolationError";
  }
}

export class ReportingIdentifierViolationError extends Error {
  readonly code = "REPORTING_IDENTIFIER_VIOLATION";
  readonly statusCode = 500;
  readonly httpStatus = 500;
  constructor(message = "Internal error: a non-registry SQL identifier was rejected.") {
    super(message); this.name = "ReportingIdentifierViolationError";
  }
}

export class ReportMetricUnavailableError extends Error {
  readonly code = "REPORT_METRIC_UNAVAILABLE";
  readonly statusCode = 501;
  readonly httpStatus = 501;
  constructor(message = "This metric is not derivable from the current data model.") {
    super(message); this.name = "ReportMetricUnavailableError";
  }
}
```

Notes: permission denial uses the shared `ForbiddenError` thrown by `assertPermission` — reporting does not duplicate it. `ReportingIdentifierViolationError` is a 500 because it can only fire on a programming error, never on user input; if a user can trigger it, that is itself the bug. `ReportMetricUnavailableError` (501) is the structural answer for §17.2's deferred metrics: it names the missing source data instead of returning a fabricated zero.

---

## 17. Report & Metric Catalog Allocation

### 17.1 Sub-Phase Allocation

| Sub-phase | Report keys | Representative metrics |
| :--- | :--- | :--- |
| **1.14.3** Operational | `operational.workOrderVolume`, `operational.workOrderThroughput` | `workOrders.createdCount`, `completedCount`, `cancelledCount`, `openBacklogCount`, `completionRate`, `avgCycleTimeMinutes` |
| **1.14.4** Scheduling & Dispatch | `scheduling.dispatchPerformance` | `schedule.appointmentsScheduledCount`, `appointmentsCompletedCount`, `appointmentsCancelledCount`, `dispatchedCount`, `avgDispatchLatencyMinutes` |
| **1.14.5** Technician | `technician.productivity` | `technicians.completedWorkOrderCount`, `onSiteMinutes`, `travelMinutes`, `trackedMinutes`, `onSiteShareOfTrackedTime` |
| **1.14.6** Financial | `financial.revenueSummary`, `financial.arAging`, `financial.quotePipeline` | `invoices.issuedCount/issuedTotal`, `voidedCount/voidedTotal`, `outstandingBalance`, `avgDaysToPayment`, `payments.collectedCount/collectedTotal`, `quotes.*` |
| **1.14.7** Inventory / Asset / Customer | `inventory.partsConsumption`, `customer.activitySummary` | `inventory.partsConsumedCost/Quantity`, `quantityOnHand`, `belowMinimumStockPartCount`, `assets.count`, `warrantyExpiringCount`, `customers.newCount/activeCount` |

### 17.2 Metrics Deferred for Missing Source Data (Verified Gaps)

These are **not** implemented, and Phase 1.14 does **not** add columns to make them possible (§1.2, §15.3). Each is a genuine data-model gap discovered while writing this specification. Requesting one returns `501 ReportMetricUnavailableError` naming the missing field.

| Deferred metric | Missing source data | Owning phase for a fix |
| :--- | :--- | :--- |
| `schedule.avgAcknowledgeLatencyMinutes` | **`ScheduleAppointment` has `dispatchedAt`, `undispatchedAt`, and `fieldExecutionStartedAt`, but no `acknowledgedAt`.** `dispatchStatus` reaches `ACKNOWLEDGED`, and `ScheduleHistoryEventType` has no `ACKNOWLEDGED` member — so the acknowledgment instant is recorded **nowhere**. The metric is not derivable at any cost. | 1.8 (scheduling) |
| `workOrders.avgHoldDurationMinutes` | `WorkOrder` has `holdReason` and an `ON_HOLD` status but no `heldAt` / `resumedAt`. Only reconstructible by parsing `WorkOrderHistory.oldValue` / `newValue`, which are untyped `String?` columns. | 1.6 / 1.9 |
| `workOrders.reworkRate`, `firstTimeFixRate` | No revisit, rework, or parent/child linkage exists between work orders. | 1.6 |
| `technicians.billableUtilization` | No billable/non-billable flag on `TechnicianTimeEntry`, and no labor rate anywhere (Phase 1.5 pricing pending). Utilization would require inventing both. | 1.5 / 1.9 |
| Any metric requiring `*History` replay | `field` / `oldValue` / `newValue` are untyped strings. Analytics built on string parsing is fragile and would silently drift when a service changes its history payload wording. | Out of scope for 1.14 |

**These gaps are reported, not worked around.** Fabricating a plausible number from an adjacent field — using `fieldExecutionStartedAt` as a proxy for acknowledgment, for instance — would be worse than returning 501, because the number would look authoritative.

---

## 18. Phase 1.14 Implementation Roadmap (10-Stage Breakdown)

| Milestone | Scope | Core deliverables |
| :--- | :--- | :--- |
| **1.14.1** | Domain Architecture & Specification | This locked contract, the walkthrough, and the self-audit. **No code.** |
| **1.14.2** | Reporting Foundation | `reporting.types.ts`, `reportingErrors.ts`, `reporting.schemas.ts`, empty typed registries, `reportingConstants.ts`, **`dateRange.ts` + its DST fixture suite**, `lib/utils/reportingApiError.ts`, the four new `PERMISSIONS` entries and `ROLE_PERMISSIONS` wiring, and the **index-only migration** (§10.3). |
| **1.14.3** | Operational Metrics | `metrics/operationalMetrics.ts`, work-order registry entries, `baseWhere` completion guards (§11.3), `operational.*` reports. |
| **1.14.4** | Scheduling & Dispatch Metrics | `metrics/schedulingMetrics.ts`, `scheduling.dispatchPerformance`, 501 wiring for the deferred acknowledgment metric. |
| **1.14.5** | Technician Metrics | `metrics/technicianMetrics.ts`, time-entry aggregation with the `status = COMPLETED` / non-null `durationMinutes` guards, self-scope injection (§7.3). |
| **1.14.6** | Financial Metrics | `metrics/financialMetrics.ts`, snapshot-only money sourcing (§11.1), AR aging with `MAX_SCAN_ROWS` guard, per-currency grouping, quote pipeline. |
| **1.14.7** | Inventory / Asset / Customer Metrics | `metrics/inventoryMetrics.ts`, `metrics/customerMetrics.ts`, `SUM_PRODUCT` Decimal reduce, point-in-time stock and asset metrics. |
| **1.14.8** | Report Composition Engine | `reportComposer.ts` — registry resolution, dimension grouping, label batch-hydration, the §8.4 time-series raw-SQL path with `assertRegistryIdentifier`, zero-fill, cardinality and scan guards, sort/pagination. |
| **1.14.9** | REST API & CSV Export | `app/api/workspaces/[workspaceId]/reports/[reportKey]/route.ts` and `/export/route.ts`, RBAC enforcement, `csvSerializer.ts` with injection defence and row cap. |
| **1.14.10** | Hardening, Tests & Lock | Vitest suite: registry completeness, tenant-isolation assertions, RBAC matrix per role × report, DST fixtures, snapshot-invariant tests (no calculation-engine import in the reporting tree), guard-boundary tests, CSV injection tests, raw-SQL parameterization test, measured p95 per endpoint against §4.5 triggers, final audit and phase lock. |

---

## 19. Architectural Invariant Summary Checklist

- [x] **Strictly Read-Only**: no `INSERT` / `UPDATE` / `UPSERT` / `DELETE` against any operational table, ever; no reporting function accepts a `Prisma.TransactionClient`.
- [x] **Zero New Models**: Phase 1.14 adds no Prisma model and no data migration. Its only DDL is the index-only migration in §10.3.
- [x] **Closed Registries**: every metric, dimension, filter, sort key, and report is a compile-time registry entry; no inline aggregate in any route handler.
- [x] **No Persisted Report Entity**: reports are parametrized code-registered specs; a future `SavedReport` table is additive and named to preserve the distinction.
- [x] **Live Aggregation (A)**: computed on demand in PostgreSQL; **no scheduler dependency introduced**; materialization candidates flagged with numeric triggers in §4.5.
- [x] **One Canonical Date Resolver**: `resolveReportDateRange()` only; half-open `[startUtc, endUtc)`; workspace-timezone anchored; explicit DST disambiguation.
- [x] **Structural Tenant Isolation**: `workspaceId` inside every `where`; every id filter tenant-validated; every added index leads with `workspaceId`.
- [x] **RBAC Enforced Before Parsing**: `requireWorkspaceAuthorization` → `assertPermission` → validate; technician self-scope injected from the session and out-of-scope requests rejected, never coerced.
- [x] **Snapshot-Only Money**: stored `Invoice` / `Payment` / `Quote` / line-item / `WorkOrderPart` snapshots; never `Part.unitCost`, never a calculation engine, never a future catalog price.
- [x] **Canonical Completion Definition**: `WorkOrder.completedAt` + `status = "COMPLETED"`, enforced structurally via `baseWhere`.
- [x] **Temporality Declared**: `PERIOD` metrics anchor to exactly one timestamp column; `POINT_IN_TIME` metrics ignore the range and report `asOfUtc`.
- [x] **Parameterized SQL Only**: one documented raw-SQL exception (timezone-correct bucketing) with bound values, registry-only identifiers, and an identifier assertion.
- [x] **No Silent Truncation**: every cap fails loudly with a 422; `meta.truncated` is permanently `false`.
- [x] **Established Conventions Reused**: `{ items, total, page, limit, totalPages }` pagination, `{ success, data }` envelope, Convention B errors, `Prisma.Decimal` money, one-service-per-file layout.
- [x] **Batch, Never Loop**: `Promise.all` aggregate batching and batched label hydration; no per-row queries.
- [x] **Export Bounded**: CSV only, injection-safe, row-capped; XLSX and PDF explicitly out of scope for all of Phase 1.14.
- [x] **Backend Only**: no dashboard UI; response `meta` is self-describing so a future UI needs no breaking rework.
- [x] **Gaps Reported, Not Fabricated**: metrics with no derivable source return 501 naming the missing field rather than a plausible-looking zero.
