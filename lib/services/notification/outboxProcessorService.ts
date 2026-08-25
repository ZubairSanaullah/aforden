/**
 * Phase 1.13.6 — Outbox Processing & Fan-Out Pipeline
 * Claims PENDING outbox events with atomic concurrency row locking (FOR UPDATE SKIP LOCKED)
 * and expands them into semantic Notification and NotificationDelivery rows.
 */

import crypto from "crypto";
import { PrismaClient, Prisma } from "@/generated/prisma/client";
import {
    NotificationOutboxStatus,
    NotificationStatus,
    NotificationDeliveryStatus,
    RecipientType,
    NotificationChannel,
} from "@/generated/prisma/enums";
import { getEventCatalogDefinition } from "./eventCatalogRegistry";
import { resolveRecipientDestination } from "./recipientResolutionService";
import { resolveActiveChannels } from "./channelSelectionEngine";
import { NotificationRecipientUnresolvableError } from "./notificationErrors";

export interface OutboxBatchResult {
    claimed: number;
    succeeded: number;
    failed: number;
}

interface RecipientTarget {
    recipientType: RecipientType;
    recipientId: string;
}

/**
 * Extracts candidate recipient targets from an outbox event payload based on catalog recipient types.
 *
 * Operational Domain Contract (Phase 1.13.9 Contract):
 * Payloads must carry relevant identifier fields:
 * - WORKSPACE_MEMBER: `technicianId`, `newTechnicianId`, `memberId`
 * - CUSTOMER_CONTACT: `customerContactId`, `contactId`, or `customerId` (which resolves primary contact)
 * - DIRECT_RECIPIENT: `customerEmail`, `recipientEmail`, `recipientPhone`
 */
export async function extractRecipientTargets(
    prisma: PrismaClient | Prisma.TransactionClient,
    workspaceId: string,
    recipientTypes: RecipientType[],
    payload: Record<string, any>,
): Promise<RecipientTarget[]> {
    const targets: RecipientTarget[] = [];

    for (const recipientType of recipientTypes) {
        switch (recipientType) {
            case RecipientType.WORKSPACE_MEMBER: {
                const memberIds = new Set<string>();
                if (typeof payload.technicianId === "string" && payload.technicianId) {
                    memberIds.add(payload.technicianId);
                }
                if (typeof payload.newTechnicianId === "string" && payload.newTechnicianId) {
                    memberIds.add(payload.newTechnicianId);
                }
                if (typeof payload.memberId === "string" && payload.memberId) {
                    memberIds.add(payload.memberId);
                }

                for (const memberId of memberIds) {
                    targets.push({
                        recipientType: RecipientType.WORKSPACE_MEMBER,
                        recipientId: memberId,
                    });
                }
                break;
            }

            case RecipientType.CUSTOMER_CONTACT: {
                const contactIds = new Set<string>();
                if (typeof payload.customerContactId === "string" && payload.customerContactId) {
                    contactIds.add(payload.customerContactId);
                }
                if (typeof payload.contactId === "string" && payload.contactId) {
                    contactIds.add(payload.contactId);
                }

                // If no direct contactId was given but a customerId exists, look up customer's primary contact
                if (contactIds.size === 0 && typeof payload.customerId === "string" && payload.customerId) {
                    const primaryContact = await prisma.customerContact.findFirst({
                        where: {
                            customerId: payload.customerId,
                            customer: { workspaceId },
                        },
                        orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
                    });
                    if (primaryContact) {
                        contactIds.add(primaryContact.id);
                    }
                }

                for (const contactId of contactIds) {
                    targets.push({
                        recipientType: RecipientType.CUSTOMER_CONTACT,
                        recipientId: contactId,
                    });
                }
                break;
            }

            case RecipientType.DIRECT_RECIPIENT: {
                const directDestination =
                    payload.customerEmail ||
                    payload.recipientEmail ||
                    payload.recipientPhone ||
                    payload.directRecipient;

                if (typeof directDestination === "string" && directDestination) {
                    targets.push({
                        recipientType: RecipientType.DIRECT_RECIPIENT,
                        recipientId: directDestination,
                    });
                }
                break;
            }
        }
    }

    return targets;
}

/**
 * Claims a batch of PENDING outbox records using atomic `FOR UPDATE SKIP LOCKED` semantics
 * and expands them into Notification and NotificationDelivery records.
 */
export async function processNotificationOutboxBatch(
    prisma: PrismaClient,
    batchSize = 20,
): Promise<OutboxBatchResult> {
    // 1. Atomic claim using PostgreSQL FOR UPDATE SKIP LOCKED
    const claimedRows = await prisma.$queryRaw<
        Array<{
            id: string;
            workspaceId: string;
            eventType: any;
            sourceEntity: string;
            sourceId: string;
            dedupeKey: string;
            actorMemberId: string | null;
            payload: any;
            status: NotificationOutboxStatus;
            attemptCount: number;
            errorMessage: string | null;
            processedAt: Date | null;
            createdAt: Date;
        }>
    >(
        Prisma.sql`
        WITH claimable AS (
            SELECT id
            FROM "NotificationOutbox"
            WHERE status = 'PENDING'::"NotificationOutboxStatus"
            ORDER BY "createdAt" ASC
            LIMIT ${batchSize}
            FOR UPDATE SKIP LOCKED
        )
        UPDATE "NotificationOutbox" AS o
        SET status = 'PROCESSING'::"NotificationOutboxStatus"
        FROM claimable
        WHERE o.id = claimable.id
        RETURNING o.id, o."workspaceId", o."eventType", o."sourceEntity", o."sourceId", o."dedupeKey", o."actorMemberId", o.payload, o.status, o."attemptCount", o."errorMessage", o."processedAt", o."createdAt"
        `,
    );

    if (!claimedRows || claimedRows.length === 0) {
        return { claimed: 0, succeeded: 0, failed: 0 };
    }

    let succeeded = 0;
    let failed = 0;

    for (const outboxRow of claimedRows) {
        try {
            const rawPayload =
                typeof outboxRow.payload === "string"
                    ? JSON.parse(outboxRow.payload)
                    : outboxRow.payload || {};

            const catDef = getEventCatalogDefinition(outboxRow.eventType);

            // 2. Extract recipient targets
            const targets = await extractRecipientTargets(
                prisma,
                outboxRow.workspaceId,
                catDef.defaultRecipientTypes,
                rawPayload,
            );

            if (targets.length === 0) {
                throw new NotificationRecipientUnresolvableError(
                    `No resolvable recipient targets found in payload for event ${outboxRow.eventType}.`,
                );
            }

            // 3. Resolve destinations and active channels for all targets
            interface DeliveryDraft {
                channel: NotificationChannel;
                recipientType: RecipientType;
                recipientId: string;
                destination: string;
                status: NotificationDeliveryStatus;
                errorCode?: string;
                errorMessage?: string;
            }

            const deliveryDrafts: DeliveryDraft[] = [];

            for (const target of targets) {
                const resolvedDest = await resolveRecipientDestination(
                    prisma,
                    outboxRow.workspaceId,
                    target.recipientType,
                    target.recipientId,
                );

                const channelEvaluations = await resolveActiveChannels(
                    prisma,
                    outboxRow.workspaceId,
                    outboxRow.eventType,
                    target.recipientType,
                    target.recipientId,
                    resolvedDest,
                );

                for (const evalResult of channelEvaluations) {
                    let deliveryStatus: NotificationDeliveryStatus =
                        NotificationDeliveryStatus.PENDING;
                    let errorCode: string | undefined;
                    let errorMessage: string | undefined;

                    if (evalResult.skipped) {
                        deliveryStatus = NotificationDeliveryStatus.SKIPPED;
                        errorCode = evalResult.skipReason;
                        errorMessage = `Delivery skipped: ${evalResult.skipReason}`;
                    } else if (evalResult.suppressed) {
                        deliveryStatus = NotificationDeliveryStatus.SUPPRESSED;
                        errorCode = evalResult.suppressionReason;
                        errorMessage = `Delivery suppressed: ${evalResult.suppressionReason}`;
                    }

                    let destination = target.recipientId;
                    if (evalResult.channel === NotificationChannel.EMAIL) {
                        destination = resolvedDest.email || "NO_EMAIL";
                    } else if (evalResult.channel === NotificationChannel.SMS) {
                        destination = resolvedDest.phone || "NO_PHONE";
                    } else if (
                        evalResult.channel === NotificationChannel.IN_APP ||
                        evalResult.channel === NotificationChannel.PUSH
                    ) {
                        destination = resolvedDest.userId || target.recipientId;
                    }

                    deliveryDrafts.push({
                        channel: evalResult.channel,
                        recipientType: target.recipientType,
                        recipientId: target.recipientId,
                        destination,
                        status: deliveryStatus,
                        errorCode,
                        errorMessage,
                    });
                }
            }

            // 4. Atomically persist Notification, NotificationDeliveries, and mark Outbox PROCESSED
            await prisma.$transaction(async (tx) => {
                const notification = await tx.notification.create({
                    data: {
                        workspaceId: outboxRow.workspaceId,
                        eventType: outboxRow.eventType,
                        sourceEntity: outboxRow.sourceEntity,
                        sourceId: outboxRow.sourceId,
                        actorMemberId: outboxRow.actorMemberId,
                        status: NotificationStatus.PROCESSING, // Fan-out complete, dispatch pending
                        metadata: {
                            outboxId: outboxRow.id,
                            dedupeKey: outboxRow.dedupeKey,
                        },
                    },
                });

                for (const draft of deliveryDrafts) {
                    // Tier 2 Idempotency Key
                    const idempotencyKey = crypto
                        .createHash("sha256")
                        .update(
                            `${outboxRow.workspaceId}:${notification.id}:${draft.channel}:${draft.recipientType}:${draft.recipientId}`,
                        )
                        .digest("hex");

                    await tx.notificationDelivery.create({
                        data: {
                            notificationId: notification.id,
                            workspaceId: outboxRow.workspaceId,
                            channel: draft.channel,
                            recipientType: draft.recipientType,
                            recipientId: draft.recipientId,
                            destination: draft.destination,
                            status: draft.status,
                            attemptCount: 0,
                            maxAttempts: 5,
                            errorCode: draft.errorCode || null,
                            errorMessage: draft.errorMessage || null,
                            idempotencyKey,
                        },
                    });
                }

                await tx.notificationOutbox.update({
                    where: { id: outboxRow.id },
                    data: {
                        status: NotificationOutboxStatus.PROCESSED,
                        processedAt: new Date(),
                        attemptCount: { increment: 1 },
                        errorMessage: null,
                    },
                });
            });

            succeeded++;
        } catch (error: any) {
            failed++;
            const errorMessage =
                error instanceof Error ? error.message : String(error);

            // Mark outbox row FAILED so it can be diagnosed
            try {
                await prisma.notificationOutbox.update({
                    where: { id: outboxRow.id },
                    data: {
                        status: NotificationOutboxStatus.FAILED,
                        attemptCount: { increment: 1 },
                        errorMessage,
                    },
                });
            } catch {
                // Ignore secondary failure
            }
        }
    }

    return {
        claimed: claimedRows.length,
        succeeded,
        failed,
    };
}
