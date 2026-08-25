import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

import { Prisma } from "@/generated/prisma/client";
import {
    listInvoices,
    listPayments,
    getInvoicePayments,
    getCustomerOutstandingBalance,
    InvoiceNotFoundError,
} from "@/lib/services/invoice";
import { CustomerNotFoundError } from "@/lib/services/customer/customerErrors";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

// Mock Prisma
const mocks = vi.hoisted(() => {
    return {
        invoiceCount: vi.fn(),
        invoiceFindMany: vi.fn(),
        invoiceFindFirst: vi.fn(),
        paymentCount: vi.fn(),
        paymentFindMany: vi.fn(),
        customerFindFirst: vi.fn(),
    };
});

vi.mock("@/lib/prisma", () => ({
    prisma: {
        invoice: {
            count: mocks.invoiceCount,
            findMany: mocks.invoiceFindMany,
            findFirst: mocks.invoiceFindFirst,
        },
        payment: {
            count: mocks.paymentCount,
            findMany: mocks.paymentFindMany,
        },
        customer: {
            findFirst: mocks.customerFindFirst,
        },
    },
}));

vi.mock("@/lib/services/authorization/workspaceAuthorization", () => ({
    requireWorkspaceAuthorization: vi.fn(),
}));

describe("Phase 1.12.7 — Invoice Query & Directory Architecture", () => {
    const WS_ID = "ws_test_alpha";
    const CUST_ID = "cust_alpha_01";
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

    const mockInvoiceRecord = {
        id: INVOICE_ID,
        workspaceId: WS_ID,
        invoiceNumber: "INV-2026-000001",
        customerId: CUST_ID,
        locationId: "loc_01",
        quoteId: "quote_01",
        workOrderId: "wo_01",
        status: "ISSUED",
        title: "HVAC Install",
        notes: "Net 30",
        internalNotes: null,
        termsAndConditions: null,
        currencyCode: "USD",
        issueDate: new Date("2026-08-01T00:00:00.000Z"),
        dueDate: new Date("2026-08-31T00:00:00.000Z"),
        subtotal: new Prisma.Decimal("1000.00"),
        discountType: "FIXED",
        discountValue: new Prisma.Decimal("0.00"),
        discountAmount: new Prisma.Decimal("0.00"),
        taxRate: new Prisma.Decimal("0.0800"),
        taxAmount: new Prisma.Decimal("80.00"),
        total: new Prisma.Decimal("1080.00"),
        amountPaid: new Prisma.Decimal("200.00"),
        amountDue: new Prisma.Decimal("880.00"),
        issuedAt: new Date("2026-08-01T00:00:00.000Z"),
        paidAt: null,
        voidedAt: null,
        voidReason: null,
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        updatedAt: new Date("2026-08-01T00:00:00.000Z"),
        customer: {
            id: CUST_ID,
            name: "Acme Corp",
            customerNumber: "CUST-0001",
        },
        location: {
            id: "loc_01",
            name: "Main Office",
            addressLine1: "123 Main St",
            city: "Dallas",
            state: "TX",
        },
        quote: {
            id: "quote_01",
            quoteNumber: "QTE-2026-000001",
        },
        workOrder: {
            id: "wo_01",
            workOrderNumber: "WO-2026-000001",
        },
        _count: {
            lineItems: 3,
            payments: 1,
        },
    };

    const mockPaymentRecord = {
        id: "pay_01",
        workspaceId: WS_ID,
        invoiceId: INVOICE_ID,
        paymentNumber: "PAY-2026-000001",
        customerId: CUST_ID,
        amount: new Prisma.Decimal("200.00"),
        currencyCode: "USD",
        paymentMethod: "CHECK",
        referenceNumber: "CHK-9988",
        status: "RECORDED",
        paymentDate: new Date("2026-08-10T12:00:00.000Z"),
        notes: "First deposit",
        recordedByMemberId: "mem_admin_01",
        recordedByMember: {
            user: { name: "Admin User" },
        },
        voidedAt: null,
        voidedByMemberId: null,
        voidedByMember: null,
        voidReason: null,
        createdAt: new Date("2026-08-10T12:00:00.000Z"),
        updatedAt: new Date("2026-08-10T12:00:00.000Z"),
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    // =========================================================================
    // 1. LIST INVOICES DIRECTORY
    // =========================================================================
    describe("1. listInvoices (Directory & Filters)", () => {
        it("lists invoices with default pagination and deterministic sorting", async () => {
            mocks.invoiceCount.mockResolvedValue(1);
            mocks.invoiceFindMany.mockResolvedValue([mockInvoiceRecord]);

            const result = await listInvoices(WS_ID, {}, adminActor);

            expect(result.total).toBe(1);
            expect(result.page).toBe(1);
            expect(result.limit).toBe(20);
            expect(result.totalPages).toBe(1);
            expect(result.items).toHaveLength(1);
            expect(result.items[0].invoiceNumber).toBe("INV-2026-000001");

            expect(mocks.invoiceFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { workspaceId: WS_ID },
                    orderBy: [
                        { createdAt: "desc" },
                        { id: "asc" },
                    ],
                    skip: 0,
                    take: 20,
                }),
            );
        });

        it("filters by status array, customerId, locationId, quoteId, workOrderId", async () => {
            mocks.invoiceCount.mockResolvedValue(1);
            mocks.invoiceFindMany.mockResolvedValue([mockInvoiceRecord]);

            await listInvoices(
                WS_ID,
                {
                    status: ["ISSUED", "PARTIALLY_PAID"],
                    customerId: CUST_ID,
                    locationId: "loc_01",
                    quoteId: "quote_01",
                    workOrderId: "wo_01",
                },
                adminActor,
            );

            expect(mocks.invoiceFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        workspaceId: WS_ID,
                        status: { in: ["ISSUED", "PARTIALLY_PAID"] },
                        customerId: CUST_ID,
                        locationId: "loc_01",
                        quoteId: "quote_01",
                        workOrderId: "wo_01",
                    }),
                }),
            );
        });

        it("applies amountDue range filtering for outstanding balance views", async () => {
            mocks.invoiceCount.mockResolvedValue(1);
            mocks.invoiceFindMany.mockResolvedValue([mockInvoiceRecord]);

            await listInvoices(
                WS_ID,
                {
                    minAmountDue: 100,
                    maxAmountDue: 1000,
                },
                adminActor,
            );

            expect(mocks.invoiceFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        workspaceId: WS_ID,
                        amountDue: {
                            gte: new Prisma.Decimal("100"),
                            lte: new Prisma.Decimal("1000"),
                        },
                    }),
                }),
            );
        });

        it("dynamically evaluates overdue filter on overdueOnly or isOverdue flag", async () => {
            mocks.invoiceCount.mockResolvedValue(1);
            mocks.invoiceFindMany.mockResolvedValue([mockInvoiceRecord]);

            await listInvoices(
                WS_ID,
                {
                    isOverdue: true,
                },
                adminActor,
            );

            expect(mocks.invoiceFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        workspaceId: WS_ID,
                        status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] },
                        dueDate: expect.objectContaining({ lt: expect.any(Date) }),
                        amountDue: expect.objectContaining({ gt: new Prisma.Decimal("0.00") }),
                    }),
                }),
            );
        });

        it("searches case-insensitively across invoiceNumber, title, notes, and customer", async () => {
            mocks.invoiceCount.mockResolvedValue(1);
            mocks.invoiceFindMany.mockResolvedValue([mockInvoiceRecord]);

            await listInvoices(
                WS_ID,
                {
                    search: "Acme",
                },
                adminActor,
            );

            expect(mocks.invoiceFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        workspaceId: WS_ID,
                        OR: [
                            { invoiceNumber: { contains: "Acme", mode: "insensitive" } },
                            { title: { contains: "Acme", mode: "insensitive" } },
                            { notes: { contains: "Acme", mode: "insensitive" } },
                            { customer: { name: { contains: "Acme", mode: "insensitive" } } },
                            { customer: { customerNumber: { contains: "Acme", mode: "insensitive" } } },
                        ],
                    }),
                }),
            );
        });

        it("denies access to TECHNICIAN role on listInvoices", async () => {
            await expect(listInvoices(WS_ID, {}, techActor)).rejects.toThrow(ForbiddenError);
        });
    });

    // =========================================================================
    // 2. LIST PAYMENTS
    // =========================================================================
    describe("2. listPayments", () => {
        it("lists workspace payments across all invoices with deterministic sorting", async () => {
            mocks.paymentCount.mockResolvedValue(1);
            mocks.paymentFindMany.mockResolvedValue([mockPaymentRecord]);

            const result = await listPayments(
                WS_ID,
                {
                    sortBy: "paymentDate",
                    sortOrder: "desc",
                },
                adminActor,
            );

            expect(result.total).toBe(1);
            expect(result.items).toHaveLength(1);
            expect(result.items[0].paymentNumber).toBe("PAY-2026-000001");
            expect(result.items[0].amount).toBe("200.00");

            expect(mocks.paymentFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { workspaceId: WS_ID },
                    orderBy: [
                        { paymentDate: "desc" },
                        { id: "asc" },
                    ],
                }),
            );
        });

        it("filters payments by status, customerId, invoiceId, paymentMethod, and amount bounds", async () => {
            mocks.paymentCount.mockResolvedValue(1);
            mocks.paymentFindMany.mockResolvedValue([mockPaymentRecord]);

            await listPayments(
                WS_ID,
                {
                    status: "RECORDED",
                    customerId: CUST_ID,
                    invoiceId: INVOICE_ID,
                    paymentMethod: "CHECK",
                    minAmount: 50,
                    maxAmount: 500,
                },
                adminActor,
            );

            expect(mocks.paymentFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        workspaceId: WS_ID,
                        status: "RECORDED",
                        customerId: CUST_ID,
                        invoiceId: INVOICE_ID,
                        paymentMethod: "CHECK",
                        amount: {
                            gte: new Prisma.Decimal("50"),
                            lte: new Prisma.Decimal("500"),
                        },
                    }),
                }),
            );
        });

        it("denies access to TECHNICIAN role on listPayments", async () => {
            await expect(listPayments(WS_ID, {}, techActor)).rejects.toThrow(ForbiddenError);
        });
    });

    // =========================================================================
    // 3. GET INVOICE PAYMENTS
    // =========================================================================
    describe("3. getInvoicePayments", () => {
        it("returns all payments for a specific invoice ordered by paymentDate desc", async () => {
            mocks.invoiceFindFirst.mockResolvedValue(mockInvoiceRecord);
            mocks.paymentFindMany.mockResolvedValue([mockPaymentRecord]);

            const result = await getInvoicePayments(WS_ID, INVOICE_ID, adminActor);

            expect(result).toHaveLength(1);
            expect(result[0].id).toBe("pay_01");
            expect(result[0].paymentNumber).toBe("PAY-2026-000001");

            expect(mocks.paymentFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        invoiceId: INVOICE_ID,
                        workspaceId: WS_ID,
                    },
                    orderBy: [
                        { paymentDate: "desc" },
                        { id: "asc" },
                    ],
                }),
            );
        });

        it("throws InvoiceNotFoundError if invoice does not exist in workspace", async () => {
            mocks.invoiceFindFirst.mockResolvedValue(null);

            await expect(
                getInvoicePayments(WS_ID, "missing_inv", adminActor),
            ).rejects.toThrow(InvoiceNotFoundError);
        });

        it("denies access to TECHNICIAN role on getInvoicePayments", async () => {
            await expect(
                getInvoicePayments(WS_ID, INVOICE_ID, techActor),
            ).rejects.toThrow(ForbiddenError);
        });
    });

    // =========================================================================
    // 4. CUSTOMER OUTSTANDING BALANCE / AR SUMMARY
    // =========================================================================
    describe("4. getCustomerOutstandingBalance", () => {
        it("sums amountDue across non-DRAFT and non-VOID invoices for a customer", async () => {
            mocks.customerFindFirst.mockResolvedValue({
                id: CUST_ID,
                workspaceId: WS_ID,
                name: "Acme Corp",
                workspace: { defaultCurrencyCode: "USD" },
            });

            mocks.invoiceFindMany.mockResolvedValue([
                { amountDue: new Prisma.Decimal("500.00"), currencyCode: "USD" },
                { amountDue: new Prisma.Decimal("380.00"), currencyCode: "USD" },
            ]);

            const result = await getCustomerOutstandingBalance(
                WS_ID,
                CUST_ID,
                adminActor,
            );

            expect(result.customerId).toBe(CUST_ID);
            expect(result.totalOutstandingBalance).toBe("880.00");
            expect(result.invoiceCount).toBe(2);
            expect(result.currencyCode).toBe("USD");

            expect(mocks.invoiceFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        workspaceId: WS_ID,
                        customerId: CUST_ID,
                        status: {
                            notIn: ["DRAFT", "VOID"],
                        },
                    },
                }),
            );
        });

        it("returns zero balance when customer has no active unpaid invoices", async () => {
            mocks.customerFindFirst.mockResolvedValue({
                id: CUST_ID,
                workspaceId: WS_ID,
                name: "Acme Corp",
                workspace: { defaultCurrencyCode: "USD" },
            });

            mocks.invoiceFindMany.mockResolvedValue([]);

            const result = await getCustomerOutstandingBalance(
                WS_ID,
                CUST_ID,
                adminActor,
            );

            expect(result.totalOutstandingBalance).toBe("0.00");
            expect(result.invoiceCount).toBe(0);
        });

        it("throws CustomerNotFoundError if customer does not exist in workspace", async () => {
            mocks.customerFindFirst.mockResolvedValue(null);

            await expect(
                getCustomerOutstandingBalance(WS_ID, "missing_cust", adminActor),
            ).rejects.toThrow(CustomerNotFoundError);
        });

        it("denies access to TECHNICIAN role on getCustomerOutstandingBalance", async () => {
            await expect(
                getCustomerOutstandingBalance(WS_ID, CUST_ID, techActor),
            ).rejects.toThrow(ForbiddenError);
        });
    });
});
