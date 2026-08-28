/**
 * Phase 1.16.5 — NotificationSendInAppActionHandler
 * Dispatches NOTIFICATION_SEND_IN_APP to emitNotificationEvent domain service.
 */

import crypto from "crypto";
import { AutomationActionType, NotificationEventType } from "@/generated/prisma/enums";
import { emitNotificationEvent } from "@/lib/services/notification";
import { prisma } from "@/lib/prisma";
import {
  notificationSendInAppActionParamsSchema,
  type NotificationSendInAppActionParams,
} from "../actionSchemas";
import {
  AutomationActionParamValidationError,
} from "../automationErrors";
import type {
  ActionHandler,
  ActionExecutionContext,
  ActionResult,
} from "../automation.types";

export class NotificationSendInAppActionHandler
  implements ActionHandler<NotificationSendInAppActionParams, Record<string, unknown>>
{
  public readonly actionType = AutomationActionType.NOTIFICATION_SEND_IN_APP;

  public validateParams(rawParams: unknown): NotificationSendInAppActionParams {
    const result = notificationSendInAppActionParamsSchema.safeParse(rawParams);
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
    params: NotificationSendInAppActionParams,
    context: ActionExecutionContext,
  ): string {
    const raw = `${context.workspaceId}:${this.actionType}:${params.sourceEntity}:${params.sourceId}:${params.recipientMemberId || ""}:${params.title || ""}`;
    return crypto.createHash("sha256").update(raw).digest("hex");
  }

  public async execute(
    context: ActionExecutionContext,
    params: NotificationSendInAppActionParams,
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
          recipientMemberId: params.recipientMemberId,
          title: params.title,
          message: params.message,
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
          code: error.code || error.name || "NOTIFICATION_SEND_IN_APP_FAILED",
          message: error.message || "Failed to emit notification in-app event",
          details: error.details,
          stack: error.stack,
        },
        idempotencyKey,
      };
    }
  }
}
