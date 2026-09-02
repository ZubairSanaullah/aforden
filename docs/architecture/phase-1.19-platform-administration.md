# Phase 1.19.1 — Platform Administration Architecture Specification

> **Document Status**: LOCKED FOR IMPLEMENTATION (Phase 1.19 Architecture Standard)  
> **Domain**: Platform Administration, Global Super-Admin Identity, Platform RBAC & Permissions, Cross-Tenant Support Visibility, Dangerous Action Protection Tiers, Append-Only Platform Audit Ledger, Feature Flags & Runtime Configuration, Public API Operator Governance  
> **Dependencies**: Phase 1.1 (Multi-Tenancy & Workspace Partitioning), Phase 1.2 (Authentication & User Identity), Phase 1.15 (SaaS Billing & Plan Entitlements), Phase 1.18 (Public API & Developer Platform)  
> **Target Sub-Phases**: Phase 1.19.2 – Phase 1.19.16  
> **Out of Scope (Explicit Non-Goals)**: Concrete Next.js Route Handlers (Phase 1.19.6+), Prisma Schema Migrations (Phase 1.19.2), Tenant Write Impersonation (Explicitly Deferred/Prohibited in favor of Read-Only Diagnostics), Admin Portal Frontend UI (Phase 1.23)

---

## Codebase Investigation & Architectural Precedents

Before defining the Phase 1.19 architecture, a comprehensive investigation of Aforden's existing authentication, authorization, and audit subsystems was conducted. The findings directly shaped the design decisions in this document:

### 1. Workspace Permission System (`lib/services/authorization/`)
- **Investigation**: In [lib/services/authorization/permissions.ts:1-119](file:///d:/Download/aforden/lib/services/authorization/permissions.ts#L1-L119), workspace permissions are defined as constant keys with un-prefixed dot-notation values (e.g., `CUSTOMERS_VIEW: "customers.view"`, `WORK_ORDERS_VIEW: "work_orders.view"`, `SERVICE_CATALOG_VIEW: "service_catalog.view"`).
- **Architectural Decision**: Platform permissions deliberately introduce a mandatory `platform.` prefix (e.g., `WORKSPACES_VIEW: "platform.workspaces.view"`). This structural divergence makes platform permissions impossible to confuse with workspace permissions. `assertPermission(PERMISSIONS.WORK_ORDERS_VIEW)` looks for `"work_orders.view"` and cannot be satisfied by any platform permission, while `assertPlatformPermission(PLATFORM_PERMISSIONS.WORKSPACES_VIEW)` looks strictly for `"platform.workspaces.view"`.

### 2. Authentication Architecture & Session Lifetimes (`auth.ts` & `prisma/schema.prisma`)
- **Investigation**: In [auth.ts:16-18](file:///d:/Download/aforden/auth.ts#L16-L18), NextAuth is configured with `session: { strategy: "database" }` backed by the `Session` model ([prisma/schema.prisma:1081-1093](file:///d:/Download/aforden/prisma/schema.prisma#L1081-L1093)). NextAuth's default session `maxAge` for database sessions is 30 days (2,592,000s) and does not natively support role-differentiated session timeouts out-of-the-box.
- **Architectural Decision**: The 30-minute platform operator idle timeout will be implemented as an **administrative verification layer on top of NextAuth**, rather than replacing NextAuth's session strategy. When `requirePlatformAuthorization()` executes on `/api/platform/*`, it validates a platform session record or `PlatformAdminProfile.lastActiveAt` timestamp. If `Date.now() - lastActiveAt > 30 * 60 * 1000`, the platform guard rejects the request with HTTP 401 `PlatformSessionExpiredError` and requires administrative re-authentication, leaving the user's base identity intact while enforcing strict administrative session hygiene.

### 3. Audit History Patterns (`WorkOrderHistory` & `AssetHistory`)
- **Investigation**: In [prisma/schema.prisma:1120-1144](file:///d:/Download/aforden/prisma/schema.prisma#L1120-L1144) and [lib/services/workOrder/updateWorkOrder.ts:255-278](file:///d:/Download/aforden/lib/services/workOrder/updateWorkOrder.ts#L255-L278), `WorkOrderHistory` captures per-field changes by writing individual rows with string columns (`field: String?`, `oldValue: String? @db.Text`, `newValue: String? @db.Text`).
- **Architectural Decision**: While field-level row recording works for entity attribute edits, it is insufficient for platform administration where complex, multi-field, JSON-structured configurations (such as plan overrides, feature flags, or workspace suspensions) are modified atomically. `PlatformAuditLog` establishes a new pattern: atomic multi-field JSON diffs (`previousState: JSONB`, `newState: JSONB`), structured metadata (`metadata: JSONB`), request tracing (`requestId`), client network provenance (`ipAddress`, `userAgent`), and mandatory justification reasons (`reason: String?`) in a single append-only record.

---

## Executive Summary

Phases 1.1 through 1.17 established Aforden's multi-tenant business engine, spanning operational field service domains, real-time dispatch, inventory, financial billing, automated workflows, and third-party integrations. Phase 1.18 introduced the hardened Public REST API and Developer Platform.

Phase 1.19 introduces **Platform Administration**: the sovereign administrative control plane used by Aforden staff, platform operators, system engineers, security auditors, and tier-1/tier-2 support personnel to govern the entire multi-tenant ecosystem.

Ten foundational architectural invariants govern Phase 1.19:

1. **Authority Separation Invariant**: Platform Administrator authority and Workspace Member authority are mutually exclusive, orthogonal security planes. A Platform Administrator never automatically inherits workspace membership or tenant-level operational permissions, and a Workspace Owner never gains platform administrative capabilities.
2. **Dedicated Context Isolation Invariant**: Platform routes (`/api/platform/...`) execute strictly under a verified `PlatformAuthorizationContext`. Workspace routes (`/api/...`, `/api/v1/...`) execute strictly under `WorkspaceAuthorizationContext` or `PublicApiSecurityContext`. The runtime authorization pipelines never share, derive, or cross-cast context objects.
3. **Immutable Platform Audit Ledger Invariant**: Every state-altering administrative action, configuration change, feature flag toggle, entitlement override, and diagnostic access event must be permanently recorded in an append-only `PlatformAuditLog` table. The platform exposes zero API routes or application routines that permit update, mutation, or deletion of audit records.
4. **Dangerous-Action Protection Tier Invariant**: Administrative actions are categorized into tiered risk levels. High-impact destructive operations (e.g. workspace suspension, operator role escalation, global API key revocation) mandate elevated authorization, explicit justification logging, and step-up confirmation before execution.
5. **Zero Write-Impersonation Invariant**: Direct write impersonation (operating inside a tenant workspace under a synthetic user identity with mutate permissions) is strictly prohibited. Support and diagnostic capabilities are restricted to explicit, audited, read-only visibility modes (`platform.workspaces.support_view`).
6. **Canonical Domain Service Delegation Invariant**: Platform administrative mutations to domain resources (e.g. overriding workspace entitlements, revoking developer API keys, disabling abusive webhooks) must invoke canonical domain services (`lib/services/*`, `lib/publicApi/*`), ensuring domain validation, state machines, and local audit histories are never bypassed.
7. **Secrets Exclusion Invariant**: The Platform Configuration and Feature Flag management system manages operational flags, rate limit overrides, and system toggles. Secrets, encryption keys, private credentials, and database connection strings are strictly excluded and managed exclusively via infrastructure environment variables.
8. **Constant-Time Platform Auth Invariant**: Platform operator authentication and authorization checks must resist timing side-channels and identity enumeration. Failed administrative authentication attempts return generic, sanitized errors and log security alerts.
9. **Separate Route Namespace Invariant**: Platform administration endpoints are strictly hosted under the `/api/platform/...` namespace, isolated from internal workspace routes (`/api/...`) and the public developer API (`/api/v1/...`).
10. **Emergency Break-Glass Determinism Invariant**: Emergency platform recovery and bootstrap mechanisms operate exclusively via cryptographically signed infrastructure CLI tooling and environment-seeded procedures, never via insecure backdoor HTTP endpoints.

---

## 1. Platform Admin Identity & Session Model

### 1.1 Conceptual Identity Architecture
A primary design decision for Phase 1.19 is whether Platform Operators exist as an entirely separate database table (`PlatformUser`) or as an extension of the existing `User` model (`prisma/schema.prisma:420`).

**Architectural Decision**: **Extension of `User` model with a dedicated `platformRole` attribute and `PlatformAdminProfile` relation.**

```
+-----------------------------------------------------------------------------------------+
|                                    IDENTITY TOPOLOGY                                    |
|                                                                                         |
|                                     +--------------+                                    |
|                                     |  model User  |                                    |
|                                     | (Auth Core)  |                                    |
|                                     +-------+------+                                    |
|                                             |                                           |
|                     +-----------------------+-----------------------+                   |
|                     |                                               |                   |
|                     v                                               v                   |
|           +-------------------+                           +----------------------+      |
|           |  WorkspaceMember  |                           | PlatformAdminProfile |      |
|           | (Tenant Plane)    |                           | (Admin Plane)        |      |
|           +---------+---------+                           +----------+-----------+      |
|                     |                                                |                  |
|                     v                                                v                  |
|        WorkspaceAuthorizationContext                    PlatformAuthorizationContext    |
|        - workspaceId: "ws_123"                          - isPlatformAdmin: true          |
|        - role: OWNER | ADMIN | TECH                     - platformRole: PLATFORM_OWNER   |
|        - permissions: ["work_orders.view", ...]         - permissions: ["platform.*"]   |
+-----------------------------------------------------------------------------------------+
```

#### Rationale:
1. **Single Identity, Dual Context**: Operators use their primary corporate identity for authentication (bcrypt passwords, email verification, future SAML/SSO), avoiding duplicate login screens and fragmented password reset flows.
2. **Strict Context Segregation**: While the `User` record holds identity credentials, authorization contexts are strictly decoupled. A user accessing `/api/platform/*` is evaluated exclusively via `PlatformAuthorizationContext`. Their workspace memberships (if any) are completely ignored during platform operations.

### 1.2 Platform Role Leakage Prevention
To prevent `User.platformRole` or `PlatformAdminProfile` from leaking into workspace-facing or public API serialization pathways:
1. **Sanctioned Reader Gateway**: `getPlatformAuthorizationContext()` / `requirePlatformAuthorization()` in `lib/services/platform/authorization/` is the **sole authorized reader** of `User.platformRole` and `PlatformAdminProfile`.
2. **Prisma Select Whitelisting**: All workspace queries across `lib/services/*` and `lib/auth/` must use explicit `select` blocks (`select: { id: true, name: true, email: true, avatarUrl: true }`) rather than raw entity returns, preventing `platformRole` from entering workspace memory.
3. **DTO Whitelist Immutability**: Public API and workspace DTO serialization functions strictly enforce explicit key whitelists (e.g. `APPROVED_PUBLIC_*_DTO_KEYS`), automatically discarding any unlisted administrative properties.
4. **Architectural Guard**: Workspace user serializers are prohibited from importing `PlatformRole` or exposing platform administrative metadata.

### 1.3 Administrative Session & Re-Authentication Policy
- **Session Duration**: Platform operator sessions adhere to a strict **30-minute idle timeout** enforced by verifying `PlatformAdminProfile.lastActiveAt` on every `/api/platform/*` request.
- **Step-Up Authentication**: Executing Tier-2 dangerous actions (see Section 5) requires recent password re-entry or MFA confirmation verified within the last 5 minutes (`stepUpConfirmedAt`).

---

## 2. Platform Roles & Permission Taxonomy

### 2.1 Platform Roles
Phase 1.19 defines 6 canonical platform operator roles:

| Platform Role | Scope & Responsibility |
| :--- | :--- |
| `PLATFORM_OWNER` | Sovereign platform authority. Full control over platform operators, emergency procedures, global configuration, workspace creation/deletion, and security audits. |
| `PLATFORM_ADMIN` | General system administration. Manages workspace lifecycles, plans, entitlement overrides, feature flags, and tenant configuration. |
| `PLATFORM_SUPPORT` | Customer support & troubleshooting. Read-only diagnostic access to workspace operational metrics, logs, and system health. Zero mutation rights. |
| `PLATFORM_OPERATIONS`| Infrastructure & reliability engineering. Manages background workers, outbox queues, job retries, dead-letter re-routing, and scheduler health. |
| `PLATFORM_SECURITY` | Security & compliance officer. Full access to platform audit logs, security monitoring, global API key revocation, and active session termination. |
| `PLATFORM_BILLING` | SaaS monetization & finance. Manages subscription tiers, billing adjustments, invoices, enterprise plan overrides, and Stripe synchronization. |

### 2.2 Concrete Platform Permission Taxonomy
Platform permissions follow the hierarchical dot-notation standard with the mandatory `platform.` prefix (`platform.<domain>.<action>`):

```ts
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

    // Third-Party Integrations Governance
    INTEGRATIONS_REVOKE_CREDENTIALS: "platform.integrations.revoke_credentials",

    // System Operations & Asynchronous Queues
    OPERATIONS_VIEW_QUEUES: "platform.operations.view_queues",
    OPERATIONS_RETRY_JOBS: "platform.operations.retry_jobs",
    OPERATIONS_PURGE_STALE: "platform.operations.purge_stale",

    // Audit & Security Oversight
    AUDIT_VIEW: "platform.audit.view",
    SECURITY_INSPECT_SESSIONS: "platform.security.inspect_sessions",
    SECURITY_TERMINATE_SESSIONS: "platform.security.terminate_sessions",
} as const;
```

### 2.3 Role-to-Permission Matrix (27 Permissions × 6 Roles = 162 Pairs)

| Permission | OWNER | ADMIN | SUPPORT | OPERATIONS | SECURITY | BILLING |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `platform.workspaces.view` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `platform.workspaces.create` | ✓ | ✓ | - | - | - | - |
| `platform.workspaces.update` | ✓ | ✓ | - | - | - | - |
| `platform.workspaces.suspend` | ✓ | ✓ | - | - | - | - |
| `platform.workspaces.delete` | ✓ | - | - | - | - | - |
| `platform.workspaces.support_view`| ✓ | ✓ | ✓ | - | ✓ | - |
| `platform.billing.view` | ✓ | ✓ | ✓ | - | - | ✓ |
| `platform.billing.manage_plans`| ✓ | ✓ | - | - | - | ✓ |
| `platform.billing.override_entitlements`| ✓ | ✓ | - | - | - | ✓ |
| `platform.billing.sync_gateway`| ✓ | - | - | - | - | ✓ |
| `platform.operators.view` | ✓ | ✓ | - | - | ✓ | - |
| `platform.operators.invite` | ✓ | - | - | - | - | - |
| `platform.operators.update_role` | ✓ | - | - | - | - | - |
| `platform.operators.revoke` | ✓ | - | - | - | - | - |
| `platform.config.view` | ✓ | ✓ | ✓ | ✓ | ✓ | - |
| `platform.config.manage_flags` | ✓ | ✓ | - | - | - | - |
| `platform.config.update_settings` | ✓ | ✓ | - | ✓ | - | - |
| `platform.developer.view_apps` | ✓ | ✓ | ✓ | - | ✓ | - |
| `platform.developer.revoke_keys`| ✓ | ✓ | - | - | ✓ | - |
| `platform.developer.manage_webhooks`| ✓ | ✓ | - | ✓ | ✓ | - |
| `platform.integrations.revoke_credentials`| ✓ | ✓ | - | - | ✓ | - |
| `platform.operations.view_queues`| ✓ | ✓ | - | ✓ | - | - |
| `platform.operations.retry_jobs`| ✓ | ✓ | - | ✓ | - | - |
| `platform.operations.purge_stale`| ✓ | - | - | ✓ | - | - |
| `platform.audit.view` | ✓ | ✓ | - | - | ✓ | - |
| `platform.security.inspect_sessions`| ✓ | - | - | - | ✓ | - |
| `platform.security.terminate_sessions`| ✓ | - | - | - | ✓ | - |

---

## 3. Platform vs. Workspace Authority Boundary

### 3.1 Structural Boundary Enforcement
Platform authority and Workspace authority represent two completely disconnected domains.

```
+---------------------------------------------------------------------------------------+
|                                 AUTHORIZATION GATES                                   |
|                                                                                       |
|  [ Request to /api/platform/... ]          [ Request to /api/... or /api/v1/... ]     |
|              |                                                |                       |
|              v                                                v                       |
|  requirePlatformAuthorization()            requireWorkspaceAuthorization()            |
|              |                                                |                       |
|              v                                                v                       |
|  PlatformAuthorizationContext              WorkspaceAuthorizationContext             |
|  {                                         {                                          |
|    userId: "usr_admin",                      userId: "usr_tech",                      |
|    platformRole: PLATFORM_ADMIN,             workspaceId: "ws_456",                   |
|    permissions: ["platform.workspaces.*"]    membershipRole: DISPATCHER,              |
|  }                                           permissions: ["work_orders.view", ...]  |
|                                            }                                          |
+---------------------------------------------------------------------------------------+
```

### 3.2 Invariant Guarantee: Mutual Exclusion
1. A user holding `platformRole: PLATFORM_OWNER` who sends a request to `/api/work-orders` without an active `WorkspaceMember` row for that specific workspace will be **rejected with HTTP 403 `WorkspaceAccessDeniedError`**.
2. A tenant owner holding `role: OWNER` on workspace `ws_123` who attempts to call `/api/platform/workspaces` without a verified `platformRole` will be **rejected with HTTP 403 `PlatformAccessDeniedError`**.
3. Under no circumstances can a platform context be used to satisfy `assertPermission(PERMISSIONS.WORK_ORDERS_CREATE)`.

---

## 4. Platform Audit Architecture & Event Taxonomy

### 4.1 Append-Only Audit Ledger Contract
All administrative interactions are captured in a dedicated, append-only `PlatformAuditLog` table.

```ts
export interface PlatformAuditEntry {
    id: string;
    actorUserId: string;
    actorEmail: string;
    actorRole: PlatformRole;
    action: PlatformAuditEventType;
    targetType: PlatformAuditTargetType;
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
```

### 4.2 Platform Audit Event Taxonomy (33 Canonical Events)
```ts
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
    STEP_UP_CHALLENGE_SUCCESS: "platform.security.step_up_challenge_success",
    STEP_UP_CHALLENGE_FAILED: "platform.security.step_up_challenge_failed",
} as const;
```

---

## 5. Dangerous-Action Protection Tiers

To safeguard against accidental catastrophic changes or malicious insider actions, administrative mutations are classified into two mandatory protection tiers:

```
+----------------------------------------------------------------------------------------------------+
|                                  DANGEROUS ACTION PROTECTION TIERS                                 |
|                                                                                                    |
|  [ TIER 1: Standard Operational Actions ]          [ TIER 2: Critical / High-Impact Actions ]      |
|  - Feature Flag Toggle                             - Workspace Suspension / Reactivation           |
|  - Runtime Setting Adjustment                      - Workspace Hard Deletion                       |
|  - Plan & Entitlement Override                     - Operator Role Escalation / Revocation         |
|  - Manual Outbox / Job Retry                       - Global API Key Revocation                     |
|                                                    - Session Invalidation / Force Logout           |
|  Requirements:                                     Requirements:                                   |
|  1. Valid Platform Permission                      1. Valid Platform Permission                    |
|  2. Explicit Reason String in Payload              2. Step-Up Re-Authentication (Password / MFA)    |
|  3. Structured Platform Audit Record               3. Mandatory Justification Reason (min 10 chars)|
|                                                    4. Structured Platform Audit Record with Diff   |
+----------------------------------------------------------------------------------------------------+
```

---

## 6. Tenant Support Diagnostics Policy (Zero Write-Impersonation)

### 6.1 Explicit Determination on Tenant Impersonation
Direct "write impersonation" (assuming a customer user identity and performing create/update/delete operations within a tenant workspace) is **EXPLICITLY PROHIBITED AND DEFERRED**. Write impersonation creates severe compliance, non-repudiation, and audit integrity liabilities.

### 6.2 Read-Only Support Diagnostics Mode (Phase 1.19.9)
Instead of write impersonation, Phase 1.19 establishes **Read-Only Support Diagnostics**:
- **Capability**: Operators with `platform.workspaces.support_view` can inspect tenant configuration, health metrics, member directories, queue counts, and integration connection statuses in pure read-only mode.
- **Audit Mandate**: Every invocation of the diagnostics view records a `WORKSPACE_SUPPORT_ACCESSED` audit event capturing the operator ID, target workspace ID, timestamp, and optional support ticket reference.
- **Strict Boundary**: Diagnostics mode cannot trigger state transitions, dispatch notifications, or mutate database records within the tenant workspace.

---

## 7. Emergency Access & Break-Glass Policy

### 7.1 Lockout Recovery Philosophy
If all `PLATFORM_OWNER` operator accounts become inaccessible (e.g. lost MFA devices, administrative lockout), Aforden does **NOT** provide an unauthenticated or backdoor HTTP bypass endpoint.

### 7.2 Infrastructure Break-Glass Procedure
Emergency access is restricted to direct host/container infrastructure access:
1. **CLI Emergency Bootstrap**: An administrative CLI utility (`npm run platform:bootstrap-owner`) executable only via direct shell access to the production server runtime.
2. **Environment Variable Guard**: The utility requires an ephemeral, cryptographically secure `PLATFORM_BOOTSTRAP_SECRET` provided in the container environment.
3. **Automatic Audit**: When the bootstrap script executes, it creates or restores a designated `PLATFORM_OWNER` account and writes a high-priority `EMERGENCY_ACCESS_INVOKED` entry into `PlatformAuditLog`.

---

## 8. Platform Configuration & Feature Flag Ownership

### 8.1 Scope of Platform Configuration
- **Platform Feature Flags (`PlatformFeatureFlag`)**: Dynamic boolean or percentage-based toggles used to roll out new capabilities across workspaces (e.g. `FEATURE_PUBLIC_API_BETA`, `FEATURE_ADVANCED_DISPATCH`).
- **Platform Runtime Settings (`PlatformSetting`)**: Global configuration parameters (e.g. default rate-limit ceilings, maximum file upload sizes, outbox polling intervals).

### 8.2 Secrets Exclusion Guarantee
Platform configuration models manage operational parameters only. Under no circumstances are database connection strings, Stripe webhook secrets, encryption keys, or API tokens stored in `PlatformSetting` or `PlatformFeatureFlag`. All platform secrets remain exclusively in infrastructure environment variables.

---

## 9. Public API Administration Boundary

### 9.1 Namespace Separation
- Internal Workspace Routes: `/api/...` (Cookie / Database Session)
- External Public Developer API: `/api/v1/...` (Bearer `ApiKey` token)
- Platform Administrative Control Plane: `/api/platform/...` (Administrative Session + `PlatformAuthorizationContext`)

### 9.2 Domain Service Reuse for Developer Platform Governance
When platform operators perform administrative actions on Developer Platform resources (Phase 1.18), the route handlers under `/api/platform/developer/...` must delegate strictly to canonical Phase 1.18 domain services:
- **API Key Revocation**: Calls `revokeApiKey()` in `lib/services/developerApp/developerAppService.ts`.
- **Abusive Webhook Teardown**: Calls `updateWebhookEndpoint()` in `lib/publicApi/webhooks/webhookEndpointService.ts`.

This guarantees that developer application state machines, key caches, and domain invariants remain consistent.

### 9.3 Platform Administrative Route Inventory (37 Route Files / 41 Operations)
The platform control plane under `/api/platform/...` contains exactly 37 route handler files implementing 41 HTTP operations:

| Category / Domain | Route File Path | Exported Methods | Ops |
| :--- | :--- | :--- | :---: |
| **Identity & Context** | `/api/platform/me/route.ts` | `GET` | 1 |
| | `/api/platform/me/permissions/route.ts` | `GET` | 1 |
| | `/api/platform/rbac/matrix/route.ts` | `GET` | 1 |
| | `/api/platform/auth/step-up/route.ts` | `POST`, `GET` | 2 |
| **Audit Ledger** | `/api/platform/audit/route.ts` | `GET` | 1 |
| **Workspace Governance** | `/api/platform/workspaces/route.ts` | `GET` | 1 |
| | `/api/platform/workspaces/[workspaceId]/route.ts` | `GET` | 1 |
| | `/api/platform/workspaces/[workspaceId]/suspend/route.ts` | `POST` | 1 |
| | `/api/platform/workspaces/[workspaceId]/reactivate/route.ts` | `POST` | 1 |
| | `/api/platform/workspaces/[workspaceId]/support/route.ts` | `GET` | 1 |
| **Operator Management** | `/api/platform/operators/route.ts` | `GET`, `POST` | 2 |
| | `/api/platform/operators/[operatorId]/route.ts` | `DELETE` | 1 |
| | `/api/platform/operators/[operatorId]/role/route.ts` | `PATCH` | 1 |
| **Feature Flags** | `/api/platform/flags/route.ts` | `GET`, `POST` | 2 |
| | `/api/platform/flags/[flagId]/route.ts` | `PATCH`, `DELETE` | 2 |
| | `/api/platform/flags/[flagId]/toggle/route.ts` | `POST` | 1 |
| **Runtime Settings** | `/api/platform/settings/route.ts` | `GET` | 1 |
| | `/api/platform/settings/[key]/route.ts` | `PUT` | 1 |
| **Developer Governance** | `/api/platform/developer/apps/route.ts` | `GET` | 1 |
| | `/api/platform/developer/apps/[appId]/status/route.ts` | `PATCH` | 1 |
| | `/api/platform/developer/keys/[keyId]/revoke/route.ts` | `POST` | 1 |
| | `/api/platform/developer/webhooks/[webhookId]/disable/route.ts` | `POST` | 1 |
| | `/api/platform/developer/rate-limits/reset/route.ts` | `POST` | 1 |
| **Integrations** | `/api/platform/integrations/route.ts` | `GET` | 1 |
| | `/api/platform/integrations/connections/[connectionId]/status/route.ts` | `PATCH` | 1 |
| | `/api/platform/integrations/connections/[connectionId]/test/route.ts` | `POST` | 1 |
| | `/api/platform/integrations/credentials/[credentialId]/revoke/route.ts` | `POST` | 1 |
| **Billing & Plans** | `/api/platform/billing/accounts/route.ts` | `GET` | 1 |
| | `/api/platform/billing/plans/route.ts` | `GET` | 1 |
| | `/api/platform/billing/workspaces/[workspaceId]/plan/route.ts` | `POST` | 1 |
| | `/api/platform/billing/workspaces/[workspaceId]/entitlements/route.ts` | `POST` | 1 |
| | `/api/platform/billing/workspaces/[workspaceId]/entitlements/[featureKey]/route.ts` | `DELETE` | 1 |
| | `/api/platform/billing/workspaces/[workspaceId]/sync/route.ts` | `POST` | 1 |
| | `/api/platform/billing/webhooks/[eventId]/replay/route.ts` | `POST` | 1 |
| **System Health** | `/api/platform/health/route.ts` | `GET` | 1 |
| | `/api/platform/health/queues/route.ts` | `GET` | 1 |
| | `/api/platform/health/rate-limiter/route.ts` | `GET` | 1 |
| **Total** | **37 Route Files** | **41 Operations** | **41** |

---

## 10. Request Pipeline Architecture

```
+-------------------------------------------------------------------------------------------------------------------+
|                                        PLATFORM ADMIN REQUEST PIPELINE                                            |
|                                                                                                                   |
|  [ Platform Operator Browser / CLI Tooling ]                                                                      |
|         |                                                                                                         |
|         | HTTPS Request: POST /api/platform/workspaces/ws_123/suspend                                              |
|         | Headers: Cookie: aforden_session=..., X-Admin-Reason: "Payment default chargeback"                      |
|         v                                                                                                         |
|  +-------------------------------------------------------------------------------------------------------------+  |
|  | 1. Next.js Edge Middleware: Route Matching (/api/platform/...) & Security Headers                            |  |
|  +------------------------------------------------------+------------------------------------------------------+  |
|                                                         |                                                         |
|                                                         v                                                         |
|  +-------------------------------------------------------------------------------------------------------------+  |
|  | 2. Platform Authentication (auth.ts): Validate NextAuth Session & Active User Status                      |  |
|  +------------------------------------------------------+------------------------------------------------------+  |
|                                                         |                                                         |
|                                                         v                                                         |
|  +-------------------------------------------------------------------------------------------------------------+  |
|  | 3. Platform Authorization Guard (requirePlatformAuthorization):                                             |  |
|  |    - Verify User.platformRole is NOT NULL                                                                   |  |
|  |    - Check PlatformAdminProfile.lastActiveAt within 30-minute idle ceiling                                  |  |
|  |    - Construct PlatformAuthorizationContext with platform-specific permissions                              |  |
|  |    - Check assertPlatformPermission(PLATFORM_PERMISSIONS.WORKSPACES_SUSPEND)                                |  |
|  +------------------------------------------------------+------------------------------------------------------+  |
|                                                         |                                                         |
|                                                         v                                                         |
|  +-------------------------------------------------------------------------------------------------------------+  |
|  | 4. Dangerous Action Guard: Verify Tier-2 Step-Up Auth & Reason String Presence                              |  |
|  +------------------------------------------------------+------------------------------------------------------+  |
|                                                         |                                                         |
|                                                         v                                                         |
|  +-------------------------------------------------------------------------------------------------------------+  |
|  | 5. Domain Service Invocation: Invoke Canonical Service (e.g. suspendWorkspace) within Prisma $transaction   |  |
|  +------------------------------------------------------+------------------------------------------------------+  |
|                                                         |                                                         |
|                                                         v                                                         |
|  +-------------------------------------------------------------------------------------------------------------+  |
|  | 6. Platform Audit Ledger Write: Append Structured Entry to PlatformAuditLog (Immutable)                      |  |
|  +------------------------------------------------------+------------------------------------------------------+  |
|                                                         |                                                         |
|                                                         v                                                         |
|  +-------------------------------------------------------------------------------------------------------------+  |
|  | 7. Standard Response Formatting: Return Standard Envelope { success: true, data: { ... } }                 |  |
|  +-------------------------------------------------------------------------------------------------------------+  |
+-------------------------------------------------------------------------------------------------------------------+
```

---

## 11. Architectural Sign-Off

This document stands as the locked architectural standard for Phase 1.19. All subsequent sub-phases (1.19.2 through 1.19.16) must implement components in strict conformance with the invariants, taxonomies, and boundaries defined herein.
