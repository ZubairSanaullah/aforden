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
            update: mocks.workTypeUpdate,
            delete: mocks.workTypeDelete,
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
import {
    GET as listWorkTypesHandler,
    POST as createWorkTypeHandler,
} from "@/app/api/work-types/route";
import {
    GET as getWorkTypeHandler,
    PATCH as updateWorkTypeHandler,
    DELETE as deleteWorkTypeHandler,
} from "@/app/api/work-types/[workTypeId]/route";
import type { ServiceCatalog, User, Workspace, WorkspaceMember, WorkType } from "@/generated/prisma/client";

describe("Phase 1.5.7 — RBAC Matrix Integration Across All API Endpoints", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let catalogsList: ServiceCatalog[];
    let workTypesList: WorkType[];

    const WS_ID = "ws_apex_100";

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
            return null;
        });

        mocks.serviceCatalogFindFirst.mockImplementation(async ({ where, include }: any) => {
            const found = catalogsList.find((c) => {
                if (where.id && c.id !== where.id) return false;
                if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
                return true;
            });
            if (!found) return null;

            return {
                ...found,
                _count: { workTypes: 0 },
                workTypes: [],
            };
        });

        mocks.serviceCatalogFindMany.mockImplementation(async () =>
            catalogsList.map((c) => ({
                ...c,
                _count: { workTypes: 0 },
                workTypes: [],
            })),
        );
        mocks.serviceCatalogCount.mockImplementation(async () => catalogsList.length);

        mocks.serviceCatalogCreate.mockImplementation(async ({ data }: any) => ({
            id: "sc_created",
            workspaceId: data.workspaceId,
            name: data.name,
            description: null,
            status: "ACTIVE",
            sortOrder: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
        }));

        mocks.serviceCatalogUpdate.mockImplementation(async ({ data }: any) => ({
            ...catalogsList[0],
            ...data,
            _count: { workTypes: 0 },
            workTypes: [],
        }));

        mocks.serviceCatalogDelete.mockImplementation(async () => catalogsList[0]);

        mocks.workTypeFindFirst.mockImplementation(async ({ where, include }: any) => {
            const found = workTypesList.find((wt) => {
                if (where.id && wt.id !== where.id) return false;
                if (where.workspaceId && wt.workspaceId !== where.workspaceId) return false;
                return true;
            });
            if (!found) return null;

            return {
                ...found,
                catalog: include?.catalog ? catalogsList[0] : undefined,
            };
        });

        mocks.workTypeFindMany.mockImplementation(async () => workTypesList.map((wt) => ({ ...wt, catalog: catalogsList[0] })));
        mocks.workTypeCount.mockImplementation(async () => workTypesList.length);

        mocks.workTypeCreate.mockImplementation(async ({ data, include }: any) => ({
            id: "wt_created",
            workspaceId: data.workspaceId,
            catalogId: data.catalogId,
            name: data.name,
            code: null,
            description: null,
            estimatedDuration: null,
            status: "ACTIVE",
            sortOrder: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
            catalog: include?.catalog ? catalogsList[0] : undefined,
        }));

        mocks.workTypeUpdate.mockImplementation(async ({ data, include }: any) => ({
            ...workTypesList[0],
            ...data,
            catalog: include?.catalog ? catalogsList[0] : undefined,
        }));

        mocks.workTypeDelete.mockImplementation(async () => workTypesList[0]);

        registerWorkspace(WS_ID, "Apex Operations", "apex-ops");

        catalogsList.push({
            id: "sc_sample",
            workspaceId: WS_ID,
            name: "Sample Catalog",
            description: null,
            status: "INACTIVE",
            sortOrder: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        workTypesList.push({
            id: "wt_sample",
            workspaceId: WS_ID,
            catalogId: "sc_sample",
            name: "Sample Work",
            code: null,
            description: null,
            estimatedDuration: null,
            status: "INACTIVE",
            sortOrder: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
        });
    });

    function registerUser(userId: string, name: string) {
        const user: User = {
            id: userId,
            name,
            email: `${userId}@example.com`,
            passwordHash: "hashed",
            emailVerified: new Date(),
            avatarUrl: null,
            status: "ACTIVE" as any,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        usersMap.set(userId, user);
        return user;
    }

    function registerWorkspace(id: string, name: string, slug: string) {
        const ws: Workspace = {
            id,
            name,
            slug,
            logoUrl: null,
            timezone: "Asia/Karachi",
        defaultCurrencyCode: "USD",
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        workspacesMap.set(id, ws);
        return ws;
    }

    function registerMember(userId: string, workspaceId: string, role: any) {
        const m: WorkspaceMember = {
            id: `member_${userId}_${workspaceId}`,
            userId,
            workspaceId,
            role,
            status: "ACTIVE" as any,
            createdAt: new Date(),
            updatedAt: new Date(),
        };
        membersMap.set(`${userId}_${workspaceId}`, m);
        return m;
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

    describe("1. MANAGER Role Capabilities & Deletion Boundaries", () => {
        it("allows MANAGER to view, create, and update, but rejects delete with 403", async () => {
            registerUser("user_mgr", "Manager");
            registerMember("user_mgr", WS_ID, "MANAGER");
            loginAs("user_mgr");

            // View catalog -> 200
            const listRes = await listCatalogsHandler(
                createRequest("GET", "http://localhost/api/service-catalogs", undefined, { "x-workspace-id": WS_ID }),
            );
            expect(listRes.status).toBe(200);

            // Create catalog -> 201
            const createRes = await createCatalogHandler(
                createRequest("POST", "http://localhost/api/service-catalogs", { name: "Manager Catalog" }, { "x-workspace-id": WS_ID }),
            );
            expect(createRes.status).toBe(201);

            // Update catalog -> 200
            const updateRes = await updateCatalogHandler(
                createRequest("PATCH", "http://localhost/api/service-catalogs/sc_sample", { name: "Updated by Manager" }, { "x-workspace-id": WS_ID }),
                { params: Promise.resolve({ catalogId: "sc_sample" }) },
            );
            expect(updateRes.status).toBe(200);

            // Delete catalog -> 403 (DENIED)
            const deleteRes = await deleteCatalogHandler(
                createRequest("DELETE", "http://localhost/api/service-catalogs/sc_sample", undefined, { "x-workspace-id": WS_ID }),
                { params: Promise.resolve({ catalogId: "sc_sample" }) },
            );
            expect(deleteRes.status).toBe(403);

            // Delete work type -> 403 (DENIED)
            const deleteWtRes = await deleteWorkTypeHandler(
                createRequest("DELETE", "http://localhost/api/work-types/wt_sample", undefined, { "x-workspace-id": WS_ID }),
                { params: Promise.resolve({ workTypeId: "wt_sample" }) },
            );
            expect(deleteWtRes.status).toBe(403);
        });
    });

    describe("2. Read-Only Roles (DISPATCHER, TECHNICIAN, ACCOUNTANT)", () => {
        it("allows viewing but blocks all mutations with 403 for DISPATCHER, TECHNICIAN, ACCOUNTANT", async () => {
            for (const role of ["DISPATCHER", "TECHNICIAN", "ACCOUNTANT"] as const) {
                const userId = `user_${role.toLowerCase()}`;
                registerUser(userId, role);
                registerMember(userId, WS_ID, role);
                loginAs(userId);

                // View catalogs -> 200
                const catViewRes = await listCatalogsHandler(
                    createRequest("GET", "http://localhost/api/service-catalogs", undefined, { "x-workspace-id": WS_ID }),
                );
                expect(catViewRes.status).toBe(200);

                // View work types -> 200
                const wtViewRes = await listWorkTypesHandler(
                    createRequest("GET", "http://localhost/api/work-types", undefined, { "x-workspace-id": WS_ID }),
                );
                expect(wtViewRes.status).toBe(200);

                // Create catalog -> 403
                const catCreateRes = await createCatalogHandler(
                    createRequest("POST", "http://localhost/api/service-catalogs", { name: "Illegal Cat" }, { "x-workspace-id": WS_ID }),
                );
                expect(catCreateRes.status).toBe(403);

                // Create work type -> 403
                const wtCreateRes = await createWorkTypeHandler(
                    createRequest("POST", "http://localhost/api/work-types", { catalogId: "sc_sample", name: "Illegal WT" }, { "x-workspace-id": WS_ID }),
                );
                expect(wtCreateRes.status).toBe(403);
            }
        });
    });
});
