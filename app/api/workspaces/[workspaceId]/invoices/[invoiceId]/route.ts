import { NextResponse } from "next/server";
import {
    getInvoice,
    updateInvoice,
    deleteInvoice,
} from "@/lib/services/invoice";
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
 * GET /api/workspaces/[workspaceId]/invoices/[invoiceId]
 * Fetches a single invoice by ID with line items and payments.
 */
export async function GET(request: Request, context: RouteContext) {
    try {
        const { workspaceId: pathWorkspaceId, invoiceId } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const invoice = await getInvoice(workspaceId, invoiceId);

        return NextResponse.json(
            {
                success: true,
                data: invoice,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleInvoiceApiError(error, "GET /invoices/[invoiceId]");
    }
}

/**
 * PATCH /api/workspaces/[workspaceId]/invoices/[invoiceId]
 * Updates fields and discounts on a DRAFT invoice.
 */
export async function PATCH(request: Request, context: RouteContext) {
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

        const invoice = await updateInvoice(workspaceId, invoiceId, body);

        return NextResponse.json(
            {
                success: true,
                data: invoice,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleInvoiceApiError(error, "PATCH /invoices/[invoiceId]");
    }
}

/**
 * DELETE /api/workspaces/[workspaceId]/invoices/[invoiceId]
 * Deletes a DRAFT invoice and its line items.
 */
export async function DELETE(request: Request, context: RouteContext) {
    try {
        const { workspaceId: pathWorkspaceId, invoiceId } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        await deleteInvoice(workspaceId, invoiceId);

        return NextResponse.json(
            {
                success: true,
                data: { deleted: true },
            },
            { status: 200 },
        );
    } catch (error) {
        return handleInvoiceApiError(error, "DELETE /invoices/[invoiceId]");
    }
}
