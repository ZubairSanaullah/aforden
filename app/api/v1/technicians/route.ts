import {
    jsonSuccess,
    withPublicApiAuth,
    getAuthenticatedWorkspaceId,
    withTenantScope,
    PUBLIC_API_SCOPES,
} from "@/lib/publicApi";
import { getPublicApiActorContext } from "@/lib/publicApi/actor";
import { getTechnicians } from "@/lib/services/technicianProfile";
import { toPublicTechnicianDto } from "@/lib/publicApi/technicians/technicianDto";
import { listPublicTechniciansQuerySchema } from "@/lib/publicApi/technicians/technicianValidation";
import { handleTechnicianPublicApiError } from "@/lib/publicApi/technicians/technicianErrorHandler";

/**
 * GET /api/v1/technicians
 *
 * Query and paginate collection of technicians within the authorized workspace.
 * Requires `technicians:read` scope.
 */
export const GET = withPublicApiAuth(
    async (request: Request) => {
        try {
            const workspaceId = getAuthenticatedWorkspaceId();
            // Synthetic actor context requires MANAGER role to fulfill MEMBERS_VIEW permission in domain service
            const actor = getPublicApiActorContext("MANAGER");
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

            const status = url.searchParams.get("status") || undefined;
            const search = url.searchParams.get("search") || undefined;
            const serviceAreaId = url.searchParams.get("serviceAreaId") || undefined;
            const departmentId = url.searchParams.get("departmentId") || undefined;
            const jobTitleId = url.searchParams.get("jobTitleId") || undefined;

            const domainQuery: any = {
                page,
                pageSize: limit,
                search,
                employeeStatus: status,
                serviceAreaId,
                departmentId,
                jobTitleId,
            };

            // Delegate to domain service strictly within tenant scope
            const listResult = await withTenantScope(
                (wsId) => getTechnicians(wsId, domainQuery, actor),
            );

            const data = listResult.items.map(toPublicTechnicianDto);

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
                    limit: listResult.pagination.pageSize,
                    hasMore: listResult.pagination.hasNextPage,
                    nextCursor,
                    prevCursor,
                },
            });
        } catch (error) {
            return handleTechnicianPublicApiError(error);
        }
    },
    {
        requiredScopes: [PUBLIC_API_SCOPES.TECHNICIANS_READ],
    },
);
