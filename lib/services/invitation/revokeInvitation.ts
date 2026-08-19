import { prisma } from "@/lib/prisma";

import {
    requireWorkspaceAuthorization,
} from "@/lib/services/authorization/workspaceAuthorization";

import {
    PERMISSIONS,
} from "@/lib/services/authorization/permissions";

import {
    assertPermission,
} from "@/lib/services/authorization/permissionService";

import {
    WorkspaceAccessDeniedError,
} from "@/lib/services/authorization/authorizationErrors";

import {
    InvitationNotFoundError,
    InvitationAlreadyAcceptedError,
    InvitationRevokedError,
} from "./invitationErrors";

import type { MembershipRole } from "@/generated/prisma/client";

interface RevokeInvitationResult {
    id: string;
    workspaceId: string;
    email: string;
    role: MembershipRole;
    revokedAt: Date;
}

/**
 * Revokes (cancels) a workspace invitation.
 *
 * Security guarantees:
 *   - Caller must be an authenticated, active workspace member
 *     with MEMBERS_INVITE permission (OWNER or ADMIN).
 *   - Invitation is looked up by id AND workspaceId — tenant
 *     isolation prevents cross-workspace revocation.
 *   - Only pending (not accepted, not already revoked) invitations
 *     can be revoked.
 *   - Setting revokedAt makes the invitation token permanently
 *     unusable — acceptance after revocation is blocked by
 *     acceptInvitation's revokedAt check.
 */
export async function revokeInvitation(
    workspaceId: string,
    invitationId: string,
): Promise<RevokeInvitationResult> {
    // --- Authorization ---
    const authorization = await requireWorkspaceAuthorization(
        workspaceId,
    );

    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_INVITE,
    );

    // --- Fetch invitation (tenant-scoped) ---
    const existing = await prisma.workspaceInvitation.findUnique({
        where: { id: invitationId },
        select: {
            id: true,
            workspaceId: true,
            email: true,
            role: true,
            acceptedAt: true,
            revokedAt: true,
        },
    });

    if (!existing) {
        throw new InvitationNotFoundError();
    }

    // --- Tenant isolation ---
    if (existing.workspaceId !== workspaceId) {
        throw new WorkspaceAccessDeniedError();
    }

    if (existing.acceptedAt) {
        throw new InvitationAlreadyAcceptedError(
            "This invitation has already been accepted and cannot be cancelled.",
        );
    }

    if (existing.revokedAt) {
        throw new InvitationRevokedError(
            "This invitation has already been cancelled.",
        );
    }

    // --- Revoke ---
    const revokedAt = new Date();

    await prisma.workspaceInvitation.update({
        where: { id: invitationId },
        data: { revokedAt },
    });

    return {
        id: existing.id,
        workspaceId: existing.workspaceId,
        email: existing.email,
        role: existing.role,
        revokedAt,
    };
}
