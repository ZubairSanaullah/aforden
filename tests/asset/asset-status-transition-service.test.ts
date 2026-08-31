import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    assetFindFirst: vi.fn(),
    assetUpdate: vi.fn(),
    assetHistoryCreate: vi.fn(),
    workOrderFindFirst: vi.fn(),
    transaction: vi.fn(),
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
        asset: {
            findFirst: mocks.assetFindFirst,
            update: mocks.assetUpdate,
        },
        assetHistory: {
            create: mocks.assetHistoryCreate,
        },
        workOrder: {
            findFirst: mocks.workOrderFindFirst,
        },
        $transaction: mocks.transaction,
    },
}));

import { transitionAssetStatus } from "@/lib/services/asset/transitionAssetStatus";
import { retireAsset } from "@/lib/services/asset/retireAsset";
import { ASSET_STATUS_TRANSITION_RULES } from "@/lib/services/asset/assetStatusTransitions";
import {
    AssetNotFoundError,
    AssetInvalidStatusTransitionError,
    AssetMissingStatusReasonError,
    AssetImmutableError,
} from "@/lib/services/asset/assetErrors";
import {
    ForbiddenError,
} from "@/lib/services/authorization/authorizationErrors";
import type {
    Asset,
    AssetStatus,
    User,
    Workspace,
    WorkspaceMember,
} from "@/generated/prisma/client";

describe("Phase 1.7.5 — Asset Status Transition & Lifecycle Service Unit Tests", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let assetsList: any[];
    let historyList: any[];

    const WS_ID = "ws_alpha_status";

    const USER_ADMIN: User = {
        id: "usr_admin_1",
        name: "Admin User",
        email: "admin@status.com",
        platformRole: null,
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_DISPATCHER: User = {
        id: "usr_disp_1",
        name: "Dispatcher User",
        email: "disp@status.com",
        platformRole: null,
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_TECH: User = {
        id: "usr_tech_1",
        name: "Tech User",
        email: "tech@status.com",
        platformRole: null,
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const MEMBER_ADMIN: WorkspaceMember = {
        id: "mem_admin_1",
        workspaceId: WS_ID,
        userId: USER_ADMIN.id,
        role: "ADMIN",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const MEMBER_DISPATCHER: WorkspaceMember = {
        id: "mem_disp_1",
        workspaceId: WS_ID,
        userId: USER_DISPATCHER.id,
        role: "DISPATCHER",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const MEMBER_TECH: WorkspaceMember = {
        id: "mem_tech_1",
        workspaceId: WS_ID,
        userId: USER_TECH.id,
        role: "TECHNICIAN",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const makeAsset = (status: AssetStatus = "OPERATIONAL", overrides: any = {}): any => ({
        id: "ast_status_1",
        workspaceId: WS_ID,
        assetNumber: "AST-000200",
        name: "Chiller Unit #2",
        customerId: "cust_1",
        locationId: "loc_1",
        categoryId: "cat_1",
        manufacturer: "Trane",
        modelNumber: "TR-500",
        serialNumber: "SN-999",
        status,
        subLocationNotes: null,
        installationDate: null,
        warrantyExpiresAt: null,
        purchaseDate: null,
        purchaseCost: null,
        notes: null,
        tags: [],
        metadata: null,
        decommissionedAt: status === "DECOMMISSIONED" ? new Date("2026-01-01") : null,
        retiredAt: status === "RETIRED" ? new Date("2026-01-01") : null,
        customer: { id: "cust_1", customerNumber: "CUST-001", name: "Client Corp" },
        location: { id: "loc_1", name: "Plant 1", addressLine1: "100 Ave", city: "Dallas", state: "TX", latitude: null, longitude: null },
        category: { id: "cat_1", name: "Commercial HVAC", code: "HVAC" },
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    });

    beforeEach(() => {
        vi.clearAllMocks();

        usersMap = new Map([
            [USER_ADMIN.id, USER_ADMIN],
            [USER_DISPATCHER.id, USER_DISPATCHER],
            [USER_TECH.id, USER_TECH],
        ]);

        workspacesMap = new Map([
            [
                WS_ID,
                {
                    id: WS_ID,
                    name: "Alpha Corp",
                    slug: "alpha-corp",
                    logoUrl: null,
                    timezone: "America/New_York",
                    defaultCurrencyCode: "USD",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ],
        ]);

        membersMap = new Map([
            [`${WS_ID}_${USER_ADMIN.id}`, MEMBER_ADMIN],
            [`${WS_ID}_${USER_DISPATCHER.id}`, MEMBER_DISPATCHER],
            [`${WS_ID}_${USER_TECH.id}`, MEMBER_TECH],
        ]);

        assetsList = [makeAsset()];
        historyList = [];

        mocks.auth.mockResolvedValue({
            user: { id: USER_ADMIN.id, email: USER_ADMIN.email },
        });

        mocks.userFindUnique.mockImplementation(async ({ where }: any) => {
            return usersMap.get(where.id) || null;
        });

        mocks.workspaceFindUnique.mockImplementation(async ({ where }: any) => {
            return workspacesMap.get(where.id) || null;
        });

        mocks.workspaceMemberFindUnique.mockImplementation(async ({ where }: any) => {
            const compound = where.userId_workspaceId || where.workspaceId_userId;
            if (compound) {
                const key = `${compound.workspaceId}_${compound.userId}`;
                return membersMap.get(key) || null;
            }
            return null;
        });

        mocks.assetFindFirst.mockImplementation(async ({ where }: any) => {
            return (
                assetsList.find(
                    (a) => a.id === where.id && a.workspaceId === where.workspaceId
                ) || null
            );
        });

        mocks.assetUpdate.mockImplementation(async ({ where, data }: any) => {
            const asset = assetsList.find((a) => a.id === where.id);
            if (!asset) throw new Error("Not found");
            Object.assign(asset, data);
            if (data.locationId === null) {
                asset.location = null;
            }
            return asset;
        });

        mocks.assetHistoryCreate.mockImplementation(async ({ data }: any) => {
            const row = { id: `hist_${historyList.length + 1}`, ...data };
            historyList.push(row);
            return row;
        });

        mocks.workOrderFindFirst.mockResolvedValue(null);

        mocks.transaction.mockImplementation(async (callback: any) => {
            return callback({
                asset: {
                    update: mocks.assetUpdate,
                },
                assetHistory: {
                    create: mocks.assetHistoryCreate,
                },
            });
        });
    });

    // -----------------------------------------------------------------------
    // 1. Matrix Transitions & Side Effects
    // -----------------------------------------------------------------------
    describe("1. Valid Transitions & Side Effects", () => {
        it("OPERATIONAL -> DEGRADED requires reason and creates STATUS_CHANGED history", async () => {
            const result = await transitionAssetStatus(WS_ID, "ast_status_1", {
                toStatus: "DEGRADED",
                statusReason: "High head pressure alert",
            });

            expect(result.status).toBe("DEGRADED");
            expect(historyList).toHaveLength(1);
            expect(historyList[0].eventType).toBe("STATUS_CHANGED");
            expect(historyList[0].reason).toBe("High head pressure alert");
        });

        it("OPERATIONAL -> IN_STORAGE nulls locationId (depot uninstallation)", async () => {
            expect(assetsList[0].locationId).toBe("loc_1");

            const result = await transitionAssetStatus(WS_ID, "ast_status_1", {
                toStatus: "IN_STORAGE",
                statusReason: "Removed from site to warehouse",
            });

            expect(result.status).toBe("IN_STORAGE");
            expect(result.location).toBeNull();
            expect(assetsList[0].locationId).toBeNull();
        });

        it("OPERATIONAL -> DECOMMISSIONED sets decommissionedAt and records DECOMMISSIONED event", async () => {
            const result = await transitionAssetStatus(WS_ID, "ast_status_1", {
                toStatus: "DECOMMISSIONED",
                statusReason: "Building mothballed for winter",
            });

            expect(result.status).toBe("DECOMMISSIONED");
            expect(result.decommissionedAt).toBeInstanceOf(Date);
            expect(historyList[0].eventType).toBe("DECOMMISSIONED");
        });

        it("DECOMMISSIONED -> OPERATIONAL clears decommissionedAt to null and records REACTIVATED event", async () => {
            assetsList[0] = makeAsset("DECOMMISSIONED");
            expect(assetsList[0].decommissionedAt).toBeDefined();

            const result = await transitionAssetStatus(WS_ID, "ast_status_1", {
                toStatus: "OPERATIONAL",
            });

            expect(result.status).toBe("OPERATIONAL");
            expect(result.decommissionedAt).toBeNull();
            expect(historyList[0].eventType).toBe("REACTIVATED");
        });

        it("OPERATIONAL -> RETIRED sets retiredAt and records RETIRED event", async () => {
            const result = await transitionAssetStatus(WS_ID, "ast_status_1", {
                toStatus: "RETIRED",
                statusReason: "Equipment destroyed; scrapped",
            });

            expect(result.status).toBe("RETIRED");
            expect(result.retiredAt).toBeInstanceOf(Date);
            expect(historyList[0].eventType).toBe("RETIRED");
        });

        it("comprehensively exercises all 21 valid transitions in ASSET_STATUS_TRANSITION_RULES with correct side effects and audit event types", async () => {
            expect(ASSET_STATUS_TRANSITION_RULES).toHaveLength(21);

            for (const rule of ASSET_STATUS_TRANSITION_RULES) {
                historyList = [];
                const initialLocationId = rule.from === "IN_STORAGE" ? null : "loc_1";
                const initialDecomAt = rule.from === "DECOMMISSIONED" ? new Date("2026-01-01") : null;

                assetsList[0] = makeAsset(rule.from, {
                    locationId: initialLocationId,
                    decommissionedAt: initialDecomAt,
                    retiredAt: null,
                    location: initialLocationId ? { id: "loc_1", name: "Plant 1", addressLine1: "100 Ave", city: "Dallas", state: "TX", latitude: null, longitude: null } : null,
                });

                const result = await transitionAssetStatus(WS_ID, "ast_status_1", {
                    toStatus: rule.to,
                    statusReason: rule.requiresReason ? `Reason for ${rule.from} to ${rule.to}` : undefined,
                });

                // 1. Resulting status matches target
                expect(result.status).toBe(rule.to);

                // 2. Side effect: Location nulling on -> IN_STORAGE from installed state
                if (rule.to === "IN_STORAGE" && ["OPERATIONAL", "DEGRADED", "OUT_OF_SERVICE"].includes(rule.from)) {
                    expect(result.location).toBeNull();
                    expect(assetsList[0].locationId).toBeNull();
                } else if (initialLocationId) {
                    expect(assetsList[0].locationId).toBe("loc_1");
                }

                // 3. Side effect: decommissionedAt timestamp setting / clearing
                if (rule.to === "DECOMMISSIONED") {
                    expect(result.decommissionedAt).toBeInstanceOf(Date);
                } else if (rule.from === "DECOMMISSIONED" && ["IN_STORAGE", "OPERATIONAL"].includes(rule.to)) {
                    expect(result.decommissionedAt).toBeNull();
                }

                // 4. Side effect: retiredAt timestamp setting
                if (rule.to === "RETIRED") {
                    expect(result.retiredAt).toBeInstanceOf(Date);
                } else {
                    expect(result.retiredAt).toBeNull();
                }

                // 5. Correct AssetHistoryEventType
                expect(historyList).toHaveLength(1);
                if (rule.to === "DECOMMISSIONED") {
                    expect(historyList[0].eventType).toBe("DECOMMISSIONED");
                } else if (rule.from === "DECOMMISSIONED" && ["IN_STORAGE", "OPERATIONAL"].includes(rule.to)) {
                    expect(historyList[0].eventType).toBe("REACTIVATED");
                } else if (rule.to === "RETIRED") {
                    expect(historyList[0].eventType).toBe("RETIRED");
                } else {
                    expect(historyList[0].eventType).toBe("STATUS_CHANGED");
                }
            }
        });
    });

    // -----------------------------------------------------------------------
    // 2. Reason Requirement Distinction (Per-Transition-Pair)
    // -----------------------------------------------------------------------
    describe("2. statusReason Enforcement (Per-Transition-Pair)", () => {
        it("OPERATIONAL -> DEGRADED fails without reason", async () => {
            assetsList[0] = makeAsset("OPERATIONAL");

            await expect(
                transitionAssetStatus(WS_ID, "ast_status_1", {
                    toStatus: "DEGRADED",
                })
            ).rejects.toThrow(AssetMissingStatusReasonError);
        });

        it("OUT_OF_SERVICE -> DEGRADED succeeds without reason", async () => {
            assetsList[0] = makeAsset("OUT_OF_SERVICE");

            const result = await transitionAssetStatus(WS_ID, "ast_status_1", {
                toStatus: "DEGRADED",
            });

            expect(result.status).toBe("DEGRADED");
        });
    });

    // -----------------------------------------------------------------------
    // 3. Role Permissions & Scoping
    // -----------------------------------------------------------------------
    describe("3. Role Governance & Technician Scoping", () => {
        it("allows TECHNICIAN on OPERATIONAL -> DEGRADED with active work order", async () => {
            mocks.auth.mockResolvedValue({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            mocks.workOrderFindFirst.mockResolvedValue({
                id: "wo_assigned_1",
                status: "IN_PROGRESS",
                assetId: "ast_status_1",
            });

            const result = await transitionAssetStatus(WS_ID, "ast_status_1", {
                toStatus: "DEGRADED",
                statusReason: "Compressor vibrating excessively",
            });

            expect(result.status).toBe("DEGRADED");
        });

        it("rejects TECHNICIAN on OPERATIONAL -> RETIRED with ForbiddenError", async () => {
            mocks.auth.mockResolvedValue({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            await expect(
                transitionAssetStatus(WS_ID, "ast_status_1", {
                    toStatus: "RETIRED",
                    statusReason: "Trying to retire asset as tech",
                })
            ).rejects.toThrow(ForbiddenError);
        });

        it("rejects TECHNICIAN on OPERATIONAL -> DEGRADED if not assigned to active work order", async () => {
            mocks.auth.mockResolvedValue({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            mocks.workOrderFindFirst.mockResolvedValue(null); // No work order

            await expect(
                transitionAssetStatus(WS_ID, "ast_status_1", {
                    toStatus: "DEGRADED",
                    statusReason: "Technician unassigned trying to change status",
                })
            ).rejects.toThrow(ForbiddenError);
        });
    });

    // -----------------------------------------------------------------------
    // 4. Invalid Transitions & Terminal State Invariants
    // -----------------------------------------------------------------------
    describe("4. Invalid Transitions & Terminal State", () => {
        it("rejects invalid state transition (IN_STORAGE -> DEGRADED) with AssetInvalidStatusTransitionError", async () => {
            assetsList[0] = makeAsset("IN_STORAGE");

            await expect(
                transitionAssetStatus(WS_ID, "ast_status_1", {
                    toStatus: "DEGRADED",
                    statusReason: "Not allowed",
                })
            ).rejects.toThrow(AssetInvalidStatusTransitionError);
        });

        it("rejects any outbound transition from RETIRED with AssetImmutableError", async () => {
            assetsList[0] = makeAsset("RETIRED");

            await expect(
                transitionAssetStatus(WS_ID, "ast_status_1", {
                    toStatus: "OPERATIONAL",
                })
            ).rejects.toThrow(AssetImmutableError);
        });
    });

    // -----------------------------------------------------------------------
    // 5. retireAsset() Wrapper
    // -----------------------------------------------------------------------
    describe("5. retireAsset() Service Wrapper", () => {
        it("retires asset through wrapper and sets retiredAt timestamp", async () => {
            const result = await retireAsset(WS_ID, "ast_status_1", {
                statusReason: "Unit damaged beyond repair; scrapped",
            });

            expect(result.status).toBe("RETIRED");
            expect(result.retiredAt).toBeInstanceOf(Date);
            expect(historyList[0].eventType).toBe("RETIRED");
        });
    });
});
