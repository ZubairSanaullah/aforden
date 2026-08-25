import { NextResponse } from "next/server";
import { createInvoiceFromWorkOrder } from "@/lib/services/invoice";
import {
    resolveWorkspaceId,
    handleInvoiceApiError,
} from "@/lib/utils/invoiceApiError";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
        workOrderId: string;
    }>;
}

/**
 * POST /api/workspaces/[workspaceId]/invoices/from-work-order/[workOrderId]
 * Converts a COMPLETED work order into a new DRAFT invoice.
 */
export async function POST(request: Request, context: RouteContext) {
    try {
        const {
            workspaceId: pathWorkspaceId,
            workOrderId,
        } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const body = await request.json().catch(() => ({}));

        const invoice = await createInvoiceFromWorkOrder(
            workspaceId,
            workOrderId,
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
            "POST /invoices/from-work-order/[workOrderId]",
        );
    }
}
