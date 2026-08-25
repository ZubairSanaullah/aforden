/**
 * Phase 1.13.7 — Resend Email Provider Adapter
 * Sends emails via Resend SDK with robust error categorization (retryable vs non-retryable).
 */

import { Resend } from "resend";
import {
    EmailProvider,
    SendEmailInput,
    SendEmailResult,
} from "./provider.types";
import { getEmailFromAddress } from "@/lib/services/email/config";

export class ResendEmailProviderAdapter implements EmailProvider {
    public readonly name = "RESEND";
    private resendClient: Resend | null = null;

    constructor(apiKey?: string) {
        const key = apiKey || process.env.RESEND_API_KEY?.trim();
        if (key) {
            this.resendClient = new Resend(key);
        }
    }

    async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
        if (!this.resendClient) {
            return {
                success: false,
                errorCode: "RESEND_NOT_CONFIGURED",
                errorMessage: "RESEND_API_KEY environment variable is not configured.",
                isRetryable: false,
            };
        }

        try {
            let fromAddress = input.from;
            if (!fromAddress) {
                try {
                    const fromConfig = getEmailFromAddress();
                    fromAddress = `${fromConfig.name} <${fromConfig.email}>`;
                } catch {
                    fromAddress = "Aforden <notifications@aforden.com>";
                }
            }

            const { data, error } = await this.resendClient.emails.send({
                from: fromAddress,
                to: input.to,
                subject: input.subject,
                text: input.bodyText,
                html: input.bodyHtml || undefined,
                replyTo: input.replyTo,
            });

            if (error) {
                const isRetryable = this.classifyResendError(error);
                return {
                    success: false,
                    errorCode: error.name || "RESEND_API_ERROR",
                    errorMessage: error.message || "Email delivery failed with provider error.",
                    isRetryable,
                };
            }

            return {
                success: true,
                providerMessageId: data?.id || null,
                isRetryable: false,
            };
        } catch (thrown: any) {
            const isRetryable = this.classifyException(thrown);
            return {
                success: false,
                errorCode: thrown.code || thrown.name || "EMAIL_TRANSPORT_EXCEPTION",
                errorMessage: thrown.message || "An unexpected error occurred during email transmission.",
                isRetryable,
            };
        }
    }

    private classifyResendError(error: {
        name?: string;
        message?: string;
        statusCode?: number | null;
    }): boolean {
        if (error.statusCode) {
            if ([429, 500, 502, 503, 504].includes(error.statusCode)) {
                return true;
            }
            if ([400, 401, 403, 404, 422].includes(error.statusCode)) {
                return false;
            }
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
            msg.includes("network")
        ) {
            return true;
        }

        return false;
    }
}
