import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    serviceCatalogFindFirst: vi.fn(),
    serviceCatalogCreate: vi.fn(),
    serviceCatalogUpdate: vi.fn(),
    serviceCatalogDelete: vi.fn(),
    workTypeFindFirst: vi.fn(),
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
            create: mocks.serviceCatalogCreate,
            update: mocks.serviceCatalogUpdate,
            delete: mocks.serviceCatalogDelete,
        },
        workType: {
            findFirst: mocks.workTypeFindFirst,
            create: mocks.workTypeCreate,
            update: mocks.workTypeUpdate,
            delete: mocks.workTypeDelete,
        },
    },
}));

import {
    GET as getCatalogHandler,
    DELETE as deleteCatalogHandler,
} from "@/app/api/service-catalogs/[catalogId]/route";
import { PATCH as updateCatalogStatusHandler } from "@/app/api/service-catalogs/[catalogId]/status/route";
import {
    GET as getWorkTypeHandler,
    PATCH as updateWorkTypeHandler,
    DELETE as deleteWorkTypeHandler,
} from "@/app/api/work-types/[workTypeId]/route";
import { PATCH as updateWorkTypeStatusHandler } from "@/app/api/work-types/[workTypeId]/status/route";
import type { ServiceCatalog, User, Workspace, WorkspaceMember, WorkType } from "@/generated/prisma/client";

describe("Phase 1.5.7 — Service Catalog & Work Type Lifecycle Integration Suite", () => {
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

            const attachedWorkTypes = workTypesList.filter((wt) => wt.catalogId === found.id);
            const activeWorkTypes = attachedWorkTypes.filter((wt) => wt.status === "ACTIVE");

            return {
                ...found,
                _count: { workTypes: attachedWorkTypes.length },
                workTypes: include?.workTypes ? activeWorkTypes.map((wt) => ({ id: wt.id })) : [],
            };
        });

        mocks.serviceCatalogUpdate.mockImplementation(async ({ where, data }: any) => {
            const idx = catalogsList.findIndex((c) => c.id === where.id);
            if (idx === -1) throw new Error("Catalog not found");

            catalogsList[idx] = {
                ...catalogsList[idx],
                ...data,
                updatedAt: new Date(),
            };

            const attachedWorkTypes = workTypesList.filter((wt) => wt.catalogId === catalogsList[idx].id);
            const activeWorkTypes = attachedWorkTypes.filter((wt) => wt.status === "ACTIVE");

            return {
                ...catalogsList[idx],
                _count: { workTypes: attachedWorkTypes.length },
                workTypes: activeWorkTypes.map((wt) => ({ id: wt.id })),
            };
        });

        mocks.serviceCatalogDelete.mockImplementation(async ({ where }: any) => {
            const idx = catalogsList.findIndex((c) => c.id === where.id);
            return catalogsList.splice(idx, 1)[0];
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

        mocks.workTypeUpdate.mockImplementation(async ({ where, data, include }: any) => {
            const idx = workTypesList.findIndex((wt) => wt.id === where.id);
            if (idx === -1) throw new Error("WorkType not found");

            workTypesList[idx] = {
                ...workTypesList[idx],
                ...data,
                updatedAt: new Date(),
            };

            const parentCatalog = catalogsList.find((c) => c.id === workTypesList[idx].catalogId);

            return {
                ...workTypesList[idx],
                catalog: include?.catalog ? parentCatalog : undefined,
            };
        });

        mocks.workTypeDelete.mockImplementation(async ({ where }: any) => {
            const idx = workTypesList.findIndex((wt) => wt.id === where.id);
            return workTypesList.splice(idx, 1)[0];
        });

        registerWorkspace(WS_ID, "Apex Operations", "apex-ops");
        registerUser("user_admin", "Admin User");
        registerMember("user_admin", WS_ID, "ADMIN");
        loginAs("user_admin");
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

    describe("SCENARIO A: Parent Catalog Deactivation & Reactivation Impact on Child WorkTypes", () => {
        it("deactivates catalog without mutating child workType.status while dynamically updating availability", async () => {
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

            workTypesList.push({
                id: "wt_tune",
                workspaceId: WS_ID,
                catalogId: "sc_hvac",
                name: "AC Seasonal Tune Up",
                code: "AC-TUNE",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            // 1. Initial State: WorkType is available
            const initRes = await getWorkTypeHandler(
                createRequest("GET", "http://localhost/api/work-types/wt_tune", undefined, { "x-workspace-id": WS_ID }),
                { params: Promise.resolve({ workTypeId: "wt_tune" }) },
            );
            const initData = await initRes.json();
            expect(initData.data.status).toBe("ACTIVE");
            expect(initData.data.catalogStatus).toBe("ACTIVE");
            expect(initData.data.isAvailableForWorkOrder).toBe(true);

            // 2. Deactivate Parent Catalog
            const deactRes = await updateCatalogStatusHandler(
                createRequest("PATCH", "http://localhost/api/service-catalogs/sc_hvac/status", { status: "INACTIVE" }, { "x-workspace-id": WS_ID }),
                { params: Promise.resolve({ catalogId: "sc_hvac" }) },
            );
            expect(deactRes.status).toBe(200);

            // 3. Verify Child WorkType status is still ACTIVE in DB, but availability is FALSE
            const checkDeactRes = await getWorkTypeHandler(
                createRequest("GET", "http://localhost/api/work-types/wt_tune", undefined, { "x-workspace-id": WS_ID }),
                { params: Promise.resolve({ workTypeId: "wt_tune" }) },
            );
            const checkDeactData = await checkDeactRes.json();
            expect(checkDeactData.data.status).toBe("ACTIVE"); // DB status unchanged
            expect(checkDeactData.data.catalogStatus).toBe("INACTIVE");
            expect(checkDeactData.data.isAvailableForWorkOrder).toBe(false); // Dynamic availability false

            // 4. Reactivate Parent Catalog
            const reactRes = await updateCatalogStatusHandler(
                createRequest("PATCH", "http://localhost/api/service-catalogs/sc_hvac/status", { status: "ACTIVE" }, { "x-workspace-id": WS_ID }),
                { params: Promise.resolve({ catalogId: "sc_hvac" }) },
            );
            expect(reactRes.status).toBe(200);

            // 5. Verify availability is restored to TRUE
            const checkReactRes = await getWorkTypeHandler(
                createRequest("GET", "http://localhost/api/work-types/wt_tune", undefined, { "x-workspace-id": WS_ID }),
                { params: Promise.resolve({ workTypeId: "wt_tune" }) },
            );
            const checkReactData = await checkReactRes.json();
            expect(checkReactData.data.status).toBe("ACTIVE");
            expect(checkReactData.data.catalogStatus).toBe("ACTIVE");
            expect(checkReactData.data.isAvailableForWorkOrder).toBe(true);
        });
    });

    describe("SCENARIO B: WorkType Status Transition & Parent Immutability", () => {
        it("deactivating work type does not mutate parent catalog status", async () => {
            catalogsList.push({
                id: "sc_plumb",
                workspaceId: WS_ID,
                name: "Plumbing",
                description: null,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            workTypesList.push({
                id: "wt_drain",
                workspaceId: WS_ID,
                catalogId: "sc_plumb",
                name: "Drain Snaking",
                code: "DRAIN-01",
                description: null,
                estimatedDuration: 45,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            // Deactivate work type
            const deactWtRes = await updateWorkTypeStatusHandler(
                createRequest("PATCH", "http://localhost/api/work-types/wt_drain/status", { status: "INACTIVE" }, { "x-workspace-id": WS_ID }),
                { params: Promise.resolve({ workTypeId: "wt_drain" }) },
            );
            expect(deactWtRes.status).toBe(200);
            const deactWtData = await deactWtRes.json();
            expect(deactWtData.data.status).toBe("INACTIVE");
            expect(deactWtData.data.isAvailableForWorkOrder).toBe(false);

            // Verify parent catalog is untouched
            const catRes = await getCatalogHandler(
                createRequest("GET", "http://localhost/api/service-catalogs/sc_plumb", undefined, { "x-workspace-id": WS_ID }),
                { params: Promise.resolve({ catalogId: "sc_plumb" }) },
            );
            const catData = await catRes.json();
            expect(catData.data.status).toBe("ACTIVE");
        });
    });

    describe("SCENARIO C: Reparenting WorkType and Dynamic Availability Tracking", () => {
        it("moving active work type from active catalog to inactive catalog updates availability to false", async () => {
            catalogsList.push(
                {
                    id: "sc_active",
                    workspaceId: WS_ID,
                    name: "Active Trade",
                    description: null,
                    status: "ACTIVE",
                    sortOrder: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "sc_inactive",
                    workspaceId: WS_ID,
                    name: "Inactive Trade",
                    description: null,
                    status: "INACTIVE",
                    sortOrder: 2,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            );

            workTypesList.push({
                id: "wt_move",
                workspaceId: WS_ID,
                catalogId: "sc_active",
                name: "Movable Service",
                code: "MOVE-01",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            // Move to inactive catalog
            const moveRes = await updateWorkTypeHandler(
                createRequest("PATCH", "http://localhost/api/work-types/wt_move", { catalogId: "sc_inactive" }, { "x-workspace-id": WS_ID }),
                { params: Promise.resolve({ workTypeId: "wt_move" }) },
            );
            expect(moveRes.status).toBe(200);
            const moveData = await moveRes.json();
            expect(moveData.data.catalogId).toBe("sc_inactive");
            expect(moveData.data.status).toBe("ACTIVE");
            expect(moveData.data.catalogStatus).toBe("INACTIVE");
            expect(moveData.data.isAvailableForWorkOrder).toBe(false);
        });
    });
});
