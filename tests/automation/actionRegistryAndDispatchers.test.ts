/**
 * Phase 1.16.5 — Action Registry, Dispatcher Handlers & Parameter Resolution Unit Tests
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const hoistedMocks = vi.hoisted(() => ({
  auth: vi.fn(),
  requireWorkspaceAuthorization: vi.fn(),
  assertPermission: vi.fn(),
}));

vi.mock("@/auth", () => ({
  auth: hoistedMocks.auth,
}));

vi.mock("@/lib/auth", () => ({
  auth: hoistedMocks.auth,
}));

import {
  AutomationActionType,
  WorkOrderStatus,
  WorkOrderPriority,
  CustomerStatus,
  NotificationEventType,
} from "@/generated/prisma/client";
import {
  actionRegistry,
  getActionHandler,
  isActionTypeRegistered,
  getRegisteredActionTypes,
  executeAction,
} from "@/lib/services/automation/actionRegistry";
import {
  resolveActionParams,
  resolveTemplateString,
} from "@/lib/services/automation/actionParamResolver";
import {
  AutomationInvalidActionTypeError,
  AutomationActionParamValidationError,
} from "@/lib/services/automation/automationErrors";
import type { ActionExecutionContext } from "@/lib/services/automation/automation.types";

// Import mocked domain services
import * as workOrderService from "@/lib/services/workOrder";
import * as invoiceService from "@/lib/services/invoice";
import * as notificationService from "@/lib/services/notification";
import * as inventoryService from "@/lib/services/inventory";
import * as customerService from "@/lib/services/customer";
import * as scheduleService from "@/lib/services/schedule";

describe("Phase 1.16.5 — Action Registry & Domain Dispatcher Handlers", () => {
  const mockContext: ActionExecutionContext = {
    workspaceId: "ws_acme_123",
    correlationId: "corr_xyz_789",
    parentExecutionId: null,
    executionDepth: 1,
    causalityChain: ["rule_wo_assign"],
    actorMemberId: "usr_dispatcher_1",
    ruleId: "rule_wo_assign",
    ruleName: "Assign High Priority Work Order",
    executionId: "exec_555",
    stepOrder: 1,
    trigger: {
      type: "WORK_ORDER_CREATED",
      eventType: "work_order.created",
      sourceEntity: "WorkOrder",
      sourceId: "wo_999",
      payload: {
        workOrderId: "wo_999",
        workOrderNumber: "WO-2026-000999",
        customerId: "cust_777",
        customerName: "Acme Industries",
        locationId: "loc_888",
        workTypeId: "wt_electrical",
        priority: "URGENT",
        estimatedDuration: 120,
        amount: 450.75,
        isActive: true,
        items: [
          { sku: "WIRE-01", quantity: 10 },
          { sku: "FUSE-02", quantity: 2 },
        ],
      },
    },
    steps: {
      "1": {
        output: {
          createdWorkOrderId: "wo_step1_100",
          invoiceId: "inv_step1_200",
        },
      },
    },
    metadata: {
      environment: "production",
    },
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 1. ACTION REGISTRY & ALLOWLIST INTEGRITY
  // =========================================================================
  describe("1. Action Registry & Allowlist Integrity", () => {
    it("should register exactly all 11 allowlisted AutomationActionType values", () => {
      const registeredTypes = getRegisteredActionTypes();
      expect(registeredTypes).toHaveLength(11);

      const expectedTypes: AutomationActionType[] = [
        AutomationActionType.WORK_ORDER_CREATE,
        AutomationActionType.WORK_ORDER_UPDATE_STATUS,
        AutomationActionType.WORK_ORDER_ASSIGN_TECHNICIAN,
        AutomationActionType.WORK_ORDER_ADD_NOTE,
        AutomationActionType.INVOICE_CREATE_FROM_WORK_ORDER,
        AutomationActionType.INVOICE_ISSUE,
        AutomationActionType.NOTIFICATION_SEND_EMAIL,
        AutomationActionType.NOTIFICATION_SEND_IN_APP,
        AutomationActionType.INVENTORY_RESERVE_PARTS,
        AutomationActionType.CUSTOMER_UPDATE_STATUS,
        AutomationActionType.ASSET_SCHEDULE_MAINTENANCE,
      ];

      for (const expected of expectedTypes) {
        expect(registeredTypes).toContain(expected);
        expect(isActionTypeRegistered(expected)).toBe(true);
        const handler = getActionHandler(expected);
        expect(handler).toBeDefined();
        expect(handler.actionType).toBe(expected);
      }
    });

    it("should throw AutomationInvalidActionTypeError for unregistered / malicious action types", () => {
      expect(() => getActionHandler("ARBITRARY_CODE_EXECUTION")).toThrow(
        AutomationInvalidActionTypeError,
      );
      expect(() => getActionHandler("HTTP_WEBHOOK")).toThrow(
        AutomationInvalidActionTypeError,
      );
      expect(() => getActionHandler("")).toThrow(
        AutomationInvalidActionTypeError,
      );
      expect(isActionTypeRegistered("NON_EXISTENT")).toBe(false);
    });
  });

  // =========================================================================
  // 2. TEMPLATE PARAMETER RESOLVER
  // =========================================================================
  describe("2. Template Parameter Token Resolver", () => {
    it("should preserve scalar types for standalone template tokens", () => {
      // String
      expect(
        resolveActionParams("{{trigger.payload.customerId}}", mockContext),
      ).toBe("cust_777");

      // Number
      expect(
        resolveActionParams("{{trigger.payload.amount}}", mockContext),
      ).toBe(450.75);

      // Boolean
      expect(
        resolveActionParams("{{trigger.payload.isActive}}", mockContext),
      ).toBe(true);

      // Array / Object
      expect(
        resolveActionParams("{{trigger.payload.items}}", mockContext),
      ).toEqual([
        { sku: "WIRE-01", quantity: 10 },
        { sku: "FUSE-02", quantity: 2 },
      ]);
    });

    it("should interpolate embedded template tokens in strings", () => {
      const template =
        "Work Order {{trigger.payload.workOrderNumber}} for {{trigger.payload.customerName}} created with priority {{trigger.payload.priority}}";
      expect(resolveTemplateString(template, mockContext)).toBe(
        "Work Order WO-2026-000999 for Acme Industries created with priority URGENT",
      );
    });

    it("should resolve steps.N outputs correctly", () => {
      expect(
        resolveActionParams("{{steps.1.output.invoiceId}}", mockContext),
      ).toBe("inv_step1_200");
      expect(
        resolveActionParams("{{steps.1.createdWorkOrderId}}", mockContext),
      ).toBe("wo_step1_100");
    });

    it("should recursively resolve template tokens in nested objects and arrays", () => {
      const rawParams = {
        workOrderId: "{{trigger.payload.workOrderId}}",
        notes: "Automated note for {{trigger.payload.customerName}}",
        config: {
          priority: "{{trigger.payload.priority}}",
          duration: "{{trigger.payload.estimatedDuration}}",
          tags: ["urgent", "{{trigger.payload.workTypeId}}"],
        },
      };

      const resolved = resolveActionParams(rawParams, mockContext) as any;

      expect(resolved).toEqual({
        workOrderId: "wo_999",
        notes: "Automated note for Acme Industries",
        config: {
          priority: "URGENT",
          duration: 120,
          tags: ["urgent", "wt_electrical"],
        },
      });
    });

    it("should safely handle unresolved tokens", () => {
      expect(
        resolveActionParams("{{trigger.payload.nonExistent}}", mockContext),
      ).toBeUndefined();
      expect(
        resolveTemplateString("Hello {{trigger.payload.nonExistent}}!", mockContext),
      ).toBe("Hello !");
    });
  });

  // =========================================================================
  // 3. PER-HANDLER VALIDATION (ZOD)
  // =========================================================================
  describe("3. Per-Handler Zod Parameter Validation", () => {
    it("WORK_ORDER_CREATE — validates valid and invalid payloads", () => {
      const handler = getActionHandler(AutomationActionType.WORK_ORDER_CREATE);
      expect(
        handler.validateParams({
          customerId: "cust_1",
          locationId: "loc_1",
          workTypeId: "wt_1",
          title: "Fix HVAC",
        }),
      ).toEqual({
        customerId: "cust_1",
        locationId: "loc_1",
        workTypeId: "wt_1",
        title: "Fix HVAC",
        priority: WorkOrderPriority.MEDIUM,
      });

      expect(() =>
        handler.validateParams({
          customerId: "",
          title: "Fix HVAC",
        }),
      ).toThrow(AutomationActionParamValidationError);
    });

    it("WORK_ORDER_UPDATE_STATUS — validates valid and invalid payloads", () => {
      const handler = getActionHandler(AutomationActionType.WORK_ORDER_UPDATE_STATUS);
      expect(
        handler.validateParams({
          workOrderId: "wo_1",
          toStatus: WorkOrderStatus.IN_PROGRESS,
        }),
      ).toEqual({
        workOrderId: "wo_1",
        toStatus: WorkOrderStatus.IN_PROGRESS,
      });

      expect(() =>
        handler.validateParams({
          workOrderId: "wo_1",
          toStatus: "INVALID_STATUS",
        }),
      ).toThrow(AutomationActionParamValidationError);
    });

    it("WORK_ORDER_ASSIGN_TECHNICIAN — validates valid and invalid payloads", () => {
      const handler = getActionHandler(AutomationActionType.WORK_ORDER_ASSIGN_TECHNICIAN);
      expect(
        handler.validateParams({
          workOrderId: "wo_1",
          technicianId: "tech_1",
        }),
      ).toEqual({
        workOrderId: "wo_1",
        technicianId: "tech_1",
      });

      expect(() =>
        handler.validateParams({
          workOrderId: "wo_1",
          technicianId: "",
        }),
      ).toThrow(AutomationActionParamValidationError);
    });

    it("WORK_ORDER_ADD_NOTE — validates valid and invalid payloads", () => {
      const handler = getActionHandler(AutomationActionType.WORK_ORDER_ADD_NOTE);
      expect(
        handler.validateParams({
          workOrderId: "wo_1",
          note: "Followed up with customer",
        }),
      ).toEqual({
        workOrderId: "wo_1",
        note: "Followed up with customer",
      });

      expect(() =>
        handler.validateParams({
          workOrderId: "wo_1",
        }),
      ).toThrow(AutomationActionParamValidationError);
    });

    it("INVOICE_CREATE_FROM_WORK_ORDER — validates valid and invalid payloads", () => {
      const handler = getActionHandler(AutomationActionType.INVOICE_CREATE_FROM_WORK_ORDER);
      expect(
        handler.validateParams({
          workOrderId: "wo_1",
          paymentTermsDays: 15,
        }),
      ).toEqual({
        workOrderId: "wo_1",
        paymentTermsDays: 15,
      });

      expect(() =>
        handler.validateParams({
          workOrderId: "",
        }),
      ).toThrow(AutomationActionParamValidationError);
    });

    it("INVOICE_ISSUE — validates valid and invalid payloads", () => {
      const handler = getActionHandler(AutomationActionType.INVOICE_ISSUE);
      expect(
        handler.validateParams({
          invoiceId: "inv_1",
        }),
      ).toEqual({
        invoiceId: "inv_1",
      });

      expect(() =>
        handler.validateParams({
          invoiceId: "",
        }),
      ).toThrow(AutomationActionParamValidationError);
    });

    it("NOTIFICATION_SEND_EMAIL — validates valid and invalid payloads", () => {
      const handler = getActionHandler(AutomationActionType.NOTIFICATION_SEND_EMAIL);
      const validated = handler.validateParams({
        recipientEmail: "client@acme.com",
        subject: "Invoice Ready",
      });
      expect(validated.recipientEmail).toBe("client@acme.com");
      expect(validated.subject).toBe("Invoice Ready");
    });

    it("NOTIFICATION_SEND_IN_APP — validates valid and invalid payloads", () => {
      const handler = getActionHandler(AutomationActionType.NOTIFICATION_SEND_IN_APP);
      const validated = handler.validateParams({
        recipientMemberId: "mem_1",
        title: "Work Order Assigned",
      });
      expect(validated.recipientMemberId).toBe("mem_1");
      expect(validated.title).toBe("Work Order Assigned");
    });

    it("INVENTORY_RESERVE_PARTS — validates valid and invalid payloads", () => {
      const handler = getActionHandler(AutomationActionType.INVENTORY_RESERVE_PARTS);
      expect(
        handler.validateParams({
          partId: "part_1",
          locationId: "loc_1",
          quantity: 5,
        }),
      ).toEqual({
        partId: "part_1",
        locationId: "loc_1",
        quantity: 5,
      });

      expect(() =>
        handler.validateParams({
          partId: "part_1",
          locationId: "loc_1",
          quantity: -1,
        }),
      ).toThrow(AutomationActionParamValidationError);
    });

    it("CUSTOMER_UPDATE_STATUS — validates valid and invalid payloads", () => {
      const handler = getActionHandler(AutomationActionType.CUSTOMER_UPDATE_STATUS);
      expect(
        handler.validateParams({
          customerId: "cust_1",
          status: CustomerStatus.ACTIVE,
        }),
      ).toEqual({
        customerId: "cust_1",
        status: CustomerStatus.ACTIVE,
      });

      expect(() =>
        handler.validateParams({
          customerId: "cust_1",
          status: "ARCHIVED",
        }),
      ).toThrow(AutomationActionParamValidationError);
    });

    it("ASSET_SCHEDULE_MAINTENANCE — validates valid and invalid payloads", () => {
      const handler = getActionHandler(AutomationActionType.ASSET_SCHEDULE_MAINTENANCE);
      expect(
        handler.validateParams({
          workOrderId: "wo_1",
          technicianId: "tech_1",
          start: "2026-09-01T09:00:00Z",
          end: "2026-09-01T11:00:00Z",
        }),
      ).toEqual({
        workOrderId: "wo_1",
        technicianId: "tech_1",
        start: "2026-09-01T09:00:00Z",
        end: "2026-09-01T11:00:00Z",
      });

      expect(() =>
        handler.validateParams({
          workOrderId: "wo_1",
          technicianId: "tech_1",
          start: "",
          end: "2026-09-01T11:00:00Z",
        }),
      ).toThrow(AutomationActionParamValidationError);
    });
  });

  // =========================================================================
  // 4. IDEMPOTENCY KEY COMPUTATION
  // =========================================================================
  describe("4. Idempotency Key Computation (Invariant 5 Tier 3)", () => {
    it("should compute deterministic 64-char SHA256 hex idempotency keys across all 11 handlers", () => {
      const handlers = getRegisteredActionTypes().map((type) => getActionHandler(type));

      for (const handler of handlers) {
        const dummyParams: any = {
          customerId: "cust_1",
          locationId: "loc_1",
          workTypeId: "wt_1",
          title: "Test",
          workOrderId: "wo_1",
          toStatus: WorkOrderStatus.ASSIGNED,
          technicianId: "tech_1",
          note: "Note text",
          internalNotes: "Internal note",
          paymentTermsDays: 30,
          invoiceId: "inv_1",
          sourceEntity: "WorkOrder",
          sourceId: "wo_1",
          recipientEmail: "test@test.com",
          recipientMemberId: "usr_1",
          partId: "part_1",
          quantity: 2,
          status: CustomerStatus.ACTIVE,
          start: "2026-09-01T09:00:00Z",
          end: "2026-09-01T11:00:00Z",
        };

        const key1 = handler.computeIdempotencyKey(dummyParams, mockContext);
        const key2 = handler.computeIdempotencyKey(dummyParams, mockContext);

        expect(key1).toHaveLength(64);
        expect(key1).toBe(key2);

        // Different workspace -> different key
        const keyDiffWorkspace = handler.computeIdempotencyKey(dummyParams, {
          ...mockContext,
          workspaceId: "ws_other_999",
        });
        expect(keyDiffWorkspace).not.toBe(key1);
      }
    });
  });

  // =========================================================================
  // 5. DOMAIN SERVICE EXECUTION & DISPATCH (ALL 11 HANDLERS)
  // =========================================================================
  describe("5. All 11 Action Handlers Dispatch to Real Domain Services", () => {
    // 1. WORK_ORDER_CREATE -> createWorkOrder
    it("1. WORK_ORDER_CREATE invokes createWorkOrder domain service", async () => {
      const mockResult: any = { id: "wo_created_1", workOrderNumber: "WO-2026-0001" };
      vi.spyOn(workOrderService, "createWorkOrder").mockResolvedValue(mockResult);

      const handler = getActionHandler(AutomationActionType.WORK_ORDER_CREATE);
      const params = handler.validateParams({
        customerId: "cust_1",
        locationId: "loc_1",
        workTypeId: "wt_1",
        title: "Emergency Repair",
      });

      const res = await handler.execute(mockContext, params);
      expect(res.success).toBe(true);
      expect(res.data).toEqual(mockResult);
      expect(res.idempotencyKey).toBeDefined();
      expect(workOrderService.createWorkOrder).toHaveBeenCalledWith(
        mockContext.workspaceId,
        params,
        mockContext.actorContext,
        mockContext.prismaTx,
      );
    });

    // 2. WORK_ORDER_UPDATE_STATUS -> transitionWorkOrderStatus
    it("2. WORK_ORDER_UPDATE_STATUS invokes transitionWorkOrderStatus domain service", async () => {
      const mockResult: any = { id: "wo_1", status: WorkOrderStatus.IN_PROGRESS };
      vi.spyOn(workOrderService, "transitionWorkOrderStatus").mockResolvedValue(mockResult);

      const handler = getActionHandler(AutomationActionType.WORK_ORDER_UPDATE_STATUS);
      const params = handler.validateParams({
        workOrderId: "wo_1",
        toStatus: WorkOrderStatus.IN_PROGRESS,
        holdReason: null,
      });

      const res = await handler.execute(mockContext, params);
      expect(res.success).toBe(true);
      expect(res.data).toEqual(mockResult);
      expect(workOrderService.transitionWorkOrderStatus).toHaveBeenCalledWith(
        mockContext.workspaceId,
        "wo_1",
        {
          toStatus: WorkOrderStatus.IN_PROGRESS,
          holdReason: undefined,
          cancellationReason: undefined,
        },
        mockContext.prismaTx,
      );
    });

    // 3. WORK_ORDER_ASSIGN_TECHNICIAN -> assignWorkOrder
    it("3. WORK_ORDER_ASSIGN_TECHNICIAN invokes assignWorkOrder domain service", async () => {
      const mockResult: any = { id: "wo_1", assignedTechnicianId: "tech_99" };
      vi.spyOn(workOrderService, "assignWorkOrder").mockResolvedValue(mockResult);

      const handler = getActionHandler(AutomationActionType.WORK_ORDER_ASSIGN_TECHNICIAN);
      const params = handler.validateParams({
        workOrderId: "wo_1",
        technicianId: "tech_99",
      });

      const res = await handler.execute(mockContext, params);
      expect(res.success).toBe(true);
      expect(res.data).toEqual(mockResult);
      expect(workOrderService.assignWorkOrder).toHaveBeenCalledWith(
        mockContext.workspaceId,
        "wo_1",
        { technicianId: "tech_99" },
        mockContext.actorContext,
        mockContext.prismaTx,
      );
    });

    // 4. WORK_ORDER_ADD_NOTE -> updateWorkOrder
    it("4. WORK_ORDER_ADD_NOTE invokes updateWorkOrder domain service", async () => {
      const mockResult: any = { id: "wo_1", internalNotes: "Automated inspection note" };
      vi.spyOn(workOrderService, "updateWorkOrder").mockResolvedValue(mockResult);

      const handler = getActionHandler(AutomationActionType.WORK_ORDER_ADD_NOTE);
      const params = handler.validateParams({
        workOrderId: "wo_1",
        note: "Automated inspection note",
      });

      const res = await handler.execute(mockContext, params);
      expect(res.success).toBe(true);
      expect(res.data).toEqual(mockResult);
      expect(workOrderService.updateWorkOrder).toHaveBeenCalledWith(
        mockContext.workspaceId,
        "wo_1",
        { internalNotes: "Automated inspection note" },
      );
    });

    // 5. INVOICE_CREATE_FROM_WORK_ORDER -> createInvoiceFromWorkOrder
    it("5. INVOICE_CREATE_FROM_WORK_ORDER invokes createInvoiceFromWorkOrder domain service", async () => {
      const mockResult: any = { id: "inv_1", invoiceNumber: "INV-2026-0001", totalAmount: 500 };
      vi.spyOn(invoiceService, "createInvoiceFromWorkOrder").mockResolvedValue(mockResult);

      const handler = getActionHandler(AutomationActionType.INVOICE_CREATE_FROM_WORK_ORDER);
      const params = handler.validateParams({
        workOrderId: "wo_1",
        paymentTermsDays: 30,
        notes: "Work completed successfully",
      });

      const res = await handler.execute(mockContext, params);
      expect(res.success).toBe(true);
      expect(res.data).toEqual(mockResult);
      expect(invoiceService.createInvoiceFromWorkOrder).toHaveBeenCalledWith(
        mockContext.workspaceId,
        "wo_1",
        { paymentTermsDays: 30, notes: "Work completed successfully" },
        mockContext.actorContext,
      );
    });

    // 6. INVOICE_ISSUE -> issueInvoice
    it("6. INVOICE_ISSUE invokes issueInvoice domain service", async () => {
      const mockResult: any = { id: "inv_1", status: "ISSUED" };
      vi.spyOn(invoiceService, "issueInvoice").mockResolvedValue(mockResult);

      const handler = getActionHandler(AutomationActionType.INVOICE_ISSUE);
      const params = handler.validateParams({
        invoiceId: "inv_1",
      });

      const res = await handler.execute(mockContext, params);
      expect(res.success).toBe(true);
      expect(res.data).toEqual(mockResult);
      expect(invoiceService.issueInvoice).toHaveBeenCalledWith(
        mockContext.workspaceId,
        "inv_1",
        mockContext.actorContext,
      );
    });

    // 7. NOTIFICATION_SEND_EMAIL -> emitNotificationEvent
    it("7. NOTIFICATION_SEND_EMAIL invokes emitNotificationEvent domain service", async () => {
      const mockResult: any = { id: "outbox_1", status: "PENDING" };
      vi.spyOn(notificationService, "emitNotificationEvent").mockResolvedValue(mockResult);

      const handler = getActionHandler(AutomationActionType.NOTIFICATION_SEND_EMAIL);
      const params = handler.validateParams({
        sourceEntity: "WorkOrder",
        sourceId: "wo_1",
        recipientEmail: "client@test.com",
        subject: "Status Update",
      });

      const res = await handler.execute(mockContext, params);
      expect(res.success).toBe(true);
      expect(res.data).toEqual(mockResult);
      expect(notificationService.emitNotificationEvent).toHaveBeenCalled();
    });

    // 8. NOTIFICATION_SEND_IN_APP -> emitNotificationEvent
    it("8. NOTIFICATION_SEND_IN_APP invokes emitNotificationEvent domain service", async () => {
      const mockResult: any = { id: "outbox_2", status: "PENDING" };
      vi.spyOn(notificationService, "emitNotificationEvent").mockResolvedValue(mockResult);

      const handler = getActionHandler(AutomationActionType.NOTIFICATION_SEND_IN_APP);
      const params = handler.validateParams({
        sourceEntity: "WorkOrder",
        sourceId: "wo_1",
        recipientMemberId: "usr_dispatcher",
        title: "Dispatch Alert",
      });

      const res = await handler.execute(mockContext, params);
      expect(res.success).toBe(true);
      expect(res.data).toEqual(mockResult);
      expect(notificationService.emitNotificationEvent).toHaveBeenCalled();
    });

    // 9. INVENTORY_RESERVE_PARTS -> reserveStock
    it("9. INVENTORY_RESERVE_PARTS invokes reserveStock domain service", async () => {
      const mockResult: any = { balanceId: "bal_1", quantityReserved: 5 };
      vi.spyOn(inventoryService, "reserveStock").mockResolvedValue(mockResult);

      const handler = getActionHandler(AutomationActionType.INVENTORY_RESERVE_PARTS);
      const params = handler.validateParams({
        partId: "part_1",
        locationId: "loc_1",
        quantity: 5,
        workOrderId: "wo_1",
      });

      const res = await handler.execute(mockContext, params);
      expect(res.success).toBe(true);
      expect(res.data).toEqual(mockResult);
      expect(inventoryService.reserveStock).toHaveBeenCalledWith(
        mockContext.workspaceId,
        params,
      );
    });

    // 10. CUSTOMER_UPDATE_STATUS -> changeCustomerStatus
    it("10. CUSTOMER_UPDATE_STATUS invokes changeCustomerStatus domain service", async () => {
      const mockResult: any = { id: "cust_1", status: CustomerStatus.ACTIVE };
      vi.spyOn(customerService, "changeCustomerStatus").mockResolvedValue(mockResult);

      const handler = getActionHandler(AutomationActionType.CUSTOMER_UPDATE_STATUS);
      const params = handler.validateParams({
        customerId: "cust_1",
        status: CustomerStatus.ACTIVE,
        reason: "Account reactivated by automation",
      });

      const res = await handler.execute(mockContext, params);
      expect(res.success).toBe(true);
      expect(res.data).toEqual(mockResult);
      expect(customerService.changeCustomerStatus).toHaveBeenCalledWith(
        mockContext.workspaceId,
        "cust_1",
        CustomerStatus.ACTIVE,
        "Account reactivated by automation",
      );
    });

    // 11. ASSET_SCHEDULE_MAINTENANCE -> createSchedule
    it("11. ASSET_SCHEDULE_MAINTENANCE invokes createSchedule domain service", async () => {
      const mockResult: any = { id: "apt_1", appointmentNumber: "APT-2026-0001" };
      vi.spyOn(scheduleService, "createSchedule").mockResolvedValue(mockResult);

      const handler = getActionHandler(AutomationActionType.ASSET_SCHEDULE_MAINTENANCE);
      const params = handler.validateParams({
        workOrderId: "wo_1",
        technicianId: "tech_1",
        start: "2026-09-01T09:00:00Z",
        end: "2026-09-01T11:00:00Z",
        title: "Routine Maintenance",
      });

      const res = await handler.execute(mockContext, params);
      expect(res.success).toBe(true);
      expect(res.data).toEqual(mockResult);
      expect(scheduleService.createSchedule).toHaveBeenCalledWith(
        mockContext.workspaceId,
        {
          workOrderId: "wo_1",
          technicianId: "tech_1",
          start: "2026-09-01T09:00:00Z",
          end: "2026-09-01T11:00:00Z",
          timezone: undefined,
          title: "Routine Maintenance",
          notes: undefined,
        },
      );
    });
  });

  // =========================================================================
  // 6. ERROR ISOLATION & FAILURE HANDLING (INVARIANT 6)
  // =========================================================================
  describe("6. Error Isolation & Failure Handling", () => {
    it("should capture domain service exception and return structured failed ActionResult", async () => {
      vi.spyOn(workOrderService, "assignWorkOrder").mockRejectedValue(
        new Error("Technician profile not found in workspace"),
      );

      const handler = getActionHandler(AutomationActionType.WORK_ORDER_ASSIGN_TECHNICIAN);
      const params = handler.validateParams({
        workOrderId: "wo_1",
        technicianId: "tech_invalid",
      });

      const res = await handler.execute(mockContext, params);
      expect(res.success).toBe(false);
      expect(res.error).toBeDefined();
      expect(res.error?.message).toBe("Technician profile not found in workspace");
      expect(res.idempotencyKey).toBeDefined();
    });
  });

  // =========================================================================
  // 7. END-TO-END DISPATCHER & CONCRETE TRACE-THROUGH
  // =========================================================================
  describe("7. End-to-End executeAction & Concrete Trace-Through", () => {
    it("WORK_ORDER_ASSIGN_TECHNICIAN trace-through: resolves template tokens, validates, and calls assignWorkOrder", async () => {
      const mockResult: any = {
        id: "wo_999",
        workOrderNumber: "WO-2026-000999",
        assignedTechnicianId: "tech_on_call_77",
        status: WorkOrderStatus.ASSIGNED,
      };
      const assignSpy = vi.spyOn(workOrderService, "assignWorkOrder").mockResolvedValue(mockResult);

      const rawActionParams = {
        workOrderId: "{{trigger.payload.workOrderId}}",
        technicianId: "tech_on_call_77",
      };

      const result = await executeAction(
        AutomationActionType.WORK_ORDER_ASSIGN_TECHNICIAN,
        rawActionParams,
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResult);

      // Verify assignWorkOrder received the resolved workOrderId and static technicianId
      expect(assignSpy).toHaveBeenCalledTimes(1);
      expect(assignSpy).toHaveBeenCalledWith(
        mockContext.workspaceId,
        "wo_999", // Resolved from {{trigger.payload.workOrderId}}
        { technicianId: "tech_on_call_77" }, // Static value
        mockContext.actorContext,
        mockContext.prismaTx,
      );
    });

    it("executeAction throws AutomationActionParamValidationError if resolved parameter is invalid", async () => {
      const rawActionParams = {
        workOrderId: "{{trigger.payload.nonExistentId}}", // Resolves to undefined
        technicianId: "tech_1",
      };

      await expect(
        executeAction(
          AutomationActionType.WORK_ORDER_ASSIGN_TECHNICIAN,
          rawActionParams,
          mockContext,
        ),
      ).rejects.toThrow(AutomationActionParamValidationError);
    });
  });
});
