/**
 * Phase 1.16.5 — WorkOrderUpdateStatusActionHandler
 * Dispatches WORK_ORDER_UPDATE_STATUS to transitionWorkOrderStatus domain service.
 */

import crypto from "crypto";
import { AutomationActionType } from "@/generated/prisma/enums";
import { transitionWorkOrderStatus } from "@/lib/services/workOrder";
import {
  workOrderUpdateStatusActionParamsSchema,
  type WorkOrderUpdateStatusActionParams,
} from "../actionSchemas";
import {
  AutomationActionParamValidationError,
} from "../automationErrors";
import type {
  ActionHandler,
  ActionExecutionContext,
  ActionResult,
} from "../automation.types";

export class WorkOrderUpdateStatusActionHandler
  implements ActionHandler<WorkOrderUpdateStatusActionParams, Record<string, unknown>>
{
  public readonly actionType = AutomationActionType.WORK_ORDER_UPDATE_STATUS;

  public validateParams(rawParams: unknown): WorkOrderUpdateStatusActionParams {
    const result = workOrderUpdateStatusActionParamsSchema.safeParse(rawParams);
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
    params: WorkOrderUpdateStatusActionParams,
    context: ActionExecutionContext,
  ): string {
    const raw = `${context.workspaceId}:${this.actionType}:${params.workOrderId}:${params.toStatus}`;
    return crypto.createHash("sha256").update(raw).digest("hex");
  }

  public async execute(
    context: ActionExecutionContext,
    params: WorkOrderUpdateStatusActionParams,
  ): Promise<ActionResult<Record<string, unknown>>> {
    const idempotencyKey = this.computeIdempotencyKey(params, context);
    try {
      const updated = await transitionWorkOrderStatus(
        context.workspaceId,
        params.workOrderId,
        {
          toStatus: params.toStatus,
          holdReason: params.holdReason ?? undefined,
          cancellationReason: params.cancellationReason ?? undefined,
        },
        context.prismaTx,
      );

      return {
        success: true,
        data: updated as unknown as Record<string, unknown>,
        idempotencyKey,
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: error.code || error.name || "WORK_ORDER_UPDATE_STATUS_FAILED",
          message: error.message || "Failed to update work order status",
          details: error.details,
          stack: error.stack,
        },
        idempotencyKey,
      };
    }
  }
}
