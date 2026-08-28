/**
 * Phase 1.16.5 — AssetScheduleMaintenanceActionHandler
 * Dispatches ASSET_SCHEDULE_MAINTENANCE to createSchedule domain service.
 */

import crypto from "crypto";
import { AutomationActionType } from "@/generated/prisma/enums";
import { createSchedule } from "@/lib/services/schedule";
import {
  assetScheduleMaintenanceActionParamsSchema,
  type AssetScheduleMaintenanceActionParams,
} from "../actionSchemas";
import {
  AutomationActionParamValidationError,
} from "../automationErrors";
import type {
  ActionHandler,
  ActionExecutionContext,
  ActionResult,
} from "../automation.types";

export class AssetScheduleMaintenanceActionHandler
  implements ActionHandler<AssetScheduleMaintenanceActionParams, Record<string, unknown>>
{
  public readonly actionType = AutomationActionType.ASSET_SCHEDULE_MAINTENANCE;

  public validateParams(rawParams: unknown): AssetScheduleMaintenanceActionParams {
    const result = assetScheduleMaintenanceActionParamsSchema.safeParse(rawParams);
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
    params: AssetScheduleMaintenanceActionParams,
    context: ActionExecutionContext,
  ): string {
    const startStr = typeof params.start === "string" ? params.start : new Date(params.start).toISOString();
    const endStr = typeof params.end === "string" ? params.end : new Date(params.end).toISOString();
    const raw = `${context.workspaceId}:${this.actionType}:${params.workOrderId}:${params.technicianId}:${startStr}:${endStr}`;
    return crypto.createHash("sha256").update(raw).digest("hex");
  }

  public async execute(
    context: ActionExecutionContext,
    params: AssetScheduleMaintenanceActionParams,
  ): Promise<ActionResult<Record<string, unknown>>> {
    const idempotencyKey = this.computeIdempotencyKey(params, context);
    try {
      const schedule = await createSchedule(
        context.workspaceId,
        {
          workOrderId: params.workOrderId,
          technicianId: params.technicianId,
          start: params.start,
          end: params.end,
          timezone: params.timezone,
          title: params.title,
          notes: params.notes,
        },
      );

      return {
        success: true,
        data: schedule as unknown as Record<string, unknown>,
        idempotencyKey,
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: error.code || error.name || "ASSET_SCHEDULE_MAINTENANCE_FAILED",
          message: error.message || "Failed to create schedule for maintenance",
          details: error.details,
          stack: error.stack,
        },
        idempotencyKey,
      };
    }
  }
}
