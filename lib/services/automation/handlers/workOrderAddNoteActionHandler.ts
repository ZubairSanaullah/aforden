/**
 * Phase 1.16.5 — WorkOrderAddNoteActionHandler
 * Dispatches WORK_ORDER_ADD_NOTE to updateWorkOrder domain service.
 */

import crypto from "crypto";
import { AutomationActionType } from "@/generated/prisma/enums";
import { updateWorkOrder } from "@/lib/services/workOrder";
import {
  workOrderAddNoteActionParamsSchema,
  type WorkOrderAddNoteActionParams,
} from "../actionSchemas";
import {
  AutomationActionParamValidationError,
} from "../automationErrors";
import type {
  ActionHandler,
  ActionExecutionContext,
  ActionResult,
} from "../automation.types";

export class WorkOrderAddNoteActionHandler
  implements ActionHandler<WorkOrderAddNoteActionParams, Record<string, unknown>>
{
  public readonly actionType = AutomationActionType.WORK_ORDER_ADD_NOTE;

  public validateParams(rawParams: unknown): WorkOrderAddNoteActionParams {
    const result = workOrderAddNoteActionParamsSchema.safeParse(rawParams);
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
    params: WorkOrderAddNoteActionParams,
    context: ActionExecutionContext,
  ): string {
    const noteText = params.internalNotes || params.note || "";
    const raw = `${context.workspaceId}:${this.actionType}:${params.workOrderId}:${noteText}`;
    return crypto.createHash("sha256").update(raw).digest("hex");
  }

  public async execute(
    context: ActionExecutionContext,
    params: WorkOrderAddNoteActionParams,
  ): Promise<ActionResult<Record<string, unknown>>> {
    const idempotencyKey = this.computeIdempotencyKey(params, context);
    try {
      const noteContent = params.internalNotes || params.note;
      const updated = await updateWorkOrder(
        context.workspaceId,
        params.workOrderId,
        { internalNotes: noteContent },
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
          code: error.code || error.name || "WORK_ORDER_ADD_NOTE_FAILED",
          message: error.message || "Failed to add note to work order",
          details: error.details,
          stack: error.stack,
        },
        idempotencyKey,
      };
    }
  }
}
