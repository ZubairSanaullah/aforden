import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    serviceCatalogFindFirst: vi.fn(),
    serviceCatalogFindMany: vi.fn(),
    serviceCatalogCount: vi.fn(),
    serviceCatalogCreate: vi.fn(),
    serviceCatalogUpdate: vi.fn(),
    serviceCatalogDelete: vi.fn(),
    workTypeFindFirst: vi.fn(),
    workTypeFindMany: vi.fn(),
    workTypeCount: vi.fn(),
    workTypeCreate: vi.fn(),
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
            findMany: mocks.serviceCatalogFindMany,
            count: mocks.serviceCatalogCount,
            create: mocks.serviceCatalogCreate,
            update: mocks.serviceCatalogUpdate,
            delete: mocks.serviceCatalogDelete,
        },
        workType: {
            findFirst: mocks.workTypeFindFirst,
            findMany: mocks.workTypeFindMany,
            count: mocks.workTypeCount,
            create: mocks.workTypeCreate,
        },
    },
}));

import {
    GET as listCatalogsHandler,
    POST as createCatalogHandler,
} from "@/app/api/service-catalogs/route";
import {
    GET as getCatalogHandler,
    PATCH as updateCatalogHandler,
    DELETE as deleteCatalogHandler,
} from "@/app/api/service-catalogs/[catalogId]/route";
import { PATCH as updateCatalogStatusHandler } from "@/app/api/service-catalogs/[catalogId]/status/route";
import {
    GET as listCatalogWorkTypesHandler,
    POST as createCatalogWorkTypeHandler,
} from "@/app/api/service-catalogs/[catalogId]/work-types/route";
import type { ServiceCatalog, User, Workspace, WorkspaceMember, WorkType } from "@/generated/prisma/client";

describe("Phase 1.5.6 — Service Catalog API Routes Suite", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let catalogsList: ServiceCatalog[];
    let workTypesList: WorkType[];

    const WS_ID = "ws_apex_100";
    const WS_ID_2 = "ws_beta_200";

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
            const activeWorkTypes = attachedWorkTypes.filter((wt) => wt.status === "ACTIVE");

            return {
                ...found,
                _count: {
                    workTypes: attachedWorkTypes.length,
                },
                workTypes: include?.workTypes ? activeWorkTypes.map((wt) => ({ id: wt.id })) : [],
            };
        });

        mocks.serviceCatalogFindMany.mockImplementation(async ({ where, skip = 0, take = 20 }: any) => {
            let matched = catalogsList.filter((c) => {
                if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
                if (where.status && c.status !== where.status) return false;
                if (where.OR) {
                    const searchStr = where.OR[0].name.contains.toLowerCase();
                    const matchesName = c.name.toLowerCase().includes(searchStr);
                    const matchesDesc = c.description ? c.description.toLowerCase().includes(searchStr) : false;
                    if (!matchesName && !matchesDesc) return false;
                }
                return true;
            });

            matched = matched.sort((a, b) => {
                if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
                return a.name.localeCompare(b.name);
            });

            const sliced = matched.slice(skip, skip + take);

            return sliced.map((found) => {
                const attachedWorkTypes = workTypesList.filter((wt) => wt.catalogId === found.id);
                const activeWorkTypes = attachedWorkTypes.filter((wt) => wt.status === "ACTIVE");
                return {
                    ...found,
                    _count: {
                        workTypes: attachedWorkTypes.length,
                    },
                    workTypes: activeWorkTypes.map((wt) => ({ id: wt.id })),
                };
            });
        });

        mocks.serviceCatalogCount.mockImplementation(async ({ where }: any) => {
            return catalogsList.filter((c) => {
                if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
                if (where.status && c.status !== where.status) return false;
                return true;
            }).length;
        });

        mocks.serviceCatalogCreate.mockImplementation(async ({ data }: any) => {
            const duplicate = catalogsList.find(
                (c) => c.workspaceId === data.workspaceId && c.name.toLowerCase() === data.name.toLowerCase(),
            );
            if (duplicate) {
                const err = new Error("Unique constraint failed on the fields: (`workspaceId`,`name`)");
                (err as any).code = "P2002";
                throw err;
            }

            const created: ServiceCatalog = {
                id: `sc_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                workspaceId: data.workspaceId,
                name: data.name,
                description: data.description ?? null,
                status: data.status ?? "ACTIVE",
                sortOrder: data.sortOrder ?? 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            catalogsList.push(created);
            return created;
        });

        mocks.serviceCatalogUpdate.mockImplementation(async ({ where, data }: any) => {
            const idx = catalogsList.findIndex((c) => c.id === where.id);
            if (idx === -1) {
                const err = new Error("Record not found");
                (err as any).code = "P2025";
                throw err;
            }

            const current = catalogsList[idx];

            if (data.name && data.name !== current.name) {
                const duplicate = catalogsList.find(
                    (c) => c.id !== current.id && c.workspaceId === current.workspaceId && c.name.toLowerCase() === data.name.toLowerCase(),
                );
                if (duplicate) {
                    const err = new Error("Unique constraint failed on the fields: (`workspaceId`,`name`)");
                    (err as any).code = "P2002";
                    throw err;
                }
            }

            const updated: ServiceCatalog = {
                ...current,
                ...(data.name !== undefined && { name: data.name }),
                ...(data.description !== undefined && { description: data.description }),
                ...(data.status !== undefined && { status: data.status }),
                ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
                updatedAt: new Date(),
            };
            catalogsList[idx] = updated;

            const attachedWorkTypes = workTypesList.filter((wt) => wt.catalogId === updated.id);
            const activeWorkTypes = attachedWorkTypes.filter((wt) => wt.status === "ACTIVE");

            return {
                ...updated,
                _count: { workTypes: attachedWorkTypes.length },
                workTypes: activeWorkTypes.map((wt) => ({ id: wt.id })),
            };
        });

        mocks.serviceCatalogDelete.mockImplementation(async ({ where }: any) => {
            const idx = catalogsList.findIndex((c) => c.id === where.id);
            if (idx === -1) {
                const err = new Error("Record not found");
                (err as any).code = "P2025";
                throw err;
            }
            return catalogsList.splice(idx, 1)[0];
        });

        mocks.workTypeFindMany.mockImplementation(async ({ where, skip = 0, take = 20 }: any) => {
            let matched = workTypesList.filter((wt) => {
                if (where.workspaceId && wt.workspaceId !== where.workspaceId) return false;
                if (where.catalogId && wt.catalogId !== where.catalogId) return false;
                return true;
            });
            return matched.slice(skip, skip + take).map((wt) => ({
                ...wt,
                catalog: catalogsList.find((c) => c.id === wt.catalogId),
            }));
        });

        mocks.workTypeCount.mockImplementation(async ({ where }: any) => {
            return workTypesList.filter((wt) => {
                if (where.workspaceId && wt.workspaceId !== where.workspaceId) return false;
                if (where.catalogId && wt.catalogId !== where.catalogId) return false;
                return true;
            }).length;
        });

        mocks.workTypeCreate.mockImplementation(async ({ data, include }: any) => {
            const parentCatalog = catalogsList.find((c) => c.id === data.catalogId)!;
            const created: WorkType = {
                id: `wt_${Date.now()}`,
                workspaceId: data.workspaceId,
                catalogId: data.catalogId,
                name: data.name,
                code: data.code ?? null,
                description: data.description ?? null,
                estimatedDuration: data.estimatedDuration ?? null,
                status: data.status ?? "ACTIVE",
                sortOrder: data.sortOrder ?? 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            workTypesList.push(created);
            return {
                ...created,
                catalog: include?.catalog ? parentCatalog : undefined,
            };
        });

        registerWorkspace(WS_ID, "Apex Operations", "apex-ops");
        registerWorkspace(WS_ID_2, "Beta Services", "beta-services");

        registerUser("user_admin", "Admin User");
        registerMember("user_admin", WS_ID, "ADMIN");
    });

    function registerUser(userId = "user_admin", name = "Admin User", status = "ACTIVE") {
        const user: User = {
            id: userId,
            name,
            email: `${userId}@example.com`,
            passwordHash: "hashed-pwd",
            emailVerified: new Date(),
            avatarUrl: null,
            status: status as any,
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

    function registerMember(
        userId: string,
        workspaceId: string,
        role: "OWNER" | "ADMIN" | "MANAGER" | "DISPATCHER" | "TECHNICIAN" | "ACCOUNTANT" = "ADMIN",
    ) {
        const member: WorkspaceMember = {
            id: `member_${userId}_${workspaceId}`,
            userId,
            workspaceId,
            role: role as any,
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
            init.body = JSON.stringify(body);
        }
        return new Request(url, init);
    }

    describe("1. GET /api/service-catalogs", () => {
        it("returns 400 when x-workspace-id is missing", async () => {
            loginAs("user_admin");
            const req = createRequest("GET", "http://localhost/api/service-catalogs");
            const res = await listCatalogsHandler(req);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error.code).toBe("MISSING_WORKSPACE");
        });

        it("lists catalogs with pagination metadata on valid authorized request", async () => {
            loginAs("user_admin");
            catalogsList.push({
                id: "sc_1",
                workspaceId: WS_ID,
                name: "Residential HVAC",
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const req = createRequest("GET", "http://localhost/api/service-catalogs", undefined, {
                "x-workspace-id": WS_ID,
            });
            const res = await listCatalogsHandler(req);
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.success).toBe(true);
            expect(body.data.items.length).toBe(1);
            expect(body.data.items[0].name).toBe("Residential HVAC");
            expect(body.data.pagination.total).toBe(1);
        });
    });

    describe("2. POST /api/service-catalogs", () => {
        it("creates a catalog and returns 201 with created record", async () => {
            loginAs("user_admin");
            const req = createRequest(
                "POST",
                "http://localhost/api/service-catalogs",
                { name: "Commercial Plumbing", sortOrder: 2 },
                { "x-workspace-id": WS_ID },
            );
            const res = await createCatalogHandler(req);
            expect(res.status).toBe(201);
            const body = await res.json();
            expect(body.success).toBe(true);
            expect(body.data.name).toBe("Commercial Plumbing");
            expect(body.data.status).toBe("ACTIVE");
        });

        it("returns 409 when duplicate catalog name exists in workspace", async () => {
            loginAs("user_admin");
            catalogsList.push({
                id: "sc_1",
                workspaceId: WS_ID,
                name: "Plumbing",
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const req = createRequest(
                "POST",
                "http://localhost/api/service-catalogs",
                { name: "Plumbing" },
                { "x-workspace-id": WS_ID },
            );
            const res = await createCatalogHandler(req);
            expect(res.status).toBe(409);
            const body = await res.json();
            expect(body.error.code).toBe("DUPLICATE_SERVICE_CATALOG_NAME");
        });

        it("returns 422 on invalid validation payload", async () => {
            loginAs("user_admin");
            const req = createRequest(
                "POST",
                "http://localhost/api/service-catalogs",
                { name: "" },
                { "x-workspace-id": WS_ID },
            );
            const res = await createCatalogHandler(req);
            expect(res.status).toBe(422);
            const body = await res.json();
            expect(body.error.code).toBe("VALIDATION_ERROR");
        });
    });

    describe("3. GET /api/service-catalogs/[catalogId]", () => {
        it("retrieves operational read model of single catalog with 200", async () => {
            loginAs("user_admin");
            catalogsList.push({
                id: "sc_1",
                workspaceId: WS_ID,
                name: "Residential HVAC",
                description: "HVAC description",
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const req = createRequest("GET", "http://localhost/api/service-catalogs/sc_1", undefined, {
                "x-workspace-id": WS_ID,
            });
            const res = await getCatalogHandler(req, { params: Promise.resolve({ catalogId: "sc_1" }) });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.success).toBe(true);
            expect(body.data.name).toBe("Residential HVAC");
            expect(body.data.workTypesCount).toBe(0);
        });

        it("returns 404 for non-existent catalog ID", async () => {
            loginAs("user_admin");
            const req = createRequest("GET", "http://localhost/api/service-catalogs/sc_ghost", undefined, {
                "x-workspace-id": WS_ID,
            });
            const res = await getCatalogHandler(req, { params: Promise.resolve({ catalogId: "sc_ghost" }) });
            expect(res.status).toBe(404);
            const body = await res.json();
            expect(body.error.code).toBe("SERVICE_CATALOG_NOT_FOUND");
        });
    });

    describe("4. PATCH /api/service-catalogs/[catalogId]", () => {
        it("updates catalog name and sortOrder returning 200", async () => {
            loginAs("user_admin");
            catalogsList.push({
                id: "sc_1",
                workspaceId: WS_ID,
                name: "HVAC",
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const req = createRequest(
                "PATCH",
                "http://localhost/api/service-catalogs/sc_1",
                { name: "HVAC & Energy Services", sortOrder: 5 },
                { "x-workspace-id": WS_ID },
            );
            const res = await updateCatalogHandler(req, { params: Promise.resolve({ catalogId: "sc_1" }) });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data.name).toBe("HVAC & Energy Services");
            expect(body.data.sortOrder).toBe(5);
        });
    });

    describe("5. DELETE /api/service-catalogs/[catalogId]", () => {
        it("rejects deletion of ACTIVE catalog with 409", async () => {
            loginAs("user_admin");
            catalogsList.push({
                id: "sc_active",
                workspaceId: WS_ID,
                name: "Active HVAC",
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const req = createRequest("DELETE", "http://localhost/api/service-catalogs/sc_active", undefined, {
                "x-workspace-id": WS_ID,
            });
            const res = await deleteCatalogHandler(req, { params: Promise.resolve({ catalogId: "sc_active" }) });
            expect(res.status).toBe(409);
            const body = await res.json();
            expect(body.error.code).toBe("SERVICE_CATALOG_DELETION_NOT_ALLOWED");
        });

        it("deletes INACTIVE empty catalog returning 200", async () => {
            loginAs("user_admin");
            catalogsList.push({
                id: "sc_inactive",
                workspaceId: WS_ID,
                name: "Inactive Trade",
                description: null,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const req = createRequest("DELETE", "http://localhost/api/service-catalogs/sc_inactive", undefined, {
                "x-workspace-id": WS_ID,
            });
            const res = await deleteCatalogHandler(req, { params: Promise.resolve({ catalogId: "sc_inactive" }) });
            expect(res.status).toBe(200);
            expect(catalogsList.length).toBe(0);
        });
    });

    describe("6. PATCH /api/service-catalogs/[catalogId]/status", () => {
        it("transitions catalog status returning 200", async () => {
            loginAs("user_admin");
            catalogsList.push({
                id: "sc_1",
                workspaceId: WS_ID,
                name: "HVAC",
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const req = createRequest(
                "PATCH",
                "http://localhost/api/service-catalogs/sc_1/status",
                { status: "INACTIVE" },
                { "x-workspace-id": WS_ID },
            );
            const res = await updateCatalogStatusHandler(req, { params: Promise.resolve({ catalogId: "sc_1" }) });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data.status).toBe("INACTIVE");
        });
    });

    describe("7. Nested Catalog Work Type Routes", () => {
        it("GET /api/service-catalogs/[catalogId]/work-types lists work types for catalog", async () => {
            loginAs("user_admin");
            catalogsList.push({
                id: "sc_1",
                workspaceId: WS_ID,
                name: "HVAC",
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            workTypesList.push({
                id: "wt_1",
                workspaceId: WS_ID,
                catalogId: "sc_1",
                name: "AC Inspection",
                code: "AC-01",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const req = createRequest("GET", "http://localhost/api/service-catalogs/sc_1/work-types", undefined, {
                "x-workspace-id": WS_ID,
            });
            const res = await listCatalogWorkTypesHandler(req, { params: Promise.resolve({ catalogId: "sc_1" }) });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data.items.length).toBe(1);
            expect(body.data.items[0].name).toBe("AC Inspection");
        });

        it("POST /api/service-catalogs/[catalogId]/work-types creates work type inside catalog", async () => {
            loginAs("user_admin");
            catalogsList.push({
                id: "sc_1",
                workspaceId: WS_ID,
                name: "HVAC",
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const req = createRequest(
                "POST",
                "http://localhost/api/service-catalogs/sc_1/work-types",
                { name: "Heat Pump Check", estimatedDuration: 45 },
                { "x-workspace-id": WS_ID },
            );
            const res = await createCatalogWorkTypeHandler(req, { params: Promise.resolve({ catalogId: "sc_1" }) });
            expect(res.status).toBe(201);
            const body = await res.json();
            expect(body.data.name).toBe("Heat Pump Check");
            expect(body.data.catalogId).toBe("sc_1");
        });
    });
});
