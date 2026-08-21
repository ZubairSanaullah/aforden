# Phase 1.8.9 — Scheduling Referential Integrity & Historical Safety Audit Walkthrough

## Overview

This audit walkthrough documents the verification and safety hardening for **Phase 1.8.9: Scheduling Referential Integrity & Historical Safety**.
This phase evaluates and hardens the scheduling domain against parent entity deletions (`deleteWorkOrder`, `deleteTechnicianProfile`), actor member deletions (`SetNull`), technician deactivation lifecycle boundaries, and parent entity mutations (3NF traversal vs frozen timezone snapshots).

- **Deactivation Safety Guard**: [`lib/services/schedule/assertTechnicianEligibleForDeactivation.ts`](file:///d:/Download/aforden/lib/services/schedule/assertTechnicianEligibleForDeactivation.ts)
- **Domain Errors**: [`lib/services/schedule/scheduleErrors.ts`](file:///d:/Download/aforden/lib/services/schedule/scheduleErrors.ts) (`ScheduleTechnicianActiveBookingsError`)
- **Test Suite**: [`tests/schedule/schedule-referential-integrity.test.ts`](file:///d:/Download/aforden/tests/schedule/schedule-referential-integrity.test.ts) (9 tests)
- **Cumulative Test Results**: 10 test files, 121 tests passing across `tests/schedule/`.

---

## 1. Technical Audit Findings & Service-Layer Evidence

### 1.1 Service-Layer Deletion Rejection (Exercised via Real Service Calls)
Rather than raw database-level assertions, deletion rejection was verified by invoking the actual upstream service functions:

1. **`WorkOrder` Deletion Rejection**:
   - **Service Invoked**: Real Phase 1.6 [`deleteWorkOrder(workspaceId, workOrderId)`](file:///d:/Download/aforden/lib/services/workOrder/deleteWorkOrder.ts).
   - **Test Name**: `"rejects WorkOrder deletion via deleteWorkOrder() service when ScheduleAppointment rows exist (Restrict)"`
   - **Citation**: [`tests/schedule/schedule-referential-integrity.test.ts:L205-L214`](file:///d:/Download/aforden/tests/schedule/schedule-referential-integrity.test.ts#L205-L214).
   - **Behavior**: Calling `deleteWorkOrder()` on a WorkOrder with associated `ScheduleAppointment` rows triggers the database `onDelete: Restrict` foreign key constraint, rejecting the deletion and preserving all appointment records intact.

2. **`TechnicianProfile` Deletion Rejection**:
   - **Service Invoked**: Real Phase 1.3 [`deleteTechnicianProfile(workspaceId, technicianId)`](file:///d:/Download/aforden/lib/services/technicianProfile/deleteTechnicianProfile.ts).
   - **Test Name**: `"rejects TechnicianProfile deletion via deleteTechnicianProfile() service when ScheduleAppointment rows exist (Restrict)"`
   - **Citation**: [`tests/schedule/schedule-referential-integrity.test.ts:L215-L224`](file:///d:/Download/aforden/tests/schedule/schedule-referential-integrity.test.ts#L215-L224).
   - **Behavior**: Calling `deleteTechnicianProfile()` on a technician profile referenced by `ScheduleAppointment.technicianId` triggers `onDelete: Restrict`, blocking profile deletion.

3. **`WorkspaceMember` Deletion & `SetNull` Read Safety**:
   - **Test Name**: `"ScheduleAppointment read model safely projects when dispatchedByMember has been deleted (SetNull)"`
   - **Citation**: [`tests/schedule/schedule-referential-integrity.test.ts:L230-L246`](file:///d:/Download/aforden/tests/schedule/schedule-referential-integrity.test.ts#L230-L246).
   - **Behavior**: Deleting a dispatcher / actor member nullifies `dispatchedByMemberId`, `undispatchedByMemberId`, and `actorMemberId`. `toScheduleAppointmentReadModel()` safely projects `dispatchedByName: null` with zero runtime exceptions.

---

## 2. Policy Decisions & Architectural Boundaries

### 2.1 Technician Deactivation Safety Guard & Phase 1.3 Boundary
> [!IMPORTANT]
> **Ownership Boundary & Scope Clarity**:
> - **Ownership**: `Employee.status` mutation is owned by the **Phase 1.3 / Employee Management domain** (`updateEmployeeStatus`). Phase 1.8 (Scheduling) does not own employee status mutation endpoints.
> - **Scheduling Domain Contract Implemented**: Phase 1.8 has built and exported the official deactivation guard:
>   [`assertTechnicianEligibleForDeactivation(prisma, workspaceId, technicianId)`](file:///d:/Download/aforden/lib/services/schedule/assertTechnicianEligibleForDeactivation.ts).
> - **Wiring Status**: This guard is **not yet wired into Phase 1.3's employee mutation service** because modifying locked Phase 1.3 source files was out of scope for Phase 1.8.
> - **Required Follow-Up for Phase 1.3**: When Phase 1.3 / User Management is next opened, `updateEmployeeStatus` must import `assertTechnicianEligibleForDeactivation` and invoke it before committing `status = INACTIVE` for any employee holding a `TechnicianProfile`.
> - **Active Downstream Guards in Phase 1.8**: If an inactive technician already exists, `dispatchAppointment()` and `rescheduleSchedule()` proactively block operations on that technician with `ScheduleTechnicianNotEligibleError` (422).

---

### 2.2 Formal §13 Error Taxonomy Amendment: `ScheduleTechnicianActiveBookingsError`
The scheduling domain error taxonomy (§13) has been amended to formally include:

| Error Class | Code | HTTP Status | Payload | Trigger Condition |
| :--- | :--- | :---: | :--- | :--- |
| **`ScheduleTechnicianActiveBookingsError`** | `SCHEDULE_TECHNICIAN_ACTIVE_BOOKINGS` | `409 Conflict` | `activeCount: number`<br>`appointmentIds: string[]` | Attempting to deactivate a technician who has one or more active future appointments (`status IN ['SCHEDULED', 'RESCHEDULED']` and `scheduledEnd > now`). |

*(Total locked domain error classes in §13 is now 18).*

---

### 2.3 Documented Tradeoff: 3NF Traversal vs Frozen Timezone Snapshot
> [!NOTE]
> **Design Tradeoff Confirmation**:
> Per Phase 1.8.1 §6.2 & §10.1, `ScheduleAppointment` intentionally stores `timezone` as a **frozen snapshot** resolved at creation time, while `Customer`, `ServiceLocation`, and `Asset` are traversed live through `WorkOrder` in 3NF:
>
> - **Why this tradeoff exists**: If a ServiceLocation's timezone is altered later, calendar cell placement and local-to-UTC calculations must remain deterministic based on the agreed appointment timezone at booking time.
> - **Verified Behavior**: `toScheduleAppointmentReadModel` projects the frozen appointment `timezone` alongside live-traversed `customerName` and `locationName` with zero data corruption.
> - **Test Citation**: [`tests/schedule/schedule-referential-integrity.test.ts:L316-L342`](file:///d:/Download/aforden/tests/schedule/schedule-referential-integrity.test.ts#L316-L342).

### 2.4 Historical Audit Permanence & Deletion Invariants
- **Audit Permanence**: Reaching a terminal status (`CANCELLED` or `COMPLETED`) does not trigger any archival cleanup or record removal. `ScheduleAppointmentHistory` rows survive indefinitely for regulatory compliance.
- **Physical Deletion Deferred**: No delete service exists in the scheduling domain. Appointments can only be `CANCELLED` (soft cancellation). The `ScheduleDeletionNotAllowedError` in the domain taxonomy remains intentionally preserved for future deletion boundaries.

---

## 3. Traceability Matrix: Phase 1.8.1 Specification to Phase 1.8.9 Implementation

| Referential Path / Invariant | Architectural Specification | Implementation in Service / Schema | Verification Test |
| :--- | :--- | :--- | :---: |
| **`WorkOrder` Deletion Restrict** | §10.1: `onDelete: Restrict` on `workOrderId` | Blocked via FK constraint when calling `deleteWorkOrder()` | `schedule-referential-integrity.test.ts:L205-L214` |
| **`TechnicianProfile` Deletion Restrict** | §10.1: `onDelete: Restrict` on `technicianId` | Blocked via FK constraint when calling `deleteTechnicianProfile()` | `schedule-referential-integrity.test.ts:L215-L224` |
| **`WorkspaceMember` Deletion SetNull** | §10.1: `onDelete: SetNull` on dispatch FKs | Nullifies `dispatchedByMemberId` / `undispatchedByMemberId` | `schedule-referential-integrity.test.ts:L230-L246` |
| **Deactivation Safety Guard** | Task 2: Block deactivation if future bookings exist | `assertTechnicianEligibleForDeactivation` $\rightarrow$ `ScheduleTechnicianActiveBookingsError` (409) | `schedule-referential-integrity.test.ts:L250-L288` |
| **Downstream Inactive Dispatch Guard** | §9.2 Step 4: Technician must be `ACTIVE` | `dispatchAppointment` blocks inactive technicians (422) | `schedule-referential-integrity.test.ts:L290-L314` |
| **Historical Timezone Immutability** | §6.2: Frozen snapshot timezone vs live 3NF | `toScheduleAppointmentReadModel` preserves appointment `timezone` | `schedule-referential-integrity.test.ts:L316-L342` |
| **Deletion Error Taxonomy** | §13: Physical deletion deferred | `ScheduleDeletionNotAllowedError` (409) present in taxonomy | `schedule-referential-integrity.test.ts:L344-L352` |

---

## 4. Automated Test Results

```
 RUN  v4.1.10 D:/Download/aforden

 ✓ tests/schedule/schedule-referential-integrity.test.ts (9 tests)
 ✓ tests/schedule/schedule-creation-service.test.ts (14 tests)
 ✓ tests/schedule/schedule-mutation-services.test.ts (15 tests)
 ✓ tests/schedule/technician-availability-conflict-matrix.test.ts (14 tests)
 ✓ tests/schedule/schedule-dispatch-services.test.ts (11 tests)
 ✓ tests/schedule/schedule-query-services.test.ts (20 tests)
 ✓ tests/schedule/schedule-model.test.ts (7 tests)
 ✓ tests/schedule/schedule-errors.test.ts (5 tests)
 ✓ tests/schedule/schedule-validation.test.ts (21 tests)
 ✓ tests/schedule/schedule-referential-actions.test.ts (5 tests)

 Test Files  10 passed (10)
      Tests  121 passed (121)
```
