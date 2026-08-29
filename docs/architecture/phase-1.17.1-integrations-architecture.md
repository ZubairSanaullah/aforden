# Phase 1.17.1 — Third-Party Integrations Domain Architecture & Provider Abstraction Specification

> **Document Status**: LOCKED FOR IMPLEMENTATION (Phase 1.17 Architecture Standard)  
> **Domain**: Third-Party Integrations, Provider Abstraction, Capability Registry, Connection Lifecycle State Machine, Credential Management & Envelope Encryption, Webhook Ingestion Pipeline, Outbound Execution Pipeline, Failure Taxonomy, Entitlement Interaction  
> **Dependencies**: Phase 1.1 (Multi-Tenancy & Workspace Partitioning), Phase 1.2 (Authentication & RBAC), Phase 1.13 (Notifications & Transactional Outbox), Phase 1.15 (SaaS Billing & Entitlements), Phase 1.16 (Automations & Workflows)  
> **Target Schema & Service Implementation**: Phase 1.17.2 – Phase 1.17.10  
> **Out of Scope (Explicit Non-Goals)**: Concrete Provider SDK Adapters (Phase 1.17.4+), Prisma Database Migrations (Phase 1.17.2), REST API Handlers & Public Webhook Route Handlers (Phase 1.17.8/1.17.9), Visual Integration Marketplace UI (Phase 1.23)

---

## Executive Summary

Phases 1.1 through 1.16 established Aforden's multi-tenant core foundation, operational field service domains (Work Orders, Scheduling & Dispatch, Mobile Technician Execution, Inventory & Parts, Quotes & Estimates, Invoicing & Field Payments), decoupled notification engine, analytical reporting models, SaaS monetization/entitlements, and declarative automation workflow engine.

Phase 1.17 introduces the **Third-Party Integrations & Provider Abstraction Domain**: the unified platform subsystem enabling Aforden workspaces to securely connect to external software ecosystems (e.g., transactional communications, external calendars, cloud file storage, accounting/ERP ledgers, CRM syncs, and custom external webhooks) through a provider-agnostic, capability-driven architectural contract.

This document serves as the binding architectural specification for Phase 1.17. Ten foundational domain invariants govern this domain:

1. **Provider-Agnostic Sovereign Contract Invariant**: Aforden core domain services (Work Orders, Invoicing, Scheduling, Notifications, Automations) never couple directly to external third-party SDKs, proprietary REST APIs, or vendor-specific data models. All external interactions execute exclusively through standardized, strongly typed `IntegrationAdapter` contracts.
2. **Strict Multi-Tenant Connection Scoping Invariant**: Every `IntegrationConnection`, `IntegrationCredential`, `IntegrationWebhook`, and `IntegrationExecution` record is strictly scoped to a single `Workspace(id)`. Cross-workspace credential sharing, cross-tenant connection pooling, or ambient execution without tenant context is architecturally prohibited.
3. **Referenced-Only Immutable Credential Security Invariant**: Plaintext secret material (API keys, OAuth client secrets, refresh tokens, signing secrets) is never stored in plaintext and never embedded directly inside connection records, execution ledgers, audit trails, or API responses. Secrets reside in an envelope-encrypted credential vault referenced strictly by opaque identifier (`credentialRefId`).
4. **Closed Versioned Capability Registry Invariant**: What the platform can ask an external provider to execute is governed by a closed, compile-time, versioned registry enum (`IntegrationCapability`). Dynamic, unvalidated, or free-form capability strings are strictly forbidden.
5. **Strict Webhook Tenant Resolution Invariant**: Inbound webhooks must derive their tenant identity (`workspaceId`) exclusively from the platform-registered `IntegrationWebhook(endpointSlug) -> IntegrationConnection(workspaceId)` database binding. Under no circumstances is tenant identity parsed, accepted, or trusted from the incoming webhook payload.
6. **Centralized Idempotency Key Ownership Invariant**: The Integration Service layer owns the generation and propagation of outbound idempotency keys. Domain callers (e.g., WorkOrder, Invoice) invoke capabilities with domain intent and remain entirely agnostic of external idempotency token generation, formatting, or retry headers.
7. **Entitlement-Governed Execution Guard Invariant**: All integration connections, executions, and inbound webhooks are strictly guarded by Phase 1.15's Entitlement Resolver (`assertEntitlement(workspaceId, "FEATURE_INTEGRATIONS")`). Subscriptions lacking active integration entitlements are blocked from outbound dispatches and inbound processing while preserving encrypted configuration for seamless re-activation upon upgrade.
8. **Deterministic Capability Resolution Invariant**: When a domain service requests an action by capability (e.g., `EMAIL_SEND` or `ACCOUNTING_INVOICE_SYNC`), resolution to an active provider connection must be deterministic: explicit workspace preference override $\succ$ exclusive singleton provider $\succ$ fail-closed ambiguity guard. If multiple active providers advertise the same multi-provider capability and no default is configured, execution halts with a deterministic `AmbiguousCapabilityProviderError`.
9. **Normalized Failure Taxonomy Invariant**: All provider-specific HTTP status codes, error JSON schemas, rate limits, and network faults are translated into Aforden's unified, platform-wide `IntegrationFailure` taxonomy. Upstream services react to standardized error classifications (`RATE_LIMITED`, `AUTHENTICATION_FAILED`, `NETWORK_TIMEOUT`, `SERVICE_UNAVAILABLE`) rather than vendor-specific error structures.
10. **Immutable Append-Only Integration Execution Ledger Invariant**: Every outbound execution attempt generates an immutable `IntegrationExecution` record tracking request metadata, sanitized payloads, execution latency, correlation IDs, retry attempt numbers, and normalized results. Historical execution records can never be rewritten or deleted by tenant operations.

---

```
+-----------------------------------------------------------------------------------------------------------------------------------------------+
|                                                             WORKSPACE (Tenant Boundary)                                                       |
|                                                                                                                                               |
|  CALLING DOMAIN SERVICES (Phases 1.6 - 1.16)                  THIRD-PARTY INTEGRATION PLATFORM (Phase 1.17)                                   |
|  +--------------------------------------------+               +----------------------------------------------------------------------------+  |
|  | - WorkOrderService (1.6)                   |               | 1. Capability Resolution Engine (§2.3, §2.4)                               |  |
|  | - InvoicingService (1.12)                  |--- Request -->| - Workspace Partition & Entitlement Guard (Phase 1.15)                     |  |
|  | - NotificationService (1.13)               |               | - Multi-Provider vs Exclusive Singleton Routing Logic                      |  |
|  | - AutomationEngine (1.16)                  |               | - Deterministic Provider Tie-Break (Workspace Settings Default)            |  |
|  +--------------------------------------------+               +-------------------------------------+--------------------------------------+  |
|                                                                                                     | resolved connection                     |
|                                                                                                     v                                         |
|  ===========================================================================================================================================  |
|  |                                                INTEGRATION EXECUTION MANAGER (§6)                                                       |  |
|  |                                                                                                                                         |  |
|  |  - Centralized Idempotency Key Generation (UUIDv5)                                                                                      |  |
|  |  - Timeout & SLA Enforcement Engine                                                                                                     |  |
|  |  - Exponential Backoff & Retry Orchestrator                                                                                             |  |
|  |  - Envelope Credential Decryption (AES-256-GCM via KMS)                                                                                 |  |
|  |  - Append-Only Execution Ledger Initialization (Status: PENDING)                                                                        |  |
|  +------------------------------------------------------------------+----------------------------------------------------------------------+  |
|                                                                     | dispatches normalized request                                           |
|                                                                     v                                                                         |
|  ===========================================================================================================================================  |
|  |                                              PROVIDER ADAPTER LAYER (Interface §2.1)                                                     |  |
|  |                                                                                                                                         |  |
|  |  +-------------------------------+  +-------------------------------+  +-------------------------------+  +--------------------------+  |  |
|  |  | ResendAdapter                 |  | TwilioAdapter                 |  | QuickBooksAdapter             |  | GenericWebhookAdapter    |  |  |
|  |  | [EMAIL_SEND]                  |  | [SMS_SEND]                    |  | [ACCOUNTING_INVOICE_SYNC]     |  | [WEBHOOK_RECEIVE]        |  |  |
|  |  +---------------+---------------+  +---------------+---------------+  +---------------+---------------+  +------------+-------------+  |  |
|  ===================|===================================|===================================|=============================|=================  |
|                     | HTTPS API                         | HTTPS API                         | HTTPS API                   | HTTPS Inbound     |
|                     v                                   v                                   v                             ^                   |
|  +------------------------------------------------------------------------------------------------------------------------|----------------+  |
|  | EXTERNAL THIRD-PARTY ECOSYSTEM (Resend, Twilio, QuickBooks, Stripe, AWS S3, Cloud Providers)                           |                |  |
|  +------------------------------------------------------------------------------------------------------------------------|----------------+  |
|                                                                                                                           |                   |
|                                                                                         +---------------------------------+                   |
|                                                                                         | Inbound HTTP Webhook Request                        |
|                                                                                         v                                                     |
|  +-----------------------------------------------------------------------------------------------------------------------------------------+  |
|  | INBOUND WEBHOOK INGESTION PIPELINE (§5 - 8 Stages)                                                                                      |  |
|  | Stage 1: Signature Verification  -->  Stage 2: Timestamp Window  -->  Stage 3: Replay Protection Nonce Check                            |  |
|  | Stage 4: Strict Tenant Resolution via Registered Endpoint Slug                                                                          |  |
|  | Stage 5: Connection State & Entitlement Guard (Status Check: Reject ERROR -> 503, SUSPENDED -> 402, CONNECTING -> 409, DISCONNECTED -> 410)|  |
|  | Stage 6: Idempotency Inbox Check (connectionId + providerEventId)                                                                       |  |
|  | Stage 7: Event Normalization (Adapter)                           -->  Stage 8: Dispatch to Notification Outbox / Automation Engine      |  |
|  +-----------------------------------------------------------------------------------------------------------------------------------------+  |
|                                                                                                                                               |
|  +-----------------------------------------------------------------------------------------------------------------------------------------+  |
|  | IMMUTABLE AUDIT & EXECUTION LEDGER (§1.6, §4.3)                                                                                         |  |
|  | - IntegrationExecution (id, workspaceId, connectionId, capability, idempotencyKey, correlationId, status, durationMs, failureJson)       |  |
|  | - IntegrationWebhookEvent (id, workspaceId, connectionId, providerEventId, status, headersJson, payloadJson, processedAt)              |  |
|  +-----------------------------------------------------------------------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------------------------------------------------------------------+
```

---

## 1. Core Entities Specification

The integration domain is anchored by seven canonical data entities. Each entity has a defined purpose, identity model, lifecycle, and strict workspace partition relationship.

```
+-------------------+ 1       * +-------------------------+ 1       * +--------------------------+
|    Integration    |-----------|  IntegrationConnection  |-----------|   IntegrationCredential    |
| (Platform Global) |           |  (Workspace Scoped)     |           | (Envelope-Encrypted Secret)|
+-------------------+           +-------------------------+           +--------------------------+
                                    | 1               | 1
                                    |                 |
                                    | *               | *
                        +----------------------+  +------------------------+
                        |  IntegrationWebhook  |  |  IntegrationExecution  |
                        |  (Inbound Endpoint)  |  |  (Append-Only Ledger)  |
                        +----------------------+  +------------------------+
```

### 1.1 `Integration`
* **Purpose**: Represents a platform-wide provider catalog entry defining a supported third-party system (e.g., `"resend"`, `"twilio"`, `"quickbooks"`, `"google_calendar"`, `"s3"`, `"stripe_sync"`). It defines metadata, advertised capabilities, authentication requirements, and configuration JSON schemas.
* **Identity & Key Strategy**: Global alphanumeric slug primary key (`id: string`, e.g., `"resend"`, `"quickbooks_online"`). Platform-managed singleton registry.
* **Lifecycle**: `ACTIVE` $\to$ `DEPRECATED` $\to$ `DISABLED`.
* **Workspace Scoping**: **Platform-Level (Global)**. Integrations are defined centrally in the platform catalog and referenced by tenant connections. Integrations contain zero tenant-specific data.

### 1.2 `IntegrationConnection`
* **Purpose**: Represents a workspace's concrete configured instance of a connection to a specific provider `Integration`. It holds connection-specific operational configuration (e.g., sender email address, company account ID, default tax code), current lifecycle state, health telemetry, and a reference to its secure credentials.
* **Identity & Key Strategy**: UUID primary key (`id: string`). Unique composite constraint: `@@unique([workspaceId, integrationId, connectionKey])`. Standard single connections use default key `"default"`.
* **Lifecycle**: Governed by the Connection Lifecycle State Machine (§3.1 – §3.4: `DISCONNECTED` $\to$ `CONNECTING` $\to$ `CONNECTED` $\to$ `ERROR` $\to$ `SUSPENDED_ENTITLEMENT`).
* **Workspace Scoping**: **Strictly Workspace-Scoped**. Enforces `@relation(fields: [workspaceId], references: [id], onDelete: Cascade)`. Cross-tenant access is prohibited.

### 1.3 `IntegrationCredential`
* **Purpose**: Holds encrypted secret material (API keys, OAuth2 client secrets, access tokens, refresh tokens, webhook signing secrets) required to authenticate outbound API requests or verify inbound webhooks.
* **Identity & Key Strategy**: UUID primary key (`id: string`). Unique composite constraint: `@@unique([connectionId, version])`.
* **Lifecycle**: Governed by the Credential Lifecycle State Machine (§3.5: `ACTIVE` $\to$ `ROTATING` $\to$ `SUPERSEDED` $\to$ `REVOKED`).
* **Workspace Scoping**: **Referenced-Only & Indirectly Workspace-Scoped**. Linked to `IntegrationConnection(id)`. Plaintext secrets are never stored in the database or embedded in `IntegrationConnection` models. Secrets are envelope-encrypted at rest using AES-256-GCM.

### 1.4 `IntegrationCapability`
* **Purpose**: A closed, compile-time, versioned enumeration catalog specifying every atomic operation Aforden can request an external provider to perform.
* **Identity & Key Strategy**: Versioned TypeScript enum and immutable platform catalog (`IntegrationCapability`).
* **Catalog Enum Values**:
  * `EMAIL_SEND`: Outbound transactional and notification email dispatch.
  * `SMS_SEND`: Outbound transactional SMS messaging.
  * `CALENDAR_WRITE`: Syncing appointments, schedules, and work order bookings to external calendars.
  * `CALENDAR_READ`: Reading external calendar events for technician conflict and availability checks.
  * `ACCOUNTING_INVOICE_SYNC`: Synchronizing Aforden invoices to external accounting ledgers.
  * `ACCOUNTING_PAYMENT_SYNC`: Synchronizing payments and reconciliations to external accounting ledgers.
  * `ACCOUNTING_CUSTOMER_SYNC`: Synchronizing customer records and billing profiles to accounting ledgers.
  * `FILE_UPLOAD`: Offloading binary attachments, photo evidence, and documents to cloud object storage.
  * `FILE_DOWNLOAD`: Generating secure pre-signed download URLs for stored binary assets.
  * `WEBHOOK_RECEIVE`: Ingesting and processing inbound event webhooks from external providers.
  * `CRM_CONTACT_SYNC`: Synchronizing customer service locations and contact cards to external CRMs.
* **Workspace Scoping**: **Platform-Level Registry Catalog**. Workspaces configure default provider preferences per capability via `WorkspaceIntegrationSetting`.

### 1.5 `IntegrationWebhook`
* **Purpose**: Represents an inbound public webhook endpoint registration tied to an active `IntegrationConnection`. It maps an immutable, random public URL slug to the connection, stores the webhook signing secret reference, and defines enabled event subscriptions.
* **Identity & Key Strategy**: UUID primary key (`id: string`). Globally unique public endpoint slug (`endpointSlug: string`, e.g., `"wh_sec_9f8a7b6c5d4e3f2a1b0c"`).
* **Lifecycle**: `ACTIVE` $\to$ `PAUSED` $\to$ `DISABLED`.
* **Workspace Scoping**: **Strictly Workspace-Scoped**. Bound to `IntegrationConnection(workspaceId)`. Lookups resolve the connection first; tenant context is never read from the payload.

### 1.6 `IntegrationExecution`
* **Purpose**: An immutable, append-only ledger record documenting a single outbound execution attempt by the platform through an integration adapter. Captures execution timing, correlation ID, idempotency key, sanitized request snapshot, sanitized response snapshot, attempt number, and normalized failure details.
* **Identity & Key Strategy**: UUID primary key (`id: string`). Indexed by `[workspaceId, createdAt]`, `[connectionId, createdAt]`, `[idempotencyKey]`, and `[correlationId]`.
* **Lifecycle**: State machine: `PENDING` $\to$ `RUNNING` $\to$ `COMPLETED` | `FAILED` | `TIMED_OUT`. Terminal states are permanently immutable.
* **Workspace Scoping**: **Strictly Workspace-Scoped**. Enforces `@relation(fields: [workspaceId], references: [id], onDelete: Cascade)`.

### 1.7 `IntegrationFailure`
* **Purpose**: A normalized platform failure taxonomy and data structure that standardizes disparate third-party error formats into deterministic error classes, retry classifications, and diagnostic structures.
* **Identity & Key Strategy**: Standardized TypeScript interface and enum taxonomy (`IntegrationFailureCode`).
* **Taxonomy Codes**:
  * `AUTHENTICATION_FAILED`: Invalid API key, revoked OAuth token, or rejected signature.
  * `TOKEN_EXPIRED`: OAuth access token expired and requires refresh.
  * `RATE_LIMITED`: Provider rate limit exceeded (includes `retryAfterSeconds` if advertised).
  * `NETWORK_TIMEOUT`: Request exceeded platform SLA timeout deadline.
  * `SERVICE_UNAVAILABLE`: Upstream provider returned 502/503/504 or dropped connection.
  * `BAD_REQUEST`: Upstream provider rejected payload formatting, parameters, or schema.
  * `PAYLOAD_VALIDATION_FAILED`: Local adapter rejected request prior to network transmission.
  * `RESOURCE_NOT_FOUND`: Target entity (customer, account, invoice) does not exist in upstream provider.
  * `CAPABILITY_UNSUPPORTED`: Requested capability not supported by the resolved provider.
  * `ENTITLEMENT_BLOCKED`: Execution rejected because tenant subscription tier lacks integration entitlement.
  * `INTERNAL_ADAPTER_ERROR`: Unhandled exception or mapping failure inside adapter logic.

---

## 2. Provider Abstraction Contract & Capability Resolution

### 2.1 `IntegrationAdapter` Contract

Every third-party integration in Aforden must implement the `IntegrationAdapter` interface. Adapters are stateless workers that accept validated requests, execute communication over HTTPS, and return normalized responses.

```typescript
/**
 * Phase 1.17.1 — Universal Integration Adapter Interface Contract
 */

export interface ConnectResult {
  readonly success: boolean;
  readonly connectionStatus: IntegrationConnectionStatus;
  readonly externalAccountId?: string;
  readonly externalAccountName?: string;
  readonly credentialReference: IntegrationSecretReference;
  readonly metadata?: Record<string, unknown>;
  readonly failure?: IntegrationFailure;
}

export interface TestResult {
  readonly success: boolean;
  readonly latencyMs: number;
  readonly checkedAt: Date;
  readonly failure?: IntegrationFailure;
  readonly details?: Record<string, unknown>;
}

export interface IntegrationExecutionRequest {
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly capability: IntegrationCapability;
  readonly action: string;
  readonly payload: Record<string, unknown>;
  readonly idempotencyKey: string;
  readonly correlationId: string;
  readonly timeoutMs?: number;
  readonly secretReference: IntegrationSecretReference;
  readonly connectionConfig: Record<string, unknown>;
}

export interface IntegrationExecutionResult {
  readonly success: boolean;
  readonly capability: IntegrationCapability;
  readonly action: string;
  readonly data?: Record<string, unknown>;
  readonly rawResponseStatus?: number;
  readonly providerRequestId?: string;
  readonly durationMs: number;
  readonly failure?: IntegrationFailure;
}

export interface IntegrationEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: Date;
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly entityType: string;
  readonly entityId?: string;
  readonly payload: Record<string, unknown>;
  readonly rawPayloadHash: string;
}

export interface IntegrationSecretReference {
  readonly secretId: string;
  readonly version: number;
  readonly keyVaultProvider: "AWS_KMS" | "LOCAL_ENCRYPTED_DB" | "HASHICORP_VAULT";
  readonly algorithm: "AES_256_GCM";
  readonly fingerprint: string;
  readonly expiresAt?: Date;
}

export interface IntegrationAdapter {
  readonly integrationId: string;
  readonly displayName: string;
  readonly version: string;

  /**
   * Initializes or verifies a connection handshake (e.g., exchange OAuth code for tokens).
   */
  connect(
    connection: IntegrationConnection,
    authPayload?: unknown
  ): Promise<ConnectResult>;

  /**
   * Gracefully tears down connection (e.g., revokes upstream OAuth tokens).
   */
  disconnect(
    connection: IntegrationConnection,
    secretReference: IntegrationSecretReference
  ): Promise<void>;

  /**
   * Non-destructive health check ping to verify credential validity and upstream API reachability.
   */
  testConnection(
    connection: IntegrationConnection,
    secretReference: IntegrationSecretReference
  ): Promise<TestResult>;

  /**
   * Executes a discrete outbound capability action.
   */
  execute(
    request: IntegrationExecutionRequest
  ): Promise<IntegrationExecutionResult>;

  /**
   * Ingests, verifies, and normalizes an inbound webhook payload.
   */
  handleWebhook(
    payload: unknown,
    headers: Headers,
    secretReference: IntegrationSecretReference,
    connection: IntegrationConnection
  ): Promise<IntegrationEvent | null>;

  /**
   * Returns the immutable list of capabilities advertised and implemented by this adapter.
   */
  getCapabilities(): readonly IntegrationCapability[];
}
```

### 2.2 Capability Registry Catalog & Multi-Provider Semantics

The `IntegrationCapability` catalog is a frozen compile-time registry mapping capabilities to standard operational requirements:

```typescript
export enum IntegrationCapability {
  EMAIL_SEND = "EMAIL_SEND",
  SMS_SEND = "SMS_SEND",
  CALENDAR_WRITE = "CALENDAR_WRITE",
  CALENDAR_READ = "CALENDAR_READ",
  ACCOUNTING_INVOICE_SYNC = "ACCOUNTING_INVOICE_SYNC",
  ACCOUNTING_PAYMENT_SYNC = "ACCOUNTING_PAYMENT_SYNC",
  ACCOUNTING_CUSTOMER_SYNC = "ACCOUNTING_CUSTOMER_SYNC",
  FILE_UPLOAD = "FILE_UPLOAD",
  FILE_DOWNLOAD = "FILE_DOWNLOAD",
  WEBHOOK_RECEIVE = "WEBHOOK_RECEIVE",
  CRM_CONTACT_SYNC = "CRM_CONTACT_SYNC",
}

export interface CapabilityDefinition {
  readonly capability: IntegrationCapability;
  readonly displayName: string;
  readonly description: string;
  readonly defaultTimeoutMs: number;
  /**
   * Defines whether a workspace is permitted to maintain multiple simultaneous
   * CONNECTED providers for this capability:
   * - `false` (Exclusive Singleton): A workspace may have at most ONE active CONNECTED
   *   provider for this capability (e.g. Accounting Ledgers, Calendar Sync, Primary File Storage).
   *   Attempting to activate a second provider without disconnecting the active one is rejected.
   * - `true` (Multi-Provider Transport): A workspace may connect multiple distinct providers
   *   concurrently (e.g. Email channels, SMS gateways, multiple Webhook endpoints).
   */
  readonly allowsMultipleActiveProviders: boolean;
}

export const CAPABILITY_REGISTRY: Record<IntegrationCapability, CapabilityDefinition> = {
  [IntegrationCapability.EMAIL_SEND]: {
    capability: IntegrationCapability.EMAIL_SEND,
    displayName: "Outbound Email Dispatch",
    description: "Send transactional and operational emails via provider",
    defaultTimeoutMs: 5000,
    allowsMultipleActiveProviders: true,
  },
  [IntegrationCapability.SMS_SEND]: {
    capability: IntegrationCapability.SMS_SEND,
    displayName: "Outbound SMS Dispatch",
    description: "Send transactional and alert SMS messages via provider",
    defaultTimeoutMs: 5000,
    allowsMultipleActiveProviders: true,
  },
  [IntegrationCapability.CALENDAR_WRITE]: {
    capability: IntegrationCapability.CALENDAR_WRITE,
    displayName: "External Calendar Sync (Write)",
    description: "Write bookings and schedule appointments to external calendar",
    defaultTimeoutMs: 8000,
    allowsMultipleActiveProviders: false,
  },
  [IntegrationCapability.CALENDAR_READ]: {
    capability: IntegrationCapability.CALENDAR_READ,
    displayName: "External Calendar Sync (Read)",
    description: "Read external calendar busy slots for technician scheduling",
    defaultTimeoutMs: 8000,
    allowsMultipleActiveProviders: false,
  },
  [IntegrationCapability.ACCOUNTING_INVOICE_SYNC]: {
    capability: IntegrationCapability.ACCOUNTING_INVOICE_SYNC,
    displayName: "Accounting Invoice Synchronization",
    description: "Sync Aforden field invoices into external accounting ledgers",
    defaultTimeoutMs: 15000,
    allowsMultipleActiveProviders: false,
  },
  [IntegrationCapability.ACCOUNTING_PAYMENT_SYNC]: {
    capability: IntegrationCapability.ACCOUNTING_PAYMENT_SYNC,
    displayName: "Accounting Payment Synchronization",
    description: "Sync settled payments and refunds to accounting ledgers",
    defaultTimeoutMs: 15000,
    allowsMultipleActiveProviders: false,
  },
  [IntegrationCapability.ACCOUNTING_CUSTOMER_SYNC]: {
    capability: IntegrationCapability.ACCOUNTING_CUSTOMER_SYNC,
    displayName: "Accounting Customer Synchronization",
    description: "Sync customer profiles and tax exemptions to accounting ledgers",
    defaultTimeoutMs: 15000,
    allowsMultipleActiveProviders: false,
  },
  [IntegrationCapability.FILE_UPLOAD]: {
    capability: IntegrationCapability.FILE_UPLOAD,
    displayName: "Cloud File Storage (Upload)",
    description: "Offload photo evidence and attachments to cloud bucket",
    defaultTimeoutMs: 30000,
    allowsMultipleActiveProviders: false,
  },
  [IntegrationCapability.FILE_DOWNLOAD]: {
    capability: IntegrationCapability.FILE_DOWNLOAD,
    displayName: "Cloud File Storage (Download)",
    description: "Generate secure download signatures for stored assets",
    defaultTimeoutMs: 5000,
    allowsMultipleActiveProviders: false,
  },
  [IntegrationCapability.WEBHOOK_RECEIVE]: {
    capability: IntegrationCapability.WEBHOOK_RECEIVE,
    displayName: "Inbound Webhook Processing",
    description: "Ingest and verify external provider webhooks",
    defaultTimeoutMs: 5000,
    allowsMultipleActiveProviders: true,
  },
  [IntegrationCapability.CRM_CONTACT_SYNC]: {
    capability: IntegrationCapability.CRM_CONTACT_SYNC,
    displayName: "CRM Contact Synchronization",
    description: "Sync customer service locations and contacts to external CRM",
    defaultTimeoutMs: 12000,
    allowsMultipleActiveProviders: false,
  },
};
```

### 2.3 Capability Resolution Architecture & Deterministic Routing

The `CapabilityDefinition.allowsMultipleActiveProviders` specification directly dictates both **Connection Provisioning Guards** and **Runtime Resolution Tie-Breaking**:

```
[Domain Request: executeCapability(workspaceId, capability, action, payload, optionalProviderHint?)]
                                         │
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Step 1: Evaluate Entitlement Guard                                                               │
│ assertEntitlement(workspaceId, "FEATURE_INTEGRATIONS")                                           │
└────────────────────────────────────────┬─────────────────────────────────────────────────────────┘
                                         │ Entitled
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Step 2: Check Explicit Target Hint or Workspace Default Setting Override                         │
│ If optionalProviderHint supplied OR WorkspaceIntegrationSetting.defaultProviders[cap] is set:     │
│ - Validate target connection exists, belongs to workspaceId, and status == CONNECTED             │
│ - If valid -> Return Target Connection Immediately                                               │
│ - If invalid -> Throw ConnectionNotReadyError                                                    │
└────────────────────────────────────────┬─────────────────────────────────────────────────────────┘
                                         │ No Explicit Override / Hint Supplied
                                         ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Step 3: Query Active Connections in Workspace                                                    │
│ activeConnections = query(workspaceId, status: CONNECTED, adapter.hasCapability(capability))     │
└────────────────────────────────────────┬─────────────────────────────────────────────────────────┘
                                         │
               ┌─────────────────────────┴─────────────────────────┐
               │ Inspect CAPABILITY_REGISTRY[cap].allowsMultipleActiveProviders
               ▼                                                   ▼
┌───────────────────────────────────────────────┐ ┌────────────────────────────────────────────────┐
│ Branch A: allowsMultipleActiveProviders = false│ │ Branch B: allowsMultipleActiveProviders = true │
│ (Exclusive Singleton Capability)              │ │ (Multi-Provider Transport Capability)          │
└──────────────────────┬────────────────────────┘ └───────────────────────┬────────────────────────┘
                       │                                                  │
          ┌────────────┴────────────┐                        ┌────────────┼────────────┐
          ▼ (1 Match)               ▼ (0 Matches)            ▼ (1 Match)  ▼ (>1 Match) ▼ (0 Matches)
┌───────────────────┐     ┌───────────────────┐    ┌───────────────┐ ┌──────────────┐ ┌────────────┐
│ Return Exclusive  │     │ Check Fallback    │    │ Return Single │ │ Throw        │ │ Check      │
│ Active Connection │     │ Rules             │    │ Active Provider││ Ambiguous-   │ │ Fallback   │
└───────────────────┘     └─────────┬─────────┘    └───────────────┘ │ Capability-  │ │ Rules      │
                                    │                                │ ProviderError│ └─────┬──────┘
                                    ▼                                │ (Fail-Closed)│       │
                         ┌────────────────────┐                      └──────────────┘       ▼
                         │ Built-in Fallback  │                                   ┌────────────────┐
                         │ Available?         │                                   │ Built-in       │
                         └──────────┬─────────┘                                   │ Fallback       │
                                    │                                             │ Available?     │
                         ┌──────────┴──────────┐                                  └───────┬────────┘
                         ▼ Yes                 ▼ No                                       │
              ┌────────────────────┐ ┌─────────────────────┐                   ┌──────────┴──────────┐
              ▼ Route to Platform  │ │ Throw Capability-   │                   ▼ Yes                 ▼ No
              │ Default Adapter    │ │ ProviderNot-        │        ┌────────────────────┐ ┌─────────────────┐
              └────────────────────┘ │ ConfiguredError     │        │ Route to Platform  │ │ Throw Capability│
                                     └─────────────────────┘        │ Default Adapter    │ │ ProviderNot-    │
                                                                    └────────────────────┘ │ ConfiguredError │
                                                                                           └─────────────────┘
```

#### Deterministic Routing Rules:
1. **Explicit Routing Priority**: If the caller passes an explicit `optionalProviderHint` (e.g. specific `connectionId` or provider slug) OR the workspace has an explicit default in `WorkspaceIntegrationSetting.defaultProviders[capability]`, the resolver verifies that the designated connection is `CONNECTED` and selects it.
2. **Exclusive Singleton Capability Branch (`allowsMultipleActiveProviders: false`)**:
   * For single-ledger or exclusive operations (e.g., `ACCOUNTING_INVOICE_SYNC`, `CALENDAR_WRITE`), Aforden enforces a strict **Exclusive Capability Provisioning Guard**: a workspace cannot have more than one connection in `CONNECTED` status advertising this capability at any time (§2.4).
   * If an active connection exists, resolution is inherently 1:1 and returns that connection without ambiguity.
   * If zero active connections exist, the system checks for platform fallback or throws `CapabilityProviderNotConfiguredError`.
3. **Multi-Provider Transport Branch (`allowsMultipleActiveProviders: true`)**:
   * For multi-transport operations (e.g., `EMAIL_SEND`, `SMS_SEND`, `WEBHOOK_RECEIVE`), multiple active providers may legitimately coexist in `CONNECTED` status.
   * If exactly one active connection exists, it is selected.
   * If multiple active connections exist with **no explicit default setting**, the resolver **never** selects non-deterministically (e.g., "first found" or random pick). It fails closed with `AmbiguousCapabilityProviderError`, prompting the workspace administrator to define a default provider in settings.
4. **Platform Fallback / Fail-Closed Guard**: If zero active connections exist for the capability, the system checks whether the capability permits a platform-level fallback (e.g., system transactional email). If permitted, it routes to the platform default adapter; otherwise, it throws `CapabilityProviderNotConfiguredError`.

---

### 2.4 Exclusive Capability Singleton Guard Enforcement Mechanism

To guarantee the **Exclusive Singleton Invariant** (`allowsMultipleActiveProviders: false`), the system employs a dual-layer enforcement architecture (transactional pre-check + database unique constraint), matching the rigor of the credential singleton invariant in §3.5:

```
[Connection Activation Request: CONNECTING -> CONNECTED]
                            │
                            ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Layer 1: Transactional Service Pre-Check ($transaction)                │
│ assertExclusiveCapabilityAvailability(tx, workspaceId, connectionId)   │
│ - Query WorkspaceActiveExclusiveCapability for workspace + capability  │
│ - If active exclusive provider exists:                                 │
│     Throw ExclusiveCapabilityConflictError                             │
└───────────────────────────┬────────────────────────────────────────────┘
                            │ No Existing Active Provider
                            ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Layer 2: PostgreSQL Database Unique Constraint Enforcement             │
│ Upsert row into WorkspaceActiveExclusiveCapability                     │
│ Table Constraint: @@unique([workspaceId, capability])                  │
│ - Guarantees atomic serialization against concurrent race conditions    │
│ - Disconnecting/Errored connection releases/deletes capability row     │
└───────────────────────────┬────────────────────────────────────────────┘
                            │ Success
                            ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Atomic Status Transition: IntegrationConnection.status = CONNECTED     │
└────────────────────────────────────────────────────────────────────────┘
```

#### Dual-Layer Enforcement Details:
1. **Application / Service Layer Guard (`assertExclusiveCapabilityAvailability`)**:
   * Executed inside the database transaction (`$transaction`) handling the `CONNECTING → CONNECTED` transition rule.
   * Inspects the capabilities advertised by `adapter.getCapabilities()`.
   * For every capability where `CAPABILITY_REGISTRY[cap].allowsMultipleActiveProviders === false`:
     * Queries for any existing connection in the workspace with `status === "CONNECTED"` that claims that same exclusive capability.
     * If found, halts the transition and throws `ExclusiveCapabilityConflictError`:
       `"Workspace [workspaceId] already has an active connection [existingConnectionId] for exclusive capability [capability]. You must disconnect the active provider before connecting a new one."`
2. **Database Constraint Layer (`WorkspaceActiveExclusiveCapability`)**:
   * To prevent race conditions from parallel activation requests, Phase 1.17.2's schema introduces a relational registry table:
     ```prisma
     model WorkspaceActiveExclusiveCapability {
       id           String                @id @default(cuid())
       workspaceId  String
       capability   IntegrationCapability
       connectionId String
       createdAt    DateTime              @default(now())

       workspace    Workspace             @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
       connection   IntegrationConnection @relation(fields: [connectionId], references: [id], onDelete: Cascade)

       @@unique([workspaceId, capability])
       @@index([workspaceId])
       @@index([connectionId])
     }
     ```
   * When a connection transitions to `CONNECTED`, its exclusive capabilities are inserted into `WorkspaceActiveExclusiveCapability` within the same transaction.
   * If two concurrent transactions attempt to activate competing connections for the same exclusive capability, PostgreSQL's `@@unique([workspaceId, capability])` constraint guarantees that the second transaction aborts with a unique constraint violation (`P2002`), making split-brain activation structurally impossible.
   * When a connection transitions away from `CONNECTED` (to `DISCONNECTED`, `ERROR`, or `SUSPENDED_ENTITLEMENT`), its entries in `WorkspaceActiveExclusiveCapability` are atomically removed.

---

## 3. Connection & Credential Lifecycle State Machines

### 3.1 `IntegrationConnection` State Definitions

The lifecycle of an `IntegrationConnection` is modeled on the data-driven guard pattern established in Phase 1.15.4 (`subscriptionStateMachine.ts`). Transitions are strictly validated against a declarative state transition matrix.

```
                                  USER_ACTION:connect_init
                   ┌─────────────────────────────────────────────────────┐
                   │                                                     │
                   ▼                                                     │
          +-----------------+    OAUTH:callback_success     +-----------------+
          |                 |------------------------------>|                 |
          |   CONNECTING    |                               |    CONNECTED    |
          |                 |<------------------------------|                 |
          +-----------------+    USER_ACTION:reconnect_init +-----------------+
            │             ▲                                   │             ▲
            │             │                                   │             │
OAuth Fail  │             │ Recovery Attempt        Auth Fail │             │ Recovery via
or Abort    │             │                                   │             │ Token Refresh/Test
            ▼             │                                   ▼             │
          +-----------------+    USER_ACTION:reconnect_init +-----------------+
          |                 |------------------------------>|                 |
          |  DISCONNECTED   |                               |      ERROR      |
          |  (Initial / End)|<------------------------------|                 |
          +-----------------+    USER_ACTION:disconnect     +-----------------+
            ▲             ▲                                   │
            │             └───────────────────────────────────┘
            │                    USER_ACTION:disconnect
            │
            │  ENTITLEMENT:feature_revoked
            ▼
          +-------------------------------------------------+
          |              SUSPENDED_ENTITLEMENT              |
          | (Credentials preserved, new executions blocked) |
          +-------------------------------------------------+
```

| State | Architectural Definition | Executions Allowed? | Webhooks Ingested? |
| :--- | :--- | :--- | :--- |
| **`DISCONNECTED`** | Connection is inactive or voluntarily disconnected. Credentials are wiped or marked revoked. | **No** | **No** (Rejected with HTTP 410 / 404) |
| **`CONNECTING`** | Connection is in the process of initial authentication handshake, OAuth redirection, or verification. | **No** | **No** (Rejected with HTTP 409) |
| **`CONNECTED`** | Connection is fully authenticated, operational, healthy, and ready to accept outbound and inbound traffic. | **Yes** | **Yes** (HTTP 200) |
| **`ERROR`** | An authentication, authorization, or persistent health check failure occurred. Connection is degraded. | **No** | **No** (Rejected with HTTP 503) |
| **`SUSPENDED_ENTITLEMENT`** | Workspace subscription or entitlement plan no longer permits integrations. Config is frozen. | **No** | **No** (Rejected with HTTP 402 / 423) |

### 3.2 Declarative Connection Transition Matrix

Transitions are locked as an immutable array of rules:

```typescript
export interface IntegrationTransitionRule {
  readonly from: IntegrationConnectionStatus;
  readonly to: IntegrationConnectionStatus;
  readonly permittedTriggers: readonly string[];
  readonly description: string;
}

export const INTEGRATION_TRANSITIONS: readonly IntegrationTransitionRule[] = [
  {
    from: "DISCONNECTED",
    to: "CONNECTING",
    permittedTriggers: ["USER_ACTION:connect_init", "SYSTEM:reconnect_init"],
    description: "User initiates connection setup or OAuth handshake.",
  },
  {
    from: "CONNECTING",
    to: "CONNECTED",
    permittedTriggers: [
      "OAUTH:callback_success",
      "API_KEY:verify_success",
      "TEST_CONNECTION:success",
    ],
    description: "Initial authentication and handshake successfully validated.",
  },
  {
    from: "CONNECTING",
    to: "ERROR",
    permittedTriggers: [
      "OAUTH:callback_failed",
      "API_KEY:verify_failed",
      "TEST_CONNECTION:failed",
      "TIMEOUT:handshake_expired",
    ],
    description: "Initial authentication attempt failed or timed out.",
  },
  {
    from: "CONNECTING",
    to: "DISCONNECTED",
    permittedTriggers: ["USER_ACTION:cancel_connect"],
    description: "User cancels the in-flight connection configuration.",
  },
  {
    from: "CONNECTED",
    to: "ERROR",
    permittedTriggers: [
      "AUTH:token_refresh_failed",
      "EXECUTION:auth_failed_401",
      "EXECUTION:auth_failed_403",
      "HEALTH_CHECK:failed",
    ],
    description: "Provider rejected credentials, refresh token failed, or health check broke.",
  },
  {
    from: "CONNECTED",
    to: "DISCONNECTED",
    permittedTriggers: [
      "USER_ACTION:disconnect",
      "SYSTEM:provider_deprecated",
      "ADMIN:force_disconnect",
    ],
    description: "User or platform administrator voluntarily disconnects the integration.",
  },
  {
    from: "CONNECTED",
    to: "SUSPENDED_ENTITLEMENT",
    permittedTriggers: [
      "ENTITLEMENT:feature_revoked",
      "BILLING:subscription_downgraded",
      "BILLING:subscription_past_due_cutoff",
    ],
    description: "Workspace subscription tier downgraded; integration blocked by quota engine.",
  },
  {
    from: "ERROR",
    to: "CONNECTED",
    permittedTriggers: [
      "AUTH:token_refresh_success",
      "HEALTH_CHECK:recovered",
      "API_KEY:update_success",
      "TEST_CONNECTION:success",
    ],
    description: "Recovered from error state via token refresh, key update, or successful test.",
  },
  {
    from: "ERROR",
    to: "CONNECTING",
    permittedTriggers: ["USER_ACTION:reconnect_init"],
    description: "User initiates a fresh OAuth flow or re-authentication handshake.",
  },
  {
    from: "ERROR",
    to: "DISCONNECTED",
    permittedTriggers: ["USER_ACTION:disconnect", "ADMIN:force_disconnect"],
    description: "User abandons or disconnects an errored integration.",
  },
  {
    from: "SUSPENDED_ENTITLEMENT",
    to: "CONNECTED",
    permittedTriggers: [
      "ENTITLEMENT:feature_restored",
      "BILLING:subscription_reactivated",
      "BILLING:plan_upgraded",
    ],
    description: "Workspace subscription reactivated or upgraded to tier supporting integrations.",
  },
  {
    from: "SUSPENDED_ENTITLEMENT",
    to: "DISCONNECTED",
    permittedTriggers: ["USER_ACTION:disconnect"],
    description: "User voluntarily removes connection while under entitlement suspension.",
  },
] as const;
```

### 3.3 Connection Error Recoverability Rules

A critical architectural distinction is made between transient network errors and persistent authentication errors:
* **Transient Execution Errors Do NOT Trigger `ERROR` State**: If an outbound call fails due to a rate limit (429), gateway timeout (504), or network drop, the individual `IntegrationExecution` record transitions to `FAILED`, but the `IntegrationConnection` **remains `CONNECTED`**.
* **Persistent Auth / Credential Failures Trigger `ERROR` State**: If an execution receives an HTTP 401/403 or OAuth token refresh fails, the connection transitions to `ERROR`.
* **In-Place Recovery Without Reconnect**: An `IntegrationConnection` in `ERROR` status does not force a full tear-down and re-provisioning. If a background worker successfully refreshes the OAuth token, or an administrator supplies updated API credentials and triggers `testConnection()`, the state transitions directly from `ERROR` $\to$ `CONNECTED`.

### 3.4 Interaction with Phase 1.15 Entitlement Resolver

When a workspace's subscription changes, the integration state machine interacts with Phase 1.15's Entitlement Resolver (`resolveEntitlement()`):
1. **Entitlement Revocation**: If a workspace downgrades to a plan where `FEATURE_INTEGRATIONS` is `false`, active connections transition to `SUSPENDED_ENTITLEMENT`.
2. **Credential & Config Preservation**: The system **does not** delete `IntegrationConnection`, `IntegrationCredential`, or configuration records. Secret material remains securely encrypted in the database.
3. **Execution & Webhook Blocking**: When `SUSPENDED_ENTITLEMENT` is active:
   * Outbound calls reject immediately with `EntitlementBlockedError` before attempting network transport.
   * Inbound webhooks return HTTP 402 (Payment Required) or HTTP 423 (Locked) to inform the sender that processing is paused.
4. **Instant Restoration on Upgrade**: When the tenant upgrades back to an eligible tier, the entitlement hook transitions connections back from `SUSPENDED_ENTITLEMENT` $\to$ `CONNECTED` without requiring re-authentication.

---

### 3.5 `IntegrationCredential` Lifecycle State Machine

To guarantee cryptographic integrity, safe token rotation, and zero in-flight execution dropouts, `IntegrationCredential` entities follow their own strict, data-driven lifecycle state machine.

```
                          ROTATION_INIT:scheduled / manual
                   ┌───────────────────────────────────────────┐
                   │                                           │
                   ▼                                           │
          +-----------------+    ROTATION_VERIFY:success     +-----------------+
          |                 |------------------------------->|                 |
          |    ROTATING     |                                |     ACTIVE      |
          |                 |                                |  (Authoritative)|
          +-----------------+                                +-----------------+
            │             ▲                                    │             │
            │             │                                    │             │
Rotation    │             │                                    │             │
Failed      │             │                                    │             │
            ▼             │                                    ▼             │
          +-----------------+    ROTATION:grace_period_expired+-----------------+
          |                 |<--------------------------------|                 |
          |     REVOKED     |                                 |   SUPERSEDED    |
          |    (Terminal)   |<────────────────────────────────|  (Grace Window) |
          +-----------------+     CONNECTION:disconnected     +-----------------+
                                  USER_ACTION:delete
```

#### Credential State Definitions:
| State | Architectural Definition | Outbound Execution Role | Inbound Webhook Verification Role |
| :--- | :--- | :--- | :--- |
| **`ACTIVE`** | The authoritative primary credential version currently in effect. | **Primary Target**: All new executions encrypt/authenticate with this version. | **Primary Target**: Webhook signatures evaluated against this key first. |
| **`ROTATING`** | A new credential version generated during refresh/rotation undergoing provider verification. | **Pending Verification**: Not used for outbound traffic until confirmed. | Not used for webhook verification. |
| **`SUPERSEDED`** | Previous credential version replaced by a newer `ACTIVE` version, held in read-only grace period (e.g. 24h). | **Forbidden**: Never used for new outbound executions. | **Secondary Fallback**: Allowed for webhook verification during clock-skew/overlap grace window. |
| **`REVOKED`** | Permanently invalidated, discarded, or cryptographically shredded. Irreversible terminal state. | **Forbidden**: Blocked completely. | **Forbidden**: Blocked completely. |

#### Declarative Credential Transition Matrix:

```typescript
export type IntegrationCredentialStatus = "ACTIVE" | "ROTATING" | "SUPERSEDED" | "REVOKED";

export interface CredentialTransitionRule {
  readonly from: IntegrationCredentialStatus;
  readonly to: IntegrationCredentialStatus;
  readonly permittedTriggers: readonly string[];
  readonly description: string;
}

export const CREDENTIAL_TRANSITIONS: readonly CredentialTransitionRule[] = [
  {
    from: "ACTIVE",
    to: "ROTATING",
    permittedTriggers: [
      "ROTATION_INIT:scheduled_expiry_window",
      "ROTATION_INIT:user_manual_trigger",
      "ROTATION_INIT:provider_webhook_event",
      "ROTATION_INIT:reactive_401_refresh",
    ],
    description: "Initiate token rotation handshake; creates new credential version in ROTATING state.",
  },
  {
    from: "ROTATING",
    to: "ACTIVE",
    permittedTriggers: [
      "ROTATION_VERIFY:handshake_success",
      "ROTATION_VERIFY:new_tokens_persisted",
    ],
    description: "New credential verified against upstream provider and promoted to authoritative ACTIVE version.",
  },
  {
    from: "ROTATING",
    to: "REVOKED",
    permittedTriggers: [
      "ROTATION_VERIFY:handshake_failed",
      "ROTATION:aborted_by_timeout",
      "ROTATION:invalid_grant_error",
    ],
    description: "Rotation attempt failed; discard candidate credential version without disrupting existing credentials.",
  },
  {
    from: "ACTIVE",
    to: "SUPERSEDED",
    permittedTriggers: [
      "ROTATION_PROMOTE:new_version_activated",
    ],
    description: "Existing ACTIVE credential demoted to SUPERSEDED upon successful activation of new version.",
  },
  {
    from: "ACTIVE",
    to: "REVOKED",
    permittedTriggers: [
      "USER_ACTION:delete_credential",
      "CONNECTION:disconnected",
      "ADMIN:force_revoke",
      "SECURITY:breach_revocation",
    ],
    description: "Credential explicitly revoked or connection severed; immediate cryptographic invalidation.",
  },
  {
    from: "SUPERSEDED",
    to: "REVOKED",
    permittedTriggers: [
      "ROTATION:grace_period_expired",
      "USER_ACTION:purge_old_versions",
      "CONNECTION:disconnected",
    ],
    description: "Overlap grace period expired (24h default); old key material permanently destroyed.",
  },
] as const;
```

#### Credential Invariants & Concurrency Rules:
1. **Single Active Credential Invariant**: At steady state, exactly **one** credential version may have status `ACTIVE` for any given `connectionId`. This is enforced dual-layer via PostgreSQL partial unique index `@@unique([connectionId, status]) WHERE status = 'ACTIVE'` and transactional atomic swap.
2. **Atomic Promotion & Demotion**: Promoting a `ROTATING` credential to `ACTIVE` and demoting the incumbent `ACTIVE` credential to `SUPERSEDED` occurs within a single, atomic database transaction (`$transaction`).
3. **Irreversible Revocation**: The `REVOKED` state is strictly terminal. Revoked credentials cannot be reactivated; a fresh credential must be provisioned via a new version ID.

---

## 4. Security Architecture

### 4.1 Credential Storage & Envelope Encryption

Plaintext credentials are never stored in the database. All sensitive data (API keys, client secrets, OAuth tokens, private keys) uses **Envelope Encryption** (AES-256-GCM) with key separation:

```
+----------------------------------------------------------------------------------------------------+
|                                    ENVELOPE ENCRYPTION ARCHITECTURE                                 |
|                                                                                                    |
|  Master Key Encryption Key (KEK)                                                                   |
|  (Stored in KMS / Environment Secret)                                                              |
|        │                                                                                           |
|        ▼                                                                                           |
|  +─────────────────────────────────────────────────────────+                                       |
|  | Decrypt / Unwrap DEK at runtime in memory               |                                       |
|  +─────────────────────────┬───────────────────────────────+                                       |
|                            │                                                                       |
|                            ▼                                                                       |
|  Data Encryption Key (DEK) ──── Encrypts / Decrypts ──── Plaintext Credential                      |
|  (Unique per secret version)    with AES-256-GCM        { apiKey: "...", refreshToken: "..." }     |
|        │                                                                                           |
|        ▼                                                                                           |
|  +──────────────────────────────────────────────────────────────────────────────────────────────+  |
|  | Stored Credential Record (IntegrationCredential)                                            |  |
|  | - id: "cred_123"                                                                             |  |
|  | - connectionId: "conn_456"                                                                   |  |
|  | - version: 1                                                                                 |  |
|  | - status: "ACTIVE"                                                                           |  |
|  | - keyVaultProvider: "AWS_KMS"                                                                |  |
|  | - algorithm: "AES_256_GCM"                                                                   |  |
|  | - iv: "dGVzdGl2MTIzNDU2" (96-bit initialization vector)                                      |  |
|  | - tag: "YXV0aHRhZzEyMzQ1Njc4" (128-bit authentication tag)                                   |  |
|  | - encryptedData: "eDF5Mnoz...==" (Ciphertext of credential JSON)                             |  |
|  | - encryptedDek: "bWFzdGVyZW5jcnlwdGVkZGVr..." (Wrapped DEK)                                  |  |
|  | - fingerprint: "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"     |  |
|  +----------------------------------------------------------------------------------------------+  |
+----------------------------------------------------------------------------------------------------+
```

#### Secret Reference vs. Plaintext Secret Shape:
* **Secret Reference (`IntegrationSecretReference`)**: Contains only `{ secretId, version, keyVaultProvider, algorithm, fingerprint, expiresAt }`. This object is safe to pass across internal service layers and log in tracing headers.
* **Plaintext Secret (`DecryptedSecretPayload`)**: Exists strictly in ephemeral local memory during adapter execution and is immediately garbage-collected.

### 4.2 Token Rotation Architecture & Concurrency Lock

OAuth tokens (e.g., QuickBooks, Google Calendar) require periodic refresh:
1. **Initiation Triggers**:
   * **Proactive Scheduled Check**: A background job inspects `IntegrationCredential.expiresAt` and initiates refresh 15 minutes prior to expiration.
   * **Reactive Execution Refresh**: If an API call receives an HTTP 401 and the token is near expiration, the adapter triggers an on-demand refresh.
   * **Inbound Provider Event**: Provider sends a webhook notification indicating token rotation.
2. **In-Flight Execution Mutex (Concurrency Lock)**:
   * Many third-party OAuth providers (e.g., QuickBooks Online) enforce **Single-Use Refresh Tokens**. If two parallel requests attempt to use the same refresh token simultaneously, the second attempt invalidates the entire token family.
   * To prevent token racing, token rotation acquires a short-lived distributed mutex:
     $$\text{Key: } \texttt{lock:integration:token\_refresh:\{connectionId\}}, \quad \text{TTL: } 5000\text{ms}$$
   * In-flight executions encountering an active rotation lock pause and wait (up to 2000ms) for the new token to be stored, then execute with the refreshed credential.

### 4.3 Credential Redaction Architecture

Under no circumstances may plaintext secrets, OAuth tokens, or authorization headers appear in:
* Application server logs (Pino / stdout)
* REST API responses
* `IntegrationExecution` request/response audit payloads
* Error stack traces or exception diagnostics

#### Redaction Rules:
* All headers matching `authorization`, `x-api-key`, `client_secret`, `refresh_token`, or `token` are replaced with `"[REDACTED]"`.
* Connection view APIs expose only a fixed safe fingerprint or suffix:
  ```json
  {
    "keyFingerprint": "sha256:e3b0c442...",
    "keySuffix": "...ab12",
    "lastRotatedAt": "2026-08-29T09:00:00.000Z",
    "expiresAt": "2026-09-29T09:00:00.000Z"
  }
  ```
* No variable partial reveals (e.g., exposing full keys minus 2 characters) are permitted.

### 4.4 Granular RBAC Permissions

Integration management is divided into four distinct RBAC permissions, preventing broad over-privileged access:

| Permission | Description | `OWNER` | `ADMIN` | `MANAGER` | `ACCOUNTANT` | `DISPATCHER` | `TECHNICIAN` |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| `integration.view_status` | View connection list, health status, capability catalog | **Allow** | **Allow** | **Allow** | **Allow** | Deny | Deny |
| `integration.view_history` | View execution audit ledger, webhook logs, latency | **Allow** | **Allow** | **Allow** | Deny | Deny | Deny |
| `integration.manage_connection` | Connect/disconnect, set capability defaults, edit configs | **Allow** | **Allow** | Deny | Deny | Deny | Deny |
| `integration.manage_credentials` | Enter API keys, initiate OAuth, force token rotation | **Allow** | **Allow** | Deny | Deny | Deny | Deny |

> [!NOTE]
> Field Technicians and Dispatchers have zero direct integration permissions. They trigger external actions purely through core domain services (e.g., completing a work order triggers an automated invoice sync).

---

## 5. Webhook Inbound Pipeline Architecture (Design Only)

Inbound webhooks from third-party systems follow a strict, 8-stage inbound processing pipeline:

```
[Inbound HTTP POST /api/integrations/webhooks/{endpointSlug}]
                             │
                             ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Stage 1: Cryptographic Signature Verification                          │
│ Verify HMAC-SHA256, RSA-SHA256, or Ed25519 using stored signing secret │
└────────────────────────────┬───────────────────────────────────────────┘
                             │ Valid Signature
                             ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Stage 2: Timestamp Validation Window                                   │
│ Enforce |t_current - t_webhook| <= 300 seconds                         │
└────────────────────────────┬───────────────────────────────────────────┘
                             │ Valid Timestamp
                             ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Stage 3: Replay Protection Cache Check                                 │
│ Check Nonce / Payload SHA-256 Digest in short-term distributed cache   │
└────────────────────────────┬───────────────────────────────────────────┘
                             │ Unique Nonce
                             ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Stage 4: Strict Tenant Resolution via Registered Endpoint Slug         │
│ Resolve IntegrationWebhook(endpointSlug) -> IntegrationConnection     │
│ Invariant: workspaceId is ALWAYS bound from DB, NEVER from payload     │
└────────────────────────────┬───────────────────────────────────────────┘
                             │ Resolved Connection & Workspace
                             ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Stage 5: Connection State & Entitlement Guard                          │
│ Inspect IntegrationConnection.status & assertEntitlement:              │
│ - If status == "CONNECTED" & Entitled  --> Proceed to Stage 6          │
│ - If status == "ERROR"                 --> Short-circuit: HTTP 503     │
│ - If status == "SUSPENDED_ENTITLEMENT" --> Short-circuit: HTTP 402/423 │
│ - If status == "CONNECTING"            --> Short-circuit: HTTP 409     │
│ - If status == "DISCONNECTED"          --> Short-circuit: HTTP 410/404 │
└────────────────────────────┬───────────────────────────────────────────┘
                             │ Connection Ready & Healthy
                             ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Stage 6: Idempotency Check & Transactional Inbox Persist               │
│ Upsert into IntegrationWebhookEvent(connectionId, providerEventId)     │
└────────────────────────────┬───────────────────────────────────────────┘
                             │ First-Time Processing
                             ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Stage 7: Event Normalization (Adapter)                                 │
│ Adapter maps raw payload -> canonical IntegrationEvent schema          │
└────────────────────────────┬───────────────────────────────────────────┘
                             │ Normalized Event
                             ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Stage 8: Domain Event Dispatch                                         │
│ Emit into Phase 1.13 NotificationOutbox or Phase 1.16 Automation Engine│
└────────────────────────────────────────────────────────────────────────┘
```

### 5.1 Pipeline Stage Specifications

1. **Stage 1: Cryptographic Signature Verification**:
   * Inspects incoming signature headers (e.g., `Stripe-Signature`, `X-Twilio-Signature`, `X-Hub-Signature-256`).
   * The raw HTTP request body is preserved as a binary buffer prior to JSON parsing.
   * Cryptographic verification is computed against the decrypted webhook signing secret (checking `ACTIVE` credential first, with fallback to `SUPERSEDED` credential if within grace window). Invalid signatures return HTTP 401 immediately and abort the pipeline.
2. **Stage 2: Timestamp Validation Window**:
   * Header timestamps are checked against current server time: $|t_{\text{now}} - t_{\text{webhook}}| \le 300\text{s}$.
   * Payloads outside the 5-minute tolerance are rejected with HTTP 400 to defeat delayed replay attacks.
3. **Stage 3: Replay Protection Nonce Check**:
   * If the provider supplies a unique delivery nonce or message ID, it is verified against a 10-minute sliding window cache. Duplicate nonces receive HTTP 200 (acknowledged) and are discarded.
4. **Stage 4: Strict Tenant Resolution**:
   * The public URL slug (`endpointSlug`) is matched against the `IntegrationWebhook` table.
   * The tenant identity (`workspaceId`) and target connection are retrieved directly from the linked `IntegrationConnection`.
   * **Strict Webhook Tenant Resolution Invariant**: *Tenant identity is NEVER extracted, inferred, or trusted from the incoming webhook payload body. Cross-tenant injection via spoofed payload fields is structurally impossible.*
5. **Stage 5: Connection State & Entitlement Guard**:
   * Evaluates the lifecycle state of the resolved `IntegrationConnection` and the workspace's entitlement tier:
     * **`CONNECTED`**: If active and `assertEntitlement(workspaceId, "FEATURE_INTEGRATIONS")` passes, proceeds to Stage 6.
     * **`ERROR`**: Short-circuits immediately with **HTTP 503 (Service Unavailable)** and attaches `Retry-After: 300` header. This notifies the external provider that the endpoint is temporarily degraded and prompts standard exponential webhook delivery retries while alerting tenant administrators.
     * **`SUSPENDED_ENTITLEMENT`**: Short-circuits immediately with **HTTP 402 (Payment Required)** or **HTTP 423 (Locked)**, signaling that the tenant's current plan does not support webhook ingestion.
     * **`CONNECTING`**: Short-circuits immediately with **HTTP 409 (Conflict)**, indicating that initial authentication handshake or verification is currently in-flight and not yet established.
     * **`DISCONNECTED`**: Short-circuits with **HTTP 410 (Gone)** or **HTTP 404 (Not Found)**.
6. **Stage 6: Idempotency Check & Transactional Inbox Persist**:
   * The event is written to a durable `IntegrationWebhookEvent` inbox table with a unique composite key `(connectionId, providerEventId)`.
   * If the event was already recorded as `PROCESSED`, the handler immediately returns HTTP 200 without re-executing downstream side effects.
7. **Stage 7: Event Normalization**:
   * The registered `IntegrationAdapter.handleWebhook()` translates vendor-specific JSON into Aforden's standard `IntegrationEvent` interface.
8. **Stage 8: Domain Event Dispatch**:
   * The normalized event is dispatched to Phase 1.13's `NotificationOutbox` or Phase 1.16's Automation Trigger Ingestion Engine inside a database transaction.

---

## 6. Outbound Execution Architecture (Design Only)

### 6.1 End-to-End Execution Flow

Outbound requests follow a strict, unidirectional pipeline:

```
[Domain Service: WorkOrder / Invoice / Notification / Automation]
                             │
                             │ 1. Invokes executeCapability(workspaceId, capability, action, payload)
                             ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Phase 1.17.1 Capability Resolver (§2.3, §2.4)                                                      │
│ - Validates Entitlement: assertEntitlement(workspaceId, "FEATURE_INTEGRATIONS")                    │
│ - Resolves target IntegrationConnection via deterministic routing rules                            │
└────────────────────────────┬───────────────────────────────────────────────────────────────────────┘
                             │ 2. Returns Active Connection
                             ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Integration Execution Manager                                                                      │
│ - Generates deterministic Idempotency Key (UUIDv5) [Owned by Integration Service]                  │
│ - Propagates Correlation ID (UUIDv4)                                                               │
│ - Initializes IntegrationExecution record (Status: PENDING)                                        │
│ - Retrieves & Decrypts Secret Reference (AES-256-GCM)                                              │
│ - Enforces Capability Timeout SLA Ceiling                                                          │
└────────────────────────────┬───────────────────────────────────────────────────────────────────────┘
                             │ 3. Dispatches IntegrationExecutionRequest
                             ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Provider Adapter Layer (Stateless Adapter)                                                         │
│ - Translates normalized request into provider-specific HTTP headers, URL, and body                 │
│ - Injects provider idempotency headers (e.g. Idempotency-Key, X-Request-Id)                        │
│ - Executes network call over HTTPS within deadline                                                 │
│ - Translates raw HTTP response / errors into IntegrationExecutionResult / IntegrationFailure       │
└────────────────────────────┬───────────────────────────────────────────────────────────────────────┘
                             │ 4. Returns Execution Result
                             ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Retry Orchestrator & Audit Ledger Finalizer                                                        │
│ - If Transient Failure & Retries Remain: Applies Exponential Backoff + Jitter & Re-executes        │
│ - If Non-Retryable Failure: Updates IntegrationExecution (Status: FAILED, failureJson)              │
│ - If Success: Updates IntegrationExecution (Status: COMPLETED, responseSnapshotJson)               │
│ - Returns normalized IntegrationExecutionResult to Calling Domain Service                          │
└────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Layer Responsibility Breakdown

| Architecture Responsibility | Owning Component | Architectural Rationale |
| :--- | :--- | :--- |
| **Idempotency Key Generation** | **Integration Execution Manager** | **Centralized Ownership Invariant**: Domain callers (e.g. Work Orders, Invoices) invoke operations with business intent. They must not be burdened with generating, formatting, or hashing provider-specific idempotency keys. |
| **Timeout & SLA Enforcement** | **Integration Execution Manager** | Timeout deadlines (e.g., 5s for emails, 15s for accounting syncs) are platform SLA policies enforced via `AbortController` at the orchestration layer, preventing hung worker threads. |
| **Retry & Exponential Backoff** | **Integration Execution Manager** | Retry orchestration (with full jitter) belongs in the execution manager so adapters remain simple, single-attempt network translators. |
| **Payload Formatting & Network Call** | **Provider Adapter** | Encapsulates vendor-specific URL paths, query strings, headers, and serialization quirks. |
| **Response & Error Normalization** | **Provider Adapter** | Translates vendor HTTP status codes, error payloads, and response bodies into standard `IntegrationExecutionResult` and `IntegrationFailure`. |
| **Audit Ledger Persistence** | **Integration Execution Manager** | Writes append-only `IntegrationExecution` records with automatic credential redaction. |

### 6.3 Standardized Failure Taxonomy & Retry Rules

```typescript
export interface IntegrationFailure {
  readonly code: IntegrationFailureCode;
  readonly message: string;
  readonly isRetryable: boolean;
  readonly retryAfterSeconds?: number;
  readonly providerRawCode?: string;
  readonly providerRawMessage?: string;
  readonly httpStatusCode?: number;
  readonly diagnostics?: Record<string, unknown>;
}

export enum IntegrationFailureCode {
  AUTHENTICATION_FAILED = "AUTHENTICATION_FAILED",
  TOKEN_EXPIRED = "TOKEN_EXPIRED",
  RATE_LIMITED = "RATE_LIMITED",
  NETWORK_TIMEOUT = "NETWORK_TIMEOUT",
  SERVICE_UNAVAILABLE = "SERVICE_UNAVAILABLE",
  BAD_REQUEST = "BAD_REQUEST",
  PAYLOAD_VALIDATION_FAILED = "PAYLOAD_VALIDATION_FAILED",
  RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND",
  CAPABILITY_UNSUPPORTED = "CAPABILITY_UNSUPPORTED",
  ENTITLEMENT_BLOCKED = "ENTITLEMENT_BLOCKED",
  INTERNAL_ADAPTER_ERROR = "INTERNAL_ADAPTER_ERROR",
}
```

#### Retry Classification:
* **Retryable Errors** (`isRetryable: true`):
  * `RATE_LIMITED` (honors `retryAfterSeconds` or applies exponential backoff)
  * `NETWORK_TIMEOUT`
  * `SERVICE_UNAVAILABLE` (HTTP 502, 503, 504)
  * *Max Attempts: 3. Backoff: $t = \min(30\text{s}, 2^{\text{attempt}} \times 500\text{ms} + \text{jitter})$.*
* **Non-Retryable Errors** (`isRetryable: false`):
  * `AUTHENTICATION_FAILED` (401/403)
  * `BAD_REQUEST` (400)
  * `PAYLOAD_VALIDATION_FAILED`
  * `RESOURCE_NOT_FOUND` (404)
  * `CAPABILITY_UNSUPPORTED`
  * `ENTITLEMENT_BLOCKED`
  * *Fails immediately, marks execution as `FAILED`, records diagnostics, and alerts domain caller.*

---

## 7. Explicit Non-Goals for Sub-Phase 1.17.1

To maintain strict architectural boundaries, the following deliverables are explicitly excluded from Sub-Phase 1.17.1 and deferred to subsequent sub-phases:

1. **No Prisma Schema Alterations or Database Migrations**: Prisma schema models (`Integration`, `IntegrationConnection`, `IntegrationCredential`, `IntegrationWebhook`, `IntegrationExecution`, `WorkspaceActiveExclusiveCapability`) and migration scripts will be authored in **Phase 1.17.2**.
2. **No Concrete Adapter Code or Vendor SDK Implementations**: Adapter implementations (e.g., `ResendAdapter`, `TwilioAdapter`, `QuickBooksAdapter`, `GoogleCalendarAdapter`) will be built in **Phase 1.17.4 onward**.
3. **No REST API Endpoints or Webhook Route Handlers**: Next.js route handlers (`app/api/integrations/...`) will be implemented in **Phase 1.17.8 and Phase 1.17.9**.
4. **No Frontend UI Components or Integration Marketplace**: Visual connection management interfaces, OAuth popups, and settings forms are scheduled for **Phase 1.23**.

---

## 8. Deliverable Checklist

The following checklist maps directly to the Phase 1.17 Definition of Done "Architecture" criteria, confirming complete specification coverage:

- [x] **Integration Architecture Locked**: Complete multi-tenant entity models, lifecycle relationships, and workspace scoping defined. *(Satisfied by §1, Executive Summary)*
- [x] **Provider Abstraction Contract Locked**: Standard `IntegrationAdapter` interface, `execute()`, `handleWebhook()`, `connect()`, `disconnect()`, and `testConnection()` signatures specified in TypeScript. *(Satisfied by §2.1)*
- [x] **Capability Model & Closed Registry Locked**: `IntegrationCapability` enum, metadata catalog, `allowsMultipleActiveProviders` semantics, and deterministic routing hierarchy defined. *(Satisfied by §1.4, §2.2, §2.3)*
- [x] **Exclusive Capability Singleton Guard Locked**: Dual-layer enforcement architecture (transactional pre-check + `WorkspaceActiveExclusiveCapability` table unique constraint `@@unique([workspaceId, capability])`) specified. *(Satisfied by §2.4)*
- [x] **Connection Lifecycle State Machine Locked**: Data-driven transition matrix (`INTEGRATION_TRANSITIONS`), error recoverability, and Entitlement Resolver (1.15) interaction locked. *(Satisfied by §3.1 – §3.4)*
- [x] **Credential Lifecycle State Machine Locked**: Data-driven transition matrix (`CREDENTIAL_TRANSITIONS`), atomic promotion/demotion, single active credential invariant, and grace period rules locked. *(Satisfied by §1.3, §3.5)*
- [x] **Security & Envelope Encryption Architecture Locked**: AES-256-GCM envelope encryption, secret reference shapes, concurrency locks for token rotation, credential redaction, and granular RBAC permissions locked. *(Satisfied by §4)*
- [x] **Webhook Ingestion Pipeline Locked**: 8-stage inbound verification sequence, consistent Connection State & Entitlement Guard stage (§5.1 Stage 5, short-circuiting on ERROR $\to$ 503, SUSPENDED $\to$ 402/423, CONNECTING $\to$ 409, DISCONNECTED $\to$ 410/404), and the **Strict Webhook Tenant Resolution Invariant** locked. *(Satisfied by §5)*
- [x] **Outbound Execution & Idempotency Ownership Locked**: End-to-end flow, centralized idempotency key ownership, SLA timeouts, and retry orchestration locked. *(Satisfied by §6)*
- [x] **Normalized Failure Taxonomy Locked**: `IntegrationFailure` error codes, retry classifications, and diagnostic structures locked. *(Satisfied by §1.7, §6.3)*
- [x] **Explicit Non-Goals Stated**: Clear boundary boundaries established for Phase 1.17.2+. *(Satisfied by §7)*
