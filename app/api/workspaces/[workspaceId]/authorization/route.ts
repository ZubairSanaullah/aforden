import { NextResponse } from "next/server";

import {
    requireWorkspaceAuthorization,
} from "@/lib/services/authorization";

import { handleApiError } from "@/lib/utils/api-error";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
    }>;
}

export async function GET(
    _request: Request,
    context: RouteContext
) {
    try {
        const { workspaceId } =
            await context.params;

        const authorization =
            await requireWorkspaceAuthorization(
                workspaceId
            );

        return NextResponse.json({
            success: true,

            authorization: {
                user: authorization.user,

                workspace:
                    authorization.workspace,

                membership:
                    authorization.membership,
            },
        });
    } catch (error) {
        return handleApiError(
            error,
            "Workspace authorization check failed"
        );
    }
}