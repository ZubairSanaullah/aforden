import { NextResponse } from "next/server";
import {
    getInvoicePayments,
    recordPayment,
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
 * GET /api/workspaces/[workspaceId]/invoices/[invoiceId]/payments
 * Lists all payments recorded for this specific invoice.
 */
export async function GET(request: Request, context: RouteContext) {
    try {
        const { workspaceId: pathWorkspaceId, invoiceId } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const payments = await getInvoicePayments(workspaceId, invoiceId);

        return NextResponse.json(
            {
                success: true,
                data: payments,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleInvoiceApiError(
            error,
            "GET /invoices/[invoiceId]/payments",
        );
    }
}

/**
 * POST /api/workspaces/[workspaceId]/invoices/[invoiceId]/payments
 * Records a new payment against an invoice.
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

        const payment = await recordPayment(workspaceId, invoiceId, body);

        return NextResponse.json(
            {
                success: true,
                data: payment,
            },
            { status: 201 },
        );
    } catch (error) {
        return handleInvoiceApiError(
            error,
            "POST /invoices/[invoiceId]/payments",
        );
    }
}
