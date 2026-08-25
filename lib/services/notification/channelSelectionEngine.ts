/**
 * Phase 1.13.4 — Channel Selection Engine
 * Evaluates active delivery channels for an event and recipient using the formula:
 * ActiveChannels = EventDefaultChannels ∩ WorkspaceEnabledChannels ∩ RecipientAvailableChannels — SuppressedPreferences
 */

import { PrismaClient, Prisma } from "@/generated/prisma/client";
import {
    NotificationEventType,
    NotificationChannel,
    RecipientType,
    NotificationPreferenceScope,
} from "@/generated/prisma/enums";
import { ResolvedRecipientDestination } from "./notification.types";
import { getEventCatalogDefinition } from "./eventCatalogRegistry";
import { getEffectivePreference } from "./notificationPreferenceService";

export interface ChannelEvaluationResult {
    channel: NotificationChannel;
    suppressed: boolean;
    suppressionReason?: string;
    skipped: boolean;
    skipReason?: string;
}

/**
 * Evaluates all default channels for an event against recipient availability and user preferences.
 */
export async function resolveActiveChannels(
    prisma: PrismaClient | Prisma.TransactionClient,
    workspaceId: string,
    eventType: NotificationEventType,
    recipientType: RecipientType,
    recipientId: string,
    resolvedDestination: ResolvedRecipientDestination,
): Promise<ChannelEvaluationResult[]> {
    const catalogDef = getEventCatalogDefinition(eventType);
    const results: ChannelEvaluationResult[] = [];

    // Evaluate each default channel for this event type
    for (const channel of catalogDef.defaultChannels) {
        // Step 1: Check Recipient Destination Availability
        let isSkipped = false;
        let skipReason: string | undefined;

        switch (channel) {
            case NotificationChannel.EMAIL:
                if (!resolvedDestination.email) {
                    isSkipped = true;
                    skipReason = "NO_EMAIL_ON_FILE";
                }
                break;

            case NotificationChannel.SMS:
                if (!resolvedDestination.phone) {
                    isSkipped = true;
                    skipReason = "NO_PHONE_ON_FILE";
                }
                break;

            case NotificationChannel.IN_APP:
                if (
                    recipientType !== RecipientType.WORKSPACE_MEMBER ||
                    !resolvedDestination.userId
                ) {
                    isSkipped = true;
                    skipReason = "IN_APP_REQUIRES_WORKSPACE_MEMBER";
                }
                break;

            case NotificationChannel.PUSH:
                if (recipientType !== RecipientType.WORKSPACE_MEMBER) {
                    isSkipped = true;
                    skipReason = "PUSH_REQUIRES_WORKSPACE_MEMBER";
                }
                break;
        }

        if (isSkipped) {
            results.push({
                channel,
                suppressed: false,
                skipped: true,
                skipReason,
            });
            continue;
        }

        // Step 2: Mandatory Transactional Bypass
        // Legally binding and financial notices bypass preference suppression
        if (catalogDef.isMandatoryTransactional) {
            results.push({
                channel,
                suppressed: false,
                skipped: false,
            });
            continue;
        }

        // Step 3: Preference Suppression Check
        const scope =
            recipientType === RecipientType.WORKSPACE_MEMBER
                ? NotificationPreferenceScope.MEMBER
                : recipientType === RecipientType.CUSTOMER_CONTACT
                  ? NotificationPreferenceScope.CUSTOMER
                  : NotificationPreferenceScope.WORKSPACE;

        const isEnabled = await getEffectivePreference(
            prisma,
            workspaceId,
            scope,
            recipientId,
            eventType,
            channel,
        );

        if (!isEnabled) {
            results.push({
                channel,
                suppressed: true,
                suppressionReason: "PREFERENCE_DISABLED",
                skipped: false,
            });
        } else {
            results.push({
                channel,
                suppressed: false,
                skipped: false,
            });
        }
    }

    return results;
}
