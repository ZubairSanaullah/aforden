/**
 * Phase 1.13.5 — Template Resolution & Management Service
 * Manages custom workspace templates with fallback to system defaults,
 * and performs end-to-end safe token rendering.
 */

import { PrismaClient, Prisma } from "@/generated/prisma/client";
import {
    NotificationEventType,
    NotificationChannel,
    MembershipRole,
} from "@/generated/prisma/enums";
import {
    ResolvedTemplate,
    RenderedNotificationContent,
    CreateNotificationTemplateInput,
    UpdateNotificationTemplateInput,
} from "./notification.types";
import {
    createNotificationTemplateSchema,
    updateNotificationTemplateSchema,
} from "./notification.schemas";
import { getEventVariableWhitelist } from "./eventCatalogRegistry";
import { getSystemDefaultTemplate } from "./defaultTemplates";
import { renderTemplate, validateTemplateTokens } from "./templateEngine";
import {
    NotificationTemplateNotFoundError,
    NotificationActorUnauthorizedError,
    NotificationCrossTenantLeakageError,
} from "./notificationErrors";

/**
 * Resolves the active notification template using precedence:
 * 1. Custom Workspace Template in DB
 * 2. System Default Template Registry
 * 3. Throws NotificationTemplateNotFoundError if neither exists
 */
export async function resolveNotificationTemplate(
    prisma: PrismaClient | Prisma.TransactionClient,
    workspaceId: string,
    eventType: NotificationEventType,
    channel: NotificationChannel,
    locale = "en",
): Promise<ResolvedTemplate> {
    if (!workspaceId) {
        throw new NotificationCrossTenantLeakageError(
            "workspaceId is required for template resolution.",
        );
    }

    // 1. Query custom active workspace template
    const customTemplate = await prisma.notificationTemplate.findFirst({
        where: {
            workspaceId,
            eventType,
            channel,
            locale,
            isActive: true,
        },
    });

    if (customTemplate) {
        return {
            id: customTemplate.id,
            workspaceId: customTemplate.workspaceId,
            eventType: customTemplate.eventType,
            channel: customTemplate.channel,
            locale: customTemplate.locale,
            subject: customTemplate.subject,
            bodyHtml: customTemplate.bodyHtml,
            bodyText: customTemplate.bodyText,
            isCustom: true,
        };
    }

    // 2. Fall back to system default registry
    return getSystemDefaultTemplate(eventType, channel, locale);
}

/**
 * Higher-level render pipeline combining template resolution and safe variable interpolation.
 */
export async function renderNotificationContent(
    prisma: PrismaClient | Prisma.TransactionClient,
    workspaceId: string,
    eventType: NotificationEventType,
    channel: NotificationChannel,
    payload: Record<string, unknown>,
    locale = "en",
): Promise<RenderedNotificationContent> {
    // 1. Resolve template
    const template = await resolveNotificationTemplate(
        prisma,
        workspaceId,
        eventType,
        channel,
        locale,
    );

    // 2. Retrieve variable whitelist for event
    const whitelist = getEventVariableWhitelist(eventType);

    // 3. Prepare sanitized variable map strictly constrained to whitelist
    const safeVariables: Record<
        string,
        string | number | boolean | null | undefined
    > = {};
    for (const key of whitelist) {
        if (key in payload) {
            const rawVal = payload[key];
            if (
                typeof rawVal === "string" ||
                typeof rawVal === "number" ||
                typeof rawVal === "boolean" ||
                rawVal === null ||
                rawVal === undefined
            ) {
                safeVariables[key] = rawVal;
            } else {
                safeVariables[key] = String(rawVal);
            }
        }
    }

    // 4. Render subject, bodyText, and bodyHtml
    const renderedSubject = template.subject
        ? renderTemplate(template.subject, safeVariables, whitelist)
        : undefined;

    const renderedBody = renderTemplate(
        template.bodyText,
        safeVariables,
        whitelist,
    );

    const renderedBodyHtml = template.bodyHtml
        ? renderTemplate(template.bodyHtml, safeVariables, whitelist)
        : undefined;

    return {
        subject: renderedSubject,
        body: renderedBody,
        bodyHtml: renderedBodyHtml,
    };
}

/**
 * Creates or updates a workspace custom notification template with write-time token validation.
 */
export async function createNotificationTemplate(
    prisma: PrismaClient | Prisma.TransactionClient,
    workspaceId: string,
    input: CreateNotificationTemplateInput,
    actorMemberId: string,
) {
    if (!workspaceId) {
        throw new NotificationCrossTenantLeakageError(
            "workspaceId is required for template creation.",
        );
    }

    const parsed = createNotificationTemplateSchema.parse(input);

    // Enforce RBAC: OWNER or ADMIN only
    const actor = await prisma.workspaceMember.findFirst({
        where: {
            id: actorMemberId,
            workspaceId,
            status: "ACTIVE",
        },
    });

    if (
        !actor ||
        (actor.role !== MembershipRole.OWNER &&
            actor.role !== MembershipRole.ADMIN)
    ) {
        throw new NotificationActorUnauthorizedError(
            "Only workspace OWNER or ADMIN can create custom notification templates.",
        );
    }

    // Validate tokens at save time
    const whitelist = getEventVariableWhitelist(parsed.eventType);
    validateTemplateTokens(parsed.subject, whitelist, "subject");
    validateTemplateTokens(parsed.bodyHtml, whitelist, "bodyHtml");
    validateTemplateTokens(parsed.bodyText, whitelist, "bodyText");

    return await prisma.notificationTemplate.upsert({
        where: {
            workspaceId_eventType_channel_locale: {
                workspaceId,
                eventType: parsed.eventType,
                channel: parsed.channel,
                locale: parsed.locale,
            },
        },
        create: {
            workspaceId,
            eventType: parsed.eventType,
            channel: parsed.channel,
            locale: parsed.locale,
            subject: parsed.subject || null,
            bodyHtml: parsed.bodyHtml || null,
            bodyText: parsed.bodyText,
            isActive: parsed.isActive ?? true,
        },
        update: {
            subject: parsed.subject || null,
            bodyHtml: parsed.bodyHtml || null,
            bodyText: parsed.bodyText,
            isActive: parsed.isActive ?? true,
        },
    });
}

/**
 * Updates an existing workspace custom notification template.
 */
export async function updateNotificationTemplate(
    prisma: PrismaClient | Prisma.TransactionClient,
    workspaceId: string,
    templateId: string,
    input: UpdateNotificationTemplateInput,
    actorMemberId: string,
) {
    if (!workspaceId) {
        throw new NotificationCrossTenantLeakageError(
            "workspaceId is required for template update.",
        );
    }

    const parsed = updateNotificationTemplateSchema.parse(input);

    // Enforce RBAC
    const actor = await prisma.workspaceMember.findFirst({
        where: {
            id: actorMemberId,
            workspaceId,
            status: "ACTIVE",
        },
    });

    if (
        !actor ||
        (actor.role !== MembershipRole.OWNER &&
            actor.role !== MembershipRole.ADMIN)
    ) {
        throw new NotificationActorUnauthorizedError(
            "Only workspace OWNER or ADMIN can update custom notification templates.",
        );
    }

    const existing = await prisma.notificationTemplate.findFirst({
        where: {
            id: templateId,
            workspaceId,
        },
    });

    if (!existing) {
        throw new NotificationTemplateNotFoundError(
            `Notification template ${templateId} not found in workspace.`,
        );
    }

    const whitelist = getEventVariableWhitelist(existing.eventType);
    if (parsed.subject !== undefined) {
        validateTemplateTokens(parsed.subject, whitelist, "subject");
    }
    if (parsed.bodyHtml !== undefined) {
        validateTemplateTokens(parsed.bodyHtml, whitelist, "bodyHtml");
    }
    if (parsed.bodyText !== undefined) {
        validateTemplateTokens(parsed.bodyText, whitelist, "bodyText");
    }

    return await prisma.notificationTemplate.update({
        where: { id: templateId },
        data: {
            ...(parsed.subject !== undefined
                ? { subject: parsed.subject }
                : {}),
            ...(parsed.bodyHtml !== undefined
                ? { bodyHtml: parsed.bodyHtml }
                : {}),
            ...(parsed.bodyText !== undefined
                ? { bodyText: parsed.bodyText }
                : {}),
            ...(parsed.isActive !== undefined
                ? { isActive: parsed.isActive }
                : {}),
        },
    });
}

/**
 * Lists custom notification templates for a workspace.
 */
export async function listNotificationTemplates(
    prisma: PrismaClient | Prisma.TransactionClient,
    workspaceId: string,
    eventType?: NotificationEventType,
    channel?: NotificationChannel,
) {
    if (!workspaceId) {
        throw new NotificationCrossTenantLeakageError(
            "workspaceId is required to list templates.",
        );
    }

    return await prisma.notificationTemplate.findMany({
        where: {
            workspaceId,
            ...(eventType ? { eventType } : {}),
            ...(channel ? { channel } : {}),
        },
        orderBy: [{ eventType: "asc" }, { channel: "asc" }],
    });
}

/**
 * Soft-deactivates a custom notification template.
 */
export async function deactivateNotificationTemplate(
    prisma: PrismaClient | Prisma.TransactionClient,
    workspaceId: string,
    templateId: string,
    actorMemberId: string,
) {
    return await updateNotificationTemplate(
        prisma,
        workspaceId,
        templateId,
        { isActive: false },
        actorMemberId,
    );
}
