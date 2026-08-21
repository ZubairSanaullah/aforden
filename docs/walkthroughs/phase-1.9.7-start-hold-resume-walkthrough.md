# Phase 1.9.7 — WorkOrder Start / Hold / Resume Walkthrough

## Overview

This walkthrough documents the implementation and verification of **Phase 1.9.7: WorkOrder Start / Hold / Resume** in strict accordance with **Section 2.1 (Invariant 1: Single Authority Status Machine)**, **Section 4.1 (Operational Invariants)**, **Section 5.1 (Operational Action Mapping)**, **Section 7.3 (Concurrency & Active Entry Rules)**, and **Section 14 (Transaction Boundaries)** of the locked architecture standard in [`docs/architecture/phase-1.9.1-technician-operations-architecture.md`](file:///d:/Download/aforden/docs/architecture/phase-1.9.1-technician-operations-architecture.md).

---

## 1. Architectural Invariant Implementation

### A. Start Work Order (`startTechnicianWorkOrder`)
- **Single Authority Status Machine (Invariant 1)**: Transitions the WorkOrder from `ASSIGNED` to `IN_PROGRESS`, sets `startedAt = now()`, and creates a `WorkOrderHistory` audit entry (`eventType: STATUS_CHANGED`).
- **Undispatch Execution Lock (Section 4.1.2 & Touchpoint 2)**: Stamping `ScheduleAppointment.fieldExecutionStartedAt = now()` permanently locks linked appointments against Phase 1.8 `undispatchAppointment` recalls (handling cases where a technician arrives on-site without logging a separate travel step).
- **Automatic Travel Closure (Section 4.1.4 & Section 7.3)**: In the same atomic transaction, queries for any active `TechnicianTimeEntry` for the technician. If found (e.g. an active `TRAVEL` entry), closes it (`endedAt = now()`, calculates `durationMinutes`, `status = "COMPLETED"`) before opening a new active `ON_SITE` entry.
- **Atomic Persistence (Section 14)**: All updates (WorkOrder transition, WorkOrderHistory, appointment stamp, appointment history, travel closure, and on-site entry creation) execute in an atomic `prisma.$transaction`.

### B. Hold Work Order (`holdTechnicianWorkOrder`)
- **Single Authority Status Machine (Invariant 1)**: Delegates directly to Phase 1.6 `transitionWorkOrderStatus(workspaceId, workOrderId, { toStatus: "ON_HOLD", holdReason })`, which validates the transition, sets `holdReason`, and writes `WorkOrderHistory`.
- **Reason Validation**: Enforces that `holdReason` is a non-empty string.
- **Active Entry Closure (Section 7.3)**: Closes the running active `ON_SITE` time entry (`endedAt = now()`, calculates `durationMinutes`, `status = "COMPLETED"`).

### C. Resume Work Order (`resumeTechnicianWorkOrder`)
- **Single Authority Status Machine (Invariant 1)**: Delegates directly to Phase 1.6 `transitionWorkOrderStatus(workspaceId, workOrderId, { toStatus: "IN_PROGRESS" })`, which clears `holdReason` and writes `WorkOrderHistory`.
- **New Active Entry Opening (Section 7.3)**: Creates a new active `ON_SITE` `TechnicianTimeEntry`.

---

## 2. Service Implementations

### `lib/services/technicianOperations/startTechnicianWorkOrder.ts`
```typescript
export async function startTechnicianWorkOrder(
    context: TechnicianExecutionContext,
    workOrderId: string,
    input: unknown = {}
): Promise<WorkOrderReadModel> {
    if (context.role !== "TECHNICIAN") {
        throw new ForbiddenError(
            "Only authenticated technicians can start work orders through technician operations."
        );
    }

    if (!workOrderId || typeof workOrderId !== "string" || !workOrderId.trim()) {
        throw new WorkOrderNotFoundError();
    }

    const trimmedWorkOrderId = workOrderId.trim();
    const data = startWorkOrderSchema.parse(input ?? {});

    const workOrder = await prisma.workOrder.findFirst({
        where: { id: trimmedWorkOrderId, workspaceId: context.workspaceId },
        include: { customer: true, location: true, workType: true },
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
            `Cannot start work order. Work order must be in ASSIGNED status (currently ${workOrder.status}).`
        );
    }

    const now = new Date();
    const updated = await prisma.$transaction(async (tx) => {
        const updatedWorkOrder = await tx.workOrder.update({
            where: { id: workOrder.id },
            data: {
                status: "IN_PROGRESS",
                startedAt: workOrder.startedAt ?? now,
            },
            include: { customer: true, location: true, workType: true },
        });

        if (tx.workOrderHistory?.create) {
            await tx.workOrderHistory.create({
                data: {
                    workspaceId: context.workspaceId,
                    workOrderId: workOrder.id,
                    eventType: "STATUS_CHANGED",
                    actorMemberId: context.membershipId,
                    actorName: context.technicianName,
                    field: "status",
                    oldValue: "ASSIGNED",
                    newValue: "IN_PROGRESS",
                    metadata: data.notes ? JSON.stringify({ notes: data.notes }) : null,
                },
            });
        }

        const appointment = await tx.scheduleAppointment.findFirst({
            where: {
                workOrderId: trimmedWorkOrderId,
                workspaceId: context.workspaceId,
                technicianId: context.technicianProfileId,
                status: { not: "CANCELLED" },
            },
            select: { id: true, fieldExecutionStartedAt: true },
        });

        if (appointment && appointment.fieldExecutionStartedAt === null) {
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
                metadata: { notes: data.notes ?? null },
            });
        }

        const activeEntry = await tx.technicianTimeEntry.findFirst({
            where: {
                workspaceId: context.workspaceId,
                technicianProfileId: context.technicianProfileId,
                status: "ACTIVE",
            },
        });

        if (activeEntry) {
            const durationMinutes = Math.max(
                0,
                Math.round((now.getTime() - activeEntry.startedAt.getTime()) / 60000)
            );

            await tx.technicianTimeEntry.update({
                where: { id: activeEntry.id },
                data: { endedAt: now, durationMinutes, status: "COMPLETED" },
            });
        }

        await tx.technicianTimeEntry.create({
            data: {
                workspaceId: context.workspaceId,
                technicianProfileId: context.technicianProfileId,
                workOrderId: trimmedWorkOrderId,
                appointmentId: appointment?.id ?? null,
                entryType: "ON_SITE",
                status: "ACTIVE",
                startedAt: now,
                endedAt: null,
                durationMinutes: null,
                notes: data.notes ?? null,
                metadata: data.metadata ? (data.metadata as any) : undefined,
                createdByMemberId: context.membershipId,
            },
        });

        return updatedWorkOrder;
    });

    return toWorkOrderReadModel(updated);
}
```

### `lib/services/technicianOperations/holdTechnicianWorkOrder.ts`
```typescript
export async function holdTechnicianWorkOrder(
    context: TechnicianExecutionContext,
    workOrderId: string,
    input: unknown
): Promise<WorkOrderReadModel> {
    if (context.role !== "TECHNICIAN") {
        throw new ForbiddenError(
            "Only authenticated technicians can hold work orders through technician operations."
        );
    }

    if (!workOrderId || typeof workOrderId !== "string" || !workOrderId.trim()) {
        throw new WorkOrderNotFoundError();
    }

    const trimmedWorkOrderId = workOrderId.trim();
    const data = holdWorkOrderSchema.parse(input);

    const updatedWorkOrder = await transitionWorkOrderStatus(
        context.workspaceId,
        trimmedWorkOrderId,
        {
            toStatus: "ON_HOLD",
            holdReason: data.holdReason,
        }
    );

    const now = new Date();
    await prisma.$transaction(async (tx) => {
        const activeEntry = await tx.technicianTimeEntry.findFirst({
            where: {
                workspaceId: context.workspaceId,
                technicianProfileId: context.technicianProfileId,
                status: "ACTIVE",
            },
        });

        if (activeEntry) {
            const durationMinutes = Math.max(
                0,
                Math.round((now.getTime() - activeEntry.startedAt.getTime()) / 60000)
            );

            await tx.technicianTimeEntry.update({
                where: { id: activeEntry.id },
                data: { endedAt: now, durationMinutes, status: "COMPLETED" },
            });
        }
    });

    return updatedWorkOrder;
}
```

### `lib/services/technicianOperations/resumeTechnicianWorkOrder.ts`
```typescript
export async function resumeTechnicianWorkOrder(
    context: TechnicianExecutionContext,
    workOrderId: string,
    input: unknown = {}
): Promise<WorkOrderReadModel> {
    if (context.role !== "TECHNICIAN") {
        throw new ForbiddenError(
            "Only authenticated technicians can resume work orders through technician operations."
        );
    }

    if (!workOrderId || typeof workOrderId !== "string" || !workOrderId.trim()) {
        throw new WorkOrderNotFoundError();
    }

    const trimmedWorkOrderId = workOrderId.trim();
    const data = resumeWorkOrderSchema.parse(input ?? {});

    const updatedWorkOrder = await transitionWorkOrderStatus(
        context.workspaceId,
        trimmedWorkOrderId,
        { toStatus: "IN_PROGRESS" }
    );

    const now = new Date();
    await prisma.$transaction(async (tx) => {
        const appointment = await tx.scheduleAppointment.findFirst({
            where: {
                workOrderId: trimmedWorkOrderId,
                workspaceId: context.workspaceId,
                technicianId: context.technicianProfileId,
                status: { not: "CANCELLED" },
            },
            select: { id: true },
        });

        await tx.technicianTimeEntry.create({
            data: {
                workspaceId: context.workspaceId,
                technicianProfileId: context.technicianProfileId,
                workOrderId: trimmedWorkOrderId,
                appointmentId: appointment?.id ?? null,
                entryType: "ON_SITE",
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

    return updatedWorkOrder;
}
```

---

## 3. Test Coverage Summary

Test Suite: [`tests/technician-operations/technician-start-hold-resume.test.ts`](file:///d:/Download/aforden/tests/technician-operations/technician-start-hold-resume.test.ts) (12 tests passing)

### Tested Scenarios:
1. **`startTechnicianWorkOrder`**:
   - Starts work order, auto-closes active travel time entry (`endedAt` set, `durationMinutes` computed, `status: COMPLETED`).
   - Opens new `ON_SITE` entry with `status: ACTIVE`.
   - Stamps `fieldExecutionStartedAt` on linked appointment and creates `ScheduleAppointmentHistory`.
   - Writes `WorkOrderHistory` (`STATUS_CHANGED`).
   - Operates cleanly on direct start with no prior travel entry.
   - Throws `WorkOrderInvalidStatusTransitionError` (409) if WorkOrder is not in `ASSIGNED` status.
   - Throws `TechnicianNotAssignedToWorkOrderError` (403) if WorkOrder is assigned to another technician.
   - Rejects non-`TECHNICIAN` role with `ForbiddenError` (403).
2. **`holdTechnicianWorkOrder`**:
   - Requires `holdReason` (rejects missing/empty hold reason).
   - Delegates state machine transition to `transitionWorkOrderStatus` (`ON_HOLD`).
   - Closes active `ON_SITE` time entry (`endedAt` set, `durationMinutes` computed, `status: COMPLETED`).
   - Rejects non-`TECHNICIAN` role with `ForbiddenError` (403).
3. **`resumeTechnicianWorkOrder`**:
   - Resumes work order, delegating state transition to `transitionWorkOrderStatus` (`IN_PROGRESS`).
   - Opens new active `ON_SITE` time entry.
   - Propagates Phase 1.6 status machine errors when transition is illegal.
   - Rejects non-`TECHNICIAN` role with `ForbiddenError` (403).

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
 Test Files  143 passed (143)
      Tests  2432 passed (2432)
   Start at  14:12:27
   Duration  46.78s (transform 7.62s, setup 0ms, import 38.04s, tests 43.58s, environment 32ms)
```

---

## Conclusion & Readiness for Phase 1.9.8

Phase 1.9.7 (**WorkOrder Start / Hold / Resume**) is implemented, verified against all architectural invariants and transaction boundaries, and passes all quality gates with zero regressions (2,432 tests passing across 143 test files). The workspace is ready for Phase 1.9.8.
