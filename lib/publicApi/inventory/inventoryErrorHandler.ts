import { ZodError } from "zod";
import { jsonError } from "@/lib/publicApi/envelope";
import { PartNotFoundError } from "@/lib/services/inventory/part/partErrors";
import { InventoryLocationNotFoundError } from "@/lib/services/inventory/inventoryLocation/inventoryLocationErrors";

export function handleInventoryPublicApiError(
    error: unknown,
    requestId?: string,
): Response {
    if (error instanceof ZodError) {
        const details = error.issues.map((issue) => ({
            field: issue.path.join("."),
            issue: issue.code.toUpperCase(),
            message: issue.message,
        }));

        return jsonError(
            "VALIDATION_ERROR",
            "The request query parameters failed validation constraints.",
            {
                status: 422,
                details,
                requestId,
            },
        );
    }

    if (error instanceof PartNotFoundError) {
        return jsonError("NOT_FOUND", "Part not found.", {
            status: 404,
            requestId,
        });
    }

    if (error instanceof InventoryLocationNotFoundError) {
        return jsonError("NOT_FOUND", "Inventory location not found.", {
            status: 404,
            requestId,
        });
    }

    throw error;
}
