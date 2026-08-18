interface PasswordChangedEmailInput {
    name: string;
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

export function createPasswordChangedEmail(
    input: PasswordChangedEmailInput
) {
    const safeName =
        escapeHtml(input.name);

    return {
        subject:
            "Your Aforden password was changed",

        html: `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta
        name="viewport"
        content="width=device-width, initial-scale=1.0"
    >
    <title>Password changed</title>
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
        <h1>Password changed</h1>

        <p>
            Hi ${safeName},
        </p>

        <p>
            Your Aforden account password was
            successfully changed.
        </p>

        <p>
            For your security, all existing sessions
            have been signed out.
        </p>

        <p>
            If you did not make this change,
            please contact Aforden support immediately.
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
Password changed

Hi ${input.name},

Your Aforden account password was successfully changed.

For your security, all existing sessions have been signed out.

If you did not make this change, please contact Aforden support immediately.

— The Aforden Team
        `.trim(),
    };
}