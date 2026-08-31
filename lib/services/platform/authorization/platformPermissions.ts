/**
 * Concrete Platform Permission Taxonomy
 * Hierarchical dot-notation with mandatory "platform." prefix.
 * Strictly conforms to locked Architecture Specification (Phase 1.19.1 Section 2.2).
 */
export const PLATFORM_PERMISSIONS = {
    // Workspaces & Tenancy
    WORKSPACES_VIEW: "platform.workspaces.view",
    WORKSPACES_CREATE: "platform.workspaces.create",
    WORKSPACES_UPDATE: "platform.workspaces.update",
    WORKSPACES_SUSPEND: "platform.workspaces.suspend",
    WORKSPACES_DELETE: "platform.workspaces.delete",
    WORKSPACES_SUPPORT_VIEW: "platform.workspaces.support_view",

    // Entitlements & SaaS Billing
    BILLING_VIEW: "platform.billing.view",
    BILLING_MANAGE_PLANS: "platform.billing.manage_plans",
    BILLING_OVERRIDE_ENTITLEMENTS: "platform.billing.override_entitlements",
    BILLING_SYNC_GATEWAY: "platform.billing.sync_gateway",

    // Platform Operators & Governance
    OPERATORS_VIEW: "platform.operators.view",
    OPERATORS_INVITE: "platform.operators.invite",
    OPERATORS_UPDATE_ROLE: "platform.operators.update_role",
    OPERATORS_REVOKE: "platform.operators.revoke",

    // Feature Flags & Runtime Configuration
    CONFIG_VIEW: "platform.config.view",
    CONFIG_MANAGE_FLAGS: "platform.config.manage_flags",
    CONFIG_UPDATE_SETTINGS: "platform.config.update_settings",

    // Developer Platform & Public API Governance
    DEVELOPER_VIEW_APPS: "platform.developer.view_apps",
    DEVELOPER_REVOKE_KEYS: "platform.developer.revoke_keys",
    DEVELOPER_MANAGE_WEBHOOKS: "platform.developer.manage_webhooks",

    // System Operations & Asynchronous Queues
    OPERATIONS_VIEW_QUEUES: "platform.operations.view_queues",
    OPERATIONS_RETRY_JOBS: "platform.operations.retry_jobs",
    OPERATIONS_PURGE_STALE: "platform.operations.purge_stale",

    // Audit & Security Oversight
    AUDIT_VIEW: "platform.audit.view",
    SECURITY_INSPECT_SESSIONS: "platform.security.inspect_sessions",
    SECURITY_TERMINATE_SESSIONS: "platform.security.terminate_sessions",
} as const;

export type PlatformPermission =
    (typeof PLATFORM_PERMISSIONS)[keyof typeof PLATFORM_PERMISSIONS];
