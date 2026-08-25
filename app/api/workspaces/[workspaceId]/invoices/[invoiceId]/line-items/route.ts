import { NextResponse } from "next/server";
import { addInvoiceLineItem } from "@/lib/services/invoice";
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
 * POST /api/workspaces/[workspaceId]/invoices/[invoiceId]/line-items
 * Adds a line item to a DRAFT invoice and recalculates totals.
 */
export async function POST(request: Request, context: RouteContext) {
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

        const invoice = await addInvoiceLineItem(workspaceId, invoiceId, body);

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
            "POST /invoices/[invoiceId]/line-items",
        );
    }
}
