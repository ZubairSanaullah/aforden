import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

import { Prisma } from "@/generated/prisma/client";
import {
    issueInvoice,
    voidInvoice,
    evaluateInvoiceOverdue,
    InvoiceNotFoundError,
    InvoiceStatusConflictError,
    InvoiceEmptyLineItemsError,
    InvoiceDueDateInvalidError,
    InvoiceAlreadyVoidedError,
    MissingVoidReasonError,
    InvoiceHasActivePaymentsError,
} from "@/lib/services/invoice";
import { CustomerNotFoundError } from "@/lib/services/customer/customerErrors";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

// ============================================================================
// MOCKS
// ============================================================================
const mocks = vi.hoisted(() => ({
    invoiceFindFirst: vi.fn(),
    invoiceFindMany: vi.fn(),
    invoiceUpdate: vi.fn(),
    invoiceHistoryCreate: vi.fn(),
    customerFindFirst: vi.fn(),
    $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        invoice: {
            findFirst: mocks.invoiceFindFirst,
            findMany: mocks.invoiceFindMany,
            update: mocks.invoiceUpdate,
        },
        invoiceHistory: {
            create: mocks.invoiceHistoryCreate,
        },
        customer: {
            findFirst: mocks.customerFindFirst,
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
const INV_ID = "inv_test_001";

const adminActor: WorkspaceAuthorizationContext = {
    membership: { id: "mem_admin_01", role: "ADMIN", status: "ACTIVE" },
    user: { id: "usr_admin_01", name: "Admin User", email: "admin@co.com", status: "ACTIVE", emailVerified: new Date() },
    workspace: { id: WS_A, name: "Alpha HVAC", slug: "alpha-hvac", logoUrl: null, timezone: "UTC" },
};

const techActor: WorkspaceAuthorizationContext = {
    membership: { id: "mem_tech_01", role: "TECHNICIAN", status: "ACTIVE" },
    user: { id: "usr_tech_01", name: "Field Tech", email: "tech@co.com", status: "ACTIVE", emailVerified: new Date() },
    workspace: { id: WS_A, name: "Alpha HVAC", slug: "alpha-hvac", logoUrl: null, timezone: "UTC" },
};

const dispatcherActor: WorkspaceAuthorizationContext = {
    membership: { id: "mem_disp_01", role: "DISPATCHER", status: "ACTIVE" },
    user: { id: "usr_disp_01", name: "Dispatcher", email: "disp@co.com", status: "ACTIVE", emailVerified: new Date() },
    workspace: { id: WS_A, name: "Alpha HVAC", slug: "alpha-hvac", logoUrl: null, timezone: "UTC" },
};

// ============================================================================
// HELPERS: build invoice records with correct Decimal fields
// ============================================================================
const BASE_ISSUE_DATE = new Date("2026-08-01");
const BASE_DUE_DATE = new Date("2026-09-01");

function makeDraftInvoice(overrides: Record<string, unknown> = {}) {
    return {
        id: INV_ID,
        workspaceId: WS_A,
        invoiceNumber: "INV-2026-000001",
        customerId: "cust_01",
        locationId: null,
        quoteId: null,
        workOrderId: null,
        status: "DRAFT",
        title: "Test Invoice",
        notes: null,
        internalNotes: null,
        termsAndConditions: null,
        currencyCode: "USD",
        issueDate: BASE_ISSUE_DATE,
        dueDate: BASE_DUE_DATE,
        discountType: "FIXED",
        discountValue: new Prisma.Decimal("0.00"),
        discountAmount: new Prisma.Decimal("0.00"),
        taxRate: new Prisma.Decimal("0.0000"),
        taxAmount: new Prisma.Decimal("0.00"),
        subtotal: new Prisma.Decimal("500.00"),
        total: new Prisma.Decimal("500.00"),
        amountPaid: new Prisma.Decimal("0.00"),
        amountDue: new Prisma.Decimal("500.00"),
        issuedAt: null,
        paidAt: null,
        voidedAt: null,
        voidReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        customer: { id: "cust_01", customerNumber: null, name: "Acme Corp", email: null, phone: null },
        location: null,
        quote: null,
        workOrder: null,
        payments: [],
        lineItems: [
            {
                id: "li_01",
                invoiceId: INV_ID,
                workspaceId: WS_A,
                lineItemType: "LABOR",
                workTypeId: null,
                partId: null,
                name: "Labor",
                description: null,
                workTypeName: null,
                workTypeCode: null,
                partName: null,
                partSku: null,
                partUnitOfMeasure: null,
                quantity: new Prisma.Decimal("5.00"),
                unitPrice: new Prisma.Decimal("100.00"),
                unitCost: null,
                discountAmount: new Prisma.Decimal("0.00"),
                subtotal: new Prisma.Decimal("500.00"),
                taxRate: new Prisma.Decimal("0.0000"),
                taxAmount: new Prisma.Decimal("0.00"),
                total: new Prisma.Decimal("500.00"),
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        ],
        ...overrides,
    };
}

function makeIssuedInvoice(overrides: Record<string, unknown> = {}) {
    return {
        ...makeDraftInvoice(),
        status: "ISSUED",
        issuedAt: new Date("2026-08-05"),
        ...overrides,
    };
}

beforeEach(() => {
    vi.clearAllMocks();

    // Default $transaction passthrough — returns the result of the callback
    mocks.$transaction.mockImplementation(async (cb: any) => {
        if (typeof cb === "function") {
            return cb({
                invoice: {
                    findFirst: mocks.invoiceFindFirst,
                    update: mocks.invoiceUpdate,
                    findMany: mocks.invoiceFindMany,
                },
                invoiceHistory: {
                    create: mocks.invoiceHistoryCreate,
                },
                customer: {
                    findFirst: mocks.customerFindFirst,
                },
            });
        }
        return cb;
    });
});

// ============================================================================
// 1. ISSUE INVOICE
// ============================================================================
describe("Phase 1.12.9 — issueInvoice", () => {
    it("transitions a DRAFT invoice to ISSUED, sets amountDue=total and amountPaid=0.00, writes InvoiceHistory", async () => {
        const draft = makeDraftInvoice();
        mocks.invoiceFindFirst.mockResolvedValue(draft);
        mocks.customerFindFirst.mockResolvedValue({ id: "cust_01", name: "Acme Corp", status: "ACTIVE" });

        const issuedRecord = { ...draft, status: "ISSUED", issuedAt: new Date(), amountDue: new Prisma.Decimal("500.00"), amountPaid: new Prisma.Decimal("0.00") };
        mocks.invoiceUpdate.mockResolvedValue(issuedRecord);
        mocks.invoiceHistoryCreate.mockResolvedValue({ id: "hist_01" });

        const result = await issueInvoice(WS_A, INV_ID, adminActor);

        // Verify update includes amountDue and amountPaid reset (§6.2.A step 6)
        expect(mocks.invoiceUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    status: "ISSUED",
                    issuedAt: expect.any(Date),
                    amountDue: draft.total,   // = invoice.total snapshot
                    amountPaid: "0.00",
                }),
            }),
        );

        expect(mocks.invoiceHistoryCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    eventType: "ISSUED",
                    field: "status",
                    oldValue: "DRAFT",
                    newValue: "ISSUED",
                    actorMemberId: "mem_admin_01",
                }),
            }),
        );

        expect(result.status).toBe("ISSUED");
    });

    it("returns idempotent success when invoice is already ISSUED — no DB write (§6.2.A step 3)", async () => {
        const alreadyIssued = makeIssuedInvoice();
        mocks.invoiceFindFirst.mockResolvedValue(alreadyIssued);

        const result = await issueInvoice(WS_A, INV_ID, adminActor);

        // No update, no history write — idempotent path
        expect(mocks.invoiceUpdate).not.toHaveBeenCalled();
        expect(mocks.invoiceHistoryCreate).not.toHaveBeenCalled();
        expect(mocks.$transaction).not.toHaveBeenCalled();
        expect(result.status).toBe("ISSUED");
    });

    it.each(["PARTIALLY_PAID", "PAID", "OVERDUE", "VOID"] as const)(
        "rejects issuing an invoice with status %s (InvoiceStatusConflictError)",
        async (status) => {
            mocks.invoiceFindFirst.mockResolvedValue(makeDraftInvoice({ status }));

            await expect(
                issueInvoice(WS_A, INV_ID, adminActor),
            ).rejects.toThrow(InvoiceStatusConflictError);
        },
    );

    it("rejects when invoice has no line items (InvoiceEmptyLineItemsError)", async () => {
        mocks.invoiceFindFirst.mockResolvedValue(
            makeDraftInvoice({ lineItems: [] }),
        );

        await expect(
            issueInvoice(WS_A, INV_ID, adminActor),
        ).rejects.toThrow(InvoiceEmptyLineItemsError);
    });

    it("rejects when dueDate is before issueDate (InvoiceDueDateInvalidError)", async () => {
        mocks.invoiceFindFirst.mockResolvedValue(
            makeDraftInvoice({
                issueDate: new Date("2026-09-01"),
                dueDate: new Date("2026-08-01"), // before issueDate
            }),
        );

        await expect(
            issueInvoice(WS_A, INV_ID, adminActor),
        ).rejects.toThrow(InvoiceDueDateInvalidError);
    });

    it("rejects when customer no longer exists in workspace (CustomerNotFoundError)", async () => {
        mocks.invoiceFindFirst.mockResolvedValue(makeDraftInvoice());
        // Customer deleted or not in workspace
        mocks.customerFindFirst.mockResolvedValue(null);

        await expect(
            issueInvoice(WS_A, INV_ID, adminActor),
        ).rejects.toThrow(CustomerNotFoundError);
    });

    it("rejects when customer exists but is INACTIVE (CustomerNotFoundError — activeness check)", async () => {
        // The customer findFirst WHERE clause includes status: 'ACTIVE'.
        // An INACTIVE customer returns null from that query.
        mocks.invoiceFindFirst.mockResolvedValue(makeDraftInvoice());
        mocks.customerFindFirst.mockResolvedValue(null); // INACTIVE customer → null from status=ACTIVE filter

        await expect(
            issueInvoice(WS_A, INV_ID, adminActor),
        ).rejects.toThrow(CustomerNotFoundError);
    });

    it("throws InvoiceNotFoundError if invoice is not in tenant (tenant isolation)", async () => {
        // Invoice belongs to WS_A — call scoped to WS_B
        mocks.invoiceFindFirst.mockResolvedValue(null);

        await expect(
            issueInvoice(WS_B, INV_ID, adminActor),
        ).rejects.toThrow(InvoiceNotFoundError);
    });

    it("rejects TECHNICIAN role with ForbiddenError before any DB read", async () => {
        await expect(
            issueInvoice(WS_A, INV_ID, techActor),
        ).rejects.toThrow(ForbiddenError);
        expect(mocks.invoiceFindFirst).not.toHaveBeenCalled();
    });

    it("DISPATCHER role has invoices.issue and can issue an invoice", async () => {
        const draft = makeDraftInvoice();
        mocks.invoiceFindFirst.mockResolvedValue(draft);
        mocks.customerFindFirst.mockResolvedValue({ id: "cust_01", status: "ACTIVE" });
        mocks.invoiceUpdate.mockResolvedValue({ ...draft, status: "ISSUED", issuedAt: new Date() });
        mocks.invoiceHistoryCreate.mockResolvedValue({ id: "hist_01" });

        const result = await issueInvoice(WS_A, INV_ID, dispatcherActor);
        expect(result.status).toBe("ISSUED");
    });
});

// ============================================================================
// 2. VOID INVOICE
// ============================================================================
describe("Phase 1.12.9 — voidInvoice", () => {
    it.each(["ISSUED", "OVERDUE", "PARTIALLY_PAID"] as const)(
        "voids an invoice in %s status, sets amountDue=0.00, writes InvoiceHistory with prior status as oldValue",
        async (status) => {
            const inv = makeIssuedInvoice({ status });
            mocks.invoiceFindFirst.mockResolvedValue(inv);
            const voidedRec = { ...inv, status: "VOID", voidedAt: new Date(), voidReason: "Duplicate billing", amountDue: new Prisma.Decimal("0.00") };
            mocks.invoiceUpdate.mockResolvedValue(voidedRec);
            mocks.invoiceHistoryCreate.mockResolvedValue({ id: "hist_void_01" });

            const result = await voidInvoice(WS_A, INV_ID, "Duplicate billing", adminActor);

            // §6.2.B step 6: amountDue must be 0.00 in the update
            expect(mocks.invoiceUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        status: "VOID",
                        voidedAt: expect.any(Date),
                        voidReason: "Duplicate billing",
                        amountDue: new Prisma.Decimal("0.00"),
                    }),
                }),
            );

            // oldValue must be the actual prior status, not hardcoded "ISSUED"
            expect(mocks.invoiceHistoryCreate).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        eventType: "VOIDED",
                        field: "status",
                        oldValue: status,
                        newValue: "VOID",
                    }),
                }),
            );

            expect(result.status).toBe("VOID");
        },
    );

    it("throws InvoiceAlreadyVoidedError (not InvoiceStatusConflictError) when status is VOID", async () => {
        mocks.invoiceFindFirst.mockResolvedValue(makeIssuedInvoice({ status: "VOID" }));

        // Must be InvoiceAlreadyVoidedError specifically — per §6.2.B step 4
        await expect(
            voidInvoice(WS_A, INV_ID, "Some reason", adminActor),
        ).rejects.toThrow(InvoiceAlreadyVoidedError);
    });

    it.each(["DRAFT", "PAID"] as const)(
        "rejects voiding an invoice in %s status (InvoiceStatusConflictError — not already-voided)",
        async (status) => {
            mocks.invoiceFindFirst.mockResolvedValue(makeIssuedInvoice({ status }));

            const err = await voidInvoice(WS_A, INV_ID, "Some reason", adminActor).catch((e) => e);
            expect(err).toBeInstanceOf(InvoiceStatusConflictError);
            // Must NOT be InvoiceAlreadyVoidedError — those are distinct guards
            expect(err).not.toBeInstanceOf(InvoiceAlreadyVoidedError);
        },
    );

    it("rejects void when any non-VOIDED payment exists (InvoiceHasActivePaymentsError)", async () => {
        const issuedWithPayment = makeIssuedInvoice({
            payments: [
                {
                    id: "pay_01",
                    status: "RECORDED",
                    amount: new Prisma.Decimal("250.00"),
                },
            ],
        });
        mocks.invoiceFindFirst.mockResolvedValue(issuedWithPayment);

        await expect(
            voidInvoice(WS_A, INV_ID, "Customer disputed", adminActor),
        ).rejects.toThrow(InvoiceHasActivePaymentsError);
    });

    it("allows void when all payments are VOIDED (no active payments)", async () => {
        const inv = makeIssuedInvoice({
            payments: [{ id: "pay_01", status: "VOIDED", amount: new Prisma.Decimal("500.00") }],
        });
        mocks.invoiceFindFirst.mockResolvedValue(inv);
        const voidedRec = { ...inv, status: "VOID", voidedAt: new Date(), voidReason: "Cleared", amountDue: new Prisma.Decimal("0.00") };
        mocks.invoiceUpdate.mockResolvedValue(voidedRec);
        mocks.invoiceHistoryCreate.mockResolvedValue({ id: "hist_void_02" });

        const result = await voidInvoice(WS_A, INV_ID, "Cleared", adminActor);
        expect(result.status).toBe("VOID");
    });

    it("rejects void with empty reason string (MissingVoidReasonError — before DB read)", async () => {
        await expect(
            voidInvoice(WS_A, INV_ID, "", adminActor),
        ).rejects.toThrow(MissingVoidReasonError);
        expect(mocks.invoiceFindFirst).not.toHaveBeenCalled();
    });

    it("rejects void with whitespace-only reason (MissingVoidReasonError)", async () => {
        await expect(
            voidInvoice(WS_A, INV_ID, "   ", adminActor),
        ).rejects.toThrow(MissingVoidReasonError);
    });

    it("leaves subtotal/total/taxAmount/lineItems byte-identical after void (snapshot invariant)", async () => {
        const issued = makeIssuedInvoice();
        mocks.invoiceFindFirst.mockResolvedValue(issued);
        mocks.invoiceUpdate.mockResolvedValue({ ...issued, status: "VOID", voidedAt: new Date(), voidReason: "Test", amountDue: new Prisma.Decimal("0.00") });
        mocks.invoiceHistoryCreate.mockResolvedValue({ id: "hist_snap" });

        await voidInvoice(WS_A, INV_ID, "Test", adminActor);

        const updateCall = mocks.invoiceUpdate.mock.calls[0][0];
        // Financial snapshot fields must NOT appear in the update
        expect(updateCall.data).not.toHaveProperty("total");
        expect(updateCall.data).not.toHaveProperty("subtotal");
        expect(updateCall.data).not.toHaveProperty("taxAmount");
        expect(updateCall.data).not.toHaveProperty("discountAmount");
        expect(updateCall.data).not.toHaveProperty("lineItems");
        expect(updateCall.data).not.toHaveProperty("amountPaid");
        // amountDue IS expected (zeroed per §6.2.B step 6) — not a snapshot field
        expect(updateCall.data).toHaveProperty("amountDue", new Prisma.Decimal("0.00"));
    });

    it("throws InvoiceNotFoundError for cross-tenant invoice ID (tenant isolation)", async () => {
        mocks.invoiceFindFirst.mockResolvedValue(null);

        await expect(
            voidInvoice(WS_B, INV_ID, "Some reason", adminActor),
        ).rejects.toThrow(InvoiceNotFoundError);
    });

    it("rejects TECHNICIAN role before DB read (ForbiddenError)", async () => {
        await expect(
            voidInvoice(WS_A, INV_ID, "Some reason", techActor),
        ).rejects.toThrow(ForbiddenError);
        expect(mocks.invoiceFindFirst).not.toHaveBeenCalled();
    });

    it("DISPATCHER cannot void (lacks invoices.void) — ForbiddenError", async () => {
        await expect(
            voidInvoice(WS_A, INV_ID, "Some reason", dispatcherActor),
        ).rejects.toThrow(ForbiddenError);
    });
});

// ============================================================================
// 3. EVALUATE INVOICE OVERDUE
// ============================================================================
describe("Phase 1.12.9 — evaluateInvoiceOverdue", () => {
    const pastDue = new Date("2026-07-01");
    const futureNow = new Date("2026-08-25");

    it("transitions ISSUED past-due invoices to OVERDUE and writes OVERDUE_MARKED history", async () => {
        const issuedInv = {
            id: "inv_overdue_01",
            invoiceNumber: "INV-2026-000099",
            dueDate: pastDue,
            workspaceId: WS_A,
            status: "ISSUED",
        };

        mocks.invoiceFindMany
            .mockResolvedValueOnce([{ workspaceId: WS_A }]) // workspace enumeration
            .mockResolvedValueOnce([issuedInv]); // per-workspace query

        mocks.invoiceFindFirst.mockResolvedValue({ id: "inv_overdue_01", status: "ISSUED" });
        mocks.invoiceUpdate.mockResolvedValue({ ...issuedInv, status: "OVERDUE" });
        mocks.invoiceHistoryCreate.mockResolvedValue({ id: "hist_overdue_01" });

        const result = await evaluateInvoiceOverdue("ALL", futureNow);

        expect(result.transitionedCount).toBe(1);
        expect(result.processedCount).toBe(1);

        expect(mocks.invoiceUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ data: { status: "OVERDUE" } }),
        );

        expect(mocks.invoiceHistoryCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    eventType: "OVERDUE_MARKED",
                    actorMemberId: null,
                    actorName: "System",
                    field: "status",
                    oldValue: "ISSUED",
                    newValue: "OVERDUE",
                    metadata: expect.objectContaining({ system: true }),
                }),
            }),
        );
    });

    it("transitions PARTIALLY_PAID past-due invoices to OVERDUE (§6.1 line 628 — locked architecture)", async () => {
        // This is the key regression: PARTIALLY_PAID → OVERDUE is a locked edge.
        const partialInv = {
            id: "inv_partial_01",
            invoiceNumber: "INV-2026-000100",
            dueDate: pastDue,
            workspaceId: WS_A,
            status: "PARTIALLY_PAID",
        };

        mocks.invoiceFindMany.mockResolvedValueOnce([partialInv]);
        mocks.invoiceFindFirst.mockResolvedValue({ id: "inv_partial_01", status: "PARTIALLY_PAID" });
        mocks.invoiceUpdate.mockResolvedValue({ ...partialInv, status: "OVERDUE" });
        mocks.invoiceHistoryCreate.mockResolvedValue({ id: "hist_partial_01" });

        const result = await evaluateInvoiceOverdue(WS_A, futureNow);

        expect(result.transitionedCount).toBe(1);
        // History must record the correct prior status
        expect(mocks.invoiceHistoryCreate).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    eventType: "OVERDUE_MARKED",
                    oldValue: "PARTIALLY_PAID",
                    newValue: "OVERDUE",
                }),
            }),
        );
    });

    it("scoped to specific workspace only processes that workspace's invoices", async () => {
        const overdueInWsA = {
            id: "inv_a_01",
            invoiceNumber: "INV-2026-000001",
            dueDate: pastDue,
            workspaceId: WS_A,
            status: "ISSUED",
        };

        mocks.invoiceFindMany.mockResolvedValueOnce([overdueInWsA]);
        mocks.invoiceFindFirst.mockResolvedValue({ id: "inv_a_01", status: "ISSUED" });
        mocks.invoiceUpdate.mockResolvedValue({ ...overdueInWsA, status: "OVERDUE" });
        mocks.invoiceHistoryCreate.mockResolvedValue({ id: "hist_01" });

        const result = await evaluateInvoiceOverdue(WS_A, futureNow);

        expect(result.workspacesProcessed).toBe(1);
        expect(result.transitionedCount).toBe(1);
    });

    it("skips DRAFT, PAID, VOID, and already-OVERDUE invoices (only ISSUED and PARTIALLY_PAID are eligible)", async () => {
        // No ISSUED or PARTIALLY_PAID invoices in workspace → nothing to do
        mocks.invoiceFindMany.mockResolvedValueOnce([]);

        const result = await evaluateInvoiceOverdue(WS_A, futureNow);

        expect(result.transitionedCount).toBe(0);
        expect(result.processedCount).toBe(0);
        expect(mocks.invoiceUpdate).not.toHaveBeenCalled();
    });

    it("includes amountDue > 0 in where clause and skips past-due invoices with amountDue <= 0", async () => {
        // FindMany called with amountDue: { gt: 0 } filter
        mocks.invoiceFindMany.mockResolvedValueOnce([]); // no rows with amountDue > 0

        const result = await evaluateInvoiceOverdue(WS_A, futureNow);

        expect(mocks.invoiceFindMany).toHaveBeenCalledWith(
            expect.objectContaining({
                where: expect.objectContaining({
                    status: { in: ["ISSUED", "PARTIALLY_PAID"] },
                    dueDate: { lt: futureNow },
                    amountDue: { gt: 0 },
                }),
            }),
        );
        expect(result.transitionedCount).toBe(0);
    });

    it("is idempotent: running twice produces no duplicate OVERDUE_MARKED history entries", async () => {
        const candidateInv = {
            id: "inv_idem_01",
            invoiceNumber: "INV-2026-000002",
            dueDate: pastDue,
            workspaceId: WS_A,
            status: "ISSUED",
        };

        mocks.invoiceFindMany
            .mockResolvedValueOnce([candidateInv]) // First run: finds candidate
            .mockResolvedValueOnce([]);              // Second run: already OVERDUE, not in result set

        mocks.invoiceFindFirst.mockResolvedValueOnce({ id: "inv_idem_01", status: "ISSUED" });
        mocks.invoiceUpdate.mockResolvedValue({ ...candidateInv, status: "OVERDUE" });
        mocks.invoiceHistoryCreate.mockResolvedValue({ id: "hist_idem_01" });

        const result1 = await evaluateInvoiceOverdue(WS_A, futureNow);
        expect(result1.transitionedCount).toBe(1);

        const result2 = await evaluateInvoiceOverdue(WS_A, futureNow);
        expect(result2.transitionedCount).toBe(0);

        // History created exactly once
        expect(mocks.invoiceHistoryCreate).toHaveBeenCalledTimes(1);
    });

    it("idempotency guard: re-fetch inside tx sees non-eligible status → skips transition, transitionedCount=0", async () => {
        const candidateInv = {
            id: "inv_race_01",
            invoiceNumber: "INV-2026-000003",
            dueDate: pastDue,
            workspaceId: WS_A,
            status: "ISSUED",
        };

        mocks.invoiceFindMany.mockResolvedValueOnce([candidateInv]);
        // Inner re-fetch returns null → already changed (race condition)
        mocks.invoiceFindFirst.mockResolvedValueOnce(null);

        const result = await evaluateInvoiceOverdue(WS_A, futureNow);

        expect(result.processedCount).toBe(1);
        expect(result.transitionedCount).toBe(0);
        expect(mocks.invoiceUpdate).not.toHaveBeenCalled();
        expect(mocks.invoiceHistoryCreate).not.toHaveBeenCalled();
    });

    it("tenant isolation: ALL path only processes workspaces enumerated from eligible invoices", async () => {
        mocks.invoiceFindMany
            .mockResolvedValueOnce([{ workspaceId: WS_A }]) // workspace discovery
            .mockResolvedValueOnce([{
                id: "inv_a_01",
                invoiceNumber: "INV-2026-000001",
                dueDate: pastDue,
                workspaceId: WS_A,
                status: "ISSUED",
            }]);

        mocks.invoiceFindFirst.mockResolvedValue({ id: "inv_a_01", status: "ISSUED" });
        mocks.invoiceUpdate.mockResolvedValue({ id: "inv_a_01", status: "OVERDUE" });
        mocks.invoiceHistoryCreate.mockResolvedValue({ id: "hist_01" });

        const result = await evaluateInvoiceOverdue("ALL", futureNow);

        const historyCall = mocks.invoiceHistoryCreate.mock.calls[0][0];
        expect(historyCall.data.workspaceId).toBe(WS_A);
        expect(result.workspacesProcessed).toBe(1);
    });

    it("returns error summary when one invoice fails, continues processing others", async () => {
        const inv1 = { id: "inv_ok_01", invoiceNumber: "INV-2026-000001", dueDate: pastDue, workspaceId: WS_A, status: "ISSUED" };
        const inv2 = { id: "inv_fail_02", invoiceNumber: "INV-2026-000002", dueDate: pastDue, workspaceId: WS_A, status: "ISSUED" };

        mocks.invoiceFindMany.mockResolvedValueOnce([inv1, inv2]);

        mocks.invoiceFindFirst
            .mockResolvedValueOnce({ id: "inv_ok_01", status: "ISSUED" })
            .mockResolvedValueOnce({ id: "inv_fail_02", status: "ISSUED" });

        mocks.invoiceHistoryCreate.mockResolvedValue({ id: "hist_01" });

        let callCount = 0;
        mocks.invoiceUpdate.mockImplementation(() => {
            callCount++;
            if (callCount === 2) throw new Error("DB write failed for inv_fail_02");
            return { id: "inv_ok_01", status: "OVERDUE" };
        });

        const result = await evaluateInvoiceOverdue(WS_A, futureNow);

        expect(result.transitionedCount).toBe(1);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].invoiceId).toBe("inv_fail_02");
        expect(result.errors[0].error).toContain("DB write failed");
    });
});
