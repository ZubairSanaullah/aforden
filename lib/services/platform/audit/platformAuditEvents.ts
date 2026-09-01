import { PlatformRole } from "../authorization/types";

/**
 * Concrete Platform Audit Event Taxonomy
 * Strictly conforms to locked Architecture Specification (Phase 1.19.1 Section 4.2).
 */
export const PLATFORM_AUDIT_EVENTS = {
    // Operator Management
    OPERATOR_INVITED: "platform.operator.invited",
    OPERATOR_ROLE_UPDATED: "platform.operator.role_updated",
    OPERATOR_REVOKED: "platform.operator.revoked",

    // Workspace Governance
    WORKSPACE_CREATED: "platform.workspace.created",
    WORKSPACE_SUSPENDED: "platform.workspace.suspended",
    WORKSPACE_REACTIVATED: "platform.workspace.reactivated",
    WORKSPACE_DELETED: "platform.workspace.deleted",
    WORKSPACE_SUPPORT_ACCESSED: "platform.workspace.support_accessed",

    // Entitlements & Billing
    ENTITLEMENT_OVERRIDDEN: "platform.billing.entitlement_overridden",
    ENTITLEMENT_REVOKED: "platform.billing.entitlement_revoked",
    PLAN_ASSIGNED: "platform.billing.plan_assigned",
    BILLING_RESYNCHRONIZED: "platform.billing.resynchronized",
    BILLING_WEBHOOK_REPLAYED: "platform.billing.webhook_replayed",

    // Feature Flags & Config
    FEATURE_FLAG_CREATED: "platform.config.flag_created",
    FEATURE_FLAG_UPDATED: "platform.config.flag_updated",
    FEATURE_FLAG_TOGGLED: "platform.config.flag_toggled",
    FEATURE_FLAG_DELETED: "platform.config.flag_deleted",
    RUNTIME_SETTING_UPDATED: "platform.config.setting_updated",


    // Developer Platform Administration
    DEVELOPER_API_KEY_REVOKED: "platform.developer.api_key_revoked",
    DEVELOPER_WEBHOOK_DISABLED: "platform.developer.webhook_disabled",
    DEVELOPER_APP_STATUS_UPDATED: "platform.developer.app_status_updated",
    DEVELOPER_RATE_LIMIT_RESET: "platform.developer.rate_limit_reset",

    // Third-Party Integrations Administration
    INTEGRATION_CONNECTION_STATUS_UPDATED: "platform.integration.connection_status_updated",
    INTEGRATION_CREDENTIAL_REVOKED: "platform.integration.credential_revoked",
    INTEGRATION_CONFIG_UPDATED: "platform.integration.config_updated",
    INTEGRATION_CONNECTION_TESTED: "platform.integration.connection_tested",

    // Operations & Jobs
    JOB_MANUALLY_TRIGGERED: "platform.operations.job_triggered",
    JOB_RETRIED: "platform.operations.job_retried",
    STALE_DATA_PURGED: "platform.operations.stale_purged",

    // Security & Sessions
    SECURITY_SESSION_TERMINATED: "platform.security.session_terminated",
    EMERGENCY_ACCESS_INVOKED: "platform.security.emergency_access_invoked",
} as const;

export type PlatformAuditEventType =
    (typeof PLATFORM_AUDIT_EVENTS)[keyof typeof PLATFORM_AUDIT_EVENTS];

export type PlatformAuditTargetType =
    | "WORKSPACE"
    | "USER"
    | "OPERATOR"
    | "FEATURE_FLAG"
    | "CONFIG"
    | "API_KEY"
    | "JOB"
    | "SESSION"
    | "BILLING_PLAN"
    | "BILLING_ACCOUNT"
    | "SUBSCRIPTION"
    | "ENTITLEMENT"
    | "INTEGRATION"
    | "INTEGRATION_CONNECTION"
    | "INTEGRATION_CREDENTIAL"
    | "QUEUE"
    | "DEVELOPER_APP"
    | "WEBHOOK"
    | "RATE_LIMIT";

export interface PlatformAuditEntry {
    id: string;
    actorUserId: string;
    actorEmail: string;
    actorRole: PlatformRole;
    action: PlatformAuditEventType | string;
    targetType: PlatformAuditTargetType | string;
    targetId: string;
    workspaceId?: string | null;
    requestId: string;
    ipAddress: string;
    userAgent?: string | null;
    reason?: string | null;
    previousState?: Record<string, unknown> | null;
    newState?: Record<string, unknown> | null;
    metadata?: Record<string, unknown> | null;
    createdAt: Date;
}
