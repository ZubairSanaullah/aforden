import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { acceptInvitation } from "@/lib/services/invitation/acceptInvitation";
import { acceptInvitationSchema } from "@/lib/validations/invitation";
import {
    InvitationNotFoundError,
    InvitationExpiredError,
    InvitationAlreadyAcceptedError,
    InvitationRevokedError,
    InvitationEmailMismatchError,
    InvitationAlreadyMemberError,
    InvitationRateLimitError,
} from "@/lib/services/invitation/invitationErrors";

/**
 * POST /api/invitations/accept
 *
 * Accepts a workspace invitation using the raw token from the
 * invitation email URL.
 *
 * This endpoint is publicly accessible (no authentication required)
 * to support both flows:
 *
 * Authenticated user flow:
 *   - Session is read server-side.
 *   - User's email MUST match the invited email.
 *   - Membership is created atomically.
 *   - Returns membershipCreated: true.
 *
 * Unauthenticated user flow:
 *   - Invitation is validated.
 *   - Returns membershipCreated: false with the invited email,
 *     so the frontend can redirect to login/register with context.
 *
 * Security:
 *   - Token is hashed server-side before the DB lookup.
 *   - Email matching prevents invitation hijacking.
 *   - TOCTOU-safe: re-validates inside the DB transaction.
 *   - Rate limited per token and per IP.
 */
export async function POST(request: Request) {
    try {
        const body = await request.json().catch(() => null);

        if (!body) {
            return NextResponse.json(
                {
                    success: false,
                    error: {
                        code: "INVALID_REQUEST",
                        message: "Request body is required.",
                    },
                },
                { status: 400 },
            );
        }

        const parsed = acceptInvitationSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json(
                {
                    success: false,
                    error: {
                        code: "VALIDATION_ERROR",
                        message: "Invalid invitation token.",
                        fields: parsed.error.flatten().fieldErrors,
                    },
                },
                { status: 422 },
            );
        }

        const ipAddress =
            request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
            request.headers.get("x-real-ip") ||
            "unknown";

        // --- Session (optional) ---
        const session = await auth();
        let authenticatedUserId: string | undefined;
        let authenticatedUserEmail: string | undefined;

        if (session?.user?.id) {
            const user = await prisma.user.findUnique({
                where: { id: session.user.id },
                select: {
                    id: true,
                    email: true,
                    status: true,
                    emailVerified: true,
                },
            });

            // Only trust fully active + verified accounts for acceptance.
            if (
                user &&
                user.status === "ACTIVE" &&
                user.emailVerified
            ) {
                authenticatedUserId = user.id;
                authenticatedUserEmail = user.email;
            }
        }

        const result = await acceptInvitation({
            rawToken: parsed.data.token,
            authenticatedUserId,
            authenticatedUserEmail,
            ipAddress,
        });

        return NextResponse.json(
            {
                success: true,
                membershipCreated: result.membershipCreated,
                invitation: result.invitation,
                ...(result.membershipId
                    ? { membershipId: result.membershipId }
                    : {}),
            },
            { status: result.membershipCreated ? 200 : 202 },
        );
    } catch (error) {
        if (error instanceof InvitationRateLimitError) {
            return NextResponse.json(
                {
                    success: false,
                    error: {
                        code: "RATE_LIMITED",
                        message: "Too many attempts. Please try again later.",
                    },
                },
                {
                    status: 429,
                    headers: {
                        "Retry-After": String(error.retryAfterSeconds),
                    },
                },
            );
        }

        if (
            error instanceof InvitationNotFoundError ||
            error instanceof InvitationExpiredError
        ) {
            // Merged response — prevents confirming whether the token exists.
            return NextResponse.json(
                {
                    success: false,
                    error: {
                        code: "INVITATION_INVALID",
                        message: "This invitation is invalid or has expired.",
                    },
                },
                { status: 404 },
            );
        }

        if (error instanceof InvitationAlreadyAcceptedError) {
            return NextResponse.json(
                {
                    success: false,
                    error: {
                        code: "ALREADY_ACCEPTED",
                        message: "This invitation has already been accepted.",
                    },
                },
                { status: 409 },
            );
        }

        if (error instanceof InvitationRevokedError) {
            return NextResponse.json(
                {
                    success: false,
                    error: {
                        code: "INVITATION_CANCELLED",
                        message: "This invitation has been cancelled.",
                    },
                },
                { status: 410 },
            );
        }

        if (error instanceof InvitationEmailMismatchError) {
            return NextResponse.json(
                {
                    success: false,
                    error: {
                        code: "EMAIL_MISMATCH",
                        message: "This invitation was sent to a different email address. Please sign in with the invited email to accept.",
                    },
                },
                { status: 403 },
            );
        }

        if (error instanceof InvitationAlreadyMemberError) {
            return NextResponse.json(
                {
                    success: false,
                    error: {
                        code: "ALREADY_MEMBER",
                        message: "You are already a member of this workspace.",
                    },
                },
                { status: 409 },
            );
        }

        console.error("[Aforden] Accept invitation error:", error);

        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "INTERNAL_SERVER_ERROR",
                    message: "An unexpected error occurred.",
                },
            },
            { status: 500 },
        );
    }
}
