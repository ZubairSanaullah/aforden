/**
 * Phase 1.16.5 — Action Parameter Zod Schemas
 *
 * Strict validation schemas for all 11 allowlisted AutomationAction types.
 * Validates resolved parameter objects before passing them to underlying domain services.
 */

import { z } from "zod";
import {
  WorkOrderStatus,
  WorkOrderPriority,
  CustomerStatus,
  InvoiceStatus,
} from "@/generated/prisma/client";
import { NotificationEventType } from "@/generated/prisma/enums";

// ==========================================
// 1. WORK_ORDER_CREATE
// ==========================================
export const workOrderCreateActionParamsSchema = z.object({
  customerId: z.string().min(1, "customerId is required"),
  locationId: z.string().min(1, "locationId is required"),
  workTypeId: z.string().min(1, "workTypeId is required"),
  title: z.string().min(1, "title is required").max(255),
  priority: z.nativeEnum(WorkOrderPriority).optional().default(WorkOrderPriority.MEDIUM),
  description: z.string().optional(),
  internalNotes: z.string().optional(),
  assetId: z.string().nullable().optional(),
  estimatedDuration: z.number().int().positive().optional(),
});

export type WorkOrderCreateActionParams = z.infer<typeof workOrderCreateActionParamsSchema>;

// ==========================================
// 2. WORK_ORDER_UPDATE_STATUS
// ==========================================
export const workOrderUpdateStatusActionParamsSchema = z.object({
  workOrderId: z.string().min(1, "workOrderId is required"),
  toStatus: z.nativeEnum(WorkOrderStatus),
  holdReason: z.string().nullable().optional(),
  cancellationReason: z.string().nullable().optional(),
});

export type WorkOrderUpdateStatusActionParams = z.infer<typeof workOrderUpdateStatusActionParamsSchema>;

// ==========================================
// 3. WORK_ORDER_ASSIGN_TECHNICIAN
// ==========================================
export const workOrderAssignTechnicianActionParamsSchema = z.object({
  workOrderId: z.string().min(1, "workOrderId is required"),
  technicianId: z.string().min(1, "technicianId is required"),
  notes: z.string().optional(),
});

export type WorkOrderAssignTechnicianActionParams = z.infer<typeof workOrderAssignTechnicianActionParamsSchema>;

// ==========================================
// 4. WORK_ORDER_ADD_NOTE
// ==========================================
export const workOrderAddNoteActionParamsSchema = z
  .object({
    workOrderId: z.string().min(1, "workOrderId is required"),
    note: z.string().optional(),
    internalNotes: z.string().optional(),
  })
  .refine((data) => Boolean(data.note || data.internalNotes), {
    message: "Either 'note' or 'internalNotes' must be provided",
    path: ["note"],
  });

export type WorkOrderAddNoteActionParams = z.infer<typeof workOrderAddNoteActionParamsSchema>;

// ==========================================
// 5. INVOICE_CREATE_DRAFT & INVOICE_CREATE_FROM_WORK_ORDER
// ==========================================
export const invoiceCreateDraftActionParamsSchema = z.object({
  workOrderId: z.string().min(1, "workOrderId is required"),
  dueDate: z.union([z.string().min(1), z.date()]).optional(),
  notes: z.string().optional(),
  terms: z.string().optional(),
});

export type InvoiceCreateDraftActionParams = z.infer<typeof invoiceCreateDraftActionParamsSchema>;

export const invoiceCreateFromWorkOrderActionParamsSchema = z.object({
  workOrderId: z.string().min(1, "workOrderId is required"),
  paymentTermsDays: z.number().int().min(0).optional(),
  notes: z.string().optional(),
});

export type InvoiceCreateFromWorkOrderActionParams = z.infer<typeof invoiceCreateFromWorkOrderActionParamsSchema>;

// ==========================================
// 6. INVOICE_UPDATE_STATUS & INVOICE_ISSUE
// ==========================================
export const invoiceUpdateStatusActionParamsSchema = z.object({
  invoiceId: z.string().min(1, "invoiceId is required"),
  status: z.nativeEnum(InvoiceStatus),
  reason: z.string().optional(),
});

export type InvoiceUpdateStatusActionParams = z.infer<typeof invoiceUpdateStatusActionParamsSchema>;

export const invoiceIssueActionParamsSchema = z.object({
  invoiceId: z.string().min(1, "invoiceId is required"),
});

export type InvoiceIssueActionParams = z.infer<typeof invoiceIssueActionParamsSchema>;

// ==========================================
// 7. NOTIFICATION_SEND_EMAIL
// ==========================================
export const notificationSendEmailActionParamsSchema = z.object({
  sourceEntity: z.string().default("Automation"),
  sourceId: z.string().default("automation_exec"),
  eventType: z.union([z.nativeEnum(NotificationEventType), z.string()]).default(NotificationEventType.WORK_ORDER_STATUS_CHANGED),
  recipientEmail: z.string().optional(),
  subject: z.string().optional(),
  body: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export type NotificationSendEmailActionParams = z.infer<typeof notificationSendEmailActionParamsSchema>;

// ==========================================
// 8. NOTIFICATION_SEND_IN_APP
// ==========================================
export const notificationSendInAppActionParamsSchema = z.object({
  sourceEntity: z.string().default("Automation"),
  sourceId: z.string().default("automation_exec"),
  eventType: z.union([z.nativeEnum(NotificationEventType), z.string()]).default(NotificationEventType.WORK_ORDER_STATUS_CHANGED),
  recipientMemberId: z.string().optional(),
  title: z.string().optional(),
  message: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).default({}),
});

export type NotificationSendInAppActionParams = z.infer<typeof notificationSendInAppActionParamsSchema>;

// ==========================================
// 9. INVENTORY_RESERVE_PARTS
// ==========================================
export const inventoryReservePartsActionParamsSchema = z.object({
  partId: z.string().min(1, "partId is required"),
  locationId: z.string().min(1, "locationId is required"),
  quantity: z.number().positive("quantity must be greater than zero"),
  workOrderId: z.string().nullable().optional(),
  notes: z.string().optional(),
});

export type InventoryReservePartsActionParams = z.infer<typeof inventoryReservePartsActionParamsSchema>;

// ==========================================
// 10. CUSTOMER_UPDATE_STATUS
// ==========================================
export const customerUpdateStatusActionParamsSchema = z.object({
  customerId: z.string().min(1, "customerId is required"),
  status: z.nativeEnum(CustomerStatus),
  reason: z.string().optional(),
});

export type CustomerUpdateStatusActionParams = z.infer<typeof customerUpdateStatusActionParamsSchema>;

// ==========================================
// 11. ASSET_SCHEDULE_MAINTENANCE
// ==========================================
export const assetScheduleMaintenanceActionParamsSchema = z.object({
  workOrderId: z.string().min(1, "workOrderId is required"),
  technicianId: z.string().min(1, "technicianId is required"),
  start: z.union([z.string().min(1), z.date(), z.number()]),
  end: z.union([z.string().min(1), z.date(), z.number()]),
  timezone: z.string().optional(),
  title: z.string().optional(),
  notes: z.string().optional(),
});

export type AssetScheduleMaintenanceActionParams = z.infer<typeof assetScheduleMaintenanceActionParamsSchema>;
