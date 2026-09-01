import {
    IntegrationStatus,
    IntegrationConnectionStatus,
    IntegrationCredentialStatus,
    IntegrationCapability,
    IntegrationExecutionStatus,
} from "@/generated/prisma/enums";

export {
    IntegrationStatus,
    IntegrationConnectionStatus,
    IntegrationCredentialStatus,
    IntegrationCapability,
    IntegrationExecutionStatus,
};

export interface PlatformIntegrationDto {
    id: string;
    name: string;
    description: string | null;
    logoUrl: string | null;
    status: IntegrationStatus;
    capabilities: IntegrationCapability[];
    authType: string | null;
    connectionCount?: number;
    createdAt: string;
    updatedAt: string;
}

/**
 * Sanitized Credential DTO.
 * Critical Invariant: encryptedData, iv, tag, encryptedDek are NEVER exposed to platform administrators.
 */
export interface PlatformIntegrationCredentialDto {
    id: string;
    connectionId: string;
    version: number;
    status: IntegrationCredentialStatus;
    keyVaultProvider: string;
    algorithm: string;
    fingerprint: string;
    expiresAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface PlatformIntegrationConnectionDto {
    id: string;
    workspaceId: string;
    workspaceName?: string;
    workspaceSlug?: string;
    integrationId: string;
    integrationName?: string;
    connectionKey: string;
    status: IntegrationConnectionStatus;
    configJson: Record<string, unknown> | null;
    metadataJson: Record<string, unknown> | null;
    externalAccountId: string | null;
    externalAccountName: string | null;
    lastTestedAt: string | null;
    lastErrorJson: Record<string, unknown> | null;
    createdAt: string;
    updatedAt: string;
    activeCredential?: PlatformIntegrationCredentialDto | null;
}

export interface PlatformIntegrationWebhookDto {
    id: string;
    endpointSlug: string;
    description: string | null;
    status: string;
    enabledEvents: string[];
    createdAt: string;
}

export interface PlatformIntegrationConnectionDetailDto
    extends PlatformIntegrationConnectionDto {
    credentials: PlatformIntegrationCredentialDto[];
    webhooks: PlatformIntegrationWebhookDto[];
    activeExclusiveCapabilities: IntegrationCapability[];
}

export interface PlatformIntegrationExecutionDto {
    id: string;
    workspaceId: string;
    connectionId: string;
    capability: IntegrationCapability;
    action: string;
    status: IntegrationExecutionStatus;
    attemptNumber: number;
    durationMs: number | null;
    failureCode: string | null;
    startedAt: string | null;
    completedAt: string | null;
    createdAt: string;
}

export interface PlatformIntegrationFilter {
    status?: IntegrationStatus;
    capability?: IntegrationCapability;
    search?: string;
}

export interface PlatformIntegrationConnectionFilter {
    workspaceId?: string;
    integrationId?: string;
    status?: IntegrationConnectionStatus;
    limit?: number;
    offset?: number;
}

export interface PlatformIntegrationExecutionFilter {
    workspaceId?: string;
    connectionId?: string;
    status?: IntegrationExecutionStatus;
    capability?: IntegrationCapability;
    limit?: number;
    offset?: number;
}

export interface PlatformIntegrationActionOptions {
    requestId?: string;
    ipAddress?: string;
    userAgent?: string | null;
    metadata?: Record<string, unknown> | null;
}
