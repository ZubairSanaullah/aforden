/**
 * Phase 1.17.9 — Integration API Error & Sanitization Utilities
 * Handles workspace ID extraction, credential masking (zero secret leakage),
 * payload redaction, and standardized REST error envelopes.
 */

import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authorizationErrorResponse } from "@/lib/services/authorization/authorizationResponse";
import {
  IntegrationDomainError,
  ConnectionNotFoundError,
  AdapterNotRegisteredError,
  ExclusiveCapabilityConflictError,
  AdapterCapabilityMismatchError,
} from "@/lib/integrations/integrationErrors";
import {
  PlanFeatureNotEnabledError,
  QuotaExceededError,
} from "@/lib/services/billing/billingErrors";

export {
  ConnectionNotFoundError,
  AdapterNotRegisteredError,
  ExclusiveCapabilityConflictError,
  AdapterCapabilityMismatchError,
};

export class IntegrationNotFoundError extends Error {
  constructor(public readonly integrationId: string) {
    super(`Integration '${integrationId}' does not exist in catalog.`);
    this.name = "IntegrationNotFoundError";
  }
}

/**
 * Extracts the tenant workspace ID from route context params, standard headers, or query parameters.
 */
export function extractWorkspaceId(
  request: Request,
  pathWorkspaceId?: string
): string | null {
  if (pathWorkspaceId && pathWorkspaceId.trim().length > 0) {
    return pathWorkspaceId.trim();
  }

  const headerX = request.headers.get("x-workspace-id")?.trim();
  if (headerX) return headerX;

  const header = request.headers.get("workspace-id")?.trim();
  if (header) return header;

  try {
    const queryParam = new URL(request.url).searchParams.get("workspaceId")?.trim();
    if (queryParam) return queryParam;
  } catch {
    // Fallback for relative or malformed URLs
  }

  return null;
}

/**
 * Resolves the tenant workspace ID or returns a standardized 400 MISSING_WORKSPACE response.
 */
export function resolveWorkspaceId(
  request: Request,
  pathWorkspaceId?: string
):
  | { workspaceId: string; errorResponse?: never }
  | { workspaceId?: never; errorResponse: NextResponse } {
  const workspaceId = extractWorkspaceId(request, pathWorkspaceId);
  if (!workspaceId) {
    return {
      errorResponse: NextResponse.json(
        {
          success: false,
          error: {
            code: "MISSING_WORKSPACE",
            message: "Workspace ID is required.",
          },
        },
        { status: 400 }
      ),
    };
  }
  return { workspaceId };
}

const SENSITIVE_KEYS = new Set([
  "apikey",
  "api_key",
  "xapikey",
  "x_api_key",
  "secret",
  "secretkey",
  "secret_key",
  "clientsecret",
  "client_secret",
  "authtoken",
  "auth_token",
  "password",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "token",
  "authorization",
  "privatekey",
  "private_key",
  "secretpayload",
  "secret_payload",
  "encrypteddata",
  "encrypted_data",
  "iv",
  "tag",
  "encrypteddek",
  "stripesecret",
  "stripe_secret",
  "webhooksigningkey",
  "webhook_signing_key",
  "webhooksecret",
  "webhook_secret",
  "signingsecret",
  "signing_secret",
]);

/**
 * Recursively masks sensitive fields in request/response payloads with [REDACTED].
 */
export function sanitizePayload(payload: unknown): unknown {
  if (payload === null || payload === undefined) {
    return payload;
  }

  if (typeof payload !== "object") {
    return payload;
  }

  if (Array.isArray(payload)) {
    return payload.map((item) => sanitizePayload(item));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    const lower = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (SENSITIVE_KEYS.has(lower) || SENSITIVE_KEYS.has(key.toLowerCase())) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      result[key] = sanitizePayload(value);
    } else {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Masks an IntegrationCredential record to prevent secret leakage per Phase 1.17.1 §4.3.
 */
export function maskCredentialSummary(credential: Record<string, unknown>): Record<string, unknown> {
  return {
    id: credential.id,
    version: credential.version,
    status: credential.status,
    keyVaultProvider: credential.keyVaultProvider,
    algorithm: credential.algorithm,
    fingerprint: credential.fingerprint,
    expiresAt: credential.expiresAt,
    createdAt: credential.createdAt,
    updatedAt: credential.updatedAt,
  };
}

/**
 * Unified error mapper for the Integration Management REST API.
 */
export function handleIntegrationApiError(
  error: unknown,
  _context?: string
): NextResponse {
  // 1. Authorization & Workspace Access Errors
  const authResponse = authorizationErrorResponse(error);
  if (authResponse) {
    return authResponse;
  }

  // 2. Zod Validation Errors (400)
  if (error instanceof ZodError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          details: error.issues.map((issue) => ({
            field: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      { status: 400 }
    );
  }

  // 3. Syntax / JSON parse error (400)
  if (error instanceof SyntaxError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INVALID_JSON",
          message: error.message || "Invalid JSON in request body.",
        },
      },
      { status: 400 }
    );
  }

  // 4. Resource Not Found Errors (404)
  if (error instanceof IntegrationNotFoundError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTEGRATION_NOT_FOUND",
          message: error.message,
        },
      },
      { status: 404 }
    );
  }

  if (error instanceof ConnectionNotFoundError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "CONNECTION_NOT_FOUND",
          message: error.message,
        },
      },
      { status: 404 }
    );
  }

  // 5. Exclusive Capability Conflict (409)
  if (error instanceof ExclusiveCapabilityConflictError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "EXCLUSIVE_CAPABILITY_CONFLICT",
          message: error.message,
          capability: error.context?.capability,
          existingConnectionId: error.context?.existingConnectionId,
          attemptedConnectionId: error.context?.attemptedConnectionId,
        },
      },
      { status: 409 }
    );
  }

  // 6. Adapter Registration Errors
  if (error instanceof AdapterNotRegisteredError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "ADAPTER_NOT_REGISTERED",
          message: error.message,
        },
      },
      { status: 500 }
    );
  }

  if (error instanceof AdapterCapabilityMismatchError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "ADAPTER_CAPABILITY_MISMATCH",
          message: error.message,
        },
      },
      { status: 500 }
    );
  }

  // 7. Entitlement & Quota Errors (402)
  if (error instanceof PlanFeatureNotEnabledError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "PLAN_FEATURE_NOT_ENABLED",
          message: error.message,
        },
      },
      { status: 402 }
    );
  }

  if (error instanceof QuotaExceededError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "QUOTA_EXCEEDED",
          message: error.message,
        },
      },
      { status: 402 }
    );
  }

  // 8. General IntegrationDomainError (400/409/500)
  if (error instanceof IntegrationDomainError) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: error.code || "INTEGRATION_ERROR",
          message: error.message,
        },
      },
      { status: error.statusCode || 400 }
    );
  }

  // 9. Unhandled Internal Server Errors (500) - Sanitized
  if (_context) {
    console.error(`[Integration API Error] [${_context}]:`, error);
  } else {
    console.error("[Integration API Error]:", error);
  }

  return NextResponse.json(
    {
      success: false,
      error: {
        code: "INTERNAL_SERVER_ERROR",
        message: "An unexpected error occurred while processing the integration request.",
      },
    },
    { status: 500 }
  );
}
