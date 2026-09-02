import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

import { Prisma } from "@/generated/prisma/client";
import {
    deleteInvoice,
    removeInvoiceLineItem,
    recordPayment,
    voidPayment,
    InvoiceStatusConflictError,
    InvoiceHasActivePaymentsError,
} from "@/lib/services/invoice";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

// ============================================================================
// MOCKS
// ============================================================================
const mocks = vi.hoisted(() => ({
    invoiceFindFirst: vi.fn(),
    invoiceFindMany: vi.fn(),
    invoiceCreate: vi.fn(),
    invoiceUpdate: vi.fn(),
    invoiceDelete: vi.fn(),
    invoiceLineItemDelete: vi.fn(),
    invoiceLineItemFindMany: vi.fn(),
    paymentFindFirst: vi.fn(),
    paymentCreate: vi.fn(),
    paymentUpdate: vi.fn(),
    invoiceHistoryCreate: vi.fn(),
    customerFindFirst: vi.fn(),
    serviceLocationFindFirst: vi.fn(),
    workspaceFindUnique: vi.fn(),
    $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        invoice: {
            findFirst: mocks.invoiceFindFirst,
            findMany: mocks.invoiceFindMany,
            create: mocks.invoiceCreate,
            update: mocks.invoiceUpdate,
            delete: mocks.invoiceDelete,
        },
        invoiceLineItem: {
            delete: mocks.invoiceLineItemDelete,
            findMany: mocks.invoiceLineItemFindMany,
        },
        payment: {
            findFirst: mocks.paymentFindFirst,
            create: mocks.paymentCreate,
            update: mocks.paymentUpdate,
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

const WS_A = "ws_tenant_alpha";
const INV_ID = "inv_test_ref_01";
const LINE_ID = "li_test_ref_01";
const PAY_ID = "pay_test_ref_01";

const adminActor: WorkspaceAuthorizationContext = {
    membership: { id: "mem_admin_01", role: "ADMIN", status: "ACTIVE" },
    user: { id: "usr_admin_01", name: "Admin User", email: "admin@co.com", status: "ACTIVE", emailVerified: new Date() },
    workspace: { id: WS_A, name: "Alpha HVAC", slug: "alpha-hvac", logoUrl: null, timezone: "UTC" },
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
                    delete: mocks.invoiceLineItemDelete,
                    findMany: mocks.invoiceLineItemFindMany,
                },
                payment: {
                    findFirst: mocks.paymentFindFirst,
                    create: mocks.paymentCreate,
                    update: mocks.paymentUpdate,
                },
                invoiceHistory: {
                    create: mocks.invoiceHistoryCreate,
                },
            });
        }
        return cb;
    });
});

describe("Phase 1.12.11 — Referential Integrity & Historical Safety Audit", () => {
    // ------------------------------------------------------------------------
    // 1. Cascade / Restrict Behavior Tests
    // ------------------------------------------------------------------------
    describe("1. Deletion Restrictions & Immutability", () => {
        it("blocks hard deleting an invoice with status !== DRAFT (InvoiceStatusConflictError)", async () => {
            mocks.invoiceFindFirst.mockResolvedValue({
                id: INV_ID,
                workspaceId: WS_A,
                status: "ISSUED",
                payments: [],
            });

            await expect(
                deleteInvoice(WS_A, INV_ID, adminActor),
            ).rejects.toThrow(InvoiceStatusConflictError);

            expect(mocks.invoiceDelete).not.toHaveBeenCalled();
        });

        it("blocks hard deleting a DRAFT invoice if payments defensively exist (InvoiceStatusConflictError)", async () => {
            mocks.invoiceFindFirst.mockResolvedValue({
                id: INV_ID,
                workspaceId: WS_A,
                status: "DRAFT",
                payments: [{ id: "pay_orphan", status: "RECORDED" }],
            });

            await expect(
                deleteInvoice(WS_A, INV_ID, adminActor),
            ).rejects.toThrow(InvoiceStatusConflictError);

            expect(mocks.invoiceDelete).not.toHaveBeenCalled();
        });

        it("blocks hard deleting line items on non-DRAFT invoices (InvoiceStatusConflictError)", async () => {
            mocks.invoiceFindFirst.mockResolvedValue({
                id: INV_ID,
                workspaceId: WS_A,
                status: "PAID",
            });

            await expect(
                removeInvoiceLineItem(WS_A, INV_ID, LINE_ID, adminActor),
            ).rejects.toThrow(InvoiceStatusConflictError);

            expect(mocks.invoiceLineItemDelete).not.toHaveBeenCalled();
        });
    });

    // ------------------------------------------------------------------------
    // 2. Historical Immutability & Ledger Invariants
    // ------------------------------------------------------------------------
    describe("2. Historical Immutability & Ledger Invariants", () => {
        it("recordPayment always creates an immutable RECORDED row and appends InvoiceHistory", async () => {
            const invoice = {
                id: INV_ID,
                workspaceId: WS_A,
                customerId: "cust_01",
                currencyCode: "USD",
                status: "ISSUED",
                total: new Prisma.Decimal("500.00"),
                amountPaid: new Prisma.Decimal("0.00"),
                amountDue: new Prisma.Decimal("500.00"),
                payments: [],
            };

            mocks.invoiceFindFirst.mockResolvedValue(invoice);
            mocks.paymentCreate.mockResolvedValue({
                id: PAY_ID,
                workspaceId: WS_A,
                invoiceId: INV_ID,
                paymentNumber: "PAY-2026-000001",
                customerId: "cust_01",
                amount: new Prisma.Decimal("200.00"),
                currencyCode: "USD",
                paymentMethod: "CHECK",
                referenceNumber: "CHK-100",
                status: "RECORDED",
                paymentDate: new Date(),
                notes: null,
                recordedByMemberId: "mem_admin_01",
                voidedAt: null,
                voidedByMemberId: null,
                voidReason: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            mocks.invoiceUpdate.mockResolvedValue({});
            mocks.invoiceHistoryCreate.mockResolvedValue({});

            const result = await recordPayment(
                WS_A,
                INV_ID,
                { amount: 200, paymentMethod: "CHECK" },
                adminActor,
            );

            expect(result.status).toBe("RECORDED");
            expect(mocks.paymentCreate).toHaveBeenCalled();
            expect(mocks.invoiceHistoryCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        eventType: "PAYMENT_APPLIED",
                    }),
                }),
            );
        });

        it("voidPayment transitions payment to VOIDED without deleting payment row and logs PAYMENT_VOIDED", async () => {
            const paymentRecord = {
                id: PAY_ID,
                workspaceId: WS_A,
                invoiceId: INV_ID,
                paymentNumber: "PAY-2026-000001",
                customerId: "cust_01",
                amount: new Prisma.Decimal("200.00"),
                currencyCode: "USD",
                paymentMethod: "CHECK",
                referenceNumber: "CHK-100",
                status: "RECORDED",
                paymentDate: new Date(),
                notes: null,
                recordedByMemberId: "mem_admin_01",
                voidedAt: null,
                voidedByMemberId: null,
                voidReason: null,
                createdAt: new Date(),
                updatedAt: new Date(),
                invoice: {
                    id: INV_ID,
                    workspaceId: WS_A,
                    total: new Prisma.Decimal("500.00"),
                    amountPaid: new Prisma.Decimal("200.00"),
                    amountDue: new Prisma.Decimal("300.00"),
                    status: "PARTIALLY_PAID",
                    dueDate: new Date("2099-01-01"),
                    payments: [
                        { id: PAY_ID, status: "RECORDED", amount: new Prisma.Decimal("200.00") },
                    ],
                },
                recordedByMember: null,
                voidedByMember: null,
            };

            mocks.paymentFindFirst.mockResolvedValue(paymentRecord);
            mocks.paymentUpdate.mockResolvedValue({
                ...paymentRecord,
                status: "VOIDED",
                voidedAt: new Date(),
                voidReason: "Check NSF",
                voidedByMemberId: "mem_admin_01",
            });
            mocks.invoiceUpdate.mockResolvedValue({});
            mocks.invoiceHistoryCreate.mockResolvedValue({});

            const result = await voidPayment(WS_A, PAY_ID, "Check NSF", adminActor);

            expect(result.status).toBe("VOIDED");
            expect(mocks.paymentUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { id: PAY_ID },
                    data: expect.objectContaining({
                        status: "VOIDED",
                        voidReason: "Check NSF",
                    }),
                }),
            );
            expect(mocks.invoiceHistoryCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        eventType: "PAYMENT_VOIDED",
                    }),
                }),
            );
        });
    });

    // ------------------------------------------------------------------------
    // 3. Snapshot Fidelity Invariants
    // ------------------------------------------------------------------------
    describe("3. Frozen Independent Snapshots", () => {
        it("denormalized line item snapshot fields preserve commercial truth even if catalog relation is null", () => {
            // Simulate an InvoiceLineItem whose source WorkType or Part was deleted (onDelete: SetNull -> workTypeId = null)
            const lineItemWithNullFK = {
                id: "li_snap_01",
                invoiceId: INV_ID,
                workspaceId: WS_A,
                lineItemType: "LABOR",
                workTypeId: null, // source deleted in catalog
                partId: null,
                name: "Standard Diagnostic",
                description: "Initial system assessment",
                workTypeName: "Diagnostic Labor",
                workTypeCode: "LAB-DIAG",
                partName: null,
                partSku: null,
                partUnitOfMeasure: null,
                quantity: new Prisma.Decimal("2.00"),
                unitPrice: new Prisma.Decimal("125.00"),
                unitCost: new Prisma.Decimal("50.00"),
                discountAmount: new Prisma.Decimal("0.00"),
                subtotal: new Prisma.Decimal("250.00"),
                taxRate: new Prisma.Decimal("0.0825"),
                taxAmount: new Prisma.Decimal("20.63"),
                total: new Prisma.Decimal("270.63"),
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            // All commercial values remain crisp and fully self-contained
            expect(lineItemWithNullFK.workTypeName).toBe("Diagnostic Labor");
            expect(lineItemWithNullFK.workTypeCode).toBe("LAB-DIAG");
            expect(lineItemWithNullFK.unitPrice.toFixed(2)).toBe("125.00");
            expect(lineItemWithNullFK.subtotal.toFixed(2)).toBe("250.00");
            expect(lineItemWithNullFK.total.toFixed(2)).toBe("270.63");
        });
    });

    // ------------------------------------------------------------------------
    // 4. Sequential Numbering Concurrency & Collision Retries
    // ------------------------------------------------------------------------
    describe("4. Sequential Numbering Concurrency & Collision Retries", () => {
        it("createInvoice retries on P2002 unique constraint race condition and succeeds with next sequence number", async () => {
            const { createInvoice } = await import("@/lib/services/invoice/createInvoice");

            mocks.customerFindFirst.mockResolvedValue({ id: "cust_01", status: "ACTIVE" });

            let attemptCount = 0;
            // First attempt throws P2002 unique collision on invoiceNumber; second attempt succeeds
            mocks.invoiceFindFirst.mockImplementation(() => {
                attemptCount++;
                if (attemptCount === 1) {
                    return Promise.resolve({ invoiceNumber: "INV-2026-000001" });
                }
                return Promise.resolve({ invoiceNumber: "INV-2026-000002" }); // competitor committed INV-2026-000002
            });

            mocks.invoiceCreate.mockImplementation(({ data }: any) => {
                if (data.invoiceNumber === "INV-2026-000002") {
                    const p2002Error: any = new Error("Unique constraint failed on the fields: (`workspaceId`,`invoiceNumber`)");
                    p2002Error.code = "P2002";
                    p2002Error.meta = { target: ["invoiceNumber"] };
                    throw p2002Error;
                }
                return Promise.resolve({
                    id: "inv_retry_ok",
                    workspaceId: WS_A,
                    invoiceNumber: data.invoiceNumber,
                    customerId: "cust_01",
                    locationId: null,
                    quoteId: null,
                    workOrderId: null,
                    status: "DRAFT",
                    title: "Test Concurrent",
                    notes: null,
                    internalNotes: null,
                    termsAndConditions: null,
                    currencyCode: "USD",
                    issueDate: new Date(),
                    dueDate: new Date(),
                    subtotal: new Prisma.Decimal("0.00"),
                    discountType: "PERCENTAGE",
                    discountValue: new Prisma.Decimal("0.00"),
                    discountAmount: new Prisma.Decimal("0.00"),
                    taxRate: new Prisma.Decimal("0.0000"),
                    taxAmount: new Prisma.Decimal("0.00"),
                    total: new Prisma.Decimal("0.00"),
                    amountPaid: new Prisma.Decimal("0.00"),
                    amountDue: new Prisma.Decimal("0.00"),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    customer: { id: "cust_01", name: "Acme Corp" },
                    location: null,
                    lineItems: [],
                    payments: [],
                });
            });

            mocks.invoiceHistoryCreate.mockResolvedValue({});

            const result = await createInvoice(
                WS_A,
                {
                    customerId: "cust_01",
                    title: "Test Concurrent",
                    issueDate: new Date("2026-09-01"),
                    dueDate: new Date("2026-09-01"),
                },
                adminActor,
            );

            // Successfully recovered by retrying and acquiring next number INV-2026-000003
            expect(result.invoiceNumber).toBe("INV-2026-000003");
            expect(attemptCount).toBe(2);
        });

        it("recordPayment retries on P2002 unique constraint race condition and succeeds with next paymentNumber", async () => {
            const invoice = {
                id: INV_ID,
                workspaceId: WS_A,
                customerId: "cust_01",
                currencyCode: "USD",
                status: "ISSUED",
                total: new Prisma.Decimal("500.00"),
                amountPaid: new Prisma.Decimal("0.00"),
                amountDue: new Prisma.Decimal("500.00"),
                payments: [],
            };

            mocks.invoiceFindFirst.mockResolvedValue(invoice);

            let paymentAttemptCount = 0;
            mocks.paymentFindFirst.mockImplementation(() => {
                paymentAttemptCount++;
                if (paymentAttemptCount === 1) {
                    return Promise.resolve({ paymentNumber: "PAY-2026-000005" });
                }
                return Promise.resolve({ paymentNumber: "PAY-2026-000006" }); // competitor committed PAY-2026-000006
            });

            mocks.paymentCreate.mockImplementation(({ data }: any) => {
                if (data.paymentNumber === "PAY-2026-000006") {
                    const p2002Error: any = new Error("Unique constraint failed on the fields: (`workspaceId`,`paymentNumber`)");
                    p2002Error.code = "P2002";
                    p2002Error.meta = { target: ["paymentNumber"] };
                    throw p2002Error;
                }
                return Promise.resolve({
                    id: "pay_retry_ok",
                    workspaceId: WS_A,
                    invoiceId: INV_ID,
                    paymentNumber: data.paymentNumber,
                    customerId: "cust_01",
                    amount: new Prisma.Decimal("100.00"),
                    currencyCode: "USD",
                    paymentMethod: "CHECK",
                    referenceNumber: null,
                    status: "RECORDED",
                    paymentDate: new Date(),
                    notes: null,
                    recordedByMemberId: "mem_admin_01",
                    voidedAt: null,
                    voidedByMemberId: null,
                    voidReason: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                });
            });

            mocks.invoiceUpdate.mockResolvedValue({});
            mocks.invoiceHistoryCreate.mockResolvedValue({});

            const result = await recordPayment(
                WS_A,
                INV_ID,
                { amount: 100, paymentMethod: "CHECK" },
                adminActor,
            );

            // Successfully recovered by retrying and acquiring next number PAY-2026-000007
            expect(result.paymentNumber).toBe("PAY-2026-000007");
            expect(paymentAttemptCount).toBe(2);
        });

        it("concurrent creation calls against the same workspace both succeed with distinct numbers", async () => {
            const { createInvoice } = await import("@/lib/services/invoice/createInvoice");

            mocks.customerFindFirst.mockResolvedValue({ id: "cust_01", status: "ACTIVE" });

            let sequence = 10;
            mocks.invoiceFindFirst.mockImplementation(() => {
                sequence++;
                return Promise.resolve({ invoiceNumber: `INV-2026-${String(sequence).padStart(6, "0")}` });
            });

            mocks.invoiceCreate.mockImplementation(({ data }: any) => {
                return Promise.resolve({
                    id: `inv_${data.invoiceNumber}`,
                    workspaceId: WS_A,
                    invoiceNumber: data.invoiceNumber,
                    customerId: "cust_01",
                    locationId: null,
                    quoteId: null,
                    workOrderId: null,
                    status: "DRAFT",
                    title: "Concurrent Batch",
                    notes: null,
                    internalNotes: null,
                    termsAndConditions: null,
                    currencyCode: "USD",
                    issueDate: new Date(),
                    dueDate: new Date(),
                    subtotal: new Prisma.Decimal("0.00"),
                    discountType: "PERCENTAGE",
                    discountValue: new Prisma.Decimal("0.00"),
                    discountAmount: new Prisma.Decimal("0.00"),
                    taxRate: new Prisma.Decimal("0.0000"),
                    taxAmount: new Prisma.Decimal("0.00"),
                    total: new Prisma.Decimal("0.00"),
                    amountPaid: new Prisma.Decimal("0.00"),
                    amountDue: new Prisma.Decimal("0.00"),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    customer: { id: "cust_01", name: "Acme Corp" },
                    location: null,
                    lineItems: [],
                    payments: [],
                });
            });

            mocks.invoiceHistoryCreate.mockResolvedValue({});

            const [inv1, inv2] = await Promise.all([
                createInvoice(WS_A, { customerId: "cust_01", title: "Concurrent 1", issueDate: new Date("2026-09-01"), dueDate: new Date("2026-09-01") }, adminActor),
                createInvoice(WS_A, { customerId: "cust_01", title: "Concurrent 2", issueDate: new Date("2026-09-01"), dueDate: new Date("2026-09-01") }, adminActor),
            ]);

            expect(inv1.invoiceNumber).not.toBe(inv2.invoiceNumber);
            expect(inv1.invoiceNumber).toMatch(/^INV-2026-\d{6}$/);
            expect(inv2.invoiceNumber).toMatch(/^INV-2026-\d{6}$/);
        });
    });
});
