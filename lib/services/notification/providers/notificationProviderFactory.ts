/**
 * Phase 1.13.7 — Notification Provider Factory
 * Lazy singleton provider instantiation with environment-based selection and test override support.
 */

import {
    EmailProvider,
    InAppProvider,
    SMSProvider,
    PushProvider,
} from "./provider.types";
import { DatabaseInAppProviderAdapter } from "./databaseInAppProviderAdapter";
import { ResendEmailProviderAdapter } from "./resendEmailProviderAdapter";
import { MockEmailProviderAdapter } from "./mockEmailProviderAdapter";
import {
    UnimplementedSMSProviderAdapter,
    UnimplementedPushProviderAdapter,
} from "./unimplementedAdapters";

let emailProviderInstance: EmailProvider | null = null;
let inAppProviderInstance: InAppProvider | null = null;
let smsProviderInstance: SMSProvider | null = null;
let pushProviderInstance: PushProvider | null = null;

export class NotificationProviderFactory {
    static getEmailProvider(): EmailProvider {
        if (!emailProviderInstance) {
            const hasResendKey = !!process.env.RESEND_API_KEY?.trim();
            if (hasResendKey) {
                emailProviderInstance = new ResendEmailProviderAdapter();
            } else {
                emailProviderInstance = new MockEmailProviderAdapter();
            }
        }
        return emailProviderInstance;
    }

    static getInAppProvider(): InAppProvider {
        if (!inAppProviderInstance) {
            inAppProviderInstance = new DatabaseInAppProviderAdapter();
        }
        return inAppProviderInstance;
    }

    static getSMSProvider(): SMSProvider {
        if (!smsProviderInstance) {
            smsProviderInstance = new UnimplementedSMSProviderAdapter();
        }
        return smsProviderInstance;
    }

    static getPushProvider(): PushProvider {
        if (!pushProviderInstance) {
            pushProviderInstance = new UnimplementedPushProviderAdapter();
        }
        return pushProviderInstance;
    }

    // Testing and injection hooks
    static setEmailProvider(provider: EmailProvider | null): void {
        emailProviderInstance = provider;
    }

    static setInAppProvider(provider: InAppProvider | null): void {
        inAppProviderInstance = provider;
    }

    static setSMSProvider(provider: SMSProvider | null): void {
        smsProviderInstance = provider;
    }

    static setPushProvider(provider: PushProvider | null): void {
        pushProviderInstance = provider;
    }

    static reset(): void {
        emailProviderInstance = null;
        inAppProviderInstance = null;
        smsProviderInstance = null;
        pushProviderInstance = null;
    }
}
