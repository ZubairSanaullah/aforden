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

import type { MembershipRole } from "@/generated/prisma/client";

interface InvitationListItem {
    id: string;
    workspaceId: string;
    email: string;
    role: MembershipRole;
    invitedById: string;
    inviterName: string | null;
    expiresAt: Date;
    createdAt: Date;
    /** Derived status for convenience. */
    status: "pending" | "expired";
}

/**
 * Lists pending and expired (not yet accepted/revoked) invitations
 * for a workspace.
 *
 * Security guarantees:
 *   - Caller must be an authenticated, active workspace member.
 *   - Caller must have MEMBERS_VIEW permission.
 *   - Results are strictly scoped to the requested workspaceId —
 *     no cross-workspace data is ever returned.
 *   - tokenHash is never included in results.
 */
export async function listInvitations(
    workspaceId: string,
): Promise<InvitationListItem[]> {
    const authorization = await requireWorkspaceAuthorization(
        workspaceId,
    );

    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_VIEW,
    );

    const invitations = await prisma.workspaceInvitation.findMany({
        where: {
            workspaceId,
            acceptedAt: null,
            revokedAt: null,
        },
        select: {
            id: true,
            workspaceId: true,
            email: true,
            role: true,
            invitedById: true,
            invitedBy: {
                select: {
                    name: true,
                },
            },
            expiresAt: true,
            createdAt: true,
        },
        orderBy: {
            createdAt: "desc",
        },
    });

    const now = Date.now();

    return invitations.map((inv) => ({
        id: inv.id,
        workspaceId: inv.workspaceId,
        email: inv.email,
        role: inv.role,
        invitedById: inv.invitedById,
        inviterName: inv.invitedBy.name,
        expiresAt: inv.expiresAt,
        createdAt: inv.createdAt,
        status:
            inv.expiresAt.getTime() <= now ? "expired" : "pending",
    }));
}
