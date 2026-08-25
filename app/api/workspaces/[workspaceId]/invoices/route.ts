import { NextResponse } from "next/server";
import {
    listInvoices,
    createInvoice,
} from "@/lib/services/invoice";
import {
    resolveWorkspaceId,
    extractQueryParams,
    handleInvoiceApiError,
} from "@/lib/utils/invoiceApiError";

interface RouteContext {
    params: Promise<{
        workspaceId: string;
    }>;
}

/**
 * GET /api/workspaces/[workspaceId]/invoices
 * Lists paginated, filtered, searched, and sorted Invoices for the workspace.
 */
export async function GET(request: Request, context: RouteContext) {
    try {
        const { workspaceId: pathWorkspaceId } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const query = extractQueryParams(request);
        const result = await listInvoices(workspaceId, query);

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleInvoiceApiError(error, "GET /invoices");
    }
}

/**
 * POST /api/workspaces/[workspaceId]/invoices
 * Creates a new DRAFT Invoice under the workspace.
 */
export async function POST(request: Request, context: RouteContext) {
    try {
        const { workspaceId: pathWorkspaceId } = await context.params;
        const { workspaceId, errorResponse } = resolveWorkspaceId(
            request,
            pathWorkspaceId,
        );
        if (errorResponse) return errorResponse;

        const body = await request.json().catch(() => {
            throw new SyntaxError("Invalid JSON in request body.");
        });

        const invoice = await createInvoice(workspaceId, body);

        return NextResponse.json(
            {
                success: true,
                data: invoice,
            },
            { status: 201 },
        );
    } catch (error) {
        return handleInvoiceApiError(error, "POST /invoices");
    }
}
