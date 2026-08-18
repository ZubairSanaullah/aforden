import { NextResponse } from "next/server";

import {
    requirePermission,
    isPermission,
} from "@/lib/services/authorization";

import { handleApiError } from "@/lib/utils/api-error";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
        permission: string;
    }>;
}

export async function GET(
    _request: Request,
    context: RouteContext
) {
    try {
        const {
            workspaceId,
            permission,
        } = await context.params;

        if (!isPermission(permission)) {
            return NextResponse.json(
                {
                    success: false,
                    error: {
                        code: "INVALID_PERMISSION",
                        message:
                            "Invalid permission.",
                    },
                },
                {
                    status: 400,
                }
            );
        }

        const authorization =
            await requirePermission(
                workspaceId,
                permission
            );

        return NextResponse.json({
            success: true,
            authorized: true,
            permission,
            role:
                authorization.membership
                    .role,
            workspace: {
                id:
                    authorization
                        .workspace.id,
                name:
                    authorization
                        .workspace.name,
            },
        });
    } catch (error) {
        return handleApiError(
            error,
            "Permission authorization check failed"
        );
    }
}