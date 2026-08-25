import { NextResponse } from "next/server";
import { createInvoiceFromQuote } from "@/lib/services/invoice";
import {
    resolveWorkspaceId,
    handleInvoiceApiError,
} from "@/lib/utils/invoiceApiError";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
        quoteId: string;
    }>;
}

/**
 * POST /api/workspaces/[workspaceId]/invoices/from-quote/[quoteId]
 * Converts an APPROVED or CONVERTED quote into a new DRAFT invoice.
 */
export async function POST(request: Request, context: RouteContext) {
    try {
        const { workspaceId: pathWorkspaceId, quoteId } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const body = await request.json().catch(() => ({}));

        const invoice = await createInvoiceFromQuote(
            workspaceId,
            quoteId,
            body,
        );

        return NextResponse.json(
            {
                success: true,
                data: invoice,
            },
            { status: 201 },
        );
    } catch (error) {
        return handleInvoiceApiError(
            error,
            "POST /invoices/from-quote/[quoteId]",
        );
    }
}
