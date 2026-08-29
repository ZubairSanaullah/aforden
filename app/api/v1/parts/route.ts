import {
    jsonSuccess,
    withPublicApiAuth,
    getAuthenticatedWorkspaceId,
    withTenantScope,
    PUBLIC_API_SCOPES,
} from "@/lib/publicApi";
import { getPublicApiActorContext } from "@/lib/publicApi/actor";
import { getParts } from "@/lib/services/inventory/part/getParts";
import { toPublicPartDto } from "@/lib/publicApi/parts/partDto";
import { handlePartPublicApiError } from "@/lib/publicApi/parts/partErrorHandler";

/**
 * GET /api/v1/parts
 *
 * Query and paginate collection of parts in the catalog.
 * Requires `inventory:read` scope.
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

            const search = url.searchParams.get("search") || undefined;
            const status = url.searchParams.get("status") || undefined;
            const unitOfMeasure = url.searchParams.get("unitOfMeasure") || undefined;

            const domainQuery: any = {
                page,
                pageSize: limit,
                search,
                status,
                unitOfMeasure,
            };

            const listResult = await withTenantScope(
                (wsId) => getParts(wsId, domainQuery, actor),
            );

            const data = listResult.items.map(toPublicPartDto);

            const nextCursor =
                listResult.pagination.hasNextPage && listResult.items.length > 0
                    ? Buffer.from(
                          JSON.stringify({
                              id: listResult.items[listResult.items.length - 1].id,
                          }),
                      ).toString("base64url")
                    : null;

            const prevCursor =
                listResult.pagination.hasPreviousPage && listResult.items.length > 0
                    ? Buffer.from(
                          JSON.stringify({
                              id: listResult.items[0].id,
                          }),
                      ).toString("base64url")
                    : null;

            return jsonSuccess(data, {
                pagination: {
                    limit: listResult.pagination.pageSize,
                    hasMore: listResult.pagination.hasNextPage,
                    nextCursor,
                    prevCursor,
                },
            });
        } catch (error) {
            return handlePartPublicApiError(error);
        }
    },
    {
        requiredScopes: [PUBLIC_API_SCOPES.INVENTORY_READ],
    },
);
