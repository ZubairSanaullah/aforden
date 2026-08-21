# Phase 1.8.7 — Dispatch Assignment Architecture Walkthrough

## Overview

This walkthrough documents the implementation, verification, and architectural corrections for **Phase 1.8.7: Dispatch Assignment Architecture (`dispatchAppointment`, `undispatchAppointment`, `acknowledgeDispatch`)**.
This layer governs the dispatch lifecycle transitions, technician assignment releases, recall/undispatch preconditions (§9.2, §9.3), and establishes the formal Phase 1.9 Technician Execution boundary entry point (§2.1, §9.1).

- **Dispatch Service**: [`lib/services/schedule/dispatchAppointment.ts`](file:///d:/Download/aforden/lib/services/schedule/dispatchAppointment.ts)
- **Undispatch / Recall Service**: [`lib/services/schedule/undispatchAppointment.ts`](file:///d:/Download/aforden/lib/services/schedule/undispatchAppointment.ts)
- **Acknowledge Service (Phase 1.9 Entry Point)**: [`lib/services/schedule/acknowledgeDispatch.ts`](file:///d:/Download/aforden/lib/services/schedule/acknowledgeDispatch.ts)
- **Shared Helpers**: [`lib/services/schedule/conflictDetection.ts`](file:///d:/Download/aforden/lib/services/schedule/conflictDetection.ts) (`assertTechnicianActive`, `assertNoTechnicianConflicts`)
- **Test Files**:
  - [`tests/schedule/schedule-dispatch-services.test.ts`](file:///d:/Download/aforden/tests/schedule/schedule-dispatch-services.test.ts) (11 tests)
  - [`tests/schedule/schedule-mutation-services.test.ts`](file:///d:/Download/aforden/tests/schedule/schedule-mutation-services.test.ts) (15 tests, +1 new reassignment-flow test)

---

## 1. Technical Audit & Architectural Alignments

### 1.1 Strict Precondition Alignment for `dispatchAppointment()` (§9.2)
`dispatchAppointment()` has been strictly scoped down to match the **exact five preconditions** defined in Phase 1.8.1 §9.2:
1. **Appointment Resolution**: Appointment exists in workspace $\rightarrow$ `ScheduleAppointmentNotFoundError` (404).
2. **Status Guard**: Must be `SCHEDULED` or `RESCHEDULED` (not `CANCELLED` or `COMPLETED`) $\rightarrow$ `DispatchNotAllowedError` (409).
3. **Parent WorkOrder Guard**: WorkOrder must be in an active state (`OPEN`, `ASSIGNED`, `IN_PROGRESS`) $\rightarrow$ `DispatchNotAllowedError` (409).
4. **Technician Active Status**: Evaluated via shared [`assertTechnicianActive()`](file:///d:/Download/aforden/lib/services/schedule/conflictDetection.ts) $\rightarrow$ `ScheduleTechnicianNotEligibleError` (422) if inactive or suspended.
5. **No Hard Overlap Conflicts**: Evaluated via shared [`assertNoTechnicianConflicts()`](file:///d:/Download/aforden/lib/services/schedule/conflictDetection.ts) with `excludeAppointmentId: appt.id` $\rightarrow$ `ScheduleTechnicianConflictError` (409).

> [!NOTE]
> **Working-Hours & Time-Off Exception Scoping**:
> Working-hours windows and time-off exceptions are scheduling-time constraints (`createSchedule` / `rescheduleSchedule`).
> Per §9.2, they are intentionally not re-evaluated at dispatch time, ensuring that already-scheduled appointments are not blocked from field dispatch due to retroactive calendar edits.

### 1.2 Phase 1.9 Boundary Contract Confirmation
`acknowledgeDispatch()` is documented and exported as the **only sanctioned write path** into `ScheduleAppointment` for future Phase 1.9 Technician Execution code.
- **Identity Scoping**: If caller has role `TECHNICIAN`, the service resolves the caller's `TechnicianProfile` (`employee.workspaceMemberId === membership.id`) and asserts it matches `appt.technicianId`. Other technicians are rejected with `AuthorizationError` (403).
- **State Machine Guard**: Rejects acknowledgment unless the appointment is currently in `DISPATCHED` status (`ScheduleInvalidStatusTransitionError`).

### 1.3 Reassignment-Flow Integration Verification (§9.4)
A dedicated integration test was added to [`tests/schedule/schedule-mutation-services.test.ts`](file:///d:/Download/aforden/tests/schedule/schedule-mutation-services.test.ts#L272-L325):
- **Test Name**: `"reassignment-flow integration test (§9.4): rescheduling a DISPATCHED appointment with populated dispatchedAt/dispatchedByMemberId resets dispatchStatus to PENDING_DISPATCH and preserves sane dispatch fields"`
- **Assertion**: Verifies that when an appointment in `DISPATCHED` status (with `dispatchedAt` timestamp and `dispatchedByMemberId` populated) is rescheduled, its `dispatchStatus` safely resets to `PENDING_DISPATCH`, its `status` becomes `RESCHEDULED`, and an audit history record is created with `previousDispatchStatus: "DISPATCHED"`.
- **Test File Count**: Increased from 14 to **15 tests**.

---

## 2. Traceability Matrix: Phase 1.8.1 Specification to Phase 1.8.7 Implementation

| Service / Transition | Architectural Specification | Implementation in Service | Verification Test |
| :--- | :--- | :--- | :---: |
| **`dispatchAppointment`** | RBAC Permission | `SCHEDULER_UPDATE` permission required. | `schedule-dispatch-services.test.ts` (Happy path) |
| **`dispatchAppointment`** | 1. Resolution & 404 (§9.2) | Tenant-scoped lookup by `{ id, workspaceId }`. | `ScheduleAppointmentNotFoundError` (404) |
| **`dispatchAppointment`** | 2. Status Guard (§9.2) | Must be `SCHEDULED` or `RESCHEDULED`. | `DispatchNotAllowedError` (409) |
| **`dispatchAppointment`** | 3. WorkOrder Active Guard (§9.2) | WorkOrder must be `OPEN`, `ASSIGNED`, `IN_PROGRESS`. | `DispatchNotAllowedError` (409) |
| **`dispatchAppointment`** | 4. Technician Active (§9.2) | Asserts `employee.status === 'ACTIVE'`. | `assertTechnicianActive` $\rightarrow$ 422 |
| **`dispatchAppointment`** | 5. Hard Conflict Overlap (§9.2) | Overlap check excluding self. | `assertNoTechnicianConflicts` $\rightarrow$ 409 |
| **`dispatchAppointment`** | Mutation & History (§15.3) | Sets `DISPATCHED`, `dispatchedAt`, `dispatchedByMemberId`. | `tx.scheduleAppointmentHistory.create({ eventType: 'DISPATCHED' })` |
| **`undispatchAppointment`** | RBAC Permission | `SCHEDULER_UPDATE` permission required. | `schedule-dispatch-services.test.ts` (Happy path) |
| **`undispatchAppointment`** | Transition Guard (§9.3) | Only permitted from `DISPATCHED` or `ACKNOWLEDGED`. | `UndispatchNotAllowedError` (409) |
| **`undispatchAppointment`** | Field Execution Guard (§9.3) | Cannot undispatch if `fieldExecutionStartedAt !== null`. | `UndispatchNotAllowedError` (409) |
| **`undispatchAppointment`** | Mutation & History (§15.4) | Sets `PENDING_DISPATCH`, `undispatchedAt`, `undispatchedByMemberId`. | `tx.scheduleAppointmentHistory.create({ eventType: 'UNDISPATCHED' })` |
| **`acknowledgeDispatch`** | Auth & Identity Scoping (§2.1, §9.1) | `SCHEDULER_VIEW` tier auth; technician can only acknowledge own appointment. | `AuthorizationError` (403) on technician mismatch |
| **`acknowledgeDispatch`** | State Machine Guard (§5.3) | Permitted strictly from `DISPATCHED`. | `ScheduleInvalidStatusTransitionError` (409) |
| **`acknowledgeDispatch`** | Mutation & History (§5.4, §15) | Sets `ACKNOWLEDGED`. | `tx.scheduleAppointmentHistory.create({ eventType: 'UPDATED' })` |
| **Reassignment Flow** | Reassignment / Reschedule Reset (§9.4) | Rescheduling a `DISPATCHED` booking resets `dispatchStatus = PENDING_DISPATCH`. | `schedule-mutation-services.test.ts` (Reassignment flow test) |

---

## 3. Automated Test Results

```
 RUN  v4.1.10 D:/Download/aforden

 ✓ tests/schedule/schedule-creation-service.test.ts (14 tests)
 ✓ tests/schedule/schedule-mutation-services.test.ts (15 tests)
 ✓ tests/schedule/schedule-dispatch-services.test.ts (11 tests)
 ✓ tests/schedule/technician-availability-conflict-matrix.test.ts (14 tests)
 ✓ tests/schedule/schedule-model.test.ts (7 tests)
 ✓ tests/schedule/schedule-validation.test.ts (21 tests)
 ✓ tests/schedule/schedule-errors.test.ts (5 tests)
 ✓ tests/schedule/schedule-referential-actions.test.ts (5 tests)

 Test Files  8 passed (8)
      Tests  92 passed (92)
```

---

## 4. Scope Compliance

- **Service Layer Only**: Implemented pure business logic across `dispatchAppointment.ts`, `undispatchAppointment.ts`, and `acknowledgeDispatch.ts`.
- **Zero API Routes**: No HTTP route handlers or UI components were created.
- **Phase 1.9 Integrity**: Established the boundary contract entry point without implementing execution-phase state machines.
