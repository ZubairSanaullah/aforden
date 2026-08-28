/**
 * Phase 1.16.5 — CustomerUpdateStatusActionHandler
 * Dispatches CUSTOMER_UPDATE_STATUS to changeCustomerStatus domain service.
 */

import crypto from "crypto";
import { AutomationActionType } from "@/generated/prisma/enums";
import { changeCustomerStatus } from "@/lib/services/customer";
import {
  customerUpdateStatusActionParamsSchema,
  type CustomerUpdateStatusActionParams,
} from "../actionSchemas";
import {
  AutomationActionParamValidationError,
} from "../automationErrors";
import type {
  ActionHandler,
  ActionExecutionContext,
  ActionResult,
} from "../automation.types";

export class CustomerUpdateStatusActionHandler
  implements ActionHandler<CustomerUpdateStatusActionParams, Record<string, unknown>>
{
  public readonly actionType = AutomationActionType.CUSTOMER_UPDATE_STATUS;

  public validateParams(rawParams: unknown): CustomerUpdateStatusActionParams {
    const result = customerUpdateStatusActionParamsSchema.safeParse(rawParams);
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
    params: CustomerUpdateStatusActionParams,
    context: ActionExecutionContext,
  ): string {
    const raw = `${context.workspaceId}:${this.actionType}:${params.customerId}:${params.status}`;
    return crypto.createHash("sha256").update(raw).digest("hex");
  }

  public async execute(
    context: ActionExecutionContext,
    params: CustomerUpdateStatusActionParams,
  ): Promise<ActionResult<Record<string, unknown>>> {
    const idempotencyKey = this.computeIdempotencyKey(params, context);
    try {
      const updated = await changeCustomerStatus(
        context.workspaceId,
        params.customerId,
        params.status,
        params.reason,
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
          code: error.code || error.name || "CUSTOMER_UPDATE_STATUS_FAILED",
          message: error.message || "Failed to update customer status",
          details: error.details,
          stack: error.stack,
        },
        idempotencyKey,
      };
    }
  }
}
