import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { WorkOrderNotFoundError } from "@/lib/services/workOrder/workOrderErrors";
import {
    ActiveTimeEntryExistsError,
    TimeEntryNotFoundError,
} from "./technicianOperationsErrors";
import {
    adminUpdateTechnicianTimeEntrySchema,
    toTechnicianTimeEntryReadModel,
    type TechnicianTimeEntryReadModel,
} from "./technicianOperations.types";

const RESERVED_METADATA_KEYS = [
    "adminAuditHistory",
    "lastEditedAt",
    "lastEditedByMemberId",
    "lastEditedByName",
    "lastEditedByRole",
    "lastEditReason",
] as const;

/**
 * Administratively updates a historical or active technician time entry.
 *
 * Operational & Invariant Rules:
 * - Section 2.2 (Invariant 2): Administrative operations authenticate via standard workspace authorization
 *   (`requireWorkspaceAuthorization`) and are not bound to `TechnicianExecutionContext`.
 * - Section 11.1 (RBAC): Strictly permits `OWNER`, `ADMIN`, and `MANAGER` roles.
 *   `DISPATCHER`, `TECHNICIAN`, and `ACCOUNTANT` roles throw `ForbiddenError` (403).
 * - Section 7.1: Scope exclusions: strictly operational duration, NO payroll/billing fields.
 * - Section 7.3 (Single Active Entry Rule): If an administrative mutation sets an entry to `ACTIVE` (e.g. `endedAt: null`),
 *   verifies that no other `ACTIVE` time entry exists for the same technician in the workspace, throwing
 *   `ActiveTimeEntryExistsError` (409) if a conflict exists.
 * - Section 7.3 (Duration Synchronization): When `startedAt` or `endedAt` is modified on a completed entry,
 *   recomputes `durationMinutes` accurately unless the caller explicitly supplies a `durationMinutes` override.
 * - Section 2.4 (Invariant 4 - Tamper-Proof Audit Trail): Writes comprehensive structured audit log entries into
 *   `TechnicianTimeEntry.metadata.adminAuditHistory`, recording actor identity (`editedByMemberId`, `editedByName`, `editedByRole`),
 *   timestamp (`editedAt`), optional `editReason`, and exact before/after field changes. Reserved audit keys supplied
 *   in client request metadata are stripped server-side to prevent audit trail clobbering.
 * - Section 14: Mutation executes in an atomic `prisma.$transaction`.
 */
export async function updateTechnicianTimeEntryAdmin(
    workspaceId: string,
    workOrderId: string,
    timeEntryId: string,
    input: unknown = {}
): Promise<TechnicianTimeEntryReadModel> {
    if (!workspaceId || typeof workspaceId !== "string" || !workspaceId.trim()) {
        throw new WorkOrderNotFoundError();
    }

    // 1. Authenticate session & verify active membership in workspace
    const authorization = await requireWorkspaceAuthorization(workspaceId.trim());

    // 2. Role Enforcement (RBAC Matrix §11.1: OWNER, ADMIN, MANAGER)
    if (
        authorization.membership.role !== "OWNER" &&
        authorization.membership.role !== "ADMIN" &&
        authorization.membership.role !== "MANAGER"
    ) {
        throw new ForbiddenError(
            "Only OWNER, ADMIN, and MANAGER roles are authorized to administratively update time entries."
        );
    }

    if (!workOrderId || typeof workOrderId !== "string" || !workOrderId.trim()) {
        throw new WorkOrderNotFoundError();
    }

    if (!timeEntryId || typeof timeEntryId !== "string" || !timeEntryId.trim()) {
        throw new TimeEntryNotFoundError();
    }

    const trimmedWorkOrderId = workOrderId.trim();
    const trimmedTimeEntryId = timeEntryId.trim();

    // 3. Validate Input Payload
    const data = adminUpdateTechnicianTimeEntrySchema.parse(input ?? {});

    // 4. Resolve WorkOrder in Workspace
    const workOrder = await prisma.workOrder.findFirst({
        where: {
            id: trimmedWorkOrderId,
            workspaceId: authorization.workspace.id,
        },
        select: { id: true },
    });

    if (!workOrder) {
        throw new WorkOrderNotFoundError();
    }

    // 5. Resolve Target Time Entry
    const timeEntry = await prisma.technicianTimeEntry.findFirst({
        where: {
            id: trimmedTimeEntryId,
            workspaceId: authorization.workspace.id,
            workOrderId: trimmedWorkOrderId,
        },
    });

    if (!timeEntry) {
        throw new TimeEntryNotFoundError();
    }

    // 6. Compute Effective Timestamps & Status
    const effectiveStartedAt = data.startedAt !== undefined
        ? new Date(data.startedAt)
        : timeEntry.startedAt;

    let effectiveEndedAt: Date | null;
    if (data.endedAt !== undefined) {
        effectiveEndedAt = data.endedAt === null ? null : new Date(data.endedAt);
    } else {
        effectiveEndedAt = timeEntry.endedAt;
    }

    const targetStatus = effectiveEndedAt === null ? "ACTIVE" : "COMPLETED";

    // 7. Single Active Entry Rule Enforcement (§7.3)
    if (targetStatus === "ACTIVE") {
        const conflictingActiveEntry = await prisma.technicianTimeEntry.findFirst({
            where: {
                workspaceId: authorization.workspace.id,
                technicianProfileId: timeEntry.technicianProfileId,
                status: "ACTIVE",
                id: { not: timeEntry.id },
            },
            select: { id: true },
        });

        if (conflictingActiveEntry) {
            throw new ActiveTimeEntryExistsError(
                "Cannot set time entry to ACTIVE: an active time entry is already in progress for this technician."
            );
        }
    }

    // 8. Compute Duration Minutes
    let effectiveDurationMinutes: number | null = null;
    if (targetStatus === "COMPLETED" && effectiveEndedAt !== null) {
        if (data.durationMinutes !== undefined && data.durationMinutes !== null) {
            // Explicit caller override wins
            effectiveDurationMinutes = data.durationMinutes;
        } else if (
            data.startedAt !== undefined ||
            data.endedAt !== undefined ||
            timeEntry.durationMinutes === null
        ) {
            // Recompute from timestamps when startedAt/endedAt modified or if previously uncalculated
            effectiveDurationMinutes = Math.max(
                0,
                Math.round((effectiveEndedAt.getTime() - effectiveStartedAt.getTime()) / 60000)
            );
        } else {
            // Preserve existing duration
            effectiveDurationMinutes = timeEntry.durationMinutes;
        }
    }

    // 9. Build Audit Trail & Detect Field Changes (Invariant 4 §2.4)
    const changes: Record<string, { oldValue: any; newValue: any }> = {};

    if (data.startedAt !== undefined && effectiveStartedAt.getTime() !== timeEntry.startedAt.getTime()) {
        changes.startedAt = {
            oldValue: timeEntry.startedAt.toISOString(),
            newValue: effectiveStartedAt.toISOString(),
        };
    }

    const oldEndedIso = timeEntry.endedAt ? timeEntry.endedAt.toISOString() : null;
    const newEndedIso = effectiveEndedAt ? effectiveEndedAt.toISOString() : null;
    if (data.endedAt !== undefined && oldEndedIso !== newEndedIso) {
        changes.endedAt = {
            oldValue: oldEndedIso,
            newValue: newEndedIso,
        };
    }

    if (effectiveDurationMinutes !== timeEntry.durationMinutes) {
        changes.durationMinutes = {
            oldValue: timeEntry.durationMinutes,
            newValue: effectiveDurationMinutes,
        };
    }

    if (targetStatus !== timeEntry.status) {
        changes.status = {
            oldValue: timeEntry.status,
            newValue: targetStatus,
        };
    }

    if (data.notes !== undefined && data.notes !== timeEntry.notes) {
        changes.notes = {
            oldValue: timeEntry.notes,
            newValue: data.notes,
        };
    }

    // Server-side Protection of Reserved Audit Keys (Invariant 4 §2.4):
    // Strip any client-supplied reserved keys from data.metadata to prevent audit ledger tampering.
    const sanitizedIncomingMetadata: Record<string, any> = {};
    if (typeof data.metadata === "object" && data.metadata !== null) {
        for (const [key, value] of Object.entries(data.metadata)) {
            if (!RESERVED_METADATA_KEYS.includes(key as any)) {
                sanitizedIncomingMetadata[key] = value;
            }
        }
    }

    // Preserve existing real audit history from database
    const existingRawMetadata = (timeEntry.metadata as Record<string, any> | null) ?? {};
    const existingAuditHistory = Array.isArray(existingRawMetadata.adminAuditHistory)
        ? existingRawMetadata.adminAuditHistory
        : [];

    // Merge existing user metadata (excluding reserved keys) with sanitized incoming metadata
    const mergedUserMetadata: Record<string, any> = { ...existingRawMetadata };
    for (const key of RESERVED_METADATA_KEYS) {
        delete mergedUserMetadata[key];
    }
    Object.assign(mergedUserMetadata, sanitizedIncomingMetadata);

    const nowIso = new Date().toISOString();
    const auditRecord = {
        editedAt: nowIso,
        editedByMemberId: authorization.membership.id,
        editedByName: authorization.user.name || authorization.user.email || "Administrator",
        editedByRole: authorization.membership.role,
        editReason: data.editReason ?? null,
        changes,
    };

    const finalMetadata = {
        ...mergedUserMetadata,
        adminAuditHistory: [...existingAuditHistory, auditRecord],
        lastEditedAt: nowIso,
        lastEditedByMemberId: auditRecord.editedByMemberId,
        lastEditedByName: auditRecord.editedByName,
        lastEditedByRole: auditRecord.editedByRole,
        lastEditReason: auditRecord.editReason,
    };

    // 10. Prepare Mutation Payload
    const updateData: {
        startedAt: Date;
        endedAt: Date | null;
        durationMinutes: number | null;
        status: "ACTIVE" | "COMPLETED";
        notes?: string | null;
        metadata: any;
    } = {
        startedAt: effectiveStartedAt,
        endedAt: effectiveEndedAt,
        durationMinutes: effectiveDurationMinutes,
        status: targetStatus,
        metadata: finalMetadata,
    };

    if (data.notes !== undefined) {
        updateData.notes = data.notes;
    }

    // 11. Atomic Persistence in Database Transaction (§14)
    const updated = await prisma.$transaction(async (tx) => {
        return tx.technicianTimeEntry.update({
            where: { id: timeEntry.id },
            data: updateData,
        });
    });

    return toTechnicianTimeEntryReadModel(updated);
}
