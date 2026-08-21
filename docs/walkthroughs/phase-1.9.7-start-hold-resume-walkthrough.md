# Phase 1.9.7 — WorkOrder Start / Hold / Resume Walkthrough

## Overview

This walkthrough documents the corrected implementation and verification of **Phase 1.9.7: WorkOrder Start / Hold / Resume** in strict accordance with **Section 2.1 (Invariant 1: Single Authority Status Machine)**, **Section 2.4 (Invariant 4: Atomic Transactions & Immutable Audit History)**, **Section 4.1 (Operational Invariants)**, **Section 5.1 (Operational Action Mapping)**, **Section 7.3 (Concurrency & Active Entry Rules)**, and **Section 14 (Transaction Boundaries)** of the locked architecture standard in [`docs/architecture/phase-1.9.1-technician-operations-architecture.md`](file:///d:/Download/aforden/docs/architecture/phase-1.9.1-technician-operations-architecture.md).

---

## 1. Architectural Invariant Implementation & Resolution of Review Items

### A. Canonical Single Authority Status Machine (Section 2.1 Invariant 1)
- **`startTechnicianWorkOrder` Delegation**: `startTechnicianWorkOrder` delegates lifecycle mutation directly to the authoritative Phase 1.6 status machine: `transitionWorkOrderStatus(context.workspaceId, trimmedWorkOrderId, { toStatus: "IN_PROGRESS" }, tx)`. Raw `tx.workOrder.update` and manual `WorkOrderHistory` creation in `startTechnicianWorkOrder` have been completely removed.
- **Unconditional Audit History (Section 2.4 Invariant 4)**: Defensive optional-chaining (`if (tx.workOrderHistory?.create)`) has been eliminated. History writing is the unconditional responsibility of the authoritative `transitionWorkOrderStatus()` service, ensuring mutations never persist if audit history recording fails.
- **Role Permission Matrix Alignment (Section 11.1)**: `transitionWorkOrderStatus` permits assigned technicians to perform `ASSIGNED -> IN_PROGRESS` (in addition to `IN_PROGRESS -> ON_HOLD`, `ON_HOLD -> IN_PROGRESS`, and `IN_PROGRESS -> COMPLETED`), unifying all field execution transitions under one status machine.

### B. Unified Transaction Atomicity (Option A: Section 14 Boundary)
- `transitionWorkOrderStatus` has been extended to accept an optional transaction client (`txClient?: Prisma.TransactionClient | any`).
- `startTechnicianWorkOrder`, `holdTechnicianWorkOrder`, and `resumeTechnicianWorkOrder` all execute within a single atomic `prisma.$transaction(async (tx) => { ... })`:
  - **Start**: (1) State transition to `IN_PROGRESS` + `WorkOrderHistory` via `transitionWorkOrderStatus(..., tx)`, (2) execution lock stamping on `ScheduleAppointment.fieldExecutionStartedAt` + `ScheduleAppointmentHistory`, (3) auto-closure of active `TRAVEL` entry, and (4) opening new active `ON_SITE` entry.
  - **Hold**: (1) State transition to `ON_HOLD` with `holdReason` + `WorkOrderHistory` via `transitionWorkOrderStatus(..., tx)`, and (2) closure of active `ON_SITE` entry.
  - **Resume**: (1) State transition to `IN_PROGRESS` + `WorkOrderHistory` via `transitionWorkOrderStatus(..., tx)`, and (2) opening new active `ON_SITE` entry.
- If any downstream side effect fails, the entire transaction rolls back atomically, preventing partial status updates or orphaned time entries.

---

## 2. Service Implementations

### `lib/services/technicianOperations/startTechnicianWorkOrder.ts`
```typescript
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { WorkOrderNotFoundError } from "@/lib/services/workOrder/workOrderErrors";
import { transitionWorkOrderStatus } from "@/lib/services/workOrder/transitionWorkOrderStatus";
import { recordScheduleHistory } from "@/lib/services/schedule/recordScheduleHistory";
import {
    startWorkOrderSchema,
    type TechnicianExecutionContext,
} from "./technicianOperations.types";
import type { WorkOrderReadModel } from "@/lib/services/workOrder/workOrder.types";

/**
 * Commences on-site execution for an assigned WorkOrder by the authenticated technician.
 *
 * Operational & Invariant Rules:
 * - Section 2.1 (Invariant 1: Single Authority Status Machine): Delegates lifecycle transition directly
 *   to Phase 1.6 `transitionWorkOrderStatus(workspaceId, workOrderId, { toStatus: "IN_PROGRESS" }, tx)`.
 *   This enforces role authorization, matrix legality, sets `startedAt`, and writes `WorkOrderHistory`.
 * - Section 4.1.2 & Section 6.1 (Touchpoint 2): Stamping `ScheduleAppointment.fieldExecutionStartedAt = now()`
 *   locks the appointment against subsequent Phase 1.8 `undispatchAppointment` recalls (travel-skipped case).
 * - Section 4.1.4 (Automatic Travel Closure) & Section 7.3: Automatically closes any open `ACTIVE` time entry
 *   for this technician (`endedAt = now()`, computing `durationMinutes`) before opening a new `ON_SITE` entry.
 * - Section 14: All mutations execute in a single, unified atomic `prisma.$transaction`.
 */
export async function startTechnicianWorkOrder(
    context: TechnicianExecutionContext,
    workOrderId: string,
    input: unknown = {}
): Promise<WorkOrderReadModel> {
    // 1. Role Enforcement (Invariant 2)
    if (context.role !== "TECHNICIAN") {
        throw new ForbiddenError(
            "Only authenticated technicians can start work orders through technician operations."
        );
    }

    if (!workOrderId || typeof workOrderId !== "string" || !workOrderId.trim()) {
        throw new WorkOrderNotFoundError();
    }

    const trimmedWorkOrderId = workOrderId.trim();

    // 2. Validate Input Payload
    const data = startWorkOrderSchema.parse(input ?? {});

    // 3. Persistence of WorkOrder State Transition, Execution Lock & Time Entries in Atomic Transaction (§14)
    const now = new Date();
    return await prisma.$transaction(async (tx) => {
        // 3a. Delegate lifecycle transition to canonical Phase 1.6 status machine (Invariant 1)
        const updatedWorkOrder = await transitionWorkOrderStatus(
            context.workspaceId,
            trimmedWorkOrderId,
            { toStatus: "IN_PROGRESS" },
            tx
        );

        // 3b. Resolve linked appointment for execution lock stamping (§4.1.2)
        const appointment = await tx.scheduleAppointment.findFirst({
            where: {
                workOrderId: trimmedWorkOrderId,
                workspaceId: context.workspaceId,
                technicianId: context.technicianProfileId,
                status: { not: "CANCELLED" },
            },
            select: {
                id: true,
                fieldExecutionStartedAt: true,
            },
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
                metadata: {
                    notes: data.notes ?? null,
                },
            });
        }

        // 3c. Automatic Travel/Active Entry Closure (§4.1.4, §7.3)
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
                data: {
                    endedAt: now,
                    durationMinutes,
                    status: "COMPLETED",
                },
            });
        }

        // 3d. Open new ACTIVE ON_SITE time entry
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
}
```

### `lib/services/technicianOperations/holdTechnicianWorkOrder.ts`
```typescript
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { WorkOrderNotFoundError } from "@/lib/services/workOrder/workOrderErrors";
import { transitionWorkOrderStatus } from "@/lib/services/workOrder/transitionWorkOrderStatus";
import {
    holdWorkOrderSchema,
    type TechnicianExecutionContext,
} from "./technicianOperations.types";
import type { WorkOrderReadModel } from "@/lib/services/workOrder/workOrder.types";

/**
 * Places an in-progress WorkOrder on hold by the authenticated technician.
 */
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

    const now = new Date();
    return await prisma.$transaction(async (tx) => {
        const updatedWorkOrder = await transitionWorkOrderStatus(
            context.workspaceId,
            trimmedWorkOrderId,
            {
                toStatus: "ON_HOLD",
                holdReason: data.holdReason,
            },
            tx
        );

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
                data: {
                    endedAt: now,
                    durationMinutes,
                    status: "COMPLETED",
                },
            });
        }

        return updatedWorkOrder;
    });
}
```

### `lib/services/technicianOperations/resumeTechnicianWorkOrder.ts`
```typescript
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { WorkOrderNotFoundError } from "@/lib/services/workOrder/workOrderErrors";
import { transitionWorkOrderStatus } from "@/lib/services/workOrder/transitionWorkOrderStatus";
import {
    resumeWorkOrderSchema,
    type TechnicianExecutionContext,
} from "./technicianOperations.types";
import type { WorkOrderReadModel } from "@/lib/services/workOrder/workOrder.types";

/**
 * Resumes an on-hold WorkOrder back to in-progress execution by the authenticated technician.
 */
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

    const now = new Date();
    return await prisma.$transaction(async (tx) => {
        const updatedWorkOrder = await transitionWorkOrderStatus(
            context.workspaceId,
            trimmedWorkOrderId,
            { toStatus: "IN_PROGRESS" },
            tx
        );

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

        return updatedWorkOrder;
    });
}
```

---

## 3. Test Coverage Summary

Test Suite: [`tests/technician-operations/technician-start-hold-resume.test.ts`](file:///d:/Download/aforden/tests/technician-operations/technician-start-hold-resume.test.ts) (14 tests passing)

### Tested Scenarios:
1. **`startTechnicianWorkOrder`**:
   - Explicit mock call verification: `expect(mocks.transitionWorkOrderStatus).toHaveBeenCalledWith(WS_ID, WO_ID, { toStatus: "IN_PROGRESS" }, expect.anything())`.
   - Auto-closes active travel time entry (`endedAt` set, `durationMinutes` computed, `status: COMPLETED`).
   - Opens new `ON_SITE` entry with `status: ACTIVE`.
   - Stamps `fieldExecutionStartedAt` on linked appointment and creates `ScheduleAppointmentHistory`.
   - Operates cleanly on direct start with no prior travel entry.
   - Propagates `WorkOrderInvalidStatusTransitionError` (409) when `transitionWorkOrderStatus` rejects.
   - Propagates `ForbiddenError` (403) when technician is not assigned.
   - Rejects non-`TECHNICIAN` role with `ForbiddenError` (403) without invoking `transitionWorkOrderStatus`.
   - Rejects empty `workOrderId` with `WorkOrderNotFoundError` (404).
2. **`holdTechnicianWorkOrder`**:
   - Explicit mock call verification: `expect(mocks.transitionWorkOrderStatus).toHaveBeenCalledWith(WS_ID, WO_ID, { toStatus: "ON_HOLD", holdReason: "..." }, expect.anything())`.
   - Closes active `ON_SITE` time entry (`endedAt` set, `durationMinutes` computed, `status: COMPLETED`).
   - Requires `holdReason` (rejects missing/empty hold reason via `ZodError`).
   - Rejects non-`TECHNICIAN` role with `ForbiddenError` (403).
   - Rejects empty `workOrderId` with `WorkOrderNotFoundError` (404).
3. **`resumeTechnicianWorkOrder`**:
   - Explicit mock call verification: `expect(mocks.transitionWorkOrderStatus).toHaveBeenCalledWith(WS_ID, WO_ID, { toStatus: "IN_PROGRESS" }, expect.anything())`.
   - Opens new active `ON_SITE` time entry.
   - Propagates Phase 1.6 status machine errors when transition is illegal.
   - Rejects non-`TECHNICIAN` role with `ForbiddenError` (403).
   - Rejects empty `workOrderId` with `WorkOrderNotFoundError` (404).

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

### C. Full Workspace Test Suite (`npx vitest run`)

```text
 Test Files  143 passed (143)
      Tests  2434 passed (2434)
   Start at  14:41:09
   Duration  50.82s (transform 9.11s, setup 0ms, import 42.65s, tests 44.28s, environment 49ms)
```

---

## Conclusion & Readiness for Phase 1.9.8

Phase 1.9.7 (**WorkOrder Start / Hold / Resume**) has been updated to strictly delegate to the canonical `transitionWorkOrderStatus` status machine inside unified atomic transactions with unconditional audit history writing. All quality gates pass with zero regressions (2,434 tests passing across 143 test files). The workspace is ready for Phase 1.9.8.
