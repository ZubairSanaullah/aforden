# Phase 1.8.2 — Scheduling & Dispatch Prisma/Data Model Walkthrough

## Overview

This walkthrough documents the implementation of **Phase 1.8.2: Scheduling & Dispatch Prisma / Data Model**.
All models, fields, enums, relations, and indices trace directly and unambiguously to the locked Phase 1.8.1 architectural specification in [`phase-1.8.1-scheduling-dispatch-domain-architecture.md`](file:///d:/Download/aforden/docs/architecture/phase-1.8.1-scheduling-dispatch-domain-architecture.md).

- **Schema File**: [`prisma/schema.prisma`](file:///d:/Download/aforden/prisma/schema.prisma)
- **Migration File**: [`prisma/migrations/20260821101500_add_scheduling_and_dispatch_domain/migration.sql`](file:///d:/Download/aforden/prisma/migrations/20260821101500_add_scheduling_and_dispatch_domain/migration.sql)
- **Test Files**:
  - [`tests/schedule/schedule-model.test.ts`](file:///d:/Download/aforden/tests/schedule/schedule-model.test.ts)
  - [`tests/schedule/schedule-referential-actions.test.ts`](file:///d:/Download/aforden/tests/schedule/schedule-referential-actions.test.ts)

---

## 1. Traceability Matrix: Phase 1.8.1 Specification to Phase 1.8.2 Implementation

### 1.1 Enums Traceability

| Enum Name | Enum Values | Phase 1.8.1 Specification Reference | Implementation Status |
| :--- | :--- | :--- | :---: |
| `ScheduleStatus` | `SCHEDULED`, `RESCHEDULED`, `CANCELLED`, `COMPLETED` | Section 5.1 | ✅ Implemented |
| `DispatchStatus` | `PENDING_DISPATCH`, `DISPATCHED`, `ACKNOWLEDGED` | Section 5.1 | ✅ Implemented |
| `ScheduleHistoryEventType` | `CREATED`, `RESCHEDULED`, `CANCELLED`, `COMPLETED`, `DISPATCHED`, `UNDISPATCHED`, `UPDATED` | Section 5.1 & Section 15 | ✅ Implemented |

### 1.2 `ScheduleAppointment` Model Traceability

| Field Name | Prisma Type | Constraints / Defaults | Phase 1.8.1 Specification Reference | Implementation Status |
| :--- | :--- | :--- | :--- | :---: |
| `id` | `String` | `@id @default(cuid())` | Section 4.1 | ✅ Implemented |
| `workspaceId` | `String` | `NOT NULL`, FK to `Workspace` | Section 4.1 & 10.1 | ✅ Implemented |
| `appointmentNumber` | `String` | `NOT NULL`, Unique per workspace | Section 4.1 | ✅ Implemented |
| `workOrderId` | `String` | `NOT NULL`, FK to `WorkOrder` | Section 4.1 & 10.1 | ✅ Implemented |
| `technicianId` | `String` | `NOT NULL`, FK to `TechnicianProfile` | Section 4.1 & 10.1 | ✅ Implemented |
| `scheduledStart` | `DateTime` | `NOT NULL`, UTC timestamp | Section 4.1 & 6.1 | ✅ Implemented |
| `scheduledEnd` | `DateTime` | `NOT NULL`, UTC timestamp | Section 4.1 & 6.1 | ✅ Implemented |
| `durationMinutes` | `Int` | `NOT NULL`, Derived integer | Section 4.1 & 6.3 | ✅ Implemented |
| `timezone` | `String` | `NOT NULL`, IANA timezone string | Section 4.1 & 6.2 | ✅ Implemented |
| `status` | `ScheduleStatus` | `@default(SCHEDULED)` | Section 4.1 & 5.1 | ✅ Implemented |
| `dispatchStatus` | `DispatchStatus` | `@default(PENDING_DISPATCH)` | Section 4.1 & 5.1 | ✅ Implemented |
| `dispatchedAt` | `DateTime?` | `NULLABLE`, UTC timestamp | Section 4.1 | ✅ Implemented |
| `dispatchedByMemberId` | `String?` | `NULLABLE`, FK to `WorkspaceMember` | Section 4.1 & 10.1 | ✅ Implemented |
| `undispatchedAt` | `DateTime?` | `NULLABLE`, UTC timestamp | Section 4.1 | ✅ Implemented |
| `undispatchedByMemberId` | `String?` | `NULLABLE`, FK to `WorkspaceMember` | Section 4.1 & 10.1 | ✅ Implemented |
| `fieldExecutionStartedAt` | `DateTime?`| `NULLABLE`, Phase 1.9 execution guard | Section 4.1 & 9.3 | ✅ Implemented |
| `cancellationReason` | `String?` | `NULLABLE`, `@db.Text` | Section 4.1 | ✅ Implemented |
| `notes` | `String?` | `NULLABLE`, `@db.Text` | Section 4.1 | ✅ Implemented |
| `metadata` | `Json?` | `NULLABLE`, JSONB payload | Section 4.1 | ✅ Implemented |
| `createdAt` | `DateTime` | `@default(now())` | Section 4.1 | ✅ Implemented |
| `updatedAt` | `DateTime` | `@updatedAt` | Section 4.1 | ✅ Implemented |

### 1.3 `ScheduleAppointmentHistory` Model Traceability

| Field Name | Prisma Type | Constraints / Defaults | Phase 1.8.1 Specification Reference | Implementation Status |
| :--- | :--- | :--- | :--- | :---: |
| `id` | `String` | `@id @default(cuid())` | Section 4.2 | ✅ Implemented |
| `workspaceId` | `String` | `NOT NULL`, FK to `Workspace` | Section 4.2 & 10.1 | ✅ Implemented |
| `appointmentId` | `String` | `NOT NULL`, FK to `ScheduleAppointment` | Section 4.2 & 10.1 | ✅ Implemented |
| `eventType` | `ScheduleHistoryEventType` | `NOT NULL`, Enum | Section 4.2 & 5.1 | ✅ Implemented |
| `actorMemberId` | `String?` | `NULLABLE`, FK to `WorkspaceMember` | Section 4.2 & 10.1 | ✅ Implemented |
| `actorName` | `String?` | `NULLABLE`, Actor display name snapshot | Section 4.2 | ✅ Implemented |
| `field` | `String?` | `NULLABLE`, Specific field modified | Section 4.2 & 15.7 | ✅ Implemented |
| `oldValue` | `String?` | `NULLABLE`, `@db.Text` | Section 4.2 | ✅ Implemented |
| `newValue` | `String?` | `NULLABLE`, `@db.Text` | Section 4.2 | ✅ Implemented |
| `metadata` | `Json?` | `NULLABLE`, JSONB payload | Section 4.2 | ✅ Implemented |
| `createdAt` | `DateTime` | `@default(now())` | Section 4.2 | ✅ Implemented |

### 1.4 Referential Actions & Cascades (§10.1)

| Relation | Source Model $\rightarrow$ Target Model | Referential Action (`onDelete`) | Justification from §10.1 |
| :--- | :--- | :---: | :--- |
| `workspace` | `ScheduleAppointment` $\rightarrow$ `Workspace` | `Cascade` | Complete tenant purge on workspace deletion. |
| `workOrder` | `ScheduleAppointment` $\rightarrow$ `WorkOrder` | `Restrict` | Prevents deleting a WorkOrder with active appointment records. |
| `technician` | `ScheduleAppointment` $\rightarrow$ `TechnicianProfile` | `Restrict` | Prevents deleting a technician profile with active bookings. |
| `dispatchedByMember` | `ScheduleAppointment` $\rightarrow$ `WorkspaceMember` | `SetNull` | Preserves appointment record if staff member leaves. |
| `undispatchedByMember` | `ScheduleAppointment` $\rightarrow$ `WorkspaceMember` | `SetNull` | Preserves appointment record if staff member leaves. |
| `workspace` | `ScheduleAppointmentHistory` $\rightarrow$ `Workspace` | `Cascade` | Purges audit history on workspace deletion. |
| `appointment` | `ScheduleAppointmentHistory` $\rightarrow$ `ScheduleAppointment` | `Cascade` | Purges appointment audit history on appointment deletion. |
| `actorMember` | `ScheduleAppointmentHistory` $\rightarrow$ `WorkspaceMember` | `SetNull` | Preserves audit records if staff member is removed. |

### 1.5 Indices and Unique Constraints

| Target Model | Index / Constraint Definition | Purpose in Specification |
| :--- | :--- | :--- |
| `ScheduleAppointment` | `@@unique([workspaceId, appointmentNumber])` | Tenant-scoped uniqueness of human-readable reference. |
| `ScheduleAppointment` | `@@index([workspaceId, technicianId, scheduledStart, scheduledEnd])` | $O(1)$ overlap conflict detection queries (§7.2, §12). |
| `ScheduleAppointment` | `@@index([workspaceId, workOrderId])` | Scoped lookup of all appointments for a WorkOrder. |
| `ScheduleAppointment` | `@@index([workspaceId, scheduledStart, scheduledEnd])` | Dispatch board date-range grid and Gantt timeline rendering. |
| `ScheduleAppointment` | `@@index([workspaceId, status])` | Filter by lifecycle state (`SCHEDULED`, `RESCHEDULED`, etc.). |
| `ScheduleAppointment` | `@@index([workspaceId, dispatchStatus])` | Filter by dispatch queue (`PENDING_DISPATCH`, `DISPATCHED`). |
| `ScheduleAppointmentHistory` | `@@index([workspaceId, appointmentId, createdAt])` | Chronological audit ledger lookups for an appointment. |
| `ScheduleAppointmentHistory` | `@@index([eventType])` | Audit queries filtered by mutation type. |

---

## 2. Verification & Automated Test Results

### 2.1 Schedule Data Model Tests (`tests/schedule/schedule-model.test.ts`)
- ✅ Verifies creation of `ScheduleAppointment` with all 21 fields.
- ✅ Verifies default values (`status = SCHEDULED`, `dispatchStatus = PENDING_DISPATCH`, `fieldExecutionStartedAt = null`).
- ✅ Verifies all 4 values of `ScheduleStatus` enum.
- ✅ Verifies all 3 values of `DispatchStatus` enum.
- ✅ Verifies creation of `ScheduleAppointmentHistory` across all 7 `ScheduleHistoryEventType` values.
- ✅ Verifies `@@unique([workspaceId, appointmentNumber])` constraint enforcement per workspace and permits identical numbers across distinct tenants.

### 2.2 Referential Actions & Cascade Tests (`tests/schedule/schedule-referential-actions.test.ts`)
- ✅ Verifies `onDelete: Restrict` on `WorkOrder` deletion with active appointments.
- ✅ Verifies `onDelete: Restrict` on `TechnicianProfile` deletion with active appointments.
- ✅ Verifies `onDelete: Cascade` on `ScheduleAppointment` deleting `ScheduleAppointmentHistory`.
- ✅ Verifies `onDelete: Cascade` on `Workspace` deleting appointments and history.
- ✅ Verifies `onDelete: SetNull` on `WorkspaceMember` deletion.

---

## 3. Schema & Client Generation

- **Prisma Schema Validation**: `npx prisma validate` completed with code `0` (Schema valid).
- **Client Generation**: `npx prisma generate` updated `@/generated/prisma` client with types for `ScheduleAppointment`, `ScheduleAppointmentHistory`, and all 3 enums.
- **Scope Compliance**: No services, no API routes, and no UI components were introduced in this schema-only sub-phase.
