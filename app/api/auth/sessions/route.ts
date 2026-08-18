import { NextResponse } from "next/server";

import { auth } from "@/auth";

import {
    getUserSessions,
} from "@/lib/services/auth/sessionManagement";

export async function GET() {
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

    return NextResponse.json({
        success: true,
        sessions,
    });
}