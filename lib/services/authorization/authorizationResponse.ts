import { NextResponse } from "next/server";

import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
    WorkspaceNotFoundError,
} from "./authorizationErrors";

export function authorizationErrorResponse(
    error: unknown
): NextResponse | null {
    if (
        error instanceof UnauthorizedError
    ) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "UNAUTHORIZED",
                    message:
                        "Authentication is required.",
                },
            },
            {
                status: 401,
            }
        );
    }

    if (
        error instanceof
        ForbiddenError ||
        error instanceof
        WorkspaceAccessDeniedError ||
        error instanceof
        WorkspaceNotFoundError
    ) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "FORBIDDEN",
                    message:
                        "You do not have permission to perform this action.",
                },
            },
            {
                status: 403,
            }
        );
    }

    return null;
}