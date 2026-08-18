import crypto from "crypto";

import { prisma } from "@/lib/prisma";

const VERIFICATION_TOKEN_EXPIRY_HOURS = 24;

/**
 * Generates a cryptographically secure random token.
 */
function generateRawToken(): string {
    return crypto.randomBytes(32).toString("hex");
}

/**
 * Creates a SHA-256 hash of a verification token.
 *
 * Only the hash is stored in the database.
 * The raw token is returned to the caller so it can be
 * included in the verification URL/email.
 */
function hashToken(token: string): string {
    return crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");
}

/**
 * Creates a new email verification token for a user.
 *
 * Existing verification tokens for the same identifier
 * are removed first so multiple active verification links
 * do not accumulate.
 */
export async function createVerificationToken(
    email: string
): Promise<{
    token: string;
    expires: Date;
}> {
    const identifier = email.trim().toLowerCase();

    const rawToken = generateRawToken();
    const tokenHash = hashToken(rawToken);

    const expires = new Date(
        Date.now() +
        VERIFICATION_TOKEN_EXPIRY_HOURS *
        60 *
        60 *
        1000
    );

    await prisma.$transaction([
        prisma.verificationToken.deleteMany({
            where: {
                identifier,
            },
        }),

        prisma.verificationToken.create({
            data: {
                identifier,
                token: tokenHash,
                expires,
            },
        }),
    ]);

    return {
        token: rawToken,
        expires,
    };
}

/**
 * Consumes a verification token.
 *
 * Returns the associated identifier when the token is
 * valid and unused.
 *
 * Returns null for:
 * - Invalid tokens
 * - Expired tokens
 */
export async function consumeVerificationToken(
    rawToken: string
): Promise<string | null> {
    if (!rawToken) {
        return null;
    }

    const tokenHash = hashToken(rawToken);

    const verificationToken =
        await prisma.verificationToken.findUnique({
            where: {
                token: tokenHash,
            },
        });

    if (!verificationToken) {
        return null;
    }

    if (
        verificationToken.expires.getTime() <=
        Date.now()
    ) {
        await prisma.verificationToken.delete({
            where: {
                token: verificationToken.token,
            },
        });

        return null;
    }

    await prisma.verificationToken.delete({
        where: {
            token: verificationToken.token,
        },
    });

    return verificationToken.identifier;
}

/**
 * Removes all verification tokens associated with
 * an email address.
 */
export async function revokeVerificationTokens(
    email: string
): Promise<void> {
    await prisma.verificationToken.deleteMany({
        where: {
            identifier: email.trim().toLowerCase(),
        },
    });
}