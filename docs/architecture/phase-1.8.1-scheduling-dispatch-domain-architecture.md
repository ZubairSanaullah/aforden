# Phase 1.8.1 — Scheduling & Dispatch Domain Architecture & Specification

> **Document Status**: LOCKED FOR IMPLEMENTATION (Phase 1.8 Architecture Standard)  
> **Domain**: Scheduling, Appointment Management & Field Workforce Dispatch  
> **Dependencies**: Phase 1.1 (Multi-Tenancy & Workspace Partitioning), Phase 1.2 (Authentication & RBAC), Phase 1.3 (Technicians & Organization), Phase 1.4 (Customers & Service Locations), Phase 1.5 (Service Catalog & Work Types), Phase 1.6 (Work Orders), Phase 1.7 (Assets & Equipment)  
> **Target Schema & Service Implementation**: Phase 1.8.2 – Phase 1.8.11  

---

## Executive Summary

Phase 1.8 introduces the **Scheduling & Dispatch** domain to the Aforden Field Service Management (FSM) platform. In previous phases, the system established tenant isolation (Phase 1.1), authentication and role-based access control (Phase 1.2), technician profiles and workforce capacity (Phase 1.3), customer premises and service locations (Phase 1.4), cataloged service offerings (Phase 1.5), operational execution units via Work Orders (Phase 1.6), and physical client equipment records (Phase 1.7).

Phase 1.8 establishes the temporal and dispatching coordination layer: binding work orders to specific calendar windows, allocating qualified technician labor time, enforcing mathematical non-overlapping conflict invariants, and managing the formal operational dispatch lifecycle.

This document serves as the binding architectural contract for Phase 1.8. It formally resolves all structural decisions, field contracts, state machines, conflict semantics, timezone strategies, and error taxonomies prior to any schema generation, migration, service logic, or API route implementation.

---

```
+---------------------------------------------------------------------------------------------------+
|                                        WORKSPACE (Tenant)                                         |
|                                                                                                   |
|   +-----------------------+       +------------------------+       +--------------------------+   |
|   |       CUSTOMER        |       |    SERVICE LOCATION    |       |     ASSET / EQUIPMENT    |   |
|   | (Who receives service)|       | (Where service occurs) |       |   (Physical equipment)   |   |
|   +-----------+-----------+       +-----------+------------+       +------------+-------------+   |
|               |                               |                                 |                 |
|               +-----------------------+       |       +-------------------------+                 |
|                                       |       |       |                                           |
|                                       v       v       v                                           |
|                           +---------------------------------------+                               |
|                           |              WORK ORDER               |                               |
|                           |      (Operational unit of work)       |                               |
|                           |  - id, workOrderNumber                |                               |
|                           |  - status: OPEN | ASSIGNED | ...      |                               |
|                           |  - assignedTechnicianId (Lead Tech)   |                               |
|                           +-------------------+-------------------+                               |
|                                               |                                                   |
|                                               | 1:N Relation (Direct FK)                          |
|                                               v                                                   |
|   +-----------------------+       +---------------------------------------+                       |
|   |  TECHNICIAN PROFILE   |       |         SCHEDULE APPOINTMENT          |                       |
|   |  (Field Service Tech) |<------+   (Temporal Calendar & Dispatch Unit) |                       |
|   |  - id, employeeId     | 1:N   |  - id, appointmentNumber             |                       |
|   |  - skills, areas      | (FK)  |  - scheduledStart, scheduledEnd (UTC) |                       |
|   +-----------------------+       |  - status: SCHEDULED | RESCHEDULED... |                       |
|                                   |  - dispatchStatus: PENDING | DISP...  |                       |
|                                   +-------------------+-------------------+                       |
|                                                       |                                           |
|                                                       | 1:N (Append-Only Audit)                   |
|                                                       v                                           |
|                                   +---------------------------------------+                       |
|                                   |      SCHEDULE APPOINTMENT HISTORY     |                       |
|                                   | (Audit ledger of reschedules/dispatch)|                       |
|                                   +---------------------------------------+                       |
+---------------------------------------------------------------------------------------------------+
```

---

## 1. Domain Responsibility Statement

The **Scheduling & Dispatch** domain is responsible for the temporal allocation, calendar reservation, schedule integrity, and operational dispatch of field service labor for Work Orders within a tenant workspace. Specifically, this domain owns:
- The creation, modification, rescheduling, cancellation, and completion of time-bounded appointments (`[scheduledStart, scheduledEnd)`).
- The reservation of specific technician labor resources for defined calendar intervals.
- The mathematical enforcement of overlap-free scheduling rules (conflict detection) across technician calendars.
- The operational dispatch lifecycle (`PENDING_DISPATCH` $\rightarrow$ `DISPATCHED` $\rightarrow$ `ACKNOWLEDGED`), representing the formal release of work to the field workforce.
- The authoritative service entry point for dispatch acknowledgments (`acknowledgeDispatch()`), which downstream mobile workflows in Phase 1.9 invoke.
- The immutable audit tracking of all scheduling changes, duration adjustments, time-slot shifts, operational note edits, and dispatch state transitions via `ScheduleAppointmentHistory`.

The Scheduling & Dispatch domain **does not own**:
- Work Order lifecycle states (`OPEN`, `ON_HOLD`, `CANCELLED`, `COMPLETED`), priority, work type snapshots, or customer billing terms (owned by Phase 1.6 `WorkOrder`).
- Technician master profile records, employee master records, certification tracking, or weekly recurring shift schedules (owned by Phase 1.3 `TechnicianProfile` / `Employee`).
- Generic ad-hoc non-WorkOrder tasks (early generic `TechnicianAssignment` container from Phase 1.3 is superseded for all WorkOrder execution by `ScheduleAppointment`).
- Real-time GPS tracking, breadcrumb telemetry, geofence trigger detection, or turn-by-turn route optimization (deferred to Phase 1.9 & Phase 1.16).
- Field execution workflows such as technician travel logging (`EN_ROUTE`), on-site arrival (`ON_SITE`), checklist completion, and customer signature capture (owned by Phase 1.9 `Technician Operations`).
- Automated notification transmission via SMS, Push, or Email (owned by Phase 1.13 `Notifications`).
- Invoicing, time-sheet payroll calculations, or parts consumption billing (owned by Phase 1.10 & Phase 1.12).

---

## 2. Critical Architectural Distinction

A clean separation of concerns must be strictly maintained across the four operational stages of field labor execution:

$$\text{WorkOrder Assignment} \neq \text{Schedule / Appointment} \neq \text{Dispatch} \neq \text{Technician Execution}$$

```
+------------------------+      +------------------------+      +------------------------+      +------------------------+
|  WORKORDER ASSIGNMENT  |      | SCHEDULE / APPOINTMENT |      |        DISPATCH        |      |  TECHNICIAN EXECUTION  |
|      (Phase 1.6)       | ---> |      (Phase 1.8)       | ---> |      (Phase 1.8)       | ---> |      (Phase 1.9)       |
| "Who is responsible?"  |      |   "When will it occur?"|      |  "Release job to tech" |      | "Work done in field"   |
|  - Agnostic of time    |      |  - Explicit time window|      |  - Push to mobile queue|      |  - En Route / On Site  |
|  - Lead technician ID  |      |  - Conflict validation |      |  - Lock calendar slot  |      |  - Checklist / Signoff |
+------------------------+      +------------------------+      +------------------------+      +------------------------+
```

### 2.1 Distinction Definitions

1. **WorkOrder Assignment (`WorkOrder.assignedTechnicianId`)**:
   - Establishes organizational accountability: designates the primary technician responsible for overseeing and delivering the work order.
   - **Time-Agnostic**: Does not allocate calendar time or create a booking.
   - Managed strictly via Phase 1.6 assignment services (`assignWorkOrder`, `reassignWorkOrder`, `unassignWorkOrder`).

2. **Schedule / Appointment (`ScheduleAppointment`)**:
   - Establishes temporal commitment: reserves a specific, conflict-checked interval `[scheduledStart, scheduledEnd)` on a technician's calendar.
   - A WorkOrder may have multiple appointments over its lifecycle (e.g., multi-day visits, diagnostic visit followed by installation visit).

3. **Dispatch (`ScheduleAppointment.dispatchStatus`)**:
   - Establishes operational activation: the administrative release of a scheduled appointment to the field worker.
   - Transitions the booking from a draft planning state (`PENDING_DISPATCH`) to an active field assignment (`DISPATCHED`).
   - Managed strictly via Phase 1.8 dispatch services (`dispatchAppointment`, `undispatchAppointment`, `acknowledgeDispatch`).

4. **Technician Execution (Phase 1.9)**:
   - Establishes real-world field progression: technician accepting the dispatch, travelling to the service location, clocking on-site, performing work, and completing checklists.
   - **Boundary Contract**: When a technician acknowledges a dispatch in the mobile application (Phase 1.9), Phase 1.9 calls the Phase 1.8 service entry point `acknowledgeDispatch()`. Phase 1.9 never performs direct database writes into `ScheduleAppointment`.

### 2.2 Precondition Verification Rule

**WorkOrder assignment is a strict prerequisite for scheduling.**
- When creating a `ScheduleAppointment` for technician $T$ on WorkOrder $W$, the scheduling service verifies that:
  1. $W\text{.assignedTechnicianId} \neq \text{null}$ (Work order is assigned).
  2. $W\text{.assignedTechnicianId} == T$ (Technician matches the assigned lead technician).
- **Invariance Rule**: The scheduling service **never** mutates `WorkOrder.assignedTechnicianId` directly. If $W$ is unassigned or assigned to a different technician, the scheduling service immediately aborts and throws `ScheduleWorkOrderNotAssignedError` or `ScheduleTechnicianMismatchError`. The caller must invoke Phase 1.6 `assignWorkOrder` first. This preserves strict domain boundaries and domain-specific audit logs.

---

## 3. Model Decision: Unified Model vs. Two Related Models

### 3.1 The Architectural Decision
Scheduling and Dispatch are modeled as **one unified entity**: `ScheduleAppointment`.

```
                    UNIFIED MODEL: ScheduleAppointment
+---------------------------------------------------------------------------+
| - id, workspaceId, workOrderId, technicianId, appointmentNumber           |
| - scheduledStart, scheduledEnd, durationMinutes, timezone                 |
| - status: SCHEDULED | RESCHEDULED | CANCELLED | COMPLETED                 |
| - dispatchStatus: PENDING_DISPATCH | DISPATCHED | ACKNOWLEDGED            |
| - dispatchedAt, dispatchedByMemberId, undispatchedAt, undispatchedBy...   |
| - fieldExecutionStartedAt (populated by Phase 1.9)                        |
+---------------------------------------------------------------------------+
```

### 3.2 Formal Justification

1. **Atomic Operational Lifecycle**:
   In field service workflows, an appointment and its dispatch state are fundamentally two facets of the same operational event. A dispatch cannot exist without a scheduled time window, and every scheduled time window requires a deterministic dispatch state.
2. **Performance & Query Optimization (Dispatch Board / Gantt Views)**:
   Dispatch boards and calendar timelines execute high-frequency queries over date ranges (e.g., `WHERE workspaceId = ? AND scheduledStart >= ? AND scheduledEnd <= ?`). A unified model avoids mandatory $1:1$ joins on every calendar cell render, reducing query latency and database memory pressure.
3. **Elimination of Distributed State Anomalies**:
   A two-model approach (`Schedule` + `Dispatch`) introduces edge cases: orphaned dispatch rows, desynchronized status transitions when an appointment is rescheduled or cancelled, and relational foreign key cascading overhead. A unified model guarantees atomic transactions on all scheduling mutations.
4. **Audit Trail via Dedicated Ledger**:
   Historical tracking is cleanly handled by an append-only `ScheduleAppointmentHistory` table, capturing state transitions for both time changes (rescheduling) and dispatch actions (dispatch/undispatch) without cluttering operational relational schemas.

---

## 4. Field-Level Contract

### 4.1 `ScheduleAppointment` Field Specification

| Field Name | Type | Nullability | Purpose & Constraints |
| :--- | :--- | :--- | :--- |
| `id` | `String` (CUID) | `NOT NULL` | System primary key (`@id @default(cuid())`). |
| `workspaceId` | `String` | `NOT NULL` | Multi-tenant partition anchor. FK to `Workspace.id`. |
| `appointmentNumber` | `String` | `NOT NULL` | Human-readable unique identifier (e.g., `APT-2026-000001`). Unique per workspace (`@@unique([workspaceId, appointmentNumber])`). |
| `workOrderId` | `String` | `NOT NULL` | Target work order being scheduled. FK to `WorkOrder.id` (`onDelete: Restrict`). |
| `technicianId` | `String` | `NOT NULL` | Assigned technician profile. FK to `TechnicianProfile.id` (`onDelete: Restrict`). |
| `scheduledStart` | `DateTime` | `NOT NULL` | Start timestamp stored strictly in UTC (`TIMESTAMPTZ`). Inclusive boundary. |
| `scheduledEnd` | `DateTime` | `NOT NULL` | End timestamp stored strictly in UTC (`TIMESTAMPTZ`). Exclusive boundary. |
| `durationMinutes` | `Int` | `NOT NULL` | Calculated interval duration in minutes: `(scheduledEnd - scheduledStart) / 60000`. Validated on write ($>0$). |
| `timezone` | `String` | `NOT NULL` | IANA timezone string (e.g., `"America/New_York"`, `"Asia/Karachi"`). Captured from location/workspace at creation. |
| `status` | `ScheduleStatus` | `NOT NULL` | Lifecycle enum: `SCHEDULED`, `RESCHEDULED`, `CANCELLED`, `COMPLETED`. Default `SCHEDULED`. |
| `dispatchStatus` | `DispatchStatus` | `NOT NULL` | Dispatch enum: `PENDING_DISPATCH`, `DISPATCHED`, `ACKNOWLEDGED`. Default `PENDING_DISPATCH`. |
| `dispatchedAt` | `DateTime` | `NULLABLE` | Timestamp in UTC when dispatch was triggered. |
| `dispatchedByMemberId` | `String` | `NULLABLE` | FK to `WorkspaceMember.id` who dispatched the appointment. |
| `undispatchedAt` | `DateTime` | `NULLABLE` | Timestamp in UTC when undispatch (recall to `PENDING_DISPATCH`) was triggered. |
| `undispatchedByMemberId`| `String` | `NULLABLE` | FK to `WorkspaceMember.id` who undispatched the appointment. |
| `fieldExecutionStartedAt`| `DateTime`| `NULLABLE` | Timestamp when in-field execution began (populated by Phase 1.9 mobile action; used by 1.8 undispatch guard). |
| `cancellationReason` | `String` | `NULLABLE` | Mandatory explanation when status transitions to `CANCELLED` (`@db.Text`). |
| `notes` | `String` | `NULLABLE` | Operational dispatch and technician instructions (`@db.Text`). |
| `metadata` | `Json` | `NULLABLE` | Extensible JSON metadata payload for downstream integrations. |
| `createdAt` | `DateTime` | `NOT NULL` | Creation timestamp (`@default(now())`). |
| `updatedAt` | `DateTime` | `NOT NULL` | Last update timestamp (`@updatedAt`). |

### 4.2 `ScheduleAppointmentHistory` Field Specification

| Field Name | Type | Nullability | Purpose & Constraints |
| :--- | :--- | :--- | :--- |
| `id` | `String` (CUID) | `NOT NULL` | Primary key (`@id @default(cuid())`). |
| `workspaceId` | `String` | `NOT NULL` | Tenant isolation key. FK to `Workspace.id`. |
| `appointmentId` | `String` | `NOT NULL` | Target appointment. FK to `ScheduleAppointment.id` (`onDelete: Cascade`). |
| `eventType` | `ScheduleHistoryEventType` | `NOT NULL` | Enum: `CREATED`, `RESCHEDULED`, `CANCELLED`, `COMPLETED`, `DISPATCHED`, `UNDISPATCHED`, `UPDATED`. |
| `actorMemberId` | `String` | `NULLABLE` | FK to `WorkspaceMember.id` who performed the action. |
| `actorName` | `String` | `NULLABLE` | Snapshot of actor's display name or email. |
| `field` | `String` | `NULLABLE` | Specific field modified (e.g., `"scheduledStart"`, `"dispatchStatus"`, `"notes"`). |
| `oldValue` | `String` | `NULLABLE` | Previous value as text (`@db.Text`). |
| `newValue` | `String` | `NULLABLE` | Updated value as text (`@db.Text`). |
| `metadata` | `Json` | `NULLABLE` | Structured payload (e.g., `{ oldDuration: 60, newDuration: 90, reason: "Traffic" }`). |
| `createdAt` | `DateTime` | `NOT NULL` | Timestamp of audit entry (`@default(now())`). |

---

## 5. Status Model & State Transition Rules

### 5.1 Enums Definition

```prisma
enum ScheduleStatus {
  SCHEDULED
  RESCHEDULED
  CANCELLED
  COMPLETED
}

enum DispatchStatus {
  PENDING_DISPATCH
  DISPATCHED
  ACKNOWLEDGED
}

enum ScheduleHistoryEventType {
  CREATED
  RESCHEDULED
  CANCELLED
  COMPLETED
  DISPATCHED
  UNDISPATCHED
  UPDATED
}
```

### 5.2 Schedule State Machine Diagram

```
                 +-------------------+
                 |     SCHEDULED     |
                 | (Initial Booking) |
                 +---+-----------+---+
                     |           |
          reschedule |           | cancel
                     v           | (cancellationReason required)
                 +---+-----------+---+
                 |    RESCHEDULED    |
                 | (Time Modified)   |
                 +---+-----------+---+
                     |           |
            complete |           | cancel
                     v           v
           +---------+---+   +---+-----------+
           |  COMPLETED  |   |   CANCELLED   |
           |  (Terminal) |   |   (Terminal)  |
           +-------------+   +---------------+
```

### 5.3 Dispatch State Machine Diagram

```
                 +-----------------------+
                 |   PENDING_DISPATCH    | <---------------+
                 |  (Draft / Unreleased) |                 |
                 +-----------+-----------+                 |
                             |                             |
                    dispatch |                             | undispatch (recall)
                             v                             | (resets to PENDING_DISPATCH)
                 +-----------+-----------+                 |
                 |      DISPATCHED       +-----------------+
                 |  (Released to Tech)   |
                 +-----------+-----------+
                             |
                 acknowledge | (Phase 1.9 Mobile Flow via Phase 1.8 acknowledgeDispatch)
                             v
                 +-----------+-----------+
                 |     ACKNOWLEDGED      |
                 |   (Confirmed Receipt) |
                 +-----------------------+
```

### 5.4 State Transition Matrix & Governance

| Current State (`status`) | Target State (`status`) | Allowed Roles | Preconditions & Validation Rules | Side Effects & Audit Entry |
| :--- | :--- | :--- | :--- | :--- |
| `*` (New) | `SCHEDULED` | `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER` | Valid WorkOrder in `OPEN` or `ASSIGNED` status; Technician `ACTIVE`; no interval conflicts. | Creates `ScheduleAppointment` with `dispatchStatus = PENDING_DISPATCH`. Logs `CREATED`. |
| `SCHEDULED` | `RESCHEDULED` | `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER` | Valid new interval `[start, end)`; non-conflicting; reason provided. | Updates timestamps and duration. If `DISPATCHED` or `ACKNOWLEDGED`, resets `dispatchStatus = PENDING_DISPATCH`. Logs `RESCHEDULED`. |
| `RESCHEDULED` | `RESCHEDULED` | `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER` | Subsequent time change; non-conflicting; reason provided. | Updates timestamps and duration. Resets `dispatchStatus = PENDING_DISPATCH`. Logs `RESCHEDULED`. |
| `SCHEDULED` / `RESCHEDULED` | `CANCELLED` | `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER` | `cancellationReason` is mandatory; cannot cancel if WorkOrder is `COMPLETED`. | Releases calendar conflict lock. Resets `dispatchStatus = PENDING_DISPATCH`. Logs `CANCELLED`. |
| `SCHEDULED` / `RESCHEDULED` | `COMPLETED` | `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER`, `TECHNICIAN` | Executed work completed; appointment reached end of execution. | Marks terminal status. Logs `COMPLETED`. |
| `CANCELLED` | `*` (Any) | *None* | **Illegal Transition**. Cancelled appointments are terminal. | Throws `ScheduleImmutableError`. |
| `COMPLETED` | `*` (Any) | *None* | **Illegal Transition**. Completed appointments are terminal. | Throws `ScheduleImmutableError`. |

#### Dispatch State Actions:
- **Dispatch (`dispatchAppointment`)**: `PENDING_DISPATCH` $\rightarrow$ `DISPATCHED`. Allowed for `SCHEDULED` or `RESCHEDULED` status. Sets `dispatchedAt = now()`, `dispatchedByMemberId`. Logs `DISPATCHED`.
- **Undispatch (`undispatchAppointment`)**: `DISPATCHED` (or `ACKNOWLEDGED`) $\rightarrow$ `PENDING_DISPATCH`. Permitted only if `fieldExecutionStartedAt === null`. Sets `undispatchedAt = now()`, `undispatchedByMemberId`. Logs `UNDISPATCHED`.
- **Acknowledge (`acknowledgeDispatch`)**: `DISPATCHED` $\rightarrow$ `ACKNOWLEDGED`. Invoked by Phase 1.9 mobile entry point. Validates caller is the assigned technician. Logs `UPDATED` (field: `dispatchStatus`).

---

## 6. Time & Timezone Strategy

### 6.1 Database Storage (Strict UTC Standard)
- All temporal fields (`scheduledStart`, `scheduledEnd`, `dispatchedAt`, `undispatchedAt`, `fieldExecutionStartedAt`, `createdAt`, `updatedAt`) are stored strictly in **UTC** as PostgreSQL `TIMESTAMPTZ` (Prisma `DateTime`).
- Local wall-clock inputs provided by clients are converted to UTC at the API/Service boundary using the resolved timezone.

### 6.2 Timezone Resolution Hierarchy
When scheduling an appointment, the service resolves the canonical IANA timezone in the following deterministic sequence:
1. **ServiceLocation Timezone**: The geographic timezone of the customer service location where physical work is executed.
2. **Workspace Timezone**: The fallback default timezone configured on `Workspace.timezone` (e.g., `"Asia/Karachi"`, `"America/New_York"`).
3. The resolved timezone is persisted directly into `ScheduleAppointment.timezone`. This guarantees that future daylight saving time (DST) adjustments and UI calendar renderings always reflect the local wall-clock time intended at the service location.

### 6.3 Duration Derivation vs. Storage
- `durationMinutes` is a **derived, stored integer**:
  $$\text{durationMinutes} = \frac{\text{scheduledEnd.getTime()} - \text{scheduledStart.getTime()}}{1000 \times 60}$$
- **Invariants**:
  - `scheduledStart < scheduledEnd` must be strictly true (positive duration).
  - Minimum appointment duration: `5 minutes`.
  - Maximum single appointment duration: `14 days` ($20,160$ minutes).
  - `durationMinutes` is stored directly on the row to allow high-performance filtering, aggregation, and capacity reporting without dynamic SQL timestamp arithmetic.

---

## 7. Conflict Detection Rules

### 7.1 Interval Semantics: Half-Open `[start, end)` Standard
Aforden strictly enforces **half-open interval semantics** for all appointment bookings:
- **`scheduledStart` is inclusive**: $[$
- **`scheduledEnd` is exclusive**: $)$

### 7.2 Overlap Condition Formula
Two appointments $A$ and $B$ for the same technician overlap **if and only if**:

$$A\text{.scheduledStart} < B\text{.scheduledEnd} \quad \land \quad B\text{.scheduledStart} < A\text{.scheduledEnd}$$

```
Case 1: True Overlap (CONFLICT)
A: [===================)
B:           [===================)
Result: A.start < B.end AND B.start < A.end  -->  CONFLICT!

Case 2: Touching Boundaries / Back-to-Back (LEGAL)
A: [===================)
B:                     [===================)
Result: B.start (12:00) < A.end (12:00) is FALSE  -->  NO CONFLICT (PERMITTED)

Case 3: Enclosure / Subset (CONFLICT)
A: [=============================================)
B:           [===================)
Result: A.start < B.end AND B.start < A.end  -->  CONFLICT!
```

### 7.3 Boundary Match Semantics (Touching Appointments)
Exact boundary matches are **explicitly allowed**:
- If Appointment $A$ is scheduled for `08:00 – 12:00 UTC` and Appointment $B$ is scheduled for `12:00 – 16:00 UTC`:
  - $B\text{.scheduledStart} < A\text{.scheduledEnd} \implies 12:00 < 12:00$ evaluates to **`FALSE`**.
  - **No conflict exists.** A technician can finish one job at 12:00 and immediately begin the next at 12:00.

### 7.4 Excluded Statuses
The conflict detection engine queries only active, booked appointments:
- **Included in Conflict Checks**: `SCHEDULED`, `RESCHEDULED`.
- **Excluded from Conflict Checks**: `CANCELLED`, `COMPLETED`.
- When updating or rescheduling an existing appointment, the query accepts an `excludeAppointmentId` parameter to exclude the record's current state from blocking itself.

### 7.5 Conflict Scope (Technician vs. Asset vs. Location)
1. **Per-Technician Conflict (HARD BLOCKER)**:
   - A technician cannot be in two places simultaneously. An overlapping interval for the same `technicianId` within the workspace throws `ScheduleTechnicianConflictError` (HTTP 409) and blocks persistence.
2. **Per-Asset Conflict (SOFT WARNING / INFORMATIVE)**:
   - Evaluated as a soft warning query. While two technicians rarely work on the exact same asset simultaneously, complex multi-tech installations may permit it. Phase 1.8 returns an asset conflict flag in query payloads but does not hard-block persistence unless configured.
3. **Per-Location Conflict (NO BLOCKER)**:
   - Large commercial service locations (e.g., hospitals, campuses, manufacturing plants) regularly host multiple technicians on different work orders at the same time. Location overlap is not restricted.

---

## 8. Availability Boundaries

### 8.1 Definition of "Technician Availability" in Phase 1.8
In Phase 1.8, technician availability validation consists of three distinct checks:
1. **Hard Schedule Conflict Check**: Mathematical non-overlapping validation against active `ScheduleAppointment` records in the database.
2. **Technician Status Eligibility**: Verification that `Employee.status === ACTIVE` and `TechnicianProfile` belongs to the current workspace.
3. **Weekly Hours & Time-Off Exception Verification**: Point-in-time evaluation against the Phase 1.3 `TechnicianAvailability` (working days/hours) and `TechnicianAvailabilityException` (vacations, sick leave, training, time off) models using the existing `evaluateIntervalAvailability` engine.

### 8.2 Out-of-Scope Boundaries for Phase 1.8
The following advanced workforce capacity features are **explicitly out of scope** for Phase 1.8:
- Dynamic shift swapping, on-call bidding, and union break compliance rules.
- Real-time travel buffer padding based on live traffic telemetry (deferred to Phase 1.16).
- Automated dispatch algorithms and AI-driven slot optimization (deferred to Phase 1.16).

---

## 9. Dispatch Lifecycle

### 9.1 Roles & Authorization
- **Who can Dispatch / Undispatch**: `OWNER`, `ADMIN`, `MANAGER`, `DISPATCHER`.
- **Required Permission**: `SCHEDULER_UPDATE` (or `SCHEDULER_CREATE`).
- **Who can Acknowledge Dispatch**: Authenticated `TECHNICIAN` assigned to the appointment (via Phase 1.9 calling Phase 1.8 `acknowledgeDispatch()`).

### 9.2 Dispatch Preconditions
An appointment can be transitioned from `PENDING_DISPATCH` to `DISPATCHED` if and only if:
1. The appointment exists within the caller's authorized workspace.
2. The appointment `status` is currently `SCHEDULED` or `RESCHEDULED` (not `CANCELLED` or `COMPLETED`).
3. The parent WorkOrder is in an active state (`OPEN`, `ASSIGNED`, `IN_PROGRESS`).
4. The assigned technician's `Employee.status` is `ACTIVE`.
5. No unresolved hard interval conflicts exist on the technician's calendar.

### 9.3 Undispatch Rules & Execution Guard
- Undispatch allows dispatchers to recall an appointment from `DISPATCHED` (or `ACKNOWLEDGED`) back to `PENDING_DISPATCH` if operational scheduling changes arise before field work starts.
- **Execution Precondition Enforcement**:
  - In Phase 1.8, the `undispatchAppointment` service enforces the guard:
    ```typescript
    if (appointment.fieldExecutionStartedAt !== null) {
        throw new UndispatchNotAllowedError(
            "Cannot undispatch appointment because technician has already started field execution.",
        );
    }
    ```
  - In Phase 1.8, `fieldExecutionStartedAt` defaults to `null`, allowing undispatch to execute cleanly during Phase 1.8 operational testing.
  - When Phase 1.9 mobile workflows land, technician travel/clock-in actions will populate `fieldExecutionStartedAt = now()`, immediately activating this block without requiring modifications to Phase 1.8 schemas or services.

### 9.4 Technician Reassignment Post-Dispatch
If an appointment has already been dispatched and must be reassigned to a different technician:
1. The WorkOrder assignment must be updated via `reassignWorkOrder` (Phase 1.6).
2. The appointment must be rescheduled/updated with the new `technicianId`.
3. The system automatically executes conflict checks on the new technician's calendar.
4. The appointment's `dispatchStatus` is automatically reset to `PENDING_DISPATCH`, requiring explicit re-dispatch to notify the new technician.

---

## 10. Relationships & Entity Traversal

```
+-----------------------------------------------------------------------------------------------+
|                                      RELATIONSHIP MAP                                         |
|                                                                                               |
|   +-------------------+                                                                       |
|   |     WORKSPACE     |                                                                       |
|   +---------+---------+                                                                       |
|             | 1:N (Cascade Delete)                                                            |
|             v                                                                                 |
|   +-------------------+ 1:N (Restrict)  +-------------------+ 1:N (Restrict)                 |
|   |    WORK ORDER     |<----------------|SCHEDULEAPPOINTMENT|---------------->+               |
|   +---------+---------+                 +---------+---------+                 |               |
|             |                                     | 1:N (Cascade)             |               |
|             | Traversal                           v                           v               |
|             +------------> Customer     +-------------------+       +-------------------+     |
|             +------------> Location     |APPOINTMENT HISTORY|       |TECHNICIAN PROFILE |     |
|             +------------> Asset        +-------------------+       +-------------------+     |
+-----------------------------------------------------------------------------------------------+
```

### 10.1 Prisma Relationship Specifications

1. **`workspace` (`Workspace`)**:
   - `workspaceId String` $\rightarrow$ `@relation(fields: [workspaceId], references: [id], onDelete: Cascade)`
   - **Justification**: Enforces complete tenant isolation. Deleting a workspace purges all scheduling records.
2. **`workOrder` (`WorkOrder`)**:
   - `workOrderId String` $\rightarrow$ `@relation(fields: [workOrderId], references: [id], onDelete: Restrict)`
   - **Justification**: An appointment cannot exist without a valid parent WorkOrder. Deleting a WorkOrder is restricted while active appointments exist.
3. **`technician` (`TechnicianProfile`)**:
   - `technicianId String` $\rightarrow$ `@relation(fields: [technicianId], references: [id], onDelete: Restrict)`
   - **Justification**: Direct foreign key enables $O(1)$ indexed lookups for technician calendar queries without requiring a join through `WorkOrder`.
4. **`Customer`, `ServiceLocation`, `Asset` (Traversal through `WorkOrder`)**:
   - Accessed via relational traversal: `appointment.workOrder.customer`, `appointment.workOrder.location`, `appointment.workOrder.asset`.
   - **Justification**: Customer, location, and asset are intrinsic properties of the WorkOrder. Denormalizing foreign keys onto `ScheduleAppointment` would violate third normal form (3NF), create data synchronization risks if a WorkOrder's asset or location is updated, and introduce redundant database constraints.
5. **`dispatchedByMember` / `undispatchedByMember` (`WorkspaceMember`)**:
   - `@relation(fields: [dispatchedByMemberId], references: [id], onDelete: SetNull)`
   - **Justification**: Preserves appointment integrity and audit tracking even if a staff member's workspace membership is later removed.

### 10.2 Relationship to Legacy `TechnicianAssignment`
In Phase 1.3, `TechnicianAssignment` was created as an early generic assignment model. In Phase 1.8:
- `ScheduleAppointment` is the **authoritative, first-class system of record** for all WorkOrder scheduling.
- `ScheduleAppointment` does **not** write or synchronize duplicate rows into `TechnicianAssignment`.
- The conflict detection engine queries `ScheduleAppointment` as the definitive booking ledger.

---

## 11. Tenant Isolation & Role-Based Access Control (RBAC)

### 11.1 Tenant Isolation Invariants
Aforden's multi-tenant security architecture requires that:
1. Every query, mutation, count, and conflict lookup must include `workspaceId` in its Prisma `where` clause.
2. Entity lookups by ID must use compound tenant scoping (`where: { id: appointmentId, workspaceId }`).
3. If an entity exists in another tenant workspace, the query returns `null` and throws `ScheduleAppointmentNotFoundError` (HTTP 404). This prevents ID enumeration and cross-tenant information leaks.

### 11.2 Permission Keys Operationalized

The four Scheduler permission keys were declared in Phase 1.2 within `lib/services/authorization/permissions.ts` and mapped in `rolePermissions.ts` as architectural placeholders. Phase 1.8 is the first phase to operationalize and enforce them across business services and API route handlers:

```typescript
export const PERMISSIONS = {
    SCHEDULER_VIEW: "scheduler.view",
    SCHEDULER_CREATE: "scheduler.create",
    SCHEDULER_UPDATE: "scheduler.update",
    SCHEDULER_DELETE: "scheduler.delete",
} as const;
```

### 11.3 Role Permission Matrix

| Operation | Required Permission | `OWNER` | `ADMIN` | `MANAGER` | `DISPATCHER` | `TECHNICIAN` | `ACCOUNTANT` |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| View Calendar / Appointments | `SCHEDULER_VIEW` | ✅ | ✅ | ✅ | ✅ | ✅ *(Own only)* | ❌ |
| Create Appointment / Book Slot | `SCHEDULER_CREATE` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Reschedule / Adjust Time Window | `SCHEDULER_UPDATE` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Dispatch / Undispatch Appointment | `SCHEDULER_UPDATE` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Acknowledge Dispatch | `SCHEDULER_VIEW`* | ❌ | ❌ | ❌ | ❌ | ✅ *(Assigned)* | ❌ |
| Cancel Appointment | `SCHEDULER_DELETE` | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| View Appointment History | `SCHEDULER_VIEW` | ✅ | ✅ | ✅ | ✅ | ✅ *(Own only)* | ❌ |

*Note: For users with the `TECHNICIAN` role, all queries and actions are automatically scoped to appointments where `technician.employee.workspaceMember.userId === session.user.id`.*

---

## 12. Execution-Order Invariant

All services implemented across Phase 1.8 must strictly adhere to Aforden's locked 7-step pipeline:

$$\text{AUTH} \longrightarrow \text{PERMISSION} \longrightarrow \text{VALIDATION} \longrightarrow \text{RESOLUTION} \longrightarrow \text{BUSINESS LOGIC} \longrightarrow \text{PERSISTENCE / TRANSACTION} \longrightarrow \text{CANONICAL READ MODEL}$$

```
+-------------------------------------------------------------------------------------------------------+
| 1. AUTH: requireWorkspaceAuthorization(workspaceId)                                                   |
|    - Validates session, extracts active membership and user record.                                   |
+-------------------------------------------------------------------------------------------------------+
| 2. PERMISSION: assertPermission(role, PERMISSIONS.SCHEDULER_*)                                        |
|    - Validates membership role against required permission key.                                       |
+-------------------------------------------------------------------------------------------------------+
| 3. VALIDATION: schema.parse(input)                                                                    |
|    - Validates payload types, date formats, string lengths, and basic bounds using Zod.               |
+-------------------------------------------------------------------------------------------------------+
| 4. RESOLUTION: Tenant-Scoped Entity Lookups                                                          |
|    - Loads WorkOrder and TechnicianProfile using { id, workspaceId } (404 IDOR protection).           |
+-------------------------------------------------------------------------------------------------------+
| 5. BUSINESS LOGIC: Preconditions & Conflict Evaluation                                                |
|    - Enforces start < end, checks WorkOrder assignment matching, runs conflict detection algorithm.   |
+-------------------------------------------------------------------------------------------------------+
| 6. PERSISTENCE / TRANSACTION: prisma.$transaction                                                     |
|    - Creates/updates ScheduleAppointment and creates ScheduleAppointmentHistory audit record.          |
+-------------------------------------------------------------------------------------------------------+
| 7. CANONICAL READ MODEL: toScheduleAppointmentReadModel(record)                                       |
|    - Transforms Prisma entity into frozen canonical read model projection.                            |
+-------------------------------------------------------------------------------------------------------+
```

---

## 13. Error Taxonomy

All Scheduling & Dispatch domain errors are defined in `lib/services/schedule/scheduleErrors.ts`. They are pure domain exceptions translated to HTTP responses by route handlers:

| Error Class | HTTP Status | Trigger Condition (When it fires) |
| :--- | :---: | :--- |
| `ScheduleAppointmentNotFoundError` | `404` | Appointment ID does not exist within the caller's tenant workspace. |
| `ScheduleWorkOrderNotFoundError` | `404` | Target WorkOrder ID does not exist within the caller's tenant workspace. |
| `ScheduleWorkOrderNotAssignedError` | `422` | Attempted to schedule a WorkOrder that has no assigned technician (`assignedTechnicianId === null`). |
| `ScheduleTechnicianMismatchError` | `422` | Appointment technician does not match the WorkOrder's assigned technician. |
| `ScheduleWorkOrderNotEligibleError` | `422` | Target WorkOrder is in a terminal status (`COMPLETED` or `CANCELLED`) and cannot be scheduled. |
| `ScheduleTechnicianNotFoundError` | `404` | Target TechnicianProfile ID does not exist within the caller's tenant workspace. |
| `ScheduleTechnicianNotEligibleError` | `422` | Technician is inactive, suspended, or does not meet workspace service requirements. |
| `ScheduleInvalidTimeIntervalError` | `400` | Start time is not strictly before end time (`scheduledStart >= scheduledEnd`) or duration is invalid. |
| `ScheduleTechnicianConflictError` | `409` | Technician has an active overlapping appointment during the requested interval. |
| `ScheduleInvalidStatusTransitionError` | `409` | Requested state transition is not permitted by the status state machine. |
| `ScheduleImmutableError` | `409` | Attempted to modify or reschedule an appointment in a terminal state (`CANCELLED`, `COMPLETED`). |
| `ScheduleMissingCancellationReasonError`| `400` | Attempted to cancel an appointment without providing a mandatory cancellation reason. |
| `DispatchNotAllowedError` | `409` | Attempted to dispatch an appointment that is cancelled, completed, unassigned, or in conflict. |
| `UndispatchNotAllowedError` | `409` | Attempted to undispatch an appointment that is not dispatched or has already begun field execution (`fieldExecutionStartedAt !== null`). |
| `ScheduleDeletionNotAllowedError` | `409` | Attempted to delete an appointment that has active dispatch history or downstream audit dependencies. |

---

## 14. Canonical Read Model

To guarantee consistent API responses, prevent $N+1$ query cascades in dispatch board views, and enforce clean domain boundaries, all scheduling service operations return the frozen **`ScheduleAppointmentReadModel`**:

```typescript
export interface ScheduleAppointmentReadModel {
    id: string;
    workspaceId: string;
    appointmentNumber: string;

    // Parent WorkOrder Information
    workOrderId: string;
    workOrderNumber: string;
    workOrderTitle: string;
    workOrderStatus: string;
    workOrderPriority: string;

    // Customer & Service Location Projections
    customerId: string;
    customerName: string;
    customerNumber: string | null;

    locationId: string;
    locationName: string;
    locationAddress: string;
    locationLatitude: number | null;
    locationLongitude: number | null;

    // Associated Asset (if linked to WorkOrder)
    assetId: string | null;
    assetName: string | null;
    assetNumber: string | null;

    // Assigned Technician Information
    technicianId: string;
    technicianName: string;
    technicianEmployeeNumber: string | null;

    // Calendar Interval & Timezone
    scheduledStart: Date;
    scheduledEnd: Date;
    durationMinutes: number;
    timezone: string;

    // Lifecycle & Dispatch States
    status: "SCHEDULED" | "RESCHEDULED" | "CANCELLED" | "COMPLETED";
    dispatchStatus: "PENDING_DISPATCH" | "DISPATCHED" | "ACKNOWLEDGED";

    // Dispatch Tracking Metadata
    dispatchedAt: Date | null;
    dispatchedByMemberId: string | null;
    dispatchedByName: string | null;

    undispatchedAt: Date | null;
    undispatchedByMemberId: string | null;

    fieldExecutionStartedAt: Date | null;

    // Notes & Explanations
    cancellationReason: string | null;
    notes: string | null;
    metadata: Record<string, any> | null;

    // Timestamps
    createdAt: Date;
    updatedAt: Date;
}

export interface ScheduleAppointmentListResult {
    items: ScheduleAppointmentReadModel[];
    pagination: {
        total: number;
        page: number;
        limit: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
    };
}
```

---

## 15. Historical Requirements Preview (Phase 1.8.10 Audit Ledger)

In Phase 1.8.10, an append-only audit trail service will record all mutations into `ScheduleAppointmentHistory`. To ensure the data model fully supports these requirements from Day 1, the 7 historical events of `ScheduleHistoryEventType` are defined as follows:

1. **`CREATED` Event**:
   - Recorded immediately upon initial appointment creation.
   - Captures: `scheduledStart`, `scheduledEnd`, `durationMinutes`, `technicianId`, and creator identity.
2. **`RESCHEDULED` Event**:
   - Recorded whenever calendar time boundaries or duration are modified.
   - Captures: previous interval (`oldValue: "[oldStart, oldEnd]"`), new interval (`newValue: "[newStart, newEnd]"`), delta duration, reason for rescheduling, and actor.
3. **`DISPATCHED` Event**:
   - Recorded when an appointment transitions from `PENDING_DISPATCH` to `DISPATCHED`.
   - Captures: dispatch timestamp, dispatcher member ID, and dispatcher name snapshot.
4. **`UNDISPATCHED` Event**:
   - Recorded when an appointment is recalled from `DISPATCHED` (or `ACKNOWLEDGED`) back to `PENDING_DISPATCH`.
   - Captures: recall timestamp, reason for undispatch, and actor.
5. **`CANCELLED` Event**:
   - Recorded when an appointment is cancelled.
   - Captures: mandatory `cancellationReason`, cancellation timestamp, and actor.
6. **`COMPLETED` Event**:
   - Recorded when an appointment reaches completion.
   - Captures: completion timestamp and actor.
7. **`UPDATED` Event**:
   - Recorded when non-temporal, non-lifecycle metadata is modified (e.g., updating operational `notes`, `metadata` JSON, or acknowledgment state) without altering the calendar interval `[scheduledStart, scheduledEnd)`.
   - Captures: specific modified `field` (e.g., `"notes"`, `"dispatchStatus"`), text snapshots of `oldValue` and `newValue`, and actor.
   - **Distinction**: Rescheduling changes to start/end times strictly emit `RESCHEDULED`; general metadata edits strictly emit `UPDATED`.

---

## 16. Explicit Boundaries & Future Phase Deferrals

To maintain architectural discipline and prevent scope creep, it is explicitly confirmed in writing that this document and Phase 1.8 **do NOT include**:

- ❌ **Technician Mobile Operations & Field Workflows** (Phase 1.9): Offline mobile caching, en-route drive tracking, on-site clocking, dynamic checklists, and signature capture.
- ❌ **Inventory & Parts Management** (Phase 1.10): Truck stock deduction, warehouse reservation, parts replenishment, and purchase orders.
- ❌ **Quotes & Estimates** (Phase 1.11): Pre-work cost estimations, customer quote approvals, and conversion to work orders.
- ❌ **Invoicing & Payments** (Phase 1.12): Generating invoice line items from completed schedules, payment processing (Stripe), and tax calculations.
- ❌ **Automated Notifications & Communications** (Phase 1.13): Outbound SMS appointment reminders, customer email dispatch notices, and push notifications.
- ❌ **Reporting & Analytics** (Phase 1.14): Technician utilization dashboards, SLA breach metrics, and travel-time efficiency analytics.
- ❌ **Automation & Workflows** (Phase 1.16): AI auto-scheduling engines, rule-based dispatch routing, and automated calendar optimization.
- ❌ **External Integrations** (Phase 1.17): Google Calendar / Outlook two-way sync, IoT telemetry triggers.
- ❌ **Public Developer API** (Phase 1.18): External developer webhooks and REST API endpoints.
- ❌ **Frontend User Interfaces** (Phase 1.23): React calendar components, FullCalendar/Gantt board layouts, and drag-and-drop dispatch board UI.

---

## Summary of Architectural Approvals

| Section | Architectural Standard | Status |
| :--- | :--- | :---: |
| 1. Domain Responsibility | Clear ownership of calendar scheduling, intervals, conflicts, dispatch, and acknowledgment entry point. | **LOCKED** |
| 2. Architectural Distinction | $WO \text{ Assignment} \neq \text{Schedule} \neq \text{Dispatch} \neq \text{Execution}$. Assignment verified as prerequisite. | **LOCKED** |
| 3. Model Decision | Unified `ScheduleAppointment` model with integrated dispatch status and execution guard placeholder. | **LOCKED** |
| 4. Field Contract | Detailed field tables for `ScheduleAppointment` (including `fieldExecutionStartedAt`) and `ScheduleAppointmentHistory`. | **LOCKED** |
| 5. Status Model | 4-state `ScheduleStatus` + 3-state `DispatchStatus` with consistent transition matrices and diagrams. | **LOCKED** |
| 6. Time & Timezone Strategy | UTC storage + IANA timezone persistence + stored derived duration. | **LOCKED** |
| 7. Conflict Detection | Half-open $[start, end)$ intervals; touching boundaries permitted; hard tech conflict. | **LOCKED** |
| 8. Availability Boundaries | Scope bounded to hard schedule conflicts + Phase 1.3 shift/exception checks. | **LOCKED** |
| 9. Dispatch Lifecycle | Dispatch / Undispatch rules, execution guard mechanics, and post-dispatch reassignment rules. | **LOCKED** |
| 10. Relationships | Direct FKs to WorkOrder and Technician; 3NF traversal for Customer/Location/Asset; clarification of `TechnicianAssignment`. | **LOCKED** |
| 11. Tenant Isolation & RBAC | Strict `workspaceId` scoping, operationalization of the 4 Phase 1.2 `SCHEDULER_*` permissions. | **LOCKED** |
| 12. Execution Order | Locked 7-step pipeline (`AUTH` $\rightarrow$ `PERMISSION` $\rightarrow$ `VALIDATION` $\rightarrow$ `RESOLUTION` $\rightarrow$ `LOGIC` $\rightarrow$ `TX` $\rightarrow$ `READ MODEL`). | **LOCKED** |
| 13. Error Taxonomy | 15 standardized domain error classes with exact trigger conditions. | **LOCKED** |
| 14. Canonical Read Model | Full projection contract with denormalized customer/location/technician fields and execution timestamp. | **LOCKED** |
| 15. History & Audit Ledger | 7 historical event types for Phase 1.8.10 audit ledger explicitly defined. | **LOCKED** |
