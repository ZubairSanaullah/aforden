import { NextResponse } from "next/server";

import { auth } from "@/auth";

import { prisma } from "@/lib/prisma";

export async function GET() {
    try {
        const session = await auth();

        if (!session?.user?.id) {
            return NextResponse.json({
                authenticated: false,
                user: null,
            });
        }

        const user =
            await prisma.user.findUnique({
                where: {
                    id: session.user.id,
                },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    status: true,
                    emailVerified: true,
                    avatarUrl: true,
                },
            });

        if (!user) {
            return NextResponse.json({
                authenticated: false,
                user: null,
            });
        }

        return NextResponse.json({
            authenticated: true,

            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                status: user.status,
                emailVerified:
                    user.emailVerified !== null,
                avatarUrl: user.avatarUrl,
            },
        });
    } catch (error) {
        console.error(
            "Aforden authentication status error:",
            error
        );

        return NextResponse.json(
            {
                authenticated: false,
                user: null,
            },
            {
                status: 500,
            }
        );
    }
}