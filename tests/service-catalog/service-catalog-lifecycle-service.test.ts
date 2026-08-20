import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    serviceCatalogFindFirst: vi.fn(),
    serviceCatalogUpdate: vi.fn(),
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
            update: mocks.serviceCatalogUpdate,
        },
    },
}));

import { changeServiceCatalogStatus } from "@/lib/services/serviceCatalog/changeServiceCatalogStatus";
import { ServiceCatalogNotFoundError } from "@/lib/services/serviceCatalog/serviceCatalogErrors";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type { ServiceCatalog, User, Workspace, WorkspaceMember, WorkType } from "@/generated/prisma/client";

describe("Phase 1.5.4 — ServiceCatalog Lifecycle Service Layer", () => {
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

        mocks.serviceCatalogUpdate.mockImplementation(async ({ where, data }: any) => {
            const idx = catalogsList.findIndex((c) => c.id === where.id);
            if (idx === -1) {
                const err = new Error("Record not found");
                (err as any).code = "P2025";
                throw err;
            }

            const current = catalogsList[idx];
            const updated: ServiceCatalog = {
                ...current,
                status: data.status,
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

        registerWorkspace(WS_ID, "Apex Operations", "apex-ops");
        registerWorkspace(WS_ID_2, "Beta Services", "beta-services");
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

    describe("1. Status Transitions & Child Immutability", () => {
        it("deactivates an ACTIVE catalog to INACTIVE without altering child workType statuses", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
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
                code: "AC-INSP",
                description: null,
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await changeServiceCatalogStatus(WS_ID, "sc_1", {
                status: "INACTIVE",
            });

            expect(result.status).toBe("INACTIVE");
            // Child work type is untouched in the database
            expect(workTypesList[0].status).toBe("ACTIVE");
        });

        it("reactivates an INACTIVE catalog to ACTIVE", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            catalogsList.push({
                id: "sc_1",
                workspaceId: WS_ID,
                name: "HVAC",
                description: null,
                status: "INACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await changeServiceCatalogStatus(WS_ID, "sc_1", "ACTIVE");
            expect(result.status).toBe("ACTIVE");
        });

        it("rejects invalid status transitions", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
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

            await expect(
                changeServiceCatalogStatus(WS_ID, "sc_1", { status: "SUSPENDED" }),
            ).rejects.toThrow();
        });
    });

    describe("2. Authorization Checks", () => {
        it("allows OWNER, ADMIN, and MANAGER to mutate status", async () => {
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

            for (const role of ["OWNER", "ADMIN", "MANAGER"] as const) {
                const userId = `user_${role.toLowerCase()}`;
                registerUser(userId);
                registerMember(userId, WS_ID, role);
                loginAs(userId);

                const res = await changeServiceCatalogStatus(WS_ID, "sc_1", "INACTIVE");
                expect(res.status).toBe("INACTIVE");
                await changeServiceCatalogStatus(WS_ID, "sc_1", "ACTIVE");
            }
        });

        it("rejects DISPATCHER, TECHNICIAN, and ACCOUNTANT with ForbiddenError", async () => {
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

            for (const role of ["DISPATCHER", "TECHNICIAN", "ACCOUNTANT"] as const) {
                const userId = `user_${role.toLowerCase()}`;
                registerUser(userId);
                registerMember(userId, WS_ID, role);
                loginAs(userId);

                await expect(
                    changeServiceCatalogStatus(WS_ID, "sc_1", "INACTIVE"),
                ).rejects.toThrow(ForbiddenError);
            }
        });
    });

    describe("3. Tenant Isolation", () => {
        it("throws ServiceCatalogNotFoundError when trying to change status of catalog in another workspace", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            catalogsList.push({
                id: "sc_other",
                workspaceId: WS_ID_2,
                name: "Other WS Catalog",
                description: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await expect(
                changeServiceCatalogStatus(WS_ID, "sc_other", "INACTIVE"),
            ).rejects.toThrow(ServiceCatalogNotFoundError);
        });
    });
});
