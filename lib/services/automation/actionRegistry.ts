/**
 * Phase 1.16.5 — Allowlisted Action Registry & Dispatcher
 *
 * Implements the centralized action registry mapping every AutomationActionType
 * to its dedicated domain action handler. No dynamic reflection or arbitrary execution.
 */

import { AutomationActionType } from "@/generated/prisma/enums";
import {
  AutomationInvalidActionTypeError,
} from "./automationErrors";
import { resolveActionParams } from "./actionParamResolver";
import type {
  ActionHandler,
  ActionExecutionContext,
  ActionResult,
} from "./automation.types";
import {
  WorkOrderCreateActionHandler,
  WorkOrderUpdateStatusActionHandler,
  WorkOrderAssignTechnicianActionHandler,
  WorkOrderAddNoteActionHandler,
  InvoiceCreateFromWorkOrderActionHandler,
  InvoiceIssueActionHandler,
  NotificationSendEmailActionHandler,
  NotificationSendInAppActionHandler,
  InventoryReservePartsActionHandler,
  CustomerUpdateStatusActionHandler,
  AssetScheduleMaintenanceActionHandler,
} from "./handlers";

/**
 * Static registry of allowlisted ActionHandler instances.
 */
class ActionRegistry {
  private readonly handlers: ReadonlyMap<AutomationActionType, ActionHandler<any, any>>;

  constructor() {
    const handlerList: ActionHandler<any, any>[] = [
      new WorkOrderCreateActionHandler(),
      new WorkOrderUpdateStatusActionHandler(),
      new WorkOrderAssignTechnicianActionHandler(),
      new WorkOrderAddNoteActionHandler(),
      new InvoiceCreateFromWorkOrderActionHandler(),
      new InvoiceIssueActionHandler(),
      new NotificationSendEmailActionHandler(),
      new NotificationSendInAppActionHandler(),
      new InventoryReservePartsActionHandler(),
      new CustomerUpdateStatusActionHandler(),
      new AssetScheduleMaintenanceActionHandler(),
    ];

    const map = new Map<AutomationActionType, ActionHandler<any, any>>();
    for (const handler of handlerList) {
      map.set(handler.actionType, handler);
    }

    this.handlers = map;
  }

  /**
   * Retrieves the ActionHandler for a given AutomationActionType.
   * Throws AutomationInvalidActionTypeError if the action type is not allowlisted.
   */
  public getHandler(actionType: AutomationActionType | string): ActionHandler<any, any> {
    const handler = this.handlers.get(actionType as AutomationActionType);
    if (!handler) {
      throw new AutomationInvalidActionTypeError(String(actionType));
    }
    return handler;
  }

  /**
   * Checks if an action type string is allowlisted and registered.
   */
  public isRegistered(actionType: string): actionType is AutomationActionType {
    return this.handlers.has(actionType as AutomationActionType);
  }

  /**
   * Returns an array of all 11 registered AutomationActionType values.
   */
  public getRegisteredActionTypes(): AutomationActionType[] {
    return Array.from(this.handlers.keys());
  }

  /**
   * Dispatches an action execution:
   * 1. Resolves ActionHandler from registry.
   * 2. Resolves template tokens in rawParams against context.
   * 3. Validates resolved parameters against the handler schema.
   * 4. Executes the handler and returns structured ActionResult.
   */
  public async executeAction(
    actionType: AutomationActionType | string,
    rawParams: unknown,
    context: ActionExecutionContext,
  ): Promise<ActionResult> {
    const handler = this.getHandler(actionType);

    // 1. Resolve template tokens against context
    const resolvedParams = resolveActionParams(rawParams, context);

    // 2. Validate parameters using handler's schema
    const validatedParams = handler.validateParams(resolvedParams);

    // 3. Execute domain service via handler
    return handler.execute(context, validatedParams);
  }
}

/**
 * Singleton ActionRegistry instance.
 */
export const actionRegistry = new ActionRegistry();

/**
 * Helper function to retrieve an allowlisted ActionHandler.
 */
export function getActionHandler(actionType: AutomationActionType | string): ActionHandler<any, any> {
  return actionRegistry.getHandler(actionType);
}

/**
 * Helper function to check if an action type is registered.
 */
export function isActionTypeRegistered(actionType: string): actionType is AutomationActionType {
  return actionRegistry.isRegistered(actionType);
}

/**
 * Helper function to retrieve all registered action types.
 */
export function getRegisteredActionTypes(): AutomationActionType[] {
  return actionRegistry.getRegisteredActionTypes();
}

/**
 * Helper function to dispatch an action with parameter resolution and validation.
 */
export async function executeAction(
  actionType: AutomationActionType | string,
  rawParams: unknown,
  context: ActionExecutionContext,
): Promise<ActionResult> {
  return actionRegistry.executeAction(actionType, rawParams, context);
}
