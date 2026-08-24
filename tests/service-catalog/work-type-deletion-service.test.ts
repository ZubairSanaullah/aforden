import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
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
        workType: {
            findFirst: mocks.workTypeFindFirst,
            delete: mocks.workTypeDelete,
        },
    },
}));

import { deleteWorkType } from "@/lib/services/workType/deleteWorkType";
import {
    WorkTypeNotFoundError,
    WorkTypeDeletionNotAllowedError,
} from "@/lib/services/workType/workTypeErrors";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type { ServiceCatalog, User, Workspace, WorkspaceMember, WorkType } from "@/generated/prisma/client";

describe("Phase 1.5.5 — WorkType Deletion Service Layer", () => {
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

            const deleted = workTypesList.splice(idx, 1)[0];
            return deleted;
        });

        registerWorkspace(WS_ID, "Apex Operations", "apex-ops");
        registerWorkspace(WS_ID_2, "Beta Services", "beta-services");

        // Seed catalog
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

    describe("1. Deletion Invariants", () => {
        it("rejects deletion of an ACTIVE work type with WorkTypeDeletionNotAllowedError", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
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

            await expect(deleteWorkType(WS_ID, "wt_active")).rejects.toThrow(
                WorkTypeDeletionNotAllowedError,
            );
        });

        it("allows deletion of an INACTIVE work type", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
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

            const result = await deleteWorkType(WS_ID, "wt_inactive");

            expect(result.id).toBe("wt_inactive");
            expect(workTypesList.length).toBe(0);
        });
    });

    describe("2. Authorization and Security", () => {
        it("allows OWNER and ADMIN to delete inactive work types", async () => {
            for (const role of ["OWNER", "ADMIN"] as const) {
                const wtId = `wt_del_${role.toLowerCase()}`;
                workTypesList.push({
                    id: wtId,
                    workspaceId: WS_ID,
                    catalogId: "sc_hvac",
                    name: `Work ${role}`,
                    code: null,
                    description: null,
                    estimatedDuration: null,
                    status: "INACTIVE",
                    sortOrder: 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                });

                const userId = `user_${role.toLowerCase()}`;
                registerUser(userId);
                registerMember(userId, WS_ID, role);
                loginAs(userId);

                const res = await deleteWorkType(WS_ID, wtId);
                expect(res.id).toBe(wtId);
            }
        });

        it("rejects MANAGER, DISPATCHER, TECHNICIAN, and ACCOUNTANT with ForbiddenError", async () => {
            workTypesList.push({
                id: "wt_target",
                workspaceId: WS_ID,
                catalogId: "sc_hvac",
                name: "Target Work",
                code: null,
                description: null,
                estimatedDuration: null,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            for (const role of ["MANAGER", "DISPATCHER", "TECHNICIAN", "ACCOUNTANT"] as const) {
                const userId = `user_${role.toLowerCase()}`;
                registerUser(userId);
                registerMember(userId, WS_ID, role);
                loginAs(userId);

                await expect(deleteWorkType(WS_ID, "wt_target")).rejects.toThrow(ForbiddenError);
            }
        });

        it("throws WorkTypeNotFoundError when attempting to delete cross-tenant work type", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            workTypesList.push({
                id: "wt_other_ws",
                workspaceId: WS_ID_2,
                catalogId: "sc_other",
                name: "Other WS Inactive",
                code: null,
                description: null,
                estimatedDuration: null,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await expect(deleteWorkType(WS_ID, "wt_other_ws")).rejects.toThrow(
                WorkTypeNotFoundError,
            );
        });
    });
});
