import { prisma } from "@/lib/prisma";

export async function cleanupExpiredSessions(): Promise<number> {
    const result =
        await prisma.session.deleteMany({
            where: {
                expires: {
                    lte: new Date(),
                },
            },
        });

    return result.count;
}