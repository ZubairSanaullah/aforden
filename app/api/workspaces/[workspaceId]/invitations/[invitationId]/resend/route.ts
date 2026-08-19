import { NextResponse } from "next/server";

import { resendInvitation } from "@/lib/services/invitation/resendInvitation";
import { handleApiError } from "@/lib/utils/api-error";
import {
    InvitationNotFoundError,
    InvitationAlreadyAcceptedError,
    InvitationRevokedError,
} from "@/lib/services/invitation/invitationErrors";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
        invitationId: string;
    }>;
}

/**
 * POST /api/workspaces/[workspaceId]/invitations/[invitationId]/resend
 *
 * Resends a workspace invitation by generating a new secure token
 * and refreshing the expiration. The previous token is immediately
 * invalidated.
 *
 * Authorization: OWNER or ADMIN (members.invite permission).
 * Tenant isolation: enforced at both the authorization and
 * service level — the invitation must belong to [workspaceId].
 */
export async function POST(
    _request: Request,
    context: RouteContext,
) {
    try {
        const { workspaceId, invitationId } = await context.params;

        const result = await resendInvitation(workspaceId, invitationId);

        return NextResponse.json({
            success: true,
            invitation: result,
        });
    } catch (error) {
        if (error instanceof InvitationNotFoundError) {
            return NextResponse.json(
                {
                    success: false,
                    error: {
                        code: "NOT_FOUND",
                        message: "Invitation not found.",
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
                        code: "REVOKED",
                        message: "This invitation has been cancelled and cannot be resent.",
                    },
                },
                { status: 409 },
            );
        }

        return handleApiError(error, "Resend invitation");
    }
}
