import { prisma } from "@/lib/prisma";
import { Prisma, type PlatformAuditLog } from "@/generated/prisma/client";
import {
    PlatformAuthorizationContext,
    PlatformRole,
    PLATFORM_PERMISSIONS,
    assertPlatformPermission,
} from "../authorization";
import {
    PlatformAuditEventType,
    PlatformAuditTargetType,
} from "./platformAuditEvents";

export interface RecordPlatformAuditInput {
    actor:
        | PlatformAuthorizationContext
        | {
              userId: string;
              email: string;
              platformRole: PlatformRole;
          };
    action: PlatformAuditEventType | string;
    targetType: PlatformAuditTargetType | string;
    targetId: string;
    workspaceId?: string | null;
    requestId: string;
    ipAddress: string;
    userAgent?: string | null;
    reason?: string | null;
    /**
     * Field-level before-mutation state snapshot.
     * DISCIPLINE: Capture only affected attributes (e.g. { status: "ACTIVE" }), NEVER full row dumps.
     */
    previousState?: Record<string, unknown> | null;
    /**
     * Field-level after-mutation state snapshot.
     * DISCIPLINE: Capture only affected attributes (e.g. { status: "SUSPENDED" }), NEVER full row dumps.
     */
    newState?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
    tx?: Prisma.TransactionClient;
}

export interface QueryPlatformAuditFilters {
    workspaceId?: string;
    actorUserId?: string;
    action?: PlatformAuditEventType | string;
    targetType?: string;
    targetId?: string;
    startDate?: Date;
    endDate?: Date;
    limit?: number;
    offset?: number;
}

/**
 * Compliance-Grade Platform Audit Ledger Writer (Phase 1.19.1 Section 4 & Section 10 Step 6).
 * 
 * Synchronous / Awaited Decision (Invariant #3):
 * Writes to PlatformAuditLog are strictly synchronous and awaited. Unlike best-effort telemetry
 * (e.g. lastActiveAt / lastUsedAt), platform administrative mutations are legally binding security
 * actions. The write must be durably committed to the database before the caller's request completes.
 */
export async function recordPlatformAuditEvent(
    input: RecordPlatformAuditInput
): Promise<PlatformAuditLog> {
    const db = input.tx || prisma;

    const actorUserId =
        "userId" in input.actor ? input.actor.userId : (input.actor as any).id;
    const actorEmail = input.actor.email;
    const actorRole = input.actor.platformRole;

    const auditEntry = await db.platformAuditLog.create({
        data: {
            actorUserId,
            actorEmail,
            actorRole,
            action: input.action,
            targetType: input.targetType,
            targetId: input.targetId,
            workspaceId: input.workspaceId || null,
            requestId: input.requestId,
            ipAddress: input.ipAddress,
            userAgent: input.userAgent || null,
            reason: input.reason || null,
            previousState: (input.previousState as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            newState: (input.newState as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            metadata: (input.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        },
    });

    return auditEntry;
}

/**
 * Service-layer query engine for Platform Audit Logs.
 * Strictly requires the platform.audit.view permission (Phase 1.19.1 Section 2.2).
 */
export async function queryPlatformAuditLog(
    context: PlatformAuthorizationContext,
    filters?: QueryPlatformAuditFilters
): Promise<{
    records: PlatformAuditLog[];
    total: number;
}> {
    // Permission Gate: requires platform.audit.view
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.AUDIT_VIEW);

    const where: Prisma.PlatformAuditLogWhereInput = {};

    if (filters?.workspaceId) {
        where.workspaceId = filters.workspaceId;
    }
    if (filters?.actorUserId) {
        where.actorUserId = filters.actorUserId;
    }
    if (filters?.action) {
        where.action = filters.action;
    }
    if (filters?.targetType) {
        where.targetType = filters.targetType;
    }
    if (filters?.targetId) {
        where.targetId = filters.targetId;
    }
    if (filters?.startDate || filters?.endDate) {
        where.createdAt = {};
        if (filters.startDate) {
            where.createdAt.gte = filters.startDate;
        }
        if (filters.endDate) {
            where.createdAt.lte = filters.endDate;
        }
    }

    const limit = Math.min(Math.max(filters?.limit ?? 50, 1), 200);
    const offset = Math.max(filters?.offset ?? 0, 0);

    const [records, total] = await Promise.all([
        prisma.platformAuditLog.findMany({
            where,
            orderBy: { createdAt: "desc" },
            take: limit,
            skip: offset,
        }),
        prisma.platformAuditLog.count({ where }),
    ]);

    return { records, total };
}
