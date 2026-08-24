/**
 * Phase 1.11.5 — Quotes Listing & Filtering Service
 * Implements tenant-scoped pagination, filtering, searching, and deterministic sorting.
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { listQuotesQuerySchema } from "./quote.schemas";
import { mapQuoteToReadModel } from "./quoteMappers";
import type { PaginatedQuotesReadModel } from "./quote.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import { Prisma } from "@/generated/prisma/client";

/**
 * Lists quotes for an authorized workspace with pagination, filters, and search.
 */
export async function listQuotes(
    workspaceId: string,
    rawQuery?: unknown,
    actor?: WorkspaceAuthorizationContext,
): Promise<PaginatedQuotesReadModel> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert quotes.view
    assertPermission(authContext.membership.role, PERMISSIONS.QUOTES_VIEW);

    // 3. VALIDATION
    const query = listQuotesQuerySchema.parse(rawQuery ?? {});

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    // 4. FILTERING & WHERE CLAUSE
    const where: Prisma.QuoteWhereInput = {
        workspaceId,
    };

    if (query.status) {
        if (Array.isArray(query.status)) {
            where.status = { in: query.status as any };
        } else {
            where.status = query.status as any;
        }
    }

    if (query.customerId) {
        where.customerId = query.customerId;
    }

    if (query.locationId) {
        where.locationId = query.locationId;
    }

    if (query.validUntilFrom || query.validUntilTo) {
        where.validUntil = {
            ...(query.validUntilFrom && { gte: query.validUntilFrom }),
            ...(query.validUntilTo && { lte: query.validUntilTo }),
        };
    }

    if (query.createdFrom || query.createdTo) {
        where.createdAt = {
            ...(query.createdFrom && { gte: query.createdFrom }),
            ...(query.createdTo && { lte: query.createdTo }),
        };
    }

    if (query.minTotal !== undefined || query.maxTotal !== undefined) {
        where.total = {
            ...(query.minTotal !== undefined && { gte: new Prisma.Decimal(query.minTotal) }),
            ...(query.maxTotal !== undefined && { lte: new Prisma.Decimal(query.maxTotal) }),
        };
    }

    if (query.search && query.search.trim().length > 0) {
        const term = query.search.trim();
        where.OR = [
            { quoteNumber: { contains: term, mode: "insensitive" } },
            { title: { contains: term, mode: "insensitive" } },
            { description: { contains: term, mode: "insensitive" } },
            { customer: { name: { contains: term, mode: "insensitive" } } },
            { customer: { customerNumber: { contains: term, mode: "insensitive" } } },
        ];
    }

    // 5. DETERMINISTIC SORTING
    const sortBy = query.sortBy ?? "createdAt";
    const sortOrder = query.sortOrder ?? "desc";

    const orderBy: Prisma.QuoteOrderByWithRelationInput[] = [
        { [sortBy]: sortOrder },
        { id: "asc" }, // Deterministic secondary tie-breaker
    ];

    // 6. PERSISTENCE / QUERY
    const [total, records] = await Promise.all([
        prisma.quote.count({ where }),
        prisma.quote.findMany({
            where,
            orderBy,
            skip,
            take: limit,
            include: {
                customer: true,
                location: true,
                _count: {
                    select: { lineItems: true },
                },
            },
        }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
        items: records.map(mapQuoteToReadModel),
        total,
        page,
        limit,
        totalPages,
    };
}
