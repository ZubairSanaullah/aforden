import { describe, expect, it, vi, beforeEach } from "vitest";
import { ZodError } from "zod";

const mocks = vi.hoisted(() => ({
    listQuotes: vi.fn(),
    createQuote: vi.fn(),
    getQuote: vi.fn(),
    updateQuote: vi.fn(),
    deleteQuote: vi.fn(),
    addQuoteLineItem: vi.fn(),
    updateQuoteLineItem: vi.fn(),
    removeQuoteLineItem: vi.fn(),
    reorderQuoteLineItems: vi.fn(),
    sendQuote: vi.fn(),
    approveQuote: vi.fn(),
    rejectQuote: vi.fn(),
    reviseQuote: vi.fn(),
    convertQuoteToWorkOrder: vi.fn(),
    getQuoteHistory: vi.fn(),
    getQuoteTimelineSummary: vi.fn(),
}));

vi.mock("@/lib/services/quote", () => ({
    listQuotes: mocks.listQuotes,
    createQuote: mocks.createQuote,
    getQuote: mocks.getQuote,
    updateQuote: mocks.updateQuote,
    deleteQuote: mocks.deleteQuote,
    addQuoteLineItem: mocks.addQuoteLineItem,
    updateQuoteLineItem: mocks.updateQuoteLineItem,
    removeQuoteLineItem: mocks.removeQuoteLineItem,
    reorderQuoteLineItems: mocks.reorderQuoteLineItems,
    sendQuote: mocks.sendQuote,
    approveQuote: mocks.approveQuote,
    rejectQuote: mocks.rejectQuote,
    reviseQuote: mocks.reviseQuote,
    convertQuoteToWorkOrder: mocks.convertQuoteToWorkOrder,
    getQuoteHistory: mocks.getQuoteHistory,
    getQuoteTimelineSummary: mocks.getQuoteTimelineSummary,
}));

import {
    GET as listQuotesRoute,
    POST as createQuoteRoute,
} from "@/app/api/workspaces/[workspaceId]/quotes/route";
import {
    GET as getQuoteRoute,
    PATCH as updateQuoteRoute,
    DELETE as deleteQuoteRoute,
} from "@/app/api/workspaces/[workspaceId]/quotes/[quoteId]/route";
import { POST as addQuoteLineItemRoute } from "@/app/api/workspaces/[workspaceId]/quotes/[quoteId]/lines/route";
import {
    PATCH as updateQuoteLineItemRoute,
    DELETE as removeQuoteLineItemRoute,
} from "@/app/api/workspaces/[workspaceId]/quotes/[quoteId]/lines/[lineId]/route";
import { POST as reorderQuoteLineItemsRoute } from "@/app/api/workspaces/[workspaceId]/quotes/[quoteId]/lines/reorder/route";
import { POST as sendQuoteRoute } from "@/app/api/workspaces/[workspaceId]/quotes/[quoteId]/send/route";
import { POST as approveQuoteRoute } from "@/app/api/workspaces/[workspaceId]/quotes/[quoteId]/approve/route";
import { POST as rejectQuoteRoute } from "@/app/api/workspaces/[workspaceId]/quotes/[quoteId]/reject/route";
import { POST as reviseQuoteRoute } from "@/app/api/workspaces/[workspaceId]/quotes/[quoteId]/revise/route";
import { POST as convertQuoteRoute } from "@/app/api/workspaces/[workspaceId]/quotes/[quoteId]/convert/route";
import { GET as getQuoteHistoryRoute } from "@/app/api/workspaces/[workspaceId]/quotes/[quoteId]/history/route";
import { GET as getQuoteTimelineRoute } from "@/app/api/workspaces/[workspaceId]/quotes/[quoteId]/timeline/route";

import {
    QuoteNotFoundError,
    QuoteLineItemNotFoundError,
    QuoteStatusConflictError,
    QuoteAlreadyConvertedError,
    QuoteExpiredError,
    QuoteEmptyLineItemsError,
    InvalidQuoteCalculationError,
    MissingRejectionReasonError,
} from "@/lib/services/quote/quoteErrors";
import {
    CustomerNotFoundError,
    ServiceLocationNotFoundError,
} from "@/lib/services/customer/customerErrors";
import {
    UnauthorizedError,
    ForbiddenError,
} from "@/lib/services/authorization/authorizationErrors";

describe("Phase 1.11.10 — REST API Route Handlers & Utilities", () => {
    const WS_ID = "ws_test_alpha";
    const QUOTE_ID = "quote_test_01";
    const LINE_ID = "line_test_01";

    beforeEach(() => {
        vi.clearAllMocks();
    });

    // ==========================================
    // 1. Happy Path Endpoints (All 16 Routes)
    // ==========================================
    describe("1. Happy Path Endpoints", () => {
        it("GET /api/workspaces/[workspaceId]/quotes — succeeds with 200", async () => {
            const mockData = { items: [{ id: QUOTE_ID, quoteNumber: "Q-001" }], total: 1, page: 1, limit: 20, totalPages: 1 };
            mocks.listQuotes.mockResolvedValueOnce(mockData);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes?page=1&limit=20&status=DRAFT`);
            const res = await listQuotesRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockData });
            expect(mocks.listQuotes).toHaveBeenCalledWith(WS_ID, expect.objectContaining({ page: "1", limit: "20", status: "DRAFT" }));
        });

        it("POST /api/workspaces/[workspaceId]/quotes — succeeds with 201", async () => {
            const mockQuote = { id: QUOTE_ID, quoteNumber: "Q-001", status: "DRAFT" };
            mocks.createQuote.mockResolvedValueOnce(mockQuote);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes`, {
                method: "POST",
                body: JSON.stringify({ customerId: "cust_01", title: "New Quote" }),
            });
            const res = await createQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(201);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockQuote });
            expect(mocks.createQuote).toHaveBeenCalledWith(WS_ID, { customerId: "cust_01", title: "New Quote" });
        });

        it("GET /api/workspaces/[workspaceId]/quotes/[quoteId] — succeeds with 200", async () => {
            const mockQuote = { id: QUOTE_ID, quoteNumber: "Q-001" };
            mocks.getQuote.mockResolvedValueOnce(mockQuote);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}`);
            const res = await getQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockQuote });
            expect(mocks.getQuote).toHaveBeenCalledWith(WS_ID, QUOTE_ID);
        });

        it("PATCH /api/workspaces/[workspaceId]/quotes/[quoteId] — succeeds with 200", async () => {
            const mockQuote = { id: QUOTE_ID, title: "Updated Title" };
            mocks.updateQuote.mockResolvedValueOnce(mockQuote);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}`, {
                method: "PATCH",
                body: JSON.stringify({ title: "Updated Title" }),
            });
            const res = await updateQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockQuote });
            expect(mocks.updateQuote).toHaveBeenCalledWith(WS_ID, QUOTE_ID, { title: "Updated Title" });
        });

        it("DELETE /api/workspaces/[workspaceId]/quotes/[quoteId] — succeeds with 200", async () => {
            const mockResult = { success: true, id: QUOTE_ID };
            mocks.deleteQuote.mockResolvedValueOnce(mockResult);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}`, {
                method: "DELETE",
            });
            const res = await deleteQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockResult });
            expect(mocks.deleteQuote).toHaveBeenCalledWith(WS_ID, QUOTE_ID);
        });

        it("POST /api/workspaces/[workspaceId]/quotes/[quoteId]/lines — succeeds with 201", async () => {
            const mockQuote = { id: QUOTE_ID, lineItems: [{ id: LINE_ID, name: "Labor" }] };
            mocks.addQuoteLineItem.mockResolvedValueOnce(mockQuote);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}/lines`, {
                method: "POST",
                body: JSON.stringify({ lineItemType: "LABOR", name: "Labor", unitPrice: "100.00" }),
            });
            const res = await addQuoteLineItemRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(201);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockQuote });
            expect(mocks.addQuoteLineItem).toHaveBeenCalledWith(WS_ID, QUOTE_ID, { lineItemType: "LABOR", name: "Labor", unitPrice: "100.00" });
        });

        it("PATCH /api/workspaces/[workspaceId]/quotes/[quoteId]/lines/[lineId] — succeeds with 200", async () => {
            const mockQuote = { id: QUOTE_ID, lineItems: [{ id: LINE_ID, quantity: "2.00" }] };
            mocks.updateQuoteLineItem.mockResolvedValueOnce(mockQuote);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}/lines/${LINE_ID}`, {
                method: "PATCH",
                body: JSON.stringify({ quantity: "2.00" }),
            });
            const res = await updateQuoteLineItemRoute(req, {
                params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID, lineId: LINE_ID }),
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockQuote });
            expect(mocks.updateQuoteLineItem).toHaveBeenCalledWith(WS_ID, QUOTE_ID, LINE_ID, { quantity: "2.00" });
        });

        it("DELETE /api/workspaces/[workspaceId]/quotes/[quoteId]/lines/[lineId] — succeeds with 200", async () => {
            const mockQuote = { id: QUOTE_ID, lineItems: [] };
            mocks.removeQuoteLineItem.mockResolvedValueOnce(mockQuote);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}/lines/${LINE_ID}`, {
                method: "DELETE",
            });
            const res = await removeQuoteLineItemRoute(req, {
                params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID, lineId: LINE_ID }),
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockQuote });
            expect(mocks.removeQuoteLineItem).toHaveBeenCalledWith(WS_ID, QUOTE_ID, LINE_ID);
        });

        it("POST /api/workspaces/[workspaceId]/quotes/[quoteId]/lines/reorder — succeeds with 200", async () => {
            const mockQuote = { id: QUOTE_ID, lineItems: [{ id: LINE_ID, sortOrder: 0 }] };
            mocks.reorderQuoteLineItems.mockResolvedValueOnce(mockQuote);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}/lines/reorder`, {
                method: "POST",
                body: JSON.stringify({ lineItemIds: [LINE_ID] }),
            });
            const res = await reorderQuoteLineItemsRoute(req, {
                params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }),
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockQuote });
            expect(mocks.reorderQuoteLineItems).toHaveBeenCalledWith(WS_ID, QUOTE_ID, { lineItemIds: [LINE_ID] });
        });

        it("POST /api/workspaces/[workspaceId]/quotes/[quoteId]/send — succeeds with 200", async () => {
            const mockQuote = { id: QUOTE_ID, status: "PENDING_APPROVAL" };
            mocks.sendQuote.mockResolvedValueOnce(mockQuote);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}/send`, {
                method: "POST",
                body: JSON.stringify({ notes: "Please review" }),
            });
            const res = await sendQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockQuote });
            expect(mocks.sendQuote).toHaveBeenCalledWith(WS_ID, QUOTE_ID, { notes: "Please review" });
        });

        it("POST /api/workspaces/[workspaceId]/quotes/[quoteId]/approve — succeeds with 200", async () => {
            const mockQuote = { id: QUOTE_ID, status: "APPROVED" };
            mocks.approveQuote.mockResolvedValueOnce(mockQuote);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}/approve`, {
                method: "POST",
                body: JSON.stringify({ approvedByCustomerName: "John Doe" }),
            });
            const res = await approveQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockQuote });
            expect(mocks.approveQuote).toHaveBeenCalledWith(WS_ID, QUOTE_ID, { approvedByCustomerName: "John Doe" });
        });

        it("POST /api/workspaces/[workspaceId]/quotes/[quoteId]/reject — succeeds with 200", async () => {
            const mockQuote = { id: QUOTE_ID, status: "REJECTED" };
            mocks.rejectQuote.mockResolvedValueOnce(mockQuote);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}/reject`, {
                method: "POST",
                body: JSON.stringify({ rejectionReason: "Too expensive" }),
            });
            const res = await rejectQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockQuote });
            expect(mocks.rejectQuote).toHaveBeenCalledWith(WS_ID, QUOTE_ID, { rejectionReason: "Too expensive" });
        });

        it("POST /api/workspaces/[workspaceId]/quotes/[quoteId]/revise — succeeds with 200", async () => {
            const mockQuote = { id: QUOTE_ID, status: "DRAFT" };
            mocks.reviseQuote.mockResolvedValueOnce(mockQuote);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}/revise`, {
                method: "POST",
            });
            const res = await reviseQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockQuote });
            expect(mocks.reviseQuote).toHaveBeenCalledWith(WS_ID, QUOTE_ID);
        });

        it("POST /api/workspaces/[workspaceId]/quotes/[quoteId]/convert — succeeds with 200", async () => {
            const mockResult = { success: true, workOrder: { id: "wo_01" }, quote: { id: QUOTE_ID, status: "CONVERTED" } };
            mocks.convertQuoteToWorkOrder.mockResolvedValueOnce(mockResult);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}/convert`, {
                method: "POST",
                body: JSON.stringify({ title: "WO Title" }),
            });
            const res = await convertQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockResult });
            expect(mocks.convertQuoteToWorkOrder).toHaveBeenCalledWith(WS_ID, QUOTE_ID, { title: "WO Title" });
        });

        it("GET /api/workspaces/[workspaceId]/quotes/[quoteId]/history — succeeds with 200", async () => {
            const mockHistory = { items: [{ id: "hist_01", eventType: "CREATED" }], total: 1, page: 1, limit: 20, totalPages: 1 };
            mocks.getQuoteHistory.mockResolvedValueOnce(mockHistory);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}/history?page=1&limit=20`);
            const res = await getQuoteHistoryRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockHistory });
            expect(mocks.getQuoteHistory).toHaveBeenCalledWith(WS_ID, QUOTE_ID, undefined, expect.objectContaining({ page: "1", limit: "20" }));
        });

        it("GET /api/workspaces/[workspaceId]/quotes/[quoteId]/timeline — succeeds with 200", async () => {
            const mockSummary = { quoteId: QUOTE_ID, status: "APPROVED", currentLifecycleMilestone: "APPROVED" };
            mocks.getQuoteTimelineSummary.mockResolvedValueOnce(mockSummary);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}/timeline`);
            const res = await getQuoteTimelineRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockSummary });
            expect(mocks.getQuoteTimelineSummary).toHaveBeenCalledWith(WS_ID, QUOTE_ID);
        });
    });

    // ==========================================
    // 2. Permission Denied (403) Handling
    // ==========================================
    describe("2. Permission Denied (403) Handling", () => {
        it("returns 403 Forbidden on quotes.view permission denial", async () => {
            mocks.getQuote.mockRejectedValueOnce(new ForbiddenError("Permission quotes.view required."));

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}`);
            const res = await getQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("FORBIDDEN");
        });

        it("returns 403 Forbidden on quotes.create permission denial", async () => {
            mocks.createQuote.mockRejectedValueOnce(new ForbiddenError("Permission quotes.create required."));

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes`, {
                method: "POST",
                body: JSON.stringify({ customerId: "cust_01" }),
            });
            const res = await createQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("FORBIDDEN");
        });

        it("returns 403 Forbidden on quotes.update permission denial", async () => {
            mocks.updateQuote.mockRejectedValueOnce(new ForbiddenError("Permission quotes.update required."));

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}`, {
                method: "PATCH",
                body: JSON.stringify({ title: "Edit" }),
            });
            const res = await updateQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("FORBIDDEN");
        });

        it("returns 403 Forbidden on quotes.delete permission denial", async () => {
            mocks.deleteQuote.mockRejectedValueOnce(new ForbiddenError("Permission quotes.delete required."));

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}`, {
                method: "DELETE",
            });
            const res = await deleteQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("FORBIDDEN");
        });

        it("returns 403 Forbidden on quotes.send permission denial", async () => {
            mocks.sendQuote.mockRejectedValueOnce(new ForbiddenError("Permission quotes.send required."));

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}/send`, {
                method: "POST",
                body: JSON.stringify({}),
            });
            const res = await sendQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("FORBIDDEN");
        });

        it("returns 403 Forbidden on quotes.approve permission denial", async () => {
            mocks.approveQuote.mockRejectedValueOnce(new ForbiddenError("Permission quotes.approve required."));

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}/approve`, {
                method: "POST",
                body: JSON.stringify({}),
            });
            const res = await approveQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("FORBIDDEN");
        });

        it("returns 403 Forbidden on quotes.reject permission denial", async () => {
            mocks.rejectQuote.mockRejectedValueOnce(new ForbiddenError("Permission quotes.reject required."));

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}/reject`, {
                method: "POST",
                body: JSON.stringify({ rejectionReason: "Rejected" }),
            });
            const res = await rejectQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("FORBIDDEN");
        });

        it("returns 403 Forbidden on quotes.convert permission denial", async () => {
            mocks.convertQuoteToWorkOrder.mockRejectedValueOnce(new ForbiddenError("Permission quotes.convert required."));

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}/convert`, {
                method: "POST",
                body: JSON.stringify({}),
            });
            const res = await convertQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("FORBIDDEN");
        });
    });

    // ==========================================
    // 3. Malformed JSON & Missing Workspace (400)
    // ==========================================
    describe("3. Malformed JSON & Missing Workspace", () => {
        it("returns 400 INVALID_REQUEST on malformed JSON payload on POST /quotes", async () => {
            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes`, {
                method: "POST",
                body: "{ broken json",
                headers: { "Content-Type": "application/json" },
            });
            const res = await createQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.error.code).toBe("INVALID_REQUEST");
            expect(json.error.message).toBe("Invalid JSON in request body.");
        });

        it("returns 400 INVALID_REQUEST on malformed JSON payload on PATCH /quotes/[quoteId]", async () => {
            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}`, {
                method: "PATCH",
                body: "invalid json string",
            });
            const res = await updateQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.error.code).toBe("INVALID_REQUEST");
        });

        it("returns 400 INVALID_REQUEST on malformed JSON payload on POST /quotes/[quoteId]/lines", async () => {
            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}/lines`, {
                method: "POST",
                body: "{'bad': json}",
            });
            const res = await addQuoteLineItemRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.error.code).toBe("INVALID_REQUEST");
        });

        it("returns 400 INVALID_REQUEST on malformed JSON payload on POST /quotes/[quoteId]/lines/reorder", async () => {
            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}/lines/reorder`, {
                method: "POST",
                body: "not json",
            });
            const res = await reorderQuoteLineItemsRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.error.code).toBe("INVALID_REQUEST");
        });

        it("returns 400 INVALID_REQUEST on malformed JSON payload on POST /quotes/[quoteId]/reject", async () => {
            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}/reject`, {
                method: "POST",
                body: "{ malformed",
            });
            const res = await rejectQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.error.code).toBe("INVALID_REQUEST");
        });

        it("returns 400 MISSING_WORKSPACE if workspaceId is empty", async () => {
            const req = new Request(`http://localhost/api/workspaces//quotes`);
            const res = await listQuotesRoute(req, { params: Promise.resolve({ workspaceId: "" }) });

            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.error.code).toBe("MISSING_WORKSPACE");
        });
    });

    // ==========================================
    // 4. Zod Validation Error (422)
    // ==========================================
    describe("4. Zod Validation Error (422)", () => {
        it("returns 422 VALIDATION_ERROR with fieldErrors on Zod validation failure through POST /quotes", async () => {
            const zodError = new ZodError([
                {
                    code: "custom",
                    path: ["customerId"],
                    message: "Customer ID is required",
                },
            ]);
            mocks.createQuote.mockRejectedValueOnce(zodError);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes`, {
                method: "POST",
                body: JSON.stringify({}),
            });
            const res = await createQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.error.code).toBe("VALIDATION_ERROR");
            expect(json.error.fields).toBeDefined();
            expect(json.error.fields.customerId).toContain("Customer ID is required");
        });

        it("returns 422 VALIDATION_ERROR with structured fields on Zod validation failure through POST /quotes/[quoteId]/lines", async () => {
            const zodError = new ZodError([
                {
                    code: "custom",
                    path: ["unitPrice"],
                    message: "Unit price cannot be negative",
                },
            ]);
            mocks.addQuoteLineItem.mockRejectedValueOnce(zodError);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}/lines`, {
                method: "POST",
                body: JSON.stringify({ name: "Line", unitPrice: -50 }),
            });
            const res = await addQuoteLineItemRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.error.code).toBe("VALIDATION_ERROR");
            expect(json.error.fields.unitPrice).toContain("Unit price cannot be negative");
        });
    });

    // ==========================================
    // 5. Complete Domain Error Taxonomy Mapping
    // ==========================================
    describe("5. Complete Domain Error Taxonomy Mapping", () => {
        it("maps QuoteNotFoundError to 404", async () => {
            mocks.getQuote.mockRejectedValueOnce(new QuoteNotFoundError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}`);
            const res = await getQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.error.code).toBe("QUOTE_NOT_FOUND");
        });

        it("maps QuoteLineItemNotFoundError to 404", async () => {
            mocks.updateQuoteLineItem.mockRejectedValueOnce(new QuoteLineItemNotFoundError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}/lines/${LINE_ID}`, {
                method: "PATCH",
                body: JSON.stringify({ quantity: "1.00" }),
            });
            const res = await updateQuoteLineItemRoute(req, {
                params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID, lineId: LINE_ID }),
            });

            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.error.code).toBe("QUOTE_LINE_ITEM_NOT_FOUND");
        });

        it("maps CustomerNotFoundError to 404", async () => {
            mocks.createQuote.mockRejectedValueOnce(new CustomerNotFoundError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes`, {
                method: "POST",
                body: JSON.stringify({ customerId: "missing_cust" }),
            });
            const res = await createQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.error.code).toBe("CUSTOMER_NOT_FOUND");
        });

        it("maps ServiceLocationNotFoundError to 404", async () => {
            mocks.createQuote.mockRejectedValueOnce(new ServiceLocationNotFoundError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes`, {
                method: "POST",
                body: JSON.stringify({ customerId: "cust_01", locationId: "missing_loc" }),
            });
            const res = await createQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.error.code).toBe("SERVICE_LOCATION_NOT_FOUND");
        });

        it("maps QuoteStatusConflictError to 409", async () => {
            mocks.updateQuote.mockRejectedValueOnce(new QuoteStatusConflictError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}`, {
                method: "PATCH",
                body: JSON.stringify({ title: "Edit" }),
            });
            const res = await updateQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(409);
            const json = await res.json();
            expect(json.error.code).toBe("QUOTE_STATUS_CONFLICT");
        });

        it("maps QuoteAlreadyConvertedError to 409", async () => {
            mocks.convertQuoteToWorkOrder.mockRejectedValueOnce(new QuoteAlreadyConvertedError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}/convert`, {
                method: "POST",
                body: JSON.stringify({}),
            });
            const res = await convertQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(409);
            const json = await res.json();
            expect(json.error.code).toBe("QUOTE_ALREADY_CONVERTED");
        });

        it("maps QuoteExpiredError to 422", async () => {
            mocks.approveQuote.mockRejectedValueOnce(new QuoteExpiredError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}/approve`, {
                method: "POST",
                body: JSON.stringify({}),
            });
            const res = await approveQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.error.code).toBe("QUOTE_EXPIRED");
        });

        it("maps QuoteEmptyLineItemsError to 422", async () => {
            mocks.sendQuote.mockRejectedValueOnce(new QuoteEmptyLineItemsError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}/send`, {
                method: "POST",
                body: JSON.stringify({}),
            });
            const res = await sendQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.error.code).toBe("QUOTE_EMPTY_LINE_ITEMS");
        });

        it("maps InvalidQuoteCalculationError to 422", async () => {
            mocks.addQuoteLineItem.mockRejectedValueOnce(new InvalidQuoteCalculationError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}/lines`, {
                method: "POST",
                body: JSON.stringify({ name: "Item", unitPrice: "-100" }),
            });
            const res = await addQuoteLineItemRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.error.code).toBe("INVALID_QUOTE_CALCULATION");
        });

        it("maps MissingRejectionReasonError to 422", async () => {
            mocks.rejectQuote.mockRejectedValueOnce(new MissingRejectionReasonError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}/reject`, {
                method: "POST",
                body: JSON.stringify({}),
            });
            const res = await rejectQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.error.code).toBe("MISSING_REJECTION_REASON");
        });
    });

    // ==========================================
    // 6. Tenant Isolation & Sanitized 500
    // ==========================================
    describe("6. Tenant Isolation & Sanitized 500", () => {
        it("returns 404 QuoteNotFoundError for cross-workspace GET /quotes/[quoteId] without data leak", async () => {
            mocks.getQuote.mockRejectedValueOnce(new QuoteNotFoundError());

            const req = new Request(`http://localhost/api/workspaces/ws_other/quotes/${QUOTE_ID}`);
            const res = await getQuoteRoute(req, { params: Promise.resolve({ workspaceId: "ws_other", quoteId: QUOTE_ID }) });

            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.error.code).toBe("QUOTE_NOT_FOUND");
            expect(json.error.message).toBe("Quote not found.");
            expect(mocks.getQuote).toHaveBeenCalledWith("ws_other", QUOTE_ID);
        });

        it("returns 404 QuoteNotFoundError for cross-workspace PATCH /quotes/[quoteId] without data leak", async () => {
            mocks.updateQuote.mockRejectedValueOnce(new QuoteNotFoundError());

            const req = new Request(`http://localhost/api/workspaces/ws_other/quotes/${QUOTE_ID}`, {
                method: "PATCH",
                body: JSON.stringify({ title: "Cross Tenant Attack" }),
            });
            const res = await updateQuoteRoute(req, { params: Promise.resolve({ workspaceId: "ws_other", quoteId: QUOTE_ID }) });

            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.error.code).toBe("QUOTE_NOT_FOUND");
            expect(mocks.updateQuote).toHaveBeenCalledWith("ws_other", QUOTE_ID, expect.any(Object));
        });

        it("returns 404 QuoteNotFoundError for cross-workspace DELETE /quotes/[quoteId] without data leak", async () => {
            mocks.deleteQuote.mockRejectedValueOnce(new QuoteNotFoundError());

            const req = new Request(`http://localhost/api/workspaces/ws_other/quotes/${QUOTE_ID}`, {
                method: "DELETE",
            });
            const res = await deleteQuoteRoute(req, { params: Promise.resolve({ workspaceId: "ws_other", quoteId: QUOTE_ID }) });

            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.error.code).toBe("QUOTE_NOT_FOUND");
            expect(mocks.deleteQuote).toHaveBeenCalledWith("ws_other", QUOTE_ID);
        });

        it("returns 404 QuoteNotFoundError for cross-workspace POST /quotes/[quoteId]/convert without data leak", async () => {
            mocks.convertQuoteToWorkOrder.mockRejectedValueOnce(new QuoteNotFoundError());

            const req = new Request(`http://localhost/api/workspaces/ws_other/quotes/${QUOTE_ID}/convert`, {
                method: "POST",
                body: JSON.stringify({}),
            });
            const res = await convertQuoteRoute(req, { params: Promise.resolve({ workspaceId: "ws_other", quoteId: QUOTE_ID }) });

            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.error.code).toBe("QUOTE_NOT_FOUND");
            expect(mocks.convertQuoteToWorkOrder).toHaveBeenCalledWith("ws_other", QUOTE_ID, expect.any(Object));
        });

        it("sanitizes unexpected internal runtime errors on GET to 500 INTERNAL_SERVER_ERROR without leaking internal details", async () => {
            mocks.getQuote.mockRejectedValueOnce(new Error("FATAL: database disk full at /var/lib/postgresql/data"));

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes/${QUOTE_ID}`);
            const res = await getQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, quoteId: QUOTE_ID }) });

            expect(res.status).toBe(500);
            const json = await res.json();
            expect(json.error.code).toBe("INTERNAL_SERVER_ERROR");
            expect(json.error.message).toBe("An unexpected error occurred while processing the quote request.");
            expect(JSON.stringify(json)).not.toContain("FATAL");
            expect(JSON.stringify(json)).not.toContain("/var/lib/postgresql/data");
        });

        it("sanitizes unexpected database crash on POST /quotes to 500 INTERNAL_SERVER_ERROR", async () => {
            mocks.createQuote.mockRejectedValueOnce(new Error("Connection refused: postgresql://admin:secret@10.0.0.1:5432/aforden"));

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/quotes`, {
                method: "POST",
                body: JSON.stringify({ customerId: "cust_01" }),
            });
            const res = await createQuoteRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(500);
            const json = await res.json();
            expect(json.error.code).toBe("INTERNAL_SERVER_ERROR");
            expect(JSON.stringify(json)).not.toContain("secret");
            expect(JSON.stringify(json)).not.toContain("10.0.0.1");
        });
    });
});
