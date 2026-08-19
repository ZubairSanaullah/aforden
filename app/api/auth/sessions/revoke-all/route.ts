import { NextResponse } from "next/server";

import { auth } from "@/auth";

import {
    revokeAllSessions,
} from "@/lib/services/auth/sessionManagement";

export async function POST() {
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

        const revoked =
            await revokeAllSessions(
                session.user.id
            );

        return NextResponse.json(
            {
                success: true,
                revokedSessions: revoked,
                message:
                    "All active sessions have been revoked. Please sign in again.",
            },
            {
                status: 200,
            }
        );
    } catch (error) {
        console.error(
            "Aforden revoke-all-sessions API error:",
            error
        );

        return NextResponse.json(
            {
                success: false,
                message:
                    "Unable to revoke your sessions.",
            },
            {
                status: 500,
            }
        );
    }
}