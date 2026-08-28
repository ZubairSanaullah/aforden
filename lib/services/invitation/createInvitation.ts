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
    assertCanManageRole,
} from "@/lib/services/authorization/membershipRoleService";

import {
    generateInvitationToken,
    hashInvitationToken,
    createInvitationExpiry,
} from "./invitationToken";

import {
    createInvitationAcceptUrl,
} from "./invitationUrl";

import {
    InvitationAlreadyMemberError,
    InvitationRateLimitError,
} from "./invitationErrors";

import { assertEntitlement } from "@/lib/services/billing/entitlementResolver";

import {
    checkInvitationCreateRateLimit,
} from "./invitationRateLimit";

import {
    sendEmail,
} from "@/lib/services/email/sendEmail";

import {
    createInvitationEmail,
} from "@/lib/services/email/templates/invitation";

import type { MembershipRole } from "@/generated/prisma/client";

interface CreateInvitationInput {
    email: string; // already normalized (lowercase) by Zod schema
    role: MembershipRole;
}

interface CreateInvitationOptions {
    /** Raw IP address of the request for rate limiting. */
    ipAddress: string;
}

interface InvitationResult {
    id: string;
    workspaceId: string;
    email: string;
    role: MembershipRole;
    expiresAt: Date;
    createdAt: Date;
}

/**
 * Creates a workspace invitation.
 *
 * Security guarantees:
 *   - Inviter must be an authenticated, active workspace member.
 *   - Inviter must have MEMBERS_INVITE permission (OWNER or ADMIN).
 *   - Inviter cannot assign a role equal to or higher than their own
 *     (assertCanManageRole enforcement).
 *   - Raw token is never stored — only the SHA-256 hash.
 *   - If a pending invitation already exists for workspace+email,
 *     it is atomically invalidated and replaced (resend semantics).
 *     This prevents multiple active tokens for the same invitation.
 *   - If the email is already an active workspace member, the invitation
 *     is rejected to prevent duplicate membership creation.
 *   - Rate limited per email, per workspace, and per IP.
 */
export async function createInvitation(
    workspaceId: string,
    input: CreateInvitationInput,
    options: CreateInvitationOptions,
): Promise<InvitationResult> {
    // --- Defensive normalization ---
    // The Zod schema normalizes email at route level, but services
    // should be defensive (consistent with requestPasswordReset.ts pattern).
    const normalizedEmail = input.email.trim().toLowerCase();

    // --- Rate limiting ---
    const rateLimit = checkInvitationCreateRateLimit(
        normalizedEmail,
        workspaceId,
        options.ipAddress,
    );

    if (!rateLimit.allowed) {
        throw new InvitationRateLimitError(rateLimit.retryAfterSeconds);
    }

    // --- Authorization ---
    // requireWorkspaceAuthorization: verifies session, user ACTIVE,
    // workspace exists, and caller has an ACTIVE membership.
    const authorization = await requireWorkspaceAuthorization(
        workspaceId,
    );

    assertPermission(
        authorization.membership.role,
        PERMISSIONS.MEMBERS_INVITE,
    );

    // --- Role escalation prevention ---
    // assertCanManageRole throws ForbiddenError if the inviter is
    // trying to assign a role >= their own.
    assertCanManageRole(
        authorization.membership.role,
        input.role,
    );

    // --- Existing membership check ---
    const existingMember = await prisma.workspaceMember.findFirst({
        where: {
            workspaceId,
            status: "ACTIVE",
            user: {
                email: normalizedEmail,
            },
        },
        select: { id: true },
    });

    if (existingMember) {
        throw new InvitationAlreadyMemberError();
    }

    // --- Token generation ---
    const rawToken = generateInvitationToken();
    const tokenHash = hashInvitationToken(rawToken);
    const expiresAt = createInvitationExpiry();

    // --- Atomic: revoke existing pending invitation + create new ---
    // If a pending invitation already exists for this workspace+email,
    // we invalidate it by setting revokedAt. This ensures only one
    // active token exists at a time, preventing ambiguous acceptance.
    const runTx =
        typeof prisma.$transaction === "function"
            ? (cb: (tx: any) => Promise<any>) => prisma.$transaction(cb)
            : async (cb: (tx: any) => Promise<any>) => cb(prisma);

    const invitation = await runTx(async (tx) => {
        // Phase 1.15.5: Assert MAX_MEMBERS quota inside the transaction to prevent
        // TOCTOU races — the count query and the insert happen atomically.
        await assertEntitlement(tx, workspaceId, "MAX_MEMBERS");

        await tx.workspaceInvitation.updateMany({
            where: {
                workspaceId,
                email: normalizedEmail,
                acceptedAt: null,
                revokedAt: null,
            },
            data: {
                revokedAt: new Date(),
            },
        });

        return tx.workspaceInvitation.create({
            data: {
                workspaceId,
                email: normalizedEmail,
                invitedById: authorization.user.id,
                role: input.role,
                tokenHash,
                expiresAt,
            },
            select: {
                id: true,
                workspaceId: true,
                email: true,
                role: true,
                expiresAt: true,
                createdAt: true,
            },
        });
    });

    // --- Email ---
    // Email failure is logged but does NOT roll back the invitation.
    // The inviter can safely resend if delivery fails.
    const acceptUrl = createInvitationAcceptUrl(rawToken);

    const emailContent = createInvitationEmail({
        workspaceName: authorization.workspace.name,
        inviterName: authorization.user.name || "A team member",
        recipientEmail: normalizedEmail,
        role: input.role,
        acceptUrl,
        expiresAt,
    });

    try {
        await sendEmail({
            to: { email: normalizedEmail },
            subject: emailContent.subject,
            html: emailContent.html,
            text: emailContent.text,
        });
    } catch (error) {
        console.error(
            "[Aforden] Invitation email delivery failed for invitation",
            invitation.id,
            error,
        );
        // Invitation persists — the inviter can resend via the API.
    }

    return invitation;
}
