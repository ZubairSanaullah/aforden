import type {
    MembershipRole,
} from "@/generated/prisma/client";

import {
    ForbiddenError,
} from "./authorizationErrors";

import {
    roleHasMinimumLevel,
} from "./roleHierarchy";

export function assertMinimumRole(
    role: MembershipRole,
    minimumRole: MembershipRole
): void {
    if (
        !roleHasMinimumLevel(
            role,
            minimumRole
        )
    ) {
        throw new ForbiddenError(
            "You do not have the required workspace role."
        );
    }
}

export function assertOwner(
    role: MembershipRole
): void {
    if (role !== "OWNER") {
        throw new ForbiddenError(
            "Only the workspace owner can perform this action."
        );
    }
}

export function assertAdminOrOwner(
    role: MembershipRole
): void {
    if (
        role !== "OWNER" &&
        role !== "ADMIN"
    ) {
        throw new ForbiddenError(
            "Administrator or owner access is required."
        );
    }
}