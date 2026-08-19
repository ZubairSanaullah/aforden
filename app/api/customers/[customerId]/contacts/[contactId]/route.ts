import { NextResponse } from "next/server";
import {
    getCustomerContact,
    updateCustomerContact,
    deleteCustomerContact,
} from "@/lib/services/customer";
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
 * GET /api/customers/[customerId]/contacts/[contactId]
 *
 * Retrieves a single CustomerContact by ID.
 */
export async function GET(
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

        const contact = await getCustomerContact(workspaceId, customerId, contactId);

        if (!contact) {
            return NextResponse.json(
                {
                    success: false,
                    error: {
                        code: "CONTACT_NOT_FOUND",
                        message: "Customer contact not found.",
                    },
                },
                { status: 404 },
            );
        }

        return NextResponse.json(
            {
                success: true,
                data: contact,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleCustomerContactApiError(error, "Get customer contact");
    }
}

/**
 * PATCH /api/customers/[customerId]/contacts/[contactId]
 *
 * Updates an existing CustomerContact by ID.
 */
export async function PATCH(
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

        const body = await request.json().catch(() => {
            throw new SyntaxError("Invalid JSON in request body.");
        });

        const updated = await updateCustomerContact(workspaceId, customerId, contactId, body);

        return NextResponse.json(
            {
                success: true,
                data: updated,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleCustomerContactApiError(error, "Update customer contact");
    }
}

/**
 * DELETE /api/customers/[customerId]/contacts/[contactId]
 *
 * Hard deletes a CustomerContact by ID.
 */
export async function DELETE(
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

        const deleted = await deleteCustomerContact(workspaceId, customerId, contactId);

        return NextResponse.json(
            {
                success: true,
                data: deleted,
            },
            { status: 200 },
        );
    } catch (error) {
        return handleCustomerContactApiError(error, "Delete customer contact");
    }
}
