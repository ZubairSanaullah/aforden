/**
 * Phase 1.13.5 — System Default Notification Templates Registry
 * Hardcoded, production-ready fallback templates for all supported notification events and channels.
 */

import {
    NotificationEventType,
    NotificationChannel,
} from "@/generated/prisma/enums";
import { ResolvedTemplate } from "./notification.types";
import { NotificationTemplateNotFoundError } from "./notificationErrors";
import { validateTemplateTokens } from "./templateEngine";
import { EVENT_CATALOG_REGISTRY } from "./eventCatalogRegistry";

type DefaultTemplateMap = Record<
    string,
    {
        subject?: string | null;
        bodyHtml?: string | null;
        bodyText: string;
    }
>;

const DEFAULT_TEMPLATES_EN: DefaultTemplateMap = {
    // ==========================================
    // WORK ORDER EVENTS
    // ==========================================
    [`${NotificationEventType.WORK_ORDER_CREATED}:${NotificationChannel.IN_APP}`]: {
        subject: null,
        bodyHtml: null,
        bodyText:
            "Work Order {{workOrderNumber}} ({{title}}) has been created with {{priority}} priority.",
    },
    [`${NotificationEventType.WORK_ORDER_CREATED}:${NotificationChannel.EMAIL}`]: {
        subject: "Work Order {{workOrderNumber}} Created - {{title}}",
        bodyHtml:
            "<p>Work Order <strong>{{workOrderNumber}}</strong> ({{title}}) has been created for {{customerName}} with priority <strong>{{priority}}</strong>.</p>",
        bodyText:
            "Work Order {{workOrderNumber}} ({{title}}) has been created for {{customerName}} with priority {{priority}}.",
    },

    [`${NotificationEventType.WORK_ORDER_ASSIGNED}:${NotificationChannel.IN_APP}`]: {
        subject: null,
        bodyHtml: null,
        bodyText:
            "You have been assigned to Work Order {{workOrderNumber}} ({{title}}).",
    },
    [`${NotificationEventType.WORK_ORDER_ASSIGNED}:${NotificationChannel.EMAIL}`]: {
        subject: "Assignment: Work Order {{workOrderNumber}} - {{title}}",
        bodyHtml:
            "<p>Work Order <strong>{{workOrderNumber}}</strong> ({{title}}) has been assigned to <strong>{{technicianName}}</strong> with priority {{priority}}.</p>",
        bodyText:
            "Work Order {{workOrderNumber}} ({{title}}) has been assigned to {{technicianName}} with priority {{priority}}.",
    },

    [`${NotificationEventType.WORK_ORDER_REASSIGNED}:${NotificationChannel.IN_APP}`]: {
        subject: null,
        bodyHtml: null,
        bodyText:
            "Work Order {{workOrderNumber}} has been reassigned to {{newTechnicianName}}.",
    },
    [`${NotificationEventType.WORK_ORDER_REASSIGNED}:${NotificationChannel.EMAIL}`]: {
        subject: "Reassignment: Work Order {{workOrderNumber}}",
        bodyHtml:
            "<p>Work Order <strong>{{workOrderNumber}}</strong> has been reassigned to <strong>{{newTechnicianName}}</strong>.</p>",
        bodyText:
            "Work Order {{workOrderNumber}} has been reassigned to {{newTechnicianName}}.",
    },

    [`${NotificationEventType.WORK_ORDER_UNASSIGNED}:${NotificationChannel.IN_APP}`]: {
        subject: null,
        bodyHtml: null,
        bodyText:
            "Technician assignment was removed from Work Order {{workOrderNumber}}.",
    },

    [`${NotificationEventType.WORK_ORDER_STATUS_CHANGED}:${NotificationChannel.IN_APP}`]: {
        subject: null,
        bodyHtml: null,
        bodyText:
            "Work Order {{workOrderNumber}} status changed from {{previousStatus}} to {{newStatus}}.",
    },

    [`${NotificationEventType.WORK_ORDER_STARTED}:${NotificationChannel.IN_APP}`]: {
        subject: null,
        bodyHtml: null,
        bodyText:
            "Technician {{technicianName}} started work on Work Order {{workOrderNumber}} at {{startedAt}}.",
    },

    [`${NotificationEventType.WORK_ORDER_PAUSED}:${NotificationChannel.IN_APP}`]: {
        subject: null,
        bodyHtml: null,
        bodyText:
            "Work Order {{workOrderNumber}} was paused. Reason: {{holdReason}}.",
    },

    [`${NotificationEventType.WORK_ORDER_RESUMED}:${NotificationChannel.IN_APP}`]: {
        subject: null,
        bodyHtml: null,
        bodyText:
            "Work on Work Order {{workOrderNumber}} has been resumed.",
    },

    [`${NotificationEventType.WORK_ORDER_COMPLETED}:${NotificationChannel.IN_APP}`]: {
        subject: null,
        bodyHtml: null,
        bodyText:
            "Work Order {{workOrderNumber}} ({{title}}) has been marked completed.",
    },
    [`${NotificationEventType.WORK_ORDER_COMPLETED}:${NotificationChannel.EMAIL}`]: {
        subject: "Work Order {{workOrderNumber}} Completed",
        bodyHtml:
            "<p>Work Order <strong>{{workOrderNumber}}</strong> ({{title}}) for {{customerName}} has been completed by <strong>{{technicianName}}</strong>.</p>",
        bodyText:
            "Work Order {{workOrderNumber}} ({{title}}) for {{customerName}} has been completed by {{technicianName}}.",
    },

    [`${NotificationEventType.WORK_ORDER_CANCELLED}:${NotificationChannel.IN_APP}`]: {
        subject: null,
        bodyHtml: null,
        bodyText:
            "Work Order {{workOrderNumber}} was cancelled. Reason: {{cancellationReason}}.",
    },
    [`${NotificationEventType.WORK_ORDER_CANCELLED}:${NotificationChannel.EMAIL}`]: {
        subject: "Work Order {{workOrderNumber}} Cancelled",
        bodyHtml:
            "<p>Work Order <strong>{{workOrderNumber}}</strong> has been cancelled. Reason: {{cancellationReason}}.</p>",
        bodyText:
            "Work Order {{workOrderNumber}} has been cancelled. Reason: {{cancellationReason}}.",
    },

    // ==========================================
    // SCHEDULING & DISPATCH EVENTS
    // ==========================================
    [`${NotificationEventType.SCHEDULE_APPOINTMENT_SCHEDULED}:${NotificationChannel.IN_APP}`]: {
        subject: null,
        bodyHtml: null,
        bodyText:
            "Appointment {{appointmentNumber}} scheduled for {{technicianName}} from {{scheduledStart}} to {{scheduledEnd}}.",
    },
    [`${NotificationEventType.SCHEDULE_APPOINTMENT_SCHEDULED}:${NotificationChannel.EMAIL}`]: {
        subject: "Appointment Confirmed: {{appointmentNumber}}",
        bodyHtml:
            "<p>Your service appointment <strong>{{appointmentNumber}}</strong> has been scheduled from <strong>{{scheduledStart}}</strong> to <strong>{{scheduledEnd}}</strong> with technician <strong>{{technicianName}}</strong>.</p>",
        bodyText:
            "Your service appointment {{appointmentNumber}} has been scheduled from {{scheduledStart}} to {{scheduledEnd}} with technician {{technicianName}}.",
    },

    [`${NotificationEventType.SCHEDULE_APPOINTMENT_RESCHEDULED}:${NotificationChannel.IN_APP}`]: {
        subject: null,
        bodyHtml: null,
        bodyText:
            "Appointment {{appointmentNumber}} rescheduled to {{newStart}} - {{newEnd}}.",
    },
    [`${NotificationEventType.SCHEDULE_APPOINTMENT_RESCHEDULED}:${NotificationChannel.EMAIL}`]: {
        subject: "Appointment Rescheduled: {{appointmentNumber}}",
        bodyHtml:
            "<p>Your appointment <strong>{{appointmentNumber}}</strong> has been rescheduled to <strong>{{newStart}} - {{newEnd}}</strong>.</p>",
        bodyText:
            "Your appointment {{appointmentNumber}} has been rescheduled to {{newStart}} - {{newEnd}}.",
    },

    [`${NotificationEventType.SCHEDULE_DISPATCH_CHANGED}:${NotificationChannel.IN_APP}`]: {
        subject: null,
        bodyHtml: null,
        bodyText:
            "Appointment {{appointmentNumber}} dispatch status changed to {{dispatchStatus}}.",
    },

    [`${NotificationEventType.SCHEDULE_APPOINTMENT_APPROACHING}:${NotificationChannel.IN_APP}`]: {
        subject: null,
        bodyHtml: null,
        bodyText:
            "Appointment {{appointmentNumber}} starts in {{minutesUntilStart}} minutes at {{scheduledStart}}.",
    },
    [`${NotificationEventType.SCHEDULE_APPOINTMENT_APPROACHING}:${NotificationChannel.EMAIL}`]: {
        subject: "Reminder: Upcoming Service Appointment {{appointmentNumber}}",
        bodyHtml:
            "<p>This is a reminder that your service appointment <strong>{{appointmentNumber}}</strong> is starting in <strong>{{minutesUntilStart}} minutes</strong> at {{scheduledStart}}.</p>",
        bodyText:
            "This is a reminder that your service appointment {{appointmentNumber}} is starting in {{minutesUntilStart}} minutes at {{scheduledStart}}.",
    },

    // ==========================================
    // QUOTES & ESTIMATES EVENTS
    // ==========================================
    [`${NotificationEventType.QUOTE_CREATED}:${NotificationChannel.IN_APP}`]: {
        subject: null,
        bodyHtml: null,
        bodyText:
            "New Quote {{quoteNumber}} ({{title}}) created for {{customerName}} with total {{totalAmount}}.",
    },

    [`${NotificationEventType.QUOTE_SENT}:${NotificationChannel.EMAIL}`]: {
        subject: "Estimate {{quoteNumber}} from Aforden: {{title}}",
        bodyHtml:
            "<p>Dear {{customerName}},</p><p>Please review estimate <strong>{{quoteNumber}}</strong> ({{title}}) for total amount <strong>{{totalAmount}}</strong>.</p>",
        bodyText:
            "Dear {{customerName}}, please review estimate {{quoteNumber}} ({{title}}) for total amount {{totalAmount}}.",
    },

    [`${NotificationEventType.QUOTE_ACCEPTED}:${NotificationChannel.IN_APP}`]: {
        subject: null,
        bodyHtml: null,
        bodyText:
            "Quote {{quoteNumber}} ({{totalAmount}}) was accepted by {{customerName}}.",
    },
    [`${NotificationEventType.QUOTE_ACCEPTED}:${NotificationChannel.EMAIL}`]: {
        subject: "Quote {{quoteNumber}} Accepted",
        bodyHtml:
            "<p>Quote <strong>{{quoteNumber}}</strong> for {{customerName}} ({{totalAmount}}) was accepted at {{acceptedAt}}.</p>",
        bodyText:
            "Quote {{quoteNumber}} for {{customerName}} ({{totalAmount}}) was accepted at {{acceptedAt}}.",
    },

    [`${NotificationEventType.QUOTE_REJECTED}:${NotificationChannel.IN_APP}`]: {
        subject: null,
        bodyHtml: null,
        bodyText:
            "Quote {{quoteNumber}} was declined by {{customerName}}. Reason: {{rejectionReason}}.",
    },
    [`${NotificationEventType.QUOTE_REJECTED}:${NotificationChannel.EMAIL}`]: {
        subject: "Quote {{quoteNumber}} Declined",
        bodyHtml:
            "<p>Quote <strong>{{quoteNumber}}</strong> was declined by {{customerName}}. Reason: {{rejectionReason}}.</p>",
        bodyText:
            "Quote {{quoteNumber}} was declined by {{customerName}}. Reason: {{rejectionReason}}.",
    },

    [`${NotificationEventType.QUOTE_EXPIRED}:${NotificationChannel.IN_APP}`]: {
        subject: null,
        bodyHtml: null,
        bodyText:
            "Quote {{quoteNumber}} for {{customerName}} expired at {{expiredAt}}.",
    },

    // ==========================================
    // INVOICING & PAYMENTS EVENTS
    // ==========================================
    [`${NotificationEventType.INVOICE_CREATED}:${NotificationChannel.IN_APP}`]: {
        subject: null,
        bodyHtml: null,
        bodyText:
            "Draft Invoice {{invoiceNumber}} created for {{customerName}} ({{totalAmount}}), due on {{dueDate}}.",
    },

    [`${NotificationEventType.INVOICE_SENT}:${NotificationChannel.EMAIL}`]: {
        subject: "Invoice {{invoiceNumber}} from Aforden (Due: {{dueDate}})",
        bodyHtml:
            "<p>Dear {{customerName}},</p><p>Please find attached invoice <strong>{{invoiceNumber}}</strong> for <strong>{{currencyCode}} {{totalAmount}}</strong>, due on <strong>{{dueDate}}</strong>.</p>",
        bodyText:
            "Dear {{customerName}}, please find attached invoice {{invoiceNumber}} for {{currencyCode}} {{totalAmount}}, due on {{dueDate}}.",
    },

    [`${NotificationEventType.INVOICE_OVERDUE}:${NotificationChannel.EMAIL}`]: {
        subject: "Payment Reminder: Invoice {{invoiceNumber}} is {{daysOverdue}} days overdue",
        bodyHtml:
            "<p>Dear {{customerName}},</p><p>This is a reminder that invoice <strong>{{invoiceNumber}}</strong> (amount due: <strong>{{amountDue}}</strong>) was due on {{dueDate}} and is now <strong>{{daysOverdue}} days overdue</strong>.</p>",
        bodyText:
            "Dear {{customerName}}, invoice {{invoiceNumber}} (amount due: {{amountDue}}) was due on {{dueDate}} and is now {{daysOverdue}} days overdue.",
    },
    [`${NotificationEventType.INVOICE_OVERDUE}:${NotificationChannel.IN_APP}`]: {
        subject: null,
        bodyHtml: null,
        bodyText:
            "Invoice {{invoiceNumber}} for {{customerName}} is {{daysOverdue}} days overdue (Amount due: {{amountDue}}).",
    },

    [`${NotificationEventType.PAYMENT_RECEIVED}:${NotificationChannel.EMAIL}`]: {
        subject: "Payment Receipt: {{paymentNumber}} for Invoice {{invoiceNumber}}",
        bodyHtml:
            "<p>Dear {{customerName}},</p><p>Thank you! We received payment <strong>{{paymentNumber}}</strong> of <strong>{{currencyCode}} {{amount}}</strong> via {{paymentMethod}} on {{paymentDate}}.</p><p>Remaining invoice balance: {{currencyCode}} {{remainingInvoiceBalance}}.</p>",
        bodyText:
            "Dear {{customerName}}, we received payment {{paymentNumber}} of {{currencyCode}} {{amount}} on {{paymentDate}}. Remaining balance: {{currencyCode}} {{remainingInvoiceBalance}}.",
    },
    [`${NotificationEventType.PAYMENT_RECEIVED}:${NotificationChannel.IN_APP}`]: {
        subject: null,
        bodyHtml: null,
        bodyText:
            "Payment {{paymentNumber}} of {{currencyCode}} {{amount}} recorded for Invoice {{invoiceNumber}}.",
    },

    [`${NotificationEventType.PAYMENT_FAILED}:${NotificationChannel.EMAIL}`]: {
        subject: "Payment Failed: Invoice {{invoiceNumber}}",
        bodyHtml:
            "<p>Dear {{customerName}},</p><p>A payment of <strong>{{currencyCode}} {{amount}}</strong> for invoice <strong>{{invoiceNumber}}</strong> could not be processed. Reason: {{reason}}.</p>",
        bodyText:
            "Dear {{customerName}}, a payment of {{currencyCode}} {{amount}} for invoice {{invoiceNumber}} could not be processed. Reason: {{reason}}.",
    },
    [`${NotificationEventType.PAYMENT_FAILED}:${NotificationChannel.IN_APP}`]: {
        subject: null,
        bodyHtml: null,
        bodyText:
            "Payment of {{currencyCode}} {{amount}} for Invoice {{invoiceNumber}} failed. Reason: {{reason}}.",
    },
};

// Self-validation check at module load time to guarantee every default template token is in its event's variableWhitelist
for (const [key, template] of Object.entries(DEFAULT_TEMPLATES_EN)) {
    const [eventTypeStr] = key.split(":");
    const eventType = eventTypeStr as NotificationEventType;
    const catDef = EVENT_CATALOG_REGISTRY[eventType];
    if (catDef) {
        validateTemplateTokens(template.subject, catDef.variableWhitelist, `${key} subject`);
        validateTemplateTokens(template.bodyHtml, catDef.variableWhitelist, `${key} bodyHtml`);
        validateTemplateTokens(template.bodyText, catDef.variableWhitelist, `${key} bodyText`);
    }
}

/**
 * Retrieves a system default template for a given event, channel, and locale.
 */
export function getSystemDefaultTemplate(
    eventType: NotificationEventType,
    channel: NotificationChannel,
    locale = "en",
): ResolvedTemplate {
    const key = `${eventType}:${channel}`;
    const template = DEFAULT_TEMPLATES_EN[key];

    if (!template) {
        throw new NotificationTemplateNotFoundError(
            `No system default template authored for event ${eventType} on channel ${channel} (locale: ${locale}).`,
        );
    }

    return {
        eventType,
        channel,
        locale: "en",
        subject: template.subject || null,
        bodyHtml: template.bodyHtml || null,
        bodyText: template.bodyText,
        isCustom: false,
    };
}
