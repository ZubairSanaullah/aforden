import {
    jsonSuccess,
    withPublicApiAuth,
    getAuthenticatedWorkspaceId,
    withTenantScope,
    PUBLIC_API_SCOPES,
} from "@/lib/publicApi";
import { getPublicApiActorContext } from "@/lib/publicApi/actor";
import {
    getWorkOrder,
    updateWorkOrder,
} from "@/lib/services/workOrder";
import { toPublicWorkOrderDto } from "@/lib/publicApi/workOrders/workOrderDto";
import { publicUpdateWorkOrderSchema } from "@/lib/publicApi/workOrders/workOrderValidation";
import { handleWorkOrderPublicApiError } from "@/lib/publicApi/workOrders/workOrderErrorHandler";

interface RouteContext {
    params: Promise<{ id: string }> | { id: string };
}

/**
 * GET /api/v1/work-orders/:id
 *
 * Fetch single work order details by ID within the authorized workspace.
 * Requires `work_orders:read` scope.
 */
export const GET = withPublicApiAuth(
    async (request: Request, context: RouteContext) => {
        try {
            const params = await context.params;
            const workOrderId = params.id;

            const workspaceId = getAuthenticatedWorkspaceId();
            const actor = getPublicApiActorContext();

            // Sourced exclusively within tenant scope
            const workOrder = await withTenantScope(
                (wsId) => getWorkOrder(wsId, workOrderId, actor),
            );

            const publicDto = toPublicWorkOrderDto(workOrder);

            return jsonSuccess(publicDto);
        } catch (error) {
            return handleWorkOrderPublicApiError(error);
        }
    },
    {
        requiredScopes: [PUBLIC_API_SCOPES.WORK_ORDERS_READ],
    },
);

/**
 * PATCH /api/v1/work-orders/:id
 *
 * Atomically update mutable fields on an existing work order.
 * Requires `work_orders:write` scope.
 */
export const PATCH = withPublicApiAuth(
    async (request: Request, context: RouteContext) => {
        try {
            const params = await context.params;
            const workOrderId = params.id;

            const workspaceId = getAuthenticatedWorkspaceId();
            const actor = getPublicApiActorContext();

            let rawBody: unknown;
            try {
                rawBody = await request.json();
            } catch {
                rawBody = {};
            }

            // Validate against public patch schema
            const validated = publicUpdateWorkOrderSchema.parse(rawBody);

            // Delegate to domain service
            const updated = await withTenantScope(
                (wsId) => updateWorkOrder(wsId, workOrderId, validated, actor),
            );

            const publicDto = toPublicWorkOrderDto(updated);

            return jsonSuccess(publicDto);
        } catch (error) {
            return handleWorkOrderPublicApiError(error);
        }
    },
    {
        requiredScopes: [PUBLIC_API_SCOPES.WORK_ORDERS_WRITE],
    },
);
