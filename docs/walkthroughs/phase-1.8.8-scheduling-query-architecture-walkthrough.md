# Phase 1.8.8 — Scheduling Directory & Calendar Query Architecture Walkthrough

## Overview

This walkthrough documents the implementation, verification, and architectural corrections for **Phase 1.8.8: Scheduling Directory & Calendar Query Architecture (`getSchedule`, `listSchedules`, `getTechnicianSchedule`, `getWorkOrderSchedule`)**.
This layer delivers high-performance, tenant-isolated query services powering dispatch consoles, technician calendar views, WorkOrder historical timelines, and directory filtering with strict N+1 query prevention.

- **Single Record Query**: [`lib/services/schedule/getSchedule.ts`](file:///d:/Download/aforden/lib/services/schedule/getSchedule.ts)
- **Directory / Filter Query**: [`lib/services/schedule/listSchedules.ts`](file:///d:/Download/aforden/lib/services/schedule/listSchedules.ts)
- **Technician Calendar Query**: [`lib/services/schedule/getTechnicianSchedule.ts`](file:///d:/Download/aforden/lib/services/schedule/getTechnicianSchedule.ts)
- **WorkOrder Timeline Query**: [`lib/services/schedule/getWorkOrderSchedule.ts`](file:///d:/Download/aforden/lib/services/schedule/getWorkOrderSchedule.ts)
- **Test File**: [`tests/schedule/schedule-query-services.test.ts`](file:///d:/Download/aforden/tests/schedule/schedule-query-services.test.ts) (20 tests)

---

## 1. Architectural Policy Decisions & Traversal Paths

### 1.1 Decision 1: CANCELLED-Visibility Default in Calendar Views (`getTechnicianSchedule`)
> [!IMPORTANT]
> **Policy**: `CANCELLED` appointments are **excluded by default** in `getTechnicianSchedule()`.
>
> - **Rationale**: Dispatch consoles and technician day-view calendars must display active working intervals without visual clutter or ambiguity regarding active bookings.
> - **Inclusion Flag**: Callers can explicitly view cancelled slots by passing `includeCancelled: true` in `GetTechnicianScheduleQueryInput`.

### 1.2 Decision 2: Search Field Traversal Paths in Directory Listing (`listSchedules`)
Full-text / search filtering across appointments executes multi-relational case-insensitive traversal across the following verified Prisma schema paths:
1. `appointmentNumber` (Direct field on `ScheduleAppointment`)
2. `notes` (Direct field on `ScheduleAppointment`)
3. `workOrder.workOrderNumber` (Traversed through `WorkOrder`)
4. `workOrder.title` (Traversed through `WorkOrder`)
5. `workOrder.customer.name` (Traversed through `WorkOrder.customer`)
6. `workOrder.location.name` (Traversed through `WorkOrder.location`)
7. `technician.employee.displayName` (Traversed through `TechnicianProfile.employee`)

### 1.3 Customer & Location Filter Relational Traversal
Since `customerId` and `locationId` are normalized on `WorkOrder` rather than duplicated on `ScheduleAppointment` (per §10.1), directory filtering traverses through the parent relation:
```typescript
if (query.customerId || query.locationId) {
    whereClause.workOrder = {};
    if (query.customerId) whereClause.workOrder.customerId = query.customerId;
    if (query.locationId) whereClause.workOrder.locationId = query.locationId;
}
```

---

## 2. N+1 Prevention & Automated Query-Count Verification

### 2.1 Canonical Relational Include Shape
Every query service uses a single Prisma query with the shared, canonical include definition:

```typescript
export const SCHEDULE_APPOINTMENT_INCLUDE = {
    workOrder: {
        include: {
            customer: true,
            location: true,
            asset: true,
        },
    },
    technician: {
        include: {
            employee: true,
        },
    },
    dispatchedByMember: {
        include: {
            user: true,
        },
    },
    undispatchedByMember: {
        include: {
            user: true,
        },
    },
} as const;
```

### 2.2 Automated Query-Count Assertion Methodology
Rather than relying on manual inspection, N+1 query prevention is verified by an automated regression test in [`tests/schedule/schedule-query-services.test.ts`](file:///d:/Download/aforden/tests/schedule/schedule-query-services.test.ts#L430-L469):
- **Test Name**: `"asserts exactly 1 findMany and 1 count call for N=10 records with 0 follow-up queries"`
- **Assertion**:
  - Fetches a batch of $N = 10$ appointments.
  - Spies on all secondary Prisma entity delegates (`technicianProfile.findFirst`, `workOrder.findFirst`).
  - Asserts that `findMany` executes **exactly 1 time** and `count` executes **exactly 1 time**.
  - Asserts that secondary entity queries execute **0 times** (`toHaveBeenCalledTimes(0)`).
  - Asserts that all 10 read models are completely projected with denormalized customer, location, and technician data.

---

## 3. Strict Tenant Isolation (§11.1)

Tenant isolation is verified by dedicated automated tests covering all four query entry points:
- **`listSchedules`**: Confirms `where.workspaceId` is strictly scoped to the caller's workspace across all filter combinations (technician, work order, status, customer, location, search).
- **`getTechnicianSchedule`**: Rejects cross-workspace technician queries with `ScheduleTechnicianNotFoundError` (404), and strictly scopes appointment find operations by `workspaceId`.
- **`getSchedule`**: Rejects cross-workspace appointment IDs with `ScheduleAppointmentNotFoundError` (404).
- **`getWorkOrderSchedule`**: Rejects cross-workspace WorkOrder IDs with `ScheduleWorkOrderNotFoundError` (404).

---

## 4. Traceability Matrix: Phase 1.8.1 Specification to Phase 1.8.8 Implementation

| Service / Capability | Architectural Specification | Implementation in Service | Verification Test |
| :--- | :--- | :--- | :---: |
| **`getSchedule`** | RBAC Permission | `SCHEDULER_VIEW` required. | `getSchedule happy path` |
| **`getSchedule`** | Scoped Lookup & 404 | Tenant-scoped lookup `{ id, workspaceId }`. | `ScheduleAppointmentNotFoundError` (404) |
| **`getSchedule`** | Tenant Isolation (§11.1) | Cross-workspace ID lookup rejected. | `Tenant Isolation: getSchedule 404 test` |
| **`listSchedules`** | Pagination Metadata | Computes `page`, `limit`, `total`, `totalPages`, `hasNextPage`, `hasPreviousPage`. | `Pagination & bounds test` |
| **`listSchedules`** | Sort Allowlist | Rejects arbitrary orderBy strings; allows `scheduledStart`, `scheduledEnd`, `createdAt`, `updatedAt`, `status`. | `Sort allowlist validation test` |
| **`listSchedules`** | Relational Filters | Traversal through `workOrder.customerId` and `workOrder.locationId`. | `Customer & location filter test` |
| **`listSchedules`** | Date Overlap Filter | Half-open overlap: `scheduledStart < endDate AND scheduledEnd > startDate`. | `Date range overlap test` |
| **`listSchedules`** | Search Traversal | Multi-field search across appointment, work order, customer, location, and technician. | `Search traversal test` |
| **`listSchedules`** | Tenant Isolation (§11.1) | Scopes where clause to `workspaceId` across all filter parameters. | `Tenant Isolation: listSchedules scoping test` |
| **`getTechnicianSchedule`** | Calendar Interval Query | Half-open overlap for technician schedule windows. | `Technician calendar test` |
| **`getTechnicianSchedule`** | CANCELLED Filter Default | Excluded by default (`status != CANCELLED`), include via `includeCancelled: true`. | `Cancelled visibility test` |
| **`getTechnicianSchedule`** | Technician 404 Guard | Validates technician belongs to workspace. | `ScheduleTechnicianNotFoundError` (404) |
| **`getTechnicianSchedule`** | Tenant Isolation (§11.1) | Cross-workspace technician returns 404; appointment query scoped by `workspaceId`. | `Tenant Isolation: getTechnicianSchedule test` |
| **`getWorkOrderSchedule`** | WorkOrder Timeline | Retrieves all appointments for WorkOrder ordered by `scheduledStart` asc. | `WorkOrder timeline test` |
| **`getWorkOrderSchedule`** | WorkOrder 404 Guard | Validates WorkOrder belongs to workspace. | `ScheduleWorkOrderNotFoundError` (404) |
| **`getWorkOrderSchedule`** | Tenant Isolation (§11.1) | Cross-workspace WorkOrder returns 404. | `Tenant Isolation: getWorkOrderSchedule test` |
| **N+1 Safety** | Automated Query-Count Assertion | Spies on Prisma calls, asserting 1 findMany + 1 count + 0 follow-up queries for N=10. | `N+1 Prevention Query-Count test` |

---

## 5. Automated Test Results

```
 RUN  v4.1.10 D:/Download/aforden

 ✓ tests/schedule/schedule-query-services.test.ts (20 tests)
 ✓ tests/schedule/schedule-creation-service.test.ts (14 tests)
 ✓ tests/schedule/schedule-mutation-services.test.ts (15 tests)
 ✓ tests/schedule/technician-availability-conflict-matrix.test.ts (14 tests)
 ✓ tests/schedule/schedule-dispatch-services.test.ts (11 tests)
 ✓ tests/schedule/schedule-validation.test.ts (21 tests)
 ✓ tests/schedule/schedule-model.test.ts (7 tests)
 ✓ tests/schedule/schedule-errors.test.ts (5 tests)
 ✓ tests/schedule/schedule-referential-actions.test.ts (5 tests)

 Test Files  9 passed (9)
      Tests  112 passed (112)
```

---

## 6. Scope Compliance

- **Service Layer Only**: Implemented pure query logic across `getSchedule.ts`, `listSchedules.ts`, `getTechnicianSchedule.ts`, and `getWorkOrderSchedule.ts`.
- **Zero API Routes**: No HTTP route handlers or UI components were created.
- **Zero Query Backdoors**: Enforces strict parameter validation and allowlists without exposing arbitrary Prisma filters.
