# Phase 1.11.1 — Quotes & Estimates Domain Architecture & Specification

> **Document Status**: LOCKED FOR IMPLEMENTATION (Phase 1.11 Architecture Standard)  
> **Domain**: Quotes, Estimates, Line Items, Pricing Snapshots, Server-Authoritative Totals, Quote Lifecycle State Machine, WorkOrder Conversion  
> **Dependencies**: Phase 1.1 (Multi-Tenancy & Workspace Partitioning), Phase 1.2 (Authentication & RBAC), Phase 1.3 (Technicians & Organization), Phase 1.4 (Customers & Service Locations), Phase 1.5 (Service Catalog & Work Types), Phase 1.6 (Work Orders), Phase 1.7 (Assets & Equipment), Phase 1.8 (Scheduling & Dispatch), Phase 1.9 (Technician Operations), Phase 1.10 (Inventory & Parts)  
> **Target Schema & Service Implementation**: Phase 1.11.2+

---

## Executive Summary

Phase 1.11 introduces the **Quotes & Estimates** domain to the Aforden Field Service Management (FSM) platform. Up through Phase 1.10, Aforden has established robust tenant isolation, multi-location customer hierarchies, service catalog pricing models, asset tracking, field dispatching, technician mobile execution, and inventory stock movements.

Phase 1.11 enables commercial proposals and customer cost estimation prior to field execution. Field service companies routinely quote jobs that combine **labor services (WorkTypes)**, **required parts/materials (Parts)**, and **custom expenses or fees**. Once a customer approves a quote, it must smoothly transition into active operations by spawning a canonical **WorkOrder** without duplicating operational logic or breaking tenant boundaries.

This document is the binding architectural contract for Phase 1.11. It defines:
1. Strict domain boundaries separating Quotes (pre-work proposal) from Invoicing (post-work billing) and Live Inventory (operational stock tracking).
2. The core data models (`Quote`, `QuoteLineItem`, `QuoteHistory`, and the `WorkOrder.sourceQuoteId` foreign key).
3. Immutable pricing snapshots preserving historical rates, part costs, and currency representation (`currencyCode`).
4. Server-authoritative monetary calculations with exact line-level Decimal arithmetic and discount proration.
5. The quote lifecycle state machine (`DRAFT` → `PENDING_APPROVAL` → `APPROVED` / `REJECTED` / `EXPIRED` → `CONVERTED`).
6. The atomic conversion contract from Quote to WorkOrder.
7. Commercial visibility isolation (restricting technicians from un-scoped quote viewing), RBAC permissions, domain error taxonomy, and REST API contracts.
8. Explicitly disclosed architectural deviations from the initial roadmap with technical rationale.

---

```
+---------------------------------------------------------------------------------------------------+
|                                        WORKSPACE (Tenant)                                         |
|                                                                                                   |
|   +-----------------------+       +------------------------+       +--------------------------+   |
|   |       CUSTOMER        |       |    SERVICE LOCATION    |       |     ASSET / EQUIPMENT    |   |
|   |      (Phase 1.4)      |       |      (Phase 1.4)       |       |       (Phase 1.7)        |   |
|   +-----------+-----------+       +-----------+------------+       +------------+-------------+   |
|               |                               |                                 |                 |
|               +-----------------------+       |       +-------------------------+                 |
|                                       |       |       |                                           |
|                                       v       v       v                                           |
|   =============================================================================================   |
|   |                               QUOTES & ESTIMATES DOMAIN                                   |   |
|   |                                      (Phase 1.11)                                         |   |
|   |                                                                                           |   |
|   |   +-----------------------------------------------------------------------------------+   |   |
|   |   |                                      QUOTE                                        |   |   |
|   |   |  - quoteNumber, currencyCode (e.g. USD/PKR), customerId, locationId, validUntil   |   |   |
|   |   |  - subtotal, discount, taxRate (template), taxAmount, total (Authoritative Dec)  |   |   |
|   |   |  - convertedWorkOrderId, convertedAt, convertedByMemberId                         |   |   |
|   |   +-----------------------------------------------------------------------------------+   |   |
|   |            |                                                         |                    |   |
|   |            | 1:N                                                     | 1:N                |   |
|   |            v                                                         v                    |   |
|   |   +---------------------------------------+       +-----------------------------------+   |   |
|   |   |            QuoteLineItem              |       |           QuoteHistory            |   |   |
|   |   |  - type: LABOR | PART | EXPENSE | ... |       |  - CREATED, UPDATED, SENT,        |   |   |
|   |   |  - quantity, unitPrice, discount, tax |       |    APPROVED, REJECTED, EXPIRED,   |   |   |
|   |   |  - Snapshots: name, code, sku, uom    |       |    CONVERTED                      |   |   |
|   |   +---------------------------------------+       +-----------------------------------+   |   |
|   =============================================================================================   |
|                                               |                                                   |
|                                               | convertQuoteToWorkOrder() (Atomic Conversion)     |
|                                               v                                                   |
|                           +---------------------------------------+                               |
|                           |              WORK ORDER               |                               |
|                           |              (Phase 1.6)              |                               |
|                           |  - sourceQuoteId: FK -> Quote         |                               |
|                           |  - customerId, locationId, workTypeId |                               |
|                           |  - status: OPEN                       |                               |
|                           +-------------------+-------------------+                               |
|                                               |                                                   |
|                        +----------------------+----------------------+                            |
|                        |                                             |                            |
|                        v                                             v                            |
|            +-----------------------+                     +-----------------------+                |
|            |  SCHEDULING/DISPATCH  |                     |   INVENTORY & PARTS   |                |
|            |      (Phase 1.8)      |                     |      (Phase 1.10)     |                |
|            +-----------------------+                     +-----------------------+                |
+---------------------------------------------------------------------------------------------------+
```

---

## 1. Domain Boundary & Ownership Matrix

### 1.1 Strict Domain Ownership Rules

| Domain | Owns | Does NOT Own / Consumes |
| :--- | :--- | :--- |
| **Quotes & Estimates** (Phase 1.11) | `Quote` entity, `QuoteLineItem` entity, `QuoteHistory` audit ledger, quote pricing snapshots, server-side monetary calculation engine, quote lifecycle state machine, customer approval tracking, atomic conversion dispatching. | Does **NOT** own WorkOrder entity creation logic (calls Phase 1.6 `createWorkOrder`), does **NOT** own stock movements/reservations (Phase 1.10), does **NOT** generate invoices or accept payments (Phase 1.12). |
| **Work Orders** (Phase 1.6) | `WorkOrder` entity, operational execution state machine, technician assignments, work order history. | Does **NOT** calculate quote totals or manage quote proposals. Owns `sourceQuoteId` as a foreign key reference. |
| **Inventory & Parts** (Phase 1.10) | `Part` catalog, `InventoryLocation`, `InventoryBalance`, `StockMovement` ledger, `WorkOrderPart` consumption. | Quoting a part in a quote reads catalog price/cost and snapshots it. Quoting a part **never** mutates live inventory balances or stock ledgers. |
| **Service Catalog** (Phase 1.5) | `ServiceCatalog`, `WorkType` definitions, standard pricing and duration estimates. | Consumed read-only by Quotes for populating initial line items. |
| **Invoicing & Payments** (Phase 1.12) | Invoices, payment processing, tax filing ledgers, credit notes. | Distinct domain. Quotes are pre-work proposals; Invoices are post-work binding payment demands. Quote logic **must not** bleed into Invoice logic. |

### 1.2 Explicit Exclusions from Phase 1.11

The following capabilities are explicitly deferred and must not be implemented in Phase 1.11:
- **Invoicing & Billing** (Phase 1.12) — Quotes are not invoices. No payment collection or credit terms.
- **Live Inventory Allocations/Reservations** (Phase 1.10) — Adding a part to a quote does **not** create a `StockMovement` (RESERVATION) or decrement stock balances. Stock reservation occurs during work order scheduling or staging.
- **Direct PDF Rendering Engine** — PDF generation is handled by the shared rendering utility/notification pipeline (Phase 1.13 / Phase 1.23); this phase exposes clean structured JSON endpoints.
- **Customer Portal Authentication** — Public approval links and tokenized magic links will interface through the customer portal layer; this phase provides the domain service `approveQuote` / `rejectQuote`.
- **Dynamic Cross-Currency FX Conversion** — Currency conversion and multi-currency exchange rates are out of scope; quotes store an immutable `currencyCode` snapshot (e.g. USD, PKR) representing the transaction currency.

---

## 2. Key Architectural Decisions

### 2.1 Quote <-> WorkOrder Relationship: Direct Nullable Foreign Key (`WorkOrder.sourceQuoteId`)

#### Decision
`WorkOrder` shall include a nullable foreign key `sourceQuoteId String?` pointing directly to `Quote.id` with `onDelete: SetNull` and an index `@@index([sourceQuoteId])`.

#### Architectural Rationale
1. **Consistency with Core Schema Architecture**: In Aforden, operational provenance is modeled cleanly on the child entity (e.g., `WorkOrder.assetId`, `WorkOrder.workTypeId`, `WorkOrder.assignedTechnicianId`). A nullable `sourceQuoteId` on `WorkOrder` matches this standard pattern.
2. **Query Performance and Clean Traversal**: When retrieving a WorkOrder, determining whether it originated from a Quote is a direct 1-hop relation (`workOrder.sourceQuote`) without the latency and query overhead of a separate bridge/join table.
3. **Purity of State**: The conversion of an approved quote produces a primary operational WorkOrder. Storing `sourceQuoteId` on `WorkOrder` and recording `convertedWorkOrderId` on `Quote` gives bidirectional $O(1)$ lookup while keeping the relationship simple and unambiguous.
4. **Why NOT a Join Table (`QuoteWorkOrderConversion`)**: A join table introduces unnecessary relational indirection, duplicate foreign keys, and extra schema complexity for what is fundamentally a single provenance pointer.

---

## 3. Data Model & Prisma Schema Contract

### 3.1 Enums

```prisma
enum QuoteStatus {
  DRAFT               // Editable draft
  PENDING_APPROVAL    // Sent to customer / awaiting decision
  APPROVED            // Customer approved the proposal
  REJECTED            // Customer declined the proposal
  EXPIRED             // Passed validUntil timestamp
  CONVERTED           // Transformed into an active WorkOrder
}

enum QuoteLineItemType {
  LABOR       // Linked to WorkType (hourly / fixed labor)
  PART        // Linked to Part catalog (materials / components)
  EXPENSE     // Travel, equipment rental, permits
  CUSTOM      // Ad-hoc line item
}

enum QuoteDiscountType {
  PERCENTAGE  // Discount as a percentage (e.g., 10.00%)
  FIXED       // Fixed currency amount discount (e.g., $50.00)
}

enum QuoteHistoryEventType {
  CREATED
  UPDATED
  LINE_ITEM_ADDED
  LINE_ITEM_UPDATED
  LINE_ITEM_REMOVED
  SENT
  APPROVED
  REJECTED
  EXPIRED
  CONVERTED
  DELETED
}
```

### 3.2 Quote Model

```prisma
model Quote {
  id                    String            @id @default(cuid())
  workspaceId           String
  quoteNumber           String            // Auto-generated human-readable code (e.g. Q-00001)

  customerId            String
  locationId            String?

  status                QuoteStatus       @default(DRAFT)
  title                 String
  description           String?           @db.Text
  internalNotes         String?           @db.Text
  termsAndConditions    String?           @db.Text

  currencyCode          String            @default("USD") @db.VarChar(3) // ISO 4217 code (USD, PKR, EUR) snapshotted from workspace default
  validUntil            DateTime?         // Quote expiration date

  // Server-Authoritative Monetary Totals
  subtotal              Decimal           @default(0.00) @db.Decimal(12, 2)
  discountType          QuoteDiscountType @default(PERCENTAGE)
  discountValue         Decimal           @default(0.00) @db.Decimal(12, 2)
  discountAmount        Decimal           @default(0.00) @db.Decimal(12, 2)
  taxRate               Decimal           @default(0.00) @db.Decimal(5, 4)   // Template / default tax rate for new lines (e.g. 0.0825 for 8.25%)
  taxAmount             Decimal           @default(0.00) @db.Decimal(12, 2)  // Authoritative sum of all line item tax amounts
  total                 Decimal           @default(0.00) @db.Decimal(12, 2)  // Authoritative total = net taxable base + taxAmount

  // Lifecycle Audit Timestamps & Actors
  sentAt                DateTime?
  approvedAt            DateTime?
  approvedByCustomerName String?
  rejectedAt            DateTime?
  rejectionReason       String?           @db.Text
  convertedAt           DateTime?
  convertedWorkOrderId  String?
  convertedByMemberId   String?

  createdAt             DateTime          @default(now())
  updatedAt             DateTime          @updatedAt

  // Relations
  workspace             Workspace         @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  customer              Customer          @relation(fields: [customerId], references: [id], onDelete: Restrict)
  location              ServiceLocation?  @relation(fields: [locationId], references: [id], onDelete: Restrict)
  lineItems             QuoteLineItem[]
  history               QuoteHistory[]
  workOrders            WorkOrder[]

  @@unique([workspaceId, quoteNumber])
  @@index([workspaceId])
  @@index([customerId])
  @@index([locationId])
  @@index([status])
  @@index([workspaceId, status])
  @@index([validUntil])
  @@index([createdAt])
}
```

### 3.3 QuoteLineItem Model (with Pricing Snapshots)

```prisma
model QuoteLineItem {
  id                  String            @id @default(cuid())
  quoteId             String
  workspaceId         String

  lineItemType        QuoteLineItemType @default(CUSTOM)

  // Optional References to Source Catalogs
  workTypeId          String?
  partId              String?

  // Item Details & Snapshots (Frozen at time of addition)
  name                String
  description         String?           @db.Text
  workTypeName        String?
  workTypeCode        String?
  partName            String?
  partSku             String?
  partUnitOfMeasure   String?

  // Financial Calculations (Server Authoritative)
  quantity            Decimal           @default(1.00) @db.Decimal(10, 2)
  unitPrice           Decimal           @default(0.00) @db.Decimal(12, 2)
  unitCost            Decimal?          @db.Decimal(12, 2)                // Internal cost snapshot for margin analysis
  discountAmount      Decimal           @default(0.00) @db.Decimal(12, 2) // Line-specific discount
  subtotal            Decimal           @default(0.00) @db.Decimal(12, 2) // (quantity * unitPrice) - discountAmount
  taxRate             Decimal           @default(0.00) @db.Decimal(5, 4)   // Authoritative line tax rate (e.g. 0.0825)
  taxAmount           Decimal           @default(0.00) @db.Decimal(12, 2) // Calculated line tax after discount allocation
  total               Decimal           @default(0.00) @db.Decimal(12, 2) // Line net base + line taxAmount

  sortOrder           Int               @default(0)

  createdAt           DateTime          @default(now())
  updatedAt           DateTime          @updatedAt

  // Relations
  quote               Quote             @relation(fields: [quoteId], references: [id], onDelete: Cascade)
  workspace           Workspace         @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  workType            WorkType?         @relation(fields: [workTypeId], references: [id], onDelete: SetNull)
  part                Part?             @relation(fields: [partId], references: [id], onDelete: SetNull)

  @@index([quoteId])
  @@index([workspaceId])
  @@index([workTypeId])
  @@index([partId])
  @@index([sortOrder])
}
```

### 3.4 QuoteHistory Model

```prisma
model QuoteHistory {
  id              String                @id @default(cuid())
  quoteId         String
  workspaceId     String

  eventType       QuoteHistoryEventType
  actorMemberId   String?
  actorName       String?

  field           String?
  oldValue        String?               @db.Text
  newValue        String?               @db.Text
  metadata        Json?

  createdAt       DateTime              @default(now())

  quote           Quote                 @relation(fields: [quoteId], references: [id], onDelete: Cascade)
  workspace       Workspace             @relation(fields: [workspaceId], references: [id], onDelete: Cascade)

  @@index([quoteId])
  @@index([workspaceId])
  @@index([eventType])
  @@index([createdAt])
}
```

### 3.5 WorkOrder Model Extension

```prisma
// In model WorkOrder:
sourceQuoteId String?
sourceQuote   Quote?   @relation(fields: [sourceQuoteId], references: [id], onDelete: SetNull)

@@index([sourceQuoteId])
```

---

## 4. Pricing Snapshots & Authoritative Totals Engine

### 4.1 Pricing Snapshots
Catalog prices change constantly as suppliers update parts and companies adjust hourly rates. A quote is a binding commercial offer; its lines must never change due to later catalog updates.

When a line item is created or updated:
1. If `workTypeId` is provided:
   - Read active `WorkType`.
   - Freeze `workTypeName = workType.name`, `workTypeCode = workType.code`.
   - Default `unitPrice` to catalog standard rate if not explicitly provided.
2. If `partId` is provided:
   - Read active `Part`.
   - Freeze `partName = part.name`, `partSku = part.sku`, `partUnitOfMeasure = part.unitOfMeasure`.
   - Freeze `unitCost = part.unitCost`.
   - Default `unitPrice` to catalog pricing if applicable.
3. If the catalog `WorkType` or `Part` is subsequently modified, renamed, or deleted (`onDelete: SetNull`), the line item retains its frozen snapshot data intact.

### 4.2 Canonical Authoritative Monetary Calculation Model

The calculation engine uses a **single canonical line-level tax model with discount proration**. There are no competing calculation branches. `Quote.taxRate` is solely a template/display default used to initialize new line items; all calculations are executed at line item resolution and aggregated to the header.

All calculations use 2-decimal rounded arithmetic (`round(val, 2)`):

#### Step 1: Line Item Base Subtotal
For each line item $i$:
$$\text{LineBaseSubtotal}_i = \text{round}\Big((\text{Quantity}_i \times \text{UnitPrice}_i) - \text{LineDiscountAmount}_i, 2\Big)$$
*(Guarded: $\text{LineBaseSubtotal}_i \ge 0$)*

#### Step 2: Quote Gross Subtotal
$$\text{QuoteSubtotal} = \sum_{i=1}^{N} \text{LineBaseSubtotal}_i$$

#### Step 3: Quote Header Discount Calculation
$$\text{QuoteDiscountAmount} = \begin{cases} 
\text{round}\left(\text{QuoteSubtotal} \times \frac{\text{DiscountValue}}{100}, 2\right) & \text{if } \text{QuoteDiscountType} = \text{PERCENTAGE} \\ 
\min(\text{DiscountValue}, \text{QuoteSubtotal}) & \text{if } \text{QuoteDiscountType} = \text{FIXED} 
\end{cases}$$

#### Step 4: Line-Level Header Discount Proration & Net Taxable Base
To ensure exact line-item tax calculation when a global quote discount is applied, the header discount is allocated proportionally across all lines:

1. For each line $i$ (if $\text{QuoteSubtotal} > 0$):
   $$\text{AllocatedHeaderDiscount}_i = \text{round}\left(\text{QuoteDiscountAmount} \times \frac{\text{LineBaseSubtotal}_i}{\text{QuoteSubtotal}}, 2\right)$$
2. **Penny-Rounding Reconciliation**: If $\sum \text{AllocatedHeaderDiscount}_i \neq \text{QuoteDiscountAmount}$, the delta (remainder cents) is applied to the line with the largest subtotal.
3. **Net Taxable Base per Line**:
   $$\text{LineNetBase}_i = \max(0.00, \text{LineBaseSubtotal}_i - \text{AllocatedHeaderDiscount}_i)$$

#### Step 5: Authoritative Line Tax & Line Total
For each line $i$:
$$\text{LineTaxAmount}_i = \text{round}(\text{LineNetBase}_i \times \text{taxRate}_i, 2)$$
$$\text{LineTotal}_i = \text{LineNetBase}_i + \text{LineTaxAmount}_i$$

#### Step 6: Authoritative Quote Header Aggregation
The header totals are strictly the sum of the calculated line values:
$$\text{TaxableBase} = \sum_{i=1}^{N} \text{LineNetBase}_i = \text{QuoteSubtotal} - \text{QuoteDiscountAmount}$$
$$\text{QuoteTaxAmount} = \sum_{i=1}^{N} \text{LineTaxAmount}_i$$
$$\text{QuoteTotal} = \text{TaxableBase} + \text{QuoteTaxAmount} = \sum_{i=1}^{N} \text{LineTotal}_i$$

**Non-Negotiable Invariant**: Clients never submit `subtotal`, `taxAmount`, or `total`. The server computes these authoritatively on every line mutation and recalculates quote header totals within the database transaction.

---

## 5. Quote Lifecycle State Machine

```
               createQuote()
                     │
                     v
             ┌───────────────┐
             │     DRAFT     │ <─────────────┐ (revise / reset)
             └───────┬───────┘               │
                     │ sendQuote()           │
                     v                       │
             ┌───────────────┐               │
  ┌───────── │PENDING_APPRVL │ ──────────────┘
  │          └───────┬───────┘
  │ (expire)         │
  │                  ├─── rejectQuote() ───> ┌───────────────┐
  │                  │                       │   REJECTED    │
  │                  └─── approveQuote()     └───────────────┘
  │                              │
  │                              v
  │                      ┌───────────────┐
  v                      │   APPROVED    │
┌────────────────┐       └───────┬───────┘
│    EXPIRED     │               │ convertQuoteToWorkOrder()
└────────────────┘               v
                         ┌───────────────┐
                         │   CONVERTED   │ (Terminal operational state)
                         └───────────────┘
```

### 5.1 State Transition Matrix

| Current State | Target State | Trigger Function | Required Conditions / Guards |
| :--- | :--- | :--- | :--- |
| *None* | `DRAFT` | `createQuote` | Valid `customerId`, valid title, authenticated workspace. Sets `currencyCode` from workspace default. |
| `DRAFT` | `PENDING_APPROVAL` | `sendQuote` | At least 1 line item present, valid `subtotal >= 0`, `validUntil` in future. |
| `PENDING_APPROVAL` | `APPROVED` | `approveQuote` | Quote is not expired (`now() <= validUntil`). Recorded approver name. |
| `PENDING_APPROVAL` | `REJECTED` | `rejectQuote` | Mandatory `rejectionReason` string provided. |
| `PENDING_APPROVAL` | `EXPIRED` | `evaluateQuoteExpiration` | `now() > validUntil`. |
| `PENDING_APPROVAL` | `DRAFT` | `reviseQuote` | Moves back to DRAFT for edits before re-sending. |
| `APPROVED` | `CONVERTED` | `convertQuoteToWorkOrder` | Quote must be `APPROVED`. Atomically calls `createWorkOrder` service. |

---

## 6. Conversion Architecture (Quote → WorkOrder)

### 6.1 Strict Single-Path Creation Invariant
To prevent divergence between standalone work order creation and quote-originated work order creation, `convertQuoteToWorkOrder` **must call the existing canonical `createWorkOrder` service** (Phase 1.6). It must not duplicate WorkOrder insertion logic.

### 6.2 Atomic Conversion Pipeline

```typescript
// Conceptual Flow in convertQuoteToWorkOrder.ts
export async function convertQuoteToWorkOrder(
  workspaceId: string,
  quoteId: string,
  actor: AuthContext
): Promise<ConvertQuoteResult> {
  // 1. Authenticate & Assert Permission (QUOTES_CONVERT)
  // 2. Fetch Quote with Line Items (must be status === APPROVED)
  // 3. Prepare WorkOrder Input Payload:
  //    - customerId = quote.customerId
  //    - locationId = quote.locationId
  //    - workTypeId = primary labor line item's workTypeId (or default)
  //    - title = quote.title
  //    - description = quote.description
  //    - sourceQuoteId = quote.id
  // 4. In interactive transaction:
  //    a. Call canonical createWorkOrder(workspaceId, payload, actor, tx)
  //    b. Update Quote: status = CONVERTED, convertedWorkOrderId = newWorkOrder.id, convertedAt = now(), convertedByMemberId = actor.id
  //    c. Insert QuoteHistory: eventType = CONVERTED, metadata = { workOrderId: newWorkOrder.id, workOrderNumber: newWorkOrder.workOrderNumber }
  // 5. Return { success: true, workOrder: newWorkOrder, quote: updatedQuote }
}
```

---

## 7. RBAC, Security & Commercial Visibility Specifications

### 7.1 Permissions

Declared in `lib/services/authorization/permissions.ts`:
- `quotes.view`: View quotes and line items within workspace.
- `quotes.create`: Create draft quotes and add line items.
- `quotes.update`: Modify draft quotes and edit line items.
- `quotes.delete`: Delete draft quotes.
- `quotes.send`: Mark quote as sent / pending approval.
- `quotes.approve`: Record customer approval or internal sign-off.
- `quotes.reject`: Record customer rejection with reason.
- `quotes.convert`: Convert approved quotes into operational WorkOrders.

### 7.2 Role Permission Matrix

| Role | View | Create | Update | Delete | Send | Approve/Reject | Convert |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **OWNER** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **ADMIN** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| **MANAGER** | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ |
| **DISPATCHER** | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ✅ |
| **TECHNICIAN** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **ACCOUNTANT** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

### 7.3 Technician Commercial Visibility Isolation
In compliance with the Phase 1.11 security requirements, field technicians are **strictly isolated from commercial quote visibility**:
- `TECHNICIAN` role has no `quotes.*` permissions.
- Technicians cannot query quotes, view unit prices, discounts, profit margins, or customer quotation history.
- When a Quote is converted to a WorkOrder, operational execution details (tasks, parts required, customer address) are consumed by the technician through the standard WorkOrder interface (Phase 1.6 / Phase 1.9) without exposing sensitive commercial pricing.

---

## 8. Domain Error Taxonomy

All errors extend pure domain error classes following Convention B (`code`, `statusCode`, `httpStatus`):

| Error Class | Code | HTTP Status | Trigger Condition |
| :--- | :--- | :---: | :--- |
| `QuoteNotFoundError` | `QUOTE_NOT_FOUND` | 404 | Quote ID does not exist in the tenant workspace. |
| `QuoteLineItemNotFoundError` | `QUOTE_LINE_ITEM_NOT_FOUND` | 404 | Line item does not exist or belong to the specified quote. |
| `QuoteStatusConflictError` | `QUOTE_STATUS_CONFLICT` | 409 | Attempting an illegal state transition (e.g. editing a CONVERTED quote). |
| `QuoteAlreadyConvertedError` | `QUOTE_ALREADY_CONVERTED` | 409 | Attempting to convert an already converted quote. |
| `QuoteExpiredError` | `QUOTE_EXPIRED` | 422 | Attempting to approve an expired quote. |
| `QuoteEmptyLineItemsError` | `QUOTE_EMPTY_LINE_ITEMS` | 422 | Attempting to send or convert a quote with 0 line items. |
| `InvalidQuoteCalculationError` | `INVALID_QUOTE_CALCULATION` | 422 | Negative amounts or mathematically invalid discount values. |
| `MissingRejectionReasonError` | `MISSING_REJECTION_REASON` | 422 | Rejecting a quote without specifying a reason. |

---

## 9. REST API Endpoint Specifications

All endpoints are scoped under `/api/workspaces/[workspaceId]/quotes`:

| Method | Path | Description | Required Permission |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/workspaces/[workspaceId]/quotes` | List quotes with pagination, status filter, and customer search | `quotes.view` |
| `POST` | `/api/workspaces/[workspaceId]/quotes` | Create a new quote header (DRAFT) | `quotes.create` |
| `GET` | `/api/workspaces/[workspaceId]/quotes/[quoteId]` | Get quote detail with line items, customer, and history | `quotes.view` |
| `PATCH` | `/api/workspaces/[workspaceId]/quotes/[quoteId]` | Update quote header metadata | `quotes.update` |
| `DELETE` | `/api/workspaces/[workspaceId]/quotes/[quoteId]` | Delete quote (only allowed if status is DRAFT) | `quotes.delete` |
| `POST` | `/api/workspaces/[workspaceId]/quotes/[quoteId]/lines` | Add a line item (recalculates totals) | `quotes.update` |
| `PATCH` | `/api/workspaces/[workspaceId]/quotes/[quoteId]/lines/[lineId]` | Update a line item (recalculates totals) | `quotes.update` |
| `DELETE` | `/api/workspaces/[workspaceId]/quotes/[quoteId]/lines/[lineId]` | Delete a line item (recalculates totals) | `quotes.update` |
| `POST` | `/api/workspaces/[workspaceId]/quotes/[quoteId]/send` | Mark quote as PENDING_APPROVAL | `quotes.send` |
| `POST` | `/api/workspaces/[workspaceId]/quotes/[quoteId]/approve` | Record approval | `quotes.approve` |
| `POST` | `/api/workspaces/[workspaceId]/quotes/[quoteId]/reject` | Record rejection with reason | `quotes.reject` |
| `POST` | `/api/workspaces/[workspaceId]/quotes/[quoteId]/convert` | Atomically convert quote to WorkOrder | `quotes.convert` |

---

## 10. Phase 1.11 Implementation Roadmap

| Milestone | Scope | Deliverables |
| :--- | :--- | :--- |
| **Phase 1.11.1** | Domain Architecture & Specification | `phase-1.11.1-quotes-estimates-domain-architecture.md`, audit walkthrough. |
| **Phase 1.11.2** | Prisma Schema & Database Migration | `Quote` (with `currencyCode`), `QuoteLineItem`, `QuoteHistory`, `WorkOrder.sourceQuoteId`, migration script, Prisma Client generation. |
| **Phase 1.11.3** | Domain Types, Errors & Zod Schemas | Pure domain error classes, read models, input DTOs, Zod validation contracts. |
| **Phase 1.11.4** | Calculation Engine & Pricing Snapshots | Server-authoritative Decimal calculation utility, line tax proration helpers, catalog freeze helpers. |
| **Phase 1.11.5** | Quote Header CRUD Services | `createQuote`, `getQuote`, `listQuotes`, `updateQuote`, `deleteQuote`. |
| **Phase 1.11.6** | Quote Line Item Services | `addQuoteLineItem`, `updateQuoteLineItem`, `removeQuoteLineItem`, `reorderQuoteLineItems`. |
| **Phase 1.11.7** | Quote Lifecycle Transition Services | `sendQuote`, `approveQuote`, `rejectQuote`, `reviseQuote`, `evaluateQuoteExpiration`. |
| **Phase 1.11.8** | Atomic WorkOrder Conversion Service | `convertQuoteToWorkOrder` invoking existing `createWorkOrder` with provenance metadata. |
| **Phase 1.11.9** | Quote Audit History & Query Services | `QuoteHistory` event recorder and historical timeline query services. |
| **Phase 1.11.10** | REST API Route Handlers & Utilities | REST endpoints, workspace isolation guards, HTTP error translation. |
| **Phase 1.11.11** | Integration Hardening & Test Suite | Vitest unit and integration tests covering calculation math, concurrency, and conversion pipeline. |

---

## 11. Deviations from Phase 1.11 Roadmap

Per Aforden architecture governance, any evolution from preliminary roadmap terminology is itemized and justified below:

### 11.1 `QuoteStatus` State Naming
- **Roadmap Terminology**: `SENT`, `ACCEPTED`, `REJECTED`, `EXPIRED`.
- **Architectural Specification**: `PENDING_APPROVAL`, `APPROVED`, `REJECTED`, `EXPIRED`, `CONVERTED`.
- **Justification**:
  1. `PENDING_APPROVAL` precisely describes the domain state (a proposal submitted to a client awaiting decision) rather than conflating state with email transport delivery (`SENT`).
  2. `APPROVED` aligns with standard approval terminology used throughout the platform (e.g., timesheet approvals, expense approvals) and pairs symmetrically with `REJECTED`.
  3. `CONVERTED` was added as an explicit terminal state to prevent re-conversion or modification of quotes that have successfully spawned operational WorkOrders.

### 11.2 `QuoteLineItemType` Categorization
- **Roadmap Terminology**: `SERVICE`, `PART`, `MATERIAL`, `CUSTOM`.
- **Architectural Specification**: `LABOR`, `PART`, `EXPENSE`, `CUSTOM`.
- **Justification**:
  1. `LABOR` directly maps to the `WorkType` catalog entity (Phase 1.5) representing billable technician time and catalog hourly rates.
  2. `MATERIAL` was consolidated into `PART` to match the canonical Phase 1.10 `Part` catalog schema, preventing dual overlapping concepts in the database.
  3. `EXPENSE` was introduced to represent pass-through commercial fees (e.g. permits, specialized equipment rentals, disposal surcharges) that are neither catalog labor nor inventoried parts.
