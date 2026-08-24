/**
 * Phase 1.11.5 — Quote Creation Service
 * Implements the locked execution pipeline:
 * AUTHENTICATION → PERMISSION → VALIDATION → RESOLUTION → BUSINESS LOGIC → PERSISTENCE
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createQuoteSchema } from "./quote.schemas";
import {
    CustomerNotFoundError,
    ServiceLocationNotFoundError,
} from "@/lib/services/customer/customerErrors";
import { mapQuoteToReadModel } from "./quoteMappers";
import type { QuoteReadModel } from "./quote.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import { Prisma } from "@/generated/prisma/client";

/**
 * Creates a new Quote in DRAFT status within an authorized workspace.
 */
export async function createQuote(
    workspaceId: string,
    input: unknown,
    actor?: WorkspaceAuthorizationContext,
): Promise<QuoteReadModel> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert quotes.create
    assertPermission(authContext.membership.role, PERMISSIONS.QUOTES_CREATE);

    // 3. VALIDATION
    const data = createQuoteSchema.parse(input);

    // 4. RESOLUTION & TENANT INTEGRITY
    const customer = await prisma.customer.findFirst({
        where: {
            id: data.customerId,
            workspaceId,
        },
    });

    if (!customer) {
        throw new CustomerNotFoundError();
    }

    if (data.locationId) {
        const location = await prisma.serviceLocation.findFirst({
            where: {
                id: data.locationId,
                customerId: data.customerId,
            },
        });

        if (!location) {
            throw new ServiceLocationNotFoundError();
        }
    }

    // Resolve Workspace currency configuration
    const workspace = await prisma.workspace.findUnique({
        where: { id: workspaceId },
        select: { defaultCurrencyCode: true },
    });

    const currencyCode =
        data.currencyCode || workspace?.defaultCurrencyCode || "USD";

    // 5. BUSINESS LOGIC & 6. PERSISTENCE (Atomic Transaction)
    const year = new Date().getFullYear();
    const prefix = `Q-${year}-`;

    const createdQuote = await prisma.$transaction(async (tx) => {
        // Deterministic sequential numbering (Q-YYYY-XXXXXX)
        const latest = await tx.quote.findFirst({
            where: {
                workspaceId,
                quoteNumber: { startsWith: prefix },
            },
            orderBy: { quoteNumber: "desc" },
            select: { quoteNumber: true },
        });

        let nextSeq = 1;
        if (latest?.quoteNumber) {
            const match = latest.quoteNumber.match(/^Q-\d{4}-(\d+)$/);
            if (match && match[1]) {
                const currentSeq = parseInt(match[1], 10);
                if (!isNaN(currentSeq)) {
                    nextSeq = currentSeq + 1;
                }
            }
        }

        const quoteNumber = `${prefix}${String(nextSeq).padStart(6, "0")}`;

        const quote = await tx.quote.create({
            data: {
                workspaceId,
                quoteNumber,
                customerId: data.customerId,
                locationId: data.locationId ?? null,
                status: "DRAFT",
                title: data.title,
                description: data.description ?? null,
                internalNotes: data.internalNotes ?? null,
                termsAndConditions: data.termsAndConditions ?? null,
                currencyCode,
                validUntil: data.validUntil ?? null,
                subtotal: new Prisma.Decimal("0.00"),
                discountType: data.discountType ?? "PERCENTAGE",
                discountValue: new Prisma.Decimal(data.discountValue ?? 0),
                discountAmount: new Prisma.Decimal("0.00"),
                taxRate: new Prisma.Decimal(data.taxRate ?? 0),
                taxAmount: new Prisma.Decimal("0.00"),
                total: new Prisma.Decimal("0.00"),
            },
            include: {
                customer: true,
                location: true,
                lineItems: true,
            },
        });

        // Atomic audit ledger write
        await tx.quoteHistory.create({
            data: {
                quoteId: quote.id,
                workspaceId,
                eventType: "CREATED",
                actorMemberId: authContext.membership.id,
                actorName: authContext.user?.name ?? null,
                field: null,
                oldValue: null,
                newValue: quote.quoteNumber,
                metadata: {
                    title: quote.title,
                    customerId: quote.customerId,
                    currencyCode: quote.currencyCode,
                },
            },
        });

        return quote;
    });

    return mapQuoteToReadModel(createdQuote);
}
