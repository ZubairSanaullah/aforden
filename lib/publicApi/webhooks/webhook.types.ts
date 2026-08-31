/**
 * Phase 1.18.17 — Public API Webhooks Types & Envelopes
 */

import { PublicWebhookEventType } from "./webhookEvents";

export type WebhookEndpointStatusType = "ACTIVE" | "DISABLED";

export type WebhookDeliveryStatusType =
    | "PENDING"
    | "DELIVERED"
    | "FAILED"
    | "RETRYING";

/**
 * Standard public webhook payload envelope broadcasted to external receivers.
 */
export interface PublicWebhookPayloadEnvelope<T = any> {
    /**
     * Unique globally identifiable event identifier (e.g. 'evt_01HPX7K9...').
     */
    id: string;

    /**
     * Canonical event type (e.g. 'work_order.created').
     */
    event: PublicWebhookEventType;

    /**
     * ISO 8601 UTC timestamp of when the domain event occurred.
     */
    createdAt: string;

    /**
     * Explicit Workspace ID to eliminate multi-tenant receiver ambiguity.
     */
    workspaceId: string;

    /**
     * Public API schema version of the event data.
     */
    apiVersion: string;

    /**
     * Canonical public resource DTO payload (e.g., PublicWorkOrderDto, PublicCustomerDto).
     */
    data: T;
}

/**
 * Public DTO projection of a registered Webhook Endpoint.
 * Raw secret is NEVER exposed in this projection.
 */
export interface WebhookEndpointDto {
    id: string;
    workspaceId: string;
    developerApplicationId: string;
    url: string;
    description: string | null;
    status: WebhookEndpointStatusType;
    events: PublicWebhookEventType[];
    secretMasked: string;
    createdAt: string;
    updatedAt: string;
}

/**
 * Input for registering a new webhook endpoint.
 */
export interface CreateWebhookEndpointInput {
    url: string;
    events: string[];
    description?: string;
    metadata?: Record<string, unknown>;
}

/**
 * Result returned ONCE upon creation containing the raw signing secret.
 */
export interface CreateWebhookEndpointResult {
    id: string;
    workspaceId: string;
    developerApplicationId: string;
    url: string;
    description: string | null;
    status: WebhookEndpointStatusType;
    events: PublicWebhookEventType[];
    /**
     * Raw HMAC signing secret (e.g. 'whsec_...').
     * Returned ONLY once upon creation/rotation and never stored or queryable in plaintext DTOs.
     */
    rawSecret: string;
    createdAt: string;
}

/**
 * Input for updating an existing webhook endpoint.
 */
export interface UpdateWebhookEndpointInput {
    url?: string;
    events?: string[];
    description?: string | null;
    status?: WebhookEndpointStatusType;
}

/**
 * Foundation input for recording a webhook delivery attempt (for Phase 1.18.18).
 */
export interface CreateWebhookDeliveryInput {
    workspaceId: string;
    webhookEndpointId: string;
    eventId: string;
    eventType: string;
    payload: PublicWebhookPayloadEnvelope;
    status?: WebhookDeliveryStatusType;
}

/**
 * Projection of a WebhookDelivery record.
 */
export interface WebhookDeliveryDto {
    id: string;
    workspaceId: string;
    webhookEndpointId: string;
    eventId: string;
    eventType: string;
    status: WebhookDeliveryStatusType;
    attempts: number;
    responseStatus: number | null;
    responseBody: string | null;
    durationMs: number | null;
    nextRetryAt: string | null;
    deliveredAt: string | null;
    failedAt: string | null;
    createdAt: string;
}
