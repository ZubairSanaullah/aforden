/**
 * Phase 1.13.4 — Notification Preference Service
 * Manages multi-tiered notification preferences (Workspace, Member, Customer)
 * with strict RBAC rules and immutable protection for mandatory transactional events.
 */

import { PrismaClient, Prisma } from "@/generated/prisma/client";
import {
    NotificationPreferenceScope,
    NotificationEventType,
    NotificationChannel,
    MembershipRole,
} from "@/generated/prisma/enums";
import { updateNotificationPreferenceSchema } from "./notification.schemas";
import {
    getEventCatalogDefinition,
} from "./eventCatalogRegistry";
import {
    NotificationActorUnauthorizedError,
    NotificationPayloadValidationError,
    NotificationCrossTenantLeakageError,
} from "./notificationErrors";

export interface UpdateNotificationPreferenceInput {
    scope: NotificationPreferenceScope;
    scopeId?: string | null;
    eventType: NotificationEventType;
    channel: NotificationChannel;
    isEnabled: boolean;
}

/**
 * Resolves the effective preference for a given event, channel, and recipient.
 *
 * Precedence Order:
 * 1. If event is mandatory transactional -> ALWAYS TRUE (cannot be disabled)
 * 2. Recipient scope (MEMBER or CUSTOMER matching scopeId) -> if row exists, return row.isEnabled
 * 3. Workspace scope (scope=WORKSPACE) -> if row exists, return row.isEnabled
 * 4. Default -> TRUE (enabled)
 */
export async function getEffectivePreference(
    prisma: PrismaClient | Prisma.TransactionClient,
    workspaceId: string,
    scope: NotificationPreferenceScope,
    scopeId: string | null,
    eventType: NotificationEventType,
    channel: NotificationChannel,
): Promise<boolean> {
    const catalogDef = getEventCatalogDefinition(eventType);

    // 1. Mandatory transactional events cannot be suppressed
    if (catalogDef.isMandatoryTransactional) {
        return true;
    }

    // 2. Check Recipient Scope if applicable
    if (scope !== NotificationPreferenceScope.WORKSPACE && scopeId) {
        const recipientPref = await prisma.notificationPreference.findFirst({
            where: {
                workspaceId,
                scope,
                scopeId,
                eventType,
                channel,
            },
        });

        if (recipientPref != null) {
            return recipientPref.isEnabled;
        }
    }

    // 3. Fall back to Workspace Scope preference
    const workspacePref = await prisma.notificationPreference.findFirst({
        where: {
            workspaceId,
            scope: NotificationPreferenceScope.WORKSPACE,
            scopeId: null,
            eventType,
            channel,
        },
    });

    if (workspacePref != null) {
        return workspacePref.isEnabled;
    }

    // 4. Default to enabled
    return true;
}

/**
 * Upserts a notification preference record with RBAC and compliance validation.
 */
export async function upsertNotificationPreference(
    prisma: PrismaClient | Prisma.TransactionClient,
    workspaceId: string,
    input: UpdateNotificationPreferenceInput,
    actorMemberId: string,
) {
    if (!workspaceId) {
        throw new NotificationCrossTenantLeakageError(
            "workspaceId is required for preference management.",
        );
    }

    // 1. Validate input schema
    const parsed = updateNotificationPreferenceSchema.parse(input);

    // 2. Enforce Mandatory Transactional Invariant:
    // Reject disabling notifications for mandatory legal/billing events
    const catalogDef = getEventCatalogDefinition(parsed.eventType);
    if (catalogDef.isMandatoryTransactional && !parsed.isEnabled) {
        throw new NotificationPayloadValidationError(
            `Cannot disable notifications for mandatory transactional event: ${parsed.eventType}. Legally binding and billing notifications cannot be opted out.`,
        );
    }

    // 3. Resolve actor and enforce RBAC
    const actor = await prisma.workspaceMember.findFirst({
        where: {
            id: actorMemberId,
            workspaceId,
            status: "ACTIVE",
        },
    });

    if (!actor) {
        throw new NotificationActorUnauthorizedError(
            "Actor is not an active member of this workspace.",
        );
    }

    const isAdminOrOwner =
        actor.role === MembershipRole.OWNER ||
        actor.role === MembershipRole.ADMIN;

    if (parsed.scope === NotificationPreferenceScope.WORKSPACE) {
        if (!isAdminOrOwner) {
            throw new NotificationActorUnauthorizedError(
                "Only workspace OWNER or ADMIN can configure workspace-level notification preferences.",
            );
        }
    } else if (parsed.scope === NotificationPreferenceScope.MEMBER) {
        const targetMemberId = parsed.scopeId || actorMemberId;
        if (targetMemberId !== actorMemberId && !isAdminOrOwner) {
            throw new NotificationActorUnauthorizedError(
                "Workspace members can only configure their own notification preferences unless they are ADMIN or OWNER.",
            );
        }
    } else if (parsed.scope === NotificationPreferenceScope.CUSTOMER) {
        const canManageCustomer =
            isAdminOrOwner ||
            actor.role === MembershipRole.MANAGER ||
            actor.role === MembershipRole.DISPATCHER;
        if (!canManageCustomer) {
            throw new NotificationActorUnauthorizedError(
                "Technicians cannot configure customer notification preferences.",
            );
        }
    }

    const normalizedScopeId = parsed.scopeId || null;

    // 4. Find existing preference row or create new
    const existing = await prisma.notificationPreference.findFirst({
        where: {
            workspaceId,
            scope: parsed.scope,
            scopeId: normalizedScopeId,
            eventType: parsed.eventType,
            channel: parsed.channel,
        },
    });

    if (existing) {
        return await prisma.notificationPreference.update({
            where: { id: existing.id },
            data: { isEnabled: parsed.isEnabled },
        });
    }

    return await prisma.notificationPreference.create({
        data: {
            workspaceId,
            scope: parsed.scope,
            scopeId: normalizedScopeId,
            eventType: parsed.eventType,
            channel: parsed.channel,
            isEnabled: parsed.isEnabled,
        },
    });
}

/**
 * Lists notification preferences filtered by workspace and optional scope.
 */
export async function listNotificationPreferences(
    prisma: PrismaClient | Prisma.TransactionClient,
    workspaceId: string,
    scope?: NotificationPreferenceScope,
    scopeId?: string | null,
) {
    if (!workspaceId) {
        throw new NotificationCrossTenantLeakageError(
            "workspaceId is required to list preferences.",
        );
    }

    return await prisma.notificationPreference.findMany({
        where: {
            workspaceId,
            ...(scope ? { scope } : {}),
            ...(scopeId !== undefined ? { scopeId } : {}),
        },
        orderBy: [{ eventType: "asc" }, { channel: "asc" }],
    });
}
