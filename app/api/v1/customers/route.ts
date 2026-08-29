import {
    jsonSuccess,
    withPublicApiAuth,
    getAuthenticatedWorkspaceId,
    withTenantScope,
    PUBLIC_API_SCOPES,
} from "@/lib/publicApi";
import { getPublicApiActorContext } from "@/lib/publicApi/actor";
import {
    createCustomer,
    getCustomers,
} from "@/lib/services/customer";
import { toPublicCustomerDto } from "@/lib/publicApi/customers/customerDto";
import { createPublicCustomerSchema } from "@/lib/publicApi/customers/customerValidation";
import { handleCustomerPublicApiError } from "@/lib/publicApi/customers/customerErrorHandler";

/**
 * GET /api/v1/customers
 *
 * Query and paginate collection of customers within the authorized workspace.
 * Requires `customers:read` scope.
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
            const search = url.searchParams.get("search") || undefined;
            const sort = url.searchParams.get("sort") || "-createdAt";

            const domainQuery: any = {
                page,
                pageSize: limit,
                search,
            };

            if (statusParam) {
                domainQuery.status = statusParam.split(",")[0].trim();
            }

            // Sort parsing: -created_at -> sortBy: "createdAt", sortOrder: "desc"
            if (sort) {
                const isDesc = sort.startsWith("-");
                const rawField = isDesc ? sort.substring(1) : sort;
                const fieldCamel =
                    rawField === "created_at"
                        ? "createdAt"
                        : rawField === "updated_at"
                          ? "updatedAt"
                          : rawField === "customer_number"
                            ? "customerNumber"
                            : rawField;
                domainQuery.sortBy = fieldCamel;
                domainQuery.sortOrder = isDesc ? "desc" : "asc";
            }

            // Invoke domain service strictly within tenant scope
            const listResult = await withTenantScope(
                (wsId) => getCustomers(wsId, domainQuery, actor),
            );

            const data = listResult.items.map(toPublicCustomerDto);

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
            return handleCustomerPublicApiError(error);
        }
    },
    {
        requiredScopes: [PUBLIC_API_SCOPES.CUSTOMERS_READ],
    },
);

/**
 * POST /api/v1/customers
 *
 * Create a new Customer within the authorized workspace.
 * Requires `customers:write` scope.
 */
export const POST = withPublicApiAuth(
    async (request: Request) => {
        try {
            const workspaceId = getAuthenticatedWorkspaceId();
            const actor = getPublicApiActorContext();

            let rawBody: unknown;
            try {
                rawBody = await request.json();
            } catch {
                rawBody = {};
            }

            // Validate against public customer creation schema
            const validated = createPublicCustomerSchema.parse(rawBody);

            // Delegate to domain service
            const created = await withTenantScope(
                (wsId) => createCustomer(wsId, validated, actor),
            );

            const publicDto = toPublicCustomerDto(created);

            return jsonSuccess(publicDto, { status: 201 });
        } catch (error) {
            return handleCustomerPublicApiError(error);
        }
    },
    {
        requiredScopes: [PUBLIC_API_SCOPES.CUSTOMERS_WRITE],
    },
);
