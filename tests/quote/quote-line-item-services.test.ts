import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

import { Prisma } from "@/generated/prisma/client";
import {
    addQuoteLineItem,
    updateQuoteLineItem,
    removeQuoteLineItem,
    reorderQuoteLineItems,
    QuoteNotFoundError,
    QuoteLineItemNotFoundError,
    QuoteStatusConflictError,
    InvalidQuoteCalculationError,
} from "@/lib/services/quote";
import { WorkTypeNotFoundError } from "@/lib/services/workType/workTypeErrors";
import { PartNotFoundError } from "@/lib/services/inventory/part/partErrors";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

// Mock Prisma
const mocks = vi.hoisted(() => {
    return {
        quoteFindFirst: vi.fn(),
        quoteFindUniqueOrThrow: vi.fn(),
        quoteUpdate: vi.fn(),
        quoteLineItemCreate: vi.fn(),
        quoteLineItemUpdate: vi.fn(),
        quoteLineItemDelete: vi.fn(),
        quoteHistoryCreate: vi.fn(),
        workTypeFindFirst: vi.fn(),
        partFindFirst: vi.fn(),
        $transaction: vi.fn(),
    };
});

vi.mock("@/lib/prisma", () => ({
    prisma: {
        quote: {
            findFirst: mocks.quoteFindFirst,
            findUniqueOrThrow: mocks.quoteFindUniqueOrThrow,
            update: mocks.quoteUpdate,
        },
        quoteLineItem: {
            create: mocks.quoteLineItemCreate,
            update: mocks.quoteLineItemUpdate,
            delete: mocks.quoteLineItemDelete,
        },
        quoteHistory: {
            create: mocks.quoteHistoryCreate,
        },
        workType: {
            findFirst: mocks.workTypeFindFirst,
        },
        part: {
            findFirst: mocks.partFindFirst,
        },
        $transaction: mocks.$transaction,
    },
}));

vi.mock("@/lib/services/authorization/workspaceAuthorization", () => ({
    requireWorkspaceAuthorization: vi.fn(),
}));

describe("Phase 1.11.6 — Quote Line Item Mutation Services", () => {
    const WS_ID = "ws_test_alpha";
    const CUST_ID = "cust_alpha_01";
    const QUOTE_ID = "quote_test_01";
    const WORK_TYPE_ID = "wt_ac_service_01";
    const PART_ID = "part_filter_01";

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

    const mockQuoteDraft = {
        id: QUOTE_ID,
        workspaceId: WS_ID,
        quoteNumber: "Q-2026-000001",
        customerId: CUST_ID,
        locationId: null,
        status: "DRAFT",
        title: "Initial AC Repair",
        description: "Draft estimate",
        internalNotes: null,
        termsAndConditions: null,
        currencyCode: "USD",
        validUntil: null,
        subtotal: new Prisma.Decimal("100.00"),
        discountType: "PERCENTAGE",
        discountValue: new Prisma.Decimal("10.00"),
        discountAmount: new Prisma.Decimal("10.00"),
        taxRate: new Prisma.Decimal("0.0500"),
        taxAmount: new Prisma.Decimal("4.50"),
        total: new Prisma.Decimal("94.50"),
        createdAt: new Date("2026-08-25T00:00:00Z"),
        updatedAt: new Date("2026-08-25T00:00:00Z"),
        lineItems: [
            {
                id: "line_01",
                quoteId: QUOTE_ID,
                workspaceId: WS_ID,
                lineItemType: "CUSTOM",
                workTypeId: null,
                partId: null,
                name: "Initial Diagnostic",
                description: null,
                workTypeName: null,
                workTypeCode: null,
                partName: null,
                partSku: null,
                partUnitOfMeasure: null,
                quantity: new Prisma.Decimal("1.00"),
                unitPrice: new Prisma.Decimal("100.00"),
                unitCost: null,
                discountAmount: new Prisma.Decimal("0.00"),
                subtotal: new Prisma.Decimal("100.00"),
                taxRate: new Prisma.Decimal("0.0500"),
                taxAmount: new Prisma.Decimal("4.50"),
                total: new Prisma.Decimal("94.50"),
                sortOrder: 0,
                createdAt: new Date("2026-08-25T00:00:00Z"),
                updatedAt: new Date("2026-08-25T00:00:00Z"),
            },
        ],
    };

    beforeEach(() => {
        vi.clearAllMocks();

        mocks.quoteHistoryCreate.mockResolvedValue({});
        mocks.quoteLineItemUpdate.mockResolvedValue({});
        mocks.quoteLineItemDelete.mockResolvedValue({});

        // Default transaction mock executes callback with fake tx
        mocks.$transaction.mockImplementation(async (cb: any) => {
            const tx = {
                quote: {
                    update: mocks.quoteUpdate,
                    findUniqueOrThrow: mocks.quoteFindUniqueOrThrow,
                },
                quoteLineItem: {
                    create: mocks.quoteLineItemCreate,
                    update: mocks.quoteLineItemUpdate,
                    delete: mocks.quoteLineItemDelete,
                },
                quoteHistory: {
                    create: mocks.quoteHistoryCreate,
                },
                workType: {
                    findFirst: mocks.workTypeFindFirst,
                },
                part: {
                    findFirst: mocks.partFindFirst,
                },
            };
            return cb(tx);
        });
    });

    // ==========================================
    // 1. addQuoteLineItem
    // ==========================================
    describe("1. addQuoteLineItem", () => {
        it("rejects unauthorized actor without quotes.update permission", async () => {
            await expect(
                addQuoteLineItem(
                    WS_ID,
                    QUOTE_ID,
                    { name: "Labor Item", quantity: 1, unitPrice: 50 },
                    techActor,
                ),
            ).rejects.toThrow(ForbiddenError);
        });

        it("throws QuoteNotFoundError if quote does not exist or belongs to another workspace", async () => {
            mocks.quoteFindFirst.mockResolvedValue(null);

            await expect(
                addQuoteLineItem(
                    WS_ID,
                    "quote_missing",
                    { name: "Labor Item", quantity: 1, unitPrice: 50 },
                    adminActor,
                ),
            ).rejects.toThrow(QuoteNotFoundError);
        });

        it("throws QuoteStatusConflictError if quote is not in DRAFT status", async () => {
            mocks.quoteFindFirst.mockResolvedValue({
                ...mockQuoteDraft,
                status: "APPROVED",
            });

            await expect(
                addQuoteLineItem(
                    WS_ID,
                    QUOTE_ID,
                    { name: "Labor Item", quantity: 1, unitPrice: 50 },
                    adminActor,
                ),
            ).rejects.toThrow(QuoteStatusConflictError);
        });

        it("throws WorkTypeNotFoundError if workTypeId is not found in the workspace", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteDraft);
            mocks.workTypeFindFirst.mockResolvedValue(null);

            await expect(
                addQuoteLineItem(
                    WS_ID,
                    QUOTE_ID,
                    {
                        workTypeId: "wt_nonexistent",
                        name: "Labor Item",
                        quantity: 1,
                        unitPrice: 50,
                    },
                    adminActor,
                ),
            ).rejects.toThrow(WorkTypeNotFoundError);
        });

        it("throws PartNotFoundError if partId is not found in the workspace", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteDraft);
            mocks.partFindFirst.mockResolvedValue(null);

            await expect(
                addQuoteLineItem(
                    WS_ID,
                    QUOTE_ID,
                    {
                        partId: "part_nonexistent",
                        name: "Filter Item",
                        quantity: 1,
                        unitPrice: 50,
                    },
                    adminActor,
                ),
            ).rejects.toThrow(PartNotFoundError);
        });

        it("throws InvalidQuoteCalculationError when (quantity * unitPrice) - discountAmount < 0", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteDraft);

            await expect(
                addQuoteLineItem(
                    WS_ID,
                    QUOTE_ID,
                    {
                        name: "Negative Subtotal Item",
                        quantity: 2,
                        unitPrice: 10,
                        discountAmount: 25, // 20 - 25 = -5 -> INVALID!
                    },
                    adminActor,
                ),
            ).rejects.toThrow(InvalidQuoteCalculationError);
        });

        it("resolves and freezes WorkType catalog snapshots with default LABOR type", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteDraft);
            mocks.workTypeFindFirst.mockResolvedValue({
                id: WORK_TYPE_ID,
                name: "AC Full Service",
                code: "SRV-AC-01",
                status: "ACTIVE",
            });

            const newLineItem = {
                id: "line_02",
                quoteId: QUOTE_ID,
                workspaceId: WS_ID,
                lineItemType: "LABOR",
                workTypeId: WORK_TYPE_ID,
                partId: null,
                name: "AC Full Service",
                description: null,
                workTypeName: "AC Full Service",
                workTypeCode: "SRV-AC-01",
                partName: null,
                partSku: null,
                partUnitOfMeasure: null,
                quantity: new Prisma.Decimal("2.00"),
                unitPrice: new Prisma.Decimal("100.00"),
                unitCost: null,
                discountAmount: new Prisma.Decimal("0.00"),
                subtotal: new Prisma.Decimal("200.00"),
                taxRate: new Prisma.Decimal("0.0500"),
                taxAmount: new Prisma.Decimal("9.00"),
                total: new Prisma.Decimal("189.00"),
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            mocks.quoteLineItemCreate.mockResolvedValue(newLineItem);
            mocks.quoteUpdate.mockResolvedValue({
                ...mockQuoteDraft,
                subtotal: new Prisma.Decimal("300.00"),
                discountAmount: new Prisma.Decimal("30.00"),
                taxAmount: new Prisma.Decimal("13.50"),
                total: new Prisma.Decimal("283.50"),
                lineItems: [mockQuoteDraft.lineItems[0], newLineItem],
            });

            const result = await addQuoteLineItem(
                WS_ID,
                QUOTE_ID,
                {
                    workTypeId: WORK_TYPE_ID,
                    quantity: 2,
                    unitPrice: 100,
                },
                adminActor,
            );

            expect(mocks.quoteLineItemCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        workTypeId: WORK_TYPE_ID,
                        workTypeName: "AC Full Service",
                        workTypeCode: "SRV-AC-01",
                        lineItemType: "LABOR",
                        name: "AC Full Service",
                        sortOrder: 1, // Appended after line_01 (sortOrder 0)
                    }),
                }),
            );

            expect(mocks.quoteHistoryCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        quoteId: QUOTE_ID,
                        eventType: "LINE_ITEM_ADDED",
                        field: "lineItems",
                        newValue: "line_02",
                    }),
                }),
            );

            expect(result.lineItems).toHaveLength(2);
            expect(result.subtotal).toBe("300.00");
        });

        it("resolves and freezes Part catalog snapshots with default PART type and unitCost", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteDraft);
            mocks.partFindFirst.mockResolvedValue({
                id: PART_ID,
                name: "HEPA Air Filter",
                sku: "FLT-HEPA-001",
                unitOfMeasure: "PIECE",
                unitCost: new Prisma.Decimal("15.50"),
                status: "ACTIVE",
            });

            const newLineItem = {
                id: "line_part_01",
                quoteId: QUOTE_ID,
                workspaceId: WS_ID,
                lineItemType: "PART",
                workTypeId: null,
                partId: PART_ID,
                name: "HEPA Air Filter",
                description: null,
                workTypeName: null,
                workTypeCode: null,
                partName: "HEPA Air Filter",
                partSku: "FLT-HEPA-001",
                partUnitOfMeasure: "PIECE",
                quantity: new Prisma.Decimal("1.00"),
                unitPrice: new Prisma.Decimal("45.00"),
                unitCost: new Prisma.Decimal("15.50"),
                discountAmount: new Prisma.Decimal("0.00"),
                subtotal: new Prisma.Decimal("45.00"),
                taxRate: new Prisma.Decimal("0.0500"),
                taxAmount: new Prisma.Decimal("2.03"),
                total: new Prisma.Decimal("42.53"),
                sortOrder: 5,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            mocks.quoteLineItemCreate.mockResolvedValue(newLineItem);
            mocks.quoteUpdate.mockResolvedValue({
                ...mockQuoteDraft,
                lineItems: [mockQuoteDraft.lineItems[0], newLineItem],
            });

            await addQuoteLineItem(
                WS_ID,
                QUOTE_ID,
                {
                    partId: PART_ID,
                    quantity: 1,
                    unitPrice: 45.0,
                    sortOrder: 5, // Explicit caller sortOrder
                },
                adminActor,
            );

            expect(mocks.quoteLineItemCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        partId: PART_ID,
                        partName: "HEPA Air Filter",
                        partSku: "FLT-HEPA-001",
                        partUnitOfMeasure: "PIECE",
                        unitCost: new Prisma.Decimal("15.50"),
                        lineItemType: "PART",
                        name: "HEPA Air Filter",
                        sortOrder: 5,
                    }),
                }),
            );
        });

        it("triggers full quote recalculation across all lines and writes LINE_ITEM_ADDED history", async () => {
            // Existing Quote: 10% header discount, 5% tax.
            // Existing Line 1: Subtotal 100 -> alloc header discount = 10 -> net = 90 -> tax = 4.50 -> total = 94.50
            // Add Line 2: Subtotal 200 -> total subtotal = 300.
            // Header discount 10% on 300 = 30.00.
            // Line 1: alloc = (100 / 300) * 30 = 10.00 -> net = 90 -> tax = 4.50 -> total = 94.50
            // Line 2: alloc = (200 / 300) * 30 = 20.00 -> net = 180 -> tax = 9.00 -> total = 189.00
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteDraft);

            const newLineItem = {
                id: "line_02",
                quoteId: QUOTE_ID,
                workspaceId: WS_ID,
                lineItemType: "CUSTOM",
                workTypeId: null,
                partId: null,
                name: "Custom Duct Cleaning",
                description: null,
                workTypeName: null,
                workTypeCode: null,
                partName: null,
                partSku: null,
                partUnitOfMeasure: null,
                quantity: new Prisma.Decimal("1.00"),
                unitPrice: new Prisma.Decimal("200.00"),
                unitCost: null,
                discountAmount: new Prisma.Decimal("0.00"),
                subtotal: new Prisma.Decimal("0.00"),
                taxRate: new Prisma.Decimal("0.0500"),
                taxAmount: new Prisma.Decimal("0.00"),
                total: new Prisma.Decimal("0.00"),
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            mocks.quoteLineItemCreate.mockResolvedValue(newLineItem);
            mocks.quoteUpdate.mockResolvedValue({
                ...mockQuoteDraft,
                subtotal: new Prisma.Decimal("300.00"),
                discountAmount: new Prisma.Decimal("30.00"),
                taxAmount: new Prisma.Decimal("13.50"),
                total: new Prisma.Decimal("283.50"),
                lineItems: [
                    mockQuoteDraft.lineItems[0],
                    { ...newLineItem, subtotal: new Prisma.Decimal("200.00"), total: new Prisma.Decimal("189.00") },
                ],
            });

            const result = await addQuoteLineItem(
                WS_ID,
                QUOTE_ID,
                {
                    name: "Custom Duct Cleaning",
                    quantity: 1,
                    unitPrice: 200,
                },
                adminActor,
            );

            // Verified line item updates occurred for both lines
            expect(mocks.quoteLineItemUpdate).toHaveBeenCalledWith({
                where: { id: "line_01" },
                data: expect.objectContaining({
                    subtotal: new Prisma.Decimal("100.00"),
                    taxAmount: new Prisma.Decimal("4.50"),
                    total: new Prisma.Decimal("94.50"),
                }),
            });

            expect(mocks.quoteLineItemUpdate).toHaveBeenCalledWith({
                where: { id: "line_02" },
                data: expect.objectContaining({
                    subtotal: new Prisma.Decimal("200.00"),
                    taxAmount: new Prisma.Decimal("9.00"),
                    total: new Prisma.Decimal("189.00"),
                }),
            });

            // Quote header updated
            expect(mocks.quoteUpdate).toHaveBeenCalledWith({
                where: { id: QUOTE_ID },
                data: {
                    subtotal: new Prisma.Decimal("300.00"),
                    discountAmount: new Prisma.Decimal("30.00"),
                    taxAmount: new Prisma.Decimal("13.50"),
                    total: new Prisma.Decimal("283.50"),
                },
                include: expect.any(Object),
            });

            // History written
            expect(mocks.quoteHistoryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    eventType: "LINE_ITEM_ADDED",
                    metadata: expect.objectContaining({
                        lineItemId: "line_02",
                        name: "Custom Duct Cleaning",
                        amount: "189",
                    }),
                }),
            });

            expect(result.subtotal).toBe("300.00");
            expect(result.total).toBe("283.50");
        });
    });

    // ==========================================
    // 2. updateQuoteLineItem
    // ==========================================
    describe("2. updateQuoteLineItem", () => {
        it("rejects unauthorized actor", async () => {
            await expect(
                updateQuoteLineItem(
                    WS_ID,
                    QUOTE_ID,
                    "line_01",
                    { quantity: 2 },
                    techActor,
                ),
            ).rejects.toThrow(ForbiddenError);
        });

        it("throws QuoteNotFoundError if quote is missing", async () => {
            mocks.quoteFindFirst.mockResolvedValue(null);

            await expect(
                updateQuoteLineItem(
                    WS_ID,
                    "quote_missing",
                    "line_01",
                    { quantity: 2 },
                    adminActor,
                ),
            ).rejects.toThrow(QuoteNotFoundError);
        });

        it("throws QuoteStatusConflictError if quote is not in DRAFT status", async () => {
            mocks.quoteFindFirst.mockResolvedValue({
                ...mockQuoteDraft,
                status: "PENDING_APPROVAL",
            });

            await expect(
                updateQuoteLineItem(
                    WS_ID,
                    QUOTE_ID,
                    "line_01",
                    { quantity: 2 },
                    adminActor,
                ),
            ).rejects.toThrow(QuoteStatusConflictError);
        });

        it("throws QuoteLineItemNotFoundError if line item does not belong to the quote", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteDraft); // Contains only "line_01"

            await expect(
                updateQuoteLineItem(
                    WS_ID,
                    QUOTE_ID,
                    "line_foreign_99", // Belongs to another quote or doesn't exist
                    { quantity: 2 },
                    adminActor,
                ),
            ).rejects.toThrow(QuoteLineItemNotFoundError);
        });

        it("throws InvalidQuoteCalculationError when updated discount exceeds merged quantity * unitPrice", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteDraft); // line_01 has qty 1, price 100

            await expect(
                updateQuoteLineItem(
                    WS_ID,
                    QUOTE_ID,
                    "line_01",
                    { discountAmount: 150 }, // 100 - 150 = -50 -> INVALID!
                    adminActor,
                ),
            ).rejects.toThrow(InvalidQuoteCalculationError);
        });

        it("re-resolves and updates snapshots when changing workTypeId", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteDraft);
            mocks.workTypeFindFirst.mockResolvedValue({
                id: "wt_new_02",
                name: "Compressor Replacement",
                code: "CMP-02",
                status: "ACTIVE",
            });

            mocks.quoteUpdate.mockResolvedValue({
                ...mockQuoteDraft,
                lineItems: [
                    {
                        ...mockQuoteDraft.lineItems[0],
                        workTypeId: "wt_new_02",
                        workTypeName: "Compressor Replacement",
                        workTypeCode: "CMP-02",
                    },
                ],
            });

            await updateQuoteLineItem(
                WS_ID,
                QUOTE_ID,
                "line_01",
                { workTypeId: "wt_new_02" },
                adminActor,
            );

            expect(mocks.quoteLineItemUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: "line_01" },
                    data: expect.objectContaining({
                        workTypeId: "wt_new_02",
                        workTypeName: "Compressor Replacement",
                        workTypeCode: "CMP-02",
                        name: "Compressor Replacement",
                    }),
                }),
            );
        });

        it("throws WorkTypeNotFoundError / PartNotFoundError when update provides invalid catalog ID", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteDraft);
            mocks.workTypeFindFirst.mockResolvedValue(null);

            await expect(
                updateQuoteLineItem(
                    WS_ID,
                    QUOTE_ID,
                    "line_01",
                    { workTypeId: "wt_invalid" },
                    adminActor,
                ),
            ).rejects.toThrow(WorkTypeNotFoundError);
        });

        it("triggers full-quote recalculation affecting proration on all line items", async () => {
            // Quote with 2 lines:
            // Line 1: 100, Line 2: 300 -> Total Subtotal: 400.
            // Fixed header discount: 40.00.
            // Update Line 1 from 100 to 500:
            // New Total Subtotal: 500 + 300 = 800.
            // Header discount remains 40.00, but proration changes:
            // Line 1 alloc = (500 / 800) * 40 = 25.00 -> net = 475.00
            // Line 2 alloc = (300 / 800) * 40 = 15.00 -> net = 285.00 (previously was 30.00!)
            const multiLineQuote = {
                ...mockQuoteDraft,
                discountType: "FIXED",
                discountValue: new Prisma.Decimal("40.00"),
                discountAmount: new Prisma.Decimal("40.00"),
                lineItems: [
                    {
                        ...mockQuoteDraft.lineItems[0],
                        id: "line_01",
                        quantity: new Prisma.Decimal("1.00"),
                        unitPrice: new Prisma.Decimal("100.00"),
                        subtotal: new Prisma.Decimal("100.00"),
                    },
                    {
                        ...mockQuoteDraft.lineItems[0],
                        id: "line_02",
                        sortOrder: 1,
                        quantity: new Prisma.Decimal("3.00"),
                        unitPrice: new Prisma.Decimal("100.00"),
                        subtotal: new Prisma.Decimal("300.00"),
                    },
                ],
            };

            mocks.quoteFindFirst.mockResolvedValue(multiLineQuote);
            mocks.quoteUpdate.mockResolvedValue({
                ...multiLineQuote,
                subtotal: new Prisma.Decimal("800.00"),
                total: new Prisma.Decimal("798.00"),
                lineItems: [
                    { ...multiLineQuote.lineItems[0], unitPrice: new Prisma.Decimal("500.00"), subtotal: new Prisma.Decimal("500.00") },
                    multiLineQuote.lineItems[1],
                ],
            });

            await updateQuoteLineItem(
                WS_ID,
                QUOTE_ID,
                "line_01",
                { unitPrice: 500 },
                adminActor,
            );

            // Check that Line 2 was updated with new proration!
            expect(mocks.quoteLineItemUpdate).toHaveBeenCalledWith({
                where: { id: "line_02" },
                data: expect.objectContaining({
                    subtotal: new Prisma.Decimal("300.00"),
                    total: new Prisma.Decimal("299.25"), // Net base 285 + 5% tax 14.25 = 299.25
                }),
            });

            // History record
            expect(mocks.quoteHistoryCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        eventType: "LINE_ITEM_UPDATED",
                        field: "lineItems",
                    }),
                }),
            );
        });
    });

    // ==========================================
    // 3. removeQuoteLineItem
    // ==========================================
    describe("3. removeQuoteLineItem", () => {
        it("rejects unauthorized actor", async () => {
            await expect(
                removeQuoteLineItem(WS_ID, QUOTE_ID, "line_01", techActor),
            ).rejects.toThrow(ForbiddenError);
        });

        it("throws QuoteNotFoundError if quote is missing", async () => {
            mocks.quoteFindFirst.mockResolvedValue(null);

            await expect(
                removeQuoteLineItem(WS_ID, "quote_missing", "line_01", adminActor),
            ).rejects.toThrow(QuoteNotFoundError);
        });

        it("throws QuoteStatusConflictError if quote is not DRAFT", async () => {
            mocks.quoteFindFirst.mockResolvedValue({
                ...mockQuoteDraft,
                status: "EXPIRED",
            });

            await expect(
                removeQuoteLineItem(WS_ID, QUOTE_ID, "line_01", adminActor),
            ).rejects.toThrow(QuoteStatusConflictError);
        });

        it("throws QuoteLineItemNotFoundError if line item does not belong to the quote", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteDraft);

            await expect(
                removeQuoteLineItem(WS_ID, QUOTE_ID, "line_other_quote", adminActor),
            ).rejects.toThrow(QuoteLineItemNotFoundError);
        });

        it("deletes line item, recalculates remaining lines, and writes LINE_ITEM_REMOVED history", async () => {
            const twoLineQuote = {
                ...mockQuoteDraft,
                lineItems: [
                    mockQuoteDraft.lineItems[0],
                    {
                        ...mockQuoteDraft.lineItems[0],
                        id: "line_02",
                        sortOrder: 1,
                        quantity: new Prisma.Decimal("2.00"),
                        unitPrice: new Prisma.Decimal("100.00"),
                        subtotal: new Prisma.Decimal("200.00"),
                    },
                ],
            };

            mocks.quoteFindFirst.mockResolvedValue(twoLineQuote);
            mocks.quoteUpdate.mockResolvedValue({
                ...mockQuoteDraft,
                subtotal: new Prisma.Decimal("100.00"),
                discountAmount: new Prisma.Decimal("10.00"),
                taxAmount: new Prisma.Decimal("4.50"),
                total: new Prisma.Decimal("94.50"),
                lineItems: [twoLineQuote.lineItems[0]],
            });

            const result = await removeQuoteLineItem(
                WS_ID,
                QUOTE_ID,
                "line_02",
                adminActor,
            );

            expect(mocks.quoteLineItemDelete).toHaveBeenCalledWith({
                where: { id: "line_02" },
            });

            // Remaining line updated
            expect(mocks.quoteLineItemUpdate).toHaveBeenCalledWith({
                where: { id: "line_01" },
                data: expect.objectContaining({
                    subtotal: new Prisma.Decimal("100.00"),
                    taxAmount: new Prisma.Decimal("4.50"),
                    total: new Prisma.Decimal("94.50"),
                }),
            });

            // History written
            expect(mocks.quoteHistoryCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        eventType: "LINE_ITEM_REMOVED",
                        field: "lineItems",
                        oldValue: "line_02",
                    }),
                }),
            );

            expect(result.subtotal).toBe("100.00");
        });

        it("succeeds when removing the only remaining line item (leaving 0 items and 0.00 totals)", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteDraft);
            mocks.quoteUpdate.mockResolvedValue({
                ...mockQuoteDraft,
                subtotal: new Prisma.Decimal("0.00"),
                discountAmount: new Prisma.Decimal("0.00"),
                taxAmount: new Prisma.Decimal("0.00"),
                total: new Prisma.Decimal("0.00"),
                lineItems: [],
            });

            const result = await removeQuoteLineItem(
                WS_ID,
                QUOTE_ID,
                "line_01",
                adminActor,
            );

            expect(mocks.quoteLineItemDelete).toHaveBeenCalledWith({
                where: { id: "line_01" },
            });

            expect(mocks.quoteUpdate).toHaveBeenCalledWith({
                where: { id: QUOTE_ID },
                data: {
                    subtotal: new Prisma.Decimal("0.00"),
                    discountAmount: new Prisma.Decimal("0.00"),
                    taxAmount: new Prisma.Decimal("0.00"),
                    total: new Prisma.Decimal("0.00"),
                },
                include: expect.any(Object),
            });

            expect(result.subtotal).toBe("0.00");
            expect(result.total).toBe("0.00");
            expect(result.lineItems).toHaveLength(0);
        });
    });

    // ==========================================
    // 4. reorderQuoteLineItems
    // ==========================================
    describe("4. reorderQuoteLineItems", () => {
        const threeLineQuote = {
            ...mockQuoteDraft,
            lineItems: [
                { ...mockQuoteDraft.lineItems[0], id: "line_A", sortOrder: 0 },
                { ...mockQuoteDraft.lineItems[0], id: "line_B", sortOrder: 1 },
                { ...mockQuoteDraft.lineItems[0], id: "line_C", sortOrder: 2 },
            ],
        };

        it("rejects unauthorized actor", async () => {
            await expect(
                reorderQuoteLineItems(
                    WS_ID,
                    QUOTE_ID,
                    ["line_C", "line_A", "line_B"],
                    techActor,
                ),
            ).rejects.toThrow(ForbiddenError);
        });

        it("throws QuoteStatusConflictError if quote is not DRAFT", async () => {
            mocks.quoteFindFirst.mockResolvedValue({
                ...threeLineQuote,
                status: "CONVERTED",
            });

            await expect(
                reorderQuoteLineItems(
                    WS_ID,
                    QUOTE_ID,
                    ["line_C", "line_A", "line_B"],
                    adminActor,
                ),
            ).rejects.toThrow(QuoteStatusConflictError);
        });

        it("rejects when ordered IDs length does not match quote lines count", async () => {
            mocks.quoteFindFirst.mockResolvedValue(threeLineQuote);

            await expect(
                reorderQuoteLineItems(
                    WS_ID,
                    QUOTE_ID,
                    ["line_A", "line_B"], // Missing line_C
                    adminActor,
                ),
            ).rejects.toThrow(/expected 3 IDs/);
        });

        it("rejects duplicate IDs in ordered list", async () => {
            mocks.quoteFindFirst.mockResolvedValue(threeLineQuote);

            await expect(
                reorderQuoteLineItems(
                    WS_ID,
                    QUOTE_ID,
                    ["line_A", "line_A", "line_C"],
                    adminActor,
                ),
            ).rejects.toThrow(/duplicate/i);
        });

        it("rejects foreign line item IDs not in the quote", async () => {
            mocks.quoteFindFirst.mockResolvedValue(threeLineQuote);

            await expect(
                reorderQuoteLineItems(
                    WS_ID,
                    QUOTE_ID,
                    ["line_A", "line_B", "line_foreign_X"],
                    adminActor,
                ),
            ).rejects.toThrow(QuoteLineItemNotFoundError);
        });

        it("atomically updates sortOrder for each line and records audit history", async () => {
            mocks.quoteFindFirst.mockResolvedValue(threeLineQuote);
            mocks.quoteFindUniqueOrThrow.mockResolvedValue({
                ...threeLineQuote,
                lineItems: [
                    { ...threeLineQuote.lineItems[2], sortOrder: 0 },
                    { ...threeLineQuote.lineItems[0], sortOrder: 1 },
                    { ...threeLineQuote.lineItems[1], sortOrder: 2 },
                ],
            });

            const result = await reorderQuoteLineItems(
                WS_ID,
                QUOTE_ID,
                ["line_C", "line_A", "line_B"],
                adminActor,
            );

            expect(mocks.quoteLineItemUpdate).toHaveBeenNthCalledWith(1, {
                where: { id: "line_C" },
                data: { sortOrder: 0 },
            });
            expect(mocks.quoteLineItemUpdate).toHaveBeenNthCalledWith(2, {
                where: { id: "line_A" },
                data: { sortOrder: 1 },
            });
            expect(mocks.quoteLineItemUpdate).toHaveBeenNthCalledWith(3, {
                where: { id: "line_B" },
                data: { sortOrder: 2 },
            });

            expect(mocks.quoteHistoryCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        eventType: "LINE_ITEM_UPDATED",
                        field: "sortOrder",
                        metadata: {
                            action: "REORDER",
                            orderedLineItemIds: ["line_C", "line_A", "line_B"],
                        },
                    }),
                }),
            );

            expect(result.lineItems?.[0].id).toBe("line_C");
        });
    });

    // ==========================================
    // 5. Transaction Rollback & Deterministic Tie-Break
    // ==========================================
    describe("5. Transaction Rollback & Deterministic Tie-Break", () => {
        it("rolls back transaction atomically if quoteHistory audit creation fails", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteDraft);
            mocks.quoteHistoryCreate.mockRejectedValue(new Error("DB History Lock Failure"));

            await expect(
                addQuoteLineItem(
                    WS_ID,
                    QUOTE_ID,
                    { name: "Failing Line", quantity: 1, unitPrice: 100 },
                    adminActor,
                ),
            ).rejects.toThrow("DB History Lock Failure");
        });

        it("preserves deterministic tie-break remainder allocation when line set changes", async () => {
            // Equal lines with identical subtotals: sortOrder determines penny remainder candidate.
            // 2 lines with 100.00 each -> Gross 200.00. Fixed discount 33.33 -> remainder 0.01 goes to sortOrder 0.
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteDraft);

            const newLine = {
                id: "line_02",
                quoteId: QUOTE_ID,
                workspaceId: WS_ID,
                lineItemType: "CUSTOM",
                workTypeId: null,
                partId: null,
                name: "Equal Item",
                description: null,
                workTypeName: null,
                workTypeCode: null,
                partName: null,
                partSku: null,
                partUnitOfMeasure: null,
                quantity: new Prisma.Decimal("1.00"),
                unitPrice: new Prisma.Decimal("100.00"),
                unitCost: null,
                discountAmount: new Prisma.Decimal("0.00"),
                subtotal: new Prisma.Decimal("100.00"),
                taxRate: new Prisma.Decimal("0.0000"),
                taxAmount: new Prisma.Decimal("0.00"),
                total: new Prisma.Decimal("100.00"),
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            mocks.quoteLineItemCreate.mockResolvedValue(newLine);

            const quoteWithFixedDiscount = {
                ...mockQuoteDraft,
                discountType: "FIXED",
                discountValue: new Prisma.Decimal("33.33"),
                discountAmount: new Prisma.Decimal("33.33"),
                taxRate: new Prisma.Decimal("0.0000"),
                taxAmount: new Prisma.Decimal("0.00"),
                lineItems: [{ ...mockQuoteDraft.lineItems[0], taxRate: new Prisma.Decimal("0.0000") }],
            };

            mocks.quoteFindFirst.mockResolvedValue(quoteWithFixedDiscount);
            mocks.quoteUpdate.mockResolvedValue({
                ...quoteWithFixedDiscount,
                subtotal: new Prisma.Decimal("200.00"),
                total: new Prisma.Decimal("166.67"),
                lineItems: [quoteWithFixedDiscount.lineItems[0], newLine],
            });

            await addQuoteLineItem(
                WS_ID,
                QUOTE_ID,
                { name: "Equal Item", quantity: 1, unitPrice: 100, taxRate: 0 },
                adminActor,
            );

            // Line 01 (sortOrder 0) gets allocated discount 16.67 (received the remainder!), Line 02 gets 16.66
            expect(mocks.quoteLineItemUpdate).toHaveBeenCalledWith({
                where: { id: "line_01" },
                data: expect.objectContaining({
                    total: new Prisma.Decimal("83.33"), // 100 - 16.67 = 83.33
                }),
            });

            expect(mocks.quoteLineItemUpdate).toHaveBeenCalledWith({
                where: { id: "line_02" },
                data: expect.objectContaining({
                    total: new Prisma.Decimal("83.34"), // 100 - 16.66 = 83.34
                }),
            });
        });
    });
});
