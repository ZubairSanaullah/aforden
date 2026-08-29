import {
    jsonSuccess,
    withPublicApiAuth,
    getAuthenticatedWorkspaceId,
    withTenantScope,
    PUBLIC_API_SCOPES,
} from "@/lib/publicApi";
import { getPublicApiActorContext } from "@/lib/publicApi/actor";
import { listSchedules } from "@/lib/services/schedule";
import { toPublicScheduleDto } from "@/lib/publicApi/schedules/scheduleDto";
import { listPublicSchedulesQuerySchema } from "@/lib/publicApi/schedules/scheduleValidation";
import { handleSchedulePublicApiError } from "@/lib/publicApi/schedules/scheduleErrorHandler";

/**
 * GET /api/v1/schedules
 *
 * Query and paginate collection of schedule appointments within the authorized workspace.
 * Requires `schedules:read` scope.
 */
export const GET = withPublicApiAuth(
    async (request: Request) => {
        try {
            const workspaceId = getAuthenticatedWorkspaceId();
            // Synthetic actor context uses DISPATCHER role for tenant-wide SCHEDULER_VIEW permission
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

            const technicianId = url.searchParams.get("technicianId") || undefined;
            const workOrderId = url.searchParams.get("workOrderId") || undefined;
            const customerId = url.searchParams.get("customerId") || undefined;
            const locationId = url.searchParams.get("locationId") || undefined;
            const status = url.searchParams.get("status") || undefined;
            const dispatchStatus = url.searchParams.get("dispatchStatus") || undefined;
            const startDate = url.searchParams.get("startDate") || undefined;
            const endDate = url.searchParams.get("endDate") || undefined;
            const search = url.searchParams.get("search") || undefined;
            const sort = url.searchParams.get("sort") || "scheduledStart";

            const domainQuery: any = {
                page,
                limit,
                technicianId,
                workOrderId,
                customerId,
                locationId,
                status,
                dispatchStatus,
                startDate,
                endDate,
                search,
            };

            // Sort parsing: -scheduledStart -> sortBy: "scheduledStart", sortOrder: "desc"
            if (sort) {
                const isDesc = sort.startsWith("-");
                const rawField = isDesc ? sort.substring(1) : sort;
                const fieldCamel =
                    rawField === "scheduled_start"
                        ? "scheduledStart"
                        : rawField === "scheduled_end"
                          ? "scheduledEnd"
                          : rawField === "created_at"
                            ? "createdAt"
                            : rawField === "updated_at"
                              ? "updatedAt"
                              : rawField;
                domainQuery.sortBy = fieldCamel;
                domainQuery.sortOrder = isDesc ? "desc" : "asc";
            }

            // Delegate to domain service strictly within tenant scope
            const listResult = await withTenantScope(
                (wsId) => listSchedules(wsId, domainQuery, actor),
            );

            const data = listResult.items.map(toPublicScheduleDto);

            // Compute cursor tokens
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
                    limit: listResult.pagination.limit,
                    hasMore: listResult.pagination.hasNextPage,
                    nextCursor,
                    prevCursor,
                },
            });
        } catch (error) {
            return handleSchedulePublicApiError(error);
        }
    },
    {
        requiredScopes: [PUBLIC_API_SCOPES.SCHEDULES_READ],
    },
);
