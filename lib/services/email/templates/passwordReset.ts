interface PasswordResetEmailInput {
    name: string;
    resetUrl: string;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

export function createPasswordResetEmail(
    input: PasswordResetEmailInput
) {
    const safeName = escapeHtml(input.name);
    const safeUrl = escapeHtml(input.resetUrl);

    return {
        subject: "Reset your Aforden password",

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
        color:#111827;
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
        <h1
            style="
                margin:0 0 24px;
                font-size:28px;
                line-height:1.3;
            "
        >
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
                    font-weight:600;
                "
            >
                Reset Password
            </a>
        </p>

        <p>
            This password reset link will expire
            in 30 minutes.
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
            &mdash; The Aforden Team
        </p>
    </div>
</body>
</html>
        `.trim(),

        text: `
Reset your Aforden password.

Hi ${input.name},

We received a request to reset your Aforden password.

Use this link to reset your password:

${input.resetUrl}

This password reset link will expire in 30 minutes.

If you did not request a password reset,
you can safely ignore this email.

— The Aforden Team
        `.trim(),
    };
}