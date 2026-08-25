import { describe, expect, it, vi, beforeEach } from "vitest";
import { z, ZodError } from "zod";

const mocks = vi.hoisted(() => ({
    listInvoices: vi.fn(),
    createInvoice: vi.fn(),
    getInvoice: vi.fn(),
    updateInvoice: vi.fn(),
    deleteInvoice: vi.fn(),
    addInvoiceLineItem: vi.fn(),
    updateInvoiceLineItem: vi.fn(),
    removeInvoiceLineItem: vi.fn(),
    reorderInvoiceLineItems: vi.fn(),
    issueInvoice: vi.fn(),
    voidInvoice: vi.fn(),
    getInvoicePayments: vi.fn(),
    recordPayment: vi.fn(),
    listPayments: vi.fn(),
    voidPayment: vi.fn(),
    getInvoiceHistory: vi.fn(),
    listInvoiceHistoryEvents: vi.fn(),
    createInvoiceFromQuote: vi.fn(),
    createInvoiceFromWorkOrder: vi.fn(),
    evaluateInvoiceOverdue: vi.fn(),
    getCustomerOutstandingBalance: vi.fn(),
}));

vi.mock("@/lib/services/invoice", () => ({
    listInvoices: mocks.listInvoices,
    createInvoice: mocks.createInvoice,
    getInvoice: mocks.getInvoice,
    updateInvoice: mocks.updateInvoice,
    deleteInvoice: mocks.deleteInvoice,
    addInvoiceLineItem: mocks.addInvoiceLineItem,
    updateInvoiceLineItem: mocks.updateInvoiceLineItem,
    removeInvoiceLineItem: mocks.removeInvoiceLineItem,
    reorderInvoiceLineItems: mocks.reorderInvoiceLineItems,
    issueInvoice: mocks.issueInvoice,
    voidInvoice: mocks.voidInvoice,
    getInvoicePayments: mocks.getInvoicePayments,
    recordPayment: mocks.recordPayment,
    listPayments: mocks.listPayments,
    voidPayment: mocks.voidPayment,
    getInvoiceHistory: mocks.getInvoiceHistory,
    listInvoiceHistoryEvents: mocks.listInvoiceHistoryEvents,
    createInvoiceFromQuote: mocks.createInvoiceFromQuote,
    createInvoiceFromWorkOrder: mocks.createInvoiceFromWorkOrder,
    evaluateInvoiceOverdue: mocks.evaluateInvoiceOverdue,
    getCustomerOutstandingBalance: mocks.getCustomerOutstandingBalance,
}));

import {
    GET as listInvoicesRoute,
    POST as createInvoiceRoute,
} from "@/app/api/workspaces/[workspaceId]/invoices/route";
import {
    GET as getInvoiceRoute,
    PATCH as updateInvoiceRoute,
    DELETE as deleteInvoiceRoute,
} from "@/app/api/workspaces/[workspaceId]/invoices/[invoiceId]/route";
import { POST as addInvoiceLineItemRoute } from "@/app/api/workspaces/[workspaceId]/invoices/[invoiceId]/line-items/route";
import {
    PATCH as updateInvoiceLineItemRoute,
    DELETE as removeInvoiceLineItemRoute,
} from "@/app/api/workspaces/[workspaceId]/invoices/[invoiceId]/line-items/[lineItemId]/route";
import { PUT as reorderInvoiceLineItemsRoute } from "@/app/api/workspaces/[workspaceId]/invoices/[invoiceId]/line-items/reorder/route";
import { POST as issueInvoiceRoute } from "@/app/api/workspaces/[workspaceId]/invoices/[invoiceId]/issue/route";
import { POST as voidInvoiceRoute } from "@/app/api/workspaces/[workspaceId]/invoices/[invoiceId]/void/route";
import {
    GET as getInvoicePaymentsRoute,
    POST as recordPaymentRoute,
} from "@/app/api/workspaces/[workspaceId]/invoices/[invoiceId]/payments/route";
import { GET as listPaymentsRoute } from "@/app/api/workspaces/[workspaceId]/payments/route";
import { POST as voidPaymentRoute } from "@/app/api/workspaces/[workspaceId]/payments/[paymentId]/void/route";
import { GET as getInvoiceHistoryRoute } from "@/app/api/workspaces/[workspaceId]/invoices/[invoiceId]/history/route";
import { GET as listInvoiceHistoryEventsRoute } from "@/app/api/workspaces/[workspaceId]/invoices/history/route";
import { POST as createInvoiceFromQuoteRoute } from "@/app/api/workspaces/[workspaceId]/invoices/from-quote/[quoteId]/route";
import { POST as createInvoiceFromWorkOrderRoute } from "@/app/api/workspaces/[workspaceId]/invoices/from-work-order/[workOrderId]/route";
import { POST as evaluateInvoiceOverdueRoute } from "@/app/api/workspaces/[workspaceId]/invoices/overdue/route";
import { GET as getCustomerBalanceRoute } from "@/app/api/workspaces/[workspaceId]/customers/[customerId]/balance/route";

import {
    InvoiceNotFoundError,
    InvoiceLineItemNotFoundError,
    PaymentNotFoundError,
    InvoiceStatusConflictError,
    InvoiceAlreadyPaidError,
    InvoiceAlreadyVoidedError,
    PaymentAlreadyVoidedError,
    InvoiceHasActivePaymentsError,
    InvoiceTotalsMismatchError,
    OverpaymentNotAllowedError,
    InvalidPaymentAmountError,
    InvoiceEmptyLineItemsError,
    InvalidInvoiceCalculationError,
    SourceEntityNotEligibleError,
    MissingVoidReasonError,
    InvoiceDueDateInvalidError,
} from "@/lib/services/invoice/invoiceErrors";
import {
    CustomerNotFoundError,
    ServiceLocationNotFoundError,
} from "@/lib/services/customer/customerErrors";
import { QuoteNotFoundError } from "@/lib/services/quote/quoteErrors";
import { WorkOrderNotFoundError } from "@/lib/services/workOrder/workOrderErrors";
import {
    UnauthorizedError,
    ForbiddenError,
} from "@/lib/services/authorization/authorizationErrors";

describe("Phase 1.12.13 — REST API Route Handlers & Utilities", () => {
    const WS_ID = "ws_test_alpha";
    const INV_ID = "inv_test_01";
    const LINE_ID = "line_test_01";
    const PAY_ID = "pay_test_01";
    const QUOTE_ID = "quote_test_01";
    const WO_ID = "wo_test_01";
    const CUST_ID = "cust_test_01";

    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ========================================================================
    // 1. Happy Path Endpoints (All 16+ Route Handlers)
    // ========================================================================
    describe("1. Happy Path Endpoints", () => {
        it("GET /invoices — succeeds with 200 and paginated list", async () => {
            const mockData = { items: [{ id: INV_ID, invoiceNumber: "INV-2026-000001" }], total: 1, page: 1, limit: 20, totalPages: 1 };
            mocks.listInvoices.mockResolvedValueOnce(mockData);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices?status=DRAFT`);
            const res = await listInvoicesRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toEqual(mockData);
            expect(mocks.listInvoices).toHaveBeenCalledWith(WS_ID, expect.objectContaining({ status: "DRAFT" }));
        });

        it("POST /invoices — succeeds with 201 and created draft invoice", async () => {
            const mockInvoice = { id: INV_ID, invoiceNumber: "INV-2026-000001", status: "DRAFT" };
            mocks.createInvoice.mockResolvedValueOnce(mockInvoice);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ customerId: CUST_ID, title: "AC Maintenance" }),
            });
            const res = await createInvoiceRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(201);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toEqual(mockInvoice);
            expect(mocks.createInvoice).toHaveBeenCalledWith(WS_ID, { customerId: CUST_ID, title: "AC Maintenance" });
        });

        it("GET /invoices/[invoiceId] — succeeds with 200 and single invoice", async () => {
            const mockInvoice = { id: INV_ID, invoiceNumber: "INV-2026-000001", total: "250.00" };
            mocks.getInvoice.mockResolvedValueOnce(mockInvoice);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices/${INV_ID}`);
            const res = await getInvoiceRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, invoiceId: INV_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toEqual(mockInvoice);
            expect(mocks.getInvoice).toHaveBeenCalledWith(WS_ID, INV_ID);
        });

        it("PATCH /invoices/[invoiceId] — succeeds with 200 and updated invoice", async () => {
            const mockInvoice = { id: INV_ID, title: "Updated Title" };
            mocks.updateInvoice.mockResolvedValueOnce(mockInvoice);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices/${INV_ID}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: "Updated Title" }),
            });
            const res = await updateInvoiceRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, invoiceId: INV_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toEqual(mockInvoice);
            expect(mocks.updateInvoice).toHaveBeenCalledWith(WS_ID, INV_ID, { title: "Updated Title" });
        });

        it("DELETE /invoices/[invoiceId] — succeeds with 200 and deleted true", async () => {
            mocks.deleteInvoice.mockResolvedValueOnce(undefined);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices/${INV_ID}`, { method: "DELETE" });
            const res = await deleteInvoiceRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, invoiceId: INV_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toEqual({ deleted: true });
            expect(mocks.deleteInvoice).toHaveBeenCalledWith(WS_ID, INV_ID);
        });

        it("POST /invoices/[invoiceId]/line-items — succeeds with 201 and updated invoice", async () => {
            const mockInvoice = { id: INV_ID, lineItems: [{ id: LINE_ID, name: "Labor" }] };
            mocks.addInvoiceLineItem.mockResolvedValueOnce(mockInvoice);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices/${INV_ID}/line-items`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ lineItemType: "LABOR", name: "Labor", quantity: 1, unitPrice: 100 }),
            });
            const res = await addInvoiceLineItemRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, invoiceId: INV_ID }) });

            expect(res.status).toBe(201);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toEqual(mockInvoice);
            expect(mocks.addInvoiceLineItem).toHaveBeenCalledWith(WS_ID, INV_ID, { lineItemType: "LABOR", name: "Labor", quantity: 1, unitPrice: 100 });
        });

        it("PATCH /invoices/[invoiceId]/line-items/[lineItemId] — succeeds with 200", async () => {
            const mockInvoice = { id: INV_ID, lineItems: [{ id: LINE_ID, quantity: 2 }] };
            mocks.updateInvoiceLineItem.mockResolvedValueOnce(mockInvoice);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices/${INV_ID}/line-items/${LINE_ID}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ quantity: 2 }),
            });
            const res = await updateInvoiceLineItemRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, invoiceId: INV_ID, lineItemId: LINE_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toEqual(mockInvoice);
            expect(mocks.updateInvoiceLineItem).toHaveBeenCalledWith(WS_ID, INV_ID, LINE_ID, { quantity: 2 });
        });

        it("DELETE /invoices/[invoiceId]/line-items/[lineItemId] — succeeds with 200", async () => {
            const mockInvoice = { id: INV_ID, lineItems: [] };
            mocks.removeInvoiceLineItem.mockResolvedValueOnce(mockInvoice);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices/${INV_ID}/line-items/${LINE_ID}`, { method: "DELETE" });
            const res = await removeInvoiceLineItemRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, invoiceId: INV_ID, lineItemId: LINE_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toEqual(mockInvoice);
            expect(mocks.removeInvoiceLineItem).toHaveBeenCalledWith(WS_ID, INV_ID, LINE_ID);
        });

        it("PUT /invoices/[invoiceId]/line-items/reorder — succeeds with 200", async () => {
            const mockInvoice = { id: INV_ID, lineItems: [{ id: LINE_ID, sortOrder: 0 }] };
            mocks.reorderInvoiceLineItems.mockResolvedValueOnce(mockInvoice);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices/${INV_ID}/line-items/reorder`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ itemIds: [LINE_ID] }),
            });
            const res = await reorderInvoiceLineItemsRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, invoiceId: INV_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toEqual(mockInvoice);
            expect(mocks.reorderInvoiceLineItems).toHaveBeenCalledWith(WS_ID, INV_ID, { itemIds: [LINE_ID] });
        });

        it("POST /invoices/[invoiceId]/issue — succeeds with 200 and ISSUED invoice", async () => {
            const mockInvoice = { id: INV_ID, status: "ISSUED" };
            mocks.issueInvoice.mockResolvedValueOnce(mockInvoice);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices/${INV_ID}/issue`, { method: "POST" });
            const res = await issueInvoiceRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, invoiceId: INV_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toEqual(mockInvoice);
            expect(mocks.issueInvoice).toHaveBeenCalledWith(WS_ID, INV_ID);
        });

        it("POST /invoices/[invoiceId]/void — succeeds with 200 and VOID invoice", async () => {
            const mockInvoice = { id: INV_ID, status: "VOID", voidReason: "Disputed" };
            mocks.voidInvoice.mockResolvedValueOnce(mockInvoice);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices/${INV_ID}/void`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reason: "Disputed" }),
            });
            const res = await voidInvoiceRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, invoiceId: INV_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toEqual(mockInvoice);
            expect(mocks.voidInvoice).toHaveBeenCalledWith(WS_ID, INV_ID, "Disputed");
        });

        it("GET /invoices/[invoiceId]/payments — succeeds with 200 and payment list", async () => {
            const mockPayments = [{ id: PAY_ID, paymentNumber: "PAY-2026-000001", amount: "100.00" }];
            mocks.getInvoicePayments.mockResolvedValueOnce(mockPayments);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices/${INV_ID}/payments`);
            const res = await getInvoicePaymentsRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, invoiceId: INV_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toEqual(mockPayments);
            expect(mocks.getInvoicePayments).toHaveBeenCalledWith(WS_ID, INV_ID);
        });

        it("POST /invoices/[invoiceId]/payments — succeeds with 201 and recorded payment", async () => {
            const mockPayment = { id: PAY_ID, paymentNumber: "PAY-2026-000001", amount: "100.00", status: "RECORDED" };
            mocks.recordPayment.mockResolvedValueOnce(mockPayment);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices/${INV_ID}/payments`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ amount: 100, paymentMethod: "CHECK" }),
            });
            const res = await recordPaymentRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, invoiceId: INV_ID }) });

            expect(res.status).toBe(201);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toEqual(mockPayment);
            expect(mocks.recordPayment).toHaveBeenCalledWith(WS_ID, INV_ID, { amount: 100, paymentMethod: "CHECK" });
        });

        it("GET /payments — succeeds with 200 and workspace payments list", async () => {
            const mockPayments = { items: [{ id: PAY_ID, paymentNumber: "PAY-2026-000001" }], total: 1, page: 1, limit: 20, totalPages: 1 };
            mocks.listPayments.mockResolvedValueOnce(mockPayments);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/payments?paymentMethod=CHECK`);
            const res = await listPaymentsRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toEqual(mockPayments);
            expect(mocks.listPayments).toHaveBeenCalledWith(WS_ID, expect.objectContaining({ paymentMethod: "CHECK" }));
        });

        it("POST /payments/[paymentId]/void — succeeds with 200 and VOIDED payment", async () => {
            const mockPayment = { id: PAY_ID, status: "VOIDED", voidReason: "Bounced" };
            mocks.voidPayment.mockResolvedValueOnce(mockPayment);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/payments/${PAY_ID}/void`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reason: "Bounced" }),
            });
            const res = await voidPaymentRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, paymentId: PAY_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toEqual(mockPayment);
            expect(mocks.voidPayment).toHaveBeenCalledWith(WS_ID, PAY_ID, "Bounced");
        });

        it("GET /invoices/[invoiceId]/history — succeeds with 200 and invoice history", async () => {
            const mockHistory = { items: [{ id: "hist_01", eventType: "CREATED" }], total: 1, page: 1, limit: 50, totalPages: 1 };
            mocks.getInvoiceHistory.mockResolvedValueOnce(mockHistory);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices/${INV_ID}/history?sortOrder=asc`);
            const res = await getInvoiceHistoryRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, invoiceId: INV_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toEqual(mockHistory);
            expect(mocks.getInvoiceHistory).toHaveBeenCalledWith(WS_ID, INV_ID, undefined, expect.objectContaining({ sortOrder: "asc" }));
        });

        it("GET /invoices/history — succeeds with 200 and workspace history events", async () => {
            const mockHistory = { items: [{ id: "hist_02", eventType: "ISSUED" }], total: 1, page: 1, limit: 50, totalPages: 1 };
            mocks.listInvoiceHistoryEvents.mockResolvedValueOnce(mockHistory);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices/history?eventType=ISSUED`);
            const res = await listInvoiceHistoryEventsRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toEqual(mockHistory);
            expect(mocks.listInvoiceHistoryEvents).toHaveBeenCalledWith(WS_ID, expect.objectContaining({ eventType: "ISSUED" }));
        });

        it("POST /invoices/from-quote/[quoteId] — succeeds with 201 and converted invoice", async () => {
            const mockInvoice = { id: INV_ID, quoteId: QUOTE_ID, status: "DRAFT" };
            mocks.createInvoiceFromQuote.mockResolvedValueOnce(mockInvoice);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices/from-quote/${QUOTE_ID}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: "Quote Conversion" }),
            });
            const res = await createInvoiceFromQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(201);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toEqual(mockInvoice);
            expect(mocks.createInvoiceFromQuote).toHaveBeenCalledWith(WS_ID, QUOTE_ID, { title: "Quote Conversion" });
        });

        it("POST /invoices/from-work-order/[workOrderId] — succeeds with 201 and converted invoice", async () => {
            const mockInvoice = { id: INV_ID, workOrderId: WO_ID, status: "DRAFT" };
            mocks.createInvoiceFromWorkOrder.mockResolvedValueOnce(mockInvoice);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices/from-work-order/${WO_ID}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title: "Work Order Conversion" }),
            });
            const res = await createInvoiceFromWorkOrderRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, workOrderId: WO_ID }) });

            expect(res.status).toBe(201);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toEqual(mockInvoice);
            expect(mocks.createInvoiceFromWorkOrder).toHaveBeenCalledWith(WS_ID, WO_ID, { title: "Work Order Conversion" });
        });

        it("POST /invoices/overdue — succeeds with 200 and evaluation result", async () => {
            const mockResult = { processedCount: 5, transitionedCount: 2, workspacesProcessed: 1, errors: [] };
            mocks.evaluateInvoiceOverdue.mockResolvedValueOnce(mockResult);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices/overdue`, { method: "POST" });
            const res = await evaluateInvoiceOverdueRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toEqual(mockResult);
            expect(mocks.evaluateInvoiceOverdue).toHaveBeenCalledWith(WS_ID);
        });

        it("GET /customers/[customerId]/balance — succeeds with 200 and balance object", async () => {
            const mockBalance = { customerId: CUST_ID, currencyCode: "USD", outstandingBalance: "450.00", unpaidInvoiceCount: 2 };
            mocks.getCustomerOutstandingBalance.mockResolvedValueOnce(mockBalance);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/customers/${CUST_ID}/balance`);
            const res = await getCustomerBalanceRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, customerId: CUST_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data).toEqual(mockBalance);
            expect(mocks.getCustomerOutstandingBalance).toHaveBeenCalledWith(WS_ID, CUST_ID);
        });
    });

    // ========================================================================
    // 2. Status Code & Error Mapping Tests (400, 401, 403, 404, 409, 422, 500)
    // ========================================================================
    describe("2. Error Code Status Mappings", () => {
        it("returns 400 when workspace ID is missing", async () => {
            const req = new Request(`http://localhost/api/invoices`);
            const res = await listInvoicesRoute(req, { params: Promise.resolve({ workspaceId: "" }) });

            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("MISSING_WORKSPACE");
        });

        it("returns 400 on malformed JSON body", async () => {
            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "INVALID_JSON_STRING{{{",
            });
            const res = await createInvoiceRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("MALFORMED_JSON");
        });

        it("returns 401 when request is unauthenticated (UnauthorizedError)", async () => {
            mocks.listInvoices.mockRejectedValueOnce(new UnauthorizedError("Authentication required."));

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices`);
            const res = await listInvoicesRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("UNAUTHORIZED");
        });

        it("returns 403 when user lacks permissions (ForbiddenError)", async () => {
            mocks.createInvoice.mockRejectedValueOnce(new ForbiddenError("Permission denied."));

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ customerId: CUST_ID }),
            });
            const res = await createInvoiceRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("FORBIDDEN");
        });

        it("returns 404 for InvoiceNotFoundError", async () => {
            mocks.getInvoice.mockRejectedValueOnce(new InvoiceNotFoundError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices/${INV_ID}`);
            const res = await getInvoiceRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, invoiceId: INV_ID }) });

            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("INVOICE_NOT_FOUND");
        });

        it("returns 404 for PaymentNotFoundError", async () => {
            mocks.voidPayment.mockRejectedValueOnce(new PaymentNotFoundError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/payments/${PAY_ID}/void`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reason: "Void" }),
            });
            const res = await voidPaymentRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, paymentId: PAY_ID }) });

            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("PAYMENT_NOT_FOUND");
        });

        it("returns 409 for InvoiceStatusConflictError", async () => {
            mocks.deleteInvoice.mockRejectedValueOnce(new InvoiceStatusConflictError("Cannot delete non-DRAFT invoice."));

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices/${INV_ID}`, { method: "DELETE" });
            const res = await deleteInvoiceRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, invoiceId: INV_ID }) });

            expect(res.status).toBe(409);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("INVOICE_STATUS_CONFLICT");
        });

        it("returns 409 for InvoiceAlreadyPaidError", async () => {
            mocks.recordPayment.mockRejectedValueOnce(new InvoiceAlreadyPaidError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices/${INV_ID}/payments`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ amount: 50, paymentMethod: "CHECK" }),
            });
            const res = await recordPaymentRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, invoiceId: INV_ID }) });

            expect(res.status).toBe(409);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("INVOICE_ALREADY_PAID");
        });

        it("returns 409 for InvoiceAlreadyVoidedError", async () => {
            mocks.issueInvoice.mockRejectedValueOnce(new InvoiceAlreadyVoidedError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices/${INV_ID}/issue`, { method: "POST" });
            const res = await issueInvoiceRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, invoiceId: INV_ID }) });

            expect(res.status).toBe(409);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("INVOICE_ALREADY_VOIDED");
        });

        it("returns 409 for PaymentAlreadyVoidedError", async () => {
            mocks.voidPayment.mockRejectedValueOnce(new PaymentAlreadyVoidedError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/payments/${PAY_ID}/void`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ reason: "Re-void" }),
            });
            const res = await voidPaymentRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, paymentId: PAY_ID }) });

            expect(res.status).toBe(409);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("PAYMENT_ALREADY_VOIDED");
        });

        it("returns 409 for InvoiceTotalsMismatchError", async () => {
            mocks.issueInvoice.mockRejectedValueOnce(new InvoiceTotalsMismatchError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices/${INV_ID}/issue`, { method: "POST" });
            const res = await issueInvoiceRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, invoiceId: INV_ID }) });

            expect(res.status).toBe(409);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("INVOICE_TOTALS_MISMATCH");
        });

        it("returns 422 for OverpaymentNotAllowedError", async () => {
            mocks.recordPayment.mockRejectedValueOnce(new OverpaymentNotAllowedError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices/${INV_ID}/payments`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ amount: 9999, paymentMethod: "CHECK" }),
            });
            const res = await recordPaymentRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, invoiceId: INV_ID }) });

            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("OVERPAYMENT_NOT_ALLOWED");
        });

        it("returns 422 for SourceEntityNotEligibleError", async () => {
            mocks.createInvoiceFromQuote.mockRejectedValueOnce(new SourceEntityNotEligibleError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices/from-quote/${QUOTE_ID}`, { method: "POST" });
            const res = await createInvoiceFromQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("SOURCE_ENTITY_NOT_ELIGIBLE");
        });

        it("returns 422 for Zod schema validation errors", async () => {
            const parsed = z.object({ customerId: z.string() }).safeParse({});
            mocks.createInvoice.mockRejectedValueOnce(parsed.error);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({}),
            });
            const res = await createInvoiceRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("VALIDATION_ERROR");
            expect(json.error.fields).toHaveProperty("customerId");
        });

        it("returns 500 with sanitized error for unexpected runtime errors (no SQL or stack leaks)", async () => {
            const spy = vi.spyOn(console, "error").mockImplementation(() => {});
            mocks.getInvoice.mockRejectedValueOnce(new Error("FATAL: relation \"prisma_invoice\" does not exist at postgres.internal:5432"));

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/invoices/${INV_ID}`);
            const res = await getInvoiceRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, invoiceId: INV_ID }) });

            expect(res.status).toBe(500);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("INTERNAL_SERVER_ERROR");
            expect(json.error.message).toBe("An unexpected error occurred. Please try again later.");
            expect(JSON.stringify(json)).not.toContain("FATAL");
            expect(JSON.stringify(json)).not.toContain("postgres");
            spy.mockRestore();
        });
    });

    // ========================================================================
    // 3. Tenant Isolation at Route Level
    // ========================================================================
    describe("3. Tenant Isolation at Route Level", () => {
        it("resolves workspaceId from x-workspace-id header when path param is absent", async () => {
            mocks.listInvoices.mockResolvedValueOnce({ items: [], total: 0, page: 1, limit: 20, totalPages: 0 });

            const req = new Request("http://localhost/api/invoices", {
                headers: { "x-workspace-id": "ws_header_01" },
            });
            const res = await listInvoicesRoute(req, { params: Promise.resolve({ workspaceId: "" }) });

            expect(res.status).toBe(200);
            expect(mocks.listInvoices).toHaveBeenCalledWith("ws_header_01", expect.any(Object));
        });

        it("cross-tenant read request returns 404 with identical shape to non-existent resource", async () => {
            mocks.getInvoice.mockRejectedValueOnce(new InvoiceNotFoundError("Invoice not found."));

            const req = new Request(`http://localhost/api/workspaces/ws_tenant_other/invoices/${INV_ID}`);
            const res = await getInvoiceRoute(req, { params: Promise.resolve({ workspaceId: "ws_tenant_other", invoiceId: INV_ID }) });

            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json).toEqual({
                success: false,
                error: {
                    code: "INVOICE_NOT_FOUND",
                    message: "Invoice not found.",
                },
            });
        });

        it("cross-tenant payment mutation returns 404 with identical shape, leaking zero cross-tenant state", async () => {
            mocks.recordPayment.mockRejectedValueOnce(new InvoiceNotFoundError("Invoice not found."));

            const req = new Request(`http://localhost/api/workspaces/ws_tenant_other/invoices/${INV_ID}/payments`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ amount: 50, paymentMethod: "CHECK" }),
            });
            const res = await recordPaymentRoute(req, { params: Promise.resolve({ workspaceId: "ws_tenant_other", invoiceId: INV_ID }) });

            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json).toEqual({
                success: false,
                error: {
                    code: "INVOICE_NOT_FOUND",
                    message: "Invoice not found.",
                },
            });
        });
    });
});
