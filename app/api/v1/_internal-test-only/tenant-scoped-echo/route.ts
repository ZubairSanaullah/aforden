import {
    jsonSuccess,
    jsonError,
    withPublicApiAuth,
    getAuthenticatedApiContext,
    getAuthenticatedWorkspaceId,
    withTenantScope,
    PUBLIC_API_SCOPES,
} from "@/lib/publicApi";

/**
 * ----------------------------------------------------------------------------
 * TEST-ONLY FIXTURE ROUTE — NOT FOR PRODUCTION BUSINESS DATA CONSUMPTION
 * ----------------------------------------------------------------------------
 * Location: /api/v1/_internal-test-only/tenant-scoped-echo
 *
 * Demonstrates and verifies:
 * 1. Strict tenant resolution from verified API key context.
 * 2. Complete rejection and ignorance of caller-supplied workspaceId overrides.
 * 3. Standardized 404 NOT_FOUND error behavior on cross-tenant resource lookups
 *    (enumeration resistance).
 */

export interface MockTenantResource {
    id: string;
    name: string;
    workspaceId: string;
}

// In-memory mock registry of tenant-partitioned items for cross-tenant testing
export const MOCK_TENANT_RESOURCES: Map<string, MockTenantResource> = new Map();

export function registerMockTenantResource(resource: MockTenantResource): void {
    MOCK_TENANT_RESOURCES.set(resource.id, resource);
}

export function clearMockTenantResources(): void {
    MOCK_TENANT_RESOURCES.clear();
}

export const GET = withPublicApiAuth(
    async (request: Request) => {
        const auth = getAuthenticatedApiContext();
        const verifiedWorkspaceId = getAuthenticatedWorkspaceId();

        const url = new URL(request.url);
        const resourceId = url.searchParams.get("resourceId");

        // If a resourceId query is requested, simulate tenant-partitioned resource lookup
        if (resourceId) {
            const resource = await withTenantScope(async (scopedWsId) => {
                const item = MOCK_TENANT_RESOURCES.get(resourceId);
                if (!item || item.workspaceId !== scopedWsId) {
                    return null;
                }
                return item;
            });

            if (!resource) {
                // Return uniform 404 NOT_FOUND regardless of whether the resource
                // doesn't exist or exists in a different workspace.
                return jsonError("NOT_FOUND", "Resource not found.", {
                    status: 404,
                });
            }

            return jsonSuccess(resource);
        }

        // Standard tenant echo response
        return jsonSuccess({
            status: "ok",
            resolvedWorkspaceId: verifiedWorkspaceId,
            developerApplicationId: auth.developerApplicationId,
            environment: auth.environment,
            callerSuppliedParametersIgnored: {
                queryWorkspaceId:
                    url.searchParams.get("workspaceId") ||
                    url.searchParams.get("workspace_id"),
                headerWorkspaceId:
                    request.headers.get("x-workspace-id") ||
                    request.headers.get("workspace-id"),
            },
        });
    },
    {
        requiredScopes: [PUBLIC_API_SCOPES.PING_READ],
    },
);

export const POST = withPublicApiAuth(
    async (request: Request) => {
        let body: any = {};
        try {
            body = await request.json();
        } catch {
            body = {};
        }

        // Domain service call wrapped with withTenantScope
        const echoedResult = await withTenantScope(async (scopedWorkspaceId, payload) => {
            return {
                enforcedWorkspaceId: scopedWorkspaceId,
                action: "created_in_authenticated_tenant",
                receivedPayload: payload,
            };
        }, body);

        return jsonSuccess(echoedResult, { status: 201 });
    },
    {
        requiredScopes: [PUBLIC_API_SCOPES.PING_READ],
    },
);
