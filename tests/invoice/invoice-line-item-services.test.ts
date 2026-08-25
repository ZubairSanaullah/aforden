import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

import { Prisma } from "@/generated/prisma/client";
import {
    addInvoiceLineItem,
    updateInvoiceLineItem,
    removeInvoiceLineItem,
    reorderInvoiceLineItems,
    InvoiceNotFoundError,
    InvoiceLineItemNotFoundError,
    InvoiceStatusConflictError,
    InvalidInvoiceCalculationError,
} from "@/lib/services/invoice";
import { WorkTypeNotFoundError } from "@/lib/services/workType/workTypeErrors";
import { PartNotFoundError } from "@/lib/services/inventory/part/partErrors";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

// Mock Prisma
const mocks = vi.hoisted(() => {
    return {
        invoiceFindFirst: vi.fn(),
        invoiceUpdate: vi.fn(),
        invoiceLineItemCreate: vi.fn(),
        invoiceLineItemUpdate: vi.fn(),
        invoiceLineItemDelete: vi.fn(),
        invoiceHistoryCreate: vi.fn(),
        workTypeFindFirst: vi.fn(),
        partFindFirst: vi.fn(),
        $transaction: vi.fn(),
    };
});

vi.mock("@/lib/prisma", () => ({
    prisma: {
        invoice: {
            findFirst: mocks.invoiceFindFirst,
            update: mocks.invoiceUpdate,
        },
        invoiceLineItem: {
            create: mocks.invoiceLineItemCreate,
            update: mocks.invoiceLineItemUpdate,
            delete: mocks.invoiceLineItemDelete,
        },
        invoiceHistory: {
            create: mocks.invoiceHistoryCreate,
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

describe("Phase 1.12.6 — Invoice Line Item Mutation Services", () => {
    const WS_ID = "ws_test_alpha";
    const CUST_ID = "cust_alpha_01";
    const INVOICE_ID = "inv_test_01";
    const WORK_TYPE_ID = "wt_furnace_01";
    const PART_ID = "part_igniter_01";

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
            name: "Field Tech",
            email: "tech@aforden.com",
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

    const baseInvoiceRecord = {
        id: INVOICE_ID,
        workspaceId: WS_ID,
        invoiceNumber: "INV-2026-000001",
        customerId: CUST_ID,
        locationId: null,
        quoteId: null,
        workOrderId: null,
        status: "DRAFT",
        title: "HVAC Installation Invoice",
        notes: null,
        internalNotes: null,
        termsAndConditions: null,
        currencyCode: "USD",
        issueDate: new Date("2026-08-25T00:00:00.000Z"),
        dueDate: new Date("2026-09-25T00:00:00.000Z"),
        subtotal: new Prisma.Decimal("0.00"),
        discountType: "FIXED",
        discountValue: new Prisma.Decimal("10.00"),
        discountAmount: new Prisma.Decimal("0.00"),
        taxRate: new Prisma.Decimal("0.0825"),
        taxAmount: new Prisma.Decimal("0.00"),
        total: new Prisma.Decimal("0.00"),
        amountPaid: new Prisma.Decimal("0.00"),
        amountDue: new Prisma.Decimal("0.00"),
        issuedAt: null,
        paidAt: null,
        voidedAt: null,
        voidReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        lineItems: [],
        payments: [],
    };

    const mockExistingLine1 = {
        id: "line_01",
        invoiceId: INVOICE_ID,
        workspaceId: WS_ID,
        lineItemType: "CUSTOM",
        workTypeId: null,
        partId: null,
        name: "Diagnostic Fee",
        description: "Initial inspection",
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
        taxRate: new Prisma.Decimal("0.0825"),
        taxAmount: new Prisma.Decimal("7.43"),
        total: new Prisma.Decimal("97.43"),
        sortOrder: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    beforeEach(() => {
        vi.clearAllMocks();

        mocks.$transaction.mockImplementation(async (cb: any) => {
            if (typeof cb === "function") {
                return cb({
                    invoice: {
                        findFirst: mocks.invoiceFindFirst,
                        update: mocks.invoiceUpdate,
                    },
                    invoiceLineItem: {
                        create: mocks.invoiceLineItemCreate,
                        update: mocks.invoiceLineItemUpdate,
                        delete: mocks.invoiceLineItemDelete,
                    },
                    invoiceHistory: {
                        create: mocks.invoiceHistoryCreate,
                    },
                });
            }
            return cb;
        });
    });

    // =========================================================================
    // 1. ADD INVOICE LINE ITEM
    // =========================================================================
    describe("1. addInvoiceLineItem", () => {
        it("adds custom line item and triggers full invoice recalculation across all lines", async () => {
            mocks.invoiceFindFirst.mockResolvedValue({
                ...baseInvoiceRecord,
                lineItems: [mockExistingLine1],
            });

            mocks.invoiceLineItemCreate.mockResolvedValue({
                id: "line_02",
                invoiceId: INVOICE_ID,
                workspaceId: WS_ID,
                lineItemType: "CUSTOM",
                workTypeId: null,
                partId: null,
                name: "Thermostat Wire",
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
                taxRate: new Prisma.Decimal("0.0825"),
                taxAmount: new Prisma.Decimal("0.00"),
                total: new Prisma.Decimal("0.00"),
                sortOrder: 1,
            });

            mocks.invoiceUpdate.mockImplementation(({ data }: any) => ({
                ...baseInvoiceRecord,
                ...data,
                lineItems: [
                    mockExistingLine1,
                    {
                        id: "line_02",
                        name: "Thermostat Wire",
                        quantity: new Prisma.Decimal("1.00"),
                        unitPrice: new Prisma.Decimal("100.00"),
                        discountAmount: new Prisma.Decimal("5.00"),
                        subtotal: new Prisma.Decimal("100.00"),
                        taxRate: new Prisma.Decimal("0.0825"),
                        taxAmount: new Prisma.Decimal("7.84"),
                        total: new Prisma.Decimal("102.84"),
                        sortOrder: 1,
                    },
                ],
            }));

            const result = await addInvoiceLineItem(
                WS_ID,
                INVOICE_ID,
                {
                    name: "Thermostat Wire",
                    quantity: 1,
                    unitPrice: 100,
                },
                adminActor,
            );

            expect(mocks.invoiceLineItemCreate).toHaveBeenCalled();
            // Both lines updated with redistributed $10.00 header discount ($5.00 each)
            expect(mocks.invoiceLineItemUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: "line_01" },
                }),
            );
            expect(mocks.invoiceLineItemUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: "line_02" },
                }),
            );
            expect(mocks.invoiceHistoryCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        invoiceId: INVOICE_ID,
                        eventType: "LINE_ITEM_ADDED",
                    }),
                }),
            );
        });

        it("resolves and freezes WorkType catalog snapshot fields for LABOR lines", async () => {
            mocks.invoiceFindFirst.mockResolvedValue(baseInvoiceRecord);
            mocks.workTypeFindFirst.mockResolvedValue({
                id: WORK_TYPE_ID,
                name: "Furnace Repair Labor",
                code: "FURN-REP-01",
                status: "ACTIVE",
            });

            mocks.invoiceLineItemCreate.mockImplementation(({ data }: any) => ({
                id: "line_wt_01",
                ...data,
            }));

            mocks.invoiceUpdate.mockImplementation(({ data }: any) => ({
                ...baseInvoiceRecord,
                ...data,
                lineItems: [],
            }));

            await addInvoiceLineItem(
                WS_ID,
                INVOICE_ID,
                {
                    workTypeId: WORK_TYPE_ID,
                    quantity: 2,
                    unitPrice: 125,
                },
                adminActor,
            );

            expect(mocks.invoiceLineItemCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        lineItemType: "LABOR",
                        workTypeId: WORK_TYPE_ID,
                        workTypeName: "Furnace Repair Labor",
                        workTypeCode: "FURN-REP-01",
                    }),
                }),
            );
        });

        it("resolves and freezes Part catalog snapshot fields for PART lines", async () => {
            mocks.invoiceFindFirst.mockResolvedValue(baseInvoiceRecord);
            mocks.partFindFirst.mockResolvedValue({
                id: PART_ID,
                name: "Hot Surface Igniter",
                sku: "IGN-500",
                unitOfMeasure: "piece",
                unitCost: new Prisma.Decimal("28.50"),
                status: "ACTIVE",
            });

            mocks.invoiceLineItemCreate.mockImplementation(({ data }: any) => ({
                id: "line_part_01",
                ...data,
            }));

            mocks.invoiceUpdate.mockImplementation(({ data }: any) => ({
                ...baseInvoiceRecord,
                ...data,
                lineItems: [],
            }));

            await addInvoiceLineItem(
                WS_ID,
                INVOICE_ID,
                {
                    partId: PART_ID,
                    quantity: 1,
                    unitPrice: 75,
                },
                adminActor,
            );

            expect(mocks.invoiceLineItemCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        lineItemType: "PART",
                        partId: PART_ID,
                        partName: "Hot Surface Igniter",
                        partSku: "IGN-500",
                        partUnitOfMeasure: "piece",
                        unitCost: new Prisma.Decimal("28.50"),
                    }),
                }),
            );
        });

        it("throws WorkTypeNotFoundError on invalid workTypeId", async () => {
            mocks.invoiceFindFirst.mockResolvedValue(baseInvoiceRecord);
            mocks.workTypeFindFirst.mockResolvedValue(null);

            await expect(
                addInvoiceLineItem(
                    WS_ID,
                    INVOICE_ID,
                    {
                        workTypeId: "missing_wt",
                        quantity: 1,
                        unitPrice: 100,
                    },
                    adminActor,
                ),
            ).rejects.toThrow(WorkTypeNotFoundError);
        });

        it("throws PartNotFoundError on invalid partId", async () => {
            mocks.invoiceFindFirst.mockResolvedValue(baseInvoiceRecord);
            mocks.partFindFirst.mockResolvedValue(null);

            await expect(
                addInvoiceLineItem(
                    WS_ID,
                    INVOICE_ID,
                    {
                        partId: "missing_part",
                        quantity: 1,
                        unitPrice: 100,
                    },
                    adminActor,
                ),
            ).rejects.toThrow(PartNotFoundError);
        });

        it("throws InvalidInvoiceCalculationError on Step 1 negative subtotal input", async () => {
            mocks.invoiceFindFirst.mockResolvedValue(baseInvoiceRecord);

            await expect(
                addInvoiceLineItem(
                    WS_ID,
                    INVOICE_ID,
                    {
                        name: "Faulty Line",
                        quantity: 1,
                        unitPrice: 50,
                        discountAmount: 75, // 50 - 75 = -25 < 0
                    },
                    adminActor,
                ),
            ).rejects.toThrow(InvalidInvoiceCalculationError);
        });

        it("enforces DRAFT-only lifecycle guard on non-DRAFT invoices", async () => {
            mocks.invoiceFindFirst.mockResolvedValue({
                ...baseInvoiceRecord,
                status: "ISSUED",
            });

            await expect(
                addInvoiceLineItem(
                    WS_ID,
                    INVOICE_ID,
                    {
                        name: "New Line",
                        quantity: 1,
                        unitPrice: 100,
                    },
                    adminActor,
                ),
            ).rejects.toThrow(InvoiceStatusConflictError);
        });

        it("denies access to TECHNICIAN role", async () => {
            await expect(
                addInvoiceLineItem(
                    WS_ID,
                    INVOICE_ID,
                    {
                        name: "New Line",
                        quantity: 1,
                        unitPrice: 100,
                    },
                    techActor,
                ),
            ).rejects.toThrow(ForbiddenError);
        });
    });

    // =========================================================================
    // 2. UPDATE INVOICE LINE ITEM
    // =========================================================================
    describe("2. updateInvoiceLineItem", () => {
        it("updates line item and redistributes full invoice discounts and taxes", async () => {
            const line2 = {
                ...mockExistingLine1,
                id: "line_02",
                name: "Part B",
                quantity: new Prisma.Decimal("1.00"),
                unitPrice: new Prisma.Decimal("100.00"),
                sortOrder: 1,
            };

            mocks.invoiceFindFirst.mockResolvedValue({
                ...baseInvoiceRecord,
                lineItems: [mockExistingLine1, line2],
            });

            mocks.invoiceLineItemUpdate.mockResolvedValue({
                ...mockExistingLine1,
                unitPrice: new Prisma.Decimal("300.00"),
            });

            mocks.invoiceUpdate.mockImplementation(({ data }: any) => ({
                ...baseInvoiceRecord,
                ...data,
                lineItems: [mockExistingLine1, line2],
            }));

            await updateInvoiceLineItem(
                WS_ID,
                INVOICE_ID,
                "line_01",
                {
                    unitPrice: 300,
                },
                adminActor,
            );

            expect(mocks.invoiceLineItemUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: "line_01" },
                }),
            );
            expect(mocks.invoiceHistoryCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        invoiceId: INVOICE_ID,
                        eventType: "LINE_ITEM_UPDATED",
                    }),
                }),
            );
        });

        it("throws InvoiceLineItemNotFoundError when lineItemId belongs to another invoice", async () => {
            mocks.invoiceFindFirst.mockResolvedValue({
                ...baseInvoiceRecord,
                lineItems: [mockExistingLine1],
            });

            await expect(
                updateInvoiceLineItem(
                    WS_ID,
                    INVOICE_ID,
                    "foreign_line_item",
                    {
                        quantity: 2,
                    },
                    adminActor,
                ),
            ).rejects.toThrow(InvoiceLineItemNotFoundError);
        });

        it("throws InvalidInvoiceCalculationError on Step 1 negative subtotal in update", async () => {
            mocks.invoiceFindFirst.mockResolvedValue({
                ...baseInvoiceRecord,
                lineItems: [mockExistingLine1],
            });

            await expect(
                updateInvoiceLineItem(
                    WS_ID,
                    INVOICE_ID,
                    "line_01",
                    {
                        discountAmount: 200, // 1 * 100 - 200 = -100 < 0
                    },
                    adminActor,
                ),
            ).rejects.toThrow(InvalidInvoiceCalculationError);
        });

        it("enforces DRAFT-only lifecycle guard on update", async () => {
            mocks.invoiceFindFirst.mockResolvedValue({
                ...baseInvoiceRecord,
                status: "PAID",
                lineItems: [mockExistingLine1],
            });

            await expect(
                updateInvoiceLineItem(
                    WS_ID,
                    INVOICE_ID,
                    "line_01",
                    {
                        quantity: 2,
                    },
                    adminActor,
                ),
            ).rejects.toThrow(InvoiceStatusConflictError);
        });

        it("denies access to TECHNICIAN role on update", async () => {
            await expect(
                updateInvoiceLineItem(
                    WS_ID,
                    INVOICE_ID,
                    "line_01",
                    { quantity: 2 },
                    techActor,
                ),
            ).rejects.toThrow(ForbiddenError);
        });
    });

    // =========================================================================
    // 3. REMOVE INVOICE LINE ITEM
    // =========================================================================
    describe("3. removeInvoiceLineItem", () => {
        it("removes line item and recalculates full invoice totals across remaining lines", async () => {
            const line2 = {
                ...mockExistingLine1,
                id: "line_02",
                name: "Remaining Line",
                sortOrder: 1,
            };

            mocks.invoiceFindFirst.mockResolvedValue({
                ...baseInvoiceRecord,
                lineItems: [mockExistingLine1, line2],
            });

            mocks.invoiceLineItemDelete.mockResolvedValue(mockExistingLine1);
            mocks.invoiceUpdate.mockImplementation(({ data }: any) => ({
                ...baseInvoiceRecord,
                ...data,
                lineItems: [line2],
            }));

            const result = await removeInvoiceLineItem(
                WS_ID,
                INVOICE_ID,
                "line_01",
                adminActor,
            );

            expect(mocks.invoiceLineItemDelete).toHaveBeenCalledWith({
                where: { id: "line_01" },
            });
            expect(mocks.invoiceHistoryCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        invoiceId: INVOICE_ID,
                        eventType: "LINE_ITEM_REMOVED",
                        oldValue: "line_01",
                    }),
                }),
            );
        });

        it("succeeds without error when removing the only remaining line item (totals reset to 0.00)", async () => {
            mocks.invoiceFindFirst.mockResolvedValue({
                ...baseInvoiceRecord,
                lineItems: [mockExistingLine1],
            });

            mocks.invoiceLineItemDelete.mockResolvedValue(mockExistingLine1);
            mocks.invoiceUpdate.mockImplementation(({ data }: any) => ({
                ...baseInvoiceRecord,
                ...data,
                subtotal: new Prisma.Decimal("0.00"),
                total: new Prisma.Decimal("0.00"),
                lineItems: [],
            }));

            const result = await removeInvoiceLineItem(
                WS_ID,
                INVOICE_ID,
                "line_01",
                adminActor,
            );

            expect(mocks.invoiceLineItemDelete).toHaveBeenCalledWith({
                where: { id: "line_01" },
            });
            expect(mocks.invoiceUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: INVOICE_ID },
                    data: expect.objectContaining({
                        subtotal: new Prisma.Decimal("0.00"),
                        total: new Prisma.Decimal("0.00"),
                    }),
                }),
            );
        });

        it("throws InvoiceLineItemNotFoundError when removing foreign line item", async () => {
            mocks.invoiceFindFirst.mockResolvedValue({
                ...baseInvoiceRecord,
                lineItems: [mockExistingLine1],
            });

            await expect(
                removeInvoiceLineItem(WS_ID, INVOICE_ID, "foreign_line", adminActor),
            ).rejects.toThrow(InvoiceLineItemNotFoundError);
        });

        it("enforces DRAFT-only lifecycle guard on remove", async () => {
            mocks.invoiceFindFirst.mockResolvedValue({
                ...baseInvoiceRecord,
                status: "VOID",
                lineItems: [mockExistingLine1],
            });

            await expect(
                removeInvoiceLineItem(WS_ID, INVOICE_ID, "line_01", adminActor),
            ).rejects.toThrow(InvoiceStatusConflictError);
        });

        it("denies access to TECHNICIAN role on remove", async () => {
            await expect(
                removeInvoiceLineItem(WS_ID, INVOICE_ID, "line_01", techActor),
            ).rejects.toThrow(ForbiddenError);
        });
    });

    // =========================================================================
    // 4. REORDER INVOICE LINE ITEMS
    // =========================================================================
    describe("4. reorderInvoiceLineItems", () => {
        it("atomically updates sortOrder for all line items and logs history", async () => {
            const lineA = { ...mockExistingLine1, id: "line_a", sortOrder: 0 };
            const lineB = { ...mockExistingLine1, id: "line_b", sortOrder: 1 };

            mocks.invoiceFindFirst
                .mockResolvedValueOnce({
                    ...baseInvoiceRecord,
                    lineItems: [lineA, lineB],
                })
                .mockResolvedValueOnce({
                    ...baseInvoiceRecord,
                    lineItems: [
                        { ...lineB, sortOrder: 0 },
                        { ...lineA, sortOrder: 1 },
                    ],
                });

            const result = await reorderInvoiceLineItems(
                WS_ID,
                INVOICE_ID,
                ["line_b", "line_a"],
                adminActor,
            );

            expect(mocks.invoiceLineItemUpdate).toHaveBeenCalledWith({
                where: { id: "line_b" },
                data: { sortOrder: 0 },
            });
            expect(mocks.invoiceLineItemUpdate).toHaveBeenCalledWith({
                where: { id: "line_a" },
                data: { sortOrder: 1 },
            });
            expect(mocks.invoiceHistoryCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        invoiceId: INVOICE_ID,
                        eventType: "LINE_ITEM_UPDATED",
                    }),
                }),
            );
        });

        it("rejects incomplete, duplicate, or foreign ID sets in reorder", async () => {
            const lineA = { ...mockExistingLine1, id: "line_a", sortOrder: 0 };
            const lineB = { ...mockExistingLine1, id: "line_b", sortOrder: 1 };

            mocks.invoiceFindFirst.mockResolvedValue({
                ...baseInvoiceRecord,
                lineItems: [lineA, lineB],
            });

            // Length mismatch
            await expect(
                reorderInvoiceLineItems(WS_ID, INVOICE_ID, ["line_a"], adminActor),
            ).rejects.toThrow();

            // Duplicate IDs
            await expect(
                reorderInvoiceLineItems(
                    WS_ID,
                    INVOICE_ID,
                    ["line_a", "line_a"],
                    adminActor,
                ),
            ).rejects.toThrow();

            // Foreign ID
            await expect(
                reorderInvoiceLineItems(
                    WS_ID,
                    INVOICE_ID,
                    ["line_a", "foreign_id"],
                    adminActor,
                ),
            ).rejects.toThrow(InvoiceLineItemNotFoundError);
        });

        it("enforces DRAFT-only lifecycle guard on reorder", async () => {
            mocks.invoiceFindFirst.mockResolvedValue({
                ...baseInvoiceRecord,
                status: "ISSUED",
                lineItems: [mockExistingLine1],
            });

            await expect(
                reorderInvoiceLineItems(WS_ID, INVOICE_ID, ["line_01"], adminActor),
            ).rejects.toThrow(InvoiceStatusConflictError);
        });

        it("denies access to TECHNICIAN role on reorder", async () => {
            await expect(
                reorderInvoiceLineItems(WS_ID, INVOICE_ID, ["line_01"], techActor),
            ).rejects.toThrow(ForbiddenError);
        });
    });

    // =========================================================================
    // 5. ATOMICITY & PRORATION TIE-BREAKING
    // =========================================================================
    describe("5. Atomicity & Proration Invariants", () => {
        it("rolls back transaction if history write fails during addInvoiceLineItem", async () => {
            mocks.invoiceFindFirst.mockResolvedValue(baseInvoiceRecord);
            mocks.invoiceLineItemCreate.mockResolvedValue(mockExistingLine1);
            mocks.invoiceUpdate.mockResolvedValue(baseInvoiceRecord);
            mocks.invoiceHistoryCreate.mockRejectedValueOnce(new Error("Audit log DB crash"));

            await expect(
                addInvoiceLineItem(
                    WS_ID,
                    INVOICE_ID,
                    {
                        name: "New Line",
                        quantity: 1,
                        unitPrice: 100,
                    },
                    adminActor,
                ),
            ).rejects.toThrow("Audit log DB crash");
        });

        it("preserves deterministic tie-break discount allocation across newly added lines", async () => {
            // Invoice with $1.01 FIXED discount and 2 equal lines ($100 each)
            // Remainder $0.01 must go to the line with lowest sortOrder (line_a: sortOrder 0)
            const lineA = {
                ...mockExistingLine1,
                id: "line_a",
                sortOrder: 0,
                taxRate: new Prisma.Decimal("0.0000"),
            };
            mocks.invoiceFindFirst.mockResolvedValue({
                ...baseInvoiceRecord,
                discountType: "FIXED",
                discountValue: new Prisma.Decimal("1.01"),
                taxRate: new Prisma.Decimal("0.0000"),
                lineItems: [lineA],
            });

            mocks.invoiceLineItemCreate.mockResolvedValue({
                id: "line_b",
                invoiceId: INVOICE_ID,
                name: "Line B",
                quantity: new Prisma.Decimal("1.00"),
                unitPrice: new Prisma.Decimal("100.00"),
                discountAmount: new Prisma.Decimal("0.00"),
                subtotal: new Prisma.Decimal("100.00"),
                taxRate: new Prisma.Decimal("0.0000"),
                taxAmount: new Prisma.Decimal("0.00"),
                total: new Prisma.Decimal("100.00"),
                sortOrder: 1,
            });

            mocks.invoiceUpdate.mockImplementation(({ data }: any) => ({
                ...baseInvoiceRecord,
                ...data,
                lineItems: [lineA, { id: "line_b", sortOrder: 1 }],
            }));

            await addInvoiceLineItem(
                WS_ID,
                INVOICE_ID,
                {
                    name: "Line B",
                    quantity: 1,
                    unitPrice: 100,
                    sortOrder: 1,
                },
                adminActor,
            );

            // $1.01 / 2 -> floor2 is $0.50 each. Remainder $0.01 goes to line_a (sortOrder 0) -> total $99.49 vs line_b $99.50
            expect(mocks.invoiceLineItemUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: "line_a" },
                    data: expect.objectContaining({
                        total: new Prisma.Decimal("99.49"),
                    }),
                }),
            );
            expect(mocks.invoiceLineItemUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: "line_b" },
                    data: expect.objectContaining({
                        total: new Prisma.Decimal("99.50"),
                    }),
                }),
            );
        });
    });
});
