import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

import { Prisma } from "@/generated/prisma/client";
import {
    recordPayment,
    voidPayment,
    InvoiceNotFoundError,
    PaymentNotFoundError,
    InvoiceStatusConflictError,
    InvoiceAlreadyVoidedError,
    InvoiceAlreadyPaidError,
    PaymentAlreadyVoidedError,
    OverpaymentNotAllowedError,
    InvalidPaymentAmountError,
    MissingVoidReasonError,
} from "@/lib/services/invoice";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

// ============================================================================
// MOCKS
// ============================================================================
const mocks = vi.hoisted(() => ({
    invoiceFindFirst: vi.fn(),
    invoiceUpdate: vi.fn(),
    paymentFindFirst: vi.fn(),
    paymentCreate: vi.fn(),
    paymentUpdate: vi.fn(),
    invoiceHistoryCreate: vi.fn(),
    $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        invoice: {
            findFirst: mocks.invoiceFindFirst,
            update: mocks.invoiceUpdate,
        },
        payment: {
            findFirst: mocks.paymentFindFirst,
            create: mocks.paymentCreate,
            update: mocks.paymentUpdate,
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

// ============================================================================
// SHARED TEST FIXTURES
// ============================================================================
const WS_A = "ws_tenant_alpha";
const WS_B = "ws_tenant_beta";
const INV_ID = "inv_test_100";
const PAY_ID = "pay_test_200";

const adminActor: WorkspaceAuthorizationContext = {
    membership: { id: "mem_admin_01", role: "ADMIN", status: "ACTIVE" },
    user: { id: "usr_admin_01", name: "Admin User", email: "admin@co.com", status: "ACTIVE", emailVerified: new Date() },
    workspace: { id: WS_A, name: "Alpha HVAC", slug: "alpha-hvac", logoUrl: null, timezone: "UTC" },
};

const accountantActor: WorkspaceAuthorizationContext = {
    membership: { id: "mem_acc_01", role: "ACCOUNTANT", status: "ACTIVE" },
    user: { id: "usr_acc_01", name: "Accountant", email: "accountant@co.com", status: "ACTIVE", emailVerified: new Date() },
    workspace: { id: WS_A, name: "Alpha HVAC", slug: "alpha-hvac", logoUrl: null, timezone: "UTC" },
};

const managerActor: WorkspaceAuthorizationContext = {
    membership: { id: "mem_mgr_01", role: "MANAGER", status: "ACTIVE" },
    user: { id: "usr_mgr_01", name: "Manager", email: "mgr@co.com", status: "ACTIVE", emailVerified: new Date() },
    workspace: { id: WS_A, name: "Alpha HVAC", slug: "alpha-hvac", logoUrl: null, timezone: "UTC" },
};

const dispatcherActor: WorkspaceAuthorizationContext = {
    membership: { id: "mem_disp_01", role: "DISPATCHER", status: "ACTIVE" },
    user: { id: "usr_disp_01", name: "Dispatcher", email: "disp@co.com", status: "ACTIVE", emailVerified: new Date() },
    workspace: { id: WS_A, name: "Alpha HVAC", slug: "alpha-hvac", logoUrl: null, timezone: "UTC" },
};

const techActor: WorkspaceAuthorizationContext = {
    membership: { id: "mem_tech_01", role: "TECHNICIAN", status: "ACTIVE" },
    user: { id: "usr_tech_01", name: "Field Tech", email: "tech@co.com", status: "ACTIVE", emailVerified: new Date() },
    workspace: { id: WS_A, name: "Alpha HVAC", slug: "alpha-hvac", logoUrl: null, timezone: "UTC" },
};

function makeTestInvoice(overrides: Record<string, unknown> = {}) {
    return {
        id: INV_ID,
        workspaceId: WS_A,
        invoiceNumber: "INV-2026-000001",
        customerId: "cust_01",
        status: "ISSUED",
        title: "HVAC Installation",
        currencyCode: "USD",
        issueDate: new Date("2026-08-01"),
        dueDate: new Date("2026-09-01"),
        subtotal: new Prisma.Decimal("1000.00"),
        total: new Prisma.Decimal("1000.00"),
        amountPaid: new Prisma.Decimal("0.00"),
        amountDue: new Prisma.Decimal("1000.00"),
        paidAt: null,
        voidedAt: null,
        payments: [],
        ...overrides,
    };
}

function makeTestPayment(overrides: Record<string, unknown> = {}) {
    return {
        id: PAY_ID,
        workspaceId: WS_A,
        invoiceId: INV_ID,
        paymentNumber: "PAY-2026-000001",
        customerId: "cust_01",
        amount: new Prisma.Decimal("400.00"),
        currencyCode: "USD",
        paymentMethod: "CHECK",
        referenceNumber: "CHK-1001",
        status: "RECORDED",
        paymentDate: new Date("2026-08-10"),
        notes: "Deposit payment",
        recordedByMemberId: "mem_admin_01",
        voidedAt: null,
        voidedByMemberId: null,
        voidReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        recordedByMember: {
            user: { name: "Admin User" },
        },
        voidedByMember: null,
        invoice: makeTestInvoice({
            amountPaid: new Prisma.Decimal("400.00"),
            amountDue: new Prisma.Decimal("600.00"),
            status: "PARTIALLY_PAID",
            payments: [
                {
                    id: PAY_ID,
                    status: "RECORDED",
                    amount: new Prisma.Decimal("400.00"),
                },
            ],
        }),
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();

    mocks.$transaction.mockImplementation(async (cb: any) => {
        if (typeof cb === "function") {
            return cb({
                payment: {
                    findFirst: mocks.paymentFindFirst,
                    create: mocks.paymentCreate,
                    update: mocks.paymentUpdate,
                },
                invoice: {
                    findFirst: mocks.invoiceFindFirst,
                    update: mocks.invoiceUpdate,
                },
                invoiceHistory: {
                    create: mocks.invoiceHistoryCreate,
                },
            });
        }
        return cb;
    });
});

// ============================================================================
// 1. recordPayment Tests
// ============================================================================
describe("Phase 1.12.10 — recordPayment", () => {
    it("records full payment on an ISSUED invoice: transitions to PAID, amountDue=0, sets paidAt", async () => {
        const inv = makeTestInvoice();
        mocks.invoiceFindFirst.mockResolvedValue(inv);

        const createdPayment = {
            id: "pay_01",
            workspaceId: WS_A,
            invoiceId: INV_ID,
            paymentNumber: "PAY-2026-000001",
            customerId: "cust_01",
            amount: new Prisma.Decimal("1000.00"),
            currencyCode: "USD",
            paymentMethod: "CREDIT_CARD",
            referenceNumber: "TX-9988",
            status: "RECORDED",
            paymentDate: new Date(),
            notes: "Full payment",
            recordedByMemberId: "mem_admin_01",
            voidedAt: null,
            voidedByMemberId: null,
            voidReason: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            recordedByMember: { user: { name: "Admin User" } },
            voidedByMember: null,
        };

        mocks.paymentCreate.mockResolvedValue(createdPayment);
        mocks.invoiceUpdate.mockResolvedValue({ ...inv, status: "PAID", amountPaid: new Prisma.Decimal("1000.00"), amountDue: new Prisma.Decimal("0.00"), paidAt: new Date() });
        mocks.invoiceHistoryCreate.mockResolvedValue({ id: "hist_01" });

        const result = await recordPayment(
            WS_A,
            INV_ID,
            {
                amount: 1000,
                paymentMethod: "CREDIT_CARD",
                referenceNumber: "TX-9988",
                notes: "Full payment",
            },
            adminActor,
        );

        expect(mocks.paymentCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    amount: new Prisma.Decimal("1000.00"),
                    paymentMethod: "CREDIT_CARD",
                    referenceNumber: "TX-9988",
                    status: "RECORDED",
                }),
            }),
        );

        expect(mocks.invoiceUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: INV_ID },
                data: expect.objectContaining({
                    status: "PAID",
                    amountPaid: new Prisma.Decimal("1000.00"),
                    amountDue: new Prisma.Decimal("0.00"),
                    paidAt: expect.any(Date),
                }),
            }),
        );

        expect(mocks.invoiceHistoryCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    eventType: "PAYMENT_APPLIED",
                    field: "amountPaid",
                    oldValue: "0.00",
                    newValue: "1000.00",
                    metadata: expect.objectContaining({
                        amount: "1000.00",
                        amountDue: "0.00",
                        status: "PAID",
                    }),
                }),
            }),
        );

        expect(result.amount).toBe("1000.00");
        expect(result.status).toBe("RECORDED");
    });

    it("records partial payment on an ISSUED invoice: transitions to PARTIALLY_PAID with correct balances", async () => {
        const inv = makeTestInvoice();
        mocks.invoiceFindFirst.mockResolvedValue(inv);

        const createdPayment = {
            id: "pay_02",
            workspaceId: WS_A,
            invoiceId: INV_ID,
            paymentNumber: "PAY-2026-000001",
            customerId: "cust_01",
            amount: new Prisma.Decimal("350.00"),
            currencyCode: "USD",
            paymentMethod: "CHECK",
            referenceNumber: "CHK-101",
            status: "RECORDED",
            paymentDate: new Date(),
            notes: null,
            recordedByMemberId: "mem_admin_01",
            voidedAt: null,
            voidedByMemberId: null,
            voidReason: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            recordedByMember: { user: { name: "Admin User" } },
            voidedByMember: null,
        };

        mocks.paymentCreate.mockResolvedValue(createdPayment);
        mocks.invoiceUpdate.mockResolvedValue({ ...inv, status: "PARTIALLY_PAID", amountPaid: new Prisma.Decimal("350.00"), amountDue: new Prisma.Decimal("650.00"), paidAt: null });
        mocks.invoiceHistoryCreate.mockResolvedValue({ id: "hist_02" });

        const result = await recordPayment(
            WS_A,
            INV_ID,
            {
                amount: 350,
                paymentMethod: "CHECK",
                referenceNumber: "CHK-101",
            },
            adminActor,
        );

        expect(mocks.invoiceUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    status: "PARTIALLY_PAID",
                    amountPaid: new Prisma.Decimal("350.00"),
                    amountDue: new Prisma.Decimal("650.00"),
                    paidAt: null,
                }),
            }),
        );

        expect(result.amount).toBe("350.00");
    });

    it("records payment on an OVERDUE invoice: fully paying transitions it to PAID", async () => {
        const overdueInv = makeTestInvoice({ status: "OVERDUE" });
        mocks.invoiceFindFirst.mockResolvedValue(overdueInv);

        const createdPayment = {
            id: "pay_03",
            workspaceId: WS_A,
            invoiceId: INV_ID,
            paymentNumber: "PAY-2026-000001",
            customerId: "cust_01",
            amount: new Prisma.Decimal("1000.00"),
            currencyCode: "USD",
            paymentMethod: "BANK_TRANSFER",
            referenceNumber: "ACH-55",
            status: "RECORDED",
            paymentDate: new Date(),
            notes: null,
            recordedByMemberId: "mem_admin_01",
            voidedAt: null,
            voidedByMemberId: null,
            voidReason: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            recordedByMember: { user: { name: "Admin User" } },
            voidedByMember: null,
        };

        mocks.paymentCreate.mockResolvedValue(createdPayment);
        mocks.invoiceUpdate.mockResolvedValue({ ...overdueInv, status: "PAID", amountPaid: new Prisma.Decimal("1000.00"), amountDue: new Prisma.Decimal("0.00"), paidAt: new Date() });
        mocks.invoiceHistoryCreate.mockResolvedValue({ id: "hist_03" });

        const result = await recordPayment(
            WS_A,
            INV_ID,
            { amount: 1000, paymentMethod: "BANK_TRANSFER" },
            adminActor,
        );

        expect(mocks.invoiceUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    status: "PAID",
                    amountDue: new Prisma.Decimal("0.00"),
                }),
            }),
        );
        expect(result.amount).toBe("1000.00");
    });

    it("accumulates multiple partial payments from ledger rather than trusting stale cached invoice.amountPaid", async () => {
        // Deliberately make cached amountPaid on invoice stale/wrong (0.00) while ledger has 300.00 active
        const invWithLedger = makeTestInvoice({
            amountPaid: new Prisma.Decimal("0.00"), // stale cache
            amountDue: new Prisma.Decimal("1000.00"),
            status: "PARTIALLY_PAID",
            payments: [
                {
                    id: "p1",
                    status: "RECORDED",
                    amount: new Prisma.Decimal("300.00"),
                },
                {
                    id: "p2_void",
                    status: "VOIDED",
                    amount: new Prisma.Decimal("200.00"),
                },
            ],
        });

        mocks.invoiceFindFirst.mockResolvedValue(invWithLedger);

        const newPayment = {
            id: "p3",
            workspaceId: WS_A,
            invoiceId: INV_ID,
            paymentNumber: "PAY-2026-000002",
            customerId: "cust_01",
            amount: new Prisma.Decimal("400.00"),
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
            recordedByMember: null,
            voidedByMember: null,
        };

        mocks.paymentCreate.mockResolvedValue(newPayment);
        mocks.invoiceUpdate.mockResolvedValue({});
        mocks.invoiceHistoryCreate.mockResolvedValue({});

        await recordPayment(WS_A, INV_ID, { amount: 400, paymentMethod: "CHECK" }, adminActor);

        // Ledger has 300 active + 400 new = 700 total paid; amountDue = 1000 - 700 = 300
        expect(mocks.invoiceUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    amountPaid: new Prisma.Decimal("700.00"),
                    amountDue: new Prisma.Decimal("300.00"),
                    status: "PARTIALLY_PAID",
                }),
            }),
        );
    });

    it("rejects overpayment exceeding remaining amountDue (OverpaymentNotAllowedError)", async () => {
        const inv = makeTestInvoice({
            total: new Prisma.Decimal("500.00"),
            payments: [
                { id: "p1", status: "RECORDED", amount: new Prisma.Decimal("400.00") },
            ],
        });
        mocks.invoiceFindFirst.mockResolvedValue(inv);

        // Remaining due is 100.00; attempt to pay 150.00
        await expect(
            recordPayment(WS_A, INV_ID, { amount: 150, paymentMethod: "CASH" }, adminActor),
        ).rejects.toThrow(OverpaymentNotAllowedError);
    });

    it("rejects payment on a DRAFT invoice (InvoiceStatusConflictError per §5.5 Step 4b)", async () => {
        mocks.invoiceFindFirst.mockResolvedValue(makeTestInvoice({ status: "DRAFT" }));

        await expect(
            recordPayment(WS_A, INV_ID, { amount: 100, paymentMethod: "CHECK" }, adminActor),
        ).rejects.toThrow(InvoiceStatusConflictError);
    });

    it("rejects payment on a VOID invoice (InvoiceAlreadyVoidedError per §5.5 Step 4a)", async () => {
        mocks.invoiceFindFirst.mockResolvedValue(makeTestInvoice({ status: "VOID" }));

        await expect(
            recordPayment(WS_A, INV_ID, { amount: 100, paymentMethod: "CHECK" }, adminActor),
        ).rejects.toThrow(InvoiceAlreadyVoidedError);
    });

    it("rejects payment on an already PAID invoice (InvoiceAlreadyPaidError per §5.5 Step 4c)", async () => {
        mocks.invoiceFindFirst.mockResolvedValue(makeTestInvoice({ status: "PAID", amountPaid: new Prisma.Decimal("1000.00"), amountDue: new Prisma.Decimal("0.00") }));

        await expect(
            recordPayment(WS_A, INV_ID, { amount: 100, paymentMethod: "CHECK" }, adminActor),
        ).rejects.toThrow(InvoiceAlreadyPaidError);
    });

    it.each([0, -50, -0.01])("rejects zero or negative payment amount %s (InvalidPaymentAmountError)", async (amount) => {
        await expect(
            recordPayment(WS_A, INV_ID, { amount, paymentMethod: "CASH" }, adminActor),
        ).rejects.toThrow(InvalidPaymentAmountError);
    });

    it("rejects payment amount with more than 2 decimal places (InvalidPaymentAmountError)", async () => {
        await expect(
            recordPayment(WS_A, INV_ID, { amount: 100.555, paymentMethod: "CASH" }, adminActor),
        ).rejects.toThrow(InvalidPaymentAmountError);
    });

    it("throws InvoiceNotFoundError if invoice does not belong to tenant (tenant isolation)", async () => {
        mocks.invoiceFindFirst.mockResolvedValue(null);

        await expect(
            recordPayment(WS_B, INV_ID, { amount: 100, paymentMethod: "CASH" }, adminActor),
        ).rejects.toThrow(InvoiceNotFoundError);
    });

    it("rejects TECHNICIAN role before DB read (ForbiddenError)", async () => {
        await expect(
            recordPayment(WS_A, INV_ID, { amount: 100, paymentMethod: "CASH" }, techActor),
        ).rejects.toThrow(ForbiddenError);
        expect(mocks.invoiceFindFirst).not.toHaveBeenCalled();
    });

    it("rejects DISPATCHER role before DB read (ForbiddenError — lacks payments.create)", async () => {
        await expect(
            recordPayment(WS_A, INV_ID, { amount: 100, paymentMethod: "CASH" }, dispatcherActor),
        ).rejects.toThrow(ForbiddenError);
        expect(mocks.invoiceFindFirst).not.toHaveBeenCalled();
    });

    it("allows ACCOUNTANT and MANAGER roles to record payment (RBAC positive)", async () => {
        const inv = makeTestInvoice();
        mocks.invoiceFindFirst.mockResolvedValue(inv);
        mocks.paymentCreate.mockResolvedValue(makeTestPayment());
        mocks.invoiceUpdate.mockResolvedValue({});
        mocks.invoiceHistoryCreate.mockResolvedValue({});

        const resultAcc = await recordPayment(WS_A, INV_ID, { amount: 100, paymentMethod: "ACH" }, accountantActor);
        expect(resultAcc).toBeDefined();

        const resultMgr = await recordPayment(WS_A, INV_ID, { amount: 100, paymentMethod: "ACH" }, managerActor);
        expect(resultMgr).toBeDefined();
    });
});

// ============================================================================
// 2. voidPayment Tests
// ============================================================================
describe("Phase 1.12.10 — voidPayment", () => {
    it("voids a payment on a PARTIALLY_PAID invoice: recomputes balances and updates payment status", async () => {
        const paymentRecord = makeTestPayment({
            invoice: makeTestInvoice({
                total: new Prisma.Decimal("1000.00"),
                amountPaid: new Prisma.Decimal("700.00"),
                amountDue: new Prisma.Decimal("300.00"),
                status: "PARTIALLY_PAID",
                dueDate: new Date("2026-12-01"), // future due date
                payments: [
                    { id: PAY_ID, status: "RECORDED", amount: new Prisma.Decimal("400.00") },
                    { id: "pay_other", status: "RECORDED", amount: new Prisma.Decimal("300.00") },
                ],
            }),
        });

        mocks.paymentFindFirst.mockResolvedValue(paymentRecord);
        const voidedPayment = {
            ...paymentRecord,
            status: "VOIDED",
            voidedAt: new Date(),
            voidReason: "Check bounced",
            voidedByMemberId: "mem_admin_01",
        };
        mocks.paymentUpdate.mockResolvedValue(voidedPayment);
        mocks.invoiceUpdate.mockResolvedValue({});
        mocks.invoiceHistoryCreate.mockResolvedValue({});

        const result = await voidPayment(WS_A, PAY_ID, "Check bounced", adminActor);

        // After voiding 400.00 payment, remaining active payment is 300.00; amountDue = 700.00; status = PARTIALLY_PAID
        expect(mocks.paymentUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: PAY_ID },
                data: expect.objectContaining({
                    status: "VOIDED",
                    voidReason: "Check bounced",
                    voidedByMemberId: "mem_admin_01",
                }),
            }),
        );

        expect(mocks.invoiceUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                where: { id: INV_ID },
                data: expect.objectContaining({
                    amountPaid: new Prisma.Decimal("300.00"),
                    amountDue: new Prisma.Decimal("700.00"),
                    status: "PARTIALLY_PAID",
                    paidAt: null,
                }),
            }),
        );

        expect(mocks.invoiceHistoryCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    eventType: "PAYMENT_VOIDED",
                    field: "amountPaid",
                    oldValue: "700.00",
                    newValue: "300.00",
                    metadata: expect.objectContaining({
                        voidReason: "Check bounced",
                        amountDue: "700.00",
                        status: "PARTIALLY_PAID",
                    }),
                }),
            }),
        );

        expect(result.status).toBe("VOIDED");
        expect(result.voidReason).toBe("Check bounced");
    });

    it("voids a payment on a PAID invoice: drops balance below full, clears paidAt, reverts status to PARTIALLY_PAID", async () => {
        const paymentRecord = makeTestPayment({
            invoice: makeTestInvoice({
                total: new Prisma.Decimal("1000.00"),
                amountPaid: new Prisma.Decimal("1000.00"),
                amountDue: new Prisma.Decimal("0.00"),
                status: "PAID",
                dueDate: new Date("2026-12-01"), // future
                payments: [
                    { id: PAY_ID, status: "RECORDED", amount: new Prisma.Decimal("600.00") },
                    { id: "pay_prior", status: "RECORDED", amount: new Prisma.Decimal("400.00") },
                ],
            }),
        });

        mocks.paymentFindFirst.mockResolvedValue(paymentRecord);
        mocks.paymentUpdate.mockResolvedValue({ ...paymentRecord, status: "VOIDED", voidReason: "Disputed swipe" });
        mocks.invoiceUpdate.mockResolvedValue({});
        mocks.invoiceHistoryCreate.mockResolvedValue({});

        await voidPayment(WS_A, PAY_ID, "Disputed swipe", adminActor);

        // Remaining active = 400.00, amountDue = 600.00, status reverts to PARTIALLY_PAID
        expect(mocks.invoiceUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    amountPaid: new Prisma.Decimal("400.00"),
                    amountDue: new Prisma.Decimal("600.00"),
                    status: "PARTIALLY_PAID",
                    paidAt: null,
                }),
            }),
        );
    });

    it("voids sole payment on invoice before dueDate: reverts status to ISSUED", async () => {
        const paymentRecord = makeTestPayment({
            invoice: makeTestInvoice({
                total: new Prisma.Decimal("1000.00"),
                amountPaid: new Prisma.Decimal("1000.00"),
                amountDue: new Prisma.Decimal("0.00"),
                status: "PAID",
                dueDate: new Date("2099-01-01"), // strictly in the future
                payments: [
                    { id: PAY_ID, status: "RECORDED", amount: new Prisma.Decimal("1000.00") },
                ],
            }),
        });

        mocks.paymentFindFirst.mockResolvedValue(paymentRecord);
        mocks.paymentUpdate.mockResolvedValue({ ...paymentRecord, status: "VOIDED" });
        mocks.invoiceUpdate.mockResolvedValue({});
        mocks.invoiceHistoryCreate.mockResolvedValue({});

        await voidPayment(WS_A, PAY_ID, "Cancelled transaction", adminActor);

        // 0 remaining active payments, future due date -> ISSUED
        expect(mocks.invoiceUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    amountPaid: new Prisma.Decimal("0.00"),
                    amountDue: new Prisma.Decimal("1000.00"),
                    status: "ISSUED",
                    paidAt: null,
                }),
            }),
        );
    });

    it("voids payment on past-due invoice: reverts status to OVERDUE per §6.2.C", async () => {
        const paymentRecord = makeTestPayment({
            invoice: makeTestInvoice({
                total: new Prisma.Decimal("1000.00"),
                amountPaid: new Prisma.Decimal("1000.00"),
                amountDue: new Prisma.Decimal("0.00"),
                status: "PAID",
                dueDate: new Date("2020-01-01"), // strictly in the past
                payments: [
                    { id: PAY_ID, status: "RECORDED", amount: new Prisma.Decimal("1000.00") },
                ],
            }),
        });

        mocks.paymentFindFirst.mockResolvedValue(paymentRecord);
        mocks.paymentUpdate.mockResolvedValue({ ...paymentRecord, status: "VOIDED" });
        mocks.invoiceUpdate.mockResolvedValue({});
        mocks.invoiceHistoryCreate.mockResolvedValue({});

        await voidPayment(WS_A, PAY_ID, "Bounced", adminActor);

        // Past due date + balance due -> OVERDUE
        expect(mocks.invoiceUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    amountPaid: new Prisma.Decimal("0.00"),
                    amountDue: new Prisma.Decimal("1000.00"),
                    status: "OVERDUE",
                    paidAt: null,
                }),
            }),
        );
    });

    it("rejects voiding a payment that is already VOIDED (PaymentAlreadyVoidedError)", async () => {
        mocks.paymentFindFirst.mockResolvedValue(makeTestPayment({ status: "VOIDED" }));

        await expect(
            voidPayment(WS_A, PAY_ID, "Re-void attempt", adminActor),
        ).rejects.toThrow(PaymentAlreadyVoidedError);
    });

    it("rejects voiding a payment with empty or whitespace-only reason (MissingVoidReasonError)", async () => {
        await expect(
            voidPayment(WS_A, PAY_ID, "", adminActor),
        ).rejects.toThrow(MissingVoidReasonError);

        await expect(
            voidPayment(WS_A, PAY_ID, "   ", adminActor),
        ).rejects.toThrow(MissingVoidReasonError);

        expect(mocks.paymentFindFirst).not.toHaveBeenCalled();
    });

    it("rejects voiding a payment on an already VOID invoice (InvoiceAlreadyVoidedError)", async () => {
        const paymentOnVoidInvoice = makeTestPayment({
            invoice: makeTestInvoice({ status: "VOID" }),
        });
        mocks.paymentFindFirst.mockResolvedValue(paymentOnVoidInvoice);

        await expect(
            voidPayment(WS_A, PAY_ID, "Attempt on void invoice", adminActor),
        ).rejects.toThrow(InvoiceAlreadyVoidedError);
    });

    it("throws PaymentNotFoundError if payment does not belong to tenant (tenant isolation)", async () => {
        mocks.paymentFindFirst.mockResolvedValue(null);

        await expect(
            voidPayment(WS_B, PAY_ID, "Tenant test", adminActor),
        ).rejects.toThrow(PaymentNotFoundError);
    });

    it("rejects TECHNICIAN, DISPATCHER, and MANAGER roles before DB read (ForbiddenError — lacks payments.void)", async () => {
        await expect(
            voidPayment(WS_A, PAY_ID, "Test", techActor),
        ).rejects.toThrow(ForbiddenError);

        await expect(
            voidPayment(WS_A, PAY_ID, "Test", dispatcherActor),
        ).rejects.toThrow(ForbiddenError);

        await expect(
            voidPayment(WS_A, PAY_ID, "Test", managerActor),
        ).rejects.toThrow(ForbiddenError);

        expect(mocks.paymentFindFirst).not.toHaveBeenCalled();
    });

    it("allows ACCOUNTANT and ADMIN roles to void payment (RBAC positive)", async () => {
        const paymentRecord = makeTestPayment();
        mocks.paymentFindFirst.mockResolvedValue(paymentRecord);
        mocks.paymentUpdate.mockResolvedValue({ ...paymentRecord, status: "VOIDED", voidReason: "Test" });
        mocks.invoiceUpdate.mockResolvedValue({});
        mocks.invoiceHistoryCreate.mockResolvedValue({});

        const resultAcc = await voidPayment(WS_A, PAY_ID, "Accounting correction", accountantActor);
        expect(resultAcc.status).toBe("VOIDED");

        const resultAdmin = await voidPayment(WS_A, PAY_ID, "Admin correction", adminActor);
        expect(resultAdmin.status).toBe("VOIDED");
    });
});
