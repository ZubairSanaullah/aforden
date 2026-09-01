import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
    PlatformAuthorizationContext,
    PLATFORM_PERMISSIONS,
    assertPlatformPermission,
} from "../authorization";
import {
    recordPlatformAuditEvent,
    PLATFORM_AUDIT_EVENTS,
} from "../audit";
import {
    PlatformRuntimeSettingDto,
    UpsertRuntimeSettingInput,
    RuntimeSettingFilterOptions,
    RuntimeSettingLifecycleOptions,
    SettingValueType,
} from "./types";
import {
    PlatformRuntimeSettingNotFoundError,
    PlatformRuntimeSettingValidationError,
    PlatformRuntimeSettingProtectedError,
} from "./errors";

// =========================================================================
// In-Memory Performance Caching API
// =========================================================================

interface CachedSettingEntry {
    value: unknown;
    expiresAt: number;
}

const settingCache = new Map<string, CachedSettingEntry>();
const SETTING_CACHE_TTL_MS = 10_000; // 10-second TTL cache for hot paths

/**
 * Invalidates local in-memory runtime setting cache.
 */
export function invalidateRuntimeSettingCache(settingKey?: string): void {
    if (settingKey) {
        settingCache.delete(settingKey);
    } else {
        settingCache.clear();
    }
}

/**
 * Maps raw database PlatformRuntimeSetting entity into sanitized PlatformRuntimeSettingDto.
 */
function mapToPlatformRuntimeSettingDto(setting: any): PlatformRuntimeSettingDto {
    return {
        id: setting.id,
        key: setting.key,
        value: setting.value,
        valueType: setting.valueType as SettingValueType,
        description: setting.description ?? null,
        isProtected: setting.isProtected ?? false,
        metadata: (setting.metadata as Record<string, unknown> | null) ?? null,
        createdAt: setting.createdAt,
        updatedAt: setting.updatedAt,
    };
}

// =========================================================================
// Performant & Safe Setting Reader API
// =========================================================================

/**
 * Evaluates a runtime setting value for operational code paths.
 * Uses 10s in-memory TTL caching and provides error-trapping safe fallbacks.
 */
export async function getSettingValue<T = unknown>(
    key: string,
    defaultValue?: T
): Promise<T> {
    const fallback = defaultValue as T;

    try {
        if (!key || typeof key !== "string") {
            return fallback;
        }

        const now = Date.now();
        const cached = settingCache.get(key);
        if (cached && cached.expiresAt > now) {
            return cached.value as T;
        }

        const setting = await prisma.platformRuntimeSetting.findUnique({
            where: { key },
        });

        if (!setting) {
            return fallback;
        }

        const val = setting.value as T;
        settingCache.set(key, {
            value: val,
            expiresAt: now + SETTING_CACHE_TTL_MS,
        });

        return val;
    } catch {
        return fallback;
    }
}

// =========================================================================
// Input Validation & Secrets Exclusion Rules
// =========================================================================

const BANNED_SECRET_PATTERNS = [
    /secret/i,
    /password/i,
    /private_key/i,
    /token/i,
    /credential/i,
    /connection_string/i,
    /api_key/i,
];

/**
 * Validates setting keys, value types, known schemas, and enforces secret exclusion invariants.
 */
export function validateSettingValue(
    key: string,
    value: unknown,
    valueType: SettingValueType
): void {
    if (!key || typeof key !== "string" || !/^[a-z0-9_\-\.]+$/i.test(key)) {
        throw new PlatformRuntimeSettingValidationError(
            "Setting key must be non-empty and contain only letters, numbers, underscores, hyphens, or dots."
        );
    }

    // Secrets Exclusion Guard (Invariant #7)
    for (const pattern of BANNED_SECRET_PATTERNS) {
        if (pattern.test(key)) {
            throw new PlatformRuntimeSettingValidationError(
                "Secrets and sensitive credentials cannot be stored in runtime settings. Use infrastructure environment variables."
            );
        }
    }

    // Type checking
    if (valueType === "STRING") {
        if (typeof value !== "string") {
            throw new PlatformRuntimeSettingValidationError(
                `Setting value for type 'STRING' must be a string. Received: ${typeof value}`
            );
        }
    } else if (valueType === "NUMBER") {
        if (typeof value !== "number" || isNaN(value)) {
            throw new PlatformRuntimeSettingValidationError(
                `Setting value for type 'NUMBER' must be a valid number. Received: ${typeof value}`
            );
        }
    } else if (valueType === "BOOLEAN") {
        if (typeof value !== "boolean") {
            throw new PlatformRuntimeSettingValidationError(
                `Setting value for type 'BOOLEAN' must be a boolean. Received: ${typeof value}`
            );
        }
    } else if (valueType === "JSON") {
        if (value === null || typeof value !== "object") {
            throw new PlatformRuntimeSettingValidationError(
                `Setting value for type 'JSON' must be a non-null object or array. Received: ${typeof value}`
            );
        }
    } else {
        throw new PlatformRuntimeSettingValidationError(
            `Unsupported setting valueType: '${valueType}'. Expected STRING, NUMBER, BOOLEAN, or JSON.`
        );
    }

    // Known Key Schema Constraints
    if (key === "system.maintenance_mode") {
        if (valueType !== "BOOLEAN") {
            throw new PlatformRuntimeSettingValidationError(
                "Setting 'system.maintenance_mode' must have valueType 'BOOLEAN'."
            );
        }
    } else if (key === "rate_limit.default_rpm") {
        if (valueType !== "NUMBER" || (value as number) < 1 || (value as number) > 100_000) {
            throw new PlatformRuntimeSettingValidationError(
                "Setting 'rate_limit.default_rpm' must be a number between 1 and 100,000."
            );
        }
    } else if (key === "rate_limit.burst_multiplier") {
        if (valueType !== "NUMBER" || (value as number) < 1 || (value as number) > 50) {
            throw new PlatformRuntimeSettingValidationError(
                "Setting 'rate_limit.burst_multiplier' must be a number between 1 and 50."
            );
        }
    } else if (key === "jobs.outbox_batch_size") {
        if (valueType !== "NUMBER" || (value as number) < 1 || (value as number) > 1_000) {
            throw new PlatformRuntimeSettingValidationError(
                "Setting 'jobs.outbox_batch_size' must be a number between 1 and 1,000."
            );
        }
    } else if (key === "system.announcement_banner") {
        if (valueType === "JSON") {
            const banner = value as Record<string, unknown>;
            if (typeof banner.message !== "string") {
                throw new PlatformRuntimeSettingValidationError(
                    "JSON banner setting must include a string 'message' property."
                );
            }
        }
    }
}

// =========================================================================
// Protection Tier Step-Up Authorization Guard
// =========================================================================

function verifyTier2Protection(
    context: PlatformAuthorizationContext,
    settingKey: string,
    reason?: string
): void {
    if (!reason || reason.trim().length < 10) {
        throw new PlatformRuntimeSettingValidationError(
            `Protected setting '${settingKey}' requires a detailed justification reason of at least 10 characters.`
        );
    }

    if (
        !context.stepUpConfirmedAt ||
        Date.now() - new Date(context.stepUpConfirmedAt).getTime() > 5 * 60 * 1000
    ) {
        throw new PlatformRuntimeSettingProtectedError(settingKey);
    }
}

// =========================================================================
// Platform Configuration Administration API
// =========================================================================

/**
 * Retrieves details for a single runtime setting.
 * Gated by platform.config.view.
 */
export async function getSetting(
    context: PlatformAuthorizationContext,
    key: string
): Promise<PlatformRuntimeSettingDto | null> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.CONFIG_VIEW);

    const setting = await prisma.platformRuntimeSetting.findUnique({
        where: { key },
    });

    if (!setting) {
        return null;
    }

    return mapToPlatformRuntimeSettingDto(setting);
}

/**
 * Lists runtime settings with filtering and pagination.
 * Gated by platform.config.view.
 */
export async function listSettings(
    context: PlatformAuthorizationContext,
    filters?: RuntimeSettingFilterOptions
): Promise<{
    settings: PlatformRuntimeSettingDto[];
    total: number;
}> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.CONFIG_VIEW);

    const where: Prisma.PlatformRuntimeSettingWhereInput = {};

    if (filters?.isProtected !== undefined) {
        where.isProtected = filters.isProtected;
    }

    if (filters?.valueType) {
        where.valueType = filters.valueType;
    }

    if (filters?.search) {
        where.OR = [
            { key: { contains: filters.search, mode: "insensitive" } },
            { description: { contains: filters.search, mode: "insensitive" } },
        ];
    }

    const limit = Math.min(Math.max(filters?.limit ?? 50, 1), 200);
    const offset = Math.max(filters?.offset ?? 0, 0);

    const [settings, total] = await Promise.all([
        prisma.platformRuntimeSetting.findMany({
            where,
            orderBy: { key: "asc" },
            take: limit,
            skip: offset,
        }),
        prisma.platformRuntimeSetting.count({ where }),
    ]);

    return {
        settings: settings.map(mapToPlatformRuntimeSettingDto),
        total,
    };
}

/**
 * Creates or updates a runtime setting (Phase 1.19.11).
 * Gated by platform.config.update_settings.
 * Performs validation, Tier-1/Tier-2 step-up verification, and synchronous audit logging in a transaction.
 */
export async function upsertSetting(
    context: PlatformAuthorizationContext,
    input: UpsertRuntimeSettingInput,
    reason?: string,
    options?: RuntimeSettingLifecycleOptions
): Promise<PlatformRuntimeSettingDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.CONFIG_UPDATE_SETTINGS);

    const key = input.key.trim().toLowerCase();
    validateSettingValue(key, input.value, input.valueType);

    const isSystemMaintenance = key === "system.maintenance_mode";
    const requestedProtected = input.isProtected ?? false;

    return prisma.$transaction(async (tx) => {
        const existing = await tx.platformRuntimeSetting.findUnique({ where: { key } });

        const isCurrentlyProtected = existing?.isProtected ?? false;
        const requiresTier2 = isSystemMaintenance || requestedProtected || isCurrentlyProtected;

        if (requiresTier2) {
            verifyTier2Protection(context, key, reason);
        }

        const previousState = existing
            ? {
                  key: existing.key,
                  value: existing.value,
                  valueType: existing.valueType,
                  isProtected: existing.isProtected,
                  description: existing.description,
              }
            : null;

        const valueJson = input.value as Prisma.InputJsonValue;

        const setting = await tx.platformRuntimeSetting.upsert({
            where: { key },
            create: {
                key,
                value: valueJson,
                valueType: input.valueType,
                description: input.description ?? null,
                isProtected: isSystemMaintenance || requestedProtected,
                metadata: (input.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            },
            update: {
                value: valueJson,
                valueType: input.valueType,
                description: input.description !== undefined ? input.description : existing?.description,
                isProtected: isSystemMaintenance || requestedProtected || isCurrentlyProtected,
                metadata: input.metadata !== undefined
                    ? (input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.JsonNull)
                    : (existing?.metadata ? (existing.metadata as Prisma.InputJsonValue) : Prisma.JsonNull),
            },
        });

        const newState = {
            key: setting.key,
            value: setting.value,
            valueType: setting.valueType,
            isProtected: setting.isProtected,
            description: setting.description,
        };

        await recordPlatformAuditEvent({
            actor: context,
            action: PLATFORM_AUDIT_EVENTS.RUNTIME_SETTING_UPDATED,
            targetType: "CONFIG",
            targetId: setting.id,
            workspaceId: null,
            requestId: options?.requestId ?? `req_setting_${Date.now()}`,
            ipAddress: options?.ipAddress ?? "127.0.0.1",
            userAgent: options?.userAgent ?? null,
            reason: reason ?? null,
            previousState,
            newState,
            metadata: options?.metadata ?? null,
            tx,
        });

        invalidateRuntimeSettingCache(key);
        return mapToPlatformRuntimeSettingDto(setting);
    });
}

/**
 * Deletes a runtime setting.
 * Gated by platform.config.update_settings.
 * Requires Tier-2 step-up if protected, invalidates cache and records audit event in a transaction.
 */
export async function deleteSetting(
    context: PlatformAuthorizationContext,
    key: string,
    reason?: string,
    options?: RuntimeSettingLifecycleOptions
): Promise<void> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.CONFIG_UPDATE_SETTINGS);

    const settingKey = key.trim().toLowerCase();

    return prisma.$transaction(async (tx) => {
        const setting = await tx.platformRuntimeSetting.findUnique({ where: { key: settingKey } });
        if (!setting) {
            throw new PlatformRuntimeSettingNotFoundError(settingKey);
        }

        if (setting.isProtected || settingKey === "system.maintenance_mode") {
            verifyTier2Protection(context, settingKey, reason);
        }

        const previousState = {
            key: setting.key,
            value: setting.value,
            valueType: setting.valueType,
            isProtected: setting.isProtected,
            description: setting.description,
        };

        await tx.platformRuntimeSetting.delete({ where: { key: settingKey } });

        await recordPlatformAuditEvent({
            actor: context,
            action: PLATFORM_AUDIT_EVENTS.RUNTIME_SETTING_UPDATED,
            targetType: "CONFIG",
            targetId: setting.id,
            workspaceId: null,
            requestId: options?.requestId ?? `req_setting_del_${Date.now()}`,
            ipAddress: options?.ipAddress ?? "127.0.0.1",
            userAgent: options?.userAgent ?? null,
            reason: reason ?? null,
            previousState,
            newState: null,
            metadata: options?.metadata ?? null,
            tx,
        });

        invalidateRuntimeSettingCache(settingKey);
    });
}
