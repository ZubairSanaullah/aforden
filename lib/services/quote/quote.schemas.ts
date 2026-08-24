/**
 * Phase 1.11.3 — Quotes & Estimates Zod Validation Schemas
 * Pure domain schemas with strict boundary validation and calculation guards.
 */

import { z } from "zod";

// ==========================================
// ENUMS & CONSTANTS
// ==========================================

export const QUOTE_STATUSES = [
    "DRAFT",
    "PENDING_APPROVAL",
    "APPROVED",
    "REJECTED",
    "EXPIRED",
    "CONVERTED",
] as const;

export const QUOTE_LINE_ITEM_TYPES = [
    "LABOR",
    "PART",
    "EXPENSE",
    "CUSTOM",
] as const;

export const QUOTE_DISCOUNT_TYPES = [
    "PERCENTAGE",
    "FIXED",
] as const;

export const quoteStatusSchema = z.enum(QUOTE_STATUSES, {
    error: `Status must be one of: ${QUOTE_STATUSES.join(", ")}.`,
});

export const quoteLineItemTypeSchema = z.enum(QUOTE_LINE_ITEM_TYPES, {
    error: `Line item type must be one of: ${QUOTE_LINE_ITEM_TYPES.join(", ")}.`,
});

export const quoteDiscountTypeSchema = z.enum(QUOTE_DISCOUNT_TYPES, {
    error: `Discount type must be one of: ${QUOTE_DISCOUNT_TYPES.join(", ")}.`,
});

// ==========================================
// QUOTE HEADER SCHEMAS
// ==========================================

export const createQuoteSchema = z.object({
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

    title: z
        .string()
        .trim()
        .min(1, "Quote title must not be empty.")
        .max(200, "Quote title cannot exceed 200 characters."),

    description: z
        .string()
        .trim()
        .max(4000, "Description cannot exceed 4000 characters.")
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
        .max(8000, "Terms and conditions cannot exceed 8000 characters.")
        .nullable()
        .optional(),

    currencyCode: z
        .string()
        .trim()
        .length(3, "Currency code must be an ISO 3-letter code (e.g. USD, PKR).")
        .toUpperCase()
        .optional(),

    validUntil: z
        .coerce
        .date()
        .nullable()
        .optional(),

    discountType: quoteDiscountTypeSchema.default("PERCENTAGE").optional(),

    discountValue: z
        .coerce
        .number()
        .min(0, "Discount value must be greater than or equal to 0.")
        .default(0)
        .optional(),

    taxRate: z
        .coerce
        .number()
        .min(0, "Tax rate must be greater than or equal to 0.")
        .max(1.0, "Tax rate cannot exceed 1.0 (100%).")
        .default(0)
        .optional(),
});

export type CreateQuoteInputSchemaType = z.infer<typeof createQuoteSchema>;

export const updateQuoteSchema = z.object({
    customerId: z
        .string()
        .trim()
        .min(1, "Customer ID must not be empty.")
        .optional(),

    locationId: z
        .string()
        .trim()
        .min(1, "Location ID must not be empty.")
        .nullable()
        .optional(),

    title: z
        .string()
        .trim()
        .min(1, "Quote title must not be empty.")
        .max(200, "Quote title cannot exceed 200 characters.")
        .optional(),

    description: z
        .string()
        .trim()
        .max(4000, "Description cannot exceed 4000 characters.")
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
        .max(8000, "Terms and conditions cannot exceed 8000 characters.")
        .nullable()
        .optional(),

    validUntil: z
        .coerce
        .date()
        .nullable()
        .optional(),

    discountType: quoteDiscountTypeSchema.optional(),

    discountValue: z
        .coerce
        .number()
        .min(0, "Discount value must be greater than or equal to 0.")
        .optional(),

    taxRate: z
        .coerce
        .number()
        .min(0, "Tax rate must be greater than or equal to 0.")
        .max(1.0, "Tax rate cannot exceed 1.0 (100%).")
        .optional(),
});

export type UpdateQuoteInputSchemaType = z.infer<typeof updateQuoteSchema>;

// ==========================================
// QUOTE LINE ITEM SCHEMAS
// ==========================================

export const createQuoteLineItemSchema = z
    .object({
        lineItemType: quoteLineItemTypeSchema.default("CUSTOM").optional(),

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
            .min(1, "Line item name must not be empty.")
            .max(200, "Line item name cannot exceed 200 characters."),

        description: z
            .string()
            .trim()
            .max(4000, "Description cannot exceed 4000 characters.")
            .nullable()
            .optional(),

        quantity: z
            .coerce
            .number()
            .min(0.01, "Quantity must be at least 0.01."),

        unitPrice: z
            .coerce
            .number()
            .min(0, "Unit price must be greater than or equal to 0."),

        unitCost: z
            .coerce
            .number()
            .min(0, "Unit cost must be greater than or equal to 0.")
            .nullable()
            .optional(),

        discountAmount: z
            .coerce
            .number()
            .min(0, "Discount amount must be greater than or equal to 0.")
            .default(0)
            .optional(),

        taxRate: z
            .coerce
            .number()
            .min(0, "Tax rate must be greater than or equal to 0.")
            .max(1.0, "Tax rate cannot exceed 1.0 (100%).")
            .default(0)
            .optional(),

        sortOrder: z
            .number()
            .int("Sort order must be an integer.")
            .min(0, "Sort order cannot be negative.")
            .default(0)
            .optional(),
    })
    .refine(
        (data) => {
            const qty = Number(data.quantity);
            const price = Number(data.unitPrice);
            const discount = Number(data.discountAmount ?? 0);
            return (qty * price) - discount >= 0;
        },
        {
            message:
                "Invalid quote calculation: line item subtotal ((quantity × unitPrice) − discountAmount) cannot be negative.",
            path: ["discountAmount"],
        },
    );

export type CreateQuoteLineItemInputSchemaType = z.infer<
    typeof createQuoteLineItemSchema
>;

export const updateQuoteLineItemSchema = z
    .object({
        lineItemType: quoteLineItemTypeSchema.optional(),

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
            .min(1, "Line item name must not be empty.")
            .max(200, "Line item name cannot exceed 200 characters.")
            .optional(),

        description: z
            .string()
            .trim()
            .max(4000, "Description cannot exceed 4000 characters.")
            .nullable()
            .optional(),

        quantity: z
            .coerce
            .number()
            .min(0.01, "Quantity must be at least 0.01.")
            .optional(),

        unitPrice: z
            .coerce
            .number()
            .min(0, "Unit price must be greater than or equal to 0.")
            .optional(),

        unitCost: z
            .coerce
            .number()
            .min(0, "Unit cost must be greater than or equal to 0.")
            .nullable()
            .optional(),

        discountAmount: z
            .coerce
            .number()
            .min(0, "Discount amount must be greater than or equal to 0.")
            .optional(),

        taxRate: z
            .coerce
            .number()
            .min(0, "Tax rate must be greater than or equal to 0.")
            .max(1.0, "Tax rate cannot exceed 1.0 (100%).")
            .optional(),

        sortOrder: z
            .number()
            .int("Sort order must be an integer.")
            .min(0, "Sort order cannot be negative.")
            .optional(),
    })
    .refine(
        (data) => {
            if (
                data.quantity !== undefined &&
                data.unitPrice !== undefined &&
                data.discountAmount !== undefined
            ) {
                const qty = Number(data.quantity);
                const price = Number(data.unitPrice);
                const discount = Number(data.discountAmount);
                return (qty * price) - discount >= 0;
            }
            return true;
        },
        {
            message:
                "Invalid quote calculation: line item subtotal ((quantity × unitPrice) − discountAmount) cannot be negative.",
            path: ["discountAmount"],
        },
    );

export type UpdateQuoteLineItemInputSchemaType = z.infer<
    typeof updateQuoteLineItemSchema
>;

// ==========================================
// LIFECYCLE TRANSITION SCHEMAS
// ==========================================

export const sendQuoteSchema = z.object({
    notes: z
        .string()
        .trim()
        .max(2000, "Notes cannot exceed 2000 characters.")
        .optional(),
});

export type SendQuoteInputSchemaType = z.infer<typeof sendQuoteSchema>;

export const approveQuoteSchema = z.object({
    approvedByCustomerName: z
        .string()
        .trim()
        .min(1, "Approver name must not be empty.")
        .max(200, "Approver name cannot exceed 200 characters.")
        .nullable()
        .optional(),

    notes: z
        .string()
        .trim()
        .max(2000, "Notes cannot exceed 2000 characters.")
        .nullable()
        .optional(),
});

export type ApproveQuoteInputSchemaType = z.infer<typeof approveQuoteSchema>;

export const rejectQuoteSchema = z.object({
    rejectionReason: z
        .string()
        .trim()
        .min(1, "Rejection reason is required when rejecting a quote.")
        .max(2000, "Rejection reason cannot exceed 2000 characters."),
});

export type RejectQuoteInputSchemaType = z.infer<typeof rejectQuoteSchema>;

export const convertQuoteSchema = z.object({
    workTypeId: z
        .string()
        .trim()
        .min(1, "Work type ID must not be empty.")
        .optional(),

    assignedTechnicianId: z
        .string()
        .trim()
        .min(1, "Technician ID must not be empty.")
        .nullable()
        .optional(),

    title: z
        .string()
        .trim()
        .min(1, "Title must not be empty.")
        .max(200, "Title cannot exceed 200 characters.")
        .optional(),

    description: z
        .string()
        .trim()
        .max(4000, "Description cannot exceed 4000 characters.")
        .nullable()
        .optional(),
});

export type ConvertQuoteInputSchemaType = z.infer<typeof convertQuoteSchema>;

// ==========================================
// QUERY / FILTERING SCHEMA
// ==========================================

export const listQuotesQuerySchema = z.object({
    status: z
        .union([
            quoteStatusSchema,
            z.array(quoteStatusSchema),
            z.string().transform((val) => {
                const parts = val.split(",").map((s) => s.trim().toUpperCase());
                return parts.length === 1 ? parts[0] : parts;
            }),
        ])
        .optional(),

    customerId: z.string().trim().optional(),
    locationId: z.string().trim().optional(),
    search: z.string().trim().optional(),

    validUntilFrom: z.coerce.date().optional(),
    validUntilTo: z.coerce.date().optional(),
    createdFrom: z.coerce.date().optional(),
    createdTo: z.coerce.date().optional(),

    minTotal: z.coerce.number().min(0).optional(),
    maxTotal: z.coerce.number().min(0).optional(),

    sortBy: z
        .enum([
            "createdAt",
            "updatedAt",
            "quoteNumber",
            "total",
            "validUntil",
            "status",
        ])
        .default("createdAt")
        .optional(),

    sortOrder: z.enum(["asc", "desc"]).default("desc").optional(),

    page: z.coerce.number().int().min(1).default(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20).optional(),
});

export type ListQuotesQueryInputSchemaType = z.infer<
    typeof listQuotesQuerySchema
>;
