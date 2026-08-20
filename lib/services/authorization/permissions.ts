export const PERMISSIONS = {
    CUSTOMERS_VIEW: "customers.view",
    CUSTOMERS_CREATE: "customers.create",
    CUSTOMERS_UPDATE: "customers.update",
    CUSTOMERS_DELETE: "customers.delete",

    WORK_ORDERS_VIEW: "work_orders.view",
    WORK_ORDERS_CREATE: "work_orders.create",
    WORK_ORDERS_UPDATE: "work_orders.update",
    WORK_ORDERS_ASSIGN: "work_orders.assign",
    WORK_ORDERS_COMPLETE:
        "work_orders.complete",
    WORK_ORDERS_DELETE: "work_orders.delete",

    SCHEDULER_VIEW: "scheduler.view",
    SCHEDULER_CREATE:
        "scheduler.create",
    SCHEDULER_UPDATE:
        "scheduler.update",
    SCHEDULER_DELETE:
        "scheduler.delete",

    MEMBERS_VIEW: "members.view",
    MEMBERS_INVITE:
        "members.invite",
    MEMBERS_UPDATE:
        "members.update",
    MEMBERS_REMOVE:
        "members.remove",

    SETTINGS_VIEW: "settings.view",
    SETTINGS_UPDATE:
        "settings.update",

    SERVICE_CATALOG_VIEW: "service_catalog.view",
    SERVICE_CATALOG_CREATE: "service_catalog.create",
    SERVICE_CATALOG_UPDATE: "service_catalog.update",
    SERVICE_CATALOG_DELETE: "service_catalog.delete",

    ASSETS_VIEW: "assets.view",
    ASSETS_CREATE: "assets.create",
    ASSETS_UPDATE: "assets.update",
    ASSETS_TRANSFER: "assets.transfer",
    ASSETS_STATUS_CHANGE: "assets.status_change",
    ASSETS_RETIRE: "assets.retire",
    ASSETS_DELETE: "assets.delete",
    ASSET_CATEGORIES_MANAGE: "asset_categories.manage",

    BILLING_VIEW: "billing.view",
    BILLING_MANAGE:
        "billing.manage",
} as const;

export type Permission =
    (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS =
    Object.values(PERMISSIONS);

export function isPermission(
    value: string
): value is Permission {
    return (
        ALL_PERMISSIONS.includes(
            value as Permission
        )
    );
}