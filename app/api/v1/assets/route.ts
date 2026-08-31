import {
    jsonSuccess,
    withPublicApiAuth,
    withIdempotency,
    getAuthenticatedWorkspaceId,
    withTenantScope,
    PUBLIC_API_SCOPES,
} from "@/lib/publicApi";
import { getPublicApiActorContext } from "@/lib/publicApi/actor";
import {
    createAsset,
    getAssets,
} from "@/lib/services/asset";
import { toPublicAssetDto } from "@/lib/publicApi/assets/assetDto";
import { createPublicAssetSchema } from "@/lib/publicApi/assets/assetValidation";
import { handleAssetPublicApiError } from "@/lib/publicApi/assets/assetErrorHandler";

/**
 * GET /api/v1/assets
 *
 * Query and paginate collection of Assets within the authorized workspace.
 * Requires `assets:read` scope.
 */
export const GET = withPublicApiAuth(
    async (request: Request) => {
        try {
            const workspaceId = getAuthenticatedWorkspaceId();
            const actor = getPublicApiActorContext();
            const url = new URL(request.url);

            // Parse pagination parameters
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

            // Parse filtering & search parameters
            const statusParam = url.searchParams.get("status");
            const customerId = url.searchParams.get("customerId") || undefined;
            const locationId = url.searchParams.get("locationId") || undefined;
            const categoryId = url.searchParams.get("categoryId") || undefined;
            const manufacturer = url.searchParams.get("manufacturer") || undefined;
            const search = url.searchParams.get("search") || undefined;
            const sort = url.searchParams.get("sort") || "-createdAt";

            const domainQuery: any = {
                page,
                pageSize: limit,
                search,
                customerId,
                locationId,
                categoryId,
                manufacturer,
            };

            if (statusParam) {
                domainQuery.status = statusParam.split(",")[0].trim();
            }

            // Sort parsing: -createdAt -> sortBy: "createdAt", sortOrder: "desc"
            if (sort) {
                const isDesc = sort.startsWith("-");
                const rawField = isDesc ? sort.substring(1) : sort;
                const fieldCamel =
                    rawField === "created_at"
                        ? "createdAt"
                        : rawField === "updated_at"
                          ? "updatedAt"
                          : rawField === "asset_number"
                            ? "assetNumber"
                            : rawField === "serial_number"
                              ? "serialNumber"
                              : rawField;
                domainQuery.sortBy = fieldCamel;
                domainQuery.sortOrder = isDesc ? "desc" : "asc";
            }

            // Invoke domain service strictly within tenant scope
            const listResult = await withTenantScope(
                (wsId) => getAssets(wsId, domainQuery, actor),
            );

            const data = listResult.items.map(toPublicAssetDto);

            // Compute cursor tokens
            const nextCursor =
                listResult.pagination.hasNextPage && listResult.items.length > 0
                    ? Buffer.from(
                          JSON.stringify({
                              createdAt: listResult.items[listResult.items.length - 1].createdAt,
                              id: listResult.items[listResult.items.length - 1].id,
                          }),
                      ).toString("base64url")
                    : null;

            const prevCursor =
                listResult.pagination.hasPreviousPage && listResult.items.length > 0
                    ? Buffer.from(
                          JSON.stringify({
                              createdAt: listResult.items[0].createdAt,
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
            return handleAssetPublicApiError(error);
        }
    },
    {
        requiredScopes: [PUBLIC_API_SCOPES.ASSETS_READ],
    },
);

/**
 * POST /api/v1/assets
 *
 * Create a new physical Asset / Equipment record within the authorized workspace.
 * Requires `assets:write` scope.
 */
export const POST = withPublicApiAuth(
    withIdempotency(async (request: Request) => {
        try {
            const workspaceId = getAuthenticatedWorkspaceId();
            const actor = getPublicApiActorContext();

            let rawBody: unknown;
            try {
                rawBody = await request.json();
            } catch {
                rawBody = {};
            }

            // Validate against public asset creation schema
            const validated = createPublicAssetSchema.parse(rawBody);

            // Delegate to domain service
            const created = await withTenantScope(
                (wsId) => createAsset(wsId, validated, actor),
            );

            const publicDto = toPublicAssetDto(created);

            return jsonSuccess(publicDto, { status: 201 });
        } catch (error) {
            return handleAssetPublicApiError(error);
        }
    }),
    {
        requiredScopes: [PUBLIC_API_SCOPES.ASSETS_WRITE],
    },
);
