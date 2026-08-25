import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

import { Prisma } from "@/generated/prisma/client";
import {
    createInvoice,
    getInvoice,
    updateInvoice,
    deleteInvoice,
    listInvoices,
    InvoiceNotFoundError,
    InvoiceStatusConflictError,
    InvoiceDueDateInvalidError,
} from "@/lib/services/invoice";
import {
    CustomerNotFoundError,
    ServiceLocationNotFoundError,
} from "@/lib/services/customer/customerErrors";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

// Mock Prisma
const mocks = vi.hoisted(() => {
    return {
        invoiceFindFirst: vi.fn(),
        invoiceFindUnique: vi.fn(),
        invoiceFindMany: vi.fn(),
        invoiceCount: vi.fn(),
        invoiceCreate: vi.fn(),
        invoiceUpdate: vi.fn(),
        invoiceDelete: vi.fn(),
        invoiceLineItemUpdate: vi.fn(),
        invoiceHistoryCreate: vi.fn(),
        customerFindFirst: vi.fn(),
        serviceLocationFindFirst: vi.fn(),
        workspaceFindUnique: vi.fn(),
        $transaction: vi.fn(),
    };
});

vi.mock("@/lib/prisma", () => ({
    prisma: {
        invoice: {
            findFirst: mocks.invoiceFindFirst,
            findUnique: mocks.invoiceFindUnique,
            findMany: mocks.invoiceFindMany,
            count: mocks.invoiceCount,
            create: mocks.invoiceCreate,
            update: mocks.invoiceUpdate,
            delete: mocks.invoiceDelete,
        },
        invoiceLineItem: {
            update: mocks.invoiceLineItemUpdate,
        },
        invoiceHistory: {
            create: mocks.invoiceHistoryCreate,
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

describe("Phase 1.12.5 — Invoice Header CRUD & Numbering Services", () => {
    const WS_ID = "ws_test_alpha";
    const CUST_ID = "cust_alpha_01";
    const LOC_ID = "loc_alpha_01";
    const INVOICE_ID = "inv_test_01";

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

    const managerActor: WorkspaceAuthorizationContext = {
        membership: {
            id: "mem_mgr_01",
            role: "MANAGER",
            status: "ACTIVE",
        },
        user: {
            id: "usr_mgr_01",
            name: "Operations Manager",
            email: "mgr@aforden.com",
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

    const dispatcherActor: WorkspaceAuthorizationContext = {
        membership: {
            id: "mem_disp_01",
            role: "DISPATCHER",
            status: "ACTIVE",
        },
        user: {
            id: "usr_disp_01",
            name: "Dispatcher User",
            email: "dispatcher@aforden.com",
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
        name: "Main Facility",
        addressLine1: "100 Industrial Pkwy",
        city: "Austin",
        state: "TX",
        postalCode: "78701",
    };

    const baseInvoiceRecord = {
        id: INVOICE_ID,
        workspaceId: WS_ID,
        invoiceNumber: "INV-2026-000001",
        customerId: CUST_ID,
        locationId: LOC_ID,
        quoteId: null,
        workOrderId: null,
        status: "DRAFT",
        title: "HVAC Maintenance Invoice",
        notes: "Thank you for your business.",
        internalNotes: "Generated after job completion",
        termsAndConditions: "Net 30 days",
        currencyCode: "USD",
        issueDate: new Date("2026-08-25T00:00:00.000Z"),
        dueDate: new Date("2026-09-24T00:00:00.000Z"),
        subtotal: new Prisma.Decimal("0.00"),
        discountType: "PERCENTAGE",
        discountValue: new Prisma.Decimal("0.00"),
        discountAmount: new Prisma.Decimal("0.00"),
        taxRate: new Prisma.Decimal("0.0000"),
        taxAmount: new Prisma.Decimal("0.00"),
        total: new Prisma.Decimal("0.00"),
        amountPaid: new Prisma.Decimal("0.00"),
        amountDue: new Prisma.Decimal("0.00"),
        issuedAt: null,
        paidAt: null,
        voidedAt: null,
        voidReason: null,
        createdAt: new Date("2026-08-25T00:00:00.000Z"),
        updatedAt: new Date("2026-08-25T00:00:00.000Z"),
        customer: mockCustomer,
        location: mockLocation,
        lineItems: [],
        payments: [],
        history: [],
    };

    beforeEach(() => {
        vi.clearAllMocks();

        mocks.$transaction.mockImplementation(async (cb: any) => {
            if (typeof cb === "function") {
                return cb({
                    invoice: {
                        findFirst: mocks.invoiceFindFirst,
                        create: mocks.invoiceCreate,
                        update: mocks.invoiceUpdate,
                        delete: mocks.invoiceDelete,
                    },
                    invoiceLineItem: {
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
    // 1. CREATE INVOICE
    // =========================================================================
    describe("1. createInvoice", () => {
        it("successfully creates a DRAFT invoice with deterministic numbering and currency snapshot", async () => {
            mocks.customerFindFirst.mockResolvedValue(mockCustomer);
            mocks.serviceLocationFindFirst.mockResolvedValue(mockLocation);
            mocks.workspaceFindUnique.mockResolvedValue({ defaultCurrencyCode: "EUR" });
            mocks.invoiceFindFirst.mockResolvedValue(null); // No prior invoice -> SEQ 1

            mocks.invoiceCreate.mockResolvedValue({
                ...baseInvoiceRecord,
                currencyCode: "EUR",
                invoiceNumber: "INV-2026-000001",
            });

            const result = await createInvoice(
                WS_ID,
                {
                    customerId: CUST_ID,
                    locationId: LOC_ID,
                    title: "Quarterly Facility Service",
                    issueDate: "2026-08-25",
                    dueDate: "2026-09-25",
                    notes: "Payment due within 30 days",
                },
                adminActor,
            );

            expect(result.invoiceNumber).toBe("INV-2026-000001");
            expect(result.status).toBe("DRAFT");
            expect(result.currencyCode).toBe("EUR");
            expect(result.subtotal).toBe("0.00");
            expect(result.total).toBe("0.00");
            expect(result.amountDue).toBe("0.00");

            // Verify atomic history creation
            expect(mocks.invoiceHistoryCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        invoiceId: INVOICE_ID,
                        eventType: "CREATED",
                        actorMemberId: "mem_admin_01",
                        newValue: "DRAFT",
                    }),
                }),
            );
        });

        it("increments sequential invoice number when previous invoices exist", async () => {
            mocks.customerFindFirst.mockResolvedValue(mockCustomer);
            mocks.serviceLocationFindFirst.mockResolvedValue(null);
            mocks.workspaceFindUnique.mockResolvedValue({ defaultCurrencyCode: "USD" });
            mocks.invoiceFindFirst.mockResolvedValue({
                invoiceNumber: "INV-2026-000042",
            });

            mocks.invoiceCreate.mockImplementation(({ data }: any) => {
                return {
                    ...baseInvoiceRecord,
                    ...data,
                    customer: mockCustomer,
                    location: null,
                    lineItems: [],
                    payments: [],
                };
            });

            const result = await createInvoice(
                WS_ID,
                {
                    customerId: CUST_ID,
                    title: "Emergency Diagnostic",
                    dueDate: "2026-09-01",
                },
                adminActor,
            );

            expect(result.invoiceNumber).toBe("INV-2026-000043");
        });

        it("throws CustomerNotFoundError when customer does not exist in workspace", async () => {
            mocks.customerFindFirst.mockResolvedValue(null);

            await expect(
                createInvoice(
                    WS_ID,
                    {
                        customerId: "foreign_customer",
                        title: "Unauthorized Invoice",
                        dueDate: "2026-09-01",
                    },
                    adminActor,
                ),
            ).rejects.toThrow(CustomerNotFoundError);
        });

        it("throws ServiceLocationNotFoundError when location belongs to a different customer", async () => {
            mocks.customerFindFirst.mockResolvedValue(mockCustomer);
            mocks.serviceLocationFindFirst.mockResolvedValue(null);

            await expect(
                createInvoice(
                    WS_ID,
                    {
                        customerId: CUST_ID,
                        locationId: "foreign_location",
                        title: "Mismatched Location",
                        dueDate: "2026-09-01",
                    },
                    adminActor,
                ),
            ).rejects.toThrow(ServiceLocationNotFoundError);
        });

        it("rejects creation when dueDate is before issueDate via schema validation", async () => {
            await expect(
                createInvoice(
                    WS_ID,
                    {
                        customerId: CUST_ID,
                        title: "Invalid Due Date",
                        issueDate: "2026-09-10",
                        dueDate: "2026-09-05", // Earlier than issueDate
                    },
                    adminActor,
                ),
            ).rejects.toThrow();
        });

        it("denies access to TECHNICIAN role (lacks invoices.create)", async () => {
            await expect(
                createInvoice(
                    WS_ID,
                    {
                        customerId: CUST_ID,
                        title: "Tech Attempt",
                        dueDate: "2026-09-01",
                    },
                    techActor,
                ),
            ).rejects.toThrow(ForbiddenError);
        });
    });

    // =========================================================================
    // 2. GET INVOICE
    // =========================================================================
    describe("2. getInvoice", () => {
        it("returns full invoice detail read model with lineItems, payments, and history", async () => {
            mocks.invoiceFindFirst.mockResolvedValue({
                ...baseInvoiceRecord,
                lineItems: [
                    {
                        id: "li_1",
                        invoiceId: INVOICE_ID,
                        lineItemType: "LABOR",
                        name: "Compressor Replacement",
                        quantity: new Prisma.Decimal("2.00"),
                        unitPrice: new Prisma.Decimal("150.00"),
                        discountAmount: new Prisma.Decimal("0.00"),
                        taxRate: new Prisma.Decimal("0.0825"),
                        subtotal: new Prisma.Decimal("300.00"),
                        taxAmount: new Prisma.Decimal("24.75"),
                        total: new Prisma.Decimal("324.75"),
                        sortOrder: 0,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                ],
                payments: [
                    {
                        id: "pay_1",
                        invoiceId: INVOICE_ID,
                        paymentNumber: "PAY-2026-000001",
                        amount: new Prisma.Decimal("100.00"),
                        paymentMethod: "CREDIT_CARD",
                        status: "RECORDED",
                        currencyCode: "USD",
                        paymentDate: new Date(),
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                ],
                history: [
                    {
                        id: "hist_1",
                        invoiceId: INVOICE_ID,
                        eventType: "CREATED",
                        actorMemberId: "mem_admin_01",
                        actorName: "Admin User",
                        field: "status",
                        oldValue: null,
                        newValue: "DRAFT",
                        metadata: {},
                        createdAt: new Date(),
                    },
                ],
            });

            const result = await getInvoice(WS_ID, INVOICE_ID, adminActor);

            expect(result.id).toBe(INVOICE_ID);
            expect(result.lineItems).toHaveLength(1);
            expect(result.lineItems?.[0].name).toBe("Compressor Replacement");
            expect(result.payments).toHaveLength(1);
            expect(result.payments?.[0].amount).toBe("100.00");
            expect(result.history).toHaveLength(1);
            expect(result.history?.[0].eventType).toBe("CREATED");
        });

        it("throws InvoiceNotFoundError when invoice does not exist in workspace", async () => {
            mocks.invoiceFindFirst.mockResolvedValue(null);

            await expect(getInvoice(WS_ID, "missing_inv", adminActor)).rejects.toThrow(
                InvoiceNotFoundError,
            );
        });

        it("denies access to TECHNICIAN role (lacks invoices.view)", async () => {
            await expect(getInvoice(WS_ID, INVOICE_ID, techActor)).rejects.toThrow(
                ForbiddenError,
            );
        });
    });

    // =========================================================================
    // 3. UPDATE INVOICE
    // =========================================================================
    describe("3. updateInvoice", () => {
        it("successfully updates allowed DRAFT invoice header fields", async () => {
            mocks.invoiceFindFirst.mockResolvedValue(baseInvoiceRecord);
            mocks.invoiceUpdate.mockResolvedValue({
                ...baseInvoiceRecord,
                title: "Updated Title",
                notes: "Updated customer notes",
            });

            const result = await updateInvoice(
                WS_ID,
                INVOICE_ID,
                {
                    title: "Updated Title",
                    notes: "Updated customer notes",
                },
                adminActor,
            );

            expect(result.title).toBe("Updated Title");
            expect(result.notes).toBe("Updated customer notes");
            expect(mocks.invoiceHistoryCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        invoiceId: INVOICE_ID,
                        eventType: "UPDATED",
                    }),
                }),
            );
        });

        it("strictly enforces DRAFT-only mutability guard on non-DRAFT invoices", async () => {
            mocks.invoiceFindFirst.mockResolvedValue({
                ...baseInvoiceRecord,
                status: "ISSUED",
            });

            await expect(
                updateInvoice(
                    WS_ID,
                    INVOICE_ID,
                    {
                        title: "Attempted Edit on Issued Invoice",
                    },
                    adminActor,
                ),
            ).rejects.toThrow(InvoiceStatusConflictError);
        });

        it("recalculates line item distributions and totals when discount or tax changes", async () => {
            mocks.invoiceFindFirst.mockResolvedValue({
                ...baseInvoiceRecord,
                lineItems: [
                    {
                        id: "li_1",
                        invoiceId: INVOICE_ID,
                        sortOrder: 0,
                        name: "Labor",
                        quantity: new Prisma.Decimal("1.00"),
                        unitPrice: new Prisma.Decimal("100.00"),
                        discountAmount: new Prisma.Decimal("0.00"),
                        taxRate: new Prisma.Decimal("0.0000"),
                        subtotal: new Prisma.Decimal("100.00"),
                        taxAmount: new Prisma.Decimal("0.00"),
                        total: new Prisma.Decimal("100.00"),
                    },
                ],
                payments: [],
            });

            mocks.invoiceUpdate.mockImplementation(({ data }: any) => ({
                ...baseInvoiceRecord,
                ...data,
                lineItems: [
                    {
                        id: "li_1",
                        invoiceId: INVOICE_ID,
                        sortOrder: 0,
                        name: "Labor",
                        quantity: new Prisma.Decimal("1.00"),
                        unitPrice: new Prisma.Decimal("100.00"),
                        discountAmount: new Prisma.Decimal("10.00"),
                        taxRate: new Prisma.Decimal("0.1000"),
                        subtotal: new Prisma.Decimal("100.00"),
                        taxAmount: new Prisma.Decimal("9.00"),
                        total: new Prisma.Decimal("99.00"),
                    },
                ],
                payments: [],
            }));

            const result = await updateInvoice(
                WS_ID,
                INVOICE_ID,
                {
                    discountType: "FIXED",
                    discountValue: 10,
                    taxRate: 0.1,
                },
                adminActor,
            );

            expect(mocks.invoiceLineItemUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: "li_1" },
                }),
            );
        });

        it("throws InvoiceDueDateInvalidError when updating dueDate before existing issueDate", async () => {
            mocks.invoiceFindFirst.mockResolvedValue({
                ...baseInvoiceRecord,
                issueDate: new Date("2026-08-25T00:00:00.000Z"),
                dueDate: new Date("2026-09-25T00:00:00.000Z"),
            });

            await expect(
                updateInvoice(
                    WS_ID,
                    INVOICE_ID,
                    {
                        dueDate: "2026-08-20", // Before 2026-08-25
                    },
                    adminActor,
                ),
            ).rejects.toThrow(InvoiceDueDateInvalidError);
        });

        it("denies access to DISPATCHER and TECHNICIAN roles", async () => {
            await expect(
                updateInvoice(WS_ID, INVOICE_ID, { title: "Disp Edit" }, dispatcherActor),
            ).rejects.toThrow(ForbiddenError);

            await expect(
                updateInvoice(WS_ID, INVOICE_ID, { title: "Tech Edit" }, techActor),
            ).rejects.toThrow(ForbiddenError);
        });
    });

    // =========================================================================
    // 4. DELETE INVOICE
    // =========================================================================
    describe("4. deleteInvoice", () => {
        it("successfully deletes DRAFT invoice and writes DELETED history event", async () => {
            mocks.invoiceFindFirst.mockResolvedValue({
                ...baseInvoiceRecord,
                status: "DRAFT",
                payments: [],
            });

            const result = await deleteInvoice(WS_ID, INVOICE_ID, adminActor);

            expect(result.success).toBe(true);
            expect(result.id).toBe(INVOICE_ID);

            // Verify DELETED history is written before row deletion
            expect(mocks.invoiceHistoryCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        invoiceId: INVOICE_ID,
                        eventType: "DELETED",
                        actorMemberId: "mem_admin_01",
                        oldValue: "DRAFT",
                        newValue: "DELETED",
                    }),
                }),
            );

            expect(mocks.invoiceDelete).toHaveBeenCalledWith({
                where: { id: INVOICE_ID },
            });
        });

        it("blocks deletion of non-DRAFT invoices with InvoiceStatusConflictError", async () => {
            mocks.invoiceFindFirst.mockResolvedValue({
                ...baseInvoiceRecord,
                status: "ISSUED",
                payments: [],
            });

            await expect(deleteInvoice(WS_ID, INVOICE_ID, adminActor)).rejects.toThrow(
                InvoiceStatusConflictError,
            );
            expect(mocks.invoiceDelete).not.toHaveBeenCalled();
        });

        it("defensively blocks deletion of DRAFT invoice if payments exist", async () => {
            // Constructing state where status is DRAFT but a payment row is present
            mocks.invoiceFindFirst.mockResolvedValue({
                ...baseInvoiceRecord,
                status: "DRAFT",
                payments: [{ id: "pay_anomaly_01" }],
            });

            await expect(deleteInvoice(WS_ID, INVOICE_ID, adminActor)).rejects.toThrow(
                InvoiceStatusConflictError,
            );
            expect(mocks.invoiceDelete).not.toHaveBeenCalled();
        });

        it("throws InvoiceNotFoundError if invoice does not exist", async () => {
            mocks.invoiceFindFirst.mockResolvedValue(null);

            await expect(deleteInvoice(WS_ID, "missing_inv", adminActor)).rejects.toThrow(
                InvoiceNotFoundError,
            );
        });

        it("denies access to MANAGER, DISPATCHER, ACCOUNTANT, and TECHNICIAN roles (only OWNER/ADMIN permit delete)", async () => {
            await expect(deleteInvoice(WS_ID, INVOICE_ID, managerActor)).rejects.toThrow(
                ForbiddenError,
            );
            await expect(deleteInvoice(WS_ID, INVOICE_ID, dispatcherActor)).rejects.toThrow(
                ForbiddenError,
            );
            await expect(deleteInvoice(WS_ID, INVOICE_ID, accountantActor)).rejects.toThrow(
                ForbiddenError,
            );
            await expect(deleteInvoice(WS_ID, INVOICE_ID, techActor)).rejects.toThrow(
                ForbiddenError,
            );
        });
    });

    // =========================================================================
    // 5. LIST INVOICES
    // =========================================================================
    describe("5. listInvoices", () => {
        it("returns paginated results with filters and deterministic secondary sorting", async () => {
            mocks.invoiceCount.mockResolvedValue(1);
            mocks.invoiceFindMany.mockResolvedValue([baseInvoiceRecord]);

            const result = await listInvoices(
                WS_ID,
                {
                    page: 1,
                    limit: 10,
                    status: "DRAFT",
                    customerId: CUST_ID,
                    sortBy: "total",
                    sortOrder: "desc",
                },
                adminActor,
            );

            expect(result.total).toBe(1);
            expect(result.page).toBe(1);
            expect(result.limit).toBe(10);
            expect(result.totalPages).toBe(1);
            expect(result.items).toHaveLength(1);
            expect(result.items[0].id).toBe(INVOICE_ID);

            expect(mocks.invoiceFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        workspaceId: WS_ID,
                        status: "DRAFT",
                        customerId: CUST_ID,
                    }),
                    orderBy: [{ total: "desc" }, { id: "asc" }],
                    skip: 0,
                    take: 10,
                }),
            );
        });

        it("supports multiple status array filtering and search queries", async () => {
            mocks.invoiceCount.mockResolvedValue(0);
            mocks.invoiceFindMany.mockResolvedValue([]);

            await listInvoices(
                WS_ID,
                {
                    status: ["ISSUED", "OVERDUE"],
                    search: "INV-2026",
                    overdueOnly: true,
                },
                adminActor,
            );

            expect(mocks.invoiceFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        workspaceId: WS_ID,
                        status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] },
                        OR: expect.arrayContaining([
                            { invoiceNumber: { contains: "INV-2026", mode: "insensitive" } },
                        ]),
                    }),
                }),
            );
        });

        it("supports date ranges and amount filters", async () => {
            mocks.invoiceCount.mockResolvedValue(0);
            mocks.invoiceFindMany.mockResolvedValue([]);

            await listInvoices(
                WS_ID,
                {
                    issueDateFrom: "2026-08-01",
                    issueDateTo: "2026-08-31",
                    minTotal: 100,
                    maxTotal: 5000,
                },
                adminActor,
            );

            expect(mocks.invoiceFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        workspaceId: WS_ID,
                        issueDate: {
                            gte: new Date("2026-08-01"),
                            lte: new Date("2026-08-31"),
                        },
                        total: {
                            gte: new Prisma.Decimal("100"),
                            lte: new Prisma.Decimal("5000"),
                        },
                    }),
                }),
            );
        });

        it("denies access to TECHNICIAN role (lacks invoices.view)", async () => {
            await expect(listInvoices(WS_ID, {}, techActor)).rejects.toThrow(ForbiddenError);
        });
    });
});
