import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

import { Prisma } from "@/generated/prisma/client";
import {
    convertQuoteToWorkOrder,
    QuoteNotFoundError,
    QuoteAlreadyConvertedError,
    QuoteStatusConflictError,
} from "@/lib/services/quote";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

// Mock Services & Prisma
const mocks = vi.hoisted(() => {
    return {
        quoteFindFirst: vi.fn(),
        quoteUpdate: vi.fn(),
        quoteHistoryCreate: vi.fn(),
        workOrderUpdate: vi.fn(),
        createWorkOrder: vi.fn(),
        assignWorkOrder: vi.fn(),
        stockMovementCreate: vi.fn(),
        $transaction: vi.fn(),
    };
});

vi.mock("@/lib/prisma", () => ({
    prisma: {
        quote: {
            findFirst: mocks.quoteFindFirst,
            update: mocks.quoteUpdate,
        },
        quoteHistory: {
            create: mocks.quoteHistoryCreate,
        },
        workOrder: {
            update: mocks.workOrderUpdate,
        },
        stockMovement: {
            create: mocks.stockMovementCreate,
        },
        $transaction: mocks.$transaction,
    },
}));

vi.mock("@/lib/services/authorization/workspaceAuthorization", () => ({
    requireWorkspaceAuthorization: vi.fn(),
}));

vi.mock("@/lib/services/workOrder/createWorkOrder", () => ({
    createWorkOrder: mocks.createWorkOrder,
}));

vi.mock("@/lib/services/workOrder/assignWorkOrder", () => ({
    assignWorkOrder: mocks.assignWorkOrder,
}));

describe("Phase 1.11.8 — Atomic WorkOrder Conversion Service", () => {
    const WS_ID = "ws_test_alpha";
    const CUST_ID = "cust_alpha_01";
    const LOC_ID = "loc_alpha_01";
    const QUOTE_ID = "quote_test_01";
    const WORK_TYPE_PRIMARY = "wt_ac_diagnostic";
    const WORK_TYPE_SECONDARY = "wt_fan_replacement";
    const WORK_TYPE_OVERRIDE = "wt_emergency_overhaul";

    const adminActor: WorkspaceAuthorizationContext = {
        membership: {
            id: "mem_admin_01",
            role: "ADMIN",
            status: "ACTIVE",
        },
        user: {
            id: "usr_admin_01",
            name: "Admin User",
            email: "admin@aforden.com",
            status: "ACTIVE",
            emailVerified: new Date(),
        },
        workspace: {
            id: WS_ID,
            name: "Alpha HVAC",
            slug: "alpha-hvac",
            logoUrl: null,
            timezone: "UTC",
        },
    };

    const managerActor: WorkspaceAuthorizationContext = {
        membership: {
            id: "mem_mgr_01",
            role: "MANAGER",
            status: "ACTIVE",
        },
        user: {
            id: "usr_mgr_01",
            name: "Manager User",
            email: "mgr@aforden.com",
            status: "ACTIVE",
            emailVerified: new Date(),
        },
        workspace: adminActor.workspace,
    };

    const dispatcherActor: WorkspaceAuthorizationContext = {
        membership: {
            id: "mem_disp_01",
            role: "DISPATCHER",
            status: "ACTIVE",
        },
        user: {
            id: "usr_disp_01",
            name: "Dispatcher User",
            email: "disp@aforden.com",
            status: "ACTIVE",
            emailVerified: new Date(),
        },
        workspace: adminActor.workspace,
    };

    const techActor: WorkspaceAuthorizationContext = {
        membership: {
            id: "mem_tech_01",
            role: "TECHNICIAN",
            status: "ACTIVE",
        },
        user: {
            id: "usr_tech_01",
            name: "Tech User",
            email: "tech@aforden.com",
            status: "ACTIVE",
            emailVerified: new Date(),
        },
        workspace: adminActor.workspace,
    };

    const accountantActor: WorkspaceAuthorizationContext = {
        membership: {
            id: "mem_acct_01",
            role: "ACCOUNTANT",
            status: "ACTIVE",
        },
        user: {
            id: "usr_acct_01",
            name: "Accountant User",
            email: "acct@aforden.com",
            status: "ACTIVE",
            emailVerified: new Date(),
        },
        workspace: adminActor.workspace,
    };

    const mockQuoteApproved = {
        id: QUOTE_ID,
        workspaceId: WS_ID,
        quoteNumber: "Q-2026-000001",
        customerId: CUST_ID,
        locationId: LOC_ID,
        status: "APPROVED",
        title: "AC System Overhaul",
        description: "Full service diagnostic and parts replacement",
        internalNotes: "Customer requested morning service",
        termsAndConditions: "Standard 30-day warranty",
        currencyCode: "USD",
        validUntil: new Date("2026-09-01T00:00:00Z"),
        subtotal: new Prisma.Decimal("450.00"),
        discountType: "PERCENTAGE",
        discountValue: new Prisma.Decimal("0.00"),
        discountAmount: new Prisma.Decimal("0.00"),
        taxRate: new Prisma.Decimal("0.0000"),
        taxAmount: new Prisma.Decimal("0.00"),
        total: new Prisma.Decimal("450.00"),
        sentAt: new Date("2026-08-25T01:00:00Z"),
        approvedAt: new Date("2026-08-25T02:00:00Z"),
        approvedByCustomerName: "John Customer",
        rejectedAt: null,
        rejectionReason: null,
        convertedAt: null,
        convertedWorkOrderId: null,
        convertedByMemberId: null,
        createdAt: new Date("2026-08-25T00:00:00Z"),
        updatedAt: new Date("2026-08-25T02:00:00Z"),
        lineItems: [
            {
                id: "line_part_01",
                quoteId: QUOTE_ID,
                workspaceId: WS_ID,
                lineItemType: "PART",
                workTypeId: null,
                partId: "part_filter_01",
                name: "HEPA Air Filter",
                description: null,
                workTypeName: null,
                workTypeCode: null,
                partName: "HEPA Air Filter",
                partSku: "FLT-001",
                partUnitOfMeasure: "EACH",
                quantity: new Prisma.Decimal("2.00"),
                unitPrice: new Prisma.Decimal("50.00"),
                unitCost: new Prisma.Decimal("25.00"),
                discountAmount: new Prisma.Decimal("0.00"),
                subtotal: new Prisma.Decimal("100.00"),
                taxRate: new Prisma.Decimal("0.0000"),
                taxAmount: new Prisma.Decimal("0.00"),
                total: new Prisma.Decimal("100.00"),
                sortOrder: 0,
                createdAt: new Date("2026-08-25T00:00:00Z"),
                updatedAt: new Date("2026-08-25T00:00:00Z"),
            },
            {
                id: "line_labor_01",
                quoteId: QUOTE_ID,
                workspaceId: WS_ID,
                lineItemType: "LABOR",
                workTypeId: WORK_TYPE_PRIMARY,
                partId: null,
                name: "Standard AC Diagnostic",
                description: null,
                workTypeName: "Standard AC Diagnostic",
                workTypeCode: "AC-DIAG",
                partName: null,
                partSku: null,
                partUnitOfMeasure: null,
                quantity: new Prisma.Decimal("1.00"),
                unitPrice: new Prisma.Decimal("150.00"),
                unitCost: null,
                discountAmount: new Prisma.Decimal("0.00"),
                subtotal: new Prisma.Decimal("150.00"),
                taxRate: new Prisma.Decimal("0.0000"),
                taxAmount: new Prisma.Decimal("0.00"),
                total: new Prisma.Decimal("150.00"),
                sortOrder: 1,
                createdAt: new Date("2026-08-25T00:00:00Z"),
                updatedAt: new Date("2026-08-25T00:00:00Z"),
            },
            {
                id: "line_labor_02",
                quoteId: QUOTE_ID,
                workspaceId: WS_ID,
                lineItemType: "LABOR",
                workTypeId: WORK_TYPE_SECONDARY,
                partId: null,
                name: "Blower Motor Fan Replacement",
                description: null,
                workTypeName: "Fan Replacement",
                workTypeCode: "FAN-REP",
                partName: null,
                partSku: null,
                partUnitOfMeasure: null,
                quantity: new Prisma.Decimal("1.00"),
                unitPrice: new Prisma.Decimal("200.00"),
                unitCost: null,
                discountAmount: new Prisma.Decimal("0.00"),
                subtotal: new Prisma.Decimal("200.00"),
                taxRate: new Prisma.Decimal("0.0000"),
                taxAmount: new Prisma.Decimal("0.00"),
                total: new Prisma.Decimal("200.00"),
                sortOrder: 2,
                createdAt: new Date("2026-08-25T00:00:00Z"),
                updatedAt: new Date("2026-08-25T00:00:00Z"),
            },
        ],
    };

    const mockCreatedWorkOrder = {
        id: "wo_created_001",
        workspaceId: WS_ID,
        workOrderNumber: "WO-2026-000001",
        customerId: CUST_ID,
        customerName: "Alpha Customer",
        customerNumber: "CUST-0001",
        locationId: LOC_ID,
        locationName: "Main Branch",
        locationAddress: "123 Main St, City, ST 12345",
        workTypeId: WORK_TYPE_PRIMARY,
        workTypeName: "Standard AC Diagnostic",
        workTypeCode: "AC-DIAG",
        estimatedDuration: 60,
        assignedTechnicianId: null,
        assetId: null,
        status: "OPEN" as const,
        priority: "MEDIUM" as const,
        title: "AC System Overhaul",
        description: "Full service diagnostic and parts replacement",
        internalNotes: "Customer requested morning service",
        holdReason: null,
        cancellationReason: null,
        startedAt: null,
        completedAt: null,
        cancelledAt: null,
        createdAt: new Date("2026-08-25T03:00:00Z"),
        updatedAt: new Date("2026-08-25T03:00:00Z"),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        mocks.createWorkOrder.mockResolvedValue(mockCreatedWorkOrder);
        mocks.assignWorkOrder.mockResolvedValue({
            ...mockCreatedWorkOrder,
            assignedTechnicianId: "tech_01",
            status: "ASSIGNED",
        });
        mocks.quoteHistoryCreate.mockResolvedValue({});
        mocks.workOrderUpdate.mockResolvedValue({});
        mocks.quoteUpdate.mockResolvedValue({
            ...mockQuoteApproved,
            status: "CONVERTED",
            convertedWorkOrderId: "wo_created_001",
            convertedAt: new Date("2026-08-25T03:00:00Z"),
            convertedByMemberId: adminActor.membership.id,
        });

        mocks.$transaction.mockImplementation(async (cb: any) => {
            const tx = {
                workOrder: {
                    update: mocks.workOrderUpdate,
                },
                quote: {
                    update: mocks.quoteUpdate,
                },
                quoteHistory: {
                    create: mocks.quoteHistoryCreate,
                },
            };
            return cb(tx);
        });
    });

    // ==========================================
    // 1. RBAC Permissions
    // ==========================================
    describe("1. RBAC Permissions", () => {
        it("rejects TECHNICIAN actor without quotes.convert permission", async () => {
            await expect(
                convertQuoteToWorkOrder(WS_ID, QUOTE_ID, {}, techActor),
            ).rejects.toThrow(ForbiddenError);
        });

        it("rejects ACCOUNTANT actor without quotes.convert permission", async () => {
            await expect(
                convertQuoteToWorkOrder(WS_ID, QUOTE_ID, {}, accountantActor),
            ).rejects.toThrow(ForbiddenError);
        });

        it("allows DISPATCHER actor with quotes.convert permission", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteApproved);

            const result = await convertQuoteToWorkOrder(
                WS_ID,
                QUOTE_ID,
                {},
                dispatcherActor,
            );
            expect(result.success).toBe(true);
            expect(result.workOrder.id).toBe("wo_created_001");
            expect(result.quote.status).toBe("CONVERTED");
        });

        it("allows MANAGER actor with quotes.convert permission", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteApproved);

            const result = await convertQuoteToWorkOrder(
                WS_ID,
                QUOTE_ID,
                {},
                managerActor,
            );
            expect(result.success).toBe(true);
            expect(result.workOrder.id).toBe("wo_created_001");
            expect(result.quote.status).toBe("CONVERTED");
        });

        it("allows ADMIN actor with quotes.convert permission", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteApproved);

            const result = await convertQuoteToWorkOrder(
                WS_ID,
                QUOTE_ID,
                {},
                adminActor,
            );
            expect(result.success).toBe(true);
            expect(result.quote.status).toBe("CONVERTED");
        });
    });

    // ==========================================
    // 2. Lifecycle State Guards
    // ==========================================
    describe("2. Lifecycle State Guards", () => {
        it("throws QuoteNotFoundError if quote does not exist", async () => {
            mocks.quoteFindFirst.mockResolvedValue(null);

            await expect(
                convertQuoteToWorkOrder(WS_ID, "quote_missing", {}, adminActor),
            ).rejects.toThrow(QuoteNotFoundError);
        });

        it("throws QuoteAlreadyConvertedError specifically when quote is already CONVERTED", async () => {
            mocks.quoteFindFirst.mockResolvedValue({
                ...mockQuoteApproved,
                status: "CONVERTED",
                convertedWorkOrderId: "wo_existing_001",
            });

            await expect(
                convertQuoteToWorkOrder(WS_ID, QUOTE_ID, {}, adminActor),
            ).rejects.toThrow(QuoteAlreadyConvertedError);
        });

        it("throws QuoteStatusConflictError when quote is in DRAFT status", async () => {
            mocks.quoteFindFirst.mockResolvedValue({
                ...mockQuoteApproved,
                status: "DRAFT",
            });

            await expect(
                convertQuoteToWorkOrder(WS_ID, QUOTE_ID, {}, adminActor),
            ).rejects.toThrow(QuoteStatusConflictError);
        });

        it("throws QuoteStatusConflictError when quote is in PENDING_APPROVAL status", async () => {
            mocks.quoteFindFirst.mockResolvedValue({
                ...mockQuoteApproved,
                status: "PENDING_APPROVAL",
            });

            await expect(
                convertQuoteToWorkOrder(WS_ID, QUOTE_ID, {}, adminActor),
            ).rejects.toThrow(QuoteStatusConflictError);
        });

        it("throws QuoteStatusConflictError when quote is in REJECTED status", async () => {
            mocks.quoteFindFirst.mockResolvedValue({
                ...mockQuoteApproved,
                status: "REJECTED",
            });

            await expect(
                convertQuoteToWorkOrder(WS_ID, QUOTE_ID, {}, adminActor),
            ).rejects.toThrow(QuoteStatusConflictError);
        });

        it("throws QuoteStatusConflictError when quote is in EXPIRED status", async () => {
            mocks.quoteFindFirst.mockResolvedValue({
                ...mockQuoteApproved,
                status: "EXPIRED",
            });

            await expect(
                convertQuoteToWorkOrder(WS_ID, QUOTE_ID, {}, adminActor),
            ).rejects.toThrow(QuoteStatusConflictError);
        });
    });

    // ==========================================
    // 3. workTypeId Resolution
    // ==========================================
    describe("3. workTypeId Resolution", () => {
        it("resolves workTypeId from lowest-sortOrder LABOR line item when no override is provided", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteApproved);

            await convertQuoteToWorkOrder(WS_ID, QUOTE_ID, {}, adminActor);

            expect(mocks.createWorkOrder).toHaveBeenCalledWith(
                WS_ID,
                expect.objectContaining({
                    workTypeId: WORK_TYPE_PRIMARY, // sortOrder 1 is lowest among LABOR lines (line_part_01 is PART at 0)
                }),
                adminActor,
                expect.any(Object), // tx handle passed
            );
        });

        it("uses explicit workTypeId override when provided in input", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteApproved);

            await convertQuoteToWorkOrder(
                WS_ID,
                QUOTE_ID,
                { workTypeId: WORK_TYPE_OVERRIDE },
                adminActor,
            );

            expect(mocks.createWorkOrder).toHaveBeenCalledWith(
                WS_ID,
                expect.objectContaining({
                    workTypeId: WORK_TYPE_OVERRIDE,
                }),
                adminActor,
                expect.any(Object), // tx handle passed
            );
        });

        it("rejects conversion with explicit error when quote has no LABOR line items and no override is given", async () => {
            mocks.quoteFindFirst.mockResolvedValue({
                ...mockQuoteApproved,
                lineItems: [
                    mockQuoteApproved.lineItems[0], // only PART line item
                ],
            });

            await expect(
                convertQuoteToWorkOrder(WS_ID, QUOTE_ID, {}, adminActor),
            ).rejects.toThrow(/No LABOR line item with a workTypeId was found/i);

            expect(mocks.createWorkOrder).not.toHaveBeenCalled();
        });
    });

    // ==========================================
    // 4. Single Interactive Transaction & Atomicity
    // ==========================================
    describe("4. Single Interactive Transaction & Atomicity", () => {
        it("delegates to canonical createWorkOrder passing quote values inside shared transaction handle", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteApproved);

            const result = await convertQuoteToWorkOrder(
                WS_ID,
                QUOTE_ID,
                {
                    title: "Custom WorkOrder Title",
                    description: "Custom WorkOrder Description",
                },
                adminActor,
            );

            expect(mocks.$transaction).toHaveBeenCalledTimes(1);

            expect(mocks.createWorkOrder).toHaveBeenCalledWith(
                WS_ID,
                {
                    customerId: CUST_ID,
                    locationId: LOC_ID,
                    workTypeId: WORK_TYPE_PRIMARY,
                    title: "Custom WorkOrder Title",
                    description: "Custom WorkOrder Description",
                    internalNotes: "Customer requested morning service",
                },
                adminActor,
                expect.any(Object), // tx client
            );

            expect(mocks.workOrderUpdate).toHaveBeenCalledWith({
                where: { id: "wo_created_001" },
                data: { sourceQuoteId: QUOTE_ID },
            });

            expect(mocks.quoteUpdate).toHaveBeenCalledWith({
                where: { id: QUOTE_ID },
                data: {
                    status: "CONVERTED",
                    convertedWorkOrderId: "wo_created_001",
                    convertedAt: expect.any(Date),
                    convertedByMemberId: adminActor.membership.id,
                },
                include: expect.any(Object),
            });

            expect(mocks.quoteHistoryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    quoteId: QUOTE_ID,
                    workspaceId: WS_ID,
                    eventType: "CONVERTED",
                    actorMemberId: adminActor.membership.id,
                    field: "status",
                    oldValue: "APPROVED",
                    newValue: "CONVERTED",
                    metadata: expect.objectContaining({
                        workOrderId: "wo_created_001",
                        workOrderNumber: "WO-2026-000001",
                    }),
                }),
            });

            expect(result.success).toBe(true);
            expect(result.workOrder.id).toBe("wo_created_001");
            expect(result.quote.status).toBe("CONVERTED");
        });

        it("invokes canonical assignWorkOrder within the same transaction when assignedTechnicianId is provided", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteApproved);

            const result = await convertQuoteToWorkOrder(
                WS_ID,
                QUOTE_ID,
                { assignedTechnicianId: "tech_01" },
                adminActor,
            );

            expect(mocks.assignWorkOrder).toHaveBeenCalledWith(
                WS_ID,
                "wo_created_001",
                { technicianId: "tech_01" },
                adminActor,
                expect.any(Object), // tx client
            );

            expect(result.workOrder.assignedTechnicianId).toBe("tech_01");
        });

        it("ensures atomic rollback: if quote update fails after createWorkOrder succeeds, the entire transaction rolls back", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteApproved);
            mocks.quoteUpdate.mockRejectedValue(new Error("Database connection lost during quote update"));

            await expect(
                convertQuoteToWorkOrder(WS_ID, QUOTE_ID, {}, adminActor),
            ).rejects.toThrow("Database connection lost during quote update");

            // Confirms both happened under the same $transaction execution
            expect(mocks.$transaction).toHaveBeenCalledTimes(1);
            expect(mocks.createWorkOrder).toHaveBeenCalled();
            // Because $transaction rejects, all changes are aborted atomically in Prisma
        });

        it("creates ZERO StockMovement or inventory balance mutations during conversion", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteApproved);

            await convertQuoteToWorkOrder(WS_ID, QUOTE_ID, {}, adminActor);

            expect(mocks.stockMovementCreate).not.toHaveBeenCalled();
        });

        it("delegates locationId validation to createWorkOrder when quote has null locationId", async () => {
            mocks.quoteFindFirst.mockResolvedValue({
                ...mockQuoteApproved,
                locationId: null,
            });

            mocks.createWorkOrder.mockRejectedValue(new Error("Location ID is required."));

            await expect(
                convertQuoteToWorkOrder(WS_ID, QUOTE_ID, {}, adminActor),
            ).rejects.toThrow("Location ID is required.");

            expect(mocks.createWorkOrder).toHaveBeenCalledWith(
                WS_ID,
                expect.objectContaining({
                    locationId: undefined,
                }),
                adminActor,
                expect.any(Object),
            );
        });
    });
});
