# Phase 1.12.10 — Payment Services & Balance Reconciliation Walkthrough

## Overview

This walkthrough documents **Phase 1.12.10: Payment Services & Balance Reconciliation**, implementing:
- `recordPayment(workspaceId, invoiceId, payload, actor)`
- `voidPayment(workspaceId, paymentId, reason, actor)`
- Server-authoritative payment ledger balance reconciliation for `Invoice.amountPaid`, `Invoice.amountDue`, and state machine transitions.

---

## 1. Locked Architecture References (Phase 1.12.1 §5.5 & §6.2.C)

### §5.5 Execution Sequence for `recordPayment`
```markdown
1. Authentication & RBAC Guard:
   - Assert that actor possesses the payments.create permission in workspaceId.
   - If not authorized -> throw AuthorizationError (HTTP 403).
2. Existence & Tenant Isolation Guard:
   - Query Invoice by (workspaceId, invoiceId).
   - If not found in the tenant workspace -> throw InvoiceNotFoundError (HTTP 404).
3. Payload Syntactic & Amount Validation Guard:
   - Assert payload.amount is a valid Decimal number with <= 2 decimal places.
   - Assert payload.amount > 0.00. If amount <= 0.00 or NaN -> throw InvalidPaymentAmountError (HTTP 422).
   - Assert payload.paymentMethod is a valid PaymentMethod enum value.
4. Terminal & Non-Payable Status Guards (Strict Hierarchical Order):
   - Step 4a (VOID Check): If invoice.status === VOID -> throw InvoiceAlreadyVoidedError (HTTP 409).
   - Step 4b (DRAFT Check): If invoice.status === DRAFT -> throw InvoiceStatusConflictError (HTTP 409).
   - Step 4c (PAID Check): If invoice.status === PAID -> throw InvoiceAlreadyPaidError (HTTP 409).
5. Payable State Affirmation:
   - Status must be strictly one of ISSUED, PARTIALLY_PAID, or OVERDUE.
6. Balance & Overpayment Guard:
   - Evaluate whether payload.amount > invoice.amountDue. If true -> throw OverpaymentNotAllowedError (HTTP 422).
7. Atomic Execution & State Transition (inside Prisma $transaction):
   - Generate unique paymentNumber (PAY-YYYY-XXXXXX).
   - Create Payment record with status: RECORDED, currencyCode = invoice.currencyCode, recordedByMemberId = actor.id.
   - Calculate updated totals:
     - newAmountPaid = invoice.amountPaid + payload.amount
     - newAmountDue = invoice.total - newAmountPaid
   - Determine new InvoiceStatus:
     - If newAmountDue == 0.00 -> newStatus = PAID, paidAt = now()
     - If newAmountDue > 0.00 -> newStatus = PARTIALLY_PAID, paidAt = null
   - Update Invoice: amountPaid = newAmountPaid, amountDue = newAmountDue, status = newStatus, paidAt = paidAt.
   - Append InvoiceHistory event: eventType = PAYMENT_APPLIED.
   - Return PaymentReadModel.
```

### §6.2.C Execution Sequence for `voidPayment`
```markdown
1. RBAC Guard: Assert payments.void permission.
2. Existence Guard: Fetch Payment with its Invoice. If not found -> throw PaymentNotFoundError (404).
3. Void Reason Guard: Assert payload.voidReason is non-empty string. If empty -> throw MissingVoidReasonError (HTTP 422).
4. Already Voided Guard: If payment.status === VOIDED -> throw PaymentAlreadyVoidedError (HTTP 409).
5. Execution (in $transaction):
   - Update Payment: status = VOIDED, voidedAt = now(), voidedByMemberId = actor.id, voidReason = payload.voidReason.
   - Recalculate remaining active amountPaid = sum(RECORDED payments).
   - Recalculate amountDue = invoice.total - amountPaid.
   - Determine new InvoiceStatus:
     - If amountPaid == 0.00 and now() > invoice.dueDate -> OVERDUE
     - If amountPaid == 0.00 and now() <= invoice.dueDate -> ISSUED
     - If amountPaid > 0.00 and now() > invoice.dueDate -> OVERDUE
     - If amountPaid > 0.00 and now() <= invoice.dueDate -> PARTIALLY_PAID
   - Update Invoice: amountPaid, amountDue, status = newStatus, paidAt = null.
   - Log InvoiceHistory event PAYMENT_VOIDED.
```

---

## 2. Implemented Services

### A. [`recordPayment.ts`](file:///d:/Download/aforden/lib/services/invoice/recordPayment.ts)
- **AUTH & RBAC**: Asserts `PERMISSIONS.PAYMENTS_CREATE` (`payments.create`).
- **VALIDATION**: Validates payload with `recordPaymentSchema`; verifies positive amount with at most 2 decimals (`InvalidPaymentAmountError`).
- **EXISTENCE**: Resolves `Invoice` with its associated payments ledger in workspace; throws `InvoiceNotFoundError` if absent.
- **HIERARCHICAL STATUS GUARDS**:
  - `VOID` -> `InvoiceAlreadyVoidedError` (409)
  - `DRAFT` -> `InvoiceStatusConflictError` (409)
  - `PAID` -> `InvoiceAlreadyPaidError` (409)
- **PAYABLE AFFIRMATION**: Enforces status strictly in `["ISSUED", "PARTIALLY_PAID", "OVERDUE"]`.
- **LEDGER RECONCILIATION & OVERPAYMENT**: Sums active `RECORDED` payments from DB; rejects amounts exceeding remaining `amountDue` (`OverpaymentNotAllowedError`).
- **PERSISTENCE**: Atomic `$transaction` generating sequential `PAY-YYYY-XXXXXX` number, creating `Payment`, updating `Invoice` (`amountPaid`, `amountDue`, `status`, `paidAt`), and writing `InvoiceHistory` (`PAYMENT_APPLIED`).

### B. [`voidPayment.ts`](file:///d:/Download/aforden/lib/services/invoice/voidPayment.ts)
- **AUTH & RBAC**: Asserts `PERMISSIONS.PAYMENTS_VOID` (`payments.void`).
- **REASON GUARD**: Pre-DB validation requiring non-empty trimmed reason (`MissingVoidReasonError`).
- **EXISTENCE & RESOLUTION**: Fetches `Payment` with parent `Invoice` and payments ledger; throws `PaymentNotFoundError` (404).
- **ALREADY VOIDED GUARD**: `payment.status === "VOIDED"` -> `PaymentAlreadyVoidedError` (409).
- **PARENT INVOICE VOID GUARD**: `payment.invoice.status === "VOID"` -> `InvoiceAlreadyVoidedError` (409).
- **RECONCILIATION & REVERSION**: Recomputes remaining active payments, derives new balance due, and sets status:
  - `amountPaid == 0`: `OVERDUE` if past due, else `ISSUED`.
  - `amountPaid > 0`: `OVERDUE` if past due, else `PARTIALLY_PAID`.
  - `paidAt = null`.
- **PERSISTENCE**: Atomic `$transaction` updating `Payment` (`status: VOIDED`, `voidedAt`, `voidedByMemberId`, `voidReason`), updating parent `Invoice`, and writing `InvoiceHistory` (`PAYMENT_VOIDED`).

---

## 3. Verification Results

### Payment Test Suite (`tests/invoice/invoice-payment-services.test.ts`)
26/26 tests passed across all scenarios.

### All Invoicing Tests (`tests/invoice/`)
211/211 tests passed across 8 test suites.

### Full Regression Suite
- **178 test files passed (178)**
- **3,287 tests passed (3,287)**
