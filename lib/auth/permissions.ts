/**
 * Aforden RBAC Permission Registry
 *
 * This file is the single source of truth for all application
 * permissions.
 *
 * Permission format:
 *
 *     resource.action
 *
 * Example:
 *
 *     customers.view
 *     work_orders.assign
 */

export const PERMISSIONS = {
    // Customers
    CUSTOMERS_VIEW: "customers.view",
    CUSTOMERS_CREATE: "customers.create",
    CUSTOMERS_UPDATE: "customers.update",
    CUSTOMERS_DELETE: "customers.delete",

    // Work Orders
    WORK_ORDERS_VIEW: "work_orders.view",
    WORK_ORDERS_CREATE: "work_orders.create",
    WORK_ORDERS_UPDATE: "work_orders.update",
    WORK_ORDERS_ASSIGN: "work_orders.assign",
    WORK_ORDERS_COMPLETE: "work_orders.complete",

    // Scheduler
    SCHEDULER_VIEW: "scheduler.view",
    SCHEDULER_CREATE: "scheduler.create",
    SCHEDULER_UPDATE: "scheduler.update",
    SCHEDULER_DELETE: "scheduler.delete",

    // Members
    MEMBERS_VIEW: "members.view",
    MEMBERS_INVITE: "members.invite",
    MEMBERS_UPDATE: "members.update",
    MEMBERS_REMOVE: "members.remove",

    // Settings
    SETTINGS_VIEW: "settings.view",
    SETTINGS_UPDATE: "settings.update",

    // Billing
    BILLING_VIEW: "billing.view",
    BILLING_MANAGE: "billing.manage",

    // Integrations
    INTEGRATIONS_VIEW_STATUS: "integration.view_status",
    INTEGRATIONS_MANAGE_CONNECTION: "integration.manage_connection",
    INTEGRATIONS_MANAGE_CREDENTIALS: "integration.manage_credentials",
    INTEGRATIONS_VIEW_HISTORY: "integration.view_history",
} as const;

/**
 * Union of every valid permission value.
 */
export type Permission =
    (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/**
 * Complete permission registry.
 */
export const ALL_PERMISSIONS: readonly Permission[] =
    Object.values(PERMISSIONS);

/**
 * Checks whether a value is a registered Aforden permission.
 */
export function isPermission(
    value: string,
): value is Permission {
    return ALL_PERMISSIONS.includes(
        value as Permission,
    );
}

/**
 * Ensures the permission registry contains no duplicate values.
 *
 * This is useful during development and automated testing.
 */
export function hasDuplicatePermissions(): boolean {
    return (
        new Set(ALL_PERMISSIONS).size !==
        ALL_PERMISSIONS.length
    );
}