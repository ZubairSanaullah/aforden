import type {
    MembershipRole,
} from "@/generated/prisma/client";

import {
    ForbiddenError,
} from "./authorizationErrors";

import {
    ROLE_HIERARCHY,
} from "./roleHierarchy";

export function assertCanManageRole(
    actorRole: MembershipRole,
    targetRole: MembershipRole
): void {
    if (
        actorRole === "OWNER"
    ) {
        return;
    }

    if (
        actorRole !== "ADMIN"
    ) {
        throw new ForbiddenError(
            "Only an owner or administrator can manage member roles."
        );
    }

    if (
        targetRole === "OWNER"
    ) {
        throw new ForbiddenError(
            "Administrators cannot assign or manage the owner role."
        );
    }

    if (
        ROLE_HIERARCHY[targetRole] >=
        ROLE_HIERARCHY[actorRole]
    ) {
        throw new ForbiddenError(
            "You cannot assign a role equal to or higher than your own role."
        );
    }
}

export function assertCanChangeMemberRole(
    actorRole: MembershipRole,
    currentTargetRole: MembershipRole,
    newTargetRole: MembershipRole
): void {
    assertCanManageRole(
        actorRole,
        newTargetRole
    );

    if (
        actorRole !== "OWNER" &&
        ROLE_HIERARCHY[
        currentTargetRole
        ] >= ROLE_HIERARCHY[actorRole]
    ) {
        throw new ForbiddenError(
            "You cannot modify a member with an equal or higher role."
        );
    }
}