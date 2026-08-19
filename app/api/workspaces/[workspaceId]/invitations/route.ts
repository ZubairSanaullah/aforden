import { NextResponse } from "next/server";

import { createInvitation } from "@/lib/services/invitation/createInvitation";
import { listInvitations } from "@/lib/services/invitation/listInvitations";
import { createInvitationSchema } from "@/lib/validations/invitation";
import { handleApiError } from "@/lib/utils/api-error";
import {
    InvitationAlreadyMemberError,
    InvitationRateLimitError,
    InvitationInvalidRoleError,
} from "@/lib/services/invitation/invitationErrors";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
    }>;
}

/**
 * POST /api/workspaces/[workspaceId]/invitations
 *
 * Creates a new workspace invitation and sends an email to the invitee.
 *
 * Authorization: OWNER or ADMIN (members.invite permission).
 */
export async function POST(
    request: Request,
    context: RouteContext,
) {
    try {
        const { workspaceId } = await context.params;

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

        const parsed = createInvitationSchema.safeParse(body);

        if (!parsed.success) {
            return NextResponse.json(
                {
                    success: false,
                    error: {
                        code: "VALIDATION_ERROR",
                        message: "Invalid request data.",
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

        const invitation = await createInvitation(
            workspaceId,
            parsed.data,
            { ipAddress },
        );

        return NextResponse.json(
            {
                success: true,
                invitation,
            },
            { status: 201 },
        );
    } catch (error) {
        if (error instanceof InvitationRateLimitError) {
            return NextResponse.json(
                {
                    success: false,
                    error: {
                        code: "RATE_LIMITED",
                        message: "Too many invitation requests. Please try again later.",
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

        if (error instanceof InvitationAlreadyMemberError) {
            return NextResponse.json(
                {
                    success: false,
                    error: {
                        code: "ALREADY_MEMBER",
                        message: "This user is already a member of the workspace.",
                    },
                },
                { status: 409 },
            );
        }

        if (error instanceof InvitationInvalidRoleError) {
            return NextResponse.json(
                {
                    success: false,
                    error: {
                        code: "INVALID_ROLE",
                        message: "The specified role is not valid.",
                    },
                },
                { status: 422 },
            );
        }

        return handleApiError(error, "Create invitation");
    }
}

/**
 * GET /api/workspaces/[workspaceId]/invitations
 *
 * Lists pending and expired (not accepted/revoked) invitations
 * for a workspace.
 *
 * Authorization: OWNER, ADMIN, or any role with members.view permission.
 */
export async function GET(
    _request: Request,
    context: RouteContext,
) {
    try {
        const { workspaceId } = await context.params;

        const invitations = await listInvitations(workspaceId);

        return NextResponse.json({
            success: true,
            invitations,
        });
    } catch (error) {
        return handleApiError(error, "List invitations");
    }
}
