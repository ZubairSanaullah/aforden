/**
 * Phase 1.16.3 — Event Catalog & Tier 1 Deduplication Unit Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { AutomationTriggerType } from "@/generated/prisma/enums";
import {
  mapEventNameToTriggerType,
  isAutomationTriggerType,
  DOMAIN_EVENT_TO_TRIGGER_MAP,
} from "@/lib/services/automation/eventCatalogRegistry";
import {
  computeIngestionDedupeKey,
  checkAndRecordIngestionDedupe,
  clearIngestionDedupeCache,
} from "@/lib/services/automation/ingestionDeduplication";

describe("Phase 1.16.3 — Event Catalog & Tier 1 Deduplication Tests", () => {
  beforeEach(() => {
    clearIngestionDedupeCache();
  });

  describe("1. Event Catalog Registry & Mapping", () => {
    it("should correctly map all 14 canonical preliminary trigger types from enum", () => {
      const canonicalTypes = Object.values(AutomationTriggerType);
      expect(canonicalTypes).toHaveLength(14);

      for (const type of canonicalTypes) {
        expect(isAutomationTriggerType(type)).toBe(true);
        expect(mapEventNameToTriggerType(type)).toBe(type);
      }
    });

    it("should map dot-case domain events to canonical AutomationTriggerType enums", () => {
      expect(mapEventNameToTriggerType("work_order.completed")).toBe(AutomationTriggerType.WORK_ORDER_COMPLETED);
      expect(mapEventNameToTriggerType("work_order.created")).toBe(AutomationTriggerType.WORK_ORDER_CREATED);
      expect(mapEventNameToTriggerType("work_order.status_changed")).toBe(AutomationTriggerType.WORK_ORDER_STATUS_CHANGED);
      expect(mapEventNameToTriggerType("work_order.assigned")).toBe(AutomationTriggerType.WORK_ORDER_ASSIGNED);
      expect(mapEventNameToTriggerType("quote.approved")).toBe(AutomationTriggerType.QUOTE_APPROVED);
      expect(mapEventNameToTriggerType("quote.expired")).toBe(AutomationTriggerType.QUOTE_EXPIRED);
      expect(mapEventNameToTriggerType("invoice.issued")).toBe(AutomationTriggerType.INVOICE_ISSUED);
      expect(mapEventNameToTriggerType("invoice.payment_recorded")).toBe(AutomationTriggerType.INVOICE_PAYMENT_RECORDED);
      expect(mapEventNameToTriggerType("invoice.overdue")).toBe(AutomationTriggerType.INVOICE_OVERDUE);
      expect(mapEventNameToTriggerType("inventory.low_stock")).toBe(AutomationTriggerType.INVENTORY_LOW_STOCK_REACHED);
      expect(mapEventNameToTriggerType("asset.maintenance_due")).toBe(AutomationTriggerType.ASSET_MAINTENANCE_DUE);
      expect(mapEventNameToTriggerType("scheduled.cron")).toBe(AutomationTriggerType.SCHEDULED_CRON);
      expect(mapEventNameToTriggerType("scheduled.interval")).toBe(AutomationTriggerType.SCHEDULED_INTERVAL);
      expect(mapEventNameToTriggerType("scheduled.entity_offset")).toBe(AutomationTriggerType.SCHEDULED_ENTITY_OFFSET);
    });

    it("should return null for unknown event names", () => {
      expect(mapEventNameToTriggerType("unknown.custom_event")).toBeNull();
      expect(mapEventNameToTriggerType("random_string_123")).toBeNull();
    });
  });

  describe("2. Ingestion Deduplication (Invariant 5 - Tier 1)", () => {
    it("should deterministically compute identical SHA-256 dedupeKey for identical parameters", () => {
      const workspaceId = "ws_test_123";
      const eventType = "WORK_ORDER_COMPLETED";
      const sourceEntity = "WorkOrder";
      const sourceId = "wo_abc_456";
      const timestamp = "2026-08-28T12:00:00.000Z";

      const key1 = computeIngestionDedupeKey(workspaceId, eventType, sourceEntity, sourceId, timestamp);
      const key2 = computeIngestionDedupeKey(workspaceId, eventType, sourceEntity, sourceId, timestamp);

      expect(key1).toBe(key2);
      expect(key1).toHaveLength(64); // SHA-256 hex length
    });

    it("should compute different dedupeKey when any attribute changes", () => {
      const baseArgs = ["ws_1", "WORK_ORDER_COMPLETED", "WorkOrder", "wo_1", "2026-08-28T12:00:00Z"] as const;
      const baseKey = computeIngestionDedupeKey(...baseArgs);

      const diffWs = computeIngestionDedupeKey("ws_2", "WORK_ORDER_COMPLETED", "WorkOrder", "wo_1", "2026-08-28T12:00:00Z");
      const diffType = computeIngestionDedupeKey("ws_1", "WORK_ORDER_CREATED", "WorkOrder", "wo_1", "2026-08-28T12:00:00Z");
      const diffEntity = computeIngestionDedupeKey("ws_1", "WORK_ORDER_COMPLETED", "Invoice", "wo_1", "2026-08-28T12:00:00Z");
      const diffId = computeIngestionDedupeKey("ws_1", "WORK_ORDER_COMPLETED", "WorkOrder", "wo_2", "2026-08-28T12:00:00Z");
      const diffTs = computeIngestionDedupeKey("ws_1", "WORK_ORDER_COMPLETED", "WorkOrder", "wo_1", "2026-08-28T12:01:00Z");

      expect(diffWs).not.toBe(baseKey);
      expect(diffType).not.toBe(baseKey);
      expect(diffEntity).not.toBe(baseKey);
      expect(diffId).not.toBe(baseKey);
      expect(diffTs).not.toBe(baseKey);
    });

    it("should detect duplicate event within 5-minute rolling window and allow after window expires", () => {
      const workspaceId = "ws_test_dedupe";
      const dedupeKey = "test_hash_abcdef123456";
      const initialTime = 1000000;

      // First ingestion
      const result1 = checkAndRecordIngestionDedupe(workspaceId, dedupeKey, initialTime);
      expect(result1.isDuplicate).toBe(false);

      // Second ingestion within 5 minutes (e.g., +2 minutes = +120,000 ms)
      const result2 = checkAndRecordIngestionDedupe(workspaceId, dedupeKey, initialTime + 120000);
      expect(result2.isDuplicate).toBe(true);

      // Third ingestion exactly at 5 minutes (300,000 ms) -> duplicate
      const result3 = checkAndRecordIngestionDedupe(workspaceId, dedupeKey, initialTime + 300000);
      expect(result3.isDuplicate).toBe(true);

      // Fourth ingestion after window expires (> 300,000 ms, e.g. +300,001 ms)
      const result4 = checkAndRecordIngestionDedupe(workspaceId, dedupeKey, initialTime + 300001);
      expect(result4.isDuplicate).toBe(false);
    });
  });
});
