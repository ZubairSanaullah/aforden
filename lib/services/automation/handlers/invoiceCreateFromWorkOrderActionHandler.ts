/**
 * Phase 1.16.5 — InvoiceCreateFromWorkOrderActionHandler
 * Dispatches INVOICE_CREATE_FROM_WORK_ORDER to createInvoiceFromWorkOrder domain service.
 */

import crypto from "crypto";
import { AutomationActionType } from "@/generated/prisma/enums";
import { createInvoiceFromWorkOrder } from "@/lib/services/invoice";
import {
  invoiceCreateFromWorkOrderActionParamsSchema,
  type InvoiceCreateFromWorkOrderActionParams,
} from "../actionSchemas";
import {
  AutomationActionParamValidationError,
} from "../automationErrors";
import type {
  ActionHandler,
  ActionExecutionContext,
  ActionResult,
} from "../automation.types";

export class InvoiceCreateFromWorkOrderActionHandler
  implements ActionHandler<InvoiceCreateFromWorkOrderActionParams, Record<string, unknown>>
{
  public readonly actionType = AutomationActionType.INVOICE_CREATE_FROM_WORK_ORDER;

  public validateParams(rawParams: unknown): InvoiceCreateFromWorkOrderActionParams {
    const result = invoiceCreateFromWorkOrderActionParamsSchema.safeParse(rawParams);
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
    params: InvoiceCreateFromWorkOrderActionParams,
    context: ActionExecutionContext,
  ): string {
    const raw = `${context.workspaceId}:${this.actionType}:${params.workOrderId}`;
    return crypto.createHash("sha256").update(raw).digest("hex");
  }

  public async execute(
    context: ActionExecutionContext,
    params: InvoiceCreateFromWorkOrderActionParams,
  ): Promise<ActionResult<Record<string, unknown>>> {
    const idempotencyKey = this.computeIdempotencyKey(params, context);
    try {
      const invoice = await createInvoiceFromWorkOrder(
        context.workspaceId,
        params.workOrderId,
        {
          paymentTermsDays: params.paymentTermsDays ?? 30,
          notes: params.notes ?? "Automated invoice generated from work order",
        },
        context.actorContext,
      );

      return {
        success: true,
        data: invoice as unknown as Record<string, unknown>,
        idempotencyKey,
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: error.code || error.name || "INVOICE_CREATE_FROM_WORK_ORDER_FAILED",
          message: error.message || "Failed to create invoice from work order",
          details: error.details,
          stack: error.stack,
        },
        idempotencyKey,
      };
    }
  }
}
