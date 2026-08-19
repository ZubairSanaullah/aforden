import { NextResponse } from "next/server";

import { auth } from "@/auth";

import {
    getUserSessions,
} from "@/lib/services/auth/sessionManagement";

export async function GET() {
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

        const sessions =
            await getUserSessions(
                session.user.id
            );

        return NextResponse.json(
            {
                success: true,
                sessions,
            },
            {
                status: 200,
            }
        );
    } catch (error) {
        console.error(
            "Aforden sessions API error:",
            error
        );

        return NextResponse.json(
            {
                success: false,
                message:
                    "Unable to retrieve your sessions.",
            },
            {
                status: 500,
            }
        );
    }
}