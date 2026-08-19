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
    generateInvitationToken,
    hashInvitationToken,
    createInvitationExpiry,
} from "./invitationToken";

import {
    createInvitationAcceptUrl,
} from "./invitationUrl";

import {
    InvitationNotFoundError,
    InvitationAlreadyAcceptedError,
    InvitationRevokedError,
} from "./invitationErrors";

import {
    sendEmail,
} from "@/lib/services/email/sendEmail";

import {
    createInvitationEmail,
} from "@/lib/services/email/templates/invitation";

import type { MembershipRole } from "@/generated/prisma/client";

interface ResendInvitationResult {
    id: string;
    workspaceId: string;
    email: string;
    role: MembershipRole;
    expiresAt: Date;
    updatedAt: Date;
}

/**
 * Resends a workspace invitation by generating a new secure token
 * and refreshing the expiration.
 *
 * Security guarantees:
 *   - Caller must be an authenticated, active workspace member
 *     with MEMBERS_INVITE permission.
 *   - Invitation is looked up by both id AND workspaceId — this
 *     enforces tenant isolation: an admin of workspace A cannot
 *     resend an invitation belonging to workspace B.
 *   - The old token is immediately invalidated (tokenHash replaced).
 *     Any link containing the previous token will no longer work.
 *   - Only a raw token is placed in the email; the hash is stored.
 *   - Only pending invitations can be resent (not accepted or revoked).
 *   - Expired invitations receive a fresh token + extended expiry.
 */
export async function resendInvitation(
    workspaceId: string,
    invitationId: string,
): Promise<ResendInvitationResult> {
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
    // Ensure the invitation belongs to the authorized workspace.
    if (existing.workspaceId !== workspaceId) {
        throw new WorkspaceAccessDeniedError();
    }

    if (existing.acceptedAt) {
        throw new InvitationAlreadyAcceptedError(
            "This invitation has already been accepted and cannot be resent.",
        );
    }

    if (existing.revokedAt) {
        throw new InvitationRevokedError(
            "This invitation has been cancelled and cannot be resent.",
        );
    }

    // --- New token ---
    // Generate before the DB write so the raw token is available
    // for the email immediately after the update commits.
    const rawToken = generateInvitationToken();
    const tokenHash = hashInvitationToken(rawToken);
    const expiresAt = createInvitationExpiry();

    // --- Atomic update ---
    const updated = await prisma.workspaceInvitation.update({
        where: { id: invitationId },
        data: {
            tokenHash,
            expiresAt,
        },
        select: {
            id: true,
            workspaceId: true,
            email: true,
            role: true,
            expiresAt: true,
            updatedAt: true,
        },
    });

    // --- Email ---
    const acceptUrl = createInvitationAcceptUrl(rawToken);

    const emailContent = createInvitationEmail({
        workspaceName: authorization.workspace.name,
        inviterName: authorization.user.name || "A team member",
        recipientEmail: existing.email,
        role: existing.role,
        acceptUrl,
        expiresAt,
    });

    try {
        await sendEmail({
            to: { email: existing.email },
            subject: emailContent.subject,
            html: emailContent.html,
            text: emailContent.text,
        });
    } catch (error) {
        console.error(
            "[Aforden] Resend invitation email delivery failed for invitation",
            invitationId,
            error,
        );
        // The new token is already active. The inviter can call resend
        // again if needed.
    }

    return updated;
}
