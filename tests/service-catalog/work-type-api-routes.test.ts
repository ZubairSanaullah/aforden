import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    serviceCatalogFindFirst: vi.fn(),
    workTypeFindFirst: vi.fn(),
    workTypeFindMany: vi.fn(),
    workTypeCount: vi.fn(),
    workTypeCreate: vi.fn(),
    workTypeUpdate: vi.fn(),
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
            findMany: mocks.workTypeFindMany,
            count: mocks.workTypeCount,
            create: mocks.workTypeCreate,
            update: mocks.workTypeUpdate,
            delete: mocks.workTypeDelete,
        },
    },
}));

import {
    GET as listWorkTypesHandler,
    POST as createWorkTypeHandler,
} from "@/app/api/work-types/route";
import {
    GET as getWorkTypeHandler,
    PATCH as updateWorkTypeHandler,
    DELETE as deleteWorkTypeHandler,
} from "@/app/api/work-types/[workTypeId]/route";
import { PATCH as updateWorkTypeStatusHandler } from "@/app/api/work-types/[workTypeId]/status/route";
import type { ServiceCatalog, User, Workspace, WorkspaceMember, WorkType } from "@/generated/prisma/client";

describe("Phase 1.5.6 — Work Type API Routes Suite", () => {
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
                if (where.code && wt.code !== where.code) return false;
                if (where.NOT?.id && wt.id === where.NOT.id) return false;
                return true;
            });
            if (!found) return null;

            const parentCatalog = catalogsList.find((c) => c.id === found.catalogId);
            return {
                ...found,
                catalog: include?.catalog ? parentCatalog : undefined,
            };
        });

        mocks.workTypeFindMany.mockImplementation(async ({ where, skip = 0, take = 20 }: any) => {
            let matched = workTypesList.filter((wt) => {
                if (where.workspaceId && wt.workspaceId !== where.workspaceId) return false;
                if (where.status && wt.status !== where.status) return false;
                if (where.catalogId && wt.catalogId !== where.catalogId) return false;
                return true;
            });

            matched = matched.sort((a, b) => {
                if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
                return a.name.localeCompare(b.name);
            });

            const sliced = matched.slice(skip, skip + take);

            return sliced.map((wt) => ({
                ...wt,
                catalog: catalogsList.find((c) => c.id === wt.catalogId),
            }));
        });

        mocks.workTypeCount.mockImplementation(async ({ where }: any) => {
            return workTypesList.filter((wt) => {
                if (where.workspaceId && wt.workspaceId !== where.workspaceId) return false;
                if (where.status && wt.status !== where.status) return false;
                if (where.catalogId && wt.catalogId !== where.catalogId) return false;
                return true;
            }).length;
        });

        mocks.workTypeCreate.mockImplementation(async ({ data, include }: any) => {
            // Check catalog-scoped name uniqueness
            const nameDup = workTypesList.find(
                (wt) => wt.catalogId === data.catalogId && wt.name.toLowerCase() === data.name.toLowerCase(),
            );
            if (nameDup) {
                const err = new Error("Unique constraint failed on the fields: (`catalogId`,`name`)");
                (err as any).code = "P2002";
                (err as any).meta = { target: ["catalogId", "name"] };
                throw err;
            }

            if (data.code) {
                const codeDup = workTypesList.find(
                    (wt) => wt.workspaceId === data.workspaceId && wt.code === data.code,
                );
                if (codeDup) {
                    const err = new Error("Unique constraint failed on the fields: (`workspaceId`,`code`)");
                    (err as any).code = "P2002";
                    (err as any).meta = { target: ["workspaceId", "code"] };
                    throw err;
                }
            }

            const parentCatalog = catalogsList.find((c) => c.id === data.catalogId)!;
            const created: WorkType = {
                id: `wt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
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

        mocks.workTypeUpdate.mockImplementation(async ({ where, data, include }: any) => {
            const idx = workTypesList.findIndex((wt) => wt.id === where.id);
            if (idx === -1) {
                const err = new Error("Record not found");
                (err as any).code = "P2025";
                throw err;
            }

            const current = workTypesList[idx];
            const targetCatalogId = data.catalogId ?? current.catalogId;
            const targetName = data.name ?? current.name;
            const targetCode = data.code !== undefined ? data.code : current.code;

            if (data.name && data.name !== current.name) {
                const nameDup = workTypesList.find(
                    (wt) => wt.id !== current.id && wt.catalogId === targetCatalogId && wt.name.toLowerCase() === targetName.toLowerCase(),
                );
                if (nameDup) {
                    const err = new Error("Unique constraint failed on the fields: (`catalogId`,`name`)");
                    (err as any).code = "P2002";
                    (err as any).meta = { target: ["catalogId", "name"] };
                    throw err;
                }
            }

            if (targetCode && targetCode !== current.code) {
                const codeDup = workTypesList.find(
                    (wt) => wt.id !== current.id && wt.workspaceId === current.workspaceId && wt.code === targetCode,
                );
                if (codeDup) {
                    const err = new Error("Unique constraint failed on the fields: (`workspaceId`,`code`)");
                    (err as any).code = "P2002";
                    (err as any).meta = { target: ["workspaceId", "code"] };
                    throw err;
                }
            }

            const updated: WorkType = {
                ...current,
                ...(data.catalogId !== undefined && { catalogId: data.catalogId }),
                ...(data.name !== undefined && { name: data.name }),
                ...(data.code !== undefined && { code: data.code }),
                ...(data.description !== undefined && { description: data.description }),
                ...(data.estimatedDuration !== undefined && { estimatedDuration: data.estimatedDuration }),
                ...(data.status !== undefined && { status: data.status }),
                ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
                updatedAt: new Date(),
            };
            workTypesList[idx] = updated;

            const parentCatalog = catalogsList.find((c) => c.id === updated.catalogId);

            return {
                ...updated,
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

        registerWorkspace(WS_ID, "Apex Operations", "apex-ops");
        registerWorkspace(WS_ID_2, "Beta Services", "beta-services");

        registerUser("user_admin", "Admin User");
        registerMember("user_admin", WS_ID, "ADMIN");

        catalogsList.push({
            id: "sc_hvac",
            workspaceId: WS_ID,
            name: "Residential HVAC",
            description: null,
            status: "ACTIVE",
            sortOrder: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
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

    describe("1. GET /api/work-types", () => {
        it("returns 400 when workspace header is missing", async () => {
            loginAs("user_admin");
            const req = createRequest("GET", "http://localhost/api/work-types");
            const res = await listWorkTypesHandler(req);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error.code).toBe("MISSING_WORKSPACE");
        });

        it("lists work types with availability calculation and pagination", async () => {
            loginAs("user_admin");
            workTypesList.push({
                id: "wt_1",
                workspaceId: WS_ID,
                catalogId: "sc_hvac",
                name: "AC Inspection",
                code: "AC-01",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const req = createRequest("GET", "http://localhost/api/work-types", undefined, {
                "x-workspace-id": WS_ID,
            });
            const res = await listWorkTypesHandler(req);
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.success).toBe(true);
            expect(body.data.items.length).toBe(1);
            expect(body.data.items[0].isAvailableForWorkOrder).toBe(true);
        });
    });

    describe("2. POST /api/work-types", () => {
        it("creates work type returning 201 with operational read model", async () => {
            loginAs("user_admin");
            const req = createRequest(
                "POST",
                "http://localhost/api/work-types",
                {
                    catalogId: "sc_hvac",
                    name: "Emergency Furnace Inspection",
                    code: "furn-em",
                    estimatedDuration: 90,
                },
                { "x-workspace-id": WS_ID },
            );
            const res = await createWorkTypeHandler(req);
            expect(res.status).toBe(201);
            const body = await res.json();
            expect(body.success).toBe(true);
            expect(body.data.name).toBe("Emergency Furnace Inspection");
            expect(body.data.code).toBe("FURN-EM"); // normalized uppercase
            expect(body.data.isAvailableForWorkOrder).toBe(true);
        });

        it("returns 409 on duplicate code in workspace", async () => {
            loginAs("user_admin");
            workTypesList.push({
                id: "wt_1",
                workspaceId: WS_ID,
                catalogId: "sc_hvac",
                name: "AC 1",
                code: "CODE-1",
                description: null,
                estimatedDuration: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const req = createRequest(
                "POST",
                "http://localhost/api/work-types",
                {
                    catalogId: "sc_hvac",
                    name: "AC 2",
                    code: "CODE-1",
                },
                { "x-workspace-id": WS_ID },
            );
            const res = await createWorkTypeHandler(req);
            expect(res.status).toBe(409);
            const body = await res.json();
            expect(body.error.code).toBe("DUPLICATE_WORK_TYPE_CODE");
        });
    });

    describe("3. GET /api/work-types/[workTypeId]", () => {
        it("retrieves operational read model of single work type returning 200", async () => {
            loginAs("user_admin");
            workTypesList.push({
                id: "wt_1",
                workspaceId: WS_ID,
                catalogId: "sc_hvac",
                name: "AC Inspection",
                code: "AC-01",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const req = createRequest("GET", "http://localhost/api/work-types/wt_1", undefined, {
                "x-workspace-id": WS_ID,
            });
            const res = await getWorkTypeHandler(req, { params: Promise.resolve({ workTypeId: "wt_1" }) });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data.name).toBe("AC Inspection");
            expect(body.data.catalogName).toBe("Residential HVAC");
            expect(body.data.isAvailableForWorkOrder).toBe(true);
        });

        it("returns 404 for non-existent workTypeId", async () => {
            loginAs("user_admin");
            const req = createRequest("GET", "http://localhost/api/work-types/wt_ghost", undefined, {
                "x-workspace-id": WS_ID,
            });
            const res = await getWorkTypeHandler(req, { params: Promise.resolve({ workTypeId: "wt_ghost" }) });
            expect(res.status).toBe(404);
            const body = await res.json();
            expect(body.error.code).toBe("WORK_TYPE_NOT_FOUND");
        });
    });

    describe("4. PATCH /api/work-types/[workTypeId]", () => {
        it("updates work type fields returning 200", async () => {
            loginAs("user_admin");
            workTypesList.push({
                id: "wt_1",
                workspaceId: WS_ID,
                catalogId: "sc_hvac",
                name: "AC Inspection",
                code: "AC-01",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const req = createRequest(
                "PATCH",
                "http://localhost/api/work-types/wt_1",
                { name: "Comprehensive AC Inspection", estimatedDuration: 90 },
                { "x-workspace-id": WS_ID },
            );
            const res = await updateWorkTypeHandler(req, { params: Promise.resolve({ workTypeId: "wt_1" }) });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data.name).toBe("Comprehensive AC Inspection");
            expect(body.data.estimatedDuration).toBe(90);
        });
    });

    describe("5. DELETE /api/work-types/[workTypeId]", () => {
        it("rejects deletion of ACTIVE work type with 409", async () => {
            loginAs("user_admin");
            workTypesList.push({
                id: "wt_active",
                workspaceId: WS_ID,
                catalogId: "sc_hvac",
                name: "Active Work",
                code: null,
                description: null,
                estimatedDuration: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const req = createRequest("DELETE", "http://localhost/api/work-types/wt_active", undefined, {
                "x-workspace-id": WS_ID,
            });
            const res = await deleteWorkTypeHandler(req, { params: Promise.resolve({ workTypeId: "wt_active" }) });
            expect(res.status).toBe(409);
            const body = await res.json();
            expect(body.error.code).toBe("WORK_TYPE_DELETION_NOT_ALLOWED");
        });

        it("deletes INACTIVE work type returning 200", async () => {
            loginAs("user_admin");
            workTypesList.push({
                id: "wt_inactive",
                workspaceId: WS_ID,
                catalogId: "sc_hvac",
                name: "Inactive Work",
                code: null,
                description: null,
                estimatedDuration: null,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const req = createRequest("DELETE", "http://localhost/api/work-types/wt_inactive", undefined, {
                "x-workspace-id": WS_ID,
            });
            const res = await deleteWorkTypeHandler(req, { params: Promise.resolve({ workTypeId: "wt_inactive" }) });
            expect(res.status).toBe(200);
            expect(workTypesList.length).toBe(0);
        });
    });

    describe("6. PATCH /api/work-types/[workTypeId]/status", () => {
        it("updates work type status returning 200", async () => {
            loginAs("user_admin");
            workTypesList.push({
                id: "wt_1",
                workspaceId: WS_ID,
                catalogId: "sc_hvac",
                name: "AC Inspection",
                code: null,
                description: null,
                estimatedDuration: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const req = createRequest(
                "PATCH",
                "http://localhost/api/work-types/wt_1/status",
                { status: "INACTIVE" },
                { "x-workspace-id": WS_ID },
            );
            const res = await updateWorkTypeStatusHandler(req, { params: Promise.resolve({ workTypeId: "wt_1" }) });
            expect(res.status).toBe(200);
            const body = await res.json();
            expect(body.data.status).toBe("INACTIVE");
            expect(body.data.isAvailableForWorkOrder).toBe(false);
        });
    });
});
