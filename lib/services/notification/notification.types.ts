/**
 * Phase 1.13.3 — Notifications & Communications Domain Types & DTOs
 * Clean API-facing contracts without leaking internal database or transport provider types.
 */

import {
    NotificationEventType,
    NotificationChannel,
    NotificationOutboxStatus,
    NotificationStatus,
    NotificationDeliveryStatus,
    RecipientType,
    NotificationPreferenceScope,
    MembershipRole,
} from "@/generated/prisma/enums";

export {
    NotificationEventType,
    NotificationChannel,
    NotificationOutboxStatus,
    NotificationStatus,
    NotificationDeliveryStatus,
    RecipientType,
    NotificationPreferenceScope,
    MembershipRole,
};

// ==========================================
// EVENT EMISSION INTERFACES
// ==========================================

export interface EmitNotificationEventInput<
    TPayload = Record<string, unknown>,
> {
    workspaceId: string;
    eventType: NotificationEventType;
    sourceEntity: string; // e.g. "WorkOrder", "Invoice", "Quote", "ScheduleAppointment"
    sourceId: string; // e.g. workOrder.id, invoice.id
    actorMemberId?: string | null;
    payload: TPayload;
    dedupeKey?: string; // Optional caller-supplied override for legitimate recurring sequences
}

export interface NotificationOutboxRecordDTO {
    id: string;
    workspaceId: string;
    eventType: NotificationEventType;
    sourceEntity: string;
    sourceId: string;
    dedupeKey: string;
    actorMemberId: string | null;
    payload: Record<string, unknown>;
    status: NotificationOutboxStatus;
    attemptCount: number;
    errorMessage: string | null;
    processedAt: string | null;
    createdAt: string;
}

// ==========================================
// RECIPIENT RESOLUTION INTERFACES
// ==========================================

export interface ResolvedRecipientDestination {
    recipientId: string;
    recipientType: RecipientType;
    name: string;
    email?: string;
    phone?: string;
    userId?: string;
    customerId?: string;
    role?: string;
}

// ==========================================
// DELIVERY DISPATCH INTERFACES
// ==========================================

export interface NotificationDeliveryInput {
    notificationId: string;
    workspaceId: string;
    channel: NotificationChannel;
    recipientType: RecipientType;
    recipientId: string;
    destination: string;
    idempotencyKey: string;
}

export interface NotificationDeliveryResult {
    deliveryId: string;
    notificationId?: string;
    channel?: NotificationChannel;
    status: NotificationDeliveryStatus;
    attemptCount: number;
    providerMessageId?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    isRetryable?: boolean;
}

// ==========================================
// RESPONSE READ DTOs (API Models)
// ==========================================

export interface NotificationSummaryDTO {
    id: string;
    workspaceId: string;
    eventType: NotificationEventType;
    sourceEntity: string;
    sourceId: string;
    actorMemberId: string | null;
    status: NotificationStatus;
    metadata: Record<string, unknown> | null;
    deliveryCount?: number;
    createdAt: string;
    updatedAt: string;
}

export interface NotificationDetailDTO extends NotificationSummaryDTO {
    deliveries: NotificationDeliveryDTO[];
    logs: NotificationLogDTO[];
}

export interface NotificationDeliveryDTO {
    id: string;
    notificationId: string;
    workspaceId: string;
    channel: NotificationChannel;
    recipientType: RecipientType;
    recipientId: string;
    destination: string;
    status: NotificationDeliveryStatus;
    attemptCount: number;
    maxAttempts: number;
    lastAttemptAt: string | null;
    nextAttemptAt: string | null;
    deliveredAt: string | null;
    providerMessageId: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    idempotencyKey: string;
    createdAt: string;
    updatedAt: string;
}

export interface NotificationLogDTO {
    id: string;
    workspaceId: string;
    notificationId: string;
    deliveryId: string | null;
    channel: NotificationChannel;
    recipient: string;
    status: NotificationDeliveryStatus;
    attemptNumber: number;
    provider: string;
    providerMessageId: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: string;
}

export interface InAppNotificationFeedItemDTO {
    id: string;
    workspaceId: string;
    memberId: string;
    notificationId: string;
    title: string;
    body: string;
    linkUrl: string | null;
    sourceEntity: string | null;
    sourceId: string | null;
    isRead: boolean;
    readAt: string | null;
    isArchived: boolean;
    archivedAt: string | null;
    createdAt: string;
    updatedAt: string;
}

export interface NotificationTemplateDTO {
    id: string;
    workspaceId: string;
    eventType: NotificationEventType;
    channel: NotificationChannel;
    locale: string;
    subject: string | null;
    bodyHtml: string | null;
    bodyText: string;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface NotificationPreferenceDTO {
    id: string;
    workspaceId: string;
    scope: NotificationPreferenceScope;
    scopeId: string | null;
    eventType: NotificationEventType;
    channel: NotificationChannel;
    isEnabled: boolean;
    createdAt: string;
    updatedAt: string;
}

// ==========================================
// QUERY / FILTER INPUT INTERFACES
// ==========================================

export interface NotificationFeedQueryInput {
    workspaceId: string;
    memberId: string;
    isRead?: boolean;
    isArchived?: boolean;
    limit?: number;
    offset?: number;
}

export interface NotificationLogQueryInput {
    workspaceId: string;
    notificationId?: string;
    deliveryId?: string;
    channel?: NotificationChannel;
    status?: NotificationDeliveryStatus;
    limit?: number;
    offset?: number;
}

// ==========================================
// TEMPLATE ENGINE INTERFACES
// ==========================================

export interface ResolvedTemplate {
    id?: string;
    workspaceId?: string;
    eventType: NotificationEventType;
    channel: NotificationChannel;
    locale: string;
    subject?: string | null;
    bodyHtml?: string | null;
    bodyText: string;
    isCustom: boolean;
}

export interface RenderedNotificationContent {
    subject?: string;
    body: string;
    bodyHtml?: string;
}

export interface CreateNotificationTemplateInput {
    eventType: NotificationEventType;
    channel: NotificationChannel;
    locale?: string;
    subject?: string | null;
    bodyHtml?: string | null;
    bodyText: string;
    isActive?: boolean;
}

export interface UpdateNotificationTemplateInput {
    subject?: string | null;
    bodyHtml?: string | null;
    bodyText?: string;
    isActive?: boolean;
}



