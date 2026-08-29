import {
    jsonSuccess,
    withPublicApiAuth,
    getAuthenticatedWorkspaceId,
    withTenantScope,
    PUBLIC_API_SCOPES,
} from "@/lib/publicApi";
import { getPublicApiActorContext } from "@/lib/publicApi/actor";
import { getInvoice } from "@/lib/services/invoice/getInvoice";
import { toPublicInvoiceDto } from "@/lib/publicApi/invoices/invoiceDto";
import { handleInvoicePublicApiError } from "@/lib/publicApi/invoices/invoiceErrorHandler";

interface RouteContext {
    params: Promise<{ id: string }> | { id: string };
}

/**
 * GET /api/v1/invoices/:id
 *
 * Fetch details of a single invoice with its line items and calculated balances.
 * Requires `invoices:read` scope.
 */
export const GET = withPublicApiAuth(
    async (request: Request, context: RouteContext) => {
        try {
            const params = await context.params;
            const invoiceId = params.id;

            const workspaceId = getAuthenticatedWorkspaceId();
            const actor = getPublicApiActorContext("DISPATCHER");

            const invoice = await withTenantScope(
                (wsId) => getInvoice(wsId, invoiceId, actor),
            );

            const publicDto = toPublicInvoiceDto(invoice);

            return jsonSuccess(publicDto);
        } catch (error) {
            return handleInvoicePublicApiError(error);
        }
    },
    {
        requiredScopes: [PUBLIC_API_SCOPES.INVOICES_READ],
    },
);
