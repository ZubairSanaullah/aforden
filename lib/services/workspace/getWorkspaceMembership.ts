import { prisma } from "@/lib/prisma";

export async function getWorkspaceMembership(
    userId: string,
    workspaceId: string
) {
    return prisma.workspaceMember.findFirst({
        where: {
            userId,
            workspaceId,
            status: "ACTIVE",
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