/**
 * Phase 1.11.8 — Atomic WorkOrder Conversion Service
 * Implements the locked execution pipeline:
 * AUTHENTICATION → PERMISSION → VALIDATION → RESOLUTION → BUSINESS LOGIC → PERSISTENCE
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { createWorkOrder } from "@/lib/services/workOrder/createWorkOrder";
import { assignWorkOrder } from "@/lib/services/workOrder/assignWorkOrder";
import { convertQuoteSchema } from "./quote.schemas";
import {
    QuoteNotFoundError,
    QuoteAlreadyConvertedError,
    QuoteStatusConflictError,
} from "./quoteErrors";
import { mapQuoteToReadModel } from "./quoteMappers";
import type { ConvertQuoteResult } from "./quote.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

/**
 * Converts an APPROVED Quote into a WorkOrder via the canonical WorkOrder creation service.
 * Enforces single-path execution, deterministic workTypeId resolution, relational linkage,
 * and single-transaction atomicity across both Quote and WorkOrder domain mutations.
 */
export async function convertQuoteToWorkOrder(
    workspaceId: string,
    quoteId: string,
    input?: unknown,
    actor?: WorkspaceAuthorizationContext,
): Promise<ConvertQuoteResult> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert quotes.convert
    assertPermission(authContext.membership.role, PERMISSIONS.QUOTES_CONVERT);

    // 3. VALIDATION
    const data = convertQuoteSchema.parse(input ?? {});

    // 4. RESOLUTION & INVARIANTS
    const quote = await prisma.quote.findFirst({
        where: {
            id: quoteId,
            workspaceId,
        },
        include: {
            customer: true,
            location: true,
            lineItems: {
                orderBy: { sortOrder: "asc" },
            },
        },
    });

    if (!quote) {
        throw new QuoteNotFoundError();
    }

    // Status Guard: Dedicated QuoteAlreadyConvertedError if already converted
    if (quote.status === "CONVERTED") {
        throw new QuoteAlreadyConvertedError(
            `Quote ${quote.quoteNumber} has already been converted to a Work Order.`,
        );
    }

    // Status Guard: Must be in APPROVED status
    if (quote.status !== "APPROVED") {
        throw new QuoteStatusConflictError(
            `Quotes in ${quote.status} status cannot be converted. Only APPROVED quotes can be converted to Work Orders.`,
        );
    }

    // Deterministic workTypeId Resolution (§1.11.1 & §1.11.8):
    // 1. Explicit input override if supplied
    // 2. Lowest-sortOrder LABOR-type line item with a non-null workTypeId
    // 3. If neither, reject with clear error rather than silently guessing
    let resolvedWorkTypeId: string | undefined = data.workTypeId;

    if (!resolvedWorkTypeId) {
        const primaryLaborLine = quote.lineItems.find(
            (item) => item.lineItemType === "LABOR" && item.workTypeId,
        );
        if (primaryLaborLine?.workTypeId) {
            resolvedWorkTypeId = primaryLaborLine.workTypeId;
        }
    }

    if (!resolvedWorkTypeId) {
        throw new Error(
            "Quote conversion requires a resolvable workTypeId. No LABOR line item with a workTypeId was found on this quote, and no workTypeId override was provided.",
        );
    }

    const title = data.title ?? quote.title;
    const description =
        data.description !== undefined ? data.description : quote.description;

    const convertedAt = new Date();

    // 5. BUSINESS LOGIC & 6. PERSISTENCE (Single Interactive Transaction)
    // Runs createWorkOrder, assignWorkOrder, foreign-key linking, Quote status update,
    // and QuoteHistory creation inside one shared transaction handle.
    const result = await prisma.$transaction(async (tx) => {
        // 1. Create WorkOrder within shared transaction client
        const createdWorkOrder = await createWorkOrder(
            workspaceId,
            {
                customerId: quote.customerId,
                locationId: quote.locationId ?? undefined,
                workTypeId: resolvedWorkTypeId,
                title,
                description: description ?? undefined,
                internalNotes: quote.internalNotes ?? undefined,
            },
            authContext,
            tx,
        );

        // 2. If technician assignment is requested, invoke canonical assignment service within transaction
        let finalWorkOrder = createdWorkOrder;
        if (data.assignedTechnicianId) {
            finalWorkOrder = await assignWorkOrder(
                workspaceId,
                createdWorkOrder.id,
                { technicianId: data.assignedTechnicianId },
                authContext,
                tx,
            );
        }

        // 3. Link relational foreign key on the WorkOrder
        await tx.workOrder.update({
            where: { id: createdWorkOrder.id },
            data: {
                sourceQuoteId: quote.id,
            },
        });

        // 4. Transition Quote to CONVERTED
        const resultQuote = await tx.quote.update({
            where: { id: quoteId },
            data: {
                status: "CONVERTED",
                convertedWorkOrderId: createdWorkOrder.id,
                convertedAt,
                convertedByMemberId: authContext.membership.id,
            },
            include: {
                customer: true,
                location: true,
                lineItems: {
                    orderBy: { sortOrder: "asc" },
                },
            },
        });

        // 5. Record QuoteHistory event
        await tx.quoteHistory.create({
            data: {
                quoteId,
                workspaceId,
                eventType: "CONVERTED",
                actorMemberId: authContext.membership.id,
                actorName: authContext.user?.name ?? null,
                field: "status",
                oldValue: "APPROVED",
                newValue: "CONVERTED",
                metadata: {
                    workOrderId: createdWorkOrder.id,
                    workOrderNumber: createdWorkOrder.workOrderNumber,
                    convertedAt: convertedAt.toISOString(),
                },
            },
        });

        return {
            workOrder: finalWorkOrder,
            quote: resultQuote,
        };
    });

    return {
        success: true,
        workOrder: result.workOrder,
        quote: mapQuoteToReadModel(result.quote),
    };
}
