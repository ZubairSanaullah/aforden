import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    prisma: {
        user: { findUnique: vi.fn() },
        workspace: { findUnique: vi.fn(), create: vi.fn() },
        workspaceMember: { findFirst: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
        workOrder: { findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
        serviceCatalog: { findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
        scheduleAppointment: { findMany: vi.fn(), create: vi.fn(), count: vi.fn() },
        session: { findMany: vi.fn(), deleteMany: vi.fn() },
        $transaction: vi.fn(),
    },
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: mocks.prisma,
}));

// Route handlers
import { GET as getWorkspacesRoute, POST as createWorkspaceRoute } from "@/app/api/workspaces/route";
import { GET as getWorkOrdersRoute, POST as createWorkOrderRoute } from "@/app/api/work-orders/route";
import { GET as getServiceCatalogsRoute, POST as createServiceCatalogRoute } from "@/app/api/service-catalogs/route";
import { GET as getSchedulesRoute, POST as createScheduleRoute } from "@/app/api/schedules/route";
import { GET as getSessionsRoute } from "@/app/api/auth/sessions/route";
import { DELETE as deleteSessionRoute } from "@/app/api/auth/sessions/[sessionId]/route";
import { POST as revokeAllSessionsRoute } from "@/app/api/auth/sessions/revoke-all/route";
import { POST as acceptInvitationRoute } from "@/app/api/invitations/accept/route";

describe("Phase 1.21.3 — Workspace & Domain API HTTP Boundary Contract", () => {
    const WS_ID = "ws_contract_100";
    const USER_ID = "user_contract_1";

    beforeEach(() => {
        vi.clearAllMocks();

        mocks.auth.mockResolvedValue({
            user: { id: USER_ID, email: "tester@example.com" },
        });

        mocks.prisma.workspace.findUnique.mockResolvedValue({
            id: WS_ID,
            name: "Contract Workspace",
            slug: "contract-ws",
        });

        mocks.prisma.user.findUnique.mockResolvedValue({
            id: USER_ID,
            email: "tester@example.com",
            status: "ACTIVE",
            emailVerified: new Date(),
        });

        const activeMember = {
            id: "mem_contract_1",
            userId: USER_ID,
            workspaceId: WS_ID,
            role: "OWNER",
            status: "ACTIVE",
        };
        mocks.prisma.workspaceMember.findFirst.mockResolvedValue(activeMember);
        mocks.prisma.workspaceMember.findUnique.mockResolvedValue(activeMember);
    });

    describe("1. Missing Workspace Context Boundary (400 MISSING_WORKSPACE)", () => {
        it("GET /api/work-orders returns 400 when x-workspace-id header or query is omitted", async () => {
            const req = new Request("http://localhost/api/work-orders");
            const res = await getWorkOrdersRoute(req);
            expect(res.status).toBe(400);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("MISSING_WORKSPACE");
            expect(json.error.message).toBe("Workspace ID is required.");
        });

        it("POST /api/work-orders returns 400 when workspace context is omitted", async () => {
            const req = new Request("http://localhost/api/work-orders", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ title: "WO without WS" }),
            });
            const res = await createWorkOrderRoute(req);
            expect(res.status).toBe(400);

            const json = await res.json();
            expect(json.error.code).toBe("MISSING_WORKSPACE");
        });

        it("GET /api/service-catalogs returns 400 when workspace context is omitted", async () => {
            const req = new Request("http://localhost/api/service-catalogs");
            const res = await getServiceCatalogsRoute(req);
            expect(res.status).toBe(400);

            const json = await res.json();
            expect(json.error.code).toBe("MISSING_WORKSPACE");
        });

        it("POST /api/service-catalogs returns 400 when workspace context is omitted", async () => {
            const req = new Request("http://localhost/api/service-catalogs", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ name: "Catalog without WS" }),
            });
            const res = await createServiceCatalogRoute(req);
            expect(res.status).toBe(400);

            const json = await res.json();
            expect(json.error.code).toBe("MISSING_WORKSPACE");
        });

        it("GET /api/schedules returns 400 when workspace context is omitted", async () => {
            const req = new Request("http://localhost/api/schedules");
            const res = await getSchedulesRoute(req);
            expect(res.status).toBe(400);

            const json = await res.json();
            expect(json.error.code).toBe("MISSING_WORKSPACE");
        });

        it("POST /api/schedules returns 400 when workspace context is omitted", async () => {
            const req = new Request("http://localhost/api/schedules", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ workOrderId: "wo_1" }),
            });
            const res = await createScheduleRoute(req);
            expect(res.status).toBe(400);

            const json = await res.json();
            expect(json.error.code).toBe("MISSING_WORKSPACE");
        });
    });

    describe("2. Unauthenticated Session Rejection Boundary (401 UNAUTHORIZED)", () => {
        it("GET /api/workspaces returns 401 when unauthenticated", async () => {
            mocks.auth.mockResolvedValue(null);
            const res = await getWorkspacesRoute();
            expect(res.status).toBe(401);

            const json = await res.json();
            expect(json.error).toBe("Unauthorized");
        });

        it("POST /api/workspaces returns 401 when unauthenticated", async () => {
            mocks.auth.mockResolvedValue(null);
            const req = new Request("http://localhost/api/workspaces", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ name: "New Workspace" }),
            });
            const res = await createWorkspaceRoute(req);
            expect(res.status).toBe(401);
        });

        it("GET /api/auth/sessions returns 401 when unauthenticated", async () => {
            mocks.auth.mockResolvedValue(null);
            const res = await getSessionsRoute();
            expect(res.status).toBe(401);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.message).toBe("Authentication is required.");
        });

        it("DELETE /api/auth/sessions/:id returns 401 when unauthenticated", async () => {
            mocks.auth.mockResolvedValue(null);
            const req = new Request("http://localhost/api/auth/sessions/sess_1", { method: "DELETE" });
            const res = await deleteSessionRoute(req, { params: Promise.resolve({ sessionId: "sess_1" }) });
            expect(res.status).toBe(401);
        });

        it("POST /api/auth/sessions/revoke-all returns 401 when unauthenticated", async () => {
            mocks.auth.mockResolvedValue(null);
            const res = await revokeAllSessionsRoute();
            expect(res.status).toBe(401);
        });
    });

    describe("3. Malformed JSON Body Handling (400 / 422)", () => {
        it("POST /api/workspaces returns 400 on invalid JSON syntax", async () => {
            const req = new Request("http://localhost/api/workspaces", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: "{ invalid json ...",
            });
            const res = await createWorkspaceRoute(req);
            expect(res.status).toBe(400);

            const json = await res.json();
            expect(json.error).toBe("Invalid request body");
        });

        it("POST /api/work-orders returns 400 on invalid JSON syntax with workspace header", async () => {
            const req = new Request("http://localhost/api/work-orders", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-workspace-id": WS_ID,
                },
                body: "<<< malformed >>>",
            });
            const res = await createWorkOrderRoute(req);
            expect(res.status).toBe(400);

            const json = await res.json();
            expect(json.error.code).toBe("INVALID_REQUEST");
        });

        it("POST /api/service-catalogs returns 400 on invalid JSON syntax with workspace query", async () => {
            const req = new Request(`http://localhost/api/service-catalogs?workspaceId=${WS_ID}`, {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: "not json",
            });
            const res = await createServiceCatalogRoute(req);
            expect(res.status).toBe(400);

            const json = await res.json();
            expect(json.error.code).toBe("INVALID_REQUEST");
        });

        it("POST /api/schedules returns 400 on invalid JSON syntax with workspace header", async () => {
            const req = new Request("http://localhost/api/schedules", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-workspace-id": WS_ID,
                },
                body: "broken payload",
            });
            const res = await createScheduleRoute(req);
            expect(res.status).toBe(400);
        });
    });

    describe("4. Schema Constraint Boundary Validations (422 / 400 with details)", () => {
        it("POST /api/invitations/accept returns 422 with field errors on invalid token format", async () => {
            const req = new Request("http://localhost/api/invitations/accept", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ token: "too_short_token" }),
            });
            const res = await acceptInvitationRoute(req);
            expect(res.status).toBe(422);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("VALIDATION_ERROR");
            expect(json.error.fields).toHaveProperty("token");
        });

        it("DELETE /api/auth/sessions/:sessionId returns 400 when sessionId is empty string", async () => {
            const req = new Request("http://localhost/api/auth/sessions/", { method: "DELETE" });
            const res = await deleteSessionRoute(req, { params: Promise.resolve({ sessionId: "" }) });
            expect(res.status).toBe(400);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.message).toBe("Session ID is required.");
        });
    });

    describe("5. Query Parameter & Header Resolution Consistency", () => {
        it("GET /api/work-orders resolves workspace from x-workspace-id header", async () => {
            mocks.prisma.workOrder.count.mockResolvedValue(1);
            mocks.prisma.workOrder.findMany.mockResolvedValue([
                {
                    id: "wo_test_1",
                    workspaceId: WS_ID,
                    title: "Test Work Order",
                    workOrderNumber: "WO-001",
                    customerId: "cust_1",
                    locationId: "loc_1",
                    workTypeId: "wt_1",
                    workTypeName: "HVAC Repair",
                    workTypeCode: "WT-001",
                    estimatedDuration: 60,
                    status: "OPEN",
                    priority: "MEDIUM",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    customer: {
                        id: "cust_1",
                        name: "Acme Corp",
                        customerNumber: "CUST-001",
                    },
                    location: {
                        id: "loc_1",
                        name: "HQ",
                        addressLine1: "123 Test Street",
                        addressLine2: null,
                        city: "Testville",
                        state: "NY",
                        postalCode: "12345",
                        country: "US",
                    },
                    workType: {
                        id: "wt_1",
                        name: "HVAC Repair",
                        code: "WT-001",
                    },
                },
            ]);

            const req = new Request("http://localhost/api/work-orders?status=OPEN&limit=10", {
                headers: { "x-workspace-id": WS_ID },
            });
            const res = await getWorkOrdersRoute(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.items.length).toBe(1);
        });

        it("GET /api/service-catalogs resolves workspace from workspaceId query parameter", async () => {
            mocks.prisma.serviceCatalog.count.mockResolvedValue(1);
            mocks.prisma.serviceCatalog.findMany.mockResolvedValue([
                {
                    id: "cat_test_1",
                    workspaceId: WS_ID,
                    name: "HVAC Services",
                    status: "ACTIVE",
                    description: null,
                    sortOrder: 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    workTypes: [],
                    _count: {
                        workTypes: 0,
                    },
                },
            ]);

            const req = new Request(`http://localhost/api/service-catalogs?workspaceId=${WS_ID}&search=HVAC`);
            const res = await getServiceCatalogsRoute(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.items.length).toBe(1);
        });
    });
});
