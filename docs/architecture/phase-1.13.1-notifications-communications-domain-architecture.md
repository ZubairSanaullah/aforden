# Phase 1.13.1 — Notifications & Communications Domain Architecture & Specification

> **Document Status**: LOCKED FOR IMPLEMENTATION (Phase 1.13 Architecture Standard)  
> **Domain**: Notifications, Transports & Communications, In-App Feeds, Multi-Channel Delivery, Transactional Outbox, Template Compilation, Delivery Logs & Communication Audit  
> **Dependencies**: Phase 1.1 (Multi-Tenancy & Workspace Partitioning), Phase 1.2 (Authentication & RBAC), Phase 1.3 (Technicians & Organization), Phase 1.4 (Customers & Service Locations), Phase 1.5 (Service Catalog & Work Types), Phase 1.6 (Work Orders), Phase 1.7 (Assets & Equipment), Phase 1.8 (Scheduling & Dispatch), Phase 1.9 (Technician Operations), Phase 1.10 (Inventory & Parts), Phase 1.11 (Quotes & Estimates), Phase 1.12 (Invoicing & Payments)  
> **Target Schema & Service Implementation**: Phase 1.13.2 – Phase 1.13.10  

---

## Executive Summary

Phase 1.13 introduces the **Notifications & Communications** domain to the Aforden Field Service Management (FSM) platform. Across Phases 1.1 through 1.12, Aforden established core organizational tenancy, role-based access control, field asset management, cataloged services, mobile technician field execution, inventory movements, commercial proposals (Quotes), and accounts receivable billing (Invoices & Payments).

Phase 1.13 establishes the **decoupled, multi-channel communication layer**. It allows existing operational domains to signal business state changes without coupling those operational domains to communication channels, delivery vendors, message formatting, or recipient transport endpoints.

This document serves as the binding architectural contract for Phase 1.13. It establishes:
1. **The Core Decoupling Invariant**: Operational domains (WorkOrder, Scheduling, Quote, Invoice, etc.) declare *what event occurred*, while the Notification domain determines *who receives it, via which channels, through what templates, and with what retry/delivery mechanics*.
2. **The Transactional Outbox Pattern**: Guaranteed event capture within operational ACID database transactions with zero risk of transaction rollback caused by downstream provider or delivery failures.
3. **The 1:N Fan-Out Delivery Architecture**: Complete separation between the semantic business record (`Notification`) and granular per-recipient, per-channel transport attempts (`NotificationDelivery`).
4. **Tenant-Scoped Recipient Resolution & Isolation**: Strict database-level workspace boundaries preventing any cross-tenant data leakage or notification misdirection.
5. **Safe Token Interpolation & Template Architecture**: Deterministic, code-injection-proof template compilation with whitelisted variable schemas derived strictly from server-side domain records.
6. **Hierarchical Preferences & Opt-Out Model**: A layered precedence hierarchy (Workspace $\rightarrow$ System Safeguards $\rightarrow$ Member/Customer Preferences) governing delivery channels without compromising security or mandatory transactional notices.
7. **Idempotency & Concurrent Retry Engine**: Cryptographically deterministic idempotency keys and exponential backoff with full jitter to eliminate duplicate messages across network retries.
8. **Independent Communication Audit Ledger**: Complete separation between operational history (e.g., `WorkOrderHistory`, `InvoiceHistory`) and transport history (`NotificationLog` / `NotificationDelivery`).
9. **Extensible Event Catalog & Provider Abstraction**: Strongly typed registries for operational events and vendor-agnostic channel interfaces (`EmailProvider`, `SMSProvider`, `PushProvider`, `InAppProvider`).
10. **Phase 1.13 Implementation Roadmap**: The locked 10-stage breakdown (1.13.1 through 1.13.10).

---

```
+-----------------------------------------------------------------------------------------------------------------------+
|                                                  WORKSPACE (Tenant)                                                   |
|                                                                                                                       |
|   +-----------------------+     +------------------------+     +------------------------+     +-------------------+   |
|   |   WORK ORDER (1.6)    |     |    SCHEDULING (1.8)    |     |      QUOTE (1.11)      |     |   INVOICE (1.12)  |   |
|   | - Created / Assigned  |     | - Scheduled            |     | - Sent / Approved      |     | - Issued / Due    |   |
|   | - Completed           |     | - Dispatched           |     | - Accepted / Rejected  |     | - Payment Settled |   |
|   +-----------+-----------+     +-----------+------------+     +-----------+------------+     +---------+---------+   |
|               |                             |                              |                            |             |
|               +-----------------------------+--------------+---------------+----------------------------+             |
|                                                            |                                                          |
|                                                            | emitNotificationEvent(tx, event)                         |
|                                                            v (Same DB Transaction)                                    |
|   =================================================================================================================   |
|   |                                       NOTIFICATION DOMAIN (Phase 1.13)                                        |   |
|   |                                                                                                               |   |
|   +-------------------------------------------------------------------------------------------------------+   |   |
|   |                                         NotificationOutbox                                            |   |   |
|   |  - id, workspaceId, eventType, sourceEntity, sourceId, dedupeKey, actorMemberId, payload             |   |   |
|   |  - status: PENDING | PROCESSING | PROCESSED | FAILED (NotificationOutboxStatus)                       |   |   |
|   +---------------------------------------------------+---------------------------------------------------+   |   |
|   |                                                       |                                                       |   |
|   |                                                       | Asynchronous Dispatcher / Worker Poll                 |   |
|   |                                                       v                                                       |   |
|   |   +-------------------------------------------------------------------------------------------------------+   |   |
|   |   |                                            Notification                                               |   |   |
|   |   |  - id, workspaceId, eventType, sourceEntity, sourceId, actorMemberId, status: PENDING | SENT | FAILED  |   |   |
|   |   +---------------------------------------------------+---------------------------------------------------+   |   |
|   |                                                       |                                                       |   |
|   |                         +-----------------------------+-----------------------------+                         |   |
|   |                         | 1:N Fan-Out (Recipient Resolution x Channel Evaluation)   |                         |   |
|   |                         v                                                           v                         |   |
|   |   +-------------------------------------------+               +-------------------------------------------+   |   |
|   |   |           NotificationDelivery            |               |           NotificationDelivery            |   |   |
|   |   |  - channel: IN_APP                        |               |  - channel: EMAIL                         |   |   |
|   |   |  - recipientId: member_tech_01            |               |  - recipientId: cust_contact_42           |   |   |
|   |   |  - destination: "mem_tech_01"             |               |  - destination: "client@example.com"      |   |   |
|   |   |  - status: DELIVERED                      |               |  - status: DELIVERED                      |   |   |
|   |   +---------------------+---------------------+               +---------------------+---------------------+   |   |
|   |                         |                                                           |                         |   |
|   |                         v                                                           v                         |   |
|   |   +-------------------------------------------+               +-------------------------------------------+   |   |
|   |   |           InAppNotificationFeed           |               |               EmailProvider               |   |   |
|   |   |  (User Bell / Realtime In-App Center)     |               |         (Resend / SMTP Adapter)           |   |   |
|   |   +-------------------------------------------+               +-------------------------------------------+   |   |
|   |                                                       |                                                       |   |
|   |                                                       | Durable Audit Log                                     |   |
|   |                                                       v                                                       |   |
|   |   +-------------------------------------------------------------------------------------------------------+   |   |
|   |   |                                          NotificationLog                                              |   |   |
|   |   |  - id, workspaceId, notificationId, deliveryId, channel, recipient, status, providerMessageId, error  |   |   |
|   |   +-------------------------------------------------------------------------------------------------------+   |   |
|   =================================================================================================================   |
+-----------------------------------------------------------------------------------------------------------------------+
```

---

## 1. Domain Boundaries & Responsibilities

### 1.1 Strict Domain Ownership Rules

| Domain | Owns | Does NOT Own / Consumes |
| :--- | :--- | :--- |
| **Notifications & Communications** (Phase 1.13) | `NotificationOutbox`, `Notification`, `NotificationDelivery`, `NotificationTemplate`, `NotificationPreference`, `NotificationLog`, `InAppNotificationFeed`, recipient resolution pipeline, channel selection engine, safe template variable interpolation, delivery retry/backoff engine, channel provider abstraction adapters (`InAppProvider`, `EmailProvider`, `SMSProvider`, `PushProvider`), and communication audit history. | Does **NOT** own operational entity state machines (WorkOrders, Quotes, Invoices, Schedules), does **NOT** own customer master records (Phase 1.4), does **NOT** own technician master records (Phase 1.3), does **NOT** own complex multi-step automated branching/rule workflows (reserved for Phase 1.16). |
| **Work Orders** (Phase 1.6 & 1.9) | `WorkOrder` entity, priority, assignment, field operational statuses (`OPEN` $\rightarrow$ `COMPLETED`). | Emits `WORK_ORDER_*` notification events via `emitNotificationEvent(tx, ...)`. Never sends emails, SMS, or formats notification templates directly. |
| **Scheduling & Dispatch** (Phase 1.8) | `ScheduleAppointment`, calendar reservations, technician conflict calculations, dispatch lifecycle (`PENDING` $\rightarrow$ `DISPATCHED`). | Emits `SCHEDULE_*` notification events via `emitNotificationEvent(tx, ...)`. Never contacts technicians or customers directly. |
| **Quotes & Estimates** (Phase 1.11) | `Quote` proposal, pricing line items, quote conversion to WorkOrders, approval status. | Emits `QUOTE_*` notification events via `emitNotificationEvent(tx, ...)`. Consumes no external transport libraries. |
| **Invoicing & Payments** (Phase 1.12) | `Invoice` billing records, line item financial snapshots, recorded `Payment` entries, balance reconciliation. | Emits `INVOICE_*` and `PAYMENT_*` notification events via `emitNotificationEvent(tx, ...)`. Completely decoupled from email transports. |

### 1.2 The Non-Negotiable Decoupling Principle

Under no circumstance may an operational service contain transport-specific logic:
- ❌ **Forbidden**: `workOrderService.ts` importing `resend` or calling `sendEmail({ to: tech.email, subject: "Job Assigned" })`.
- ❌ **Forbidden**: `invoiceService.ts` assembling an HTML email body or querying customer email addresses directly to send a PDF.
- ❌ **Forbidden**: UI components initiating external SMS/email provider requests directly from the client browser.
- ✅ **Mandatory Architecture**: Operational services call `emitNotificationEvent(tx, eventPayload)`. The operational service supplies only the semantic event type, source entity identifiers, and contextual metadata. The Notification domain autonomously handles recipient resolution, channel filtering, preference evaluation, template rendering, and multi-channel dispatch.

### 1.3 Trigger Contract: Transactional Outbox Pattern & Ingestion-Level Idempotency

#### Decision
Operational domains request notifications via a standardized internal helper:
```typescript
export interface EmitNotificationEventInput<TPayload = Record<string, unknown>> {
  workspaceId: string;
  eventType: NotificationEventType;
  sourceEntity: string; // e.g. "WorkOrder", "Invoice", "Quote", "ScheduleAppointment"
  sourceId: string;     // e.g. workOrder.id, invoice.id
  actorMemberId?: string | null;
  payload: TPayload;
  dedupeKey?: string;   // Optional caller override for legitimately recurring events
}

export async function emitNotificationEvent(
  tx: Prisma.TransactionClient,
  event: EmitNotificationEventInput
): Promise<NotificationOutbox>;
```

#### Ingestion-Level Idempotency & Deduplication Mechanics
To prevent duplicate `Notification` creation from repeated calls to `emitNotificationEvent()` (such as client-side request retries, at-least-once webhook redelivery, or double-submit UI races), the event ingestion layer enforces deterministic deduplication at the database level:

1. **Deterministic `dedupeKey` Derivation**:
   - By default, the server computes:
     $$\text{dedupeKey} = \text{SHA256}(\text{workspaceId} + ":" + \text{sourceEntity} + ":" + \text{sourceId} + ":" + \text{eventType})$$
   - For events that can legitimately recur for the same source entity and event type (such as `SCHEDULE_APPOINTMENT_APPROACHING` reminder sequences), the caller supplies an explicit `dedupeKey` override containing a sequence differentiator (e.g. `sha256(workspaceId + ":ScheduleAppointment:" + appointmentId + ":SCHEDULE_APPOINTMENT_APPROACHING:reminder_24h")`).
2. **Database-Level Unique Constraint**:
   - `NotificationOutbox` enforces `@@unique([workspaceId, dedupeKey])`.
3. **Upsert-or-Ignore Ingestion Semantics**:
   - When `emitNotificationEvent(tx, event)` is called, it attempts insertion using an `INSERT ... ON CONFLICT (workspace_id, dedupe_key) DO NOTHING RETURNING *` or an equivalent find-or-create pattern inside the active transaction `tx`.
   - If a record with the matching `(workspaceId, dedupeKey)` already exists, `emitNotificationEvent()` logs a diagnostic duplicate-ingestion notice and safely returns the existing `NotificationOutbox` row. It **never throws an error** and **never creates a duplicate outbox row**.

#### Rationale & Operational Guarantees
1. **Zero Phantom Notifications on Transaction Failure**: By passing the active Prisma transaction client (`tx`), the outbox record is inserted in the exact same atomic transaction as the business entity mutation. If the WorkOrder update fails or rolls back, the notification event is rolled back automatically.
2. **Zero Blast-Radius on Notification Transport Failure**: The actual network call to third-party delivery providers (e.g. Resend, Twilio) occurs asynchronously in a dedicated worker process processing `NotificationOutbox` rows. A downstream provider outage or rate-limit error can NEVER fail or roll back an operational WorkOrder completion or Invoice payment.
3. **At-Least-Once Delivery Guarantee**: Unprocessed outbox rows remain in `PENDING` state until acknowledged by the delivery worker, ensuring zero dropped communications during server restarts or transient failures.
4. **End-to-End Idempotency**: Ingestion-level deduplication (`dedupeKey`) prevents duplicate `Notification` generation, while downstream delivery-level deduplication (`idempotencyKey`) prevents duplicate provider transmissions during retry attempts.

### 1.4 Explicit Scope Exclusion: Phase 1.16 Automations vs. Phase 1.13 Notifications

To maintain architectural integrity, the following boundaries are strictly enforced:
- **Phase 1.13 Scope**: Deterministic, 1:1 or 1:N transactional event notifications triggered directly by system state changes (e.g., "WorkOrder assigned $\rightarrow$ notify technician via In-App and Email").
- **Phase 1.16 Scope (Excluded from 1.13)**: User-defined automation rule builders, visual drag-and-drop workflow canvases, arbitrary conditional branching (e.g., "If invoice is overdue by 3 days AND customer tag is VIP, then do X, else do Y"), multi-day delayed drip marketing campaigns, and webhook trigger builders.

---

## 2. Notification Types & Extensible Event Catalog

### 2.1 Initial Supported Event Catalog

The initial event catalog is strictly scoped to the operational capabilities established in Phases 1.6 through 1.12:

```typescript
export enum NotificationEventType {
  // --- Work Order Domain (Phases 1.6 & 1.9) ---
  WORK_ORDER_CREATED = "WORK_ORDER_CREATED",
  WORK_ORDER_ASSIGNED = "WORK_ORDER_ASSIGNED",
  WORK_ORDER_REASSIGNED = "WORK_ORDER_REASSIGNED",
  WORK_ORDER_UNASSIGNED = "WORK_ORDER_UNASSIGNED",
  WORK_ORDER_STATUS_CHANGED = "WORK_ORDER_STATUS_CHANGED",
  WORK_ORDER_STARTED = "WORK_ORDER_STARTED",
  WORK_ORDER_PAUSED = "WORK_ORDER_PAUSED",
  WORK_ORDER_RESUMED = "WORK_ORDER_RESUMED",
  WORK_ORDER_COMPLETED = "WORK_ORDER_COMPLETED",
  WORK_ORDER_CANCELLED = "WORK_ORDER_CANCELLED",

  // --- Scheduling & Dispatch Domain (Phase 1.8) ---
  SCHEDULE_APPOINTMENT_SCHEDULED = "SCHEDULE_APPOINTMENT_SCHEDULED",
  SCHEDULE_APPOINTMENT_RESCHEDULED = "SCHEDULE_APPOINTMENT_RESCHEDULED",
  SCHEDULE_DISPATCH_CHANGED = "SCHEDULE_DISPATCH_CHANGED",
  SCHEDULE_APPOINTMENT_APPROACHING = "SCHEDULE_APPOINTMENT_APPROACHING",

  // --- Quotes & Estimates Domain (Phase 1.11) ---
  QUOTE_CREATED = "QUOTE_CREATED",
  QUOTE_SENT = "QUOTE_SENT",
  QUOTE_ACCEPTED = "QUOTE_ACCEPTED",
  QUOTE_REJECTED = "QUOTE_REJECTED",
  QUOTE_EXPIRED = "QUOTE_EXPIRED",

  // --- Invoicing & Payments Domain (Phase 1.12) ---
  INVOICE_CREATED = "INVOICE_CREATED",
  INVOICE_SENT = "INVOICE_SENT",
  INVOICE_OVERDUE = "INVOICE_OVERDUE",
  PAYMENT_RECEIVED = "PAYMENT_RECEIVED",
  PAYMENT_FAILED = "PAYMENT_FAILED",
}
```

### 2.2 Extensible Registry Architecture

#### Decision
Rather than hardcoding closed switch statements across delivery services, Aforden implements a table-backed / strongly typed code registry: `EventCatalogRegistry`.

```typescript
export interface EventCatalogDefinition<TPayload = Record<string, unknown>> {
  eventType: NotificationEventType;
  domain: "WORK_ORDER" | "SCHEDULE" | "QUOTE" | "INVOICE" | "PAYMENT";
  defaultChannels: NotificationChannel[];
  defaultRecipientTypes: RecipientType[];
  isMandatoryTransactional: boolean; // If true, cannot be opted out by recipients (e.g. INVOICE_SENT)
  payloadValidator: z.ZodType<TPayload>;
  variableWhitelist: string[];
  description: string;
}
```

#### Architectural Rationale
1. **Open-Closed Principle**: Adding a new operational event in future phases (e.g., Phase 1.14 Analytics or Phase 1.15 Subscriptions) requires only adding the enum value and registering its metadata definition in `EventCatalogRegistry`. The core outbox pipeline, fan-out engine, and delivery worker require zero modifications.
2. **Compile-Time & Runtime Validation**: The registry couples each event type to a Zod validation schema, preventing malformed event payloads from entering the outbox queue.

---

## 3. Notification Lifecycle & State Machines

### 3.1 Three Independent Lifecycles Architecture

Aforden strictly separates three independent lifecycles that answer distinct operational and business questions:
1. **Outbox Processing Lifecycle (`NotificationOutboxStatus`)**: Tracks whether a persisted transactional outbox row has been claimed by a background worker and expanded into a semantic `Notification` with delivery rows.
2. **Semantic Business Notification Lifecycle (`NotificationStatus`)**: Tracks the high-level business delivery outcome of the notification event.
3. **Channel Delivery Lifecycle (`NotificationDeliveryStatus`)**: Tracks the granular per-channel, per-recipient physical transport attempt.

```
[1] Outbox Ingestion & Expansion Lifecycle (NotificationOutbox.status)

       +----------+       worker claim        +------------+
       | PENDING  | ------------------------> | PROCESSING |
       +----+-----+                           +-----+------+
            |                                       |
            | (duplicate dedupeKey on insert)       +---------------------+
            v                                       |                     |
     (Ignored / Handled)                 expanded   v        fatal error  v
                                      +-------------+----+   +------------+
                                      |    PROCESSED     |   |   FAILED   |
                                      +------------------+   +------------+

---------------------------------------------------------------------------------------

[2] Semantic Notification Lifecycle (Notification.status)

       +----------+      fan-out started      +------------+
       | PENDING  | ------------------------> | PROCESSING |
       +----+-----+                           +-----+------+
            |                                       |
            | (all suppressed)                      +-------------------+-------------------+
            v                                       |                   |                   |
     +------------+               v (all delivered) v (partial fail)    v (all failed)      v
     | SUPPRESSED |                  +--------+      +----------------+   +--------+   +-----------+
     +------------+                  |  SENT  |      | PARTIALLY_SENT |   | FAILED |   | CANCELLED |
                                     +--------+      +----------------+   +--------+   +-----------+

---------------------------------------------------------------------------------------

[3] Channel Delivery Lifecycle (NotificationDelivery.status)

       +----------+       worker dispatch     +------------+
       | PENDING  | ------------------------> | PROCESSING |
       +----+-----+                           +-----+------+
            |                                       |
            | (suppressed by pref / missing dst)    +---------------------+
            v                                       |                     |
     +--------------------+            success      v        transient    v
     | SUPPRESSED /       |         +-----------+-------+   error   +------------+
     | SKIPPED            |         |     DELIVERED     |           |   FAILED   |
     +--------------------+         +-------------------+           +-----+------+
                                                                          |
                                                      +-------------------+
                                                      |
                                    retry count < max |  retry count >= max OR fatal
                                                      v
                                              +---------------+     +-----------+
                                              | PENDING_RETRY |     | EXHAUSTED |
                                              +---------------+     +-----------+
```

### 3.2 Explicit State Enumerations

```typescript
export enum NotificationOutboxStatus {
  PENDING = "PENDING",               // Outbox row created, awaiting worker claim
  PROCESSING = "PROCESSING",         // Claimed by worker, resolution and expansion in flight
  PROCESSED = "PROCESSED",           // Successfully expanded into Notification and NotificationDelivery rows
  FAILED = "FAILED",                 // Expansion/claiming encountered fatal unrecoverable error
}

export enum NotificationStatus {
  PENDING = "PENDING",               // Event ingested, awaiting fan-out & delivery resolution
  PROCESSING = "PROCESSING",         // Recipient resolution and delivery queueing in flight
  SENT = "SENT",                     // All generated deliveries successfully delivered
  PARTIALLY_SENT = "PARTIALLY_SENT", // At least 1 delivery succeeded, but >= 1 delivery exhausted
  FAILED = "FAILED",                 // All generated deliveries failed permanently
  SUPPRESSED = "SUPPRESSED",         // All deliveries suppressed by preferences (no sends attempted)
  CANCELLED = "CANCELLED",           // Notification revoked prior to delivery processing
}

export enum NotificationDeliveryStatus {
  PENDING = "PENDING",               // Delivery row generated, awaiting dispatch
  PROCESSING = "PROCESSING",         // Provider API call or in-app write in flight
  DELIVERED = "DELIVERED",           // Delivery confirmed by provider or written to in-app feed
  FAILED = "FAILED",                 // Transient delivery error encountered; eligible for retry
  PENDING_RETRY = "PENDING_RETRY",   // Backoff interval active, scheduled for next retry
  EXHAUSTED = "EXHAUSTED",           // Max attempts exceeded or permanent fatal error (no more retries)
  SKIPPED = "SKIPPED",               // Channel skipped (e.g. missing phone/email on recipient record)
  SUPPRESSED = "SUPPRESSED",         // Filtered out by workspace or member preference settings
}
```

### 3.3 Explicit Transition Guard Invariants

1. **Terminal State Immutability**: Once a `NotificationDelivery` reaches `DELIVERED`, `EXHAUSTED`, `SKIPPED`, or `SUPPRESSED`, its status is permanently immutable.
2. **Aggregated Parent State Resolution**:
   - If total active deliveries = 0 and all were suppressed $\rightarrow$ Parent `Notification.status = SUPPRESSED`.
   - When all deliveries reach terminal states:
     - If count(`DELIVERED`) == total $\rightarrow$ `SENT`.
     - If count(`DELIVERED`) > 0 and count(`EXHAUSTED`) > 0 $\rightarrow$ `PARTIALLY_SENT`.
     - If count(`DELIVERED`) == 0 and count(`EXHAUSTED`) > 0 $\rightarrow$ `FAILED`.

---

## 4. Recipient Model & Tenant-Scoped Resolution

### 4.1 Supported Recipient Types

```typescript
export enum RecipientType {
  WORKSPACE_MEMBER = "WORKSPACE_MEMBER", // Internal staff (Admin, Manager, Dispatcher, Tech, Accountant)
  CUSTOMER_CONTACT = "CUSTOMER_CONTACT", // External customer / point of contact
  DIRECT_RECIPIENT = "DIRECT_RECIPIENT", // Validated external target (ad-hoc email/phone)
}
```

### 4.2 Tenant-Scoped Resolution Architecture

#### Problem
A malicious or buggy operational payload might attempt to send a notification to a `memberId` or `customerId` belonging to a foreign workspace, leaking confidential operational details across tenants.

#### Decision
All recipient resolution is executed **exclusively within the Notification domain** through strictly tenant-bounded queries:

```typescript
export async function resolveRecipientDestination(
  prisma: PrismaClient,
  workspaceId: string,
  recipientType: RecipientType,
  recipientId: string
): Promise<ResolvedRecipientDestination> {
  if (recipientType === RecipientType.WORKSPACE_MEMBER) {
    const member = await prisma.workspaceMember.findFirst({
      where: { id: recipientId, workspaceId, status: "ACTIVE" },
      include: { user: true },
    });
    if (!member || !member.user) {
      throw new NotificationRecipientUnresolvableError(
        `Active member ${recipientId} does not exist in workspace ${workspaceId}.`
      );
    }
    return {
      recipientId: member.id,
      name: member.user.name ?? `${member.user.email}`,
      email: member.user.email,
      userId: member.user.id,
      role: member.role,
    };
  }

  if (recipientType === RecipientType.CUSTOMER_CONTACT) {
    const contact = await prisma.customerContact.findFirst({
      where: { id: recipientId, customer: { workspaceId } },
      include: { customer: true },
    });
    if (!contact) {
      throw new NotificationRecipientUnresolvableError(
        `Customer contact ${recipientId} does not exist in workspace ${workspaceId}.`
      );
    }
    return {
      recipientId: contact.id,
      name: `${contact.firstName} ${contact.lastName}`.trim(),
      email: contact.email ?? undefined,
      phone: contact.phone ?? undefined,
      customerId: contact.customerId,
    };
  }

  throw new InvalidRecipientTypeError(`Unsupported recipient type: ${recipientType}`);
}
```

#### Invariant
If an operational event contains an ID not belonging to `workspaceId`, the resolver immediately aborts and logs `NotificationCrossTenantLeakageError`. It is structurally impossible for an event to target foreign tenant entities.

---

## 5. Channel Model & Selection Rules

### 5.1 Supported Channel Enumeration

```typescript
export enum NotificationChannel {
  IN_APP = "IN_APP", // Internal notification feed / bell menu (Implemented 1.13.8)
  EMAIL = "EMAIL",   // Transactional email dispatch (Implemented 1.13.7)
  SMS = "SMS",       // Short message service (Interface locked; reserved for 1.13.7/1.17)
  PUSH = "PUSH",     // Mobile push notification (Interface locked; reserved for 1.13.7/1.9)
}
```

### 5.2 Channel Selection Engine

The channels activated for any given `(Event, Recipient)` pair are computed via deterministic set intersection:

$$\text{ActiveChannels} = (\text{EventDefaultChannels} \cap \text{WorkspaceEnabledChannels} \cap \text{RecipientAvailableChannels}) \setminus \text{SuppressedPreferences}$$

1. **Event Default Channels**: Defined in `EventCatalogRegistry` (e.g. `WORK_ORDER_ASSIGNED` defaults to `[IN_APP, EMAIL]`).
2. **Workspace Enabled Channels**: Workspace settings (e.g. if the workspace administrator has disabled SMS organization-wide, SMS is removed).
3. **Recipient Available Channels**: If recipient has no valid email on file, `EMAIL` is marked `SKIPPED`. If recipient is external customer, `IN_APP` is excluded.
4. **Preferences & Opt-Outs**: If member disabled `EMAIL` for `WORK_ORDER_ASSIGNED`, `EMAIL` is marked `SUPPRESSED` (unless the event is flagged `isMandatoryTransactional = true`).

---

## 6. Delivery Model: 1:N Fan-Out Architecture

### 6.1 Entity Relational Structure

A single operational event generates exactly one `Notification` record, which fans out to $N$ `NotificationDelivery` rows based on resolved recipients and evaluated channels.

```
                    +------------------------------------+
                    |            Notification            |
                    | id: "notif_001"                    |
                    | eventType: WORK_ORDER_ASSIGNED     |
                    | sourceEntity: "WorkOrder"          |
                    | sourceId: "wo_8842"                |
                    | workspaceId: "ws_acme"             |
                    +-----------------+------------------+
                                      |
                                      | 1:N Relation
                                      v
          +---------------------------+---------------------------+
          |                                                       |
          v                                                       v
+------------------------------------+  +------------------------------------+
|        NotificationDelivery        |  |        NotificationDelivery        |
| id: "deliv_101"                    |  | id: "deliv_102"                    |
| notificationId: "notif_001"        |  | notificationId: "notif_001"        |
| channel: IN_APP                    |  | channel: EMAIL                     |
| recipientType: WORKSPACE_MEMBER    |  | recipientType: WORKSPACE_MEMBER    |
| recipientId: "mem_tech_09"         |  | recipientId: "mem_tech_09"         |
| destination: "user_john_44"        |  | destination: "john@example.com"    |
| status: DELIVERED                  |  | status: DELIVERED                  |
+------------------------------------+  +------------------------------------+
```

### 6.2 Data Integrity Rules
- `NotificationDelivery` records are linked to `Notification` via `onDelete: Cascade`.
- Deleting an operational entity (e.g. during dev seed resets) cascades cleanly through workspace boundaries without leaving orphaned deliveries.
- In production, operational entities use soft deletion or restricted deletes, preserving the immutable communication ledger.

---

## 7. Template Architecture & Safe Token Interpolation

### 7.1 Template Storage & Fallback Precedence

Templates are keyed by the composite tuple: `(workspaceId, eventType, channel, locale)`.

```typescript
// Lookup Precedence:
// 1. Custom Workspace Template: (workspaceId == :wsId, eventType == :type, channel == :chan, locale == :locale)
// 2. Default System Template: Hardcoded fallback in code registry (locale-aware)
```

### 7.2 Safe Token Interpolation Invariant

#### Security Mandate
No arbitrary template engines (e.g., `eval()`, Handlebars runtime expressions, or unsafe string interpolation) are permitted. All templates use strict `{{variableName}}` token replacement.

```typescript
export function renderTemplate(
  templateString: string,
  variables: Record<string, string | number | undefined>,
  allowedWhitelist: string[]
): string {
  return templateString.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, tokenName) => {
    if (!allowedWhitelist.includes(tokenName)) {
      throw new NotificationTemplateCompilationError(
        `Disallowed or unrecognized template token: '{{${tokenName}}}'`
      );
    }
    const val = variables[tokenName];
    if (val === undefined || val === null) {
      return "";
    }
    // Automatically sanitize and escape HTML entities to prevent XSS in email/in-app rendering
    return escapeHtml(String(val));
  });
}
```

#### Token Schema Invariants
1. Variable values are populated **server-side only** from verified database entity fields.
2. User-supplied input strings (e.g., custom work order descriptions or customer notes) are strictly HTML-escaped before interpolation.
3. Templates cannot execute conditional branching or loop constructs in this phase.

---

## 8. Preferences Architecture & Inheritance Rules

*(Locked contract for implementation in Phase 1.13.4)*

### 8.1 Preference Scopes

1. **Workspace Scope (`NotificationPreferenceScope.WORKSPACE`)**: Tenant-wide master toggles controlled by `OWNER` / `ADMIN` (e.g. disable all SMS notifications).
2. **Member Scope (`NotificationPreferenceScope.MEMBER`)**: Per-staff member settings (e.g., Technician turns off `WORK_ORDER_CREATED` email alerts, keeping in-app alerts active).
3. **Customer Scope (`NotificationPreferenceScope.CUSTOMER`)**: External customer opt-out preferences.

### 8.2 Hierarchical Precedence & Safeguard Rules

$$\text{Effective Preference} = \text{System Transactional Guard} \rightarrow \text{Workspace Master Policy} \rightarrow \text{Member/Customer Preference} \rightarrow \text{System Default}$$

```
+-----------------------------------------------------------------------------+
|                                EVALUATION ORDER                             |
|                                                                             |
|  [Step 1] Is Event Mandatory Transactional? (e.g. INVOICE_SENT)             |
|           YES -> FORCE SEND (Preferences CANNOT suppress legal/billing docs)|
|           NO  -> Proceed to Step 2                                          |
|                                                                             |
|  [Step 2] Is Channel Disabled Workspace-Wide?                               |
|           YES -> SUPPRESS CHANNEL                                           |
|           NO  -> Proceed to Step 3                                          |
|                                                                             |
|  [Step 3] Has Recipient Configured an Explicit Preference for this Event?   |
|           YES -> Respect Recipient Preference (ALLOW or SUPPRESS)           |
|           NO  -> Fall back to System Default for this EventType             |
+-----------------------------------------------------------------------------+
```

### 8.3 Security & Boundary Invariant
Preferences act strictly as a **suppression filter**. A preference setting can NEVER:
- Cause a notification to be routed to a foreign recipient or foreign tenant.
- Elevate recipient authorization or bypass RBAC guards.
- Alter the payload or source entity data of a notification.

---

## 9. Event-Trigger Architecture & Transactional Isolation

### 9.1 Transactional Outbox Pattern Workflow

```
[ HTTP Request: POST /api/workspaces/[wsId]/work-orders/[woId]/complete ]
                         |
                         v
+------------------------------------------------------------------+
|               Operational Service: completeWorkOrder()           |
|                                                                  |
|   await prisma.$transaction(async (tx) => {                      |
|     // 1. Mutate WorkOrder status = COMPLETED                    |
|     await tx.workOrder.update({ ... });                          |
|                                                                  |
|     // 2. Append operational audit history                       |
|     await tx.workOrderHistory.create({ ... });                   |
|                                                                  |
|     // 3. Queue Notification Event in Outbox (SAME ACID TX)      |
|     //    Deduplicates deterministically on (workspaceId, dedupeKey)
|     await emitNotificationEvent(tx, {                            |
|       workspaceId,                                               |
|       eventType: NotificationEventType.WORK_ORDER_COMPLETED,     |
|       sourceEntity: "WorkOrder",                                 |
|       sourceId: workOrder.id,                                    |
|       actorMemberId: session.memberId,                           |
|       payload: { workOrderNumber, customerId, technicianId }     |
|     });                                                          |
|   });                                                            |
+------------------------------------------------------------------+
                         |
                         v Transaction Commits
+------------------------------------------------------------------+
|                   Database (PostgreSQL)                          |
|  - WorkOrder: COMPLETED                                          |
|  - WorkOrderHistory: Recorded                                    |
|  - NotificationOutbox: PENDING (dedupeKey: sha256(...))          |
+------------------------------------------------------------------+
                         |
                         v Asynchronous Worker (Poll / Queue Processor)
+------------------------------------------------------------------+
|                   Outbox Processing Engine                       |
|  1. Claim pending outbox row (atomic status -> PROCESSING)       |
|  2. Resolve recipients and channels                              |
|  3. Render templates and insert Notification & Deliveries         |
|  4. Dispatch via InApp / EmailProvider                           |
|  5. Mark Outbox status = PROCESSED (NotificationOutboxStatus)    |
+------------------------------------------------------------------+
```

### 9.2 Failure Isolation Matrix

| Failure Scenario | Operational Mutation Impact | Notification Impact | System Behavior |
| :--- | :--- | :--- | :--- |
| **Database error during WorkOrder mutation** | Rolls back cleanly | Rolls back (no outbox row created) | Client receives 4xx/5xx; zero phantom notifications. |
| **Database error inserting Outbox row** | Rolls back cleanly | Rolls back | Transactional consistency preserved. |
| **Duplicate operational event emission** | **Unaffected (Committed)** | Existing outbox row returned; zero duplicate outbox records | Ingestion deduplication on `(workspaceId, dedupeKey)` ignores duplicate. |
| **Email provider (Resend) outage / 503** | **Unaffected (Committed)** | Outbox marked `PROCESSED`; Delivery marked `FAILED`, enqueued for retry | WorkOrder remains `COMPLETED`; retry worker attempts delivery later. |
| **Invalid recipient email syntax** | **Unaffected (Committed)** | Outbox marked `PROCESSED`; Delivery marked `EXHAUSTED` | WorkOrder remains `COMPLETED`; error logged to `NotificationLog`. |
| **Worker process crash mid-dispatch** | **Unaffected (Committed)** | Outbox lock expires; reclaimed by next worker | At-least-once delivery guaranteed by worker heartbeat. |

---

## 10. Retry Philosophy & Exponential Backoff

### 10.1 Error Classification: Transient vs. Permanent

| Category | Error Conditions | Action | Next State |
| :--- | :--- | :--- | :--- |
| **Transient (Retryable)** | HTTP 429 (Rate Limit), HTTP 500/502/503/504 (Provider Down), Network TCP timeout, DB connection pool lock timeout. | Calculate backoff delay, increment `attemptCount`, reschedule. | `PENDING_RETRY` |
| **Permanent (Fatal)** | HTTP 400 (Malformed payload), HTTP 404 (Unknown recipient), Invalid email syntax, Deactivated user account, Blocked/Spam destination. | Log diagnostic error code, abort retries immediately. | `EXHAUSTED` |

### 10.2 Mathematical Backoff Formula

Retries use bounded exponential backoff with full jitter to avoid the "thundering herd" problem on third-party provider recovery:

$$\Delta t = \min\left(t_{\max},\; t_{\text{base}} \times 2^{(\text{attempt} - 1)}\right) + \text{uniform}(0, t_{\text{jitter}})$$

- Parameters:
  - $t_{\text{base}} = 10\text{ seconds}$
  - $\text{Multiplier} = 2.0$
  - $t_{\max} = 3600\text{ seconds (1 hour)}$
  - $t_{\text{jitter}} = 5\text{ seconds}$
  - $N_{\max} = 5\text{ attempts}$

```
Attempt 1: Immediate (0s)
Attempt 2: ~10s (+ 0-5s jitter)
Attempt 3: ~20s (+ 0-5s jitter)
Attempt 4: ~40s (+ 0-5s jitter)
Attempt 5: ~80s (+ 0-5s jitter)
Attempt 6: EXHAUSTED (Permanently failed; alert logged)
```

---

## 11. Idempotency Architecture (Two-Tiered Protection)

Aforden implements end-to-end idempotency protection across two distinct architectural boundaries:
1. **Tier 1 (Event-Ingestion Level)**: Protects `NotificationOutbox` against duplicate calls to `emitNotificationEvent()`.
2. **Tier 2 (Delivery-Dispatch Level)**: Protects `NotificationDelivery` against duplicate transport dispatches during worker retries.

```
[ Tier 1: Event Ingestion ]
emitNotificationEvent(tx, event) ---> SHA256(workspaceId + ":" + sourceEntity + ":" + sourceId + ":" + eventType)
                                      Enforced by: NotificationOutbox.@@unique([workspaceId, dedupeKey])
                                      Result: Prevents duplicate Notification creation

[ Tier 2: Delivery Dispatch ]
dispatchDelivery(delivery)       ---> SHA256(workspaceId + ":" + notificationId + ":" + channel + ":" + recipientType + ":" + recipientId)
                                      Enforced by: NotificationDelivery.@@unique([workspaceId, idempotencyKey])
                                      Result: Prevents duplicate email / SMS / push transmissions
```

### 11.1 Tier 1: Event-Ingestion Idempotency (`NotificationOutbox.dedupeKey`)

- **Deterministic Default**:
  $$\text{dedupeKey} = \text{SHA256}(\text{workspaceId} + ":" + \text{sourceEntity} + ":" + \text{sourceId} + ":" + \text{eventType})$$
- **Legitimate Recurrences**: For events that legitimately recur for the same source entity and event type (such as `SCHEDULE_APPOINTMENT_APPROACHING` reminder sequences), the caller provides an explicit `dedupeKey` containing a sequence differentiator (e.g. `reminder_24h`, `reminder_1h`).
- **Database Enforcement**: `NotificationOutbox` enforces `@@unique([workspaceId, dedupeKey])`.
- **Behavior on Duplicate**: If a duplicate emission occurs, `emitNotificationEvent()` catches the conflict, logs a duplicate-ingestion warning, and safely returns the existing outbox record. Zero duplicate notifications are created.

### 11.2 Tier 2: Delivery-Level Idempotency (`NotificationDelivery.idempotencyKey`)

- **Deterministic Key Construction**:
  $$\text{idempotencyKey} = \text{SHA256}(\text{workspaceId} + ":" + \text{notificationId} + ":" + \text{channel} + ":" + \text{recipientType} + ":" + \text{recipientId})$$
- **Database Enforcement**: `NotificationDelivery` enforces `@@unique([workspaceId, idempotencyKey])`.

### 11.3 Concurrency Control & Row-Level Locking

When workers claim outbox or delivery rows, race conditions across multiple concurrent background workers are structurally prevented using atomic status transitions and PostgreSQL `FOR UPDATE SKIP LOCKED`:

```sql
-- Outbox Worker Claim
UPDATE "NotificationOutbox"
SET "status" = 'PROCESSING'
WHERE "id" IN (
    SELECT "id"
    FROM "NotificationOutbox"
    WHERE "status" = 'PENDING'
    ORDER BY "createdAt" ASC
    LIMIT 25
    FOR UPDATE SKIP LOCKED
)
RETURNING *;

-- Delivery Worker Claim
UPDATE "NotificationDelivery"
SET "status" = 'PROCESSING',
    "lastAttemptAt" = NOW()
WHERE "id" IN (
    SELECT "id"
    FROM "NotificationDelivery"
    WHERE "status" IN ('PENDING', 'PENDING_RETRY')
      AND ("nextAttemptAt" IS NULL OR "nextAttemptAt" <= NOW())
    ORDER BY "createdAt" ASC
    LIMIT 20
    FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

---

## 12. Audit & Communication History Requirements

### 12.1 Operational History vs. Communication History

Aforden maintains a strict architectural distinction between **operational history** and **communication history**:

```
+-------------------------------------------------------+  +-------------------------------------------------------+
|             OPERATIONAL AUDIT LEDGER                  |  |             COMMUNICATION AUDIT LEDGER                |
|       (WorkOrderHistory, InvoiceHistory, etc.)        |  |            (NotificationLog / Delivery)               |
+-------------------------------------------------------+  +-------------------------------------------------------+
| Focus: "WHAT HAPPENED TO THE BUSINESS ENTITY"         |  | Focus: "HOW AND TO WHOM WAS IT COMMUNICATED"          |
| - WorkOrder status changed to COMPLETED               |  | - Email dispatched to customer@example.com            |
| - Technician John assigned                            |  | - In-App notification pushed to tech_01               |
| - Invoice total changed to $450.00                    |  | - Resend messageId msg_9941 (HTTP 200)                |
| - Actor: Dispatcher Sarah                             |  | - Delivery attempt count: 1                           |
+-------------------------------------------------------+  +-------------------------------------------------------+
```

### 12.2 Durable Communication History Query Contract

The communication log answers all regulatory and operational compliance questions:
1. Which operational record triggered this message? (`sourceEntity: "WorkOrder"`, `sourceId: "wo_102"`)
2. Who received it? (`recipientType: CUSTOMER_CONTACT`, `recipient: "Jane Doe <jane@example.com>"`)
3. Through which channel? (`channel: EMAIL`)
4. What was the exact delivery timeline? (`createdAt`, `lastAttemptAt`, `deliveredAt`)
5. Did third-party providers accept the message? (`provider: "resend"`, `providerMessageId: "email_89472"`)
6. If it failed, what was the root cause? (`errorCode: "BOUNCE"`, `errorMessage: "550 Mailbox does not exist"`)

---

## 13. Tenant Isolation & Structural Protection

### 13.1 Multi-Tenant Invariants

1. **Non-Nullable `workspaceId`**: Every notification table (`NotificationOutbox`, `Notification`, `NotificationDelivery`, `NotificationTemplate`, `NotificationPreference`, `NotificationLog`, `InAppNotificationFeed`) contains a non-nullable `workspaceId String` foreign key.
2. **Cascade Deletion**: All tables enforce `onDelete: Cascade` with their parent `Workspace`.
3. **Composite Database Indexes**: All primary search indexes lead with or include `workspaceId`:
   - `@@index([workspaceId, status])`
   - `@@index([workspaceId, eventType])`
   - `@@unique([workspaceId, idempotencyKey])`
   - `@@unique([workspaceId, eventType, channel, locale])`
4. **Zero Cross-Tenant Foreign Keys**: Notification tables never link directly to foreign entity tables without qualifying `workspaceId`.

---

## 14. Authorization Boundaries & RBAC

### 14.1 Role-Based Access Control Matrix

| Role | View In-App Feed | Manage Personal Preferences | View Workspace Notification Logs | Configure Workspace Templates / Channels | Manage All Workspace Preferences |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **OWNER** | ✅ All | ✅ | ✅ | ✅ | ✅ |
| **ADMIN** | ✅ All | ✅ | ✅ | ✅ | ✅ |
| **MANAGER** | ✅ All | ✅ | ✅ | ❌ | ❌ |
| **DISPATCHER** | ✅ Assigned Jobs | ✅ | ✅ (Operational) | ❌ | ❌ |
| **TECHNICIAN** | ✅ Personal Only | ✅ (Personal) | ❌ | ❌ | ❌ |
| **ACCOUNTANT** | ✅ Billing Only | ✅ (Personal) | ✅ (Financial) | ❌ | ❌ |

### 14.2 Server-Authoritative Actor Derivation

The `actorMemberId` recorded on notifications is derived **strictly server-side** from the authenticated user session:
- In API route handlers: `session.user.memberId`
- In automated cron / background queue jobs: `SYSTEM` (null memberId with `actorType = SYSTEM`)
- **Blocked**: Client request bodies cannot supply or override `actorMemberId`.

---

## 15. Failure Handling & Error Taxonomy

### 15.1 Pure Domain Error Classes (Convention B)

Following Aforden architecture conventions, all notification domain errors are pure TypeScript `Error` subclasses containing immutable `readonly code`, `readonly statusCode`, and `readonly httpStatus` metadata:

```typescript
export class NotificationNotFoundError extends Error {
  readonly code = "NOTIFICATION_NOT_FOUND";
  readonly statusCode = 404;
  readonly httpStatus = 404;
  constructor(message = "Notification not found.") {
    super(message);
    this.name = "NotificationNotFoundError";
  }
}

export class NotificationDeliveryNotFoundError extends Error {
  readonly code = "NOTIFICATION_DELIVERY_NOT_FOUND";
  readonly statusCode = 404;
  readonly httpStatus = 404;
  constructor(message = "Notification delivery record not found.") {
    super(message);
    this.name = "NotificationDeliveryNotFoundError";
  }
}

export class NotificationTemplateNotFoundError extends Error {
  readonly code = "NOTIFICATION_TEMPLATE_NOT_FOUND";
  readonly statusCode = 404;
  readonly httpStatus = 404;
  constructor(message = "Notification template not found.") {
    super(message);
    this.name = "NotificationTemplateNotFoundError";
  }
}

export class NotificationPreferenceNotFoundError extends Error {
  readonly code = "NOTIFICATION_PREFERENCE_NOT_FOUND";
  readonly statusCode = 404;
  readonly httpStatus = 404;
  constructor(message = "Notification preference record not found.") {
    super(message);
    this.name = "NotificationPreferenceNotFoundError";
  }
}

export class InvalidNotificationEventType extends Error {
  readonly code = "INVALID_NOTIFICATION_EVENT_TYPE";
  readonly statusCode = 400;
  readonly httpStatus = 400;
  constructor(message = "Invalid or unsupported notification event type.") {
    super(message);
    this.name = "InvalidNotificationEventType";
  }
}

export class InvalidNotificationChannelError extends Error {
  readonly code = "INVALID_NOTIFICATION_CHANNEL";
  readonly statusCode = 400;
  readonly httpStatus = 400;
  constructor(message = "Invalid or unsupported notification channel.") {
    super(message);
    this.name = "InvalidNotificationChannelError";
  }
}

export class DuplicateNotificationEventError extends Error {
  readonly code = "DUPLICATE_NOTIFICATION_EVENT";
  readonly statusCode = 409;
  readonly httpStatus = 409;
  constructor(message = "Duplicate notification event detected by idempotency key.") {
    super(message);
    this.name = "DuplicateNotificationEventError";
  }
}

export class NotificationCrossTenantLeakageError extends Error {
  readonly code = "NOTIFICATION_CROSS_TENANT_LEAKAGE";
  readonly statusCode = 403;
  readonly httpStatus = 403;
  constructor(message = "Recipient or entity does not belong to the event workspace.") {
    super(message);
    this.name = "NotificationCrossTenantLeakageError";
  }
}

export class NotificationActorUnauthorizedError extends Error {
  readonly code = "NOTIFICATION_ACTOR_UNAUTHORIZED";
  readonly statusCode = 403;
  readonly httpStatus = 403;
  constructor(message = "Actor does not have permission to view or manage this notification resource.") {
    super(message);
    this.name = "NotificationActorUnauthorizedError";
  }
}

export class NotificationPayloadValidationError extends Error {
  readonly code = "NOTIFICATION_PAYLOAD_VALIDATION_ERROR";
  readonly statusCode = 422;
  readonly httpStatus = 422;
  constructor(message = "Event payload failed schema validation for this event type.") {
    super(message);
    this.name = "NotificationPayloadValidationError";
  }
}

export class NotificationTemplateCompilationError extends Error {
  readonly code = "NOTIFICATION_TEMPLATE_COMPILATION_ERROR";
  readonly statusCode = 422;
  readonly httpStatus = 422;
  constructor(message = "Template compilation failed due to invalid token syntax or missing variable.") {
    super(message);
    this.name = "NotificationTemplateCompilationError";
  }
}

export class NotificationRecipientUnresolvableError extends Error {
  readonly code = "NOTIFICATION_RECIPIENT_UNRESOLVABLE";
  readonly statusCode = 422;
  readonly httpStatus = 422;
  constructor(message = "Recipient cannot be resolved to a valid communication destination.") {
    super(message);
    this.name = "NotificationRecipientUnresolvableError";
  }
}

export class NotificationChannelDisabledError extends Error {
  readonly code = "NOTIFICATION_CHANNEL_DISABLED";
  readonly statusCode = 422;
  readonly httpStatus = 422;
  constructor(message = "The requested communication channel is disabled for this workspace.") {
    super(message);
    this.name = "NotificationChannelDisabledError";
  }
}

export class NotificationDeliveryExhaustedError extends Error {
  readonly code = "NOTIFICATION_DELIVERY_EXHAUSTED";
  readonly statusCode = 500;
  readonly httpStatus = 500;
  constructor(message = "Notification delivery exceeded maximum retry attempts.") {
    super(message);
    this.name = "NotificationDeliveryExhaustedError";
  }
}

export class NotificationProviderUnavailableError extends Error {
  readonly code = "NOTIFICATION_PROVIDER_UNAVAILABLE";
  readonly statusCode = 503;
  readonly httpStatus = 503;
  constructor(message = "Third-party notification transport provider is currently unreachable.") {
    super(message);
    this.name = "NotificationProviderUnavailableError";
  }
}
```

---

## 16. Future Provider Abstraction Layer

### 16.1 Abstract Provider Interfaces

All transport mechanisms are defined as abstract contracts. Concrete implementations (e.g. Resend, Twilio, Firebase Cloud Messaging) adhere strictly to these interfaces without leaking vendor types into core domain services:

```typescript
export interface SendEmailInput {
  to: string | string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
  attachments?: Array<{ filename: string; content: Buffer; contentType: string }>;
  idempotencyKey?: string;
}

export interface SendEmailResult {
  success: boolean;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  isRetryable: boolean;
}

export interface EmailProvider {
  readonly providerName: string;
  send(input: SendEmailInput): Promise<SendEmailResult>;
}

export interface SendSmsInput {
  to: string;
  message: string;
  idempotencyKey?: string;
}

export interface SendSmsResult {
  success: boolean;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  isRetryable: boolean;
}

export interface SMSProvider {
  readonly providerName: string;
  send(input: SendSmsInput): Promise<SendSmsResult>;
}

export interface SendPushInput {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  idempotencyKey?: string;
}

export interface SendPushResult {
  success: boolean;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
  isRetryable: boolean;
}

export interface PushProvider {
  readonly providerName: string;
  send(input: SendPushInput): Promise<SendPushResult>;
}

export interface PublishInAppInput {
  workspaceId: string;
  memberId: string;
  title: string;
  body: string;
  linkUrl?: string;
  sourceEntity?: string;
  sourceId?: string;
  notificationId: string;
}

export interface PublishInAppResult {
  success: boolean;
  feedItemId: string;
}

export interface InAppProvider {
  publish(input: PublishInAppInput): Promise<PublishInAppResult>;
}
```

### 16.2 Provider Factory & Resolution Strategy

```typescript
export class NotificationProviderFactory {
  private static emailProvider: EmailProvider | null = null;
  private static inAppProvider: InAppProvider | null = null;

  static getEmailProvider(): EmailProvider {
    if (!this.emailProvider) {
      // Lazily instantiated Resend or Mock provider depending on NODE_ENV / configuration
      this.emailProvider = new ResendEmailProviderAdapter();
    }
    return this.emailProvider;
  }

  static getInAppProvider(): InAppProvider {
    if (!this.inAppProvider) {
      this.inAppProvider = new DatabaseInAppProviderAdapter();
    }
    return this.inAppProvider;
  }
}
```

---

## 17. Prisma Schema Blueprint Sketch (Target for Phase 1.13.2)

The following schema represents the concrete Prisma data model sketched and locked for migration in Phase 1.13.2:

```prisma
enum NotificationEventType {
  WORK_ORDER_CREATED
  WORK_ORDER_ASSIGNED
  WORK_ORDER_REASSIGNED
  WORK_ORDER_UNASSIGNED
  WORK_ORDER_STATUS_CHANGED
  WORK_ORDER_STARTED
  WORK_ORDER_PAUSED
  WORK_ORDER_RESUMED
  WORK_ORDER_COMPLETED
  WORK_ORDER_CANCELLED

  SCHEDULE_APPOINTMENT_SCHEDULED
  SCHEDULE_APPOINTMENT_RESCHEDULED
  SCHEDULE_DISPATCH_CHANGED
  SCHEDULE_APPOINTMENT_APPROACHING

  QUOTE_CREATED
  QUOTE_SENT
  QUOTE_ACCEPTED
  QUOTE_REJECTED
  QUOTE_EXPIRED

  INVOICE_CREATED
  INVOICE_SENT
  INVOICE_OVERDUE
  PAYMENT_RECEIVED
  PAYMENT_FAILED
}

enum NotificationChannel {
  IN_APP
  EMAIL
  SMS
  PUSH
}

enum NotificationOutboxStatus {
  PENDING
  PROCESSING
  PROCESSED
  FAILED
}

enum NotificationStatus {
  PENDING
  PROCESSING
  SENT
  PARTIALLY_SENT
  FAILED
  SUPPRESSED
  CANCELLED
}

enum NotificationDeliveryStatus {
  PENDING
  PROCESSING
  DELIVERED
  FAILED
  PENDING_RETRY
  EXHAUSTED
  SKIPPED
  SUPPRESSED
}

enum RecipientType {
  WORKSPACE_MEMBER
  CUSTOMER_CONTACT
  DIRECT_RECIPIENT
}

enum NotificationPreferenceScope {
  WORKSPACE
  MEMBER
  CUSTOMER
}

model NotificationOutbox {
  id            String                   @id @default(cuid())
  workspaceId   String
  eventType     NotificationEventType
  sourceEntity  String                   @db.VarChar(64)
  sourceId      String                   @db.VarChar(64)
  dedupeKey     String                   @db.VarChar(128)
  actorMemberId String?
  payload       Json
  status        NotificationOutboxStatus @default(PENDING)
  attemptCount  Int                      @default(0)
  errorMessage  String?                  @db.Text
  processedAt   DateTime?
  createdAt     DateTime                 @default(now())

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, dedupeKey])
  @@index([workspaceId, status])
  @@index([status, createdAt])
}

model Notification {
  id            String                @id @default(cuid())
  workspaceId   String
  eventType     NotificationEventType
  sourceEntity  String                @db.VarChar(64)
  sourceId      String                @db.VarChar(64)
  actorMemberId String?
  status        NotificationStatus    @default(PENDING)
  metadata      Json?
  createdAt     DateTime              @default(now())
  updatedAt     DateTime              @updatedAt

  workspace  Workspace              @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  deliveries NotificationDelivery[]
  logs       NotificationLog[]

  @@index([workspaceId, eventType])
  @@index([workspaceId, sourceEntity, sourceId])
  @@index([workspaceId, status])
  @@index([createdAt])
}

model NotificationDelivery {
  id                String                     @id @default(cuid())
  notificationId    String
  workspaceId       String
  channel           NotificationChannel
  recipientType     RecipientType
  recipientId       String
  destination       String                     @db.VarChar(255)
  status            NotificationDeliveryStatus @default(PENDING)
  attemptCount      Int                        @default(0)
  maxAttempts       Int                        @default(5)
  lastAttemptAt     DateTime?
  nextAttemptAt     DateTime?
  deliveredAt       DateTime?
  providerMessageId String?                    @db.VarChar(255)
  errorCode         String?                    @db.VarChar(64)
  errorMessage      String?                    @db.Text
  idempotencyKey    String                     @db.VarChar(128)
  createdAt         DateTime                   @default(now())
  updatedAt         DateTime                   @updatedAt

  notification Notification      @relation(fields: [notificationId], references: [id], onDelete: Cascade)
  workspace    Workspace         @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  logs         NotificationLog[]

  @@unique([workspaceId, idempotencyKey])
  @@index([workspaceId, status])
  @@index([status, nextAttemptAt])
  @@index([notificationId])
  @@index([recipientType, recipientId])
}

model NotificationTemplate {
  id          String                @id @default(cuid())
  workspaceId String
  eventType   NotificationEventType
  channel     NotificationChannel
  locale      String                @default("en") @db.VarChar(10)
  subject     String?               @db.VarChar(255)
  bodyHtml    String?               @db.Text
  bodyText    String                @db.Text
  isActive    Boolean               @default(true)
  createdAt   DateTime              @default(now())
  updatedAt   DateTime              @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, eventType, channel, locale])
  @@index([workspaceId, eventType])
}

model NotificationPreference {
  id          String                      @id @default(cuid())
  workspaceId String
  scope       NotificationPreferenceScope
  scopeId     String?                     @db.VarChar(64) // memberId or customerId (null if WORKSPACE)
  eventType   NotificationEventType
  channel     NotificationChannel
  isEnabled   Boolean                     @default(true)
  createdAt   DateTime                    @default(now())
  updatedAt   DateTime                    @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, scope, scopeId, eventType, channel])
  @@index([workspaceId, scope, scopeId])
}

model NotificationLog {
  id                String                     @id @default(cuid())
  workspaceId       String
  notificationId    String
  deliveryId        String?
  channel           NotificationChannel
  recipient         String                     @db.VarChar(255)
  status            NotificationDeliveryStatus
  attemptNumber     Int
  provider          String                     @db.VarChar(64)
  providerMessageId String?                    @db.VarChar(255)
  errorCode         String?                    @db.VarChar(64)
  errorMessage      String?                    @db.Text
  metadata          Json?
  createdAt         DateTime                   @default(now())

  workspace    Workspace             @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  notification Notification          @relation(fields: [notificationId], references: [id], onDelete: Cascade)
  delivery     NotificationDelivery? @relation(fields: [deliveryId], references: [id], onDelete: SetNull)

  @@index([workspaceId, createdAt])
  @@index([notificationId])
  @@index([deliveryId])
}

model InAppNotificationFeed {
  id             String    @id @default(cuid())
  workspaceId    String
  memberId       String
  notificationId String
  title          String    @db.VarChar(255)
  body           String    @db.Text
  linkUrl        String?   @db.VarChar(512)
  sourceEntity   String?   @db.VarChar(64)
  sourceId       String?   @db.VarChar(64)
  isRead         Boolean   @default(false)
  readAt         DateTime?
  isArchived     Boolean   @default(false)
  archivedAt     DateTime?
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt

  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([workspaceId, memberId, isRead, isArchived])
  @@index([workspaceId, memberId, createdAt])
}
```

---

## 18. Phase 1.13 Implementation Roadmap (10-Stage Breakdown)

The implementation of Phase 1.13 spans 10 sequential, rigorous sub-phases (1.13.1 through 1.13.10):

| Milestone | Stage Scope | Core Deliverables |
| :--- | :--- | :--- |
| **Phase 1.13.1** | Domain Architecture & Specification | Locked architecture contract (`phase-1.13.1-notifications-communications-domain-architecture.md`), walkthrough, and self-audit. |
| **Phase 1.13.2** | Prisma Schema & Database Migration | `NotificationOutbox`, `Notification`, `NotificationDelivery`, `NotificationTemplate`, `NotificationPreference`, `NotificationLog`, `InAppNotificationFeed` Prisma models, workspace cascades, indices, migration execution, and client regeneration. |
| **Phase 1.13.3** | Domain Types, Errors & Validation Schemas | Pure domain error classes (Convention B), TypeScript DTOs, Zod event payload schemas, and event catalog registry. |
| **Phase 1.13.4** | Recipient Resolution Engine & Notification Preferences | Workspace/member/customer recipient resolvers, preference evaluation matrix, mandatory event guards, and tenant validation. |
| **Phase 1.13.5** | Template Engine & Safe Variable Interpolation | Token replacement engine, HTML sanitization, system default template catalog, and custom template CRUD services. |
| **Phase 1.13.6** | Event Ingestion & Transactional Outbox Pipeline | `emitNotificationEvent()` transaction integration, outbox worker polling, atomic status claiming, and fan-out orchestrator. |
| **Phase 1.13.7** | Provider Abstraction & Delivery Adapters | `EmailProvider` (Resend adapter), `InAppProvider` (DB feed adapter), mock SMS/Push provider interfaces, and factory registry. |
| **Phase 1.13.8** | In-App Notification Center & Member Feed API | In-app feed queries, unread count badge service, `markAsRead`, `markAllAsRead`, `archiveNotification`, and REST endpoints. |
| **Phase 1.13.9** | Operational Domain Event Integrations | Outbox event wiring across WorkOrder (1.6/1.9), Schedule (1.8), Quote (1.11), and Invoice/Payment (1.12) lifecycle services. |
| **Phase 1.13.10** | Retry/Backoff Engine, Audit History, REST API Routes & Hardening | Exponential backoff retry engine, communication history directory, REST API endpoints, RBAC enforcement, Vitest test suite, and final phase lock. |

---

## 19. Architectural Invariant Summary Checklist

- [x] **No Direct Provider Calls**: Operational domain services never import provider SDKs or construct transport messages directly.
- [x] **Transactional Outbox Guarantee**: `emitNotificationEvent(tx, ...)` writes outbox rows in the same ACID transaction as operational mutations.
- [x] **Zero Rollback Blast-Radius**: Provider outages, network errors, or invalid recipient addresses never fail or roll back operational mutations.
- [x] **Tenant Boundary Isolation**: All recipient resolution queries are workspace-scoped; cross-tenant references fail fast with `NotificationCrossTenantLeakageError`.
- [x] **Safe Template Interpolation**: Strict token parsing (`{{token}}`) with zero runtime code execution (`eval()`, Handlebars expressions) and automatic HTML escaping.
- [x] **Deterministic Idempotency**: Unique constraint `@@unique([workspaceId, idempotencyKey])` enforces at-most-once delivery per channel attempt.
- [x] **Independent Audit History**: Communication history (`NotificationLog`) is distinct from operational entity history (`WorkOrderHistory`).
- [x] **RBAC & Actor Integrity**: Notification actor identity is strictly server-derived from authenticated sessions or system cron jobs.
