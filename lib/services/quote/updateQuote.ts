/**
 * Phase 1.11.5 — Quote Header Update Service
 * Implements the locked execution pipeline and lifecycle mutability guards:
 * AUTHENTICATION → PERMISSION → VALIDATION → RESOLUTION → BUSINESS LOGIC → PERSISTENCE
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { updateQuoteSchema } from "./quote.schemas";
import {
    QuoteNotFoundError,
    QuoteStatusConflictError,
} from "./quoteErrors";
import {
    CustomerNotFoundError,
    ServiceLocationNotFoundError,
} from "@/lib/services/customer/customerErrors";
import { calculateQuoteTotals } from "./quoteCalculationEngine";
import { mapQuoteToReadModel } from "./quoteMappers";
import type { QuoteReadModel } from "./quote.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import { Prisma } from "@/generated/prisma/client";

/**
 * Updates a Quote's header fields within an authorized workspace.
 * Strictly restricted to DRAFT status.
 */
export async function updateQuote(
    workspaceId: string,
    quoteId: string,
    input: unknown,
    actor?: WorkspaceAuthorizationContext,
): Promise<QuoteReadModel> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert quotes.update
    assertPermission(authContext.membership.role, PERMISSIONS.QUOTES_UPDATE);

    // 3. VALIDATION
    const data = updateQuoteSchema.parse(input);

    // 4. RESOLUTION & INVARIANTS
    const existing = await prisma.quote.findFirst({
        where: {
            id: quoteId,
            workspaceId,
        },
        include: {
            lineItems: {
                orderBy: { sortOrder: "asc" },
            },
        },
    });

    if (!existing) {
        throw new QuoteNotFoundError();
    }

    // Lifecycle Mutability Guard: Only DRAFT status permits edits
    if (existing.status !== "DRAFT") {
        throw new QuoteStatusConflictError(
            `Quotes in ${existing.status} status cannot be edited. Only DRAFT quotes can be modified.`,
        );
    }

    const effectiveCustomerId = data.customerId ?? existing.customerId;

    if (data.customerId && data.customerId !== existing.customerId) {
        const customer = await prisma.customer.findFirst({
            where: {
                id: data.customerId,
                workspaceId,
            },
        });
        if (!customer) {
            throw new CustomerNotFoundError();
        }
    }

    if (data.locationId !== undefined && data.locationId !== null) {
        const location = await prisma.serviceLocation.findFirst({
            where: {
                id: data.locationId,
                customerId: effectiveCustomerId,
            },
        });
        if (!location) {
            throw new ServiceLocationNotFoundError();
        }
    }

    // 5. BUSINESS LOGIC: Re-calculate totals if discount or tax parameters change
    const discountType = data.discountType !== undefined ? data.discountType : existing.discountType;
    const discountValue = data.discountValue !== undefined ? new Prisma.Decimal(data.discountValue) : existing.discountValue;
    const taxRate = data.taxRate !== undefined ? new Prisma.Decimal(data.taxRate) : existing.taxRate;

    const calculationNeeded =
        data.discountType !== undefined ||
        data.discountValue !== undefined ||
        data.taxRate !== undefined;

    let computedTotals = {
        subtotal: existing.subtotal,
        discountAmount: existing.discountAmount,
        taxAmount: existing.taxAmount,
        total: existing.total,
        lineItems: [] as any[],
    };

    if (calculationNeeded && existing.lineItems.length > 0) {
        const computed = calculateQuoteTotals(
            {
                discountType,
                discountValue,
                taxRate,
            },
            existing.lineItems.map((item) => ({
                id: item.id,
                sortOrder: item.sortOrder,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                unitCost: item.unitCost,
                discountAmount: item.discountAmount,
                taxRate: item.taxRate,
                name: item.name,
            })),
        );

        computedTotals = {
            subtotal: computed.subtotal,
            discountAmount: computed.discountAmount,
            taxAmount: computed.taxAmount,
            total: computed.total,
            lineItems: computed.lineItems,
        };
    }

    // 6. PERSISTENCE (Atomic Transaction)
    const updatedQuote = await prisma.$transaction(async (tx) => {
        // If line items were recalculated, update their allocated discounts and totals
        if (computedTotals.lineItems.length > 0) {
            for (const computedLine of computedTotals.lineItems) {
                if (computedLine.id) {
                    await tx.quoteLineItem.update({
                        where: { id: computedLine.id },
                        data: {
                            discountAmount: computedLine.totalDiscountAmount,
                            subtotal: computedLine.lineBaseSubtotal,
                            taxRate: computedLine.taxRate,
                            taxAmount: computedLine.taxAmount,
                            total: computedLine.total,
                        },
                    });
                }
            }
        }

        const quote = await tx.quote.update({
            where: { id: quoteId },
            data: {
                ...(data.customerId !== undefined && { customerId: data.customerId }),
                ...(data.locationId !== undefined && { locationId: data.locationId }),
                ...(data.title !== undefined && { title: data.title }),
                ...(data.description !== undefined && { description: data.description }),
                ...(data.internalNotes !== undefined && { internalNotes: data.internalNotes }),
                ...(data.termsAndConditions !== undefined && { termsAndConditions: data.termsAndConditions }),
                ...(data.validUntil !== undefined && { validUntil: data.validUntil }),
                ...(data.discountType !== undefined && { discountType: data.discountType }),
                ...(data.discountValue !== undefined && { discountValue }),
                ...(data.taxRate !== undefined && { taxRate }),
                ...(calculationNeeded && {
                    subtotal: computedTotals.subtotal,
                    discountAmount: computedTotals.discountAmount,
                    taxAmount: computedTotals.taxAmount,
                    total: computedTotals.total,
                }),
            },
            include: {
                customer: true,
                location: true,
                lineItems: {
                    orderBy: { sortOrder: "asc" },
                },
            },
        });

        // Audit Trail Entry
        await tx.quoteHistory.create({
            data: {
                quoteId: quote.id,
                workspaceId,
                eventType: "UPDATED",
                actorMemberId: authContext.membership.id,
                actorName: authContext.user?.name ?? null,
                field: "header",
                oldValue: JSON.stringify({
                    title: existing.title,
                    discountType: existing.discountType,
                    discountValue: existing.discountValue.toString(),
                    taxRate: existing.taxRate.toString(),
                }),
                newValue: JSON.stringify({
                    title: quote.title,
                    discountType: quote.discountType,
                    discountValue: quote.discountValue.toString(),
                    taxRate: quote.taxRate.toString(),
                }),
                metadata: {
                    updatedFields: Object.keys(data),
                },
            },
        });

        return quote;
    });

    return mapQuoteToReadModel(updatedQuote);
}
