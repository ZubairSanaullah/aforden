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

function escapeHtml(
    value: string
): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function createPasswordResetEmail(
    name: string,
    resetUrl: string
) {
    const safeName =
        escapeHtml(name);

    const safeUrl =
        escapeHtml(resetUrl);

    return {
        subject:
            "Reset your Aforden password",

        html: `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >
    <title>Reset your Aforden password</title>
</head>

<body
    style="
        margin:0;
        padding:0;
        background:#f6f8fa;
        font-family:Arial,sans-serif;
    "
>
    <div
        style="
            max-width:600px;
            margin:40px auto;
            background:#ffffff;
            padding:40px;
            border-radius:12px;
        "
    >
        <h1 style="margin-top:0;">
            Reset your password
        </h1>

        <p>
            Hi ${safeName},
        </p>

        <p>
            We received a request to reset your
            Aforden password.
        </p>

        <p style="margin:32px 0;">
            <a
                href="${safeUrl}"
                style="
                    display:inline-block;
                    padding:12px 20px;
                    background:#111827;
                    color:#ffffff;
                    text-decoration:none;
                    border-radius:8px;
                "
            >
                Reset Password
            </a>
        </p>

        <p>
            This link expires in 30 minutes.
        </p>

        <p>
            If you did not request a password reset,
            you can safely ignore this email.
        </p>

        <p
            style="
                margin-top:32px;
                color:#6b7280;
                font-size:14px;
            "
        >
            — The Aforden Team
        </p>
    </div>
</body>
</html>
        `.trim(),

        text: `
Reset your Aforden password.

Hi ${name},

We received a request to reset your Aforden password.

Use this link:

${resetUrl}

This link expires in 30 minutes.

If you did not request a password reset,
you can safely ignore this email.

— The Aforden Team
        `.trim(),
    };
}

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
     * Password recovery should not activate
     * disabled accounts.
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
        createPasswordResetEmail(
            user.name || "there",
            resetUrl
        );

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