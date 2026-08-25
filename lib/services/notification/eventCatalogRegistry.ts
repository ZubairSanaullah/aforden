/**
 * Phase 1.13.3 — Event Catalog Registry
 * Extensible, strongly typed catalog registering all supported operational notification events,
 * payload validators, default channels, recipient types, and token variable whitelists.
 */

import { z } from "zod";
import {
    NotificationEventType,
    NotificationChannel,
    RecipientType,
} from "@/generated/prisma/enums";
import {
    workOrderCreatedPayloadSchema,
    workOrderAssignedPayloadSchema,
    workOrderReassignedPayloadSchema,
    workOrderUnassignedPayloadSchema,
    workOrderStatusChangedPayloadSchema,
    workOrderStartedPayloadSchema,
    workOrderPausedPayloadSchema,
    workOrderResumedPayloadSchema,
    workOrderCompletedPayloadSchema,
    workOrderCancelledPayloadSchema,
    scheduleAppointmentScheduledPayloadSchema,
    scheduleAppointmentRescheduledPayloadSchema,
    scheduleDispatchChangedPayloadSchema,
    scheduleAppointmentApproachingPayloadSchema,
    quoteCreatedPayloadSchema,
    quoteSentPayloadSchema,
    quoteAcceptedPayloadSchema,
    quoteRejectedPayloadSchema,
    quoteExpiredPayloadSchema,
    invoiceCreatedPayloadSchema,
    invoiceSentPayloadSchema,
    invoiceOverduePayloadSchema,
    paymentReceivedPayloadSchema,
    paymentFailedPayloadSchema,
} from "./notification.schemas";
import {
    InvalidNotificationEventType,
    NotificationPayloadValidationError,
} from "./notificationErrors";

export interface EventCatalogDefinition<TPayload = Record<string, unknown>> {
    eventType: NotificationEventType;
    domain: "WORK_ORDER" | "SCHEDULE" | "QUOTE" | "INVOICE" | "PAYMENT";
    defaultChannels: NotificationChannel[];
    defaultRecipientTypes: RecipientType[];
    isMandatoryTransactional: boolean; // If true, cannot be opted out by recipients (e.g. INVOICE_SENT)
    payloadValidator: z.ZodType<TPayload>;
    variableWhitelist: string[];
    description: string;
}

export const EVENT_CATALOG_REGISTRY: Record<
    NotificationEventType,
    EventCatalogDefinition
> = {
    // ==========================================
    // WORK ORDER EVENTS (Phases 1.6 & 1.9)
    // ==========================================
    [NotificationEventType.WORK_ORDER_CREATED]: {
        eventType: NotificationEventType.WORK_ORDER_CREATED,
        domain: "WORK_ORDER",
        defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        defaultRecipientTypes: [RecipientType.WORKSPACE_MEMBER],
        isMandatoryTransactional: false,
        payloadValidator: workOrderCreatedPayloadSchema,
        variableWhitelist: [
            "workOrderId",
            "workOrderNumber",
            "title",
            "customerId",
            "customerName",
            "priority",
        ],
        description: "Emitted when a new operational WorkOrder is created in the workspace.",
    },
    [NotificationEventType.WORK_ORDER_ASSIGNED]: {
        eventType: NotificationEventType.WORK_ORDER_ASSIGNED,
        domain: "WORK_ORDER",
        defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        defaultRecipientTypes: [RecipientType.WORKSPACE_MEMBER],
        isMandatoryTransactional: false,
        payloadValidator: workOrderAssignedPayloadSchema,
        variableWhitelist: [
            "workOrderId",
            "workOrderNumber",
            "title",
            "customerId",
            "customerName",
            "technicianId",
            "technicianName",
            "priority",
        ],
        description: "Emitted when a lead technician is assigned to an open WorkOrder.",
    },
    [NotificationEventType.WORK_ORDER_REASSIGNED]: {
        eventType: NotificationEventType.WORK_ORDER_REASSIGNED,
        domain: "WORK_ORDER",
        defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        defaultRecipientTypes: [RecipientType.WORKSPACE_MEMBER],
        isMandatoryTransactional: false,
        payloadValidator: workOrderReassignedPayloadSchema,
        variableWhitelist: [
            "workOrderId",
            "workOrderNumber",
            "title",
            "customerId",
            "customerName",
            "previousTechnicianId",
            "newTechnicianId",
            "newTechnicianName",
        ],
        description: "Emitted when the assigned technician on a WorkOrder is changed.",
    },
    [NotificationEventType.WORK_ORDER_UNASSIGNED]: {
        eventType: NotificationEventType.WORK_ORDER_UNASSIGNED,
        domain: "WORK_ORDER",
        defaultChannels: [NotificationChannel.IN_APP],
        defaultRecipientTypes: [RecipientType.WORKSPACE_MEMBER],
        isMandatoryTransactional: false,
        payloadValidator: workOrderUnassignedPayloadSchema,
        variableWhitelist: [
            "workOrderId",
            "workOrderNumber",
            "title",
            "customerId",
            "customerName",
            "previousTechnicianId",
        ],
        description: "Emitted when a technician assignment is removed from a WorkOrder.",
    },
    [NotificationEventType.WORK_ORDER_STATUS_CHANGED]: {
        eventType: NotificationEventType.WORK_ORDER_STATUS_CHANGED,
        domain: "WORK_ORDER",
        defaultChannels: [NotificationChannel.IN_APP],
        defaultRecipientTypes: [RecipientType.WORKSPACE_MEMBER],
        isMandatoryTransactional: false,
        payloadValidator: workOrderStatusChangedPayloadSchema,
        variableWhitelist: [
            "workOrderId",
            "workOrderNumber",
            "title",
            "customerId",
            "previousStatus",
            "newStatus",
            "reason",
        ],
        description: "Emitted on generic WorkOrder operational status transitions.",
    },
    [NotificationEventType.WORK_ORDER_STARTED]: {
        eventType: NotificationEventType.WORK_ORDER_STARTED,
        domain: "WORK_ORDER",
        defaultChannels: [NotificationChannel.IN_APP],
        defaultRecipientTypes: [RecipientType.WORKSPACE_MEMBER],
        isMandatoryTransactional: false,
        payloadValidator: workOrderStartedPayloadSchema,
        variableWhitelist: [
            "workOrderId",
            "workOrderNumber",
            "title",
            "customerId",
            "technicianId",
            "technicianName",
            "startedAt",
        ],
        description: "Emitted when a technician starts active on-site work on a WorkOrder.",
    },
    [NotificationEventType.WORK_ORDER_PAUSED]: {
        eventType: NotificationEventType.WORK_ORDER_PAUSED,
        domain: "WORK_ORDER",
        defaultChannels: [NotificationChannel.IN_APP],
        defaultRecipientTypes: [RecipientType.WORKSPACE_MEMBER],
        isMandatoryTransactional: false,
        payloadValidator: workOrderPausedPayloadSchema,
        variableWhitelist: [
            "workOrderId",
            "workOrderNumber",
            "title",
            "customerId",
            "technicianId",
            "pausedAt",
            "holdReason",
        ],
        description: "Emitted when active field work is placed on hold.",
    },
    [NotificationEventType.WORK_ORDER_RESUMED]: {
        eventType: NotificationEventType.WORK_ORDER_RESUMED,
        domain: "WORK_ORDER",
        defaultChannels: [NotificationChannel.IN_APP],
        defaultRecipientTypes: [RecipientType.WORKSPACE_MEMBER],
        isMandatoryTransactional: false,
        payloadValidator: workOrderResumedPayloadSchema,
        variableWhitelist: [
            "workOrderId",
            "workOrderNumber",
            "title",
            "customerId",
            "technicianId",
            "resumedAt",
        ],
        description: "Emitted when on-hold field work is resumed.",
    },
    [NotificationEventType.WORK_ORDER_COMPLETED]: {
        eventType: NotificationEventType.WORK_ORDER_COMPLETED,
        domain: "WORK_ORDER",
        defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        defaultRecipientTypes: [
            RecipientType.WORKSPACE_MEMBER,
            RecipientType.CUSTOMER_CONTACT,
        ],
        isMandatoryTransactional: false,
        payloadValidator: workOrderCompletedPayloadSchema,
        variableWhitelist: [
            "workOrderId",
            "workOrderNumber",
            "title",
            "customerId",
            "customerName",
            "technicianId",
            "technicianName",
            "completedAt",
            "completionNotes",
        ],
        description: "Emitted when all field labor is completed and resolution recorded.",
    },
    [NotificationEventType.WORK_ORDER_CANCELLED]: {
        eventType: NotificationEventType.WORK_ORDER_CANCELLED,
        domain: "WORK_ORDER",
        defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        defaultRecipientTypes: [
            RecipientType.WORKSPACE_MEMBER,
            RecipientType.CUSTOMER_CONTACT,
        ],
        isMandatoryTransactional: false,
        payloadValidator: workOrderCancelledPayloadSchema,
        variableWhitelist: [
            "workOrderId",
            "workOrderNumber",
            "title",
            "customerId",
            "cancelledAt",
            "cancellationReason",
        ],
        description: "Emitted when an active WorkOrder is formally cancelled.",
    },

    // ==========================================
    // SCHEDULING & DISPATCH EVENTS (Phase 1.8)
    // ==========================================
    [NotificationEventType.SCHEDULE_APPOINTMENT_SCHEDULED]: {
        eventType: NotificationEventType.SCHEDULE_APPOINTMENT_SCHEDULED,
        domain: "SCHEDULE",
        defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        defaultRecipientTypes: [
            RecipientType.WORKSPACE_MEMBER,
            RecipientType.CUSTOMER_CONTACT,
        ],
        isMandatoryTransactional: false,
        payloadValidator: scheduleAppointmentScheduledPayloadSchema,
        variableWhitelist: [
            "appointmentId",
            "appointmentNumber",
            "workOrderId",
            "workOrderNumber",
            "technicianId",
            "technicianName",
            "scheduledStart",
            "scheduledEnd",
            "customerId",
        ],
        description: "Emitted when an appointment calendar window is scheduled for a technician.",
    },
    [NotificationEventType.SCHEDULE_APPOINTMENT_RESCHEDULED]: {
        eventType: NotificationEventType.SCHEDULE_APPOINTMENT_RESCHEDULED,
        domain: "SCHEDULE",
        defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        defaultRecipientTypes: [
            RecipientType.WORKSPACE_MEMBER,
            RecipientType.CUSTOMER_CONTACT,
        ],
        isMandatoryTransactional: false,
        payloadValidator: scheduleAppointmentRescheduledPayloadSchema,
        variableWhitelist: [
            "appointmentId",
            "appointmentNumber",
            "workOrderId",
            "workOrderNumber",
            "technicianId",
            "previousStart",
            "previousEnd",
            "newStart",
            "newEnd",
            "rescheduleReason",
        ],
        description: "Emitted when an existing appointment time slot is shifted.",
    },
    [NotificationEventType.SCHEDULE_DISPATCH_CHANGED]: {
        eventType: NotificationEventType.SCHEDULE_DISPATCH_CHANGED,
        domain: "SCHEDULE",
        defaultChannels: [NotificationChannel.IN_APP],
        defaultRecipientTypes: [RecipientType.WORKSPACE_MEMBER],
        isMandatoryTransactional: false,
        payloadValidator: scheduleDispatchChangedPayloadSchema,
        variableWhitelist: [
            "appointmentId",
            "appointmentNumber",
            "workOrderId",
            "technicianId",
            "technicianName",
            "dispatchStatus",
            "dispatchedAt",
        ],
        description: "Emitted when an appointment is formally dispatched to the field.",
    },
    [NotificationEventType.SCHEDULE_APPOINTMENT_APPROACHING]: {
        eventType: NotificationEventType.SCHEDULE_APPOINTMENT_APPROACHING,
        domain: "SCHEDULE",
        defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        defaultRecipientTypes: [
            RecipientType.WORKSPACE_MEMBER,
            RecipientType.CUSTOMER_CONTACT,
        ],
        isMandatoryTransactional: false,
        payloadValidator: scheduleAppointmentApproachingPayloadSchema,
        variableWhitelist: [
            "appointmentId",
            "appointmentNumber",
            "workOrderId",
            "technicianId",
            "customerId",
            "customerName",
            "scheduledStart",
            "minutesUntilStart",
        ],
        description: "Emitted prior to an upcoming appointment as a calendar reminder.",
    },

    // ==========================================
    // QUOTES & ESTIMATES EVENTS (Phase 1.11)
    // ==========================================
    [NotificationEventType.QUOTE_CREATED]: {
        eventType: NotificationEventType.QUOTE_CREATED,
        domain: "QUOTE",
        defaultChannels: [NotificationChannel.IN_APP],
        defaultRecipientTypes: [RecipientType.WORKSPACE_MEMBER],
        isMandatoryTransactional: false,
        payloadValidator: quoteCreatedPayloadSchema,
        variableWhitelist: [
            "quoteId",
            "quoteNumber",
            "title",
            "customerId",
            "customerName",
            "totalAmount",
        ],
        description: "Emitted when a new commercial estimate or proposal is drafted.",
    },
    [NotificationEventType.QUOTE_SENT]: {
        eventType: NotificationEventType.QUOTE_SENT,
        domain: "QUOTE",
        defaultChannels: [NotificationChannel.EMAIL],
        defaultRecipientTypes: [RecipientType.CUSTOMER_CONTACT],
        isMandatoryTransactional: false,
        payloadValidator: quoteSentPayloadSchema,
        variableWhitelist: [
            "quoteId",
            "quoteNumber",
            "title",
            "customerId",
            "customerName",
            "customerEmail",
            "totalAmount",
            "expirationDate",
        ],
        description: "Emitted when a quote is sent to the customer for commercial review.",
    },
    [NotificationEventType.QUOTE_ACCEPTED]: {
        eventType: NotificationEventType.QUOTE_ACCEPTED,
        domain: "QUOTE",
        defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        defaultRecipientTypes: [RecipientType.WORKSPACE_MEMBER],
        isMandatoryTransactional: false,
        payloadValidator: quoteAcceptedPayloadSchema,
        variableWhitelist: [
            "quoteId",
            "quoteNumber",
            "title",
            "customerId",
            "customerName",
            "totalAmount",
            "acceptedAt",
            "approvedByCustomer",
        ],
        description: "Emitted when a quote is approved/accepted by the customer.",
    },
    [NotificationEventType.QUOTE_REJECTED]: {
        eventType: NotificationEventType.QUOTE_REJECTED,
        domain: "QUOTE",
        defaultChannels: [NotificationChannel.IN_APP, NotificationChannel.EMAIL],
        defaultRecipientTypes: [RecipientType.WORKSPACE_MEMBER],
        isMandatoryTransactional: false,
        payloadValidator: quoteRejectedPayloadSchema,
        variableWhitelist: [
            "quoteId",
            "quoteNumber",
            "title",
            "customerId",
            "customerName",
            "rejectedAt",
            "rejectionReason",
        ],
        description: "Emitted when a quote is rejected by the customer.",
    },
    [NotificationEventType.QUOTE_EXPIRED]: {
        eventType: NotificationEventType.QUOTE_EXPIRED,
        domain: "QUOTE",
        defaultChannels: [NotificationChannel.IN_APP],
        defaultRecipientTypes: [RecipientType.WORKSPACE_MEMBER],
        isMandatoryTransactional: false,
        payloadValidator: quoteExpiredPayloadSchema,
        variableWhitelist: [
            "quoteId",
            "quoteNumber",
            "title",
            "customerId",
            "customerName",
            "totalAmount",
            "expiredAt",
        ],
        description: "Emitted when a quote reaches its expiration date without acceptance.",
    },

    // ==========================================
    // INVOICING & PAYMENTS EVENTS (Phase 1.12)
    // ==========================================
    [NotificationEventType.INVOICE_CREATED]: {
        eventType: NotificationEventType.INVOICE_CREATED,
        domain: "INVOICE",
        defaultChannels: [NotificationChannel.IN_APP],
        defaultRecipientTypes: [RecipientType.WORKSPACE_MEMBER],
        isMandatoryTransactional: false,
        payloadValidator: invoiceCreatedPayloadSchema,
        variableWhitelist: [
            "invoiceId",
            "invoiceNumber",
            "title",
            "customerId",
            "customerName",
            "totalAmount",
            "dueDate",
        ],
        description: "Emitted when a draft invoice is generated.",
    },
    [NotificationEventType.INVOICE_SENT]: {
        eventType: NotificationEventType.INVOICE_SENT,
        domain: "INVOICE",
        defaultChannels: [NotificationChannel.EMAIL],
        defaultRecipientTypes: [RecipientType.CUSTOMER_CONTACT],
        isMandatoryTransactional: true, // Mandatory financial demand for payment
        payloadValidator: invoiceSentPayloadSchema,
        variableWhitelist: [
            "invoiceId",
            "invoiceNumber",
            "title",
            "customerId",
            "customerName",
            "customerEmail",
            "totalAmount",
            "dueDate",
            "currencyCode",
        ],
        description: "Emitted when an invoice is issued/sent to the customer.",
    },
    [NotificationEventType.INVOICE_OVERDUE]: {
        eventType: NotificationEventType.INVOICE_OVERDUE,
        domain: "INVOICE",
        defaultChannels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
        defaultRecipientTypes: [
            RecipientType.CUSTOMER_CONTACT,
            RecipientType.WORKSPACE_MEMBER,
        ],
        isMandatoryTransactional: true, // Mandatory delinquent debt notice
        payloadValidator: invoiceOverduePayloadSchema,
        variableWhitelist: [
            "invoiceId",
            "invoiceNumber",
            "title",
            "customerId",
            "customerName",
            "totalAmount",
            "amountDue",
            "dueDate",
            "daysOverdue",
        ],
        description: "Emitted when an outstanding invoice passes its due date.",
    },
    [NotificationEventType.PAYMENT_RECEIVED]: {
        eventType: NotificationEventType.PAYMENT_RECEIVED,
        domain: "PAYMENT",
        defaultChannels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
        defaultRecipientTypes: [
            RecipientType.CUSTOMER_CONTACT,
            RecipientType.WORKSPACE_MEMBER,
        ],
        isMandatoryTransactional: true, // Mandatory legal payment receipt
        payloadValidator: paymentReceivedPayloadSchema,
        variableWhitelist: [
            "paymentId",
            "paymentNumber",
            "invoiceId",
            "invoiceNumber",
            "customerId",
            "customerName",
            "amount",
            "currencyCode",
            "paymentMethod",
            "paymentDate",
            "remainingInvoiceBalance",
        ],
        description: "Emitted when a payment is recorded against an invoice.",
    },
    [NotificationEventType.PAYMENT_FAILED]: {
        eventType: NotificationEventType.PAYMENT_FAILED,
        domain: "PAYMENT",
        defaultChannels: [NotificationChannel.EMAIL, NotificationChannel.IN_APP],
        defaultRecipientTypes: [
            RecipientType.CUSTOMER_CONTACT,
            RecipientType.WORKSPACE_MEMBER,
        ],
        isMandatoryTransactional: true, // Mandatory payment breach / failure alert
        payloadValidator: paymentFailedPayloadSchema,
        variableWhitelist: [
            "paymentId",
            "paymentNumber",
            "invoiceId",
            "invoiceNumber",
            "customerId",
            "customerName",
            "amount",
            "currencyCode",
            "reason",
        ],
        description: "Emitted when a recorded payment fails, bounces, or is voided.",
    },
};

/**
 * Helper to retrieve the catalog definition for a given event type.
 */
export function getEventCatalogDefinition(
    eventType: NotificationEventType,
): EventCatalogDefinition {
    const def = EVENT_CATALOG_REGISTRY[eventType];
    if (!def) {
        throw new InvalidNotificationEventType(
            `Unknown or unregistered notification event type: ${eventType}`,
        );
    }
    return def;
}

/**
 * Validates an event payload against its catalog definition schema.
 */
export function validateEventPayload<T = Record<string, unknown>>(
    eventType: NotificationEventType,
    payload: unknown,
): T {
    const def = getEventCatalogDefinition(eventType);
    const result = def.payloadValidator.safeParse(payload);
    if (!result.success) {
        throw new NotificationPayloadValidationError(
            `Payload validation failed for event ${eventType}: ${result.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; ")}`,
        );
    }
    return result.data as T;
}

/**
 * Returns the variable whitelist for a given event type.
 */
export function getEventVariableWhitelist(
    eventType: NotificationEventType,
): string[] {
    return getEventCatalogDefinition(eventType).variableWhitelist;
}
