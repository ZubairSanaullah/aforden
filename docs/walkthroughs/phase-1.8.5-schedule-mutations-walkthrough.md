# Phase 1.8.5 — Schedule Update, Reschedule & Cancellation Walkthrough

## Overview

This walkthrough documents the implementation and verification of **Phase 1.8.5: Schedule Controlled Mutation Services (`rescheduleSchedule`, `cancelSchedule`, `updateSchedule`)**.
All three services follow the locked execution order, state transition matrix (§5.4), conflict detection formulas (§7.2, §7.4), and audit logging rules (§15.2, §15.5, §15.7) from [`phase-1.8.1-scheduling-dispatch-domain-architecture.md`](file:///d:/Download/aforden/docs/architecture/phase-1.8.1-scheduling-dispatch-domain-architecture.md).

- **Reschedule Service**: [`lib/services/schedule/rescheduleSchedule.ts`](file:///d:/Download/aforden/lib/services/schedule/rescheduleSchedule.ts)
- **Cancellation Service**: [`lib/services/schedule/cancelSchedule.ts`](file:///d:/Download/aforden/lib/services/schedule/cancelSchedule.ts)
- **Metadata Update Service**: [`lib/services/schedule/updateSchedule.ts`](file:///d:/Download/aforden/lib/services/schedule/updateSchedule.ts)
- **Shared Conflict Detection Engine**: [`lib/services/schedule/conflictDetection.ts`](file:///d:/Download/aforden/lib/services/schedule/conflictDetection.ts)
- **Shared Read Model Mapper**: [`lib/services/schedule/scheduleReadModel.ts`](file:///d:/Download/aforden/lib/services/schedule/scheduleReadModel.ts)
- **Test File**: [`tests/schedule/schedule-mutation-services.test.ts`](file:///d:/Download/aforden/tests/schedule/schedule-mutation-services.test.ts)

---

## 1. Architectural Invariants & Domain Confirmations

### 1.1 Shared Conflict Engine Refactoring Confirmation
> [!IMPORTANT]
> **Zero Duplicate Conflict Logic**:
> `createSchedule.ts` (from Phase 1.8.4) was refactored to call the shared [`assertNoTechnicianConflicts()`](file:///d:/Download/aforden/lib/services/schedule/conflictDetection.ts) helper.
> Neither `createSchedule` nor `rescheduleSchedule` contains any private or inline conflict queries.
>
> All 14 original unit and integration tests in [`tests/schedule/schedule-creation-service.test.ts`](file:///d:/Download/aforden/tests/schedule/schedule-creation-service.test.ts) pass unmodified against the shared helper.

The conflict helper executes the exact half-open overlap query:
```sql
WHERE workspaceId = :workspaceId
  AND technicianId = :technicianId
  AND status IN ('SCHEDULED', 'RESCHEDULED')
  AND scheduledStart < :requestedEnd
  AND scheduledEnd > :requestedStart
  AND (:excludeAppointmentId IS NULL OR id != :excludeAppointmentId)
```

### 1.2 Dispatch Status Reset & History Semantics in `rescheduleSchedule`
- **State Transition (§5.4)**: When an appointment is rescheduled:
  - If its previous `dispatchStatus` was `DISPATCHED` or `ACKNOWLEDGED`, it is automatically reset to `PENDING_DISPATCH` (recalling the booking from the technician until re-dispatched).
  - If its previous `dispatchStatus` was already `PENDING_DISPATCH`, it remains `PENDING_DISPATCH` (no-op reset).
- **History Record Invariant (§15.2)**: In **both cases**, `rescheduleSchedule` writes an immutable `ScheduleAppointmentHistory` record (`eventType: RESCHEDULED`), capturing `field: "scheduledInterval"`, `oldValue`, `newValue`, `metadata.reason`, `metadata.previousStatus`, and `metadata.previousDispatchStatus`.

---

## 2. Traceability Matrix: Business Logic & State Transitions to Phase 1.8.1

| Service | Pipeline Step / Rule | Architectural Invariant | Implementation Reference | Verification Test |
| :--- | :--- | :--- | :--- | :---: |
| **`rescheduleSchedule`** | RBAC Permission | `SCHEDULER_UPDATE` permission required. | `assertPermission(role, PERMISSIONS.SCHEDULER_UPDATE)` | `happy path` |
| **`rescheduleSchedule`** | Resolution & 404 | Tenant-scoped lookup by `{ id, workspaceId }`. | `prisma.scheduleAppointment.findFirst` $\rightarrow$ `ScheduleAppointmentNotFoundError` | `ScheduleAppointmentNotFoundError test` |
| **`rescheduleSchedule`** | Immutability Guard | Rejects `CANCELLED` and `COMPLETED` appointments. | `if (status in [CANCELLED, COMPLETED]) throw new ScheduleImmutableError()` | `ScheduleImmutableError test` |
| **`rescheduleSchedule`** | Interval Validation | Validates new interval and mandatory `reason` (min 1 char). | `rescheduleAppointmentSchema.parse` + defensive bound assertions | `schedule-validation.test.ts` |
| **`rescheduleSchedule`** | Conflict Check (§7.4) | Identical half-open overlap query excluding current record. | `assertNoTechnicianConflicts(..., { excludeAppointmentId: appt.id })` | `conflict overlap test`<br>`touching boundary test` |
| **`rescheduleSchedule`** | Dispatch Reset (§5.4) | If `DISPATCHED` or `ACKNOWLEDGED`, reset to `PENDING_DISPATCH`. | `dispatchStatus: "PENDING_DISPATCH"` on update | `happy path dispatch reset test`<br>`pending_dispatch reschedule test` |
| **`rescheduleSchedule`** | History Audit (§15.2) | Captures old/new intervals, duration, and reason under `eventType: RESCHEDULED`. | `tx.scheduleAppointmentHistory.create({ eventType: "RESCHEDULED", field: "scheduledInterval", ... })` | `history audit test` |
| **`cancelSchedule`** | RBAC Permission | `SCHEDULER_DELETE` permission required. | `assertPermission(role, PERMISSIONS.SCHEDULER_DELETE)` | `happy path` |
| **`cancelSchedule`** | Immutability Guard | Rejects if already `CANCELLED` or `COMPLETED`. | `if (status in [CANCELLED, COMPLETED]) throw new ScheduleImmutableError()` | `ScheduleImmutableError test` |
| **`cancelSchedule`** | Mandatory Reason | Rejects empty or whitespace-only reason. | `if (!cancellationReason) throw new ScheduleMissingCancellationReasonError()` | `missing reason test` |
| **`cancelSchedule`** | WorkOrder Guard (§5.4)| Rejects if parent WorkOrder is `COMPLETED`. | `if (workOrder.status === 'COMPLETED') throw new ScheduleWorkOrderNotEligibleError()` | `completed workOrder test` |
| **`cancelSchedule`** | State Mutation | Sets `status = CANCELLED`, `dispatchStatus = PENDING_DISPATCH`. | `status: "CANCELLED", dispatchStatus: "PENDING_DISPATCH", cancellationReason` | `happy path` |
| **`cancelSchedule`** | History Audit (§15.5) | Captures cancellation reason under `eventType: CANCELLED`. | `tx.scheduleAppointmentHistory.create({ eventType: "CANCELLED", field: "status", ... })` | `history audit test` |
| **`updateSchedule`** | RBAC Permission | `SCHEDULER_UPDATE` permission required. | `assertPermission(role, PERMISSIONS.SCHEDULER_UPDATE)` | `happy path` |
| **`updateSchedule`** | Immutability Guard | Rejects if `CANCELLED` or `COMPLETED`. | `if (status in [CANCELLED, COMPLETED]) throw new ScheduleImmutableError()` | `ScheduleImmutableError test` |
| **`updateSchedule`** | Non-Temporal Safety | Does NOT touch start, end, duration, status, or dispatch status. | Only modifies `notes` and `metadata`. | `happy path non-temporal test` |
| **`updateSchedule`** | History Audit (§15.7) | Captures modified field (`notes`, `metadata`) under `eventType: UPDATED`. | `tx.scheduleAppointmentHistory.create({ eventType: "UPDATED", field, ... })` | `history audit test` |
| **All Services** | Transaction Atomicity | Atomic database mutation & history record creation. | `prisma.$transaction(...)` | `rollback on history failure tests` |

---

## 3. Automated Test Results

```
 RUN  v4.1.10 D:/Download/aforden

 ✓ tests/schedule/schedule-validation.test.ts (21 tests)
 ✓ tests/schedule/schedule-creation-service.test.ts (14 tests)
 ✓ tests/schedule/schedule-mutation-services.test.ts (14 tests)
 ✓ tests/schedule/schedule-model.test.ts (7 tests)
 ✓ tests/schedule/schedule-referential-actions.test.ts (5 tests)
 ✓ tests/schedule/schedule-errors.test.ts (4 tests)

 Test Files  6 passed (6)
      Tests  65 passed (65)
```

---

## 4. Scope Compliance

- **Service Layer Only**: Implemented pure business logic across `rescheduleSchedule.ts`, `cancelSchedule.ts`, `updateSchedule.ts`, and `conflictDetection.ts`.
- **Zero API Routes**: No HTTP route handlers or UI components were created.
