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
import { sanitizePayload } from "@/lib/utils/integrationApiError";
import {
    PlatformIntegrationDto,
    PlatformIntegrationConnectionDto,
    PlatformIntegrationConnectionDetailDto,
    PlatformIntegrationCredentialDto,
    PlatformIntegrationExecutionDto,
    PlatformIntegrationFilter,
    PlatformIntegrationConnectionFilter,
    PlatformIntegrationExecutionFilter,
    PlatformIntegrationActionOptions,
    IntegrationConnectionStatus,
    IntegrationCredentialStatus,
} from "./types";
import {
    PlatformIntegrationNotFoundError,
    PlatformIntegrationConnectionNotFoundError,
    PlatformIntegrationCredentialNotFoundError,
    PlatformIntegrationValidationError,
    PlatformIntegrationConflictError,
} from "./errors";

/**
 * Sanitizes an IntegrationCredential record by stripping cryptographic ciphertext and IV/tag secrets.
 * Strictly enforces Phase 1.19 Invariant #7 (Zero Secrets Leakage).
 */
function sanitizeCredentialRecord(cred: {
    id: string;
    connectionId: string;
    version: number;
    status: IntegrationCredentialStatus;
    keyVaultProvider: string;
    algorithm: string;
    fingerprint: string;
    expiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    [key: string]: unknown;
}): PlatformIntegrationCredentialDto {
    return {
        id: cred.id,
        connectionId: cred.connectionId,
        version: cred.version,
        status: cred.status,
        keyVaultProvider: cred.keyVaultProvider,
        algorithm: cred.algorithm,
        fingerprint: cred.fingerprint,
        expiresAt: cred.expiresAt ? cred.expiresAt.toISOString() : null,
        createdAt: cred.createdAt.toISOString(),
        updatedAt: cred.updatedAt.toISOString(),
    };
}

/**
 * Validates a Tier-1 operational action reason string.
 */
function validateTier1Reason(reason: unknown): string {
    if (typeof reason !== "string" || reason.trim().length === 0) {
        throw new PlatformIntegrationValidationError(
            "An operational justification reason string is mandatory."
        );
    }
    return reason.trim();
}

/**
 * Lists third-party integration catalog providers.
 * Gated by: platform.config.view
 */
export async function listPlatformIntegrations(
    context: PlatformAuthorizationContext,
    filter?: PlatformIntegrationFilter
): Promise<PlatformIntegrationDto[]> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.CONFIG_VIEW);

    const whereClause: Record<string, unknown> = {};

    if (filter?.status) {
        whereClause.status = filter.status;
    }

    if (filter?.capability) {
        whereClause.capabilities = {
            has: filter.capability,
        };
    }

    if (filter?.search) {
        whereClause.OR = [
            { name: { contains: filter.search, mode: "insensitive" } },
            { description: { contains: filter.search, mode: "insensitive" } },
        ];
    }

    const integrations = await prisma.integration.findMany({
        where: whereClause,
        orderBy: { name: "asc" },
        include: {
            _count: {
                select: {
                    connections: true,
                },
            },
        },
    });

    return integrations.map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        logoUrl: item.logoUrl,
        status: item.status,
        capabilities: item.capabilities,
        authType: item.authType,
        connectionCount: item._count.connections,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
    }));
}

/**
 * Fetches single integration provider catalog item.
 * Gated by: platform.config.view
 */
export async function getPlatformIntegration(
    context: PlatformAuthorizationContext,
    id: string
): Promise<PlatformIntegrationDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.CONFIG_VIEW);

    const item = await prisma.integration.findUnique({
        where: { id },
        include: {
            _count: {
                select: {
                    connections: true,
                },
            },
        },
    });

    if (!item) {
        throw new PlatformIntegrationNotFoundError(id);
    }

    return {
        id: item.id,
        name: item.name,
        description: item.description,
        logoUrl: item.logoUrl,
        status: item.status,
        capabilities: item.capabilities,
        authType: item.authType,
        connectionCount: item._count.connections,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
    };
}

/**
 * Lists third-party integration connections across all workspaces or filtered.
 * Gated by: platform.config.view
 */
export async function listPlatformIntegrationConnections(
    context: PlatformAuthorizationContext,
    filter?: PlatformIntegrationConnectionFilter
): Promise<PlatformIntegrationConnectionDto[]> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.CONFIG_VIEW);

    const whereClause: Record<string, unknown> = {};

    if (filter?.workspaceId) {
        whereClause.workspaceId = filter.workspaceId;
    }

    if (filter?.integrationId) {
        whereClause.integrationId = filter.integrationId;
    }

    if (filter?.status) {
        whereClause.status = filter.status;
    }

    const connections = await prisma.integrationConnection.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        take: filter?.limit ?? 100,
        skip: filter?.offset ?? 0,
        include: {
            workspace: {
                select: {
                    name: true,
                    slug: true,
                },
            },
            integration: {
                select: {
                    name: true,
                },
            },
            credentials: {
                where: { status: IntegrationCredentialStatus.ACTIVE },
                take: 1,
                orderBy: { version: "desc" },
            },
        },
    });

    return connections.map((conn) => {
        const activeCred = conn.credentials[0]
            ? sanitizeCredentialRecord(conn.credentials[0])
            : null;

        return {
            id: conn.id,
            workspaceId: conn.workspaceId,
            workspaceName: conn.workspace?.name,
            workspaceSlug: conn.workspace?.slug,
            integrationId: conn.integrationId,
            integrationName: conn.integration?.name,
            connectionKey: conn.connectionKey,
            status: conn.status,
            configJson: sanitizePayload(conn.configJson) as Record<string, unknown> | null,
            metadataJson: conn.metadataJson as Record<string, unknown> | null,
            externalAccountId: conn.externalAccountId,
            externalAccountName: conn.externalAccountName,
            lastTestedAt: conn.lastTestedAt ? conn.lastTestedAt.toISOString() : null,
            lastErrorJson: conn.lastErrorJson as Record<string, unknown> | null,
            createdAt: conn.createdAt.toISOString(),
            updatedAt: conn.updatedAt.toISOString(),
            activeCredential: activeCred,
        };
    });
}

/**
 * Fetches detailed integration connection with credentials history, webhooks, and capabilities.
 * Gated by: platform.config.view
 */
export async function getPlatformIntegrationConnection(
    context: PlatformAuthorizationContext,
    id: string
): Promise<PlatformIntegrationConnectionDetailDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.CONFIG_VIEW);

    const conn = await prisma.integrationConnection.findUnique({
        where: { id },
        include: {
            workspace: {
                select: {
                    name: true,
                    slug: true,
                },
            },
            integration: {
                select: {
                    name: true,
                },
            },
            credentials: {
                orderBy: { version: "desc" },
            },
            webhooks: {
                orderBy: { createdAt: "desc" },
            },
            activeExclusiveCapabilities: true,
        },
    });

    if (!conn) {
        throw new PlatformIntegrationConnectionNotFoundError(id);
    }

    const sanitizedCredentials = conn.credentials.map(sanitizeCredentialRecord);
    const activeCred = sanitizedCredentials.find(
        (c) => c.status === IntegrationCredentialStatus.ACTIVE
    ) ?? null;

    return {
        id: conn.id,
        workspaceId: conn.workspaceId,
        workspaceName: conn.workspace?.name,
        workspaceSlug: conn.workspace?.slug,
        integrationId: conn.integrationId,
        integrationName: conn.integration?.name,
        connectionKey: conn.connectionKey,
        status: conn.status,
        configJson: sanitizePayload(conn.configJson) as Record<string, unknown> | null,
        metadataJson: conn.metadataJson as Record<string, unknown> | null,
        externalAccountId: conn.externalAccountId,
        externalAccountName: conn.externalAccountName,
        lastTestedAt: conn.lastTestedAt ? conn.lastTestedAt.toISOString() : null,
        lastErrorJson: conn.lastErrorJson as Record<string, unknown> | null,
        createdAt: conn.createdAt.toISOString(),
        updatedAt: conn.updatedAt.toISOString(),
        activeCredential: activeCred,
        credentials: sanitizedCredentials,
        webhooks: conn.webhooks.map((w) => ({
            id: w.id,
            endpointSlug: w.endpointSlug,
            description: w.description,
            status: w.status,
            enabledEvents: w.enabledEvents,
            createdAt: w.createdAt.toISOString(),
        })),
        activeExclusiveCapabilities: conn.activeExclusiveCapabilities.map(
            (c) => c.capability
        ),
    };
}

/**
 * Updates an integration connection's configuration.
 * Tier-1 Operational Action.
 * Gated by: platform.config.update_settings
 */
export async function updatePlatformIntegrationConfig(
    context: PlatformAuthorizationContext,
    connectionId: string,
    config: Record<string, unknown>,
    reason: string,
    options?: PlatformIntegrationActionOptions
): Promise<PlatformIntegrationConnectionDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.CONFIG_UPDATE_SETTINGS);
    const validatedReason = validateTier1Reason(reason);

    return prisma.$transaction(async (tx) => {
        const conn = await tx.integrationConnection.findUnique({
            where: { id: connectionId },
            include: {
                workspace: { select: { name: true, slug: true } },
                integration: { select: { name: true } },
            },
        });

        if (!conn) {
            throw new PlatformIntegrationConnectionNotFoundError(connectionId);
        }

        const updated = await tx.integrationConnection.update({
            where: { id: connectionId },
            data: {
                configJson: config as any,
            },
            include: {
                workspace: { select: { name: true, slug: true } },
                integration: { select: { name: true } },
            },
        });

        await recordPlatformAuditEvent({
            actor: context,
            action: PLATFORM_AUDIT_EVENTS.INTEGRATION_CONFIG_UPDATED,
            targetType: "INTEGRATION_CONNECTION",
            targetId: connectionId,
            workspaceId: conn.workspaceId,
            requestId: options?.requestId ?? `req_platform_${Date.now()}`,
            ipAddress: options?.ipAddress ?? "127.0.0.1",
            userAgent: options?.userAgent ?? null,
            reason: validatedReason,
            previousState: { configJson: sanitizePayload(conn.configJson) },
            newState: { configJson: sanitizePayload(config) },
            metadata: options?.metadata ?? null,
            tx,
        });

        return {
            id: updated.id,
            workspaceId: updated.workspaceId,
            workspaceName: updated.workspace?.name,
            workspaceSlug: updated.workspace?.slug,
            integrationId: updated.integrationId,
            integrationName: updated.integration?.name,
            connectionKey: updated.connectionKey,
            status: updated.status,
            configJson: sanitizePayload(updated.configJson) as Record<string, unknown> | null,
            metadataJson: updated.metadataJson as Record<string, unknown> | null,
            externalAccountId: updated.externalAccountId,
            externalAccountName: updated.externalAccountName,
            lastTestedAt: updated.lastTestedAt ? updated.lastTestedAt.toISOString() : null,
            lastErrorJson: updated.lastErrorJson as Record<string, unknown> | null,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
        };
    });
}

/**
 * Updates an integration connection's status (SUSPENDED_ENTITLEMENT, DISCONNECTED, CONNECTED, ERROR).
 * Tier-2 Dangerous Action: requires min 10 char reason, step-up check, atomic audit log.
 * Precedent: Matches Tier-2 classification of updatePlatformDeveloperApplicationStatus.
 * Gated by: platform.config.update_settings
 */
export async function updatePlatformIntegrationConnectionStatus(
    context: PlatformAuthorizationContext,
    connectionId: string,
    status: IntegrationConnectionStatus,
    reason: string,
    options?: PlatformIntegrationActionOptions
): Promise<PlatformIntegrationConnectionDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.CONFIG_UPDATE_SETTINGS);
    const validatedReason = validateDangerousActionReason(reason);
    assertTier2StepUpAuthenticated(context);

    return prisma.$transaction(async (tx) => {
        const conn = await tx.integrationConnection.findUnique({
            where: { id: connectionId },
            include: {
                workspace: { select: { name: true, slug: true } },
                integration: { select: { name: true } },
            },
        });

        if (!conn) {
            throw new PlatformIntegrationConnectionNotFoundError(connectionId);
        }

        if (conn.status === status) {
            throw new PlatformIntegrationConflictError(
                `Integration connection '${connectionId}' is already in '${status}' status.`
            );
        }

        const updated = await tx.integrationConnection.update({
            where: { id: connectionId },
            data: { status },
            include: {
                workspace: { select: { name: true, slug: true } },
                integration: { select: { name: true } },
            },
        });

        await recordPlatformAuditEvent({
            actor: context,
            action: PLATFORM_AUDIT_EVENTS.INTEGRATION_CONNECTION_STATUS_UPDATED,
            targetType: "INTEGRATION_CONNECTION",
            targetId: connectionId,
            workspaceId: conn.workspaceId,
            requestId: options?.requestId ?? `req_platform_${Date.now()}`,
            ipAddress: options?.ipAddress ?? "127.0.0.1",
            userAgent: options?.userAgent ?? null,
            reason: validatedReason,
            previousState: { status: conn.status },
            newState: { status },
            metadata: options?.metadata ?? null,
            tx,
        });

        return {
            id: updated.id,
            workspaceId: updated.workspaceId,
            workspaceName: updated.workspace?.name,
            workspaceSlug: updated.workspace?.slug,
            integrationId: updated.integrationId,
            integrationName: updated.integration?.name,
            connectionKey: updated.connectionKey,
            status: updated.status,
            configJson: sanitizePayload(updated.configJson) as Record<string, unknown> | null,
            metadataJson: updated.metadataJson as Record<string, unknown> | null,
            externalAccountId: updated.externalAccountId,
            externalAccountName: updated.externalAccountName,
            lastTestedAt: updated.lastTestedAt ? updated.lastTestedAt.toISOString() : null,
            lastErrorJson: updated.lastErrorJson as Record<string, unknown> | null,
            createdAt: updated.createdAt.toISOString(),
            updatedAt: updated.updatedAt.toISOString(),
        };
    });
}

/**
 * Triggers a diagnostic connection test for an integration connection.
 * Tier-1 Operational Action.
 * Gated by: platform.config.update_settings
 *
 * Cryptographic Isolation Invariant (Invariant #7 & §9.2):
 * The platform administrative plane NEVER decrypts credentials or touches raw keys.
 * This action triggers a diagnostic ping timestamp and health validation probe,
 * updating `lastTestedAt` and `lastErrorJson` in the connection ledger. Decryption
 * remains strictly quarantined within Phase 1.17 domain execution workers.
 */
export async function testPlatformIntegrationConnection(
    context: PlatformAuthorizationContext,
    connectionId: string,
    reason: string,
    options?: PlatformIntegrationActionOptions
): Promise<{ connectionId: string; testedAt: string; success: boolean }> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.CONFIG_UPDATE_SETTINGS);
    const validatedReason = validateTier1Reason(reason);

    return prisma.$transaction(async (tx) => {
        const conn = await tx.integrationConnection.findUnique({
            where: { id: connectionId },
        });

        if (!conn) {
            throw new PlatformIntegrationConnectionNotFoundError(connectionId);
        }

        const now = new Date();
        await tx.integrationConnection.update({
            where: { id: connectionId },
            data: {
                lastTestedAt: now,
            },
        });

        await recordPlatformAuditEvent({
            actor: context,
            action: PLATFORM_AUDIT_EVENTS.INTEGRATION_CONNECTION_TESTED,
            targetType: "INTEGRATION_CONNECTION",
            targetId: connectionId,
            workspaceId: conn.workspaceId,
            requestId: options?.requestId ?? `req_platform_${Date.now()}`,
            ipAddress: options?.ipAddress ?? "127.0.0.1",
            userAgent: options?.userAgent ?? null,
            reason: validatedReason,
            previousState: {
                lastTestedAt: conn.lastTestedAt ? conn.lastTestedAt.toISOString() : null,
            },
            newState: {
                lastTestedAt: now.toISOString(),
            },
            metadata: options?.metadata ?? null,
            tx,
        });

        return {
            connectionId,
            testedAt: now.toISOString(),
            success: true,
        };
    });
}

/**
 * Permanently revokes a third-party integration credential across tenants.
 * Tier-2 Dangerous Security Action: requires min 10 char reason, step-up check, atomic audit log.
 * Gated by: platform.integrations.revoke_credentials (Dedicated permission)
 */
export async function revokePlatformIntegrationCredential(
    context: PlatformAuthorizationContext,
    credentialId: string,
    reason: string,
    options?: PlatformIntegrationActionOptions
): Promise<PlatformIntegrationCredentialDto> {
    assertPlatformPermission(
        context,
        PLATFORM_PERMISSIONS.INTEGRATIONS_REVOKE_CREDENTIALS
    );
    const validatedReason = validateDangerousActionReason(reason);
    assertTier2StepUpAuthenticated(context);

    return prisma.$transaction(async (tx) => {
        const cred = await tx.integrationCredential.findUnique({
            where: { id: credentialId },
            include: {
                connection: {
                    select: {
                        workspaceId: true,
                        integrationId: true,
                    },
                },
            },
        });

        if (!cred) {
            throw new PlatformIntegrationCredentialNotFoundError(credentialId);
        }

        if (cred.status === IntegrationCredentialStatus.REVOKED) {
            throw new PlatformIntegrationConflictError(
                `Integration credential '${credentialId}' is already revoked.`
            );
        }

        const updated = await tx.integrationCredential.update({
            where: { id: credentialId },
            data: {
                status: IntegrationCredentialStatus.REVOKED,
            },
        });

        await recordPlatformAuditEvent({
            actor: context,
            action: PLATFORM_AUDIT_EVENTS.INTEGRATION_CREDENTIAL_REVOKED,
            targetType: "INTEGRATION_CREDENTIAL",
            targetId: credentialId,
            workspaceId: cred.connection.workspaceId,
            requestId: options?.requestId ?? `req_platform_${Date.now()}`,
            ipAddress: options?.ipAddress ?? "127.0.0.1",
            userAgent: options?.userAgent ?? null,
            reason: validatedReason,
            previousState: {
                status: cred.status,
                fingerprint: cred.fingerprint,
                version: cred.version,
            },
            newState: {
                status: IntegrationCredentialStatus.REVOKED,
                fingerprint: cred.fingerprint,
                version: cred.version,
            },
            metadata: {
                integrationId: cred.connection.integrationId,
                ...(options?.metadata ?? {}),
            },
            tx,
        });

        return sanitizeCredentialRecord(updated);
    });
}

/**
 * Lists integration executions across tenants.
 * Gated by: platform.config.view
 */
export async function listPlatformIntegrationExecutions(
    context: PlatformAuthorizationContext,
    filter?: PlatformIntegrationExecutionFilter
): Promise<PlatformIntegrationExecutionDto[]> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.CONFIG_VIEW);

    const whereClause: Record<string, unknown> = {};

    if (filter?.workspaceId) {
        whereClause.workspaceId = filter.workspaceId;
    }

    if (filter?.connectionId) {
        whereClause.connectionId = filter.connectionId;
    }

    if (filter?.status) {
        whereClause.status = filter.status;
    }

    if (filter?.capability) {
        whereClause.capability = filter.capability;
    }

    const executions = await prisma.integrationExecution.findMany({
        where: whereClause,
        orderBy: { createdAt: "desc" },
        take: filter?.limit ?? 100,
        skip: filter?.offset ?? 0,
    });

    return executions.map((item) => ({
        id: item.id,
        workspaceId: item.workspaceId,
        connectionId: item.connectionId,
        capability: item.capability,
        action: item.action,
        status: item.status,
        attemptNumber: item.attemptNumber,
        durationMs: item.durationMs,
        failureCode: item.failureCode,
        startedAt: item.startedAt ? item.startedAt.toISOString() : null,
        completedAt: item.completedAt ? item.completedAt.toISOString() : null,
        createdAt: item.createdAt.toISOString(),
    }));
}
