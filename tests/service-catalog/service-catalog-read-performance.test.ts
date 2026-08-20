import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    serviceCatalogFindMany: vi.fn(),
    serviceCatalogCount: vi.fn(),
    workTypeFindMany: vi.fn(),
    workTypeCount: vi.fn(),
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
            findMany: mocks.serviceCatalogFindMany,
            count: mocks.serviceCatalogCount,
        },
        workType: {
            findMany: mocks.workTypeFindMany,
            count: mocks.workTypeCount,
        },
    },
}));

import { getServiceCatalogs } from "@/lib/services/serviceCatalog/getServiceCatalogs";
import { getWorkTypes } from "@/lib/services/workType/getWorkTypes";
import { getServiceCatalogOperationalSummary } from "@/lib/services/serviceCatalog/getServiceCatalogOperationalSummary";
import { getWorkTypeOperationalSummary } from "@/lib/services/workType/getWorkTypeOperationalSummary";
import type { User, Workspace, WorkspaceMember } from "@/generated/prisma/client";

describe("Phase 1.5.10 — Read Performance, N+1 Prevention & Aggregation Optimization", () => {
    const WS_ID = "ws_perf_100";

    beforeEach(() => {
        vi.clearAllMocks();

        mocks.userFindUnique.mockResolvedValue({
            id: "user_admin",
            status: "ACTIVE",
        } as User);

        mocks.workspaceFindUnique.mockResolvedValue({
            id: WS_ID,
        } as Workspace);

        mocks.workspaceMemberFindUnique.mockResolvedValue({
            id: "member_admin",
            userId: "user_admin",
            workspaceId: WS_ID,
            role: "ADMIN",
            status: "ACTIVE",
        } as WorkspaceMember);

        mocks.auth.mockResolvedValue({
            user: { id: "user_admin", email: "admin@example.com" },
        });
    });

    describe("1. N+1 Query Prevention in getServiceCatalogs", () => {
        it("executes exactly 1 findMany with eager inclusion for counts and 1 count query", async () => {
            mocks.serviceCatalogCount.mockResolvedValue(5);
            mocks.serviceCatalogFindMany.mockResolvedValue([
                {
                    id: "sc_1",
                    workspaceId: WS_ID,
                    name: "Catalog 1",
                    description: null,
                    status: "ACTIVE",
                    sortOrder: 1,
                    _count: { workTypes: 3 },
                    workTypes: [{ id: "wt_1" }, { id: "wt_2" }],
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ]);

            const result = await getServiceCatalogs(WS_ID);

            expect(mocks.serviceCatalogFindMany).toHaveBeenCalledTimes(1);
            expect(mocks.serviceCatalogCount).toHaveBeenCalledTimes(1);

            // Ensure no separate per-catalog queries were made
            expect(mocks.workTypeFindMany).not.toHaveBeenCalled();
            expect(mocks.workTypeCount).not.toHaveBeenCalled();

            expect(result.items[0].workTypesCount).toBe(3);
            expect(result.items[0].activeWorkTypesCount).toBe(2);
        });
    });

    describe("2. N+1 Query Prevention in getWorkTypes", () => {
        it("executes exactly 1 findMany with catalog inclusion and 1 count query", async () => {
            mocks.workTypeCount.mockResolvedValue(10);
            mocks.workTypeFindMany.mockResolvedValue([
                {
                    id: "wt_1",
                    workspaceId: WS_ID,
                    catalogId: "sc_1",
                    name: "Work 1",
                    code: "W-1",
                    description: null,
                    estimatedDuration: 60,
                    status: "ACTIVE",
                    sortOrder: 1,
                    catalog: {
                        id: "sc_1",
                        name: "Catalog 1",
                        status: "ACTIVE",
                    },
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ]);

            const result = await getWorkTypes(WS_ID);

            expect(mocks.workTypeFindMany).toHaveBeenCalledTimes(1);
            expect(mocks.workTypeCount).toHaveBeenCalledTimes(1);

            // Ensure no per-item queries were made
            expect(mocks.serviceCatalogFindMany).not.toHaveBeenCalled();

            expect(result.items[0].catalogName).toBe("Catalog 1");
            expect(result.items[0].isAvailableForWorkOrder).toBe(true);
        });
    });

    describe("3. Aggregation Efficiency in Operational Summaries", () => {
        it("computes getServiceCatalogOperationalSummary via parallel database count queries without pulling records", async () => {
            mocks.serviceCatalogCount.mockResolvedValueOnce(10); // total
            mocks.serviceCatalogCount.mockResolvedValueOnce(8);  // active
            mocks.serviceCatalogCount.mockResolvedValueOnce(2);  // inactive
            mocks.workTypeCount.mockResolvedValueOnce(25);       // total wt
            mocks.workTypeCount.mockResolvedValueOnce(20);       // active wt

            const summary = await getServiceCatalogOperationalSummary(WS_ID);

            expect(mocks.serviceCatalogFindMany).not.toHaveBeenCalled();
            expect(mocks.workTypeFindMany).not.toHaveBeenCalled();

            expect(summary).toEqual({
                workspaceId: WS_ID,
                totalCatalogs: 10,
                activeCatalogs: 8,
                inactiveCatalogs: 2,
                totalWorkTypes: 25,
                activeWorkTypes: 20,
            });
        });

        it("computes getWorkTypeOperationalSummary via parallel database count queries without pulling records", async () => {
            mocks.workTypeCount.mockResolvedValueOnce(25);       // total wt
            mocks.workTypeCount.mockResolvedValueOnce(20);       // active wt
            mocks.workTypeCount.mockResolvedValueOnce(5);        // inactive wt
            mocks.workTypeCount.mockResolvedValueOnce(18);       // available wt (active + active cat)
            mocks.serviceCatalogCount.mockResolvedValueOnce(10); // total cat

            const summary = await getWorkTypeOperationalSummary(WS_ID);

            expect(mocks.serviceCatalogFindMany).not.toHaveBeenCalled();
            expect(mocks.workTypeFindMany).not.toHaveBeenCalled();

            expect(summary).toEqual({
                workspaceId: WS_ID,
                totalWorkTypes: 25,
                activeWorkTypes: 20,
                inactiveWorkTypes: 5,
                availableWorkTypes: 18,
                unavailableWorkTypes: 7,
                totalCatalogs: 10,
            });
        });
    });
});
