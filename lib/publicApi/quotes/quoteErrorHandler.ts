import { ZodError } from "zod";
import { jsonError } from "@/lib/publicApi/envelope";
import { QuoteNotFoundError } from "@/lib/services/quote/quoteErrors";
import { CustomerNotFoundError } from "@/lib/services/customer/customerErrors";

export function handleQuotePublicApiError(
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

    if (error instanceof QuoteNotFoundError) {
        return jsonError("NOT_FOUND", "Quote not found.", {
            status: 404,
            requestId,
        });
    }

    if (error instanceof CustomerNotFoundError) {
        return jsonError("NOT_FOUND", "Customer not found.", {
            status: 404,
            requestId,
        });
    }

    throw error;
}
