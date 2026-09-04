import { Resend } from "resend";

import { getEmailFromAddress } from "./config";
import { BrevoEmailProvider } from "./brevoProvider";
import type {
    EmailProvider,
    EmailSendResult,
    SendEmailInput,
} from "./types";

export { BrevoEmailProvider };

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

export class ResendEmailProvider
    implements EmailProvider {
    public readonly name = "Resend";
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

let provider: EmailProvider | null = null;

export function getEmailProvider(): EmailProvider {
    if (!provider) {
        const configuredProvider = process.env.EMAIL_PROVIDER?.trim().toUpperCase();

        if (configuredProvider === "RESEND") {
            provider = new ResendEmailProvider();
        } else if (configuredProvider === "BREVO") {
            provider = new BrevoEmailProvider();
        } else if (process.env.BREVO_API_KEY?.trim()) {
            // Default to Brevo if BREVO_API_KEY is configured
            provider = new BrevoEmailProvider();
        } else if (process.env.RESEND_API_KEY?.trim()) {
            // Backward compatibility fallback to Resend if RESEND_API_KEY is present
            provider = new ResendEmailProvider();
        } else {
            // Default to Brevo
            provider = new BrevoEmailProvider();
        }
    }

    return provider;
}

export function setEmailProvider(customProvider: EmailProvider | null): void {
    provider = customProvider;
}

export function resetEmailProvider(): void {
    provider = null;
}