import bcrypt from "bcrypt";

import { prisma } from "@/lib/prisma";
import {
    registerSchema,
    type RegisterInput,
} from "@/lib/validations/auth";
import {
    createVerificationToken,
} from "./verificationToken";
import {
    createVerificationUrl,
} from "./verificationUrl";
import {
    createVerificationEmail,
} from "@/lib/services/email/templates/verification";
import {
    sendEmail,
} from "@/lib/services/email/sendEmail";

export class RegistrationError extends Error {
    constructor(
        message: string,
        public readonly code:
            | "VALIDATION_ERROR"
            | "EMAIL_EXISTS"
            | "EMAIL_DELIVERY_FAILED"
            | "REGISTRATION_FAILED"
    ) {
        super(message);
        this.name = "RegistrationError";
    }
}

export interface RegisterUserResult {
    user: {
        id: string;
        name: string | null;
        email: string;
        status: string;
    };
}

export async function registerUser(
    input: RegisterInput
): Promise<RegisterUserResult> {
    const parsed =
        registerSchema.safeParse(input);

    if (!parsed.success) {
        throw new RegistrationError(
            "Invalid registration data.",
            "VALIDATION_ERROR"
        );
    }

    const {
        name,
        email,
        password,
    } = parsed.data;

    const existingUser =
        await prisma.user.findUnique({
            where: {
                email,
            },
            select: {
                id: true,
            },
        });

    if (existingUser) {
        throw new RegistrationError(
            "An account with this email already exists.",
            "EMAIL_EXISTS"
        );
    }

    const passwordHash =
        await bcrypt.hash(password, 12);

    let userId: string | null = null;

    try {
        const user =
            await prisma.user.create({
                data: {
                    name,
                    email,
                    passwordHash,
                    status: "PENDING",
                    emailVerified: null,
                },
                select: {
                    id: true,
                    name: true,
                    email: true,
                    status: true,
                },
            });

        userId = user.id;

        const {
            token,
        } = await createVerificationToken(
            user.email
        );

        const verificationUrl =
            createVerificationUrl(token);

        const emailContent =
            createVerificationEmail({
                name:
                    user.name ||
                    "there",
                verificationUrl,
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

        return {
            user,
        };
    } catch (error) {
        /**
         * If the account was created but verification
         * email delivery failed, remove the newly-created
         * account and its verification tokens so the user
         * can safely retry registration.
         */
        if (userId) {
            try {
                await prisma.$transaction([
                    prisma.verificationToken.deleteMany({
                        where: {
                            identifier: email,
                        },
                    }),

                    prisma.user.delete({
                        where: {
                            id: userId,
                        },
                    }),
                ]);
            } catch (cleanupError) {
                console.error(
                    "Aforden registration cleanup error:",
                    cleanupError
                );
            }
        }

        if (
            error instanceof RegistrationError
        ) {
            throw error;
        }

        console.error(
            "Aforden registration error:",
            error
        );

        if (
            error instanceof Error &&
            error.message ===
            "Email could not be sent."
        ) {
            throw new RegistrationError(
                "Unable to send the verification email. Please try again.",
                "EMAIL_DELIVERY_FAILED"
            );
        }

        throw new RegistrationError(
            "Unable to create your account.",
            "REGISTRATION_FAILED"
        );
    }
}