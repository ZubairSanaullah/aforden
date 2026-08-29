import {
    jsonSuccess,
    withPublicApiAuth,
    getAuthenticatedWorkspaceId,
    withTenantScope,
    PUBLIC_API_SCOPES,
} from "@/lib/publicApi";
import { getPublicApiActorContext } from "@/lib/publicApi/actor";
import { getTechnicianProfileOverview } from "@/lib/services/technicianProfile";
import { TechnicianProfileNotFoundError } from "@/lib/services/technicianProfile/technicianProfileErrors";
import { toPublicTechnicianDto } from "@/lib/publicApi/technicians/technicianDto";
import { handleTechnicianPublicApiError } from "@/lib/publicApi/technicians/technicianErrorHandler";

interface RouteContext {
    params: Promise<{ id: string }> | { id: string };
}

/**
 * GET /api/v1/technicians/:id
 *
 * Fetch detailed profile, certified skills, and service areas for a single technician by ID.
 * Requires `technicians:read` scope.
 */
export const GET = withPublicApiAuth(
    async (request: Request, context: RouteContext) => {
        try {
            const params = await context.params;
            const technicianId = params.id;

            const workspaceId = getAuthenticatedWorkspaceId();
            // Synthetic actor context requires MANAGER role to fulfill MEMBERS_VIEW permission in domain service
            const actor = getPublicApiActorContext("MANAGER");

            const overview = await withTenantScope(
                (wsId) => getTechnicianProfileOverview(wsId, technicianId, actor),
            );

            if (!overview) {
                throw new TechnicianProfileNotFoundError();
            }

            const publicDto = toPublicTechnicianDto(overview);

            return jsonSuccess(publicDto);
        } catch (error) {
            return handleTechnicianPublicApiError(error);
        }
    },
    {
        requiredScopes: [PUBLIC_API_SCOPES.TECHNICIANS_READ],
    },
);
