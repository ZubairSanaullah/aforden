import { PlatformRole, PlatformAuthorizationContext } from "./types";
import { PlatformPermission } from "./platformPermissions";
import { PLATFORM_ROLE_PERMISSIONS } from "./platformRolePermissions";
import { PlatformAccessDeniedError } from "./platformErrors";

/**
 * Pure function: checks if a PlatformRole contains a specific platform permission.
 * Zero database calls.
 */
export function platformRoleHasPermission(
    role: PlatformRole,
    permission: PlatformPermission
): boolean {
    const permissions = PLATFORM_ROLE_PERMISSIONS[role];
    if (!permissions) {
        return false;
    }
    return permissions.includes(permission);
}

/**
 * Pure function: checks if a PlatformRole contains at least one of the specified permissions.
 */
export function platformRoleHasAnyPermission(
    role: PlatformRole,
    permissions: readonly PlatformPermission[]
): boolean {
    return permissions.some((permission) =>
        platformRoleHasPermission(role, permission)
    );
}

/**
 * Pure function: checks if a PlatformRole contains all of the specified permissions.
 */
export function platformRoleHasAllPermissions(
    role: PlatformRole,
    permissions: readonly PlatformPermission[]
): boolean {
    return permissions.every((permission) =>
        platformRoleHasPermission(role, permission)
    );
}

/**
 * Checks if a PlatformAuthorizationContext has a specific platform permission.
 * Fails closed (returns false) if context is null, undefined, or lacks the permission.
 */
export function hasPlatformPermission(
    context: PlatformAuthorizationContext | null | undefined,
    permission: PlatformPermission
): boolean {
    if (!context || !context.platformRole) {
        return false;
    }
    return platformRoleHasPermission(context.platformRole, permission);
}

/**
 * Checks if a PlatformAuthorizationContext has any of the specified platform permissions.
 * Fails closed (returns false) if context is null, undefined, or lacks all permissions.
 */
export function hasAnyPlatformPermission(
    context: PlatformAuthorizationContext | null | undefined,
    permissions: readonly PlatformPermission[]
): boolean {
    if (!context || !context.platformRole) {
        return false;
    }
    return platformRoleHasAnyPermission(context.platformRole, permissions);
}

/**
 * Checks if a PlatformAuthorizationContext has all of the specified platform permissions.
 * Fails closed (returns false) if context is null, undefined, or lacks any permission.
 */
export function hasAllPlatformPermissions(
    context: PlatformAuthorizationContext | null | undefined,
    permissions: readonly PlatformPermission[]
): boolean {
    if (!context || !context.platformRole) {
        return false;
    }
    return platformRoleHasAllPermissions(context.platformRole, permissions);
}

/**
 * Helper to extract PlatformRole from either a PlatformAuthorizationContext, a raw PlatformRole string, or null/undefined.
 */
function resolveRole(
    contextOrRole: PlatformAuthorizationContext | PlatformRole | null | undefined
): PlatformRole | null {
    if (!contextOrRole) {
        return null;
    }
    if (typeof contextOrRole === "string") {
        return contextOrRole as PlatformRole;
    }
    return contextOrRole.platformRole || null;
}

/**
 * Asserts that a context or role holds the required platform permission.
 * Fails closed: throws PlatformAccessDeniedError if context/role is missing or lacks permission.
 * Pure function: zero database queries.
 */
export function assertPlatformPermission(
    contextOrRole: PlatformAuthorizationContext | PlatformRole | null | undefined,
    permission: PlatformPermission
): void {
    const role = resolveRole(contextOrRole);
    if (!role) {
        throw new PlatformAccessDeniedError(
            "Access denied: platform authorization context required"
        );
    }
    if (!platformRoleHasPermission(role, permission)) {
        throw new PlatformAccessDeniedError(
            `Access denied: role '${role}' lacks required permission '${permission}'`
        );
    }
}

/**
 * Asserts that a context or role holds at least one of the specified platform permissions.
 */
export function assertAnyPlatformPermission(
    contextOrRole: PlatformAuthorizationContext | PlatformRole | null | undefined,
    permissions: readonly PlatformPermission[]
): void {
    const role = resolveRole(contextOrRole);
    if (!role) {
        throw new PlatformAccessDeniedError(
            "Access denied: platform authorization context required"
        );
    }
    if (!platformRoleHasAnyPermission(role, permissions)) {
        throw new PlatformAccessDeniedError(
            `Access denied: role '${role}' lacks at least one of required permissions [${permissions.join(", ")}]`
        );
    }
}

/**
 * Asserts that a context or role holds all of the specified platform permissions.
 */
export function assertAllPlatformPermissions(
    contextOrRole: PlatformAuthorizationContext | PlatformRole | null | undefined,
    permissions: readonly PlatformPermission[]
): void {
    const role = resolveRole(contextOrRole);
    if (!role) {
        throw new PlatformAccessDeniedError(
            "Access denied: platform authorization context required"
        );
    }
    if (!platformRoleHasAllPermissions(role, permissions)) {
        throw new PlatformAccessDeniedError(
            `Access denied: role '${role}' lacks all required permissions [${permissions.join(", ")}]`
        );
    }
}
