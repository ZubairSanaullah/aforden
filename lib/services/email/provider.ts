import { Resend } from "resend";

import { getEmailFromAddress } from "./config";
import type {
    EmailProvider,
    EmailSendResult,
    SendEmailInput,
} from "./types";

function getResendClient(): Resend {
    const apiKey =
        process.env.RESEND_API_KEY?.trim();

    if (!apiKey) {
        throw new Error(
            "RESEND_API_KEY environment variable is not configured."
        );
    }

    return new Resend(apiKey);
}

function normalizeRecipients(
    to: SendEmailInput["to"]
): string[] {
    const recipients = Array.isArray(to)
        ? to
        : [to];

    return recipients.map((recipient) => {
        if (recipient.name?.trim()) {
            return `${recipient.name.trim()} <${recipient.email.trim()}>`;
        }

        return recipient.email.trim();
    });
}

class ResendEmailProvider
    implements EmailProvider {
    async send(
        input: SendEmailInput
    ): Promise<EmailSendResult> {
        const resend = getResendClient();
        const from = getEmailFromAddress();

        const fromAddress = `${from.name} <${from.email}>`;

        const { data, error } =
            await resend.emails.send({
                from: fromAddress,
                to: normalizeRecipients(input.to),
                subject: input.subject,
                html: input.html,
                ...(input.text
                    ? {
                        text: input.text,
                    }
                    : {}),
            });

        if (error) {
            console.error(
                "Resend email delivery error:",
                error
            );

            throw new Error(
                "Email could not be sent."
            );
        }

        return {
            success: true,
            messageId: data?.id,
        };
    }
}

let provider: EmailProvider | null =
    null;

export function getEmailProvider(): EmailProvider {
    if (!provider) {
        provider =
            new ResendEmailProvider();
    }

    return provider;
}