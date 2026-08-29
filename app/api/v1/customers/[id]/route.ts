import {
    jsonSuccess,
    withPublicApiAuth,
    getAuthenticatedWorkspaceId,
    withTenantScope,
    PUBLIC_API_SCOPES,
} from "@/lib/publicApi";
import { getPublicApiActorContext } from "@/lib/publicApi/actor";
import {
    getCustomer,
    updateCustomer,
} from "@/lib/services/customer";
import { CustomerNotFoundError } from "@/lib/services/customer/customerErrors";
import { toPublicCustomerDto } from "@/lib/publicApi/customers/customerDto";
import { updatePublicCustomerSchema } from "@/lib/publicApi/customers/customerValidation";
import { handleCustomerPublicApiError } from "@/lib/publicApi/customers/customerErrorHandler";

interface RouteContext {
    params: Promise<{ id: string }> | { id: string };
}

/**
 * GET /api/v1/customers/:id
 *
 * Fetch single customer details by ID within the authorized workspace.
 * Requires `customers:read` scope.
 */
export const GET = withPublicApiAuth(
    async (request: Request, context: RouteContext) => {
        try {
            const params = await context.params;
            const customerId = params.id;

            const workspaceId = getAuthenticatedWorkspaceId();
            const actor = getPublicApiActorContext();

            // Sourced exclusively within tenant scope
            const customer = await withTenantScope(
                (wsId) => getCustomer(wsId, customerId, actor),
            );

            if (!customer) {
                throw new CustomerNotFoundError();
            }

            const publicDto = toPublicCustomerDto(customer);

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
 * PATCH /api/v1/customers/:id
 *
 * Atomically update mutable profile fields on an existing customer.
 * Requires `customers:write` scope.
 */
export const PATCH = withPublicApiAuth(
    async (request: Request, context: RouteContext) => {
        try {
            const params = await context.params;
            const customerId = params.id;

            const workspaceId = getAuthenticatedWorkspaceId();
            const actor = getPublicApiActorContext();

            let rawBody: unknown;
            try {
                rawBody = await request.json();
            } catch {
                rawBody = {};
            }

            // Validate against public customer update schema
            const validated = updatePublicCustomerSchema.parse(rawBody);

            // Delegate to domain service
            const updated = await withTenantScope(
                (wsId) => updateCustomer(wsId, customerId, validated, actor),
            );

            const publicDto = toPublicCustomerDto(updated);

            return jsonSuccess(publicDto);
        } catch (error) {
            return handleCustomerPublicApiError(error);
        }
    },
    {
        requiredScopes: [PUBLIC_API_SCOPES.CUSTOMERS_WRITE],
    },
);
