import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    serviceCatalogFindFirst: vi.fn(),
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
        serviceCatalog: {
            findFirst: mocks.serviceCatalogFindFirst,
        },
        workType: {
            findFirst: mocks.workTypeFindFirst,
            update: mocks.workTypeUpdate,
        },
    },
}));

import { updateWorkType } from "@/lib/services/workType/updateWorkType";
import {
    WorkTypeNotFoundError,
    DuplicateWorkTypeNameError,
    DuplicateWorkTypeCodeError,
} from "@/lib/services/workType/workTypeErrors";
import { ServiceCatalogNotFoundError } from "@/lib/services/serviceCatalog/serviceCatalogErrors";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type { ServiceCatalog, User, Workspace, WorkspaceMember, WorkType } from "@/generated/prisma/client";

describe("Phase 1.5.5 — WorkType Update Service Layer", () => {
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

        mocks.workTypeFindFirst.mockImplementation(async ({ where }: any) => {
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
            const targetCatalogId = data.catalogId ?? current.catalogId;
            const targetName = data.name ?? current.name;
            const targetCode = data.code !== undefined ? data.code : current.code;

            // Check duplicate name in target catalog
            const nameDup = workTypesList.find(
                (wt) => wt.id !== current.id && wt.catalogId === targetCatalogId && wt.name.toLowerCase() === targetName.toLowerCase(),
            );
            if (nameDup) {
                const err = new Error("Unique constraint failed on the fields: (`catalogId`,`name`)");
                (err as any).code = "P2002";
                (err as any).meta = { target: ["catalogId", "name"] };
                throw err;
            }

            // Check duplicate code in workspace
            if (targetCode) {
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
                id: "sc_plumb",
                workspaceId: WS_ID,
                name: "Plumbing",
                description: null,
                status: "ACTIVE",
                sortOrder: 2,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            {
                id: "sc_inactive",
                workspaceId: WS_ID,
                name: "Inactive Trade",
                description: null,
                status: "INACTIVE",
                sortOrder: 3,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            {
                id: "sc_beta",
                workspaceId: WS_ID_2,
                name: "Beta Trade",
                description: null,
                status: "ACTIVE",
                sortOrder: 1,
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

    describe("1. Successful Field Updates", () => {
        it("updates work type fields and normalizes updated code to uppercase", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            workTypesList.push({
                id: "wt_1",
                workspaceId: WS_ID,
                catalogId: "sc_hvac",
                name: "AC Diagnostic",
                code: "AC-01",
                description: "Old description",
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await updateWorkType(WS_ID, "wt_1", {
                name: "Comprehensive AC Diagnostic",
                code: "hvac-diag-comp",
                description: "Updated detailed scope",
                estimatedDuration: 120,
                sortOrder: 5,
            });

            expect(result.name).toBe("Comprehensive AC Diagnostic");
            expect(result.code).toBe("HVAC-DIAG-COMP");
            expect(result.description).toBe("Updated detailed scope");
            expect(result.estimatedDuration).toBe(120);
            expect(result.sortOrder).toBe(5);
        });

        it("clears optional fields with null", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            workTypesList.push({
                id: "wt_1",
                workspaceId: WS_ID,
                catalogId: "sc_hvac",
                name: "AC Diagnostic",
                code: "AC-01",
                description: "Old description",
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await updateWorkType(WS_ID, "wt_1", {
                code: null,
                description: null,
                estimatedDuration: null,
            });

            expect(result.code).toBeNull();
            expect(result.description).toBeNull();
            expect(result.estimatedDuration).toBeNull();
        });
    });

    describe("2. Reparenting & Cross-Tenant Safety", () => {
        it("allows reparenting work type to another catalog within the same workspace", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            workTypesList.push({
                id: "wt_1",
                workspaceId: WS_ID,
                catalogId: "sc_hvac",
                name: "Emergency Snaking",
                code: "SNAKE-01",
                description: null,
                estimatedDuration: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await updateWorkType(WS_ID, "wt_1", {
                catalogId: "sc_plumb",
            });

            expect(result.catalogId).toBe("sc_plumb");
            expect(result.catalogName).toBe("Plumbing");
        });

        it("rejects reparenting to a catalog in another workspace (cross-tenant reparenting attack)", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            workTypesList.push({
                id: "wt_1",
                workspaceId: WS_ID,
                catalogId: "sc_hvac",
                name: "Test Work",
                code: null,
                description: null,
                estimatedDuration: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            await expect(
                updateWorkType(WS_ID, "wt_1", {
                    catalogId: "sc_beta", // Belongs to WS_ID_2
                }),
            ).rejects.toThrow(ServiceCatalogNotFoundError);
        });

        it("re-evaluates isAvailableForWorkOrder when reparented to an INACTIVE catalog", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            workTypesList.push({
                id: "wt_1",
                workspaceId: WS_ID,
                catalogId: "sc_hvac", // ACTIVE
                name: "Boiler Service",
                code: null,
                description: null,
                estimatedDuration: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await updateWorkType(WS_ID, "wt_1", {
                catalogId: "sc_inactive",
            });

            expect(result.status).toBe("ACTIVE");
            expect(result.catalogStatus).toBe("INACTIVE");
            expect(result.isAvailableForWorkOrder).toBe(false);
        });
    });

    describe("3. Uniqueness and Authorization", () => {
        it("rejects updating code to an existing code in the same workspace", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            workTypesList.push(
                {
                    id: "wt_1",
                    workspaceId: WS_ID,
                    catalogId: "sc_hvac",
                    name: "Service A",
                    code: "CODE-100",
                    description: null,
                    estimatedDuration: null,
                    status: "ACTIVE",
                    sortOrder: 0,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
                {
                    id: "wt_2",
                    workspaceId: WS_ID,
                    catalogId: "sc_hvac",
                    name: "Service B",
                    code: "CODE-200",
                    description: null,
                    estimatedDuration: null,
                    status: "ACTIVE",
                    sortOrder: 1,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            );

            await expect(
                updateWorkType(WS_ID, "wt_2", {
                    code: "CODE-100",
                }),
            ).rejects.toThrow(DuplicateWorkTypeCodeError);
        });

        it("rejects unauthorized role from updating work type", async () => {
            workTypesList.push({
                id: "wt_1",
                workspaceId: WS_ID,
                catalogId: "sc_hvac",
                name: "Service A",
                code: null,
                description: null,
                estimatedDuration: null,
                status: "ACTIVE",
                sortOrder: 0,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            registerUser("user_tech");
            registerMember("user_tech", WS_ID, "TECHNICIAN");
            loginAs("user_tech");

            await expect(
                updateWorkType(WS_ID, "wt_1", { name: "Unauthorized Update" }),
            ).rejects.toThrow(ForbiddenError);
        });
    });
});
