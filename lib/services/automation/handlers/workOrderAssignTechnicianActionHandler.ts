/**
 * Phase 1.16.5 — WorkOrderAssignTechnicianActionHandler
 * Dispatches WORK_ORDER_ASSIGN_TECHNICIAN to assignWorkOrder domain service.
 */

import crypto from "crypto";
import { AutomationActionType } from "@/generated/prisma/enums";
import { assignWorkOrder } from "@/lib/services/workOrder";
import {
  workOrderAssignTechnicianActionParamsSchema,
  type WorkOrderAssignTechnicianActionParams,
} from "../actionSchemas";
import {
  AutomationActionParamValidationError,
} from "../automationErrors";
import type {
  ActionHandler,
  ActionExecutionContext,
  ActionResult,
} from "../automation.types";

export class WorkOrderAssignTechnicianActionHandler
  implements ActionHandler<WorkOrderAssignTechnicianActionParams, Record<string, unknown>>
{
  public readonly actionType = AutomationActionType.WORK_ORDER_ASSIGN_TECHNICIAN;

  public validateParams(rawParams: unknown): WorkOrderAssignTechnicianActionParams {
    const result = workOrderAssignTechnicianActionParamsSchema.safeParse(rawParams);
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
    params: WorkOrderAssignTechnicianActionParams,
    context: ActionExecutionContext,
  ): string {
    const raw = `${context.workspaceId}:${this.actionType}:${params.workOrderId}:${params.technicianId}`;
    return crypto.createHash("sha256").update(raw).digest("hex");
  }

  public async execute(
    context: ActionExecutionContext,
    params: WorkOrderAssignTechnicianActionParams,
  ): Promise<ActionResult<Record<string, unknown>>> {
    const idempotencyKey = this.computeIdempotencyKey(params, context);
    try {
      const assigned = await assignWorkOrder(
        context.workspaceId,
        params.workOrderId,
        { technicianId: params.technicianId },
        context.actorContext,
        context.prismaTx,
      );

      return {
        success: true,
        data: assigned as unknown as Record<string, unknown>,
        idempotencyKey,
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: error.code || error.name || "WORK_ORDER_ASSIGN_FAILED",
          message: error.message || "Failed to assign work order to technician",
          details: error.details,
          stack: error.stack,
        },
        idempotencyKey,
      };
    }
  }
}
