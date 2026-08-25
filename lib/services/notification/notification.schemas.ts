/**
 * Phase 1.13.3 — Notifications & Communications Zod Validation Schemas
 * Authoritative input validation schemas for event envelopes, payload schemas, templates, and preferences.
 */

import { z } from "zod";
import {
    NotificationEventType,
    NotificationChannel,
    RecipientType,
    NotificationPreferenceScope,
    NotificationDeliveryStatus,
    NotificationStatus,
} from "@/generated/prisma/enums";

// ==========================================
// 1. WORK ORDER DOMAIN EVENT SCHEMAS (1.6 & 1.9)
// ==========================================

export const workOrderCreatedPayloadSchema = z.object({
    workOrderId: z.string().min(1, "workOrderId is required"),
    workOrderNumber: z.string().min(1, "workOrderNumber is required"),
    title: z.string().min(1, "title is required"),
    customerId: z.string().min(1, "customerId is required"),
    customerName: z.string().optional(),
    priority: z.string().min(1, "priority is required"),
});

export const workOrderAssignedPayloadSchema = z.object({
    workOrderId: z.string().min(1, "workOrderId is required"),
    workOrderNumber: z.string().min(1, "workOrderNumber is required"),
    title: z.string().min(1, "title is required"),
    customerId: z.string().min(1, "customerId is required"),
    customerName: z.string().optional(),
    technicianId: z.string().min(1, "technicianId is required"),
    technicianName: z.string().optional(),
    priority: z.string().min(1, "priority is required"),
});

export const workOrderReassignedPayloadSchema = z.object({
    workOrderId: z.string().min(1, "workOrderId is required"),
    workOrderNumber: z.string().min(1, "workOrderNumber is required"),
    title: z.string().min(1, "title is required"),
    customerId: z.string().min(1, "customerId is required"),
    customerName: z.string().optional(),
    previousTechnicianId: z.string().optional(),
    newTechnicianId: z.string().min(1, "newTechnicianId is required"),
    newTechnicianName: z.string().optional(),
});

export const workOrderUnassignedPayloadSchema = z.object({
    workOrderId: z.string().min(1, "workOrderId is required"),
    workOrderNumber: z.string().min(1, "workOrderNumber is required"),
    title: z.string().min(1, "title is required"),
    customerId: z.string().min(1, "customerId is required"),
    customerName: z.string().optional(),
    previousTechnicianId: z.string().min(1, "previousTechnicianId is required"),
});

export const workOrderStatusChangedPayloadSchema = z.object({
    workOrderId: z.string().min(1, "workOrderId is required"),
    workOrderNumber: z.string().min(1, "workOrderNumber is required"),
    title: z.string().min(1, "title is required"),
    customerId: z.string().min(1, "customerId is required"),
    previousStatus: z.string().min(1, "previousStatus is required"),
    newStatus: z.string().min(1, "newStatus is required"),
    reason: z.string().optional(),
});

export const workOrderStartedPayloadSchema = z.object({
    workOrderId: z.string().min(1, "workOrderId is required"),
    workOrderNumber: z.string().min(1, "workOrderNumber is required"),
    title: z.string().min(1, "title is required"),
    customerId: z.string().min(1, "customerId is required"),
    technicianId: z.string().min(1, "technicianId is required"),
    technicianName: z.string().optional(),
    startedAt: z.string().min(1, "startedAt is required"),
});

export const workOrderPausedPayloadSchema = z.object({
    workOrderId: z.string().min(1, "workOrderId is required"),
    workOrderNumber: z.string().min(1, "workOrderNumber is required"),
    title: z.string().min(1, "title is required"),
    customerId: z.string().min(1, "customerId is required"),
    technicianId: z.string().min(1, "technicianId is required"),
    pausedAt: z.string().min(1, "pausedAt is required"),
    holdReason: z.string().min(1, "holdReason is required"),
});

export const workOrderResumedPayloadSchema = z.object({
    workOrderId: z.string().min(1, "workOrderId is required"),
    workOrderNumber: z.string().min(1, "workOrderNumber is required"),
    title: z.string().min(1, "title is required"),
    customerId: z.string().min(1, "customerId is required"),
    technicianId: z.string().min(1, "technicianId is required"),
    resumedAt: z.string().min(1, "resumedAt is required"),
});

export const workOrderCompletedPayloadSchema = z.object({
    workOrderId: z.string().min(1, "workOrderId is required"),
    workOrderNumber: z.string().min(1, "workOrderNumber is required"),
    title: z.string().min(1, "title is required"),
    customerId: z.string().min(1, "customerId is required"),
    customerName: z.string().optional(),
    technicianId: z.string().optional(),
    technicianName: z.string().optional(),
    completedAt: z.string().min(1, "completedAt is required"),
    completionNotes: z.string().optional(),
});

export const workOrderCancelledPayloadSchema = z.object({
    workOrderId: z.string().min(1, "workOrderId is required"),
    workOrderNumber: z.string().min(1, "workOrderNumber is required"),
    title: z.string().min(1, "title is required"),
    customerId: z.string().min(1, "customerId is required"),
    cancelledAt: z.string().min(1, "cancelledAt is required"),
    cancellationReason: z.string().min(1, "cancellationReason is required"),
});

// ==========================================
// 2. SCHEDULING & DISPATCH EVENT SCHEMAS (1.8)
// ==========================================

export const scheduleAppointmentScheduledPayloadSchema = z.object({
    appointmentId: z.string().min(1, "appointmentId is required"),
    appointmentNumber: z.string().min(1, "appointmentNumber is required"),
    workOrderId: z.string().min(1, "workOrderId is required"),
    workOrderNumber: z.string().optional(),
    technicianId: z.string().min(1, "technicianId is required"),
    technicianName: z.string().optional(),
    scheduledStart: z.string().min(1, "scheduledStart is required"),
    scheduledEnd: z.string().min(1, "scheduledEnd is required"),
    customerId: z.string().optional(),
});

export const scheduleAppointmentRescheduledPayloadSchema = z.object({
    appointmentId: z.string().min(1, "appointmentId is required"),
    appointmentNumber: z.string().min(1, "appointmentNumber is required"),
    workOrderId: z.string().min(1, "workOrderId is required"),
    workOrderNumber: z.string().optional(),
    technicianId: z.string().min(1, "technicianId is required"),
    previousStart: z.string().min(1, "previousStart is required"),
    previousEnd: z.string().min(1, "previousEnd is required"),
    newStart: z.string().min(1, "newStart is required"),
    newEnd: z.string().min(1, "newEnd is required"),
    rescheduleReason: z.string().optional(),
});

export const scheduleDispatchChangedPayloadSchema = z.object({
    appointmentId: z.string().min(1, "appointmentId is required"),
    appointmentNumber: z.string().min(1, "appointmentNumber is required"),
    workOrderId: z.string().min(1, "workOrderId is required"),
    technicianId: z.string().min(1, "technicianId is required"),
    technicianName: z.string().optional(),
    dispatchStatus: z.string().min(1, "dispatchStatus is required"),
    dispatchedAt: z.string().optional(),
});

export const scheduleAppointmentApproachingPayloadSchema = z.object({
    appointmentId: z.string().min(1, "appointmentId is required"),
    appointmentNumber: z.string().min(1, "appointmentNumber is required"),
    workOrderId: z.string().min(1, "workOrderId is required"),
    technicianId: z.string().min(1, "technicianId is required"),
    customerId: z.string().optional(),
    customerName: z.string().optional(),
    scheduledStart: z.string().min(1, "scheduledStart is required"),
    minutesUntilStart: z.number().int().positive("minutesUntilStart must be a positive integer"),
});

// ==========================================
// 3. QUOTES & ESTIMATES EVENT SCHEMAS (1.11)
// ==========================================

export const quoteCreatedPayloadSchema = z.object({
    quoteId: z.string().min(1, "quoteId is required"),
    quoteNumber: z.string().min(1, "quoteNumber is required"),
    title: z.string().min(1, "title is required"),
    customerId: z.string().min(1, "customerId is required"),
    customerName: z.string().optional(),
    totalAmount: z.string().min(1, "totalAmount is required"),
});

export const quoteSentPayloadSchema = z.object({
    quoteId: z.string().min(1, "quoteId is required"),
    quoteNumber: z.string().min(1, "quoteNumber is required"),
    title: z.string().min(1, "title is required"),
    customerId: z.string().min(1, "customerId is required"),
    customerName: z.string().optional(),
    customerEmail: z.string().email().optional(),
    totalAmount: z.string().min(1, "totalAmount is required"),
    expirationDate: z.string().optional(),
});

export const quoteAcceptedPayloadSchema = z.object({
    quoteId: z.string().min(1, "quoteId is required"),
    quoteNumber: z.string().min(1, "quoteNumber is required"),
    title: z.string().min(1, "title is required"),
    customerId: z.string().min(1, "customerId is required"),
    customerName: z.string().optional(),
    totalAmount: z.string().min(1, "totalAmount is required"),
    acceptedAt: z.string().min(1, "acceptedAt is required"),
    approvedByCustomer: z.string().optional(),
});

export const quoteRejectedPayloadSchema = z.object({
    quoteId: z.string().min(1, "quoteId is required"),
    quoteNumber: z.string().min(1, "quoteNumber is required"),
    title: z.string().min(1, "title is required"),
    customerId: z.string().min(1, "customerId is required"),
    customerName: z.string().optional(),
    rejectedAt: z.string().min(1, "rejectedAt is required"),
    rejectionReason: z.string().optional(),
});

export const quoteExpiredPayloadSchema = z.object({
    quoteId: z.string().min(1, "quoteId is required"),
    quoteNumber: z.string().min(1, "quoteNumber is required"),
    title: z.string().min(1, "title is required"),
    customerId: z.string().min(1, "customerId is required"),
    customerName: z.string().optional(),
    totalAmount: z.string().min(1, "totalAmount is required"),
    expiredAt: z.string().min(1, "expiredAt is required"),
});

// ==========================================
// 4. INVOICING & PAYMENTS EVENT SCHEMAS (1.12)
// ==========================================

export const invoiceCreatedPayloadSchema = z.object({
    invoiceId: z.string().min(1, "invoiceId is required"),
    invoiceNumber: z.string().min(1, "invoiceNumber is required"),
    title: z.string().min(1, "title is required"),
    customerId: z.string().min(1, "customerId is required"),
    customerName: z.string().optional(),
    totalAmount: z.string().min(1, "totalAmount is required"),
    dueDate: z.string().min(1, "dueDate is required"),
});

export const invoiceSentPayloadSchema = z.object({
    invoiceId: z.string().min(1, "invoiceId is required"),
    invoiceNumber: z.string().min(1, "invoiceNumber is required"),
    title: z.string().min(1, "title is required"),
    customerId: z.string().min(1, "customerId is required"),
    customerName: z.string().optional(),
    customerEmail: z.string().email().optional(),
    totalAmount: z.string().min(1, "totalAmount is required"),
    dueDate: z.string().min(1, "dueDate is required"),
    currencyCode: z.string().length(3, "currencyCode must be 3 characters").default("USD"),
});

export const invoiceOverduePayloadSchema = z.object({
    invoiceId: z.string().min(1, "invoiceId is required"),
    invoiceNumber: z.string().min(1, "invoiceNumber is required"),
    title: z.string().min(1, "title is required"),
    customerId: z.string().min(1, "customerId is required"),
    customerName: z.string().optional(),
    totalAmount: z.string().min(1, "totalAmount is required"),
    amountDue: z.string().min(1, "amountDue is required"),
    dueDate: z.string().min(1, "dueDate is required"),
    daysOverdue: z.number().int().nonnegative("daysOverdue must be non-negative"),
});

export const paymentReceivedPayloadSchema = z.object({
    paymentId: z.string().min(1, "paymentId is required"),
    paymentNumber: z.string().min(1, "paymentNumber is required"),
    invoiceId: z.string().min(1, "invoiceId is required"),
    invoiceNumber: z.string().min(1, "invoiceNumber is required"),
    customerId: z.string().min(1, "customerId is required"),
    customerName: z.string().optional(),
    amount: z.string().min(1, "amount is required"),
    currencyCode: z.string().length(3).default("USD"),
    paymentMethod: z.string().min(1, "paymentMethod is required"),
    paymentDate: z.string().min(1, "paymentDate is required"),
    remainingInvoiceBalance: z.string().min(1, "remainingInvoiceBalance is required"),
});

export const paymentFailedPayloadSchema = z.object({
    paymentId: z.string().optional(),
    paymentNumber: z.string().optional(),
    invoiceId: z.string().min(1, "invoiceId is required"),
    invoiceNumber: z.string().min(1, "invoiceNumber is required"),
    customerId: z.string().min(1, "customerId is required"),
    customerName: z.string().optional(),
    amount: z.string().min(1, "amount is required"),
    currencyCode: z.string().length(3).default("USD"),
    reason: z.string().optional(),
});

// ==========================================
// 5. ENVELOPE & MANAGEMENT SCHEMAS
// ==========================================

export const emitNotificationEnvelopeSchema = z.object({
    workspaceId: z.string().min(1, "workspaceId is required"),
    eventType: z.nativeEnum(NotificationEventType, {
        message: "Invalid NotificationEventType",
    }),
    sourceEntity: z.string().min(1, "sourceEntity is required").max(64),
    sourceId: z.string().min(1, "sourceId is required").max(64),
    actorMemberId: z.string().nullable().optional(),
    payload: z.record(z.string(), z.unknown()),
    dedupeKey: z.string().max(128).optional(),
});

export const updateNotificationPreferenceSchema = z.object({
    scope: z.nativeEnum(NotificationPreferenceScope, {
        message: "Invalid NotificationPreferenceScope",
    }),
    scopeId: z.string().max(64).nullable().optional(),
    eventType: z.nativeEnum(NotificationEventType, {
        message: "Invalid NotificationEventType",
    }),
    channel: z.nativeEnum(NotificationChannel, {
        message: "Invalid NotificationChannel",
    }),
    isEnabled: z.boolean(),
});

export const createNotificationTemplateSchema = z.object({
    eventType: z.nativeEnum(NotificationEventType, {
        message: "Invalid NotificationEventType",
    }),
    channel: z.nativeEnum(NotificationChannel, {
        message: "Invalid NotificationChannel",
    }),
    locale: z.string().min(2).max(10).default("en"),
    subject: z.string().max(255).nullable().optional(),
    bodyHtml: z.string().nullable().optional(),
    bodyText: z.string().min(1, "bodyText is required"),
    isActive: z.boolean().default(true),
});

export const updateNotificationTemplateSchema = z.object({
    subject: z.string().max(255).nullable().optional(),
    bodyHtml: z.string().nullable().optional(),
    bodyText: z.string().min(1, "bodyText is required").optional(),
    isActive: z.boolean().optional(),
});

export const queryNotificationFeedSchema = z.object({
    isRead: z.coerce.boolean().optional(),
    isArchived: z.coerce.boolean().optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    offset: z.coerce.number().int().nonnegative().optional(),
});

export const queryNotificationLogsSchema = z.object({
    notificationId: z.string().optional(),
    deliveryId: z.string().optional(),
    channel: z.nativeEnum(NotificationChannel).optional(),
    status: z.nativeEnum(NotificationDeliveryStatus).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(50),
});

export const queryNotificationHistorySchema = z.object({
    eventType: z.nativeEnum(NotificationEventType).optional(),
    status: z.nativeEnum(NotificationStatus).optional(),
    channel: z.nativeEnum(NotificationChannel).optional(),
    sourceEntity: z.string().optional(),
    sourceId: z.string().optional(),
    startDate: z.string().datetime({ offset: true }).optional(),
    endDate: z.string().datetime({ offset: true }).optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    offset: z.coerce.number().int().nonnegative().optional(),
});

export const queryNotificationPreferencesSchema = z.object({
    scope: z.nativeEnum(NotificationPreferenceScope).optional(),
    scopeId: z.string().optional(),
});

