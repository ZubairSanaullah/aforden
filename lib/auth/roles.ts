/**
 * Aforden Role → Permission Mapping
 *
 * System roles are defined by the Prisma MembershipRole enum.
 *
 * Permission definitions themselves live in permissions.ts.
 */

import type { MembershipRole } from "@/generated/prisma/enums";

import {
    ALL_PERMISSIONS,
    PERMISSIONS,
    type Permission,
} from "./permissions";

/**
 * Authoritative system role → permission mapping.
 */
export const ROLE_PERMISSIONS: Record<
    MembershipRole,
    readonly Permission[]
> = {
    OWNER: ALL_PERMISSIONS,

    ADMIN: [
        // Customers
        PERMISSIONS.CUSTOMERS_VIEW,
        PERMISSIONS.CUSTOMERS_CREATE,
        PERMISSIONS.CUSTOMERS_UPDATE,
        PERMISSIONS.CUSTOMERS_DELETE,

        // Work Orders
        PERMISSIONS.WORK_ORDERS_VIEW,
        PERMISSIONS.WORK_ORDERS_CREATE,
        PERMISSIONS.WORK_ORDERS_UPDATE,
        PERMISSIONS.WORK_ORDERS_ASSIGN,
        PERMISSIONS.WORK_ORDERS_COMPLETE,

        // Scheduler
        PERMISSIONS.SCHEDULER_VIEW,
        PERMISSIONS.SCHEDULER_CREATE,
        PERMISSIONS.SCHEDULER_UPDATE,
        PERMISSIONS.SCHEDULER_DELETE,

        // Members
        PERMISSIONS.MEMBERS_VIEW,
        PERMISSIONS.MEMBERS_INVITE,
        PERMISSIONS.MEMBERS_UPDATE,
        PERMISSIONS.MEMBERS_REMOVE,

        // Settings
        PERMISSIONS.SETTINGS_VIEW,
        PERMISSIONS.SETTINGS_UPDATE,

        // Billing
        PERMISSIONS.BILLING_VIEW,
        PERMISSIONS.BILLING_MANAGE,
    ],

    MANAGER: [
        // Customers
        PERMISSIONS.CUSTOMERS_VIEW,
        PERMISSIONS.CUSTOMERS_CREATE,
        PERMISSIONS.CUSTOMERS_UPDATE,
        PERMISSIONS.CUSTOMERS_DELETE,

        // Work Orders
        PERMISSIONS.WORK_ORDERS_VIEW,
        PERMISSIONS.WORK_ORDERS_CREATE,
        PERMISSIONS.WORK_ORDERS_UPDATE,
        PERMISSIONS.WORK_ORDERS_ASSIGN,
        PERMISSIONS.WORK_ORDERS_COMPLETE,

        // Scheduler
        PERMISSIONS.SCHEDULER_VIEW,
        PERMISSIONS.SCHEDULER_CREATE,
        PERMISSIONS.SCHEDULER_UPDATE,
        PERMISSIONS.SCHEDULER_DELETE,
    ],

    DISPATCHER: [
        // Customers
        PERMISSIONS.CUSTOMERS_VIEW,
        PERMISSIONS.CUSTOMERS_UPDATE,

        // Work Orders
        PERMISSIONS.WORK_ORDERS_VIEW,
        PERMISSIONS.WORK_ORDERS_CREATE,
        PERMISSIONS.WORK_ORDERS_UPDATE,
        PERMISSIONS.WORK_ORDERS_ASSIGN,

        // Scheduler
        PERMISSIONS.SCHEDULER_VIEW,
        PERMISSIONS.SCHEDULER_CREATE,
        PERMISSIONS.SCHEDULER_UPDATE,
        PERMISSIONS.SCHEDULER_DELETE,
    ],

    TECHNICIAN: [
        // Customers
        PERMISSIONS.CUSTOMERS_VIEW,

        // Work Orders
        PERMISSIONS.WORK_ORDERS_VIEW,
        PERMISSIONS.WORK_ORDERS_UPDATE,
        PERMISSIONS.WORK_ORDERS_COMPLETE,

        // Scheduler
        PERMISSIONS.SCHEDULER_VIEW,
    ],

    ACCOUNTANT: [
        // Customers
        PERMISSIONS.CUSTOMERS_VIEW,

        // Billing
        PERMISSIONS.BILLING_VIEW,
        PERMISSIONS.BILLING_MANAGE,
    ],
};

/**
 * Returns all permissions assigned to a role.
 */
export function getRolePermissions(
    role: MembershipRole,
): readonly Permission[] {
    return ROLE_PERMISSIONS[role];
}

/**
 * Checks whether a role has a specific permission.
 */
export function roleHasPermission(
    role: MembershipRole,
    permission: Permission,
): boolean {
    return ROLE_PERMISSIONS[role].includes(
        permission,
    );
}

/**
 * Returns whether a role has at least one permission
 * from the supplied list.
 */
export function roleHasAnyPermission(
    role: MembershipRole,
    permissions: readonly Permission[],
): boolean {
    return permissions.some((permission) =>
        roleHasPermission(role, permission),
    );
}

/**
 * Returns whether a role has every permission
 * from the supplied list.
 */
export function roleHasAllPermissions(
    role: MembershipRole,
    permissions: readonly Permission[],
): boolean {
    return permissions.every((permission) =>
        roleHasPermission(role, permission),
    );
}