import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    customerFindFirst: vi.fn(),
    serviceLocationFindFirst: vi.fn(),
    serviceLocationFindMany: vi.fn(),
    serviceLocationCount: vi.fn(),
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
            findMany: mocks.serviceLocationFindMany,
            count: mocks.serviceLocationCount,
        },
    },
}));

import { getServiceLocation } from "@/lib/services/customer/getServiceLocation";
import { getServiceLocations } from "@/lib/services/customer/getServiceLocations";
import { CustomerNotFoundError } from "@/lib/services/customer/customerErrors";
import {
    UnauthorizedError,
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

describe("Phase 1.4.20 — Service Location Read Services Suite", () => {
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
                    return true;
                }) || null
            );
        });

        mocks.serviceLocationCount.mockImplementation(async ({ where }: any) => {
            const filtered = filterLocations(where);
            return filtered.length;
        });

        mocks.serviceLocationFindMany.mockImplementation(async ({ where, skip = 0, take = 20, orderBy }: any) => {
            let filtered = filterLocations(where);

            if (orderBy && Array.isArray(orderBy) && orderBy.length > 0) {
                const primarySort = orderBy[0]!;
                const [sortField, sortOrder] = Object.entries(primarySort)[0]!;

                filtered.sort((a: any, b: any) => {
                    const aVal = a[sortField];
                    const bVal = b[sortField];

                    if (aVal === bVal) {
                        return a.id.localeCompare(b.id);
                    }
                    if (aVal == null) return 1;
                    if (bVal == null) return -1;

                    if (sortOrder === "desc") {
                        return aVal > bVal ? -1 : 1;
                    }
                    return aVal < bVal ? -1 : 1;
                });
            }

            return filtered.slice(skip, skip + take);
        });

        registerWorkspace(WS_ID_1, "Alpha Operations", "alpha-ops");
        registerWorkspace(WS_ID_2, "Beta Operations", "beta-ops");
    });

    function filterLocations(where: any): ServiceLocation[] {
        return locationsList.filter((loc) => {
            if (where.customerId && loc.customerId !== where.customerId) return false;
            if (where.isPrimary !== undefined && loc.isPrimary !== where.isPrimary) return false;

            if (where.OR && Array.isArray(where.OR)) {
                const searchMatch = where.OR.some((clause: any) => {
                    const field = Object.keys(clause)[0] as keyof ServiceLocation;
                    const condition = clause[field];
                    const targetVal = String(loc[field] || "");
                    if (condition && condition.contains) {
                        return targetVal.toLowerCase().includes(condition.contains.toLowerCase());
                    }
                    return false;
                });
                if (!searchMatch) return false;
            }

            return true;
        });
    }

    function registerUser(userId = "user_view", name = "Viewer User", status = "ACTIVE") {
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
            notes: "Client for service location read tests",
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
            notes: "Operational notes",
            isPrimary,
            createdAt: new Date("2026-08-19T10:00:00.000Z"),
            updatedAt: new Date("2026-08-19T10:00:00.000Z"),
        };
        locationsList.push(location);
        return location;
    }

    describe("1. Authorization & RBAC Checks", () => {
        beforeEach(() => {
            seedCustomer("cust_1", WS_ID_1, "Alpha Client");
            seedLocation("loc_1", "cust_1", "HQ", true);
        });

        it("rejects unauthenticated getServiceLocation and getServiceLocations", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(getServiceLocation(WS_ID_1, "cust_1", "loc_1")).rejects.toThrow(
                UnauthorizedError
            );
            await expect(getServiceLocations(WS_ID_1, "cust_1")).rejects.toThrow(
                UnauthorizedError
            );
        });

        it("rejects inactive workspace membership", async () => {
            registerUser("user_suspended");
            registerMember("user_suspended", WS_ID_1, "ADMIN", "SUSPENDED");
            loginAs("user_suspended");

            await expect(getServiceLocation(WS_ID_1, "cust_1", "loc_1")).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
            await expect(getServiceLocations(WS_ID_1, "cust_1")).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
        });

        it("rejects deactivated user", async () => {
            registerUser("user_deactivated", "Deactivated", "DEACTIVATED");
            registerMember("user_deactivated", WS_ID_1, "ADMIN");
            loginAs("user_deactivated");

            await expect(getServiceLocation(WS_ID_1, "cust_1", "loc_1")).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
            await expect(getServiceLocations(WS_ID_1, "cust_1")).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
        });

        it("rejects non-existent workspace", async () => {
            registerUser("user_admin");
            registerMember("user_admin", "ws_nonexistent", "ADMIN");
            loginAs("user_admin");

            await expect(getServiceLocation("ws_nonexistent", "cust_1", "loc_1")).rejects.toThrow(
                WorkspaceNotFoundError
            );
            await expect(getServiceLocations("ws_nonexistent", "cust_1")).rejects.toThrow(
                WorkspaceNotFoundError
            );
        });

        const allowedRoles: Array<"OWNER" | "ADMIN" | "MANAGER" | "DISPATCHER" | "TECHNICIAN" | "ACCOUNTANT"> = [
            "OWNER",
            "ADMIN",
            "MANAGER",
            "DISPATCHER",
            "TECHNICIAN",
            "ACCOUNTANT",
        ];

        for (const role of allowedRoles) {
            it(`allows ${role} to execute getServiceLocation and getServiceLocations`, async () => {
                const userId = `user_${role.toLowerCase()}`;
                registerUser(userId);
                registerMember(userId, WS_ID_1, role);
                loginAs(userId);

                const single = await getServiceLocation(WS_ID_1, "cust_1", "loc_1");
                expect(single?.id).toBe("loc_1");

                const list = await getServiceLocations(WS_ID_1, "cust_1");
                expect(list.items).toHaveLength(1);
            });
        }
    });

    describe("2. Tenant Isolation & Scope Enforcement", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_ws1", WS_ID_1, "Customer 1");
            seedCustomer("cust_ws2", WS_ID_2, "Customer 2");

            seedLocation("loc_ws1", "cust_ws1", "Location WS1");
            seedLocation("loc_ws2", "cust_ws2", "Location WS2");
        });

        it("returns location when workspace and customer ownership match", async () => {
            const location = await getServiceLocation(WS_ID_1, "cust_ws1", "loc_ws1");
            expect(location?.id).toBe("loc_ws1");
        });

        it("throws CustomerNotFoundError when attempting to retrieve location for customer in another workspace", async () => {
            await expect(getServiceLocation(WS_ID_1, "cust_ws2", "loc_ws2")).rejects.toThrow(
                CustomerNotFoundError
            );
        });

        it("returns null when location belongs to another customer even if locationId is known", async () => {
            seedCustomer("cust_ws1_other", WS_ID_1, "Customer 1 Other");
            const location = await getServiceLocation(WS_ID_1, "cust_ws1_other", "loc_ws1");
            expect(location).toBeNull();
        });

        it("throws CustomerNotFoundError when listing locations for a customer in another workspace", async () => {
            await expect(getServiceLocations(WS_ID_1, "cust_ws2")).rejects.toThrow(
                CustomerNotFoundError
            );
        });

        it("throws CustomerNotFoundError for non-existent customer in getServiceLocation and getServiceLocations", async () => {
            await expect(getServiceLocation(WS_ID_1, "cust_nonexistent", "loc_1")).rejects.toThrow(
                CustomerNotFoundError
            );
            await expect(getServiceLocations(WS_ID_1, "cust_nonexistent")).rejects.toThrow(
                CustomerNotFoundError
            );
        });
    });

    describe("3. Customer Lifecycle Behavior (INACTIVE Customers Remain Readable)", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_inactive", WS_ID_1, "Inactive Client", "INACTIVE");
            seedLocation("loc_inactive", "cust_inactive", "Inactive Site", true);
        });

        it("allows reading single service location of an INACTIVE customer without throwing", async () => {
            const location = await getServiceLocation(WS_ID_1, "cust_inactive", "loc_inactive");
            expect(location).not.toBeNull();
            expect(location?.id).toBe("loc_inactive");
        });

        it("allows listing service locations of an INACTIVE customer without throwing", async () => {
            const list = await getServiceLocations(WS_ID_1, "cust_inactive");
            expect(list.items).toHaveLength(1);
            expect(list.items[0]?.name).toBe("Inactive Site");
        });
    });

    describe("4. Single Location Retrieval (`getServiceLocation`)", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Client Corp");
            seedLocation(
                "loc_1",
                "cust_1",
                "Manufacturing Facility",
                true,
                "100 Industrial Way",
                "Building 4",
                "Austin",
                "TX",
                "78701",
                "USA"
            );
        });

        it("retrieves single service location with all details", async () => {
            const location = await getServiceLocation(WS_ID_1, "cust_1", "loc_1");

            expect(location).not.toBeNull();
            expect(location?.name).toBe("Manufacturing Facility");
            expect(location?.addressLine1).toBe("100 Industrial Way");
            expect(location?.addressLine2).toBe("Building 4");
            expect(location?.city).toBe("Austin");
            expect(location?.state).toBe("TX");
            expect(location?.postalCode).toBe("78701");
            expect(location?.country).toBe("USA");
            expect(location?.isPrimary).toBe(true);
        });

        it("returns null for non-existent location ID under valid customer", async () => {
            const location = await getServiceLocation(WS_ID_1, "cust_1", "loc_missing");
            expect(location).toBeNull();
        });
    });

    describe("5. Listing & Pagination (`getServiceLocations`)", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Client Corp");
            seedCustomer("cust_empty", WS_ID_1, "Empty Client");

            for (let i = 1; i <= 25; i++) {
                seedLocation(
                    `loc_${i.toString().padStart(2, "0")}`,
                    "cust_1",
                    `Site_${i}`,
                    i === 1,
                    `${i * 10} Main St`,
                    null,
                    "Austin",
                    "TX",
                    "78701",
                    "USA"
                );
            }
        });

        it("returns empty list with 0 total for a customer with no locations without throwing", async () => {
            const result = await getServiceLocations(WS_ID_1, "cust_empty");
            expect(result.items).toEqual([]);
            expect(result.pagination.total).toBe(0);
            expect(result.pagination.totalPages).toBe(0);
            expect(result.pagination.hasNextPage).toBe(false);
            expect(result.pagination.hasPreviousPage).toBe(false);
        });

        it("applies default pagination (page 1, pageSize 20)", async () => {
            const result = await getServiceLocations(WS_ID_1, "cust_1");
            expect(result.items).toHaveLength(20);
            expect(result.pagination.page).toBe(1);
            expect(result.pagination.pageSize).toBe(20);
            expect(result.pagination.total).toBe(25);
            expect(result.pagination.totalPages).toBe(2);
            expect(result.pagination.hasNextPage).toBe(true);
            expect(result.pagination.hasPreviousPage).toBe(false);
        });

        it("handles custom page and pageSize navigation", async () => {
            const result = await getServiceLocations(WS_ID_1, "cust_1", {
                page: 2,
                pageSize: 10,
            });
            expect(result.items).toHaveLength(10);
            expect(result.pagination.page).toBe(2);
            expect(result.pagination.pageSize).toBe(10);
            expect(result.pagination.total).toBe(25);
            expect(result.pagination.totalPages).toBe(3);
            expect(result.pagination.hasNextPage).toBe(true);
            expect(result.pagination.hasPreviousPage).toBe(true);
        });
    });

    describe("6. Search Filtering Across Fields", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Client Corp");

            seedLocation("loc_1", "cust_1", "North Distribution Hub", false, "100 Logistics Blvd", "Bay 4", "Dallas", "TX", "75201", "USA");
            seedLocation("loc_2", "cust_1", "South Warehouse", false, "200 Harbor Way", null, "Houston", "TX", "77001", "USA");
            seedLocation("loc_3", "cust_1", "Central Plant", false, "300 Factory Rd", "Suite A", "Austin", "CA", "90210", "Canada");
        });

        it("searches by name case-insensitively", async () => {
            const result = await getServiceLocations(WS_ID_1, "cust_1", { search: "distribution" });
            expect(result.items).toHaveLength(1);
            expect(result.items[0]?.name).toBe("North Distribution Hub");
        });

        it("searches by addressLine1", async () => {
            const result = await getServiceLocations(WS_ID_1, "cust_1", { search: "Harbor Way" });
            expect(result.items).toHaveLength(1);
            expect(result.items[0]?.name).toBe("South Warehouse");
        });

        it("searches by addressLine2", async () => {
            const result = await getServiceLocations(WS_ID_1, "cust_1", { search: "Bay 4" });
            expect(result.items).toHaveLength(1);
            expect(result.items[0]?.name).toBe("North Distribution Hub");
        });

        it("searches by city", async () => {
            const result = await getServiceLocations(WS_ID_1, "cust_1", { search: "houston" });
            expect(result.items).toHaveLength(1);
            expect(result.items[0]?.name).toBe("South Warehouse");
        });

        it("searches by state", async () => {
            const result = await getServiceLocations(WS_ID_1, "cust_1", { search: "CA" });
            expect(result.items).toHaveLength(1);
            expect(result.items[0]?.name).toBe("Central Plant");
        });

        it("searches by postalCode", async () => {
            const result = await getServiceLocations(WS_ID_1, "cust_1", { search: "90210" });
            expect(result.items).toHaveLength(1);
            expect(result.items[0]?.name).toBe("Central Plant");
        });

        it("searches by country", async () => {
            const result = await getServiceLocations(WS_ID_1, "cust_1", { search: "canada" });
            expect(result.items).toHaveLength(1);
            expect(result.items[0]?.name).toBe("Central Plant");
        });
    });

    describe("7. isPrimary Filtering", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Client Corp");

            seedLocation("loc_1", "cust_1", "Primary Headquarters", true);
            seedLocation("loc_2", "cust_1", "Secondary Depot 1", false);
            seedLocation("loc_3", "cust_1", "Secondary Depot 2", false);
        });

        it("filters for primary location only (isPrimary = true)", async () => {
            const result = await getServiceLocations(WS_ID_1, "cust_1", { isPrimary: true });
            expect(result.items).toHaveLength(1);
            expect(result.items[0]?.isPrimary).toBe(true);
            expect(result.items[0]?.name).toBe("Primary Headquarters");
        });

        it("filters for non-primary locations only (isPrimary = false)", async () => {
            const result = await getServiceLocations(WS_ID_1, "cust_1", { isPrimary: false });
            expect(result.items).toHaveLength(2);
            expect(result.items.every((l) => !l.isPrimary)).toBe(true);
        });

        it("returns all locations when isPrimary is omitted", async () => {
            const result = await getServiceLocations(WS_ID_1, "cust_1");
            expect(result.items).toHaveLength(3);
        });
    });

    describe("8. Whitelisted & Deterministic Sorting", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Client Corp");

            seedLocation("loc_1", "cust_1", "Charlie Hub", false, "100 Main", null, "Chicago");
            seedLocation("loc_2", "cust_1", "Alice Plant", true, "200 Main", null, "Austin");
            seedLocation("loc_3", "cust_1", "Bob Depot", false, "300 Main", null, "Boston");
        });

        it("sorts by name ascending", async () => {
            const result = await getServiceLocations(WS_ID_1, "cust_1", {
                sortBy: "name",
                sortOrder: "asc",
            });
            expect(result.items.map((l) => l.name)).toEqual(["Alice Plant", "Bob Depot", "Charlie Hub"]);
        });

        it("sorts by name descending", async () => {
            const result = await getServiceLocations(WS_ID_1, "cust_1", {
                sortBy: "name",
                sortOrder: "desc",
            });
            expect(result.items.map((l) => l.name)).toEqual(["Charlie Hub", "Bob Depot", "Alice Plant"]);
        });

        it("sorts by city ascending", async () => {
            const result = await getServiceLocations(WS_ID_1, "cust_1", {
                sortBy: "city",
                sortOrder: "asc",
            });
            expect(result.items.map((l) => l.city)).toEqual(["Austin", "Boston", "Chicago"]);
        });

        it("sorts by isPrimary descending (primary first)", async () => {
            const result = await getServiceLocations(WS_ID_1, "cust_1", {
                sortBy: "isPrimary",
                sortOrder: "desc",
            });
            expect(result.items[0]?.isPrimary).toBe(true);
            expect(result.items[0]?.name).toBe("Alice Plant");
        });

        it("rejects invalid sort field through validation", async () => {
            await expect(
                getServiceLocations(WS_ID_1, "cust_1", {
                    sortBy: "latitude" as any,
                })
            ).rejects.toThrow();
        });
    });
});
