# Phase 1.13.1 — Notifications & Communications Domain Architecture Walkthrough

> **Milestone Status**: COMPLETE & LOCKED  
> **Target Specification**: [`phase-1.13.1-notifications-communications-domain-architecture.md`](file:///d:/Download/aforden/docs/architecture/phase-1.13.1-notifications-communications-domain-architecture.md)  
> **Sub-Phase Deliverable**: Phase 1.13 Architecture Contract & Self-Audit Walkthrough  

---

## 1. Milestone Overview

Phase 1.13.1 formally establishes the architecture for the **Notifications & Communications** domain of the Aforden Field Service Management (FSM) platform.

This phase is a locked specification exercise that establishes all domain boundaries, schema models, transactional outbox contracts, state machines, channel abstractions, idempotency guarantees, security guards, error taxonomies, and the 10-stage execution roadmap (1.13.1 through 1.13.10) before any code or database migrations are implemented in Phase 1.13.2 onward.

---

## 2. Walkthrough of the 16 Architectural Decisions

### Pillar 1: Domain Boundaries & Ownership Matrix
- **Decision**: Implemented the **Transactional Outbox Pattern** (`NotificationOutbox`) with the `emitNotificationEvent(tx, eventPayload)` contract.
- **Boundary**: Operational domains (WorkOrder, Scheduling, Quote, Invoice, etc.) declare only *that a business event occurred*. They never interact with transport channels, construct HTML/SMS messages, or call external delivery providers.
- **Ingestion Deduplication**: Ingestion is guarded against double-submits, client retries, and webhook redelivery races via `NotificationOutbox.dedupeKey` with `@@unique([workspaceId, dedupeKey])`.
- **Scope Exclusion**: Advanced multi-step automations, conditional workflow branching, delayed drip marketing, and visual automation builders are explicitly excluded and deferred to Phase 1.16 ("Automation & Workflows").

### Pillar 2: Notification Types & Extensible Event Catalog
- **Decision**: Defined the initial 24 supported event types spanning Work Orders (10 events), Scheduling & Dispatch (4 events), Quotes (5 events), and Invoices & Payments (5 events).
- **Registry Pattern**: Designed `EventCatalogRegistry` mapping each event type to its domain origin, default channels, recipient types, mandatory status, variable whitelists, and Zod payload validation schemas. This eliminates hardcoded switch statements across delivery engines.

### Pillar 3: Notification & Delivery Lifecycles (Three Independent State Machines)
- **Decision**: Separated lifecycle concerns into three explicit, non-inferred state machines:
  1. **Outbox Ingestion Lifecycle (`NotificationOutboxStatus`)**: `PENDING` $\rightarrow$ `PROCESSING` $\rightarrow$ `PROCESSED` / `FAILED`. (Tracks whether the outbox row has been claimed and expanded into a Notification).
  2. **Semantic Notification Lifecycle (`NotificationStatus`)**: `PENDING` $\rightarrow$ `PROCESSING` $\rightarrow$ `SENT` / `PARTIALLY_SENT` / `FAILED` / `SUPPRESSED` / `CANCELLED`. (Tracks the high-level business delivery outcome).
  3. **Per-Recipient Channel Delivery Lifecycle (`NotificationDeliveryStatus`)**: `PENDING` $\rightarrow$ `PROCESSING` $\rightarrow$ `DELIVERED` / `FAILED` $\rightarrow$ `PENDING_RETRY` $\rightarrow$ `EXHAUSTED` / `SKIPPED` / `SUPPRESSED`. (Tracks the granular transport attempt).
- **Invariants**: Terminal states are strictly immutable. Parent notification status is dynamically aggregated from child delivery statuses.

### Pillar 4: Recipient Model & Tenant-Scoped Resolution
- **Decision**: Supported `WORKSPACE_MEMBER`, `CUSTOMER_CONTACT`, and validated `DIRECT_RECIPIENT`.
- **Tenant Isolation**: Recipient resolution queries are strictly bounded by `workspaceId` (e.g. `prisma.workspaceMember.findFirst({ where: { id: recipientId, workspaceId } })`). If an operational event contains an entity not belonging to the workspace, resolution aborts immediately with `NotificationCrossTenantLeakageError`.

### Pillar 5: Channel Model & Selection Engine
- **Decision**: Initial channels locked as `IN_APP` and `EMAIL`, with `SMS` and `PUSH` interfaces locked for future integration.
- **Selection Formula**: $\text{ActiveChannels} = (\text{EventDefaults} \cap \text{WorkspaceEnabled} \cap \text{RecipientAvailable}) \setminus \text{SuppressedPreferences}$.

### Pillar 6: Delivery Model (1:N Fan-Out)
- **Decision**: 1 `Notification` semantic record fans out to $N$ `NotificationDelivery` rows (one per recipient $\times$ channel combination).
- **Integrity**: `NotificationDelivery` enforces `onDelete: Cascade` with its parent `Notification` and `Workspace`.

### Pillar 7: Template Architecture & Safe Token Interpolation
- **Decision**: Templates are identified by `(workspaceId, eventType, channel, locale)` with system default fallback in code.
- **Security Mandate**: Safe token replacement (`{{variableName}}`) against an explicit whitelist with zero runtime code execution (`eval()`, Handlebars scripts). All interpolated variables are automatically HTML-escaped to prevent stored XSS.

### Pillar 8: Hierarchical Preferences Architecture
- **Decision**: Layered hierarchy:
  $$\text{Effective Preference} = \text{System Mandatory Guard} \rightarrow \text{Workspace Policy} \rightarrow \text{Member/Customer Preference} \rightarrow \text{System Default}$$
- **Safeguards**: Mandatory transactional events (`isMandatoryTransactional = true`, such as `INVOICE_SENT` or `PASSWORD_RESET`) cannot be opted out of. Preferences act strictly as a suppression filter and cannot route communications across tenant or authorization boundaries.

### Pillar 9: Event-Trigger Architecture & Transactional Isolation
- **Decision**: `emitNotificationEvent(tx, ...)` writes outbox rows within the caller's active Prisma transaction (`tx`).
- **Upsert-or-Ignore Ingestion**: If an event with an existing `(workspaceId, dedupeKey)` is emitted, `emitNotificationEvent()` logs and returns the existing outbox row without throwing and without creating a duplicate record.
- **Isolation Guarantee**: If the operational transaction rolls back, the notification event rolls back. Once committed, delivery processing occurs asynchronously via background workers. Third-party provider outages, timeouts, or invalid emails can NEVER roll back or fail operational business transactions.

### Pillar 10: Retry Philosophy & Exponential Backoff
- **Decision**: Clear bifurcation of errors into Transient (retryable) vs. Permanent/Fatal (`EXHAUSTED`).
- **Backoff Algorithm**: Bounded exponential backoff with full jitter:
  $$\Delta t = \min\left(3600\text{s},\; 10\text{s} \times 2^{(\text{attempt} - 1)}\right) + \text{uniform}(0, 5\text{s})$$
- Maximum attempts capped at $N_{\max} = 5$.

### Pillar 11: Idempotency Architecture (Two-Tiered Protection)
- **Decision**: Implemented end-to-end two-tiered idempotency:
  1. **Tier 1 (Event Ingestion)**: `NotificationOutbox.dedupeKey = SHA256(workspaceId + ":" + sourceEntity + ":" + sourceId + ":" + eventType)` (with optional caller override for legitimate sequence recurrences), enforced via `@@unique([workspaceId, dedupeKey])`.
  2. **Tier 2 (Delivery Dispatch)**: `NotificationDelivery.idempotencyKey = SHA256(workspaceId + ":" + notificationId + ":" + channel + ":" + recipientType + ":" + recipientId)`, enforced via `@@unique([workspaceId, idempotencyKey])`.
- **Worker Claiming**: Concurrency race conditions across worker nodes are eliminated using PostgreSQL `FOR UPDATE SKIP LOCKED`.

### Pillar 12: Audit & Communication History Requirements
- **Decision**: Complete architectural separation between Operational History (e.g. `WorkOrderHistory` documenting business entity changes) and Communication History (`NotificationLog` documenting transport metadata, provider message IDs, timestamps, and delivery statuses).

### Pillar 13: Tenant Isolation & Structural Protection
- **Decision**: Every table in the domain has a non-nullable `workspaceId String` foreign key with `onDelete: Cascade` and composite indexing. Zero cross-tenant entity linkages.

### Pillar 14: Authorization Boundaries & RBAC
- **Decision**: Strict RBAC permissions aligned with the platform taxonomy:
  - `OWNER` / `ADMIN`: Full access to notification logs, workspace templates, and channel settings.
  - `MANAGER`: View operational notification logs and manage personal preferences.
  - `DISPATCHER`: View dispatch/operational delivery status and manage personal preferences.
  - `TECHNICIAN`: Read personal in-app notifications and personal preferences; zero access to financial/billing notices.
  - `ACCOUNTANT`: Access billing/payment notifications and personal preferences.
- **Actor Integrity**: `actorMemberId` is derived exclusively server-side from the authenticated session.

### Pillar 15: Failure Handling & Pure Domain Error Taxonomy
- **Decision**: 15 pure domain error classes following Convention B (`readonly code`, `readonly statusCode`, `readonly httpStatus`):
  - `NotificationNotFoundError` (404)
  - `NotificationDeliveryNotFoundError` (404)
  - `NotificationTemplateNotFoundError` (404)
  - `NotificationPreferenceNotFoundError` (404)
  - `InvalidNotificationEventType` (400)
  - `InvalidNotificationChannelError` (400)
  - `DuplicateNotificationEventError` (409)
  - `NotificationCrossTenantLeakageError` (403)
  - `NotificationActorUnauthorizedError` (403)
  - `NotificationPayloadValidationError` (422)
  - `NotificationTemplateCompilationError` (422)
  - `NotificationRecipientUnresolvableError` (422)
  - `NotificationChannelDisabledError` (422)
  - `NotificationDeliveryExhaustedError` (500)
  - `NotificationProviderUnavailableError` (503)

### Pillar 16: Future Provider Abstraction Layer
- **Decision**: Defined vendor-agnostic TypeScript interfaces: `EmailProvider`, `SMSProvider`, `PushProvider`, and `InAppProvider`, managed via `NotificationProviderFactory`. No external SDK types leak into core application logic.

---

## 3. Explicit Disclosures

### 3.1 Extensions to Specification & Audit Refinements
1. **Dedicated `NotificationOutboxStatus` Enum**: Separated outbox processing lifecycle (`PENDING / PROCESSING / PROCESSED / FAILED`) from the semantic business notification status (`NotificationStatus`).
2. **Event-Ingestion Idempotency Key (`dedupeKey`)**: Added database-enforced deduplication on `NotificationOutbox` (`@@unique([workspaceId, dedupeKey])`) to prevent duplicate notification entity creation from client-side retries or double-submits.
3. **`InAppNotificationFeed` Model**: Included the dedicated `InAppNotificationFeed` Prisma model sketch in addition to `NotificationDelivery`. This allows high-performance member inbox queries (unread badges, mark read, archive) without scanning raw delivery logs.
4. **Deterministic Idempotency Key Formulation**: Formulated explicit SHA-256 composite string hashing algorithms for both ingestion (`dedupeKey`) and delivery (`idempotencyKey`).

### 3.2 Assumptions Resolved
1. **Outbox Polling vs Message Broker**: In the initial SaaS foundation, the outbox worker operates via database row locking (`FOR UPDATE SKIP LOCKED`) and scheduled interval polling. When Redis/BullMQ or dedicated message brokers are introduced in Phase 1.17 (Integrations), the outbox pattern smoothly adapts without altering the operational domain contract (`emitNotificationEvent`).
2. **System Actor Representation**: For background automated events (such as `INVOICE_OVERDUE` cron evaluations or appointment reminders), `actorMemberId` is stored as `null` with system provenance recorded in metadata.

---

## 4. Phase 1.13 Execution Roadmap

The implementation plan is locked into 10 sequential milestones:

```
[Phase 1.13.1] Architecture & Specification (LOCKED)
      |
[Phase 1.13.2] Prisma Schema & Database Migration
      |
[Phase 1.13.3] Domain Types, Errors & Validation Schemas
      |
[Phase 1.13.4] Recipient Resolution Engine & Notification Preferences
      |
[Phase 1.13.5] Template Engine & Safe Variable Interpolation
      |
[Phase 1.13.6] Event Ingestion & Transactional Outbox Pipeline
      |
[Phase 1.13.7] Provider Abstraction & Delivery Adapters (Email / In-App)
      |
[Phase 1.13.8] In-App Notification Center & Member Feed API
      |
[Phase 1.13.9] Operational Domain Event Integrations (WorkOrder, Schedule, Quote, Invoice)
      |
[Phase 1.13.10] Retry/Backoff Engine, Audit History, REST API Routes & Final Hardening
```

---

## 5. Verification & Compliance Sign-Off

- [x] **Zero Direct Provider Calls in Operational Services**: Guaranteed by contract.
- [x] **Transactional Outbox Guarantee**: ACID transactional consistency with zero blast radius.
- [x] **Strict Multi-Tenant Isolation**: Structural workspace enforcement at all database and service layers.
- [x] **Safe Template Engine**: Whitelisted token interpolation with zero runtime code execution.
- [x] **Pure Error Taxonomy (Convention B)**: 15 standardized error classes.
- [x] **No Unintended Source Code or Migrations**: Locked as a pure specification milestone.
