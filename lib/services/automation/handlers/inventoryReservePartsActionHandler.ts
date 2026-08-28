/**
 * Phase 1.16.5 — InventoryReservePartsActionHandler
 * Dispatches INVENTORY_RESERVE_PARTS to reserveStock domain service.
 */

import crypto from "crypto";
import { AutomationActionType } from "@/generated/prisma/enums";
import { reserveStock } from "@/lib/services/inventory";
import {
  inventoryReservePartsActionParamsSchema,
  type InventoryReservePartsActionParams,
} from "../actionSchemas";
import {
  AutomationActionParamValidationError,
} from "../automationErrors";
import type {
  ActionHandler,
  ActionExecutionContext,
  ActionResult,
} from "../automation.types";

export class InventoryReservePartsActionHandler
  implements ActionHandler<InventoryReservePartsActionParams, Record<string, unknown>>
{
  public readonly actionType = AutomationActionType.INVENTORY_RESERVE_PARTS;

  public validateParams(rawParams: unknown): InventoryReservePartsActionParams {
    const result = inventoryReservePartsActionParamsSchema.safeParse(rawParams);
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
    params: InventoryReservePartsActionParams,
    context: ActionExecutionContext,
  ): string {
    const raw = `${context.workspaceId}:${this.actionType}:${params.partId}:${params.locationId}:${params.quantity}:${params.workOrderId || ""}`;
    return crypto.createHash("sha256").update(raw).digest("hex");
  }

  public async execute(
    context: ActionExecutionContext,
    params: InventoryReservePartsActionParams,
  ): Promise<ActionResult<Record<string, unknown>>> {
    const idempotencyKey = this.computeIdempotencyKey(params, context);
    try {
      const reservation = await reserveStock(
        context.workspaceId,
        params,
      );

      return {
        success: true,
        data: reservation as unknown as Record<string, unknown>,
        idempotencyKey,
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: error.code || error.name || "INVENTORY_RESERVE_PARTS_FAILED",
          message: error.message || "Failed to reserve inventory parts",
          details: error.details,
          stack: error.stack,
        },
        idempotencyKey,
      };
    }
  }
}
