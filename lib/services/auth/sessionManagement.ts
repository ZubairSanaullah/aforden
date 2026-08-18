import { prisma } from "@/lib/prisma";

export async function getUserSessions(
    userId: string
) {
    const sessions =
        await prisma.session.findMany({
            where: {
                userId,
                expires: {
                    gt: new Date(),
                },
            },
            orderBy: {
                updatedAt: "desc",
            },
            select: {
                id: true,
                expires: true,
                createdAt: true,
                updatedAt: true,
            },
        });

    return sessions.map((session) => ({
        id: session.id,
        expires: session.expires,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
    }));
}

export async function revokeSession(
    userId: string,
    sessionId: string
): Promise<boolean> {
    const result =
        await prisma.session.deleteMany({
            where: {
                id: sessionId,
                userId,
            },
        });

    return result.count > 0;
}

export async function revokeAllSessions(
    userId: string,
    exceptSessionId?: string
): Promise<number> {
    const result =
        await prisma.session.deleteMany({
            where: {
                userId,
                ...(exceptSessionId
                    ? {
                        NOT: {
                            id: exceptSessionId,
                        },
                    }
                    : {}),
            },
        });

    return result.count;
}