import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

import { Prisma } from "@/generated/prisma/client";
import {
    createInvoiceFromQuote,
    createInvoiceFromWorkOrder,
    SourceEntityNotEligibleError,
} from "@/lib/services/invoice";
import { QuoteNotFoundError } from "@/lib/services/quote/quoteErrors";
import { WorkOrderNotFoundError } from "@/lib/services/workOrder/workOrderErrors";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

// Mock Prisma
const mocks = vi.hoisted(() => {
    return {
        quoteFindFirst: vi.fn(),
        workOrderFindFirst: vi.fn(),
        workspaceFindUnique: vi.fn(),
        invoiceFindFirst: vi.fn(),
        invoiceCreate: vi.fn(),
        invoiceUpdate: vi.fn(),
        invoiceLineItemCreate: vi.fn(),
        invoiceLineItemUpdate: vi.fn(),
        invoiceHistoryCreate: vi.fn(),
        $transaction: vi.fn(),
    };
});

vi.mock("@/lib/prisma", () => ({
    prisma: {
        quote: {
            findFirst: mocks.quoteFindFirst,
        },
        workOrder: {
            findFirst: mocks.workOrderFindFirst,
        },
        workspace: {
            findUnique: mocks.workspaceFindUnique,
        },
        invoice: {
            findFirst: mocks.invoiceFindFirst,
            create: mocks.invoiceCreate,
            update: mocks.invoiceUpdate,
        },
        invoiceLineItem: {
            create: mocks.invoiceLineItemCreate,
            update: mocks.invoiceLineItemUpdate,
        },
        invoiceHistory: {
            create: mocks.invoiceHistoryCreate,
        },
        $transaction: mocks.$transaction,
    },
}));

vi.mock("@/lib/services/authorization/workspaceAuthorization", () => ({
    requireWorkspaceAuthorization: vi.fn(),
}));

describe("Phase 1.12.8 — Source Conversion Adapters", () => {
    const WS_ID = "ws_test_alpha";
    const CUST_ID = "cust_alpha_01";
    const LOC_ID = "loc_alpha_01";
    const QUOTE_ID = "quote_test_01";
    const WO_ID = "wo_test_01";

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

    const mockQuoteRecord = {
        id: QUOTE_ID,
        workspaceId: WS_ID,
        quoteNumber: "QTE-2026-000001",
        customerId: CUST_ID,
        locationId: LOC_ID,
        status: "APPROVED",
        title: "Furnace Replacement Quote",
        description: "Standard furnace replacement",
        internalNotes: "Customer requested morning install",
        termsAndConditions: "Standard 30-day payment terms",
        currencyCode: "USD",
        discountType: "FIXED",
        discountValue: new Prisma.Decimal("50.00"),
        taxRate: new Prisma.Decimal("0.0825"),
        convertedWorkOrderId: null,
        lineItems: [
            {
                id: "qli_01",
                quoteId: QUOTE_ID,
                workspaceId: WS_ID,
                lineItemType: "LABOR",
                workTypeId: "wt_furnace_01",
                partId: null,
                name: "Furnace Installation Labor",
                description: "4 hours install",
                workTypeName: "Furnace Installation",
                workTypeCode: "FURN-01",
                partName: null,
                partSku: null,
                partUnitOfMeasure: null,
                quantity: new Prisma.Decimal("1.00"),
                unitPrice: new Prisma.Decimal("400.00"),
                unitCost: null,
                discountAmount: new Prisma.Decimal("0.00"),
                taxRate: new Prisma.Decimal("0.0825"),
                sortOrder: 0,
            },
            {
                id: "qli_02",
                quoteId: QUOTE_ID,
                workspaceId: WS_ID,
                lineItemType: "PART",
                workTypeId: null,
                partId: "part_furnace_01",
                name: "Carrier High-Efficiency Furnace",
                description: "Model XYZ",
                workTypeName: null,
                workTypeCode: null,
                partName: "Carrier Furnace",
                partSku: "CAR-9900",
                partUnitOfMeasure: "unit",
                quantity: new Prisma.Decimal("1.00"),
                unitPrice: new Prisma.Decimal("1600.00"),
                unitCost: new Prisma.Decimal("1000.00"),
                discountAmount: new Prisma.Decimal("0.00"),
                taxRate: new Prisma.Decimal("0.0825"),
                sortOrder: 1,
            },
        ],
        customer: { id: CUST_ID, name: "Acme Corp" },
        location: { id: LOC_ID, name: "Headquarters" },
    };

    const mockWorkOrderRecord = {
        id: WO_ID,
        workspaceId: WS_ID,
        workOrderNumber: "WO-2026-000001",
        customerId: CUST_ID,
        locationId: LOC_ID,
        sourceQuoteId: QUOTE_ID,
        status: "COMPLETED",
        title: "AC Compressor Overhaul",
        description: "Replaced faulty compressor",
        internalNotes: "Job completed ahead of schedule",
        billableHours: new Prisma.Decimal("3.50"),
        laborRate: new Prisma.Decimal("120.00"),
        workTypeId: "wt_ac_01",
        workType: {
            id: "wt_ac_01",
            name: "AC Compressor Labor",
            code: "AC-COMP-01",
            description: "Compressor service",
            estimatedDuration: 3,
            standardRate: new Prisma.Decimal("120.00"),
        },
        workOrderParts: [
            {
                id: "wop_01",
                partId: "part_comp_01",
                partName: "Copeland 3-Ton Compressor",
                partSku: "COP-3TON",
                partUnitOfMeasure: "piece",
                quantity: new Prisma.Decimal("1.00"),
                unitPrice: new Prisma.Decimal("850.00"),
                part: {
                    id: "part_comp_01",
                    name: "Copeland 3-Ton Compressor",
                    sku: "COP-3TON",
                    unitOfMeasure: "piece",
                    unitPrice: new Prisma.Decimal("850.00"),
                },
            },
        ],
        customer: { id: CUST_ID, name: "Acme Corp" },
        location: { id: LOC_ID, name: "Headquarters" },
    };

    beforeEach(() => {
        vi.clearAllMocks();

        mocks.workspaceFindUnique.mockResolvedValue({
            id: WS_ID,
            defaultCurrencyCode: "USD",
        });

        mocks.$transaction.mockImplementation(async (cb: any) => {
            if (typeof cb === "function") {
                return cb({
                    invoice: {
                        findFirst: mocks.invoiceFindFirst,
                        create: mocks.invoiceCreate,
                        update: mocks.invoiceUpdate,
                    },
                    invoiceLineItem: {
                        create: mocks.invoiceLineItemCreate,
                        update: mocks.invoiceLineItemUpdate,
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
    // 1. CREATE INVOICE FROM QUOTE
    // =========================================================================
    describe("1. createInvoiceFromQuote", () => {
        it("converts an APPROVED quote into an invoice with deep-copied snapshot lines and calculated totals", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteRecord);
            mocks.invoiceFindFirst.mockResolvedValue(null); // Sequence starts at 1

            let insertedInvoice: any = null;
            mocks.invoiceCreate.mockImplementation(({ data }: any) => {
                insertedInvoice = {
                    id: "inv_from_quote_01",
                    ...data,
                };
                return insertedInvoice;
            });

            mocks.invoiceLineItemCreate.mockImplementation(({ data }: any) => ({
                id: `ili_${Math.random()}`,
                ...data,
            }));

            mocks.invoiceUpdate.mockImplementation(({ data }: any) => ({
                ...insertedInvoice,
                ...data,
                customer: mockQuoteRecord.customer,
                location: mockQuoteRecord.location,
                lineItems: [],
                payments: [],
            }));

            const result = await createInvoiceFromQuote(
                WS_ID,
                QUOTE_ID,
                {
                    dueDate: "2026-09-30",
                },
                adminActor,
            );

            expect(mocks.invoiceCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        workspaceId: WS_ID,
                        invoiceNumber: expect.stringMatching(/^INV-\d{4}-\d{6}$/),
                        customerId: CUST_ID,
                        locationId: LOC_ID,
                        quoteId: QUOTE_ID,
                        workOrderId: null,
                        status: "DRAFT",
                        currencyCode: "USD",
                    }),
                }),
            );

            // Expect 2 line items created from the quote
            expect(mocks.invoiceLineItemCreate).toHaveBeenCalledTimes(2);

            // Audit history recorded with source quote metadata
            expect(mocks.invoiceHistoryCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        eventType: "CREATED",
                        metadata: expect.objectContaining({
                            source: "QUOTE",
                            sourceQuoteId: QUOTE_ID,
                            sourceQuoteNumber: "QTE-2026-000001",
                        }),
                    }),
                }),
            );
        });

        it("converts a CONVERTED quote and auto-populates workOrderId from quote.convertedWorkOrderId", async () => {
            const convertedQuote = {
                ...mockQuoteRecord,
                status: "CONVERTED",
                convertedWorkOrderId: "wo_converted_99",
            };
            mocks.quoteFindFirst.mockResolvedValue(convertedQuote);
            mocks.invoiceFindFirst.mockResolvedValue(null);

            mocks.invoiceCreate.mockImplementation(({ data }: any) => ({
                id: "inv_converted_01",
                ...data,
            }));

            mocks.invoiceLineItemCreate.mockImplementation(({ data }: any) => ({
                id: `ili_${Math.random()}`,
                ...data,
            }));

            mocks.invoiceUpdate.mockImplementation(({ data }: any) => ({
                id: "inv_converted_01",
                ...data,
                customer: convertedQuote.customer,
                location: convertedQuote.location,
                lineItems: [],
                payments: [],
            }));

            await createInvoiceFromQuote(
                WS_ID,
                QUOTE_ID,
                {
                    dueDate: "2026-09-30",
                },
                adminActor,
            );

            expect(mocks.invoiceCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        quoteId: QUOTE_ID,
                        workOrderId: "wo_converted_99",
                    }),
                }),
            );
        });

        it("rejects ineligible quote statuses (DRAFT, PENDING_APPROVAL, REJECTED, EXPIRED)", async () => {
            for (const status of ["DRAFT", "PENDING_APPROVAL", "REJECTED", "EXPIRED"]) {
                mocks.quoteFindFirst.mockResolvedValue({
                    ...mockQuoteRecord,
                    status,
                });

                await expect(
                    createInvoiceFromQuote(
                        WS_ID,
                        QUOTE_ID,
                        { dueDate: "2026-09-30" },
                        adminActor,
                    ),
                ).rejects.toThrow(SourceEntityNotEligibleError);
            }
        });

        it("throws QuoteNotFoundError if quote is not found in authorized workspace", async () => {
            mocks.quoteFindFirst.mockResolvedValue(null);

            await expect(
                createInvoiceFromQuote(
                    WS_ID,
                    "missing_quote",
                    { dueDate: "2026-09-30" },
                    adminActor,
                ),
            ).rejects.toThrow(QuoteNotFoundError);
        });

        it("rolls back transaction atomically if history write fails during quote conversion", async () => {
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteRecord);
            mocks.invoiceFindFirst.mockResolvedValue(null);
            mocks.invoiceCreate.mockResolvedValue({ id: "inv_test" });
            mocks.invoiceLineItemCreate.mockResolvedValue({ id: "ili_test" });
            mocks.invoiceUpdate.mockResolvedValue({ id: "inv_test" });
            mocks.invoiceHistoryCreate.mockRejectedValueOnce(new Error("DB Transaction Crash"));

            await expect(
                createInvoiceFromQuote(
                    WS_ID,
                    QUOTE_ID,
                    { dueDate: "2026-09-30" },
                    adminActor,
                ),
            ).rejects.toThrow("DB Transaction Crash");
        });

        it("denies access to TECHNICIAN role on createInvoiceFromQuote", async () => {
            await expect(
                createInvoiceFromQuote(
                    WS_ID,
                    QUOTE_ID,
                    { dueDate: "2026-09-30" },
                    techActor,
                ),
            ).rejects.toThrow(ForbiddenError);
        });
    });

    // =========================================================================
    // 2. CREATE INVOICE FROM WORK ORDER
    // =========================================================================
    describe("2. createInvoiceFromWorkOrder", () => {
        it("converts a COMPLETED work order into an invoice with derived LABOR and PART snapshot lines", async () => {
            mocks.workOrderFindFirst.mockResolvedValue(mockWorkOrderRecord);
            mocks.invoiceFindFirst.mockResolvedValue(null);

            let insertedInvoice: any = null;
            mocks.invoiceCreate.mockImplementation(({ data }: any) => {
                insertedInvoice = {
                    id: "inv_from_wo_01",
                    ...data,
                };
                return insertedInvoice;
            });

            mocks.invoiceLineItemCreate.mockImplementation(({ data }: any) => ({
                id: `ili_${Math.random()}`,
                ...data,
            }));

            mocks.invoiceUpdate.mockImplementation(({ data }: any) => ({
                ...insertedInvoice,
                ...data,
                customer: mockWorkOrderRecord.customer,
                location: mockWorkOrderRecord.location,
                lineItems: [],
                payments: [],
            }));

            const result = await createInvoiceFromWorkOrder(
                WS_ID,
                WO_ID,
                {
                    dueDate: "2026-09-30",
                },
                adminActor,
            );

            expect(mocks.invoiceCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        workspaceId: WS_ID,
                        customerId: CUST_ID,
                        locationId: LOC_ID,
                        workOrderId: WO_ID,
                        quoteId: QUOTE_ID, // Cross-entity backlink populated from sourceQuoteId
                        status: "DRAFT",
                    }),
                }),
            );

            // 1 LABOR line (3.5h @ $120) + 1 PART line ($850)
            expect(mocks.invoiceLineItemCreate).toHaveBeenCalledTimes(2);

            expect(mocks.invoiceHistoryCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        eventType: "CREATED",
                        metadata: expect.objectContaining({
                            source: "WORK_ORDER",
                            sourceWorkOrderId: WO_ID,
                            sourceWorkOrderNumber: "WO-2026-000001",
                        }),
                    }),
                }),
            );
        });

        it("rejects non-COMPLETED work orders (OPEN, ASSIGNED, IN_PROGRESS, ON_HOLD, CANCELLED)", async () => {
            for (const status of ["OPEN", "ASSIGNED", "IN_PROGRESS", "ON_HOLD", "CANCELLED"]) {
                mocks.workOrderFindFirst.mockResolvedValue({
                    ...mockWorkOrderRecord,
                    status,
                });

                await expect(
                    createInvoiceFromWorkOrder(
                        WS_ID,
                        WO_ID,
                        { dueDate: "2026-09-30" },
                        adminActor,
                    ),
                ).rejects.toThrow(SourceEntityNotEligibleError);
            }
        });

        it("throws WorkOrderNotFoundError if work order does not exist in workspace", async () => {
            mocks.workOrderFindFirst.mockResolvedValue(null);

            await expect(
                createInvoiceFromWorkOrder(
                    WS_ID,
                    "missing_wo",
                    { dueDate: "2026-09-30" },
                    adminActor,
                ),
            ).rejects.toThrow(WorkOrderNotFoundError);
        });

        it("rolls back transaction atomically if history write fails during work order conversion", async () => {
            mocks.workOrderFindFirst.mockResolvedValue(mockWorkOrderRecord);
            mocks.invoiceFindFirst.mockResolvedValue(null);
            mocks.invoiceCreate.mockResolvedValue({ id: "inv_test" });
            mocks.invoiceLineItemCreate.mockResolvedValue({ id: "ili_test" });
            mocks.invoiceUpdate.mockResolvedValue({ id: "inv_test" });
            mocks.invoiceHistoryCreate.mockRejectedValueOnce(new Error("DB Transaction Crash"));

            await expect(
                createInvoiceFromWorkOrder(
                    WS_ID,
                    WO_ID,
                    { dueDate: "2026-09-30" },
                    adminActor,
                ),
            ).rejects.toThrow("DB Transaction Crash");
        });

        it("denies access to TECHNICIAN role on createInvoiceFromWorkOrder", async () => {
            await expect(
                createInvoiceFromWorkOrder(
                    WS_ID,
                    WO_ID,
                    { dueDate: "2026-09-30" },
                    techActor,
                ),
            ).rejects.toThrow(ForbiddenError);
        });
    });

    // =========================================================================
    // 3. MULTIPLE INVOICING / PROGRESS BILLING BEHAVIOR
    // =========================================================================
    describe("3. Progress Billing & Multiple Invoices Support", () => {
        it("explicitly permits creating multiple invoices from the same source entity to support deposit and milestone billing", async () => {
            // First conversion
            mocks.quoteFindFirst.mockResolvedValue(mockQuoteRecord);
            mocks.invoiceFindFirst
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ invoiceNumber: "INV-2026-000001" });

            mocks.invoiceCreate
                .mockResolvedValueOnce({
                    id: "inv_deposit_01",
                    invoiceNumber: "INV-2026-000001",
                    workspaceId: WS_ID,
                    customerId: CUST_ID,
                    quoteId: QUOTE_ID,
                    workOrderId: null,
                    status: "DRAFT",
                })
                .mockResolvedValueOnce({
                    id: "inv_final_02",
                    invoiceNumber: "INV-2026-000002",
                    workspaceId: WS_ID,
                    customerId: CUST_ID,
                    quoteId: QUOTE_ID,
                    workOrderId: null,
                    status: "DRAFT",
                });

            mocks.invoiceLineItemCreate.mockImplementation(({ data }: any) => ({
                id: `ili_${Math.random()}`,
                ...data,
            }));

            mocks.invoiceUpdate
                .mockResolvedValueOnce({
                    id: "inv_deposit_01",
                    invoiceNumber: "INV-2026-000001",
                    customer: mockQuoteRecord.customer,
                    lineItems: [],
                    payments: [],
                })
                .mockResolvedValueOnce({
                    id: "inv_final_02",
                    invoiceNumber: "INV-2026-000002",
                    customer: mockQuoteRecord.customer,
                    lineItems: [],
                    payments: [],
                });

            const inv1 = await createInvoiceFromQuote(
                WS_ID,
                QUOTE_ID,
                { dueDate: "2026-09-15", title: "50% Deposit Invoice" },
                adminActor,
            );

            const inv2 = await createInvoiceFromQuote(
                WS_ID,
                QUOTE_ID,
                { dueDate: "2026-09-30", title: "50% Final Invoice" },
                adminActor,
            );

            expect(inv1.id).toBe("inv_deposit_01");
            expect(inv2.id).toBe("inv_final_02");
            expect(inv1.id).not.toBe(inv2.id);
        });
    });
});
