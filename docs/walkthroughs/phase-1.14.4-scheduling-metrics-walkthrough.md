# Phase 1.14.4 — Scheduling & Dispatch Metrics Walkthrough

> **Milestone Status**: COMPLETE & VERIFIED (Phase 1.14 Scheduling Layer)  
> **Target Specification**: [`phase-1.14.1-reporting-analytics-domain-architecture.md`](file:///d:/Download/aforden/docs/architecture/phase-1.14.1-reporting-analytics-domain-architecture.md)  
> **Test Suite**: [`tests/reporting/schedulingMetricsAndReports.test.ts`](file:///d:/Download/aforden/tests/reporting/schedulingMetricsAndReports.test.ts)  

---

## 1. Executive Summary

Phase 1.14.4 implements the **Scheduling & Dispatch Metrics** and the `scheduling.dispatchPerformance` report for the Aforden Field Service Management (FSM) platform, strictly adhering to the read-only operational invariant, locked compile-time registries, and the staged query pipeline pattern established in Phase 1.14.3.

This milestone delivers:
1. **Core Scheduling & Dispatch Metrics**:
   - `schedule.appointmentsScheduledCount` (COUNT, PERIOD, anchored to `ScheduleAppointment.createdAt`)
   - `schedule.appointmentsCompletedCount` (COUNT, PERIOD, anchored to the immutable `ScheduleAppointmentHistory.createdAt` with `eventType = "COMPLETED"`)
   - `schedule.appointmentsCancelledCount` (COUNT, PERIOD, anchored to the immutable `ScheduleAppointmentHistory.createdAt` with `eventType = "CANCELLED"`)
   - `schedule.dispatchedCount` (COUNT, PERIOD, anchored to `ScheduleAppointment.dispatchedAt` with `dispatchStatus in ["DISPATCHED", "ACKNOWLEDGED"]` and `dispatchedAt != null`)
   - `schedule.avgDispatchLatencyMinutes` (AVG_DATE_DIFF_MINUTES, PERIOD, row-scanned latency from `createdAt` to `dispatchedAt`, `MAX_SCAN_ROWS`-capped)
2. **Proper 501 Handling for Deferred Metric (§17.2)**:
   - `schedule.avgAcknowledgeLatencyMinutes` is registered in `MetricKey` and `METRIC_KEYS`, but resolution via `getMetricDefinition` or report execution throws `501 ReportMetricUnavailableError` explicitly naming the missing `acknowledgedAt` timestamp on `ScheduleAppointment` and missing `ACKNOWLEDGED` event type in `ScheduleHistoryEventType`. Zero fabrication from adjacent fields.
3. **Reachable Dimension & Filter Registrations**:
   - Registered `appointmentStatus` and `dispatchStatus` enum dimensions and filters in `DIMENSION_REGISTRY` and `FILTER_REGISTRY`.
   - Updated `technician` and time dimensions to declare reachability on `ScheduleAppointment`.
4. **Generalization of Staged Pipeline into Shared Model-Agnostic Helpers**:
   - Extracted [`tenantFilterValidation.ts`](file:///d:/Download/aforden/lib/services/reporting/tenantFilterValidation.ts): Shared tenant isolation validator for all foreign key ID filters across models.
   - Extracted [`labelHydration.ts`](file:///d:/Download/aforden/lib/services/reporting/labelHydration.ts): Shared batch relation label hydrator executing exactly 1 query per relation dimension.
   - Refactored `workOrderVolumeReport.ts` and `workOrderThroughputReport.ts` to consume these shared helpers without duplication.
5. **Dispatch Performance Report Service ([`dispatchPerformanceReport.ts`](file:///d:/Download/aforden/lib/services/reporting/reports/dispatchPerformanceReport.ts))**:
   - Executes `scheduling.dispatchPerformance` in both scalar mode and dimensional grouping mode with in-memory sort, pagination, and guard enforcement (`MAX_GROUP_CARDINALITY = 1,000`, `MAX_SCAN_ROWS = 50,000`).

---

## 2. Verified Schema Field Names & Invariant Disclosures

### 2.1 Schema Verification Matrix & Anchor Resolution (Option 2a)

| Metric / Dimension / Filter | Source Model | Field Name Verified in Schema | Anchor Reliability & Mutation Drift Defense |
| :--- | :--- | :--- | :--- |
| `schedule.appointmentsScheduledCount` | `ScheduleAppointment` | `createdAt` (DateTime) | Base filter: workspace isolation only |
| `schedule.appointmentsCompletedCount` | `ScheduleAppointmentHistory` | `createdAt` (DateTime) | **Immutable History Anchor**: `history: { some: { eventType: "COMPLETED", createdAt: [start, end) } }`. Unrelated post-completion mutations (e.g. note updates advancing `updatedAt`) never drift the reporting period. |
| `schedule.appointmentsCancelledCount` | `ScheduleAppointmentHistory` | `createdAt` (DateTime) | **Immutable History Anchor**: `history: { some: { eventType: "CANCELLED", createdAt: [start, end) } }`. Post-cancellation mutations never drift the reporting period. |
| `schedule.dispatchedCount` | `ScheduleAppointment` | `dispatchedAt` (DateTime?) | `dispatchStatus in ["DISPATCHED", "ACKNOWLEDGED"]` and `dispatchedAt != null` |
| `schedule.avgDispatchLatencyMinutes` | `ScheduleAppointment` | `createdAt` → `dispatchedAt` | `dispatchedAt - createdAt` in minutes; row-scan capped at `MAX_SCAN_ROWS` (50,000) |
| `appointmentStatus` Dimension & Filter | `ScheduleAppointment` | `status` (`ScheduleStatus`) | Enums: `SCHEDULED`, `RESCHEDULED`, `CANCELLED`, `COMPLETED` |
| `dispatchStatus` Dimension & Filter | `ScheduleAppointment` | `dispatchStatus` (`DispatchStatus`) | Enums: `PENDING_DISPATCH`, `DISPATCHED`, `ACKNOWLEDGED` |
| `technician` Dimension & Filter | `ScheduleAppointment` | `technicianId` (FK to `TechnicianProfile`) | Tenant validated via `technicianProfile.employee.workspaceId` |

### 2.2 Reusable Staged Pipeline Confirmation

The staged query pipeline established in Phase 1.14.3 was confirmed to generalize cleanly and was extracted into dedicated, model-agnostic helpers:
1. **Tenant ID Filter Validation**: [`lib/services/reporting/tenantFilterValidation.ts`](file:///d:/Download/aforden/lib/services/reporting/tenantFilterValidation.ts)
2. **Batch Label Hydration**: [`lib/services/reporting/labelHydration.ts`](file:///d:/Download/aforden/lib/services/reporting/labelHydration.ts)

Both WorkOrder reports (`workOrderVolumeReport`, `workOrderThroughputReport`) and the new Scheduling report (`dispatchPerformanceReport`) now share these exact helpers, preparing for the generic `reportComposer.ts` in Phase 1.14.8.

### 2.3 Deferred Metric 501 Verification

When `schedule.avgAcknowledgeLatencyMinutes` is requested:
- Throws `ReportMetricUnavailableError` (HTTP 501).
- Error message explicitly names the verified data model gap:
  > *"Metric "schedule.avgAcknowledgeLatencyMinutes" cannot be computed: ScheduleAppointment model lacks "acknowledgedAt" timestamp field and ScheduleHistoryEventType has no "ACKNOWLEDGED" member (Phase 1.8 dependency gap)."*

---

## 3. Directory Layout & Implemented Files

```
lib/services/reporting/
├── tenantFilterValidation.ts           # Model-agnostic tenant filter ID validator
├── labelHydration.ts                   # Model-agnostic batched label hydrator
├── metrics/
│   ├── operationalMetrics.ts           # WorkOrder operational metrics (1.14.3)
│   └── schedulingMetrics.ts            # Scheduling & dispatch metrics (1.14.4)
├── reports/
│   ├── workOrderVolumeReport.ts        # operational.workOrderVolume (1.14.3)
│   ├── workOrderThroughputReport.ts    # operational.workOrderThroughput (1.14.3)
│   └── dispatchPerformanceReport.ts    # scheduling.dispatchPerformance (1.14.4)
├── dimensionRegistry.ts                # Updated with appointmentStatus & dispatchStatus
├── filterRegistry.ts                   # Updated with appointmentStatus & dispatchStatus
├── metricRegistry.ts                   # Updated with deferred 501 handler
├── reportRegistry.ts                   # Registered scheduling.dispatchPerformance
└── index.ts                            # Re-exports all services & registries

tests/reporting/
├── schedulingMetricsAndReports.test.ts  # 18 unit & integration tests for 1.14.4
├── operationalMetricsAndReports.test.ts # 18 unit & integration tests for 1.14.3
└── reportingFoundation.test.ts          # 63 foundation & DST tests (1.14.2)
```

---

## 4. Verification & Test Results

### 4.1 Reporting Test Suite

Ran Vitest on all reporting suites:
```
 ✓ tests/reporting/operationalMetricsAndReports.test.ts (18 tests) 66ms
 ✓ tests/reporting/schedulingMetricsAndReports.test.ts (18 tests) 73ms
 ✓ tests/reporting/reportingFoundation.test.ts (63 tests) 105ms

 Test Files  3 passed (3)
      Tests  99 passed (99)
```

**Key Verified Tests in `tests/reporting/schedulingMetricsAndReports.test.ts`**:
- `it("verifies schedule.appointmentsCompletedCount anchors to immutable ScheduleAppointmentHistory.createdAt with eventType=COMPLETED")`
- `it("verifies schedule.appointmentsCancelledCount anchors to immutable ScheduleAppointmentHistory.createdAt with eventType=CANCELLED")`
- `it("verifies touching an appointment later (advancing updatedAt) does NOT change reporting period anchor")` *(Mutation Drift Regression Test)*
- `it("throws 501 ReportMetricUnavailableError for deferred schedule.avgAcknowledgeLatencyMinutes (§17.2)")`
- `it("executes scalar dispatch performance report correctly")`
- `it("executes dimensional grouping and batched label hydration for technician")`
- `it("allows DISPATCHER role to execute scheduling report (§7.2)")`
- `it("rejects TECHNICIAN role from scheduling report (requires reports.view_operational)")`

### 4.2 Full Workspace Test Suite Baseline

Ran full test suite across all 193 files:
```
 Test Files  193 passed (193)
      Tests  3570 passed (3570)
```
The entire prior baseline (192 files, 3,552 tests) was completely preserved, and all 18 new tests passed with 0 regressions.

### 4.3 TypeScript Type-Check

Ran `npx tsc --noEmit`:
```
Exit code: 0 (Zero type errors)
```

---

## 5. Compliance Checklist

- [x] **Strictly Read-Only**: No `INSERT`/`UPDATE`/`DELETE`/`UPSERT` operations on operational tables; no `Prisma.TransactionClient` accepted.
- [x] **Zero New Models or Tables**: Operates purely over existing `ScheduleAppointment` and `TechnicianProfile` tables.
- [x] **Compile-Time Closed Registries**: All scheduling metrics, dimensions, filters, and reports registered in static allowlists.
- [x] **Immutable Transition Event Anchoring**: `appointmentsCompletedCount` and `appointmentsCancelledCount` anchor to `ScheduleAppointmentHistory.createdAt` with `eventType = "COMPLETED"` and `eventType = "CANCELLED"`, ensuring subsequent edits (note modifications, metadata touches advancing `updatedAt`) never drift the reporting period.
- [x] **Deferred Metric Handled via 501**: `schedule.avgAcknowledgeLatencyMinutes` throws `ReportMetricUnavailableError` (501) naming the exact missing field without synthetic approximation.
- [x] **Shared Pipeline Reusability**: Staged pipeline cleanly separated into reusable, model-agnostic `tenantFilterValidation` and `labelHydration` modules.
- [x] **RBAC & Tenant Isolation**: Requires `reports.view_operational`; foreign technician ID rejected with `ReportScopeViolationError` (403); `workspaceId` leading in all query predicates.

