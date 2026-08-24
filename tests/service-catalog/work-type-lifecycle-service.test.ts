import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    workTypeFindFirst: vi.fn(),
    workTypeUpdate: vi.fn(),
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
        workType: {
            findFirst: mocks.workTypeFindFirst,
            update: mocks.workTypeUpdate,
        },
    },
}));

import { changeWorkTypeStatus } from "@/lib/services/workType/changeWorkTypeStatus";
import { WorkTypeNotFoundError } from "@/lib/services/workType/workTypeErrors";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type { ServiceCatalog, User, Workspace, WorkspaceMember, WorkType } from "@/generated/prisma/client";

describe("Phase 1.5.5 — WorkType Lifecycle Service Layer", () => {
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

        mocks.workTypeFindFirst.mockImplementation(async ({ where }: any) => {
            const found = workTypesList.find((wt) => {
                if (where.id && wt.id !== where.id) return false;
                if (where.workspaceId && wt.workspaceId !== where.workspaceId) return false;
                return true;
            });
            if (!found) return null;

            const parentCatalog = catalogsList.find((c) => c.id === found.catalogId);
            return {
                ...found,
                catalog: parentCatalog,
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
            const updated: WorkType = {
                ...current,
                status: data.status,
                updatedAt: new Date(),
            };
            workTypesList[idx] = updated;

            const parentCatalog = catalogsList.find((c) => c.id === updated.catalogId);

            return {
                ...updated,
                catalog: include?.catalog ? parentCatalog : undefined,
            };
        });

        registerWorkspace(WS_ID, "Apex Operations", "apex-ops");
        registerWorkspace(WS_ID_2, "Beta Services", "beta-services");

        // Seed catalogs
        catalogsList.push(
            {
                id: "sc_hvac",
                workspaceId: WS_ID,
                name: "Residential HVAC",
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
        defaultCurrencyCode: "USD",
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
        status = "ACTIVE",
    ) {
        const member: WorkspaceMember = {
            id: `member_${userId}_${workspaceId}`,
            userId,
            workspaceId,
            role: role as any,
            status: status as any,
            createdAt: new Date("2026-08-19T00:00:00.000Z"),
            updatedAt: new Date("2026-08-19T00:00:00.000Z"),
        };
        membersMap.set(`${userId}_${workspaceId}`, member);
        membersMap.set(member.id, member);
        return member;
    }

    function loginAs(userId: string) {
        mocks.auth.mockResolvedValue({
            user: { id: userId, email: `${userId}@example.com` },
        });
    }

    describe("1. Status Transitions & Availability Calculation", () => {
        it("deactivates an ACTIVE work type to INACTIVE and recalculates isAvailableForWorkOrder to false", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
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
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const res = await changeWorkTypeStatus(WS_ID, "wt_1", { status: "INACTIVE" });

            expect(res.status).toBe("INACTIVE");
            expect(res.isAvailableForWorkOrder).toBe(false);
            // Parent catalog status is not mutated
            expect(catalogsList[0].status).toBe("ACTIVE");
        });

        it("reactivates an INACTIVE work type to ACTIVE and recalculates isAvailableForWorkOrder to true", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            workTypesList.push({
                id: "wt_1",
                workspaceId: WS_ID,
                catalogId: "sc_hvac",
                name: "AC Inspection",
                code: "AC-01",
                description: null,
                estimatedDuration: 60,
                status: "INACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const res = await changeWorkTypeStatus(WS_ID, "wt_1", "ACTIVE");

            expect(res.status).toBe("ACTIVE");
            expect(res.isAvailableForWorkOrder).toBe(true);
        });

        it("reactivates a work type under an INACTIVE catalog with isAvailableForWorkOrder remaining false", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            workTypesList.push({
                id: "wt_2",
                workspaceId: WS_ID,
                catalogId: "sc_inactive",
                name: "Legacy Work",
                code: null,
                description: null,
                estimatedDuration: null,
                status: "INACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const res = await changeWorkTypeStatus(WS_ID, "wt_2", "ACTIVE");

            expect(res.status).toBe("ACTIVE");
            expect(res.catalogStatus).toBe("INACTIVE");
            expect(res.isAvailableForWorkOrder).toBe(false);
        });
    });

    describe("2. Authorization and Security", () => {
        it("allows OWNER, ADMIN, and MANAGER to change work type status", async () => {
            workTypesList.push({
                id: "wt_shared",
                workspaceId: WS_ID,
                catalogId: "sc_hvac",
                name: "Shared Work",
                code: null,
                description: null,
                estimatedDuration: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            for (const role of ["OWNER", "ADMIN", "MANAGER"] as const) {
                const userId = `user_${role.toLowerCase()}`;
                registerUser(userId);
                registerMember(userId, WS_ID, role);
                loginAs(userId);

                const res = await changeWorkTypeStatus(WS_ID, "wt_shared", "INACTIVE");
                expect(res.status).toBe("INACTIVE");
                await changeWorkTypeStatus(WS_ID, "wt_shared", "ACTIVE");
            }
        });

        it("rejects DISPATCHER, TECHNICIAN, and ACCOUNTANT with ForbiddenError", async () => {
            workTypesList.push({
                id: "wt_target",
                workspaceId: WS_ID,
                catalogId: "sc_hvac",
                name: "Target Work",
                code: null,
                description: null,
                estimatedDuration: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            for (const role of ["DISPATCHER", "TECHNICIAN", "ACCOUNTANT"] as const) {
                const userId = `user_${role.toLowerCase()}`;
                registerUser(userId);
                registerMember(userId, WS_ID, role);
                loginAs(userId);

                await expect(
                    changeWorkTypeStatus(WS_ID, "wt_target", "INACTIVE"),
                ).rejects.toThrow(ForbiddenError);
            }
        });
    });
});
