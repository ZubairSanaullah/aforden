import { prisma } from "@/lib/prisma";

export async function getUserWorkspaces(userId: string) {
    return prisma.workspaceMember.findMany({
        where: {
            userId,
            status: "ACTIVE",
        },

        orderBy: {
            createdAt: "asc",
        },

        select: {
            id: true,
            role: true,
            status: true,
            workspaceId: true,

            workspace: {
                select: {
                    id: true,
                    name: true,
                    slug: true,
                    logoUrl: true,
                    timezone: true,
                },
            },
        },
    });
}