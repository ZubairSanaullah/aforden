/**
 * Phase 1.16.8 — Automation Management Services & REST APIs Integration Tests
 */

import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";

const hoistedMocks = vi.hoisted(() => ({
  auth: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: hoistedMocks.auth,
}));

vi.mock("@/lib/auth", () => ({
  auth: hoistedMocks.auth,
}));

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import {
  AutomationTriggerType,
  AutomationExecutionStatus,
  AutomationExecutionStepStatus,
  AutomationActionType,
  AutomationErrorPolicy,
  ConditionOperator,
  FeatureValueType,
  MembershipRole,
} from "@/generated/prisma/enums";
import {
  createAutomationRule,
  getAutomationRule,
  listAutomationRules,
  updateAutomationRule,
  toggleAutomationRule,
  deleteAutomationRule,
  testRunAutomationRule,
  listAutomationExecutions,
  getAutomationExecution,
  listAutomationScheduleJobs,
  toggleAutomationScheduleJob,
  deleteAutomationScheduleJob,
  getActionHandler,
  AutomationRuleNotFoundError,

  AutomationExecutionNotFoundError,
  AutomationValidationError,
} from "@/lib/services/automation";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import { PlanFeatureNotEnabledError } from "@/lib/services/billing/billingErrors";
import * as workOrderService from "@/lib/services/workOrder";
import * as notificationService from "@/lib/services/notification";

// REST API Route Handlers
import { GET as listRulesRoute, POST as createRuleRoute } from "@/app/api/automations/rules/route";
import {
  GET as getRuleRoute,
  PATCH as updateRuleRoute,
  DELETE as deleteRuleRoute,
} from "@/app/api/automations/rules/[ruleId]/route";
import { POST as toggleRuleRoute } from "@/app/api/automations/rules/[ruleId]/toggle/route";
import { POST as testRunRuleRoute } from "@/app/api/automations/rules/[ruleId]/test-run/route";
import { GET as listExecutionsRoute } from "@/app/api/automations/executions/route";
import { GET as getExecutionRoute } from "@/app/api/automations/executions/[executionId]/route";
import {
  GET as listSchedulesRoute,
  POST as registerScheduleRoute,
} from "@/app/api/automations/schedules/route";
import {
  PATCH as updateScheduleRoute,
  DELETE as deleteScheduleRoute,
} from "@/app/api/automations/schedules/[jobId]/route";

describe("Phase 1.16.8 — Automation Management Services & REST APIs", { timeout: 25000 }, () => {
  let prisma: PrismaClient;
  const testRunId = `mgmt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const wsId = `ws_mgmt_${testRunId}`;
  const unentitledWsId = `ws_unentitled_${testRunId}`;
  const otherWsId = `ws_other_${testRunId}`;

  // User contexts
  const ownerUserId = `user_owner_${testRunId}`;
  const adminUserId = `user_admin_${testRunId}`;
  const managerUserId = `user_manager_${testRunId}`;
  const techUserId = `user_tech_${testRunId}`;

  const createAuthContext = (userId: string, role: MembershipRole, workspaceId: string) => ({
    userId,
    user: { id: userId, name: `User ${userId}`, email: `${userId}@example.com`, status: "ACTIVE" },
    workspaceId,
    workspace: { id: workspaceId, name: "Test WS", slug: `slug-${workspaceId}` },
    membership: { id: `mem_${userId}`, role, userId, workspaceId, status: "ACTIVE" },
  });

  beforeAll(async () => {
    const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL or DIRECT_URL is required for live database tests");
    }
    const adapter = new PrismaPg({ connectionString });
    prisma = new PrismaClient({ adapter });
    await prisma.$connect();

    // 1. Create Workspaces
    await prisma.workspace.createMany({
      data: [
        { id: wsId, name: "Automation Mgmt WS", slug: `mgmt-main-${testRunId}` },
        { id: unentitledWsId, name: "Unentitled WS", slug: `mgmt-unent-${testRunId}` },
        { id: otherWsId, name: "Other WS", slug: `mgmt-other-${testRunId}` },
      ],
    });

    // 2. Create Users
    await prisma.user.createMany({
      data: [
        { id: ownerUserId, email: `owner_${testRunId}@example.com`, name: "Owner User", status: "ACTIVE" },
        { id: adminUserId, email: `admin_${testRunId}@example.com`, name: "Admin User", status: "ACTIVE" },
        { id: managerUserId, email: `manager_${testRunId}@example.com`, name: "Manager User", status: "ACTIVE" },
        { id: techUserId, email: `tech_${testRunId}@example.com`, name: "Tech User", status: "ACTIVE" },
      ],
    });

    // 3. Create Workspace Memberships
    await prisma.workspaceMember.createMany({
      data: [
        { id: `mem_owner_${testRunId}`, workspaceId: wsId, userId: ownerUserId, role: MembershipRole.OWNER, status: "ACTIVE" },
        { id: `mem_admin_${testRunId}`, workspaceId: wsId, userId: adminUserId, role: MembershipRole.ADMIN, status: "ACTIVE" },
        { id: `mem_mgr_${testRunId}`, workspaceId: wsId, userId: managerUserId, role: MembershipRole.MANAGER, status: "ACTIVE" },
        { id: `mem_tech_${testRunId}`, workspaceId: wsId, userId: techUserId, role: MembershipRole.TECHNICIAN, status: "ACTIVE" },
      ],
    });

    // 4. Seed Automation Entitlements (Entitled WS = true, Unentitled WS = false)
    await prisma.workspaceEntitlementOverride.createMany({
      data: [
        {
          workspaceId: wsId,
          featureKey: "FEATURE_AUTOMATIONS",
          featureType: FeatureValueType.BOOLEAN,
          overrideValueJson: true,
          reason: "Entitled test workspace",
          grantedByUserId: ownerUserId,
        },
        {
          workspaceId: otherWsId,
          featureKey: "FEATURE_AUTOMATIONS",
          featureType: FeatureValueType.BOOLEAN,
          overrideValueJson: true,
          reason: "Other test workspace",
          grantedByUserId: ownerUserId,
        },
        {
          workspaceId: unentitledWsId,
          featureKey: "FEATURE_AUTOMATIONS",
          featureType: FeatureValueType.BOOLEAN,
          overrideValueJson: false,
          reason: "Unentitled test workspace",
          grantedByUserId: ownerUserId,
        },
      ],
    });
  });

  afterAll(async () => {
    if (prisma) {
      await prisma.automationScheduleJob.deleteMany({
        where: { workspaceId: { in: [wsId, unentitledWsId, otherWsId] } },
      });
      await prisma.automationExecutionStep.deleteMany({
        where: { workspaceId: { in: [wsId, unentitledWsId, otherWsId] } },
      });
      await prisma.automationExecution.deleteMany({
        where: { workspaceId: { in: [wsId, unentitledWsId, otherWsId] } },
      });
      await prisma.automationAction.deleteMany({
        where: { workspaceId: { in: [wsId, unentitledWsId, otherWsId] } },
      });
      await prisma.automationCondition.deleteMany({
        where: { workspaceId: { in: [wsId, unentitledWsId, otherWsId] } },
      });
      await prisma.automationConditionGroup.deleteMany({
        where: { workspaceId: { in: [wsId, unentitledWsId, otherWsId] } },
      });
      await prisma.automationTrigger.deleteMany({
        where: { workspaceId: { in: [wsId, unentitledWsId, otherWsId] } },
      });
      await prisma.automationRule.deleteMany({
        where: { workspaceId: { in: [wsId, unentitledWsId, otherWsId] } },
      });
      await prisma.workspaceMember.deleteMany({
        where: { workspaceId: { in: [wsId, unentitledWsId, otherWsId] } },
      });
      await prisma.workspaceEntitlementOverride.deleteMany({
        where: { workspaceId: { in: [wsId, unentitledWsId, otherWsId] } },
      });
      await prisma.workspace.deleteMany({
        where: { id: { in: [wsId, unentitledWsId, otherWsId] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [ownerUserId, adminUserId, managerUserId, techUserId] } },
      });
      await prisma.$disconnect();
    }
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. RULE CRUD & LIFECYCLE MANAGEMENT SERVICES
  // =========================================================================
  describe("1. Rule CRUD & Lifecycle Management Services", () => {
    it("should atomically create a complete automation rule with trigger, nested conditions, and actions", async () => {
      const auth = createAuthContext(adminUserId, MembershipRole.ADMIN, wsId);

      const input = {
        name: "Auto Invoice Rule",
        description: "Creates invoice on completion",
        isEnabled: true,
        errorPolicy: AutomationErrorPolicy.HALT_ON_ERROR,
        trigger: {
          triggerType: AutomationTriggerType.WORK_ORDER_COMPLETED,
          eventType: "work_order.completed",
          filterJson: { priority: "HIGH" },
        },
        conditionGroup: {
          logicalOperator: "AND",
          conditions: [
            {
              fieldPath: "trigger.payload.totalLaborMinutes",
              operator: ConditionOperator.GREATER_THAN,
              targetValueJson: 60,
            },
          ],
          childGroups: [
            {
              logicalOperator: "OR",
              conditions: [
                {
                  fieldPath: "trigger.payload.isWarranty",
                  operator: ConditionOperator.IS_FALSE,
                  targetValueJson: false,
                },
              ],
            },
          ],
        },
        actions: [
          {
            stepOrder: 1,
            actionType: AutomationActionType.INVOICE_CREATE_FROM_WORK_ORDER,
            paramsJson: { workOrderId: "{{trigger.payload.workOrderId}}" },
          },
          {
            stepOrder: 2,
            actionType: AutomationActionType.NOTIFICATION_SEND_IN_APP,
            paramsJson: { message: "Invoice created" },
          },
        ],
      };

      const created = await createAutomationRule(wsId, input, auth as any, prisma);

      expect(created.id).toBeDefined();
      expect(created.name).toBe("Auto Invoice Rule");
      expect(created.trigger?.eventType).toBe("work_order.completed");
      expect(created.conditionGroup?.conditions).toHaveLength(1);
      expect(created.conditionGroup?.childGroups).toHaveLength(1);
      expect(created.actions).toHaveLength(2);
      expect(created.actions[0].stepOrder).toBe(1);
      expect(created.actions[1].stepOrder).toBe(2);
    });

    it("should retrieve a single rule by ID with full nested structure", async () => {
      const auth = createAuthContext(managerUserId, MembershipRole.MANAGER, wsId);

      const created = await createAutomationRule(
        wsId,
        {
          name: "Fetch Target Rule",
          isEnabled: true,
          trigger: {
            triggerType: AutomationTriggerType.WORK_ORDER_CREATED,
            eventType: "work_order.created",
          },
        },
        undefined,
        prisma,
      );

      const fetched = await getAutomationRule(wsId, created.id, auth as any, prisma);

      expect(fetched.id).toBe(created.id);
      expect(fetched.name).toBe("Fetch Target Rule");
      expect(fetched.trigger?.triggerType).toBe(AutomationTriggerType.WORK_ORDER_CREATED);
    });

    it("should list rules with filtering, search, and pagination", async () => {
      const auth = createAuthContext(managerUserId, MembershipRole.MANAGER, wsId);

      const result = await listAutomationRules(
        wsId,
        {
          search: "Invoice",
          page: 1,
          pageSize: 10,
        },
        auth as any,
        prisma,
      );

      expect(result.rules.length).toBeGreaterThanOrEqual(1);
      expect(result.total).toBeGreaterThanOrEqual(1);
      expect(result.page).toBe(1);
    });

    it("should update rule attributes and replace actions atomically", async () => {
      const auth = createAuthContext(ownerUserId, MembershipRole.OWNER, wsId);

      const rule = await createAutomationRule(
        wsId,
        {
          name: "Original Name",
          isEnabled: true,
          actions: [
            {
              stepOrder: 1,
              actionType: AutomationActionType.WORK_ORDER_ADD_NOTE,
              paramsJson: { note: "Initial" },
            },
          ],
        },
        undefined,
        prisma,
      );

      const updated = await updateAutomationRule(
        wsId,
        rule.id,
        {
          name: "Updated Name",
          actions: [
            {
              stepOrder: 1,
              actionType: AutomationActionType.NOTIFICATION_SEND_IN_APP,
              paramsJson: { message: "Replaced" },
            },
          ],
        },
        auth as any,
        prisma,
      );

      expect(updated.name).toBe("Updated Name");
      expect(updated.actions).toHaveLength(1);
      expect(updated.actions[0].actionType).toBe(AutomationActionType.NOTIFICATION_SEND_IN_APP);
    });

    it("should replace an existing trigger with a new one atomically", async () => {
      const auth = createAuthContext(ownerUserId, MembershipRole.OWNER, wsId);

      const rule = await createAutomationRule(
        wsId,
        {
          name: "Trigger Replacement Rule",
          isEnabled: true,
          trigger: {
            triggerType: AutomationTriggerType.WORK_ORDER_CREATED,
            eventType: "work_order.created",
            configJson: { initial: true },
          },
        },
        undefined,
        prisma,
      );

      const oldTriggerId = rule.trigger?.id;
      expect(oldTriggerId).toBeDefined();

      const updated = await updateAutomationRule(
        wsId,
        rule.id,
        {
          trigger: {
            triggerType: AutomationTriggerType.INVOICE_ISSUED,
            eventType: "invoice.issued",
            configJson: { minAmount: 500 },
          },
        },
        auth as any,
        prisma,
      );

      expect(updated.trigger).toBeDefined();
      expect(updated.trigger?.id).not.toBe(oldTriggerId);
      expect(updated.trigger?.triggerType).toBe(AutomationTriggerType.INVOICE_ISSUED);
      expect(updated.trigger?.eventType).toBe("invoice.issued");

      // Verify DB has exactly 1 trigger row for this rule
      const triggersInDb = await prisma.automationTrigger.findMany({
        where: { ruleId: rule.id, workspaceId: wsId },
      });
      expect(triggersInDb).toHaveLength(1);
      expect(triggersInDb[0].eventType).toBe("invoice.issued");
    });

    it("should replace an existing conditionGroup tree with a new nested tree atomically", async () => {
      const auth = createAuthContext(ownerUserId, MembershipRole.OWNER, wsId);

      const rule = await createAutomationRule(
        wsId,
        {
          name: "Condition Replacement Rule",
          isEnabled: true,
          conditionGroup: {
            logicalOperator: "AND",
            conditions: [
              {
                fieldPath: "trigger.payload.priority",
                operator: ConditionOperator.EQUALS,
                targetValueJson: "HIGH",
              },
            ],
          },
        },
        undefined,
        prisma,
      );

      const oldGroupId = rule.conditionGroup?.id;
      expect(oldGroupId).toBeDefined();

      const updated = await updateAutomationRule(
        wsId,
        rule.id,
        {
          conditionGroup: {
            logicalOperator: "OR",
            conditions: [
              {
                fieldPath: "trigger.payload.status",
                operator: ConditionOperator.EQUALS,
                targetValueJson: "COMPLETED",
              },
            ],
            childGroups: [
              {
                logicalOperator: "AND",
                conditions: [
                  {
                    fieldPath: "trigger.payload.totalAmount",
                    operator: ConditionOperator.GREATER_THAN,
                    targetValueJson: 1000,
                  },
                ],
              },
            ],
          },
        },
        auth as any,
        prisma,
      );

      expect(updated.conditionGroup).toBeDefined();
      expect(updated.conditionGroup?.id).not.toBe(oldGroupId);
      expect(updated.conditionGroup?.logicalOperator).toBe("OR");
      expect(updated.conditionGroup?.conditions).toHaveLength(1);
      expect(updated.conditionGroup?.childGroups).toHaveLength(1);
      expect(updated.conditionGroup?.childGroups[0].logicalOperator).toBe("AND");
      expect(updated.conditionGroup?.childGroups[0].conditions).toHaveLength(1);

      // Verify old group is deleted and new group structure is intact in DB
      const rootGroupsInDb = await prisma.automationConditionGroup.findMany({
        where: { ruleId: rule.id, workspaceId: wsId },
      });
      expect(rootGroupsInDb).toHaveLength(1);
      expect(rootGroupsInDb[0].id).toBe(updated.conditionGroup?.id);
    });

    it("should explicitly clear trigger and conditionGroup when passed null without leaving orphaned rows", async () => {
      const auth = createAuthContext(ownerUserId, MembershipRole.OWNER, wsId);

      const rule = await createAutomationRule(
        wsId,
        {
          name: "Nulling Test Rule",
          isEnabled: true,
          trigger: {
            triggerType: AutomationTriggerType.INVOICE_ISSUED,
            eventType: "invoice.issued",
          },
          conditionGroup: {
            logicalOperator: "AND",
            conditions: [
              {
                fieldPath: "trigger.payload.amount",
                operator: ConditionOperator.GREATER_THAN,
                targetValueJson: 100,
              },
            ],
          },
        },
        undefined,
        prisma,
      );


      expect(rule.trigger).toBeDefined();
      expect(rule.conditionGroup).toBeDefined();

      const updated = await updateAutomationRule(
        wsId,
        rule.id,
        {
          trigger: null,
          conditionGroup: null,
        },
        auth as any,
        prisma,
      );

      expect(updated.trigger).toBeNull();
      expect(updated.conditionGroup).toBeNull();

      // Verify no orphaned rows in database
      const triggersInDb = await prisma.automationTrigger.findMany({
        where: { ruleId: rule.id, workspaceId: wsId },
      });
      expect(triggersInDb).toHaveLength(0);

      const conditionGroupsInDb = await prisma.automationConditionGroup.findMany({
        where: { ruleId: rule.id, workspaceId: wsId },
      });
      expect(conditionGroupsInDb).toHaveLength(0);
    });


    it("should toggle rule isEnabled status", async () => {
      const auth = createAuthContext(adminUserId, MembershipRole.ADMIN, wsId);

      const rule = await createAutomationRule(
        wsId,
        { name: "Toggle Rule", isEnabled: true },
        undefined,
        prisma,
      );

      const toggledOff = await toggleAutomationRule(wsId, rule.id, false, auth as any, prisma);
      expect(toggledOff.isEnabled).toBe(false);

      const toggledOn = await toggleAutomationRule(wsId, rule.id, true, auth as any, prisma);
      expect(toggledOn.isEnabled).toBe(true);
    });

    it("should delete rule while preserving execution history records (Invariant 4)", async () => {
      const auth = createAuthContext(ownerUserId, MembershipRole.OWNER, wsId);

      const rule = await createAutomationRule(
        wsId,
        { name: "Delete Test Rule", isEnabled: true },
        undefined,
        prisma,
      );

      // Create an execution record linked to this rule
      const execution = await prisma.automationExecution.create({
        data: {
          workspaceId: wsId,
          ruleId: rule.id,
          status: AutomationExecutionStatus.COMPLETED,
          correlationId: `corr_${Date.now()}`,
          causalityChain: [rule.id],
          triggerPayloadJson: {},
        },
      });

      // Delete Rule
      const delResult = await deleteAutomationRule(wsId, rule.id, auth as any, prisma);
      expect(delResult.success).toBe(true);

      // Verify Rule is gone
      await expect(getAutomationRule(wsId, rule.id, undefined, prisma)).rejects.toThrow(
        AutomationRuleNotFoundError,
      );

      // Verify Execution history record was PRESERVED with ruleId: null (Invariant 4)
      const executionAfter = await prisma.automationExecution.findUnique({
        where: { id: execution.id },
      });
      expect(executionAfter).toBeDefined();
      expect(executionAfter?.ruleId).toBeNull();
      expect(executionAfter?.status).toBe(AutomationExecutionStatus.COMPLETED);
    });

    it("should reject non-contiguous action step orders with AutomationValidationError", async () => {
      const auth = createAuthContext(adminUserId, MembershipRole.ADMIN, wsId);

      const invalidInput = {
        name: "Non-contiguous steps rule",
        actions: [
          { stepOrder: 1, actionType: AutomationActionType.WORK_ORDER_ADD_NOTE, paramsJson: {} },
          { stepOrder: 3, actionType: AutomationActionType.WORK_ORDER_ADD_NOTE, paramsJson: {} }, // Missing step 2!
        ],
      };

      await expect(
        createAutomationRule(wsId, invalidInput, auth as any, prisma),
      ).rejects.toThrow(AutomationValidationError);
    });
  });

  // =========================================================================
  // 2. RBAC ENFORCEMENT MATRIX (INVARIANT 2)
  // =========================================================================
  describe("2. RBAC Enforcement Matrix (Invariant 2)", () => {
    it("OWNER and ADMIN can manage rules", async () => {
      const ownerAuth = createAuthContext(ownerUserId, MembershipRole.OWNER, wsId);
      const adminAuth = createAuthContext(adminUserId, MembershipRole.ADMIN, wsId);

      const rule1 = await createAutomationRule(
        wsId,
        { name: "Owner Rule" },
        ownerAuth as any,
        prisma,
      );
      expect(rule1.id).toBeDefined();

      const rule2 = await createAutomationRule(
        wsId,
        { name: "Admin Rule" },
        adminAuth as any,
        prisma,
      );
      expect(rule2.id).toBeDefined();
    });

    it("MANAGER can view rules but CANNOT create, update, toggle, or delete", async () => {
      const mgrAuth = createAuthContext(managerUserId, MembershipRole.MANAGER, wsId);

      // Manager CAN list
      const list = await listAutomationRules(wsId, {}, mgrAuth as any, prisma);
      expect(list).toBeDefined();

      // Manager CANNOT create
      await expect(
        createAutomationRule(wsId, { name: "Mgr Blocked Rule" }, mgrAuth as any, prisma),
      ).rejects.toThrow(ForbiddenError);

      const rule = await createAutomationRule(wsId, { name: "Target For Mgr Test" }, undefined, prisma);

      // Manager CANNOT update
      await expect(
        updateAutomationRule(wsId, rule.id, { name: "Hacked" }, mgrAuth as any, prisma),
      ).rejects.toThrow(ForbiddenError);

      // Manager CANNOT toggle
      await expect(
        toggleAutomationRule(wsId, rule.id, false, mgrAuth as any, prisma),
      ).rejects.toThrow(ForbiddenError);

      // Manager CANNOT delete
      await expect(
        deleteAutomationRule(wsId, rule.id, mgrAuth as any, prisma),
      ).rejects.toThrow(ForbiddenError);
    });

    it("TECHNICIAN has ZERO access to automation management (Invariant 2)", async () => {
      const techAuth = createAuthContext(techUserId, MembershipRole.TECHNICIAN, wsId);

      await expect(
        listAutomationRules(wsId, {}, techAuth as any, prisma),
      ).rejects.toThrow(ForbiddenError);

      await expect(
        createAutomationRule(wsId, { name: "Tech Rule" }, techAuth as any, prisma),
      ).rejects.toThrow(ForbiddenError);
    });
  });

  // =========================================================================
  // 3. ENTITLEMENT DELEGATION (PHASE 1.15)
  // =========================================================================
  describe("3. Entitlement Delegation (Phase 1.15)", () => {
    it("should reject rule creation with PlanFeatureNotEnabledError when workspace lacks FEATURE_AUTOMATIONS", async () => {
      const auth = createAuthContext(ownerUserId, MembershipRole.OWNER, unentitledWsId);

      await expect(
        createAutomationRule(
          unentitledWsId,
          { name: "Unentitled Rule" },
          auth as any,
          prisma,
        ),
      ).rejects.toThrow(PlanFeatureNotEnabledError);
    });
  });

  // =========================================================================
  // 4. TENANT ISOLATION (INVARIANT 1)
  // =========================================================================
  describe("4. Tenant Isolation (Invariant 1)", () => {
    it("should reject fetching a rule from another workspace", async () => {
      const rule = await createAutomationRule(
        wsId,
        { name: "WS A Rule" },
        undefined,
        prisma,
      );

      // Attempt access from otherWsId
      await expect(
        getAutomationRule(otherWsId, rule.id, undefined, prisma),
      ).rejects.toThrow(AutomationRuleNotFoundError);
    });

    it("should reject updating or deleting a rule from another workspace", async () => {
      const rule = await createAutomationRule(
        wsId,
        { name: "WS A Rule" },
        undefined,
        prisma,
      );

      await expect(
        updateAutomationRule(otherWsId, rule.id, { name: "Cross Update" }, undefined, prisma),
      ).rejects.toThrow(AutomationRuleNotFoundError);

      await expect(
        deleteAutomationRule(otherWsId, rule.id, undefined, prisma),
      ).rejects.toThrow(AutomationRuleNotFoundError);
    });
  });

  // =========================================================================
  // 5. TEST RUNNER SERVICE
  // =========================================================================
  describe("5. Manual Test Run Service", () => {
    it("should execute rule manually with mock payload and return execution results", async () => {
      const handler = getActionHandler(AutomationActionType.NOTIFICATION_SEND_IN_APP);
      vi.spyOn(handler, "execute").mockResolvedValue({
        success: true,
        data: { outboxId: "outbox_test_run_1" },
        idempotencyKey: "test_idemp_key",
      });

      const auth = createAuthContext(managerUserId, MembershipRole.MANAGER, wsId);


      const rule = await createAutomationRule(
        wsId,
        {
          name: "Test Run Target",
          isEnabled: true,
          trigger: {
            triggerType: AutomationTriggerType.WORK_ORDER_CREATED,
            eventType: "work_order.created",
          },
          actions: [
            {
              stepOrder: 1,
              actionType: AutomationActionType.NOTIFICATION_SEND_IN_APP,
              paramsJson: {
                sourceEntity: "WorkOrder",
                sourceId: "wo_123",
                message: "Test in-app notification",
              },
            },
          ],
        },
        undefined,
        prisma,
      );

      const testResult = await testRunAutomationRule(
        wsId,
        rule.id,
        {
          payload: { customerId: "cust_test" },
        },
        auth as any,
        prisma,
      );

      expect(testResult.success).toBe(true);
      expect(testResult.ruleId).toBe(rule.id);
      expect(testResult.results).toHaveLength(1);
      expect(testResult.results[0].status).toBe(AutomationExecutionStatus.COMPLETED);
    });
  });


  // =========================================================================
  // 6. EXECUTION HISTORY & STEP TRACE INSPECTION
  // =========================================================================
  describe("6. Execution History & Step Trace Inspection", () => {
    it("should list execution history and retrieve detailed step execution traces", async () => {
      const auth = createAuthContext(managerUserId, MembershipRole.MANAGER, wsId);

      const rule = await createAutomationRule(
        wsId,
        { name: "Exec History Rule" },
        undefined,
        prisma,
      );

      const execution = await prisma.automationExecution.create({
        data: {
          workspaceId: wsId,
          ruleId: rule.id,
          status: AutomationExecutionStatus.COMPLETED,
          correlationId: `corr_trace_${Date.now()}`,
          causalityChain: [rule.id],
          triggerPayloadJson: { test: 123 },
          steps: {
            create: [
              {
                workspaceId: wsId,
                stepOrder: 1,
                actionType: AutomationActionType.NOTIFICATION_SEND_IN_APP,
                status: AutomationExecutionStepStatus.COMPLETED,
                outputJson: { outboxId: "out_1" },
                durationMs: 42,
              },
            ],
          },
        },
      });

      // List executions
      const list = await listAutomationExecutions(
        wsId,
        { ruleId: rule.id },
        auth as any,
        prisma,
      );
      expect(list.executions.length).toBeGreaterThanOrEqual(1);

      // Get execution detail
      const detail = await getAutomationExecution(wsId, execution.id, auth as any, prisma);
      expect(detail.id).toBe(execution.id);
      expect(detail.steps).toHaveLength(1);
      expect(detail.steps[0].status).toBe(AutomationExecutionStepStatus.COMPLETED);
    });
  });

  // =========================================================================
  // 7. SCHEDULE JOB MANAGEMENT SERVICES
  // =========================================================================
  describe("7. Schedule Job Management Services", () => {
    it("should list, toggle, and delete schedule jobs", async () => {
      const auth = createAuthContext(adminUserId, MembershipRole.ADMIN, wsId);

      const rule = await createAutomationRule(
        wsId,
        { name: "Sched Mgmt Rule" },
        undefined,
        prisma,
      );

      const job = await prisma.automationScheduleJob.create({
        data: {
          workspaceId: wsId,
          ruleId: rule.id,
          scheduleKind: "SCHEDULED_INTERVAL",
          intervalSeconds: 60,
          isActive: true,
        },
      });

      // List
      const list = await listAutomationScheduleJobs(
        wsId,
        { ruleId: rule.id },
        auth as any,
        prisma,
      );
      expect(list.jobs.length).toBeGreaterThanOrEqual(1);

      // Toggle
      const toggled = await toggleAutomationScheduleJob(
        wsId,
        job.id,
        false,
        auth as any,
        prisma,
      );
      expect(toggled.isActive).toBe(false);

      // Delete
      const del = await deleteAutomationScheduleJob(wsId, job.id, auth as any, prisma);
      expect(del.success).toBe(true);
    });
  });

  // =========================================================================
  // 8. REST API ROUTE HANDLERS
  // =========================================================================
  describe("8. REST API Route Handlers Integration", () => {
    it("GET & POST /api/automations/rules", async () => {
      hoistedMocks.auth.mockResolvedValue({
        user: { id: adminUserId },
      });

      // POST create
      const postReq = new Request("http://localhost/api/automations/rules", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": wsId },
        body: JSON.stringify({
          name: "API Created Rule",
          isEnabled: true,
          trigger: {
            triggerType: "WORK_ORDER_CREATED",
            eventType: "work_order.created",
          },
        }),
      });

      const postRes = await createRuleRoute(postReq);
      const postJson = await postRes.json();

      expect(postRes.status).toBe(201);
      expect(postJson.success).toBe(true);
      expect(postJson.data.name).toBe("API Created Rule");

      const createdRuleId = postJson.data.id;

      // GET list
      const getReq = new Request(`http://localhost/api/automations/rules?search=API`, {
        method: "GET",
        headers: { "x-workspace-id": wsId },
      });

      const getRes = await listRulesRoute(getReq);
      const getJson = await getRes.json();

      expect(getRes.status).toBe(200);
      expect(getJson.success).toBe(true);
      expect(getJson.data.rules.length).toBeGreaterThanOrEqual(1);

      // GET single rule
      const getSingleReq = new Request(`http://localhost/api/automations/rules/${createdRuleId}`, {
        method: "GET",
        headers: { "x-workspace-id": wsId },
      });
      const getSingleRes = await getRuleRoute(getSingleReq, {
        params: Promise.resolve({ ruleId: createdRuleId }),
      });
      const getSingleJson = await getSingleRes.json();
      expect(getSingleRes.status).toBe(200);
      expect(getSingleJson.data.id).toBe(createdRuleId);

      // PATCH update rule
      const patchReq = new Request(`http://localhost/api/automations/rules/${createdRuleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-workspace-id": wsId },
        body: JSON.stringify({ name: "API Renamed Rule" }),
      });
      const patchRes = await updateRuleRoute(patchReq, {
        params: Promise.resolve({ ruleId: createdRuleId }),
      });
      const patchJson = await patchRes.json();
      expect(patchRes.status).toBe(200);
      expect(patchJson.data.name).toBe("API Renamed Rule");

      // POST toggle
      const toggleReq = new Request(`http://localhost/api/automations/rules/${createdRuleId}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": wsId },
        body: JSON.stringify({ isEnabled: false }),
      });
      const toggleRes = await toggleRuleRoute(toggleReq, {
        params: Promise.resolve({ ruleId: createdRuleId }),
      });
      const toggleJson = await toggleRes.json();
      expect(toggleRes.status).toBe(200);
      expect(toggleJson.data.isEnabled).toBe(false);

      // POST test-run
      const testRunReq = new Request(`http://localhost/api/automations/rules/${createdRuleId}/test-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": wsId },
        body: JSON.stringify({ payload: { test: true } }),
      });
      const testRunRes = await testRunRuleRoute(testRunReq, {
        params: Promise.resolve({ ruleId: createdRuleId }),
      });
      const testRunJson = await testRunRes.json();
      expect(testRunRes.status).toBe(200);
      expect(testRunJson.success).toBe(true);

      // DELETE rule
      const delReq = new Request(`http://localhost/api/automations/rules/${createdRuleId}`, {
        method: "DELETE",
        headers: { "x-workspace-id": wsId },
      });
      const delRes = await deleteRuleRoute(delReq, {
        params: Promise.resolve({ ruleId: createdRuleId }),
      });
      const delJson = await delRes.json();
      expect(delRes.status).toBe(200);
      expect(delJson.data.deletedRuleId).toBe(createdRuleId);
    });

    it("GET /api/automations/executions and /api/automations/executions/[executionId]", async () => {
      hoistedMocks.auth.mockResolvedValue({
        user: { id: adminUserId },
      });

      const execution = await prisma.automationExecution.create({
        data: {
          workspaceId: wsId,
          status: AutomationExecutionStatus.COMPLETED,
          correlationId: `corr_api_${Date.now()}`,
          causalityChain: [],
          triggerPayloadJson: {},
        },
      });

      // GET list executions
      const listReq = new Request("http://localhost/api/automations/executions", {
        method: "GET",
        headers: { "x-workspace-id": wsId },
      });
      const listRes = await listExecutionsRoute(listReq);
      const listJson = await listRes.json();
      expect(listRes.status).toBe(200);
      expect(listJson.data.executions.length).toBeGreaterThanOrEqual(1);

      // GET single execution
      const getReq = new Request(`http://localhost/api/automations/executions/${execution.id}`, {
        method: "GET",
        headers: { "x-workspace-id": wsId },
      });
      const getRes = await getExecutionRoute(getReq, {
        params: Promise.resolve({ executionId: execution.id }),
      });
      const getJson = await getRes.json();
      expect(getRes.status).toBe(200);
      expect(getJson.data.id).toBe(execution.id);
    });

    it("GET, POST, PATCH, DELETE /api/automations/schedules", async () => {
      hoistedMocks.auth.mockResolvedValue({
        user: { id: adminUserId },
      });

      const rule = await createAutomationRule(
        wsId,
        { name: "Schedule API Rule" },
        undefined,
        prisma,
      );

      // POST register schedule
      const postReq = new Request("http://localhost/api/automations/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-workspace-id": wsId },
        body: JSON.stringify({
          ruleId: rule.id,
          scheduleKind: "SCHEDULED_INTERVAL",
          intervalSeconds: 120,
        }),
      });
      const postRes = await registerScheduleRoute(postReq);
      const postJson = await postRes.json();
      expect(postRes.status).toBe(201);
      expect(postJson.data.intervalSeconds).toBe(120);

      const jobId = postJson.data.id;

      // GET list schedules
      const getReq = new Request(`http://localhost/api/automations/schedules?ruleId=${rule.id}`, {
        method: "GET",
        headers: { "x-workspace-id": wsId },
      });
      const getRes = await listSchedulesRoute(getReq);
      const getJson = await getRes.json();
      expect(getRes.status).toBe(200);
      expect(getJson.data.jobs.length).toBeGreaterThanOrEqual(1);

      // PATCH update schedule
      const patchReq = new Request(`http://localhost/api/automations/schedules/${jobId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-workspace-id": wsId },
        body: JSON.stringify({ isActive: false }),
      });
      const patchRes = await updateScheduleRoute(patchReq, {
        params: Promise.resolve({ jobId }),
      });
      const patchJson = await patchRes.json();
      expect(patchRes.status).toBe(200);
      expect(patchJson.data.isActive).toBe(false);

      // DELETE schedule
      const delReq = new Request(`http://localhost/api/automations/schedules/${jobId}`, {
        method: "DELETE",
        headers: { "x-workspace-id": wsId },
      });
      const delRes = await deleteScheduleRoute(delReq, {
        params: Promise.resolve({ jobId }),
      });
      const delJson = await delRes.json();
      expect(delRes.status).toBe(200);
      expect(delJson.data.deletedJobId).toBe(jobId);
    });
  });
});
