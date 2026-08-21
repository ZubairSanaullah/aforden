# Phase 1.9.6 — Travel / Field Execution Start Walkthrough (Corrected)

## Overview

This walkthrough documents the corrected implementation and verification of **Phase 1.9.6: Travel / Field Execution Start** in strict accordance with **Section 4 (Travel vs. On-Site Execution Semantics)**, **Section 4.1 (Operational Invariants)**, **Section 5.1 (`startTravel()`)**, **Section 7.3 (Concurrency & Active Entry Rules)**, and **Section 14 (Transaction Boundaries)** of the locked architecture standard in [`docs/architecture/phase-1.9.1-technician-operations-architecture.md`](file:///d:/Download/aforden/docs/architecture/phase-1.9.1-technician-operations-architecture.md).

---

## 1. Architectural Invariant Compliance & Direct Resolution of Audit Points

### A. Direct, Unconditional Atomic Transaction (Audit Point 1)
- Removed all conditional transaction fallbacks (`const runTx = ...`).
- All mutations (appointment stamping, audit logging, and `TechnicianTimeEntry` creation) execute directly and unconditionally inside `await prisma.$transaction(async (tx) => { ... })` per Section 14.

### B. Precondition State: `ACKNOWLEDGED` Dispatch Status Required (Audit Point 2)
- Per the lifecycle diagram in Section 4 ("1. DISPATCHED & ACKNOWLEDGED" $\rightarrow$ "2. TRAVEL PHASE"), a technician can only begin driving once the dispatch receipt has been acknowledged.
- `startTechnicianTravel` explicitly enforces that `appointment.dispatchStatus === "ACKNOWLEDGED"`.
- If the appointment is in `PENDING_DISPATCH` or `DISPATCHED` (unacknowledged), the service throws `ScheduleInvalidStatusTransitionError` (**409 Conflict**).

### C. Mandatory Linked Scheduled Appointment Requirement (Audit Point 3)
- Section 4.1.2 defines "Travel Activates the Execution Lock" as an unconditional operational invariant: starting travel must stamp `ScheduleAppointment.fieldExecutionStartedAt = now()`.
- A technician cannot enter travel status for a work order without a scheduled dispatch appointment.
- If no active `ScheduleAppointment` is linked to the WorkOrder and technician, `startTechnicianTravel` throws `ScheduleAppointmentNotFoundError` (**404 Not Found**).

### D. Single Active Time Entry Rule (Section 7.3)
- If the technician already has an active entry (`status: "ACTIVE"`), the service throws `ActiveTimeEntryExistsError` (**409 Conflict**).
- No silent auto-close occurs during travel start (auto-closing travel entries is reserved for on-site work commencement in Phase 1.9.7).

### E. WorkOrder Status Invariant (Section 4.1.1)
- `startTechnicianTravel` validates that the WorkOrder is in `ASSIGNED` status and assigned to the caller.
- `WorkOrder.status` remains `ASSIGNED` (on-site work has not commenced).

---

## 2. Corrected Service Implementation

[`lib/services/technicianOperations/startTechnicianTravel.ts`](file:///d:/Download/aforden/lib/services/technicianOperations/startTechnicianTravel.ts)

```typescript
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import {
    WorkOrderNotFoundError,
    WorkOrderInvalidStatusTransitionError,
} from "@/lib/services/workOrder/workOrderErrors";
import {
    ScheduleAppointmentNotFoundError,
    ScheduleInvalidStatusTransitionError,
} from "@/lib/services/schedule/scheduleErrors";
import {
    TechnicianNotAssignedToWorkOrderError,
    ActiveTimeEntryExistsError,
} from "./technicianOperationsErrors";
import { recordScheduleHistory } from "@/lib/services/schedule/recordScheduleHistory";
import {
    startTravelSchema,
    toTechnicianTimeEntryReadModel,
    type TechnicianExecutionContext,
    type TechnicianTimeEntryReadModel,
} from "./technicianOperations.types";

/**
 * Initiates travel for an assigned WorkOrder by the authenticated technician.
 *
 * Operational & Invariant Rules:
 * - Section 2.2 (Invariant 2): Bound strictly to the caller's server-derived technician context (role: TECHNICIAN).
 * - Section 4: "1. DISPATCHED & ACKNOWLEDGED" is the strict precondition state before the travel phase begins.
 *   The linked ScheduleAppointment must be in `ACKNOWLEDGED` dispatch status.
 * - Section 4.1.1 (Invariant 1): WorkOrder status REMAINS `ASSIGNED` (on-site work has not commenced).
 * - Section 4.1.2 (Invariant 2) & Section 6.1 (Touchpoint 2): Stamping `ScheduleAppointment.fieldExecutionStartedAt = now()`
 *   is an unconditional invariant that permanently locks the appointment against Phase 1.8 `undispatchAppointment` recalls.
 *   A linked active ScheduleAppointment is strictly required; throws `ScheduleAppointmentNotFoundError` (404) if missing.
 * - Section 7.3 (Single-Active-Entry Rule): If the technician already has an active time entry, throws
 *   `ActiveTimeEntryExistsError` (409) rather than auto-closing (auto-close is reserved for on-site transition).
 * - Section 14: Executes directly in an unconditional atomic `prisma.$transaction`, recording audit history in `ScheduleAppointmentHistory`.
 */
export async function startTechnicianTravel(
    context: TechnicianExecutionContext,
    workOrderId: string,
    input: unknown = {}
): Promise<TechnicianTimeEntryReadModel> {
    // 1. Role Enforcement (Invariant 2)
    if (context.role !== "TECHNICIAN") {
        throw new ForbiddenError(
            "Only authenticated technicians can start travel through technician operations."
        );
    }

    if (!workOrderId || typeof workOrderId !== "string" || !workOrderId.trim()) {
        throw new WorkOrderNotFoundError();
    }

    // 2. Validate Input Payload
    const data = startTravelSchema.parse(input ?? {});

    // 3. Precondition: Resolve WorkOrder & Check Assignment + Status (§4.1, §5.1)
    const workOrder = await prisma.workOrder.findFirst({
        where: {
            id: workOrderId.trim(),
            workspaceId: context.workspaceId,
        },
        select: {
            id: true,
            status: true,
            assignedTechnicianId: true,
        },
    });

    if (!workOrder) {
        throw new WorkOrderNotFoundError();
    }

    if (workOrder.assignedTechnicianId !== context.technicianProfileId) {
        throw new TechnicianNotAssignedToWorkOrderError(
            "You are not assigned to execute this work order."
        );
    }

    if (workOrder.status !== "ASSIGNED") {
        throw new WorkOrderInvalidStatusTransitionError(
            `Cannot start travel. Work order must be in ASSIGNED status (currently ${workOrder.status}).`
        );
    }

    // 4. Precondition: Single Active Time Entry Rule (§7.3)
    const existingActiveEntry = await prisma.technicianTimeEntry.findFirst({
        where: {
            workspaceId: context.workspaceId,
            technicianProfileId: context.technicianProfileId,
            status: "ACTIVE",
        },
        select: { id: true },
    });

    if (existingActiveEntry) {
        throw new ActiveTimeEntryExistsError(
            "An active time entry is already in progress for this technician."
        );
    }

    // 5. Precondition: Resolve Linked ScheduleAppointment & Verify Dispatch State (§4, §6.1)
    const appointment = await prisma.scheduleAppointment.findFirst({
        where: {
            workOrderId: workOrder.id,
            workspaceId: context.workspaceId,
            technicianId: context.technicianProfileId,
            status: { not: "CANCELLED" },
        },
        select: {
            id: true,
            dispatchStatus: true,
            fieldExecutionStartedAt: true,
        },
    });

    if (!appointment) {
        throw new ScheduleAppointmentNotFoundError(
            "No active scheduled appointment found for this work order and technician."
        );
    }

    if (appointment.dispatchStatus !== "ACKNOWLEDGED") {
        throw new ScheduleInvalidStatusTransitionError(
            `Appointment must be in ACKNOWLEDGED dispatch status before starting travel (currently ${appointment.dispatchStatus}).`,
            appointment.dispatchStatus,
            "ACKNOWLEDGED"
        );
    }

    // 6. Persistence in Unconditional Atomic Transaction (§14)
    const now = new Date();
    const createdEntry = await prisma.$transaction(async (tx) => {
        // Stamp fieldExecutionStartedAt on linked appointment if not yet set
        if (appointment.fieldExecutionStartedAt === null) {
            await tx.scheduleAppointment.update({
                where: { id: appointment.id },
                data: { fieldExecutionStartedAt: now },
            });

            await recordScheduleHistory(tx, {
                workspaceId: context.workspaceId,
                appointmentId: appointment.id,
                eventType: "UPDATED",
                actorMemberId: context.membershipId,
                actorName: context.technicianName,
                field: "fieldExecutionStartedAt",
                oldValue: null,
                newValue: now.toISOString(),
                metadata: {
                    notes: data.notes ?? null,
                },
            });
        }

        // Create ACTIVE TRAVEL time entry
        return tx.technicianTimeEntry.create({
            data: {
                workspaceId: context.workspaceId,
                technicianProfileId: context.technicianProfileId,
                workOrderId: workOrder.id,
                appointmentId: appointment.id,
                entryType: "TRAVEL",
                status: "ACTIVE",
                startedAt: now,
                endedAt: null,
                durationMinutes: null,
                notes: data.notes ?? null,
                metadata: data.metadata ? (data.metadata as any) : undefined,
                createdByMemberId: context.membershipId,
            },
        });
    });

    // 7. Return Canonical Read Model DTO
    return toTechnicianTimeEntryReadModel(createdEntry);
}
```

---

## 3. Test Coverage Summary

Test Suite: [`tests/technician-operations/technician-travel-start.test.ts`](file:///d:/Download/aforden/tests/technician-operations/technician-travel-start.test.ts) (9 tests passing)

### Tested Scenarios:
1. **Successful Travel Start**:
   - Starts travel inside direct atomic transaction.
   - Creates `TechnicianTimeEntry` with `entryType: "TRAVEL"`, `status: "ACTIVE"`, `startedAt: Date`, and `appointmentId`.
   - Stamps `fieldExecutionStartedAt = now` on linked appointment.
   - Writes immutable `ScheduleAppointmentHistory` record.
   - WorkOrder remains in `ASSIGNED` status.
2. **Mandatory Appointment & Dispatch Status Preconditions (Audit Points 2 & 3)**:
   - Throws `ScheduleAppointmentNotFoundError` (404) if no scheduled appointment exists for the work order.
   - Throws `ScheduleInvalidStatusTransitionError` (409) if linked appointment is not in `ACKNOWLEDGED` status (e.g. `DISPATCHED`).
3. **Single Active Time Entry Rule (Section 7.3)**:
   - Throws `ActiveTimeEntryExistsError` (409) if technician already has a running active time entry.
4. **WorkOrder Precondition Failures**:
   - Throws `WorkOrderInvalidStatusTransitionError` (409) if WorkOrder is in `IN_PROGRESS` or any non-`ASSIGNED` status.
   - Throws `TechnicianNotAssignedToWorkOrderError` (403) if WorkOrder is assigned to another technician.
   - Throws `WorkOrderNotFoundError` (404) for non-existent WorkOrders.
5. **Role Enforcement**:
   - Rejects non-`TECHNICIAN` roles with `ForbiddenError` (403).
6. **Integration with Phase 1.8 Undispatch Guard**:
   - Proves that stamping `fieldExecutionStartedAt` causes Phase 1.8 `undispatchAppointment` to reject recalls with `UndispatchNotAllowedError` (409).

---

## 4. Quality Gate Outputs (Verbatim)

### A. Prisma Schema Validation (`npx prisma validate`)

```text
Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma\schema.prisma.
The schema at prisma\schema.prisma is valid 🚀
```

### B. TypeScript Compiler Check (`npx tsc --noEmit`)

```text
Exit Code: 0
Stdout: (clean compilation, 0 errors)
Stderr: (empty)
```

### C. Full Workspace Test Suite (`npm test`)

```text
 Test Files  142 passed (142)
      Tests  2420 passed (2420)
   Start at  13:57:39
   Duration  43.85s (transform 7.44s, setup 0ms, import 35.28s, tests 43.53s, environment 30ms)
```

---

## Conclusion & Readiness for Phase 1.9.7

Phase 1.9.6 (**Travel / Field Execution Start**) is corrected, verified against all architectural invariants and transaction boundaries, and passes all quality gates with zero regressions (2,420 tests passing across 142 test files). The workspace is ready for Phase 1.9.7.
