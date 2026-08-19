import { NextResponse } from "next/server";

import { auth } from "@/auth";

import {
    revokeSession,
} from "@/lib/services/auth/sessionManagement";

interface RouteContext {
    params: Promise<{
        sessionId: string;
    }>;
}

export async function DELETE(
    _request: Request,
    context: RouteContext
) {
    try {
        const session =
            await auth();

        if (!session?.user?.id) {
            return NextResponse.json(
                {
                    success: false,
                    message:
                        "Authentication is required.",
                },
                {
                    status: 401,
                }
            );
        }

        const { sessionId } =
            await context.params;

        if (!sessionId) {
            return NextResponse.json(
                {
                    success: false,
                    message:
                        "Session ID is required.",
                },
                {
                    status: 400,
                }
            );
        }

        const revoked =
            await revokeSession(
                session.user.id,
                sessionId
            );

        if (!revoked) {
            return NextResponse.json(
                {
                    success: false,
                    message:
                        "Session could not be found.",
                },
                {
                    status: 404,
                }
            );
        }

        return NextResponse.json(
            {
                success: true,
                message:
                    "Session revoked successfully.",
            },
            {
                status: 200,
            }
        );
    } catch (error) {
        console.error(
            "Aforden revoke-session API error:",
            error
        );

        return NextResponse.json(
            {
                success: false,
                message:
                    "Unable to revoke the session.",
            },
            {
                status: 500,
            }
        );
    }
}