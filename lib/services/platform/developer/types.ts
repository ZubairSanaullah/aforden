import {
    DeveloperApplicationStatus,
    ApiKeyEnvironment,
    ApiKeyStatus,
    WebhookEndpointStatus,
} from "@/generated/prisma/enums";

export {
    DeveloperApplicationStatus,
    ApiKeyEnvironment,
    ApiKeyStatus,
    WebhookEndpointStatus,
};

export interface PlatformDeveloperApplicationDto {
    id: string;
    workspaceId: string;
    name: string;
    description: string | null;
    status: DeveloperApplicationStatus;
    createdByUserId: string;
    createdAt: string;
    updatedAt: string;
    apiKeyCount?: number;
    webhookCount?: number;
}

export interface PlatformDeveloperApplicationDetailDto
    extends PlatformDeveloperApplicationDto {
    workspaceName?: string;
    workspaceSlug?: string;
    createdByUserEmail?: string;
    apiKeys: PlatformApiKeyDto[];
    webhookEndpoints: PlatformWebhookEndpointDto[];
}

export interface PlatformApiKeyDto {
    id: string;
    developerApplicationId: string;
    developerApplicationName?: string;
    workspaceId?: string;
    keyPrefix: string;
    environment: ApiKeyEnvironment;
    status: ApiKeyStatus;
    scopes: string[];
    expiresAt: string | null;
    revokedAt: string | null;
    lastUsedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface PlatformWebhookEndpointDto {
    id: string;
    workspaceId: string;
    developerApplicationId: string;
    url: string;
    description: string | null;
    status: WebhookEndpointStatus;
    events: string[];
    secretMasked: string;
    createdAt: string;
    updatedAt: string;
}

export interface PlatformRateLimitStatusDto {
    key: string;
    targetType: "KEY" | "WORKSPACE" | "IP";
    limit: number;
    windowMs: number;
    currentUsage?: number;
    remaining?: number;
    resetEpochSeconds?: number;
}

export interface PlatformDeveloperApplicationFilter {
    workspaceId?: string;
    status?: DeveloperApplicationStatus;
    search?: string;
    limit?: number;
    offset?: number;
}

export interface PlatformApiKeyFilter {
    workspaceId?: string;
    developerApplicationId?: string;
    status?: ApiKeyStatus;
    environment?: ApiKeyEnvironment;
    limit?: number;
    offset?: number;
}

export interface PlatformWebhookFilter {
    workspaceId?: string;
    developerApplicationId?: string;
    status?: WebhookEndpointStatus;
    limit?: number;
    offset?: number;
}

export interface PlatformDeveloperActionOptions {
    requestId?: string;
    ipAddress?: string;
    userAgent?: string | null;
    metadata?: Record<string, unknown> | null;
}
