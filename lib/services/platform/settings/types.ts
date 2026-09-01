export type SettingValueType = "STRING" | "NUMBER" | "BOOLEAN" | "JSON";

export interface PlatformRuntimeSettingDto {
    id: string;
    key: string;
    value: unknown;
    valueType: SettingValueType;
    description: string | null;
    isProtected: boolean;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface UpsertRuntimeSettingInput {
    key: string;
    value: unknown;
    valueType: SettingValueType;
    description?: string | null;
    isProtected?: boolean;
    metadata?: Record<string, unknown> | null;
}

export interface RuntimeSettingFilterOptions {
    isProtected?: boolean;
    valueType?: SettingValueType;
    search?: string;
    limit?: number;
    offset?: number;
}

export interface RuntimeSettingLifecycleOptions {
    requestId?: string;
    ipAddress?: string;
    userAgent?: string | null;
    metadata?: Record<string, unknown> | null;
}
