import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    serviceCatalogFindFirst: vi.fn(),
    serviceCatalogDelete: vi.fn(),
    workTypeFindMany: vi.fn(),
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
            delete: mocks.serviceCatalogDelete,
        },
        workType: {
            findMany: mocks.workTypeFindMany,
        },
    },
}));

import { deleteServiceCatalog } from "@/lib/services/serviceCatalog/deleteServiceCatalog";
import { DELETE as deleteCatalogApiHandler } from "@/app/api/service-catalogs/[catalogId]/route";
import {
    ServiceCatalogNotFoundError,
    ServiceCatalogDeletionNotAllowedError,
    ServiceCatalogDeletionError,
} from "@/lib/services/serviceCatalog/serviceCatalogErrors";
import { ForbiddenError, UnauthorizedError } from "@/lib/services/authorization/authorizationErrors";
import type { ServiceCatalog, User, Workspace, WorkspaceMember, WorkType } from "@/generated/prisma/client";

describe("Phase 1.5.8 — Service Catalog Deletion Services & Lifecycle Enforcement", () => {
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

        mocks.serviceCatalogFindFirst.mockImplementation(async ({ where, include }: any) => {
            const found = catalogsList.find((c) => {
                if (where.id && c.id !== where.id) return false;
                if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
                return true;
            });
            if (!found) return null;

            const attachedWorkTypes = workTypesList.filter((wt) => wt.catalogId === found.id);

            return {
                ...found,
                _count: {
                    workTypes: attachedWorkTypes.length,
                },
            };
        });

        mocks.serviceCatalogDelete.mockImplementation(async ({ where }: any) => {
            const idx = catalogsList.findIndex((c) => c.id === where.id);
            if (idx === -1) {
                const err = new Error("Record not found");
                (err as any).code = "P2025";
                throw err;
            }

            const attached = workTypesList.filter((wt) => wt.catalogId === where.id);
            if (attached.length > 0) {
                const err = new Error("Foreign key constraint failed on the field: `catalogId`");
                (err as any).code = "P2003";
                throw err;
            }

            return catalogsList.splice(idx, 1)[0];
        });

        mocks.workTypeFindMany.mockImplementation(async ({ where }: any) => {
            return workTypesList.filter((wt) => {
                if (where.catalogId && wt.catalogId !== where.catalogId) return false;
                return true;
            });
        });

        registerWorkspace(WS_ALPHA, "Alpha Operations", "alpha-ops");
        registerWorkspace(WS_BETA, "Beta Operations", "beta-ops");

        registerUser("user_owner", "Owner User");
        registerMember("user_owner", WS_ALPHA, "OWNER");

        registerUser("user_admin", "Admin User");
        registerMember("user_admin", WS_ALPHA, "ADMIN");

        registerUser("user_manager", "Manager User");
        registerMember("user_manager", WS_ALPHA, "MANAGER");

        registerUser("user_tech", "Technician User");
        registerMember("user_tech", WS_ALPHA, "TECHNICIAN");

        registerUser("user_beta_admin", "Beta Admin");
        registerMember("user_beta_admin", WS_BETA, "ADMIN");
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

    describe("1. Service Deletion Lifecycle Matrix", () => {
        it("rejects deletion of an ACTIVE catalog with 0 work types", async () => {
            catalogsList.push({
                id: "sc_active_empty",
                workspaceId: WS_ALPHA,
                name: "Active Empty Catalog",
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            loginAs("user_admin");

            await expect(deleteServiceCatalog(WS_ALPHA, "sc_active_empty")).rejects.toThrow(
                ServiceCatalogDeletionNotAllowedError,
            );
            expect(catalogsList).toHaveLength(1);
        });

        it("rejects deletion of an ACTIVE catalog with >0 work types", async () => {
            catalogsList.push({
                id: "sc_active_with_wt",
                workspaceId: WS_ALPHA,
                name: "Active With WorkTypes",
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            workTypesList.push({
                id: "wt_1",
                workspaceId: WS_ALPHA,
                catalogId: "sc_active_with_wt",
                name: "Active Work Type",
                code: "A-01",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            loginAs("user_admin");

            await expect(deleteServiceCatalog(WS_ALPHA, "sc_active_with_wt")).rejects.toThrow(
                ServiceCatalogDeletionNotAllowedError,
            );
            expect(catalogsList).toHaveLength(1);
            expect(workTypesList).toHaveLength(1);
        });

        it("rejects deletion of an INACTIVE catalog with >0 work types and leaves child work types untouched", async () => {
            catalogsList.push({
                id: "sc_inactive_with_wt",
                workspaceId: WS_ALPHA,
                name: "Inactive With WorkTypes",
                description: null,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            workTypesList.push({
                id: "wt_1",
                workspaceId: WS_ALPHA,
                catalogId: "sc_inactive_with_wt",
                name: "Child Work Type",
                code: "C-01",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            loginAs("user_admin");

            await expect(deleteServiceCatalog(WS_ALPHA, "sc_inactive_with_wt")).rejects.toThrow(
                ServiceCatalogDeletionNotAllowedError,
            );
            expect(catalogsList).toHaveLength(1);
            expect(workTypesList).toHaveLength(1);
            expect(workTypesList[0].catalogId).toBe("sc_inactive_with_wt");
        });

        it("permanently deletes an INACTIVE catalog with 0 work types for OWNER and ADMIN", async () => {
            catalogsList.push({
                id: "sc_inactive_empty",
                workspaceId: WS_ALPHA,
                name: "Inactive Empty Catalog",
                description: null,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            loginAs("user_admin");

            const deleted = await deleteServiceCatalog(WS_ALPHA, "sc_inactive_empty");
            expect(deleted.id).toBe("sc_inactive_empty");
            expect(catalogsList).toHaveLength(0);
        });
    });

    describe("2. RBAC Deletion Enforcement", () => {
        it("allows OWNER and ADMIN to delete eligible catalogs", async () => {
            for (const role of ["user_owner", "user_admin"]) {
                catalogsList.push({
                    id: `sc_empty_${role}`,
                    workspaceId: WS_ALPHA,
                    name: `Empty Catalog for ${role}`,
                    description: null,
                    status: "INACTIVE",
                    sortOrder: 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                });

                loginAs(role);

                const res = await deleteServiceCatalog(WS_ALPHA, `sc_empty_${role}`);
                expect(res.id).toBe(`sc_empty_${role}`);
            }
        });

        it("rejects MANAGER, TECHNICIAN with ForbiddenError at service layer", async () => {
            catalogsList.push({
                id: "sc_target",
                workspaceId: WS_ALPHA,
                name: "Target Catalog",
                description: null,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            for (const user of ["user_manager", "user_tech"]) {
                loginAs(user);

                await expect(deleteServiceCatalog(WS_ALPHA, "sc_target")).rejects.toThrow(
                    ForbiddenError,
                );
            }
            expect(catalogsList).toHaveLength(1);
        });
    });

    describe("3. Tenant Isolation & IDOR Defense", () => {
        it("returns ServiceCatalogNotFoundError when Workspace A tries to delete Workspace B catalog", async () => {
            catalogsList.push({
                id: "sc_beta_catalog",
                workspaceId: WS_BETA,
                name: "Beta Inactive Empty",
                description: null,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            loginAs("user_admin"); // Workspace Alpha Admin

            await expect(deleteServiceCatalog(WS_ALPHA, "sc_beta_catalog")).rejects.toThrow(
                ServiceCatalogNotFoundError,
            );
            expect(catalogsList).toHaveLength(1);
        });
    });

    describe("4. Database Error & Referential Integrity Isolation", () => {
        it("translates database restrict constraint violation (P2003) to ServiceCatalogDeletionNotAllowedError", async () => {
            catalogsList.push({
                id: "sc_race_condition",
                workspaceId: WS_ALPHA,
                name: "Race Condition Catalog",
                description: null,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            mocks.serviceCatalogDelete.mockImplementationOnce(async () => {
                const err = new Error("Foreign key constraint failed on the field: `catalogId`");
                (err as any).code = "P2003";
                throw err;
            });

            loginAs("user_admin");

            await expect(deleteServiceCatalog(WS_ALPHA, "sc_race_condition")).rejects.toThrow(
                ServiceCatalogDeletionNotAllowedError,
            );
        });
    });

    describe("5. HTTP REST API Endpoint Enforcement (DELETE /api/service-catalogs/[catalogId])", () => {
        it("returns 200 with deleted catalog data when deleting eligible inactive empty catalog", async () => {
            catalogsList.push({
                id: "sc_api_eligible",
                workspaceId: WS_ALPHA,
                name: "API Eligible",
                description: null,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            loginAs("user_admin");

            const req = createRequest("DELETE", "http://localhost/api/service-catalogs/sc_api_eligible", undefined, {
                "x-workspace-id": WS_ALPHA,
            });
            const res = await deleteCatalogApiHandler(req, { params: Promise.resolve({ catalogId: "sc_api_eligible" }) });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.success).toBe(true);
            expect(body.data.id).toBe("sc_api_eligible");
            expect(catalogsList).toHaveLength(0);
        });

        it("returns 409 when attempting to delete an ACTIVE catalog via API", async () => {
            catalogsList.push({
                id: "sc_api_active",
                workspaceId: WS_ALPHA,
                name: "API Active",
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            loginAs("user_admin");

            const req = createRequest("DELETE", "http://localhost/api/service-catalogs/sc_api_active", undefined, {
                "x-workspace-id": WS_ALPHA,
            });
            const res = await deleteCatalogApiHandler(req, { params: Promise.resolve({ catalogId: "sc_api_active" }) });
            expect(res.status).toBe(409);
            const body = await res.json();
            expect(body.error.code).toBe("SERVICE_CATALOG_DELETION_NOT_ALLOWED");
        });

        it("returns 409 when attempting to delete an INACTIVE catalog with work types via API", async () => {
            catalogsList.push({
                id: "sc_api_with_children",
                workspaceId: WS_ALPHA,
                name: "API With Children",
                description: null,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            workTypesList.push({
                id: "wt_child",
                workspaceId: WS_ALPHA,
                catalogId: "sc_api_with_children",
                name: "Child Work",
                code: "CW-01",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            loginAs("user_admin");

            const req = createRequest("DELETE", "http://localhost/api/service-catalogs/sc_api_with_children", undefined, {
                "x-workspace-id": WS_ALPHA,
            });
            const res = await deleteCatalogApiHandler(req, { params: Promise.resolve({ catalogId: "sc_api_with_children" }) });
            expect(res.status).toBe(409);
            const body = await res.json();
            expect(body.error.code).toBe("SERVICE_CATALOG_DELETION_NOT_ALLOWED");
        });

        it("returns 403 when MANAGER attempts to delete a catalog via API", async () => {
            catalogsList.push({
                id: "sc_manager_target",
                workspaceId: WS_ALPHA,
                name: "Manager Target",
                description: null,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            loginAs("user_manager");

            const req = createRequest("DELETE", "http://localhost/api/service-catalogs/sc_manager_target", undefined, {
                "x-workspace-id": WS_ALPHA,
            });
            const res = await deleteCatalogApiHandler(req, { params: Promise.resolve({ catalogId: "sc_manager_target" }) });
            expect(res.status).toBe(403);
            const body = await res.json();
            expect(body.error.code).toBe("FORBIDDEN");
        });

        it("returns 404 for cross-tenant catalog deletion via API without leaking existence", async () => {
            catalogsList.push({
                id: "sc_beta_target",
                workspaceId: WS_BETA,
                name: "Beta Target",
                description: null,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            loginAs("user_admin"); // Alpha admin

            const req = createRequest("DELETE", "http://localhost/api/service-catalogs/sc_beta_target", undefined, {
                "x-workspace-id": WS_ALPHA,
            });
            const res = await deleteCatalogApiHandler(req, { params: Promise.resolve({ catalogId: "sc_beta_target" }) });
            expect(res.status).toBe(404);
            const body = await res.json();
            expect(body.error.code).toBe("SERVICE_CATALOG_NOT_FOUND");
        });
    });
});
