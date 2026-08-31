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
    getServiceLocation,
    updateServiceLocation,
} from "@/lib/services/customer";
import { ServiceLocationNotFoundError } from "@/lib/services/customer/customerErrors";
import { toPublicServiceLocationDto } from "@/lib/publicApi/customers/customerDto";
import { updatePublicServiceLocationSchema } from "@/lib/publicApi/customers/customerValidation";
import { handleCustomerPublicApiError } from "@/lib/publicApi/customers/customerErrorHandler";

interface RouteContext {
    params: Promise<{ id: string; locationId: string }> | { id: string; locationId: string };
}

/**
 * GET /api/v1/customers/:id/locations/:locationId
 *
 * Fetch single service location details by ID for a specific customer.
 * Requires `customers:read` scope.
 */
export const GET = withPublicApiAuth(
    async (request: Request, context: RouteContext) => {
        try {
            const params = await context.params;
            const customerId = params.id;
            const locationId = params.locationId;

            const workspaceId = getAuthenticatedWorkspaceId();
            const actor = getPublicApiActorContext();

            // Sourced exclusively within tenant scope
            const location = await withTenantScope(
                (wsId) => getServiceLocation(wsId, customerId, locationId, actor),
            );

            if (!location) {
                throw new ServiceLocationNotFoundError();
            }

            const publicDto = toPublicServiceLocationDto(location);

            return jsonSuccess(publicDto);
        } catch (error) {
            return handleCustomerPublicApiError(error);
        }
    },
    {
        requiredScopes: [PUBLIC_API_SCOPES.CUSTOMERS_READ],
    },
);

/**
 * PATCH /api/v1/customers/:id/locations/:locationId
 *
 * Atomically update mutable fields on an existing service location.
 * Requires `customers:write` scope.
 */
export const PATCH = withPublicApiAuth(
    withIdempotency(async (request: Request, context: RouteContext) => {
        try {
            const params = await context.params;
            const customerId = params.id;
            const locationId = params.locationId;

            const workspaceId = getAuthenticatedWorkspaceId();
            const actor = getPublicApiActorContext();

            let rawBody: unknown;
            try {
                rawBody = await request.json();
            } catch {
                rawBody = {};
            }

            // Validate against public service location update schema
            const validated = updatePublicServiceLocationSchema.parse(rawBody);

            // Delegate to domain service
            const updated = await withTenantScope(
                (wsId) => updateServiceLocation(wsId, customerId, locationId, validated, actor),
            );

            const publicDto = toPublicServiceLocationDto(updated);

            return jsonSuccess(publicDto);
        } catch (error) {
            return handleCustomerPublicApiError(error);
        }
    }),
    {
        requiredScopes: [PUBLIC_API_SCOPES.CUSTOMERS_WRITE],
    },
);
