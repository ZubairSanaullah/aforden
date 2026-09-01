import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import {
    PlatformAuthorizationContext,
    PLATFORM_PERMISSIONS,
    assertPlatformPermission,
} from "../authorization";
import { assertTier2StepUpAuthenticated } from "../workspaces";
import {
    recordPlatformAuditEvent,
    PLATFORM_AUDIT_EVENTS,
} from "../audit";
import {
    PlatformFeatureFlagDto,
    CreateFeatureFlagInput,
    UpdateFeatureFlagInput,
    FeatureFlagEvaluationTarget,
    FeatureFlagFilterOptions,
    FeatureFlagLifecycleOptions,
} from "./types";
import {
    PlatformFeatureFlagNotFoundError,
    PlatformFeatureFlagConflictError,
    PlatformFeatureFlagValidationError,
} from "./errors";

// =========================================================================
// In-Memory Performance Caching & Deterministic Hash Bucket
// =========================================================================

interface CachedFlagEntry {
    flag: any;
    expiresAt: number;
}

const flagCache = new Map<string, CachedFlagEntry>();
const FLAG_CACHE_TTL_MS = 10_000; // 10-second TTL cache for hot paths

/**
 * Invalidates local in-memory feature flag cache.
 */
export function invalidateFeatureFlagCache(flagKey?: string): void {
    if (flagKey) {
        flagCache.delete(flagKey);
    } else {
        flagCache.clear();
    }
}

/**
 * Computes a stable, deterministic 32-bit hash bucket (0-99) for percentage rollouts.
 * Guarantees that the same (flagKey, targetId) pair ALWAYS maps to the identical bucket value.
 */
export function getStableHashBucket(flagKey: string, targetId: string): number {
    const combined = `${flagKey}:${targetId}`;
    let hash = 0;
    for (let i = 0; i < combined.length; i++) {
        hash = (hash << 5) - hash + combined.charCodeAt(i);
        hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash) % 100;
}

/**
 * Maps raw database PlatformFeatureFlag entity into sanitized PlatformFeatureFlagDto.
 */
function mapToPlatformFeatureFlagDto(flag: any): PlatformFeatureFlagDto {
    return {
        id: flag.id,
        key: flag.key,
        name: flag.name,
        description: flag.description ?? null,
        enabled: flag.enabled,
        defaultValue: flag.defaultValue,
        rolloutPercentage: flag.rolloutPercentage ?? 100,
        allowedWorkspaceIds: flag.allowedWorkspaceIds ?? [],
        metadata: (flag.metadata as Record<string, unknown> | null) ?? null,
        createdAt: flag.createdAt,
        updatedAt: flag.updatedAt,
    };
}

// =========================================================================
// Performant & Safe Flag Evaluation API
// =========================================================================

/**
 * Evaluates whether a feature flag is enabled for a given target context.
 * 
 * Invariants & Guarantees:
 * - Deterministic Evaluation: Percentage rollouts use a stable hash bucket modulo 100 (no Math.random).
 * - Safe Fallback: Traps all internal DB errors, missing flag keys, and malformed inputs, returning false (or fallback).
 * - Hot Path Caching: Uses a 10s in-memory TTL cache to minimize database roundtrips.
 */
export async function isFeatureEnabled(
    flagKey: string,
    target?: FeatureFlagEvaluationTarget,
    options?: { fallback?: boolean }
): Promise<boolean> {
    const defaultFallback = options?.fallback ?? false;

    try {
        if (!flagKey || typeof flagKey !== "string") {
            return defaultFallback;
        }

        const now = Date.now();
        let flag: any = null;

        // Check in-memory cache
        const cached = flagCache.get(flagKey);
        if (cached && cached.expiresAt > now) {
            flag = cached.flag;
        } else {
            flag = await prisma.platformFeatureFlag.findUnique({
                where: { key: flagKey },
            });
            if (flag) {
                flagCache.set(flagKey, {
                    flag,
                    expiresAt: now + FLAG_CACHE_TTL_MS,
                });
            }
        }

        if (!flag) {
            return defaultFallback;
        }

        // Rule 1: Master Global Toggle
        if (!flag.enabled) {
            return flag.defaultValue ?? false;
        }

        // Rule 2: Workspace Target Evaluation
        if (target?.workspaceId) {
            const wsId = target.workspaceId;

            // Rule 2a: Explicit Workspace Allowlist Override
            if (
                Array.isArray(flag.allowedWorkspaceIds) &&
                flag.allowedWorkspaceIds.includes(wsId)
            ) {
                return true;
            }

            // Rule 2b: Deterministic Percentage Rollout
            const rollout = flag.rolloutPercentage ?? 100;
            if (rollout <= 0) return false;
            if (rollout >= 100) return true;

            const bucket = getStableHashBucket(flagKey, wsId);
            return bucket < rollout;
        }

        // Rule 3: Global Evaluation when no workspace target is supplied
        const globalRollout = flag.rolloutPercentage ?? 100;
        return globalRollout >= 100 ? true : (flag.defaultValue ?? false);
    } catch {
        // Safe Fallback: Error in flag evaluation traps exception and returns safe fallback
        return defaultFallback;
    }
}

// =========================================================================
// Platform Administration CRUD & Audit Integration
// =========================================================================

/**
 * Creates a new platform feature flag (Phase 1.19.10).
 * Gated by platform.config.manage_flags.
 * Logs FEATURE_FLAG_CREATED audit event.
 */
export async function createFeatureFlag(
    context: PlatformAuthorizationContext,
    input: CreateFeatureFlagInput,
    reason?: string,
    options?: FeatureFlagLifecycleOptions
): Promise<PlatformFeatureFlagDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.CONFIG_MANAGE_FLAGS);

    if (!input.key || !/^[a-z0-9_\-\.]+$/i.test(input.key)) {
        throw new PlatformFeatureFlagValidationError(
            "Flag key must contain only letters, numbers, underscores, hyphens, or dots."
        );
    }
    if (!input.name || input.name.trim().length === 0) {
        throw new PlatformFeatureFlagValidationError("Flag name is required.");
    }
    if (
        input.rolloutPercentage !== undefined &&
        input.rolloutPercentage !== null &&
        (input.rolloutPercentage < 0 || input.rolloutPercentage > 100)
    ) {
        throw new PlatformFeatureFlagValidationError("Rollout percentage must be between 0 and 100.");
    }

    const key = input.key.trim().toLowerCase();

    return prisma.$transaction(async (tx) => {
        const existing = await tx.platformFeatureFlag.findUnique({ where: { key } });
        if (existing) {
            throw new PlatformFeatureFlagConflictError(key);
        }

        const flag = await tx.platformFeatureFlag.create({
            data: {
                key,
                name: input.name.trim(),
                description: input.description ?? null,
                enabled: input.enabled ?? false,
                defaultValue: input.defaultValue ?? false,
                rolloutPercentage: input.rolloutPercentage ?? 100,
                allowedWorkspaceIds: input.allowedWorkspaceIds ?? [],
                metadata: (input.metadata as Prisma.InputJsonValue) ?? Prisma.JsonNull,
            },
        });

        await recordPlatformAuditEvent({
            actor: context,
            action: PLATFORM_AUDIT_EVENTS.FEATURE_FLAG_CREATED,
            targetType: "FEATURE_FLAG",
            targetId: flag.id,
            workspaceId: null,
            requestId: options?.requestId ?? `req_flag_${Date.now()}`,
            ipAddress: options?.ipAddress ?? "127.0.0.1",
            userAgent: options?.userAgent ?? null,
            reason: reason ?? null,
            previousState: null,
            newState: {
                key: flag.key,
                enabled: flag.enabled,
                defaultValue: flag.defaultValue,
                rolloutPercentage: flag.rolloutPercentage,
                allowedWorkspaceIds: flag.allowedWorkspaceIds,
            },
            metadata: options?.metadata ?? null,
            tx,
        });

        invalidateFeatureFlagCache(key);
        return mapToPlatformFeatureFlagDto(flag);
    });
}

/**
 * Updates an existing feature flag's rules and properties (Phase 1.19.10).
 * Gated by platform.config.manage_flags.
 * Logs FEATURE_FLAG_UPDATED audit event.
 */
export async function updateFeatureFlag(
    context: PlatformAuthorizationContext,
    flagKey: string,
    input: UpdateFeatureFlagInput,
    reason?: string,
    options?: FeatureFlagLifecycleOptions
): Promise<PlatformFeatureFlagDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.CONFIG_MANAGE_FLAGS);

    if (
        input.rolloutPercentage !== undefined &&
        input.rolloutPercentage !== null &&
        (input.rolloutPercentage < 0 || input.rolloutPercentage > 100)
    ) {
        throw new PlatformFeatureFlagValidationError("Rollout percentage must be between 0 and 100.");
    }

    return prisma.$transaction(async (tx) => {
        const flag = await tx.platformFeatureFlag.findUnique({ where: { key: flagKey } });
        if (!flag) {
            throw new PlatformFeatureFlagNotFoundError(flagKey);
        }

        const previousState = {
            name: flag.name,
            description: flag.description,
            defaultValue: flag.defaultValue,
            rolloutPercentage: flag.rolloutPercentage,
            allowedWorkspaceIds: flag.allowedWorkspaceIds,
        };

        const updated = await tx.platformFeatureFlag.update({
            where: { key: flagKey },
            data: {
                name: input.name !== undefined ? input.name.trim() : flag.name,
                description: input.description !== undefined ? input.description : flag.description,
                defaultValue: input.defaultValue !== undefined ? input.defaultValue : flag.defaultValue,
                rolloutPercentage: input.rolloutPercentage !== undefined ? input.rolloutPercentage : flag.rolloutPercentage,
                allowedWorkspaceIds: input.allowedWorkspaceIds ? input.allowedWorkspaceIds : flag.allowedWorkspaceIds,
                metadata: input.metadata !== undefined
                    ? (input.metadata ? (input.metadata as Prisma.InputJsonValue) : Prisma.JsonNull)
                    : (flag.metadata ? (flag.metadata as Prisma.InputJsonValue) : Prisma.JsonNull),
            },
        });


        const newState = {
            name: updated.name,
            description: updated.description,
            defaultValue: updated.defaultValue,
            rolloutPercentage: updated.rolloutPercentage,
            allowedWorkspaceIds: updated.allowedWorkspaceIds,
        };

        await recordPlatformAuditEvent({
            actor: context,
            action: PLATFORM_AUDIT_EVENTS.FEATURE_FLAG_UPDATED,
            targetType: "FEATURE_FLAG",
            targetId: flag.id,
            workspaceId: null,
            requestId: options?.requestId ?? `req_flag_upd_${Date.now()}`,
            ipAddress: options?.ipAddress ?? "127.0.0.1",
            userAgent: options?.userAgent ?? null,
            reason: reason ?? null,
            previousState,
            newState,
            metadata: options?.metadata ?? null,
            tx,
        });

        invalidateFeatureFlagCache(flagKey);
        return mapToPlatformFeatureFlagDto(updated);
    });
}

/**
 * Toggles a feature flag's master enabled status ON or OFF (Phase 1.19.10).
 * Gated by platform.config.manage_flags.
 * Logs FEATURE_FLAG_TOGGLED audit event.
 */
export async function toggleFeatureFlag(
    context: PlatformAuthorizationContext,
    flagKey: string,
    enabled: boolean,
    reason?: string,
    options?: FeatureFlagLifecycleOptions
): Promise<PlatformFeatureFlagDto> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.CONFIG_MANAGE_FLAGS);

    return prisma.$transaction(async (tx) => {
        const flag = await tx.platformFeatureFlag.findUnique({ where: { key: flagKey } });
        if (!flag) {
            throw new PlatformFeatureFlagNotFoundError(flagKey);
        }

        const previousState = { enabled: flag.enabled };

        const updated = await tx.platformFeatureFlag.update({
            where: { key: flagKey },
            data: { enabled },
        });

        await recordPlatformAuditEvent({
            actor: context,
            action: PLATFORM_AUDIT_EVENTS.FEATURE_FLAG_TOGGLED,
            targetType: "FEATURE_FLAG",
            targetId: flag.id,
            workspaceId: null,
            requestId: options?.requestId ?? `req_flag_toggle_${Date.now()}`,
            ipAddress: options?.ipAddress ?? "127.0.0.1",
            userAgent: options?.userAgent ?? null,
            reason: reason ?? null,
            previousState,
            newState: { enabled: updated.enabled },
            metadata: options?.metadata ?? null,
            tx,
        });

        invalidateFeatureFlagCache(flagKey);
        return mapToPlatformFeatureFlagDto(updated);
    });
}

/**
 * Deletes a feature flag from the system (Phase 1.19.10).
 * Gated by platform.config.manage_flags.
 * Logs FEATURE_FLAG_DELETED audit event.
 */
export async function deleteFeatureFlag(
    context: PlatformAuthorizationContext,
    flagKey: string,
    reason?: string,
    options?: FeatureFlagLifecycleOptions
): Promise<void> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.CONFIG_MANAGE_FLAGS);
    assertTier2StepUpAuthenticated(context);

    return prisma.$transaction(async (tx) => {
        const flag = await tx.platformFeatureFlag.findUnique({ where: { key: flagKey } });
        if (!flag) {
            throw new PlatformFeatureFlagNotFoundError(flagKey);
        }

        const previousState = {
            key: flag.key,
            name: flag.name,
            enabled: flag.enabled,
            defaultValue: flag.defaultValue,
            rolloutPercentage: flag.rolloutPercentage,
            allowedWorkspaceIds: flag.allowedWorkspaceIds,
        };

        await tx.platformFeatureFlag.delete({ where: { key: flagKey } });

        await recordPlatformAuditEvent({
            actor: context,
            action: PLATFORM_AUDIT_EVENTS.FEATURE_FLAG_DELETED,
            targetType: "FEATURE_FLAG",
            targetId: flag.id,
            workspaceId: null,
            requestId: options?.requestId ?? `req_flag_del_${Date.now()}`,
            ipAddress: options?.ipAddress ?? "127.0.0.1",
            userAgent: options?.userAgent ?? null,
            reason: reason ?? null,
            previousState,
            newState: null,
            metadata: options?.metadata ?? null,
            tx,
        });

        invalidateFeatureFlagCache(flagKey);
    });
}


/**
 * Retrieves details for a single feature flag.
 * Gated by platform.config.view.
 */
export async function getFeatureFlag(
    context: PlatformAuthorizationContext,
    flagKey: string
): Promise<PlatformFeatureFlagDto | null> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.CONFIG_VIEW);

    const flag = await prisma.platformFeatureFlag.findUnique({ where: { key: flagKey } });
    if (!flag) {
        return null;
    }

    return mapToPlatformFeatureFlagDto(flag);
}

/**
 * Lists feature flags with filtering and pagination.
 * Gated by platform.config.view.
 */
export async function listFeatureFlags(
    context: PlatformAuthorizationContext,
    filters?: FeatureFlagFilterOptions
): Promise<{
    flags: PlatformFeatureFlagDto[];
    total: number;
}> {
    assertPlatformPermission(context, PLATFORM_PERMISSIONS.CONFIG_VIEW);

    const where: Prisma.PlatformFeatureFlagWhereInput = {};

    if (filters?.enabled !== undefined) {
        where.enabled = filters.enabled;
    }

    if (filters?.search) {
        where.OR = [
            { key: { contains: filters.search, mode: "insensitive" } },
            { name: { contains: filters.search, mode: "insensitive" } },
            { description: { contains: filters.search, mode: "insensitive" } },
        ];
    }

    const limit = Math.min(Math.max(filters?.limit ?? 50, 1), 200);
    const offset = Math.max(filters?.offset ?? 0, 0);

    const [flags, total] = await Promise.all([
        prisma.platformFeatureFlag.findMany({
            where,
            orderBy: { key: "asc" },
            take: limit,
            skip: offset,
        }),
        prisma.platformFeatureFlag.count({ where }),
    ]);

    return {
        flags: flags.map(mapToPlatformFeatureFlagDto),
        total,
    };
}
