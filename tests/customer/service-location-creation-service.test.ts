import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    customerFindFirst: vi.fn(),
    serviceLocationFindFirst: vi.fn(),
    serviceLocationCreate: vi.fn(),
    serviceLocationCount: vi.fn(),
    workspaceEntitlementOverrideFindUnique: vi.fn(),
    subscriptionFindFirst: vi.fn(),
    $transaction: vi.fn(async (cb: any) => cb({
        serviceLocation: {
            findFirst: mocks.serviceLocationFindFirst,
            create: mocks.serviceLocationCreate,
            count: mocks.serviceLocationCount,
        },
        workspace: {
            findUnique: mocks.workspaceFindUnique,
        },
        workspaceEntitlementOverride: {
            findUnique: mocks.workspaceEntitlementOverrideFindUnique,
        },
        subscription: {
            findFirst: mocks.subscriptionFindFirst,
        },
    })),
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
            create: mocks.serviceLocationCreate,
            count: mocks.serviceLocationCount,
        },
        workspaceEntitlementOverride: {
            findUnique: mocks.workspaceEntitlementOverrideFindUnique,
        },
        subscription: {
            findFirst: mocks.subscriptionFindFirst,
        },
        $transaction: mocks.$transaction,
    },
}));

import { createServiceLocation } from "@/lib/services/customer/createServiceLocation";
import {
    CustomerNotFoundError,
    InactiveCustomerError,
    ServiceLocationCreationError,
    ServiceLocationPrimaryExistsError,
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

describe("Phase 1.4.19 — Service Location Creation Service Layer", () => {
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
                    if (where.customerId && loc.customerId !== where.customerId) return false;
                    if (where.isPrimary !== undefined && loc.isPrimary !== where.isPrimary) return false;
                    return true;
                }) || null
            );
        });

        mocks.serviceLocationCreate.mockImplementation(async ({ data }: any) => {
            if (data.isPrimary) {
                const existingPrimary = locationsList.find(
                    (l) => l.customerId === data.customerId && l.isPrimary === true
                );
                if (existingPrimary) {
                    const err = new Error("Unique constraint failed on the fields: (`customerId`,`isPrimary`)");
                    (err as any).code = "P2002";
                    throw err;
                }
            }

            const location: ServiceLocation = {
                id: `loc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                customerId: data.customerId,
                name: data.name,
                addressLine1: data.addressLine1,
                addressLine2: data.addressLine2 ?? null,
                city: data.city,
                state: data.state ?? null,
                postalCode: data.postalCode ?? null,
                country: data.country,
                latitude: data.latitude ?? null,
                longitude: data.longitude ?? null,
                notes: data.notes ?? null,
                isPrimary: data.isPrimary ?? false,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            locationsList.push(location);
            return location;
        });

        registerWorkspace(WS_ID_1, "Alpha Operations", "alpha-ops");
        registerWorkspace(WS_ID_2, "Beta Operations", "beta-ops");
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
            notes: "Client for service location tests",
            createdAt: new Date("2026-08-19T10:00:00.000Z"),
            updatedAt: new Date("2026-08-19T10:00:00.000Z"),
        };
        customersList.push(customer);
        return customer;
    }

    describe("1. Authorization & RBAC Checks", () => {
        const validPayload = {
            name: "Headquarters",
            addressLine1: "100 Main St",
            city: "Austin",
            country: "USA",
        };

        it("rejects unauthenticated caller with UnauthorizedError", async () => {
            mocks.auth.mockResolvedValue(null);
            seedCustomer("cust_1", WS_ID_1, "Client Corp");

            await expect(createServiceLocation(WS_ID_1, "cust_1", validPayload)).rejects.toThrow(
                UnauthorizedError
            );
        });

        it("rejects inactive workspace membership with WorkspaceAccessDeniedError", async () => {
            registerUser("user_suspended");
            registerMember("user_suspended", WS_ID_1, "ADMIN", "SUSPENDED");
            loginAs("user_suspended");
            seedCustomer("cust_1", WS_ID_1, "Client Corp");

            await expect(createServiceLocation(WS_ID_1, "cust_1", validPayload)).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
        });

        it("rejects deactivated user with WorkspaceAccessDeniedError", async () => {
            registerUser("user_deactivated", "Deactivated", "DEACTIVATED");
            registerMember("user_deactivated", WS_ID_1, "ADMIN");
            loginAs("user_deactivated");
            seedCustomer("cust_1", WS_ID_1, "Client Corp");

            await expect(createServiceLocation(WS_ID_1, "cust_1", validPayload)).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
        });

        it("rejects non-existent workspace with WorkspaceNotFoundError", async () => {
            registerUser("user_admin");
            registerMember("user_admin", "ws_nonexistent", "ADMIN");
            loginAs("user_admin");

            await expect(createServiceLocation("ws_nonexistent", "cust_1", validPayload)).rejects.toThrow(
                WorkspaceNotFoundError
            );
        });

        it("allows OWNER to create a service location", async () => {
            registerUser("user_owner");
            registerMember("user_owner", WS_ID_1, "OWNER");
            loginAs("user_owner");
            seedCustomer("cust_1", WS_ID_1, "Client Corp");

            const location = await createServiceLocation(WS_ID_1, "cust_1", validPayload);
            expect(location.name).toBe("Headquarters");
        });

        it("allows ADMIN to create a service location", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");
            seedCustomer("cust_1", WS_ID_1, "Client Corp");

            const location = await createServiceLocation(WS_ID_1, "cust_1", validPayload);
            expect(location.name).toBe("Headquarters");
        });

        it("allows MANAGER to create a service location", async () => {
            registerUser("user_mgr");
            registerMember("user_mgr", WS_ID_1, "MANAGER");
            loginAs("user_mgr");
            seedCustomer("cust_1", WS_ID_1, "Client Corp");

            const location = await createServiceLocation(WS_ID_1, "cust_1", validPayload);
            expect(location.name).toBe("Headquarters");
        });

        it("allows DISPATCHER to create a service location", async () => {
            registerUser("user_disp");
            registerMember("user_disp", WS_ID_1, "DISPATCHER");
            loginAs("user_disp");
            seedCustomer("cust_1", WS_ID_1, "Client Corp");

            const location = await createServiceLocation(WS_ID_1, "cust_1", validPayload);
            expect(location.name).toBe("Headquarters");
        });

        it("rejects TECHNICIAN with ForbiddenError", async () => {
            registerUser("user_tech");
            registerMember("user_tech", WS_ID_1, "TECHNICIAN");
            loginAs("user_tech");
            seedCustomer("cust_1", WS_ID_1, "Client Corp");

            await expect(createServiceLocation(WS_ID_1, "cust_1", validPayload)).rejects.toThrow(
                ForbiddenError
            );
        });

        it("rejects ACCOUNTANT with ForbiddenError", async () => {
            registerUser("user_acct");
            registerMember("user_acct", WS_ID_1, "ACCOUNTANT");
            loginAs("user_acct");
            seedCustomer("cust_1", WS_ID_1, "Client Corp");

            await expect(createServiceLocation(WS_ID_1, "cust_1", validPayload)).rejects.toThrow(
                ForbiddenError
            );
        });
    });

    describe("2. Tenant Isolation & Scope Enforcement", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");
        });

        it("allows creating location for customer in authorized workspace", async () => {
            seedCustomer("cust_ws1", WS_ID_1, "Customer in WS1");

            const location = await createServiceLocation(WS_ID_1, "cust_ws1", {
                name: "Plant A",
                addressLine1: "100 Factory Rd",
                city: "Austin",
                country: "USA",
            });
            expect(location.customerId).toBe("cust_ws1");
            expect(locationsList).toHaveLength(1);
        });

        it("rejects creating location for customer in another workspace with CustomerNotFoundError", async () => {
            seedCustomer("cust_ws2", WS_ID_2, "Customer in WS2");

            await expect(
                createServiceLocation(WS_ID_1, "cust_ws2", {
                    name: "Plant B",
                    addressLine1: "200 Factory Rd",
                    city: "Austin",
                    country: "USA",
                })
            ).rejects.toThrow(CustomerNotFoundError);
            expect(locationsList).toHaveLength(0);
        });

        it("rejects creating location for non-existent customer with CustomerNotFoundError", async () => {
            await expect(
                createServiceLocation(WS_ID_1, "cust_nonexistent", {
                    name: "Plant C",
                    addressLine1: "300 Factory Rd",
                    city: "Austin",
                    country: "USA",
                })
            ).rejects.toThrow(CustomerNotFoundError);
        });

        it("ignores and strips malicious customerId or workspaceId from input payload", async () => {
            seedCustomer("cust_legit", WS_ID_1, "Legit Customer");

            const location = await createServiceLocation(WS_ID_1, "cust_legit", {
                name: "Legit Branch",
                addressLine1: "100 Safe St",
                city: "Austin",
                country: "USA",
                customerId: "cust_malicious_override",
                workspaceId: "ws_malicious_override",
                id: "forged_id",
            });

            expect(location.customerId).toBe("cust_legit");
            expect(location.id).not.toBe("forged_id");
        });
    });

    describe("3. Validation & Field Handling", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");
            seedCustomer("cust_1", WS_ID_1, "Client Corp");
        });

        it("creates service location with all operational and geographic fields", async () => {
            const location = await createServiceLocation(WS_ID_1, "cust_1", {
                name: "  Austin Distribution Center  ",
                addressLine1: "  100 Industrial Parkway  ",
                addressLine2: "  Building B  ",
                city: "  Austin  ",
                state: "  TX  ",
                postalCode: "  78701  ",
                country: "  USA  ",
                latitude: 30.267153,
                longitude: -97.743057,
                notes: "  Gate 3 access only  ",
                isPrimary: true,
            });

            expect(location.name).toBe("Austin Distribution Center");
            expect(location.addressLine1).toBe("100 Industrial Parkway");
            expect(location.addressLine2).toBe("Building B");
            expect(location.city).toBe("Austin");
            expect(location.state).toBe("TX");
            expect(location.postalCode).toBe("78701");
            expect(location.country).toBe("USA");
            expect(location.latitude).toEqual(new Prisma.Decimal(30.267153));
            expect(location.longitude).toEqual(new Prisma.Decimal(-97.743057));
            expect(location.notes).toBe("Gate 3 access only");
            expect(location.isPrimary).toBe(true);
        });

        it("creates service location with minimal required fields and defaults isPrimary to false", async () => {
            const location = await createServiceLocation(WS_ID_1, "cust_1", {
                name: "Minimal Branch",
                addressLine1: "50 Plain Rd",
                city: "Dallas",
                country: "USA",
            });

            expect(location.name).toBe("Minimal Branch");
            expect(location.addressLine1).toBe("50 Plain Rd");
            expect(location.city).toBe("Dallas");
            expect(location.country).toBe("USA");
            expect(location.isPrimary).toBe(false);
            expect(location.addressLine2).toBeNull();
            expect(location.state).toBeNull();
            expect(location.postalCode).toBeNull();
            expect(location.latitude).toBeNull();
            expect(location.longitude).toBeNull();
            expect(location.notes).toBeNull();
        });

        it("accepts explicit null for optional nullable fields", async () => {
            const location = await createServiceLocation(WS_ID_1, "cust_1", {
                name: "Null Fields Branch",
                addressLine1: "50 Plain Rd",
                addressLine2: null,
                city: "Dallas",
                state: null,
                postalCode: null,
                country: "USA",
                latitude: null,
                longitude: null,
                notes: null,
            });

            expect(location.addressLine2).toBeNull();
            expect(location.state).toBeNull();
            expect(location.postalCode).toBeNull();
            expect(location.latitude).toBeNull();
            expect(location.longitude).toBeNull();
            expect(location.notes).toBeNull();
        });

        it("rejects missing required name", async () => {
            await expect(
                createServiceLocation(WS_ID_1, "cust_1", {
                    addressLine1: "100 St",
                    city: "Dallas",
                    country: "USA",
                })
            ).rejects.toThrow();
        });

        it("rejects coordinates outside valid range", async () => {
            await expect(
                createServiceLocation(WS_ID_1, "cust_1", {
                    name: "Out of Bounds",
                    addressLine1: "100 St",
                    city: "Dallas",
                    country: "USA",
                    latitude: 91,
                })
            ).rejects.toThrow();

            await expect(
                createServiceLocation(WS_ID_1, "cust_1", {
                    name: "Out of Bounds",
                    addressLine1: "100 St",
                    city: "Dallas",
                    country: "USA",
                    longitude: -181,
                })
            ).rejects.toThrow();
        });
    });

    describe("4. Customer Lifecycle Rule (ACTIVE vs INACTIVE)", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");
        });

        it("allows creating location for an ACTIVE customer", async () => {
            seedCustomer("cust_active", WS_ID_1, "Active Customer", "ACTIVE");

            const location = await createServiceLocation(WS_ID_1, "cust_active", {
                name: "Active Site",
                addressLine1: "100 Active Way",
                city: "Austin",
                country: "USA",
            });
            expect(location.customerId).toBe("cust_active");
        });

        it("rejects creating location for an INACTIVE customer with InactiveCustomerError", async () => {
            seedCustomer("cust_inactive", WS_ID_1, "Inactive Customer", "INACTIVE");

            await expect(
                createServiceLocation(WS_ID_1, "cust_inactive", {
                    name: "Inactive Site",
                    addressLine1: "100 Inactive Way",
                    city: "Austin",
                    country: "USA",
                })
            ).rejects.toThrow(InactiveCustomerError);
            expect(locationsList).toHaveLength(0);
        });
    });

    describe("5. Primary Location Invariant & Concurrency Handling", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");
            seedCustomer("cust_1", WS_ID_1, "Client Corp");
        });

        it("creates the first primary location successfully", async () => {
            const primary = await createServiceLocation(WS_ID_1, "cust_1", {
                name: "Primary Hub",
                addressLine1: "100 Hub St",
                city: "Austin",
                country: "USA",
                isPrimary: true,
            });

            expect(primary.isPrimary).toBe(true);
            expect(locationsList).toHaveLength(1);
        });

        it("allows creating subsequent non-primary locations when a primary already exists", async () => {
            await createServiceLocation(WS_ID_1, "cust_1", {
                name: "Primary Hub",
                addressLine1: "100 Hub St",
                city: "Austin",
                country: "USA",
                isPrimary: true,
            });

            const secondary = await createServiceLocation(WS_ID_1, "cust_1", {
                name: "Secondary Hub",
                addressLine1: "200 Sub St",
                city: "Austin",
                country: "USA",
                isPrimary: false,
            });

            expect(secondary.isPrimary).toBe(false);
            expect(locationsList).toHaveLength(2);
        });

        it("rejects creating a second primary location via pre-check with ServiceLocationPrimaryExistsError", async () => {
            await createServiceLocation(WS_ID_1, "cust_1", {
                name: "Primary One",
                addressLine1: "100 St",
                city: "Austin",
                country: "USA",
                isPrimary: true,
            });

            await expect(
                createServiceLocation(WS_ID_1, "cust_1", {
                    name: "Duplicate Primary",
                    addressLine1: "200 St",
                    city: "Austin",
                    country: "USA",
                    isPrimary: true,
                })
            ).rejects.toThrow(ServiceLocationPrimaryExistsError);

            expect(locationsList).toHaveLength(1);
            expect(locationsList[0]!.name).toBe("Primary One");
            expect(locationsList[0]!.isPrimary).toBe(true);
        });

        it("translates concurrent primary creation collision (Prisma P2002) into ServiceLocationPrimaryExistsError", async () => {
            // Simulate pre-check passing (returning null), but Prisma create encountering race collision (P2002)
            mocks.serviceLocationFindFirst.mockResolvedValueOnce(null);
            mocks.serviceLocationCreate.mockRejectedValueOnce(
                Object.assign(new Error("Unique constraint failed on the fields: (`customerId`,`isPrimary`)"), {
                    code: "P2002",
                })
            );

            await expect(
                createServiceLocation(WS_ID_1, "cust_1", {
                    name: "Race Location",
                    addressLine1: "100 Race St",
                    city: "Austin",
                    country: "USA",
                    isPrimary: true,
                })
            ).rejects.toThrow(ServiceLocationPrimaryExistsError);
        });

        it("masks unexpected database failures into ServiceLocationCreationError", async () => {
            mocks.serviceLocationCreate.mockRejectedValueOnce(new Error("Database connection lost"));

            await expect(
                createServiceLocation(WS_ID_1, "cust_1", {
                    name: "Crash Site",
                    addressLine1: "100 St",
                    city: "Austin",
                    country: "USA",
                })
            ).rejects.toThrow(ServiceLocationCreationError);
        });
    });
});
