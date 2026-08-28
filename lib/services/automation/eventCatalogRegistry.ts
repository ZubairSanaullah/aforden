/**
 * Phase 1.16.3 — Event Catalog Registry
 * Maps domain event names to canonical AutomationTriggerType enums and validates event payloads.
 */

import { AutomationTriggerType } from "@/generated/prisma/enums";

/**
 * Event-to-TriggerType mapping table supporting both dot-notation domain events
 * and canonical enum names.
 */
export const DOMAIN_EVENT_TO_TRIGGER_MAP: Readonly<Record<string, AutomationTriggerType>> = Object.freeze({
  // Work Order Domain Events
  "work_order.created": AutomationTriggerType.WORK_ORDER_CREATED,
  "WORK_ORDER_CREATED": AutomationTriggerType.WORK_ORDER_CREATED,
  "work_order.status_changed": AutomationTriggerType.WORK_ORDER_STATUS_CHANGED,
  "WORK_ORDER_STATUS_CHANGED": AutomationTriggerType.WORK_ORDER_STATUS_CHANGED,
  "work_order.assigned": AutomationTriggerType.WORK_ORDER_ASSIGNED,
  "WORK_ORDER_ASSIGNED": AutomationTriggerType.WORK_ORDER_ASSIGNED,
  "work_order.completed": AutomationTriggerType.WORK_ORDER_COMPLETED,
  "WORK_ORDER_COMPLETED": AutomationTriggerType.WORK_ORDER_COMPLETED,

  // Quote Domain Events
  "quote.approved": AutomationTriggerType.QUOTE_APPROVED,
  "QUOTE_APPROVED": AutomationTriggerType.QUOTE_APPROVED,
  "quote.expired": AutomationTriggerType.QUOTE_EXPIRED,
  "QUOTE_EXPIRED": AutomationTriggerType.QUOTE_EXPIRED,

  // Invoice Domain Events
  "invoice.issued": AutomationTriggerType.INVOICE_ISSUED,
  "INVOICE_ISSUED": AutomationTriggerType.INVOICE_ISSUED,
  "invoice.payment_succeeded": AutomationTriggerType.INVOICE_PAYMENT_RECORDED,
  "invoice.payment_recorded": AutomationTriggerType.INVOICE_PAYMENT_RECORDED,
  "INVOICE_PAYMENT_RECORDED": AutomationTriggerType.INVOICE_PAYMENT_RECORDED,
  "invoice.overdue": AutomationTriggerType.INVOICE_OVERDUE,
  "INVOICE_OVERDUE": AutomationTriggerType.INVOICE_OVERDUE,

  // Inventory Domain Events
  "inventory.low_stock": AutomationTriggerType.INVENTORY_LOW_STOCK_REACHED,
  "INVENTORY_LOW_STOCK_REACHED": AutomationTriggerType.INVENTORY_LOW_STOCK_REACHED,

  // Asset Domain Events
  "asset.maintenance_due": AutomationTriggerType.ASSET_MAINTENANCE_DUE,
  "ASSET_MAINTENANCE_DUE": AutomationTriggerType.ASSET_MAINTENANCE_DUE,

  // Scheduled / Temporal Triggers
  "scheduled.cron": AutomationTriggerType.SCHEDULED_CRON,
  "SCHEDULED_CRON": AutomationTriggerType.SCHEDULED_CRON,
  "scheduled.interval": AutomationTriggerType.SCHEDULED_INTERVAL,
  "SCHEDULED_INTERVAL": AutomationTriggerType.SCHEDULED_INTERVAL,
  "scheduled.entity_offset": AutomationTriggerType.SCHEDULED_ENTITY_OFFSET,
  "SCHEDULED_ENTITY_OFFSET": AutomationTriggerType.SCHEDULED_ENTITY_OFFSET,
});

/**
 * Checks whether a given string is a valid AutomationTriggerType enum value.
 */
export function isAutomationTriggerType(type: string): type is AutomationTriggerType {
  return Object.values(AutomationTriggerType).includes(type as AutomationTriggerType);
}

/**
 * Maps a raw event name (e.g. "work_order.completed" or "WORK_ORDER_COMPLETED")
 * to its canonical AutomationTriggerType enum.
 */
export function mapEventNameToTriggerType(eventName: string): AutomationTriggerType | null {
  if (isAutomationTriggerType(eventName)) {
    return eventName;
  }
  const normalized = eventName.trim().toLowerCase();
  if (DOMAIN_EVENT_TO_TRIGGER_MAP[normalized]) {
    return DOMAIN_EVENT_TO_TRIGGER_MAP[normalized];
  }
  const upper = eventName.trim().toUpperCase();
  if (DOMAIN_EVENT_TO_TRIGGER_MAP[upper]) {
    return DOMAIN_EVENT_TO_TRIGGER_MAP[upper];
  }
  return null;
}
