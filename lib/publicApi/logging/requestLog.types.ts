/**
 * Phase 1.18.14 — API Usage & Request Logging Types
 */

export interface CreateApiRequestLogParams {
    workspaceId: string;
    apiKeyId?: string | null;
    developerApplicationId?: string | null;
    requestId: string;
    endpoint: string;
    method: string;
    statusCode: number;
    durationMs: number;
    ipHash?: string | null;
    userAgent?: string | null;
    apiVersion?: string;
    rateLimitTier?: string | null;
    errorCode?: string | null;
}

export interface ApiRequestLogQueryOptions {
    apiKeyId?: string;
    developerApplicationId?: string;
    statusCode?: number;
    endpoint?: string;
    method?: string;
    startDate?: Date;
    endDate?: Date;
    cursor?: string;
    limit?: number;
}

export interface ApiRequestLogDto {
    id: string;
    workspaceId: string;
    apiKeyId: string | null;
    developerApplicationId: string | null;
    requestId: string;
    endpoint: string;
    method: string;
    statusCode: number;
    durationMs: number;
    ipHash: string | null;
    userAgent: string | null;
    apiVersion: string;
    rateLimitTier: string | null;
    errorCode: string | null;
    createdAt: string;
}

export interface PaginatedApiRequestLogsResult {
    items: ApiRequestLogDto[];
    nextCursor: string | null;
    hasMore: boolean;
}
