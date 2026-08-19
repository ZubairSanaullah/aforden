import { NextResponse } from "next/server";

import { auth } from "@/auth";

import { prisma } from "@/lib/prisma";

export async function GET() {
    try {
        const session =
            await auth();

        if (!session?.user?.id) {
            return NextResponse.json(
                {
                    authenticated: false,
                    user: null,
                },
                {
                    status: 200,
                }
            );
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
            return NextResponse.json(
                {
                    authenticated: false,
                    user: null,
                },
                {
                    status: 200,
                }
            );
        }

        return NextResponse.json(
            {
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
            },
            {
                status: 200,
            }
        );
    } catch (error) {
        console.error(
            "Aforden auth status API error:",
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