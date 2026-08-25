/**
 * Phase 1.12.3 — Invoicing & Payments Zod Validation Schemas
 * Pure domain schemas with strict boundary validation, due date comparisons, and calculation guards.
 */

import { z } from "zod";

// ==========================================
// ENUMS & CONSTANTS
// ==========================================

export const INVOICE_STATUSES = [
    "DRAFT",
    "ISSUED",
    "PARTIALLY_PAID",
    "PAID",
    "OVERDUE",
    "VOID",
] as const;

export const INVOICE_LINE_ITEM_TYPES = [
    "LABOR",
    "PART",
    "EXPENSE",
    "CUSTOM",
] as const;

export const INVOICE_DISCOUNT_TYPES = [
    "PERCENTAGE",
    "FIXED",
] as const;

export const PAYMENT_METHODS = [
    "CASH",
    "CHECK",
    "CREDIT_CARD",
    "BANK_TRANSFER",
    "ACH",
    "OTHER",
] as const;

export const PAYMENT_STATUSES = [
    "RECORDED",
    "VOIDED",
] as const;

export const INVOICE_HISTORY_EVENT_TYPES = [
    "CREATED",
    "UPDATED",
    "LINE_ITEM_ADDED",
    "LINE_ITEM_UPDATED",
    "LINE_ITEM_REMOVED",
    "ISSUED",
    "PAYMENT_APPLIED",
    "PAYMENT_VOIDED",
    "OVERDUE_MARKED",
    "VOIDED",
    "DELETED",
] as const;

export const invoiceStatusSchema = z.enum(INVOICE_STATUSES, {
    error: `Status must be one of: ${INVOICE_STATUSES.join(", ")}.`,
});

export const invoiceLineItemTypeSchema = z.enum(INVOICE_LINE_ITEM_TYPES, {
    error: `Line item type must be one of: ${INVOICE_LINE_ITEM_TYPES.join(", ")}.`,
});

export const invoiceDiscountTypeSchema = z.enum(INVOICE_DISCOUNT_TYPES, {
    error: `Discount type must be one of: ${INVOICE_DISCOUNT_TYPES.join(", ")}.`,
});

export const paymentMethodSchema = z.enum(PAYMENT_METHODS, {
    error: `Payment method must be one of: ${PAYMENT_METHODS.join(", ")}.`,
});

export const paymentStatusSchema = z.enum(PAYMENT_STATUSES, {
    error: `Payment status must be one of: ${PAYMENT_STATUSES.join(", ")}.`,
});

export const invoiceHistoryEventTypeSchema = z.enum(INVOICE_HISTORY_EVENT_TYPES, {
    error: `History event type must be one of: ${INVOICE_HISTORY_EVENT_TYPES.join(", ")}.`,
});

// ==========================================
// DATE HELPER UTILITIES FOR VALIDATION
// ==========================================

function parseDateValue(val: unknown): Date | null {
    if (!val) return null;
    if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
    if (typeof val === "string" || typeof val === "number") {
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : d;
    }
    return null;
}

// ==========================================
// LINE ITEM SCHEMAS (WITH STEP 1 CALCULATION GUARD)
// ==========================================

export const createInvoiceLineItemSchema = z
    .object({
        lineItemType: invoiceLineItemTypeSchema.default("CUSTOM"),

        workTypeId: z
            .string()
            .trim()
            .min(1, "Work type ID must not be empty.")
            .nullable()
            .optional(),

        partId: z
            .string()
            .trim()
            .min(1, "Part ID must not be empty.")
            .nullable()
            .optional(),

        name: z
            .string()
            .trim()
            .min(1, "Item name must not be empty.")
            .max(200, "Item name cannot exceed 200 characters.")
            .optional(),

        description: z
            .string()
            .trim()
            .max(2000, "Description cannot exceed 2000 characters.")
            .nullable()
            .optional(),

        quantity: z
            .number({ error: "Quantity must be a number." })
            .positive("Quantity must be greater than zero.")
            .max(999999.99, "Quantity exceeds maximum allowable limit.")
            .default(1),

        unitPrice: z
            .number({ error: "Unit price must be a number." })
            .min(0, "Unit price cannot be negative.")
            .max(99999999.99, "Unit price exceeds maximum allowable limit.")
            .default(0),

        unitCost: z
            .number({ error: "Unit cost must be a number." })
            .min(0, "Unit cost cannot be negative.")
            .max(99999999.99, "Unit cost exceeds maximum allowable limit.")
            .nullable()
            .optional(),

        discountAmount: z
            .number({ error: "Discount amount must be a number." })
            .min(0, "Discount amount cannot be negative.")
            .max(99999999.99, "Discount amount exceeds maximum allowable limit.")
            .default(0),

        taxRate: z
            .number({ error: "Tax rate must be a number." })
            .min(0, "Tax rate cannot be negative.")
            .max(1, "Tax rate must be between 0.0000 and 1.0000 (e.g., 0.0825 for 8.25%).")
            .default(0),

        sortOrder: z
            .number({ error: "Sort order must be an integer." })
            .int("Sort order must be an integer.")
            .min(0, "Sort order cannot be negative.")
            .optional(),
    })
    .refine(
        (data) => {
            const qty = data.quantity ?? 1;
            const price = data.unitPrice ?? 0;
            const disc = data.discountAmount ?? 0;
            const subtotal = qty * price - disc;
            return subtotal >= 0;
        },
        {
            message:
                "Invalid invoice calculation: line item subtotal ((quantity × unitPrice) − discountAmount) cannot be negative.",
            path: ["discountAmount"],
        },
    );

export const updateInvoiceLineItemSchema = z
    .object({
        lineItemType: invoiceLineItemTypeSchema.optional(),

        workTypeId: z
            .string()
            .trim()
            .min(1, "Work type ID must not be empty.")
            .nullable()
            .optional(),

        partId: z
            .string()
            .trim()
            .min(1, "Part ID must not be empty.")
            .nullable()
            .optional(),

        name: z
            .string()
            .trim()
            .min(1, "Item name must not be empty.")
            .max(200, "Item name cannot exceed 200 characters.")
            .optional(),

        description: z
            .string()
            .trim()
            .max(2000, "Description cannot exceed 2000 characters.")
            .nullable()
            .optional(),

        quantity: z
            .number({ error: "Quantity must be a number." })
            .positive("Quantity must be greater than zero.")
            .max(999999.99, "Quantity exceeds maximum allowable limit.")
            .optional(),

        unitPrice: z
            .number({ error: "Unit price must be a number." })
            .min(0, "Unit price cannot be negative.")
            .max(99999999.99, "Unit price exceeds maximum allowable limit.")
            .optional(),

        unitCost: z
            .number({ error: "Unit cost must be a number." })
            .min(0, "Unit cost cannot be negative.")
            .max(99999999.99, "Unit cost exceeds maximum allowable limit.")
            .nullable()
            .optional(),

        discountAmount: z
            .number({ error: "Discount amount must be a number." })
            .min(0, "Discount amount cannot be negative.")
            .max(99999999.99, "Discount amount exceeds maximum allowable limit.")
            .optional(),

        taxRate: z
            .number({ error: "Tax rate must be a number." })
            .min(0, "Tax rate cannot be negative.")
            .max(1, "Tax rate must be between 0.0000 and 1.0000.")
            .optional(),

        sortOrder: z
            .number({ error: "Sort order must be an integer." })
            .int("Sort order must be an integer.")
            .min(0, "Sort order cannot be negative.")
            .optional(),
    })
    .refine(
        (data) => {
            if (
                data.quantity !== undefined ||
                data.unitPrice !== undefined ||
                data.discountAmount !== undefined
            ) {
                const qty = data.quantity ?? 1;
                const price = data.unitPrice ?? 0;
                const disc = data.discountAmount ?? 0;
                if (data.quantity !== undefined && data.unitPrice !== undefined && data.discountAmount !== undefined) {
                    return qty * price - disc >= 0;
                }
            }
            return true;
        },
        {
            message:
                "Invalid invoice calculation: line item subtotal ((quantity × unitPrice) − discountAmount) cannot be negative.",
            path: ["discountAmount"],
        },
    );

export const invoiceLineItemInputSchema = createInvoiceLineItemSchema;

export const reorderInvoiceLineItemsSchema = z.object({
    lineItemIds: z
        .array(z.string().trim().min(1, "Line item ID must not be empty."))
        .min(1, "Must provide at least one line item ID to reorder."),
});

// ==========================================
// INVOICE HEADER SCHEMAS
// ==========================================

export const createInvoiceSchema = z
    .object({
        customerId: z
            .string()
            .trim()
            .min(1, "Customer ID must not be empty."),

        locationId: z
            .string()
            .trim()
            .min(1, "Location ID must not be empty.")
            .nullable()
            .optional(),

        quoteId: z
            .string()
            .trim()
            .min(1, "Quote ID must not be empty.")
            .nullable()
            .optional(),

        workOrderId: z
            .string()
            .trim()
            .min(1, "Work order ID must not be empty.")
            .nullable()
            .optional(),

        title: z
            .string()
            .trim()
            .min(1, "Invoice title must not be empty.")
            .max(200, "Invoice title cannot exceed 200 characters."),

        notes: z
            .string()
            .trim()
            .max(4000, "Customer notes cannot exceed 4000 characters.")
            .nullable()
            .optional(),

        internalNotes: z
            .string()
            .trim()
            .max(4000, "Internal notes cannot exceed 4000 characters.")
            .nullable()
            .optional(),

        termsAndConditions: z
            .string()
            .trim()
            .max(4000, "Terms and conditions cannot exceed 4000 characters.")
            .nullable()
            .optional(),

        currencyCode: z
            .string()
            .trim()
            .length(3, "Currency code must be exactly 3 ISO characters.")
            .toUpperCase()
            .optional(),

        issueDate: z
            .union([z.string(), z.date()])
            .optional(),

        dueDate: z
            .union([z.string(), z.date()], {
                error: "Due date is required.",
            }),

        discountType: invoiceDiscountTypeSchema.default("PERCENTAGE"),

        discountValue: z
            .number({ error: "Discount value must be a number." })
            .min(0, "Discount value cannot be negative.")
            .default(0),

        taxRate: z
            .number({ error: "Tax rate must be a number." })
            .min(0, "Tax rate cannot be negative.")
            .max(1, "Tax rate must be between 0.0000 and 1.0000.")
            .default(0),

        lineItems: z
            .array(createInvoiceLineItemSchema)
            .optional(),
    })
    .refine(
        (data) => {
            const issueD = data.issueDate ? parseDateValue(data.issueDate) : new Date();
            const dueD = parseDateValue(data.dueDate);
            if (issueD && dueD) {
                // Normalize to midnight UTC/local for pure date comparison
                const issueDateMidnight = new Date(issueD.getFullYear(), issueD.getMonth(), issueD.getDate()).getTime();
                const dueDateMidnight = new Date(dueD.getFullYear(), dueD.getMonth(), dueD.getDate()).getTime();
                return dueDateMidnight >= issueDateMidnight;
            }
            return true;
        },
        {
            message: "Invoice due date must be on or after the issue date.",
            path: ["dueDate"],
        },
    );

export const createInvoiceFromQuoteSchema = z
    .object({
        quoteId: z
            .string()
            .trim()
            .min(1, "Quote ID must not be empty.")
            .optional(),

        title: z
            .string()
            .trim()
            .min(1, "Invoice title must not be empty.")
            .max(200, "Invoice title cannot exceed 200 characters.")
            .optional(),

        issueDate: z
            .union([z.string(), z.date()])
            .optional(),

        dueDate: z
            .union([z.string(), z.date()], {
                error: "Due date is required.",
            }),

        notes: z
            .string()
            .trim()
            .max(4000, "Notes cannot exceed 4000 characters.")
            .nullable()
            .optional(),

        internalNotes: z
            .string()
            .trim()
            .max(4000, "Internal notes cannot exceed 4000 characters.")
            .nullable()
            .optional(),

        termsAndConditions: z
            .string()
            .trim()
            .max(4000, "Terms and conditions cannot exceed 4000 characters.")
            .nullable()
            .optional(),
    })
    .refine(
        (data) => {
            const issueD = data.issueDate ? parseDateValue(data.issueDate) : new Date();
            const dueD = parseDateValue(data.dueDate);
            if (issueD && dueD) {
                const issueDateMidnight = new Date(issueD.getFullYear(), issueD.getMonth(), issueD.getDate()).getTime();
                const dueDateMidnight = new Date(dueD.getFullYear(), dueD.getMonth(), dueD.getDate()).getTime();
                return dueDateMidnight >= issueDateMidnight;
            }
            return true;
        },
        {
            message: "Invoice due date must be on or after the issue date.",
            path: ["dueDate"],
        },
    );

export const createInvoiceFromWorkOrderSchema = z
    .object({
        workOrderId: z
            .string()
            .trim()
            .min(1, "Work order ID must not be empty.")
            .optional(),

        title: z
            .string()
            .trim()
            .min(1, "Invoice title must not be empty.")
            .max(200, "Invoice title cannot exceed 200 characters.")
            .optional(),

        issueDate: z
            .union([z.string(), z.date()])
            .optional(),

        dueDate: z
            .union([z.string(), z.date()], {
                error: "Due date is required.",
            }),

        notes: z
            .string()
            .trim()
            .max(4000, "Notes cannot exceed 4000 characters.")
            .nullable()
            .optional(),

        internalNotes: z
            .string()
            .trim()
            .max(4000, "Internal notes cannot exceed 4000 characters.")
            .nullable()
            .optional(),

        termsAndConditions: z
            .string()
            .trim()
            .max(4000, "Terms and conditions cannot exceed 4000 characters.")
            .nullable()
            .optional(),
    })
    .refine(
        (data) => {
            const issueD = data.issueDate ? parseDateValue(data.issueDate) : new Date();
            const dueD = parseDateValue(data.dueDate);
            if (issueD && dueD) {
                const issueDateMidnight = new Date(issueD.getFullYear(), issueD.getMonth(), issueD.getDate()).getTime();
                const dueDateMidnight = new Date(dueD.getFullYear(), dueD.getMonth(), dueD.getDate()).getTime();
                return dueDateMidnight >= issueDateMidnight;
            }
            return true;
        },
        {
            message: "Invoice due date must be on or after the issue date.",
            path: ["dueDate"],
        },
    );

export const updateInvoiceSchema = z
    .object({
        title: z
            .string()
            .trim()
            .min(1, "Invoice title must not be empty.")
            .max(200, "Invoice title cannot exceed 200 characters.")
            .optional(),

        notes: z
            .string()
            .trim()
            .max(4000, "Notes cannot exceed 4000 characters.")
            .nullable()
            .optional(),

        internalNotes: z
            .string()
            .trim()
            .max(4000, "Internal notes cannot exceed 4000 characters.")
            .nullable()
            .optional(),

        termsAndConditions: z
            .string()
            .trim()
            .max(4000, "Terms and conditions cannot exceed 4000 characters.")
            .nullable()
            .optional(),

        issueDate: z
            .union([z.string(), z.date()])
            .optional(),

        dueDate: z
            .union([z.string(), z.date()])
            .optional(),

        discountType: invoiceDiscountTypeSchema.optional(),

        discountValue: z
            .number({ error: "Discount value must be a number." })
            .min(0, "Discount value cannot be negative.")
            .optional(),

        taxRate: z
            .number({ error: "Tax rate must be a number." })
            .min(0, "Tax rate cannot be negative.")
            .max(1, "Tax rate must be between 0.0000 and 1.0000.")
            .optional(),
    })
    .refine(
        (data) => {
            if (data.dueDate && data.issueDate) {
                const issueD = parseDateValue(data.issueDate);
                const dueD = parseDateValue(data.dueDate);
                if (issueD && dueD) {
                    const issueDateMidnight = new Date(issueD.getFullYear(), issueD.getMonth(), issueD.getDate()).getTime();
                    const dueDateMidnight = new Date(dueD.getFullYear(), dueD.getMonth(), dueD.getDate()).getTime();
                    return dueDateMidnight >= issueDateMidnight;
                }
            }
            return true;
        },
        {
            message: "Invoice due date must be on or after the issue date.",
            path: ["dueDate"],
        },
    );

// ==========================================
// LIFECYCLE SCHEMAS
// ==========================================

export const issueInvoiceSchema = z
    .object({
        notes: z.string().trim().max(4000).optional(),
    })
    .optional();

export const voidInvoiceSchema = z.object({
    voidReason: z
        .string({ error: "Void reason is required." })
        .trim()
        .min(1, "Void reason is required and cannot be empty.")
        .max(2000, "Void reason cannot exceed 2000 characters."),
});

// ==========================================
// PAYMENT SCHEMAS
// ==========================================

export const recordPaymentSchema = z.object({
    amount: z
        .number({ error: "Payment amount must be a number." })
        .positive("Payment amount must be greater than zero.")
        .max(99999999.99, "Payment amount exceeds allowable limit.")
        .refine(
            (val) => {
                const parts = val.toString().split(".");
                return parts.length === 1 || parts[1].length <= 2;
            },
            {
                message: "Payment amount cannot have more than 2 decimal places.",
            },
        ),

    paymentMethod: paymentMethodSchema.default("CHECK"),

    referenceNumber: z
        .string()
        .trim()
        .max(100, "Reference number cannot exceed 100 characters.")
        .nullable()
        .optional(),

    paymentDate: z
        .union([z.string(), z.date()])
        .optional(),

    notes: z
        .string()
        .trim()
        .max(2000, "Payment notes cannot exceed 2000 characters.")
        .nullable()
        .optional(),
});

export const voidPaymentSchema = z.object({
    voidReason: z
        .string({ error: "Void reason is required." })
        .trim()
        .min(1, "Void reason is required and cannot be empty.")
        .max(2000, "Void reason cannot exceed 2000 characters."),
});

// ==========================================
// QUERY / FILTER SCHEMAS
// ==========================================

export const listInvoicesQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.union([invoiceStatusSchema, z.array(invoiceStatusSchema)]).optional(),
    customerId: z.string().trim().optional(),
    locationId: z.string().trim().optional(),
    quoteId: z.string().trim().optional(),
    workOrderId: z.string().trim().optional(),
    search: z.string().trim().optional(),
    overdueOnly: z
        .union([z.boolean(), z.string()])
        .transform((v) => (typeof v === "string" ? v === "true" : v))
        .optional(),
    isOverdue: z
        .union([z.boolean(), z.string()])
        .transform((v) => (typeof v === "string" ? v === "true" : v))
        .optional(),
    fromDate: z.string().trim().optional(),
    toDate: z.string().trim().optional(),
    issueDateFrom: z.string().trim().optional(),
    issueDateTo: z.string().trim().optional(),
    dueDateFrom: z.string().trim().optional(),
    dueDateTo: z.string().trim().optional(),
    createdFrom: z.string().trim().optional(),
    createdTo: z.string().trim().optional(),
    minTotal: z.coerce.number().min(0).optional(),
    maxTotal: z.coerce.number().min(0).optional(),
    minAmountDue: z.coerce.number().min(0).optional(),
    maxAmountDue: z.coerce.number().min(0).optional(),
    sortBy: z
        .enum([
            "createdAt",
            "updatedAt",
            "invoiceNumber",
            "issueDate",
            "dueDate",
            "total",
            "amountPaid",
            "amountDue",
            "status",
        ])
        .default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const listPaymentsQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    invoiceId: z.string().trim().optional(),
    customerId: z.string().trim().optional(),
    status: paymentStatusSchema.optional(),
    paymentMethod: paymentMethodSchema.optional(),
    fromDate: z.string().trim().optional(),
    toDate: z.string().trim().optional(),
    paymentDateFrom: z.string().trim().optional(),
    paymentDateTo: z.string().trim().optional(),
    startDate: z.string().trim().optional(),
    endDate: z.string().trim().optional(),
    minAmount: z.coerce.number().min(0).optional(),
    maxAmount: z.coerce.number().min(0).optional(),
    search: z.string().trim().optional(),
    sortBy: z.enum(["createdAt", "paymentDate", "paymentNumber", "amount", "status"]).default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

export const getInvoiceHistoryQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    eventType: z
        .union([
            invoiceHistoryEventTypeSchema,
            z.array(invoiceHistoryEventTypeSchema),
        ])
        .optional(),
    sortOrder: z.enum(["asc", "desc"]).default("asc"),
});

export const listInvoiceHistoryEventsQuerySchema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    invoiceId: z.string().trim().optional(),
    eventType: z
        .union([
            invoiceHistoryEventTypeSchema,
            z.array(invoiceHistoryEventTypeSchema),
        ])
        .optional(),
    actorMemberId: z.string().trim().optional(),
    fromDate: z.string().trim().optional(),
    toDate: z.string().trim().optional(),
    createdFrom: z.string().trim().optional(),
    createdTo: z.string().trim().optional(),
    sortBy: z.enum(["createdAt"]).default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
});

// Type inferences
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
export type CreateInvoiceFromQuoteInput = z.infer<typeof createInvoiceFromQuoteSchema>;
export type CreateInvoiceFromWorkOrderInput = z.infer<typeof createInvoiceFromWorkOrderSchema>;
export type UpdateInvoiceInput = z.infer<typeof updateInvoiceSchema>;
export type CreateInvoiceLineItemInput = z.infer<typeof createInvoiceLineItemSchema>;
export type UpdateInvoiceLineItemInput = z.infer<typeof updateInvoiceLineItemSchema>;
export type InvoiceLineItemInput = z.infer<typeof invoiceLineItemInputSchema>;
export type ReorderInvoiceLineItemsInput = z.infer<typeof reorderInvoiceLineItemsSchema>;
export type VoidInvoiceInput = z.infer<typeof voidInvoiceSchema>;
export type RecordPaymentInput = z.infer<typeof recordPaymentSchema>;
export type VoidPaymentInput = z.infer<typeof voidPaymentSchema>;
export type ListInvoicesQuery = z.infer<typeof listInvoicesQuerySchema>;
export type ListPaymentsQuery = z.infer<typeof listPaymentsQuerySchema>;
export type GetInvoiceHistoryQuery = z.infer<typeof getInvoiceHistoryQuerySchema>;
export type ListInvoiceHistoryEventsQuery = z.infer<typeof listInvoiceHistoryEventsQuerySchema>;
