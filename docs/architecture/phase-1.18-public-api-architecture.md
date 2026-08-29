# Phase 1.18.1 — Public API Architecture & Contract Specification

> **Document Status**: LOCKED FOR IMPLEMENTATION (Phase 1.18 Architecture Standard)  
> **Domain**: Public REST API, Developer Platform, API Key Authentication, Scoped Authorization, Versioning, Request/Response Envelopes, Error Taxonomy, Idempotency, Rate Limiting, Tenant Resolution, OpenApi Documentation  
> **Dependencies**: Phase 1.1 (Multi-Tenancy & Workspace Partitioning), Phase 1.2 (Authentication & RBAC), Phase 1.6 – Phase 1.12 (Core Domain Services), Phase 1.13 (Notifications), Phase 1.15 (SaaS Billing & Entitlements), Phase 1.16 (Automations & Workflows), Phase 1.17 (Third-Party Integrations)  
> **Target Sub-Phases**: Phase 1.18.2 – Phase 1.18.16  
> **Out of Scope (Explicit Non-Goals)**: Concrete Next.js Route Handlers (Phase 1.18.2+), Prisma Schema Migrations (Phase 1.18.2), OAuth 2.0 Authorization Server / App Store (Deferred to Phase 1.18.X), Developer Portal UI (Phase 1.23)

---

## Executive Summary

Phases 1.1 through 1.17 established Aforden's multi-tenant core foundation, operational field service domains (Work Orders, Scheduling & Dispatch, Mobile Technician Execution, Inventory & Parts, Quotes & Estimates, Invoicing & Field Payments), decoupled notification engine, analytical reporting models, SaaS monetization/entitlements, declarative automation workflow engine, and third-party provider integration abstractions.

Phase 1.18 introduces the **Public API & Developer Platform**: the sovereign, versioned, external-facing programmatic interface enabling third-party developers, customer IT teams, Zapier/Make connectors, and enterprise systems to securely interact with Aforden workspaces.

This document serves as the binding architectural specification for Phase 1.18. Ten foundational domain invariants govern the public API:

1. **Domain Service Encapsulation Invariant**: Public API routes (`/api/v1/...`) never execute raw Prisma queries, bypass service layer validations, or touch database models directly. Every public endpoint invokes the authoritative domain application service (`lib/services/*`) within the target workspace context.
2. **Strict Multi-Tenant Isolation Invariant**: Tenant identity (`workspaceId`) is derived exclusively from the verified cryptographic API credential (`ApiKey -> DeveloperApplication -> Workspace`). Tenant identity is never accepted from unverified request headers, path parameters, or client JSON payloads.
3. **Internal vs. Public Route Segregation Invariant**: The `/api/...` namespace is reserved strictly for internal Next.js application UI interactions (session-based, cookie-authenticated, UI-optimized DTOs). The `/api/v1/...` namespace is strictly reserved for the external developer platform (Bearer token authenticated, versioned, canonical public DTOs). Under no circumstances are internal route handlers or schema models shared or exposed publicly.
4. **Canonical DTO Projection Invariant**: Public API endpoints return standardized, sanitized public Data Transfer Objects (DTOs). Internal database IDs, soft-deletion timestamps, encryption keys, and internal workflow flags are never leaked into the public contract.
5. **Deterministic Envelope Invariant**: Every public API response adheres to a strict, top-level JSON envelope (`{ success: true, data, meta }` or `{ success: false, error }`). Metadata (pagination, request IDs, timestamps) is colocated in `meta` and never mingled with domain entity payloads in `data`.
6. **Immutable Public Error Contract Invariant**: Public error codes (`UNAUTHORIZED`, `FORBIDDEN`, `VALIDATION_ERROR`, `NOT_FOUND`, `CONFLICT`, `RATE_LIMITED`, `IDEMPOTENCY_CONFLICT`, `INTERNAL_SERVER_ERROR`, `API_VERSION_UNSUPPORTED`) remain permanent and stable across internal codebase refactors.
7. **Fine-Grained Scoped Authorization Invariant**: Access control for public API keys is governed by explicit, granular OAuth-style scopes (`<resource>:<action>`). Public scopes are cleanly decoupled from internal user RBAC roles (`MembershipRole`) via an explicit authorization adapter.
8. **Stateless Multi-Instance Rate Limiting Invariant**: Rate limiting must be enforced at both the API key and workspace level using a distributed sliding-window mechanism compatible with horizontally scaled, stateless serverless/container runtimes.
9. **Atomic Idempotency Invariant**: All mutating requests (`POST`, `PATCH`) support an optional or mandatory `Idempotency-Key` header scoped strictly to `(workspaceId, apiKeyId, endpoint, idempotencyKey)`. Duplicate requests with identical keys return the cached canonical response without re-executing domain services.
10. **Additive-Only Non-Breaking Contract Invariant**: Within a major version (`v1`), all updates must be strictly backwards-compatible. Any breaking change (field removal, field rename, type mutation, new mandatory request parameter) mandates a new version namespace (`/api/v2/`).

---

## 1. Public API Boundary & Request Pipeline

### 1.1 Definition of the Public API
The "Public API" in Aforden represents the hardened, versioned, public REST interface published for external consumption by:
- Customer developer teams building custom integrations or internal dashboards.
- Third-party SaaS tools and iPaaS orchestrators (e.g., Zapier, Make, Workato).
- Enterprise ERPs, CRMs, and accounting systems synchronizing master data.
- Future mobile or desktop partner client applications.

The Public API is **not** a direct database gateway. It is a strictly governed presentation and orchestration layer that translates external HTTP requests into internal domain service invocations and converts domain outputs into canonical, contract-guaranteed public DTOs.

### 1.2 Domain Service Decoupling Requirement
Public API route handlers must remain thin controllers. Specifically:
- **No Direct Prisma Queries**: Public route handlers are prohibited from importing `@/lib/prisma` or invoking `prisma.<model>.*`.
- **Domain Service Authority**: All operations must be delegated to domain application services (e.g., `createWorkOrder`, `getWorkOrders`, `updateCustomer`, `issueInvoice`).
- **Data Integrity**: Domain services remain the sole arbiters of business rules, entity state transitions, invariant validation, and operational history tracking.

### 1.3 Request Flow Architecture

```
+-----------------------------------------------------------------------------------------------------------------------------------------------+
|                                                             PUBLIC API REQUEST FLOW                                                           |
|                                                                                                                                               |
|  [ External Client / Developer Integration ]                                                                                                  |
|         |                                                                                                                                     |
|         | HTTPS Request (e.g., POST /api/v1/work-orders)                                                                                      |
|         | Headers: Authorization: Bearer afd_live_..., Idempotency-Key: idm_123, X-Request-ID: req_abc                                        |
|         v                                                                                                                                     |
|  +-----------------------------------------------------------------------------------------------------------------------------------------+  |
|  | PUBLIC API BOUNDARY & MIDDLEWARE PIPELINE                                                                                                |  |
|  |                                                                                                                                         |  |
|  |  1. Request Trace Initialization (Assign X-Request-ID, Start Performance Timer)                                                          |  |
|  |  2. Version Route Dispatcher (Enforce /api/v1/ namespace; reject unsupported versions with 404)                                          |  |
|  |  3. Authentication Guard (Extract Bearer token, hash SHA-256, verify ApiKey active & not expired)                                       |  |
|  |  4. Tenant Resolution (Derive workspaceId & developerAppId from ApiKey; verify Workspace active)                                           |  |
|  |  5. Distributed Rate Limit Guard (Enforce Per-Key & Per-Workspace Sliding Window Quota via Redis / Cache)                                 |  |
|  |  6. Scoped Authorization Guard (Verify ApiKey scopes contain required scope, e.g., "work_orders:write")                                   |  |
|  |  7. Idempotency Gate (Check Idempotency-Key in cache/store; if resolved, return cached response immediately)                              |  |
|  |  8. Schema Validation Guard (Validate Request Body / Query Params against strict Zod Schema -> return 422 on failure)                    |  |
|  +--------------------------------------------------------------------+--------------------------------------------------------------------+  |
|                                                                       | validated input DTO + resolved workspaceId                            |
|                                                                       v                                                                       |
|  +-----------------------------------------------------------------------------------------------------------------------------------------+  |
|  | DOMAIN APPLICATION SERVICES (Phase 1.6 – Phase 1.17)                                                                                     |  |
|  |  - WorkOrderService.createWorkOrder(workspaceId, serviceInput)                                                                          |  |
|  |  - CustomerService.updateCustomer(workspaceId, customerId, updateInput)                                                                 |  |
|  |  - (Business Logic, Invariant Validation, DB Transaction, Notification Trigger, Outbox Write)                                             |  |
|  +--------------------------------------------------------------------+--------------------------------------------------------------------+  |
|                                                                       | internal domain result / error                                        |
|                                                                       v                                                                       |
|  +-----------------------------------------------------------------------------------------------------------------------------------------+  |
|  | CANONICAL PUBLIC DTO PROJECTION & RESPONSE PIPELINE                                                                                     |  |
|  |  1. Error Normalization (Map internal domain errors to canonical Public Error Taxonomy §7)                                               |  |
|  |  2. DTO Serialization & Sanitization (Strip internal DB metadata, format ISO 8601 UTC dates, construct URLs)                               |  |
|  |  3. Envelope Wrapping (Format `{ success: true, data: DTO, meta: { requestId, timestamp, ... } }`)                                       |  |
|  |  4. Idempotency Record Storage (Store final response payload & status in Idempotency Store for 24h)                                       |  |
|  |  5. Response Headers Attached (X-Request-ID, X-RateLimit-*, ETag, Content-Type: application/json)                                        |  |
|  +-----------------------------------------------------------------------------------------------------------------------------------------+  |
|         |                                                                                                                                     |
|         v HTTPS Response (200 / 201 / 204 / 401 / 403 / 404 / 409 / 422 / 429 / 500)                                                         |
|  [ External Client / Developer Integration ]                                                                                                  |
+-----------------------------------------------------------------------------------------------------------------------------------------------+
```

---

## 2. Internal vs. Public API Separation

Aforden maintains a strict, non-negotiable wall between internal application routes and external public API routes.

```
+--------------------------------------------------------------------+--------------------------------------------------------------------+
| Feature / Characteristic          | Internal Web Application API (`/api/...`)   | Public Developer API (`/api/v1/...`)               |
+-----------------------------------+---------------------------------------------+----------------------------------------------------+
| **Route Prefix**                  | `/api/<resource>`                           | `/api/v1/<resource>`                               |
| **Target Audience**               | Aforden Next.js Web App & Internal UI       | External Developers, Integrators, iPaaS, Customers |
| **Authentication Scheme**         | NextAuth Session Cookie / JWT Session Token | API Key (`Bearer afd_live_...` / `afd_test_...`)    |
| **Authorization Model**           | Internal RBAC (`MembershipRole`, `User`)    | Granular Public Scopes (`<resource>:<action>`)     |
| **Tenant Context Resolution**     | Active Session Workspace Context Cookie     | Cryptographically resolved from API Key record     |
| **Response Contract Stability**   | Evolving with frontend UI requirements      | Strictly locked, versioned, backwards-compatible   |
| **Payload Optimization**          | UI-specific views, nested component aggregates| Canonical entity DTOs, normalized schemas          |
| **Idempotency Support**           | Ad-hoc where required                       | Standardized `Idempotency-Key` header pipeline      |
| **Rate Limiting Model**           | Per-user/session web security limits        | Per-key and per-workspace published tier quotas    |
| **Error Format**                  | Internal error structures / form messages   | Unified machine-readable JSON Error Envelope       |
| **Documentation**                 | Internal developer docs / component tests   | Public OpenAPI 3.1 Specification                   |
+--------------------------------------------------------------------+--------------------------------------------------------------------+
```

### 2.1 Cross-Exposition Prevention Rules
1. **No Shared Handlers**: Public route files under `app/api/v1/` must never import or delegate directly to `app/api/` internal route handlers.
2. **Independent Middleware / Security Guards**: Public route authentication and authorization use a dedicated API platform guard (`validatePublicApiRequest`), completely independent of session cookies or NextAuth session validation.
3. **Zero Impact on Internal Routes**: Existing `/api/...` routes remain untouched and continue to serve the internal application UI without modification.

---

## 3. Versioning Strategy

### 3.1 URL-Path Versioning Standard
Public API versioning is explicitly path-based:
- `/api/v1/` is the initial, canonical version for all public developer endpoints.
- Any future breaking changes will be introduced in a distinct major version path (e.g., `/api/v2/`).

### 3.2 Breaking vs. Backwards-Compatible Changes

```
+-------------------------------------------------------------+-------------------------------------------------------------+
| Non-Breaking (Permitted in Current `v1` Version)             | Breaking (Mandates a New Major Version `v2`)                |
+-------------------------------------------------------------+-------------------------------------------------------------+
| Adding a new endpoint (e.g., `POST /api/v1/inventory/recount`)| Removing an existing endpoint or changing its HTTP method    |
| Adding a new optional request field or query parameter       | Renaming an existing endpoint, field, or query parameter   |
| Adding a new property to a response DTO JSON object          | Removing or renaming a property from a response DTO         |
| Adding a new enum variant to an existing response property   | Changing the data type or format of a field (e.g. str->num) |
| Adding new optional response headers                        | Adding a new REQUIRED request field                         |
| Enhancing error messages or adding detailed issue objects   | Modifying the meaning or HTTP status of an error code       |
| Relaxing validation constraints (e.g. length limits)        | Tightening validation constraints on existing fields        |
+-------------------------------------------------------------+-------------------------------------------------------------+
```

### 3.3 Unsupported Version Handling
When an external client requests a non-existent or unsupported API version (e.g., `GET /api/v0/work-orders` or `GET /api/v2/customers`):
- **HTTP Status**: `404 Not Found` (mapped directly to canonical error code `API_VERSION_UNSUPPORTED` in §7)
- **Error Code**: `API_VERSION_UNSUPPORTED`
- **Headers Returned**: `X-Aforden-Supported-Versions: v1`
- **Response Body**:
```json
{
  "success": false,
  "error": {
    "code": "API_VERSION_UNSUPPORTED",
    "message": "The requested API version 'v2' is not supported. Supported versions: v1.",
    "requestId": "req_01HPX7K9V4Z8Y6M2E3W1N0QRST",
    "documentationUrl": "https://docs.aforden.com/api/versioning"
  }
}
```

---

## 4. Resource Naming & HTTP Conventions

### 4.1 Resource Naming Standard
Public endpoints follow RESTful conventions:
- **Plural Naming**: All collection resources use plural nouns (e.g., `work-orders`, `customers`, `invoices`, `quotes`, `assets`, `inventory-items`, `technicians`).
- **Kebab-Case URLs**: Multi-word resources and sub-resources strictly use kebab-case (e.g., `/api/v1/service-locations`, `/api/v1/work-orders/{id}/line-items`).
- **Resource Hierarchy**: Sub-resources represent clear parent-child relationships (e.g., `/api/v1/customers/{id}/locations`, `/api/v1/work-orders/{id}/history`).
- **Lifecycle Action Endpoints**: Non-CRUD lifecycle transitions use sub-resource action paths with `POST` (e.g., `POST /api/v1/work-orders/{id}/cancel`, `POST /api/v1/invoices/{id}/void`).

### 4.2 Standard HTTP Verbs

```
+-----------+-----------------------+---------------------+-------------------------------+---------------------------------------------------------+
| HTTP Verb | Operation Type        | Target URI Pattern  | Success Status                | Aforden Semantic Meaning                                |
+-----------+-----------------------+---------------------+-------------------------------+---------------------------------------------------------+
| `GET`     | Collection Read       | `/api/v1/{resource}`| `200 OK`                      | Query & paginate collection within authorized workspace |
| `GET`     | Single Entity Read    | `/api/v1/{res}/{id}`| `200 OK`                      | Fetch single entity details by ID                       |
| `POST`    | Resource Creation     | `/api/v1/{resource}`| `201 Created`                 | Create a new entity within authorized workspace         |
| `POST`    | Lifecycle Action      | `/api/v1/{res}/{id}/action` | `200 OK`              | Execute atomic state transition (cancel, approve, void) |
| `PATCH`   | Atomic Partial Update | `/api/v1/{res}/{id}`| `200 OK`                      | Update specified fields on existing entity              |
| `DELETE`  | Resource Removal      | `/api/v1/{res}/{id}`| `204 No Content` / `200 OK`   | Archive, soft-delete, or delete resource                |
+-----------+-----------------------+---------------------+-------------------------------+---------------------------------------------------------+
```

**DELETE Success Status Rule**: `204 No Content` is the default success status for resource deletion where no response body is returned, whereas `200 OK` (with the standard JSON envelope returning the soft-deleted or archived entity in `data`) is the explicit alternative used only when the domain service produces and returns an updated archived/soft-deleted entity state to the caller.

### 4.3 Standardizing on `PATCH` (Justification over `PUT`)
Aforden establishes **`PATCH`** as the exclusive standard for resource updates across the Public API:
1. **Prevention of Lost Updates / Concurrency Safety**: A full `PUT` requires the client to supply the entire entity payload. In field service, technicians concurrently update job status or notes from the mobile app while dispatchers or automated integrations update schedules. A full `PUT` risks clobbering concurrent field modifications with stale data.
2. **Bandwidth & Payload Efficiency**: Integrators typically mutate small subsets of data (e.g., updating a customer's phone number or a work order priority). `PATCH` transmits only mutated fields.
3. **Consistency with Domain Architecture**: All internal domain services (Phases 1.6–1.17) implement partial update contracts (`UpdateWorkOrderInput`, `UpdateCustomerInput`). Standardizing on `PATCH` creates a direct, seamless 1:1 mapping with domain service capabilities.

---

## 5. Request & Response Envelope Specification

All public API endpoints return uniform JSON envelopes. Top-level attributes are strictly partitioned into `success`, `data` (payload), `meta` (request and pagination metadata), or `error`.

### 5.1 Success Envelope

#### Single Entity Response (`GET /api/v1/work-orders/{id}`, `POST`, `PATCH`)
```json
{
  "success": true,
  "data": {
    "id": "wo_01HPX7K9V4Z8Y6M2E3W1N0QRST",
    "workOrderNumber": "WO-2026-0042",
    "status": "IN_PROGRESS",
    "priority": "HIGH",
    "title": "HVAC Compressor Overhaul",
    "description": "Customer reported intermittent cooling failure.",
    "customerId": "cust_01HPX7K8A1B2C3D4E5F6G7H8J9",
    "locationId": "loc_01HPX7K8K1L2M3N4P5Q6R7S8T9",
    "assignedTechnicianId": "tech_01HPX7K9T1U2V3W4X5Y6Z7A8B9",
    "scheduledStartAt": "2026-08-30T09:00:00.000Z",
    "scheduledEndAt": "2026-08-30T12:00:00.000Z",
    "createdAt": "2026-08-29T10:15:30.000Z",
    "updatedAt": "2026-08-29T11:00:00.000Z"
  },
  "meta": {
    "requestId": "req_01HPX7K9V4Z8Y6M2E3W1N0QRST",
    "timestamp": "2026-08-29T11:00:00.125Z"
  }
}
```

#### Paginated Collection Response (`GET /api/v1/work-orders`)
```json
{
  "success": true,
  "data": [
    {
      "id": "wo_01HPX7K9V4Z8Y6M2E3W1N0QRST",
      "workOrderNumber": "WO-2026-0042",
      "status": "IN_PROGRESS",
      "priority": "HIGH",
      "title": "HVAC Compressor Overhaul",
      "customerId": "cust_01HPX7K8A1B2C3D4E5F6G7H8J9",
      "createdAt": "2026-08-29T10:15:30.000Z"
    }
  ],
  "meta": {
    "requestId": "req_01HPX7K9V4Z8Y6M2E3W1N0QRST",
    "timestamp": "2026-08-29T11:00:00.125Z",
    "pagination": {
      "hasMore": true,
      "limit": 25,
      "nextCursor": "ZXlKaGJHY2lPaUpTVXpVeE5pSXNJblI1Y0NJNklrcFhWQ0o5...",
      "prevCursor": null
    }
  }
}
```

### 5.2 Error Envelope (Canonical Stub §1.18.16 Aligned)

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "The request body failed validation constraints.",
    "details": [
      {
        "field": "scheduledStartAt",
        "issue": "INVALID_DATETIME_FORMAT",
        "message": "scheduledStartAt must be a valid ISO 8601 UTC timestamp."
      },
      {
        "field": "priority",
        "issue": "INVALID_ENUM_VALUE",
        "message": "priority must be one of: LOW, MEDIUM, HIGH, EMERGENCY."
      }
    ],
    "requestId": "req_01HPX7K9V4Z8Y6M2E3W1N0QRST",
    "documentationUrl": "https://docs.aforden.com/api/errors#VALIDATION_ERROR"
  }
}
```

### 5.3 Metadata Placement Principle
All operational metadata (`requestId`, `timestamp`, `pagination`, execution telemetry) resides strictly in the top-level **`meta`** object alongside `data`. It is never placed inside `data` to ensure the entity payload is 100% clean and directly deserializable into domain models by client SDKs.

---

## 6. Pagination, Filtering & Sorting Contracts

### 6.1 Cursor-Based Pagination Standard
Aforden public API uses **Cursor-Based Pagination** as its primary, canonical pagination mechanism:
- **High Performance & Index Safety**: Uses keyset pagination (`(createdAt, id)` composite index), ensuring $O(1)$ database execution time even on multi-million row datasets.
- **Drift Immunity**: Inserting or deleting records while an external script is paging does not result in skipped or duplicated records (a classic flaw of offset pagination).
- **Opaque Cursor Tokens**: Cursors are URL-safe base64-encoded strings encoding the cursor timestamp and entity ID. Clients must treat cursors as opaque strings.

```
Query Parameters:
- `cursor`: Opaque string obtained from `meta.pagination.nextCursor` of previous page.
- `limit`: Number of items to return (Default: `25`, Maximum: `100`, Minimum: `1`).
```

### 6.2 Standard Filtering Parameters
Filters use explicit, type-safe query parameter conventions:
- **Exact Match**: `?status=IN_PROGRESS&priority=HIGH`
- **Multi-Value (IN query)**: Comma-separated strings `?status=OPEN,IN_PROGRESS,ON_HOLD`
- **Temporal Range Filters**:
  - `?created_after=2026-08-01T00:00:00Z`
  - `?created_before=2026-08-31T23:59:59Z`
  - `?scheduled_after=...` / `?scheduled_before=...`
- **Text Search Query**: `?search=compressor` (delegates to domain service full-text/prefix search)
- **Foreign Key / Parent Scoping**: `?customer_id=cust_123` / `?technician_id=tech_456`

### 6.3 Standard Sorting Parameters
Sorting is expressed via a unified `sort` query parameter:
- **Syntax**: `?sort=field1,-field2` (prefix with `-` for descending, no prefix for ascending).
- **Snake_Case Fields**: Sort parameters use snake_case matching query conventions.
- **Example**: `?sort=-created_at,priority` (Orders by `createdAt` descending, then `priority` ascending).
- **Default Sort**: If unspecified, collections default to `?sort=-created_at`.

---

## 7. Error Taxonomy & Status Code Mapping

The Public API guarantees a stable, immutable 9-code error taxonomy. Internal exception classes thrown by Prisma, database engines, or third-party adapters are caught and mapped cleanly into these canonical public error codes.

```
+---------------------------+-------------+-----------------------------------------------------------------------------------------+
| Public Error Code         | HTTP Status | Trigger Condition / Description                                                         |
+---------------------------+-------------+-----------------------------------------------------------------------------------------+
| `UNAUTHORIZED`            | `401`       | Missing, invalid, expired, or revoked API key credential.                               |
| `FORBIDDEN`               | `403`       | API key lacks required scope, or workspace account is suspended/restricted.              |
| `VALIDATION_ERROR`        | `422`       | Request body or query parameters violate schema constraints (field-level issues in details)|
| `NOT_FOUND`               | `404`       | Requested resource does not exist in the caller's workspace.                             |
| `CONFLICT`                | `409`       | Resource state conflict (e.g. transitioning already completed work order, duplicate key)|
| `RATE_LIMITED`            | `429`       | Key or workspace quota exceeded. `Retry-After` header included in response.              |
| `IDEMPOTENCY_CONFLICT`    | `409`       | `Idempotency-Key` was re-used with a different request payload or is currently executing|
| `API_VERSION_UNSUPPORTED` | `404`       | The requested API version is not supported by the platform (e.g., `/api/v2/...`).        |
| `INTERNAL_SERVER_ERROR`   | `500`       | Unexpected platform error. Sensitive stack trace sanitized; `requestId` provided.       |
+---------------------------+-------------+-----------------------------------------------------------------------------------------+
```

### 7.1 Stability Invariant for Error Contracts
Public error codes are permanent. If an internal service refactors its private error class (e.g., `WorkOrderNotFoundError` $\to$ `DomainEntityMissingError`), the public error serialization layer guarantees the external API response remains:
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Work order 'wo_123' not found.",
    "requestId": "req_01HPX..."
  }
}
```

---

## 8. API Version Lifecycle & Backwards Compatibility Rules

### 8.1 Breaking vs Non-Breaking Invariants
To preserve production stability for developer integrations:
- **Non-Breaking Changes** are released continuously under `/api/v1/`. Clients must implement liberal parsing (e.g. ignoring unknown JSON keys).
- **Breaking Changes** are strictly prohibited within `/api/v1/`. They can only be introduced by releasing a new major version `/api/v2/`.

### 8.2 Deprecation & Sunset Lifecycle Policy
When an endpoint or version is slated for retirement:
1. **Announcement & Minimum Notice**: Deprecation is announced with a mandatory minimum 6-month sunset period.
2. **Standard HTTP Headers Attached**:
   - `Deprecation: @<unix_timestamp>` (Date deprecation went into effect).
   - `Sunset: <http_date>` (Exact UTC date and time when the endpoint will be permanently terminated).
   - `Link: <https://docs.aforden.com/api/deprecations/...>; rel="sunset"`
3. **Sunset Execution**: Upon passing the sunset timestamp, the endpoint returns `410 Gone` with a link to the migration guide.

---

## 9. Multi-Tenant Resolution Strategy

Tenant resolution in the Public API is non-negotiable, cryptographic, and enforced at the infrastructure level.

```
+-----------------------------------------------------------------------------------------------------------------------+
|                                           TENANT RESOLUTION ARCHITECTURE                                              |
|                                                                                                                       |
|  1. Incoming Request: Authorization: Bearer afd_live_9f83ab4e12c67...                                                 |
|                                |                                                                                      |
|                                v                                                                                      |
|  2. SHA-256 Hash Computation: sha256("afd_live_9f83ab4e12c67...") -> keyHash                                         |
|                                |                                                                                      |
|                                v                                                                                      |
|  3. Database Lookup: SELECT * FROM "ApiKey" WHERE "keyHash" = :keyHash AND "status" = 'ACTIVE'                       |
|                                |                                                                                      |
|                                v                                                                                      |
|  4. Entity Graph Traversal:                                                                                          |
|     +-------------------------+         +-------------------------------+         +--------------------------------+  |
|     |  ApiKey                 |         |  DeveloperApplication         |         |  Workspace                     |  |
|     |  - id: key_123          | ------> |  - id: app_456                | ------> |  - id: ws_789 (TENANT BOUNDARY)|  |
|     |  - scopes: ["..."]      |         |  - name: "ERP Connector"      |         |  - status: ACTIVE              |  |
|     +-------------------------+         +-------------------------------+         +--------------------------------+  |
|                                |                                                                                      |
|                                v                                                                                      |
|  5. Execution Context Bound: `RequestContext { workspaceId: "ws_789", apiKeyId: "key_123", scopes: [...] }`         |
|                                |                                                                                      |
|                                v                                                                                      |
|  6. Domain Service Invoked: `workOrderService.getWorkOrders(requestContext.workspaceId, query)`                      |
+-----------------------------------------------------------------------------------------------------------------------+
```

### 9.1 Tenant Resolution Guarantees
- **No Path/Body Spoofing**: A request can never pass `?workspace_id=other_ws` or `{ workspaceId: "other_ws" }` to access another tenant's data.
- **Deep Partitioning**: All domain service calls receive `workspaceId` explicitly from the verified `RequestContext`. Every downstream Prisma query filters strictly by `where: { workspaceId }`.

---

## 10. Authentication Strategy (Architecture-Level)

### 10.1 API Key Structure & Token Taxonomy
Public API authentication uses high-entropy, structured API keys formatted with standardized prefixes:
- **Live Keys (Production)**: `afd_live_<32_bytes_base62_random_secret>` (e.g., `afd_live_8Fk2m9Pq4Rt7Uv1Wx0Z3Ab5Cd6Ef8Gh9`)
- **Test Keys (Sandbox)**: `afd_test_<32_bytes_base62_random_secret>` (e.g., `afd_test_9Ab5Cd6Ef8Gh98Fk2m9Pq4Rt7Uv1Wx0Z3`)

### 10.2 Transmission Convention
Keys must be transmitted via the standard HTTP `Authorization` header:
```http
Authorization: Bearer afd_live_8Fk2m9Pq4Rt7Uv1Wx0Z3Ab5Cd6Ef8Gh9
```
*(Secondary fallback support for `X-API-Key: afd_live_...` header is supported for legacy clients).*

### 10.3 Cryptographic Storage & Security Invariant
1. **One-Time Display**: The raw plaintext API key is shown to the developer **once** upon creation and never stored in plaintext anywhere in Aforden's databases or logs.
2. **SHA-256 Key Hashing**: The database stores only the cryptographically secure SHA-256 hash (`keyHash`), along with an unmasked visual prefix/suffix for dashboard display (e.g., `afd_live_8Fk2...Gh9`).
3. **Timing-Safe Validation**: Key lookup is indexed on `keyHash`. Validation is constant-time and immune to timing attacks.

### 10.4 OAuth 2.0 / App Authentication Extensibility
- Architecture accommodates future user-delegated OAuth 2.0 access tokens (`Bearer afd_oauth_...`).
- The authentication middleware inspects the token prefix and routes to the appropriate credential validator.
- *Detailed OAuth 2.0 authorization server flows are explicitly deferred to Phase 1.18.X.*

---

## 11. Scoped Authorization Strategy (Architecture-Level)

Public API authorization uses a granular, OAuth-style permission model tailored for external programmatic consumers.

### 11.1 Scopes Model
Scopes follow the standard format `<resource>:<action>`:
- `work_orders:read` / `work_orders:write`
- `customers:read` / `customers:write`
- `schedules:read` / `schedules:write`
- `invoices:read` / `invoices:write`
- `quotes:read` / `quotes:write`
- `assets:read` / `assets:write`
- `inventory:read` / `inventory:write`
- `technicians:read`
- `reporting:read`

### 11.2 Decoupling from Internal RBAC
Public API scopes are **not** identical to internal employee RBAC roles (`MembershipRole`: `ADMIN`, `DISPATCHER`, `TECHNICIAN`):
- Internal RBAC governs interactive human user permissions within the web UI.
- Public Scopes govern machine-to-machine integrations.
- An explicit authorization adapter (`assertPublicScope(requestContext, "work_orders:write")`) validates the API key's assigned scopes before any domain service is called.

---

## 12. Idempotency Strategy (Architecture-Level)

To prevent duplicate side-effects (e.g., creating double work orders or duplicate invoice charges due to network retries), all mutating public API endpoints (`POST`, `PATCH`) support the `Idempotency-Key` header.

### 12.1 Header Convention & Uniqueness Scope
Clients transmit an opaque, unique UUIDv4 string:
```http
Idempotency-Key: 9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d
```
The uniqueness scope for idempotency is strictly four-dimensional:
$$\text{Idempotency Scope} = \text{workspaceId} + \text{apiKeyId} + \text{endpointPath} + \text{idempotencyKey}$$

### 12.2 Lifecycle State Machine & Replay

```
+--------------------------------------------------------------------------------------------------------------------+
|                                           IDEMPOTENCY EXECUTION FLOW                                               |
|                                                                                                                    |
|  Incoming Mutating Request (POST /api/v1/work-orders + Idempotency-Key)                                            |
|                                |                                                                                   |
|                                v                                                                                   |
|  Query Idempotency Store for (workspaceId, apiKeyId, endpoint, key)                                                |
|                                |                                                                                   |
|         +----------------------+-----------------------+                                                           |
|         |                                              |                                                           |
|         v (Key Found)                                  v (Key Not Found)                                           |
|  Check Record Status                                   1. Write Lock Record (Status: PENDING, Hash: PayloadHash)   |
|  - Status == PENDING:                                  2. Execute Domain Application Service                       |
|    -> Return 409 Conflict ("Request in progress")      3. Capture Result DTO & HTTP Status (e.g., 201 Created)     |
|  - Status == RESOLVED:                                 4. Update Idempotency Record (Status: RESOLVED, Body, 24h)  |
|    - Payload Hash Matches:                             5. Return Fresh Response with Header `Idempotent-Replay: true`|
|      -> Return Cached Response (HTTP + Headers + Body)                                                             |
|      -> Header: `Idempotent-Replay: true`                                                                          |
|    - Payload Hash Differs:                                                                                         |
|      -> Return 409 Conflict (IDEMPOTENCY_CONFLICT)                                                                 |
|         ("Idempotency key re-used with different payload")                                                         |
+--------------------------------------------------------------------------------------------------------------------+
```

### 12.3 Retention Window
Idempotency cache records are retained for a sliding window of **24 hours**, after which keys expire and can be safely re-used.

---

## 13. Distributed Rate Limiting Strategy (Architecture-Level)

### 13.1 Multi-Tiered Quotas
Rate limiting protects the platform from denial-of-service, runaway scripts, and noisy-neighbor tenant contention:
1. **Per-API-Key Limit**: Protects against specific rogue client scripts (e.g., 120 requests/minute).
2. **Per-Workspace Aggregate Limit**: Protects the workspace tenant budget based on SaaS Subscription Tier (Phase 1.15) (e.g., Starter: 300 req/min, Professional: 1,200 req/min, Enterprise: 6,000 req/min).

### 13.2 Distributed Sliding Window Algorithm
- Rate limits are calculated using a **Distributed Sliding Window Log / Token Bucket** algorithm backed by Redis / Distributed Key-Value Store.
- Stateless design ensures 100% accurate rate limit tracking across multiple, horizontally scaled Next.js serverless execution nodes. No in-memory only single-instance state.

### 13.3 Standard Rate Limit Headers
Every public API response includes canonical RFC rate limiting headers:
```http
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 118
X-RateLimit-Reset: 1724932860
```
When a client exceeds their quota:
- **HTTP Status**: `429 Too Many Requests`
- **Header**: `Retry-After: 35` (seconds until quota renewal)
- **Response Body**:
```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "API rate limit exceeded. Please retry after 35 seconds.",
    "requestId": "req_01HPX7K9V4Z8Y6M2E3W1N0QRST",
    "documentationUrl": "https://docs.aforden.com/api/rate-limits"
  }
}
```

---

## 14. API Documentation & OpenAPI 3.1 Strategy

### 14.1 Code-First OpenAPI Generation
Aforden public API documentation will be derived directly from code contracts:
- **Single Source of Truth**: Public DTO validation schemas (defined in TypeScript / Zod) serve as the authoritative definition for both runtime request validation and automated OpenAPI 3.1 schema export.
- **Zero Drift Guarantee**: Because OpenAPI schemas are generated from the runtime Zod validators, documentation drift is impossible.
- **Forward-Looking Note**: No docs site UI or hosted Swagger UI is implemented in Phase 1.18.1; the architecture establishes the contract for OpenAPI schema generation to be consumed in future developer tooling.

---

## 15. Summary of Architectural Decisions & Deferred Items

```
+------------------------------------+-------------------------------------------+-------------------------------------------------------+
| Subsystem Area                     | Architectural Decision Locked in 1.18.1   | Justification / Deferred Target                       |
+------------------------------------+-------------------------------------------+-------------------------------------------------------+
| **Route Prefix**                   | `/api/v1/...`                             | Clean separation from internal `/api/...` routes      |
| **Entity Mutation**                | `PATCH` exclusively                       | Atomic updates prevent race conditions and lost data  |
| **Data Access**                    | Domain Services only (`lib/services/*`)   | Bypassing services to query Prisma directly forbidden |
| **Tenant Isolation**               | Verified `ApiKey` -> `Workspace` binding  | Non-negotiable cryptographic tenant partitioning      |
| **Pagination**                     | Cursor-based (`cursor`, `limit`)          | $O(1)$ database execution, drift-free collection paging|
| **Authentication**                 | SHA-256 Hashed API Keys (`afd_live_...`)  | High security, timing-safe, one-time reveal           |
| **Authorization**                  | Scoped OAuth model (`<res>:<action>`)     | Decoupled from internal employee RBAC roles           |
| **Idempotency**                    | Composite 4-part scope, 24h cache         | Atomic retry safety for network failures              |
| **Rate Limiting**                  | Distributed Sliding Window via Redis      | Multi-instance support, key & workspace tiers         |
| **OAuth 2.0 Server**               | Architecture stubbed; plug-in ready       | *Deferred to Phase 1.18.X*                            |
| **Interactive Docs UI**            | OpenAPI 3.1 export from Zod contracts     | *Deferred to Phase 1.23*                              |
+------------------------------------+-------------------------------------------+-------------------------------------------------------+
```

---

## 16. Verification & Self-Audit Checklist

| # | Architecture Requirement | Verification Status |
| :-: | :--- | :--- |
| **1** | **Public API Boundary Defined** | Section 1 defines boundary and forbids direct Prisma queries. | ✅ Passed |
| **2** | **Internal vs Public Separation** | Section 2 details `/api/...` vs `/api/v1/...` segregation and rules. | ✅ Passed |
| **3** | **Versioning Strategy** | Section 3 establishes `/api/v1/`, breaking rules, and 404 handling. | ✅ Passed |
| **4** | **Resource Naming & Verbs** | Section 4 locks kebab-case plural nouns and justifies `PATCH` over `PUT`. | ✅ Passed |
| **5** | **Request/Response Envelope** | Section 5 specifies exact success and error JSON envelopes and `meta` placement. | ✅ Passed |
| **6** | **Pagination, Filtering, Sorting** | Section 6 locks cursor-based pagination, search parameters, and sort syntax. | ✅ Passed |
| **7** | **Error Taxonomy** | Section 7 locks 9 canonical public error codes and stability invariant. | ✅ Passed |
| **8** | **Version Lifecycle & Deprecation**| Section 8 defines backwards-compatibility rules and HTTP sunset headers. | ✅ Passed |
| **9** | **Tenant Resolution Strategy** | Section 9 specifies `ApiKey -> DeveloperApp -> Workspace` binding. | ✅ Passed |
| **10** | **Authentication Strategy** | Section 10 specifies SHA-256 hashed API keys with `afd_live_`/`afd_test_` prefixes. | ✅ Passed |
| **11** | **Authorization Strategy** | Section 11 specifies scoped permissions decoupled from internal RBAC. | ✅ Passed |
| **12** | **Idempotency Strategy** | Section 12 specifies `Idempotency-Key` 4-part scope and 24h retention. | ✅ Passed |
| **13** | **Rate-Limit Strategy** | Section 13 specifies distributed multi-tier sliding-window limiting. | ✅ Passed |
| **14** | **API Documentation Strategy** | Section 14 locks code-first OpenAPI 3.1 generation from Zod contracts. | ✅ Passed |
| **15** | **Zero Code Invariant** | Strictly an architecture document deliverable; 0 code files modified. | ✅ Passed |

---

## Completion Statement & Readiness for Phase 1.18.2

The specification in `docs/architecture/phase-1.18-public-api-architecture.md` is complete, internally consistent with Phases 1.1 through 1.17, and locked for execution.

**Next Milestone**: **Phase 1.18.2 (Developer Platform Schema & Database Migrations)** — introducing `DeveloperApplication`, `ApiKey`, `ApiScope`, and `ApiIdempotencyRecord` Prisma models.
