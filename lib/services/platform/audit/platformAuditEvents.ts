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
    PLAN_ASSIGNED: "platform.billing.plan_assigned",
    BILLING_RESYNCHRONIZED: "platform.billing.resynchronized",

    // Feature Flags & Config
    FEATURE_FLAG_CREATED: "platform.config.flag_created",
    FEATURE_FLAG_UPDATED: "platform.config.flag_updated",
    FEATURE_FLAG_TOGGLED: "platform.config.flag_toggled",
    RUNTIME_SETTING_UPDATED: "platform.config.setting_updated",

    // Developer Platform Administration
    DEVELOPER_API_KEY_REVOKED: "platform.developer.api_key_revoked",
    DEVELOPER_WEBHOOK_DISABLED: "platform.developer.webhook_disabled",

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
    | "INTEGRATION"
    | "QUEUE";

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
