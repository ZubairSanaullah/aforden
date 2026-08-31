import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    serviceCatalogFindFirst: vi.fn(),
    workTypeFindFirst: vi.fn(),
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
        },
    },
}));

import { getWorkTypeForWorkOrderConsumption } from "@/lib/services/workType/getWorkTypeForWorkOrderConsumption";
import {
    WorkTypeNotFoundError,
    WorkTypeUnavailableForWorkOrderError,
} from "@/lib/services/workType/workTypeErrors";
import type { ServiceCatalog, User, Workspace, WorkspaceMember, WorkType } from "@/generated/prisma/client";

describe("Phase 1.5.11 — WorkOrder Consumption Contract & Boundary Hardening", () => {
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

        registerWorkspace(WS_ALPHA, "Alpha Operations", "alpha-ops");
        registerWorkspace(WS_BETA, "Beta Operations", "beta-ops");

        registerUser("user_admin", "Admin User");
        registerMember("user_admin", WS_ALPHA, "ADMIN");
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

    describe("1. Resolution & Field Preservation", () => {
        it("resolves valid available WorkType and returns operational consumption model", async () => {
            catalogsList.push({
                id: "sc_hvac",
                workspaceId: WS_ALPHA,
                name: "Residential HVAC",
                description: "HVAC Catalog",
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            workTypesList.push({
                id: "wt_install",
                workspaceId: WS_ALPHA,
                catalogId: "sc_hvac",
                name: "AC Installation",
                code: "HVAC-AC-01",
                description: "Full unit installation",
                estimatedDuration: 180,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await getWorkTypeForWorkOrderConsumption(WS_ALPHA, "wt_install");

            expect(result).toEqual({
                workTypeId: "wt_install",
                workspaceId: WS_ALPHA,
                catalogId: "sc_hvac",
                name: "AC Installation",
                code: "HVAC-AC-01",
                estimatedDuration: 180,
                isAvailableForWorkOrder: true,
            });
        });

        it("preserves null values for code and estimatedDuration", async () => {
            catalogsList.push({
                id: "sc_plumb",
                workspaceId: WS_ALPHA,
                name: "Plumbing",
                description: null,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            workTypesList.push({
                id: "wt_inspect",
                workspaceId: WS_ALPHA,
                catalogId: "sc_plumb",
                name: "General Inspection",
                code: null,
                description: null,
                estimatedDuration: null,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await getWorkTypeForWorkOrderConsumption(WS_ALPHA, "wt_inspect");

            expect(result.code).toBeNull();
            expect(result.estimatedDuration).toBeNull();
            expect(result.isAvailableForWorkOrder).toBe(true);
        });
    });

    describe("2. Dynamic Availability Matrix Enforcement", () => {
        it("Scenario A: ACTIVE WorkType + ACTIVE Catalog -> Success (Available)", async () => {
            catalogsList.push({
                id: "sc_act",
                workspaceId: WS_ALPHA,
                name: "Active Cat",
                description: null,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            workTypesList.push({
                id: "wt_act",
                workspaceId: WS_ALPHA,
                catalogId: "sc_act",
                name: "Active Work",
                code: "ACT-01",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const res = await getWorkTypeForWorkOrderConsumption(WS_ALPHA, "wt_act");
            expect(res.isAvailableForWorkOrder).toBe(true);
        });

        it("Scenario B: ACTIVE WorkType + INACTIVE Catalog -> Rejects with WorkTypeUnavailableForWorkOrderError", async () => {
            catalogsList.push({
                id: "sc_inact",
                workspaceId: WS_ALPHA,
                name: "Inactive Cat",
                description: null,
                status: "INACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            workTypesList.push({
                id: "wt_act_under_inact",
                workspaceId: WS_ALPHA,
                catalogId: "sc_inact",
                name: "Active Work under Inactive Cat",
                code: "AI-01",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await expect(
                getWorkTypeForWorkOrderConsumption(WS_ALPHA, "wt_act_under_inact"),
            ).rejects.toThrow(WorkTypeUnavailableForWorkOrderError);
        });

        it("Scenario C: INACTIVE WorkType + ACTIVE Catalog -> Rejects with WorkTypeUnavailableForWorkOrderError", async () => {
            catalogsList.push({
                id: "sc_act_2",
                workspaceId: WS_ALPHA,
                name: "Active Cat 2",
                description: null,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            workTypesList.push({
                id: "wt_inact_under_act",
                workspaceId: WS_ALPHA,
                catalogId: "sc_act_2",
                name: "Inactive Work",
                code: "IA-01",
                description: null,
                estimatedDuration: 60,
                status: "INACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await expect(
                getWorkTypeForWorkOrderConsumption(WS_ALPHA, "wt_inact_under_act"),
            ).rejects.toThrow(WorkTypeUnavailableForWorkOrderError);
        });

        it("Scenario D: INACTIVE WorkType + INACTIVE Catalog -> Rejects with WorkTypeUnavailableForWorkOrderError", async () => {
            catalogsList.push({
                id: "sc_inact_2",
                workspaceId: WS_ALPHA,
                name: "Inactive Cat 2",
                description: null,
                status: "INACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            workTypesList.push({
                id: "wt_inact_under_inact",
                workspaceId: WS_ALPHA,
                catalogId: "sc_inact_2",
                name: "Inactive Work 2",
                code: "II-01",
                description: null,
                estimatedDuration: 60,
                status: "INACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await expect(
                getWorkTypeForWorkOrderConsumption(WS_ALPHA, "wt_inact_under_inact"),
            ).rejects.toThrow(WorkTypeUnavailableForWorkOrderError);
        });
    });

    describe("3. Tenant Isolation & IDOR Protection", () => {
        it("throws WorkTypeNotFoundError when attempting to consume cross-tenant WorkType", async () => {
            catalogsList.push({
                id: "sc_beta",
                workspaceId: WS_BETA,
                name: "Beta Catalog",
                description: null,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });
            workTypesList.push({
                id: "wt_beta_work",
                workspaceId: WS_BETA,
                catalogId: "sc_beta",
                name: "Beta Work Type",
                code: "BW-01",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            // Alpha workspace attempts to consume Beta WorkType
            await expect(
                getWorkTypeForWorkOrderConsumption(WS_ALPHA, "wt_beta_work"),
            ).rejects.toThrow(WorkTypeNotFoundError);
        });

        it("throws WorkTypeNotFoundError for nonexistent WorkType ID", async () => {
            await expect(
                getWorkTypeForWorkOrderConsumption(WS_ALPHA, "wt_nonexistent"),
            ).rejects.toThrow(WorkTypeNotFoundError);
        });
    });

    describe("4. Historical Immutability & Non-Mutation Guarantees", () => {
        it("verifies consumption invocation does not mutate WorkType or ServiceCatalog", async () => {
            catalogsList.push({
                id: "sc_immut",
                workspaceId: WS_ALPHA,
                name: "Immutable Catalog",
                description: "Test",
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date("2026-08-01"),
                updatedAt: new Date("2026-08-01"),
            });
            workTypesList.push({
                id: "wt_immut",
                workspaceId: WS_ALPHA,
                catalogId: "sc_immut",
                name: "Immutable Work",
                code: "IMM-01",
                description: "Test",
                estimatedDuration: 90,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date("2026-08-01"),
                updatedAt: new Date("2026-08-01"),
            });

            const initialCatalog = { ...catalogsList[0] };
            const initialWorkType = { ...workTypesList[0] };

            await getWorkTypeForWorkOrderConsumption(WS_ALPHA, "wt_immut");

            expect(catalogsList[0]).toEqual(initialCatalog);
            expect(workTypesList[0]).toEqual(initialWorkType);
        });
    });
});
