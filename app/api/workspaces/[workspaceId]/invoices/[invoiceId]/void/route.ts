import { NextResponse } from "next/server";
import { voidInvoice } from "@/lib/services/invoice";
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
 * POST /api/workspaces/[workspaceId]/invoices/[invoiceId]/void
 * Voids an ISSUED, PARTIALLY_PAID, or OVERDUE invoice.
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

        const invoice = await voidInvoice(
            workspaceId,
            invoiceId,
            body?.reason,
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
            "POST /invoices/[invoiceId]/void",
        );
    }
}
