/**
 * Canonical 9-Code Public API Error Taxonomy.
 * Locked in Phase 1.18.1 Architecture Specification Section 7.
 */

export const PUBLIC_ERROR_CODES = {
    UNAUTHORIZED: "UNAUTHORIZED",
    FORBIDDEN: "FORBIDDEN",
    VALIDATION_ERROR: "VALIDATION_ERROR",
    NOT_FOUND: "NOT_FOUND",
    CONFLICT: "CONFLICT",
    RATE_LIMITED: "RATE_LIMITED",
    IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
    API_VERSION_UNSUPPORTED: "API_VERSION_UNSUPPORTED",
    INTERNAL_SERVER_ERROR: "INTERNAL_SERVER_ERROR",
} as const;

export type PublicErrorCode =
    (typeof PUBLIC_ERROR_CODES)[keyof typeof PUBLIC_ERROR_CODES];

export const PUBLIC_ERROR_STATUS_MAP: Record<PublicErrorCode, number> = {
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    VALIDATION_ERROR: 422,
    NOT_FOUND: 404,
    CONFLICT: 409,
    RATE_LIMITED: 429,
    IDEMPOTENCY_CONFLICT: 409,
    API_VERSION_UNSUPPORTED: 404,
    INTERNAL_SERVER_ERROR: 500,
};

export const STATUS_TO_PUBLIC_ERROR_MAP: Record<number, PublicErrorCode> = {
    400: "VALIDATION_ERROR",
    401: "UNAUTHORIZED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    409: "CONFLICT",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMITED",
    500: "INTERNAL_SERVER_ERROR",
    502: "INTERNAL_SERVER_ERROR",
    503: "INTERNAL_SERVER_ERROR",
    504: "INTERNAL_SERVER_ERROR",
};


export interface PublicErrorDetail {
    field?: string;
    issue: string;
    message: string;
}

export interface PublicErrorPayload {
    code: PublicErrorCode;
    message: string;
    details?: PublicErrorDetail[];
    requestId: string;
    documentationUrl?: string;
}

/**
 * Returns the default documentation URL for a given public error code.
 */
export function getErrorDocumentationUrl(code: PublicErrorCode): string {
    return `https://docs.aforden.com/api/errors#${code}`;
}

/**
 * Base custom error class for Public API domain and contract errors.
 */
export class PublicApiError extends Error {
    readonly code: PublicErrorCode;
    readonly statusCode: number;
    readonly details?: PublicErrorDetail[];
    readonly documentationUrl?: string;

    constructor(
        code: PublicErrorCode,
        message: string,
        options?: {
            statusCode?: number;
            details?: PublicErrorDetail[];
            documentationUrl?: string;
        },
    ) {
        super(message);
        this.name = "PublicApiError";
        this.code = code;
        this.statusCode = options?.statusCode ?? PUBLIC_ERROR_STATUS_MAP[code];
        this.details = options?.details;
        this.documentationUrl =
            options?.documentationUrl ?? getErrorDocumentationUrl(code);
    }
}
