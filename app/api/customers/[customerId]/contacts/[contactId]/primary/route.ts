import { NextResponse } from "next/server";
import { setPrimaryCustomerContact } from "@/lib/services/customer";
import { handleCustomerContactApiError } from "@/lib/utils/customerApiError";

interface RouteContext {
    params: Promise<{
        customerId: string;
        contactId: string;
    }>;
}

function extractWorkspaceId(request: Request): string | null {
    return (
        request.headers.get("x-workspace-id") ||
        request.headers.get("workspace-id") ||
        new URL(request.url).searchParams.get("workspaceId") ||
        null
    );
}

/**
 * POST /api/customers/[customerId]/contacts/[contactId]/primary
 *
 * Sets the specified CustomerContact as the primary contact for the Customer.
 */
export async function POST(
    request: Request,
    context: RouteContext,
) {
    try {
        const { customerId, contactId } = await context.params;
        const workspaceId = extractWorkspaceId(request);

        if (!workspaceId) {
            return NextResponse.json(
                {
                    success: false,
                    error: {
                        code: "MISSING_WORKSPACE",
                        message: "Workspace ID is required.",
                    },
                },
                { status: 400 },
            );
        }

        const contact = await setPrimaryCustomerContact(workspaceId, customerId, contactId);

        return NextResponse.json(
            {
                success: true,
                data: contact,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleCustomerContactApiError(error, "Set primary customer contact");
    }
}
