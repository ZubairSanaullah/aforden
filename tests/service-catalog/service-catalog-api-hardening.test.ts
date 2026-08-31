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
    GET as getWorkTypeHandler,
    PATCH as updateWorkTypeHandler,
    DELETE as deleteWorkTypeHandler,
} from "@/app/api/work-types/[workTypeId]/route";
import { POST as createWorkTypeHandler } from "@/app/api/work-types/route";
import type { ServiceCatalog, User, Workspace, WorkspaceMember, WorkType } from "@/generated/prisma/client";

describe("Phase 1.5.6 — Service Catalog & Work Type API Hardening Suite", () => {
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

        mocks.serviceCatalogCreate.mockImplementation(async ({ data }: any) => {
            const created: ServiceCatalog = {
                id: `sc_${Date.now()}`,
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

        registerWorkspace(WS_ALPHA, "Alpha Workspace", "alpha");
        registerWorkspace(WS_BETA, "Beta Workspace", "beta");

        registerUser("user_alpha", "Alpha Admin");
        registerMember("user_alpha", WS_ALPHA, "ADMIN");

        registerUser("user_alpha_mgr", "Alpha Manager");
        registerMember("user_alpha_mgr", WS_ALPHA, "MANAGER");

        registerUser("user_alpha_tech", "Alpha Tech");
        registerMember("user_alpha_tech", WS_ALPHA, "TECHNICIAN");

        registerUser("user_beta", "Beta Admin");
        registerMember("user_beta", WS_BETA, "ADMIN");

        catalogsList.push(
            {
                id: "sc_alpha",
                workspaceId: WS_ALPHA,
                name: "Alpha HVAC",
                description: null,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            {
                id: "sc_beta",
                workspaceId: WS_BETA,
                name: "Beta HVAC",
                description: null,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        );

        workTypesList.push(
            {
                id: "wt_alpha",
                workspaceId: WS_ALPHA,
                catalogId: "sc_alpha",
                name: "Alpha AC Tune",
                code: "AC-A",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            {
                id: "wt_beta",
                workspaceId: WS_BETA,
                catalogId: "sc_beta",
                name: "Beta AC Tune",
                code: "AC-B",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 0,
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
        platformRole: null,
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

    describe("1. IDOR & Cross-Tenant Boundary Tests", () => {
        it("returns 404 for cross-tenant catalog GET without leaking resource existence", async () => {
            loginAs("user_alpha");

            const req = createRequest("GET", "http://localhost/api/service-catalogs/sc_beta", undefined, {
                "x-workspace-id": WS_ALPHA,
            });
            const res = await getCatalogHandler(req, { params: Promise.resolve({ catalogId: "sc_beta" }) });
            expect(res.status).toBe(404);
            const data = await res.json();
            expect(data.error.code).toBe("SERVICE_CATALOG_NOT_FOUND");
        });

        it("returns 404 for cross-tenant work type GET", async () => {
            loginAs("user_alpha");

            const req = createRequest("GET", "http://localhost/api/work-types/wt_beta", undefined, {
                "x-workspace-id": WS_ALPHA,
            });
            const res = await getWorkTypeHandler(req, { params: Promise.resolve({ workTypeId: "wt_beta" }) });
            expect(res.status).toBe(404);
            const data = await res.json();
            expect(data.error.code).toBe("WORK_TYPE_NOT_FOUND");
        });

        it("blocks creating a work type attached to a cross-tenant catalogId with 404", async () => {
            loginAs("user_alpha");

            const req = createRequest(
                "POST",
                "http://localhost/api/work-types",
                {
                    catalogId: "sc_beta", // Belongs to WS_BETA
                    name: "Malicious Attachment",
                },
                { "x-workspace-id": WS_ALPHA },
            );
            const res = await createWorkTypeHandler(req);
            expect(res.status).toBe(404);
            const data = await res.json();
            expect(data.error.code).toBe("SERVICE_CATALOG_NOT_FOUND");
        });
    });

    describe("2. Mass Assignment Defense", () => {
        it("strips client-injected workspaceId during catalog create", async () => {
            loginAs("user_alpha");

            const req = createRequest(
                "POST",
                "http://localhost/api/service-catalogs",
                {
                    name: "Secure Alpha Catalog",
                    workspaceId: WS_BETA,
                },
                { "x-workspace-id": WS_ALPHA },
            );
            const res = await createCatalogHandler(req);
            expect(res.status).toBe(201);
            const data = await res.json();
            expect(data.data.workspaceId).toBe(WS_ALPHA);
        });

        it("strips client-injected status during catalog update", async () => {
            loginAs("user_alpha");

            mocks.serviceCatalogUpdate.mockImplementation(async ({ where, data }: any) => {
                const current = catalogsList.find((c) => c.id === where.id)!;
                return {
                    ...current,
                    ...data,
                    _count: { workTypes: 0 },
                    workTypes: [],
                };
            });

            const req = createRequest(
                "PATCH",
                "http://localhost/api/service-catalogs/sc_alpha",
                {
                    name: "Renamed Alpha",
                    status: "INACTIVE",
                },
                { "x-workspace-id": WS_ALPHA },
            );
            const res = await updateCatalogHandler(req, { params: Promise.resolve({ catalogId: "sc_alpha" }) });
            expect(res.status).toBe(200);
            const data = await res.json();
            expect(data.data.name).toBe("Renamed Alpha");
            expect(data.data.status).toBe("ACTIVE");
        });
    });

    describe("3. Transport and Authorization Hardening", () => {
        it("returns 400 on malformed JSON body", async () => {
            loginAs("user_alpha");

            const req = createRequest(
                "POST",
                "http://localhost/api/service-catalogs",
                "{ invalid_json: ",
                { "x-workspace-id": WS_ALPHA },
            );
            const res = await createCatalogHandler(req);
            expect(res.status).toBe(400);
            const data = await res.json();
            expect(data.error.code).toBe("INVALID_REQUEST");
        });

        it("returns 401 when request is unauthenticated", async () => {
            mocks.auth.mockResolvedValue(null);

            const req = createRequest("GET", "http://localhost/api/service-catalogs", undefined, {
                "x-workspace-id": WS_ALPHA,
            });
            const res = await listCatalogsHandler(req);
            expect(res.status).toBe(401);
        });

        it("returns 403 when role lacks permission (TECHNICIAN creating catalog)", async () => {
            loginAs("user_alpha_tech");

            const req = createRequest(
                "POST",
                "http://localhost/api/service-catalogs",
                { name: "Unauthorized Catalog" },
                { "x-workspace-id": WS_ALPHA },
            );
            const res = await createCatalogHandler(req);
            expect(res.status).toBe(403);
        });

        it("returns 403 when MANAGER attempts to delete catalog", async () => {
            loginAs("user_alpha_mgr");

            const req = createRequest("DELETE", "http://localhost/api/service-catalogs/sc_alpha", undefined, {
                "x-workspace-id": WS_ALPHA,
            });
            const res = await deleteCatalogHandler(req, { params: Promise.resolve({ catalogId: "sc_alpha" }) });
            expect(res.status).toBe(403);
        });
    });
});
