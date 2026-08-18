import type {
    MembershipRole,
} from "@/generated/prisma/client";

import {
    ForbiddenError,
} from "./authorizationErrors";

import {
    ROLE_PERMISSIONS,
} from "./rolePermissions";

import type {
    Permission,
} from "./permissions";

export function roleHasPermission(
    role: MembershipRole,
    permission: Permission
): boolean {
    return ROLE_PERMISSIONS[
        role
    ].includes(permission);
}

export function roleHasAnyPermission(
    role: MembershipRole,
    permissions: readonly Permission[]
): boolean {
    return permissions.some(
        (permission) =>
            roleHasPermission(
                role,
                permission
            )
    );
}

export function roleHasAllPermissions(
    role: MembershipRole,
    permissions: readonly Permission[]
): boolean {
    return permissions.every(
        (permission) =>
            roleHasPermission(
                role,
                permission
            )
    );
}

export function assertPermission(
    role: MembershipRole,
    permission: Permission
): void {
    if (
        !roleHasPermission(
            role,
            permission
        )
    ) {
        throw new ForbiddenError(
            "You do not have permission to perform this action."
        );
    }
}

export function assertAnyPermission(
    role: MembershipRole,
    permissions: readonly Permission[]
): void {
    if (
        !roleHasAnyPermission(
            role,
            permissions
        )
    ) {
        throw new ForbiddenError(
            "You do not have permission to perform this action."
        );
    }
}

export function assertAllPermissions(
    role: MembershipRole,
    permissions: readonly Permission[]
): void {
    if (
        !roleHasAllPermissions(
            role,
            permissions
        )
    ) {
        throw new ForbiddenError(
            "You do not have permission to perform this action."
        );
    }
}