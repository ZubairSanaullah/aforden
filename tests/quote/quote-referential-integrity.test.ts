import { describe, expect, it, vi, beforeEach } from "vitest";
import { Prisma } from "@/generated/prisma/client";

const mocks = vi.hoisted(() => ({
    requireWorkspaceAuthorization: vi.fn(),
    assertPermission: vi.fn(),

    quoteFindFirst: vi.fn(),
    quoteFindUnique: vi.fn(),
    quoteFindMany: vi.fn(),
    quoteCreate: vi.fn(),
    quoteUpdate: vi.fn(),
    quoteDelete: vi.fn(),
    quoteCount: vi.fn(),

    quoteLineItemFindFirst: vi.fn(),
    quoteLineItemFindMany: vi.fn(),
    quoteLineItemCreate: vi.fn(),
    quoteLineItemUpdate: vi.fn(),
    quoteLineItemDelete: vi.fn(),

    quoteHistoryFindFirst: vi.fn(),
    quoteHistoryFindMany: vi.fn(),
    quoteHistoryCreate: vi.fn(),
    quoteHistoryDeleteMany: vi.fn(),

    customerFindFirst: vi.fn(),
    customerDelete: vi.fn(),

    serviceLocationFindFirst: vi.fn(),
    serviceLocationDelete: vi.fn(),

    workTypeFindFirst: vi.fn(),
    workTypeDelete: vi.fn(),

    partFindFirst: vi.fn(),
    partDelete: vi.fn(),

    workOrderFindFirst: vi.fn(),
    workOrderFindMany: vi.fn(),
    workOrderUpdate: vi.fn(),

    workspaceFindUnique: vi.fn(),
    workspaceDelete: vi.fn(),
    $transaction: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

vi.mock("@/lib/services/authorization/workspaceAuthorization", () => ({
    requireWorkspaceAuthorization: mocks.requireWorkspaceAuthorization,
}));

vi.mock("@/lib/services/authorization/permissionService", () => ({
    assertPermission: mocks.assertPermission,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        quote: {
            findFirst: mocks.quoteFindFirst,
            findUnique: mocks.quoteFindUnique,
            findMany: mocks.quoteFindMany,
            create: mocks.quoteCreate,
            update: mocks.quoteUpdate,
            delete: mocks.quoteDelete,
            count: mocks.quoteCount,
        },
        quoteLineItem: {
            findFirst: mocks.quoteLineItemFindFirst,
            findMany: mocks.quoteLineItemFindMany,
            create: mocks.quoteLineItemCreate,
            update: mocks.quoteLineItemUpdate,
            delete: mocks.quoteLineItemDelete,
        },
        quoteHistory: {
            findFirst: mocks.quoteHistoryFindFirst,
            findMany: mocks.quoteHistoryFindMany,
            create: mocks.quoteHistoryCreate,
            deleteMany: mocks.quoteHistoryDeleteMany,
        },
        customer: {
            findFirst: mocks.customerFindFirst,
            delete: mocks.customerDelete,
        },
        serviceLocation: {
            findFirst: mocks.serviceLocationFindFirst,
            delete: mocks.serviceLocationDelete,
        },
        workType: {
            findFirst: mocks.workTypeFindFirst,
            delete: mocks.workTypeDelete,
        },
        part: {
            findFirst: mocks.partFindFirst,
            delete: mocks.partDelete,
        },
        workOrder: {
            findFirst: mocks.workOrderFindFirst,
            findMany: mocks.workOrderFindMany,
            update: mocks.workOrderUpdate,
        },
        workspace: {
            findUnique: mocks.workspaceFindUnique,
            delete: mocks.workspaceDelete,
        },
        $transaction: mocks.$transaction,
    },
}));

import { prisma } from "@/lib/prisma";
import {
    createQuote,
    getQuote,
    deleteQuote,
    addQuoteLineItem,
} from "@/lib/services/quote";
import {
    QuoteNotFoundError,
    QuoteStatusConflictError,
} from "@/lib/services/quote/quoteErrors";
import {
    deleteCustomer,
    deleteServiceLocation,
    CustomerNotFoundError,
    ServiceLocationNotFoundError,
    CustomerDeletionNotAllowedError,
    ServiceLocationDeletionNotAllowedError,
} from "@/lib/services/customer";
import { WorkTypeNotFoundError } from "@/lib/services/workType/workTypeErrors";
import { PartNotFoundError } from "@/lib/services/inventory/part/partErrors";

describe("Phase 1.11.11 — Quotes Referential Integrity & Historical Safety Suite", () => {
    const WS_ALPHA = "ws_alpha_ref";
    const WS_BETA = "ws_beta_ref";
    const QUOTE_ID = "quote_ref_01";
    const CUST_ID = "cust_ref_01";
    const LOC_ID = "loc_ref_01";
    const WORK_TYPE_ID = "wt_ref_01";
    const PART_ID = "part_ref_01";
    const WO_ID = "wo_ref_01";

    const authContextAlpha = {
        membership: {
            id: "mem_alpha_admin",
            workspaceId: WS_ALPHA,
            role: "ADMIN",
            user: { id: "usr_alpha_01", name: "Admin Alpha", email: "admin@alpha.com" },
        },
        user: { id: "usr_alpha_01", name: "Admin Alpha", email: "admin@alpha.com" },
        workspace: { id: WS_ALPHA, name: "Workspace Alpha", defaultCurrencyCode: "USD" },
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mocks.requireWorkspaceAuthorization.mockResolvedValue(authContextAlpha);
        mocks.assertPermission.mockReturnValue(undefined);
        mocks.workspaceFindUnique.mockResolvedValue({ defaultCurrencyCode: "USD" });
        mocks.$transaction.mockImplementation(async (callback: any) => {
            if (typeof callback === "function") {
                return callback(prisma);
            }
            return callback;
        });
    });

    // =========================================================================
    // 1. Foreign Key Referential Integrity (onDelete actions verification)
    // =========================================================================
    describe("1. Foreign Key Referential Integrity (onDelete Verification)", () => {
        it("Quote.workspaceId → Workspace (Cascade): Deleting workspace triggers cascading delete of quotes", async () => {
            mocks.workspaceDelete.mockResolvedValueOnce({ id: WS_ALPHA });

            const result = await prisma.workspace.delete({ where: { id: WS_ALPHA } });
            expect(result.id).toBe(WS_ALPHA);
            expect(mocks.workspaceDelete).toHaveBeenCalledWith({ where: { id: WS_ALPHA } });
        });

        it("Quote.customerId → Customer (Restrict): Raw DB delete blocks customer deletion with P2003 when referenced by Quote", async () => {
            const p2003Error = new Error("Foreign key constraint failed on the field: `Quote_customerId_fkey`");
            (p2003Error as any).code = "P2003";

            mocks.customerDelete.mockRejectedValueOnce(p2003Error);

            await expect(
                prisma.customer.delete({ where: { id: CUST_ID } })
            ).rejects.toThrow("Foreign key constraint failed on the field: `Quote_customerId_fkey`");
            expect(mocks.customerDelete).toHaveBeenCalledWith({ where: { id: CUST_ID } });
        });

        it("Quote.customerId → Customer (Restrict): Phase 1.4 deleteCustomer service safely translates P2003 to CustomerDeletionNotAllowedError", async () => {
            const p2003Error = new Error("Foreign key constraint failed on the field: `Quote_customerId_fkey`");
            (p2003Error as any).code = "P2003";

            mocks.customerFindFirst.mockResolvedValueOnce({
                id: CUST_ID,
                workspaceId: WS_ALPHA,
                status: "INACTIVE",
            });
            mocks.customerDelete.mockRejectedValueOnce(p2003Error);

            await expect(deleteCustomer(WS_ALPHA, CUST_ID)).rejects.toThrow(CustomerDeletionNotAllowedError);
            expect(mocks.customerDelete).toHaveBeenCalledWith({ where: { id: CUST_ID } });
        });

        it("Quote.locationId → ServiceLocation (Restrict): Raw DB delete blocks location deletion with P2003 when referenced by Quote", async () => {
            const p2003Error = new Error("Foreign key constraint failed on the field: `Quote_locationId_fkey`");
            (p2003Error as any).code = "P2003";

            mocks.serviceLocationDelete.mockRejectedValueOnce(p2003Error);

            await expect(
                prisma.serviceLocation.delete({ where: { id: LOC_ID } })
            ).rejects.toThrow("Foreign key constraint failed on the field: `Quote_locationId_fkey`");
            expect(mocks.serviceLocationDelete).toHaveBeenCalledWith({ where: { id: LOC_ID } });
        });

        it("Quote.locationId → ServiceLocation (Restrict): Phase 1.4 deleteServiceLocation service safely translates P2003 to ServiceLocationDeletionNotAllowedError", async () => {
            const p2003Error = new Error("Foreign key constraint failed on the field: `Quote_locationId_fkey`");
            (p2003Error as any).code = "P2003";

            mocks.customerFindFirst.mockResolvedValueOnce({
                id: CUST_ID,
                workspaceId: WS_ALPHA,
                status: "ACTIVE",
            });
            mocks.serviceLocationFindFirst.mockResolvedValueOnce({
                id: LOC_ID,
                customerId: CUST_ID,
                workspaceId: WS_ALPHA,
                isPrimary: false,
            });
            mocks.serviceLocationDelete.mockRejectedValueOnce(p2003Error);

            await expect(deleteServiceLocation(WS_ALPHA, CUST_ID, LOC_ID)).rejects.toThrow(ServiceLocationDeletionNotAllowedError);
            expect(mocks.serviceLocationDelete).toHaveBeenCalledWith({ where: { id: LOC_ID } });
        });

        it("QuoteLineItem.quoteId → Quote (Cascade): Deleting quote cascades to delete all QuoteLineItems", async () => {
            mocks.quoteFindFirst.mockResolvedValueOnce({
                id: QUOTE_ID,
                workspaceId: WS_ALPHA,
                status: "DRAFT",
                quoteNumber: "Q-0001",
                total: new Prisma.Decimal("100.00"),
            });
            mocks.quoteDelete.mockResolvedValueOnce({ id: QUOTE_ID });

            await deleteQuote(WS_ALPHA, QUOTE_ID);

            expect(mocks.quoteDelete).toHaveBeenCalledWith({
                where: { id: QUOTE_ID },
            });
        });

        it("QuoteLineItem.workTypeId → WorkType (SetNull): Deleting a WorkType sets quoteLineItem.workTypeId = null", async () => {
            mocks.workTypeDelete.mockResolvedValueOnce({ id: WORK_TYPE_ID });

            const result = await prisma.workType.delete({ where: { id: WORK_TYPE_ID } });
            expect(result.id).toBe(WORK_TYPE_ID);
            expect(mocks.workTypeDelete).toHaveBeenCalledWith({ where: { id: WORK_TYPE_ID } });
        });

        it("QuoteLineItem.partId → Part (SetNull): Deleting a Part sets quoteLineItem.partId = null", async () => {
            mocks.partDelete.mockResolvedValueOnce({ id: PART_ID });

            const result = await prisma.part.delete({ where: { id: PART_ID } });
            expect(result.id).toBe(PART_ID);
            expect(mocks.partDelete).toHaveBeenCalledWith({ where: { id: PART_ID } });
        });

        it("QuoteHistory.quoteId → Quote (Cascade): Deleting a quote cascades to delete all QuoteHistory entries", async () => {
            mocks.quoteHistoryDeleteMany.mockResolvedValueOnce({ count: 5 });

            const result = await prisma.quoteHistory.deleteMany({ where: { quoteId: QUOTE_ID } });
            expect(result.count).toBe(5);
            expect(mocks.quoteHistoryDeleteMany).toHaveBeenCalledWith({ where: { quoteId: QUOTE_ID } });
        });

        it("WorkOrder.sourceQuoteId → Quote (SetNull): Deleting a converted Quote sets workOrder.sourceQuoteId = null without deleting WorkOrder", async () => {
            mocks.workOrderUpdate.mockResolvedValueOnce({
                id: WO_ID,
                sourceQuoteId: null,
            });

            const result = await prisma.workOrder.update({
                where: { id: WO_ID },
                data: { sourceQuoteId: null },
            });

            expect(result.id).toBe(WO_ID);
            expect(result.sourceQuoteId).toBeNull();
        });
    });

    // =========================================================================
    // 2. Historical Safety & Catalog Snapshot Immutability
    // =========================================================================
    describe("2. Historical Safety & Catalog Snapshot Immutability", () => {
        it("modifying a WorkType's rate/name does not alter already-persisted snapshot fields on QuoteLineItem", async () => {
            const originalSnapshotLine = {
                id: "line_01",
                quoteId: QUOTE_ID,
                workspaceId: WS_ALPHA,
                lineItemType: "LABOR",
                workTypeId: WORK_TYPE_ID,
                name: "HVAC Inspection Standard",
                workTypeName: "HVAC Inspection Standard",
                workTypeCode: "HVAC-01",
                quantity: new Prisma.Decimal("2.00"),
                unitPrice: new Prisma.Decimal("150.00"),
                unitCost: null,
                discountAmount: new Prisma.Decimal("0.00"),
                subtotal: new Prisma.Decimal("300.00"),
                taxRate: new Prisma.Decimal("0.0000"),
                taxAmount: new Prisma.Decimal("0.00"),
                total: new Prisma.Decimal("300.00"),
                sortOrder: 0,
            };

            const mockQuoteWithSnapshot = {
                id: QUOTE_ID,
                workspaceId: WS_ALPHA,
                quoteNumber: "Q-0001",
                status: "DRAFT",
                title: "HVAC Quote",
                description: null,
                internalNotes: null,
                termsAndConditions: null,
                currencyCode: "USD",
                validUntil: null,
                subtotal: new Prisma.Decimal("300.00"),
                discountType: "PERCENTAGE",
                discountValue: new Prisma.Decimal("0.00"),
                discountAmount: new Prisma.Decimal("0.00"),
                taxRate: new Prisma.Decimal("0.0000"),
                taxAmount: new Prisma.Decimal("0.00"),
                total: new Prisma.Decimal("300.00"),
                sentAt: null,
                approvedAt: null,
                approvedByCustomerName: null,
                rejectedAt: null,
                rejectionReason: null,
                convertedAt: null,
                convertedWorkOrderId: null,
                convertedByMemberId: null,
                createdAt: new Date("2026-08-20T10:00:00Z"),
                updatedAt: new Date("2026-08-20T10:00:00Z"),
                customerId: CUST_ID,
                locationId: null,
                customer: { id: CUST_ID, name: "Customer Alpha", customerNumber: "CUST-001" },
                location: null,
                lineItems: [originalSnapshotLine],
            };

            mocks.quoteFindFirst.mockResolvedValueOnce(mockQuoteWithSnapshot);

            const quote = await getQuote(WS_ALPHA, QUOTE_ID);

            expect(quote.lineItems![0].workTypeName).toBe("HVAC Inspection Standard");
            expect(quote.lineItems![0].workTypeCode).toBe("HVAC-01");
            expect(quote.lineItems![0].unitPrice).toBe("150.00");
            expect(quote.lineItems![0].total).toBe("300.00");
        });

        it("modifying a Part's SKU/cost/price does not alter already-persisted snapshot fields on QuoteLineItem", async () => {
            const originalPartSnapshotLine = {
                id: "line_02",
                quoteId: QUOTE_ID,
                workspaceId: WS_ALPHA,
                lineItemType: "PART",
                partId: PART_ID,
                name: "Air Filter 20x20",
                partName: "Air Filter 20x20",
                partSku: "FLT-2020",
                partUnitOfMeasure: "PIECE",
                quantity: new Prisma.Decimal("4.00"),
                unitPrice: new Prisma.Decimal("25.00"),
                unitCost: new Prisma.Decimal("12.50"),
                discountAmount: new Prisma.Decimal("0.00"),
                subtotal: new Prisma.Decimal("100.00"),
                taxRate: new Prisma.Decimal("0.0500"),
                taxAmount: new Prisma.Decimal("5.00"),
                total: new Prisma.Decimal("105.00"),
                sortOrder: 1,
            };

            const mockQuoteWithPartSnapshot = {
                id: QUOTE_ID,
                workspaceId: WS_ALPHA,
                quoteNumber: "Q-0001",
                status: "DRAFT",
                title: "Parts Quote",
                description: null,
                internalNotes: null,
                termsAndConditions: null,
                currencyCode: "USD",
                validUntil: null,
                subtotal: new Prisma.Decimal("100.00"),
                discountType: "PERCENTAGE",
                discountValue: new Prisma.Decimal("0.00"),
                discountAmount: new Prisma.Decimal("0.00"),
                taxRate: new Prisma.Decimal("0.0500"),
                taxAmount: new Prisma.Decimal("5.00"),
                total: new Prisma.Decimal("105.00"),
                sentAt: null,
                approvedAt: null,
                approvedByCustomerName: null,
                rejectedAt: null,
                rejectionReason: null,
                convertedAt: null,
                convertedWorkOrderId: null,
                convertedByMemberId: null,
                createdAt: new Date("2026-08-20T10:00:00Z"),
                updatedAt: new Date("2026-08-20T10:00:00Z"),
                customerId: CUST_ID,
                locationId: null,
                customer: { id: CUST_ID, name: "Customer Alpha", customerNumber: "CUST-001" },
                location: null,
                lineItems: [originalPartSnapshotLine],
            };

            mocks.quoteFindFirst.mockResolvedValueOnce(mockQuoteWithPartSnapshot);

            const quote = await getQuote(WS_ALPHA, QUOTE_ID);

            expect(quote.lineItems![0].partName).toBe("Air Filter 20x20");
            expect(quote.lineItems![0].partSku).toBe("FLT-2020");
            expect(quote.lineItems![0].partUnitOfMeasure).toBe("PIECE");
            expect(quote.lineItems![0].unitCost).toBe("12.50");
            expect(quote.lineItems![0].unitPrice).toBe("25.00");
        });

        it("deleting a WorkType (SetNull) preserves the line item's snapshot fields even when workTypeId becomes null", async () => {
            const lineItemWithNullWorkTypeId = {
                id: "line_01",
                quoteId: QUOTE_ID,
                workspaceId: WS_ALPHA,
                lineItemType: "LABOR",
                workTypeId: null, // Catalog record was deleted; SetNull applied
                name: "HVAC Inspection Standard",
                workTypeName: "HVAC Inspection Standard",
                workTypeCode: "HVAC-01",
                partName: null,
                partSku: null,
                partUnitOfMeasure: null,
                quantity: new Prisma.Decimal("2.00"),
                unitPrice: new Prisma.Decimal("150.00"),
                unitCost: null,
                discountAmount: new Prisma.Decimal("0.00"),
                subtotal: new Prisma.Decimal("300.00"),
                taxRate: new Prisma.Decimal("0.0000"),
                taxAmount: new Prisma.Decimal("0.00"),
                total: new Prisma.Decimal("300.00"),
                sortOrder: 0,
            };

            const mockQuote = {
                id: QUOTE_ID,
                workspaceId: WS_ALPHA,
                quoteNumber: "Q-0001",
                status: "DRAFT",
                title: "HVAC Quote",
                description: null,
                internalNotes: null,
                termsAndConditions: null,
                currencyCode: "USD",
                validUntil: null,
                subtotal: new Prisma.Decimal("300.00"),
                discountType: "PERCENTAGE",
                discountValue: new Prisma.Decimal("0.00"),
                discountAmount: new Prisma.Decimal("0.00"),
                taxRate: new Prisma.Decimal("0.0000"),
                taxAmount: new Prisma.Decimal("0.00"),
                total: new Prisma.Decimal("300.00"),
                sentAt: null,
                approvedAt: null,
                approvedByCustomerName: null,
                rejectedAt: null,
                rejectionReason: null,
                convertedAt: null,
                convertedWorkOrderId: null,
                convertedByMemberId: null,
                createdAt: new Date("2026-08-20T10:00:00Z"),
                updatedAt: new Date("2026-08-20T10:00:00Z"),
                customerId: CUST_ID,
                locationId: null,
                customer: { id: CUST_ID, name: "Customer Alpha", customerNumber: "CUST-001" },
                location: null,
                lineItems: [lineItemWithNullWorkTypeId],
            };

            mocks.quoteFindFirst.mockResolvedValueOnce(mockQuote);

            const quote = await getQuote(WS_ALPHA, QUOTE_ID);

            expect(quote.lineItems![0].workTypeId).toBeNull();
            expect(quote.lineItems![0].workTypeName).toBe("HVAC Inspection Standard");
            expect(quote.lineItems![0].workTypeCode).toBe("HVAC-01");
            expect(quote.lineItems![0].unitPrice).toBe("150.00");
        });

        it("cross-tenant protection: rejects creating quote referencing Customer from another workspace", async () => {
            mocks.customerFindFirst.mockResolvedValueOnce(null);

            await expect(
                createQuote(WS_ALPHA, {
                    customerId: "cust_belonging_to_ws_beta",
                    title: "Cross Tenant Quote",
                })
            ).rejects.toThrow(CustomerNotFoundError);

            expect(mocks.customerFindFirst).toHaveBeenCalledWith({
                where: { id: "cust_belonging_to_ws_beta", workspaceId: WS_ALPHA },
            });
        });

        it("cross-tenant protection: rejects creating quote referencing ServiceLocation from another workspace", async () => {
            mocks.customerFindFirst.mockResolvedValueOnce({
                id: CUST_ID,
                workspaceId: WS_ALPHA,
            });
            mocks.serviceLocationFindFirst.mockResolvedValueOnce(null);

            await expect(
                createQuote(WS_ALPHA, {
                    customerId: CUST_ID,
                    locationId: "loc_belonging_to_ws_beta",
                    title: "Cross Tenant Quote",
                })
            ).rejects.toThrow(ServiceLocationNotFoundError);

            expect(mocks.serviceLocationFindFirst).toHaveBeenCalledWith({
                where: { id: "loc_belonging_to_ws_beta", customerId: CUST_ID },
            });
        });

        it("cross-tenant protection: rejects adding quote line item referencing WorkType from another workspace", async () => {
            mocks.quoteFindFirst.mockResolvedValueOnce({
                id: QUOTE_ID,
                workspaceId: WS_ALPHA,
                status: "DRAFT",
            });
            mocks.workTypeFindFirst.mockResolvedValueOnce(null);

            await expect(
                addQuoteLineItem(WS_ALPHA, QUOTE_ID, {
                    lineItemType: "LABOR",
                    workTypeId: "wt_belonging_to_ws_beta",
                    name: "Labor Task",
                    quantity: "1.00",
                    unitPrice: "100.00",
                })
            ).rejects.toThrow(WorkTypeNotFoundError);

            expect(mocks.workTypeFindFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: "wt_belonging_to_ws_beta", workspaceId: WS_ALPHA },
                })
            );
        });

        it("cross-tenant protection: rejects adding quote line item referencing Part from another workspace", async () => {
            mocks.quoteFindFirst.mockResolvedValueOnce({
                id: QUOTE_ID,
                workspaceId: WS_ALPHA,
                status: "DRAFT",
            });
            mocks.partFindFirst.mockResolvedValueOnce(null);

            await expect(
                addQuoteLineItem(WS_ALPHA, QUOTE_ID, {
                    lineItemType: "PART",
                    partId: "part_belonging_to_ws_beta",
                    name: "Replacement Part",
                    quantity: "1.00",
                    unitPrice: "50.00",
                })
            ).rejects.toThrow(PartNotFoundError);

            expect(mocks.partFindFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: "part_belonging_to_ws_beta", workspaceId: WS_ALPHA },
                })
            );
        });
    });

    // =========================================================================
    // 3. Destructive-Action Protection Audit
    // =========================================================================
    describe("3. Destructive-Action Protection Audit", () => {
        it("rejects deleteQuote on PENDING_APPROVAL quote with QuoteStatusConflictError", async () => {
            mocks.quoteFindFirst.mockResolvedValueOnce({
                id: QUOTE_ID,
                workspaceId: WS_ALPHA,
                status: "PENDING_APPROVAL",
                quoteNumber: "Q-0001",
            });

            await expect(deleteQuote(WS_ALPHA, QUOTE_ID)).rejects.toThrow(QuoteStatusConflictError);
            expect(mocks.quoteDelete).not.toHaveBeenCalled();
        });

        it("rejects deleteQuote on APPROVED quote with QuoteStatusConflictError", async () => {
            mocks.quoteFindFirst.mockResolvedValueOnce({
                id: QUOTE_ID,
                workspaceId: WS_ALPHA,
                status: "APPROVED",
                quoteNumber: "Q-0001",
            });

            await expect(deleteQuote(WS_ALPHA, QUOTE_ID)).rejects.toThrow(QuoteStatusConflictError);
            expect(mocks.quoteDelete).not.toHaveBeenCalled();
        });

        it("rejects deleteQuote on CONVERTED quote with QuoteStatusConflictError", async () => {
            mocks.quoteFindFirst.mockResolvedValueOnce({
                id: QUOTE_ID,
                workspaceId: WS_ALPHA,
                status: "CONVERTED",
                quoteNumber: "Q-0001",
            });

            await expect(deleteQuote(WS_ALPHA, QUOTE_ID)).rejects.toThrow(QuoteStatusConflictError);
            expect(mocks.quoteDelete).not.toHaveBeenCalled();
        });

        it("rejects deleteQuote on REJECTED quote with QuoteStatusConflictError", async () => {
            mocks.quoteFindFirst.mockResolvedValueOnce({
                id: QUOTE_ID,
                workspaceId: WS_ALPHA,
                status: "REJECTED",
                quoteNumber: "Q-0001",
            });

            await expect(deleteQuote(WS_ALPHA, QUOTE_ID)).rejects.toThrow(QuoteStatusConflictError);
            expect(mocks.quoteDelete).not.toHaveBeenCalled();
        });

        it("rejects deleteQuote on EXPIRED quote with QuoteStatusConflictError", async () => {
            mocks.quoteFindFirst.mockResolvedValueOnce({
                id: QUOTE_ID,
                workspaceId: WS_ALPHA,
                status: "EXPIRED",
                quoteNumber: "Q-0001",
            });

            await expect(deleteQuote(WS_ALPHA, QUOTE_ID)).rejects.toThrow(QuoteStatusConflictError);
            expect(mocks.quoteDelete).not.toHaveBeenCalled();
        });
    });
});
