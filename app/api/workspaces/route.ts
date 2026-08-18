import { NextResponse } from "next/server";

import { auth } from "@/auth";
import { createWorkspace } from "@/lib/services/workspace/createWorkspace";
import { getUserWorkspaces } from "@/lib/services/workspace/getUserWorkspaces";

export async function POST(request: Request) {
    try {
        const session = await auth();

        if (!session?.user?.id) {
            return NextResponse.json(
                {
                    error: "Unauthorized",
                },
                {
                    status: 401,
                }
            );
        }

        const body = await request.json();

        const workspace = await createWorkspace(
            session.user.id,
            body
        );

        return NextResponse.json(
            {
                workspace,
            },
            {
                status: 201,
            }
        );
    } catch (error) {
        console.error("Create workspace error:", error);

        if (error instanceof SyntaxError) {
            return NextResponse.json(
                {
                    error: "Invalid request body",
                },
                {
                    status: 400,
                }
            );
        }

        return NextResponse.json(
            {
                error: "Unable to create workspace",
            },
            {
                status: 500,
            }
        );
    }
}

export async function GET() {
    try {
        const session = await auth();

        if (!session?.user?.id) {
            return NextResponse.json(
                {
                    error: "Unauthorized",
                },
                {
                    status: 401,
                }
            );
        }

        const workspaces = await getUserWorkspaces(
            session.user.id
        );

        return NextResponse.json({
            workspaces,
        });
    } catch (error) {
        console.error("Get workspaces error:", error);

        return NextResponse.json(
            {
                error: "Unable to retrieve workspaces",
            },
            {
                status: 500,
            }
        );
    }
}