/**
 * Phase 1.23.3 — Brevo Email Provider Adapter
 * Sends notification emails via Brevo REST API with error categorization (retryable vs non-retryable).
 */

import {
    EmailProvider,
    SendEmailInput,
    SendEmailResult,
} from "./provider.types";
import { getEmailFromAddress } from "@/lib/services/email/config";

export class BrevoEmailProviderAdapter implements EmailProvider {
    public readonly name = "BREVO";
    private readonly apiKey: string | null = null;
    private readonly apiUrl: string;

    constructor(apiKey?: string, options?: { apiUrl?: string }) {
        this.apiKey = apiKey || process.env.BREVO_API_KEY?.trim() || null;
        this.apiUrl = options?.apiUrl || "https://api.brevo.com/v3/smtp/email";
    }

    async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
        if (!this.apiKey) {
            return {
                success: false,
                errorCode: "BREVO_NOT_CONFIGURED",
                errorMessage: "BREVO_API_KEY environment variable is not configured.",
                isRetryable: false,
            };
        }

        try {
            let senderName = "Aforden";
            let senderEmail = "notifications@aforden.com";

            if (input.from) {
                const match = input.from.match(/^(.*?)\s*<(.+)>$/);
                if (match) {
                    senderName = match[1].trim() || senderName;
                    senderEmail = match[2].trim();
                } else {
                    senderEmail = input.from.trim();
                }
            } else {
                try {
                    const fromConfig = getEmailFromAddress();
                    senderName = fromConfig.name;
                    senderEmail = fromConfig.email;
                } catch {
                    // Fallback to default
                }
            }

            const payload: Record<string, unknown> = {
                sender: {
                    name: senderName,
                    email: senderEmail,
                },
                to: [{ email: input.to.trim() }],
                subject: input.subject,
                textContent: input.bodyText,
            };

            if (input.bodyHtml) {
                payload.htmlContent = input.bodyHtml;
            }

            if (input.replyTo) {
                payload.replyTo = { email: input.replyTo.trim() };
            }

            const response = await fetch(this.apiUrl, {
                method: "POST",
                headers: {
                    accept: "application/json",
                    "content-type": "application/json",
                    "api-key": this.apiKey,
                },
                body: JSON.stringify(payload),
            });

            if (!response.ok) {
                const errorBody = (await response.json().catch(() => ({}))) as {
                    code?: string;
                    message?: string;
                };

                const isRetryable = this.classifyBrevoError(response.status, errorBody);

                return {
                    success: false,
                    errorCode: errorBody.code || `BREVO_HTTP_${response.status}`,
                    errorMessage: errorBody.message || `Brevo API rejected email with status ${response.status}`,
                    isRetryable,
                };
            }

            const data = (await response.json().catch(() => ({}))) as {
                messageId?: string;
            };

            return {
                success: true,
                providerMessageId: data.messageId || null,
                isRetryable: false,
            };
        } catch (thrown: any) {
            const isRetryable = this.classifyException(thrown);
            return {
                success: false,
                errorCode: thrown.code || thrown.name || "BREVO_TRANSPORT_EXCEPTION",
                errorMessage: thrown.message || "An unexpected error occurred during email transmission to Brevo.",
                isRetryable,
            };
        }
    }

    private classifyBrevoError(
        status: number,
        error: { code?: string; message?: string }
    ): boolean {
        if ([429, 500, 502, 503, 504].includes(status)) {
            return true;
        }
        if ([400, 401, 403, 404, 422].includes(status)) {
            return false;
        }

        const msg = (error.message || "").toLowerCase();
        if (
            msg.includes("rate limit") ||
            msg.includes("too many requests") ||
            msg.includes("timeout") ||
            msg.includes("temporary") ||
            msg.includes("server error")
        ) {
            return true;
        }

        return false;
    }

    private classifyException(err: any): boolean {
        const msg = (err.message || "").toLowerCase();
        const code = (err.code || "").toLowerCase();

        if (
            code === "etimedout" ||
            code === "econnreset" ||
            code === "econnrefused" ||
            code === "enotfound" ||
            msg.includes("timeout") ||
            msg.includes("network") ||
            msg.includes("connection") ||
            msg.includes("reset")
        ) {
            return true;
        }

        return false;
    }
}
