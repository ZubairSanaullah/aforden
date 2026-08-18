import crypto from "crypto";

import { prisma } from "@/lib/prisma";

const PASSWORD_RESET_TOKEN_EXPIRY_MINUTES = 30;

function generateRawToken(): string {
    return crypto.randomBytes(32).toString("hex");
}

function hashToken(token: string): string {
    return crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");
}

export async function createPasswordResetToken(
    userId: string
): Promise<{
    token: string;
    expiresAt: Date;
}> {
    const rawToken = generateRawToken();

    const tokenHash = hashToken(rawToken);

    const expiresAt = new Date(
        Date.now() +
        PASSWORD_RESET_TOKEN_EXPIRY_MINUTES *
        60 *
        1000
    );

    await prisma.$transaction([
        prisma.passwordResetToken.updateMany({
            where: {
                userId,
                usedAt: null,
            },
            data: {
                usedAt: new Date(),
            },
        }),

        prisma.passwordResetToken.create({
            data: {
                userId,
                tokenHash,
                expiresAt,
            },
        }),
    ]);

    return {
        token: rawToken,
        expiresAt,
    };
}

export function hashPasswordResetToken(
    token: string
): string {
    return hashToken(token);
}