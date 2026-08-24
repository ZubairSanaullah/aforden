import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    customerFindFirst: vi.fn(),
    serviceLocationFindFirst: vi.fn(),
    assetCategoryFindFirst: vi.fn(),
    assetFindFirst: vi.fn(),
    assetCreate: vi.fn(),
    assetHistoryCreate: vi.fn(),
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
        customer: {
            findFirst: mocks.customerFindFirst,
        },
        serviceLocation: {
            findFirst: mocks.serviceLocationFindFirst,
        },
        assetCategory: {
            findFirst: mocks.assetCategoryFindFirst,
        },
        asset: {
            findFirst: mocks.assetFindFirst,
            create: mocks.assetCreate,
        },
        assetHistory: {
            create: mocks.assetHistoryCreate,
        },
        $transaction: mocks.transaction,
    },
}));

import { createAsset } from "@/lib/services/asset/createAsset";
import {
    AssetCustomerNotFoundError,
    AssetCustomerInactiveError,
    AssetLocationNotFoundError,
    AssetLocationCustomerMismatchError,
    AssetLocationRequiresCustomerError,
    AssetCategoryNotFoundError,
    AssetCategoryInactiveError,
    DuplicateAssetNumberError,
} from "@/lib/services/asset/assetErrors";
import {
    UnauthorizedError,
    ForbiddenError,
} from "@/lib/services/authorization/authorizationErrors";
import type {
    Customer,
    ServiceLocation,
    AssetCategory,
    Asset,
    User,
    Workspace,
    WorkspaceMember,
} from "@/generated/prisma/client";

describe("Phase 1.7.4 — Asset Creation Service Unit Tests", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let customersList: Customer[];
    let locationsList: ServiceLocation[];
    let categoriesList: AssetCategory[];
    let assetsList: Asset[];
    let historyList: any[];

    const WS_ID = "ws_test_alpha";
    const WS_ID_BETA = "ws_test_beta";

    const USER_ADMIN: User = {
        id: "user_admin_1",
        name: "Admin User",
        email: "admin@test.com",
        emailVerified: new Date(),
        passwordHash: "hash",
        avatarUrl: null,
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const USER_TECH: User = {
        id: "user_tech_2",
        name: "Tech User",
        email: "tech@test.com",
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

    const MEMBER_TECH: WorkspaceMember = {
        id: "mem_tech_2",
        workspaceId: WS_ID,
        userId: USER_TECH.id,
        role: "TECHNICIAN",
        status: "ACTIVE",
        createdAt: new Date(),
        updatedAt: new Date(),
    };

    const makeCustomer = (overrides: Partial<Customer>): Customer => ({
        id: "cust_1",
        workspaceId: WS_ID,
        name: "Acme Industrial",
        customerNumber: "CUST-000001",
        status: "ACTIVE",
        email: null,
        phone: null,
        website: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        state: null,
        postalCode: null,
        country: null,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    });

    const makeLocation = (overrides: Partial<ServiceLocation>): ServiceLocation => ({
        id: "loc_1",
        customerId: "cust_1",
        name: "HQ Plant",
        addressLine1: "100 Main St",
        addressLine2: null,
        city: "Dallas",
        state: "TX",
        postalCode: "75001",
        country: "USA",
        latitude: 32.77 as any,
        longitude: -96.79 as any,
        isPrimary: false,
        notes: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
    });

    beforeEach(() => {
        vi.clearAllMocks();

        usersMap = new Map([
            [USER_ADMIN.id, USER_ADMIN],
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
            [
                WS_ID_BETA,
                {
                    id: WS_ID_BETA,
                    name: "Beta Corp",
                    slug: "beta-corp",
                    logoUrl: null,
                    timezone: "America/Chicago",
                    defaultCurrencyCode: "USD",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ],
        ]);

        membersMap = new Map([
            [`${WS_ID}_${USER_ADMIN.id}`, MEMBER_ADMIN],
            [`${WS_ID}_${USER_TECH.id}`, MEMBER_TECH],
        ]);

        customersList = [
            makeCustomer({ id: "cust_1", workspaceId: WS_ID, name: "Acme Industrial" }),
            makeCustomer({ id: "cust_inactive", workspaceId: WS_ID, status: "INACTIVE", name: "Old Corp Inactive" }),
            makeCustomer({ id: "cust_beta", workspaceId: WS_ID_BETA, name: "Beta Customer" }),
        ];

        locationsList = [
            makeLocation({ id: "loc_1", customerId: "cust_1", name: "HQ Plant" }),
            makeLocation({ id: "loc_beta", customerId: "cust_beta", name: "Beta Plant" }),
        ];

        categoriesList = [
            {
                id: "cat_1",
                workspaceId: WS_ID,
                name: "Commercial HVAC",
                code: "HVAC",
                description: "HVAC systems",
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            {
                id: "cat_inactive",
                workspaceId: WS_ID,
                name: "Obsolete Category",
                code: "OBS",
                description: null,
                status: "INACTIVE",
                sortOrder: 2,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
            {
                id: "cat_beta",
                workspaceId: WS_ID_BETA,
                name: "Beta Cat",
                code: "BC",
                description: null,
                status: "ACTIVE",
                sortOrder: 1,
                createdAt: new Date(),
                updatedAt: new Date(),
            },
        ];

        assetsList = [];
        historyList = [];

        // Setup auth mocks
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

        mocks.customerFindFirst.mockImplementation(async ({ where }: any) => {
            return (
                customersList.find(
                    (c) => c.id === where.id && c.workspaceId === where.workspaceId
                ) || null
            );
        });

        mocks.serviceLocationFindFirst.mockImplementation(async ({ where }: any) => {
            return (
                locationsList.find((l) => {
                    if (l.id !== where.id) return false;
                    if (where.customer?.workspaceId) {
                        const parentCust = customersList.find((c) => c.id === l.customerId);
                        return parentCust?.workspaceId === where.customer.workspaceId;
                    }
                    return true;
                }) || null
            );
        });

        mocks.assetCategoryFindFirst.mockImplementation(async ({ where }: any) => {
            return (
                categoriesList.find(
                    (c) => c.id === where.id && c.workspaceId === where.workspaceId
                ) || null
            );
        });

        mocks.assetFindFirst.mockImplementation(async ({ where, orderBy }: any) => {
            const matches = assetsList.filter((a) => a.workspaceId === where.workspaceId);
            if (orderBy?.assetNumber === "desc") {
                matches.sort((a, b) => b.assetNumber.localeCompare(a.assetNumber));
            }
            return matches[0] || null;
        });

        mocks.assetCreate.mockImplementation(async ({ data, include }: any) => {
            const newAsset: any = {
                id: `ast_${assetsList.length + 1}`,
                workspaceId: data.workspaceId,
                assetNumber: data.assetNumber,
                name: data.name,
                customerId: data.customerId,
                locationId: data.locationId,
                categoryId: data.categoryId,
                manufacturer: data.manufacturer,
                modelNumber: data.modelNumber,
                serialNumber: data.serialNumber,
                status: data.status,
                subLocationNotes: data.subLocationNotes,
                installationDate: data.installationDate,
                warrantyExpiresAt: data.warrantyExpiresAt,
                purchaseDate: data.purchaseDate,
                purchaseCost: data.purchaseCost,
                notes: data.notes,
                tags: data.tags || [],
                metadata: data.metadata || null,
                decommissionedAt: null,
                retiredAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            if (include?.customer) {
                newAsset.customer = customersList.find((c) => c.id === data.customerId) || null;
            }
            if (include?.location) {
                newAsset.location = locationsList.find((l) => l.id === data.locationId) || null;
            }
            if (include?.category) {
                newAsset.category = categoriesList.find((c) => c.id === data.categoryId) || null;
            }

            assetsList.push(newAsset);
            return newAsset;
        });

        mocks.assetHistoryCreate.mockImplementation(async ({ data }: any) => {
            const entry = { id: `asthist_${historyList.length + 1}`, ...data };
            historyList.push(entry);
            return entry;
        });

        mocks.transaction.mockImplementation(async (callback: any) => {
            return callback({
                asset: {
                    findFirst: mocks.assetFindFirst,
                    create: mocks.assetCreate,
                },
                assetHistory: {
                    create: mocks.assetHistoryCreate,
                },
            });
        });
    });

    // -----------------------------------------------------------------------
    // 1. Authentication & RBAC
    // -----------------------------------------------------------------------
    describe("1. Authentication & RBAC", () => {
        it("throws UnauthorizedError when session is missing", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(
                createAsset(WS_ID, { name: "Test Chiller" })
            ).rejects.toThrow(UnauthorizedError);
        });

        it("throws ForbiddenError when user has TECHNICIAN role (lacks ASSETS_CREATE)", async () => {
            mocks.auth.mockResolvedValue({
                user: { id: USER_TECH.id, email: USER_TECH.email },
            });

            await expect(
                createAsset(WS_ID, { name: "Test Chiller" })
            ).rejects.toThrow(ForbiddenError);
        });
    });

    // -----------------------------------------------------------------------
    // 2. Happy Paths & Default States
    // -----------------------------------------------------------------------
    describe("2. Happy Path Creation", () => {
        it("creates installed asset with customer, location, category, and auto-generated assetNumber", async () => {
            const result = await createAsset(WS_ID, {
                name: "Rooftop Chiller Unit #1",
                customerId: "cust_1",
                locationId: "loc_1",
                categoryId: "cat_1",
                manufacturer: "Carrier",
                modelNumber: "30RAP-055",
                serialNumber: "SN-998811",
                tags: ["critical-infrastructure", "rooftop"],
                metadata: { tonnage: 55 },
            });

            expect(result.id).toBeDefined();
            expect(result.workspaceId).toBe(WS_ID);
            expect(result.assetNumber).toBe("AST-000001");
            expect(result.status).toBe("OPERATIONAL");
            expect(result.customer).toEqual({
                id: "cust_1",
                customerNumber: "CUST-000001",
                name: "Acme Industrial",
            });
            expect(result.location).toEqual({
                id: "loc_1",
                name: "HQ Plant",
                addressLine1: "100 Main St",
                city: "Dallas",
                state: "TX",
                latitude: 32.77,
                longitude: -96.79,
            });
            expect(result.category).toEqual({
                id: "cat_1",
                name: "Commercial HVAC",
                code: "HVAC",
            });

            // Assert AssetHistory CREATED record was written
            expect(historyList).toHaveLength(1);
            expect(historyList[0].eventType).toBe("CREATED");
            expect(historyList[0].actorUserId).toBe(USER_ADMIN.id);
            expect(historyList[0].actorRole).toBe("ADMIN");
            expect(historyList[0].metadata.assetNumber).toBe("AST-000001");
        });

        it("creates depot asset (null customer and location) and defaults status to IN_STORAGE", async () => {
            const result = await createAsset(WS_ID, {
                name: "Portable Emergency Generator 50kW",
                customerId: null,
                locationId: null,
            });

            expect(result.assetNumber).toBe("AST-000001");
            expect(result.status).toBe("IN_STORAGE");
            expect(result.customer).toBeNull();
            expect(result.location).toBeNull();
        });

        it("creates asset with explicit assetNumber and explicit status", async () => {
            const result = await createAsset(WS_ID, {
                name: "Standby Pump Unit",
                assetNumber: "AST-CUSTOM-99",
                status: "IN_STORAGE",
                customerId: null,
                locationId: null,
            });

            expect(result.assetNumber).toBe("AST-CUSTOM-99");
            expect(result.status).toBe("IN_STORAGE");
        });

        it("increments sequential assetNumber automatically", async () => {
            assetsList.push({
                id: "ast_pre",
                workspaceId: WS_ID,
                assetNumber: "AST-000042",
                name: "Existing Asset",
                customerId: null,
                locationId: null,
                categoryId: null,
                manufacturer: null,
                modelNumber: null,
                serialNumber: null,
                status: "OPERATIONAL",
                subLocationNotes: null,
                installationDate: null,
                warrantyExpiresAt: null,
                purchaseDate: null,
                purchaseCost: null,
                notes: null,
                tags: [],
                metadata: null,
                decommissionedAt: null,
                retiredAt: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await createAsset(WS_ID, {
                name: "Next Asset in Sequence",
            });

            expect(result.assetNumber).toBe("AST-000043");
        });
    });

    // -----------------------------------------------------------------------
    // 3. Resolution & Invariant Violations
    // -----------------------------------------------------------------------
    describe("3. Resolution & Invariants", () => {
        it("throws AssetCustomerNotFoundError if customerId does not exist", async () => {
            await expect(
                createAsset(WS_ID, {
                    name: "Chiller",
                    customerId: "non_existent_customer",
                })
            ).rejects.toThrow(AssetCustomerNotFoundError);
        });

        it("throws AssetCustomerNotFoundError for cross-tenant customerId (IDOR protection)", async () => {
            await expect(
                createAsset(WS_ID, {
                    name: "Chiller",
                    customerId: "cust_beta", // belongs to WS_ID_BETA
                })
            ).rejects.toThrow(AssetCustomerNotFoundError);
        });

        it("throws AssetCustomerInactiveError if target customer is inactive", async () => {
            await expect(
                createAsset(WS_ID, {
                    name: "Chiller",
                    customerId: "cust_inactive",
                })
            ).rejects.toThrow(AssetCustomerInactiveError);
        });

        it("throws AssetLocationRequiresCustomerError if locationId is provided without customerId (Depot Rule Invariant 2)", async () => {
            await expect(
                createAsset(WS_ID, {
                    name: "Chiller",
                    customerId: null,
                    locationId: "loc_1",
                })
            ).rejects.toThrow(AssetLocationRequiresCustomerError);
        });

        it("throws AssetLocationNotFoundError if locationId does not exist in workspace", async () => {
            await expect(
                createAsset(WS_ID, {
                    name: "Chiller",
                    customerId: "cust_1",
                    locationId: "non_existent_location",
                })
            ).rejects.toThrow(AssetLocationNotFoundError);
        });

        it("throws AssetLocationCustomerMismatchError if location does not belong to the customer", async () => {
            // Add a second active customer in same workspace
            customersList.push(
                makeCustomer({
                    id: "cust_2",
                    workspaceId: WS_ID,
                    name: "Second Corp",
                    customerNumber: "CUST-000004",
                })
            );

            await expect(
                createAsset(WS_ID, {
                    name: "Chiller",
                    customerId: "cust_2",
                    locationId: "loc_1", // loc_1 belongs to cust_1
                })
            ).rejects.toThrow(AssetLocationCustomerMismatchError);
        });

        it("throws AssetCategoryNotFoundError if categoryId does not exist", async () => {
            await expect(
                createAsset(WS_ID, {
                    name: "Chiller",
                    categoryId: "non_existent_category",
                })
            ).rejects.toThrow(AssetCategoryNotFoundError);
        });

        it("throws AssetCategoryNotFoundError for cross-tenant categoryId", async () => {
            await expect(
                createAsset(WS_ID, {
                    name: "Chiller",
                    categoryId: "cat_beta",
                })
            ).rejects.toThrow(AssetCategoryNotFoundError);
        });

        it("throws AssetCategoryInactiveError if category is INACTIVE", async () => {
            await expect(
                createAsset(WS_ID, {
                    name: "Chiller",
                    categoryId: "cat_inactive",
                })
            ).rejects.toThrow(AssetCategoryInactiveError);
        });

        it("throws DuplicateAssetNumberError if explicit assetNumber collides", async () => {
            mocks.assetCreate.mockRejectedValueOnce({
                code: "P2002",
                message: "Unique constraint failed on the fields: (`workspaceId`,`assetNumber`)",
            });

            await expect(
                createAsset(WS_ID, {
                    name: "Chiller",
                    assetNumber: "AST-DUPLICATE-01",
                })
            ).rejects.toThrow(DuplicateAssetNumberError);
        });
    });

    // -----------------------------------------------------------------------
    // 4. Transaction Atomicity & Rollback
    // -----------------------------------------------------------------------
    describe("4. Transaction Atomicity & Rollback", () => {
        it("rolls back transaction and fails asset creation if AssetHistory.create fails", async () => {
            // Simulate AssetHistory creation failure inside the transaction
            mocks.assetHistoryCreate.mockRejectedValueOnce(
                new Error("Database disk full or constraint violation during audit write")
            );

            await expect(
                createAsset(WS_ID, {
                    name: "Rollback Test Chiller",
                    customerId: "cust_1",
                    locationId: "loc_1",
                })
            ).rejects.toThrow("Database disk full or constraint violation during audit write");
        });
    });
});
