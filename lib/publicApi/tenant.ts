import { getAuthenticatedApiContext } from "./context";

/**
 * Retrieves the verified tenant workspaceId from the active authenticated context.
 *
 * MANDATORY ARCHITECTURAL RULE FOR ALL 1.18.7+ RESOURCE ENDPOINTS:
 * -----------------------------------------------------------------
 * 1. Every domain service call made from a public API route handler MUST source
 *    workspaceId exclusively from getAuthenticatedWorkspaceId() or withTenantScope().
 * 2. Route handlers MUST NEVER accept or trust workspaceId from caller inputs
 *    (e.g., query params ?workspaceId=..., body { workspaceId: "..." }, or headers).
 * 3. Any query for single resources that do not exist within the authenticated workspace
 *    MUST return HTTP 404 NOT_FOUND, never 403, preventing cross-tenant enumeration.
 */
export function getAuthenticatedWorkspaceId(): string {
    return getAuthenticatedApiContext().workspaceId;
}

/**
 * Higher-order utility that automatically injects the verified workspaceId from
 * the active authenticated context into a domain service invocation.
 *
 * Example:
 * ```ts
 * const workOrders = await withTenantScope(
 *     (workspaceId) => workOrderService.getWorkOrders(workspaceId, filters)
 * );
 * ```
 */
export async function withTenantScope<T, TArgs extends any[]>(
    serviceFn: (workspaceId: string, ...args: TArgs) => Promise<T> | T,
    ...args: TArgs
): Promise<T> {
    const workspaceId = getAuthenticatedWorkspaceId();
    return serviceFn(workspaceId, ...args);
}
