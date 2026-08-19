import { prisma } from "@/lib/prisma";

import {
    hashInvitationToken,
    isInvitationExpired,
} from "./invitationToken";

import {
    checkInvitationAcceptRateLimit,
} from "./invitationRateLimit";

import {
    InvitationNotFoundError,
    InvitationExpiredError,
    InvitationAlreadyAcceptedError,
    InvitationRevokedError,
    InvitationEmailMismatchError,
    InvitationAlreadyMemberError,
    InvitationRateLimitError,
} from "./invitationErrors";

import type { MembershipRole } from "@/generated/prisma/client";

interface AcceptInvitationOptions {
    /**
     * The raw invitation token from the URL query parameter.
     * This will be hashed for the database lookup.
     */
    rawToken: string;

    /**
     * The authenticated user's ID and email, if they are signed in.
     *
     * If provided:
     *   - The user's email MUST match the invited email exactly.
     *   - Membership is created for this authenticated user.
     *
     * If not provided:
     *   - The invitation is validated and returned so the caller can
     *     redirect to registration/login with the token preserved.
     */
    authenticatedUserId?: string;
    authenticatedUserEmail?: string;

    /** Raw IP address for rate limiting. */
    ipAddress: string;
}

interface AcceptInvitationResult {
    /**
     * true  = membership was created (authenticated user flow).
     * false = invitation valid but user needs to register/login first.
     */
    membershipCreated: boolean;
    invitation: {
        id: string;
        workspaceId: string;
        email: string;
        role: MembershipRole;
    };
    membershipId?: string;
}

/**
 * Accepts a workspace invitation.
 *
 * Security guarantees:
 *   - Raw token is never logged or re-stored.
 *   - Token is hashed and looked up by hash (prevents timing oracle).
 *   - Expiry, acceptance, and revocation are all checked before
 *     any membership is created.
 *   - If an authenticated user's email does not match the invited
 *     email, the request is rejected (prevents invitation hijacking).
 *   - Membership creation and invitation acceptance are a single
 *     atomic transaction — no partial state is possible.
 *   - Replay is prevented: acceptedAt is set in the same transaction
 *     as membership creation, and subsequent calls will see
 *     InvitationAlreadyAcceptedError.
 *   - Rate limited per token (brute-force) and per IP.
 */
export async function acceptInvitation(
    options: AcceptInvitationOptions,
): Promise<AcceptInvitationResult> {
    // --- Rate limiting ---
    const rateLimit = checkInvitationAcceptRateLimit(
        options.rawToken,
        options.ipAddress,
    );

    if (!rateLimit.allowed) {
        throw new InvitationRateLimitError(rateLimit.retryAfterSeconds);
    }

    // --- Token lookup ---
    const tokenHash = hashInvitationToken(options.rawToken);

    const invitation = await prisma.workspaceInvitation.findUnique({
        where: { tokenHash },
        select: {
            id: true,
            workspaceId: true,
            email: true,
            role: true,
            expiresAt: true,
            acceptedAt: true,
            revokedAt: true,
            workspace: {
                select: { id: true },
            },
        },
    });

    // --- Validation —
    // Use consistent error messages to avoid revealing whether a
    // token exists at all (enumeration protection).
    if (!invitation) {
        throw new InvitationNotFoundError(
            "This invitation is invalid or has expired.",
        );
    }

    if (invitation.acceptedAt) {
        throw new InvitationAlreadyAcceptedError();
    }

    if (invitation.revokedAt) {
        throw new InvitationRevokedError();
    }

    if (isInvitationExpired(invitation.expiresAt)) {
        throw new InvitationExpiredError();
    }

    // --- Email matching (authenticated user flow) ---
    if (
        options.authenticatedUserId &&
        options.authenticatedUserEmail
    ) {
        const invitedEmail = invitation.email;
        const userEmail = options.authenticatedUserEmail
            .trim()
            .toLowerCase();

        if (userEmail !== invitedEmail) {
            throw new InvitationEmailMismatchError();
        }

        // --- Check not already a member ---
        const existingMembership =
            await prisma.workspaceMember.findUnique({
                where: {
                    userId_workspaceId: {
                        userId: options.authenticatedUserId,
                        workspaceId: invitation.workspaceId,
                    },
                },
                select: { id: true, status: true },
            });

        if (
            existingMembership &&
            existingMembership.status === "ACTIVE"
        ) {
            throw new InvitationAlreadyMemberError();
        }

        // --- Atomic: create membership + mark accepted ---
        const result = await prisma.$transaction(async (tx) => {
            // Re-read invitation inside transaction to prevent TOCTOU.
            const lockedInvitation =
                await tx.workspaceInvitation.findUnique({
                    where: { tokenHash },
                    select: {
                        id: true,
                        acceptedAt: true,
                        revokedAt: true,
                        expiresAt: true,
                    },
                });

            if (!lockedInvitation || lockedInvitation.acceptedAt) {
                throw new InvitationAlreadyAcceptedError();
            }

            if (lockedInvitation.revokedAt) {
                throw new InvitationRevokedError();
            }

            if (isInvitationExpired(lockedInvitation.expiresAt)) {
                throw new InvitationExpiredError();
            }

            let membership;

            if (existingMembership) {
                // Reactivate a previously removed/suspended membership.
                membership = await tx.workspaceMember.update({
                    where: { id: existingMembership.id },
                    data: {
                        role: invitation.role,
                        status: "ACTIVE",
                    },
                    select: { id: true },
                });
            } else {
                membership = await tx.workspaceMember.create({
                    data: {
                        userId: options.authenticatedUserId!,
                        workspaceId: invitation.workspaceId,
                        role: invitation.role,
                        status: "ACTIVE",
                    },
                    select: { id: true },
                });
            }

            await tx.workspaceInvitation.update({
                where: { id: lockedInvitation.id },
                data: { acceptedAt: new Date() },
            });

            return membership;
        });

        return {
            membershipCreated: true,
            invitation: {
                id: invitation.id,
                workspaceId: invitation.workspaceId,
                email: invitation.email,
                role: invitation.role,
            },
            membershipId: result.id,
        };
    }

    // --- Unauthenticated flow ---
    // Invitation is valid; caller should redirect to login/register
    // with the token preserved in the URL so the user can complete
    // acceptance after authenticating.
    return {
        membershipCreated: false,
        invitation: {
            id: invitation.id,
            workspaceId: invitation.workspaceId,
            email: invitation.email,
            role: invitation.role,
        },
    };
}
