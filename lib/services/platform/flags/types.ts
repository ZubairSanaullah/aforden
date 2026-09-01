export interface PlatformFeatureFlagDto {
    id: string;
    key: string;
    name: string;
    description: string | null;
    enabled: boolean;
    defaultValue: boolean;
    rolloutPercentage: number;
    allowedWorkspaceIds: string[];
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface CreateFeatureFlagInput {
    key: string;
    name: string;
    description?: string | null;
    enabled?: boolean;
    defaultValue?: boolean;
    rolloutPercentage?: number | null;
    allowedWorkspaceIds?: string[] | null;
    metadata?: Record<string, unknown> | null;
}

export interface UpdateFeatureFlagInput {
    name?: string;
    description?: string | null;
    defaultValue?: boolean;
    rolloutPercentage?: number | null;
    allowedWorkspaceIds?: string[] | null;
    metadata?: Record<string, unknown> | null;
}

export interface FeatureFlagEvaluationTarget {
    workspaceId?: string | null;
    userId?: string | null;
}

export interface FeatureFlagFilterOptions {
    enabled?: boolean;
    search?: string;
    limit?: number;
    offset?: number;
}

export interface FeatureFlagLifecycleOptions {
    requestId?: string;
    ipAddress?: string;
    userAgent?: string | null;
    metadata?: Record<string, unknown> | null;
}
