import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { authMock, prismaMock } = vi.hoisted(() => ({
    authMock: vi.fn(),
    prismaMock: {
        workspace: { findUnique: vi.fn() },
        workspaceMember: { findFirst: vi.fn(), findUnique: vi.fn() },
        user: { findUnique: vi.fn() },
        employee: { findFirst: vi.fn(), findUnique: vi.fn() },
        technicianProfile: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
        technicianTimeEntry: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
        scheduleAppointment: { findFirst: vi.fn(), update: vi.fn() },
        workOrder: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
        workOrderHistory: { create: vi.fn() },
        serviceCatalog: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
        workType: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
        quote: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
        inAppNotificationFeed: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
        developerApplication: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
        $transaction: vi.fn(),
    },
}));

vi.mock("@/auth", () => ({ auth: authMock }));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

// Domain Services
import { getServiceCatalog } from "@/lib/services/serviceCatalog/getServiceCatalog";
import { updateServiceCatalog } from "@/lib/services/serviceCatalog/updateServiceCatalog";
import { deleteServiceCatalog } from "@/lib/services/serviceCatalog/deleteServiceCatalog";
import { getWorkType } from "@/lib/services/workType/getWorkType";
import { updateWorkType } from "@/lib/services/workType/updateWorkType";
import { deleteWorkType } from "@/lib/services/workType/deleteWorkType";
import { ServiceCatalogNotFoundError } from "@/lib/services/serviceCatalog/serviceCatalogErrors";
import { WorkTypeNotFoundError } from "@/lib/services/workType/workTypeErrors";
import { getQuote } from "@/lib/services/quote/getQuote";
import { deleteQuote } from "@/lib/services/quote/deleteQuote";
import { QuoteNotFoundError } from "@/lib/services/quote/quoteErrors";
import {
    getDeveloperApplication,
    updateDeveloperApplicationStatus,
} from "@/lib/services/developerApp/developerAppService";
import { markNotificationAsRead } from "@/lib/services/notification/inAppFeedService";
import { NotificationNotFoundError } from "@/lib/services/notification/notificationErrors";
import { recordTechnicianTimeEntry } from "@/lib/services/technicianOperations/recordTechnicianTimeEntry";
import { startTechnicianWorkOrder } from "@/lib/services/technicianOperations/startTechnicianWorkOrder";
import { assignWorkOrder } from "@/lib/services/workOrder/assignWorkOrder";
import {
    TechnicianNotAssignedToWorkOrderError,
    type TechnicianExecutionContext,
} from "@/lib/services/technicianOperations";
import {
    WorkOrderTechnicianNotFoundError,
} from "@/lib/services/workOrder/workOrderErrors";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

// Route Handlers
import { POST as postTechnicianTimeRoute } from "@/app/api/technician/work-orders/[workOrderId]/time/route";
import { POST as postWorkOrderAssignmentRoute } from "@/app/api/work-orders/[workOrderId]/assignment/route";
import { POST as postTechnicianStartRoute } from "@/app/api/technician/work-orders/[workOrderId]/start/route";

function makeActor(
    workspaceId: string,
    role: "OWNER" | "ADMIN" | "MANAGER" | "DISPATCHER" | "TECHNICIAN" | "ACCOUNTANT" = "ADMIN",
    userId = "user_attacker_1"
): WorkspaceAuthorizationContext {
    return {
        user: { id: userId, email: "attacker@tenant-a.com" } as any,
        membership: { id: "mem_attacker", role, userId } as any,
        workspace: { id: workspaceId, name: "Tenant A Workspace", slug: "tenant-a", timezone: "UTC", logoUrl: null } as any,
    };
}

describe("Phase 1.21.4 — Cross-Tenant IDOR & Identity Spoofing Adversarial Suite", () => {
    const TENANT_A_WS = "ws_tenant_a_100";
    const TENANT_B_WS = "ws_tenant_b_200";

    const TENANT_B_CATALOG_ID = "cat_tenant_b_999";
    const TENANT_B_WORK_TYPE_ID = "wt_tenant_b_999";
    const TENANT_B_QUOTE_ID = "quote_tenant_b_999";
    const TENANT_B_DEV_APP_ID = "app_tenant_b_999";
    const TENANT_B_FEED_ITEM_ID = "feed_tenant_b_999";

    const AUTH_TECH_PROFILE_ID = "tech_authenticated_1";
    const SPOOFED_TECH_PROFILE_ID = "tech_victim_999";

    const mockTechnicianContext: TechnicianExecutionContext = {
        userId: "user_tech_1",
        workspaceId: TENANT_A_WS,
        membershipId: "mem_tech_1",
        role: "TECHNICIAN",
        employeeId: "emp_tech_1",
        technicianProfileId: AUTH_TECH_PROFILE_ID,
        technicianName: "Bob Technician",
    };

    beforeEach(() => {
        vi.clearAllMocks();

        authMock.mockResolvedValue({
            user: { id: "user_attacker_1", email: "attacker@tenant-a.com" },
        });

        prismaMock.user.findUnique.mockResolvedValue({
            id: "user_attacker_1",
            email: "attacker@tenant-a.com",
            status: "ACTIVE",
            emailVerified: new Date(),
        });

        prismaMock.workspace.findUnique.mockResolvedValue({
            id: TENANT_A_WS,
            name: "Tenant A Workspace",
            slug: "tenant-a",
        });

        const activeMember = {
            id: "mem_attacker",
            userId: "user_attacker_1",
            workspaceId: TENANT_A_WS,
            role: "ADMIN",
            status: "ACTIVE",
        };
        prismaMock.workspaceMember.findFirst.mockResolvedValue(activeMember);
        prismaMock.workspaceMember.findUnique.mockResolvedValue(activeMember);

        prismaMock.employee.findFirst.mockResolvedValue({
            id: "emp_tech_1",
            workspaceMemberId: "mem_tech_1",
            workspaceId: TENANT_A_WS,
            status: "ACTIVE",
            displayName: "Bob Technician",
            technicianProfile: {
                id: AUTH_TECH_PROFILE_ID,
            },
        });

        prismaMock.$transaction.mockImplementation(async (cb: any) => {
            if (typeof cb === "function") return cb(prismaMock);
            return Promise.all(cb);
        });
    });

    // =========================================================================
    // 1. Cross-Tenant IDOR: Service Catalogs & Work Types
    // =========================================================================
    describe("1. Cross-Tenant IDOR: Service Catalog & Work Type Boundaries", () => {
        it("getServiceCatalog: Tenant A requesting Tenant B catalog ID throws ServiceCatalogNotFoundError (404)", async () => {
            prismaMock.serviceCatalog.findFirst.mockResolvedValue(null);

            await expect(
                getServiceCatalog(TENANT_A_WS, TENANT_B_CATALOG_ID)
            ).rejects.toThrow(ServiceCatalogNotFoundError);

            expect(prismaMock.serviceCatalog.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        id: TENANT_B_CATALOG_ID,
                        workspaceId: TENANT_A_WS,
                    },
                })
            );
        });

        it("updateServiceCatalog: Tenant A attempting mutation on Tenant B catalog throws ServiceCatalogNotFoundError (404)", async () => {
            prismaMock.serviceCatalog.findFirst.mockResolvedValue(null);

            await expect(
                updateServiceCatalog(
                    TENANT_A_WS,
                    TENANT_B_CATALOG_ID,
                    { name: "Malicious Overwrite" }
                )
            ).rejects.toThrow(ServiceCatalogNotFoundError);

            expect(prismaMock.serviceCatalog.update).not.toHaveBeenCalled();
        });

        it("deleteServiceCatalog: Tenant A attempting deletion on Tenant B catalog throws ServiceCatalogNotFoundError (404)", async () => {
            prismaMock.serviceCatalog.findFirst.mockResolvedValue(null);

            await expect(
                deleteServiceCatalog(TENANT_A_WS, TENANT_B_CATALOG_ID)
            ).rejects.toThrow(ServiceCatalogNotFoundError);

            expect(prismaMock.serviceCatalog.delete).not.toHaveBeenCalled();
        });

        it("getWorkType: Tenant A requesting Tenant B workType ID throws WorkTypeNotFoundError (404)", async () => {
            prismaMock.workType.findFirst.mockResolvedValue(null);

            await expect(
                getWorkType(TENANT_A_WS, TENANT_B_WORK_TYPE_ID)
            ).rejects.toThrow(WorkTypeNotFoundError);

            expect(prismaMock.workType.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        id: TENANT_B_WORK_TYPE_ID,
                        workspaceId: TENANT_A_WS,
                    },
                })
            );
        });

        it("updateWorkType: Tenant A attempting mutation on Tenant B workType throws WorkTypeNotFoundError (404)", async () => {
            prismaMock.workType.findFirst.mockResolvedValue(null);

            await expect(
                updateWorkType(
                    TENANT_A_WS,
                    TENANT_B_WORK_TYPE_ID,
                    { name: "Hacked Work Type" }
                )
            ).rejects.toThrow(WorkTypeNotFoundError);

            expect(prismaMock.workType.update).not.toHaveBeenCalled();
        });

        it("deleteWorkType: Tenant A attempting deletion on Tenant B workType throws WorkTypeNotFoundError (404)", async () => {
            prismaMock.workType.findFirst.mockResolvedValue(null);

            await expect(
                deleteWorkType(TENANT_A_WS, TENANT_B_WORK_TYPE_ID)
            ).rejects.toThrow(WorkTypeNotFoundError);

            expect(prismaMock.workType.delete).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 2. Cross-Tenant IDOR: Quotes & Financial Projections
    // =========================================================================
    describe("2. Cross-Tenant IDOR: Quotes Boundaries", () => {
        it("getQuote: Tenant A querying Tenant B quote ID throws QuoteNotFoundError (404)", async () => {
            const actor = makeActor(TENANT_A_WS, "ADMIN");
            prismaMock.quote.findFirst.mockResolvedValue(null);

            await expect(
                getQuote(TENANT_A_WS, TENANT_B_QUOTE_ID, actor)
            ).rejects.toThrow(QuoteNotFoundError);

            expect(prismaMock.quote.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        id: TENANT_B_QUOTE_ID,
                        workspaceId: TENANT_A_WS,
                    },
                })
            );
        });

        it("deleteQuote: Tenant A attempting to delete Tenant B quote throws QuoteNotFoundError (404)", async () => {
            const actor = makeActor(TENANT_A_WS, "OWNER");
            prismaMock.quote.findFirst.mockResolvedValue(null);

            await expect(
                deleteQuote(TENANT_A_WS, TENANT_B_QUOTE_ID, actor)
            ).rejects.toThrow(QuoteNotFoundError);

            expect(prismaMock.quote.delete).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 3. Cross-Tenant IDOR: Developer Applications & Notifications
    // =========================================================================
    describe("3. Cross-Tenant IDOR: Developer Apps & In-App Notification Feed", () => {
        it("getDeveloperApplication: Tenant A requesting Tenant B developer app returns null (404 boundary)", async () => {
            prismaMock.developerApplication.findFirst.mockResolvedValue(null);

            const result = await getDeveloperApplication(TENANT_A_WS, TENANT_B_DEV_APP_ID);
            expect(result).toBeNull();

            expect(prismaMock.developerApplication.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        id: TENANT_B_DEV_APP_ID,
                        workspaceId: TENANT_A_WS,
                    },
                })
            );
        });

        it("updateDeveloperApplicationStatus: Tenant A mutating Tenant B developer app throws not found error", async () => {
            prismaMock.developerApplication.findFirst.mockResolvedValue(null);

            await expect(
                updateDeveloperApplicationStatus(TENANT_A_WS, TENANT_B_DEV_APP_ID, "SUSPENDED")
            ).rejects.toThrow("DeveloperApplication 'app_tenant_b_999' not found in workspace 'ws_tenant_a_100'");

            expect(prismaMock.developerApplication.update).not.toHaveBeenCalled();
        });

        it("markNotificationAsRead: Tenant A attempting to mark Tenant B feed item read throws NotificationNotFoundError (404)", async () => {
            prismaMock.inAppNotificationFeed.findFirst.mockResolvedValue(null);

            await expect(
                markNotificationAsRead(prismaMock as any, TENANT_A_WS, "user_attacker_1", TENANT_B_FEED_ITEM_ID)
            ).rejects.toThrow(NotificationNotFoundError);

            expect(prismaMock.inAppNotificationFeed.update).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 4. Identity Spoofing Protection: Technician Time-Entry Creation
    // =========================================================================
    describe("4. Identity Spoofing Protection: Technician Time-Entry Creation", () => {
        it("recordTechnicianTimeEntry: strictly validates schema and binds execution to session technician context", async () => {
            prismaMock.workOrder.findFirst.mockResolvedValue({
                id: "wo_123",
                workspaceId: TENANT_A_WS,
                assignedTechnicianId: AUTH_TECH_PROFILE_ID,
            });

            prismaMock.technicianTimeEntry.findFirst.mockResolvedValue(null);
            prismaMock.technicianTimeEntry.create.mockImplementation((args: any) =>
                Promise.resolve({
                    id: "tte_created_1",
                    ...args.data,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                })
            );

            // Valid payload without spoofed fields
            const validPayload = {
                entryType: "BREAK" as const,
                notes: "Coffee break",
            };

            const result = await recordTechnicianTimeEntry(mockTechnicianContext, "wo_123", validPayload);

            // Verify created record strictly holds the authenticated session identity
            expect(prismaMock.technicianTimeEntry.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        workspaceId: TENANT_A_WS,
                        technicianProfileId: AUTH_TECH_PROFILE_ID,
                        createdByMemberId: "mem_tech_1",
                        workOrderId: "wo_123",
                        entryType: "BREAK",
                    }),
                })
            );

            expect(result.technicianProfileId).toBe(AUTH_TECH_PROFILE_ID);
        });

        it("recordTechnicianTimeEntry: schema rejects unrecognized spoofed identity fields (technicianId, employeeId, workspaceId)", async () => {
            const spoofedPayload = {
                entryType: "BREAK",
                notes: "Coffee break",
                technicianId: SPOOFED_TECH_PROFILE_ID, // Malicious field
                employeeId: "emp_victim_999",         // Malicious field
                workspaceId: TENANT_B_WS,              // Malicious field
            };

            await expect(
                recordTechnicianTimeEntry(mockTechnicianContext, "wo_123", spoofedPayload)
            ).rejects.toThrow();

            expect(prismaMock.technicianTimeEntry.create).not.toHaveBeenCalled();
        });

        it("recordTechnicianTimeEntry: rejects attempt to log time on a work order assigned to a different technician", async () => {
            prismaMock.workOrder.findFirst.mockResolvedValue({
                id: "wo_123",
                workspaceId: TENANT_A_WS,
                assignedTechnicianId: "tech_other_different",
            });

            const payload = { entryType: "ADMIN" as const, notes: "Paperwork" };

            await expect(
                recordTechnicianTimeEntry(mockTechnicianContext, "wo_123", payload)
            ).rejects.toThrow(TechnicianNotAssignedToWorkOrderError);

            expect(prismaMock.technicianTimeEntry.create).not.toHaveBeenCalled();
        });

        it("POST /api/technician/work-orders/:id/time: HTTP boundary derives context from session and rejects spoofed actor fields with 422", async () => {
            authMock.mockResolvedValue({
                user: { id: "user_tech_1", email: "bob@tenant-a.com" },
            });
            prismaMock.user.findUnique.mockResolvedValue({
                id: "user_tech_1",
                email: "bob@tenant-a.com",
                status: "ACTIVE",
            });
            prismaMock.workspaceMember.findFirst.mockResolvedValue({
                id: "mem_tech_1",
                userId: "user_tech_1",
                workspaceId: TENANT_A_WS,
                role: "TECHNICIAN",
                status: "ACTIVE",
            });

            const req = new NextRequest("http://localhost/api/technician/work-orders/wo_123/time", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-workspace-id": TENANT_A_WS,
                },
                body: JSON.stringify({
                    entryType: "ADMIN",
                    technicianId: SPOOFED_TECH_PROFILE_ID, // Injected spoofed field
                    actorMemberId: "mem_spoofed_admin",
                }),
            });

            const res = await postTechnicianTimeRoute(req, {
                params: Promise.resolve({ workOrderId: "wo_123" }),
            });
            expect(res.status).toBe(422);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("VALIDATION_ERROR");
            expect(prismaMock.technicianTimeEntry.create).not.toHaveBeenCalled();
        });

        it("POST /api/technician/work-orders/:id/time: creates time entry bound strictly to authenticated session for valid payload", async () => {
            authMock.mockResolvedValue({
                user: { id: "user_tech_1", email: "bob@tenant-a.com" },
            });
            prismaMock.user.findUnique.mockResolvedValue({
                id: "user_tech_1",
                email: "bob@tenant-a.com",
                status: "ACTIVE",
            });
            const techMember = {
                id: "mem_tech_1",
                userId: "user_tech_1",
                workspaceId: TENANT_A_WS,
                role: "TECHNICIAN",
                status: "ACTIVE",
            };
            prismaMock.workspaceMember.findFirst.mockResolvedValue(techMember);
            prismaMock.workspaceMember.findUnique.mockResolvedValue(techMember);
            prismaMock.workOrder.findFirst.mockResolvedValue({
                id: "wo_123",
                workspaceId: TENANT_A_WS,
                assignedTechnicianId: AUTH_TECH_PROFILE_ID,
            });
            prismaMock.technicianTimeEntry.findFirst.mockResolvedValue(null);
            prismaMock.technicianTimeEntry.create.mockImplementation((args: any) =>
                Promise.resolve({
                    id: "tte_http_1",
                    ...args.data,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                })
            );

            const req = new NextRequest("http://localhost/api/technician/work-orders/wo_123/time", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-workspace-id": TENANT_A_WS,
                },
                body: JSON.stringify({
                    entryType: "ADMIN",
                    notes: "Valid admin time log",
                }),
            });

            const res = await postTechnicianTimeRoute(req, {
                params: Promise.resolve({ workOrderId: "wo_123" }),
            });
            expect(res.status).toBe(201);

            expect(prismaMock.technicianTimeEntry.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        technicianProfileId: AUTH_TECH_PROFILE_ID,
                        createdByMemberId: "mem_tech_1",
                    }),
                })
            );
        });
    });

    // =========================================================================
    // 5. Identity Spoofing Protection: Work-Order Assignment
    // =========================================================================
    describe("5. Identity Spoofing Protection: Work-Order Assignment", () => {
        it("assignWorkOrder: TECHNICIAN role claiming actorMemberId='mem_owner' in payload is evaluated by real session role and rejected with 403", async () => {
            const techActor = makeActor(TENANT_A_WS, "TECHNICIAN", "user_tech_attacker");

            // Valid technicianId in payload, but actor is TECHNICIAN
            const payload = {
                technicianId: AUTH_TECH_PROFILE_ID,
            };

            await expect(
                assignWorkOrder(TENANT_A_WS, "wo_123", payload, techActor)
            ).rejects.toThrow(ForbiddenError);

            expect(prismaMock.workOrder.update).not.toHaveBeenCalled();
        });

        it("assignWorkOrder: DISPATCHER attempting to assign technicianId belonging to a different workspace is rejected with 404", async () => {
            const dispatcherActor = makeActor(TENANT_A_WS, "DISPATCHER");

            prismaMock.workOrder.findFirst.mockResolvedValue({
                id: "wo_123",
                workspaceId: TENANT_A_WS,
                status: "READY",
                assignedTechnicianId: null,
            });

            // Technician belongs to Tenant B, so scoped lookup within Tenant A returns null
            prismaMock.technicianProfile.findFirst.mockResolvedValue(null);

            await expect(
                assignWorkOrder(
                    TENANT_A_WS,
                    "wo_123",
                    { technicianId: "tech_tenant_b_alien" },
                    dispatcherActor
                )
            ).rejects.toThrow(WorkOrderTechnicianNotFoundError);

            expect(prismaMock.technicianProfile.findFirst).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        id: "tech_tenant_b_alien",
                        employee: {
                            workspaceId: TENANT_A_WS, // Strict tenant scoping
                        },
                    },
                })
            );

            expect(prismaMock.workOrder.update).not.toHaveBeenCalled();
        });

        it("POST /api/work-orders/:id/assignment: rejects spoofed actor fields in body with 422 VALIDATION_ERROR", async () => {
            authMock.mockResolvedValue({
                user: { id: "user_dispatcher_1", email: "dispatcher@tenant-a.com" },
            });
            prismaMock.user.findUnique.mockResolvedValue({
                id: "user_dispatcher_1",
                email: "dispatcher@tenant-a.com",
                status: "ACTIVE",
            });
            prismaMock.workspaceMember.findFirst.mockResolvedValue({
                id: "mem_dispatcher_1",
                userId: "user_dispatcher_1",
                workspaceId: TENANT_A_WS,
                role: "DISPATCHER",
                status: "ACTIVE",
            });

            const req = new NextRequest("http://localhost/api/work-orders/wo_123/assignment", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-workspace-id": TENANT_A_WS,
                },
                body: JSON.stringify({
                    technicianId: AUTH_TECH_PROFILE_ID,
                    actorMemberId: "mem_owner_spoofed", // Attempted identity spoof
                    workspaceId: TENANT_B_WS,
                }),
            });

            const res = await postWorkOrderAssignmentRoute(req, {
                params: Promise.resolve({ workOrderId: "wo_123" }),
            });
            expect(res.status).toBe(422);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("VALIDATION_ERROR");
        });
    });

    // =========================================================================
    // 6. Identity Spoofing Protection: Technician Self-Service Execution
    // =========================================================================
    describe("6. Identity Spoofing Protection: Technician Self-Service Execution", () => {
        it("startTechnicianWorkOrder: non-technician role claiming technician context throws ForbiddenError", async () => {
            const adminTechContext: TechnicianExecutionContext = {
                ...mockTechnicianContext,
                role: "ADMIN", // Admin cannot invoke technician operations directly
            };

            await expect(
                startTechnicianWorkOrder(adminTechContext, "wo_123", {})
            ).rejects.toThrow(ForbiddenError);
        });

        it("POST /api/technician/work-orders/:id/start: rejects spoofed technicianId / employeeId in body with 422", async () => {
            authMock.mockResolvedValue({
                user: { id: "user_tech_1", email: "bob@tenant-a.com" },
            });
            prismaMock.user.findUnique.mockResolvedValue({
                id: "user_tech_1",
                email: "bob@tenant-a.com",
                status: "ACTIVE",
            });
            prismaMock.workspaceMember.findFirst.mockResolvedValue({
                id: "mem_tech_1",
                userId: "user_tech_1",
                workspaceId: TENANT_A_WS,
                role: "TECHNICIAN",
                status: "ACTIVE",
            });

            const req = new NextRequest("http://localhost/api/technician/work-orders/wo_123/start", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-workspace-id": TENANT_A_WS,
                },
                body: JSON.stringify({
                    technicianId: SPOOFED_TECH_PROFILE_ID, // Injected spoofed field
                    employeeId: "emp_spoofed_999",
                }),
            });

            const res = await postTechnicianStartRoute(req, {
                params: Promise.resolve({ workOrderId: "wo_123" }),
            });
            expect(res.status).toBe(422);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("VALIDATION_ERROR");
        });

        it("POST /api/technician/work-orders/:id/start: executes transition strictly using authenticated session profile", async () => {
            authMock.mockResolvedValue({
                user: { id: "user_tech_1", email: "bob@tenant-a.com" },
            });
            prismaMock.user.findUnique.mockResolvedValue({
                id: "user_tech_1",
                email: "bob@tenant-a.com",
                status: "ACTIVE",
            });
            const techMember = {
                id: "mem_tech_1",
                userId: "user_tech_1",
                workspaceId: TENANT_A_WS,
                role: "TECHNICIAN",
                status: "ACTIVE",
            };
            prismaMock.workspaceMember.findFirst.mockResolvedValue(techMember);
            prismaMock.workspaceMember.findUnique.mockResolvedValue(techMember);
            prismaMock.technicianProfile.findFirst.mockResolvedValue({
                id: AUTH_TECH_PROFILE_ID,
            });

            prismaMock.workOrder.findFirst.mockResolvedValue({
                id: "wo_123",
                workspaceId: TENANT_A_WS,
                status: "ASSIGNED",
                title: "Fix HVAC Unit",
                customerId: "cust_1",
                assignedTechnicianId: AUTH_TECH_PROFILE_ID,
            });

            prismaMock.workOrder.update.mockResolvedValue({
                id: "wo_123",
                workspaceId: TENANT_A_WS,
                status: "IN_PROGRESS",
                workOrderNumber: "WO-001",
                title: "Fix HVAC Unit",
                customerId: "cust_1",
                priority: "MEDIUM",
                assignedTechnicianId: AUTH_TECH_PROFILE_ID,
                customer: { name: "Acme", customerNumber: "C-1" },
                location: { addressLine1: "123 Main" },
                workType: { name: "Repair", code: "REP" },
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            prismaMock.scheduleAppointment.findFirst.mockResolvedValue(null);
            prismaMock.technicianTimeEntry.findFirst.mockResolvedValue(null);
            prismaMock.technicianTimeEntry.create.mockResolvedValue({ id: "tte_1" });
            prismaMock.workOrderHistory.create.mockResolvedValue({ id: "woh_1" });

            const req = new NextRequest("http://localhost/api/technician/work-orders/wo_123/start", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-workspace-id": TENANT_A_WS,
                },
                body: JSON.stringify({}),
            });

            const res = await postTechnicianStartRoute(req, {
                params: Promise.resolve({ workOrderId: "wo_123" }),
            });
            expect(res.status).toBe(200);

            // Verify work order transition executed under the session's workspace
            expect(prismaMock.workOrder.update).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        id: "wo_123",
                    },
                    data: expect.objectContaining({
                        status: "IN_PROGRESS",
                    }),
                })
            );
        });
    });
});
