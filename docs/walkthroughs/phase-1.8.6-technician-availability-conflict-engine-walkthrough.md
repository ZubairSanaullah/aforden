# Phase 1.8.6 — Technician Availability & Conflict Detection Engine Walkthrough

## Overview

This walkthrough documents the implementation, verification, and architectural corrections for **Phase 1.8.6: Technician Availability & Conflict Detection Engine**.
The availability and conflict engine represents the core deterministic scheduling correctness system of the Aforden FSM SaaS backend, unifying three availability pillars:
1. **Technician Identity & Status Eligibility** (§12 Step 4 & Step 5.3)
2. **Phase 1.3 Recurring Working Hours & Time-Off Exception Evaluation** (§8.1 point 3)
3. **Canonical Half-Open Overlap Conflict Engine** (§7.2–§7.4)

- **Conflict Detection Helper**: [`lib/services/schedule/conflictDetection.ts`](file:///d:/Download/aforden/lib/services/schedule/conflictDetection.ts)
- **Composite Availability Engine**: [`lib/services/schedule/checkTechnicianAvailability.ts`](file:///d:/Download/aforden/lib/services/schedule/checkTechnicianAvailability.ts)
- **Refactored Service Entry Points**:
  - [`lib/services/schedule/createSchedule.ts`](file:///d:/Download/aforden/lib/services/schedule/createSchedule.ts)
  - [`lib/services/schedule/rescheduleSchedule.ts`](file:///d:/Download/aforden/lib/services/schedule/rescheduleSchedule.ts)
- **Error Taxonomy**: [`lib/services/schedule/scheduleErrors.ts`](file:///d:/Download/aforden/lib/services/schedule/scheduleErrors.ts)
- **Conflict Matrix Test Suite**: [`tests/schedule/technician-availability-conflict-matrix.test.ts`](file:///d:/Download/aforden/tests/schedule/technician-availability-conflict-matrix.test.ts)

---

## 1. Technical Audit & Architecture Verifications

### 1.1 Verified Inspection of Phase 1.3 `evaluateIntervalAvailability`
The engine directly integrates with the existing Phase 1.3 availability utility. The source file was inspected and verified at:
[`lib/services/technicianProfile/availabilityIntervalUtils.ts`](file:///d:/Download/aforden/lib/services/technicianProfile/availabilityIntervalUtils.ts#L148-L249).

**Actual Function Signature**:
```typescript
export function evaluateIntervalAvailability(
    startsAt: Date,
    endsAt: Date,
    timeZone: string,
    activeAvailabilities: TechnicianAvailability[],
    activeExceptions: TechnicianAvailabilityException[],
): IntervalEvaluationResult
```

**Actual Return Shape & Semantics**:
```typescript
export interface IntervalEvaluationResult {
    isCoveredByRecurring: boolean;
    matchingAvailability: RecurringAvailabilityWindow[];
    blockingExceptions: BlockingExceptionInfo[];
}
```
- **Execution Characteristics**:
  - It is a pure deterministic computation that **never throws internally**.
  - It slices the requested `[startsAt, endsAt)` interval into calendar day intervals in the specified `timeZone` via `sliceIntervalByZonedDays()`.
  - Compares interval slices against active `TechnicianAvailability` records (Mon–Sun) to determine `isCoveredByRecurring` and identify `matchingAvailability`.
  - Performs half-open interval overlap testing (`exc.startsAt < endsAt && startsAt < exc.endsAt`) across active `TechnicianAvailabilityException` records (`VACATION`, `SICK_LEAVE`, `TRAINING`), returning any collisions in `blockingExceptions`.

---

### 1.2 Formal §13 Error Taxonomy Amendment: Dedicated Semantic Error Classes
To prevent semantic dilution of `ScheduleTechnicianNotEligibleError` (which is locked in §13 for inactive/suspended employment status and missing service qualifications), we formally introduced two dedicated error classes:

1. **`ScheduleTechnicianOnLeaveError`** (`SCHEDULE_TECHNICIAN_ON_LEAVE`, HTTP `422 Unprocessable Entity`):
   - **Trigger**: The requested appointment interval intersects an active approved `TechnicianAvailabilityException` (time-off, leave, training).
   - **Payload**: Includes the colliding `exceptions: BlockingExceptionInfo[]` array.
2. **`ScheduleOutsideWorkingHoursError`** (`SCHEDULE_OUTSIDE_WORKING_HOURS`, HTTP `422 Unprocessable Entity`):
   - **Trigger**: The requested appointment interval falls outside a technician's configured recurring `TechnicianAvailability` weekly windows.
3. **`ScheduleTechnicianNotEligibleError`** (`SCHEDULE_TECHNICIAN_NOT_ELIGIBLE`, HTTP `422 Unprocessable Entity`):
   - **Trigger**: Exclusively reserved for `Employee.status !== 'ACTIVE'` (e.g. `SUSPENDED`, `INACTIVE`) or missing workspace qualification prerequisites.

---

### 1.3 Single-Point De-Duplication of Technician Status Eligibility
> [!IMPORTANT]
> **Complete Elimination of Inline Duplicate Logic**:
> Technician resolution, workspace scoping, and active status checks now live in **exactly one place**: inside [`checkTechnicianAvailability.ts`](file:///d:/Download/aforden/lib/services/schedule/checkTechnicianAvailability.ts#L55-L78).
>
> Both `createSchedule.ts` and `rescheduleSchedule.ts` have zero duplicate inline `technicianProfile.findFirst` or `employee.status` checks, fully delegating to `checkTechnicianAvailability()`.

---

## 2. Traceability Matrix: Phase 1.8.1 Specification to Phase 1.8.6 Implementation

| Availability Pillar / Scenario | Mathematical Formula / Invariant | Error Class / Behavior | Verification Test |
| :--- | :--- | :--- | :---: |
| **Technician Resolution & Scope** | Must exist in target workspace (`employee.workspaceId == workspaceId`). | `ScheduleTechnicianNotFoundError` (404) | `technician-availability-conflict-matrix.test.ts` (Case 2.1) |
| **Technician Status Eligibility** | `Employee.status === 'ACTIVE'`. | `ScheduleTechnicianNotEligibleError` (422) | `technician-availability-conflict-matrix.test.ts` (Case 2.2) |
| **Schedule Exceptions (Leave/PTO)**| Collides with approved `TechnicianAvailabilityException`. | `ScheduleTechnicianOnLeaveError` (422) | `technician-availability-conflict-matrix.test.ts` (Case 3.2) |
| **Weekly Working Hours** | Interval slices not covered by active daily windows. | `ScheduleOutsideWorkingHoursError` (422) | `technician-availability-conflict-matrix.test.ts` (Case 3.1) |
| **True Overlap Conflict** | $A.\text{start} < B.\text{end} \land B.\text{start} < A.\text{end}$ | `ScheduleTechnicianConflictError` (409) | `technician-availability-conflict-matrix.test.ts` (Case 1.1 & 1.2) |
| **Enclosure / Subset Overlap** | Requested interval enclosed within longer active booking. | `ScheduleTechnicianConflictError` (409) | `technician-availability-conflict-matrix.test.ts` (Case 1.3) |
| **Identical Interval Overlap** | Requested start/end exactly equal existing booking. | `ScheduleTechnicianConflictError` (409) | `technician-availability-conflict-matrix.test.ts` (Case 1.4) |
| **Touching Boundaries (Back-to-Back)** | $A.\text{end} == B.\text{start} \lor B.\text{end} == A.\text{start}$ | Half-open intervals $[A.\text{start}, A.\text{end})$ evaluate strictly `lt`/`gt` $\rightarrow$ **Permits** | `technician-availability-conflict-matrix.test.ts` (Case 1.5) |
| **Self-Exclusion on Reschedule** | Rescheduling appointment over its own window. | `id: { not: excludeAppointmentId }` $\rightarrow$ **Permits** | `technician-availability-conflict-matrix.test.ts` (Case 1.6) |
| **Multi-Booking Day** | Clean gap between 3+ bookings vs overlap with middle booking. | Half-open overlap query evaluates multiple records | `technician-availability-conflict-matrix.test.ts` (Case 4.1 & 4.2) |
| **Tenant Isolation** | Identical time slot for technician in Tenant B never conflicts with Tenant A. | Query strictly scoped by `workspaceId` | `technician-availability-conflict-matrix.test.ts` (Case 5.1) |

---

## 3. Automated Test Results

```
 RUN  v4.1.10 D:/Download/aforden

 ✓ tests/schedule/technician-availability-conflict-matrix.test.ts (14 tests)
 ✓ tests/schedule/schedule-creation-service.test.ts (14 tests)
 ✓ tests/schedule/schedule-mutation-services.test.ts (14 tests)
 ✓ tests/schedule/schedule-validation.test.ts (21 tests)
 ✓ tests/schedule/schedule-model.test.ts (7 tests)
 ✓ tests/schedule/schedule-referential-actions.test.ts (5 tests)
 ✓ tests/schedule/schedule-errors.test.ts (5 tests)

 Test Files  7 passed (7)
      Tests  80 passed (80)
```

---

## 4. Scope Compliance

- **Engine & Service Layer Only**: No API routes, UI components, or workforce optimization solvers were introduced.
- **Zero Duplication**: Shared availability logic across `createSchedule`, `rescheduleSchedule`, and the conflict matrix test suite.
