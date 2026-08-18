import { prisma } from "@/lib/prisma";

export interface VerificationStatus {
    emailVerified: boolean;
    status:
    | "PENDING"
    | "ACTIVE"
    | "SUSPENDED"
    | "DEACTIVATED";
    canLogin: boolean;
}

export async function getVerificationStatus(
    userId: string
): Promise<VerificationStatus | null> {
    const user =
        await prisma.user.findUnique({
            where: {
                id: userId,
            },
            select: {
                emailVerified: true,
                status: true,
            },
        });

    if (!user) {
        return null;
    }

    return {
        emailVerified:
            user.emailVerified !== null,

        status: user.status,

        canLogin:
            user.emailVerified !== null &&
            user.status === "ACTIVE",
    };
}