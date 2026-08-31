/**
 * Phase 1.18.17 — Canonical Public API Webhook Event Registry
 *
 * Defines the canonical set of event types that external webhook consumers
 * can subscribe to. Free-form event strings are strictly disallowed.
 */

export const PUBLIC_WEBHOOK_EVENTS = {
    WORK_ORDER_CREATED: "work_order.created",
    WORK_ORDER_UPDATED: "work_order.updated",
    WORK_ORDER_STATUS_CHANGED: "work_order.status_changed",
    WORK_ORDER_ASSIGNED: "work_order.assigned",
    WORK_ORDER_COMPLETED: "work_order.completed",
    CUSTOMER_CREATED: "customer.created",
    CUSTOMER_UPDATED: "customer.updated",
    INVOICE_CREATED: "invoice.created",
    INVOICE_PAID: "invoice.paid",
} as const;

export type PublicWebhookEventType =
    (typeof PUBLIC_WEBHOOK_EVENTS)[keyof typeof PUBLIC_WEBHOOK_EVENTS];

export const VALID_WEBHOOK_EVENT_TYPES: ReadonlySet<string> = new Set(
    Object.values(PUBLIC_WEBHOOK_EVENTS),
);

/**
 * Checks whether a given string is a recognized canonical webhook event type.
 */
export function isValidWebhookEventType(
    event: string,
): event is PublicWebhookEventType {
    return VALID_WEBHOOK_EVENT_TYPES.has(event);
}

/**
 * Validates an array of event types. Throws an Error with detailed mismatch info
 * if any event type is invalid or if the array is empty.
 */
export function assertValidWebhookEventTypes(
    events: string[],
): asserts events is PublicWebhookEventType[] {
    if (!Array.isArray(events) || events.length === 0) {
        throw new Error("Webhook endpoint must subscribe to at least one event type.");
    }

    const invalidEvents = events.filter((e) => !VALID_WEBHOOK_EVENT_TYPES.has(e));
    if (invalidEvents.length > 0) {
        throw new Error(
            `Invalid webhook event type(s): [${invalidEvents.join(", ")}]. Canonical supported events are: [${Array.from(VALID_WEBHOOK_EVENT_TYPES).join(", ")}].`,
        );
    }
}
