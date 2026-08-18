import { prisma } from "@/lib/prisma";

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

export interface ResendVerificationResult {
    sent: boolean;
}

export async function resendVerificationEmail(
    email: string
): Promise<ResendVerificationResult> {
    const normalizedEmail =
        email.trim().toLowerCase();

    if (!normalizedEmail) {
        return {
            sent: false,
        };
    }

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
                emailVerified: true,
            },
        });

    /**
     * Do not reveal whether the account exists.
     */
    if (!user) {
        return {
            sent: false,
        };
    }

    /**
     * Already verified accounts do not need
     * another verification email.
     */
    if (user.emailVerified) {
        return {
            sent: false,
        };
    }

    /**
     * Only pending accounts should receive
     * verification emails.
     */
    if (user.status !== "PENDING") {
        return {
            sent: false,
        };
    }

    const { token } =
        await createVerificationToken(
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
        sent: true,
    };
}