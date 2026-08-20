# Phase 1.6.1 — WorkOrder Domain Architecture & Specification

> **Document Status**: LOCKED FOR IMPLEMENTATION (Phase 1.6 Architecture Standard)  
> **Domain**: Work Order Management & Operational Execution  
> **Dependencies**: Phase 1.1 (Multi-Tenancy & User Auth), Phase 1.2 (Authentication & Authorization Foundation — roles, permissions, RBAC infrastructure, tenant isolation patterns), Phase 1.3 (Technicians & Organization), Phase 1.4 (Customer & Locations), Phase 1.5 (Service Catalog & Work Types)  
> **Target Schema & Service Implementation**: Phase 1.6.2 – Phase 1.6.12  

---

## Executive Summary

Phase 1.6 introduces the **WorkOrder** domain to Aforden. A WorkOrder represents the fundamental unit of operational field service execution. While previous phases established tenants (Phase 1.1), organizations and technicians (Phases 1.2–1.3), customers and service locations (Phase 1.4), and service catalog definitions (Phase 1.5), Phase 1.6 binds these entities into an active, trackable execution lifecycle.

This document establishes and locks the twelve architectural decisions governing the WorkOrder domain before any database schemas, services, API routes, or tests are written.

---

## Context Verification & Codebase Ground Truth

### 1. WorkType Consumption Contract (`getWorkTypeForWorkOrderConsumption`)
In Phase 1.5.11, the authoritative internal boundary for WorkOrder consumption was implemented and verified. The actual implementation in `lib/services/workType/getWorkTypeForWorkOrderConsumption.ts` is:

```typescript
import { prisma } from "@/lib/prisma";
import { requireWorkspaceAuthorization } from "@/lib/services/authorization/workspaceAuthorization";
import { PERMISSIONS } from "@/lib/services/authorization/permissions";
import { assertPermission } from "@/lib/services/authorization/permissionService";
import {
    WorkTypeNotFoundError,
    WorkTypeUnavailableForWorkOrderError,
} from "./workTypeErrors";
import type { WorkTypeWorkOrderConsumptionModel } from "./workType.types";

/**
 * Resolves a WorkType for downstream WorkOrder creation (Phase 1.6).
 *
 * Security & Invariants:
 *   - Caller must be an authenticated, active member of the target workspace.
 *   - Caller must hold the SERVICE_CATALOG_VIEW permission.
 *   - Target lookup is strictly tenant-scoped (`where: { id: workTypeId, workspaceId }`).
 *   - If not found in target workspace, throws `WorkTypeNotFoundError` (prevents cross-tenant leaks).
 *   - Asserts dynamic operational availability (`workType.status === ACTIVE && catalog.status === ACTIVE`).
 *   - If unavailable, throws `WorkTypeUnavailableForWorkOrderError`.
 *   - Returns the exact operational values needed for Phase 1.6 snapshotting.
 */
export async function getWorkTypeForWorkOrderConsumption(
    workspaceId: string,
    workTypeId: string,
): Promise<WorkTypeWorkOrderConsumptionModel> {
    // --- 1. Authentication & Workspace Authorization ---
    const authorization = await requireWorkspaceAuthorization(workspaceId);

    // --- 2. RBAC: Enforce SERVICE_CATALOG_VIEW permission ---
    assertPermission(
        authorization.membership.role,
        PERMISSIONS.SERVICE_CATALOG_VIEW,
    );

    // --- 3. Scoped WorkType Lookup with Parent Catalog ---
    const existing = await prisma.workType.findFirst({
        where: {
            id: workTypeId,
            workspaceId,
        },
        include: {
            catalog: true,
        },
    });

    if (!existing) {
        throw new WorkTypeNotFoundError();
    }

    // --- 4. Evaluate Dynamic Operational Availability ---
    const isAvailable =
        existing.status === "ACTIVE" && existing.catalog.status === "ACTIVE";

    if (!isAvailable) {
        throw new WorkTypeUnavailableForWorkOrderError();
    }

    // --- 5. Return Authoritative Consumption Snapshot Model ---
    return {
        workTypeId: existing.id,
        workspaceId: existing.workspaceId,
        catalogId: existing.catalogId,
        name: existing.name,
        code: existing.code,
        estimatedDuration: existing.estimatedDuration,
        isAvailableForWorkOrder: true,
    };
}
```

**Key Contract Properties:**
- **Signature**: `getWorkTypeForWorkOrderConsumption(workspaceId: string, workTypeId: string): Promise<WorkTypeWorkOrderConsumptionModel>`
- **Return Type**: `WorkTypeWorkOrderConsumptionModel` (`workTypeId`, `workspaceId`, `catalogId`, `name`, `code`, `estimatedDuration`, `isAvailableForWorkOrder`)
- **Error Behavior**:
  - Throws `WorkTypeNotFoundError` if `workTypeId` does not exist in `workspaceId` (enforcing cross-tenant isolation and 404 translation).
  - Throws `WorkTypeUnavailableForWorkOrderError` if `workType.status !== "ACTIVE"` or `catalog.status !== "ACTIVE"`.

### 2. WorkType Deletion Constraint Contract (Phase 1.5.9)
From `lib/services/workType/deleteWorkType.ts`:
```typescript
if (error?.code === "P2003") {
    throw new WorkTypeDeletionNotAllowedError(
        "Cannot delete work type because active downstream references exist.",
    );
}
```
Foreign key referential integrity (`onDelete: Restrict`) in PostgreSQL/Prisma prevents deleting any `WorkType` that has been consumed by a `WorkOrder`.

### 3. Existing Role & Permission Taxonomy
From `prisma/schema.prisma` and `lib/services/authorization/`:
- **Roles** (`enum MembershipRole`): `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER`, `TECHNICIAN`, `ACCOUNTANT`.
- **Existing WorkOrder Permissions** in `PERMISSIONS`:
  - `WORK_ORDERS_VIEW: "work_orders.view"`
  - `WORK_ORDERS_CREATE: "work_orders.create"`
  - `WORK_ORDERS_UPDATE: "work_orders.update"`
  - `WORK_ORDERS_ASSIGN: "work_orders.assign"`
  - `WORK_ORDERS_COMPLETE: "work_orders.complete"`

---

## 1. Domain Boundary

```
+---------------------------------------------------------------------------------------+
|                                    WORKSPACE (Tenant)                                 |
|                                                                                       |
|   +-------------------+       +--------------------+       +----------------------+   |
|   |     CUSTOMER      |       |  SERVICE LOCATION  |       |      WORK TYPE       |   |
|   | (Who receives it) |       | (Where it happens) |       | (Catalog definition) |   |
|   +---------+---------+       +---------+----------+       +----------+-----------+   |
|             |                           |                             |               |
|             | 1:N                       | 1:N                         | Snapshot &    |
|             |                           |                             | Restrict      |
|             v                           v                             v               |
|   +-------------------------------------------------------------------------------+   |
|   |                              WORK ORDER                                       |   |
|   |  - id, workOrderNumber (Human readable reference)                             |   |
|   |  - status (OPEN | ASSIGNED | IN_PROGRESS | ON_HOLD | COMPLETED | CANCELLED)   |   |
|   |  - priority (LOW | MEDIUM | HIGH | URGENT)                                    |   |
|   |  - title, description, internalNotes                                          |   |
|   |  - snapshot: workTypeName, workTypeCode, estimatedDuration                    |   |
|   |  - lifecycle timestamps: startedAt, completedAt, cancelledAt                  |   |
|   |  - assignedTechnicianId (nullable link to TechnicianProfile)                  |   |
|   +-------------------------------------------------------------------------------+   |
|                                         |                                             |
|                                         | 1:1 (optional assignment link)              |
|                                         v                                             |
|                       +-----------------------------------+                           |
|                       |        TECHNICIAN PROFILE         |                           |
|                       |    (Field worker performing work) |                           |
|                       +-----------------------------------+                           |
+---------------------------------------------------------------------------------------+
```

### 1.1 Definition
A **WorkOrder** is an operational execution instance representing a discrete, trackable service task performed for a Customer at a specific ServiceLocation within a Workspace. 

It is fundamentally distinct from a **WorkType**:
- **WorkType** is an abstract, reusable service catalog definition (a template specifying standard name, code, default duration, and catalog grouping).
- **WorkOrder** is a concrete operational event with real-world state, customer commitments, financial implications, location routing, assignment, execution notes, and historical lifecycle tracking.

### 1.2 Ownership vs. External References
- **WorkOrder Owns**:
  - Lifecycle state (`status`) and transition history.
  - Operational priority (`priority`).
  - Human-readable reference number (`workOrderNumber`).
  - Title, operational description, and execution/resolution notes.
  - Frozen snapshot fields copied at creation from WorkType (`workTypeName`, `workTypeCode`, `estimatedDuration`).
  - Operational timestamps (`createdAt`, `updatedAt`, `startedAt`, `completedAt`, `cancelledAt`).
  - Cancellation reason and resolution notes.
- **WorkOrder References (Does Not Own)**:
  - `workspaceId` $\rightarrow$ Tenant partition (`Workspace`).
  - `customerId` $\rightarrow$ Client entity receiving service (`Customer`).
  - `locationId` $\rightarrow$ Physical service address (`ServiceLocation`).
  - `workTypeId` $\rightarrow$ Originating catalog definition (`WorkType`).
  - `assignedTechnicianId` $\rightarrow$ Assigned field worker (`TechnicianProfile`).

### 1.3 Explicit Out-of-Scope Exclusions for Phase 1.6
To prevent feature creep and keep Phase 1.6 focused on robust core domain modeling, the following capabilities are **explicitly excluded** from Phase 1.6:
- ❌ **Scheduling & Calendar Planning** (multi-day scheduling, calendar views, Gantt timelines — deferred to Phase 1.7).
- ❌ **Dispatch Engine & Automated Matching** (skill-based automated routing, geo-distance matching — deferred to Phase 1.7).
- ❌ **Route Optimization** (turn-by-turn driving order, fleet route optimization).
- ❌ **GPS Tracking & Geofencing** (live technician location pings, on-site geofence entry/exit triggers).
- ❌ **Mobile App / Offline Synchronization** (local SQLite cache, delta conflict resolution).
- ❌ **Time Tracking & Timesheets** (granular clock-in/out timestamps, payroll hours).
- ❌ **Invoicing & Billing Generation** (converting work orders to invoice line items).
- ❌ **Payments & Payment Processing** (Stripe, card processing, cash collection).
- ❌ **Inventory & Parts Consumption** (deducting truck stock parts or warehouse inventory).
- ❌ **Customer Portal & Public Tracking Links** (external customer tracking URLs).
- ❌ **Customer Notifications** (automated SMS alerts, outbound email dispatch).
- ❌ **Frontend User Interfaces** (React components, Next.js page layouts, dashboard forms).

---

## 2. Relationships & Entity Interactions

| Related Entity | Relationship Classification | Cardinality & Nullability | Prisma Relation Rule | Deletion / Deactivation Effect |
| :--- | :--- | :--- | :--- | :--- |
| **Workspace** | **REQUIRED OPERATIONAL DEPENDENCY** (Tenant Anchor) | Many-to-One (`WorkOrder.workspaceId -> Workspace.id`), **Non-nullable** | `onDelete: Cascade` (when workspace is destroyed) | Deleting a workspace destroys all internal records. |
| **Customer** | **REQUIRED OPERATIONAL DEPENDENCY** | Many-to-One (`WorkOrder.customerId -> Customer.id`), **Non-nullable** | `onDelete: Restrict` | Hard deletion of Customer is **PREVENTED** (409 Conflict) if any WorkOrder exists. If Customer is deactivated (`INACTIVE`), existing WorkOrders remain readable, but creating new WorkOrders is **BLOCKED**. |
| **ServiceLocation** | **REQUIRED OPERATIONAL DEPENDENCY** | Many-to-One (`WorkOrder.locationId -> ServiceLocation.id`), **Non-nullable** | `onDelete: Restrict` | Hard deletion of Location is **PREVENTED** (409 Conflict) if referenced by any WorkOrder. Location must belong to the specified Customer. |
| **WorkType** | **HISTORICAL SNAPSHOT + REFERENCE** | Many-to-One (`WorkOrder.workTypeId -> WorkType.id`), **Non-nullable** | `onDelete: Restrict` | Hard deletion of WorkType is **PREVENTED** (409 Conflict) if referenced by any WorkOrder. Deactivating WorkType preserves existing WorkOrders unchanged; blocks new WorkOrders. |
| **TechnicianProfile** | **OPTIONAL OPERATIONAL REFERENCE** | Many-to-One (`WorkOrder.assignedTechnicianId -> TechnicianProfile.id`), **Nullable** | `onDelete: SetNull` | If a technician profile is deactivated/terminated, historical WorkOrders retain the reference. Active/in-progress work orders can be reassigned. New assignments to inactive technicians are **BLOCKED**. |

### 2.1 Justifications & Rejected Alternatives

#### Decision 1: `locationId` is Required (Non-Nullable)
- **Decision**: Every WorkOrder must reference a valid `ServiceLocation` belonging to the specified `Customer`.
- **Reasoning**: Aforden is explicitly a field service management SaaS. Operational field execution fundamentally occurs at a physical customer premise (residential address, commercial facility, job site).
- **Rejected Alternative**: Allowing nullable `locationId` for "remote/virtual" services. *Rejected because field service operations require routing, geocoding, and dispatch coordinates in Phase 1.7. Remote support can define a customer default/billing location.*

#### Decision 2: `customerId` is Required (Non-Nullable)
- **Decision**: Every WorkOrder must be bound to a `Customer`.
- **Reasoning**: Operational service delivery, customer history, liability, and downstream billing require an unambiguous customer recipient.
- **Rejected Alternative**: Anonymous or internal work orders without customers. *Rejected because internal facility maintenance should be modeled as an internal company customer entity rather than compromising customer relational integrity.*

#### Decision 3: `assignedTechnicianId` is Nullable
- **Decision**: WorkOrders can be created in an unassigned state (`OPEN`) with `assignedTechnicianId = null`, and assigned later.
- **Reasoning**: In real-world field service dispatch, customer call-takers and CSRs create work orders upon initial intake before dispatchers assign available technicians.

---

## 3. Snapshot Strategy & Historical Immutability

### 3.1 The Problem
In field service operations, service catalog definitions evolve over time:
- Prices and duration estimates change.
- Work types are renamed or reorganized into new catalogs.
- Codes are adjusted or deprecated.

If a WorkOrder only referenced `workTypeId` dynamically, changing the WorkType name from "Residential AC Maintenance" to "HVAC Tier 1 Inspection" would retroactively rewrite historical work orders completed years ago, corrupting audit trails, compliance records, and customer receipts.

### 3.2 Locked Snapshot Fields
At the exact moment of WorkOrder creation, the service calls `getWorkTypeForWorkOrderConsumption(workspaceId, workTypeId)` and copies the following fields directly onto the `WorkOrder` record:

| Source (`WorkType`) | Target (`WorkOrder` Column) | Type | Nullability | Description |
| :--- | :--- | :--- | :--- | :--- |
| `name` | `workTypeName` | `String` | Non-Nullable | Exact name of service at time of booking. |
| `code` | `workTypeCode` | `String?` | Nullable | Exact alphanumeric catalog code at time of booking. |
| `estimatedDuration` | `estimatedDuration` | `Int?` | Nullable | Estimated completion time in minutes at time of booking. |

### 3.3 Core Invariants
1. **Write-Once at Creation**: Snapshot fields are written strictly during the `createWorkOrder` transaction.
2. **Never Refreshed**: Future modifications to the parent `WorkType` or `ServiceCatalog` NEVER propagate to existing WorkOrders.
3. **Never Editable via Update Endpoints**: The `updateWorkOrder` endpoint will reject or strip any attempt to modify `workTypeName`, `workTypeCode`, or `estimatedDuration`.
4. **Server-Derived Only**: Client request payloads are strictly forbidden from supplying snapshot values. Any client-submitted snapshot properties in `POST /api/work-orders` are ignored; the server re-derives them directly from `getWorkTypeForWorkOrderConsumption()`.

---

## 4. Lifecycle State Machine & Status Transitions

```
                       +-------------------+
                       |                   |
                       |       OPEN        | <-----------------+
                       |                   |                   |
                       +---------+---------+                   |
                                 |                             |
                       assign    |   unassign                  |
                                 v                             |
                       +-------------------+                   |
                       |                   |                   |
                       |     ASSIGNED      +-------------------+
                       |                   |
                       +----+---------+----+
                            |         ^
                 start work |         | resume
                            v         |
                       +----+---------+----+
                       |                   |  pause work
                       |    IN_PROGRESS    +------------+
                       |                   |            |
                       +----+---------+----+            |
                            |         ^                 |
                   complete |         | resume          |
                            v         |                 v
                       +----+---------+----+   +--------+----------+
                       |                   |   |                   |
                       |     COMPLETED     |   |      ON_HOLD      |
                       |    (Terminal)     |   | (Paused execution)|
                       +-------------------+   +--------+----------+
                                                        |
                                                        | cancel
                                                        v
                                               +--------+----------+
                                               |                   |
                                               |     CANCELLED     |
   (From OPEN, ASSIGNED, IN_PROGRESS, ON_HOLD) |    (Terminal)     |
   ==========================================> |                   |
                                               +-------------------+
```

### 4.1 Status Enum
The `WorkOrderStatus` enum is locked as:
- `OPEN`: Created, unassigned, awaiting dispatch.
- `ASSIGNED`: Technician assigned, scheduled/dispatched, awaiting start of work.
- `IN_PROGRESS`: Technician has arrived on site and commenced work.
- `ON_HOLD`: Work temporarily suspended (e.g., awaiting parts, customer unavailable, weather delay).
- `COMPLETED`: Work finished successfully. (Terminal operational state).
- `CANCELLED`: Work aborted/cancelled. (Terminal operational state).

### 4.2 Transition Matrix

| From Status | To Status | Allowed Roles | Preconditions & Validation Rules | Side Effects |
| :--- | :--- | :--- | :--- | :--- |
| `OPEN` | `ASSIGNED` | `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER` | `assignedTechnicianId` must be provided and verified eligible. | Sets `assignedTechnicianId`. |
| `OPEN` | `CANCELLED` | `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER` | `cancellationReason` optional or required. | Sets `cancelledAt = now()`. |
| `ASSIGNED` | `OPEN` | `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER` | None (Unassign action). | Clears `assignedTechnicianId = null`. |
| `ASSIGNED` | `IN_PROGRESS` | `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER`, `TECHNICIAN`* | *Technician can only transition if assigned to this WorkOrder. | Sets `startedAt = now()` if null. |
| `ASSIGNED` | `ON_HOLD` | `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER` | `holdReason` required. | Records hold metadata. |
| `ASSIGNED` | `CANCELLED` | `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER` | `cancellationReason` recorded. | Sets `cancelledAt = now()`. |
| `IN_PROGRESS` | `COMPLETED` | `OWNER`, `ADMIN`, `MANAGER`, `TECHNICIAN`* | `assignedTechnicianId !== null`. *Technician must be assigned worker. | Sets `completedAt = now()`. |
| `IN_PROGRESS` | `ON_HOLD` | `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER`, `TECHNICIAN`* | `holdReason` required. | Records hold metadata. |
| `IN_PROGRESS` | `CANCELLED` | `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER` | `cancellationReason` recorded. | Sets `cancelledAt = now()`. |
| `ON_HOLD` | `IN_PROGRESS` | `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER`, `TECHNICIAN`* | Resumes active work. | Clears hold state. |
| `ON_HOLD` | `ASSIGNED` | `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER` | Re-queues assigned work. | Clears hold state. |
| `ON_HOLD` | `CANCELLED` | `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER` | `cancellationReason` recorded. | Sets `cancelledAt = now()`. |

*Any status transition pair not explicitly listed in the table above is strictly **INVALID** and will be rejected with `WORK_ORDER_INVALID_STATUS_TRANSITION` (409 Conflict).*

### 4.3 Terminal State & Cancellation Rules
1. **Terminal States**: `COMPLETED` and `CANCELLED` are strictly irreversible terminal states.
   - Once a WorkOrder is `COMPLETED`, it cannot be moved to `OPEN`, `ASSIGNED`, `IN_PROGRESS`, `ON_HOLD`, or `CANCELLED`.
   - Once a WorkOrder is `CANCELLED`, it cannot be re-opened. A new WorkOrder must be created if service is required again.
2. **Cancellation Eligibility**: Cancellation is allowed from `OPEN`, `ASSIGNED`, `IN_PROGRESS`, and `ON_HOLD`. It is forbidden from `COMPLETED`.
3. **Completion Preconditions**:
   - WorkOrder must currently be `IN_PROGRESS`.
   - WorkOrder must have an assigned technician (`assignedTechnicianId !== null`).
   - Server automatically stamps `completedAt = new Date()`.

---

## 5. Priority Model

### 5.1 Priority Enum
The `WorkOrderPriority` enum is locked as:
- `LOW`: Non-urgent maintenance, deferred tasks.
- `MEDIUM`: Standard operational work order (Default).
- `HIGH`: Priority customer, time-sensitive repair.
- `URGENT`: Emergency service outage, safety hazard, immediate response required.

### 5.2 Creation & Mutation Rules
- **Creation Default**: If priority is omitted during creation, it defaults to `MEDIUM`.
- **Status Mutability**: Priority can be updated while in non-terminal states (`OPEN`, `ASSIGNED`, `IN_PROGRESS`, `ON_HOLD`). Priority is locked and immutable in `COMPLETED` and `CANCELLED` states.
- **RBAC Gating**: `OWNER`, `ADMIN`, `MANAGER`, and `DISPATCHER` may change priority. `TECHNICIAN` and `ACCOUNTANT` cannot change priority (403 Forbidden).

---

## 6. Deletion & Deactivation Interaction Policy

### 6.1 WorkType Deletion
- **Policy**: Hard deletion of a `WorkType` referenced by any `WorkOrder` is **STRICTLY PREVENTED**.
- **Enforcement**: PostgreSQL foreign key constraint `onDelete: Restrict` on `WorkOrder.workTypeId -> WorkType.id`.
- **Error Mapping**: Prisma error `P2003` is caught and translated to `WorkTypeDeletionNotAllowedError` (409 Conflict), exactly as established in Phase 1.5.9.

### 6.2 ServiceCatalog Deletion
- **Policy**: `ServiceCatalog` cannot be deleted if it contains any `WorkType` referenced by a `WorkOrder`.
- **Enforcement**: Phase 1.5.8 requires catalogs to be empty before deletion. Since referenced WorkTypes cannot be deleted, the parent catalog is indirectly protected from deletion.

### 6.3 Customer Deletion & Deactivation
- **Customer Deletion**: Hard deletion of a `Customer` with existing `WorkOrder` records is **PREVENTED** via foreign key `onDelete: Restrict`. Prisma `P2003` translates to `CustomerDeletionNotAllowedError` / `CustomerHasProtectedReferencesError` (409 Conflict).
- **Customer Deactivation (`INACTIVE`)**:
  - Existing WorkOrders remain intact, readable, and processable.
  - Creating **new** WorkOrders for an inactive Customer is **BLOCKED** with `WORK_ORDER_CUSTOMER_INACTIVE` (400 Bad Request).

### 6.4 Location Deletion & Deactivation
- **Location Deletion**: Hard deletion of a `ServiceLocation` with existing `WorkOrder` records is **PREVENTED** via foreign key `onDelete: Restrict`. Prisma `P2003` translates to `ServiceLocationDeletionNotAllowedError` (409 Conflict).

### 6.5 Technician Deletion & Deactivation
- **Technician Deactivation/Termination**: If an employee or technician profile is marked `INACTIVE`, `TERMINATED`, or `ON_LEAVE`:
  - Historical completed/cancelled WorkOrders preserve `assignedTechnicianId` for audit integrity.
  - Open/assigned WorkOrders can be reassigned to another active technician.
  - Assigning a new WorkOrder to an inactive technician is **BLOCKED** via `assertTechnicianAssignmentEligibility` (Phase 1.3).

### 6.6 WorkOrder Deletion Policy
- **Policy**: Hard deletion of WorkOrders is strictly an exceptional administrative cleanup action.
  - **Explicit Status Deletion Invariant**: Hard deletion is permitted **ONLY** when a WorkOrder is in `OPEN` or `CANCELLED` status.
  - **Non-Deletable Statuses**: WorkOrders in `ASSIGNED`, `ON_HOLD`, `IN_PROGRESS`, and `COMPLETED` statuses are strictly **NON-DELETABLE**. Any deletion attempt against these statuses is rejected with `WORK_ORDER_DELETION_NOT_ALLOWED` (409 Conflict).
  - If an `ASSIGNED` or `ON_HOLD` work order must be removed administratively, it must first be unassigned back to `OPEN` (via unassign) or transitioned to `CANCELLED` before deletion can be requested.
  - Deletion of eligible (`OPEN` or `CANCELLED`) WorkOrders is restricted exclusively to `OWNER` and `ADMIN` roles holding the `work_orders.delete` permission.
  - Operational cancellation (`status = CANCELLED`) remains the standard business lifecycle mechanism for aborted jobs.

---

## 7. Error Taxonomy & HTTP Status Mapping

All WorkOrder domain errors are pure TypeScript domain error classes translated into standard JSON error responses by `handleWorkOrderApiError()`.

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE_STRING",
    "message": "Human-readable sanitised description.",
    "details": {}
  }
}
```

| Domain Error Class | Error Code String | HTTP Status | Trigger Condition |
| :--- | :--- | :---: | :--- |
| `WorkOrderNotFoundError` | `WORK_ORDER_NOT_FOUND` | **404** | WorkOrder does not exist in the authorized workspace (also used for cross-tenant IDOR protection). |
| `WorkOrderCustomerNotFoundError` | `WORK_ORDER_CUSTOMER_NOT_FOUND` | **404** | Specified `customerId` not found in the authorized workspace. |
| `WorkOrderCustomerInactiveError` | `WORK_ORDER_CUSTOMER_INACTIVE` | **400** | Attempted to create a WorkOrder for a deactivated/inactive Customer. |
| `WorkOrderLocationNotFoundError` | `WORK_ORDER_LOCATION_NOT_FOUND` | **404** | Specified `locationId` not found or does not belong to the specified Customer. |
| `WorkTypeNotFoundError` | `WORK_TYPE_NOT_FOUND` | **404** | Specified `workTypeId` not found in workspace (from Phase 1.5). |
| `WorkTypeUnavailableForWorkOrderError` | `WORK_TYPE_UNAVAILABLE_FOR_WORK_ORDER` | **409** | WorkType or its parent ServiceCatalog is inactive (from Phase 1.5). |
| `WorkOrderTechnicianNotFoundError` | `WORK_ORDER_TECHNICIAN_NOT_FOUND` | **404** | Specified technician profile not found in workspace. |
| `WorkOrderTechnicianNotEligibleError` | `WORK_ORDER_TECHNICIAN_NOT_ELIGIBLE` | **422** | Technician is inactive, suspended, or not eligible for assignment. |
| `WorkOrderInvalidStatusTransitionError` | `WORK_ORDER_INVALID_STATUS_TRANSITION` | **409** | Requested `(from, to)` status transition is not permitted by state machine. |
| `WorkOrderAssignmentNotAllowedError` | `WORK_ORDER_ASSIGNMENT_NOT_ALLOWED` | **409** | Cannot assign technician to a WorkOrder in `COMPLETED` or `CANCELLED` status. |
| `WorkOrderCompletionPreconditionFailedError` | `WORK_ORDER_COMPLETION_PRECONDITION_FAILED` | **422** | Missing required technician assignment or not currently `IN_PROGRESS`. |
| `WorkOrderCancellationNotAllowedError` | `WORK_ORDER_CANCELLATION_NOT_ALLOWED` | **409** | Attempted to cancel an already `COMPLETED` WorkOrder. |
| `WorkOrderImmutableError` | `WORK_ORDER_IMMUTABLE` | **409** | Attempted to mutate fields on a terminal (`COMPLETED` / `CANCELLED`) WorkOrder. |
| `WorkOrderDeletionNotAllowedError` | `WORK_ORDER_DELETION_NOT_ALLOWED` | **409** | Attempted to delete an active, in-progress, or completed WorkOrder. |
| `DuplicateWorkOrderReferenceError` | `DUPLICATE_WORK_ORDER_REFERENCE` | **409** | Uniqueness conflict on `[workspaceId, workOrderNumber]`. |
| `ZodError` | `VALIDATION_ERROR` | **422** | Request body/query failed schema validation. |
| `SyntaxError` | `INVALID_REQUEST` | **400** | Malformed JSON in HTTP request body. |
| `UnauthorizedError` | `UNAUTHORIZED` | **401** | Missing or invalid user session. |
| `WorkspaceAccessDeniedError` | `FORBIDDEN` | **403** | User suspended, inactive, or not a member of the workspace. |
| `ForbiddenError` | `FORBIDDEN` | **403** | Caller role lacks required permission for this operation. |
| `Error` (Generic fallback) | `INTERNAL_SERVER_ERROR` | **500** | Unhandled runtime exception. |

---

## 8. Role-Based Access Control (RBAC) Matrix

### 8.1 Role Permission Definitions

| Permission Constant | String Value | Classification | Description |
| :--- | :--- | :--- | :--- |
| `PERMISSIONS.WORK_ORDERS_VIEW` | `"work_orders.view"` | Existing | View WorkOrders in authorized workspace. |
| `PERMISSIONS.WORK_ORDERS_CREATE` | `"work_orders.create"` | Existing | Create new WorkOrders in workspace. |
| `PERMISSIONS.WORK_ORDERS_UPDATE` | `"work_orders.update"` | Existing | Update mutable fields and execution notes. |
| `PERMISSIONS.WORK_ORDERS_ASSIGN` | `"work_orders.assign"` | Existing | Assign/reassign technicians to WorkOrders. |
| `PERMISSIONS.WORK_ORDERS_COMPLETE` | `"work_orders.complete"` | Existing | Mark WorkOrders as `COMPLETED`. |
| `PERMISSIONS.WORK_ORDERS_DELETE` | `"work_orders.delete"` | **NEW PERMISSION** | Administratively purge draft/cancelled WorkOrders. |

### 8.2 Role Assignment Matrix

| Membership Role | View | Create | Update | Assign | Status Transition (Start/Hold/Cancel) | Complete | Delete | Scoped Visibility Rule |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **OWNER** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Full Workspace Access |
| **ADMIN** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | Full Workspace Access |
| **MANAGER** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | Full Workspace Access |
| **DISPATCHER** | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ | Full Workspace Access |
| **TECHNICIAN** | ✅ | ❌ | ✅* | ❌ | ✅* | ✅* | ❌ | **Scoped strictly to WorkOrders assigned to this technician** |
| **ACCOUNTANT** | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | Full Workspace Read-Only (for billing/audit) |

*\*Technician Permissions & Scope Rules:*
- **List & Read Queries**: When accessed by a `TECHNICIAN`, the service automatically filters to `where: { assignedTechnician: { employee: { workspaceMember: { userId: session.user.id } } } }`. Technicians cannot view work orders assigned to other technicians.
- **Update & Status Changes**: Technicians can only update notes or transition status (`IN_PROGRESS`, `ON_HOLD`, `COMPLETED`) on WorkOrders currently assigned to them.

---

## 9. Multi-Tenant Isolation & Security Rules

### 9.1 Workspace Resolution Invariant
1. **Never Trust Request Body**: `workspaceId` is NEVER accepted or parsed from client request bodies (`POST`/`PATCH`/`PUT`).
2. **Verified Request Resolution Mechanism**: In full alignment with Phase 1.4 and Phase 1.5 route handlers, `workspaceId` is resolved via the standard header/query extraction helper:
   ```typescript
   // Quoted from lib/utils/serviceCatalogApiError.ts (and app/api/customers/[customerId]/contacts/route.ts)
   export function extractWorkspaceId(request: Request): string | null {
       return (
           request.headers.get("x-workspace-id") ||
           request.headers.get("workspace-id") ||
           new URL(request.url).searchParams.get("workspaceId") ||
           null
       );
   }
   ```
   If `extractWorkspaceId(request)` returns `null`, the route immediately short-circuits with `400 Bad Request` (`MISSING_WORKSPACE`).
3. **Session Verification**: The resolved `workspaceId` is passed into core services where `requireWorkspaceAuthorization(workspaceId)` verifies the active user session (`auth()`), ensures `user.status === "ACTIVE"`, verifies workspace existence, and confirms active workspace membership (`membership.status === "ACTIVE"`).

### 9.2 Same-Workspace Relational Parity Invariant
Every related entity referenced by a WorkOrder must belong to the exact same `workspaceId`. The `createWorkOrder` and `updateWorkOrder` services must explicitly enforce:

$$\text{Customer.workspaceId} == \text{workspaceId}$$
$$\text{ServiceLocation.customer.workspaceId} == \text{workspaceId} \land \text{ServiceLocation.customerId} == \text{customerId}$$
$$\text{WorkType.workspaceId} == \text{workspaceId}$$
$$\text{TechnicianProfile.employee.workspaceId} == \text{workspaceId} \quad (\text{if assigned})$$

### 9.3 Cross-Tenant Error Handling (404 Not Found Precedent)
If any referenced entity (`customerId`, `locationId`, `workTypeId`, `technicianId`, or `workOrderId`) exists in the database but belongs to a different workspace, the system MUST return **404 Not Found** (e.g., `WorkOrderNotFoundError`, `CustomerNotFoundError`, `WorkTypeNotFoundError`). 

*Returning 403 Forbidden is strictly prohibited for cross-tenant lookups as it would leak resource existence across tenant boundaries (IDOR prevention).*

#### Verified Codebase Precedent Quotes:
- **Phase 1.4 Customer Domain** ([`lib/services/customer/deleteCustomer.ts`](file:///d:/Download/aforden/lib/services/customer/deleteCustomer.ts#L73-L82)):
  ```typescript
  // Tenant-Scoped Customer Lookup
  const existing = await prisma.customer.findFirst({
      where: {
          id: customerId,
          workspaceId,
      },
  });

  if (!existing) {
      throw new CustomerNotFoundError(); // Translated to 404 in customerApiError.ts
  }
  ```
- **Phase 1.5 WorkType Domain** ([`lib/services/workType/getWorkType.ts`](file:///d:/Download/aforden/lib/services/workType/getWorkType.ts#L32-L44)):
  ```typescript
  // Scoped WorkType Query with Parent Catalog
  const workType = await prisma.workType.findFirst({
      where: {
          id: workTypeId,
          workspaceId,
      },
      include: {
          catalog: true,
      },
  });

  if (!workType) {
      throw new WorkTypeNotFoundError(); // Translated to 404 in serviceCatalogApiError.ts
  }
  ```
- **Phase 1.5 Consumption Boundary Test** ([`tests/service-catalog/work-type-workorder-consumption.test.ts`](file:///d:/Download/aforden/tests/service-catalog/work-type-workorder-consumption.test.ts#L345-L376)):
  ```typescript
  describe("3. Tenant Isolation & IDOR Protection", () => {
      it("throws WorkTypeNotFoundError when attempting to consume cross-tenant WorkType", async () => {
          // Alpha workspace attempts to consume Beta WorkType
          await expect(
              getWorkTypeForWorkOrderConsumption(WS_ALPHA, "wt_beta_work"),
          ).rejects.toThrow(WorkTypeNotFoundError);
      });
  });
  ```

---

## 10. API Surface (Naming & Actions)

The REST API routes to be implemented in Phase 1.6.8 are locked as follows:

| HTTP Method | Route Path | Action | Permission Required |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/work-orders` | List, search, filter, and paginate WorkOrders | `WORK_ORDERS_VIEW` |
| `POST` | `/api/work-orders` | Create a new WorkOrder | `WORK_ORDERS_CREATE` |
| `GET` | `/api/work-orders/summary` | Get operational summary metrics (counts by status/priority) | `WORK_ORDERS_VIEW` |
| `GET` | `/api/work-orders/[workOrderId]` | Get single WorkOrder details with snapshot and relations | `WORK_ORDERS_VIEW` |
| `PATCH` | `/api/work-orders/[workOrderId]` | Update mutable metadata (title, description, priority) | `WORK_ORDERS_UPDATE` |
| `POST` | `/api/work-orders/[workOrderId]/assign` | Assign or reassign technician | `WORK_ORDERS_ASSIGN` |
| `DELETE` | `/api/work-orders/[workOrderId]/assign` | Unassign technician (revert to `OPEN`) | `WORK_ORDERS_ASSIGN` |
| `PATCH` | `/api/work-orders/[workOrderId]/status` | Transition lifecycle status (`OPEN`, `IN_PROGRESS`, etc.) | `WORK_ORDERS_UPDATE` / `WORK_ORDERS_COMPLETE` |
| `DELETE` | `/api/work-orders/[workOrderId]` | Administratively delete draft/cancelled WorkOrder | `WORK_ORDERS_DELETE` |

---

## 11. Identifier & Reference Number Strategy

### 11.1 The Requirement
WorkOrders require both:
1. **Internal Technical ID**: A high-entropy, collision-free CUID (`id: String @id @default(cuid())`) for database foreign keys and API routing.
2. **Human-Readable Reference Number**: A customer-facing, easily communicable reference number (`workOrderNumber: String`) used on phone calls, printed work orders, emails, and technician dispatch tickets.

### 11.2 Locked Reference Number Format
- **Format**: `WO-YYYY-XXXXXX` (e.g., `WO-2026-000001`, `WO-2026-000142`)
  - `WO`: Standard prefix for Work Order.
  - `YYYY`: 4-digit calendar year of creation.
  - `XXXXXX`: 6-digit zero-padded sequential number scoped per workspace.
- **Uniqueness Constraint**: Unique per workspace: `@@unique([workspaceId, workOrderNumber])`.

### 11.3 Generation Strategy
- At creation time, the service queries the maximum existing `workOrderNumber` for the workspace within the current year inside a transaction, increments by 1, and formats the zero-padded string.
- If a concurrency collision occurs on insertion, the transaction retries with the next sequence number up to 3 times before failing safely.

---

## 12. Phase 1.7+ Integration Boundary

### 12.1 What Phase 1.6 Delivers to Phase 1.7 (Scheduling & Dispatch)
Phase 1.6 provides a complete operational core that Phase 1.7 can consume without modifying Phase 1.6 schemas:
1. **WorkOrder State & Identity**: Clean `id`, `workOrderNumber`, `status`, `priority`.
2. **Execution Timing Estimates**: Frozen `estimatedDuration` (in minutes) ready for calendar slotting.
3. **Geographical Coordinates**: `locationId` linking directly to `ServiceLocation.latitude` and `ServiceLocation.longitude` for distance calculation and map dispatching.
4. **Technician Link**: `assignedTechnicianId` linking to `TechnicianProfile`.
5. **Phase 1.3 `TechnicianAssignment` Bridge**: When Phase 1.7 schedules a WorkOrder into a specific calendar window (`startsAt`, `endsAt`), it creates a `TechnicianAssignment` record with `workReferenceId = workOrder.id` and `workType = "WORK"`.

### 12.2 What is Deferred to Phase 1.7
- Calendar scheduling time slots (`startsAt`, `endsAt` on calendar grid).
- Multi-technician crew dispatching.
- Route order sequencing and travel time calculation.
- Dispatcher drag-and-drop board.

---

## Summary of Decisions, Inconsistencies & Open Questions

### 1. New Permissions Flagged (Not in Current Authorization System)
- **`PERMISSIONS.WORK_ORDERS_DELETE`** (`"work_orders.delete"`):
  - *Current Status*: Does not exist in `lib/services/authorization/permissions.ts`.
  - *Proposed Decision*: Added to `PERMISSIONS` and granted only to `OWNER` and `ADMIN` roles for administrative cleanup of draft/cancelled records.

### 2. New Error Codes Flagged
The following error codes are newly introduced for the WorkOrder domain and follow the standard error conventions:
- `WORK_ORDER_NOT_FOUND` (404)
- `WORK_ORDER_CUSTOMER_NOT_FOUND` (404)
- `WORK_ORDER_CUSTOMER_INACTIVE` (400)
- `WORK_ORDER_LOCATION_NOT_FOUND` (404)
- `WORK_ORDER_TECHNICIAN_NOT_FOUND` (404)
- `WORK_ORDER_TECHNICIAN_NOT_ELIGIBLE` (422)
- `WORK_ORDER_INVALID_STATUS_TRANSITION` (409)
- `WORK_ORDER_ASSIGNMENT_NOT_ALLOWED` (409)
- `WORK_ORDER_COMPLETION_PRECONDITION_FAILED` (422)
- `WORK_ORDER_CANCELLATION_NOT_ALLOWED` (409)
- `WORK_ORDER_IMMUTABLE` (409)
- `WORK_ORDER_DELETION_NOT_ALLOWED` (409)
- `DUPLICATE_WORK_ORDER_REFERENCE` (409)

### 3. Gaps / Inconsistencies Identified in Earlier Phases
- **Technician Visibility Scope**: In earlier phases (Phases 1.3–1.5), `TECHNICIAN` role had global read permissions (`customers.view`, `service_catalog.view`). For WorkOrders, full workspace visibility for technicians would expose sensitive customer work orders assigned to other technicians. In Section 8, we explicitly locked that `TECHNICIAN` queries are scoped exclusively to their own assigned WorkOrders.
- **`TechnicianAssignment.workReferenceId` Relation**: In Phase 1.3, `TechnicianAssignment` was created with a string `workReferenceId` without an explicit Prisma `@relation` because `WorkOrder` was not yet created. In Phase 1.6, `WorkOrder` will have its own direct `assignedTechnicianId` foreign key to `TechnicianProfile` for O(1) operational lookups.

### 4. Open Questions for Sign-off Before Phase 1.6.2
1. **Reference Number Formatting**: Does the `WO-YYYY-XXXXXX` format (e.g. `WO-2026-000001`) meet all business requirements, or should workspace owners be permitted to customize their prefix in workspace settings in a future phase?
2. **Technician Self-Assignment**: Should `TECHNICIAN` role ever be permitted to self-assign an unassigned `OPEN` work order (e.g. "claim ticket"), or must assignment strictly remain the duty of `DISPATCHER`, `MANAGER`, `ADMIN`, `OWNER`? (Currently locked to Dispatcher/Manager/Admin/Owner).
