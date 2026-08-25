# Phase 1.13.9 Walkthrough — Operational Domain Event Integrations

## Overview
Phase 1.13.9 connects the existing operational business domains (WorkOrder, Scheduling, Quote, Invoicing & Payments) to the Notifications & Communications domain via transactional outbox ingestion (`emitNotificationEvent(tx, ...)`).

All events execute strictly inside the operational mutation's existing database transaction, ensuring atomicity: if the operational mutation rolls back, no notification outbox record is written; if `emitNotificationEvent` fails, the operational mutation rolls back.

---

## 1. Event Integrations Matrix

| Domain | File | Event Type | Trigger | Transaction Scope | Actor Attributed |
|---|---|---|---|---|---|
| **WorkOrder** | `lib/services/workOrder/createWorkOrder.ts` | `WORK_ORDER_CREATED` | New work order created | Same internal transaction | Authenticated Member |
| **WorkOrder** | `lib/services/workOrder/assignWorkOrder.ts` | `WORK_ORDER_ASSIGNED` | Technician initial assignment | Same internal transaction | Authenticated Member |
| **WorkOrder** | `lib/services/workOrder/assignWorkOrder.ts` | `WORK_ORDER_REASSIGNED` | Technician reassigned | Same internal transaction | Authenticated Member |
| **WorkOrder** | `lib/services/workOrder/assignWorkOrder.ts` | `WORK_ORDER_UNASSIGNED` | Work order unassigned | Same internal transaction | Authenticated Member |
| **WorkOrder** | `lib/services/workOrder/transitionWorkOrderStatus.ts` | `WORK_ORDER_STARTED` | Transition to `IN_PROGRESS` | Same internal transaction | Authenticated Member |
| **WorkOrder** | `lib/services/workOrder/transitionWorkOrderStatus.ts` | `WORK_ORDER_PAUSED` | Transition to `ON_HOLD` | Same internal transaction | Authenticated Member |
| **WorkOrder** | `lib/services/workOrder/transitionWorkOrderStatus.ts` | `WORK_ORDER_RESUMED` | Transition from `ON_HOLD` to `IN_PROGRESS` | Same internal transaction | Authenticated Member |
| **WorkOrder** | `lib/services/workOrder/transitionWorkOrderStatus.ts` | `WORK_ORDER_COMPLETED` | Transition to `COMPLETED` | Same internal transaction | Authenticated Member |
| **WorkOrder** | `lib/services/workOrder/transitionWorkOrderStatus.ts` | `WORK_ORDER_CANCELLED` | Transition to `CANCELLED` | Same internal transaction | Authenticated Member |
| **WorkOrder** | `lib/services/workOrder/transitionWorkOrderStatus.ts` | `WORK_ORDER_STATUS_CHANGED` | Other status transitions | Same internal transaction | Authenticated Member |
| **Scheduling** | `lib/services/schedule/createSchedule.ts` | `SCHEDULE_APPOINTMENT_SCHEDULED` | Appointment booked | Same internal transaction | Authenticated Member |
| **Scheduling** | `lib/services/schedule/rescheduleSchedule.ts` | `SCHEDULE_APPOINTMENT_RESCHEDULED` | Appointment rescheduled | Same internal transaction | Authenticated Member |
| **Scheduling** | `lib/services/schedule/dispatchAppointment.ts` | `SCHEDULE_DISPATCH_CHANGED` | Status updated to `DISPATCHED` | Same internal transaction | Authenticated Member |
| **Scheduling** | `lib/services/schedule/undispatchAppointment.ts` | `SCHEDULE_DISPATCH_CHANGED` | Status recalled to `PENDING_DISPATCH` | Same internal transaction | Authenticated Member |
| **Scheduling** | `lib/services/schedule/acknowledgeDispatch.ts` | `SCHEDULE_DISPATCH_CHANGED` | Status updated to `ACKNOWLEDGED` | Same internal transaction | Authenticated Member |
| **Quote** | `lib/services/quote/createQuote.ts` | `QUOTE_CREATED` | Quote draft created | Same internal transaction | Authenticated Member |
| **Quote** | `lib/services/quote/sendQuote.ts` | `QUOTE_SENT` | Quote sent to customer | Same internal transaction | Authenticated Member |
| **Quote** | `lib/services/quote/approveQuote.ts` | `QUOTE_ACCEPTED` | Quote approved by customer | Same internal transaction | Authenticated Member |
| **Quote** | `lib/services/quote/rejectQuote.ts` | `QUOTE_REJECTED` | Quote rejected | Same internal transaction | Authenticated Member |
| **Quote** | `lib/services/quote/evaluateQuoteExpiration.ts` | `QUOTE_EXPIRED` | Quote expired (automated evaluation) | Same internal transaction | System (`null`) |
| **Invoice** | `lib/services/invoice/createInvoice.ts` | `INVOICE_CREATED` | Standalone invoice created | Same internal transaction | Authenticated Member |
| **Invoice** | `lib/services/invoice/createInvoiceFromQuote.ts` | `INVOICE_CREATED` | Invoice converted from quote | Same internal transaction | Authenticated Member |
| **Invoice** | `lib/services/invoice/createInvoiceFromWorkOrder.ts` | `INVOICE_CREATED` | Invoice converted from work order | Same internal transaction | Authenticated Member |
| **Invoice** | `lib/services/invoice/issueInvoice.ts` | `INVOICE_SENT` | Invoice issued to customer | Same internal transaction | Authenticated Member |
| **Invoice** | `lib/services/invoice/evaluateInvoiceOverdue.ts` | `INVOICE_OVERDUE` | Invoice overdue (automated evaluation) | Same internal transaction | System (`null`) |
| **Invoice** | `lib/services/invoice/recordPayment.ts` | `PAYMENT_RECEIVED` | Payment recorded against invoice | Same internal transaction | Authenticated Member |

---

## 2. Invariants & Guarantees Verified

1. **Transactional Invariant**:
   - `emitNotificationEvent(tx, ...)` writes to `NotificationOutbox` using the operational method's existing transaction client `tx`.
   - If `emitNotificationEvent` throws (e.g. disk failure or outbox validation crash), the entire operational mutation aborts and does not commit.
2. **Actor Attribution**:
   - For interactive mutations, `actorMemberId` is derived exclusively from the verified session membership (`authorization.membership.id`).
   - For batch/system cron mutations (`evaluateQuoteExpiration`, `evaluateInvoiceOverdue`), `actorMemberId` is explicitly set to `null`.
3. **Payload Contract Conformity**:
   - All emitted payloads conform directly to the Zod schemas in `notification.schemas.ts` and `eventCatalogRegistry.ts`.
4. **Zero Operational Regressions**:
   - All 42 preexisting test suites across WorkOrder (10 files), Scheduling (12 files), Quote (9 files), and Invoice (11 files) continue to pass 100% cleanly without modification to original test assertions.

---

## 3. Disclosures & Unwired Events

The following time-based / external events are defined in the catalog but are not wired to interactive user mutations:
- `SCHEDULE_APPOINTMENT_APPROACHING`: Requires a time-based reminder cron worker (scheduled for Phase 1.16).
- `PAYMENT_FAILED`: Triggered when third-party payment gateway webhooks (e.g., Stripe/Square) reject a charge (scheduled for future payment gateway adapter work).

---

## 4. Verification Results

- **TypeScript Compilation**: `npx tsc --noEmit` -> **0 errors**
- **Operational Domains Regression**: `tests/work-order/`, `tests/schedule/`, `tests/quote/`, `tests/invoice/` -> **42 test files, 916 tests passed**
- **New Integration Test Suite**: `tests/notification/operational-domain-event-integrations.test.ts` -> **9 tests passed**
- **Full Platform Test Suite**: `npx vitest run` -> **188 test files, 3,444 tests passed (100% pass rate)**
