# Phase 1.8.4 — Schedule Creation & Appointment Service Walkthrough

## Overview

This walkthrough documents the implementation and verification of **Phase 1.8.4: Schedule Creation & Appointment Service (`createSchedule`)**.
The service represents the first business-logic service of the Scheduling & Dispatch domain, strictly following the locked 7-step pipeline from Phase 1.8.1 §12, the WorkOrder assignment precondition from §2.2, strict hierarchical timezone resolution from §6.2, and half-open conflict evaluation from §7.2.

- **Service File**: [`lib/services/schedule/createSchedule.ts`](file:///d:/Download/aforden/lib/services/schedule/createSchedule.ts)
- **Shared Read Model Mapper**: [`lib/services/schedule/scheduleReadModel.ts`](file:///d:/Download/aforden/lib/services/schedule/scheduleReadModel.ts)
- **Test File**: [`tests/schedule/schedule-creation-service.test.ts`](file:///d:/Download/aforden/tests/schedule/schedule-creation-service.test.ts)

---

## 1. Architectural Invariants & Tenant Scoping Confirmation

- **TechnicianProfile Tenant Scoping Confirmation**: In the Aforden database schema, `TechnicianProfile` does not contain a direct `workspaceId` column; its tenant scoping is strictly enforced via relational traversal through `employee.workspaceId` (`where: { id: technicianId, employee: { workspaceId } }`), ensuring complete tenant isolation and 404 IDOR protection without redundant foreign key duplication.
- **Strict Timezone Resolution (§6.2)**: Timezone resolution strictly resolves `workOrder.location.timezone` (ServiceLocation) first; if absent/null, it falls back to `authorization.workspace.timezone`. Client overrides are excluded and no hardcoded `'UTC'` fallbacks are used. If workspace timezone is missing, it is treated as a configuration error.

---

## 2. Traceability Matrix: Phase 1.8.1 Pipeline to Implementation

| Pipeline Step | Architectural Specification | Implementation in `createSchedule()` | Verification Test |
| :-: | :--- | :--- | :---: |
| **1. AUTH** | Verify session & active workspace membership. | `requireWorkspaceAuthorization(workspaceId)` | `Happy path` |
| **2. PERMISSION** | Enforce RBAC permission. | `assertPermission(role, PERMISSIONS.SCHEDULER_CREATE)` | `Happy path` |
| **3. VALIDATION** | Parse input payload via Zod. | `createScheduleAppointmentSchema.parse(input)` | `schedule-validation.test.ts` |
| **4. RESOLUTION** | Scoped WorkOrder & Technician lookups with IDOR 404 translation. | `prisma.workOrder.findFirst({ where: { id, workspaceId } })` $\rightarrow$ `ScheduleWorkOrderNotFoundError`<br>`prisma.technicianProfile.findFirst({ where: { id, employee: { workspaceId } } })` $\rightarrow$ `ScheduleTechnicianNotFoundError` | `ScheduleWorkOrderNotFoundError`<br>`ScheduleTechnicianNotFoundError` |
| **5.1 TERMINAL GUARD** | WorkOrder cannot be `COMPLETED` or `CANCELLED`. | `if (workOrder.status === 'COMPLETED' \|\| workOrder.status === 'CANCELLED') throw new ScheduleWorkOrderNotEligibleError()` | `ScheduleWorkOrderNotEligibleError` |
| **5.2 ASSIGNMENT PRECONDITION** | WorkOrder must be assigned to the requested technician (§2.2). | `if (workOrder.assignedTechnicianId === null) throw new ScheduleWorkOrderNotAssignedError()`<br>`if (workOrder.assignedTechnicianId !== data.technicianId) throw new ScheduleTechnicianMismatchError()` | `ScheduleWorkOrderNotAssignedError`<br>`ScheduleTechnicianMismatchError` |
| **5.3 TECHNICIAN ELIGIBILITY** | Technician employee record must be `ACTIVE`. | `if (technician.employee.status !== 'ACTIVE') throw new ScheduleTechnicianNotEligibleError()` | `ScheduleTechnicianNotEligibleError` |
| **5.4 INTERVAL DEFENSIVE CHECK** | Start strictly before end; min 5m, max 14d. | Calculates `durationMinutes`; asserts interval validity $\rightarrow$ `ScheduleInvalidTimeIntervalError`. | `ScheduleInvalidTimeIntervalError` |
| **5.5 CONFLICT DETECTION** | Half-open overlap query on active statuses (`SCHEDULED`, `RESCHEDULED`). | `scheduledStart < data.scheduledEnd && scheduledEnd > data.scheduledStart` $\rightarrow$ `ScheduleTechnicianConflictError`. | `ScheduleTechnicianConflictError`<br>`Touching boundary test` |
| **5.6 TIMEZONE RESOLUTION** | Strict hierarchical timezone resolution per §6.2. | `(workOrder.location as any)?.timezone \|\| authorization.workspace?.timezone`. | `ServiceLocation timezone test`<br>`Workspace fallback test` |
| **6. PERSISTENCE & ATOMICITY** | Atomic transaction for sequential appointment number, booking, and history. | `prisma.$transaction`: generates `APT-YYYY-XXXXXX`, inserts `ScheduleAppointment`, inserts `ScheduleAppointmentHistory` (`eventType: 'CREATED'`). | `Transaction atomicity test`<br>`Sequential numbering test` |
| **7. READ MODEL** | Canonical read model projection. | `toScheduleAppointmentReadModel(created)` | `Happy path read model test` |

---

## 3. Automated Test Results

```
 RUN  v4.1.10 D:/Download/aforden

 ✓ tests/schedule/schedule-model.test.ts (7 tests)
 ✓ tests/schedule/schedule-creation-service.test.ts (14 tests)
 ✓ tests/schedule/schedule-validation.test.ts (21 tests)
 ✓ tests/schedule/schedule-referential-actions.test.ts (5 tests)
 ✓ tests/schedule/schedule-errors.test.ts (4 tests)

 Test Files  5 passed (5)
      Tests  51 passed (51)
```

### Verified Scenarios
1. **Happy Path**: Creates appointment and history in a single transaction, returning a complete `ScheduleAppointmentReadModel` with denormalized customer and location details.
2. **Sequential Numbering**: Atomically derives `APT-YYYY-000001` and increments on subsequent bookings.
3. **Precondition Enforcement**: Rejects unassigned work orders, technician mismatches, and inactive technicians without mutating WorkOrder state.
4. **Conflict Detection**: Blocks true overlaps while permitting exact touching boundaries (back-to-back appointments).
5. **Timezone Hierarchy**: Picks ServiceLocation timezone when present; falls back to Workspace timezone when ServiceLocation timezone is null.
6. **Transaction Rollback**: Aborts appointment insertion if history creation fails.

---

## 4. Scope Compliance

- **Service Layer Only**: Implemented pure service business logic in `createSchedule.ts` and `scheduleReadModel.ts`.
- **Zero API Routes**: No HTTP route handlers or UI components were created.
