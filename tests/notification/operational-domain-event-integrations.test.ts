import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    requireWorkspaceAuthorization: vi.fn(),
    assertPermission: vi.fn(),
    checkTechnicianAvailability: vi.fn(),
    assertTechnicianActive: vi.fn(),
    assertNoTechnicianConflicts: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/services/authorization/workspaceAuthorization", () => ({
    requireWorkspaceAuthorization: mocks.requireWorkspaceAuthorization,
}));

vi.mock("@/lib/services/authorization/permissionService", () => ({
    assertPermission: mocks.assertPermission,
}));

vi.mock("@/lib/services/schedule/checkTechnicianAvailability", () => ({
    checkTechnicianAvailability: mocks.checkTechnicianAvailability,
}));

vi.mock("@/lib/services/schedule/conflictDetection", () => ({
    assertTechnicianActive: mocks.assertTechnicianActive,
    assertNoTechnicianConflicts: mocks.assertNoTechnicianConflicts,
}));

import { NotificationEventType, NotificationOutboxStatus, Prisma } from "@/generated/prisma/client";
import { createWorkOrder } from "@/lib/services/workOrder/createWorkOrder";
import { assignWorkOrder, reassignWorkOrder, unassignWorkOrder } from "@/lib/services/workOrder/assignWorkOrder";
import { transitionWorkOrderStatus } from "@/lib/services/workOrder/transitionWorkOrderStatus";
import { createSchedule } from "@/lib/services/schedule/createSchedule";
import { createQuote } from "@/lib/services/quote/createQuote";
import { recordPayment } from "@/lib/services/invoice/recordPayment";
import { prisma } from "@/lib/prisma";

describe("Phase 1.13.9 — Operational Domain Event Integrations & Invariants", () => {
    const WS_ID = "ws_test_139";
    const MEMBER_ID = "member_actor_139";

    const mockAuthContext = {
        user: { id: "user_139", name: "Agent Dispatcher", email: "agent@aforden.com" },
        workspace: { id: WS_ID, timezone: "America/New_York", defaultCurrencyCode: "USD" },
        membership: { id: MEMBER_ID, userId: "user_139", workspaceId: WS_ID, role: "ADMIN", status: "ACTIVE" },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.requireWorkspaceAuthorization.mockResolvedValue(mockAuthContext as any);
        mocks.assertPermission.mockReturnValue(undefined);
    });

    describe("1. WorkOrder Lifecycle Event Emissions", () => {
        it("emits WORK_ORDER_CREATED on createWorkOrder", async () => {
            const outboxRows: any[] = [];
            const mockTx: any = {
                customer: {
                    findFirst: vi.fn().mockResolvedValue({ id: "cust_1", workspaceId: WS_ID, name: "Acme Corp", status: "ACTIVE" }),
                },
                serviceLocation: {
                    findFirst: vi.fn().mockResolvedValue({ id: "loc_1", customerId: "cust_1", name: "HQ", addressLine1: "123 Main" }),
                },
                workType: {
                    findFirst: vi.fn().mockResolvedValue({
                        id: "wt_1",
                        workspaceId: WS_ID,
                        name: "HVAC Repair",
                        code: "HVAC",
                        estimatedDuration: 60,
                        status: "ACTIVE",
                        catalog: { status: "ACTIVE" },
                        catalogItem: { id: "ci_1", code: "HVAC", name: "HVAC", unitPrice: 100, isLabor: true },
                    }),
                },
                workOrder: {
                    findFirst: vi.fn().mockResolvedValue({ workOrderNumber: "WO-2026-000001" }),
                    create: vi.fn().mockResolvedValue({
                        id: "wo_1",
                        workspaceId: WS_ID,
                        workOrderNumber: "WO-2026-000002",
                        title: "Fix AC",
                        customerId: "cust_1",
                        locationId: "loc_1",
                        workTypeId: "wt_1",
                        priority: "HIGH",
                        status: "OPEN",
                        customer: { name: "Acme Corp", customerNumber: "CUST-001" },
                        location: { name: "HQ", addressLine1: "123 Main" },
                        workType: { name: "HVAC Repair", code: "HVAC" },
                    }),
                },
                workOrderHistory: { create: vi.fn().mockResolvedValue({ id: "woh_1" }) },
                notificationOutbox: {
                    findFirst: vi.fn().mockResolvedValue(null),
                    create: vi.fn().mockImplementation(({ data }) => {
                        outboxRows.push(data);
                        return { id: "outbox_1", ...data, createdAt: new Date() };
                    }),
                },
            };

            vi.spyOn(prisma.customer, "findFirst").mockResolvedValue({ id: "cust_1", workspaceId: WS_ID, name: "Acme Corp", status: "ACTIVE" } as any);
            vi.spyOn(prisma.serviceLocation, "findFirst").mockResolvedValue({ id: "loc_1", customerId: "cust_1", name: "HQ", addressLine1: "123 Main" } as any);
            vi.spyOn(prisma.workType, "findFirst").mockResolvedValue({
                id: "wt_1",
                workspaceId: WS_ID,
                name: "HVAC Repair",
                code: "HVAC",
                estimatedDuration: 60,
                status: "ACTIVE",
                catalog: { status: "ACTIVE" },
                catalogItem: { id: "ci_1", code: "HVAC", name: "HVAC", unitPrice: 100, isLabor: true },
            } as any);
            vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(mockTx));

            const result = await createWorkOrder(
                WS_ID,
                {
                    customerId: "cust_1",
                    locationId: "loc_1",
                    workTypeId: "wt_1",
                    title: "Fix AC",
                    priority: "HIGH",
                },
                mockAuthContext as any,
                mockTx,
            );

            expect(result.id).toBe("wo_1");
            expect(outboxRows.length).toBe(1);
            expect(outboxRows[0].eventType).toBe(NotificationEventType.WORK_ORDER_CREATED);
            expect(outboxRows[0].sourceEntity).toBe("WorkOrder");
            expect(outboxRows[0].sourceId).toBe("wo_1");
            expect(outboxRows[0].actorMemberId).toBe(MEMBER_ID);
            expect(outboxRows[0].payload.workOrderNumber).toBe("WO-2026-000002");
        });

        it("emits WORK_ORDER_ASSIGNED, REASSIGNED, and UNASSIGNED", async () => {
            const outboxRows: any[] = [];
            const mockTx: any = {
                workOrder: {
                    findFirst: vi.fn().mockResolvedValue({
                        id: "wo_1",
                        workspaceId: WS_ID,
                        workOrderNumber: "WO-2026-000001",
                        title: "Fix AC",
                        customerId: "cust_1",
                        locationId: "loc_1",
                        workTypeId: "wt_1",
                        status: "OPEN",
                        assignedTechnicianId: null,
                        priority: "HIGH",
                        customer: { name: "Acme Corp", customerNumber: "CUST-001" },
                        location: { name: "HQ", addressLine1: "123 Main" },
                        workType: { name: "HVAC Repair", code: "HVAC" },
                    }),
                    update: vi.fn().mockResolvedValue({
                        id: "wo_1",
                        workspaceId: WS_ID,
                        workOrderNumber: "WO-2026-000001",
                        title: "Fix AC",
                        customerId: "cust_1",
                        locationId: "loc_1",
                        workTypeId: "wt_1",
                        status: "OPEN",
                        assignedTechnicianId: "tech_1",
                        priority: "HIGH",
                        customer: { name: "Acme Corp", customerNumber: "CUST-001" },
                        location: { name: "HQ", addressLine1: "123 Main" },
                        workType: { name: "HVAC Repair", code: "HVAC" },
                    }),
                },
                technicianProfile: {
                    findFirst: vi.fn().mockResolvedValue({
                        id: "tech_1",
                        employee: { workspaceId: WS_ID, status: "ACTIVE", displayName: "John Tech", employeeNumber: "EMP-01" },
                    }),
                },
                workOrderHistory: { create: vi.fn().mockResolvedValue({ id: "woh_1" }) },
                notificationOutbox: {
                    findFirst: vi.fn().mockResolvedValue(null),
                    create: vi.fn().mockImplementation(({ data }) => {
                        outboxRows.push(data);
                        return { id: "outbox_2", ...data, createdAt: new Date() };
                    }),
                },
            };

            vi.spyOn(prisma.workOrder, "findFirst").mockImplementation(mockTx.workOrder.findFirst);
            vi.spyOn(prisma.technicianProfile, "findFirst").mockImplementation(mockTx.technicianProfile.findFirst);
            vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(mockTx));

            await assignWorkOrder(WS_ID, "wo_1", { technicianId: "tech_1" }, mockAuthContext as any, mockTx);
            expect(outboxRows[0].eventType).toBe(NotificationEventType.WORK_ORDER_ASSIGNED);

            // Reassign
            mockTx.workOrder.findFirst.mockResolvedValue({
                id: "wo_1",
                workspaceId: WS_ID,
                workOrderNumber: "WO-2026-000001",
                title: "Fix AC",
                customerId: "cust_1",
                locationId: "loc_1",
                workTypeId: "wt_1",
                status: "ASSIGNED",
                assignedTechnicianId: "tech_1",
                priority: "HIGH",
                customer: { name: "Acme Corp" },
                location: { name: "HQ" },
                workType: { name: "HVAC" },
            });
            mockTx.technicianProfile.findFirst.mockResolvedValue({
                id: "tech_2",
                employee: { workspaceId: WS_ID, status: "ACTIVE", displayName: "Alice Tech", employeeNumber: "EMP-02" },
            });
            await reassignWorkOrder(WS_ID, "wo_1", { technicianId: "tech_2" });
            expect(outboxRows[1].eventType).toBe(NotificationEventType.WORK_ORDER_REASSIGNED);
            expect(outboxRows[1].payload.previousTechnicianId).toBe("tech_1");
            expect(outboxRows[1].payload.newTechnicianId).toBe("tech_2");

            // Unassign
            mockTx.workOrder.findFirst.mockResolvedValue({
                id: "wo_1",
                workspaceId: WS_ID,
                workOrderNumber: "WO-2026-000001",
                title: "Fix AC",
                customerId: "cust_1",
                locationId: "loc_1",
                workTypeId: "wt_1",
                status: "ASSIGNED",
                assignedTechnicianId: "tech_2",
                priority: "HIGH",
                customer: { name: "Acme Corp" },
                location: { name: "HQ" },
                workType: { name: "HVAC" },
            });
            await unassignWorkOrder(WS_ID, "wo_1");
            expect(outboxRows[2].eventType).toBe(NotificationEventType.WORK_ORDER_UNASSIGNED);
        });

        it("emits WORK_ORDER_COMPLETED on status transition", async () => {
            const outboxRows: any[] = [];
            const mockTx: any = {
                workOrder: {
                    findFirst: vi.fn().mockResolvedValue({
                        id: "wo_1",
                        workspaceId: WS_ID,
                        workOrderNumber: "WO-2026-000001",
                        title: "Fix AC",
                        customerId: "cust_1",
                        locationId: "loc_1",
                        workTypeId: "wt_1",
                        status: "IN_PROGRESS",
                        assignedTechnicianId: "tech_1",
                        priority: "HIGH",
                        customer: { name: "Acme Corp" },
                        location: { name: "HQ" },
                        workType: { name: "HVAC" },
                    }),
                    update: vi.fn().mockResolvedValue({
                        id: "wo_1",
                        workspaceId: WS_ID,
                        workOrderNumber: "WO-2026-000001",
                        title: "Fix AC",
                        customerId: "cust_1",
                        locationId: "loc_1",
                        workTypeId: "wt_1",
                        status: "COMPLETED",
                        assignedTechnicianId: "tech_1",
                        priority: "HIGH",
                        customer: { name: "Acme Corp" },
                        location: { name: "HQ" },
                        workType: { name: "HVAC" },
                    }),
                },
                workOrderHistory: { create: vi.fn().mockResolvedValue({ id: "woh_1" }) },
                notificationOutbox: {
                    findFirst: vi.fn().mockResolvedValue(null),
                    create: vi.fn().mockImplementation(({ data }) => {
                        outboxRows.push(data);
                        return { id: "outbox_stat", ...data, createdAt: new Date() };
                    }),
                },
            };

            vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(mockTx));

            await transitionWorkOrderStatus(
                WS_ID,
                "wo_1",
                { toStatus: "COMPLETED" },
                mockTx,
            );

            expect(outboxRows.length).toBe(1);
            expect(outboxRows[0].eventType).toBe(NotificationEventType.WORK_ORDER_COMPLETED);
            expect(outboxRows[0].payload.workOrderNumber).toBe("WO-2026-000001");
            expect(outboxRows[0].payload.customerName).toBe("Acme Corp");
        });
    });

    describe("2. Scheduling Lifecycle Event Emissions", () => {
        it("emits SCHEDULE_APPOINTMENT_SCHEDULED", async () => {
            const outboxRows: any[] = [];
            const mockTx: any = {
                workOrder: {
                    findFirst: vi.fn().mockResolvedValue({
                        id: "wo_1",
                        workspaceId: WS_ID,
                        workOrderNumber: "WO-001",
                        status: "ASSIGNED",
                        assignedTechnicianId: "tech_1",
                        customerId: "cust_1",
                    }),
                },
                technicianProfile: {
                    findFirst: vi.fn().mockResolvedValue({
                        id: "tech_1",
                        workspaceId: WS_ID,
                        employee: { status: "ACTIVE", displayName: "Sam Tech" },
                    }),
                },
                scheduleAppointment: {
                    findFirst: vi.fn().mockResolvedValue(null),
                    create: vi.fn().mockResolvedValue({
                        id: "appt_1",
                        workspaceId: WS_ID,
                        appointmentNumber: "APT-2026-000001",
                        workOrderId: "wo_1",
                        technicianId: "tech_1",
                        scheduledStart: new Date("2026-08-25T14:00:00.000Z"),
                        scheduledEnd: new Date("2026-08-25T16:00:00.000Z"),
                        status: "SCHEDULED",
                        dispatchStatus: "PENDING_DISPATCH",
                        workOrder: {
                            workOrderNumber: "WO-001",
                            customerId: "cust_1",
                            customer: { name: "Acme", customerNumber: "CUST-001" },
                            location: { addressLine1: "123 Main", addressLine2: null, city: "City", state: "NY", postalCode: "10001" },
                            workType: { name: "HVAC", code: "HVAC" },
                        },
                        technician: { employee: { displayName: "Sam Tech" } },
                    }),
                },
                scheduleAppointmentHistory: { create: vi.fn().mockResolvedValue({ id: "sh_1" }) },
                notificationOutbox: {
                    findFirst: vi.fn().mockResolvedValue(null),
                    create: vi.fn().mockImplementation(({ data }) => {
                        outboxRows.push(data);
                        return { id: "outbox_sch1", ...data, createdAt: new Date() };
                    }),
                },
            };

            vi.spyOn(prisma.workOrder, "findFirst").mockResolvedValue({
                id: "wo_1",
                workspaceId: WS_ID,
                workOrderNumber: "WO-001",
                status: "ASSIGNED",
                assignedTechnicianId: "tech_1",
                customerId: "cust_1",
            } as any);
            vi.spyOn(prisma.technicianProfile, "findFirst").mockResolvedValue({
                id: "tech_1",
                workspaceId: WS_ID,
                employee: { status: "ACTIVE", displayName: "Sam Tech" },
            } as any);
            mocks.checkTechnicianAvailability.mockResolvedValue({ available: true, conflictingAppointments: [] });
            vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(mockTx));

            await createSchedule(
                WS_ID,
                {
                    workOrderId: "wo_1",
                    technicianId: "tech_1",
                    scheduledStart: "2026-08-25T14:00:00.000Z",
                    scheduledEnd: "2026-08-25T16:00:00.000Z",
                },
            );

            expect(outboxRows.length).toBe(1);
            expect(outboxRows[0].eventType).toBe(NotificationEventType.SCHEDULE_APPOINTMENT_SCHEDULED);
            expect(outboxRows[0].payload.technicianName).toBe("Sam Tech");
        });
    });

    describe("3. Quote Lifecycle Event Emissions", () => {
        it("emits QUOTE_CREATED on createQuote", async () => {
            const outboxRows: any[] = [];
            const mockTx: any = {
                quote: {
                    findFirst: vi.fn().mockResolvedValue(null),
                    create: vi.fn().mockResolvedValue({
                        id: "quote_1",
                        workspaceId: WS_ID,
                        quoteNumber: "Q-2026-000001",
                        title: "AC Replacement",
                        customerId: "cust_1",
                        status: "DRAFT",
                        total: new Prisma.Decimal(500),
                        customer: { name: "Acme Corp" },
                        location: null,
                        lineItems: [],
                    }),
                },
                quoteHistory: { create: vi.fn().mockResolvedValue({ id: "qh_1" }) },
                customer: { findFirst: vi.fn().mockResolvedValue({ id: "cust_1", status: "ACTIVE" }) },
                workspace: { findUnique: vi.fn().mockResolvedValue({ defaultCurrencyCode: "USD" }) },
                notificationOutbox: {
                    findFirst: vi.fn().mockResolvedValue(null),
                    create: vi.fn().mockImplementation(({ data }) => {
                        outboxRows.push(data);
                        return { id: "outbox_q1", ...data, createdAt: new Date() };
                    }),
                },
            };

            vi.spyOn(prisma.customer, "findFirst").mockResolvedValue({ id: "cust_1", status: "ACTIVE" } as any);
            vi.spyOn(prisma.workspace, "findUnique").mockResolvedValue({ defaultCurrencyCode: "USD" } as any);
            vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(mockTx));

            const result = await createQuote(
                WS_ID,
                {
                    customerId: "cust_1",
                    title: "AC Replacement",
                },
                mockAuthContext as any,
            );

            expect(result.id).toBe("quote_1");
            expect(outboxRows.length).toBe(1);
            expect(outboxRows[0].eventType).toBe(NotificationEventType.QUOTE_CREATED);
            expect(outboxRows[0].sourceEntity).toBe("Quote");
            expect(outboxRows[0].payload.totalAmount).toBe("500.00");
        });
    });

    describe("4. Invoice & Payment Lifecycle Event Emissions", () => {
        it("emits PAYMENT_RECEIVED on recordPayment", async () => {
            const outboxRows: any[] = [];
            const mockTx: any = {
                invoice: {
                    findFirst: vi.fn().mockResolvedValue({
                        id: "inv_1",
                        workspaceId: WS_ID,
                        invoiceNumber: "INV-2026-000001",
                        title: "Service Invoice",
                        customerId: "cust_1",
                        status: "ISSUED",
                        total: new Prisma.Decimal(100),
                        payments: [],
                        currencyCode: "USD",
                        customer: { name: "Acme Corp" },
                    }),
                    update: vi.fn().mockResolvedValue({ id: "inv_1" }),
                },
                payment: {
                    findFirst: vi.fn().mockResolvedValue(null),
                    create: vi.fn().mockResolvedValue({
                        id: "pay_1",
                        paymentNumber: "PAY-2026-000001",
                        amount: new Prisma.Decimal(100),
                        currencyCode: "USD",
                        paymentMethod: "CREDIT_CARD",
                        status: "RECORDED",
                        paymentDate: new Date("2026-08-25T12:00:00.000Z"),
                        customerId: "cust_1",
                        recordedByMember: { user: { name: "Agent" } },
                    }),
                },
                invoiceHistory: { create: vi.fn().mockResolvedValue({ id: "ih_1" }) },
                notificationOutbox: {
                    findFirst: vi.fn().mockResolvedValue(null),
                    create: vi.fn().mockImplementation(({ data }) => {
                        outboxRows.push(data);
                        return { id: "outbox_pay1", ...data, createdAt: new Date() };
                    }),
                },
            };

            vi.spyOn(prisma.invoice, "findFirst").mockResolvedValue({
                id: "inv_1",
                workspaceId: WS_ID,
                invoiceNumber: "INV-2026-000001",
                title: "Service Invoice",
                customerId: "cust_1",
                status: "ISSUED",
                total: new Prisma.Decimal(100),
                payments: [],
                currencyCode: "USD",
                customer: { name: "Acme Corp" },
            } as any);

            vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => cb(mockTx));

            const result = await recordPayment(
                WS_ID,
                "inv_1",
                {
                    amount: 100,
                    paymentMethod: "CREDIT_CARD",
                },
                mockAuthContext as any,
            );

            expect(result.id).toBe("pay_1");
            expect(outboxRows.length).toBe(1);
            expect(outboxRows[0].eventType).toBe(NotificationEventType.PAYMENT_RECEIVED);
            expect(outboxRows[0].sourceEntity).toBe("Payment");
            expect(outboxRows[0].payload.paymentNumber).toBe("PAY-2026-000001");
            expect(outboxRows[0].payload.remainingInvoiceBalance).toBe("0.00");
        });
    });

    describe("5. Critical Invariant: Atomic Transaction Rollback on Notification Failure", () => {
        it("rolls back WorkOrder creation completely if emitNotificationEvent fails", async () => {
            let workOrderPersisted = false;

            const mockTx: any = {
                customer: {
                    findFirst: vi.fn().mockResolvedValue({ id: "cust_1", workspaceId: WS_ID, name: "Acme Corp", status: "ACTIVE" }),
                },
                serviceLocation: {
                    findFirst: vi.fn().mockResolvedValue({ id: "loc_1", customerId: "cust_1", name: "HQ", addressLine1: "123 Main" }),
                },
                workType: {
                    findFirst: vi.fn().mockResolvedValue({
                        id: "wt_1",
                        workspaceId: WS_ID,
                        name: "HVAC",
                        code: "HVAC",
                        estimatedDuration: 60,
                        status: "ACTIVE",
                        catalog: { status: "ACTIVE" },
                        catalogItem: { id: "ci_1", code: "HVAC", name: "HVAC", unitPrice: 100, isLabor: true },
                    }),
                },
                workOrder: {
                    findFirst: vi.fn().mockResolvedValue(null),
                    create: vi.fn().mockImplementation(async () => {
                        workOrderPersisted = true;
                        return {
                            id: "wo_rollback",
                            workspaceId: WS_ID,
                            workOrderNumber: "WO-2026-999999",
                            title: "Rollback Test",
                            customerId: "cust_1",
                            locationId: "loc_1",
                            workTypeId: "wt_1",
                            priority: "MEDIUM",
                            status: "OPEN",
                            customer: { name: "Acme" },
                            location: { name: "HQ" },
                            workType: { name: "HVAC" },
                        };
                    }),
                },
                workOrderHistory: { create: vi.fn().mockResolvedValue({ id: "woh_1" }) },
                notificationOutbox: {
                    findFirst: vi.fn().mockResolvedValue(null),
                    create: vi.fn().mockRejectedValue(new Error("DB_OUTBOX_DISK_FAILURE")),
                },
            };

            vi.spyOn(prisma.customer, "findFirst").mockResolvedValue({ id: "cust_1", workspaceId: WS_ID, name: "Acme Corp", status: "ACTIVE" } as any);
            vi.spyOn(prisma.serviceLocation, "findFirst").mockResolvedValue({ id: "loc_1", customerId: "cust_1", name: "HQ", addressLine1: "123 Main" } as any);
            vi.spyOn(prisma.workType, "findFirst").mockResolvedValue({
                id: "wt_1",
                workspaceId: WS_ID,
                name: "HVAC",
                code: "HVAC",
                estimatedDuration: 60,
                status: "ACTIVE",
                catalog: { status: "ACTIVE" },
                catalogItem: { id: "ci_1", code: "HVAC", name: "HVAC", unitPrice: 100, isLabor: true },
            } as any);

            // Transaction rollback simulation
            vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => {
                try {
                    return await cb(mockTx);
                } catch (err) {
                    workOrderPersisted = false; // Transaction rolls back
                    throw err;
                }
            });

            await expect(
                createWorkOrder(
                    WS_ID,
                    {
                        customerId: "cust_1",
                        locationId: "loc_1",
                        workTypeId: "wt_1",
                        title: "Rollback Test",
                        priority: "MEDIUM",
                    },
                    mockAuthContext as any,
                ),
            ).rejects.toThrow("DB_OUTBOX_DISK_FAILURE");

            // Verify that the WorkOrder was NOT persisted
            expect(workOrderPersisted).toBe(false);
        });

        it("rolls back Quote creation completely if emitNotificationEvent fails", async () => {
            let quotePersisted = false;

            const mockTx: any = {
                quote: {
                    findFirst: vi.fn().mockResolvedValue(null),
                    create: vi.fn().mockImplementation(async () => {
                        quotePersisted = true;
                        return {
                            id: "quote_rollback",
                            workspaceId: WS_ID,
                            quoteNumber: "Q-2026-999999",
                            title: "Rollback Quote",
                            customerId: "cust_1",
                            status: "DRAFT",
                            total: new Prisma.Decimal(500),
                            customer: { name: "Acme Corp" },
                            location: null,
                            lineItems: [],
                        };
                    }),
                },
                quoteHistory: { create: vi.fn().mockResolvedValue({ id: "qh_1" }) },
                customer: { findFirst: vi.fn().mockResolvedValue({ id: "cust_1", status: "ACTIVE" }) },
                workspace: { findUnique: vi.fn().mockResolvedValue({ defaultCurrencyCode: "USD" }) },
                notificationOutbox: {
                    findFirst: vi.fn().mockResolvedValue(null),
                    create: vi.fn().mockRejectedValue(new Error("OUTBOX_WRITE_FAILED")),
                },
            };

            vi.spyOn(prisma.customer, "findFirst").mockResolvedValue({ id: "cust_1", status: "ACTIVE" } as any);
            vi.spyOn(prisma.workspace, "findUnique").mockResolvedValue({ defaultCurrencyCode: "USD" } as any);

            vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => {
                try {
                    return await cb(mockTx);
                } catch (err) {
                    quotePersisted = false; // Transaction rolls back
                    throw err;
                }
            });

            await expect(
                createQuote(
                    WS_ID,
                    {
                        customerId: "cust_1",
                        title: "Rollback Quote",
                    },
                    mockAuthContext as any,
                ),
            ).rejects.toThrow("OUTBOX_WRITE_FAILED");

            // Verify that the Quote was NOT persisted
            expect(quotePersisted).toBe(false);
        });

        it("rolls back Payment recording and Invoice balance update if emitNotificationEvent fails", async () => {
            let paymentPersisted = false;
            let invoiceUpdated = false;

            const mockTx: any = {
                invoice: {
                    findFirst: vi.fn().mockResolvedValue({
                        id: "inv_1",
                        workspaceId: WS_ID,
                        invoiceNumber: "INV-2026-000001",
                        title: "Service Invoice",
                        customerId: "cust_1",
                        status: "ISSUED",
                        total: new Prisma.Decimal(100),
                        payments: [],
                        currencyCode: "USD",
                        customer: { name: "Acme Corp" },
                    }),
                    update: vi.fn().mockImplementation(async () => {
                        invoiceUpdated = true;
                        return { id: "inv_1" };
                    }),
                },
                payment: {
                    findFirst: vi.fn().mockResolvedValue(null),
                    create: vi.fn().mockImplementation(async () => {
                        paymentPersisted = true;
                        return {
                            id: "pay_rollback",
                            paymentNumber: "PAY-2026-999999",
                            amount: new Prisma.Decimal(100),
                            currencyCode: "USD",
                            paymentMethod: "CREDIT_CARD",
                            status: "RECORDED",
                            paymentDate: new Date(),
                            customerId: "cust_1",
                            recordedByMember: { user: { name: "Agent" } },
                        };
                    }),
                },
                invoiceHistory: { create: vi.fn().mockResolvedValue({ id: "ih_1" }) },
                notificationOutbox: {
                    findFirst: vi.fn().mockResolvedValue(null),
                    create: vi.fn().mockRejectedValue(new Error("OUTBOX_DEADLOCK_ERROR")),
                },
            };

            vi.spyOn(prisma.invoice, "findFirst").mockResolvedValue({
                id: "inv_1",
                workspaceId: WS_ID,
                invoiceNumber: "INV-2026-000001",
                title: "Service Invoice",
                customerId: "cust_1",
                status: "ISSUED",
                total: new Prisma.Decimal(100),
                payments: [],
                currencyCode: "USD",
                customer: { name: "Acme Corp" },
            } as any);

            vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => {
                try {
                    return await cb(mockTx);
                } catch (err) {
                    paymentPersisted = false;
                    invoiceUpdated = false; // Transaction rolls back
                    throw err;
                }
            });

            await expect(
                recordPayment(
                    WS_ID,
                    "inv_1",
                    {
                        amount: 100,
                        paymentMethod: "CREDIT_CARD",
                    },
                    mockAuthContext as any,
                ),
            ).rejects.toThrow("OUTBOX_DEADLOCK_ERROR");

            // Verify that neither the Payment nor the Invoice update was persisted
            expect(paymentPersisted).toBe(false);
            expect(invoiceUpdated).toBe(false);
        });
    });
});
