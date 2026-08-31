import crypto from "node:crypto";
import { prisma as globalPrisma } from "@/lib/prisma";
import { PrismaClient } from "@/generated/prisma/client";
import {
    WebhookEndpointStatus,
    WebhookDeliveryStatus,
} from "@/generated/prisma/enums";
import {
    CreateWebhookEndpointInput,
    CreateWebhookEndpointResult,
    UpdateWebhookEndpointInput,
    WebhookEndpointDto,
    CreateWebhookDeliveryInput,
    WebhookDeliveryDto,
} from "@/lib/publicApi/webhooks/webhook.types";
import {
    assertValidWebhookEventTypes,
    PublicWebhookEventType,
} from "@/lib/publicApi/webhooks/webhookEvents";
import { validateWebhookUrl } from "@/lib/publicApi/webhooks/webhookUrlValidation";
import {
    DeveloperApplicationNotFoundError,
    DeveloperApplicationInactiveError,
} from "./developerAppErrors";

export class WebhookEndpointNotFoundError extends Error {
    constructor(message = "Webhook endpoint not found.") {
        super(message);
        this.name = "WebhookEndpointNotFoundError";
    }
}

type DbClient = PrismaClient | Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

function generateWebhookSecret(): string {
    return `whsec_${crypto.randomBytes(24).toString("hex")}`;
}

function maskSecret(secret: string): string {
    if (!secret || secret.length < 12) {
        return "whsec_****";
    }
    return `${secret.substring(0, 8)}...${secret.substring(secret.length - 4)}`;
}

function toEndpointDto(record: {
    id: string;
    workspaceId: string;
    developerApplicationId: string;
    url: string;
    description: string | null;
    status: WebhookEndpointStatus;
    events: string[];
    secret: string;
    createdAt: Date;
    updatedAt: Date;
}): WebhookEndpointDto {
    return {
        id: record.id,
        workspaceId: record.workspaceId,
        developerApplicationId: record.developerApplicationId,
        url: record.url,
        description: record.description,
        status: record.status,
        events: record.events as PublicWebhookEventType[],
        secretMasked: maskSecret(record.secret),
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
    };
}

/**
 * Registers a new webhook endpoint for a developer application within a workspace.
 */
export async function createWebhookEndpoint(
    workspaceId: string,
    developerApplicationId: string,
    input: CreateWebhookEndpointInput,
    db: DbClient = globalPrisma,
): Promise<CreateWebhookEndpointResult> {
    // 1. Verify developer application exists in this workspace and is ACTIVE
    const app = await db.developerApplication.findFirst({
        where: {
            id: developerApplicationId,
            workspaceId,
        },
    });

    if (!app) {
        throw new DeveloperApplicationNotFoundError(
            `Developer application '${developerApplicationId}' not found in workspace.`,
        );
    }

    if (app.status !== "ACTIVE") {
        throw new DeveloperApplicationInactiveError(
            `Cannot create webhook endpoint for application in '${app.status}' status.`,
        );
    }

    // 2. Validate URL against SSRF and protocol rules
    const validatedUrl = validateWebhookUrl(input.url);

    // 3. Validate subscribed event types
    assertValidWebhookEventTypes(input.events);

    // 4. Generate signing secret
    const rawSecret = generateWebhookSecret();

    // 5. Create database record
    const record = await db.webhookEndpoint.create({
        data: {
            workspaceId,
            developerApplicationId,
            url: validatedUrl,
            description: input.description?.trim() || null,
            events: input.events,
            secret: rawSecret,
            metadata: input.metadata ? JSON.parse(JSON.stringify(input.metadata)) : undefined,
        },
    });

    return {
        id: record.id,
        workspaceId: record.workspaceId,
        developerApplicationId: record.developerApplicationId,
        url: record.url,
        description: record.description,
        status: record.status,
        events: record.events as PublicWebhookEventType[],
        rawSecret,
        createdAt: record.createdAt.toISOString(),
    };
}

/**
 * Fetches a single webhook endpoint scoped to workspaceId.
 */
export async function getWebhookEndpoint(
    workspaceId: string,
    endpointId: string,
    db: DbClient = globalPrisma,
): Promise<WebhookEndpointDto> {
    const record = await db.webhookEndpoint.findFirst({
        where: {
            id: endpointId,
            workspaceId,
        },
    });

    if (!record) {
        throw new WebhookEndpointNotFoundError(`Webhook endpoint '${endpointId}' not found.`);
    }

    return toEndpointDto(record);
}

/**
 * Lists webhook endpoints scoped to workspaceId and optionally filtered by developerApplicationId.
 */
export async function listWebhookEndpoints(
    workspaceId: string,
    developerApplicationId?: string,
    db: DbClient = globalPrisma,
): Promise<WebhookEndpointDto[]> {
    const records = await db.webhookEndpoint.findMany({
        where: {
            workspaceId,
            ...(developerApplicationId ? { developerApplicationId } : {}),
        },
        orderBy: {
            createdAt: "desc",
        },
    });

    return records.map(toEndpointDto);
}

/**
 * Updates an existing webhook endpoint.
 */
export async function updateWebhookEndpoint(
    workspaceId: string,
    endpointId: string,
    input: UpdateWebhookEndpointInput,
    db: DbClient = globalPrisma,
): Promise<WebhookEndpointDto> {
    const existing = await db.webhookEndpoint.findFirst({
        where: {
            id: endpointId,
            workspaceId,
        },
    });

    if (!existing) {
        throw new WebhookEndpointNotFoundError(`Webhook endpoint '${endpointId}' not found.`);
    }

    const data: {
        url?: string;
        events?: string[];
        description?: string | null;
        status?: WebhookEndpointStatus;
    } = {};

    if (input.url !== undefined) {
        data.url = validateWebhookUrl(input.url);
    }

    if (input.events !== undefined) {
        assertValidWebhookEventTypes(input.events);
        data.events = input.events;
    }

    if (input.description !== undefined) {
        data.description = input.description?.trim() || null;
    }

    if (input.status !== undefined) {
        data.status = input.status as WebhookEndpointStatus;
    }

    const updated = await db.webhookEndpoint.update({
        where: { id: endpointId },
        data,
    });

    return toEndpointDto(updated);
}

/**
 * Deletes a webhook endpoint and cascades associated delivery logs.
 */
export async function deleteWebhookEndpoint(
    workspaceId: string,
    endpointId: string,
    db: DbClient = globalPrisma,
): Promise<void> {
    const existing = await db.webhookEndpoint.findFirst({
        where: {
            id: endpointId,
            workspaceId,
        },
    });

    if (!existing) {
        throw new WebhookEndpointNotFoundError(`Webhook endpoint '${endpointId}' not found.`);
    }

    await db.webhookEndpoint.delete({
        where: { id: endpointId },
    });
}

/**
 * Rotates the signing secret for a webhook endpoint.
 * Returns the fresh raw secret once.
 */
export async function rotateWebhookSecret(
    workspaceId: string,
    endpointId: string,
    db: DbClient = globalPrisma,
): Promise<{ id: string; rawSecret: string }> {
    const existing = await db.webhookEndpoint.findFirst({
        where: {
            id: endpointId,
            workspaceId,
        },
    });

    if (!existing) {
        throw new WebhookEndpointNotFoundError(`Webhook endpoint '${endpointId}' not found.`);
    }

    const rawSecret = generateWebhookSecret();

    await db.webhookEndpoint.update({
        where: { id: endpointId },
        data: { secret: rawSecret },
    });

    return {
        id: endpointId,
        rawSecret,
    };
}

/**
 * Foundation Helper: Creates a WebhookDelivery record (for Phase 1.18.18 dispatcher engine).
 */
export async function createWebhookDeliveryRecord(
    input: CreateWebhookDeliveryInput,
    db: DbClient = globalPrisma,
): Promise<WebhookDeliveryDto> {
    const record = await db.webhookDelivery.create({
        data: {
            workspaceId: input.workspaceId,
            webhookEndpointId: input.webhookEndpointId,
            eventId: input.eventId,
            eventType: input.eventType,
            payload: JSON.parse(JSON.stringify(input.payload)),
            status: (input.status as WebhookDeliveryStatus) || "PENDING",
        },
    });

    return {
        id: record.id,
        workspaceId: record.workspaceId,
        webhookEndpointId: record.webhookEndpointId,
        eventId: record.eventId,
        eventType: record.eventType,
        status: record.status,
        attempts: record.attempts,
        responseStatus: record.responseStatus,
        responseBody: record.responseBody,
        durationMs: record.durationMs,
        nextRetryAt: record.nextRetryAt ? record.nextRetryAt.toISOString() : null,
        deliveredAt: record.deliveredAt ? record.deliveredAt.toISOString() : null,
        failedAt: record.failedAt ? record.failedAt.toISOString() : null,
        createdAt: record.createdAt.toISOString(),
    };
}
