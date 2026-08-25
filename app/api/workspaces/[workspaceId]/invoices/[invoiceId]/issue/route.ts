import { NextResponse } from "next/server";
import { issueInvoice } from "@/lib/services/invoice";
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
 * POST /api/workspaces/[workspaceId]/invoices/[invoiceId]/issue
 * Issues a DRAFT invoice, transitioning it to ISSUED.
 */
export async function POST(request: Request, context: RouteContext) {
    try {
        const { workspaceId: pathWorkspaceId, invoiceId } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const invoice = await issueInvoice(workspaceId, invoiceId);

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
            "POST /invoices/[invoiceId]/issue",
        );
    }
}
