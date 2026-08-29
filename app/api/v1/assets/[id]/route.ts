import {
    jsonSuccess,
    withPublicApiAuth,
    getAuthenticatedWorkspaceId,
    withTenantScope,
    PUBLIC_API_SCOPES,
} from "@/lib/publicApi";
import { getPublicApiActorContext } from "@/lib/publicApi/actor";
import {
    getAsset,
    updateAsset,
} from "@/lib/services/asset";
import { toPublicAssetDto } from "@/lib/publicApi/assets/assetDto";
import { updatePublicAssetSchema } from "@/lib/publicApi/assets/assetValidation";
import { handleAssetPublicApiError } from "@/lib/publicApi/assets/assetErrorHandler";

interface RouteContext {
    params: Promise<{ id: string }> | { id: string };
}

/**
 * GET /api/v1/assets/:id
 *
 * Fetch single Asset details by ID within the authorized workspace.
 * Requires `assets:read` scope.
 */
export const GET = withPublicApiAuth(
    async (request: Request, context: RouteContext) => {
        try {
            const params = await context.params;
            const assetId = params.id;

            const workspaceId = getAuthenticatedWorkspaceId();
            const actor = getPublicApiActorContext();

            // Sourced exclusively within tenant scope
            const asset = await withTenantScope(
                (wsId) => getAsset(wsId, assetId, actor),
            );

            const publicDto = toPublicAssetDto(asset);

            return jsonSuccess(publicDto);
        } catch (error) {
            return handleAssetPublicApiError(error);
        }
    },
    {
        requiredScopes: [PUBLIC_API_SCOPES.ASSETS_READ],
    },
);

/**
 * PATCH /api/v1/assets/:id
 *
 * Atomically update mutable specification, status, and metadata fields on an existing Asset.
 * Requires `assets:write` scope.
 */
export const PATCH = withPublicApiAuth(
    async (request: Request, context: RouteContext) => {
        try {
            const params = await context.params;
            const assetId = params.id;

            const workspaceId = getAuthenticatedWorkspaceId();
            const actor = getPublicApiActorContext();

            let rawBody: unknown;
            try {
                rawBody = await request.json();
            } catch {
                rawBody = {};
            }

            // Validate against public asset update schema
            const validated = updatePublicAssetSchema.parse(rawBody);

            // Delegate to domain service
            const updated = await withTenantScope(
                (wsId) => updateAsset(wsId, assetId, validated, actor),
            );

            const publicDto = toPublicAssetDto(updated);

            return jsonSuccess(publicDto);
        } catch (error) {
            return handleAssetPublicApiError(error);
        }
    },
    {
        requiredScopes: [PUBLIC_API_SCOPES.ASSETS_WRITE],
    },
);
