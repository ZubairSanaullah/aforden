import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    prisma: {
        user: {
            findUnique: vi.fn(),
        },
        workspace: {
            findUnique: vi.fn(),
        },
        workspaceMember: {
            findFirst: vi.fn(),
            findUnique: vi.fn(),
        },
        serviceCatalog: {
            findFirst: vi.fn(),
        },
        workType: {
            create: vi.fn(),
            findMany: vi.fn(),
            findFirst: vi.fn(),
            count: vi.fn(),
        },
    },
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: mocks.prisma,
}));

import { getWorkTypes } from "@/lib/services/workType/getWorkTypes";
import { createWorkType } from "@/lib/services/workType/createWorkType";
import { ServiceCatalogNotFoundError } from "@/lib/services/serviceCatalog/serviceCatalogErrors";
import {
    DuplicateWorkTypeCodeError,
    DuplicateWorkTypeNameError,
    WorkTypeCreationError,
} from "@/lib/services/workType/workTypeErrors";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";

describe("Phase 1.21.2 — WorkType Querying & Creation Hardening", () => {
    const WS_ID = "ws_test_100";
    const USER_ID = "user_admin_1";

    beforeEach(() => {
        vi.clearAllMocks();

        mocks.auth.mockResolvedValue({
            user: { id: USER_ID, email: "admin@example.com" },
        });

        mocks.prisma.user.findUnique.mockResolvedValue({
            id: USER_ID,
            email: "admin@example.com",
            status: "ACTIVE",
            emailVerified: new Date(),
        });

        mocks.prisma.workspace.findUnique.mockResolvedValue({
            id: WS_ID,
            name: "Test WS",
            slug: "test-ws",
        });

        const memberObj = {
            id: "mem_1",
            userId: USER_ID,
            workspaceId: WS_ID,
            role: "ADMIN",
            status: "ACTIVE",
        };
        mocks.prisma.workspaceMember.findFirst.mockResolvedValue(memberObj);
        mocks.prisma.workspaceMember.findUnique.mockResolvedValue(memberObj);
    });

    describe("1. Multi-Field Sorting & Querying in `getWorkTypes`", () => {
        const dummyCatalog = {
            id: "cat_1",
            name: "HVAC",
            status: "ACTIVE",
            workspaceId: WS_ID,
        };

        const dummyWorkTypes = [
            {
                id: "wt_1",
                workspaceId: WS_ID,
                catalogId: "cat_1",
                name: "Alpha AC",
                code: "AC-1",
                description: "Cooling service",
                estimatedDuration: 60,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date("2026-09-01T00:00:00.000Z"),
                updatedAt: new Date("2026-09-01T00:00:00.000Z"),
                catalog: dummyCatalog,
            },
            {
                id: "wt_2",
                workspaceId: WS_ID,
                catalogId: "cat_1",
                name: "Beta Heating",
                code: "HT-2",
                description: "Heating service",
                estimatedDuration: 120,
                status: "INACTIVE",
                sortOrder: 2,
                createdAt: new Date("2026-09-02T00:00:00.000Z"),
                updatedAt: new Date("2026-09-02T00:00:00.000Z"),
                catalog: dummyCatalog,
            },
        ];

        it("sorts by each supported sortBy field with deterministic orderings", async () => {
            mocks.prisma.workType.count.mockResolvedValue(2);
            mocks.prisma.workType.findMany.mockResolvedValue(dummyWorkTypes);

            const sortFields = [
                "sortOrder",
                "name",
                "code",
                "estimatedDuration",
                "status",
                "createdAt",
                "updatedAt",
            ] as const;

            for (const sortBy of sortFields) {
                await getWorkTypes(WS_ID, { sortBy, sortOrder: "desc" });

                expect(mocks.prisma.workType.findMany).toHaveBeenCalledWith(
                    expect.objectContaining({
                        orderBy: expect.any(Array),
                    }),
                );
            }

            // Default fallback sort
            await getWorkTypes(WS_ID, {});
            expect(mocks.prisma.workType.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
                }),
            );
        });

        it("filters by status, catalogId, and search keyword", async () => {
            mocks.prisma.workType.count.mockResolvedValue(1);
            mocks.prisma.workType.findMany.mockResolvedValue([dummyWorkTypes[0]]);

            const result = await getWorkTypes(WS_ID, {
                status: "ACTIVE",
                catalogId: "cat_1",
                search: "cooling",
                page: 1,
                pageSize: 10,
            });

            expect(result.items.length).toBe(1);
            expect(result.items[0].isAvailableForWorkOrder).toBe(true);

            expect(mocks.prisma.workType.findMany).toHaveBeenCalledWith(
                expect.objectContaining({
                    where: {
                        workspaceId: WS_ID,
                        status: "ACTIVE",
                        catalogId: "cat_1",
                        catalog: { workspaceId: WS_ID },
                        OR: [
                            { name: { contains: "cooling", mode: "insensitive" } },
                            { code: { contains: "cooling", mode: "insensitive" } },
                            { description: { contains: "cooling", mode: "insensitive" } },
                        ],
                    },
                }),
            );
        });

        it("computes pagination metadata correctly across pages", async () => {
            mocks.prisma.workType.count.mockResolvedValue(25);
            mocks.prisma.workType.findMany.mockResolvedValue(dummyWorkTypes);

            const result = await getWorkTypes(WS_ID, {
                page: 2,
                pageSize: 10,
            });

            expect(result.pagination.page).toBe(2);
            expect(result.pagination.pageSize).toBe(10);
            expect(result.pagination.total).toBe(25);
            expect(result.pagination.totalPages).toBe(3);
            expect(result.pagination.hasNextPage).toBe(true);
            expect(result.pagination.hasPreviousPage).toBe(true);
        });

        it("denies access if caller is not an active workspace member", async () => {
            mocks.prisma.workspaceMember.findFirst.mockResolvedValue(null);
            mocks.prisma.workspaceMember.findUnique.mockResolvedValue(null);

            await expect(getWorkTypes(WS_ID, {})).rejects.toThrow(ForbiddenError);
        });
    });

    describe("2. WorkType Creation Edge Cases & Constraint Handling (`createWorkType`)", () => {
        const validPayload = {
            catalogId: "cat_1",
            name: "Boiler Installation",
            code: "BOIL-01",
            description: "Install gas boiler",
            estimatedDuration: 180,
            sortOrder: 5,
        };

        it("creates work type successfully when parent catalog is in the same workspace", async () => {
            mocks.prisma.serviceCatalog.findFirst.mockResolvedValue({
                id: "cat_1",
                workspaceId: WS_ID,
                name: "Heating",
                status: "ACTIVE",
            });

            mocks.prisma.workType.create.mockResolvedValue({
                id: "wt_new_1",
                workspaceId: WS_ID,
                catalogId: "cat_1",
                name: "Boiler Installation",
                code: "BOIL-01",
                description: "Install gas boiler",
                estimatedDuration: 180,
                sortOrder: 5,
                status: "ACTIVE",
                createdAt: new Date(),
                updatedAt: new Date(),
                catalog: {
                    id: "cat_1",
                    name: "Heating",
                    status: "ACTIVE",
                },
            });

            const result = await createWorkType(WS_ID, validPayload);

            expect(result.id).toBe("wt_new_1");
            expect(result.isAvailableForWorkOrder).toBe(true);
            expect(result.catalogName).toBe("Heating");
        });

        it("throws ServiceCatalogNotFoundError when catalog does not exist in workspace", async () => {
            mocks.prisma.serviceCatalog.findFirst.mockResolvedValue(null);

            await expect(createWorkType(WS_ID, validPayload)).rejects.toThrow(
                ServiceCatalogNotFoundError,
            );
        });

        it("handles DuplicateWorkTypeCodeError when meta.target array contains 'code'", async () => {
            mocks.prisma.serviceCatalog.findFirst.mockResolvedValue({
                id: "cat_1",
                workspaceId: WS_ID,
                name: "Heating",
                status: "ACTIVE",
            });

            const p2002Err: any = new Error("Unique constraint failed");
            p2002Err.code = "P2002";
            p2002Err.meta = { target: ["workspaceId", "code"] };
            mocks.prisma.workType.create.mockRejectedValue(p2002Err);

            await expect(createWorkType(WS_ID, validPayload)).rejects.toThrow(
                DuplicateWorkTypeCodeError,
            );
        });

        it("handles DuplicateWorkTypeNameError when meta.target array contains 'name'", async () => {
            mocks.prisma.serviceCatalog.findFirst.mockResolvedValue({
                id: "cat_1",
                workspaceId: WS_ID,
                name: "Heating",
                status: "ACTIVE",
            });

            const p2002Err: any = new Error("Unique constraint failed");
            p2002Err.code = "P2002";
            p2002Err.meta = { target: ["catalogId", "name"] };
            mocks.prisma.workType.create.mockRejectedValue(p2002Err);

            await expect(createWorkType(WS_ID, validPayload)).rejects.toThrow(
                DuplicateWorkTypeNameError,
            );
        });

        it("handles string target format for DuplicateWorkTypeCodeError and DuplicateWorkTypeNameError", async () => {
            mocks.prisma.serviceCatalog.findFirst.mockResolvedValue({
                id: "cat_1",
                workspaceId: WS_ID,
                name: "Heating",
                status: "ACTIVE",
            });

            const errCodeStr: any = new Error("Unique constraint failed on field code");
            errCodeStr.code = "P2002";
            errCodeStr.meta = { target: "work_types_workspace_id_code_key" };
            mocks.prisma.workType.create.mockRejectedValueOnce(errCodeStr);

            await expect(createWorkType(WS_ID, validPayload)).rejects.toThrow(
                DuplicateWorkTypeCodeError,
            );

            const errNameStr: any = new Error("Unique constraint failed on field name");
            errNameStr.code = "P2002";
            errNameStr.meta = { target: "work_types_catalog_id_name_key" };
            mocks.prisma.workType.create.mockRejectedValueOnce(errNameStr);

            await expect(createWorkType(WS_ID, validPayload)).rejects.toThrow(
                DuplicateWorkTypeNameError,
            );
        });

        it("falls back to DB lookup when unique constraint target is unparsed", async () => {
            mocks.prisma.serviceCatalog.findFirst.mockResolvedValue({
                id: "cat_1",
                workspaceId: WS_ID,
                name: "Heating",
                status: "ACTIVE",
            });

            const opaqueErr: any = new Error("Unique constraint failed");
            opaqueErr.code = "P2002";
            mocks.prisma.workType.create.mockRejectedValueOnce(opaqueErr);

            // Existing code found in DB
            mocks.prisma.workType.findFirst.mockResolvedValueOnce({ id: "wt_existing_code" });
            await expect(createWorkType(WS_ID, validPayload)).rejects.toThrow(
                DuplicateWorkTypeCodeError,
            );

            // No existing code in DB -> defaults to DuplicateWorkTypeNameError
            mocks.prisma.workType.create.mockRejectedValueOnce(opaqueErr);
            mocks.prisma.workType.findFirst.mockResolvedValueOnce(null);
            await expect(createWorkType(WS_ID, validPayload)).rejects.toThrow(
                DuplicateWorkTypeNameError,
            );
        });

        it("wraps unexpected non-unique database errors in WorkTypeCreationError", async () => {
            mocks.prisma.serviceCatalog.findFirst.mockResolvedValue({
                id: "cat_1",
                workspaceId: WS_ID,
                name: "Heating",
                status: "ACTIVE",
            });

            mocks.prisma.workType.create.mockRejectedValue(new Error("Connection terminated"));

            await expect(createWorkType(WS_ID, validPayload)).rejects.toThrow(
                WorkTypeCreationError,
            );
        });

        it("enforces RBAC permission check on creation (rejects DISPATCHER)", async () => {
            const dispMember = {
                id: "mem_disp",
                userId: USER_ID,
                workspaceId: WS_ID,
                role: "DISPATCHER", // lacks SERVICE_CATALOG_CREATE
                status: "ACTIVE",
            };
            mocks.prisma.workspaceMember.findFirst.mockResolvedValue(dispMember);
            mocks.prisma.workspaceMember.findUnique.mockResolvedValue(dispMember);

            await expect(createWorkType(WS_ID, validPayload)).rejects.toThrow(ForbiddenError);
        });
    });
});
