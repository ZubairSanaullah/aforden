import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    serviceCatalogFindFirst: vi.fn(),
    workTypeFindFirst: vi.fn(),
    workTypeDelete: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: {
            findUnique: mocks.userFindUnique,
        },
        workspace: {
            findUnique: mocks.workspaceFindUnique,
        },
        workspaceMember: {
            findUnique: mocks.workspaceMemberFindUnique,
        },
        serviceCatalog: {
            findFirst: mocks.serviceCatalogFindFirst,
        },
        workType: {
            findFirst: mocks.workTypeFindFirst,
            delete: mocks.workTypeDelete,
        },
    },
}));

import { deleteWorkType } from "@/lib/services/workType/deleteWorkType";
import { DELETE as deleteWorkTypeApiHandler } from "@/app/api/work-types/[workTypeId]/route";
import {
    WorkTypeNotFoundError,
    WorkTypeDeletionNotAllowedError,
    WorkTypeDeletionError,
} from "@/lib/services/workType/workTypeErrors";
import { ForbiddenError, UnauthorizedError } from "@/lib/services/authorization/authorizationErrors";
import type { ServiceCatalog, User, Workspace, WorkspaceMember, WorkType } from "@/generated/prisma/client";

describe("Phase 1.5.9 — WorkType Deletion & Lifecycle Enforcement Suite", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let catalogsList: ServiceCatalog[];
    let workTypesList: WorkType[];

    const WS_ALPHA = "ws_alpha_100";
    const WS_BETA = "ws_beta_200";

    beforeEach(() => {
        vi.clearAllMocks();
        usersMap = new Map();
        workspacesMap = new Map();
        membersMap = new Map();
        catalogsList = [];
        workTypesList = [];

        mocks.userFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
            return usersMap.get(where.id) || null;
        });

        mocks.workspaceFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
            return workspacesMap.get(where.id) || null;
        });

        mocks.workspaceMemberFindUnique.mockImplementation(async ({ where }: any) => {
            if (where.userId_workspaceId) {
                const key = `${where.userId_workspaceId.userId}_${where.userId_workspaceId.workspaceId}`;
                return membersMap.get(key) || null;
            }
            if (where.id) {
                return membersMap.get(where.id) || null;
            }
            return null;
        });

        mocks.serviceCatalogFindFirst.mockImplementation(async ({ where }: any) => {
            return (
                catalogsList.find((c) => {
                    if (where.id && c.id !== where.id) return false;
                    if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
                    return true;
                }) || null
            );
        });

        mocks.workTypeFindFirst.mockImplementation(async ({ where, include }: any) => {
            const found = workTypesList.find((wt) => {
                if (where.id && wt.id !== where.id) return false;
                if (where.workspaceId && wt.workspaceId !== where.workspaceId) return false;
                return true;
            });
            if (!found) return null;

            const parentCatalog = catalogsList.find((c) => c.id === found.catalogId);
            return {
                ...found,
                catalog: include?.catalog ? parentCatalog : undefined,
            };
        });

        mocks.workTypeDelete.mockImplementation(async ({ where }: any) => {
            const idx = workTypesList.findIndex((wt) => wt.id === where.id);
            if (idx === -1) {
                const err = new Error("Record not found");
                (err as any).code = "P2025";
                throw err;
            }

            return workTypesList.splice(idx, 1)[0];
        });

        registerWorkspace(WS_ALPHA, "Alpha Operations", "alpha-ops");
        registerWorkspace(WS_BETA, "Beta Operations", "beta-ops");

        registerUser("user_owner", "Owner User");
        registerMember("user_owner", WS_ALPHA, "OWNER");

        registerUser("user_admin", "Admin User");
        registerMember("user_admin", WS_ALPHA, "ADMIN");

        registerUser("user_manager", "Manager User");
        registerMember("user_manager", WS_ALPHA, "MANAGER");

        registerUser("user_dispatcher", "Dispatcher User");
        registerMember("user_dispatcher", WS_ALPHA, "DISPATCHER");

        registerUser("user_tech", "Technician User");
        registerMember("user_tech", WS_ALPHA, "TECHNICIAN");

        registerUser("user_accountant", "Accountant User");
        registerMember("user_accountant", WS_ALPHA, "ACCOUNTANT");

        registerUser("user_beta_admin", "Beta Admin");
        registerMember("user_beta_admin", WS_BETA, "ADMIN");

        catalogsList.push(
            {
                id: "sc_alpha_hvac",
                workspaceId: WS_ALPHA,
                name: "Residential HVAC",
                description: "HVAC Catalog",
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            {
                id: "sc_beta_hvac",
                workspaceId: WS_BETA,
                name: "Beta HVAC",
                description: null,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        );
    });

    function registerUser(userId: string, name: string) {
        const user: User = {
            id: userId,
            name,
            email: `${userId}@example.com`,
            passwordHash: "hashed-pwd",
            emailVerified: new Date(),
            avatarUrl: null,
            status: "ACTIVE" as any,
            createdAt: new Date("2026-08-19T00:00:00.000Z"),
            updatedAt: new Date("2026-08-19T00:00:00.000Z"),
        };
        usersMap.set(userId, user);
        return user;
    }

    function registerWorkspace(workspaceId: string, name: string, slug: string) {
        const workspace: Workspace = {
            id: workspaceId,
            name,
            slug,
            logoUrl: null,
            timezone: "Asia/Karachi",
            createdAt: new Date("2026-08-19T00:00:00.000Z"),
            updatedAt: new Date("2026-08-19T00:00:00.000Z"),
        };
        workspacesMap.set(workspaceId, workspace);
        return workspace;
    }

    function registerMember(userId: string, workspaceId: string, role: any) {
        const member: WorkspaceMember = {
            id: `member_${userId}_${workspaceId}`,
            userId,
            workspaceId,
            role,
            status: "ACTIVE" as any,
            createdAt: new Date("2026-08-19T00:00:00.000Z"),
            updatedAt: new Date("2026-08-19T00:00:00.000Z"),
        };
        membersMap.set(`${userId}_${workspaceId}`, member);
        return member;
    }

    function loginAs(userId: string) {
        mocks.auth.mockResolvedValue({
            user: { id: userId, email: `${userId}@example.com` },
        });
    }

    function createRequest(
        method: string,
        url: string,
        body?: any,
        headers: Record<string, string> = {},
    ) {
        const init: RequestInit = {
            method,
            headers: {
                "content-type": "application/json",
                ...headers,
            },
        };
        if (body !== undefined) {
            init.body = typeof body === "string" ? body : JSON.stringify(body);
        }
        return new Request(url, init);
    }

    describe("1. Service-Level Deletion Lifecycle & Rules", () => {
        it("rejects deletion of an ACTIVE work type with WorkTypeDeletionNotAllowedError", async () => {
            workTypesList.push({
                id: "wt_active",
                workspaceId: WS_ALPHA,
                catalogId: "sc_alpha_hvac",
                name: "AC Inspection",
                code: "AC-01",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            loginAs("user_admin");

            await expect(deleteWorkType(WS_ALPHA, "wt_active")).rejects.toThrow(
                WorkTypeDeletionNotAllowedError,
            );
            expect(workTypesList).toHaveLength(1);
        });

        it("permanently deletes an INACTIVE work type with zero downstream references for OWNER/ADMIN", async () => {
            workTypesList.push({
                id: "wt_inactive",
                workspaceId: WS_ALPHA,
                catalogId: "sc_alpha_hvac",
                name: "Retired Inspection",
                code: "RET-01",
                description: null,
                estimatedDuration: 45,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            loginAs("user_admin");

            const deleted = await deleteWorkType(WS_ALPHA, "wt_inactive");
            expect(deleted.id).toBe("wt_inactive");
            expect(deleted.name).toBe("Retired Inspection");
            expect(deleted.isAvailableForWorkOrder).toBe(false);
            expect(workTypesList).toHaveLength(0);
        });

        it("leaves parent ServiceCatalog completely untouched when deleting a child work type", async () => {
            workTypesList.push({
                id: "wt_to_delete",
                workspaceId: WS_ALPHA,
                catalogId: "sc_alpha_hvac",
                name: "Work to Delete",
                code: null,
                description: null,
                estimatedDuration: null,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const initialCatalog = { ...catalogsList[0] };

            loginAs("user_admin");

            await deleteWorkType(WS_ALPHA, "wt_to_delete");

            // Verify parent catalog unchanged in all fields
            expect(catalogsList[0]).toEqual(initialCatalog);
        });

        it("leaves parent catalog and work type untouched when deletion is rejected", async () => {
            workTypesList.push({
                id: "wt_rejected",
                workspaceId: WS_ALPHA,
                catalogId: "sc_alpha_hvac",
                name: "Active Work Type",
                code: "REJ-01",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const initialCatalog = { ...catalogsList[0] };
            const initialWorkType = { ...workTypesList[0] };

            loginAs("user_admin");

            await expect(deleteWorkType(WS_ALPHA, "wt_rejected")).rejects.toThrow(
                WorkTypeDeletionNotAllowedError,
            );

            expect(catalogsList[0]).toEqual(initialCatalog);
            expect(workTypesList[0]).toEqual(initialWorkType);
        });
    });

    describe("2. RBAC Deletion Authorization Matrix", () => {
        it("allows OWNER and ADMIN to delete eligible inactive work types", async () => {
            for (const user of ["user_owner", "user_admin"]) {
                const wtId = `wt_del_${user}`;
                workTypesList.push({
                    id: wtId,
                    workspaceId: WS_ALPHA,
                    catalogId: "sc_alpha_hvac",
                    name: `Work for ${user}`,
                    code: null,
                    description: null,
                    estimatedDuration: null,
                    status: "INACTIVE",
                    sortOrder: 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                });

                loginAs(user);

                const res = await deleteWorkType(WS_ALPHA, wtId);
                expect(res.id).toBe(wtId);
            }
        });

        it("rejects MANAGER, DISPATCHER, TECHNICIAN, and ACCOUNTANT with ForbiddenError", async () => {
            workTypesList.push({
                id: "wt_target",
                workspaceId: WS_ALPHA,
                catalogId: "sc_alpha_hvac",
                name: "Protected Work",
                code: null,
                description: null,
                estimatedDuration: null,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            for (const user of ["user_manager", "user_dispatcher", "user_tech", "user_accountant"]) {
                loginAs(user);

                await expect(deleteWorkType(WS_ALPHA, "wt_target")).rejects.toThrow(
                    ForbiddenError,
                );
            }
            expect(workTypesList).toHaveLength(1);
        });
    });

    describe("3. Multi-Tenant Isolation & IDOR Protection", () => {
        it("returns WorkTypeNotFoundError when Workspace A caller tries to delete Workspace B work type", async () => {
            workTypesList.push({
                id: "wt_beta_1",
                workspaceId: WS_BETA,
                catalogId: "sc_beta_hvac",
                name: "Beta Work",
                code: "B-01",
                description: null,
                estimatedDuration: null,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            loginAs("user_admin"); // Alpha Admin

            await expect(deleteWorkType(WS_ALPHA, "wt_beta_1")).rejects.toThrow(
                WorkTypeNotFoundError,
            );
            expect(workTypesList).toHaveLength(1);
        });
    });

    describe("4. Error Translation & Database Safety Net", () => {
        it("translates foreign key restrict violation (P2003) to WorkTypeDeletionNotAllowedError", async () => {
            workTypesList.push({
                id: "wt_referenced",
                workspaceId: WS_ALPHA,
                catalogId: "sc_alpha_hvac",
                name: "Referenced Work Type",
                code: "REF-01",
                description: null,
                estimatedDuration: null,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            mocks.workTypeDelete.mockImplementationOnce(async () => {
                const err = new Error("Foreign key constraint failed on the field: `workTypeId`");
                (err as any).code = "P2003";
                throw err;
            });

            loginAs("user_admin");

            await expect(deleteWorkType(WS_ALPHA, "wt_referenced")).rejects.toThrow(
                WorkTypeDeletionNotAllowedError,
            );
        });

        it("translates unexpected database errors to WorkTypeDeletionError", async () => {
            workTypesList.push({
                id: "wt_crash",
                workspaceId: WS_ALPHA,
                catalogId: "sc_alpha_hvac",
                name: "Crash Work Type",
                code: null,
                description: null,
                estimatedDuration: null,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            mocks.workTypeDelete.mockImplementationOnce(async () => {
                throw new Error("Database connection lost unexpectedly");
            });

            loginAs("user_admin");

            await expect(deleteWorkType(WS_ALPHA, "wt_crash")).rejects.toThrow(
                WorkTypeDeletionError,
            );
        });
    });

    describe("5. HTTP REST API Endpoint Enforcement (DELETE /api/work-types/[workTypeId])", () => {
        it("returns 200 with deleted operational read model for eligible inactive work type", async () => {
            workTypesList.push({
                id: "wt_api_eligible",
                workspaceId: WS_ALPHA,
                catalogId: "sc_alpha_hvac",
                name: "API Eligible",
                code: "ELIG-01",
                description: null,
                estimatedDuration: 60,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            loginAs("user_admin");

            const req = createRequest("DELETE", "http://localhost/api/work-types/wt_api_eligible", undefined, {
                "x-workspace-id": WS_ALPHA,
            });
            const res = await deleteWorkTypeApiHandler(req, { params: Promise.resolve({ workTypeId: "wt_api_eligible" }) });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.success).toBe(true);
            expect(body.data.id).toBe("wt_api_eligible");
            expect(body.data.catalogName).toBe("Residential HVAC");
            expect(body.data.isAvailableForWorkOrder).toBe(false);
            expect(workTypesList).toHaveLength(0);
        });

        it("returns 409 when attempting to delete an ACTIVE work type via API", async () => {
            workTypesList.push({
                id: "wt_api_active",
                workspaceId: WS_ALPHA,
                catalogId: "sc_alpha_hvac",
                name: "API Active",
                code: "ACT-01",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            loginAs("user_admin");

            const req = createRequest("DELETE", "http://localhost/api/work-types/wt_api_active", undefined, {
                "x-workspace-id": WS_ALPHA,
            });
            const res = await deleteWorkTypeApiHandler(req, { params: Promise.resolve({ workTypeId: "wt_api_active" }) });
            expect(res.status).toBe(409);
            const body = await res.json();
            expect(body.error.code).toBe("WORK_TYPE_DELETION_NOT_ALLOWED");
        });

        it("returns 403 when MANAGER attempts to delete a work type via API", async () => {
            workTypesList.push({
                id: "wt_mgr_target",
                workspaceId: WS_ALPHA,
                catalogId: "sc_alpha_hvac",
                name: "Manager Target",
                code: null,
                description: null,
                estimatedDuration: null,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            loginAs("user_manager");

            const req = createRequest("DELETE", "http://localhost/api/work-types/wt_mgr_target", undefined, {
                "x-workspace-id": WS_ALPHA,
            });
            const res = await deleteWorkTypeApiHandler(req, { params: Promise.resolve({ workTypeId: "wt_mgr_target" }) });
            expect(res.status).toBe(403);
            const body = await res.json();
            expect(body.error.code).toBe("FORBIDDEN");
        });

        it("returns 404 when attempting to delete cross-tenant work type via API", async () => {
            workTypesList.push({
                id: "wt_beta_target",
                workspaceId: WS_BETA,
                catalogId: "sc_beta_hvac",
                name: "Beta Target",
                code: null,
                description: null,
                estimatedDuration: null,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            loginAs("user_admin"); // Alpha Admin

            const req = createRequest("DELETE", "http://localhost/api/work-types/wt_beta_target", undefined, {
                "x-workspace-id": WS_ALPHA,
            });
            const res = await deleteWorkTypeApiHandler(req, { params: Promise.resolve({ workTypeId: "wt_beta_target" }) });
            expect(res.status).toBe(404);
            const body = await res.json();
            expect(body.error.code).toBe("WORK_TYPE_NOT_FOUND");
        });

        it("returns 401 when request is unauthenticated", async () => {
            mocks.auth.mockResolvedValue(null);

            const req = createRequest("DELETE", "http://localhost/api/work-types/wt_unauth", undefined, {
                "x-workspace-id": WS_ALPHA,
            });
            const res = await deleteWorkTypeApiHandler(req, { params: Promise.resolve({ workTypeId: "wt_unauth" }) });
            expect(res.status).toBe(401);
            const body = await res.json();
            expect(body.error.code).toBe("UNAUTHORIZED");
        });
    });
});
