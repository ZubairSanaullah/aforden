/**
 * Phase 1.16.3 — Trigger Ingestion & Event Matching Engine Integration Tests
 */

import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
}));

import { PrismaPg } from "@prisma/adapter-pg";

import { PrismaClient } from "@/generated/prisma/client";
import {
  AutomationTriggerType,
  AutomationExecutionStatus,
  AutomationErrorPolicy,
  AutomationActionType,
  FeatureValueType,
} from "@/generated/prisma/enums";
import {
  ingestAutomationEvent,
  clearIngestionDedupeCache,
  AutomationValidationError,
  AutomationCrossTenantLeakageError,
} from "@/lib/services/automation";

describe("Phase 1.16.3 — Trigger Ingestion & Event Matching Engine Integration Tests", () => {
  let prisma: PrismaClient;
  const testRunId = `auto_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const ws1Id = `ws_auto_1_${testRunId}`;
  const ws2Id = `ws_auto_2_${testRunId}`;
  let rule1Id: string;
  let ruleDisabledId: string;
  let ruleWs2Id: string;

  beforeAll(async () => {
    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
    }
    const adapter = new PrismaPg({ connectionString });
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();

    // 1. Create 2 isolated test workspaces
    await prisma.workspace.create({
      data: {
        id: ws1Id,
        name: `Automation Test Workspace 1 ${testRunId}`,
        slug: `auto-test-ws1-${testRunId}`,
      },
    });

    await prisma.workspace.create({
      data: {
        id: ws2Id,
        name: `Automation Test Workspace 2 ${testRunId}`,
        slug: `auto-test-ws2-${testRunId}`,
      },
    });

    // 2. Grant workspace 1 entitlement via WorkspaceEntitlementOverride
    await prisma.workspaceEntitlementOverride.create({
      data: {
        workspaceId: ws1Id,
        featureKey: "FEATURE_AUTOMATIONS",
        featureType: FeatureValueType.BOOLEAN,
        overrideValueJson: true,
        reason: "Testing Phase 1.16 automation entitlement",
        grantedByUserId: `user_admin_${testRunId}`,
      },
    });

    // 3. Create Rule 1 in WS1 (Enabled, WORK_ORDER_COMPLETED)
    const rule1 = await prisma.automationRule.create({
      data: {
        workspaceId: ws1Id,
        name: "Auto-Invoice on Work Order Completed",
        isEnabled: true,
        errorPolicy: AutomationErrorPolicy.HALT_ON_ERROR,
        trigger: {
          create: {
            workspaceId: ws1Id,
            triggerType: AutomationTriggerType.WORK_ORDER_COMPLETED,
            eventType: "WORK_ORDER_COMPLETED",
          },
        },
        actions: {
          create: [
            {
              workspaceId: ws1Id,
              stepOrder: 1,
              actionType: AutomationActionType.INVOICE_CREATE_FROM_WORK_ORDER,
              paramsJson: { template: "standard" },
            },
          ],
        },
      },
    });
    rule1Id = rule1.id;

    // 4. Create Rule Disabled in WS1 (Disabled, INVOICE_ISSUED)
    const ruleDisabled = await prisma.automationRule.create({
      data: {
        workspaceId: ws1Id,
        name: "Disabled Invoice Notification",
        isEnabled: false,
        errorPolicy: AutomationErrorPolicy.HALT_ON_ERROR,
        trigger: {
          create: {
            workspaceId: ws1Id,
            triggerType: AutomationTriggerType.INVOICE_ISSUED,
            eventType: "INVOICE_ISSUED",
          },
        },
      },
    });
    ruleDisabledId = ruleDisabled.id;

    // 5. Create Rule in WS2 (Enabled, WORK_ORDER_COMPLETED, but WS2 has NO entitlement)
    const ruleWs2 = await prisma.automationRule.create({
      data: {
        workspaceId: ws2Id,
        name: "WS2 Unentitled Rule",
        isEnabled: true,
        errorPolicy: AutomationErrorPolicy.HALT_ON_ERROR,
        trigger: {
          create: {
            workspaceId: ws2Id,
            triggerType: AutomationTriggerType.WORK_ORDER_COMPLETED,
            eventType: "WORK_ORDER_COMPLETED",
          },
        },
      },
    });
    ruleWs2Id = ruleWs2.id;
  });

  afterAll(async () => {
    // Cleanup workspaces (cascades to rules, triggers, actions, executions, overrides)
    if (prisma) {
      if (ws1Id) {
        await prisma.workspace.delete({ where: { id: ws1Id } }).catch(() => {});
      }
      if (ws2Id) {
        await prisma.workspace.delete({ where: { id: ws2Id } }).catch(() => {});
      }
      await prisma.$disconnect().catch(() => {});
    }
  });

  beforeEach(() => {
    clearIngestionDedupeCache();
  });

  describe("1. Successful Event Ingestion & Trigger Matching", () => {
    it("should match active enabled rule and create initial PENDING execution record", async () => {
      const result = await ingestAutomationEvent(
        ws1Id,
        {
          workspaceId: ws1Id,
          eventType: "WORK_ORDER_COMPLETED",
          sourceEntity: "WorkOrder",
          sourceId: "wo_test_101",
          payload: { workOrderId: "wo_test_101", status: "COMPLETED" },
          eventTimestamp: new Date().toISOString(),
          correlationId: "corr-wo-101",
        },
        prisma
      );

      expect(result.outcome).toBe("MATCHED");
      expect(result.isEntitled).toBe(true);
      expect(result.isDuplicate).toBe(false);
      expect(result.matchedRuleCount).toBe(1);
      expect(result.createdExecutionIds).toHaveLength(1);

      // Verify created Execution record in DB
      const execution = await prisma.automationExecution.findUnique({
        where: { id: result.createdExecutionIds[0] },
      });

      expect(execution).toBeDefined();
      expect(execution?.workspaceId).toBe(ws1Id);
      expect(execution?.ruleId).toBe(rule1Id);
      expect(execution?.status).toBe(AutomationExecutionStatus.PENDING);
      expect(execution?.correlationId).toBe("corr-wo-101");
      expect(execution?.executionDepth).toBe(0);
      expect(execution?.reasonCode).toBeNull();
      expect(execution?.completedAt).toBeNull();
    });

    it("should match rule using dot-case event name (e.g. work_order.completed)", async () => {
      const result = await ingestAutomationEvent(
        ws1Id,
        {
          workspaceId: ws1Id,
          eventType: "work_order.completed",
          sourceEntity: "WorkOrder",
          sourceId: "wo_test_102",
          payload: { workOrderId: "wo_test_102", totalAmount: 4500 },
          eventTimestamp: "2026-08-28T12:30:00.000Z",
        },
        prisma
      );

      expect(result.outcome).toBe("MATCHED");
      expect(result.canonicalTriggerType).toBe(AutomationTriggerType.WORK_ORDER_COMPLETED);
      expect(result.createdExecutionIds).toHaveLength(1);
    });
  });

  describe("2. Tier 1 Ingestion Deduplication (Invariant 5)", () => {
    it("should drop duplicate event within 5-minute window with NO execution record created", async () => {
      const fixedTimestamp = "2026-08-28T12:45:00.000Z";
      const eventPayload = {
        workspaceId: ws1Id,
        eventType: "WORK_ORDER_COMPLETED",
        sourceEntity: "WorkOrder",
        sourceId: "wo_test_dedup_1",
        payload: { workOrderId: "wo_test_dedup_1" },
        eventTimestamp: fixedTimestamp,
      };

      // Ingestion 1: First arrival -> MATCHED
      const result1 = await ingestAutomationEvent(ws1Id, eventPayload, prisma);
      expect(result1.outcome).toBe("MATCHED");
      expect(result1.createdExecutionIds).toHaveLength(1);

      const executionsBeforeCount = await prisma.automationExecution.count({
        where: { workspaceId: ws1Id },
      });

      // Ingestion 2: Duplicate arrival -> DROPPED_DUPLICATE
      const result2 = await ingestAutomationEvent(ws1Id, eventPayload, prisma);
      expect(result2.outcome).toBe("DROPPED_DUPLICATE");
      expect(result2.isDuplicate).toBe(true);
      expect(result2.reasonCode).toBe("DUPLICATE_INGESTION_EVENT");
      expect(result2.createdExecutionIds).toHaveLength(0);

      // Verify NO execution was inserted into database on dedupe hit
      const executionsAfterCount = await prisma.automationExecution.count({
        where: { workspaceId: ws1Id },
      });
      expect(executionsAfterCount).toBe(executionsBeforeCount);
    });
  });

  describe("3. Disabled Rule Short-Circuit Handling", () => {
    it("should short-circuit with SKIPPED status and reasonCode RULE_DISABLED", async () => {
      const result = await ingestAutomationEvent(
        ws1Id,
        {
          workspaceId: ws1Id,
          eventType: "INVOICE_ISSUED",
          sourceEntity: "Invoice",
          sourceId: "inv_test_201",
          payload: { invoiceId: "inv_test_201" },
          eventTimestamp: "2026-08-28T12:50:00.000Z",
        },
        prisma
      );

      expect(result.outcome).toBe("SKIPPED");
      expect(result.reasonCode).toBe("RULE_DISABLED");
      expect(result.createdExecutionIds).toHaveLength(1);

      const execution = await prisma.automationExecution.findUnique({
        where: { id: result.createdExecutionIds[0] },
      });

      expect(execution?.status).toBe(AutomationExecutionStatus.SKIPPED);
      expect(execution?.reasonCode).toBe("RULE_DISABLED");
      expect(execution?.ruleId).toBe(ruleDisabledId);
      expect(execution?.completedAt).not.toBeNull();
    });
  });

  describe("4. Entitlement Inactive Short-Circuit Handling", () => {
    it("should short-circuit with SKIPPED and ENTITLEMENT_INACTIVE when workspace lacks entitlement", async () => {
      const result = await ingestAutomationEvent(
        ws2Id,
        {
          workspaceId: ws2Id,
          eventType: "WORK_ORDER_COMPLETED",
          sourceEntity: "WorkOrder",
          sourceId: "wo_test_ws2_1",
          payload: { workOrderId: "wo_test_ws2_1" },
          eventTimestamp: "2026-08-28T12:55:00.000Z",
        },
        prisma
      );

      expect(result.outcome).toBe("SKIPPED");
      expect(result.isEntitled).toBe(false);
      expect(result.reasonCode).toBe("ENTITLEMENT_INACTIVE");
      expect(result.createdExecutionIds).toHaveLength(1);

      const execution = await prisma.automationExecution.findUnique({
        where: { id: result.createdExecutionIds[0] },
      });

      expect(execution?.workspaceId).toBe(ws2Id);
      expect(execution?.status).toBe(AutomationExecutionStatus.SKIPPED);
      expect(execution?.reasonCode).toBe("ENTITLEMENT_INACTIVE");
      expect(execution?.ruleId).toBe(ruleWs2Id);
    });

    it("should return NO_MATCH when no rules exist for event in unentitled workspace", async () => {
      const result = await ingestAutomationEvent(
        ws2Id,
        {
          workspaceId: ws2Id,
          eventType: "QUOTE_APPROVED",
          sourceEntity: "Quote",
          sourceId: "q_test_1",
          payload: {},
          eventTimestamp: "2026-08-28T12:56:00.000Z",
        },
        prisma
      );

      expect(result.outcome).toBe("NO_MATCH");
      expect(result.isEntitled).toBe(false);
      expect(result.createdExecutionIds).toHaveLength(0);
    });
  });

  describe("5. Tenant Isolation (Invariant 1) & Validation Security", () => {
    it("should never match rules across workspace boundaries", async () => {
      // WS1 has a rule for INVOICE_ISSUED (disabled). WS2 has NO rule for INVOICE_ISSUED.
      const result = await ingestAutomationEvent(
        ws2Id,
        {
          workspaceId: ws2Id,
          eventType: "INVOICE_ISSUED",
          sourceEntity: "Invoice",
          sourceId: "inv_test_ws2",
          payload: {},
          eventTimestamp: "2026-08-28T13:00:00.000Z",
        },
        prisma
      );

      expect(result.outcome).toBe("NO_MATCH");
      expect(result.createdExecutionIds).toHaveLength(0);
    });

    it("should throw AutomationCrossTenantLeakageError if payload workspaceId conflicts with context", async () => {
      await expect(
        ingestAutomationEvent(
          ws1Id,
          {
            workspaceId: ws2Id, // Cross-tenant conflict!
            eventType: "WORK_ORDER_COMPLETED",
            sourceEntity: "WorkOrder",
            sourceId: "wo_1",
            payload: {},
          },
          prisma
        )
      ).rejects.toThrow(AutomationCrossTenantLeakageError);
    });

    it("should throw AutomationValidationError on missing required fields", async () => {
      await expect(
        ingestAutomationEvent(
          ws1Id,
          {
            workspaceId: ws1Id,
            eventType: "",
            sourceEntity: "",
            sourceId: "",
            payload: {},
          },
          prisma
        )
      ).rejects.toThrow(AutomationValidationError);
    });
  });
});
