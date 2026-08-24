import { describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

import { ZodError } from "zod";
import {
    QuoteNotFoundError,
    QuoteLineItemNotFoundError,
    QuoteStatusConflictError,
    QuoteAlreadyConvertedError,
    QuoteExpiredError,
    QuoteEmptyLineItemsError,
    InvalidQuoteCalculationError,
    MissingRejectionReasonError,
    createQuoteSchema,
    updateQuoteSchema,
    createQuoteLineItemSchema,
    updateQuoteLineItemSchema,
    sendQuoteSchema,
    approveQuoteSchema,
    rejectQuoteSchema,
    convertQuoteSchema,
    listQuotesQuerySchema,
} from "@/lib/services/quote";
import {
    handleQuoteApiError,
    extractWorkspaceId,
    resolveWorkspaceId,
    extractQueryParams,
} from "@/lib/utils/quoteApiError";

describe("Phase 1.11.3 — Domain Types, Errors & Zod Schemas", () => {
    describe("1. Pure Domain Error Classes (Convention B)", () => {
        it("instantiates QuoteNotFoundError with correct metadata", () => {
            const errDefault = new QuoteNotFoundError();
            expect(errDefault.name).toBe("QuoteNotFoundError");
            expect(errDefault.code).toBe("QUOTE_NOT_FOUND");
            expect(errDefault.statusCode).toBe(404);
            expect(errDefault.httpStatus).toBe(404);
            expect(errDefault.message).toBe("Quote not found.");

            const errCustom = new QuoteNotFoundError("Quote Q-999 not found.");
            expect(errCustom.message).toBe("Quote Q-999 not found.");
            expect(errCustom.statusCode).toBe(404);
        });

        it("instantiates QuoteLineItemNotFoundError with correct metadata", () => {
            const err = new QuoteLineItemNotFoundError();
            expect(err.name).toBe("QuoteLineItemNotFoundError");
            expect(err.code).toBe("QUOTE_LINE_ITEM_NOT_FOUND");
            expect(err.statusCode).toBe(404);
            expect(err.httpStatus).toBe(404);
            expect(err.message).toBe("Quote line item not found.");
        });

        it("instantiates QuoteStatusConflictError with correct metadata", () => {
            const err = new QuoteStatusConflictError();
            expect(err.name).toBe("QuoteStatusConflictError");
            expect(err.code).toBe("QUOTE_STATUS_CONFLICT");
            expect(err.statusCode).toBe(409);
            expect(err.httpStatus).toBe(409);
            expect(err.message).toBe("The quote status does not permit this operation.");
        });

        it("instantiates QuoteAlreadyConvertedError with correct metadata", () => {
            const err = new QuoteAlreadyConvertedError();
            expect(err.name).toBe("QuoteAlreadyConvertedError");
            expect(err.code).toBe("QUOTE_ALREADY_CONVERTED");
            expect(err.statusCode).toBe(409);
            expect(err.httpStatus).toBe(409);
            expect(err.message).toBe("Quote has already been converted to a work order.");
        });

        it("instantiates QuoteExpiredError with correct metadata", () => {
            const err = new QuoteExpiredError();
            expect(err.name).toBe("QuoteExpiredError");
            expect(err.code).toBe("QUOTE_EXPIRED");
            expect(err.statusCode).toBe(422);
            expect(err.httpStatus).toBe(422);
            expect(err.message).toBe("Quote has expired and cannot be approved or converted without revision.");
        });

        it("instantiates QuoteEmptyLineItemsError with correct metadata", () => {
            const err = new QuoteEmptyLineItemsError();
            expect(err.name).toBe("QuoteEmptyLineItemsError");
            expect(err.code).toBe("QUOTE_EMPTY_LINE_ITEMS");
            expect(err.statusCode).toBe(422);
            expect(err.httpStatus).toBe(422);
            expect(err.message).toBe("Quote must have at least one line item before it can be sent or converted.");
        });

        it("instantiates InvalidQuoteCalculationError with correct metadata", () => {
            const err = new InvalidQuoteCalculationError();
            expect(err.name).toBe("InvalidQuoteCalculationError");
            expect(err.code).toBe("INVALID_QUOTE_CALCULATION");
            expect(err.statusCode).toBe(422);
            expect(err.httpStatus).toBe(422);
            expect(err.message).toContain("cannot be negative");
        });

        it("instantiates MissingRejectionReasonError with correct metadata", () => {
            const err = new MissingRejectionReasonError();
            expect(err.name).toBe("MissingRejectionReasonError");
            expect(err.code).toBe("MISSING_REJECTION_REASON");
            expect(err.statusCode).toBe(422);
            expect(err.httpStatus).toBe(422);
            expect(err.message).toBe("Rejection reason is required when rejecting a quote.");
        });
    });

    describe("2. Quote Header Zod Schemas", () => {
        it("validates createQuoteSchema happy path and defaults", () => {
            const valid = {
                customerId: "cust_123",
                title: "HVAC System Replacement",
            };
            const result = createQuoteSchema.parse(valid);
            expect(result.customerId).toBe("cust_123");
            expect(result.title).toBe("HVAC System Replacement");
            expect(result.discountType).toBe("PERCENTAGE");
            expect(result.discountValue).toBe(0);
            expect(result.taxRate).toBe(0);
        });

        it("validates createQuoteSchema with all optional fields", () => {
            const full = {
                customerId: "cust_123",
                locationId: "loc_456",
                title: "Annual Preventative Maintenance",
                description: "Full service diagnostic",
                internalNotes: "Customer VIP account",
                termsAndConditions: "Net 30 payment terms.",
                currencyCode: "PKR",
                validUntil: "2026-09-30T00:00:00.000Z",
                discountType: "FIXED",
                discountValue: 150.5,
                taxRate: 0.0825,
            };
            const result = createQuoteSchema.parse(full);
            expect(result.locationId).toBe("loc_456");
            expect(result.currencyCode).toBe("PKR");
            expect(result.discountType).toBe("FIXED");
            expect(result.discountValue).toBe(150.5);
            expect(result.taxRate).toBe(0.0825);
            expect(result.validUntil).toBeInstanceOf(Date);
        });

        it("fails createQuoteSchema on missing required fields or invalid bounds", () => {
            expect(() => createQuoteSchema.parse({})).toThrow(ZodError);
            expect(() => createQuoteSchema.parse({ customerId: "", title: "" })).toThrow();
            expect(() => createQuoteSchema.parse({
                customerId: "cust_1",
                title: "T",
                currencyCode: "US", // Must be 3 chars
            })).toThrow();
            expect(() => createQuoteSchema.parse({
                customerId: "cust_1",
                title: "T",
                taxRate: 1.5, // Exceeds 1.0
            })).toThrow();
        });

        it("validates updateQuoteSchema partial updates", () => {
            const partial = {
                title: "Updated Title",
                discountValue: 50,
            };
            const result = updateQuoteSchema.parse(partial);
            expect(result.title).toBe("Updated Title");
            expect(result.discountValue).toBe(50);
        });
    });

    describe("3. Quote Line Item Zod Schemas & Step 1 Calculation Guard", () => {
        it("validates createQuoteLineItemSchema happy path and defaults", () => {
            const valid = {
                name: "Standard Labor",
                quantity: 2,
                unitPrice: 75.0,
            };
            const result = createQuoteLineItemSchema.parse(valid);
            expect(result.name).toBe("Standard Labor");
            expect(result.quantity).toBe(2);
            expect(result.unitPrice).toBe(75.0);
            expect(result.discountAmount).toBe(0);
            expect(result.taxRate).toBe(0);
            expect(result.sortOrder).toBe(0);
            expect(result.lineItemType).toBe("CUSTOM");
        });

        it("enforces Step 1 calculation guard: rejects when (quantity * unitPrice) - discountAmount < 0", () => {
            const negativeLine = {
                name: "Flawed Line Item",
                quantity: 1,
                unitPrice: 50.0,
                discountAmount: 75.0, // Subtotal would be -25.00 -> REJECT!
            };

            expect(() => createQuoteLineItemSchema.parse(negativeLine)).toThrowError(
                /Invalid quote calculation: line item subtotal/i,
            );
        });

        it("accepts when (quantity * unitPrice) - discountAmount equals exactly zero (100% line discount)", () => {
            const zeroLine = {
                name: "Complimentary Inspection",
                quantity: 2,
                unitPrice: 50.0,
                discountAmount: 100.0, // Exactly 100 - 100 = 0 -> PASS!
            };

            const result = createQuoteLineItemSchema.parse(zeroLine);
            expect(result.discountAmount).toBe(100.0);
        });

        it("validates updateQuoteLineItemSchema with calculation guard", () => {
            const validUpdate = {
                quantity: 3,
                unitPrice: 20,
                discountAmount: 10, // 60 - 10 = 50 >= 0 -> PASS
            };
            expect(updateQuoteLineItemSchema.parse(validUpdate).discountAmount).toBe(10);

            const invalidUpdate = {
                quantity: 1,
                unitPrice: 20,
                discountAmount: 30, // 20 - 30 = -10 < 0 -> FAIL
            };
            expect(() => updateQuoteLineItemSchema.parse(invalidUpdate)).toThrowError(
                /Invalid quote calculation: line item subtotal/i,
            );
        });
    });

    describe("4. Lifecycle Transition Schemas", () => {
        it("validates sendQuoteSchema", () => {
            const result = sendQuoteSchema.parse({ notes: "Sent via email" });
            expect(result.notes).toBe("Sent via email");
            expect(sendQuoteSchema.parse({}).notes).toBeUndefined();
        });

        it("validates approveQuoteSchema", () => {
            const result = approveQuoteSchema.parse({
                approvedByCustomerName: "Jane Doe",
                notes: "Signed proposal",
            });
            expect(result.approvedByCustomerName).toBe("Jane Doe");
            expect(result.notes).toBe("Signed proposal");
        });

        it("validates rejectQuoteSchema: requires non-empty rejectionReason", () => {
            const valid = {
                rejectionReason: "Customer chose a competing vendor.",
            };
            const result = rejectQuoteSchema.parse(valid);
            expect(result.rejectionReason).toBe("Customer chose a competing vendor.");

            // Fails on empty or whitespace reason
            expect(() => rejectQuoteSchema.parse({})).toThrow();
            expect(() => rejectQuoteSchema.parse({ rejectionReason: "" })).toThrow();
            expect(() => rejectQuoteSchema.parse({ rejectionReason: "   " })).toThrow();
        });

        it("validates convertQuoteSchema", () => {
            const valid = {
                workTypeId: "wt_123",
                title: "Custom Work Order Title",
            };
            const result = convertQuoteSchema.parse(valid);
            expect(result.workTypeId).toBe("wt_123");
            expect(result.title).toBe("Custom Work Order Title");
        });
    });

    describe("5. Query & Filter Schemas (listQuotesQuerySchema)", () => {
        it("parses query parameters, status arrays, and pagination defaults", () => {
            const query = {
                status: "DRAFT,PENDING_APPROVAL",
                customerId: "cust_123",
                search: "chiller",
                minTotal: "100.50",
                page: "2",
                limit: "10",
                sortBy: "total",
                sortOrder: "asc",
            };

            const parsed = listQuotesQuerySchema.parse(query);
            expect(parsed.status).toEqual(["DRAFT", "PENDING_APPROVAL"]);
            expect(parsed.customerId).toBe("cust_123");
            expect(parsed.search).toBe("chiller");
            expect(parsed.minTotal).toBe(100.5);
            expect(parsed.page).toBe(2);
            expect(parsed.limit).toBe(10);
            expect(parsed.sortBy).toBe("total");
            expect(parsed.sortOrder).toBe("asc");
        });

        it("applies default pagination when omitted", () => {
            const parsed = listQuotesQuerySchema.parse({});
            expect(parsed.page).toBe(1);
            expect(parsed.limit).toBe(20);
            expect(parsed.sortBy).toBe("createdAt");
            expect(parsed.sortOrder).toBe("desc");
        });
    });

    describe("6. API Error Mapper (handleQuoteApiError)", () => {
        it("maps QuoteNotFoundError to 404 response", async () => {
            const res = handleQuoteApiError(new QuoteNotFoundError("Quote not found."));
            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("QUOTE_NOT_FOUND");
        });

        it("maps QuoteLineItemNotFoundError to 404 response", async () => {
            const res = handleQuoteApiError(new QuoteLineItemNotFoundError());
            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("QUOTE_LINE_ITEM_NOT_FOUND");
        });

        it("maps QuoteStatusConflictError to 409 response", async () => {
            const res = handleQuoteApiError(new QuoteStatusConflictError());
            expect(res.status).toBe(409);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("QUOTE_STATUS_CONFLICT");
        });

        it("maps QuoteAlreadyConvertedError to 409 response", async () => {
            const res = handleQuoteApiError(new QuoteAlreadyConvertedError());
            expect(res.status).toBe(409);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("QUOTE_ALREADY_CONVERTED");
        });

        it("maps QuoteExpiredError to 422 response", async () => {
            const res = handleQuoteApiError(new QuoteExpiredError());
            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("QUOTE_EXPIRED");
        });

        it("maps QuoteEmptyLineItemsError to 422 response", async () => {
            const res = handleQuoteApiError(new QuoteEmptyLineItemsError());
            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("QUOTE_EMPTY_LINE_ITEMS");
        });

        it("maps InvalidQuoteCalculationError to 422 response", async () => {
            const res = handleQuoteApiError(new InvalidQuoteCalculationError());
            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("INVALID_QUOTE_CALCULATION");
        });

        it("maps MissingRejectionReasonError to 422 response", async () => {
            const res = handleQuoteApiError(new MissingRejectionReasonError());
            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("MISSING_REJECTION_REASON");
        });

        it("maps ZodError to 422 with field details", async () => {
            try {
                createQuoteSchema.parse({});
            } catch (err) {
                const res = handleQuoteApiError(err);
                expect(res.status).toBe(422);
                const json = await res.json();
                expect(json.success).toBe(false);
                expect(json.error.code).toBe("VALIDATION_ERROR");
                expect(json.error.fields).toBeDefined();
            }
        });

        it("maps SyntaxError to 400 Bad Request", async () => {
            const res = handleQuoteApiError(new SyntaxError("Unexpected token"));
            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.error.code).toBe("INVALID_REQUEST");
        });

        it("maps unexpected errors to 500 INTERNAL_SERVER_ERROR", async () => {
            const res = handleQuoteApiError(new Error("Unexpected DB crash"));
            expect(res.status).toBe(500);
            const json = await res.json();
            expect(json.error.code).toBe("INTERNAL_SERVER_ERROR");
        });

        it("extracts workspaceId from path params, headers, and query parameters", () => {
            const reqWithHeader = new Request("http://localhost:3000/api/quotes", {
                headers: { "x-workspace-id": "ws_header_1" },
            });
            expect(extractWorkspaceId(reqWithHeader)).toBe("ws_header_1");

            const reqWithQuery = new Request("http://localhost:3000/api/quotes?workspaceId=ws_query_1");
            expect(extractWorkspaceId(reqWithQuery)).toBe("ws_query_1");

            const reqWithPath = new Request("http://localhost:3000/api/quotes");
            expect(extractWorkspaceId(reqWithPath, "ws_path_1")).toBe("ws_path_1");
        });

        it("resolves workspaceId or returns 400 MISSING_WORKSPACE", async () => {
            const validReq = new Request("http://localhost:3000/api/quotes", {
                headers: { "x-workspace-id": "ws_123" },
            });
            const resolved = resolveWorkspaceId(validReq);
            expect(resolved.workspaceId).toBe("ws_123");

            const invalidReq = new Request("http://localhost:3000/api/quotes");
            const missing = resolveWorkspaceId(invalidReq);
            expect(missing.errorResponse).toBeDefined();
            expect(missing.errorResponse?.status).toBe(400);
        });

        it("extracts query parameters correctly", () => {
            const req = new Request("http://localhost:3000/api/quotes?status=DRAFT&page=2");
            const params = extractQueryParams(req);
            expect(params.status).toBe("DRAFT");
            expect(params.page).toBe("2");
        });
    });
});
