import { NextResponse } from "next/server";

import {
    authorizationErrorResponse,
} from "@/lib/services/authorization";

export function handleApiError(
    error: unknown,
    context?: string
): NextResponse {
    const authorizationResponse =
        authorizationErrorResponse(
            error
        );

    if (authorizationResponse) {
        return authorizationResponse;
    }

    if (context) {
        console.error(
            `[Aforden API] ${context}`,
            error
        );
    } else {
        console.error(
            "[Aforden API]",
            error
        );
    }

    return NextResponse.json(
        {
            success: false,
            error: {
                code:
                    "INTERNAL_SERVER_ERROR",
                message:
                    "An unexpected error occurred.",
            },
        },
        {
            status: 500,
        }
    );
}