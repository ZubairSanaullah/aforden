/**
 * Phase 1.12.7 — Payments Listing & Query Service
 * Implements tenant-scoped pagination, filtering, searching, and deterministic sorting for payments.
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { listPaymentsQuerySchema } from "./invoice.schemas";
import { mapPaymentToReadModel } from "./invoiceMappers";
import type { PaginatedPaymentsReadModel } from "./invoice.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import { Prisma } from "@/generated/prisma/client";

/**
 * Lists payments for an authorized workspace across all invoices with pagination, filters, and search.
 */
export async function listPayments(
    workspaceId: string,
    rawQuery?: unknown,
    actor?: WorkspaceAuthorizationContext,
): Promise<PaginatedPaymentsReadModel> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert payments.view
    assertPermission(authContext.membership.role, PERMISSIONS.PAYMENTS_VIEW);

    // 3. VALIDATION
    const query = listPaymentsQuerySchema.parse(rawQuery ?? {});

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    // 4. FILTERING & WHERE CLAUSE
    const where: Prisma.PaymentWhereInput = {
        workspaceId,
    };

    if (query.status) {
        where.status = query.status as any;
    }

    if (query.customerId) {
        where.customerId = query.customerId;
    }

    if (query.invoiceId) {
        where.invoiceId = query.invoiceId;
    }

    if (query.paymentMethod) {
        where.paymentMethod = query.paymentMethod as any;
    }

    const effectiveDateFrom = query.paymentDateFrom || query.startDate || query.fromDate;
    const effectiveDateTo = query.paymentDateTo || query.endDate || query.toDate;
    if (effectiveDateFrom || effectiveDateTo) {
        where.paymentDate = {
            ...(effectiveDateFrom && { gte: new Date(effectiveDateFrom) }),
            ...(effectiveDateTo && { lte: new Date(effectiveDateTo) }),
        };
    }

    if (query.minAmount !== undefined || query.maxAmount !== undefined) {
        where.amount = {
            ...(query.minAmount !== undefined && { gte: new Prisma.Decimal(String(query.minAmount)) }),
            ...(query.maxAmount !== undefined && { lte: new Prisma.Decimal(String(query.maxAmount)) }),
        };
    }

    if (query.search && query.search.trim().length > 0) {
        const term = query.search.trim();
        where.OR = [
            { paymentNumber: { contains: term, mode: "insensitive" } },
            { referenceNumber: { contains: term, mode: "insensitive" } },
            { notes: { contains: term, mode: "insensitive" } },
            { customer: { name: { contains: term, mode: "insensitive" } } },
        ];
    }

    // 5. DETERMINISTIC SORTING
    const sortBy = query.sortBy ?? "createdAt";
    const sortOrder = query.sortOrder ?? "desc";

    const orderBy: Prisma.PaymentOrderByWithRelationInput[] = [
        { [sortBy]: sortOrder },
        { id: "asc" }, // Deterministic secondary tie-breaker
    ];

    // 6. QUERY EXECUTION
    const [total, records] = await Promise.all([
        prisma.payment.count({ where }),
        prisma.payment.findMany({
            where,
            orderBy,
            skip,
            take: limit,
            include: {
                recordedByMember: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                                avatarUrl: true,
                            },
                        },
                    },
                },
                voidedByMember: {
                    include: {
                        user: {
                            select: {
                                id: true,
                                name: true,
                                email: true,
                                avatarUrl: true,
                            },
                        },
                    },
                },
                customer: true,
                invoice: true,
            },
        }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
        items: records.map(mapPaymentToReadModel),
        total,
        page,
        limit,
        totalPages,
    };
}
