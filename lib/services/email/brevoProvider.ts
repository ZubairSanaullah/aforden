import { getEmailFromAddress } from "./config";
import type {
    EmailProvider,
    EmailSendResult,
    SendEmailInput,
} from "./types";

export class BrevoDeliveryError extends Error {
    public readonly statusCode: number;
    public readonly isRetryable: boolean;
    public readonly code?: string;

    constructor(message: string, statusCode: number, isRetryable: boolean, code?: string) {
        super(message);
        this.name = "BrevoDeliveryError";
        this.statusCode = statusCode;
        this.isRetryable = isRetryable;
        this.code = code;
    }
}

function normalizeBrevoRecipients(
    to: SendEmailInput["to"]
): Array<{ email: string; name?: string }> {
    const recipients = Array.isArray(to) ? to : [to];

    return recipients.map((recipient) => {
        const item: { email: string; name?: string } = {
            email: recipient.email.trim(),
        };
        if (recipient.name?.trim()) {
            item.name = recipient.name.trim();
        }
        return item;
    });
}

export interface BrevoEmailProviderOptions {
    apiKey?: string;
    apiUrl?: string;
    from?: { name: string; email: string };
}

export class BrevoEmailProvider implements EmailProvider {
    public readonly name = "Brevo";
    private readonly apiKey?: string;
    private readonly apiUrl: string;
    private readonly customFrom?: { name: string; email: string };

    constructor(options?: BrevoEmailProviderOptions) {
        this.apiKey = options?.apiKey;
        this.apiUrl = options?.apiUrl || "https://api.brevo.com/v3/smtp/email";
        this.customFrom = options?.from;
    }

    private resolveApiKey(): string {
        const key = this.apiKey ?? process.env.BREVO_API_KEY?.trim();
        if (!key) {
            throw new BrevoDeliveryError(
                "BREVO_API_KEY environment variable is not configured.",
                401,
                false,
                "CONFIG_ERROR"
            );
        }
        return key;
    }

    async send(input: SendEmailInput): Promise<EmailSendResult> {
        const apiKey = this.resolveApiKey();
        let from = this.customFrom;
        if (!from) {
            try {
                from = getEmailFromAddress();
            } catch {
                from = { name: "Aforden", email: "notifications@aforden.com" };
            }
        }

        const payload: Record<string, unknown> = {
            sender: {
                name: from.name,
                email: from.email,
            },
            to: normalizeBrevoRecipients(input.to),
            subject: input.subject,
            htmlContent: input.html,
        };

        if (input.text) {
            payload.textContent = input.text;
        }

        let response: Response;
        try {
            response = await fetch(this.apiUrl, {
                method: "POST",
                headers: {
                    accept: "application/json",
                    "content-type": "application/json",
                    "api-key": apiKey,
                },
                body: JSON.stringify(payload),
                signal: AbortSignal.timeout(10000),
            });
        } catch (fetchErr: unknown) {
            const message = fetchErr instanceof Error ? fetchErr.message : "Network error contacting Brevo API.";
            throw new BrevoDeliveryError(message, 504, true, "NETWORK_TIMEOUT");
        }

        if (!response.ok) {
            const errorBody = (await response.json().catch(() => ({}))) as Record<string, unknown>;
            const rawMessage =
                (typeof errorBody.message === "string" ? errorBody.message : undefined) ||
                `Brevo API error with HTTP ${response.status}`;
            const rawCode = typeof errorBody.code === "string" ? errorBody.code : undefined;

            console.error(`Brevo email delivery error [${rawCode || response.status}]: ${rawMessage}`);

            const isRetryable = response.status === 429 || response.status >= 500;
            throw new BrevoDeliveryError(rawMessage, response.status, isRetryable, rawCode);
        }

        const data = (await response.json().catch(() => ({}))) as {
            messageId?: string;
        };

        return {
            success: true,
            messageId: data?.messageId,
        };
    }
}
