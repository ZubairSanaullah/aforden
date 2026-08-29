import {
    jsonSuccess,
    withPublicApiAuth,
    getAuthenticatedWorkspaceId,
    withTenantScope,
    PUBLIC_API_SCOPES,
} from "@/lib/publicApi";
import { getPublicApiActorContext } from "@/lib/publicApi/actor";
import { getQuote } from "@/lib/services/quote/getQuote";
import { toPublicQuoteDto } from "@/lib/publicApi/quotes/quoteDto";
import { handleQuotePublicApiError } from "@/lib/publicApi/quotes/quoteErrorHandler";

interface RouteContext {
    params: Promise<{ id: string }> | { id: string };
}

/**
 * GET /api/v1/quotes/:id
 *
 * Fetch details of a single quote with its line items.
 * Requires `quotes:read` scope.
 */
export const GET = withPublicApiAuth(
    async (request: Request, context: RouteContext) => {
        try {
            const params = await context.params;
            const quoteId = params.id;

            const workspaceId = getAuthenticatedWorkspaceId();
            const actor = getPublicApiActorContext("DISPATCHER");

            const quote = await withTenantScope(
                (wsId) => getQuote(wsId, quoteId, actor),
            );

            const publicDto = toPublicQuoteDto(quote);

            return jsonSuccess(publicDto);
        } catch (error) {
            return handleQuotePublicApiError(error);
        }
    },
    {
        requiredScopes: [PUBLIC_API_SCOPES.QUOTES_READ],
    },
);
