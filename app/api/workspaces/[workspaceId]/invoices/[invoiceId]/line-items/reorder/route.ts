import { NextResponse } from "next/server";
import { reorderInvoiceLineItems } from "@/lib/services/invoice";
import {
    resolveWorkspaceId,
    handleInvoiceApiError,
} from "@/lib/utils/invoiceApiError";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
        invoiceId: string;
    }>;
}

/**
 * PUT /api/workspaces/[workspaceId]/invoices/[invoiceId]/line-items/reorder
 * POST /api/workspaces/[workspaceId]/invoices/[invoiceId]/line-items/reorder
 * Reorders line items on a DRAFT invoice.
 */
async function handleReorder(request: Request, context: RouteContext) {
    try {
        const { workspaceId: pathWorkspaceId, invoiceId } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const body = await request.json().catch(() => {
            throw new SyntaxError("Invalid JSON in request body.");
        });

        const invoice = await reorderInvoiceLineItems(
            workspaceId,
            invoiceId,
            body,
        );

        return NextResponse.json(
            {
                success: true,
                data: invoice,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleInvoiceApiError(
            error,
            "PUT /invoices/[invoiceId]/line-items/reorder",
        );
    }
}

export { handleReorder as PUT, handleReorder as POST };
