# Phase 1.12.1 — Invoicing & Payments Domain Architecture & Specification

> **Document Status**: LOCKED FOR IMPLEMENTATION (Phase 1.12 Architecture Standard)  
> **Domain**: Invoices, Invoice Line Items, Pricing & Cost Snapshots, Payment Recording, Balance Reconciliation, Invoice Lifecycle State Machine, Payment Lifecycle, Commercial & Financial RBAC  
> **Dependencies**: Phase 1.1 (Multi-Tenancy & Workspace Partitioning), Phase 1.2 (Authentication & RBAC), Phase 1.3 (Technicians & Organization), Phase 1.4 (Customers & Service Locations), Phase 1.5 (Service Catalog & Work Types), Phase 1.6 (Work Orders), Phase 1.7 (Assets & Equipment), Phase 1.8 (Scheduling & Dispatch), Phase 1.9 (Technician Operations), Phase 1.10 (Inventory & Parts), Phase 1.11 (Quotes & Estimates)  
> **Target Schema & Service Implementation**: Phase 1.12.2+

---

## Executive Summary

Phase 1.12 introduces the **Invoicing & Payments** domain to the Aforden Field Service Management (FSM) platform. Through Phase 1.11, Aforden established pre-work proposals (Quotes), field operational execution (Work Orders), mobile technician execution, and parts stock ledgers (Inventory).

Phase 1.12 establishes the commercial realization layer: demanding payment for work performed or goods provided, tracking customer financial liabilities, and recording settlement transactions. An invoice in Aforden is a **legally binding financial and tax instrument**. It may originate from an approved **Quote** (Phase 1.11), a completed **WorkOrder** (Phase 1.6), or be generated **standalone** for ad-hoc customer billing.

This document serves as the binding architectural contract for Phase 1.12. It establishes:
1. Strict domain boundaries separating Invoicing (Accounts Receivable billing) from Quotes (pre-work proposals), Work Orders (operational execution), Live Inventory (stock movements), and downstream accounting domains (General Ledger, AP, Payroll, Subscription Billing).
2. The core data models (`Invoice`, `InvoiceLineItem`, `Payment`, `InvoiceHistory`, and relation linkages on `Quote`, `WorkOrder`, `Customer`, `Workspace`, and `WorkspaceMember`).
3. The **independent financial snapshot layer** that guarantees invoice line items, pricing, tax rates, and historical costs remain permanently immutable even if source Quotes, WorkOrders, Service Catalogs, or Parts are modified or deleted.
4. Deterministic, bidirectional provenance rules between Invoices, Quotes, and WorkOrders.
5. The **server-authoritative monetary calculation engine** with line-level tax calculation, header discount proration, and deterministic penny-rounding reconciliation.
6. The **stored-and-reconciled payment aggregate model**, enforcing row-level consistency, transactional balance updates (`amountPaid`, `amountDue`), strict overpayment guards, and exact guard-precedence sequences.
7. The **invoice lifecycle state machine** (`DRAFT` → `ISSUED` → `PARTIALLY_PAID` → `PAID` / `OVERDUE` / `VOID`) and **payment lifecycle state machine** (`RECORDED` → `VOIDED`).
8. Complete commercial and financial RBAC specifications, including strict isolation of field technicians from accounts receivable and billing data.
9. Full domain error taxonomy following Convention B, REST API contracts, and explicit disclosures of all roadmap terminology evolutions.
10. The complete 13-stage implementation roadmap for Phase 1.12 (1.12.1 through 1.12.13).

---

```
+---------------------------------------------------------------------------------------------------+
|                                        WORKSPACE (Tenant)                                         |
|                                                                                                   |
|   +-----------------------+       +------------------------+       +--------------------------+   |
|   |       CUSTOMER        |       |    SERVICE LOCATION    |       |     ASSET / EQUIPMENT    |   |
|   |      (Phase 1.4)      |       |      (Phase 1.4)       |       |       (Phase 1.7)        |   |
|   +-----------+-----------+       +-----------+------------+       +--------------------------+   |
|               |                               |                                                   |
|               +-----------------------+       |                                                   |
|                                       |       |                                                   |
|                                       v       v                                                   |
|   +-------------------------------------------------------------------------------------------+   |
|   |   SOURCE ENTITIES (Commercial & Operational Provenance)                                   |   |
|   |                                                                                           |   |
|   |   +------------------------------------+         +------------------------------------+   |   |
|   |   |           QUOTE (1.11)             |         |          WORK ORDER (1.6)          |   |   |
|   |   |  - Status: APPROVED / CONVERTED    |         |  - Status: COMPLETED               |   |   |
|   |   |  - QuoteLineItems (Labor/Parts)    |         |  - WorkOrderParts + Labor Tasks    |   |   |
|   |   +-----------------+------------------+         +-----------------+------------------+   |   |
|   +---------------------|----------------------------------------------|----------------------+   |
|                         | createInvoiceFromQuote()                     | createInvoiceFromWO()    |
|                         | (Independent Re-Snapshot)                    | (Independent Re-Snapshot)|
|                         +----------------------+-----------------------+                          |
|                                                |                                                  |
|                                                v                                                  |
|   =============================================================================================   |
|   |                              INVOICING & PAYMENTS DOMAIN                                  |   |
|   |                                      (Phase 1.12)                                         |   |
|   |                                                                                           |   |
|   |   +-----------------------------------------------------------------------------------+   |   |
|   |   |                                     INVOICE                                       |   |   |
|   |   |  - invoiceNumber, currencyCode (snapshotted), customerId, locationId              |   |   |
|   |   |  - quoteId (Nullable FK), workOrderId (Nullable FK)                               |   |   |
|   |   |  - issueDate, dueDate, status: DRAFT | ISSUED | PARTIALLY_PAID | PAID | OVERDUE   |   |   |
|   |   |  - subtotal, discount, taxAmount, total (Authoritative Decimal)                   |   |   |
|   |   |  - amountPaid, amountDue (Server-Reconciled Decimal)                              |   |   |
|   |   +-----------------------------------------------------------------------------------+   |   |
|   |            |                                           |                    |             |   |
|   |            | 1:N                                       | 1:N                | 1:N         |   |
|   |            v                                           v                    v             |   |
|   |   +-------------------------------+   +--------------------+   +----------------------+   |   |
|   |   |        InvoiceLineItem        |   |      Payment       |   |    InvoiceHistory    |   |   |
|   |   |  - type: LABOR | PART | ...   |   |  - paymentNumber   |   |  - CREATED, ISSUED,  |   |   |
|   |   |  - quantity, unitPrice, tax   |   |  - amount, method  |   |    PAYMENT_APPLIED,  |   |   |
|   |   |  - Independent Snapshots:     |   |  - status:         |   |    PAYMENT_VOIDED,   |   |   |
|   |   |    name, sku, uom, unitCost   |   |    RECORDED|VOIDED |   |    OVERDUE, VOIDED   |   |   |
|   |   +-------------------------------+   +--------------------+   +----------------------+   |   |
|   =============================================================================================   |
+---------------------------------------------------------------------------------------------------+
```

---

## 1. Domain Boundary & Ownership Matrix

### 1.1 Strict Domain Ownership Rules

| Domain | Owns | Does NOT Own / Consumes |
| :--- | :--- | :--- |
| **Invoicing & Payments** (Phase 1.12) | `Invoice` entity, `InvoiceLineItem` entity, `Payment` entity, `InvoiceHistory` audit ledger, independent line-item pricing snapshots, server-side monetary calculation engine, balance reconciliation (`amountPaid`, `amountDue`), invoice lifecycle state machine, payment lifecycle state machine, overpayment validation guards, and Accounts Receivable (AR) reporting queries. | Does **NOT** own Quote proposals (Phase 1.11), does **NOT** own WorkOrder dispatch or technician execution (Phases 1.6, 1.8, 1.9), does **NOT** own stock balances/movements (Phase 1.10), does **NOT** manage platform SaaS subscriptions (Phase 1.15). |
| **Quotes & Estimates** (Phase 1.11) | `Quote` entity, `QuoteLineItem` entity, proposal approval tracking, quote conversion to WorkOrders. | Invoices consume Quotes read-only when generating an invoice from an approved quote (`quote.id` stored as nullable FK provenance). |
| **Work Orders** (Phase 1.6 & 1.9) | `WorkOrder` entity, operational tasks, `WorkOrderPart` consumed items, `TechnicianTimeEntry` recorded labor. | Invoices consume completed WorkOrders read-only when billing for field services (`workOrder.id` stored as nullable FK provenance). |
| **Inventory & Parts** (Phase 1.10) | `Part` catalog, `InventoryLocation`, `InventoryBalance`, `StockMovement` ledger. | Invoicing snapshots part metadata and cost at line creation time. Invoicing **never** triggers inventory stock movements or reserves parts. |
| **Service Catalog** (Phase 1.5) | `ServiceCatalog`, `WorkType` definitions, standard labor rates. | Consumed read-only by Invoicing to populate ad-hoc draft invoice line items. |
| **Customers & Locations** (Phase 1.4) | `Customer`, `CustomerContact`, `ServiceLocation`. | Consumed read-only as the billing party and service site. |

### 1.2 Critical Exclusions & Roadmap Boundaries

In strict compliance with the platform architecture roadmap, the following features are **explicitly excluded** from Phase 1.12:

1. **No General Ledger (GL) / Double-Entry Accounting**: No journal entries, chart of accounts, debit/credit ledger posting, trial balances, or fiscal year closings.
2. **No Accounts Payable (AP) / Vendor Billing**: Invoicing is strictly Accounts Receivable (customer billing). No vendor bills, supplier invoices, or purchase order matching.
3. **No Payroll Processing**: No technician wage disbursement, direct deposit generation, payroll tax withholding, or contractor 1099 tracking. (Technician time entries in Phase 1.9 provide operational hours only).
4. **No Bank Account Reconciliation**: No direct bank statement feed ingestion (OFX, Plaid) or automated cash ledger matching.
5. **No Tax Jurisdiction Filing / Compliance Remittance**: Invoicing applies configured tax rates to calculate line/invoice tax amounts; it does not generate municipal/state tax returns or automate tax remittance to revenue authorities.
6. **No Automated Dunning / Collections**: No automated SMS/email debt collection sequences, overdue penalties, interest compounding, or credit agency reporting.
7. **No Subscription Billing**: No recurring monthly/annual subscription plans, metered usage billing, or automated recurring credit card billing (reserved for Phase 1.15).
8. **No Direct Merchant Payment Gateway Tokenization in Core**: Invoicing records and reconciles financial payments (`RECORDED`, `VOIDED`, with `paymentMethod` and `referenceNumber`). Direct Stripe/merchant gateway tokenization and checkout sessions interface via integration adapters (Phase 1.17) without coupling the core financial data model.

---

## 2. Invoice Source Integration & Single-Path Snapshot Invariant

### 2.1 Provenance Modeling & Deterministic Population Rules

#### Decision
`Invoice` shall include two direct nullable foreign keys:
- `quoteId String?` pointing to `Quote.id` (`onDelete: SetNull`, `@@index([quoteId])`)
- `workOrderId String?` pointing to `WorkOrder.id` (`onDelete: SetNull`, `@@index([workOrderId])`)

#### Canonical Provenance Population Rules
To eliminate ambiguity between source pathways, the following canonical rules are strictly locked:

1. **Quote-Sourced Invoice (`createInvoiceFromQuote`)**:
   - Always sets `Invoice.quoteId = quote.id`.
   - If the source Quote was previously converted to an operational WorkOrder (`quote.convertedWorkOrderId` is not null), the service **automatically populates `Invoice.workOrderId = quote.convertedWorkOrderId`**.
   - If the Quote was approved directly without conversion, `Invoice.workOrderId` is set to `null`.
2. **WorkOrder-Sourced Invoice (`createInvoiceFromWorkOrder`)**:
   - Always sets `Invoice.workOrderId = workOrder.id`.
   - If the source WorkOrder originated from a commercial Quote (`workOrder.sourceQuoteId` is not null), the service **automatically populates `Invoice.quoteId = workOrder.sourceQuoteId`**.
   - If the WorkOrder was created standalone without a quote, `Invoice.quoteId` is set to `null`.
3. **Standalone Direct Invoice (`createInvoice`)**:
   - Sets `Invoice.quoteId = null` and `Invoice.workOrderId = null` (unless explicitly provided as optional pre-existing entity links during administrative creation).

#### Architectural Rationale
1. **Consistency with Platform Architectural Conventions**: Follows the exact provenance convention locked in Phase 1.11.1 (`WorkOrder.sourceQuoteId`).
2. **Direct Relational Traversal**: Provides direct $O(1)$ query capability from Invoice to source Quote or WorkOrder (`invoice.quote`, `invoice.workOrder`) without bridge/join table overhead.
3. **Unified Bidirectional Traceability**: Ensures that regardless of whether an invoice is spawned from a converted Quote or the resulting WorkOrder, both `quoteId` and `workOrderId` are populated deterministically when both entities exist in the provenance chain.
4. **Referential Safety**: `onDelete: SetNull` ensures that if a historical Quote or WorkOrder is purged in an administrative cleanup, the legally binding financial invoice remains intact with its historical snapshot data.

### 2.2 The Independent Snapshot Invariant

#### Problem Statement
An invoice is a legally binding demand for payment and tax document. If an invoice were merely to "reference" line items from a Quote or WorkOrder, any subsequent edit, price adjustment, or deletion on the Quote or WorkOrder would silently alter the invoice's financial record, violating accounting compliance and creating audit failure.

#### Architectural Invariant: Mandatory Re-Snapshotting
When `createInvoiceFromQuote` or `createInvoiceFromWorkOrder` is invoked, the service **MUST NOT** share or point directly to source line items. Instead, it reads the source data and creates **brand-new, independent `InvoiceLineItem` records** with frozen snapshot attributes:

1. **When generating from an accepted `Quote`**:
   - Copy each `QuoteLineItem` into a new `InvoiceLineItem`.
   - Snapshot `workTypeName`, `workTypeCode`, `partName`, `partSku`, `partUnitOfMeasure`.
   - Snapshot `quantity`, `unitPrice`, `unitCost`, `discountAmount`, `taxRate`.
   - Snapshot header discount parameters (`discountType`, `discountValue`).
2. **When generating from a completed `WorkOrder`**:
   - Convert the primary labor/work type into an `InvoiceLineItem` of type `LABOR` (defaulting quantity from billable hours or catalog estimate, unit price from standard catalog rate).
   - Convert each consumed `WorkOrderPart` into an `InvoiceLineItem` of type `PART` (snapshotting `partName`, `partSku`, `unitOfMeasure`, `quantity = workOrderPart.quantity`, `unitCost = workOrderPart.unitCostAtTimeOfUse`, `unitPrice = part.unitPrice`).
   - Allow optional billing technician expenses/custom fees as `EXPENSE` / `CUSTOM` lines.
3. **Permanent Historical Isolation**: Once created, the `Invoice` and its `InvoiceLineItem` entities exist in total isolation from the source entity. Modifications to the Quote or WorkOrder have zero effect on the Invoice.

---

## 3. Data Model & Prisma Schema Contract

### 3.1 Enums

```prisma
enum InvoiceStatus {
  DRAFT           // Editable draft invoice; not yet legally issued; payments cannot be applied
  ISSUED          // Issued/sent to customer; locked against line edits; awaiting payment
  PARTIALLY_PAID  // Partial payment received (0 < amountPaid < total); awaiting balance
  PAID            // Fully settled (amountPaid >= total; amountDue == 0.00)
  OVERDUE         // Past dueDate with outstanding balance (now > dueDate && amountDue > 0)
  VOID            // Officially cancelled/voided; locked; balance zeroed out
}

enum InvoiceLineItemType {
  LABOR           // Labor services (WorkType / billable time)
  PART            // Materials / inventoried parts
  EXPENSE         // Pass-through expenses, permits, rental fees
  CUSTOM          // Ad-hoc line item
}

enum InvoiceDiscountType {
  PERCENTAGE      // Discount as a percentage (e.g. 10.00%)
  FIXED           // Fixed currency amount discount (e.g. $50.00)
}

enum PaymentMethod {
  CASH
  CHECK
  CREDIT_CARD
  BANK_TRANSFER
  ACH
  OTHER
}

enum PaymentStatus {
  RECORDED        // Active, valid payment applied toward invoice balance
  VOIDED          // Payment nullified/reversed; balance restored onto invoice
}

enum InvoiceHistoryEventType {
  CREATED
  UPDATED
  LINE_ITEM_ADDED
  LINE_ITEM_UPDATED
  LINE_ITEM_REMOVED
  ISSUED
  PAYMENT_APPLIED
  PAYMENT_VOIDED
  OVERDUE_MARKED
  VOIDED
  DELETED
}
```

### 3.2 Invoice Model

```prisma
model Invoice {
  id                  String              @id @default(cuid())
  workspaceId         String
  invoiceNumber       String              // Auto-generated human-readable code (e.g. INV-00001)

  customerId          String
  locationId          String?

  // Provenance (Nullable Foreign Keys)
  quoteId             String?
  workOrderId         String?

  status              InvoiceStatus       @default(DRAFT)
  title               String
  notes               String?             @db.Text // Customer-facing notes
  internalNotes       String?             @db.Text // Internal operational notes
  termsAndConditions  String?             @db.Text // Payment terms (e.g. Net 30)

  currencyCode        String              @default("USD") @db.VarChar(3) // ISO 4217 code snapshotted from Workspace.defaultCurrencyCode
  issueDate           DateTime            @default(now())
  dueDate             DateTime            // Mandatory payment due date

  // Server-Authoritative Monetary Calculations
  subtotal            Decimal             @default(0.00) @db.Decimal(12, 2)
  discountType        InvoiceDiscountType @default(PERCENTAGE)
  discountValue       Decimal             @default(0.00) @db.Decimal(12, 2)
  discountAmount      Decimal             @default(0.00) @db.Decimal(12, 2)
  taxRate             Decimal             @default(0.00) @db.Decimal(5, 4)  // Template / display tax rate (e.g. 0.0825)
  taxAmount           Decimal             @default(0.00) @db.Decimal(12, 2) // Authoritative sum of line tax amounts
  total               Decimal             @default(0.00) @db.Decimal(12, 2) // Authoritative invoice total = net base + taxAmount

  // Server-Reconciled Payment Balances
  amountPaid          Decimal             @default(0.00) @db.Decimal(12, 2) // Reconciled sum of active RECORDED payments
  amountDue           Decimal             @default(0.00) @db.Decimal(12, 2) // Reconciled balance due = total - amountPaid

  // Audit Timestamps & Lifecycle Metadata
  issuedAt            DateTime?
  paidAt              DateTime?
  voidedAt            DateTime?
  voidReason          String?             @db.Text

  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt

  // Relations
  workspace           Workspace           @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  customer            Customer            @relation(fields: [customerId], references: [id], onDelete: Restrict)
  location            ServiceLocation?    @relation(fields: [locationId], references: [id], onDelete: Restrict)
  quote               Quote?              @relation(fields: [quoteId], references: [id], onDelete: SetNull)
  workOrder           WorkOrder?          @relation(fields: [workOrderId], references: [id], onDelete: SetNull)

  lineItems           InvoiceLineItem[]
  payments            Payment[]
  history             InvoiceHistory[]

  @@unique([workspaceId, invoiceNumber])
  @@index([workspaceId])
  @@index([customerId])
  @@index([locationId])
  @@index([quoteId])
  @@index([workOrderId])
  @@index([status])
  @@index([workspaceId, status])
  @@index([dueDate])
  @@index([createdAt])
}
```

### 3.3 InvoiceLineItem Model (with Independent Snapshots)

```prisma
model InvoiceLineItem {
  id                  String              @id @default(cuid())
  invoiceId           String
  workspaceId         String

  lineItemType        InvoiceLineItemType @default(CUSTOM)

  // Optional References to Source Catalogs
  workTypeId          String?
  partId              String?

  // Frozen Independent Snapshots (Immutable upon creation)
  name                String
  description         String?             @db.Text
  workTypeName        String?
  workTypeCode        String?
  partName            String?
  partSku             String?
  partUnitOfMeasure   String?

  // Financial Calculations (Server Authoritative)
  quantity            Decimal             @default(1.00) @db.Decimal(10, 2)
  unitPrice           Decimal             @default(0.00) @db.Decimal(12, 2)
  unitCost            Decimal?            @db.Decimal(12, 2)                // Cost snapshot for margin analysis
  discountAmount      Decimal             @default(0.00) @db.Decimal(12, 2) // Line-specific discount
  subtotal            Decimal             @default(0.00) @db.Decimal(12, 2) // (quantity * unitPrice) - discountAmount
  taxRate             Decimal             @default(0.00) @db.Decimal(5, 4)  // Authoritative line tax rate
  taxAmount           Decimal             @default(0.00) @db.Decimal(12, 2) // Calculated line tax after discount proration
  total               Decimal             @default(0.00) @db.Decimal(12, 2) // Net line base + line taxAmount

  sortOrder           Int                 @default(0)

  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt

  // Relations
  invoice             Invoice             @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  workspace           Workspace           @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  workType            WorkType?           @relation(fields: [workTypeId], references: [id], onDelete: SetNull)
  part                Part?               @relation(fields: [partId], references: [id], onDelete: SetNull)

  @@index([invoiceId])
  @@index([workspaceId])
  @@index([workTypeId])
  @@index([partId])
  @@index([sortOrder])
}
```

### 3.4 Payment Model

```prisma
model Payment {
  id                  String              @id @default(cuid())
  workspaceId         String
  invoiceId           String
  paymentNumber       String              // Auto-generated code (e.g. PAY-00001)

  customerId          String
  amount              Decimal             @db.Decimal(12, 2)                // Payment amount; must be > 0.00
  currencyCode        String              @default("USD") @db.VarChar(3)    // Snapshotted from Invoice
  paymentMethod       PaymentMethod       @default(CHECK)
  referenceNumber     String?                                               // Check #, transaction ref, card auth code
  status              PaymentStatus       @default(RECORDED)

  paymentDate         DateTime            @default(now())
  notes               String?             @db.Text

  recordedByMemberId  String?
  voidedAt            DateTime?
  voidedByMemberId    String?
  voidReason          String?             @db.Text

  createdAt           DateTime            @default(now())
  updatedAt           DateTime            @updatedAt

  // Relations
  workspace           Workspace           @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  invoice             Invoice             @relation(fields: [invoiceId], references: [id], onDelete: Restrict)
  customer            Customer            @relation(fields: [customerId], references: [id], onDelete: Restrict)
  recordedByMember    WorkspaceMember?    @relation("PaymentRecordedBy", fields: [recordedByMemberId], references: [id], onDelete: SetNull)
  voidedByMember      WorkspaceMember?    @relation("PaymentVoidedBy", fields: [voidedByMemberId], references: [id], onDelete: SetNull)

  @@unique([workspaceId, paymentNumber])
  @@index([workspaceId])
  @@index([invoiceId])
  @@index([customerId])
  @@index([status])
  @@index([paymentDate])
  @@index([createdAt])
}
```

### 3.5 InvoiceHistory Model

```prisma
model InvoiceHistory {
  id                  String                  @id @default(cuid())
  invoiceId           String
  workspaceId         String

  eventType           InvoiceHistoryEventType
  actorMemberId       String?
  actorName           String?

  field               String?
  oldValue            String?                 @db.Text
  newValue            String?                 @db.Text
  metadata            Json?

  createdAt           DateTime                @default(now())

  // Relations
  invoice             Invoice                 @relation(fields: [invoiceId], references: [id], onDelete: Cascade)
  workspace           Workspace               @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([invoiceId])
  @@index([workspaceId])
  @@index([eventType])
  @@index([createdAt])
}
```

### 3.6 Cross-Domain Model Extensions

```prisma
// In model Workspace:
invoices            Invoice[]
invoiceLineItems    InvoiceLineItem[]
payments            Payment[]
invoiceHistories    InvoiceHistory[]

// In model Customer:
invoices            Invoice[]
payments            Payment[]

// In model Quote:
invoices            Invoice[]

// In model WorkOrder:
invoices            Invoice[]

// In model WorkspaceMember:
recordedPayments    Payment[] @relation("PaymentRecordedBy")
voidedPayments      Payment[] @relation("PaymentVoidedBy")
```

---

## 4. Canonical Authoritative Monetary Calculation Model

To guarantee 100% mathematical consistency across Quotes (Phase 1.11) and Invoices (Phase 1.12), the calculation engine implements the **identical canonical line-level tax model with proportional header discount proration**.

All monetary computations use exact 2-decimal rounded arithmetic (`round(val, 2)`):

### Step 1: Line Item Base Subtotal
For each line item $i$:
$$\text{LineBaseSubtotal}_i = \text{round}\Big((\text{Quantity}_i \times \text{UnitPrice}_i) - \text{LineDiscountAmount}_i, 2\Big)$$
*(Guarded: $\text{LineBaseSubtotal}_i \ge 0$)*

### Step 2: Invoice Gross Subtotal
$$\text{InvoiceSubtotal} = \sum_{i=1}^{N} \text{LineBaseSubtotal}_i$$

### Step 3: Invoice Header Discount Calculation
$$\text{InvoiceDiscountAmount} = \begin{cases} 
\text{round}\left(\text{InvoiceSubtotal} \times \frac{\text{DiscountValue}}{100}, 2\right) & \text{if } \text{InvoiceDiscountType} = \text{PERCENTAGE} \\ 
\min(\text{DiscountValue}, \text{InvoiceSubtotal}) & \text{if } \text{InvoiceDiscountType} = \text{FIXED} 
\end{cases}$$

### Step 4: Line-Level Header Discount Proration & Net Taxable Base
To guarantee exact tax calculation when an overall invoice discount is applied, the header discount is prorated across line items:
1. For each line $i$ (if $\text{InvoiceSubtotal} > 0$):
   $$\text{LineAllocatedDiscount}_i = \text{round}\left(\text{InvoiceDiscountAmount} \times \frac{\text{LineBaseSubtotal}_i}{\text{InvoiceSubtotal}}, 2\right)$$
2. **Penny-Rounding Reconciliation**: If $\sum \text{LineAllocatedDiscount}_i \neq \text{InvoiceDiscountAmount}$, the delta remainder is applied to the line with the largest subtotal.
3. **Net Taxable Base per Line**:
   $$\text{LineNetBase}_i = \max(0.00, \text{LineBaseSubtotal}_i - \text{LineAllocatedDiscount}_i)$$

### Step 5: Authoritative Line Tax & Line Total
For each line $i$:
$$\text{LineTaxAmount}_i = \text{round}(\text{LineNetBase}_i \times \text{taxRate}_i, 2)$$
$$\text{LineTotal}_i = \text{LineNetBase}_i + \text{LineTaxAmount}_i$$

### Step 6: Authoritative Invoice Header Aggregation
$$\text{TaxableBase} = \sum_{i=1}^{N} \text{LineNetBase}_i = \text{InvoiceSubtotal} - \text{InvoiceDiscountAmount}$$
$$\text{InvoiceTaxAmount} = \sum_{i=1}^{N} \text{LineTaxAmount}_i$$
$$\text{InvoiceTotal} = \text{TaxableBase} + \text{InvoiceTaxAmount} = \sum_{i=1}^{N} \text{LineTotal}_i$$

### Step 7: Payment Balance Reconciliation
$$\text{amountPaid} = \sum_{j=1}^{M} \text{Payment.amount}_j \quad \text{where } \text{Payment.status} = \text{RECORDED}$$
$$\text{amountDue} = \max(0.00, \text{InvoiceTotal} - \text{amountPaid})$$

**Non-Negotiable Invariant**: Clients never supply calculated monetary values (`subtotal`, `taxAmount`, `total`, `amountPaid`, `amountDue`). The server calculates them deterministically on every line modification or payment transition within a database transaction.

---

## 5. Payment Aggregate & Balance Model

### 5.1 Relationship Cardinality
The relationship between `Invoice` and `Payment` is strictly **1:N**:
- An invoice may have $0$, $1$, or multiple partial payments recorded against it.
- Each `Payment` is tied to exactly one `Invoice` and one `Customer`.

### 5.2 Balance Storage Decision: Stored-and-Reconciled vs Dynamic Computed

#### Decision
`amountPaid` and `amountDue` are **stored directly on the `Invoice` model** and kept strictly reconciled inside database transactions.

#### Justification
1. **Query Performance & Indexing**: Invoices must be filtered and sorted in real-time by status (e.g. `OVERDUE`, `PARTIALLY_PAID`) and balance due (`amountDue > 0`). Stored fields allow fast $O(1)$ index scans without computing dynamic aggregations across thousands of payment rows per request.
2. **Transactional Guarantees**: Whenever a payment is created or voided, Prisma's interactive transaction `$transaction` updates the payment status and recalculates/reconciles `amountPaid`, `amountDue`, and `Invoice.status` atomically.
3. **Audit Immutability**: Historical financial snapshots remain crisp and verifiable without recalculating retroactive ledger balances.

### 5.3 Overpayment Guard
The calculation and payment service enforces a strict server-side guard:
$$\text{Payment.amount} \le \text{Invoice.amountDue}$$
- Attempting to record a payment where $\text{amount} > \text{amountDue}$ is rejected with `OverpaymentNotAllowedError` (`OVERPAYMENT_NOT_ALLOWED`, HTTP 422).
- Payments with $\text{amount} \le 0.00$ are rejected with `InvalidPaymentAmountError` (`INVALID_PAYMENT_AMOUNT`, HTTP 422).

### 5.4 Multiple Partial Payments Scenario Walkthrough

Consider an Invoice with `total = $1,000.00` and `dueDate = 2026-09-30`:

```
1. Invoice Issued:
   total: $1,000.00 | amountPaid: $0.00 | amountDue: $1,000.00 | status: ISSUED

2. Deposit Payment Recorded ($300.00):
   - Payment PAY-001 (amount: $300.00, status: RECORDED)
   - Invoice reconciled:
     amountPaid = $300.00
     amountDue  = $700.00
     status     = PARTIALLY_PAID

3. Second Payment Recorded ($700.00):
   - Payment PAY-002 (amount: $700.00, status: RECORDED)
   - Invoice reconciled:
     amountPaid = $1,000.00
     amountDue  = $0.00
     status     = PAID
     paidAt     = now()

4. Scenario A — Payment PAY-002 Voided (e.g. Bounced Check):
   - Payment PAY-002 updated to status: VOIDED
   - Invoice reconciled:
     amountPaid = $300.00
     amountDue  = $700.00
     paidAt     = null
     status     = PARTIALLY_PAID (or OVERDUE if now() > dueDate)
```

### 5.5 Canonical Guard Precedence & Execution Sequence for `recordPayment`

When recording a payment via `recordPayment(workspaceId, invoiceId, payload, actor, tx)`, the service executes the following strict, deterministic sequence of validation guards in exact order:

1. **Authentication & RBAC Guard**:
   - Assert that `actor` possesses the `payments.create` permission in `workspaceId`.
   - If not authorized $\rightarrow$ throw `AuthorizationError` (HTTP 403).
2. **Existence & Tenant Isolation Guard**:
   - Query `Invoice` by `(workspaceId, invoiceId)`.
   - If not found in the tenant workspace $\rightarrow$ throw `InvoiceNotFoundError` (`INVOICE_NOT_FOUND`, HTTP 404).
3. **Payload Syntactic & Amount Validation Guard**:
   - Assert `payload.amount` is a valid Decimal number with $\le 2$ decimal places.
   - Assert `payload.amount > 0.00`. If `amount <= 0.00` or NaN $\rightarrow$ throw `InvalidPaymentAmountError` (`INVALID_PAYMENT_AMOUNT`, HTTP 422).
   - Assert `payload.paymentMethod` is a valid `PaymentMethod` enum value.
4. **Terminal & Non-Payable Status Guards (Strict Hierarchical Order)**:
   - **Step 4a (`VOID` Check)**: If `invoice.status === VOID` $\rightarrow$ throw `InvoiceAlreadyVoidedError` (`INVOICE_ALREADY_VOIDED`, HTTP 409).
   - **Step 4b (`DRAFT` Check)**: If `invoice.status === DRAFT` $\rightarrow$ throw `InvoiceStatusConflictError` (`INVOICE_STATUS_CONFLICT`, HTTP 409, message: `"Cannot apply payment to a DRAFT invoice; invoice must be in ISSUED, PARTIALLY_PAID, or OVERDUE status"`).
   - **Step 4c (`PAID` Check)**: If `invoice.status === PAID` $\rightarrow$ throw `InvoiceAlreadyPaidError` (`INVOICE_ALREADY_PAID`, HTTP 409). *(Note: This status-based check fires unconditionally before balance evaluation, guaranteeing that fully settled invoices return 409 Conflict rather than 422 Overpayment).*
5. **Payable State Affirmation**:
   - Status must be strictly one of `ISSUED`, `PARTIALLY_PAID`, or `OVERDUE`.
6. **Balance & Overpayment Guard**:
   - Evaluate whether `payload.amount > invoice.amountDue`. If true $\rightarrow$ throw `OverpaymentNotAllowedError` (`OVERPAYMENT_NOT_ALLOWED`, HTTP 422, message: `"Payment amount exceeds outstanding balance due"`).
7. **Atomic Execution & State Transition (inside Prisma `$transaction`)**:
   - Generate unique `paymentNumber` (`PAY-XXXXX`).
   - Create `Payment` record with `status: RECORDED`, `currencyCode = invoice.currencyCode`, `recordedByMemberId = actor.id`.
   - Calculate updated totals:
     - `newAmountPaid = invoice.amountPaid + payload.amount`
     - `newAmountDue = invoice.total - newAmountPaid`
   - Determine new `InvoiceStatus`:
     - If `newAmountDue == 0.00` $\rightarrow$ `newStatus = PAID`, `paidAt = now()`
     - If `newAmountDue > 0.00` $\rightarrow$ `newStatus = PARTIALLY_PAID`, `paidAt = null`
   - Update `Invoice`: `amountPaid = newAmountPaid`, `amountDue = newAmountDue`, `status = newStatus`, `paidAt = paidAt`.
   - Append `InvoiceHistory` event: `eventType = PAYMENT_APPLIED`, `metadata = { paymentId, paymentNumber, amount: payload.amount, amountDue: newAmountDue, status: newStatus }`.
   - Return `{ success: true, payment, invoice }`.

---

## 6. Invoice Lifecycle State Machine

```
              createInvoice()
                    │
                    v
            ┌───────────────┐
            │     DRAFT     │ <─────────────┐ (delete line / edit)
            └───────┬───────┘               │
                    │ issueInvoice()        │
                    v                       │
            ┌───────────────┐               │
 ┌───────── │    ISSUED     │ ──────────────┘
 │          └───────┬───────┘
 │                  │
 │ (due date passed)│ (partial payment)
 │                  v
 │          ┌───────────────┐
 │          │PARTIALLY_PAID │ <─────────────┐ (void payment)
 │          └───────┬───────┘               │
 │                  │                       │
 │                  │ (final payment)       │
 │                  v                       │
 │          ┌───────────────┐               │
 │          │     PAID      │ ──────────────┘
 │          └───────────────┘
 v
┌───────────────────┐
│      OVERDUE      │ ─── (payment received) ───> [ PARTIALLY_PAID / PAID ]
└─────────┬─────────┘
          │
          │ voidInvoice() (0 active payments)
          v
┌───────────────────┐
│       VOID        │ (Terminal state)
└───────────────────┘
```

### 6.1 State Transition Matrix

| Current State | Target State | Trigger Function | Required Conditions & Guards |
| :--- | :--- | :--- | :--- |
| *None* | `DRAFT` | `createInvoice` / `createFromQuote` / `createFromWorkOrder` | Valid `customerId`, valid title, `dueDate >= issueDate`. Sets `currencyCode` from `Workspace.defaultCurrencyCode`. |
| `DRAFT` | `ISSUED` | `issueInvoice` | At least 1 line item present, `subtotal >= 0`, valid `dueDate`. Locks line items. |
| `DRAFT` | *Deleted* | `deleteInvoice` | Only allowed if status is `DRAFT` and 0 payments exist. Hard deletes invoice and line items. |
| `ISSUED` | `PARTIALLY_PAID` | `recordPayment` | $0 < \text{payment.amount} < \text{amountDue}$. Updates `amountPaid`, `amountDue`. |
| `ISSUED` | `PAID` | `recordPayment` | $\text{payment.amount} == \text{amountDue}$. Sets `amountDue = 0.00`, `paidAt = now()`. |
| `ISSUED` | `OVERDUE` | `evaluateInvoiceOverdue` | $\text{now()} > \text{dueDate}$ and $\text{amountDue} > 0.00$. |
| `ISSUED` | `VOID` | `voidInvoice` | No active `RECORDED` payments exist. Mandatory `voidReason` provided. |
| `PARTIALLY_PAID`| `PAID` | `recordPayment` | $\text{payment.amount} == \text{amountDue}$. Sets `amountDue = 0.00`, `paidAt = now()`. |
| `PARTIALLY_PAID`| `OVERDUE` | `evaluateInvoiceOverdue` | $\text{now()} > \text{dueDate}$ and $\text{amountDue} > 0.00$. |
| `OVERDUE` | `PARTIALLY_PAID` | `recordPayment` | $0 < \text{payment.amount} < \text{amountDue}$. |
| `OVERDUE` | `PAID` | `recordPayment` | $\text{payment.amount} == \text{amountDue}$. Sets `paidAt = now()`. |
| `OVERDUE` | `VOID` | `voidInvoice` | No active `RECORDED` payments exist. Mandatory `voidReason` provided. |
| `PAID` | `PARTIALLY_PAID`| `voidPayment` | Voiding a payment causes $\text{amountDue} > 0.00$ and $\text{amountPaid} > 0.00$ (with $\text{now()} \le \text{dueDate}$). Clears `paidAt`. |
| `PAID` | `ISSUED` | `voidPayment` | Voiding all payments causes $\text{amountPaid} == 0.00$ (with $\text{now()} \le \text{dueDate}$). Clears `paidAt`. |
| `PAID` | `OVERDUE` | `voidPayment` | Voiding a payment causes $\text{amountDue} > 0.00$ when $\text{now()} > \text{dueDate}$. Clears `paidAt`. |

### 6.2 Deterministic Guard Sequences for Lifecycle Transitions

#### A. `issueInvoice(workspaceId, invoiceId, actor)`
1. **RBAC Guard**: Assert `invoices.issue` permission.
2. **Existence Guard**: Fetch `Invoice`. If not found $\rightarrow$ throw `InvoiceNotFoundError` (404).
3. **Status Guard**: Assert `invoice.status === DRAFT`. If `status === ISSUED` $\rightarrow$ return idempotent success. If `status !== DRAFT` $\rightarrow$ throw `InvoiceStatusConflictError` (409).
4. **Line Item Count Guard**: Query line items count. If $0$ $\rightarrow$ throw `InvoiceEmptyLineItemsError` (`INVOICE_EMPTY_LINE_ITEMS`, HTTP 422).
5. **Due Date Guard**: Assert `invoice.dueDate >= invoice.issueDate`. If not $\rightarrow$ throw `InvoiceDueDateInvalidError` (`INVOICE_DUE_DATE_INVALID`, HTTP 422).
6. **Execution**: Atomically update `status = ISSUED`, `issuedAt = now()`, `amountDue = total`, `amountPaid = 0.00`, log `InvoiceHistory` event `ISSUED`.

#### B. `voidInvoice(workspaceId, invoiceId, payload: { voidReason }, actor)`
1. **RBAC Guard**: Assert `invoices.void` permission.
2. **Existence Guard**: Fetch `Invoice`. If not found $\rightarrow$ throw `InvoiceNotFoundError` (404).
3. **Void Reason Guard**: Assert `payload.voidReason` is non-empty string. If empty $\rightarrow$ throw `MissingVoidReasonError` (`MISSING_VOID_REASON`, HTTP 422).
4. **Already Voided Guard**: If `invoice.status === VOID` $\rightarrow$ throw `InvoiceAlreadyVoidedError` (`INVOICE_ALREADY_VOIDED`, HTTP 409).
5. **Active Payments Guard**: Query active `Payment` records where `status === RECORDED`. If count $> 0$ $\rightarrow$ throw `InvoiceHasActivePaymentsError` (`INVOICE_HAS_ACTIVE_PAYMENTS`, HTTP 409, message: `"Cannot void an invoice with active recorded payments. Void all associated payments first."`).
6. **Execution**: Update `status = VOID`, `voidedAt = now()`, `voidReason = payload.voidReason`, `amountDue = 0.00`, log `InvoiceHistory` event `VOIDED`.

#### C. `voidPayment(workspaceId, paymentId, payload: { voidReason }, actor)`
1. **RBAC Guard**: Assert `payments.void` permission.
2. **Existence Guard**: Fetch `Payment` with its `Invoice`. If not found $\rightarrow$ throw `PaymentNotFoundError` (404).
3. **Void Reason Guard**: Assert `payload.voidReason` is non-empty string. If empty $\rightarrow$ throw `MissingVoidReasonError` (`MISSING_VOID_REASON`, HTTP 422).
4. **Already Voided Guard**: If `payment.status === VOIDED` $\rightarrow$ throw `PaymentAlreadyVoidedError` (`PAYMENT_ALREADY_VOIDED`, HTTP 409).
5. **Execution (in `$transaction`)**:
   - Update `Payment`: `status = VOIDED`, `voidedAt = now()`, `voidedByMemberId = actor.id`, `voidReason = payload.voidReason`.
   - Recalculate remaining active `amountPaid = sum(RECORDED payments)`.
   - Recalculate `amountDue = invoice.total - amountPaid`.
   - Determine new `InvoiceStatus`:
     - If `amountPaid == 0.00` and `now() > invoice.dueDate` $\rightarrow$ `OVERDUE`
     - If `amountPaid == 0.00` and `now() <= invoice.dueDate` $\rightarrow$ `ISSUED`
     - If `amountPaid > 0.00` and `now() > invoice.dueDate` $\rightarrow$ `OVERDUE`
     - If `amountPaid > 0.00` and `now() <= invoice.dueDate` $\rightarrow$ `PARTIALLY_PAID`
   - Update `Invoice`: `amountPaid`, `amountDue`, `status = newStatus`, `paidAt = null`.
   - Log `InvoiceHistory` event `PAYMENT_VOIDED`.

#### D. `deleteInvoice(workspaceId, invoiceId, actor)`
1. **RBAC Guard**: Assert `invoices.delete` permission.
2. **Existence Guard**: Fetch `Invoice`. If not found $\rightarrow$ throw `InvoiceNotFoundError` (404).
3. **Status Guard**: Assert `invoice.status === DRAFT`. If `invoice.status !== DRAFT` $\rightarrow$ throw `InvoiceStatusConflictError` (`INVOICE_STATUS_CONFLICT`, HTTP 409, message: `"Only DRAFT invoices can be deleted. Issued, paid, or voided invoices must be preserved for audit compliance."`).
4. **Execution**: Hard delete `Invoice` (cascading line items and history).

---

## 7. Payment Lifecycle & Scope Decisions

### 7.1 Payment State Machine
Payments adhere to a strict two-state immutable ledger model:
$$\text{RECORDED} \xrightarrow{\text{voidPayment()}} \text{VOIDED}$$

- `RECORDED`: Payment is active and credited against the invoice's balance.
- `VOIDED`: Payment has been invalidated (e.g. check bounced, credit card disputed, mistaken manual entry). Requires `voidReason`, sets `voidedAt` and `voidedByMemberId`, and atomically increments `Invoice.amountDue` by the voided amount.
- **Immutability Invariant**: A payment is never edited in place or hard deleted once recorded. If the amount was entered incorrectly, it must be `VOIDED` and re-recorded.

### 7.2 Explicit Decision on Customer Refunds in Phase 1.12

#### Decision
Formal outward customer refunds (disbursing funds back to a customer via cash/check/card, credit note generation) are **DEFERRED to Phase 1.15 (SaaS Billing & Subscriptions) and Advanced Accounting**.

#### Architectural Rationale
1. **Core Scope Boundaries**: Phase 1.12 focuses on the operational accounts receivable pipeline: generating invoices from WorkOrders/Quotes, issuing payment demands, and recording incoming customer settlements.
2. **Operational Error Handling via Void**: In field service operations, erroneous payments (e.g. duplicate credit card swipe or entry typo) are resolved by **voiding the transaction**, which immediately resets the invoice balance without requiring complex negative-balance credit ledgers.
3. **Prevention of Scope Creep**: Adding multi-currency outward disbursements and partial refund allocation trees before payment gateway integrations (Phase 1.17) introduces unnecessary ledger complexity without live processing rails.

---

## 8. RBAC Permissions, Security & Commercial Visibility Specifications

### 8.1 Permissions Declaration

Declared in `lib/services/authorization/permissions.ts`:
```typescript
// Invoicing & Payments permissions (Phase 1.12)
INVOICES_VIEW: "invoices.view",
INVOICES_CREATE: "invoices.create",
INVOICES_UPDATE: "invoices.update",
INVOICES_DELETE: "invoices.delete",
INVOICES_ISSUE: "invoices.issue",
INVOICES_VOID: "invoices.void",

PAYMENTS_VIEW: "payments.view",
PAYMENTS_CREATE: "payments.create",
PAYMENTS_VOID: "payments.void",
```

### 8.2 Role Permission Matrix

| Role | Invoices View | Invoices Create | Invoices Update | Invoices Delete | Invoices Issue | Invoices Void | Payments View | Payments Create | Payments Void |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **OWNER** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **ADMIN** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **MANAGER** | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ❌ |
| **DISPATCHER** | ✅ | ✅ | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ |
| **TECHNICIAN** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **ACCOUNTANT** | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ | ✅ | ✅ |

### 8.3 Technician Financial Visibility Isolation

In strict compliance with the platform security architecture (consistent with Phase 1.11 Quote isolation):
- `TECHNICIAN` role is **completely excluded** from all `invoices.*` and `payments.*` permissions.
- Technicians have **zero access** to invoice line items, pricing markups, labor billing rates, outstanding customer debt, payment logs, or customer payment methods.
- Technicians interact solely with operational task details and consumed parts on the `WorkOrder` (Phase 1.6 / Phase 1.9). Billing realization is handled entirely by Dispatchers, Managers, Accountants, and Admins.

---

## 9. Domain Error Taxonomy

All errors extend pure domain error classes following Convention B (`code`, `statusCode`, `httpStatus`):

| Error Class | Code | HTTP Status | Trigger Condition |
| :--- | :--- | :---: | :--- |
| `InvoiceNotFoundError` | `INVOICE_NOT_FOUND` | 404 | Invoice ID does not exist in the tenant workspace. |
| `InvoiceLineItemNotFoundError` | `INVOICE_LINE_ITEM_NOT_FOUND` | 404 | Line item does not exist or belong to the specified invoice. |
| `PaymentNotFoundError` | `PAYMENT_NOT_FOUND` | 404 | Payment ID does not exist in the tenant workspace. |
| `InvoiceStatusConflictError` | `INVOICE_STATUS_CONFLICT` | 409 | Attempting an illegal state transition (e.g. editing lines on an `ISSUED` invoice). |
| `InvoiceAlreadyPaidError` | `INVOICE_ALREADY_PAID` | 409 | Attempting to record a payment on an invoice that is already `PAID`. |
| `InvoiceAlreadyVoidedError` | `INVOICE_ALREADY_VOIDED` | 409 | Attempting to mutate or apply payments to a `VOID` invoice. |
| `PaymentAlreadyVoidedError` | `PAYMENT_ALREADY_VOIDED` | 409 | Attempting to void a payment that is already `VOIDED`. |
| `InvoiceHasActivePaymentsError` | `INVOICE_HAS_ACTIVE_PAYMENTS` | 409 | Attempting to void or delete an invoice that has active `RECORDED` payments. |
| `OverpaymentNotAllowedError` | `OVERPAYMENT_NOT_ALLOWED` | 422 | Payment amount exceeds `amountDue` on the invoice. |
| `InvalidPaymentAmountError` | `INVALID_PAYMENT_AMOUNT` | 422 | Payment amount is $\le 0.00$ or has invalid decimal formatting. |
| `InvoiceEmptyLineItemsError` | `INVOICE_EMPTY_LINE_ITEMS` | 422 | Attempting to issue an invoice with 0 line items. |
| `InvalidInvoiceCalculationError` | `INVALID_INVOICE_CALCULATION` | 422 | Negative unit prices, invalid discount values, or arithmetic inconsistencies. |
| `SourceEntityNotEligibleError` | `SOURCE_ENTITY_NOT_ELIGIBLE` | 422 | Source Quote is not `APPROVED`/`CONVERTED` or WorkOrder is not `COMPLETED`. |
| `MissingVoidReasonError` | `MISSING_VOID_REASON` | 422 | Voiding an invoice or payment without supplying a mandatory reason. |
| `InvoiceDueDateInvalidError` | `INVOICE_DUE_DATE_INVALID` | 422 | `dueDate` is earlier than `issueDate`. |

---

## 10. REST API Endpoint Specifications

All endpoints are scoped under `/api/workspaces/[workspaceId]`:

| Method | Path | Description | Required Permission |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/workspaces/[workspaceId]/invoices` | List invoices with pagination, status filters, and customer search | `invoices.view` |
| `POST` | `/api/workspaces/[workspaceId]/invoices` | Create a new standalone draft invoice | `invoices.create` |
| `POST` | `/api/workspaces/[workspaceId]/invoices/from-quote` | Create an invoice from an approved Quote | `invoices.create` |
| `POST` | `/api/workspaces/[workspaceId]/invoices/from-work-order` | Create an invoice from a completed WorkOrder | `invoices.create` |
| `GET` | `/api/workspaces/[workspaceId]/invoices/[invoiceId]` | Get full invoice details, line items, payments, and audit history | `invoices.view` |
| `PATCH` | `/api/workspaces/[workspaceId]/invoices/[invoiceId]` | Update draft invoice metadata (title, notes, due date, terms) | `invoices.update` |
| `DELETE` | `/api/workspaces/[workspaceId]/invoices/[invoiceId]` | Delete draft invoice (only permitted in `DRAFT` with 0 payments) | `invoices.delete` |
| `POST` | `/api/workspaces/[workspaceId]/invoices/[invoiceId]/lines` | Add a line item to a draft invoice (recalculates totals) | `invoices.update` |
| `PATCH` | `/api/workspaces/[workspaceId]/invoices/[invoiceId]/lines/[lineId]` | Update a line item on a draft invoice (recalculates totals) | `invoices.update` |
| `DELETE` | `/api/workspaces/[workspaceId]/invoices/[invoiceId]/lines/[lineId]` | Delete a line item from a draft invoice (recalculates totals) | `invoices.update` |
| `POST` | `/api/workspaces/[workspaceId]/invoices/[invoiceId]/issue` | Issue invoice (`DRAFT` $\rightarrow$ `ISSUED`), locking lines | `invoices.issue` |
| `POST` | `/api/workspaces/[workspaceId]/invoices/[invoiceId]/void` | Void an issued or overdue invoice (requires `voidReason`) | `invoices.void` |
| `GET` | `/api/workspaces/[workspaceId]/invoices/[invoiceId]/payments` | List all payments recorded against an invoice | `payments.view` |
| `POST` | `/api/workspaces/[workspaceId]/invoices/[invoiceId]/payments` | Record a payment against an issued/partially paid/overdue invoice | `payments.create` |
| `POST` | `/api/workspaces/[workspaceId]/payments/[paymentId]/void` | Void a recorded payment (requires `voidReason`), restoring balance | `payments.void` |
| `GET` | `/api/workspaces/[workspaceId]/payments` | List all workspace payments with date range and method filters | `payments.view` |

---

## 11. Phase 1.12 Implementation Roadmap (13-Stage Breakdown)

The implementation roadmap for Phase 1.12 spans 13 sequential, rigorous milestones:

| Milestone | Stage Scope | Core Deliverables |
| :--- | :--- | :--- |
| **Phase 1.12.1** | Domain Architecture & Financial Domain Model | Binding architecture contract (`phase-1.12.1-invoicing-payments-domain-architecture.md`), self-audit walkthrough. |
| **Phase 1.12.2** | Prisma Schema & Database Migration | `Invoice`, `InvoiceLineItem`, `Payment`, `InvoiceHistory` schemas, cross-domain relations, Prisma migration, Client generation. |
| **Phase 1.12.3** | Domain Types, Errors & Zod Schemas | Pure domain error classes (Convention B), read/write DTOs, Zod input validation schemas. |
| **Phase 1.12.4** | Calculation Engine & Snapshot Helpers | Server-authoritative Decimal calculation utility, proportional discount proration, penny reconciliation, snapshot helpers. |
| **Phase 1.12.5** | Invoice Header CRUD Services | `createInvoice`, `getInvoice`, `updateInvoice`, `deleteInvoice` with workspace scoping and unique invoice numbers. |
| **Phase 1.12.6** | Invoice Line Item Services | `addInvoiceLineItem`, `updateInvoiceLineItem`, `removeInvoiceLineItem`, `reorderInvoiceLineItems` with automatic header recalculation. |
| **Phase 1.12.7** | Invoice Query & Directory Architecture | Advanced directory listing, multi-status filters, due date ranges, balance filters, customer search, pagination. |
| **Phase 1.12.8** | Source Conversion Adapters (Quotes & WorkOrders) | `createInvoiceFromQuote`, `createInvoiceFromWorkOrder` with independent line item re-snapshotting and bidirectional provenance. |
| **Phase 1.12.9** | Invoice Lifecycle & Overdue Services | `issueInvoice`, `voidInvoice`, `evaluateInvoiceOverdue` with strict guard sequences and audit event logging. |
| **Phase 1.12.10** | Payment Services & Balance Reconciliation | `recordPayment`, `voidPayment`, interactive transaction balance reconciliation, strict overpayment validation. |
| **Phase 1.12.11** | Referential Integrity & Historical Safety | Cascade/SetNull/Restrict verification, catalog/source deletion isolation, snapshot immutability verification. |
| **Phase 1.12.12** | Invoice & Payment Operational History | `InvoiceHistory` event logging pipeline, audit timeline queries, historical field diff tracking. |
| **Phase 1.12.13** | REST API Route Handlers, Hardening & Final Closure | REST route handlers, tenant isolation guards, RBAC enforcement, HTTP error translation, comprehensive Vitest test suite, phase closure. |

---

## 12. Deviations from Preliminary Roadmap

Per Aforden architecture governance, all evolutions from preliminary roadmap terminology and structuring are itemized and justified below:

| Area | Roadmap Terminology | Architecture Specification | Technical Rationale |
| :--- | :--- | :--- | :--- |
| **Invoice Status** | `SENT` / `UNPAID` | `ISSUED` | Standardizes accounting terminology. An invoice sent to a customer is "issued", distinguishing commercial state from email transport (`SENT`). |
| **Invoice Status** | `PAID_IN_FULL` | `PAID` | Concise, industry-standard enum naming pairing cleanly with `PARTIALLY_PAID`. |
| **Payment Lifecycle** | `COMPLETED` / `REFUNDED` | `RECORDED` / `VOIDED` | Correctly models accounting error correction in field service. Formal refund disbursements are deferred to Phase 1.15, while `VOIDED` handles operational reversals without negative balance complications. |
| **Line Item Types** | `SERVICE` | `LABOR` | Directly links to the `WorkType` catalog entity (Phase 1.5) representing technician labor and billable time. |
| **Line Item Types** | `MATERIAL` | `PART` (consolidated) | Aligns with the canonical `Part` catalog schema (Phase 1.10) to maintain uniform naming across Quotes, WorkOrders, and Invoices. |
| **Line Item Types** | *(none)* | `EXPENSE` | Added for pass-through fees (permits, equipment rental, disposal surcharges) that are neither labor nor inventoried parts. |
| **Implementation Stages** | Compressed / Implicit Stages | Explicit 13-Stage Roadmap | Restores explicit standalone milestones for Query/Directory Architecture (1.12.7), Referential Integrity (1.12.11), Operational History (1.12.12), and Final Closure (1.12.13) to match the rigorous 13-stage execution plan. |
