# Phase 1.13.3 — Notifications & Communications Domain Types, Errors & Validation Schemas Walkthrough

> **Milestone Status**: COMPLETE & VERIFIED  
> **Sub-Phase Deliverable**: Pure Error Classes (Convention B), Event Catalog Registry, Domain DTOs/Types, Zod Schemas & Unit Test Suite  
> **Test Results**: 182/182 test files passed (3,357 tests passed)  
> **TypeScript Compilation**: `tsc --noEmit` passed with 0 errors  

---

## 1. Milestone Overview

Phase 1.13.3 establishes the compile-time contracts, runtime validation boundaries, error taxonomies, and the centralized event catalog registry for the **Notifications & Communications** domain in Aforden.

No service or emission logic was implemented in this phase, preserving clean domain separation in preparation for the recipient resolution and preferences engine in Phase 1.13.4.

---

## 2. Key Components Delivered

### 2.1 Pure Domain Error Classes (Convention B)
Implemented in [`lib/services/notification/notificationErrors.ts`](file:///d:/Download/aforden/lib/services/notification/notificationErrors.ts) matching the architectural precedent from Invoicing and Quotes:

| Error Class | Code | HTTP Status | Description |
| :--- | :--- | :--- | :--- |
| `NotificationNotFoundError` | `NOTIFICATION_NOT_FOUND` | 404 | Notification record not found in workspace |
| `NotificationDeliveryNotFoundError` | `NOTIFICATION_DELIVERY_NOT_FOUND` | 404 | Notification delivery record not found |
| `NotificationTemplateNotFoundError` | `NOTIFICATION_TEMPLATE_NOT_FOUND` | 404 | Custom template not found |
| `NotificationPreferenceNotFoundError` | `NOTIFICATION_PREFERENCE_NOT_FOUND` | 404 | Preference rule record not found |
| `InvalidNotificationEventType` | `INVALID_NOTIFICATION_EVENT_TYPE` | 400 | Event type not recognized in catalog |
| `InvalidNotificationChannelError` | `INVALID_NOTIFICATION_CHANNEL` | 400 | Channel not recognized or invalid |
| `DuplicateNotificationEventError` | `DUPLICATE_NOTIFICATION_EVENT` | 409 | Duplicate event detected by idempotency/dedupe key |
| `NotificationCrossTenantLeakageError` | `NOTIFICATION_CROSS_TENANT_LEAKAGE` | 403 | Recipient or entity belongs to another workspace |
| `NotificationActorUnauthorizedError` | `NOTIFICATION_ACTOR_UNAUTHORIZED` | 403 | Actor lacks required membership permissions |
| `NotificationPayloadValidationError` | `NOTIFICATION_PAYLOAD_VALIDATION_ERROR` | 422 | Event payload failed Zod schema validation |
| `NotificationTemplateCompilationError` | `NOTIFICATION_TEMPLATE_COMPILATION_ERROR` | 422 | Token interpolation syntax error or illegal token |
| `NotificationRecipientUnresolvableError` | `NOTIFICATION_RECIPIENT_UNRESOLVABLE` | 422 | Recipient missing destination (e.g. no email/phone) |
| `NotificationChannelDisabledError` | `NOTIFICATION_CHANNEL_DISABLED` | 422 | Channel disabled at workspace level |
| `NotificationDeliveryExhaustedError` | `NOTIFICATION_DELIVERY_EXHAUSTED` | 500 | Retry attempts exceeded maximum limit |
| `NotificationProviderUnavailableError` | `NOTIFICATION_PROVIDER_UNAVAILABLE` | 503 | Downstream provider (Resend, Twilio) unreachable |

---

### 2.2 Event Catalog Registry
Implemented in [`lib/services/notification/eventCatalogRegistry.ts`](file:///d:/Download/aforden/lib/services/notification/eventCatalogRegistry.ts) as a single extensible lookup map `EVENT_CATALOG_REGISTRY: Record<NotificationEventType, EventCatalogDefinition>`.

Every registered event provides:
- **`eventType`**: Canonical enum value
- **`domain`**: Originating operational domain (`WORK_ORDER`, `SCHEDULE`, `QUOTE`, `INVOICE`, `PAYMENT`)
- **`defaultChannels`**: Default delivery channels (`IN_APP`, `EMAIL`, `SMS`, `PUSH`)
- **`defaultRecipientTypes`**: Default target audience (`WORKSPACE_MEMBER`, `CUSTOMER_CONTACT`)
- **`isMandatoryTransactional`**: Compliance flag preventing user suppression
- **`payloadValidator`**: Specific Zod schema matching upstream entity fields
- **`variableWhitelist`**: Whitelist of token interpolation keys matching the schema
- **`description`**: Human-readable documentation for templates and audit logs

Helper methods exported:
- `getEventCatalogDefinition(eventType: NotificationEventType): EventCatalogDefinition`
- `validateEventPayload<T>(eventType: NotificationEventType, payload: unknown): T`
- `getEventVariableWhitelist(eventType: NotificationEventType): string[]`

---

### 2.3 Domain DTOs & Types
Implemented in [`lib/services/notification/notification.types.ts`](file:///d:/Download/aforden/lib/services/notification/notification.types.ts):
- **Event Ingestion Input**: `EmitNotificationEventInput<TPayload>` (with optional `dedupeKey` override)
- **Outbox Representation**: `NotificationOutboxRecordDTO`
- **Recipient Resolution**: `ResolvedRecipientDestination`
- **Delivery Transport Models**: `NotificationDeliveryInput`, `NotificationDeliveryResult`
- **API Read DTOs**: `NotificationSummaryDTO`, `NotificationDetailDTO`, `NotificationDeliveryDTO`, `NotificationLogDTO`, `InAppNotificationFeedItemDTO`, `NotificationTemplateDTO`, `NotificationPreferenceDTO`
- **Query DTOs**: `NotificationFeedQueryInput`, `NotificationLogQueryInput`

---

### 2.4 Zod Validation Schemas
Implemented in [`lib/services/notification/notification.schemas.ts`](file:///d:/Download/aforden/lib/services/notification/notification.schemas.ts):
- 24 individual event payload schemas (`workOrderCreatedPayloadSchema`, `invoiceSentPayloadSchema`, etc.)
- Ingestion envelope validation: `emitNotificationEnvelopeSchema`
- Preferences & Templates: `updateNotificationPreferenceSchema`, `createNotificationTemplateSchema`, `updateNotificationTemplateSchema`
- Feed & Log Queries: `queryNotificationFeedSchema`, `queryNotificationLogsSchema`

---

## 3. Disclosures

### 3.1 Mandatory Transactional Event Classification (`isMandatoryTransactional`)

The 24 event types were classified into **Mandatory Transactional** vs. **Informational/Operational** as follows:

| Event Type | `isMandatoryTransactional` | Rationale & Business Justification |
| :--- | :---: | :--- |
| `INVOICE_SENT` | **`true`** | **Legal & Financial Demand**: Legally binding tax invoice / demand for payment sent to customer. Cannot be suppressed by generic opt-out rules. |
| `INVOICE_OVERDUE` | **`true`** | **Debt Liability & Collection Alert**: Delinquent balance notification representing credit risk and contractual liability. |
| `PAYMENT_RECEIVED` | **`true`** | **Official Settlement & Receipt**: Legally binding receipt of funds and proof of transaction. |
| `PAYMENT_FAILED` | **`true`** | **Payment Default & Breach Notice**: Immediate operational risk of non-payment requiring urgent settlement action. |
| `WORK_ORDER_CREATED` | `false` | Internal operational status event; configurable per member. |
| `WORK_ORDER_ASSIGNED` | `false` | Operational dispatch notification; customizable by member channel preference. |
| `WORK_ORDER_REASSIGNED` | `false` | Operational dispatch notification; customizable by member channel preference. |
| `WORK_ORDER_UNASSIGNED` | `false` | Operational dispatch notification; customizable by member channel preference. |
| `WORK_ORDER_STATUS_CHANGED` | `false` | Informational operational transition; configurable per member. |
| `WORK_ORDER_STARTED` | `false` | Field progress update; informational. |
| `WORK_ORDER_PAUSED` | `false` | Field progress update; informational. |
| `WORK_ORDER_RESUMED` | `false` | Field progress update; informational. |
| `WORK_ORDER_COMPLETED` | `false` | Customer & member notification; informational resolution update. |
| `WORK_ORDER_CANCELLED` | `false` | Cancellation update; customizable by member/customer preference. |
| `SCHEDULE_APPOINTMENT_SCHEDULED` | `false` | Calendar appointment notice; customizable. |
| `SCHEDULE_APPOINTMENT_RESCHEDULED` | `false` | Calendar reschedule notice; customizable. |
| `SCHEDULE_DISPATCH_CHANGED` | `false` | Dispatch state update; customizable. |
| `SCHEDULE_APPOINTMENT_APPROACHING` | `false` | Courtesy reminder notice; opt-in/opt-out allowable. |
| `QUOTE_CREATED` | `false` | Internal commercial draft notification. |
| `QUOTE_SENT` | `false` | Commercial proposal; customer marketing/proposal preference applies. |
| `QUOTE_ACCEPTED` | `false` | Commercial conversion event; member notification. |
| `QUOTE_REJECTED` | `false` | Commercial rejection event; member notification. |
| `QUOTE_EXPIRED` | `false` | Commercial lifecycle expiry notice; member notification. |
| `INVOICE_CREATED` | `false` | Internal draft creation notice; member notification. |

---

### 3.2 Upstream Domain Field Compatibility

All 24 payload schemas were designed strictly against the actual fields present on existing domain models:
- **WorkOrder (Phase 1.6 & 1.9)**: Uses `workOrderId`, `workOrderNumber`, `title`, `customerId`, `customerName`, `priority`, `technicianId`, `technicianName`, `completedAt`, etc.
- **Scheduling (Phase 1.8)**: Uses `appointmentId`, `appointmentNumber`, `workOrderId`, `technicianId`, `scheduledStart`, `scheduledEnd`, `dispatchStatus`.
- **Quote (Phase 1.11)**: Uses `quoteId`, `quoteNumber`, `title`, `customerId`, `totalAmount`, `expirationDate`, `acceptedAt`, `rejectedAt`.
- **Invoice & Payment (Phase 1.12)**: Uses `invoiceId`, `invoiceNumber`, `title`, `customerId`, `totalAmount`, `dueDate`, `currencyCode`, `paymentId`, `paymentNumber`, `amount`, `paymentMethod`, `paymentDate`.

Optional fields (e.g. `customerEmail`, `technicianName`, `rejectionReason`) were marked `.optional()` in the Zod schemas so that event emitters in operational domains can provide them when known in-memory without incurring redundant database lookups.

---

## 4. Verification Results

1. **TypeScript Type Checking**:
   ```bash
   npx tsc --noEmit
   # Exit code: 0 (zero errors across full repository)
   ```

2. **Domain Unit Tests**:
   - Test File: [`tests/notification/notification-types-schemas-errors.test.ts`](file:///d:/Download/aforden/tests/notification/notification-types-schemas-errors.test.ts)
   - Verified: All 15 error classes, all 24 catalog entries, mandatory transactional rules, variable whitelists, payload validations, envelope schemas, preference schemas, template schemas, and query schemas.

3. **Full Regression Test Suite**:
   ```bash
   npx vitest run
   # Test Files: 182 passed (182)
   # Tests:      3,357 passed (3,357)
   ```
