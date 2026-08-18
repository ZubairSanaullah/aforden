import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";

import {
    UnauthorizedError,
    WorkspaceAccessDeniedError,
    WorkspaceNotFoundError,
} from "./authorizationErrors";

import type {
    WorkspaceAuthorizationContext,
} from "./types";

export async function requireWorkspaceAuthorization(
    workspaceId: string
): Promise<WorkspaceAuthorizationContext> {
    const session = await auth();

    if (!session?.user?.id) {
        throw new UnauthorizedError();
    }

    const user = await prisma.user.findUnique({
        where: {
            id: session.user.id,
        },
        select: {
            id: true,
            name: true,
            email: true,
            status: true,
            emailVerified: true,
        },
    });

    if (!user) {
        throw new UnauthorizedError();
    }

    if (
        user.status !== "ACTIVE"
    ) {
        throw new WorkspaceAccessDeniedError();
    }

    const workspace =
        await prisma.workspace.findUnique({
            where: {
                id: workspaceId,
            },
            select: {
                id: true,
                name: true,
                slug: true,
                logoUrl: true,
                timezone: true,
            },
        });

    if (!workspace) {
        throw new WorkspaceNotFoundError();
    }

    const membership =
        await prisma.workspaceMember.findUnique(
            {
                where: {
                    userId_workspaceId: {
                        userId: user.id,
                        workspaceId,
                    },
                },
                select: {
                    id: true,
                    userId: true,
                    workspaceId: true,
                    role: true,
                    status: true,
                },
            }
        );

    if (
        !membership ||
        membership.status !== "ACTIVE"
    ) {
        throw new WorkspaceAccessDeniedError();
    }

    return {
        user,
        workspace,
        membership,
    };
}