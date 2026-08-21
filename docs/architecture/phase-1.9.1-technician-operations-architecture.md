# Phase 1.9.1 — Technician Operations Domain Architecture & Specification

> **Document Status**: LOCKED FOR IMPLEMENTATION (Phase 1.9 Architecture Standard)  
> **Domain**: Technician Field Operations & Operational Execution  
> **Dependencies**: Phase 1.1 (Multi-Tenancy & Workspace Partitioning), Phase 1.2 (Authentication & RBAC), Phase 1.3 (Technicians & Organization), Phase 1.4 (Customers & Service Locations), Phase 1.5 (Service Catalog & Work Types), Phase 1.6 (Work Orders), Phase 1.7 (Assets & Equipment), Phase 1.8 (Scheduling & Dispatch)  
> **Target Schema & Service Implementation**: Phase 1.9.2 – Phase 1.9.12  

---

## Executive Summary

Phase 1.9 introduces the **Technician Operations** domain to the Aforden Field Service Management (FSM) platform. In prior phases, the platform established tenant isolation (Phase 1.1), authentication, users, and RBAC (Phase 1.2), technician profiles and organizational hierarchies (Phase 1.3), customer premises and service locations (Phase 1.4), cataloged service offerings (Phase 1.5), operational Work Orders and canonical lifecycle tracking (Phase 1.6), physical customer equipment (Phase 1.7), and calendar scheduling, conflict detection, and dispatch management (Phase 1.8).

Phase 1.9 turns the technician from a passively assigned resource into an **active operational field worker**. The domain establishes the operational execution workflows: viewing assigned and dispatched jobs, acknowledging dispatches, managing travel status, starting on-site field execution, pausing/holding jobs with operational reasons, resuming work, completing work orders subject to business preconditions, logging operational field labor time, recording execution notes, and capturing completion evidence.

This document serves as the binding architectural contract for Phase 1.9. It defines all domain boundaries, identity resolution paths, access and isolation policies, lifecycle integration contracts, audit integrations, time tracking models, and API interfaces prior to implementing services or schemas in downstream sub-phases.

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
|                           +---------------------------------------+                               |
|                           |              WORK ORDER               |                               |
|                           |              (Phase 1.6)              |                               |
|                           |  - status: OPEN | ASSIGNED | ...      |                               |
|                           |  - assignedTechnicianId               |                               |
|                           +-------------------+-------------------+                               |
|                                               |                                                   |
|                                               | 1:N Relation                                      |
|                                               v                                                   |
|   +-----------------------+       +---------------------------------------+                       |
|   |  TECHNICIAN PROFILE   |       |         SCHEDULE APPOINTMENT          |                       |
|   |      (Phase 1.3)      |<------+              (Phase 1.8)              |                       |
|   |  - id, employeeId     | 1:N   |  - status: SCHEDULED | RESCHEDULED... |                       |
|   |  - skills, areas      |       |  - dispatchStatus: PENDING | DISP...  |                       |
|   +-----------+-----------+       |  - fieldExecutionStartedAt            |                       |
|               |                   +-------------------+-------------------+                       |
|               | Identity                              | Dispatch / Acknowledgment                 |
|               v                                       v                                           |
|   =============================================================================================   |
|   |                              TECHNICIAN OPERATIONS DOMAIN                                 |   |
|   |                                       (Phase 1.9)                                         |   |
|   |   +-----------------------------------------------------------------------------------+   |   |
|   |   |  - Assigned Work Queue Projections (Tenant & Tech Scoped)                         |   |   |
|   |   |  - Operational Actions (Acknowledge Dispatch, Start Travel, Start Work, Hold, ...) |   |   |
|   |   |  - Operational Labor Time Tracking (TechnicianTimeEntry: TRAVEL, ON_SITE, BREAK)  |   |   |
|   |   |  - Operational Execution & Completion Notes                                       |   |   |
|   |   |  - Completion Evidence Referencing (Media URI integration)                        |   |   |
|   |   +-----------------------------------------------------------------------------------+   |   |
|   =============================================================================================   |
+---------------------------------------------------------------------------------------------------+
```

---

## 1. Domain Boundary & Ownership Matrix

### 1.1 Strict Domain Ownership Rules

To prevent domain duplication and cross-boundary pollution, ownership rules are strictly established:

| Domain | Owns | Does NOT Own / Consumes |
| :--- | :--- | :--- |
| **TechnicianProfile** (Phase 1.3) | Technician identity, employee linkage (`TechnicianProfile -> Employee -> WorkspaceMember -> User`), skills, service areas, recurring working hours, availability exceptions. | Work Order execution, calendar bookings, operational time entries, job dispatch status. |
| **WorkOrder** (Phase 1.6) | WorkOrder entity, canonical status state machine (`OPEN`, `ASSIGNED`, `IN_PROGRESS`, `ON_HOLD`, `COMPLETED`, `CANCELLED`), priority, catalog snapshot fields (`workTypeName`, `workTypeCode`, `estimatedDuration`), assignment reference (`assignedTechnicianId`), completion preconditions, canonical `WorkOrderHistory`. | Field calendar appointments, dispatch workflow, technician time logs, GPS telemetry. |
| **Scheduling & Dispatch** (Phase 1.8) | `ScheduleAppointment` entity, calendar intervals `[scheduledStart, scheduledEnd)`, appointment lifecycle (`SCHEDULED`, `RESCHEDULED`, `CANCELLED`, `COMPLETED`), dispatch lifecycle (`PENDING_DISPATCH`, `DISPATCHED`, `ACKNOWLEDGED`), non-overlapping conflict engine, `ScheduleAppointmentHistory`. | Real-world field operational actions (travel, on-site arrival, checklist progression, pause reasons). |
| **Technician Operations** (Phase 1.9) | Technician-facing execution workflows, technician assigned queue projections, field operational actions (travel start, on-site start, hold, resume, complete), field execution time stamps (`ScheduleAppointment.fieldExecutionStartedAt`), operational time tracking (`TechnicianTimeEntry`), execution notes, completion workflows. | Canonical WorkOrder state transitions (delegates to Phase 1.6), calendar conflict engine (delegates to Phase 1.8), payroll, billing, inventory consumption. |
| **Inventory & Parts** (Phase 1.10) | Parts catalog, truck stock, warehouse quantities, reservations, stock adjustments, part consumption records. | Technician operations or time entries. |
| **Quotes & Estimates** (Phase 1.11) | Quotes, estimates, line items, customer approval signatures, quote-to-workorder conversions. | Field execution status. |
| **Invoicing & Payments** (Phase 1.12) | Invoices, payment processing, tax calculation, payment reconciliation, billing generation. | Operational labor time recording (consumes labor hours from 1.9 for billing lines). |
| **Notifications** (Phase 1.13) | Outbound SMS, push notifications, email communications, webhook event distribution. | Operational state transitions. |
| **Reporting & Analytics** (Phase 1.14) | Aggregated KPIs, technician utilization metrics, SLA compliance reports, mean-time-to-complete metrics. | Live operational transactions. |

---

## 2. Fundamental Architectural Invariants

### 2.1 Invariant 1: Single Authority Status Machine (NO Second Status Machine)
Technician Operations **must NEVER create a secondary or competing status machine**.
- The canonical lifecycle status of a WorkOrder is defined exclusively by `WorkOrderStatus` in Phase 1.6 (`OPEN`, `ASSIGNED`, `IN_PROGRESS`, `ON_HOLD`, `COMPLETED`, `CANCELLED`).
- All state changes originating from technician field actions (starting work, holding work, resuming work, completing work) **must delegate directly** to the authoritative `transitionWorkOrderStatus()` service from `lib/services/workOrder/transitionWorkOrderStatus.ts`.
- There will be no `TechnicianWorkOrderStatus`, no parallel `operationalStatus` enum, and no bypass of Phase 1.6 completion preconditions.

### 2.2 Invariant 2: 100% Server-Derived Technician Identity (No Client-Side Substitution)
- For all technician operational endpoints (`/api/technician/*`), technician identity is **100% strictly derived from the authenticated session**:
  $$\text{Session (auth())} \longrightarrow \text{User} \longrightarrow \text{WorkspaceMember} \longrightarrow \text{Employee} \longrightarrow \text{TechnicianProfile}$$
- Request bodies on technician endpoints **cannot supply or override `technicianId` or `workspaceId`**. Any client-supplied technician identifier in a request body is strictly forbidden and ignored.
- Administrative overrides by `OWNER`, `ADMIN`, or `MANAGER` (e.g., dispatch reassignment, administrative status change) are performed via the existing administrative WorkOrder and Scheduling services (`transitionWorkOrderStatus`, `assignWorkOrder`, `dispatchAppointment`), where the acting administrator's own identity is recorded in the audit history (`actorMemberId = adminMembership.id`). Standard technician endpoints remain strictly bound to the authenticated technician's derived profile.

### 2.3 Invariant 3: Strict Tenant & Technician Isolation
- **Tenant Isolation**: Every query and mutation is partitioned by `workspaceId`. A technician in Workspace A can never view, update, or log time on records belonging to Workspace B.
- **Technician Isolation**: A user with role `TECHNICIAN` can access only WorkOrders assigned to their specific `TechnicianProfile` (`workOrder.assignedTechnicianId === callerProfile.id` or `scheduleAppointment.technicianId === callerProfile.id`). Attempts to operate on other technicians' work orders are rejected with `403 ForbiddenError` (or `404 WorkOrderNotFoundError` for detail queries to avoid leaking entity existence).

### 2.4 Invariant 4: Atomic Transactions & Immutable Audit History
- Every operational mutation that modifies business state executes inside an atomic Prisma transaction (`prisma.$transaction`).
- Every state transition must write an audit record to `WorkOrderHistory` (for WorkOrder events) and/or `ScheduleAppointmentHistory` (for appointment events).
- A mutation is never allowed to persist if audit history generation fails.

---

## 3. Technician Identity Resolution Architecture

### 3.1 Identity Resolution Pipeline
The application standardizes the resolution of an authenticated user to their operational technician identity through the following deterministic pipeline:

```
+---------------------------------------------------------------------------------+
| 1. Authenticate Session (`auth()`)                                              |
|    - Validates JWT / session token.                                             |
|    - Yields `session.user.id`. Throws `UnauthorizedError` (401) if missing.     |
+---------------------------------------+-----------------------------------------+
                                        |
                                        v
+---------------------------------------------------------------------------------+
| 2. Workspace Authorization (`requireWorkspaceAuthorization(workspaceId)`)       |
|    - Verifies active User record (`user.status === ACTIVE`).                    |
|    - Verifies active Workspace (`workspaceId` exists).                          |
|    - Verifies active Membership (`workspaceMember.status === ACTIVE`).          |
|    - Yields `WorkspaceAuthorizationContext` (`user`, `workspace`, `membership`).|
+---------------------------------------+-----------------------------------------+
                                        |
                                        v
+---------------------------------------------------------------------------------+
| 3. Technician Profile Resolution (`resolveTechnicianContext(workspaceId)`)      |
|    - Queries `Employee` where `workspaceMemberId === membership.id`.            |
|    - Verifies `employee.status === ACTIVE`.                                     |
|    - Queries `TechnicianProfile` linked to `employee.id`.                       |
|    - Yields `TechnicianExecutionContext` (`profile`, `employee`, `membership`). |
|    - If caller has role `TECHNICIAN` but has no profile ->                     |
|      Throws `TechnicianProfileNotFoundError` (404).                             |
+---------------------------------------------------------------------------------+
```

### 3.2 Canonical Context Type Contract

```typescript
export interface TechnicianExecutionContext {
    userId: string;
    workspaceId: string;
    membershipId: string;
    role: MembershipRole;
    employeeId: string;
    technicianProfileId: string;
    technicianName: string;
}
```

---

## 4. Travel vs. On-Site Execution Semantics

A critical architectural distinction is established between the **Travel Phase** (in transit) and the **On-Site Execution Phase** (hands-on service delivery):

```
+----------------------------------------------------------------------------------------------------+
|                                    1. DISPATCHED & ACKNOWLEDGED                                    |
|  - WorkOrder: `ASSIGNED`                                                                           |
|  - ScheduleAppointment: `dispatchStatus = ACKNOWLEDGED`                                            |
|  - `fieldExecutionStartedAt = null`                                                                |
+-------------------------------------------------+--------------------------------------------------+
                                                  |
                                                  | Technician begins driving to site
                                                  v
+----------------------------------------------------------------------------------------------------+
|                                      2. TRAVEL PHASE (En Route)                                    |
|  - Action: `startTravel()` or `recordTechnicianTimeEntry({ entryType: "TRAVEL" })`                 |
|  - WorkOrder Status: REMAINS `ASSIGNED` (Work on site has not begun yet)                          |
|  - ScheduleAppointment: Sets `fieldExecutionStartedAt = now()` (LOCKS undispatch recall)          |
|  - Time Tracking: Creates `TechnicianTimeEntry` with `entryType = TRAVEL`, `status = ACTIVE`       |
+-------------------------------------------------+--------------------------------------------------+
                                                  |
                                                  | Technician arrives at customer premises
                                                  v
+----------------------------------------------------------------------------------------------------+
|                                 3. ON-SITE EXECUTION PHASE (Work Commenced)                        |
|  - Action: `startWorkOrder()` or `recordTechnicianTimeEntry({ entryType: "ON_SITE" })`            |
|  - WorkOrder Status: TRANSITIONS TO `IN_PROGRESS` via `transitionWorkOrderStatus()`                |
|    (Sets `workOrder.startedAt = now()`)                                                            |
|  - ScheduleAppointment: Ensures `fieldExecutionStartedAt` is set (if travel was skipped)           |
|  - Time Tracking: Automatically closes active `TRAVEL` entry (`endedAt = now()`)                   |
|    and opens new `TechnicianTimeEntry` with `entryType = ON_SITE`, `status = ACTIVE`              |
+-------------------------------------------------+--------------------------------------------------+
                                                  |
                         +------------------------+------------------------+
                         |                                                 |
                         | Pause / Delay                                   | Work Finished
                         v                                                 v
+--------------------------------------------------+ +-----------------------------------------------+
|             4. ON_HOLD (Work Paused)             | |            5. COMPLETED (Terminal)            |
| - Action: `holdWorkOrder({ holdReason })`        | | - Action: `completeWorkOrder({ ... })`        |
| - WorkOrder: `IN_PROGRESS` -> `ON_HOLD`          | | - WorkOrder: `IN_PROGRESS` -> `COMPLETED`     |
| - Time Tracking: Closes active `ON_SITE` entry   | | - ScheduleAppointment: `status = COMPLETED`   |
| - Resuming opens new `ON_SITE` entry             | | - Time Tracking: Closes active `ON_SITE` entry|
+--------------------------------------------------+ +-----------------------------------------------+
```

### 4.1 Operational Invariants of Travel vs. On-Site Start
1. **Travel Does Not Mutate WorkOrder Status**: While traveling, the WorkOrder remains in `ASSIGNED` status. Physical execution on the asset/site has not commenced.
2. **Travel Activates the Execution Lock**: Starting travel stamps `ScheduleAppointment.fieldExecutionStartedAt = now()`. This immediately activates Phase 1.8's undispatch guard (`if (fieldExecutionStartedAt !== null) throw new UndispatchNotAllowedError()`), preventing dispatchers from recalling the job while the technician is already driving.
3. **On-Site Start Mutates WorkOrder Status**: Starting on-site work is the canonical trigger that moves the WorkOrder from `ASSIGNED` to `IN_PROGRESS` and sets `workOrder.startedAt = now()`.
4. **Automatic Travel Closure**: If a technician was traveling (`ACTIVE` travel time entry) and starts on-site work, the service automatically closes the travel entry (`endedAt = now()`, computing `durationMinutes`) before creating the `ON_SITE` entry in the same transaction.

---

## 5. WorkOrder Lifecycle Integration

### 5.1 Operational Action Mapping to Canonical State Transitions

Technician operational actions map directly to canonical Phase 1.6 WorkOrder status transitions:

| Technician Operation | From WorkOrderStatus | To WorkOrderStatus | Downstream Invocation & Invariants |
| :--- | :--- | :--- | :--- |
| `startTravel()` | `ASSIGNED` | `ASSIGNED` | Sets `ScheduleAppointment.fieldExecutionStartedAt = now()`. Creates `TechnicianTimeEntry(entryType: TRAVEL)`. |
| `startWorkOrder()` | `ASSIGNED` | `IN_PROGRESS` | 1. Calls `transitionWorkOrderStatus(workspaceId, workOrderId, { toStatus: "IN_PROGRESS" })`.<br>2. Sets `workOrder.startedAt = now()`.<br>3. Sets `appointment.fieldExecutionStartedAt = now()`.<br>4. Closes active travel entry; opens active `ON_SITE` entry. |
| `holdWorkOrder()` | `IN_PROGRESS` | `ON_HOLD` | 1. Calls `transitionWorkOrderStatus(..., { toStatus: "ON_HOLD", holdReason })`.<br>2. Requires `holdReason`.<br>3. Closes active `ON_SITE` time entry. |
| `resumeWorkOrder()` | `ON_HOLD` | `IN_PROGRESS` | 1. Calls `transitionWorkOrderStatus(..., { toStatus: "IN_PROGRESS" })`.<br>2. Clears `holdReason`.<br>3. Opens new active `ON_SITE` time entry. |
| `completeWorkOrder()` | `IN_PROGRESS` | `COMPLETED` | 1. Validates completion preconditions (`assignedTechnicianId !== null`).<br>2. Calls `transitionWorkOrderStatus(..., { toStatus: "COMPLETED" })`.<br>3. Sets `workOrder.completedAt = now()`.<br>4. Sets linked `ScheduleAppointment.status = COMPLETED`.<br>5. Closes remaining active time entry. |

### 5.2 Completion Precondition Enforcement
Technician Operations strictly respects all completion preconditions established in Phase 1.6:
- WorkOrder must currently be in `IN_PROGRESS` status.
- `assignedTechnicianId` must not be null.
- Caller must be the assigned technician (or an authorized administrative role).
- If preconditions fail, the service throws `WorkOrderCompletionPreconditionFailedError` (422) or `ForbiddenError` (403).

---

## 6. Scheduling & Dispatch Integration

### 6.1 Integration with `ScheduleAppointment` (Phase 1.8)

Technician Operations interacts with the Scheduling & Dispatch domain through three formal touchpoints:

```
+----------------------------------------------------------------------------------------------------+
| 1. Dispatch Acknowledgment (`acknowledgeDispatch()`)                                               |
|    - Invokes Phase 1.8 service `acknowledgeDispatch(workspaceId, appointmentId)`.                  |
|    - Transitions `dispatchStatus: DISPATCHED -> ACKNOWLEDGED`.                                     |
|    - Validates caller is the assigned technician on the appointment.                               |
|    - Logs `ScheduleAppointmentHistory` (`UPDATED`, `field: dispatchStatus`).                        |
+----------------------------------------------------------------------------------------------------+
                                                  │
                                                  v
+----------------------------------------------------------------------------------------------------+
| 2. Field Execution Start (`fieldExecutionStartedAt`)                                               |
|    - Stamped with `now()` when technician starts travel or on-site work.                           |
|    - Permanently locks Phase 1.8 `undispatchAppointment` (returns `UndispatchNotAllowedError`).     |
+----------------------------------------------------------------------------------------------------+
                                                  │
                                                  v
+----------------------------------------------------------------------------------------------------+
| 3. Appointment Completion (`status = COMPLETED`)                                                   |
|    - When the WorkOrder is completed, any active `ScheduleAppointment` linked to the WorkOrder     |
|      and technician is marked `status = COMPLETED`.                                                |
|    - Writes to `ScheduleAppointmentHistory` via `recordScheduleHistory(tx, { eventType: COMPLETED })`.|
+----------------------------------------------------------------------------------------------------+
```

---

## 7. Time Tracking Architecture (`TechnicianTimeEntry`)

### 7.1 Entity Responsibility & Domain Scope
Operational field labor time tracking records the duration of technician activity on a WorkOrder. 

**Explicit Scope Boundaries**:
- **Included**: Start timestamp, end timestamp, duration in minutes, operational entry type (`TRAVEL`, `ON_SITE`, `BREAK`, `ADMIN`), operational notes, actor references.
- **Strictly Excluded**: Hourly wages, employee pay rates, overtime multipliers, customer billing rates, invoice line generation, tax calculations, payroll export formats (deferred to Phase 1.10 / Phase 1.12).

### 7.2 Conceptual Data Model Contract

```prisma
enum TimeEntryType {
  TRAVEL
  ON_SITE
  BREAK
  ADMIN
}

enum TimeEntryStatus {
  ACTIVE
  COMPLETED
}

model TechnicianTimeEntry {
  id                  String          @id @default(cuid())
  workspaceId         String
  technicianProfileId String
  workOrderId         String
  appointmentId       String?

  entryType           TimeEntryType   @default(ON_SITE)
  status              TimeEntryStatus @default(ACTIVE)

  startedAt           DateTime
  endedAt             DateTime?
  durationMinutes     Int?

  notes               String?         @db.Text
  metadata            Json?

  createdByMemberId   String
  createdAt           DateTime        @default(now())
  updatedAt           DateTime        @updatedAt

  workspace           Workspace             @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  technicianProfile   TechnicianProfile     @relation(fields: [technicianProfileId], references: [id], onDelete: Restrict)
  workOrder           WorkOrder             @relation(fields: [workOrderId], references: [id], onDelete: Restrict)
  appointment         ScheduleAppointment?  @relation(fields: [appointmentId], references: [id], onDelete: SetNull)
  createdByMember     WorkspaceMember       @relation(fields: [createdByMemberId], references: [id], onDelete: Restrict)

  @@index([workspaceId])
  @@index([technicianProfileId])
  @@index([workOrderId])
  @@index([workspaceId, technicianProfileId, status])
  @@index([workspaceId, workOrderId])
  @@index([startedAt])
}
```

### 7.3 Concurrency & Active Entry Rules
- A technician profile can have at most **one** `ACTIVE` (`endedAt === null`) time entry at any given time within a workspace.
- Starting a new operational activity auto-closes any open active entry for that technician (`endedAt = now()`, computing `durationMinutes = Math.round((endedAt - startedAt) / 60000)`).
- When a WorkOrder transitions to `ON_HOLD` or `COMPLETED`, all open active time entries for that WorkOrder and technician are automatically closed with `endedAt = now()`.

---

## 8. Operational Notes & Completion Evidence Architecture

### 8.1 Operational Notes Strategy
- **Existing Notes vs. Field Notes**:
  - `WorkOrder.description`: Initial intake / customer problem description.
  - `WorkOrder.internalNotes`: Dispatcher / administrative notes.
  - `ScheduleAppointment.notes`: Calendar / appointment-specific dispatch instructions.
- **Technician Field Execution Notes**:
  - Captured as resolution notes upon WorkOrder completion and serialized into `WorkOrderHistory.metadata` (`JSON.stringify({ resolutionNotes, completedByTechId })`).
  - Operational time entries support itemized `notes` for travel delays, diagnostic findings, or parts delays.
  - This avoids duplicate note tables while guaranteeing 100% auditability.

### 8.2 Completion Evidence Architecture
- Completion evidence (photos of completed work, customer sign-off signatures) will reference media artifacts by URI / asset key.
- Technician Operations will not create custom file-storage infrastructure.
- Completion payloads accept structured evidence references (e.g., `{ mediaUris: string[], resolutionNotes: string }`), stored in audit metadata or completion summary attachments.

---

## 9. History & Audit Integration

### 9.1 Verification Against Phase 1.6 and 1.8 Codebases

All technician operational mutations must be audited using the exact established history contracts:

1. **WorkOrder State Changes (`WorkOrderHistory`)**:
   - Model: [`prisma/schema.prisma`](file:///d:/Download/aforden/prisma/schema.prisma#L829-L855)
   - `eventType`: `WorkOrderHistoryEventType` (`STATUS_CHANGED`, `ASSIGNED`, `REASSIGNED`, `UNASSIGNED`, `UPDATED`)
   - `actorMemberId`: `authorization.membership.id` (FK to `WorkspaceMember.id`, `onDelete: SetNull`)
   - `actorName`: `authorization.user.name || authorization.user.email`
   - `field`: `"status"`
   - `oldValue`: Previous status string
   - `newValue`: New status string
   - `metadata`: `String? @db.Text` storing serialized JSON string: `JSON.stringify({ holdReason, resolutionNotes })`

2. **Schedule Appointment Events (`ScheduleAppointmentHistory`)**:
   - Model: [`prisma/schema.prisma`](file:///d:/Download/aforden/prisma/schema.prisma#L999-L1023)
   - Written exclusively via [`recordScheduleHistory(tx, params)`](file:///d:/Download/aforden/lib/services/schedule/recordScheduleHistory.ts)
   - `eventType`: `ScheduleHistoryEventType` (`UPDATED` for dispatch acknowledgment, `COMPLETED` for appointment completion)
   - `metadata`: `Json?` storing native JSON object

---

## 10. Error Taxonomy & HTTP Status Mapping

Technician Operations reuses existing domain errors where semantically exact and defines focused operational domain errors:

| Domain Error Class | Error Code String | HTTP Status | Trigger Condition |
| :--- | :--- | :---: | :--- |
| `TechnicianProfileNotFoundError` | `TECHNICIAN_PROFILE_NOT_FOUND` | **404** | Authenticated user has no active `TechnicianProfile` in target workspace. |
| `TechnicianNotAssignedToWorkOrderError` | `TECHNICIAN_NOT_ASSIGNED_TO_WORK_ORDER` | **403** | Technician attempted an operation on a WorkOrder not assigned to them. |
| `WorkOrderNotFoundError` | `WORK_ORDER_NOT_FOUND` | **404** | WorkOrder not found in authorized workspace (also used for cross-tenant IDOR protection). |
| `WorkOrderInvalidStatusTransitionError` | `WORK_ORDER_INVALID_STATUS_TRANSITION` | **409** | Requested transition is illegal according to the lifecycle state machine. |
| `WorkOrderCompletionPreconditionFailedError` | `WORK_ORDER_COMPLETION_PRECONDITION_FAILED` | **422** | Preconditions for completion (status, assignment) are not met. |
| `WorkOrderDeletionNotAllowedError` | `WORK_ORDER_DELETION_NOT_ALLOWED` | **409** | Attempted to delete a WorkOrder with protected operational references or active time entries. |
| `ActiveTimeEntryExistsError` | `ACTIVE_TIME_ENTRY_EXISTS` | **409** | Technician already has a running active time entry. |
| `TimeEntryNotFoundError` | `TIME_ENTRY_NOT_FOUND` | **404** | Target time entry not found in authorized workspace. |
| `TimeEntryImmutableError` | `TIME_ENTRY_IMMUTABLE` | **409** | Attempted to modify a finalized/locked historical time entry. |
| `UnauthorizedError` | `UNAUTHORIZED` | **401** | Missing or invalid user session. |
| `ForbiddenError` | `FORBIDDEN` | **403** | User role lacks permission for the requested operational action. |

---

## 11. Role-Based Access Control (RBAC) Architecture

### 11.1 System Role Authorization Matrix

| Operation / Endpoint | `OWNER` | `ADMIN` | `MANAGER` | `DISPATCHER` | `TECHNICIAN` | `ACCOUNTANT` |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| View Assigned Work Queue | ✅ (All) | ✅ (All) | ✅ (All) | ✅ (All) | ✅ (Assigned Only) | ❌ |
| View WorkOrder Operational Detail | ✅ | ✅ | ✅ | ✅ | ✅ (Assigned Only) | ❌ |
| Acknowledge Dispatch | ✅ | ✅ | ✅ | ✅ | ✅ (Assigned Only) | ❌ |
| Start Travel | ✅ | ✅ | ✅ | ✅ | ✅ (Assigned Only) | ❌ |
| Start Work Order (`ASSIGNED` $\rightarrow$ `IN_PROGRESS`) | ✅ | ✅ | ✅ | ✅ | ✅ (Assigned Only) | ❌ |
| Hold Work Order (`IN_PROGRESS` $\rightarrow$ `ON_HOLD`) | ✅ | ✅ | ✅ | ✅ | ✅ (Assigned Only) | ❌ |
| Resume Work Order (`ON_HOLD` $\rightarrow$ `IN_PROGRESS`) | ✅ | ✅ | ✅ | ✅ | ✅ (Assigned Only) | ❌ |
| Complete Work Order (`IN_PROGRESS` $\rightarrow$ `COMPLETED`) | ✅ | ✅ | ✅ | ❌ | ✅ (Assigned Only) | ❌ |
| Record / Clock Time Entry | ✅ | ✅ | ✅ | ❌ | ✅ (Self Only) | ❌ |
| Edit Historical Time Entry | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |

---

## 12. Proposed REST API Architecture

All routes follow Aforden's thin adapter pattern: authenticating via session, delegating business logic to domain services, and returning canonical read models without raw Prisma model leakage.

```
Candidate Endpoints for Phase 1.9:

# Operational Work Queue & Detail
GET    /api/technician/work-orders                  -> listTechnicianWorkOrders (Assigned queue)
GET    /api/technician/work-orders/[workOrderId]    -> getTechnicianWorkOrderDetail

# Operational Lifecycle Actions
POST   /api/technician/work-orders/[workOrderId]/acknowledge -> acknowledgeTechnicianDispatch
POST   /api/technician/work-orders/[workOrderId]/travel      -> startTechnicianTravel
POST   /api/technician/work-orders/[workOrderId]/start       -> startTechnicianWorkOrder
POST   /api/technician/work-orders/[workOrderId]/hold        -> holdTechnicianWorkOrder
POST   /api/technician/work-orders/[workOrderId]/resume      -> resumeTechnicianWorkOrder
POST   /api/technician/work-orders/[workOrderId]/complete    -> completeTechnicianWorkOrder

# Operational Time Tracking
GET    /api/technician/work-orders/[workOrderId]/time        -> listTechnicianTimeEntries
POST   /api/technician/work-orders/[workOrderId]/time        -> recordTechnicianTimeEntry
PATCH  /api/technician/work-orders/[workOrderId]/time/[id]   -> updateTechnicianTimeEntry
```

---

## 13. Referential Integrity, Deletion Precedence & Safety

### 13.1 Deletion Policy Hierarchy & Precedence Rules

To reconcile tenant purge behavior with intra-tenant historical immutability, the following explicit precedence rules are enforced:

1. **Tenant-Level Destruction (Root `Workspace` Purge)**:
   - `onDelete: Cascade` on `workspaceId` applies **strictly and exclusively** when an entire Workspace tenant is destroyed by a platform administrator.
   - In this event, all child records within that workspace (WorkOrders, appointments, time entries, audit histories) are destroyed.

2. **Intra-Tenant Operational Entity Deletion (`WorkOrder`, `TechnicianProfile`, `WorkspaceMember`)**:
   - Within an active workspace, operational and audit data is **strictly protected against deletion**.
   - `TechnicianTimeEntry.workOrderId -> WorkOrder.id` uses `onDelete: Restrict`. If a WorkOrder has logged time entries, hard deletion of that WorkOrder is strictly blocked at the database level. Prisma error `P2003` is caught and translated to `WorkOrderDeletionNotAllowedError` (409 Conflict).
   - `TechnicianTimeEntry.technicianProfileId -> TechnicianProfile.id` uses `onDelete: Restrict`. If a technician profile is deactivated or terminated, historical time entries remain intact.
   - `TechnicianTimeEntry.createdByMemberId -> WorkspaceMember.id` uses `onDelete: Restrict`.
   - `TechnicianTimeEntry.appointmentId -> ScheduleAppointment.id` uses `onDelete: SetNull`. If an appointment is cancelled or removed, the time entry preserves its link to the parent WorkOrder and technician.

3. **Technician Deactivation**:
   - If an employee or technician profile is marked `INACTIVE`, `TERMINATED`, or `ON_LEAVE`:
   - Historical time entries, completed work orders, and audit records remain intact.
   - Active assigned work orders must be reassigned by a dispatcher before deactivation.

---

## 14. Transaction Boundaries & Mutation Flow

Every mutation in Technician Operations executes in an atomic, deterministic sequence:

```
Request (HTTP)
   │
   ▼
1. Authentication (`requireAuthenticatedUser`)
   │
   ▼
2. Workspace Authorization (`requireWorkspaceAuthorization`)
   │
   ▼
3. Input Validation (Zod Schema `.parse()`)
   │
   ▼
4. Identity & Scoping Resolution (`resolveTechnicianContext`)
   │
   ▼
5. Business Rule & Precondition Checks (Status legality, assignment match)
   │
   ▼
6. Atomic Database Transaction (`prisma.$transaction`)
   ├── 6a. Mutate WorkOrder / TimeEntry / ScheduleAppointment
   └── 6b. Record Immutable Audit History (`WorkOrderHistory` / `ScheduleHistory`)
   │
   ▼
7. Map to DTO / Canonical Read Model
   │
   ▼
Response (JSON 200/201)
```

---

## 15. Future Phase Roadmap Boundaries

To preserve architectural focus, the following capabilities are explicitly positioned in their designated roadmap phases:

- **Phase 1.9 (Technician Operations)**: Operational execution, field actions (travel/start/hold/resume/complete), operational time tracking, execution notes, completion summaries.
- **Phase 1.10 (Inventory & Parts)**: Parts usage, truck stock deduction, barcode scanning, part return workflows.
- **Phase 1.11 (Quotes & Estimates)**: On-site estimate creation, change orders, customer quote signature capture.
- **Phase 1.12 (Invoicing & Payments)**: Transforming time and parts into invoices, on-site payment processing.
- **Phase 1.13 (Notifications & Communications)**: Customer arrival notifications, automated dispatch alerts.
- **Phase 1.14 (Reporting & Analytics)**: Technician billable efficiency, first-time fix rates, labor performance analytics.
- **Phase 1.23 (Aforden Web App UI/UX)**: Mobile-responsive technician web views, execution dashboards.

---

## Architectural Sign-Off

The domain architecture, identity derivation paths, travel/execution lifecycle semantics, time-tracking contracts, deletion precedence rules, and security boundaries defined in this document are locked as the authoritative engineering standard for **Phase 1.9: Technician Operations**.
