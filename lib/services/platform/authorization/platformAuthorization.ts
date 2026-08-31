import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import {
    PlatformAuthorizationContext,
    PLATFORM_SESSION_IDLE_TIMEOUT_MS,
} from "./types";
import {
    PlatformUnauthorizedError,
    PlatformAccessDeniedError,
    PlatformAdminInactiveError,
    PlatformSessionExpiredError,
} from "./platformErrors";
import { PlatformPermission } from "./platformPermissions";
import {
    assertPlatformPermission,
    assertAllPlatformPermissions,
    assertAnyPlatformPermission,
} from "./platformPermissionService";

export interface RequirePlatformAuthorizationOptions {
    requireAll?: boolean;
    skipIdleCheck?: boolean;
    skipTouch?: boolean;
}

/**
 * Updates PlatformAdminProfile.lastActiveAt asynchronously (fire-and-forget).
 * Failures are silently logged/caught to prevent slowing down or failing read requests.
 */
export async function touchPlatformAdminLastActive(profileId: string): Promise<void> {
    try {
        await prisma.platformAdminProfile.update({
            where: { id: profileId },
            data: { lastActiveAt: new Date() },
        });
    } catch {
        // Fire-and-forget: do not propagate background touch failure
    }
}

/**
 * Resolves the PlatformAuthorizationContext for a given user ID or current NextAuth session.
 * This is the SOLE sanctioned reader of User.platformRole and PlatformAdminProfile.
 * Returns null if the user is unauthenticated or not an active platform operator.
 */
export async function getPlatformAuthorizationContext(
    userId?: string,
    options?: { skipIdleCheck?: boolean; skipTouch?: boolean }
): Promise<PlatformAuthorizationContext | null> {
    let resolvedUserId = userId;

    if (!resolvedUserId) {
        const session = await auth();
        if (!session?.user?.id) {
            return null;
        }
        resolvedUserId = session.user.id;
    }

    const user = await prisma.user.findUnique({
        where: { id: resolvedUserId },
        select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
            status: true,
            platformRole: true,
            platformAdminProfile: {
                select: {
                    id: true,
                    status: true,
                    lastActiveAt: true,
                    lastLoginAt: true,
                    stepUpConfirmedAt: true,
                    metadata: true,
                },
            },
        },
    });

    if (!user || user.status !== "ACTIVE" || !user.platformRole) {
        return null;
    }

    const profile = user.platformAdminProfile;
    if (!profile || profile.status !== "ACTIVE") {
        return null;
    }

    // 30-minute idle session check
    if (!options?.skipIdleCheck && profile.lastActiveAt) {
        const elapsedMs = Date.now() - new Date(profile.lastActiveAt).getTime();
        if (elapsedMs > PLATFORM_SESSION_IDLE_TIMEOUT_MS) {
            return null;
        }
    }

    // Touch lastActiveAt asynchronously
    if (!options?.skipTouch) {
        void touchPlatformAdminLastActive(profile.id);
    }

    return {
        userId: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        platformRole: user.platformRole,
        profileId: profile.id,
        status: profile.status,
        lastActiveAt: profile.lastActiveAt,
        lastLoginAt: profile.lastLoginAt,
        stepUpConfirmedAt: profile.stepUpConfirmedAt,
        metadata: profile.metadata as Record<string, unknown> | null,
    };
}

/**
 * Strict platform authorization pipeline guard for administrative route handlers.
 * 
 * Pipeline Flow (Phase 1.19.1 Section 10 Steps 2-3):
 * 1. Authenticate NextAuth database session (throws PlatformUnauthorizedError if no session).
 * 2. Resolve User & PlatformAdminProfile (throws uniform PlatformAccessDeniedError if non-platform / missing).
 * 3. Enforce 30-minute idle session expiration (throws PlatformSessionExpiredError if exceeded).
 * 4. Verify specific requested permission(s) via assertPlatformPermission (throws PlatformAccessDeniedError if unauthorized).
 * 5. Return fully populated, type-safe PlatformAuthorizationContext.
 */
export async function requirePlatformAuthorization(
    options?: RequirePlatformAuthorizationOptions
): Promise<PlatformAuthorizationContext>;
export async function requirePlatformAuthorization(
    permission: PlatformPermission,
    options?: RequirePlatformAuthorizationOptions
): Promise<PlatformAuthorizationContext>;
export async function requirePlatformAuthorization(
    permissions: readonly PlatformPermission[],
    options?: RequirePlatformAuthorizationOptions
): Promise<PlatformAuthorizationContext>;
export async function requirePlatformAuthorization(
    permissionOrPermissionsOrOptions?:
        | PlatformPermission
        | readonly PlatformPermission[]
        | RequirePlatformAuthorizationOptions,
    maybeOptions?: RequirePlatformAuthorizationOptions
): Promise<PlatformAuthorizationContext> {
    let permissions: readonly PlatformPermission[] | null = null;
    let options: RequirePlatformAuthorizationOptions | undefined = maybeOptions;

    if (typeof permissionOrPermissionsOrOptions === "string") {
        permissions = [permissionOrPermissionsOrOptions];
    } else if (Array.isArray(permissionOrPermissionsOrOptions)) {
        permissions = permissionOrPermissionsOrOptions;
    } else if (
        permissionOrPermissionsOrOptions &&
        typeof permissionOrPermissionsOrOptions === "object"
    ) {
        options = permissionOrPermissionsOrOptions as RequirePlatformAuthorizationOptions;
    }

    const session = await auth();
    if (!session?.user?.id) {
        throw new PlatformUnauthorizedError();
    }

    const user = await prisma.user.findUnique({
        where: { id: session.user.id },
        select: {
            id: true,
            name: true,
            email: true,
            avatarUrl: true,
            status: true,
            platformRole: true,
            platformAdminProfile: {
                select: {
                    id: true,
                    status: true,
                    lastActiveAt: true,
                    lastLoginAt: true,
                    stepUpConfirmedAt: true,
                    metadata: true,
                },
            },
        },
    });

    // Enumeration-resistant denial: missing user or non-platform user returns identical PlatformAccessDeniedError
    if (!user || user.status !== "ACTIVE" || !user.platformRole) {
        throw new PlatformAccessDeniedError();
    }

    const profile = user.platformAdminProfile;
    if (!profile) {
        throw new PlatformAccessDeniedError();
    }

    if (profile.status !== "ACTIVE") {
        throw new PlatformAdminInactiveError(profile.status);
    }

    // 30-minute idle timeout enforcement
    if (!options?.skipIdleCheck && profile.lastActiveAt) {
        const elapsedMs = Date.now() - new Date(profile.lastActiveAt).getTime();
        if (elapsedMs > PLATFORM_SESSION_IDLE_TIMEOUT_MS) {
            throw new PlatformSessionExpiredError();
        }
    }

    // Touch lastActiveAt asynchronously
    if (!options?.skipTouch) {
        void touchPlatformAdminLastActive(profile.id);
    }

    const context: PlatformAuthorizationContext = {
        userId: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
        platformRole: user.platformRole,
        profileId: profile.id,
        status: profile.status,
        lastActiveAt: profile.lastActiveAt,
        lastLoginAt: profile.lastLoginAt,
        stepUpConfirmedAt: profile.stepUpConfirmedAt,
        metadata: profile.metadata as Record<string, unknown> | null,
    };

    // Evaluate permissions if requested
    if (permissions && permissions.length > 0) {
        if (permissions.length === 1) {
            assertPlatformPermission(context, permissions[0]);
        } else if (options?.requireAll) {
            assertAllPlatformPermissions(context, permissions);
        } else {
            assertAnyPlatformPermission(context, permissions);
        }
    }

    return context;
}

export const requirePlatformPermission = requirePlatformAuthorization;
