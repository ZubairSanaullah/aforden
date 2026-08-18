import { prisma } from "@/lib/prisma";
import { createWorkspaceSchema } from "@/lib/validations/workspace";
import { slugify } from "@/lib/utils/slug";

export async function createWorkspace(
    userId: string,
    input: unknown
) {
    const data = createWorkspaceSchema.parse(input);

    const baseSlug = slugify(data.name) || "workspace";

    return prisma.$transaction(async (tx) => {
        let slug = baseSlug;
        let counter = 2;

        while (
            await tx.workspace.findUnique({
                where: { slug },
                select: { id: true },
            })
        ) {
            slug = `${baseSlug}-${counter}`;
            counter++;
        }

        const workspace = await tx.workspace.create({
            data: {
                name: data.name,
                slug,
                timezone: data.timezone,

                memberships: {
                    create: {
                        userId,
                        role: "OWNER",
                        status: "ACTIVE",
                    },
                },
            },

            select: {
                id: true,
                name: true,
                slug: true,
                logoUrl: true,
                timezone: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        return workspace;
    });
}