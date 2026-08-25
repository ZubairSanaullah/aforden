import { describe, it, expect, vi } from "vitest";
import { ZodError, z } from "zod";
import {
    InvoiceNotFoundError,
    InvoiceLineItemNotFoundError,
    PaymentNotFoundError,
    InvoiceStatusConflictError,
    InvoiceAlreadyPaidError,
    InvoiceAlreadyVoidedError,
    PaymentAlreadyVoidedError,
    InvoiceHasActivePaymentsError,
    OverpaymentNotAllowedError,
    InvalidPaymentAmountError,
    InvoiceEmptyLineItemsError,
    InvalidInvoiceCalculationError,
    SourceEntityNotEligibleError,
    MissingVoidReasonError,
    InvoiceDueDateInvalidError,
} from "@/lib/services/invoice/invoiceErrors";
import {
    createInvoiceSchema,
    createInvoiceFromQuoteSchema,
    createInvoiceFromWorkOrderSchema,
    updateInvoiceSchema,
    createInvoiceLineItemSchema,
    updateInvoiceLineItemSchema,
    voidInvoiceSchema,
    recordPaymentSchema,
    voidPaymentSchema,
    listInvoicesQuerySchema,
    listPaymentsQuerySchema,
} from "@/lib/services/invoice/invoice.schemas";
import {
    mapInvoiceLineItemToReadModel,
    mapPaymentToReadModel,
    mapInvoiceHistoryToReadModel,
    mapInvoiceToReadModel,
} from "@/lib/services/invoice/invoiceMappers";
import { handleInvoiceApiError } from "@/lib/utils/invoiceApiError";
import {
    CustomerNotFoundError,
    ServiceLocationNotFoundError,
} from "@/lib/services/customer/customerErrors";
import { QuoteNotFoundError } from "@/lib/services/quote/quoteErrors";
import { WorkOrderNotFoundError } from "@/lib/services/workOrder/workOrderErrors";

describe("Phase 1.12.3 — Invoicing & Payments Domain Types, Errors & Zod Schemas", () => {
    // ==========================================
    // 1. PURE DOMAIN ERROR CLASSES (CONVENTION B)
    // ==========================================
    describe("1. Pure Domain Error Classes", () => {
        const errorTestCases = [
            {
                ErrorClass: InvoiceNotFoundError,
                code: "INVOICE_NOT_FOUND",
                status: 404,
                defaultMsg: "Invoice not found.",
            },
            {
                ErrorClass: InvoiceLineItemNotFoundError,
                code: "INVOICE_LINE_ITEM_NOT_FOUND",
                status: 404,
                defaultMsg: "Invoice line item not found.",
            },
            {
                ErrorClass: PaymentNotFoundError,
                code: "PAYMENT_NOT_FOUND",
                status: 404,
                defaultMsg: "Payment not found.",
            },
            {
                ErrorClass: InvoiceStatusConflictError,
                code: "INVOICE_STATUS_CONFLICT",
                status: 409,
                defaultMsg: "The invoice status does not permit this operation.",
            },
            {
                ErrorClass: InvoiceAlreadyPaidError,
                code: "INVOICE_ALREADY_PAID",
                status: 409,
                defaultMsg:
                    "Invoice is already fully paid and cannot accept additional payments.",
            },
            {
                ErrorClass: InvoiceAlreadyVoidedError,
                code: "INVOICE_ALREADY_VOIDED",
                status: 409,
                defaultMsg:
                    "Invoice has been voided and cannot be modified or receive payments.",
            },
            {
                ErrorClass: PaymentAlreadyVoidedError,
                code: "PAYMENT_ALREADY_VOIDED",
                status: 409,
                defaultMsg:
                    "Payment is already voided and cannot be voided again.",
            },
            {
                ErrorClass: InvoiceHasActivePaymentsError,
                code: "INVOICE_HAS_ACTIVE_PAYMENTS",
                status: 409,
                defaultMsg:
                    "Cannot void or delete an invoice with active recorded payments. Void all associated payments first.",
            },
            {
                ErrorClass: OverpaymentNotAllowedError,
                code: "OVERPAYMENT_NOT_ALLOWED",
                status: 422,
                defaultMsg:
                    "Payment amount exceeds the outstanding balance due on this invoice.",
            },
            {
                ErrorClass: InvalidPaymentAmountError,
                code: "INVALID_PAYMENT_AMOUNT",
                status: 422,
                defaultMsg:
                    "Payment amount must be greater than zero and have at most 2 decimal places.",
            },
            {
                ErrorClass: InvoiceEmptyLineItemsError,
                code: "INVOICE_EMPTY_LINE_ITEMS",
                status: 422,
                defaultMsg:
                    "Invoice must contain at least one line item before it can be issued.",
            },
            {
                ErrorClass: InvalidInvoiceCalculationError,
                code: "INVALID_INVOICE_CALCULATION",
                status: 422,
                defaultMsg:
                    "Invalid invoice calculation: line item subtotal ((quantity × unitPrice) − discountAmount) cannot be negative.",
            },
            {
                ErrorClass: SourceEntityNotEligibleError,
                code: "SOURCE_ENTITY_NOT_ELIGIBLE",
                status: 422,
                defaultMsg:
                    "Source entity is not in an eligible status to generate an invoice (Quotes must be APPROVED or CONVERTED; WorkOrders must be COMPLETED).",
            },
            {
                ErrorClass: MissingVoidReasonError,
                code: "MISSING_VOID_REASON",
                status: 422,
                defaultMsg:
                    "A void reason is required when voiding an invoice or payment.",
            },
            {
                ErrorClass: InvoiceDueDateInvalidError,
                code: "INVOICE_DUE_DATE_INVALID",
                status: 422,
                defaultMsg:
                    "Invoice due date must be on or after the issue date.",
            },
        ];

        it.each(errorTestCases)(
            "should instantiate $ErrorClass.name with correct code, status, and message",
            ({ ErrorClass, code, status, defaultMsg }) => {
                const err = new ErrorClass();
                expect(err).toBeInstanceOf(Error);
                expect(err).toBeInstanceOf(ErrorClass);
                expect(err.code).toBe(code);
                expect(err.statusCode).toBe(status);
                expect(err.httpStatus).toBe(status);
                expect(err.message).toBe(defaultMsg);
                expect(err.name).toBe(ErrorClass.name);

                const customErr = new ErrorClass("Custom error message.");
                expect(customErr.message).toBe("Custom error message.");
            },
        );
    });

    // ==========================================
    // 2. ZOD VALIDATION SCHEMAS
    // ==========================================
    describe("2. Zod Validation Schemas", () => {
        describe("createInvoiceSchema", () => {
            it("validates a valid standalone invoice payload", () => {
                const result = createInvoiceSchema.safeParse({
                    customerId: "cust_123",
                    title: "Electrical Upgrade Invoice",
                    issueDate: "2026-09-01",
                    dueDate: "2026-09-30",
                    discountType: "PERCENTAGE",
                    discountValue: 10,
                    taxRate: 0.0825,
                });
                expect(result.success).toBe(true);
            });

            it("rejects when dueDate is earlier than issueDate", () => {
                const result = createInvoiceSchema.safeParse({
                    customerId: "cust_123",
                    title: "Electrical Upgrade Invoice",
                    issueDate: "2026-09-30",
                    dueDate: "2026-09-01",
                });
                expect(result.success).toBe(false);
                if (!result.success) {
                    expect(result.error.issues[0].message).toContain(
                        "due date must be on or after the issue date",
                    );
                }
            });

            it("rejects missing customerId or empty title", () => {
                const res1 = createInvoiceSchema.safeParse({
                    title: "Invoice",
                    dueDate: "2026-09-30",
                });
                expect(res1.success).toBe(false);

                const res2 = createInvoiceSchema.safeParse({
                    customerId: "cust_123",
                    title: "   ",
                    dueDate: "2026-09-30",
                });
                expect(res2.success).toBe(false);
            });
        });

        describe("createInvoiceFromQuoteSchema & createInvoiceFromWorkOrderSchema", () => {
            it("validates create from quote payload", () => {
                const res = createInvoiceFromQuoteSchema.safeParse({
                    quoteId: "quote_123",
                    issueDate: "2026-09-01",
                    dueDate: "2026-09-30",
                    notes: "Payment due upon receipt",
                });
                expect(res.success).toBe(true);
            });

            it("rejects create from quote when dueDate < issueDate", () => {
                const res = createInvoiceFromQuoteSchema.safeParse({
                    quoteId: "quote_123",
                    issueDate: "2026-09-30",
                    dueDate: "2026-09-01",
                });
                expect(res.success).toBe(false);
            });

            it("validates create from work order payload", () => {
                const res = createInvoiceFromWorkOrderSchema.safeParse({
                    workOrderId: "wo_123",
                    issueDate: "2026-09-01",
                    dueDate: "2026-09-30",
                });
                expect(res.success).toBe(true);
            });

            it("rejects create from work order when dueDate < issueDate", () => {
                const res = createInvoiceFromWorkOrderSchema.safeParse({
                    workOrderId: "wo_123",
                    issueDate: "2026-09-30",
                    dueDate: "2026-09-01",
                });
                expect(res.success).toBe(false);
            });
        });

        describe("updateInvoiceSchema", () => {
            it("validates valid partial updates", () => {
                const res = updateInvoiceSchema.safeParse({
                    title: "Updated Title",
                    notes: "Updated terms",
                    discountValue: 15,
                });
                expect(res.success).toBe(true);
            });

            it("rejects when updated dueDate is earlier than updated issueDate", () => {
                const res = updateInvoiceSchema.safeParse({
                    issueDate: "2026-09-30",
                    dueDate: "2026-09-01",
                });
                expect(res.success).toBe(false);
            });
        });

        describe("createInvoiceLineItemSchema (Step 1 Calculation Guard)", () => {
            it("accepts a valid line item where subtotal >= 0", () => {
                const res = createInvoiceLineItemSchema.safeParse({
                    lineItemType: "LABOR",
                    name: "HVAC Diagnostics",
                    quantity: 2,
                    unitPrice: 150,
                    discountAmount: 50,
                    taxRate: 0.0825,
                });
                expect(res.success).toBe(true);
                if (res.success) {
                    expect(res.data.name).toBe("HVAC Diagnostics");
                }
            });

            it("rejects when discountAmount exceeds line item gross (subtotal < 0)", () => {
                const res = createInvoiceLineItemSchema.safeParse({
                    lineItemType: "PART",
                    name: "Filter Replacement",
                    quantity: 1,
                    unitPrice: 30,
                    discountAmount: 50, // 30 - 50 = -20 < 0
                });
                expect(res.success).toBe(false);
                if (!res.success) {
                    expect(res.error.issues[0].message).toContain(
                        "line item subtotal ((quantity × unitPrice) − discountAmount) cannot be negative",
                    );
                }
            });

            it("rejects negative quantity, negative unit price, or negative discount", () => {
                expect(
                    createInvoiceLineItemSchema.safeParse({
                        name: "Item",
                        quantity: -1,
                    }).success,
                ).toBe(false);

                expect(
                    createInvoiceLineItemSchema.safeParse({
                        name: "Item",
                        unitPrice: -50,
                    }).success,
                ).toBe(false);

                expect(
                    createInvoiceLineItemSchema.safeParse({
                        name: "Item",
                        discountAmount: -10,
                    }).success,
                ).toBe(false);
            });
        });

        describe("voidInvoiceSchema & voidPaymentSchema", () => {
            it("accepts a non-empty void reason", () => {
                expect(
                    voidInvoiceSchema.safeParse({
                        voidReason: "Client requested order cancellation",
                    }).success,
                ).toBe(true);

                expect(
                    voidPaymentSchema.safeParse({
                        voidReason: "Check bounced due to NSF",
                    }).success,
                ).toBe(true);
            });

            it("rejects missing, empty, or whitespace-only void reason", () => {
                expect(voidInvoiceSchema.safeParse({}).success).toBe(false);
                expect(
                    voidInvoiceSchema.safeParse({ voidReason: "   " }).success,
                ).toBe(false);

                expect(voidPaymentSchema.safeParse({}).success).toBe(false);
                expect(
                    voidPaymentSchema.safeParse({ voidReason: "" }).success,
                ).toBe(false);
            });
        });

        describe("recordPaymentSchema", () => {
            it("accepts valid positive payments with up to 2 decimal places", () => {
                expect(
                    recordPaymentSchema.safeParse({
                        amount: 150.0,
                        paymentMethod: "CREDIT_CARD",
                        referenceNumber: "AUTH-88219",
                    }).success,
                ).toBe(true);

                expect(
                    recordPaymentSchema.safeParse({
                        amount: 99.99,
                        paymentMethod: "CHECK",
                    }).success,
                ).toBe(true);
            });

            it("rejects 0 or negative payment amounts", () => {
                expect(
                    recordPaymentSchema.safeParse({
                        amount: 0,
                    }).success,
                ).toBe(false);

                expect(
                    recordPaymentSchema.safeParse({
                        amount: -25.5,
                    }).success,
                ).toBe(false);
            });

            it("rejects payment amounts with more than 2 decimal places", () => {
                const res = recordPaymentSchema.safeParse({
                    amount: 50.125,
                });
                expect(res.success).toBe(false);
                if (!res.success) {
                    expect(res.error.issues[0].message).toContain(
                        "cannot have more than 2 decimal places",
                    );
                }
            });
        });

        describe("listInvoicesQuerySchema & listPaymentsQuerySchema", () => {
            it("coerces and validates query filters", () => {
                const res = listInvoicesQuerySchema.safeParse({
                    page: "2",
                    limit: "50",
                    status: "ISSUED",
                    overdueOnly: "true",
                });
                expect(res.success).toBe(true);
                if (res.success) {
                    expect(res.data.page).toBe(2);
                    expect(res.data.limit).toBe(50);
                    expect(res.data.overdueOnly).toBe(true);
                }
            });

            it("validates payment list query filters", () => {
                const res = listPaymentsQuerySchema.safeParse({
                    page: "1",
                    paymentMethod: "CHECK",
                    status: "RECORDED",
                });
                expect(res.success).toBe(true);
                if (res.success) {
                    expect(res.data.paymentMethod).toBe("CHECK");
                }
            });
        });
    });

    // ==========================================
    // 3. READ MODEL MAPPERS
    // ==========================================
    describe("3. Read Model Mappers", () => {
        it("maps line item to read model formatting Decimals and Dates to strings", () => {
            const rawItem = {
                id: "line_1",
                invoiceId: "inv_1",
                workspaceId: "ws_1",
                lineItemType: "LABOR",
                workTypeId: "wt_1",
                partId: null,
                name: "AC Repair",
                description: "Fixed cooling fan",
                workTypeName: "AC Labor",
                workTypeCode: "AC-01",
                partName: null,
                partSku: null,
                partUnitOfMeasure: null,
                quantity: 2,
                unitPrice: 100,
                unitCost: 40,
                discountAmount: 20,
                subtotal: 180,
                taxRate: 0.0825,
                taxAmount: 14.85,
                total: 194.85,
                sortOrder: 1,
                createdAt: new Date("2026-09-01T10:00:00.000Z"),
                updatedAt: new Date("2026-09-01T10:00:00.000Z"),
            };

            const readModel = mapInvoiceLineItemToReadModel(rawItem);
            expect(readModel.quantity).toBe("2.00");
            expect(readModel.unitPrice).toBe("100.00");
            expect(readModel.unitCost).toBe("40.00");
            expect(readModel.discountAmount).toBe("20.00");
            expect(readModel.subtotal).toBe("180.00");
            expect(readModel.taxRate).toBe("0.0825");
            expect(readModel.taxAmount).toBe("14.85");
            expect(readModel.total).toBe("194.85");
            expect(readModel.createdAt).toBe("2026-09-01T10:00:00.000Z");
        });

        it("maps payment to read model", () => {
            const rawPayment = {
                id: "pay_1",
                workspaceId: "ws_1",
                invoiceId: "inv_1",
                paymentNumber: "PAY-00001",
                customerId: "cust_1",
                amount: 194.85,
                currencyCode: "USD",
                paymentMethod: "CREDIT_CARD",
                referenceNumber: "TXN-9988",
                status: "RECORDED",
                paymentDate: new Date("2026-09-02T12:00:00.000Z"),
                notes: "Paid in full",
                recordedByMemberId: "mem_1",
                recordedByMember: { user: { name: "Alice Admin" } },
                voidedAt: null,
                voidedByMemberId: null,
                voidReason: null,
                createdAt: new Date("2026-09-02T12:00:00.000Z"),
                updatedAt: new Date("2026-09-02T12:00:00.000Z"),
            };

            const readModel = mapPaymentToReadModel(rawPayment);
            expect(readModel.amount).toBe("194.85");
            expect(readModel.recordedByMemberName).toBe("Alice Admin");
            expect(readModel.paymentNumber).toBe("PAY-00001");
        });

        it("maps invoice history to read model handling system events", () => {
            const systemHist = {
                id: "hist_1",
                invoiceId: "inv_1",
                workspaceId: "ws_1",
                eventType: "OVERDUE_MARKED",
                actorMemberId: null,
                actorName: null,
                field: "status",
                oldValue: "ISSUED",
                newValue: "OVERDUE",
                metadata: { system: true },
                createdAt: new Date("2026-09-05T00:00:00.000Z"),
            };

            const readModel = mapInvoiceHistoryToReadModel(systemHist);
            expect(readModel.actorName).toBe("System");
            expect(readModel.eventType).toBe("OVERDUE_MARKED");
        });

        it("maps full invoice entity with relations", () => {
            const rawInvoice = {
                id: "inv_1",
                workspaceId: "ws_1",
                invoiceNumber: "INV-00001",
                customerId: "cust_1",
                customer: {
                    id: "cust_1",
                    customerNumber: "C-001",
                    name: "Acme Corp",
                    email: "acme@example.com",
                    phone: "555-1234",
                },
                locationId: "loc_1",
                location: {
                    id: "loc_1",
                    name: "Headquarters",
                    addressLine1: "123 Main St",
                    addressLine2: null,
                    city: "Dallas",
                    state: "TX",
                    postalCode: "75001",
                    country: "USA",
                },
                quoteId: "quote_1",
                quote: {
                    id: "quote_1",
                    quoteNumber: "Q-00001",
                    title: "Initial Estimate",
                    total: 500,
                },
                workOrderId: "wo_1",
                workOrder: {
                    id: "wo_1",
                    workOrderNumber: "WO-00001",
                    title: "HVAC Job",
                    status: "COMPLETED",
                },
                status: "ISSUED",
                title: "HVAC Service Invoice",
                notes: "Thank you for your business",
                internalNotes: null,
                termsAndConditions: "Net 30",
                currencyCode: "USD",
                issueDate: new Date("2026-09-01T00:00:00.000Z"),
                dueDate: new Date("2026-09-30T00:00:00.000Z"),
                subtotal: 500,
                discountType: "PERCENTAGE",
                discountValue: 0,
                discountAmount: 0,
                taxRate: 0.08,
                taxAmount: 40,
                total: 540,
                amountPaid: 0,
                amountDue: 540,
                issuedAt: new Date("2026-09-01T00:00:00.000Z"),
                paidAt: null,
                voidedAt: null,
                voidReason: null,
                lineItems: [],
                payments: [],
                history: [],
                createdAt: new Date("2026-09-01T00:00:00.000Z"),
                updatedAt: new Date("2026-09-01T00:00:00.000Z"),
            };

            const readModel = mapInvoiceToReadModel(rawInvoice);
            expect(readModel.invoiceNumber).toBe("INV-00001");
            expect(readModel.customer?.name).toBe("Acme Corp");
            expect(readModel.quote?.quoteNumber).toBe("Q-00001");
            expect(readModel.workOrder?.workOrderNumber).toBe("WO-00001");
            expect(readModel.total).toBe("540.00");
            expect(readModel.amountDue).toBe("540.00");
            expect(readModel.amountPaid).toBe("0.00");
        });
    });

    // ==========================================
    // 4. CENTRAL API ERROR MAPPER
    // ==========================================
    describe("4. Central API Error Mapper (handleInvoiceApiError)", () => {
        const errorMappingCases = [
            {
                error: new InvoiceNotFoundError("Invoice not found."),
                expectedStatus: 404,
                expectedCode: "INVOICE_NOT_FOUND",
            },
            {
                error: new InvoiceLineItemNotFoundError("Line item not found."),
                expectedStatus: 404,
                expectedCode: "INVOICE_LINE_ITEM_NOT_FOUND",
            },
            {
                error: new PaymentNotFoundError("Payment not found."),
                expectedStatus: 404,
                expectedCode: "PAYMENT_NOT_FOUND",
            },
            {
                error: new CustomerNotFoundError("Customer not found."),
                expectedStatus: 404,
                expectedCode: "CUSTOMER_NOT_FOUND",
            },
            {
                error: new ServiceLocationNotFoundError("Location not found."),
                expectedStatus: 404,
                expectedCode: "SERVICE_LOCATION_NOT_FOUND",
            },
            {
                error: new QuoteNotFoundError("Quote not found."),
                expectedStatus: 404,
                expectedCode: "QUOTE_NOT_FOUND",
            },
            {
                error: new WorkOrderNotFoundError("Work order not found."),
                expectedStatus: 404,
                expectedCode: "WORK_ORDER_NOT_FOUND",
            },
            {
                error: new InvoiceStatusConflictError("Conflict."),
                expectedStatus: 409,
                expectedCode: "INVOICE_STATUS_CONFLICT",
            },
            {
                error: new InvoiceAlreadyPaidError("Already paid."),
                expectedStatus: 409,
                expectedCode: "INVOICE_ALREADY_PAID",
            },
            {
                error: new InvoiceAlreadyVoidedError("Already voided."),
                expectedStatus: 409,
                expectedCode: "INVOICE_ALREADY_VOIDED",
            },
            {
                error: new PaymentAlreadyVoidedError("Payment voided."),
                expectedStatus: 409,
                expectedCode: "PAYMENT_ALREADY_VOIDED",
            },
            {
                error: new InvoiceHasActivePaymentsError("Has payments."),
                expectedStatus: 409,
                expectedCode: "INVOICE_HAS_ACTIVE_PAYMENTS",
            },
            {
                error: new OverpaymentNotAllowedError("Overpayment."),
                expectedStatus: 422,
                expectedCode: "OVERPAYMENT_NOT_ALLOWED",
            },
            {
                error: new InvalidPaymentAmountError("Invalid amount."),
                expectedStatus: 422,
                expectedCode: "INVALID_PAYMENT_AMOUNT",
            },
            {
                error: new InvoiceEmptyLineItemsError("Empty lines."),
                expectedStatus: 422,
                expectedCode: "INVOICE_EMPTY_LINE_ITEMS",
            },
            {
                error: new InvalidInvoiceCalculationError("Invalid math."),
                expectedStatus: 422,
                expectedCode: "INVALID_INVOICE_CALCULATION",
            },
            {
                error: new SourceEntityNotEligibleError("Not eligible."),
                expectedStatus: 422,
                expectedCode: "SOURCE_ENTITY_NOT_ELIGIBLE",
            },
            {
                error: new MissingVoidReasonError("Missing reason."),
                expectedStatus: 422,
                expectedCode: "MISSING_VOID_REASON",
            },
            {
                error: new InvoiceDueDateInvalidError("Invalid due date."),
                expectedStatus: 422,
                expectedCode: "INVOICE_DUE_DATE_INVALID",
            },
        ];

        it.each(errorMappingCases)(
            "maps $error.constructor.name to HTTP $expectedStatus and code $expectedCode",
            async ({ error, expectedStatus, expectedCode }) => {
                const res = handleInvoiceApiError(error);
                expect(res.status).toBe(expectedStatus);

                const data = await res.json();
                expect(data.success).toBe(false);
                expect(data.error.code).toBe(expectedCode);
            },
        );

        it("maps Zod validation error to 422 VALIDATION_ERROR with field details", async () => {
            const schema = z.object({ title: z.string().min(5) });
            const parseRes = schema.safeParse({ title: "abc" });
            expect(parseRes.success).toBe(false);

            if (!parseRes.success) {
                const res = handleInvoiceApiError(parseRes.error);
                expect(res.status).toBe(422);

                const data = await res.json();
                expect(data.success).toBe(false);
                expect(data.error.code).toBe("VALIDATION_ERROR");
                expect(data.error.fields).toBeDefined();
            }
        });

        it("maps malformed JSON SyntaxError to 400 MALFORMED_JSON", async () => {
            const syntaxErr = new SyntaxError("Unexpected token in JSON");
            (syntaxErr as any).body = "{ malformed";

            const res = handleInvoiceApiError(syntaxErr);
            expect(res.status).toBe(400);

            const data = await res.json();
            expect(data.success).toBe(false);
            expect(data.error.code).toBe("MALFORMED_JSON");
        });

        it("sanitizes unexpected runtime errors to 500 INTERNAL_SERVER_ERROR", async () => {
            const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
            const res = handleInvoiceApiError(
                new Error("Database connection timeout"),
                "TEST_ROUTE",
            );
            expect(res.status).toBe(500);

            const data = await res.json();
            expect(data.success).toBe(false);
            expect(data.error.code).toBe("INTERNAL_SERVER_ERROR");
            expect(data.error.message).not.toContain("Database connection timeout");
            consoleSpy.mockRestore();
        });
    });
});
