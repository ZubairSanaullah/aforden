import bcrypt from "bcrypt";

import { prisma } from "@/lib/prisma";

export class ChangePasswordError extends Error {
    constructor(
        message: string,
        public readonly code:
            | "UNAUTHENTICATED"
            | "USER_NOT_FOUND"
            | "INVALID_CURRENT_PASSWORD"
            | "WEAK_PASSWORD"
            | "SAME_PASSWORD"
            | "CHANGE_FAILED"
    ) {
        super(message);
        this.name = "ChangePasswordError";
    }
}

function validatePassword(
    password: string
): void {
    if (password.length < 8) {
        throw new ChangePasswordError(
            "Password must contain at least 8 characters.",
            "WEAK_PASSWORD"
        );
    }

    if (!/[A-Z]/.test(password)) {
        throw new ChangePasswordError(
            "Password must contain an uppercase letter.",
            "WEAK_PASSWORD"
        );
    }

    if (!/[a-z]/.test(password)) {
        throw new ChangePasswordError(
            "Password must contain a lowercase letter.",
            "WEAK_PASSWORD"
        );
    }

    if (!/[0-9]/.test(password)) {
        throw new ChangePasswordError(
            "Password must contain a number.",
            "WEAK_PASSWORD"
        );
    }
}

export async function changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    currentSessionToken?: string
) {
    if (!userId) {
        throw new ChangePasswordError(
            "Authentication is required.",
            "UNAUTHENTICATED"
        );
    }

    validatePassword(newPassword);

    const user =
        await prisma.user.findUnique({
            where: {
                id: userId,
            },
            select: {
                id: true,
                name: true,
                email: true,
                passwordHash: true,
            },
        });

    if (!user) {
        throw new ChangePasswordError(
            "User account could not be found.",
            "USER_NOT_FOUND"
        );
    }

    if (!user.passwordHash) {
        throw new ChangePasswordError(
            "Password authentication is not available for this account.",
            "CHANGE_FAILED"
        );
    }

    const currentPasswordMatches =
        await bcrypt.compare(
            currentPassword,
            user.passwordHash
        );

    if (!currentPasswordMatches) {
        throw new ChangePasswordError(
            "Current password is incorrect.",
            "INVALID_CURRENT_PASSWORD"
        );
    }

    const samePassword =
        await bcrypt.compare(
            newPassword,
            user.passwordHash
        );

    if (samePassword) {
        throw new ChangePasswordError(
            "New password must be different from your current password.",
            "SAME_PASSWORD"
        );
    }

    const passwordHash =
        await bcrypt.hash(
            newPassword,
            12
        );

    await prisma.$transaction(
        async (tx) => {
            await tx.user.update({
                where: {
                    id: user.id,
                },
                data: {
                    passwordHash,
                },
            });

            /**
             * Sign out all other sessions.
             *
             * The current session remains active so the
             * user isn't unexpectedly logged out after
             * changing their password.
             */
            if (currentSessionToken) {
                await tx.session.deleteMany({
                    where: {
                        userId: user.id,
                        NOT: {
                            sessionToken:
                                currentSessionToken,
                        },
                    },
                });
            } else {
                await tx.session.deleteMany({
                    where: {
                        userId: user.id,
                    },
                });
            }

            /**
             * Invalidate all outstanding password
             * reset tokens.
             */
            await tx.passwordResetToken.updateMany(
                {
                    where: {
                        userId: user.id,
                        usedAt: null,
                    },
                    data: {
                        usedAt: new Date(),
                    },
                }
            );
        }
    );

    return {
        id: user.id,
        name: user.name,
        email: user.email,
    };
}