/**
 * Phase 1.16.5 — WorkOrderCreateActionHandler
 * Dispatches WORK_ORDER_CREATE to createWorkOrder domain service.
 */

import crypto from "crypto";
import { AutomationActionType } from "@/generated/prisma/enums";
import { createWorkOrder } from "@/lib/services/workOrder";
import {
  workOrderCreateActionParamsSchema,
  type WorkOrderCreateActionParams,
} from "../actionSchemas";
import {
  AutomationActionParamValidationError,
} from "../automationErrors";
import type {
  ActionHandler,
  ActionExecutionContext,
  ActionResult,
} from "../automation.types";

export class WorkOrderCreateActionHandler
  implements ActionHandler<WorkOrderCreateActionParams, Record<string, unknown>>
{
  public readonly actionType = AutomationActionType.WORK_ORDER_CREATE;

  public validateParams(rawParams: unknown): WorkOrderCreateActionParams {
    const result = workOrderCreateActionParamsSchema.safeParse(rawParams);
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
    params: WorkOrderCreateActionParams,
    context: ActionExecutionContext,
  ): string {
    const raw = `${context.workspaceId}:${this.actionType}:${params.customerId}:${params.workTypeId}:${params.title}`;
    return crypto.createHash("sha256").update(raw).digest("hex");
  }

  public async execute(
    context: ActionExecutionContext,
    params: WorkOrderCreateActionParams,
  ): Promise<ActionResult<Record<string, unknown>>> {
    const idempotencyKey = this.computeIdempotencyKey(params, context);
    try {
      const created = await createWorkOrder(
        context.workspaceId,
        params,
        context.actorContext,
        context.prismaTx,
      );

      return {
        success: true,
        data: created as unknown as Record<string, unknown>,
        idempotencyKey,
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: error.code || error.name || "WORK_ORDER_CREATE_FAILED",
          message: error.message || "Failed to create work order",
          details: error.details || error.fieldErrors,
          stack: error.stack,
        },
        idempotencyKey,
      };
    }
  }
}
