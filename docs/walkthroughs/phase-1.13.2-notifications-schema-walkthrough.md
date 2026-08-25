# Phase 1.13.2 — Notifications & Communications Schema & Database Migration Walkthrough

> **Milestone Status**: COMPLETE & VERIFIED  
> **Migration Name**: `20260825100939_add_notifications_communications_domain`  
> **Schema Source**: [`prisma/schema.prisma`](file:///d:/Download/aforden/prisma/schema.prisma)  
> **Sub-Phase Deliverable**: Prisma Schema Models, Constraints, Migration Execution, Client Generation, Type Checking & Test Suite Verification  

---

## 1. Milestone Overview

Phase 1.13.2 establishes the physical database schema and relational persistence layer for the **Notifications & Communications** domain in the Aforden FSM platform.

Built strictly against the locked Phase 1.13.1 architecture specification (including the audit-corrected `NotificationOutboxStatus` enum and `NotificationOutbox.dedupeKey` field), this phase introduces all 7 enums, 7 database models, workspace cascade relations, uniqueness constraints, and performance indexes.

---

## 2. Enums Added

The following 7 enums were added to [`prisma/schema.prisma`](file:///d:/Download/aforden/prisma/schema.prisma):

1. **`NotificationEventType`** (24 operational values):
   - Work Orders (10): `WORK_ORDER_CREATED`, `WORK_ORDER_ASSIGNED`, `WORK_ORDER_REASSIGNED`, `WORK_ORDER_UNASSIGNED`, `WORK_ORDER_STATUS_CHANGED`, `WORK_ORDER_STARTED`, `WORK_ORDER_PAUSED`, `WORK_ORDER_RESUMED`, `WORK_ORDER_COMPLETED`, `WORK_ORDER_CANCELLED`
   - Scheduling & Dispatch (4): `SCHEDULE_APPOINTMENT_SCHEDULED`, `SCHEDULE_APPOINTMENT_RESCHEDULED`, `SCHEDULE_DISPATCH_CHANGED`, `SCHEDULE_APPOINTMENT_APPROACHING`
   - Quotes & Estimates (5): `QUOTE_CREATED`, `QUOTE_SENT`, `QUOTE_ACCEPTED`, `QUOTE_REJECTED`, `QUOTE_EXPIRED`
   - Invoicing & Payments (5): `INVOICE_CREATED`, `INVOICE_SENT`, `INVOICE_OVERDUE`, `PAYMENT_RECEIVED`, `PAYMENT_FAILED`
2. **`NotificationChannel`**: `IN_APP`, `EMAIL`, `SMS`, `PUSH`
3. **`NotificationOutboxStatus`**: `PENDING`, `PROCESSING`, `PROCESSED`, `FAILED`
4. **`NotificationStatus`**: `PENDING`, `PROCESSING`, `SENT`, `PARTIALLY_SENT`, `FAILED`, `SUPPRESSED`, `CANCELLED`
5. **`NotificationDeliveryStatus`**: `PENDING`, `PROCESSING`, `DELIVERED`, `FAILED`, `PENDING_RETRY`, `EXHAUSTED`, `SKIPPED`, `SUPPRESSED`
6. **`RecipientType`**: `WORKSPACE_MEMBER`, `CUSTOMER_CONTACT`, `DIRECT_RECIPIENT`
7. **`NotificationPreferenceScope`**: `WORKSPACE`, `MEMBER`, `CUSTOMER`

---

## 3. Database Models Added

The following 7 models were added to [`prisma/schema.prisma`](file:///d:/Download/aforden/prisma/schema.prisma):

### 1. `NotificationOutbox`
- **Purpose**: Transactional outbox table for reliable, asynchronous event dispatch with ingestion-level idempotency.
- **Fields**: `id`, `workspaceId`, `eventType`, `sourceEntity`, `sourceId`, `dedupeKey`, `actorMemberId`, `payload`, `status`, `attemptCount`, `errorMessage`, `processedAt`, `createdAt`.
- **Constraints & Indexes**:
  - `@@unique([workspaceId, dedupeKey])`
  - `@@index([workspaceId, status])`
  - `@@index([status, createdAt])`
- **Relations**: `workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)`

### 2. `Notification`
- **Purpose**: Semantic business record representing the occurrence of a domain event.
- **Fields**: `id`, `workspaceId`, `eventType`, `sourceEntity`, `sourceId`, `actorMemberId`, `status`, `metadata`, `createdAt`, `updatedAt`.
- **Constraints & Indexes**:
  - `@@index([workspaceId, eventType])`
  - `@@index([workspaceId, sourceEntity, sourceId])`
  - `@@index([workspaceId, status])`
  - `@@index([createdAt])`
- **Relations**:
  - `workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)`
  - `deliveries NotificationDelivery[]`
  - `logs NotificationLog[]`

### 3. `NotificationDelivery`
- **Purpose**: Fine-grained per-channel, per-recipient delivery attempt tracking with delivery-level idempotency.
- **Fields**: `id`, `notificationId`, `workspaceId`, `channel`, `recipientType`, `recipientId`, `destination`, `status`, `attemptCount`, `maxAttempts` (default 5), `lastAttemptAt`, `nextAttemptAt`, `deliveredAt`, `providerMessageId`, `errorCode`, `errorMessage`, `idempotencyKey`, `createdAt`, `updatedAt`.
- **Constraints & Indexes**:
  - `@@unique([workspaceId, idempotencyKey])`
  - `@@index([workspaceId, status])`
  - `@@index([status, nextAttemptAt])`
  - `@@index([notificationId])`
  - `@@index([recipientType, recipientId])`
- **Relations**:
  - `notification Notification @relation(fields: [notificationId], references: [id], onDelete: Cascade)`
  - `workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)`
  - `logs NotificationLog[]`

### 4. `NotificationTemplate`
- **Purpose**: Workspace custom templates mapping `(workspaceId, eventType, channel, locale)` with system default fallback.
- **Fields**: `id`, `workspaceId`, `eventType`, `channel`, `locale` (default "en"), `subject`, `bodyHtml`, `bodyText`, `isActive`, `createdAt`, `updatedAt`.
- **Constraints & Indexes**:
  - `@@unique([workspaceId, eventType, channel, locale])`
  - `@@index([workspaceId, eventType])`
- **Relations**: `workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)`

### 5. `NotificationPreference`
- **Purpose**: Multi-tiered preference rules (Workspace, Member, Customer) governing communication channels.
- **Fields**: `id`, `workspaceId`, `scope`, `scopeId`, `eventType`, `channel`, `isEnabled` (default true), `createdAt`, `updatedAt`.
- **Constraints & Indexes**:
  - `@@unique([workspaceId, scope, scopeId, eventType, channel])`
  - `@@index([workspaceId, scope, scopeId])`
- **Relations**: `workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)`

### 6. `NotificationLog`
- **Purpose**: Durable communication audit ledger capturing transport diagnostic metadata and provider message IDs.
- **Fields**: `id`, `workspaceId`, `notificationId`, `deliveryId`, `channel`, `recipient`, `status`, `attemptNumber`, `provider`, `providerMessageId`, `errorCode`, `errorMessage`, `metadata`, `createdAt`.
- **Constraints & Indexes**:
  - `@@index([workspaceId, createdAt])`
  - `@@index([notificationId])`
  - `@@index([deliveryId])`
- **Relations**:
  - `workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)`
  - `notification Notification @relation(fields: [notificationId], references: [id], onDelete: Cascade)`
  - `delivery NotificationDelivery? @relation(fields: [deliveryId], references: [id], onDelete: SetNull)`

### 7. `InAppNotificationFeed`
- **Purpose**: Real-time user notification feed supporting unread badge counts, mark-read, and archive states.
- **Fields**: `id`, `workspaceId`, `memberId`, `notificationId`, `title`, `body`, `linkUrl`, `sourceEntity`, `sourceId`, `isRead` (default false), `readAt`, `isArchived` (default false), `archivedAt`, `createdAt`, `updatedAt`.
- **Constraints & Indexes**:
  - `@@index([workspaceId, memberId, isRead, isArchived])`
  - `@@index([workspaceId, memberId, createdAt])`
- **Relations**: `workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)`

---

## 4. Workspace Inverse Relations

The `Workspace` model in [`prisma/schema.prisma`](file:///d:/Download/aforden/prisma/schema.prisma#L482-L488) was updated to include inverse relation fields:

```prisma
  notificationOutboxes         NotificationOutbox[]
  notifications                Notification[]
  notificationDeliveries       NotificationDelivery[]
  notificationTemplates        NotificationTemplate[]
  notificationPreferences      NotificationPreference[]
  notificationLogs             NotificationLog[]
  inAppNotificationFeeds       InAppNotificationFeed[]
```

---

## 5. Migration Execution & Verification

### 5.1 Migration Generation & Application
The migration was created and applied cleanly against the PostgreSQL database:
- **Migration Directory**: `prisma/migrations/20260825100939_add_notifications_communications_domain/`
- **Migration SQL**: `migration.sql`
- **Exit Code**: `0`

### 5.2 Prisma Client Regeneration
- Executed `npx prisma generate`
- Generated Prisma Client (7.9.1) to `generated/prisma` in 1.10s.

### 5.3 TypeScript Compilation Check
- Executed `npx tsc --noEmit` across the entire codebase.
- **Result**: Zero errors (`0` exit code), confirming full type safety and zero breaking changes across all existing domain modules.

### 5.4 Test Suite Verification
- Executed `npx vitest run`.
- **Result**: 181/181 test files passed (3,346 tests passed).

---

## 6. Disclosures

1. **Schema Integrity**: Exactly matched Section 17 of the locked Phase 1.13.1 specification, including the two audit corrections (`NotificationOutboxStatus` enum and `NotificationOutbox.dedupeKey` with `@@unique([workspaceId, dedupeKey])`). No extra fields, tables, or unapproved constraints were added.
2. **Migration Naming**: Followed the exact naming convention from prior domain migrations (`add_notifications_communications_domain`).
3. **Migration Artifact**: Applied cleanly as `20260825100939_add_notifications_communications_domain`.
