import type { MembershipRole } from "@/generated/prisma/client";

interface InvitationEmailInput {
    workspaceName: string;
    inviterName: string;
    recipientEmail: string;
    role: MembershipRole;
    acceptUrl: string;
    expiresAt: Date;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatRole(role: MembershipRole): string {
    const labels: Record<MembershipRole, string> = {
        OWNER: "Owner",
        ADMIN: "Administrator",
        MANAGER: "Manager",
        DISPATCHER: "Dispatcher",
        TECHNICIAN: "Technician",
        ACCOUNTANT: "Accountant",
    };

    return labels[role] ?? role;
}

function formatExpiryDate(expiresAt: Date): string {
    return expiresAt.toLocaleDateString("en-US", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}

export function createInvitationEmail(
    input: InvitationEmailInput,
): {
    subject: string;
    html: string;
    text: string;
} {
    const safeWorkspaceName = escapeHtml(input.workspaceName);
    const safeInviterName = escapeHtml(input.inviterName);
    const safeRecipientEmail = escapeHtml(input.recipientEmail);
    const safeRole = escapeHtml(formatRole(input.role));
    const safeAcceptUrl = escapeHtml(input.acceptUrl);
    const safeExpiryDate = escapeHtml(
        formatExpiryDate(input.expiresAt),
    );

    const subject = `You've been invited to join ${input.workspaceName} on Aforden`;

    const html = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(subject)}</title>
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
            You've been invited to join ${safeWorkspaceName}
        </h1>

        <p>
            <strong>${safeInviterName}</strong> has invited
            <strong>${safeRecipientEmail}</strong> to join
            <strong>${safeWorkspaceName}</strong> on Aforden
            as a <strong>${safeRole}</strong>.
        </p>

        <p style="margin:32px 0;">
            <a
                href="${safeAcceptUrl}"
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
                Accept Invitation
            </a>
        </p>

        <p>
            This invitation expires on
            <strong>${safeExpiryDate}</strong>.
        </p>

        <p>
            If you were not expecting this invitation,
            you can safely ignore this email.
            You will not be added to the workspace unless
            you click the button above.
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
    `.trim();

    const text = `
You've been invited to join ${input.workspaceName} on Aforden.

${input.inviterName} has invited ${input.recipientEmail} to join ${input.workspaceName} on Aforden as a ${formatRole(input.role)}.

Accept the invitation using this link:

${input.acceptUrl}

This invitation expires on ${formatExpiryDate(input.expiresAt)}.

If you were not expecting this invitation, you can safely ignore this email. You will not be added to the workspace unless you follow the link above.

— The Aforden Team
    `.trim();

    return {
        subject,
        html,
        text,
    };
}
