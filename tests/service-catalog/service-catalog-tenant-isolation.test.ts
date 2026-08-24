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
import { PATCH as updateCatalogStatusHandler } from "@/app/api/service-catalogs/[catalogId]/status/route";
import {
    GET as listCatalogWorkTypesHandler,
    POST as createCatalogWorkTypeHandler,
} from "@/app/api/service-catalogs/[catalogId]/work-types/route";
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

describe("Phase 1.5.7 — Service Catalog & Work Type Multi-Tenant Isolation", () => {
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

        mocks.serviceCatalogFindMany.mockImplementation(async ({ where, skip = 0, take = 20 }: any) => {
            let matched = catalogsList.filter((c) => {
                if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
                return true;
            });
            return matched.slice(skip, skip + take).map((c) => ({
                ...c,
                _count: { workTypes: 0 },
                workTypes: [],
            }));
        });

        mocks.serviceCatalogCount.mockImplementation(async ({ where }: any) => {
            return catalogsList.filter((c) => {
                if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
                return true;
            }).length;
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

        mocks.workTypeFindMany.mockImplementation(async ({ where, skip = 0, take = 20 }: any) => {
            let matched = workTypesList.filter((wt) => {
                if (where.workspaceId && wt.workspaceId !== where.workspaceId) return false;
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
                return true;
            }).length;
        });

        registerWorkspace(WS_ALPHA, "Alpha Workspace", "alpha");
        registerWorkspace(WS_BETA, "Beta Workspace", "beta");

        registerUser("user_alpha", "Alpha Admin");
        registerMember("user_alpha", WS_ALPHA, "ADMIN");

        registerUser("user_beta", "Beta Admin");
        registerMember("user_beta", WS_BETA, "ADMIN");

        catalogsList.push(
            {
                id: "sc_alpha_1",
                workspaceId: WS_ALPHA,
                name: "Alpha HVAC",
                description: null,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            {
                id: "sc_beta_1",
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
                id: "wt_alpha_1",
                workspaceId: WS_ALPHA,
                catalogId: "sc_alpha_1",
                name: "Alpha Diagnostic",
                code: "DIAG-A",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            {
                id: "wt_beta_1",
                workspaceId: WS_BETA,
                catalogId: "sc_beta_1",
                name: "Beta Diagnostic",
                code: "DIAG-B",
                description: null,
                estimatedDuration: 60,
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

    describe("1. Catalog Isolation", () => {
        it("Workspace A cannot access, update, delete, or change status of Workspace B catalog", async () => {
            loginAs("user_alpha");

            // GET
            const getReq = createRequest("GET", "http://localhost/api/service-catalogs/sc_beta_1", undefined, {
                "x-workspace-id": WS_ALPHA,
            });
            const getRes = await getCatalogHandler(getReq, { params: Promise.resolve({ catalogId: "sc_beta_1" }) });
            expect(getRes.status).toBe(404);

            // PATCH
            const patchReq = createRequest(
                "PATCH",
                "http://localhost/api/service-catalogs/sc_beta_1",
                { name: "Hacked" },
                { "x-workspace-id": WS_ALPHA },
            );
            const patchRes = await updateCatalogHandler(patchReq, { params: Promise.resolve({ catalogId: "sc_beta_1" }) });
            expect(patchRes.status).toBe(404);

            // DELETE
            const delReq = createRequest("DELETE", "http://localhost/api/service-catalogs/sc_beta_1", undefined, {
                "x-workspace-id": WS_ALPHA,
            });
            const delRes = await deleteCatalogHandler(delReq, { params: Promise.resolve({ catalogId: "sc_beta_1" }) });
            expect(delRes.status).toBe(404);

            // STATUS
            const statusReq = createRequest(
                "PATCH",
                "http://localhost/api/service-catalogs/sc_beta_1/status",
                { status: "INACTIVE" },
                { "x-workspace-id": WS_ALPHA },
            );
            const statusRes = await updateCatalogStatusHandler(statusReq, { params: Promise.resolve({ catalogId: "sc_beta_1" }) });
            expect(statusRes.status).toBe(404);
        });
    });

    describe("2. WorkType Cross-Tenant Reparenting Attack", () => {
        it("blocks Workspace A user from reparenting Workspace A work type to Workspace B catalog", async () => {
            loginAs("user_alpha");

            const req = createRequest(
                "PATCH",
                "http://localhost/api/work-types/wt_alpha_1",
                { catalogId: "sc_beta_1" }, // Belongs to WS_BETA
                { "x-workspace-id": WS_ALPHA },
            );
            const res = await updateWorkTypeHandler(req, { params: Promise.resolve({ workTypeId: "wt_alpha_1" }) });
            expect(res.status).toBe(404);
            const body = await res.json();
            expect(body.error.code).toBe("SERVICE_CATALOG_NOT_FOUND");
        });
    });
});
