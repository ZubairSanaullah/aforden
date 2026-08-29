import {
    jsonSuccess,
    withPublicApiAuth,
    getAuthenticatedWorkspaceId,
    withTenantScope,
    PUBLIC_API_SCOPES,
} from "@/lib/publicApi";
import { getPublicApiActorContext } from "@/lib/publicApi/actor";
import { listInvoices } from "@/lib/services/invoice/listInvoices";
import { toPublicInvoiceDto } from "@/lib/publicApi/invoices/invoiceDto";
import { handleInvoicePublicApiError } from "@/lib/publicApi/invoices/invoiceErrorHandler";

/**
 * GET /api/v1/invoices
 *
 * Query and paginate collection of invoices.
 * Requires `invoices:read` scope.
 */
export const GET = withPublicApiAuth(
    async (request: Request) => {
        try {
            const workspaceId = getAuthenticatedWorkspaceId();
            const actor = getPublicApiActorContext("DISPATCHER");
            const url = new URL(request.url);

            const rawLimit = url.searchParams.get("limit") || url.searchParams.get("pageSize");
            let limit = 25;
            if (rawLimit) {
                const parsed = parseInt(rawLimit, 10);
                if (!isNaN(parsed) && parsed >= 1) {
                    limit = Math.min(parsed, 100);
                }
            }

            const rawPage = url.searchParams.get("page");
            let page = 1;
            if (rawPage) {
                const parsed = parseInt(rawPage, 10);
                if (!isNaN(parsed) && parsed >= 1) {
                    page = parsed;
                }
            }

            const customerId = url.searchParams.get("customerId") || undefined;
            const locationId = url.searchParams.get("locationId") || undefined;
            const quoteId = url.searchParams.get("quoteId") || undefined;
            const workOrderId = url.searchParams.get("workOrderId") || undefined;
            const status = url.searchParams.get("status") || undefined;
            const search = url.searchParams.get("search") || undefined;

            const domainQuery: any = {
                page,
                limit,
                customerId,
                locationId,
                quoteId,
                workOrderId,
                status,
                search,
            };

            const listResult = await withTenantScope(
                (wsId) => listInvoices(wsId, domainQuery, actor),
            );

            const data = listResult.items.map(toPublicInvoiceDto);

            const hasNextPage = listResult.page < listResult.totalPages;
            const hasPrevPage = listResult.page > 1;

            const nextCursor =
                hasNextPage && listResult.items.length > 0
                    ? Buffer.from(
                          JSON.stringify({
                              id: listResult.items[listResult.items.length - 1].id,
                          }),
                      ).toString("base64url")
                    : null;

            const prevCursor =
                hasPrevPage && listResult.items.length > 0
                    ? Buffer.from(
                          JSON.stringify({
                              id: listResult.items[0].id,
                          }),
                      ).toString("base64url")
                    : null;

            return jsonSuccess(data, {
                pagination: {
                    limit: listResult.limit,
                    hasMore: hasNextPage,
                    nextCursor,
                    prevCursor,
                },
            });
        } catch (error) {
            return handleInvoicePublicApiError(error);
        }
    },
    {
        requiredScopes: [PUBLIC_API_SCOPES.INVOICES_READ],
    },
);
