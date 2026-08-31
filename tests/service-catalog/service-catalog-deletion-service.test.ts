import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    serviceCatalogFindFirst: vi.fn(),
    serviceCatalogDelete: vi.fn(),
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
    },
}));

import { deleteServiceCatalog } from "@/lib/services/serviceCatalog/deleteServiceCatalog";
import {
    ServiceCatalogNotFoundError,
    ServiceCatalogDeletionNotAllowedError,
} from "@/lib/services/serviceCatalog/serviceCatalogErrors";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type { ServiceCatalog, User, Workspace, WorkspaceMember, WorkType } from "@/generated/prisma/client";

describe("Phase 1.5.4 — ServiceCatalog Deletion Service Layer", () => {
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

            const deleted = catalogsList.splice(idx, 1)[0];
            return deleted;
        });

        registerWorkspace(WS_ID, "Apex Operations", "apex-ops");
        registerWorkspace(WS_ID_2, "Beta Services", "beta-services");
    });

    function registerUser(userId = "user_admin", name = "Admin User", status = "ACTIVE") {
        const user: User = {
            id: userId,
            name,
            email: `${userId}@example.com`,
        platformRole: null,
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
        it("rejects deletion of an ACTIVE catalog with ServiceCatalogDeletionNotAllowedError", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            catalogsList.push({
                id: "sc_active",
                workspaceId: WS_ID,
                name: "Active Catalog",
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await expect(deleteServiceCatalog(WS_ID, "sc_active")).rejects.toThrow(
                ServiceCatalogDeletionNotAllowedError,
            );
        });

        it("rejects deletion of an INACTIVE catalog that still has child work types", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            catalogsList.push({
                id: "sc_with_children",
                workspaceId: WS_ID,
                name: "Deactivated With Children",
                description: null,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            workTypesList.push({
                id: "wt_1",
                workspaceId: WS_ID,
                catalogId: "sc_with_children",
                name: "Residual Work Type",
                code: "RES-01",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await expect(deleteServiceCatalog(WS_ID, "sc_with_children")).rejects.toThrow(
                ServiceCatalogDeletionNotAllowedError,
            );
        });

        it("successfully deletes an INACTIVE catalog with zero child work types", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            catalogsList.push({
                id: "sc_empty_inactive",
                workspaceId: WS_ID,
                name: "Empty Inactive",
                description: null,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await deleteServiceCatalog(WS_ID, "sc_empty_inactive");

            expect(result.id).toBe("sc_empty_inactive");
            expect(catalogsList.length).toBe(0);
        });
    });

    describe("2. Authorization & Role Checks", () => {
        it("allows OWNER and ADMIN to delete inactive empty catalogs", async () => {
            for (const role of ["OWNER", "ADMIN"] as const) {
                const catalogId = `sc_del_${role.toLowerCase()}`;
                catalogsList.push({
                    id: catalogId,
                    workspaceId: WS_ID,
                    name: `Catalog ${role}`,
                    description: null,
                    status: "INACTIVE",
                    sortOrder: 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                });

                const userId = `user_${role.toLowerCase()}`;
                registerUser(userId);
                registerMember(userId, WS_ID, role);
                loginAs(userId);

                const res = await deleteServiceCatalog(WS_ID, catalogId);
                expect(res.id).toBe(catalogId);
            }
        });

        it("rejects MANAGER, DISPATCHER, TECHNICIAN, and ACCOUNTANT from deleting with ForbiddenError", async () => {
            catalogsList.push({
                id: "sc_target",
                workspaceId: WS_ID,
                name: "Target Catalog",
                description: null,
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

                await expect(deleteServiceCatalog(WS_ID, "sc_target")).rejects.toThrow(
                    ForbiddenError,
                );
            }
        });
    });

    describe("3. Tenant Isolation", () => {
        it("throws ServiceCatalogNotFoundError when trying to delete a catalog in another workspace", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            catalogsList.push({
                id: "sc_other_ws",
                workspaceId: WS_ID_2,
                name: "Other WS Inactive",
                description: null,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await expect(deleteServiceCatalog(WS_ID, "sc_other_ws")).rejects.toThrow(
                ServiceCatalogNotFoundError,
            );
        });
    });
});
