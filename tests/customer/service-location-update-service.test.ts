import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    customerFindFirst: vi.fn(),
    serviceLocationFindFirst: vi.fn(),
    serviceLocationUpdate: vi.fn(),
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
            update: mocks.serviceLocationUpdate,
        },
    },
}));

import { updateServiceLocation } from "@/lib/services/customer/updateServiceLocation";
import {
    CustomerNotFoundError,
    ServiceLocationNotFoundError,
    InactiveCustomerError,
    ServiceLocationPrimaryExistsError,
    ServiceLocationUpdateError,
} from "@/lib/services/customer/customerErrors";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
    WorkspaceNotFoundError,
} from "@/lib/services/authorization/authorizationErrors";
import {
    Prisma,
    type Customer,
    type ServiceLocation,
    type User,
    type Workspace,
    type WorkspaceMember,
} from "@/generated/prisma/client";

describe("Phase 1.4.21 — Service Location Update Service Suite", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let customersList: Customer[];
    let locationsList: ServiceLocation[];

    const WS_ID_1 = "ws_alpha_100";
    const WS_ID_2 = "ws_beta_200";

    beforeEach(() => {
        vi.clearAllMocks();
        usersMap = new Map();
        workspacesMap = new Map();
        membersMap = new Map();
        customersList = [];
        locationsList = [];

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

        mocks.customerFindFirst.mockImplementation(async ({ where }: any) => {
            return (
                customersList.find((c) => {
                    if (where.id && c.id !== where.id) return false;
                    if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
                    return true;
                }) || null
            );
        });

        mocks.serviceLocationFindFirst.mockImplementation(async ({ where }: any) => {
            return (
                locationsList.find((loc) => {
                    if (where.id && loc.id !== where.id) return false;
                    if (where.customerId && loc.customerId !== where.customerId) return false;
                    if (where.isPrimary !== undefined && loc.isPrimary !== where.isPrimary) return false;
                    if (where.NOT && where.NOT.id && loc.id === where.NOT.id) return false;
                    return true;
                }) || null
            );
        });

        mocks.serviceLocationUpdate.mockImplementation(async ({ where, data }: any) => {
            const index = locationsList.findIndex((l) => l.id === where.id);
            if (index === -1) {
                throw new Error("ServiceLocation not found in mock store");
            }

            const existing = locationsList[index]!;

            if (data.isPrimary === true && !existing.isPrimary) {
                const otherPrimary = locationsList.find(
                    (l) => l.customerId === existing.customerId && l.isPrimary === true && l.id !== existing.id
                );
                if (otherPrimary) {
                    const err = new Error("Unique constraint failed on the fields: (`customerId`,`isPrimary`)");
                    (err as any).code = "P2002";
                    throw err;
                }
            }

            const updated: ServiceLocation = {
                ...existing,
                ...data,
                updatedAt: new Date(),
            };
            locationsList[index] = updated;
            return updated;
        });

        registerWorkspace(WS_ID_1, "Alpha Operations", "alpha-ops");
        registerWorkspace(WS_ID_2, "Beta Operations", "beta-ops");
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
        status = "ACTIVE"
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

    function seedCustomer(
        id: string,
        workspaceId: string,
        name: string,
        status: "ACTIVE" | "INACTIVE" = "ACTIVE"
    ): Customer {
        const customer: Customer = {
            id,
            workspaceId,
            customerNumber: "CUST-00001",
            name,
            email: "info@client.com",
            phone: "+1-555-0100",
            website: "https://client.com",
            addressLine1: "100 Broadway",
            addressLine2: null,
            city: "New York",
            state: "NY",
            postalCode: "10001",
            country: "USA",
            status,
            notes: "Client for service location update tests",
            createdAt: new Date("2026-08-19T10:00:00.000Z"),
            updatedAt: new Date("2026-08-19T10:00:00.000Z"),
        };
        customersList.push(customer);
        return customer;
    }

    function seedLocation(
        id: string,
        customerId: string,
        name: string,
        isPrimary = false,
        addressLine1 = "100 Main St",
        addressLine2: string | null = null,
        city = "Austin",
        state: string | null = "TX",
        postalCode: string | null = "78701",
        country = "USA"
    ): ServiceLocation {
        const location: ServiceLocation = {
            id,
            customerId,
            name,
            addressLine1,
            addressLine2,
            city,
            state,
            postalCode,
            country,
            latitude: new Prisma.Decimal("30.267153"),
            longitude: new Prisma.Decimal("-97.743057"),
            notes: "Original location notes",
            isPrimary,
            createdAt: new Date("2026-08-19T10:00:00.000Z"),
            updatedAt: new Date("2026-08-19T10:00:00.000Z"),
        };
        locationsList.push(location);
        return location;
    }

    describe("1. Authorization & RBAC Checks", () => {
        beforeEach(() => {
            seedCustomer("cust_1", WS_ID_1, "Client Corp");
            seedLocation("loc_1", "cust_1", "Austin Plant");
        });

        it("rejects unauthenticated caller with UnauthorizedError", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(
                updateServiceLocation(WS_ID_1, "cust_1", "loc_1", { name: "Updated Plant" })
            ).rejects.toThrow(UnauthorizedError);
        });

        it("rejects inactive workspace membership with WorkspaceAccessDeniedError", async () => {
            registerUser("user_suspended");
            registerMember("user_suspended", WS_ID_1, "ADMIN", "SUSPENDED");
            loginAs("user_suspended");

            await expect(
                updateServiceLocation(WS_ID_1, "cust_1", "loc_1", { name: "Updated Plant" })
            ).rejects.toThrow(WorkspaceAccessDeniedError);
        });

        it("rejects deactivated user with WorkspaceAccessDeniedError", async () => {
            registerUser("user_deactivated", "Deactivated", "DEACTIVATED");
            registerMember("user_deactivated", WS_ID_1, "ADMIN");
            loginAs("user_deactivated");

            await expect(
                updateServiceLocation(WS_ID_1, "cust_1", "loc_1", { name: "Updated Plant" })
            ).rejects.toThrow(WorkspaceAccessDeniedError);
        });

        it("rejects non-existent workspace with WorkspaceNotFoundError", async () => {
            registerUser("user_admin");
            registerMember("user_admin", "ws_nonexistent", "ADMIN");
            loginAs("user_admin");

            await expect(
                updateServiceLocation("ws_nonexistent", "cust_1", "loc_1", { name: "Updated Plant" })
            ).rejects.toThrow(WorkspaceNotFoundError);
        });

        it("allows OWNER to update a service location", async () => {
            registerUser("user_owner");
            registerMember("user_owner", WS_ID_1, "OWNER");
            loginAs("user_owner");

            const updated = await updateServiceLocation(WS_ID_1, "cust_1", "loc_1", { name: "OwnerUpdated" });
            expect(updated.name).toBe("OwnerUpdated");
        });

        it("allows ADMIN to update a service location", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            const updated = await updateServiceLocation(WS_ID_1, "cust_1", "loc_1", { name: "AdminUpdated" });
            expect(updated.name).toBe("AdminUpdated");
        });

        it("allows MANAGER to update a service location", async () => {
            registerUser("user_mgr");
            registerMember("user_mgr", WS_ID_1, "MANAGER");
            loginAs("user_mgr");

            const updated = await updateServiceLocation(WS_ID_1, "cust_1", "loc_1", { name: "ManagerUpdated" });
            expect(updated.name).toBe("ManagerUpdated");
        });

        it("allows DISPATCHER to update a service location", async () => {
            registerUser("user_disp");
            registerMember("user_disp", WS_ID_1, "DISPATCHER");
            loginAs("user_disp");

            const updated = await updateServiceLocation(WS_ID_1, "cust_1", "loc_1", { name: "DispatcherUpdated" });
            expect(updated.name).toBe("DispatcherUpdated");
        });

        it("rejects TECHNICIAN with ForbiddenError", async () => {
            registerUser("user_tech");
            registerMember("user_tech", WS_ID_1, "TECHNICIAN");
            loginAs("user_tech");

            await expect(
                updateServiceLocation(WS_ID_1, "cust_1", "loc_1", { name: "Updated Plant" })
            ).rejects.toThrow(ForbiddenError);
        });

        it("rejects ACCOUNTANT with ForbiddenError", async () => {
            registerUser("user_acct");
            registerMember("user_acct", WS_ID_1, "ACCOUNTANT");
            loginAs("user_acct");

            await expect(
                updateServiceLocation(WS_ID_1, "cust_1", "loc_1", { name: "Updated Plant" })
            ).rejects.toThrow(ForbiddenError);
        });
    });

    describe("2. Tenant Isolation & Ownership Enforcement", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_ws1", WS_ID_1, "Customer WS1");
            seedCustomer("cust_ws1_alt", WS_ID_1, "Customer WS1 Alt");
            seedCustomer("cust_ws2", WS_ID_2, "Customer WS2");

            seedLocation("loc_ws1", "cust_ws1", "Location WS1");
            seedLocation("loc_ws2", "cust_ws2", "Location WS2");
        });

        it("allows update when customer and location match authorized workspace", async () => {
            const updated = await updateServiceLocation(WS_ID_1, "cust_ws1", "loc_ws1", {
                name: "Updated WS1 Location",
            });
            expect(updated.name).toBe("Updated WS1 Location");
        });

        it("rejects updating location for customer in another workspace with CustomerNotFoundError", async () => {
            await expect(
                updateServiceLocation(WS_ID_1, "cust_ws2", "loc_ws2", { name: "Hacker Update" })
            ).rejects.toThrow(CustomerNotFoundError);
        });

        it("rejects updating location using incorrect customerId with ServiceLocationNotFoundError", async () => {
            await expect(
                updateServiceLocation(WS_ID_1, "cust_ws1_alt", "loc_ws1", { name: "Mismatch Update" })
            ).rejects.toThrow(ServiceLocationNotFoundError);
        });

        it("strips client-injected customerId and workspaceId", async () => {
            const updated = await updateServiceLocation(WS_ID_1, "cust_ws1", "loc_ws1", {
                name: "CleanLocation",
                customerId: "cust_malicious",
                workspaceId: "ws_malicious",
                id: "forged_id",
            } as any);

            expect(updated.name).toBe("CleanLocation");
            expect(updated.customerId).toBe("cust_ws1");
            expect(updated.id).toBe("loc_ws1");
        });
    });

    describe("3. Customer Lifecycle Rule (ACTIVE vs INACTIVE)", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");
        });

        it("allows location update for an ACTIVE customer", async () => {
            seedCustomer("cust_act", WS_ID_1, "Active Customer", "ACTIVE");
            seedLocation("loc_act", "cust_act", "Active Location");

            const updated = await updateServiceLocation(WS_ID_1, "cust_act", "loc_act", {
                notes: "Updated active location",
            });
            expect(updated.notes).toBe("Updated active location");
        });

        it("rejects location update for an INACTIVE customer with InactiveCustomerError", async () => {
            seedCustomer("cust_inact", WS_ID_1, "Inactive Customer", "INACTIVE");
            seedLocation("loc_inact", "cust_inact", "Inactive Location");

            await expect(
                updateServiceLocation(WS_ID_1, "cust_inact", "loc_inact", {
                    notes: "Should fail",
                })
            ).rejects.toThrow(InactiveCustomerError);
        });
    });

    describe("4. Partial Updates, Nullable Fields & Normalization", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Client Corp");
            seedLocation(
                "loc_1",
                "cust_1",
                "Original Hub",
                false,
                "100 Original Way",
                "Suite 100",
                "Austin",
                "TX",
                "78701",
                "USA"
            );
        });

        it("updates single field while preserving unspecified fields", async () => {
            const updated = await updateServiceLocation(WS_ID_1, "cust_1", "loc_1", {
                name: "New Hub Name",
            });

            expect(updated.name).toBe("New Hub Name");
            expect(updated.addressLine1).toBe("100 Original Way");
            expect(updated.city).toBe("Austin");
            expect(updated.state).toBe("TX");
            expect(updated.country).toBe("USA");
        });

        it("updates coordinates with Decimal precision", async () => {
            const updated = await updateServiceLocation(WS_ID_1, "cust_1", "loc_1", {
                latitude: 32.7767,
                longitude: -96.797,
            });

            expect(updated.latitude).toEqual(new Prisma.Decimal("32.7767"));
            expect(updated.longitude).toEqual(new Prisma.Decimal("-96.797"));
        });

        it("explicitly clears nullable fields when set to null", async () => {
            const updated = await updateServiceLocation(WS_ID_1, "cust_1", "loc_1", {
                addressLine2: null,
                state: null,
                postalCode: null,
                latitude: null,
                longitude: null,
                notes: null,
            });

            expect(updated.addressLine2).toBeNull();
            expect(updated.state).toBeNull();
            expect(updated.postalCode).toBeNull();
            expect(updated.latitude).toBeNull();
            expect(updated.longitude).toBeNull();
            expect(updated.notes).toBeNull();
            expect(updated.name).toBe("Original Hub");
        });

        it("accepts empty object {} without changing any field values", async () => {
            const updated = await updateServiceLocation(WS_ID_1, "cust_1", "loc_1", {});
            expect(updated.name).toBe("Original Hub");
            expect(updated.addressLine1).toBe("100 Original Way");
        });
    });

    describe("5. Primary Location Promotion, Demotion & Concurrency", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Client Corp");
        });

        it("promotes non-primary location to primary when no other primary exists", async () => {
            seedLocation("loc_solo", "cust_1", "Solo Site", false);

            const updated = await updateServiceLocation(WS_ID_1, "cust_1", "loc_solo", {
                isPrimary: true,
            });
            expect(updated.isPrimary).toBe(true);
        });

        it("demotes primary location to non-primary (isPrimary: false)", async () => {
            seedLocation("loc_prim", "cust_1", "Primary Site", true);

            const updated = await updateServiceLocation(WS_ID_1, "cust_1", "loc_prim", {
                isPrimary: false,
            });
            expect(updated.isPrimary).toBe(false);
        });

        it("is idempotent when updating an already primary location with isPrimary: true", async () => {
            seedLocation("loc_prim", "cust_1", "Primary Site", true);

            const updated = await updateServiceLocation(WS_ID_1, "cust_1", "loc_prim", {
                isPrimary: true,
                name: "Updated Primary Name",
            });
            expect(updated.isPrimary).toBe(true);
            expect(updated.name).toBe("Updated Primary Name");
        });

        it("rejects promoting location to primary when another primary already exists", async () => {
            seedLocation("loc_existing_primary", "cust_1", "Existing Primary", true);
            seedLocation("loc_secondary", "cust_1", "Secondary Site", false);

            await expect(
                updateServiceLocation(WS_ID_1, "cust_1", "loc_secondary", {
                    isPrimary: true,
                })
            ).rejects.toThrow(ServiceLocationPrimaryExistsError);

            const existingPrimary = locationsList.find((l) => l.id === "loc_existing_primary");
            expect(existingPrimary?.isPrimary).toBe(true);
        });

        it("translates concurrent primary promotion collision (P2002) into ServiceLocationPrimaryExistsError", async () => {
            seedLocation("loc_race", "cust_1", "Race Site", false);

            // Simulate pre-check passing, but race condition triggering P2002 during update
            mocks.serviceLocationFindFirst.mockImplementation(async ({ where }: any) => {
                if (where.id === "loc_race") return locationsList.find((l) => l.id === "loc_race");
                if (where.isPrimary === true) return null; // Pre-check sees no primary
                return null;
            });

            mocks.serviceLocationUpdate.mockRejectedValueOnce(
                Object.assign(new Error("Unique constraint failed on the fields: (`customerId`,`isPrimary`)"), {
                    code: "P2002",
                })
            );

            await expect(
                updateServiceLocation(WS_ID_1, "cust_1", "loc_race", {
                    isPrimary: true,
                })
            ).rejects.toThrow(ServiceLocationPrimaryExistsError);
        });

        it("masks unexpected database failures into ServiceLocationUpdateError", async () => {
            seedLocation("loc_1", "cust_1", "Austin Hub");

            mocks.serviceLocationUpdate.mockRejectedValueOnce(new Error("Database write lock timeout"));

            await expect(
                updateServiceLocation(WS_ID_1, "cust_1", "loc_1", {
                    name: "Renamed Hub",
                })
            ).rejects.toThrow(ServiceLocationUpdateError);
        });
    });
});
