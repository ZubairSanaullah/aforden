# Phase 1.14.1 — Reporting & Analytics Domain Architecture Walkthrough

> **Milestone Status**: COMPLETE & LOCKED  
> **Target Specification**: [`phase-1.14.1-reporting-analytics-domain-architecture.md`](file:///d:/Download/aforden/docs/architecture/phase-1.14.1-reporting-analytics-domain-architecture.md)  
> **Sub-Phase Deliverable**: Phase 1.14 Architecture Contract, Decision Rationale & Self-Audit Walkthrough  

---

## 1. Milestone Overview

Phase 1.14.1 establishes the formal domain architecture and execution specification for the **Reporting & Analytics** domain of the Aforden Field Service Management (FSM) multi-tenant platform.

This phase is a locked specification exercise. It establishes all architectural boundaries, registry patterns, query execution strategies, date/time resolution semantics, tenant isolation rules, RBAC matrices, performance guards, and the 10-stage implementation roadmap (1.14.1 through 1.14.10) before any services, routes, or database index migrations are executed in Phase 1.14.2 onward.

---

## 2. Walkthrough of the 14 Architectural Pillars

### Pillar 1: Reporting Domain Boundaries & Ownership Matrix
- **Core Principle**: Reporting is **strictly read-only**. No code in Phase 1.14 (or any future 1.14.x sub-phase) executes `INSERT`, `UPDATE`, `UPSERT`, or `DELETE` on any operational table. Reporting functions never take a `Prisma.TransactionClient`.
- **Domain Invariant**: Reporting owns **no entity state**, **no business rules**, and **no pricing/tax recalculation logic**. Stored snapshots from Invoicing (Phase 1.12), Quotes (Phase 1.11), and Inventory (Phase 1.10) are the sole source of truth for financial aggregation.
- **Scope Boundary**: Workflow automation (Phase 1.16), SaaS subscription billing (Phase 1.15), external BI/data-warehouse integrations (Phase 1.17), and Web UI/Dashboards (Phase 1.23) are explicitly out of scope.

### Pillar 2: Analytics Terminology — Metrics vs. Dimensions
- **Metric**: A computed numeric aggregate (`COUNT`, `SUM`, `AVG`, `RATE`), never a raw row column or string.
- **Dimension**: A discrete grouping or filtering axis (`technician`, `customer`, `workType`, `status`, `time.month`).
- **Registry Pattern**: Modeled directly on Phase 1.13's `EVENT_CATALOG_REGISTRY`. `METRIC_REGISTRY` and `DIMENSION_REGISTRY` are closed, compile-time allowlists. Ad-hoc metrics or unlisted groupings are rejected at the API boundary with `400 UnknownMetricError` / `400 UnknownDimensionError`.
- **First-Class Temporality**: Metrics declare `PERIOD` (anchored to exactly one timestamp column) or `POINT_IN_TIME` (as-of query time, no date anchor, prohibited from time-series bucketing).

### Pillar 3: Report Definitions — Code-Registered, Parametrized Specs
- **Decision**: Reports are parametrized query specifications registered in code (`REPORT_REGISTRY`), addressed by stable keys (e.g. `operational.workOrderVolume`, `financial.revenueSummary`).
- **No Persisted Report Entity**: No `ReportDefinition` or `SavedReport` Prisma model in Phase 1.14. 
- **Justification**: REST endpoints (`GET /api/workspaces/[wsId]/reports/[reportKey]`) are fully specified by query parameters. Persisting saved parameter sets belongs to the future UI (Phase 1.23) and can be added additively as a `SavedReport` entity without modifying any core reporting service.

### Pillar 4: Query Strategy — (A) Live Aggregation on Demand
- **Decision**: All metrics are computed on demand in PostgreSQL via Prisma `aggregate`, `groupBy`, and `count`. Zero materialized summary tables, zero background ETL jobs, and **zero new scheduler infrastructure dependencies**.
- **Reasoning**: Per-workspace volume (~30k work orders/year, ~100k-150k time entries/year for a 20-tech team) aggregates in single-digit to low-tens of milliseconds over composite indexes. Background schedulers do not exist yet in the codebase.
- **Evolution Path**: `MATERIALIZATION_TRIGGERS` constants explicitly define numeric thresholds (e.g. 250k WOs, 500k time entries, or p95 > 1,500ms) for future migration to hybrid materialization (C).

### Pillar 5: Date/Time Handling & Canonical Resolver
- **Storage Reality**: Operational timestamps are stored as timezone-naive UTC instants (`TIMESTAMP(3)`).
- **Sole Calendar**: All boundary arithmetic and time bucketing use `Workspace.timezone` (default `"Asia/Karachi"`). Viewer/browser timezones and entity timezones are ignored.
- **Range Semantics**: Half-open `[startUtc, endUtc)` intervals (`{ gte: startUtc, lt: endUtc }`). `to` dates are advanced to the next local midnight.
- **Canonical Resolver**: `resolveReportDateRange()` is the single mandated entry point. Inline date math is forbidden.
- **DST Disambiguation**: `zonedWallClockToUtc()` handles spring-forward gaps (resolve forward to first existing instant) and fall-back overlaps (resolve to earlier occurrence).
- **Caps**: Hard limits of 92 daily buckets, 1,100 total days (`MAX_RANGE_DAYS`). Over-range requests throw `422 ReportDateRangeTooLargeError`.

### Pillar 6: Structural Tenant Isolation
- **Rule**: `workspaceId` is mandatory in every service call and is placed directly inside every Prisma `where` clause and SQL query.
- **Safety**: Post-query filtering is strictly forbidden. Foreign entity filter IDs throw `403 ReportScopeViolationError` upon workspace validation.
- **Index Support**: Every added reporting index leads with `workspaceId`.

### Pillar 7: Authorization & RBAC
- **Permissions**: Four new discrete permissions: `reports.view_operational`, `reports.view_financial`, `reports.view_technician`, `reports.export`.
- **Role Matrix**: `OWNER` / `ADMIN` / `MANAGER` (operational + financial + technician + export), `DISPATCHER` (operational + technician), `TECHNICIAN` (technician own data only), `ACCOUNTANT` (operational + financial + export).
- **Technician Self-Scoping**: For `TECHNICIAN` role, viewer's `technicianProfileId` is resolved server-side from session and structurally injected into query `where`. Foreign technician query attempts return `403 ReportScopeViolationError`.

### Pillar 8: Aggregation & Query Architecture
- **Prisma Defaults**: `prisma.<model>.aggregate()`, `count()`, and `groupBy()` push computations directly to PostgreSQL.
- **Row-Scanning Metrics**: Three shapes (`SUM_PRODUCT` for parts cost, AR aging buckets, and date-diff cycle times) scan narrow columns into memory with a hard cap of `MAX_SCAN_ROWS = 50_000` (`422 ReportCardinalityExceededError` on breach).
- **Single Raw-SQL Exception**: Time-series grouping via `date_trunc` with double `AT TIME ZONE` round-tripping to respect workspace calendars. Strict safeguards: tagged template parameters for all values, `assertRegistryIdentifier` compile-time whitelist for table/column identifiers.
- **Precision**: Money and quantity aggregates remain `Prisma.Decimal` and serialize to fixed-precision strings (`.toFixed(2)` / `.toFixed(4)`).

### Pillar 9: Pagination, Filtering & Sorting
- **Pagination**: Offset pagination `{ items, total, page, limit, totalPages }` matching prior domains, applied only to grouped rows.
- **Filter Allowlist**: Typed `FilterKey` registry mapping to fixed `where` fragment builders.
- **Deterministic Sorting**: Allowlisted sort keys with mandatory secondary tie-breaker on primary group key.
- **Cardinality Guard**: Grouped queries capped at `MAX_GROUP_CARDINALITY = 1_000`. High-cardinality multi-dimension combinations (e.g. `customer` × `part`) rejected upfront.

### Pillar 10: Performance Strategy & Index Audit
- **N+1 Avoidance**: Parallel aggregate batching via `Promise.all`; batched label hydration (1 query per dimension).
- **Index Audit**: Schema audit revealed critical gaps in prior phases (notably `WorkOrder.completedAt` and `Invoice.issueDate` lack composite indexes).
- **Phase 1.14.2 Index Migration**: Index-only DDL specified for `WorkOrder`, `Invoice`, `Payment`, `Quote`, `TechnicianTimeEntry`, `WorkOrderPart`, and `ScheduleAppointmentHistory`.

### Pillar 11: Historical Reporting Behavior — Snapshot vs. Live
- **Financial Invariant**: Stored snapshot columns (`Invoice.total`, `Invoice.amountPaid`, `WorkOrderPart.unitCostAtTimeOfUse`) are strictly read. Current catalog prices, `Part.unitCost`, and `*CalculationEngine` calls are strictly forbidden.
- **Operational Invariant**: Operational metrics read current state at query time. Canonical completion timestamp is `WorkOrder.completedAt` + mandatory structural guard `status = "COMPLETED"`.
- **Accepted Limitation**: Reports provide current truth about historical amounts (e.g. voided invoices excluded). Immutable period-close ledger deferred to future accounting milestone.

### Pillar 12: Read-Model Strategy
- **Decision**: Read models are well-typed DTOs (`ReportScalarsReadModel`, `ReportRowsReadModel`, `ReportSeriesReadModel`) returned by service functions. Zero persisted reporting tables.
- **Metadata**: Every response contains comprehensive `ReportMeta` (range, timezone, scope, applied filters, temporality, `truncated: false`).

### Pillar 13: Export Strategy Boundaries
- **In Scope (1.14.9)**: CSV export (`text/csv`, RFC 4180 compliant, UTF-8 BOM, self-describing header comments).
- **Security**: Mandatory CSV injection defense (prefixing `=`, `+`, `-`, `@`, `\t`, `\r` with `'`).
- **Cap**: `MAX_EXPORT_ROWS = 50_000` (throws 422 if exceeded; no silent truncation).
- **Out of Scope**: XLSX, PDF, email delivery, and asynchronous export workers are strictly excluded from Phase 1.14.

### Pillar 14: Future Dashboard Compatibility
- **Backend First**: Clean REST contract (`GET /api/workspaces/[wsId]/reports/[reportKey]`) returning standard `{ success: true, data }` envelopes.
- **Zero-Fill Contiguity**: Time-series responses guarantee gap-free, chronologically sorted bucket sequences ready for direct charting in Phase 1.23.

---

## 3. Explicit Disclosures

### 3.1 Reasoning for Query Strategy Decision (Live Aggregation vs. Materialization)
- **Tenant Partitioning**: Bounding every query by `workspaceId` limits the working set to tenant volume rather than global table size.
- **Realistic FSM Scale**: A 20-technician workspace generates ~30k work orders and ~100k-150k time entries annually. In PostgreSQL, index-backed aggregate queries over this volume execute in 5–25ms.
- **Zero Background Infrastructure**: The codebase currently possesses no background worker runtime or cron daemon (Phase 1.13 outbox polling and recurring notifications were deferred). Adopting materialization now would mandate inventing ad-hoc scheduling infrastructure or polluting operational write paths with reporting hooks.
- **Freshness & Reversibility**: Live aggregation guarantees 100% data freshness with zero cache-invalidation bugs, while preserving an additive migration path to hybrid materialization via `MATERIALIZATION_TRIGGERS`.

### 3.2 Specification Extensions & Refinements
1. **First-Class Metric Temporality (`PERIOD` vs `POINT_IN_TIME`)**: Structured into `METRIC_REGISTRY` to prevent applying date range filters to non-anchored metrics (e.g. current open backlog).
2. **Double `AT TIME ZONE` SQL Pattern**: Designed for timezone-naive `TIMESTAMP(3)` columns to ensure calendar-accurate date truncation in PostgreSQL.
3. **Machine-Readable Materialization Register**: Codified `MATERIALIZATION_TRIGGERS` constants with explicit thresholds.
4. **Mandatory CSV Injection Defense**: Formulated single-quote escaping for formula triggers on all user-controlled text fields.

### 3.3 Assumptions Resolved
1. **Dispatcher Financial Report Access**: Restricted `DISPATCHER` from `reports.view_financial` despite holding transactional `invoices.view` permissions, treating macro-aggregate financial disclosure as an administrative privilege.
2. **Missing Source Data Handling**: Flagged data model gaps (e.g. missing `ScheduleAppointment.acknowledgedAt`) and specified `501 ReportMetricUnavailableError` responses rather than fabricating approximations.
3. **Tie-Breaker Rule for Grouped Pagination**: Enforced secondary sorting on primary group keys ascending to guarantee deterministic pagination.

---

## 4. Phase 1.14 Execution Roadmap

The reporting domain roadmap is structured into 10 sequential milestones:

```
[Phase 1.14.1] Domain Architecture & Locked Specification (LOCKED)
      |
[Phase 1.14.2] Reporting Foundation, Date Resolver, RBAC & Index Migration
      |
[Phase 1.14.3] Operational Metrics & Work Order Reports
      |
[Phase 1.14.4] Scheduling & Dispatch Performance Metrics
      |
[Phase 1.14.5] Technician Productivity Metrics & Self-Scoping Engine
      |
[Phase 1.14.6] Financial Metrics, Revenue Summary & AR Aging Engine
      |
[Phase 1.14.7] Inventory, Asset & Customer Metrics
      |
[Phase 1.14.8] Report Composition Engine, Grouping & Time-Series Aggregator
      |
[Phase 1.14.9] REST API Route Handlers & Safe CSV Export Engine
      |
[Phase 1.14.10] Hardening, Performance Benchmarking, Vitest Suite & Lock
```

---

## 5. Verification & Compliance Sign-Off

- [x] **Strictly Read-Only Architecture**: Zero writes to operational models; no transaction client passed to reporting services.
- [x] **Zero New Data Models**: Phase 1.14 adds no new Prisma models; DDL is strictly index additions.
- [x] **Compile-Time Allowlist Registries**: `METRIC_REGISTRY`, `DIMENSION_REGISTRY`, `REPORT_REGISTRY`, `FILTER_REGISTRY`.
- [x] **Canonical Date Resolver**: `resolveReportDateRange()` with half-open intervals and DST handling.
- [x] **Stored Snapshot Invariant**: Financial aggregation reads stored snapshot fields exclusively.
- [x] **Pure Domain Error Taxonomy (Convention B)**: 12 standardized error classes.
- [x] **Zero Unintended Code or Migrations**: Locked as a pure specification milestone.
