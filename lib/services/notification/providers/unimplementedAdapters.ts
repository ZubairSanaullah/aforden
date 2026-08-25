/**
 * Phase 1.13.7 — Unimplemented Provider Adapters (SMS & Push)
 * Clearly-labeled stub adapters that throw NotificationProviderUnavailableError.
 */

import {
    SMSProvider,
    SendSmsInput,
    SendSmsResult,
    PushProvider,
    SendPushInput,
    SendPushResult,
} from "./provider.types";
import { NotificationProviderUnavailableError } from "../notificationErrors";

export class UnimplementedSMSProviderAdapter implements SMSProvider {
    public readonly name = "UNIMPLEMENTED_SMS";

    async sendSms(_input: SendSmsInput): Promise<SendSmsResult> {
        throw new NotificationProviderUnavailableError(
            "SMS notification transport is not implemented in this phase (scheduled for Phase 1.17/1.9).",
        );
    }
}

export class UnimplementedPushProviderAdapter implements PushProvider {
    public readonly name = "UNIMPLEMENTED_PUSH";

    async sendPush(_input: SendPushInput): Promise<SendPushResult> {
        throw new NotificationProviderUnavailableError(
            "Mobile Push notification transport is not implemented in this phase (scheduled for Phase 1.17/1.9).",
        );
    }
}
