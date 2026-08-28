/**
 * Phase 1.16.7 — Entity-Offset Scheduling Engine
 *
 * Resolves temporal triggers relative to domain entity date/time fields
 * (e.g., "24 hours before WorkOrder.scheduledStartDate", "2 hours after Invoice.dueDate").
 *
 * Invariant 9: Strictly service-mediated via domain query services (getWorkOrder, getInvoice, getSchedule).
 * Zero direct table mutations or raw prisma queries on foreign domain models.
 */

import { z } from "zod";
import type { PrismaClient, Prisma } from "@/generated/prisma/client";
import type { EntityOffsetConfig } from "./automation.types";
import {
  AutomationValidationError,
  AutomationEntityOffsetResolutionError,
} from "./automationErrors";

// Domain query services (Service-Mediated Read Access)
import { getWorkOrder } from "@/lib/services/workOrder";
import { getInvoice } from "@/lib/services/invoice";
import { getSchedule } from "@/lib/services/schedule";

type DbClient = PrismaClient | Prisma.TransactionClient;

export const entityOffsetConfigSchema = z.object({
  entityType: z.enum(["WorkOrder", "Invoice", "ScheduleAppointment"]),
  entityId: z.string().min(1, "entityId is required"),
  dateField: z.string().min(1, "dateField is required"),
  offsetSeconds: z.number().int(),
});

/**
 * Resolves the reference date from the target domain entity and calculates
 * the computed nextRunAt timestamp with offsetSeconds applied.
 *
 * @param workspaceId - Tenant workspace identifier (Invariant 1)
 * @param config - Entity offset configuration
 * @param client - Optional Prisma client
 * @param actorContext - Optional authorization context for query services
 */
export async function resolveEntityOffsetNextRun(
  workspaceId: string,
  config: EntityOffsetConfig,
  _client?: DbClient,
  _actorContext?: any,
): Promise<Date | null> {
  if (!workspaceId || typeof workspaceId !== "string") {
    throw new AutomationValidationError("Valid workspaceId is required");
  }

  const parseResult = entityOffsetConfigSchema.safeParse(config);
  if (!parseResult.success) {
    throw new AutomationValidationError(
      "Invalid entityOffsetJson configuration",
      parseResult.error.flatten().fieldErrors,
    );
  }

  const validated = parseResult.data;
  let entityDateValue: any = null;

  switch (validated.entityType) {
    case "WorkOrder": {
      try {
        const workOrder = await getWorkOrder(workspaceId, validated.entityId);
        if (workOrder) {
          entityDateValue = (workOrder as any)[validated.dateField];
        }
      } catch (err: any) {
        throw new AutomationEntityOffsetResolutionError(
          validated.entityType,
          validated.entityId,
          validated.dateField,
          `Failed to fetch WorkOrder '${validated.entityId}': ${err.message}`,
        );
      }
      break;
    }

    case "Invoice": {
      try {
        const invoice = await getInvoice(workspaceId, validated.entityId);
        if (invoice) {
          entityDateValue = (invoice as any)[validated.dateField];
        }
      } catch (err: any) {
        throw new AutomationEntityOffsetResolutionError(
          validated.entityType,
          validated.entityId,
          validated.dateField,
          `Failed to fetch Invoice '${validated.entityId}': ${err.message}`,
        );
      }
      break;
    }

    case "ScheduleAppointment": {
      try {
        // Phase 1.8 Read-only query access (Section 5.2)
        const appointment = await getSchedule(workspaceId, validated.entityId);
        if (appointment) {
          entityDateValue = (appointment as any)[validated.dateField];
        }
      } catch (err: any) {
        throw new AutomationEntityOffsetResolutionError(
          validated.entityType,
          validated.entityId,
          validated.dateField,
          `Failed to fetch ScheduleAppointment '${validated.entityId}': ${err.message}`,
        );
      }
      break;
    }

    default:
      throw new AutomationEntityOffsetResolutionError(
        String(validated.entityType),
        validated.entityId,
        validated.dateField,
        `Unsupported entityType '${validated.entityType}' for entity-offset scheduling`,
      );
  }

  if (entityDateValue === null || entityDateValue === undefined) {
    return null;
  }

  const baseDate =
    entityDateValue instanceof Date
      ? entityDateValue
      : new Date(String(entityDateValue));

  if (isNaN(baseDate.getTime())) {
    throw new AutomationEntityOffsetResolutionError(
      validated.entityType,
      validated.entityId,
      validated.dateField,
      `Field '${validated.dateField}' did not yield a valid Date (value: ${entityDateValue})`,
    );
  }

  const offsetMs = validated.offsetSeconds * 1000;
  return new Date(baseDate.getTime() + offsetMs);
}
