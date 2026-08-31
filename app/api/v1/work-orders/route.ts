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
    createWorkOrder,
    getWorkOrders,
} from "@/lib/services/workOrder";
import { toPublicWorkOrderDto } from "@/lib/publicApi/workOrders/workOrderDto";
import { publicCreateWorkOrderSchema } from "@/lib/publicApi/workOrders/workOrderValidation";
import { handleWorkOrderPublicApiError } from "@/lib/publicApi/workOrders/workOrderErrorHandler";

/**
 * GET /api/v1/work-orders
 *
 * Query and paginate collection of work orders within the authorized workspace.
 * Requires `work_orders:read` scope.
 */
export const GET = withPublicApiAuth(
    async (request: Request) => {
        try {
            const workspaceId = getAuthenticatedWorkspaceId();
            const actor = getPublicApiActorContext();
            const url = new URL(request.url);

            // Parse pagination parameters
            const rawLimit = url.searchParams.get("limit");
            let limit = 25;
            if (rawLimit) {
                const parsed = parseInt(rawLimit, 10);
                if (!isNaN(parsed) && parsed >= 1) {
                    limit = Math.min(parsed, 100);
                }
            }

            // Parse filtering parameters per Section 6.2
            const statusParam = url.searchParams.get("status");
            const priorityParam = url.searchParams.get("priority");
            const customerId =
                url.searchParams.get("customer_id") ||
                url.searchParams.get("customerId") ||
                undefined;
            const locationId =
                url.searchParams.get("location_id") ||
                url.searchParams.get("locationId") ||
                undefined;
            const workTypeId =
                url.searchParams.get("work_type_id") ||
                url.searchParams.get("workTypeId") ||
                undefined;
            const assignedTechnicianId =
                url.searchParams.get("assigned_technician_id") ||
                url.searchParams.get("technician_id") ||
                url.searchParams.get("assignedTechnicianId") ||
                undefined;
            const search = url.searchParams.get("search") || undefined;
            const sort = url.searchParams.get("sort") || "-createdAt";

            const domainQuery: any = {
                page: 1,
                pageSize: limit,
                search,
                customerId,
                locationId,
                workTypeId,
                assignedTechnicianId,
            };

            if (statusParam) {
                // If comma-separated or single
                domainQuery.status = statusParam.split(",")[0].trim();
            }

            if (priorityParam) {
                domainQuery.priority = priorityParam.trim();
            }

            // Sort parsing: -created_at -> sortBy: "createdAt", sortOrder: "desc"
            if (sort) {
                const isDesc = sort.startsWith("-");
                const rawField = isDesc ? sort.substring(1) : sort;
                const fieldCamel = rawField === "created_at" ? "createdAt" : rawField;
                domainQuery.sortBy = fieldCamel;
                domainQuery.sortOrder = isDesc ? "desc" : "asc";
            }

            // Invoke domain service strictly within tenant scope
            const listResult = await withTenantScope(
                (wsId) => getWorkOrders(wsId, domainQuery, actor),
            );

            const data = listResult.items.map(toPublicWorkOrderDto);

            // Compute cursor tokens
            const nextCursor =
                listResult.pagination.hasNextPage && listResult.items.length > 0
                    ? Buffer.from(
                          JSON.stringify({
                              id: listResult.items[listResult.items.length - 1].id,
                              createdAt:
                                  listResult.items[listResult.items.length - 1].createdAt,
                          }),
                      ).toString("base64url")
                    : null;

            const prevCursor =
                listResult.pagination.hasPreviousPage && listResult.items.length > 0
                    ? Buffer.from(
                          JSON.stringify({
                              id: listResult.items[0].id,
                              createdAt: listResult.items[0].createdAt,
                          }),
                      ).toString("base64url")
                    : null;

            return jsonSuccess(data, {
                pagination: {
                    hasMore: listResult.pagination.hasNextPage,
                    limit,
                    nextCursor,
                    prevCursor,
                },
            });
        } catch (error) {
            return handleWorkOrderPublicApiError(error);
        }
    },
    {
        requiredScopes: [PUBLIC_API_SCOPES.WORK_ORDERS_READ],
    },
);

/**
 * POST /api/v1/work-orders
 *
 * Creates a new work order within the authorized workspace.
 * Requires `work_orders:write` scope.
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

            // Validate against public schema
            const validated = publicCreateWorkOrderSchema.parse(rawBody);

            // Delegate to existing domain service within verified workspaceId
            const created = await withTenantScope(
                (wsId) => createWorkOrder(wsId, validated, actor),
            );

            const publicDto = toPublicWorkOrderDto(created);

            return jsonSuccess(publicDto, { status: 201 });
        } catch (error) {
            return handleWorkOrderPublicApiError(error);
        }
    }),
    {
        requiredScopes: [PUBLIC_API_SCOPES.WORK_ORDERS_WRITE],
    },
);

