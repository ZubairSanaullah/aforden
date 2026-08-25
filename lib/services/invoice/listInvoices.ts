/**
 * Phase 1.12.5 — Invoices Listing & Filtering Service (Header CRUD)
 * Implements tenant-scoped pagination, filtering, searching, and deterministic sorting.
 */

import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import { listInvoicesQuerySchema } from "./invoice.schemas";
import { mapInvoiceToReadModel } from "./invoiceMappers";
import type { PaginatedInvoicesReadModel } from "./invoice.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";
import { Prisma } from "@/generated/prisma/client";

/**
 * Lists invoices for an authorized workspace with pagination, filters, and search.
 */
export async function listInvoices(
    workspaceId: string,
    rawQuery?: unknown,
    actor?: WorkspaceAuthorizationContext,
): Promise<PaginatedInvoicesReadModel> {
    // 1. AUTHENTICATION
    const authContext = actor ?? (await requireWorkspaceAuthorization(workspaceId));

    // 2. PERMISSION: Assert invoices.view
    assertPermission(authContext.membership.role, PERMISSIONS.INVOICES_VIEW);

    // 3. VALIDATION
    const query = listInvoicesQuerySchema.parse(rawQuery ?? {});

    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;

    // 4. FILTERING & WHERE CLAUSE
    const where: Prisma.InvoiceWhereInput = {
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

    if (query.quoteId) {
        where.quoteId = query.quoteId;
    }

    if (query.workOrderId) {
        where.workOrderId = query.workOrderId;
    }

    const effectiveIssueDateFrom = query.issueDateFrom || query.fromDate;
    const effectiveIssueDateTo = query.issueDateTo || query.toDate;
    if (effectiveIssueDateFrom || effectiveIssueDateTo) {
        where.issueDate = {
            ...(effectiveIssueDateFrom && { gte: new Date(effectiveIssueDateFrom) }),
            ...(effectiveIssueDateTo && { lte: new Date(effectiveIssueDateTo) }),
        };
    }

    if (query.dueDateFrom || query.dueDateTo) {
        where.dueDate = {
            ...(query.dueDateFrom && { gte: new Date(query.dueDateFrom) }),
            ...(query.dueDateTo && { lte: new Date(query.dueDateTo) }),
        };
    }

    if (query.createdFrom || query.createdTo) {
        where.createdAt = {
            ...(query.createdFrom && { gte: new Date(query.createdFrom) }),
            ...(query.createdTo && { lte: new Date(query.createdTo) }),
        };
    }

    if (query.overdueOnly || query.isOverdue) {
        where.status = { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] };
        where.dueDate = { lt: new Date() };
        where.amountDue = { gt: new Prisma.Decimal("0.00") };
    }

    if (query.minTotal !== undefined || query.maxTotal !== undefined) {
        where.total = {
            ...(query.minTotal !== undefined && { gte: new Prisma.Decimal(String(query.minTotal)) }),
            ...(query.maxTotal !== undefined && { lte: new Prisma.Decimal(String(query.maxTotal)) }),
        };
    }

    if (query.minAmountDue !== undefined || query.maxAmountDue !== undefined) {
        where.amountDue = {
            ...(query.minAmountDue !== undefined && { gte: new Prisma.Decimal(String(query.minAmountDue)) }),
            ...(query.maxAmountDue !== undefined && { lte: new Prisma.Decimal(String(query.maxAmountDue)) }),
        };
    }

    if (query.search && query.search.trim().length > 0) {
        const term = query.search.trim();
        where.OR = [
            { invoiceNumber: { contains: term, mode: "insensitive" } },
            { title: { contains: term, mode: "insensitive" } },
            { notes: { contains: term, mode: "insensitive" } },
            { customer: { name: { contains: term, mode: "insensitive" } } },
            { customer: { customerNumber: { contains: term, mode: "insensitive" } } },
        ];
    }

    // 5. DETERMINISTIC SORTING
    const sortBy = query.sortBy ?? "createdAt";
    const sortOrder = query.sortOrder ?? "desc";

    const orderBy: Prisma.InvoiceOrderByWithRelationInput[] = [
        { [sortBy]: sortOrder },
        { id: "asc" }, // Deterministic secondary tie-breaker
    ];

    // 6. PERSISTENCE / QUERY
    const [total, records] = await Promise.all([
        prisma.invoice.count({ where }),
        prisma.invoice.findMany({
            where,
            orderBy,
            skip,
            take: limit,
            include: {
                customer: true,
                location: true,
                _count: {
                    select: { lineItems: true, payments: true },
                },
            },
        }),
    ]);

    const totalPages = Math.ceil(total / limit) || 1;

    return {
        items: records.map(mapInvoiceToReadModel),
        total,
        page,
        limit,
        totalPages,
    };
}
