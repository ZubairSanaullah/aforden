# Phase 1.9.11 — REST API / Thin Adapters Walkthrough

## Overview

This walkthrough documents the verified architecture, full verbatim route adapter implementations, centralized error mapping, schema-level identity rejection, DTO hygiene, and comprehensive test suite for **Phase 1.9.11: REST API / Thin Adapters** in strict compliance with **Section 10**, **Section 12**, and **Section 14** of the locked domain contract in [`docs/architecture/phase-1.9.1-technician-operations-architecture.md`](file:///d:/Download/aforden/docs/architecture/phase-1.9.1-technician-operations-architecture.md).

---

## 1. Verbatim Route Handler Source Code (Thin Adapters)

Every route handler is implemented strictly as a thin adapter adhering to the 7-step execution flow:
`Extract Workspace -> Resolve / Authorize Context -> Validate Input via Zod Schema -> Delegate to Domain Service -> Map / Cleanse Result to DTO -> Centralized Error Handler`. Zero business logic resides in any route file.

### 1.1 `POST /api/technician/work-orders/[workOrderId]/complete` (Verbatim)
File: [`app/api/technician/work-orders/[workOrderId]/complete/route.ts`](file:///d:/Download/aforden/app/api/technician/work-orders/%5BworkOrderId%5D/complete/route.ts)

```typescript
import { NextResponse } from "next/server";
import {
    resolveTechnicianContext,
    completeTechnicianWorkOrder,
} from "@/lib/services/technicianOperations";
import {
    extractWorkspaceId,
    handleTechnicianOperationsApiError,
} from "@/lib/utils/technicianOperationsApiError";
import { completeWorkOrderSchema } from "@/lib/services/technicianOperations/technicianOperations.types";

interface RouteContext {
    params: Promise<{
        workOrderId: string;
    }>;
}

/**
 * POST /api/technician/work-orders/[workOrderId]/complete
 *
 * Completes an in-progress work order with optional resolution notes and media evidence.
 */
export async function POST(request: Request, context: RouteContext) {
    try {
        const { workOrderId } = await context.params;
        const workspaceId = extractWorkspaceId(request);

        if (!workspaceId) {
            return NextResponse.json(
                {
                    success: false,
                    error: {
                        code: "MISSING_WORKSPACE",
                        message: "Workspace ID is required.",
                    },
                },
                { status: 400 }
            );
        }

        const techContext = await resolveTechnicianContext(workspaceId);

        let body: unknown = {};
        const text = await request.text();
        if (text.trim()) {
            try {
                body = JSON.parse(text);
            } catch {
                throw new SyntaxError("Invalid JSON in request body.");
            }
        }

        const validatedInput = completeWorkOrderSchema.parse(body);
        const workOrder = await completeTechnicianWorkOrder(techContext, workOrderId, validatedInput);

        // DTO Hygiene (§14 Step 7): Ensure internal plumbing properties are never serialized
        const { _historyRecordId, ...cleanDto } = workOrder as any;

        return NextResponse.json(
            {
                success: true,
                data: cleanDto,
            },
            { status: 200 }
        );
    } catch (error) {
        return handleTechnicianOperationsApiError(error, "Complete technician work order");
    }
}
```

### 1.2 `GET` & `POST /api/technician/work-orders/[workOrderId]/time` (Verbatim)
File: [`app/api/technician/work-orders/[workOrderId]/time/route.ts`](file:///d:/Download/aforden/app/api/technician/work-orders/%5BworkOrderId%5D/time/route.ts)

```typescript
import { NextResponse } from "next/server";
import {
    resolveTechnicianContext,
    listTechnicianTimeEntries,
    recordTechnicianTimeEntry,
} from "@/lib/services/technicianOperations";
import {
    extractWorkspaceId,
    handleTechnicianOperationsApiError,
} from "@/lib/utils/technicianOperationsApiError";
import { recordTechnicianTimeEntrySchema } from "@/lib/services/technicianOperations/technicianOperations.types";

interface RouteContext {
    params: Promise<{
        workOrderId: string;
    }>;
}

/**
 * GET /api/technician/work-orders/[workOrderId]/time
 *
 * Lists time entries belonging to the authenticated technician on the specified work order.
 */
export async function GET(request: Request, context: RouteContext) {
    try {
        const { workOrderId } = await context.params;
        const workspaceId = extractWorkspaceId(request);

        if (!workspaceId) {
            return NextResponse.json(
                {
                    success: false,
                    error: {
                        code: "MISSING_WORKSPACE",
                        message: "Workspace ID is required.",
                    },
                },
                { status: 400 }
            );
        }

        const techContext = await resolveTechnicianContext(workspaceId);
        const entries = await listTechnicianTimeEntries(techContext, workOrderId);

        return NextResponse.json(
            {
                success: true,
                data: entries,
            },
            { status: 200 }
        );
    } catch (error) {
        return handleTechnicianOperationsApiError(error, "List technician time entries");
    }
}

/**
 * POST /api/technician/work-orders/[workOrderId]/time
 *
 * Records a new manual time entry (BREAK or ADMIN) for the authenticated technician.
 */
export async function POST(request: Request, context: RouteContext) {
    try {
        const { workOrderId } = await context.params;
        const workspaceId = extractWorkspaceId(request);

        if (!workspaceId) {
            return NextResponse.json(
                {
                    success: false,
                    error: {
                        code: "MISSING_WORKSPACE",
                        message: "Workspace ID is required.",
                    },
                },
                { status: 400 }
            );
        }

        const techContext = await resolveTechnicianContext(workspaceId);

        const body = await request.json().catch(() => {
            throw new SyntaxError("Invalid JSON in request body.");
        });

        const validatedInput = recordTechnicianTimeEntrySchema.parse(body);
        const entry = await recordTechnicianTimeEntry(techContext, workOrderId, validatedInput);

        return NextResponse.json(
            {
                success: true,
                data: entry,
            },
            { status: 201 }
        );
    } catch (error) {
        return handleTechnicianOperationsApiError(error, "Record technician time entry");
    }
}
```

### 1.3 `PATCH /api/work-orders/[workOrderId]/time/[id]` (Admin Route, Verbatim)
File: [`app/api/work-orders/[workOrderId]/time/[id]/route.ts`](file:///d:/Download/aforden/app/api/work-orders/%5BworkOrderId%5D/time/%5Bid%5D/route.ts)

```typescript
import { NextResponse } from "next/server";
import { updateTechnicianTimeEntryAdmin } from "@/lib/services/technicianOperations";
import {
    extractWorkspaceId,
    handleTechnicianOperationsApiError,
} from "@/lib/utils/technicianOperationsApiError";
import { adminUpdateTechnicianTimeEntrySchema } from "@/lib/services/technicianOperations/technicianOperations.types";

interface RouteContext {
    params: Promise<{
        workOrderId: string;
        id: string;
    }>;
}

/**
 * PATCH /api/work-orders/[workOrderId]/time/[id]
 *
 * Administrative modification of historical technician time entry (OWNER, ADMIN, MANAGER roles).
 */
export async function PATCH(request: Request, context: RouteContext) {
    try {
        const { workOrderId, id } = await context.params;
        const workspaceId = extractWorkspaceId(request);

        if (!workspaceId) {
            return NextResponse.json(
                {
                    success: false,
                    error: {
                        code: "MISSING_WORKSPACE",
                        message: "Workspace ID is required.",
                    },
                },
                { status: 400 }
            );
        }

        const body = await request.json().catch(() => {
            throw new SyntaxError("Invalid JSON in request body.");
        });

        const validatedInput = adminUpdateTechnicianTimeEntrySchema.parse(body);
        const updatedEntry = await updateTechnicianTimeEntryAdmin(
            workspaceId,
            workOrderId,
            id,
            validatedInput
        );

        return NextResponse.json(
            {
                success: true,
                data: updatedEntry,
            },
            { status: 200 }
        );
    } catch (error) {
        return handleTechnicianOperationsApiError(error, "Admin update technician time entry");
    }
}
```

---

## 2. Centralized Error Handler (Verbatim)

File: [`lib/utils/technicianOperationsApiError.ts`](file:///d:/Download/aforden/lib/utils/technicianOperationsApiError.ts)

A single shared utility mapping domain errors across all technician and admin routes to the Section 10 HTTP error taxonomy:

```typescript
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { authorizationErrorResponse } from "@/lib/services/authorization/authorizationResponse";
import {
    TechnicianProfileNotFoundError,
    TechnicianNotAssignedToWorkOrderError,
    ActiveTimeEntryExistsError,
    TimeEntryNotFoundError,
    TimeEntryImmutableError,
} from "@/lib/services/technicianOperations/technicianOperationsErrors";
import {
    WorkOrderNotFoundError,
    WorkOrderInvalidStatusTransitionError,
    WorkOrderCompletionPreconditionFailedError,
    WorkOrderDeletionNotAllowedError,
} from "@/lib/services/workOrder/workOrderErrors";
import {
    ScheduleAppointmentNotFoundError,
    DispatchNotAllowedError,
    UndispatchNotAllowedError,
} from "@/lib/services/schedule/scheduleErrors";

/**
 * Extracts the tenant workspace ID from standard request headers or query parameters.
 * Deterministic precedence:
 * 1. x-workspace-id header
 * 2. workspace-id header
 * 3. ?workspaceId= query parameter
 */
export function extractWorkspaceId(request: Request): string | null {
    const headerX = request.headers.get("x-workspace-id")?.trim();
    if (headerX) return headerX;

    const header = request.headers.get("workspace-id")?.trim();
    if (header) return header;

    try {
        const queryParam = new URL(request.url).searchParams.get("workspaceId")?.trim();
        if (queryParam) return queryParam;
    } catch {
        // Fallback for relative or malformed URLs
    }

    return null;
}

/**
 * Maps technician operations domain errors, validation errors, and exceptions
 * to standard JSON error responses per Section 10 of Phase 1.9.1.
 */
export function mapTechnicianOperationsErrorToResponse(
    error: unknown,
    context?: string
): NextResponse {
    // 1. Authorization & Workspace Access Errors (401 / 403 / 404 for WorkspaceNotFound)
    const authResponse = authorizationErrorResponse(error);
    if (authResponse) {
        return authResponse;
    }

    // 2. Schema / Validation Errors (422 Unprocessable Entity)
    if (error instanceof ZodError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "VALIDATION_ERROR",
                    message: "Invalid request data.",
                    fields: error.flatten().fieldErrors,
                },
            },
            { status: 422 }
        );
    }

    // 3. Syntax / JSON Parsing Errors (400 Bad Request)
    if (error instanceof SyntaxError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "INVALID_REQUEST",
                    message: "Invalid JSON in request body.",
                },
            },
            { status: 400 }
        );
    }

    // 4. Technician Operations Domain Errors
    if (error instanceof TechnicianProfileNotFoundError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "TECHNICIAN_PROFILE_NOT_FOUND",
                    message: error.message,
                },
            },
            { status: 404 }
        );
    }

    if (error instanceof TechnicianNotAssignedToWorkOrderError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "TECHNICIAN_NOT_ASSIGNED_TO_WORK_ORDER",
                    message: error.message,
                },
            },
            { status: 403 }
        );
    }

    if (error instanceof ActiveTimeEntryExistsError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "ACTIVE_TIME_ENTRY_EXISTS",
                    message: error.message,
                },
            },
            { status: 409 }
        );
    }

    if (error instanceof TimeEntryNotFoundError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "TIME_ENTRY_NOT_FOUND",
                    message: error.message,
                },
            },
            { status: 404 }
        );
    }

    if (error instanceof TimeEntryImmutableError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "TIME_ENTRY_IMMUTABLE",
                    message: error.message,
                },
            },
            { status: 409 }
        );
    }

    // 5. Integrated Domain Errors (WorkOrder, Schedule)
    if (error instanceof WorkOrderNotFoundError || error instanceof ScheduleAppointmentNotFoundError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: error instanceof WorkOrderNotFoundError ? "WORK_ORDER_NOT_FOUND" : "SCHEDULE_APPOINTMENT_NOT_FOUND",
                    message: error.message,
                },
            },
            { status: 404 }
        );
    }

    if (error instanceof WorkOrderInvalidStatusTransitionError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "WORK_ORDER_INVALID_STATUS_TRANSITION",
                    message: error.message,
                },
            },
            { status: 409 }
        );
    }

    if (error instanceof WorkOrderCompletionPreconditionFailedError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "WORK_ORDER_COMPLETION_PRECONDITION_FAILED",
                    message: error.message,
                },
            },
            { status: 422 }
        );
    }

    if (error instanceof WorkOrderDeletionNotAllowedError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: "WORK_ORDER_DELETION_NOT_ALLOWED",
                    message: error.message,
                },
            },
            { status: 409 }
        );
    }

    if (error instanceof DispatchNotAllowedError || error instanceof UndispatchNotAllowedError) {
        return NextResponse.json(
            {
                success: false,
                error: {
                    code: error instanceof DispatchNotAllowedError ? "DISPATCH_NOT_ALLOWED" : "UNDISPATCH_NOT_ALLOWED",
                    message: error.message,
                },
            },
            { status: 409 }
        );
    }

    // 6. Internal / Unexpected Errors (500)
    console.error(`[Aforden Technician Operations API] Unexpected error${context ? ` in ${context}` : ""}:`, error);
    return NextResponse.json(
        {
            success: false,
            error: {
                code: "INTERNAL_SERVER_ERROR",
                message: "An unexpected error occurred while processing the technician operation.",
            },
        },
        { status: 500 }
    );
}

export const handleTechnicianOperationsApiError = mapTechnicianOperationsErrorToResponse;
```

---

## 3. Strict Zod Schema & Identity Override Rejection (Invariant 2, §2.2)

All route-level input schemas use `.strict()` to enforce that client-supplied identity override fields (e.g. `technicianId`, `technicianProfileId`, `workspaceId`) cause immediate schema-level rejection returning **422 Unprocessable Entity (`VALIDATION_ERROR`)**.

### Verbatim Schema Implementations
File: [`lib/services/technicianOperations/technicianOperations.types.ts`](file:///d:/Download/aforden/lib/services/technicianOperations/technicianOperations.types.ts)

```typescript
/**
 * Validation schema for manually recording a technician time entry.
 * Strictly restricted to BREAK and ADMIN (TRAVEL and ON_SITE are lifecycle-managed).
 * Uses .strict() to reject any client attempts to supply technicianId or workspaceId.
 */
export const recordTechnicianTimeEntrySchema = z.object({
    entryType: z.enum(["BREAK", "ADMIN"], {
        message: "Direct manual time entries only allow BREAK or ADMIN entry types. TRAVEL and ON_SITE are managed exclusively via lifecycle transitions.",
    }),
    appointmentId: z.string().trim().min(1).optional().nullable(),
    notes: z.string().trim().optional().nullable(),
    metadata: z.record(z.string(), z.any()).optional().nullable(),
}).strict();

export type RecordTechnicianTimeEntryInput = z.infer<typeof recordTechnicianTimeEntrySchema>;

/**
 * Validation schema for completing a work order with optional resolution notes and media evidence references.
 * Uses .strict() to reject unexpected override fields.
 */
export const completeWorkOrderSchema = z.object({
    resolutionNotes: z.string().trim().max(4000, "Resolution notes cannot exceed 4000 characters.").optional().nullable(),
    mediaUris: z.array(
        z.string()
            .trim()
            .min(1, "Media URI cannot be empty.")
            .max(2048, "Media URI cannot exceed 2048 characters.")
            .url("Each media URI must be a well-formed URI.")
            .refine(
                (uri) => {
                    try {
                        const parsed = new URL(uri);
                        return (
                            parsed.protocol === "http:" ||
                            parsed.protocol === "https:" ||
                            parsed.protocol === "s3:" ||
                            parsed.protocol === "blob:"
                        );
                    } catch {
                        return false;
                    }
                },
                { message: "Each media URI must use a valid web or storage scheme (http, https, s3, blob)." }
            )
    )
        .max(20, "A maximum of 20 media URIs can be attached per completion.")
        .optional()
        .nullable(),
    notes: z.string().trim().optional().nullable(),
    metadata: z.record(z.string(), z.any()).optional().nullable(),
}).strict();
```

---

## 4. Full Describe Block for `/complete` Route Test Suite (Verbatim)

The full describe block from [`tests/technician-operations/technician-api-routes.test.ts`](file:///d:/Download/aforden/tests/technician-operations/technician-api-routes.test.ts) testing all six HTTP status codes (`200`, `401`, `403`, `404`, `409`, `422`):

```typescript
    describe("3. Completion Route & Comprehensive 6-Status Coverage (§14 Step 7 & Section 10)", () => {
        it("POST /api/technician/work-orders/[workOrderId]/complete -> returns 200 on happy path and sanitizes _historyRecordId from JSON response", async () => {
            mocks.completeTechnicianWorkOrder.mockResolvedValue({
                ...sampleWorkOrderReadModel,
                status: "COMPLETED",
                completedAt: new Date("2026-08-21T11:00:00Z"),
                _historyRecordId: "hist_should_not_leak_123", // Simulated internal plumbing property
            } as any);

            const req = createRequest(
                `https://api.aforden.com/api/technician/work-orders/${WO_ID}/complete`,
                "POST",
                { "x-workspace-id": WS_ID },
                {
                    resolutionNotes: "Fixed motor bearing",
                    mediaUris: ["https://storage.aforden.com/photo.jpg"],
                }
            );
            const res = await completeRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.status).toBe("COMPLETED");

            // Explicit DTO hygiene assertion: internal audit plumbing property must NEVER leak into JSON response
            expect(json.data._historyRecordId).toBeUndefined();
        });

        it("POST /api/technician/work-orders/[workOrderId]/complete -> returns 401 on unauthenticated session", async () => {
            mocks.resolveTechnicianContext.mockRejectedValue(new UnauthorizedError());

            const req = createRequest(
                `https://api.aforden.com/api/technician/work-orders/${WO_ID}/complete`,
                "POST"
            );
            const res = await completeRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.error.code).toBe("UNAUTHORIZED");
        });

        it("POST /api/technician/work-orders/[workOrderId]/complete -> returns 403 when technician is not assigned to work order", async () => {
            mocks.completeTechnicianWorkOrder.mockRejectedValue(
                new TechnicianNotAssignedToWorkOrderError()
            );

            const req = createRequest(
                `https://api.aforden.com/api/technician/work-orders/${WO_ID}/complete`,
                "POST"
            );
            const res = await completeRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("TECHNICIAN_NOT_ASSIGNED_TO_WORK_ORDER");
        });

        it("POST /api/technician/work-orders/[workOrderId]/complete -> returns 404 when work order is not found", async () => {
            mocks.completeTechnicianWorkOrder.mockRejectedValue(
                new WorkOrderNotFoundError()
            );

            const req = createRequest(
                `https://api.aforden.com/api/technician/work-orders/${WO_ID}/complete`,
                "POST"
            );
            const res = await completeRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.error.code).toBe("WORK_ORDER_NOT_FOUND");
        });

        it("POST /api/technician/work-orders/[workOrderId]/complete -> returns 409 on invalid status transition conflict", async () => {
            mocks.completeTechnicianWorkOrder.mockRejectedValue(
                new WorkOrderInvalidStatusTransitionError("DRAFT", "COMPLETED")
            );

            const req = createRequest(
                `https://api.aforden.com/api/technician/work-orders/${WO_ID}/complete`,
                "POST"
            );
            const res = await completeRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(409);
            const json = await res.json();
            expect(json.error.code).toBe("WORK_ORDER_INVALID_STATUS_TRANSITION");
        });

        it("POST /api/technician/work-orders/[workOrderId]/complete -> returns 422 on completion precondition failure", async () => {
            mocks.completeTechnicianWorkOrder.mockRejectedValue(
                new WorkOrderCompletionPreconditionFailedError("Cannot complete: work order not IN_PROGRESS")
            );

            const req = createRequest(
                `https://api.aforden.com/api/technician/work-orders/${WO_ID}/complete`,
                "POST"
            );
            const res = await completeRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.error.code).toBe("WORK_ORDER_COMPLETION_PRECONDITION_FAILED");
        });

        it("POST /api/technician/work-orders/[workOrderId]/complete -> returns 422 on malformed media URI", async () => {
            const req = createRequest(
                `https://api.aforden.com/api/technician/work-orders/${WO_ID}/complete`,
                "POST",
                { "x-workspace-id": WS_ID },
                {
                    mediaUris: ["malformed-uri-string"],
                }
            );
            const res = await completeRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.error.code).toBe("VALIDATION_ERROR");
        });
    });
```

### Identity Override Rejection Test (`.strict()` 422 Assertion, Verbatim)

```typescript
        it("POST /api/technician/work-orders/[workOrderId]/time -> returns 422 when client supplies fraudulent technicianId or workspaceId in body (.strict() schema rejection)", async () => {
            // Client attempts to pass fraudulent identity override keys in body
            const payloadWithFraudulentKeys = {
                entryType: "BREAK",
                notes: "Lunch break",
                technicianId: "fraudulent_tech_999",
                technicianProfileId: "fraudulent_tp_999",
                workspaceId: "fraudulent_ws_999",
            };

            const req = createRequest(
                `https://api.aforden.com/api/technician/work-orders/${WO_ID}/time`,
                "POST",
                { "x-workspace-id": WS_ID },
                payloadWithFraudulentKeys
            );
            const res = await recordTimeEntryRoute(req, { params: Promise.resolve({ workOrderId: WO_ID }) });

            // Must reject at schema level with 422 Unprocessable Entity
            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.error.code).toBe("VALIDATION_ERROR");

            // Service must NEVER be called when schema validation fails
            expect(mocks.recordTechnicianTimeEntry).not.toHaveBeenCalled();
        });
```

---

## 5. Verbatim Quality Gate Outputs

### A. Prisma Schema Validation (`npx prisma validate`)

```text
Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma\schema.prisma.
The schema at prisma\schema.prisma is valid 🚀
```

### B. TypeScript Compiler Check (`npx tsc --noEmit`)

```text
Exit Code: 0
Stdout: (clean compilation, 0 errors)
Stderr: (empty)
```

### C. Full Workspace Test Suite (`npm test`)

```text
 Test Files  147 passed (147)
      Tests  2536 passed (2536)
   Start at  16:35:36
   Duration  44.12s (transform 8.12s, setup 0ms, import 36.12s, tests 43.80s, environment 31ms)
```
