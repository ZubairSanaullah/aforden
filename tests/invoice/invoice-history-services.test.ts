import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

import { Prisma } from "@/generated/prisma/client";
import {
    createInvoice,
    addInvoiceLineItem,
    issueInvoice,
    recordPayment,
    voidPayment,
    evaluateInvoiceOverdue,
    voidInvoice,
    getInvoiceHistory,
    listInvoiceHistoryEvents,
    InvoiceNotFoundError,
    InvoiceStatusConflictError,
} from "@/lib/services/invoice";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

// ============================================================================
// MOCKS & IN-MEMORY STORE
// ============================================================================
const mocks = vi.hoisted(() => ({
    invoiceFindFirst: vi.fn(),
    invoiceFindUnique: vi.fn(),
    invoiceFindMany: vi.fn(),
    invoiceCreate: vi.fn(),
    invoiceUpdate: vi.fn(),
    invoiceLineItemCreate: vi.fn(),
    invoiceLineItemFindMany: vi.fn(),
    invoiceLineItemUpdate: vi.fn(),
    paymentFindFirst: vi.fn(),
    paymentCreate: vi.fn(),
    paymentUpdate: vi.fn(),
    invoiceHistoryCreate: vi.fn(),
    invoiceHistoryFindMany: vi.fn(),
    invoiceHistoryCount: vi.fn(),
    customerFindFirst: vi.fn(),
    serviceLocationFindFirst: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workTypeFindFirst: vi.fn(),
    partFindFirst: vi.fn(),
    $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        invoice: {
            findFirst: mocks.invoiceFindFirst,
            findUnique: mocks.invoiceFindUnique,
            findMany: mocks.invoiceFindMany,
            create: mocks.invoiceCreate,
            update: mocks.invoiceUpdate,
        },
        invoiceLineItem: {
            create: mocks.invoiceLineItemCreate,
            findMany: mocks.invoiceLineItemFindMany,
            update: mocks.invoiceLineItemUpdate,
        },
        payment: {
            findFirst: mocks.paymentFindFirst,
            create: mocks.paymentCreate,
            update: mocks.paymentUpdate,
        },
        invoiceHistory: {
            create: mocks.invoiceHistoryCreate,
            findMany: mocks.invoiceHistoryFindMany,
            count: mocks.invoiceHistoryCount,
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

const WS_A = "ws_tenant_alpha";
const WS_B = "ws_tenant_beta";
const INV_ID = "inv_test_history_01";

const adminActor: WorkspaceAuthorizationContext = {
    membership: { id: "mem_admin_01", role: "ADMIN", status: "ACTIVE" },
    user: { id: "usr_admin_01", name: "Alice Admin", email: "alice@alpha.com", status: "ACTIVE", emailVerified: new Date() },
    workspace: { id: WS_A, name: "Alpha HVAC", slug: "alpha-hvac", logoUrl: null, timezone: "UTC" },
};

const techActor: WorkspaceAuthorizationContext = {
    membership: { id: "mem_tech_01", role: "TECHNICIAN", status: "ACTIVE" },
    user: { id: "usr_tech_01", name: "Bob Tech", email: "bob@alpha.com", status: "ACTIVE", emailVerified: new Date() },
    workspace: { id: WS_A, name: "Alpha HVAC", slug: "alpha-hvac", logoUrl: null, timezone: "UTC" },
};

beforeEach(() => {
    vi.clearAllMocks();

    mocks.$transaction.mockImplementation(async (cb: any) => {
        if (typeof cb === "function") {
            return cb({
                invoice: {
                    findFirst: mocks.invoiceFindFirst,
                    findUnique: mocks.invoiceFindUnique,
                    create: mocks.invoiceCreate,
                    update: mocks.invoiceUpdate,
                },
                invoiceLineItem: {
                    create: mocks.invoiceLineItemCreate,
                    findMany: mocks.invoiceLineItemFindMany,
                    update: mocks.invoiceLineItemUpdate,
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

describe("Phase 1.12.12 — Invoice & Payment Operational History Services", () => {
    // ------------------------------------------------------------------------
    // 1. Full Multi-Step Lifecycle History Integration Test
    // ------------------------------------------------------------------------
    describe("1. Multi-Step Lifecycle History Integration", () => {
        it("drives real mutation services (create -> addLineItem -> issue -> partial payment -> void payment -> overdue mark -> full payment -> void attempt rejected) and verifies getInvoiceHistory captures exact sequence", async () => {
            const inMemoryHistoryLog: any[] = [];
            let historySeq = 1;

            // Intercept all tx.invoiceHistory.create calls to append into inMemoryHistoryLog
            mocks.invoiceHistoryCreate.mockImplementation(async ({ data }: any) => {
                const entry = {
                    id: `hist_${String(historySeq++).padStart(3, "0")}`,
                    invoiceId: data.invoiceId,
                    workspaceId: data.workspaceId,
                    eventType: data.eventType,
                    actorMemberId: data.actorMemberId ?? null,
                    actorName: data.actorName ?? null,
                    field: data.field ?? null,
                    oldValue: data.oldValue ?? null,
                    newValue: data.newValue ?? null,
                    metadata: data.metadata ?? null,
                    createdAt: new Date(Date.now() + inMemoryHistoryLog.length * 1000),
                };
                inMemoryHistoryLog.push(entry);
                return entry;
            });

            // Mock database states for lifecycle driver
            mocks.customerFindFirst.mockResolvedValue({ id: "cust_01", status: "ACTIVE" });
            mocks.workspaceFindUnique.mockResolvedValue({ id: WS_A, defaultCurrencyCode: "USD" });

            // 1. Step 1: createInvoice
            mocks.invoiceFindFirst.mockResolvedValueOnce(null); // sequence lookup
            mocks.invoiceCreate.mockResolvedValueOnce({
                id: INV_ID,
                workspaceId: WS_A,
                invoiceNumber: "INV-2026-000001",
                customerId: "cust_01",
                locationId: null,
                quoteId: null,
                workOrderId: null,
                status: "DRAFT",
                title: "HVAC Installation",
                currencyCode: "USD",
                issueDate: new Date(),
                dueDate: new Date("2026-09-01"),
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

            await createInvoice(
                WS_A,
                { customerId: "cust_01", title: "HVAC Installation", issueDate: new Date("2026-09-01"), dueDate: new Date("2026-09-01") },
                adminActor,
            );

            // 2. Step 2: addInvoiceLineItem
            mocks.invoiceFindFirst.mockResolvedValue({
                id: INV_ID,
                workspaceId: WS_A,
                status: "DRAFT",
                discountType: "PERCENTAGE",
                discountValue: new Prisma.Decimal("0.00"),
                taxRate: new Prisma.Decimal("0.0000"),
                lineItems: [],
                payments: [],
            });
            mocks.invoiceLineItemCreate.mockResolvedValue({
                id: "li_01",
                invoiceId: INV_ID,
                workspaceId: WS_A,
                lineItemType: "LABOR",
                name: "Diagnostic Service",
                quantity: new Prisma.Decimal("1.00"),
                unitPrice: new Prisma.Decimal("200.00"),
                unitCost: new Prisma.Decimal("50.00"),
                discountAmount: new Prisma.Decimal("0.00"),
                taxRate: new Prisma.Decimal("0.0000"),
                subtotal: new Prisma.Decimal("200.00"),
                taxAmount: new Prisma.Decimal("0.00"),
                total: new Prisma.Decimal("200.00"),
                sortOrder: 0,
            });
            mocks.invoiceLineItemFindMany.mockResolvedValue([
                {
                    id: "li_01",
                    sortOrder: 0,
                    quantity: new Prisma.Decimal("1.00"),
                    unitPrice: new Prisma.Decimal("200.00"),
                    unitCost: new Prisma.Decimal("50.00"),
                    discountAmount: new Prisma.Decimal("0.00"),
                    taxRate: new Prisma.Decimal("0.0000"),
                    name: "Diagnostic Service",
                },
            ]);
            mocks.invoiceUpdate.mockResolvedValue({});
            mocks.invoiceFindUnique.mockResolvedValue({
                id: INV_ID,
                workspaceId: WS_A,
                status: "DRAFT",
                total: new Prisma.Decimal("200.00"),
                amountDue: new Prisma.Decimal("200.00"),
                amountPaid: new Prisma.Decimal("0.00"),
                lineItems: [{ id: "li_01", name: "Diagnostic Service", total: new Prisma.Decimal("200.00") }],
                payments: [],
            });

            await addInvoiceLineItem(
                WS_A,
                INV_ID,
                { lineItemType: "LABOR", name: "Diagnostic Service", unitPrice: 200, quantity: 1 },
                adminActor,
            );

            // 3. Step 3: issueInvoice
            mocks.invoiceFindFirst.mockResolvedValue({
                id: INV_ID,
                workspaceId: WS_A,
                customerId: "cust_01",
                status: "DRAFT",
                total: new Prisma.Decimal("200.00"),
                amountDue: new Prisma.Decimal("200.00"),
                amountPaid: new Prisma.Decimal("0.00"),
                lineItems: [{ id: "li_01", quantity: new Prisma.Decimal("1.00"), unitPrice: new Prisma.Decimal("200.00") }],
                payments: [],
            });

            await issueInvoice(WS_A, INV_ID, adminActor);

            // 4. Step 4: recordPayment (partial: 50.00)
            mocks.invoiceFindFirst.mockResolvedValue({
                id: INV_ID,
                workspaceId: WS_A,
                customerId: "cust_01",
                currencyCode: "USD",
                status: "ISSUED",
                total: new Prisma.Decimal("200.00"),
                amountPaid: new Prisma.Decimal("0.00"),
                amountDue: new Prisma.Decimal("200.00"),
                payments: [],
            });
            mocks.paymentFindFirst.mockResolvedValue(null);
            mocks.paymentCreate.mockResolvedValue({
                id: "pay_01",
                workspaceId: WS_A,
                invoiceId: INV_ID,
                paymentNumber: "PAY-2026-000001",
                customerId: "cust_01",
                amount: new Prisma.Decimal("50.00"),
                currencyCode: "USD",
                paymentMethod: "CHECK",
                status: "RECORDED",
                paymentDate: new Date(),
                recordedByMemberId: "mem_admin_01",
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await recordPayment(
                WS_A,
                INV_ID,
                { amount: 50, paymentMethod: "CHECK" },
                adminActor,
            );

            // 5. Step 5: voidPayment
            mocks.paymentFindFirst.mockResolvedValue({
                id: "pay_01",
                workspaceId: WS_A,
                invoiceId: INV_ID,
                paymentNumber: "PAY-2026-000001",
                customerId: "cust_01",
                amount: new Prisma.Decimal("50.00"),
                currencyCode: "USD",
                paymentMethod: "CHECK",
                status: "RECORDED",
                paymentDate: new Date(),
                recordedByMemberId: "mem_admin_01",
                voidedAt: null,
                voidedByMemberId: null,
                voidReason: null,
                invoice: {
                    id: INV_ID,
                    workspaceId: WS_A,
                    status: "PARTIALLY_PAID",
                    total: new Prisma.Decimal("200.00"),
                    amountPaid: new Prisma.Decimal("50.00"),
                    amountDue: new Prisma.Decimal("150.00"),
                    dueDate: new Date("2026-09-01"),
                    payments: [{ id: "pay_01", status: "RECORDED", amount: new Prisma.Decimal("50.00") }],
                },
            });
            mocks.paymentUpdate.mockResolvedValue({
                id: "pay_01",
                status: "VOIDED",
                paymentNumber: "PAY-2026-000001",
                amount: new Prisma.Decimal("50.00"),
                currencyCode: "USD",
                paymentMethod: "CHECK",
                paymentDate: new Date(),
                voidReason: "Check NSF",
            });

            await voidPayment(WS_A, "pay_01", "Check NSF", adminActor);

            // 6. Step 6: evaluateInvoiceOverdue (system transition)
            mocks.invoiceFindMany.mockResolvedValue([
                { id: INV_ID, workspaceId: WS_A, dueDate: new Date("2020-01-01"), status: "ISSUED", amountDue: new Prisma.Decimal("200.00") },
            ]);
            mocks.invoiceFindFirst.mockResolvedValue({
                id: INV_ID,
                workspaceId: WS_A,
                status: "ISSUED",
                dueDate: new Date("2020-01-01"),
                amountDue: new Prisma.Decimal("200.00"),
            });

            await evaluateInvoiceOverdue(WS_A);

            // 7. Step 7: recordPayment (full 200.00)
            mocks.invoiceFindFirst.mockResolvedValue({
                id: INV_ID,
                workspaceId: WS_A,
                customerId: "cust_01",
                currencyCode: "USD",
                status: "OVERDUE",
                total: new Prisma.Decimal("200.00"),
                amountPaid: new Prisma.Decimal("0.00"),
                amountDue: new Prisma.Decimal("200.00"),
                payments: [{ id: "pay_01", status: "VOIDED", amount: new Prisma.Decimal("50.00") }],
            });
            mocks.paymentFindFirst.mockResolvedValue({ paymentNumber: "PAY-2026-000001" });
            mocks.paymentCreate.mockResolvedValue({
                id: "pay_02",
                workspaceId: WS_A,
                invoiceId: INV_ID,
                paymentNumber: "PAY-2026-000002",
                customerId: "cust_01",
                amount: new Prisma.Decimal("200.00"),
                currencyCode: "USD",
                paymentMethod: "CREDIT_CARD",
                status: "RECORDED",
                paymentDate: new Date(),
                recordedByMemberId: "mem_admin_01",
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await recordPayment(
                WS_A,
                INV_ID,
                { amount: 200, paymentMethod: "CREDIT_CARD" },
                adminActor,
            );

            // 8. Step 8: voidInvoice attempt rejected on PAID invoice (generates 0 new history entries)
            mocks.invoiceFindFirst.mockResolvedValue({
                id: INV_ID,
                workspaceId: WS_A,
                status: "PAID",
                payments: [{ id: "pay_02", status: "RECORDED" }],
            });

            await expect(
                voidInvoice(WS_A, INV_ID, "Mistake", adminActor),
            ).rejects.toThrow(InvoiceStatusConflictError);

            // Verify in-memory history log has exactly 7 entries from the 7 executed mutations
            expect(inMemoryHistoryLog).toHaveLength(7);

            // 9. Step 9: Query via getInvoiceHistory and assert chronological playback
            mocks.invoiceFindFirst.mockResolvedValue({ id: INV_ID, workspaceId: WS_A });
            mocks.invoiceHistoryCount.mockResolvedValue(inMemoryHistoryLog.length);
            mocks.invoiceHistoryFindMany.mockResolvedValue(inMemoryHistoryLog);

            const historyResult = await getInvoiceHistory(WS_A, INV_ID, adminActor);

            expect(historyResult.total).toBe(7);
            expect(historyResult.items).toHaveLength(7);

            // Assert exact sequence of event types
            expect(historyResult.items.map((i) => i.eventType)).toEqual([
                "CREATED",
                "LINE_ITEM_ADDED",
                "ISSUED",
                "PAYMENT_APPLIED",
                "PAYMENT_VOIDED",
                "OVERDUE_MARKED",
                "PAYMENT_APPLIED",
            ]);

            // Assert field diffs and attribution
            expect(historyResult.items[0].eventType).toBe("CREATED");
            expect(historyResult.items[0].newValue).toBe("DRAFT");
            expect(historyResult.items[0].actorName).toBe("Alice Admin");

            expect(historyResult.items[1].eventType).toBe("LINE_ITEM_ADDED");
            expect(historyResult.items[1].newValue).toBe("li_01");
            expect(historyResult.items[1].metadata?.name).toBe("Diagnostic Service");

            expect(historyResult.items[2].eventType).toBe("ISSUED");
            expect(historyResult.items[2].oldValue).toBe("DRAFT");
            expect(historyResult.items[2].newValue).toBe("ISSUED");

            expect(historyResult.items[3].eventType).toBe("PAYMENT_APPLIED");
            expect(historyResult.items[3].oldValue).toBe("0.00");
            expect(historyResult.items[3].newValue).toBe("50.00");
            expect(historyResult.items[3].metadata?.paymentNumber).toBe("PAY-2026-000001");

            expect(historyResult.items[4].eventType).toBe("PAYMENT_VOIDED");
            expect(historyResult.items[4].oldValue).toBe("50.00");
            expect(historyResult.items[4].newValue).toBe("0.00");
            expect(historyResult.items[4].metadata?.voidReason).toBe("Check NSF");

            expect(historyResult.items[5].eventType).toBe("OVERDUE_MARKED");
            expect(historyResult.items[5].oldValue).toBe("ISSUED");
            expect(historyResult.items[5].newValue).toBe("OVERDUE");
            expect(historyResult.items[5].actorName).toBe("System");

            expect(historyResult.items[6].eventType).toBe("PAYMENT_APPLIED");
            expect(historyResult.items[6].oldValue).toBe("0.00");
            expect(historyResult.items[6].newValue).toBe("200.00");
            expect(historyResult.items[6].metadata?.status).toBe("PAID");
        });
    });

    // ------------------------------------------------------------------------
    // 2. Query Filters & Tenant Isolation
    // ------------------------------------------------------------------------
    describe("2. getInvoiceHistory Query Filters & Isolation", () => {
        it("filters history by specific eventType", async () => {
            mocks.invoiceFindFirst.mockResolvedValue({ id: INV_ID, workspaceId: WS_A });
            mocks.invoiceHistoryCount.mockResolvedValue(1);
            mocks.invoiceHistoryFindMany.mockResolvedValue([
                {
                    id: "hist_04",
                    invoiceId: INV_ID,
                    workspaceId: WS_A,
                    eventType: "PAYMENT_APPLIED",
                    actorMemberId: "mem_admin_01",
                    actorName: "Alice Admin",
                    field: "amountPaid",
                    oldValue: "0.00",
                    newValue: "50.00",
                    metadata: { paymentId: "pay_01" },
                    createdAt: new Date(),
                },
            ]);

            const result = await getInvoiceHistory(WS_A, INV_ID, adminActor, {
                eventType: "PAYMENT_APPLIED",
            });

            expect(result.total).toBe(1);
            expect(mocks.invoiceHistoryFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        workspaceId: WS_A,
                        invoiceId: INV_ID,
                        eventType: "PAYMENT_APPLIED",
                    }),
                }),
            );
        });

        it("throws InvoiceNotFoundError if invoice does not exist in target workspace (tenant isolation)", async () => {
            mocks.invoiceFindFirst.mockResolvedValue(null);

            await expect(
                getInvoiceHistory(WS_B, INV_ID, {
                    ...adminActor,
                    workspace: { ...adminActor.workspace, id: WS_B },
                }),
            ).rejects.toThrow(InvoiceNotFoundError);

            expect(mocks.invoiceHistoryFindMany).not.toHaveBeenCalled();
        });
    });

    // ------------------------------------------------------------------------
    // 3. listInvoiceHistoryEvents
    // ------------------------------------------------------------------------
    describe("3. listInvoiceHistoryEvents", () => {
        it("returns workspace-wide paginated operational history events in descending order", async () => {
            mocks.invoiceHistoryCount.mockResolvedValue(2);
            mocks.invoiceHistoryFindMany.mockResolvedValue([
                {
                    id: "hist_02",
                    invoiceId: "inv_02",
                    workspaceId: WS_A,
                    eventType: "ISSUED",
                    actorMemberId: "mem_admin_01",
                    actorName: "Alice Admin",
                    field: "status",
                    oldValue: "DRAFT",
                    newValue: "ISSUED",
                    metadata: null,
                    createdAt: new Date("2026-08-20T10:00:00Z"),
                },
                {
                    id: "hist_01",
                    invoiceId: "inv_01",
                    workspaceId: WS_A,
                    eventType: "CREATED",
                    actorMemberId: "mem_admin_01",
                    actorName: "Alice Admin",
                    field: "status",
                    oldValue: null,
                    newValue: "DRAFT",
                    metadata: null,
                    createdAt: new Date("2026-08-19T10:00:00Z"),
                },
            ]);

            const result = await listInvoiceHistoryEvents(WS_A, { page: 1, limit: 10 }, adminActor);

            expect(result.total).toBe(2);
            expect(result.items).toHaveLength(2);
            expect(result.page).toBe(1);
            expect(result.limit).toBe(10);
            expect(result.totalPages).toBe(1);
            expect(mocks.invoiceHistoryFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: { workspaceId: WS_A },
                    skip: 0,
                    take: 10,
                    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
                }),
            );
        });

        it("filters by actorMemberId, invoiceId, and date range", async () => {
            mocks.invoiceHistoryCount.mockResolvedValue(1);
            mocks.invoiceHistoryFindMany.mockResolvedValue([]);

            await listInvoiceHistoryEvents(
                WS_A,
                {
                    invoiceId: INV_ID,
                    actorMemberId: "mem_admin_01",
                    fromDate: "2026-08-01T00:00:00.000Z",
                    toDate: "2026-08-31T23:59:59.999Z",
                },
                adminActor,
            );

            expect(mocks.invoiceHistoryFindMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: expect.objectContaining({
                        workspaceId: WS_A,
                        invoiceId: INV_ID,
                        actorMemberId: "mem_admin_01",
                        createdAt: {
                            gte: new Date("2026-08-01T00:00:00.000Z"),
                            lte: new Date("2026-08-31T23:59:59.999Z"),
                        },
                    }),
                }),
            );
        });

        it("rejects invalid/unknown eventType filter (Zod validation error)", async () => {
            await expect(
                listInvoiceHistoryEvents(WS_A, { eventType: "NON_EXISTENT_EVENT" }, adminActor),
            ).rejects.toThrow();

            expect(mocks.invoiceHistoryFindMany).not.toHaveBeenCalled();
        });
    });

    // ------------------------------------------------------------------------
    // 4. Actor Attribution & Formatting
    // ------------------------------------------------------------------------
    describe("4. Actor Attribution & Formatting", () => {
        it("correctly attributes human actor name", async () => {
            mocks.invoiceFindFirst.mockResolvedValue({ id: INV_ID, workspaceId: WS_A });
            mocks.invoiceHistoryCount.mockResolvedValue(1);
            mocks.invoiceHistoryFindMany.mockResolvedValue([
                {
                    id: "hist_h1",
                    invoiceId: INV_ID,
                    workspaceId: WS_A,
                    eventType: "ISSUED",
                    actorMemberId: "mem_admin_01",
                    actorName: "Alice Admin",
                    field: "status",
                    oldValue: "DRAFT",
                    newValue: "ISSUED",
                    metadata: {},
                    createdAt: new Date(),
                },
            ]);

            const result = await getInvoiceHistory(WS_A, INV_ID, adminActor);
            expect(result.items[0].actorName).toBe("Alice Admin");
            expect(result.items[0].actorMemberId).toBe("mem_admin_01");
        });

        it("attributes 'System' when metadata.system is true (e.g. evaluateInvoiceOverdue)", async () => {
            mocks.invoiceFindFirst.mockResolvedValue({ id: INV_ID, workspaceId: WS_A });
            mocks.invoiceHistoryCount.mockResolvedValue(1);
            mocks.invoiceHistoryFindMany.mockResolvedValue([
                {
                    id: "hist_sys1",
                    invoiceId: INV_ID,
                    workspaceId: WS_A,
                    eventType: "OVERDUE_MARKED",
                    actorMemberId: null,
                    actorName: null,
                    field: "status",
                    oldValue: "ISSUED",
                    newValue: "OVERDUE",
                    metadata: { system: true },
                    createdAt: new Date(),
                },
            ]);

            const result = await getInvoiceHistory(WS_A, INV_ID, adminActor);
            expect(result.items[0].actorName).toBe("System");
            expect(result.items[0].actorMemberId).toBeNull();
        });

        it("attributes 'Deleted User' when actorMemberId is present but actorName is null", async () => {
            mocks.invoiceFindFirst.mockResolvedValue({ id: INV_ID, workspaceId: WS_A });
            mocks.invoiceHistoryCount.mockResolvedValue(1);
            mocks.invoiceHistoryFindMany.mockResolvedValue([
                {
                    id: "hist_del1",
                    invoiceId: INV_ID,
                    workspaceId: WS_A,
                    eventType: "UPDATED",
                    actorMemberId: "mem_deleted_99",
                    actorName: null,
                    field: "title",
                    oldValue: "Old",
                    newValue: "New",
                    metadata: {},
                    createdAt: new Date(),
                },
            ]);

            const result = await getInvoiceHistory(WS_A, INV_ID, adminActor);
            expect(result.items[0].actorName).toBe("Deleted User");
            expect(result.items[0].actorMemberId).toBe("mem_deleted_99");
        });
    });

    // ------------------------------------------------------------------------
    // 5. RBAC Positive & Rejections
    // ------------------------------------------------------------------------
    describe("5. RBAC Permissions", () => {
        it("allows ACCOUNTANT and DISPATCHER roles with invoices.view permission", async () => {
            mocks.invoiceFindFirst.mockResolvedValue({ id: INV_ID, workspaceId: WS_A });
            mocks.invoiceHistoryCount.mockResolvedValue(0);
            mocks.invoiceHistoryFindMany.mockResolvedValue([]);

            const dispatcherActor: WorkspaceAuthorizationContext = {
                membership: { id: "mem_disp_01", role: "DISPATCHER", status: "ACTIVE" },
                user: { id: "usr_disp_01", name: "Dan Dispatcher", email: "dan@alpha.com", status: "ACTIVE", emailVerified: new Date() },
                workspace: { id: WS_A, name: "Alpha HVAC", slug: "alpha-hvac", logoUrl: null, timezone: "UTC" },
            };

            const result = await getInvoiceHistory(WS_A, INV_ID, dispatcherActor);
            expect(result.items).toEqual([]);

            const listResult = await listInvoiceHistoryEvents(WS_A, {}, dispatcherActor);
            expect(listResult.items).toEqual([]);
        });

        it("rejects TECHNICIAN role lacking invoices.view permission (ForbiddenError)", async () => {
            await expect(
                getInvoiceHistory(WS_A, INV_ID, techActor),
            ).rejects.toThrow(ForbiddenError);

            await expect(
                listInvoiceHistoryEvents(WS_A, {}, techActor),
            ).rejects.toThrow(ForbiddenError);
        });
    });
});
