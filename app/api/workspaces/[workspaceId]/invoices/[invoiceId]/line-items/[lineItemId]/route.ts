import { NextResponse } from "next/server";
import {
    updateInvoiceLineItem,
    removeInvoiceLineItem,
} from "@/lib/services/invoice";
import {
    resolveWorkspaceId,
    handleInvoiceApiError,
} from "@/lib/utils/invoiceApiError";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
        invoiceId: string;
        lineItemId: string;
    }>;
}

/**
 * PATCH /api/workspaces/[workspaceId]/invoices/[invoiceId]/line-items/[lineItemId]
 * Updates a line item on a DRAFT invoice and recalculates totals.
 */
export async function PATCH(request: Request, context: RouteContext) {
    try {
        const {
            workspaceId: pathWorkspaceId,
            invoiceId,
            lineItemId,
        } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const body = await request.json().catch(() => {
            throw new SyntaxError("Invalid JSON in request body.");
        });

        const invoice = await updateInvoiceLineItem(
            workspaceId,
            invoiceId,
            lineItemId,
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
            "PATCH /invoices/[invoiceId]/line-items/[lineItemId]",
        );
    }
}

/**
 * DELETE /api/workspaces/[workspaceId]/invoices/[invoiceId]/line-items/[lineItemId]
 * Removes a line item from a DRAFT invoice and recalculates totals.
 */
export async function DELETE(request: Request, context: RouteContext) {
    try {
        const {
            workspaceId: pathWorkspaceId,
            invoiceId,
            lineItemId,
        } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const invoice = await removeInvoiceLineItem(
            workspaceId,
            invoiceId,
            lineItemId,
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
            "DELETE /invoices/[invoiceId]/line-items/[lineItemId]",
        );
    }
}
