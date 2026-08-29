import {
    jsonSuccess,
    withPublicApiAuth,
    getAuthenticatedWorkspaceId,
    withTenantScope,
    PUBLIC_API_SCOPES,
} from "@/lib/publicApi";
import { getPublicApiActorContext } from "@/lib/publicApi/actor";
import { getPart } from "@/lib/services/inventory/part/getPart";
import { toPublicPartDto } from "@/lib/publicApi/parts/partDto";
import { handlePartPublicApiError } from "@/lib/publicApi/parts/partErrorHandler";

interface RouteContext {
    params: Promise<{ id: string }> | { id: string };
}

/**
 * GET /api/v1/parts/:id
 *
 * Fetch details of a single part from the catalog.
 * Requires `inventory:read` scope.
 */
export const GET = withPublicApiAuth(
    async (request: Request, context: RouteContext) => {
        try {
            const params = await context.params;
            const partId = params.id;

            const workspaceId = getAuthenticatedWorkspaceId();
            const actor = getPublicApiActorContext("DISPATCHER");

            const part = await withTenantScope(
                (wsId) => getPart(wsId, partId, actor),
            );

            const publicDto = toPublicPartDto(part);

            return jsonSuccess(publicDto);
        } catch (error) {
            return handlePartPublicApiError(error);
        }
    },
    {
        requiredScopes: [PUBLIC_API_SCOPES.INVENTORY_READ],
    },
);
