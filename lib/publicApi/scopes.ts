/**
 * Canonical Public API Scopes Registry.
 * Single source of truth for all external API scopes in Aforden.
 * Aligned with Phase 1.18.1 Architecture Specification Section 11.
 */

export const PUBLIC_API_SCOPES = {
    WORK_ORDERS_READ: "work_orders:read",
    WORK_ORDERS_WRITE: "work_orders:write",
    CUSTOMERS_READ: "customers:read",
    CUSTOMERS_WRITE: "customers:write",
    SCHEDULES_READ: "schedules:read",
    SCHEDULES_WRITE: "schedules:write",
    INVOICES_READ: "invoices:read",
    INVOICES_WRITE: "invoices:write",
    QUOTES_READ: "quotes:read",
    QUOTES_WRITE: "quotes:write",
    ASSETS_READ: "assets:read",
    ASSETS_WRITE: "assets:write",
    INVENTORY_READ: "inventory:read",
    INVENTORY_WRITE: "inventory:write",
    TECHNICIANS_READ: "technicians:read",
    REPORTING_READ: "reporting:read",
    PAYMENTS_READ: "payments:read",
    PING_READ: "ping:read",
} as const;

export type PublicApiScope =
    (typeof PUBLIC_API_SCOPES)[keyof typeof PUBLIC_API_SCOPES];

export const ALL_PUBLIC_API_SCOPES: readonly PublicApiScope[] = Object.values(
    PUBLIC_API_SCOPES,
);

/**
 * Checks whether a given string is a recognized canonical Public API scope.
 */
export function isValidPublicApiScope(scope: unknown): scope is PublicApiScope {
    return (
        typeof scope === "string" &&
        ALL_PUBLIC_API_SCOPES.includes(scope as PublicApiScope)
    );
}

/**
 * Validates an array of scope strings against the canonical scope registry.
 */
export function validatePublicApiScopes(scopes: string[]): {
    valid: boolean;
    invalidScopes: string[];
} {
    const invalidScopes = scopes.filter((s) => !isValidPublicApiScope(s));
    return {
        valid: invalidScopes.length === 0,
        invalidScopes,
    };
}

/**
 * Checks if a granted set of scopes satisfies the required scopes.
 */
export function hasRequiredScopes(
    grantedScopes: string[],
    requiredScopes: PublicApiScope[],
    mode: "AND" | "OR" = "AND",
): boolean {
    if (requiredScopes.length === 0) {
        return true;
    }
    if (mode === "OR") {
        return requiredScopes.some((req) => grantedScopes.includes(req));
    }
    return requiredScopes.every((req) => grantedScopes.includes(req));
}

/**
 * Explicit mapping between Public API scopes and internal RBAC permission representations.
 * Ensures public scope contracts remain decoupled from internal permission renames.
 */
export const PUBLIC_SCOPE_TO_INTERNAL_PERMISSIONS_MAP: Record<
    PublicApiScope,
    string[]
> = {
    "work_orders:read": ["WORK_ORDER_READ"],
    "work_orders:write": [
        "WORK_ORDER_CREATE",
        "WORK_ORDER_UPDATE",
        "WORK_ORDER_DELETE",
    ],
    "customers:read": ["CUSTOMER_READ"],
    "customers:write": ["CUSTOMER_CREATE", "CUSTOMER_UPDATE", "CUSTOMER_DELETE"],
    "schedules:read": ["SCHEDULE_READ"],
    "schedules:write": ["SCHEDULE_CREATE", "SCHEDULE_UPDATE", "SCHEDULE_DELETE"],
    "invoices:read": ["INVOICE_READ"],
    "invoices:write": ["INVOICE_CREATE", "INVOICE_UPDATE", "INVOICE_DELETE"],
    "quotes:read": ["QUOTE_READ"],
    "quotes:write": ["QUOTE_CREATE", "QUOTE_UPDATE", "QUOTE_DELETE"],
    "assets:read": ["ASSET_READ"],
    "assets:write": ["ASSET_CREATE", "ASSET_UPDATE", "ASSET_DELETE"],
    "inventory:read": ["INVENTORY_READ"],
    "inventory:write": ["INVENTORY_CREATE", "INVENTORY_UPDATE", "INVENTORY_DELETE"],
    "technicians:read": ["TECHNICIAN_READ"],
    "reporting:read": ["REPORTING_READ"],
    "payments:read": ["PAYMENT_READ"],
    "ping:read": ["PING_READ"],
};
