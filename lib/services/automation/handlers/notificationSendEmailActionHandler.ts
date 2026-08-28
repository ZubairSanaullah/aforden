/**
 * Phase 1.16.5 — NotificationSendEmailActionHandler
 * Dispatches NOTIFICATION_SEND_EMAIL to emitNotificationEvent domain service.
 */

import crypto from "crypto";
import { AutomationActionType, NotificationEventType } from "@/generated/prisma/enums";
import { emitNotificationEvent } from "@/lib/services/notification";
import { prisma } from "@/lib/prisma";
import {
  notificationSendEmailActionParamsSchema,
  type NotificationSendEmailActionParams,
} from "../actionSchemas";
import {
  AutomationActionParamValidationError,
} from "../automationErrors";
import type {
  ActionHandler,
  ActionExecutionContext,
  ActionResult,
} from "../automation.types";

export class NotificationSendEmailActionHandler
  implements ActionHandler<NotificationSendEmailActionParams, Record<string, unknown>>
{
  public readonly actionType = AutomationActionType.NOTIFICATION_SEND_EMAIL;

  public validateParams(rawParams: unknown): NotificationSendEmailActionParams {
    const result = notificationSendEmailActionParamsSchema.safeParse(rawParams);
    if (!result.success) {
      const fieldErrors = result.error.flatten().fieldErrors;
      throw new AutomationActionParamValidationError(
        this.actionType,
        `Parameter validation failed for ${this.actionType}: ${result.error.message}`,
        fieldErrors,
      );
    }
    return result.data;
  }

  public computeIdempotencyKey(
    params: NotificationSendEmailActionParams,
    context: ActionExecutionContext,
  ): string {
    const raw = `${context.workspaceId}:${this.actionType}:${params.sourceEntity}:${params.sourceId}:${params.recipientEmail || ""}:${params.subject || ""}`;
    return crypto.createHash("sha256").update(raw).digest("hex");
  }

  public async execute(
    context: ActionExecutionContext,
    params: NotificationSendEmailActionParams,
  ): Promise<ActionResult<Record<string, unknown>>> {
    const idempotencyKey = this.computeIdempotencyKey(params, context);
    try {
      const tx = context.prismaTx ?? (prisma as any);
      const outboxEntry = await emitNotificationEvent(tx, {
        workspaceId: context.workspaceId,
        eventType: (params.eventType as NotificationEventType) || NotificationEventType.WORK_ORDER_STATUS_CHANGED,
        sourceEntity: params.sourceEntity,
        sourceId: params.sourceId,
        actorMemberId: context.actorMemberId ?? null,
        dedupeKey: idempotencyKey,
        payload: {
          ...params.payload,
          recipientEmail: params.recipientEmail,
          subject: params.subject,
          body: params.body,
        },
      });

      return {
        success: true,
        data: outboxEntry as unknown as Record<string, unknown>,
        idempotencyKey,
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: error.code || error.name || "NOTIFICATION_SEND_EMAIL_FAILED",
          message: error.message || "Failed to emit notification email event",
          details: error.details,
          stack: error.stack,
        },
        idempotencyKey,
      };
    }
  }
}
