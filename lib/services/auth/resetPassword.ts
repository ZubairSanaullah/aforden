import bcrypt from "bcrypt";

import { prisma } from "@/lib/prisma";

import {
    hashPasswordResetToken,
} from "./passwordResetToken";

import {
    sendEmail,
} from "@/lib/services/email/sendEmail";

import {
    createPasswordChangedEmail,
} from "@/lib/services/email/templates/passwordChanged";

const PASSWORD_MIN_LENGTH = 8;

export class PasswordResetError extends Error {
    constructor(
        message: string,
        public readonly code:
            | "INVALID_TOKEN"
            | "WEAK_PASSWORD"
            | "USER_NOT_FOUND"
            | "RESET_FAILED"
    ) {
        super(message);
        this.name =
            "PasswordResetError";
    }
}

function validatePassword(
    password: string
): void {
    if (
        password.length <
        PASSWORD_MIN_LENGTH
    ) {
        throw new PasswordResetError(
            "Password must contain at least 8 characters.",
            "WEAK_PASSWORD"
        );
    }

    if (!/[A-Z]/.test(password)) {
        throw new PasswordResetError(
            "Password must contain an uppercase letter.",
            "WEAK_PASSWORD"
        );
    }

    if (!/[a-z]/.test(password)) {
        throw new PasswordResetError(
            "Password must contain a lowercase letter.",
            "WEAK_PASSWORD"
        );
    }

    if (!/[0-9]/.test(password)) {
        throw new PasswordResetError(
            "Password must contain a number.",
            "WEAK_PASSWORD"
        );
    }
}

export async function resetPassword(
    rawToken: string,
    newPassword: string
) {
    if (!rawToken?.trim()) {
        throw new PasswordResetError(
            "Invalid or expired reset link.",
            "INVALID_TOKEN"
        );
    }

    validatePassword(newPassword);

    const tokenHash =
        hashPasswordResetToken(
            rawToken.trim()
        );

    const passwordHash =
        await bcrypt.hash(
            newPassword,
            12
        );

    let user:
        | {
            id: string;
            name: string | null;
            email: string;
            status: string;
        }
        | null = null;

    try {
        user =
            await prisma.$transaction(
                async (tx) => {
                    const resetToken =
                        await tx.passwordResetToken.findUnique(
                            {
                                where: {
                                    tokenHash,
                                },
                            }
                        );

                    if (
                        !resetToken ||
                        resetToken.usedAt
                    ) {
                        throw new PasswordResetError(
                            "Invalid or expired reset link.",
                            "INVALID_TOKEN"
                        );
                    }

                    if (
                        resetToken.expiresAt.getTime() <=
                        Date.now()
                    ) {
                        throw new PasswordResetError(
                            "Invalid or expired reset link.",
                            "INVALID_TOKEN"
                        );
                    }

                    const foundUser =
                        await tx.user.findUnique(
                            {
                                where: {
                                    id: resetToken.userId,
                                },
                                select: {
                                    id: true,
                                    name: true,
                                    email: true,
                                    status: true,
                                },
                            }
                        );

                    if (!foundUser) {
                        throw new PasswordResetError(
                            "Unable to reset password.",
                            "USER_NOT_FOUND"
                        );
                    }

                    await tx.user.update({
                        where: {
                            id: foundUser.id,
                        },
                        data: {
                            passwordHash,
                        },
                    });

                    await tx.passwordResetToken.updateMany(
                        {
                            where: {
                                userId:
                                    foundUser.id,
                                usedAt: null,
                            },
                            data: {
                                usedAt:
                                    new Date(),
                            },
                        }
                    );

                    await tx.session.deleteMany({
                        where: {
                            userId:
                                foundUser.id,
                        },
                    });

                    return foundUser;
                }
            );
    } catch (error) {
        if (
            error instanceof
            PasswordResetError
        ) {
            throw error;
        }

        console.error(
            "Aforden password reset transaction error:",
            error
        );

        throw new PasswordResetError(
            "Unable to reset your password.",
            "RESET_FAILED"
        );
    }

    /**
     * Send the notification only after the
     * database transaction successfully commits.
     */
    try {
        if (user) {
            const emailContent =
                createPasswordChangedEmail({
                    name:
                        user.name ||
                        "there",
                });

            await sendEmail({
                to: {
                    email: user.email,
                    name:
                        user.name ||
                        undefined,
                },
                subject:
                    emailContent.subject,
                html:
                    emailContent.html,
                text:
                    emailContent.text,
            });
        }
    } catch (error) {
        /**
         * The password has already been changed
         * successfully. Email failure must not
         * roll the password change back.
         */
        console.error(
            "Aforden password changed email error:",
            error
        );
    }

    return user;
}