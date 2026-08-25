# Phase 1.12.4 — Invoicing Calculation Engine & Snapshot Helpers Walkthrough

## Overview & Executive Summary

This walkthrough document validates the implementation of **Phase 1.12.4: Calculation Engine & Snapshot Helpers** for the Invoicing & Payments domain.

- **Calculation Engine**: [`lib/services/invoice/invoiceCalculationEngine.ts`](file:///d:/Download/aforden/lib/services/invoice/invoiceCalculationEngine.ts)
- **Snapshot Helpers**: [`lib/services/invoice/invoiceSnapshots.ts`](file:///d:/Download/aforden/lib/services/invoice/invoiceSnapshots.ts)
- **Unit Test Suite**: [`tests/invoice/invoice-calculation-engine.test.ts`](file:///d:/Download/aforden/tests/invoice/invoice-calculation-engine.test.ts)

---

## Architectural Decision Disclosure: Domain Isolation vs. Shared Math Utility

### 1. Decision: Explicit Domain-Isolated Implementation with Dual Maintainer Notices
Rather than coupling the Quotes and Invoicing domains via a cross-domain shared calculation utility, we opted for **domain-isolated implementations** of the core calculation engines (`quoteCalculationEngine.ts` and `invoiceCalculationEngine.ts`).

#### Justification for Domain Isolation:
1. **Clean Domain Boundaries**: The Invoicing domain owns its independent state machine, types, and financial models (including Step 7 payment balance reconciliation), while the Quotes domain owns proposal conversion and expiry models.
2. **Domain-Specific Error Classes**: The calculation engines throw domain-specific pure error classes (`InvalidInvoiceCalculationError` vs `InvalidQuoteCalculationError`) without polymorphic indirection or leaky abstractions.
3. **Future Independent Evolution**: If Invoicing requirements diverge in future phases (e.g., adding line-level payment allocations, multi-tax jurisdictions, or credit memo deductions), the Invoicing engine can evolve without risking regressions in Quotes proposals.

### 2. Proof of Mathematical & Algorithmic Parity (Side-by-Side Comparison)

Below is the side-by-side verification confirming that `invoiceCalculationEngine.ts` is byte-for-byte and algorithmically consistent with `quoteCalculationEngine.ts` for Steps 1 through 6:

```
+-------------------------------------------------------------+-------------------------------------------------------------+
| quoteCalculationEngine.ts (Steps 1–6)                       | invoiceCalculationEngine.ts (Steps 1–6)                     |
+-------------------------------------------------------------+-------------------------------------------------------------+
| // Step 1: Base Subtotal & Negative Rejection               | // Step 1: Base Subtotal & Negative Rejection               |
| rawGross = round2(quantity.mul(unitPrice))                  | rawGross = round2(quantity.mul(unitPrice))                  |
| lineBaseSubtotal = round2(rawGross.sub(lineDiscountAmount)) | lineBaseSubtotal = round2(rawGross.sub(lineDiscountAmount)) |
| if (lineBaseSubtotal.isNegative())                          | if (lineBaseSubtotal.isNegative())                          |
|   throw new InvalidQuoteCalculationError(...)               |   throw new InvalidInvoiceCalculationError(...)             |
|                                                             |                                                             |
| // Step 2: Gross Subtotal                                   | // Step 2: Gross Subtotal                                   |
| grossSubtotal = lines.reduce(sum.add, ZERO_2DP)             | grossSubtotal = lines.reduce(sum.add, ZERO_2DP)             |
|                                                             |                                                             |
| // Step 3: Header Discount Calculation                      | // Step 3: Header Discount Calculation                      |
| if (discountType === "PERCENTAGE")                          | if (discountType === "PERCENTAGE")                          |
|   rawDiscount = grossSubtotal.mul(val).div(100)             |   rawDiscount = grossSubtotal.mul(val).div(100)             |
|   discountAmount = round2(rawDiscount)                      |   discountAmount = round2(rawDiscount)                      |
| else discountAmount = val                                   | else discountAmount = val                                   |
| if (discountAmount.greaterThan(grossSubtotal))              | if (discountAmount.greaterThan(grossSubtotal))              |
|   discountAmount = grossSubtotal                            |   discountAmount = grossSubtotal                            |
|                                                             |                                                             |
| // Step 4: Proportional Allocation & Penny Remainder        | // Step 4: Proportional Allocation & Penny Remainder        |
| rawAlloc = discountAmount.mul(lineSubtotal).div(grossSub)   | rawAlloc = discountAmount.mul(lineSubtotal).div(grossSub)   |
| lineAlloc = floor2(rawAlloc)                                | lineAlloc = floor2(rawAlloc)                                |
| remainder = discountAmount.sub(sumAllocated)                | remainder = discountAmount.sub(sumAllocated)                |
| candidateIndex = findRemainderCandidateIndex(...)           | candidateIndex = findRemainderCandidateIndex(...)           |
| if (i === candidateIndex && remainder.isPositive())        | if (i === candidateIndex && remainder.isPositive())        |
|   finalAlloc = finalAlloc.add(remainder)                    |   finalAlloc = finalAlloc.add(remainder)                    |
| lineNet = round2(lineBaseSubtotal.sub(finalAlloc))          | lineNet = round2(lineBaseSubtotal.sub(finalAlloc))          |
|                                                             |                                                             |
| // Step 5: Line Tax & Total                                 | // Step 5: Line Tax & Total                                 |
| taxAmount = round2(lineNet.mul(taxRate))                    | taxAmount = round2(lineNet.mul(taxRate))                    |
| total = round2(lineNet.add(taxAmount))                      | total = round2(lineNet.add(taxAmount))                      |
|                                                             |                                                             |
| // Step 6: Header Aggregation                               | // Step 6: Header Aggregation                               |
| headerTax = lines.reduce(sum.add, ZERO_2DP)                 | headerTax = lines.reduce(sum.add, ZERO_2DP)                 |
| headerTotal = lines.reduce(sum.add, ZERO_2DP)               | headerTotal = lines.reduce(sum.add, ZERO_2DP)               |
+-------------------------------------------------------------+-------------------------------------------------------------+
```

### 3. Maintainer Cross-Referencing Notices
To prevent future formula drift where a bug fix is applied to one engine and missed in the other, both files contain explicit maintainer headers:

- In [`lib/services/quote/quoteCalculationEngine.ts`](file:///d:/Download/aforden/lib/services/quote/quoteCalculationEngine.ts#L15-L20):
  ```typescript
  /**
   * NOTE TO MAINTAINERS [FORMULA SYNCHRONIZATION]:
   * The mathematical formula and proration logic in Steps 1-6 are intentionally mirrored
   * in `lib/services/invoice/invoiceCalculationEngine.ts`. Any formula modifications, rounding
   * adjustments, or tie-break refinements made here MUST be synchronized with the Invoice engine.
   */
  ```

- In [`lib/services/invoice/invoiceCalculationEngine.ts`](file:///d:/Download/aforden/lib/services/invoice/invoiceCalculationEngine.ts#L17-L23):
  ```typescript
  /**
   * NOTE TO MAINTAINERS [FORMULA SYNCHRONIZATION]:
   * The mathematical formula and proration logic in Steps 1-6 are intentionally mirrored
   * from `lib/services/quote/quoteCalculationEngine.ts` to preserve total domain isolation.
   * Any formula modifications, rounding adjustments, or tie-break refinements made here MUST
   * be synchronized with the Quotes engine (and vice-versa).
   */
  ```

---

## Canonical 7-Step Server-Side Calculation Engine

1. **Step 1 — Per-Line Base Subtotal & Negative Guard**:
   - $\text{LineBaseSubtotal}_i = (\text{Quantity}_i \times \text{UnitPrice}_i) - \text{LineDiscountAmount}_i$.
   - Rejects (does not clamp) any negative subtotal by throwing `InvalidInvoiceCalculationError`.
2. **Step 2 — Invoice Gross Subtotal**:
   - $\text{InvoiceSubtotal} = \sum \text{LineBaseSubtotal}_i$.
3. **Step 3 — Invoice Header Discount Calculation**:
   - `PERCENTAGE`: $\text{round}(\text{InvoiceSubtotal} \times \text{DiscountValue} / 100, 2)$.
   - `FIXED`: $\min(\text{DiscountValue}, \text{InvoiceSubtotal})$.
4. **Step 4 — Proportional Per-Line Discount Allocation & Penny Reconciliation**:
   - Proportional allocation: $\text{floor}(\text{InvoiceDiscountAmount} \times (\text{LineBaseSubtotal}_i / \text{InvoiceSubtotal}), 2)$.
   - Remainder delta applied to the line with largest $\text{LineBaseSubtotal}$.
   - Deterministic tie-breaking: lowest `sortOrder` $\rightarrow$ lowest `id` (lexicographical) $\rightarrow$ lowest array index.
5. **Step 5 — Per-Line Tax & Total Calculation**:
   - $\text{LineNetBase}_i = \text{LineBaseSubtotal}_i - \text{LineAllocatedDiscount}_i$.
   - $\text{LineTaxAmount}_i = \text{round}(\text{LineNetBase}_i \times \text{taxRate}_i, 2)$.
   - $\text{LineTotal}_i = \text{LineNetBase}_i + \text{LineTaxAmount}_i$.
6. **Step 6 — Authoritative Header Aggregation**:
   - $\text{taxAmount} = \sum \text{LineTaxAmount}_i$.
   - $\text{total} = \sum \text{LineTotal}_i$.
7. **Step 7 — Payment Balance Reconciliation**:
   - $\text{amountPaid} = \sum \text{Payment.amount} \quad (\text{status} = \text{RECORDED})$.
   - $\text{amountDue} = \max(0.00, \text{total} - \text{amountPaid})$.
   - `VOIDED` payments are strictly excluded from $\text{amountPaid}$.

---

## Independent Snapshot Helpers

- **`snapshotLineItemsFromQuote(quoteLineItems)`**:
  - Pure function taking already-fetched `QuoteLineItem` records and deep-copying each field (`name`, `description`, `workTypeId`, `partId`, `workTypeName`, `workTypeCode`, `partName`, `partSku`, `partUnitOfMeasure`, `quantity`, `unitPrice`, `unitCost`, `discountAmount`, `taxRate`, `sortOrder`).
  - Zero shared references to source objects.
- **`snapshotLineItemsFromWorkOrder(workOrder)`**:
  - Pure function deriving `LABOR` line item from WorkOrder's `workType` (billable hours / estimated duration, standard rate) and `PART` line items from consumed parts (`partSku`, `partUnitOfMeasure`, `unitCostAtTimeOfUse`, `unitPrice`).
- **Catalog Resolvers (`resolveInvoiceWorkTypeSnapshot`, `resolveInvoicePartSnapshot`, `resolveStandaloneLineItemSnapshot`)**:
  - Pure read-only resolvers capturing catalog metadata into frozen snapshot fields.

---

## Verification Results

1. **TypeScript Typecheck**:
   ```bash
   npx tsc --noEmit
   # Result: 0 errors
   ```

2. **Unit Test Suite (`tests/invoice/invoice-calculation-engine.test.ts`)**:
   ```bash
   npx vitest run tests/invoice/invoice-calculation-engine.test.ts
   # Result: 14 passed (14)
   ```

3. **Invoicing Test Suite (`tests/invoice/`)**:
   ```bash
   npx vitest run tests/invoice/
   # Result: 2 passed (74 tests passed)
   ```

4. **Full Regression Suite**:
   ```bash
   npm run test
   # Result:
   # Test Files  172 passed (172)
   # Tests       3150 passed (3150)
   ```

---

## Self-Audit Checklist

| # | Requirement | Status |
| :-: | :--- | :-: |
| **1** | Server-side calculation engine implements exact 7-step formula (no I/O) | ✅ Passed |
| **2** | Explicit decision on domain duplication disclosed with side-by-side parity proof | ✅ Passed |
| **3** | Cross-referencing maintainer comments added to both calculation engine files | ✅ Passed |
| **4** | Step 1 negative-subtotal rejection throws `InvalidInvoiceCalculationError` | ✅ Passed |
| **5** | Header discount calculation (`PERCENTAGE` / `FIXED`) capped at subtotal | ✅ Passed |
| **6** | Proportional discount allocation with exact penny reconciliation | ✅ Passed |
| **7** | Deterministic tie-breaking (largest subtotal $\rightarrow$ lowest sortOrder $\rightarrow$ lowest id $\rightarrow$ array index) | ✅ Passed |
| **8** | Payment balance reconciliation (`amountPaid` = sum of `RECORDED`, `amountDue` = $\max(0, \text{total} - \text{amountPaid})$) | ✅ Passed |
| **9** | `VOIDED` payments strictly excluded from `amountPaid` calculation | ✅ Passed |
| **10** | `snapshotLineItemsFromQuote` deep-copies and freezes all fields without retaining source references | ✅ Passed |
| **11** | `snapshotLineItemsFromWorkOrder` derives `LABOR` and `PART` lines per 1.12.1 §2.2 rules | ✅ Passed |
| **12** | Catalog freeze helpers for standalone line creation | ✅ Passed |
| **13** | TypeScript compilation `npx tsc --noEmit` returns 0 errors | ✅ Passed |
| **14** | Full test suite green (172 test files, 3,150 tests passing) | ✅ Passed |
