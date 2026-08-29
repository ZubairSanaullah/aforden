import { AsyncLocalStorage } from "node:async_hooks";
import { registerRequestIdGetter } from "./envelope";
import { ResolvedApiCredential } from "@/lib/services/developerApp/developerApp.types";

export interface AuthenticatedApiContext extends ResolvedApiCredential {}

export interface PublicApiContext {
    requestId: string;
    startTime: number;
    version: string;
    auth?: AuthenticatedApiContext;
}

export const publicApiContextStorage = new AsyncLocalStorage<PublicApiContext>();

/**
 * Retrieves the current Public API request context, if within an active request scope.
 */
export function getPublicApiContext(): PublicApiContext | undefined {
    return publicApiContextStorage.getStore();
}

/**
 * Retrieves the authenticated API key credentials from the active context.
 * Throws an error if called outside an authenticated request scope.
 */
export function getAuthenticatedApiContext(): AuthenticatedApiContext {
    const ctx = getPublicApiContext();
    if (!ctx?.auth) {
        throw new Error("No authenticated API key context found in active request scope");
    }
    return ctx.auth;
}

/**
 * Runs an asynchronous function within a bound Public API request context.
 */
export function runWithPublicApiContext<T>(
    context: PublicApiContext,
    fn: () => Promise<T> | T,
): Promise<T> | T {
    return publicApiContextStorage.run(context, fn);
}

// Auto-register context getter with envelope builder
registerRequestIdGetter(() => getPublicApiContext()?.requestId);
