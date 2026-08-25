import { NextResponse } from "next/server";
import { voidPayment } from "@/lib/services/invoice";
import {
    resolveWorkspaceId,
    handleInvoiceApiError,
} from "@/lib/utils/invoiceApiError";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
        paymentId: string;
    }>;
}

/**
 * POST /api/workspaces/[workspaceId]/payments/[paymentId]/void
 * Voids a recorded payment and automatically reconciles the parent invoice balances.
 */
export async function POST(request: Request, context: RouteContext) {
    try {
        const { workspaceId: pathWorkspaceId, paymentId } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const body = await request.json().catch(() => {
            throw new SyntaxError("Invalid JSON in request body.");
        });

        const payment = await voidPayment(
            workspaceId,
            paymentId,
            body?.reason,
        );

        return NextResponse.json(
            {
                success: true,
                data: payment,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleInvoiceApiError(
            error,
            "POST /payments/[paymentId]/void",
        );
    }
}
