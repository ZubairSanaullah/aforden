import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

import { Prisma } from "@/generated/prisma/client";
import {
    createQuote,
    getQuote,
    updateQuote,
    deleteQuote,
    listQuotes,
    QuoteNotFoundError,
    QuoteStatusConflictError,
} from "@/lib/services/quote";
import {
    CustomerNotFoundError,
    ServiceLocationNotFoundError,
} from "@/lib/services/customer/customerErrors";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

// Mock Prisma
const mocks = vi.hoisted(() => {
    return {
        quoteFindFirst: vi.fn(),
        quoteFindUnique: vi.fn(),
        quoteFindMany: vi.fn(),
        quoteCount: vi.fn(),
        quoteCreate: vi.fn(),
        quoteUpdate: vi.fn(),
        quoteDelete: vi.fn(),
        quoteLineItemUpdate: vi.fn(),
        quoteHistoryCreate: vi.fn(),
        customerFindFirst: vi.fn(),
        serviceLocationFindFirst: vi.fn(),
        workspaceFindUnique: vi.fn(),
        $transaction: vi.fn(),
    };
});

vi.mock("@/lib/prisma", () => ({
    prisma: {
        quote: {
            findFirst: mocks.quoteFindFirst,
            findUnique: mocks.quoteFindUnique,
            findMany: mocks.quoteFindMany,
            count: mocks.quoteCount,
            create: mocks.quoteCreate,
            update: mocks.quoteUpdate,
            delete: mocks.quoteDelete,
        },
        quoteLineItem: {
            update: mocks.quoteLineItemUpdate,
        },
        quoteHistory: {
            create: mocks.quoteHistoryCreate,
        },
        customer: {
            findFirst: mocks.customerFindFirst,
        },
        serviceLocation: {
            findFirst: mocks.serviceLocationFindFirst,
        },
        workspace: {
            findUnique: mocks.workspaceFindUnique,
        },
        $transaction: mocks.$transaction,
    },
}));

vi.mock("@/lib/services/authorization/workspaceAuthorization", () => ({
    requireWorkspaceAuthorization: vi.fn(),
}));

describe("Phase 1.11.5 — Quote Header CRUD Services", () => {
    const WS_ID = "ws_test_alpha";
    const CUST_ID = "cust_alpha_01";
    const LOC_ID = "loc_alpha_01";
    const QUOTE_ID = "quote_test_01";

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
            timezone: "America/New_York",
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
            timezone: "America/New_York",
        },
    };

    const accountantActor: WorkspaceAuthorizationContext = {
        membership: {
            id: "mem_acct_01",
            role: "ACCOUNTANT",
            status: "ACTIVE",
        },
        user: {
            id: "usr_acct_01",
            name: "Lead Accountant",
            email: "accountant@aforden.com",
            status: "ACTIVE",
            emailVerified: new Date(),
        },
        workspace: {
            id: WS_ID,
            name: "Alpha HVAC",
            slug: "alpha-hvac",
            logoUrl: null,
            timezone: "America/New_York",
        },
    };

    const mockCustomer = {
        id: CUST_ID,
        workspaceId: WS_ID,
        customerNumber: "CUST-001",
        name: "Acme Industrial Corp",
        email: "contact@acme.com",
        phone: "555-0199",
        status: "ACTIVE",
    };

    const mockLocation = {
        id: LOC_ID,
        customerId: CUST_ID,
        name: "Acme Plant 1",
        addressLine1: "123 Factory Lane",
        addressLine2: null,
        city: "Dallas",
        state: "TX",
        postalCode: "75001",
        country: "USA",
    };

    beforeEach(() => {
        vi.clearAllMocks();
        // Default transaction passes through callback with mocked tx
        mocks.$transaction.mockImplementation(async (cb: any) => {
            const tx = {
                quote: {
                    findFirst: mocks.quoteFindFirst,
                    create: mocks.quoteCreate,
                    update: mocks.quoteUpdate,
                    delete: mocks.quoteDelete,
                },
                quoteLineItem: {
                    update: mocks.quoteLineItemUpdate,
                },
                quoteHistory: {
                    create: mocks.quoteHistoryCreate,
                },
            };
            return cb(tx);
        });
    });

    describe("1. createQuote", () => {
        it("creates quote in DRAFT status with workspace currency snapshot and sequential quoteNumber", async () => {
            mocks.customerFindFirst.mockResolvedValue(mockCustomer);
            mocks.serviceLocationFindFirst.mockResolvedValue(mockLocation);
            mocks.workspaceFindUnique.mockResolvedValue({ defaultCurrencyCode: "PKR" });

            const year = new Date().getFullYear();
            mocks.quoteFindFirst.mockResolvedValue({
                quoteNumber: `Q-${year}-000004`,
            });

            const createdRecord = {
                id: "quote_new_01",
                workspaceId: WS_ID,
                quoteNumber: `Q-${year}-000005`,
                customerId: CUST_ID,
                locationId: LOC_ID,
                status: "DRAFT",
                title: "HVAC Retrofit Quote",
                description: "Complete retrofit proposal",
                internalNotes: null,
                termsAndConditions: "Net 30",
                currencyCode: "PKR",
                validUntil: new Date("2026-10-01T00:00:00.000Z"),
                subtotal: new Prisma.Decimal("0.00"),
                discountType: "PERCENTAGE",
                discountValue: new Prisma.Decimal("0.00"),
                discountAmount: new Prisma.Decimal("0.00"),
                taxRate: new Prisma.Decimal("0.0000"),
                taxAmount: new Prisma.Decimal("0.00"),
                total: new Prisma.Decimal("0.00"),
                sentAt: null,
                approvedAt: null,
                approvedByCustomerName: null,
                rejectedAt: null,
                rejectionReason: null,
                convertedAt: null,
                convertedWorkOrderId: null,
                convertedByMemberId: null,
                createdAt: new Date(),
                updatedAt: new Date(),
                customer: mockCustomer,
                location: mockLocation,
                lineItems: [],
            };
            mocks.quoteCreate.mockResolvedValue(createdRecord);

            const result = await createQuote(
                WS_ID,
                {
                    customerId: CUST_ID,
                    locationId: LOC_ID,
                    title: "HVAC Retrofit Quote",
                    description: "Complete retrofit proposal",
                    termsAndConditions: "Net 30",
                    validUntil: "2026-10-01T00:00:00.000Z",
                },
                adminActor,
            );

            expect(result.id).toBe("quote_new_01");
            expect(result.quoteNumber).toBe(`Q-${year}-000005`);
            expect(result.currencyCode).toBe("PKR");
            expect(result.status).toBe("DRAFT");
            expect(result.subtotal).toBe("0.00");
            expect(result.total).toBe("0.00");

            // Verify atomic history creation
            expect(mocks.quoteHistoryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    quoteId: "quote_new_01",
                    workspaceId: WS_ID,
                    eventType: "CREATED",
                    actorMemberId: adminActor.membership.id,
                }),
            });
        });

        it("rejects cross-tenant customer reference with CustomerNotFoundError", async () => {
            mocks.customerFindFirst.mockResolvedValue(null); // Not found in workspace

            await expect(
                createQuote(
                    WS_ID,
                    {
                        customerId: "cross_tenant_cust",
                        title: "Cross Tenant Quote",
                    },
                    adminActor,
                ),
            ).rejects.toThrow(CustomerNotFoundError);
        });

        it("rejects cross-tenant or mismatched location reference with ServiceLocationNotFoundError", async () => {
            mocks.customerFindFirst.mockResolvedValue(mockCustomer);
            mocks.serviceLocationFindFirst.mockResolvedValue(null); // Location doesn't belong to customer

            await expect(
                createQuote(
                    WS_ID,
                    {
                        customerId: CUST_ID,
                        locationId: "mismatched_loc",
                        title: "Mismatched Location Quote",
                    },
                    adminActor,
                ),
            ).rejects.toThrow(ServiceLocationNotFoundError);
        });

        it("rejects TECHNICIAN actor with PermissionDeniedError", async () => {
            await expect(
                createQuote(
                    WS_ID,
                    {
                        customerId: CUST_ID,
                        title: "Unauthorized Quote",
                    },
                    techActor,
                ),
            ).rejects.toThrow(ForbiddenError);
        });
    });

    describe("2. getQuote", () => {
        it("returns full QuoteReadModel including embedded line items and history", async () => {
            const mockFullQuote = {
                id: QUOTE_ID,
                workspaceId: WS_ID,
                quoteNumber: "Q-2026-000001",
                customerId: CUST_ID,
                locationId: LOC_ID,
                status: "DRAFT",
                title: "Chiller Maintenance",
                description: null,
                internalNotes: "Internal note",
                termsAndConditions: null,
                currencyCode: "USD",
                validUntil: null,
                subtotal: new Prisma.Decimal("250.00"),
                discountType: "PERCENTAGE",
                discountValue: new Prisma.Decimal("10.00"),
                discountAmount: new Prisma.Decimal("25.00"),
                taxRate: new Prisma.Decimal("0.0825"),
                taxAmount: new Prisma.Decimal("18.56"),
                total: new Prisma.Decimal("243.56"),
                sentAt: null,
                approvedAt: null,
                approvedByCustomerName: null,
                rejectedAt: null,
                rejectionReason: null,
                convertedAt: null,
                convertedWorkOrderId: null,
                convertedByMemberId: null,
                createdAt: new Date("2026-08-24T10:00:00.000Z"),
                updatedAt: new Date("2026-08-24T11:00:00.000Z"),
                customer: mockCustomer,
                location: mockLocation,
                lineItems: [
                    {
                        id: "item_01",
                        quoteId: QUOTE_ID,
                        workspaceId: WS_ID,
                        lineItemType: "LABOR",
                        workTypeId: "wt_01",
                        partId: null,
                        name: "Diagnostic Labor",
                        description: null,
                        workTypeName: "Diagnostic Labor",
                        workTypeCode: "LAB-01",
                        partName: null,
                        partSku: null,
                        partUnitOfMeasure: null,
                        quantity: new Prisma.Decimal("2.00"),
                        unitPrice: new Prisma.Decimal("125.00"),
                        unitCost: null,
                        discountAmount: new Prisma.Decimal("25.00"),
                        subtotal: new Prisma.Decimal("250.00"),
                        taxRate: new Prisma.Decimal("0.0825"),
                        taxAmount: new Prisma.Decimal("18.56"),
                        total: new Prisma.Decimal("243.56"),
                        sortOrder: 1,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                ],
                history: [
                    {
                        id: "hist_01",
                        quoteId: QUOTE_ID,
                        workspaceId: WS_ID,
                        eventType: "CREATED",
                        actorMemberId: "mem_admin_01",
                        actorName: "Admin User",
                        field: null,
                        oldValue: null,
                        newValue: "Q-2026-000001",
                        metadata: null,
                        createdAt: new Date(),
                    },
                ],
            };

            mocks.quoteFindFirst.mockResolvedValue(mockFullQuote);

            const result = await getQuote(WS_ID, QUOTE_ID, adminActor);
            expect(result.id).toBe(QUOTE_ID);
            expect(result.quoteNumber).toBe("Q-2026-000001");
            expect(result.subtotal).toBe("250.00");
            expect(result.total).toBe("243.56");
            expect(result.lineItems).toHaveLength(1);
            expect(result.lineItems?.[0].name).toBe("Diagnostic Labor");
            expect(result.history).toHaveLength(1);
        });

        it("throws QuoteNotFoundError for missing or cross-tenant quote", async () => {
            mocks.quoteFindFirst.mockResolvedValue(null);

            await expect(
                getQuote(WS_ID, "missing_quote", adminActor),
            ).rejects.toThrow(QuoteNotFoundError);
        });

        it("denies TECHNICIAN commercial access with ForbiddenError", async () => {
            await expect(
                getQuote(WS_ID, QUOTE_ID, techActor),
            ).rejects.toThrow(ForbiddenError);
        });
    });

    describe("3. updateQuote", () => {
        const baseDraftQuote = {
            id: QUOTE_ID,
            workspaceId: WS_ID,
            quoteNumber: "Q-2026-000001",
            customerId: CUST_ID,
            locationId: LOC_ID,
            status: "DRAFT",
            title: "Original Title",
            description: "Original Description",
            internalNotes: null,
            termsAndConditions: null,
            currencyCode: "USD",
            validUntil: null,
            subtotal: new Prisma.Decimal("200.00"),
            discountType: "PERCENTAGE",
            discountValue: new Prisma.Decimal("0.00"),
            discountAmount: new Prisma.Decimal("0.00"),
            taxRate: new Prisma.Decimal("0.0500"),
            taxAmount: new Prisma.Decimal("10.00"),
            total: new Prisma.Decimal("210.00"),
            sentAt: null,
            approvedAt: null,
            approvedByCustomerName: null,
            rejectedAt: null,
            rejectionReason: null,
            convertedAt: null,
            convertedWorkOrderId: null,
            convertedByMemberId: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            customer: mockCustomer,
            location: mockLocation,
            lineItems: [
                {
                    id: "line_01",
                    quoteId: QUOTE_ID,
                    workspaceId: WS_ID,
                    name: "Service Item",
                    quantity: new Prisma.Decimal("2.00"),
                    unitPrice: new Prisma.Decimal("100.00"),
                    unitCost: null,
                    discountAmount: new Prisma.Decimal("0.00"),
                    taxRate: null,
                    sortOrder: 0,
                },
            ],
        };

        it("updates header fields and re-runs calculation engine when discount changes", async () => {
            mocks.quoteFindFirst.mockResolvedValue(baseDraftQuote);

            const updatedQuoteRecord = {
                ...baseDraftQuote,
                title: "Revised Title",
                discountType: "PERCENTAGE",
                discountValue: new Prisma.Decimal("10.00"),
                discountAmount: new Prisma.Decimal("20.00"),
                subtotal: new Prisma.Decimal("200.00"),
                taxAmount: new Prisma.Decimal("9.00"), // 180 * 0.05 = 9.00
                total: new Prisma.Decimal("189.00"),
                lineItems: [],
            };
            mocks.quoteUpdate.mockResolvedValue(updatedQuoteRecord);

            const result = await updateQuote(
                WS_ID,
                QUOTE_ID,
                {
                    title: "Revised Title",
                    discountType: "PERCENTAGE",
                    discountValue: 10,
                },
                adminActor,
            );

            expect(result.title).toBe("Revised Title");
            expect(result.discountAmount).toBe("20.00");
            expect(result.total).toBe("189.00");

            // Verify line item update was called with recalculated amounts
            expect(mocks.quoteLineItemUpdate).toHaveBeenCalledWith({
                where: { id: "line_01" },
                data: expect.objectContaining({
                    discountAmount: expect.any(Prisma.Decimal),
                    subtotal: expect.any(Prisma.Decimal),
                    total: expect.any(Prisma.Decimal),
                }),
            });

            // Verify audit history write
            expect(mocks.quoteHistoryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    eventType: "UPDATED",
                    actorMemberId: adminActor.membership.id,
                }),
            });
        });

        it("lifecycle mutability guard: rejects editing non-DRAFT status with QuoteStatusConflictError", async () => {
            const nonDraftStatuses = ["PENDING_APPROVAL", "APPROVED", "REJECTED", "EXPIRED", "CONVERTED"];

            for (const status of nonDraftStatuses) {
                mocks.quoteFindFirst.mockResolvedValue({
                    ...baseDraftQuote,
                    status,
                });

                await expect(
                    updateQuote(
                        WS_ID,
                        QUOTE_ID,
                        { title: "Should Fail" },
                        adminActor,
                    ),
                ).rejects.toThrow(QuoteStatusConflictError);
            }
        });

        it("rejects ACCOUNTANT without update permission with ForbiddenError", async () => {
            await expect(
                updateQuote(
                    WS_ID,
                    QUOTE_ID,
                    { title: "Accountant Edit" },
                    accountantActor,
                ),
            ).rejects.toThrow(ForbiddenError);
        });
    });

    describe("4. deleteQuote", () => {
        it("deletes quote in DRAFT status atomically with history event", async () => {
            mocks.quoteFindFirst.mockResolvedValue({
                id: QUOTE_ID,
                workspaceId: WS_ID,
                quoteNumber: "Q-2026-000001",
                status: "DRAFT",
                title: "To Be Deleted",
            });
            mocks.quoteDelete.mockResolvedValue({ id: QUOTE_ID });

            const result = await deleteQuote(WS_ID, QUOTE_ID, adminActor);
            expect(result.success).toBe(true);
            expect(result.id).toBe(QUOTE_ID);

            expect(mocks.quoteHistoryCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    quoteId: QUOTE_ID,
                    workspaceId: WS_ID,
                    eventType: "DELETED",
                }),
            });
            expect(mocks.quoteDelete).toHaveBeenCalledWith({
                where: { id: QUOTE_ID },
            });
        });

        it("lifecycle guard: rejects deleting non-DRAFT status with QuoteStatusConflictError", async () => {
            mocks.quoteFindFirst.mockResolvedValue({
                id: QUOTE_ID,
                workspaceId: WS_ID,
                status: "APPROVED",
            });

            await expect(
                deleteQuote(WS_ID, QUOTE_ID, adminActor),
            ).rejects.toThrow(QuoteStatusConflictError);
        });

        it("throws QuoteNotFoundError when target quote does not exist", async () => {
            mocks.quoteFindFirst.mockResolvedValue(null);

            await expect(
                deleteQuote(WS_ID, "non_existent_quote", adminActor),
            ).rejects.toThrow(QuoteNotFoundError);
        });
    });

    describe("5. listQuotes", () => {
        it("queries quotes with filters, search, pagination, and deterministic {id: 'asc'} tie-break", async () => {
            mocks.quoteCount.mockResolvedValue(1);
            mocks.quoteFindMany.mockResolvedValue([
                {
                    id: QUOTE_ID,
                    workspaceId: WS_ID,
                    quoteNumber: "Q-2026-000001",
                    customerId: CUST_ID,
                    locationId: LOC_ID,
                    status: "DRAFT",
                    title: "Chiller Maintenance",
                    description: "Annual contract",
                    currencyCode: "USD",
                    subtotal: new Prisma.Decimal("500.00"),
                    discountType: "PERCENTAGE",
                    discountValue: new Prisma.Decimal("0.00"),
                    discountAmount: new Prisma.Decimal("0.00"),
                    taxRate: new Prisma.Decimal("0.0000"),
                    taxAmount: new Prisma.Decimal("0.00"),
                    total: new Prisma.Decimal("500.00"),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    customer: mockCustomer,
                    location: mockLocation,
                    _count: { lineItems: 2 },
                },
            ]);

            const result = await listQuotes(
                WS_ID,
                {
                    status: "DRAFT",
                    customerId: CUST_ID,
                    search: "Chiller",
                    page: 1,
                    limit: 10,
                    sortBy: "total",
                    sortOrder: "desc",
                },
                adminActor,
            );

            expect(result.total).toBe(1);
            expect(result.page).toBe(1);
            expect(result.limit).toBe(10);
            expect(result.items).toHaveLength(1);
            expect(result.items[0].quoteNumber).toBe("Q-2026-000001");
            expect(result.items[0].lineItemCount).toBe(2);

            expect(mocks.quoteFindMany).toHaveBeenCalledWith({
                where: expect.objectContaining({
                    workspaceId: WS_ID,
                    status: "DRAFT",
                    customerId: CUST_ID,
                    OR: expect.any(Array),
                }),
                orderBy: [
                    { total: "desc" },
                    { id: "asc" }, // Deterministic tie-breaker
                ],
                skip: 0,
                take: 10,
                include: expect.any(Object),
            });
        });

        it("allows ACCOUNTANT with quotes.view permission to list quotes", async () => {
            mocks.quoteCount.mockResolvedValue(0);
            mocks.quoteFindMany.mockResolvedValue([]);

            const result = await listQuotes(WS_ID, {}, accountantActor);
            expect(result.total).toBe(0);
            expect(result.items).toEqual([]);
        });

        it("denies TECHNICIAN from listing quotes with ForbiddenError", async () => {
            await expect(
                listQuotes(WS_ID, {}, techActor),
            ).rejects.toThrow(ForbiddenError);
        });
    });

    describe("6. Transaction Rollback Invariant", () => {
        it("rolls back quote creation if history entry insertion fails", async () => {
            mocks.customerFindFirst.mockResolvedValue(mockCustomer);
            mocks.workspaceFindUnique.mockResolvedValue({ defaultCurrencyCode: "USD" });
            mocks.quoteFindFirst.mockResolvedValue(null);

            mocks.$transaction.mockImplementation(async (cb: any) => {
                const tx = {
                    quote: {
                        findFirst: mocks.quoteFindFirst,
                        create: mocks.quoteCreate.mockResolvedValue({
                            id: "q_fail",
                            quoteNumber: "Q-2026-000001",
                        }),
                    },
                    quoteHistory: {
                        create: mocks.quoteHistoryCreate.mockRejectedValue(
                            new Error("Database transaction constraint error"),
                        ),
                    },
                };
                return cb(tx);
            });

            await expect(
                createQuote(
                    WS_ID,
                    {
                        customerId: CUST_ID,
                        title: "Rollback Test",
                    },
                    adminActor,
                ),
            ).rejects.toThrow("Database transaction constraint error");
        });
    });
});
