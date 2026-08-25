/**
 * Phase 1.13.7 — Mock Email Provider Adapter
 * For development, local testing, and environments without an external API key.
 */

import {
    EmailProvider,
    SendEmailInput,
    SendEmailResult,
} from "./provider.types";

export class MockEmailProviderAdapter implements EmailProvider {
    public readonly name = "MOCK_EMAIL";

    async sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
        const mockMessageId = `mock_email_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

        return {
            success: true,
            providerMessageId: mockMessageId,
            isRetryable: false,
        };
    }
}
