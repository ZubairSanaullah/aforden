# Phase 1.8.1 — Scheduling & Dispatch Domain Architecture Audit Walkthrough

## Overview

This audit walkthrough validates the completed, corrected deliverable for **Phase 1.8.1: Scheduling & Dispatch Domain Architecture & Specification**.

- **Deliverable File**: [`phase-1.8.1-scheduling-dispatch-domain-architecture.md`](file:///d:/Download/aforden/docs/architecture/phase-1.8.1-scheduling-dispatch-domain-architecture.md)
- **Status**: All 6 audit correction items resolved; zero implementation code (`.ts` files) touched.

---

## Audit Correction Summary (Items 1–6)

### 1. `UNDISPATCHED` State Resolution
- **Resolution**: Cleaned up the `DispatchStatus` enum to 3 deterministic states: `PENDING_DISPATCH`, `DISPATCHED`, `ACKNOWLEDGED`.
- Undispatch is an operational action that transitions `dispatchStatus` back to `PENDING_DISPATCH`, records `undispatchedAt` / `undispatchedByMemberId` for row-level auditing, and emits an `UNDISPATCHED` event into `ScheduleAppointmentHistory`.
- The state diagram (Section 5.3), enum definitions (Section 5.1), field table (Section 4.1), and lifecycle description (Section 9.3) are now 100% mutually consistent.

### 2. `ACKNOWLEDGED` Boundary Contract
- **Resolution**: Documented the cross-phase contract between Phase 1.8 and Phase 1.9.
- Phase 1.8 owns the `ScheduleAppointment` table and exposes an authoritative service entry point:
  `acknowledgeDispatch(workspaceId: string, appointmentId: string, technicianUserId: string)` (built in Phase 1.8.7).
- When a technician acknowledges a dispatch in the mobile application (Phase 1.9), Phase 1.9 calls this Phase 1.8 service entry point rather than performing direct database writes.

### 3. Undispatch Precondition & `fieldExecutionStartedAt` Placeholder
- **Resolution**: Added `fieldExecutionStartedAt: DateTime?` to `ScheduleAppointment` (Section 4.1).
- In Phase 1.8, the `undispatchAppointment` service enforces:
  `if (appointment.fieldExecutionStartedAt !== null) throw new UndispatchNotAllowedError(...)`
- During Phase 1.8, this field defaults to `null`, enabling undispatch to pass cleanly in testing. When Phase 1.9 lands, mobile clock-in/travel actions will populate `fieldExecutionStartedAt = now()`, immediately locking undispatch without requiring schema or service retrofits.

### 4. `TechnicianAssignment` Relationship Clarification
- **Resolution**: Clarified that `ScheduleAppointment` is the first-class, normalized system of record for all WorkOrder scheduling in Aforden.
- Removed the stray "syncs TechnicianAssignment bridge" reference from Section 12 Step 6.
- Explicitly documented in Section 10.2 that `ScheduleAppointment` does not write duplicate rows to legacy Phase 1.3 `TechnicianAssignment`.

### 5. `UPDATED` Event Documented in Section 15
- **Resolution**: Documented all 7 historical event types in Section 15:
  1. `CREATED` (initial booking)
  2. `RESCHEDULED` (calendar interval / duration changes)
  3. `DISPATCHED` (transition to `DISPATCHED`)
  4. `UNDISPATCHED` (recall to `PENDING_DISPATCH`)
  5. `CANCELLED` (terminal cancellation with mandatory reason)
  6. `COMPLETED` (terminal completion)
  7. `UPDATED` (operational note and metadata edits without interval changes)

### 6. Clarification of `SCHEDULER_*` Permissions
- **Resolution**: Clarified in Section 11.2 that `SCHEDULER_VIEW`, `SCHEDULER_CREATE`, `SCHEDULER_UPDATE`, and `SCHEDULER_DELETE` were declared as foundational placeholders in Phase 1.2 (`permissions.ts` & `rolePermissions.ts`), and Phase 1.8 is the first phase to operationalize and enforce them across services and API routes.

---

## 15-Point Checklist Audit

| # | Architecture Section | Audit Verification | Status |
| :-: | :--- | :--- | :-: |
| **1** | **Domain Responsibility Statement** | Explicitly defines what Scheduling & Dispatch owns (intervals, calendar reservations, conflict detection, dispatch lifecycle, scheduling audit history) and what it does not own. | ✅ Passed |
| **2** | **Critical Architectural Distinction** | Documents $\text{WorkOrder Assignment} \neq \text{Schedule} \neq \text{Dispatch} \neq \text{Technician Execution}$. Establishes that WorkOrder assignment is a strict prerequisite. | ✅ Passed |
| **3** | **Model Decision** | Formally decides on a **unified model (`ScheduleAppointment`)** with embedded dispatch tracking. | ✅ Passed |
| **4** | **Field-Level Contract** | Full field tables for `ScheduleAppointment` (including `fieldExecutionStartedAt`) and `ScheduleAppointmentHistory`. | ✅ Passed |
| **5** | **Status Model & State Machine** | Formal definition of `ScheduleStatus` (4 states) and `DispatchStatus` (3 states) with aligned diagrams and matrices. | ✅ Passed |
| **6** | **Time & Timezone Strategy** | Strict UTC storage in database (`TIMESTAMPTZ`), hierarchical resolution of IANA timezones, and derived integer `durationMinutes`. | ✅ Passed |
| **7** | **Conflict Detection Rules** | Half-open $[start, end)$ semantics, overlap formula ($A.start < B.end \land B.start < A.end$), touching back-to-back allowed, hard tech conflict. | ✅ Passed |
| **8** | **Availability Boundaries** | Defines Phase 1.8 availability scope (hard schedule conflicts + Phase 1.3 shifts/time-off exceptions). | ✅ Passed |
| **9** | **Dispatch Lifecycle** | Roles authorized to dispatch/undispatch, execution guard mechanics, and post-dispatch reassignment mechanics. | ✅ Passed |
| **10** | **Relationships & Traversal** | Direct FKs to `Workspace`, `WorkOrder`, and `TechnicianProfile`. 3NF traversal for `Customer`, `Location`, `Asset`. Clarifies `TechnicianAssignment`. | ✅ Passed |
| **11** | **Tenant Isolation & RBAC** | Strict `workspaceId` scoping on all queries (404 IDOR protection), operationalization of the 4 Phase 1.2 `SCHEDULER_*` permissions. | ✅ Passed |
| **12** | **Execution-Order Invariant** | Restates the 7-step pipeline: $\text{AUTH} \rightarrow \text{PERMISSION} \rightarrow \text{VALIDATION} \rightarrow \text{RESOLUTION} \rightarrow \text{BUSINESS LOGIC} \rightarrow \text{PERSISTENCE/TX} \rightarrow \text{READ MODEL}$. | ✅ Passed |
| **13** | **Error Taxonomy** | Enforces 15 pure domain error classes with exact trigger conditions and HTTP status mappings. | ✅ Passed |
| **14** | **Canonical Read Model** | Defines `ScheduleAppointmentReadModel` with necessary denormalized fields to eliminate $N+1$ queries. | ✅ Passed |
| **15** | **Historical Requirements Preview** | Specifies all 7 historical event types for the Phase 1.8.10 audit ledger (`ScheduleAppointmentHistory`). | ✅ Passed |
| **—** | **Explicit Boundaries** | Confirms in writing the exclusion of Phases 1.9 through 1.23. | ✅ Passed |

---

## Conclusion & Readiness for Phase 1.8.2

The specification in [`phase-1.8.1-scheduling-dispatch-domain-architecture.md`](file:///d:/Download/aforden/docs/architecture/phase-1.8.1-scheduling-dispatch-domain-architecture.md) is now completely consistent, unambiguous, and ready for audit sign-off.
