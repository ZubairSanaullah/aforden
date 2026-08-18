interface VerificationEmailInput {
    name: string;
    verificationUrl: string;
}

export function createVerificationEmail(
    input: VerificationEmailInput
): {
    subject: string;
    html: string;
    text: string;
} {
    const safeName = escapeHtml(
        input.name
    );

    const safeUrl = escapeHtml(
        input.verificationUrl
    );

    return {
        subject:
            "Verify your Aforden account",

        html: `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify your Aforden account</title>
</head>
<body style="margin:0;padding:0;background:#f6f8fa;font-family:Arial,sans-serif;">
    <div style="max-width:600px;margin:40px auto;background:#ffffff;padding:40px;border-radius:12px;">
        <h1 style="margin-top:0;">Welcome to Aforden, ${safeName}</h1>

        <p>
            Thanks for creating your Aforden account.
            Please verify your email address to activate your account.
        </p>

        <p style="margin:32px 0;">
            <a
                href="${safeUrl}"
                style="display:inline-block;padding:12px 20px;background:#111827;color:#ffffff;text-decoration:none;border-radius:8px;"
            >
                Verify Email Address
            </a>
        </p>

        <p>
            This verification link expires in 24 hours.
        </p>

        <p>
            If you did not create an Aforden account, you can safely ignore this email.
        </p>

        <p style="margin-top:32px;color:#6b7280;font-size:14px;">
            — The Aforden Team
        </p>
    </div>
</body>
</html>
        `.trim(),

        text: `
Welcome to Aforden, ${input.name}.

Please verify your email address to activate your account:

${input.verificationUrl}

This verification link expires in 24 hours.

If you did not create an Aforden account, you can safely ignore this email.

— The Aforden Team
        `.trim(),
    };
}

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