import { NextResponse } from "next/server";
import {
    PublicErrorCode,
    PublicErrorDetail,
    PublicErrorPayload,
    PUBLIC_ERROR_STATUS_MAP,
    getErrorDocumentationUrl,
} from "./errors";
import { REQUEST_ID_HEADER_NAME, generateRequestId } from "./requestId";

export interface PaginationMeta {
    hasMore: boolean;
    limit: number;
    nextCursor: string | null;
    prevCursor?: string | null;
}

export interface PublicSuccessEnvelope<T = any> {
    success: true;
    data: T;
    meta: {
        requestId: string;
        timestamp: string;
        pagination?: PaginationMeta;
        [key: string]: any;
    };
}

export interface PublicErrorEnvelope {
    success: false;
    error: PublicErrorPayload;
}

export type PublicEnvelope<T = any> =
    | PublicSuccessEnvelope<T>
    | PublicErrorEnvelope;

export interface SuccessEnvelopeOptions {
    meta?: Record<string, any>;
    pagination?: PaginationMeta;
    requestId?: string;
    timestamp?: string;
}

export interface ErrorEnvelopeOptions {
    details?: PublicErrorDetail[];
    requestId?: string;
    documentationUrl?: string;
}

// Pluggable request ID getter (allows Node AsyncLocalStorage context to inject active requestId without Edge runtime coupling)
let activeRequestIdGetter: (() => string | undefined) | null = null;

export function registerRequestIdGetter(getter: () => string | undefined) {
    activeRequestIdGetter = getter;
}

export function getCurrentRequestId(): string {
    return activeRequestIdGetter?.() || generateRequestId();
}

/**
 * Builds the canonical public success JSON envelope.
 */
export function successEnvelope<T>(
    data: T,
    options?: SuccessEnvelopeOptions,
): PublicSuccessEnvelope<T> {
    const requestId = options?.requestId || getCurrentRequestId();
    const timestamp = options?.timestamp || new Date().toISOString();

    const pagination = options?.pagination || options?.meta?.pagination;
    const { pagination: _, ...extraMeta } = options?.meta || {};

    return {
        success: true,
        data,
        meta: {
            requestId,
            timestamp,
            ...(pagination ? { pagination } : {}),
            ...extraMeta,
        },
    };
}

/**
 * Builds the canonical public error JSON envelope.
 */
export function errorEnvelope(
    code: PublicErrorCode,
    message: string,
    options?: ErrorEnvelopeOptions,
): PublicErrorEnvelope {
    const requestId = options?.requestId || getCurrentRequestId();
    const documentationUrl =
        options?.documentationUrl || getErrorDocumentationUrl(code);

    const errorPayload: PublicErrorPayload = {
        code,
        message,
        requestId,
        documentationUrl,
    };

    if (options?.details && options.details.length > 0) {
        errorPayload.details = options.details;
    }

    return {
        success: false,
        error: errorPayload,
    };
}

/**
 * Returns a standardized JSON Response containing the canonical success envelope.
 */
export function jsonSuccess<T>(
    data: T,
    options?: {
        status?: number;
        meta?: Record<string, any>;
        pagination?: PaginationMeta;
        headers?: HeadersInit;
        requestId?: string;
    },
): Response {
    const requestId = options?.requestId || getCurrentRequestId();
    const envelope = successEnvelope(data, {
        meta: options?.meta,
        pagination: options?.pagination,
        requestId,
    });

    const headers = new Headers(options?.headers);
    headers.set(REQUEST_ID_HEADER_NAME, requestId);
    headers.set("Content-Type", "application/json");

    return NextResponse.json(envelope, {
        status: options?.status ?? 200,
        headers,
    });
}

/**
 * Returns a standardized JSON Response containing the canonical error envelope.
 */
export function jsonError(
    code: PublicErrorCode,
    message: string,
    options?: {
        status?: number;
        details?: PublicErrorDetail[];
        headers?: HeadersInit;
        requestId?: string;
        documentationUrl?: string;
    },
): Response {
    const requestId = options?.requestId || getCurrentRequestId();
    const status = options?.status ?? PUBLIC_ERROR_STATUS_MAP[code] ?? 500;
    const envelope = errorEnvelope(code, message, {
        details: options?.details,
        requestId,
        documentationUrl: options?.documentationUrl,
    });

    const headers = new Headers(options?.headers);
    headers.set(REQUEST_ID_HEADER_NAME, requestId);
    headers.set("Content-Type", "application/json");
    headers.set("X-Aforden-Error-Code", code);

    return NextResponse.json(envelope, {
        status,
        headers,
    });
}
