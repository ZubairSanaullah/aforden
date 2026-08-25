import { NextResponse } from "next/server";
import { getInvoiceHistory } from "@/lib/services/invoice";
import {
    resolveWorkspaceId,
    extractQueryParams,
    handleInvoiceApiError,
} from "@/lib/utils/invoiceApiError";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
        invoiceId: string;
    }>;
}

/**
 * GET /api/workspaces/[workspaceId]/invoices/[invoiceId]/history
 * Returns the chronological lifecycle audit history for a single invoice.
 */
export async function GET(request: Request, context: RouteContext) {
    try {
        const { workspaceId: pathWorkspaceId, invoiceId } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const query = extractQueryParams(request);
        const history = await getInvoiceHistory(
            workspaceId,
            invoiceId,
            undefined,
            query,
        );

        return NextResponse.json(
            {
                success: true,
                data: history,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleInvoiceApiError(
            error,
            "GET /invoices/[invoiceId]/history",
        );
    }
}
