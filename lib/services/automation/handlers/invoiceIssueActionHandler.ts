/**
 * Phase 1.16.5 — InvoiceIssueActionHandler
 * Dispatches INVOICE_ISSUE to issueInvoice domain service.
 */

import crypto from "crypto";
import { AutomationActionType } from "@/generated/prisma/enums";
import { issueInvoice } from "@/lib/services/invoice";
import {
  invoiceIssueActionParamsSchema,
  type InvoiceIssueActionParams,
} from "../actionSchemas";
import {
  AutomationActionParamValidationError,
} from "../automationErrors";
import type {
  ActionHandler,
  ActionExecutionContext,
  ActionResult,
} from "../automation.types";

export class InvoiceIssueActionHandler
  implements ActionHandler<InvoiceIssueActionParams, Record<string, unknown>>
{
  public readonly actionType = AutomationActionType.INVOICE_ISSUE;

  public validateParams(rawParams: unknown): InvoiceIssueActionParams {
    const result = invoiceIssueActionParamsSchema.safeParse(rawParams);
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
    params: InvoiceIssueActionParams,
    context: ActionExecutionContext,
  ): string {
    const raw = `${context.workspaceId}:${this.actionType}:${params.invoiceId}`;
    return crypto.createHash("sha256").update(raw).digest("hex");
  }

  public async execute(
    context: ActionExecutionContext,
    params: InvoiceIssueActionParams,
  ): Promise<ActionResult<Record<string, unknown>>> {
    const idempotencyKey = this.computeIdempotencyKey(params, context);
    try {
      const issued = await issueInvoice(
        context.workspaceId,
        params.invoiceId,
        context.actorContext,
      );

      return {
        success: true,
        data: issued as unknown as Record<string, unknown>,
        idempotencyKey,
      };
    } catch (error: any) {
      return {
        success: false,
        error: {
          code: error.code || error.name || "INVOICE_ISSUE_FAILED",
          message: error.message || "Failed to issue invoice",
          details: error.details,
          stack: error.stack,
        },
        idempotencyKey,
      };
    }
  }
}
