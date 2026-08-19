import { NextResponse } from "next/server";
import { getCustomerContacts, createCustomerContact } from "@/lib/services/customer";
import { handleCustomerContactApiError } from "@/lib/utils/customerApiError";

interface RouteContext {
    params: Promise<{
        customerId: string;
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
 * GET /api/customers/[customerId]/contacts
 *
 * Lists paginated, filtered, and sorted CustomerContacts for a Customer.
 */
export async function GET(
    request: Request,
    context: RouteContext,
) {
    try {
        const { customerId } = await context.params;
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

        const url = new URL(request.url);
        const searchParams = url.searchParams;
        const queryInput: Record<string, any> = {};

        if (searchParams.has("search")) queryInput.search = searchParams.get("search")!;
        if (searchParams.has("isPrimary")) queryInput.isPrimary = searchParams.get("isPrimary")!;
        if (searchParams.has("page")) queryInput.page = searchParams.get("page")!;
        if (searchParams.has("pageSize")) queryInput.pageSize = searchParams.get("pageSize")!;
        if (searchParams.has("sortBy")) queryInput.sortBy = searchParams.get("sortBy")!;
        if (searchParams.has("sortOrder")) queryInput.sortOrder = searchParams.get("sortOrder")!;

        const result = await getCustomerContacts(workspaceId, customerId, queryInput);

        return NextResponse.json(
            {
                success: true,
                data: result,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleCustomerContactApiError(error, "List customer contacts");
    }
}

/**
 * POST /api/customers/[customerId]/contacts
 *
 * Creates a new CustomerContact for a Customer.
 */
export async function POST(
    request: Request,
    context: RouteContext,
) {
    try {
        const { customerId } = await context.params;
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

        const body = await request.json().catch(() => {
            throw new SyntaxError("Invalid JSON in request body.");
        });

        const contact = await createCustomerContact(workspaceId, customerId, body);

        return NextResponse.json(
            {
                success: true,
                data: contact,
            },
            { status: 201 },
        );
    } catch (error) {
        return handleCustomerContactApiError(error, "Create customer contact");
    }
}
