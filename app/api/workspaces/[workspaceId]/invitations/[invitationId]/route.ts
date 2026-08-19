import { NextResponse } from "next/server";

import { revokeInvitation } from "@/lib/services/invitation/revokeInvitation";
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
 * DELETE /api/workspaces/[workspaceId]/invitations/[invitationId]
 *
 * Revokes (cancels) a pending workspace invitation.
 *
 * Authorization: OWNER or ADMIN (members.invite permission).
 * Tenant isolation: enforced at both the authorization and
 * service level — the invitation must belong to [workspaceId].
 */
export async function DELETE(
    _request: Request,
    context: RouteContext,
) {
    try {
        const { workspaceId, invitationId } = await context.params;

        const result = await revokeInvitation(workspaceId, invitationId);

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
                        code: "ALREADY_REVOKED",
                        message: "This invitation has already been cancelled.",
                    },
                },
                { status: 409 },
            );
        }

        return handleApiError(error, "Revoke invitation");
    }
}
