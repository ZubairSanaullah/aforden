import { NextResponse } from "next/server";
import { getCustomerOutstandingBalance } from "@/lib/services/invoice";
import {
    resolveWorkspaceId,
    handleInvoiceApiError,
} from "@/lib/utils/invoiceApiError";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
        customerId: string;
    }>;
}

/**
 * GET /api/workspaces/[workspaceId]/customers/[customerId]/balance
 * Returns the total outstanding unpaid balance across all non-DRAFT, non-VOID invoices for a customer.
 */
export async function GET(request: Request, context: RouteContext) {
    try {
        const {
            workspaceId: pathWorkspaceId,
            customerId,
        } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const balance = await getCustomerOutstandingBalance(
            workspaceId,
            customerId,
        );

        return NextResponse.json(
            {
                success: true,
                data: balance,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleInvoiceApiError(
            error,
            "GET /customers/[customerId]/balance",
        );
    }
}
