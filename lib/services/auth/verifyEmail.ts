import crypto from "crypto";

import { prisma } from "@/lib/prisma";

export class EmailVerificationError extends Error {
    constructor(
        message: string,
        public readonly code:
            | "INVALID_TOKEN"
            | "USER_NOT_FOUND"
            | "ALREADY_VERIFIED"
            | "VERIFICATION_FAILED"
    ) {
        super(message);
        this.name = "EmailVerificationError";
    }
}

export interface VerifyEmailResult {
    user: {
        id: string;
        name: string | null;
        email: string;
        status: string;
        emailVerified: Date;
    };
}

function hashToken(token: string): string {
    return crypto
        .createHash("sha256")
        .update(token)
        .digest("hex");
}

export async function verifyEmail(
    rawToken: string
): Promise<VerifyEmailResult> {
    if (!rawToken?.trim()) {
        throw new EmailVerificationError(
            "Invalid verification token.",
            "INVALID_TOKEN"
        );
    }

    const tokenHash = hashToken(
        rawToken.trim()
    );

    try {
        const result =
            await prisma.$transaction(
                async (tx) => {
                    const verificationToken =
                        await tx.verificationToken.findUnique(
                            {
                                where: {
                                    token: tokenHash,
                                },
                            }
                        );

                    if (!verificationToken) {
                        throw new EmailVerificationError(
                            "This verification link is invalid or has expired.",
                            "INVALID_TOKEN"
                        );
                    }

                    if (
                        verificationToken.expires.getTime() <=
                        Date.now()
                    ) {
                        await tx.verificationToken.delete(
                            {
                                where: {
                                    token: tokenHash,
                                },
                            }
                        );

                        throw new EmailVerificationError(
                            "This verification link is invalid or has expired.",
                            "INVALID_TOKEN"
                        );
                    }

                    const user =
                        await tx.user.findUnique(
                            {
                                where: {
                                    email: verificationToken.identifier,
                                },
                                select: {
                                    id: true,
                                    name: true,
                                    email: true,
                                    status: true,
                                    emailVerified: true,
                                },
                            }
                        );

                    if (!user) {
                        throw new EmailVerificationError(
                            "Unable to verify this account.",
                            "USER_NOT_FOUND"
                        );
                    }

                    /**
                     * The token is no longer needed once the
                     * email has already been verified.
                     *
                     * Delete it while inside the same transaction.
                     */
                    if (user.emailVerified) {
                        await tx.verificationToken.delete(
                            {
                                where: {
                                    token: tokenHash,
                                },
                            }
                        );

                        return {
                            user: {
                                ...user,
                                emailVerified:
                                    user.emailVerified,
                            },
                        };
                    }

                    const verifiedAt =
                        new Date();

                    const updatedUser =
                        await tx.user.update({
                            where: {
                                id: user.id,
                            },
                            data: {
                                emailVerified:
                                    verifiedAt,

                                status:
                                    user.status ===
                                        "PENDING"
                                        ? "ACTIVE"
                                        : user.status,
                            },
                            select: {
                                id: true,
                                name: true,
                                email: true,
                                status: true,
                                emailVerified:
                                    true,
                            },
                        });

                    await tx.verificationToken.delete(
                        {
                            where: {
                                token: tokenHash,
                            },
                        }
                    );

                    return {
                        user: {
                            ...updatedUser,
                            emailVerified: verifiedAt,
                        },
                    };
                }
            );

        return result;
    } catch (error) {
        if (error instanceof EmailVerificationError) {
            throw error;
        }

        console.error(
            "Aforden email verification transaction error:",
            error
        );

        throw new EmailVerificationError(
            "Unable to verify your email address.",
            "VERIFICATION_FAILED"
        );
    }
}