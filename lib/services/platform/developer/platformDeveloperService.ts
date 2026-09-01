import { prisma } from "@/lib/prisma";
import {
    assertPlatformPermission,
    PLATFORM_PERMISSIONS,
    PlatformAuthorizationContext,
} from "@/lib/services/platform/authorization";
import {
    recordPlatformAuditEvent,
    PLATFORM_AUDIT_EVENTS,
} from "@/lib/services/platform/audit";
import {
    validateDangerousActionReason,
    assertTier2StepUpAuthenticated,
} from "@/lib/services/platform/workspaces/platformWorkspaceService";
import {
    getRateLimitStore,
    resolveWorkspaceTierLimit,
} from "@/lib/publicApi/rateLimit/rateLimitService";
import {
    PlatformDeveloperApplicationDto,
    PlatformDeveloperApplicationDetailDto,
    PlatformApiKeyDto,
    PlatformWebhookEndpointDto,
    PlatformRateLimitStatusDto,
    PlatformDeveloperApplicationFilter,
    PlatformApiKeyFilter,
    PlatformWebhookFilter,
    PlatformDeveloperActionOptions,
    DeveloperApplicationStatus,
    WebhookEndpointStatus,
} from "./types";
import {
    PlatformDeveloperApplicationNotFoundError,
    PlatformApiKeyNotFoundError,
    PlatformWebhookEndpointNotFoundError,
    PlatformDeveloperValidationError,
    PlatformDeveloperConflictError,
} from "./errors";

function maskWebhookSecret(secret: string): string {
    if (!secret || secret.length < 12) {
        return "whsec_****";
    }
    return `${secret.substring(0, 8)}...${secret.substring(secret.length - 4)}`;
}

/**
 * Validates a Tier-1 operational action reason string.
 */
function validateTier1Reason(reason: unknown): string {
    if (typeof reason !== "string" || reason.trim().length === 0) {
        throw new PlatformDeveloperValidationError(
            "An operational justification reason string is mandatory."
        );
    }
    return reason.trim();
}

/**
 * Lists developer applications across tenants with optional filtering.
 * Gated by: platform.developer.view_apps
 */
export async function listPlatformDeveloperApplications(
    context: PlatformAuthorizationContext,
    filter?: PlatformDeveloperApplicationFilter
): Promise<PlatformDeveloperApplicationDto[]> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.DEVELOPER_VIEW_APPS);

    const whereClause: Record<string, unknown> = {};

    if (filter?.workspaceId) {
        whereClause.workspaceId = filter.workspaceId;
    }

    if (filter?.status) {
        whereClause.status = filter.status;
    }

    if (filter?.search) {
        whereClause.OR = [
            { name: { contains: filter.search, mode: "insensitive" } },
            { description: { contains: filter.search, mode: "insensitive" } },
        ];
    }

    const apps = await prisma.developerApplication.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        take: filter?.limit ?? 100,
        skip: filter?.offset ?? 0,
        include: {
            _count: {
                select: {
                    apiKeys: true,
                    webhookEndpoints: true,
                },
            },
        },
    });

    return apps.map((app) => ({
        id: app.id,
        workspaceId: app.workspaceId,
        name: app.name,
        description: app.description,
        status: app.status,
        createdByUserId: app.createdByUserId,
        createdAt: app.createdAt.toISOString(),
        updatedAt: app.updatedAt.toISOString(),
        apiKeyCount: app._count.apiKeys,
        webhookCount: app._count.webhookEndpoints,
    }));
}

/**
 * Fetches detailed developer application metadata including its keys and webhooks.
 * Gated by: platform.developer.view_apps
 */
export async function getPlatformDeveloperApplication(
    context: PlatformAuthorizationContext,
    id: string
): Promise<PlatformDeveloperApplicationDetailDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.DEVELOPER_VIEW_APPS);

    const app = await prisma.developerApplication.findUnique({
        where: { id },
        include: {
            workspace: {
                select: {
                    name: true,
                    slug: true,
                },
            },
            createdByUser: {
                select: {
                    email: true,
                },
            },
            apiKeys: {
                orderBy: { createdAt: "desc" },
            },
            webhookEndpoints: {
                orderBy: { createdAt: "desc" },
            },
        },
    });

    if (!app) {
        throw new PlatformDeveloperApplicationNotFoundError(id);
    }

    return {
        id: app.id,
        workspaceId: app.workspaceId,
        workspaceName: app.workspace?.name,
        workspaceSlug: app.workspace?.slug,
        name: app.name,
        description: app.description,
        status: app.status,
        createdByUserId: app.createdByUserId,
        createdByUserEmail: app.createdByUser?.email,
        createdAt: app.createdAt.toISOString(),
        updatedAt: app.updatedAt.toISOString(),
        apiKeys: app.apiKeys.map((key) => ({
            id: key.id,
            developerApplicationId: key.developerApplicationId,
            workspaceId: app.workspaceId,
            keyPrefix: key.keyPrefix,
            environment: key.environment,
            status: key.status,
            scopes: key.scopes,
            expiresAt: key.expiresAt ? key.expiresAt.toISOString() : null,
            revokedAt: key.revokedAt ? key.revokedAt.toISOString() : null,
            lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
            createdAt: key.createdAt.toISOString(),
            updatedAt: key.updatedAt.toISOString(),
        })),
        webhookEndpoints: app.webhookEndpoints.map((ep) => ({
            id: ep.id,
            workspaceId: ep.workspaceId,
            developerApplicationId: ep.developerApplicationId,
            url: ep.url,
            description: ep.description,
            status: ep.status,
            events: ep.events,
            secretMasked: maskWebhookSecret(ep.secret),
            createdAt: ep.createdAt.toISOString(),
            updatedAt: ep.updatedAt.toISOString(),
        })),
    };
}

/**
 * Updates a developer application's status (SUSPENDED, REVOKED, ACTIVE).
 * Tier-2 Dangerous Action: requires min 10 char reason, step-up check, atomic audit log.
 * Gated by: platform.developer.revoke_keys
 */
export async function updatePlatformDeveloperApplicationStatus(
    context: PlatformAuthorizationContext,
    id: string,
    status: DeveloperApplicationStatus,
    reason: string,
    options?: PlatformDeveloperActionOptions
): Promise<PlatformDeveloperApplicationDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.DEVELOPER_REVOKE_KEYS);
    const validatedReason = validateDangerousActionReason(reason);
    assertTier2StepUpAuthenticated(context);

    return prisma.$transaction(async (tx) => {
        const app = await tx.developerApplication.findUnique({
            where: { id },
        });

        if (!app) {
            throw new PlatformDeveloperApplicationNotFoundError(id);
        }

        if (app.status === status) {
            throw new PlatformDeveloperConflictError(
                `Developer Application '${id}' is already in '${status}' status.`
            );
        }

        const updated = await tx.developerApplication.update({
            where: { id },
            data: { status },
        });

        await recordPlatformAuditEvent({
            actor: context,
            action: PLATFORM_AUDIT_EVENTS.DEVELOPER_APP_STATUS_UPDATED,
            targetType: "DEVELOPER_APP",
            targetId: id,
            workspaceId: app.workspaceId,
            requestId: options?.requestId ?? `req_platform_${Date.now()}`,
            ipAddress: options?.ipAddress ?? "127.0.0.1",
            userAgent: options?.userAgent ?? null,
            reason: validatedReason,
            previousState: { status: app.status },
            newState: { status },
            metadata: options?.metadata ?? null,
            tx,
        });

        return {
            id: updated.id,
            workspaceId: updated.workspaceId,
            name: updated.name,
            description: updated.description,
            status: updated.status,
            createdByUserId: updated.createdByUserId,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
        };
    });
}

/**
 * Lists API keys across tenants with keyHash sanitization.
 * Gated by: platform.developer.view_apps
 */
export async function listPlatformApiKeys(
    context: PlatformAuthorizationContext,
    filter?: PlatformApiKeyFilter
): Promise<PlatformApiKeyDto[]> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.DEVELOPER_VIEW_APPS);

    const whereClause: Record<string, unknown> = {};

    if (filter?.developerApplicationId) {
        whereClause.developerApplicationId = filter.developerApplicationId;
    }

    if (filter?.status) {
        whereClause.status = filter.status;
    }

    if (filter?.environment) {
        whereClause.environment = filter.environment;
    }

    if (filter?.workspaceId) {
        whereClause.developerApplication = {
            workspaceId: filter.workspaceId,
        };
    }

    const keys = await prisma.apiKey.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        take: filter?.limit ?? 100,
        skip: filter?.offset ?? 0,
        include: {
            developerApplication: {
                select: {
                    name: true,
                    workspaceId: true,
                },
            },
        },
    });

    return keys.map((k) => ({
        id: k.id,
        developerApplicationId: k.developerApplicationId,
        developerApplicationName: k.developerApplication?.name,
        workspaceId: k.developerApplication?.workspaceId,
        keyPrefix: k.keyPrefix,
        environment: k.environment,
        status: k.status,
        scopes: k.scopes,
        expiresAt: k.expiresAt ? k.expiresAt.toISOString() : null,
        revokedAt: k.revokedAt ? k.revokedAt.toISOString() : null,
        lastUsedAt: k.lastUsedAt ? k.lastUsedAt.toISOString() : null,
        createdAt: k.createdAt.toISOString(),
        updatedAt: k.updatedAt.toISOString(),
    }));
}

/**
 * Fetches an API key by ID (strictly excluding keyHash).
 * Gated by: platform.developer.view_apps
 */
export async function getPlatformApiKey(
    context: PlatformAuthorizationContext,
    apiKeyId: string
): Promise<PlatformApiKeyDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.DEVELOPER_VIEW_APPS);

    const key = await prisma.apiKey.findUnique({
        where: { id: apiKeyId },
        include: {
            developerApplication: {
                select: {
                    name: true,
                    workspaceId: true,
                },
            },
        },
    });

    if (!key) {
        throw new PlatformApiKeyNotFoundError(apiKeyId);
    }

    return {
        id: key.id,
        developerApplicationId: key.developerApplicationId,
        developerApplicationName: key.developerApplication?.name,
        workspaceId: key.developerApplication?.workspaceId,
        keyPrefix: key.keyPrefix,
        environment: key.environment,
        status: key.status,
        scopes: key.scopes,
        expiresAt: key.expiresAt ? key.expiresAt.toISOString() : null,
        revokedAt: key.revokedAt ? key.revokedAt.toISOString() : null,
        lastUsedAt: key.lastUsedAt ? key.lastUsedAt.toISOString() : null,
        createdAt: key.createdAt.toISOString(),
        updatedAt: key.updatedAt.toISOString(),
    };
}

/**
 * Administratively revokes an API key across tenants.
 * Tier-2 Dangerous Action: requires min 10 char reason, step-up check, atomic audit log.
 * Gated by: platform.developer.revoke_keys
 */
export async function revokePlatformApiKey(
    context: PlatformAuthorizationContext,
    apiKeyId: string,
    reason: string,
    options?: PlatformDeveloperActionOptions
): Promise<PlatformApiKeyDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.DEVELOPER_REVOKE_KEYS);
    const validatedReason = validateDangerousActionReason(reason);
    assertTier2StepUpAuthenticated(context);

    return prisma.$transaction(async (tx) => {
        const key = await tx.apiKey.findUnique({
            where: { id: apiKeyId },
            include: {
                developerApplication: {
                    select: {
                        name: true,
                        workspaceId: true,
                    },
                },
            },
        });

        if (!key) {
            throw new PlatformApiKeyNotFoundError(apiKeyId);
        }

        if (key.status === "REVOKED") {
            throw new PlatformDeveloperConflictError(
                `API Key '${apiKeyId}' is already revoked.`
            );
        }

        const now = new Date();
        const updated = await tx.apiKey.update({
            where: { id: apiKeyId },
            data: {
                status: "REVOKED",
                revokedAt: now,
            },
        });

        await recordPlatformAuditEvent({
            actor: context,
            action: PLATFORM_AUDIT_EVENTS.DEVELOPER_API_KEY_REVOKED,
            targetType: "API_KEY",
            targetId: apiKeyId,
            workspaceId: key.developerApplication?.workspaceId ?? null,
            requestId: options?.requestId ?? `req_platform_${Date.now()}`,
            ipAddress: options?.ipAddress ?? "127.0.0.1",
            userAgent: options?.userAgent ?? null,
            reason: validatedReason,
            previousState: {
                status: key.status,
                revokedAt: key.revokedAt ? key.revokedAt.toISOString() : null,
            },
            newState: {
                status: "REVOKED",
                revokedAt: now.toISOString(),
            },
            metadata: options?.metadata ?? null,
            tx,
        });

        return {
            id: updated.id,
            developerApplicationId: updated.developerApplicationId,
            developerApplicationName: key.developerApplication?.name,
            workspaceId: key.developerApplication?.workspaceId,
            keyPrefix: updated.keyPrefix,
            environment: updated.environment,
            status: updated.status,
            scopes: updated.scopes,
            expiresAt: updated.expiresAt ? updated.expiresAt.toISOString() : null,
            revokedAt: updated.revokedAt ? updated.revokedAt.toISOString() : null,
            lastUsedAt: updated.lastUsedAt ? updated.lastUsedAt.toISOString() : null,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
        };
    });
}

/**
 * Lists Webhook Endpoints across tenants (with secret masking).
 * Gated by: platform.developer.view_apps
 */
export async function listPlatformWebhookEndpoints(
    context: PlatformAuthorizationContext,
    filter?: PlatformWebhookFilter
): Promise<PlatformWebhookEndpointDto[]> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.DEVELOPER_VIEW_APPS);

    const whereClause: Record<string, unknown> = {};

    if (filter?.workspaceId) {
        whereClause.workspaceId = filter.workspaceId;
    }

    if (filter?.developerApplicationId) {
        whereClause.developerApplicationId = filter.developerApplicationId;
    }

    if (filter?.status) {
        whereClause.status = filter.status;
    }

    const endpoints = await prisma.webhookEndpoint.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        take: filter?.limit ?? 100,
        skip: filter?.offset ?? 0,
    });

    return endpoints.map((ep) => ({
        id: ep.id,
        workspaceId: ep.workspaceId,
        developerApplicationId: ep.developerApplicationId,
        url: ep.url,
        description: ep.description,
        status: ep.status,
        events: ep.events,
        secretMasked: maskWebhookSecret(ep.secret),
        createdAt: ep.createdAt.toISOString(),
        updatedAt: ep.updatedAt.toISOString(),
    }));
}

/**
 * Disables an abusive or failing Webhook Endpoint across tenants.
 * Tier-1 Operational Action: requires valid operational reason and audit log.
 * Gated by: platform.developer.manage_webhooks
 */
export async function disablePlatformWebhookEndpoint(
    context: PlatformAuthorizationContext,
    webhookEndpointId: string,
    reason: string,
    options?: PlatformDeveloperActionOptions
): Promise<PlatformWebhookEndpointDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.DEVELOPER_MANAGE_WEBHOOKS);
    const validatedReason = validateTier1Reason(reason);

    return prisma.$transaction(async (tx) => {
        const ep = await tx.webhookEndpoint.findUnique({
            where: { id: webhookEndpointId },
        });

        if (!ep) {
            throw new PlatformWebhookEndpointNotFoundError(webhookEndpointId);
        }

        if (ep.status === "DISABLED") {
            throw new PlatformDeveloperConflictError(
                `Webhook endpoint '${webhookEndpointId}' is already disabled.`
            );
        }

        const updated = await tx.webhookEndpoint.update({
            where: { id: webhookEndpointId },
            data: { status: "DISABLED" },
        });

        await recordPlatformAuditEvent({
            actor: context,
            action: PLATFORM_AUDIT_EVENTS.DEVELOPER_WEBHOOK_DISABLED,
            targetType: "WEBHOOK",
            targetId: webhookEndpointId,
            workspaceId: ep.workspaceId,
            requestId: options?.requestId ?? `req_platform_${Date.now()}`,
            ipAddress: options?.ipAddress ?? "127.0.0.1",
            userAgent: options?.userAgent ?? null,
            reason: validatedReason,
            previousState: { status: ep.status },
            newState: { status: "DISABLED" },
            metadata: options?.metadata ?? null,
            tx,
        });

        return {
            id: updated.id,
            workspaceId: updated.workspaceId,
            developerApplicationId: updated.developerApplicationId,
            url: updated.url,
            description: updated.description,
            status: updated.status,
            events: updated.events,
            secretMasked: maskWebhookSecret(updated.secret),
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
        };
    });
}

/**
 * Inspects rate-limit status and subscription quotas for a target.
 * Gated by: platform.developer.view_apps
 */
export async function getPlatformRateLimitStatus(
    context: PlatformAuthorizationContext,
    target: {
        workspaceId?: string;
        apiKeyId?: string;
        ipAddress?: string;
    }
): Promise<PlatformRateLimitStatusDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.DEVELOPER_VIEW_APPS);

    if (!target.workspaceId && !target.apiKeyId && !target.ipAddress) {
        throw new PlatformDeveloperValidationError(
            "Must provide at least one target parameter (workspaceId, apiKeyId, or ipAddress)."
        );
    }

    if (target.workspaceId) {
        const limit = await resolveWorkspaceTierLimit(target.workspaceId);
        return {
            key: `workspace:${target.workspaceId}`,
            targetType: "WORKSPACE",
            limit,
            windowMs: 60 * 1000,
        };
    }

    if (target.apiKeyId) {
        return {
            key: `key:${target.apiKeyId}`,
            targetType: "KEY",
            limit: 120, // defaultKeyLimit per minute
            windowMs: 60 * 1000,
        };
    }

    return {
        key: `ip:${target.ipAddress}`,
        targetType: "IP",
        limit: 60, // defaultUnauthenticatedIpLimit per minute
        windowMs: 60 * 1000,
    };
}

/**
 * Manually resets/clears a rate limit window for a key/workspace/IP in the store.
 * Tier-1 Operational Action: requires valid operational reason and audit log.
 * Gated by: platform.developer.manage_webhooks
 */
export async function resetPlatformRateLimit(
    context: PlatformAuthorizationContext,
    target: {
        key: string;
        targetType: "KEY" | "WORKSPACE" | "IP";
        workspaceId?: string;
    },
    reason: string,
    options?: PlatformDeveloperActionOptions
): Promise<{ success: boolean; key: string }> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.DEVELOPER_MANAGE_WEBHOOKS);
    const validatedReason = validateTier1Reason(reason);

    const store = getRateLimitStore();
    await store.reset(target.key);

    await recordPlatformAuditEvent({
        actor: context,
        action: PLATFORM_AUDIT_EVENTS.DEVELOPER_RATE_LIMIT_RESET,
        targetType: "RATE_LIMIT",
        targetId: target.key,
        workspaceId: target.workspaceId ?? null,
        requestId: options?.requestId ?? `req_platform_${Date.now()}`,
        ipAddress: options?.ipAddress ?? "127.0.0.1",
        userAgent: options?.userAgent ?? null,
        reason: validatedReason,
        previousState: { rateLimitKey: target.key, status: "THROTTLED" },
        newState: { rateLimitKey: target.key, status: "RESET" },
        metadata: {
            targetType: target.targetType,
            ...(options?.metadata ?? {}),
        },
    });

    return { success: true, key: target.key };
}
