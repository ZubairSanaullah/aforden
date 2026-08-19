import { prisma } from "@/lib/prisma";

import {
    createPasswordResetToken,
} from "./passwordResetToken";

import {
    createPasswordResetUrl,
} from "./passwordResetUrl";

import {
    sendEmail,
} from "@/lib/services/email/sendEmail";

import {
    createPasswordResetEmail,
} from "@/lib/services/email/templates/passwordReset";

export async function requestPasswordReset(
    email: string
): Promise<void> {
    const normalizedEmail =
        email.trim().toLowerCase();

    const user =
        await prisma.user.findUnique({
            where: {
                email: normalizedEmail,
            },
            select: {
                id: true,
                name: true,
                email: true,
                status: true,
            },
        });

    /**
     * Do not reveal whether an account exists.
     */
    if (!user) {
        return;
    }

    /**
     * Password recovery must never activate
     * or recover a deactivated account.
     */
    if (
        user.status === "DEACTIVATED"
    ) {
        return;
    }

    const { token } =
        await createPasswordResetToken(
            user.id
        );

    const resetUrl =
        createPasswordResetUrl(token);

    const emailContent =
        createPasswordResetEmail({
            name:
                user.name || "there",
            resetUrl,
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