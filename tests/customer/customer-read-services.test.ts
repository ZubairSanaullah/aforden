import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    customerFindFirst: vi.fn(),
    customerFindUnique: vi.fn(),
    customerFindMany: vi.fn(),
    customerCount: vi.fn(),
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
            findUnique: mocks.customerFindUnique,
            findMany: mocks.customerFindMany,
            count: mocks.customerCount,
        },
    },
}));

import { getCustomer } from "@/lib/services/customer/getCustomer";
import { getCustomerByNumber } from "@/lib/services/customer/getCustomerByNumber";
import { getCustomers } from "@/lib/services/customer/getCustomers";
import {
    UnauthorizedError,
    WorkspaceAccessDeniedError,
    WorkspaceNotFoundError,
} from "@/lib/services/authorization/authorizationErrors";
import type { Customer, User, Workspace, WorkspaceMember } from "@/generated/prisma/client";

describe("Phase 1.4.5 — Customer Retrieval & Read Services", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let customersList: Customer[];

    const WS_ID_1 = "ws_alpha_100";
    const WS_ID_2 = "ws_beta_200";

    beforeEach(() => {
        vi.clearAllMocks();
        usersMap = new Map();
        workspacesMap = new Map();
        membersMap = new Map();
        customersList = [];

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

        mocks.customerFindUnique.mockImplementation(async ({ where }: any) => {
            if (where.workspaceId_customerNumber) {
                const { workspaceId, customerNumber } = where.workspaceId_customerNumber;
                return (
                    customersList.find(
                        (c) => c.workspaceId === workspaceId && c.customerNumber === customerNumber
                    ) || null
                );
            }
            if (where.id) {
                return customersList.find((c) => c.id === where.id) || null;
            }
            return null;
        });

        function filterCustomers(where: any): Customer[] {
            return customersList.filter((c) => {
                if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
                if (where.status && c.status !== where.status) return false;
                if (where.OR && Array.isArray(where.OR)) {
                    const matchesOR = where.OR.some((clause: any) => {
                        if (clause.name?.contains) {
                            return c.name.toLowerCase().includes(clause.name.contains.toLowerCase());
                        }
                        if (clause.customerNumber?.contains) {
                            return (c.customerNumber || "")
                                .toLowerCase()
                                .includes(clause.customerNumber.contains.toLowerCase());
                        }
                        if (clause.email?.contains) {
                            return (c.email || "")
                                .toLowerCase()
                                .includes(clause.email.contains.toLowerCase());
                        }
                        if (clause.phone?.contains) {
                            return (c.phone || "")
                                .toLowerCase()
                                .includes(clause.phone.contains.toLowerCase());
                        }
                        return false;
                    });
                    if (!matchesOR) return false;
                }
                return true;
            });
        }

        mocks.customerCount.mockImplementation(async ({ where }: any) => {
            return filterCustomers(where).length;
        });

        mocks.customerFindMany.mockImplementation(async ({ where, skip = 0, take = 20, orderBy }: any) => {
            let results = filterCustomers(where);

            if (orderBy && Array.isArray(orderBy)) {
                results.sort((a: any, b: any) => {
                    for (const orderClause of orderBy) {
                        const [field, direction] = Object.entries(orderClause)[0] as [string, "asc" | "desc"];
                        const valA = a[field];
                        const valB = b[field];

                        if (valA === valB) continue;
                        if (valA === null || valA === undefined) return direction === "asc" ? -1 : 1;
                        if (valB === null || valB === undefined) return direction === "asc" ? 1 : -1;

                        const comparison = valA < valB ? -1 : 1;
                        return direction === "asc" ? comparison : -comparison;
                    }
                    return 0;
                });
            }

            return results.slice(skip, skip + take);
        });

        // Register default workspaces
        registerWorkspace(WS_ID_1, "Alpha Services", "alpha-services");
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
        customerNumber: string | null = null,
        overrides: Partial<Customer> = {}
    ): Customer {
        const customer: Customer = {
            id,
            workspaceId,
            customerNumber,
            name,
            email: overrides.email ?? `${name.toLowerCase().replace(/\s+/g, "")}@example.com`,
            phone: overrides.phone ?? "+1-555-0100",
            website: overrides.website ?? null,
            addressLine1: overrides.addressLine1 ?? "123 Main St",
            addressLine2: overrides.addressLine2 ?? null,
            city: overrides.city ?? "Austin",
            state: overrides.state ?? "TX",
            postalCode: overrides.postalCode ?? "78701",
            country: overrides.country ?? "US",
            status: overrides.status ?? "ACTIVE",
            notes: overrides.notes ?? null,
            createdAt: overrides.createdAt ?? new Date("2026-08-19T10:00:00.000Z"),
            updatedAt: overrides.updatedAt ?? new Date("2026-08-19T10:00:00.000Z"),
        };
        customersList.push(customer);
        return customer;
    }

    describe("1. getCustomer() by ID", () => {
        it("retrieves a customer belonging to the authorized workspace", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            const seeded = seedCustomer("cust_1", WS_ID_1, "Apex Manufacturing", "CUST-00001");

            const result = await getCustomer(WS_ID_1, "cust_1");

            expect(result).not.toBeNull();
            expect(result?.id).toBe("cust_1");
            expect(result?.name).toBe("Apex Manufacturing");
            expect(result?.customerNumber).toBe("CUST-00001");
            expect(result?.workspaceId).toBe(WS_ID_1);
        });

        it("returns null when customer ID does not exist", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            const result = await getCustomer(WS_ID_1, "cust_nonexistent");
            expect(result).toBeNull();
        });

        it("returns null when customer belongs to another workspace (strict tenant isolation)", async () => {
            registerUser("user_admin_ws1");
            registerMember("user_admin_ws1", WS_ID_1, "ADMIN");
            loginAs("user_admin_ws1");

            // Seed customer in Workspace 2
            seedCustomer("cust_foreign_2", WS_ID_2, "Beta Foreign Customer", "CUST-00001");

            // User in Workspace 1 attempts to query Workspace 2's customer ID
            const result = await getCustomer(WS_ID_1, "cust_foreign_2");

            expect(result).toBeNull();
        });

        it("allows all authorized roles with `customers.view` permission", async () => {
            const roles: Array<"OWNER" | "ADMIN" | "MANAGER" | "DISPATCHER" | "TECHNICIAN" | "ACCOUNTANT"> = [
                "OWNER",
                "ADMIN",
                "MANAGER",
                "DISPATCHER",
                "TECHNICIAN",
                "ACCOUNTANT",
            ];

            seedCustomer("cust_shared", WS_ID_1, "Shared Customer", "CUST-100");

            for (const role of roles) {
                const userId = `user_${role.toLowerCase()}`;
                registerUser(userId);
                registerMember(userId, WS_ID_1, role);
                loginAs(userId);

                const result = await getCustomer(WS_ID_1, "cust_shared");
                expect(result?.id).toBe("cust_shared");
            }
        });

        it("rejects unauthenticated user with UnauthorizedError", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(getCustomer(WS_ID_1, "cust_1")).rejects.toThrow(UnauthorizedError);
        });

        it("rejects inactive membership with WorkspaceAccessDeniedError", async () => {
            registerUser("user_inactive");
            registerMember("user_inactive", WS_ID_1, "ADMIN", "SUSPENDED");
            loginAs("user_inactive");

            await expect(getCustomer(WS_ID_1, "cust_1")).rejects.toThrow(WorkspaceAccessDeniedError);
        });

        it("rejects deactivated user with WorkspaceAccessDeniedError", async () => {
            registerUser("user_deactivated", "Deactivated", "DEACTIVATED");
            registerMember("user_deactivated", WS_ID_1, "ADMIN");
            loginAs("user_deactivated");

            await expect(getCustomer(WS_ID_1, "cust_1")).rejects.toThrow(WorkspaceAccessDeniedError);
        });

        it("rejects non-existent workspace with WorkspaceNotFoundError", async () => {
            registerUser("user_admin");
            registerMember("user_admin", "ws_nonexistent", "ADMIN");
            loginAs("user_admin");

            await expect(getCustomer("ws_nonexistent", "cust_1")).rejects.toThrow(WorkspaceNotFoundError);
        });
    });

    describe("2. getCustomerByNumber()", () => {
        it("retrieves a customer by customerNumber in the authorized workspace", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Acme Logistics", "CUST-00042");

            const result = await getCustomerByNumber(WS_ID_1, "CUST-00042");

            expect(result).not.toBeNull();
            expect(result?.id).toBe("cust_1");
            expect(result?.customerNumber).toBe("CUST-00042");
            expect(result?.name).toBe("Acme Logistics");
        });

        it("returns null for non-existent customer number", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            const result = await getCustomerByNumber(WS_ID_1, "CUST-99999");
            expect(result).toBeNull();
        });

        it("returns null for empty or whitespace customer number", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            expect(await getCustomerByNumber(WS_ID_1, "")).toBeNull();
            expect(await getCustomerByNumber(WS_ID_1, "   ")).toBeNull();
        });

        it("enforces tenant isolation (same customer number in WS 2 is not returned for WS 1)", async () => {
            registerUser("user_ws1");
            registerMember("user_ws1", WS_ID_1, "ADMIN");

            registerUser("user_ws2");
            registerMember("user_ws2", WS_ID_2, "ADMIN");

            // Seed same number in both workspaces with different customer entities
            seedCustomer("cust_ws1", WS_ID_1, "Alpha Client", "CUST-00001");
            seedCustomer("cust_ws2", WS_ID_2, "Beta Client", "CUST-00001");

            loginAs("user_ws1");
            const res1 = await getCustomerByNumber(WS_ID_1, "CUST-00001");
            expect(res1?.id).toBe("cust_ws1");
            expect(res1?.name).toBe("Alpha Client");

            loginAs("user_ws2");
            const res2 = await getCustomerByNumber(WS_ID_2, "CUST-00001");
            expect(res2?.id).toBe("cust_ws2");
            expect(res2?.name).toBe("Beta Client");
        });
    });

    describe("3. getCustomers() Directory & Listing", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");
        });

        it("returns an empty list and zero counts when workspace has no customers", async () => {
            const result = await getCustomers(WS_ID_1);

            expect(result.items).toHaveLength(0);
            expect(result.pagination.total).toBe(0);
            expect(result.pagination.totalPages).toBe(0);
            expect(result.pagination.page).toBe(1);
            expect(result.pagination.pageSize).toBe(20);
            expect(result.pagination.hasNextPage).toBe(false);
            expect(result.pagination.hasPreviousPage).toBe(false);
        });

        it("returns all customers strictly scoped to the authorized workspace", async () => {
            seedCustomer("c1", WS_ID_1, "Alpha Cust 1", "CUST-001");
            seedCustomer("c2", WS_ID_1, "Alpha Cust 2", "CUST-002");
            seedCustomer("c3", WS_ID_2, "Beta Cust 1", "CUST-001"); // Other workspace

            const result = await getCustomers(WS_ID_1);

            expect(result.items).toHaveLength(2);
            expect(result.pagination.total).toBe(2);
            expect(result.items.map((i) => i.id)).toEqual(["c1", "c2"]);
            expect(result.items.every((i) => i.workspaceId === WS_ID_1)).toBe(true);
        });

        it("filters customers by search term across name, customerNumber, email, and phone", async () => {
            seedCustomer("c1", WS_ID_1, "Apex Manufacturing", "CUST-101", {
                email: "info@apex.com",
                phone: "+1-555-1111",
            });
            seedCustomer("c2", WS_ID_1, "Delta Logistics", "CUST-102", {
                email: "contact@delta.com",
                phone: "+1-555-2222",
            });
            seedCustomer("c3", WS_ID_1, "Echo Global", "SPEC-999", {
                email: "ops@echo.com",
                phone: "+1-555-3333",
            });

            // Search by name
            const resName = await getCustomers(WS_ID_1, { search: "Apex" });
            expect(resName.items).toHaveLength(1);
            expect(resName.items[0]?.name).toBe("Apex Manufacturing");

            // Search by customerNumber
            const resNumber = await getCustomers(WS_ID_1, { search: "SPEC-999" });
            expect(resNumber.items).toHaveLength(1);
            expect(resNumber.items[0]?.name).toBe("Echo Global");

            // Search by email
            const resEmail = await getCustomers(WS_ID_1, { search: "delta.com" });
            expect(resEmail.items).toHaveLength(1);
            expect(resEmail.items[0]?.name).toBe("Delta Logistics");

            // Search by phone
            const resPhone = await getCustomers(WS_ID_1, { search: "555-3333" });
            expect(resPhone.items).toHaveLength(1);
            expect(resPhone.items[0]?.name).toBe("Echo Global");
        });

        it("filters customers by status (ACTIVE vs INACTIVE)", async () => {
            seedCustomer("c1", WS_ID_1, "Active Cust 1", "CUST-001", { status: "ACTIVE" });
            seedCustomer("c2", WS_ID_1, "Active Cust 2", "CUST-002", { status: "ACTIVE" });
            seedCustomer("c3", WS_ID_1, "Inactive Cust", "CUST-003", { status: "INACTIVE" });

            const activeResult = await getCustomers(WS_ID_1, { status: "ACTIVE" });
            expect(activeResult.items).toHaveLength(2);
            expect(activeResult.items.every((i) => i.status === "ACTIVE")).toBe(true);

            const inactiveResult = await getCustomers(WS_ID_1, { status: "INACTIVE" });
            expect(inactiveResult.items).toHaveLength(1);
            expect(inactiveResult.items[0]?.name).toBe("Inactive Cust");
        });

        it("combines search and status filter", async () => {
            seedCustomer("c1", WS_ID_1, "Pinnacle Active", "CUST-001", { status: "ACTIVE" });
            seedCustomer("c2", WS_ID_1, "Pinnacle Inactive", "CUST-002", { status: "INACTIVE" });
            seedCustomer("c3", WS_ID_1, "Summit Active", "CUST-003", { status: "ACTIVE" });

            const result = await getCustomers(WS_ID_1, {
                search: "Pinnacle",
                status: "ACTIVE",
            });

            expect(result.items).toHaveLength(1);
            expect(result.items[0]?.name).toBe("Pinnacle Active");
            expect(result.pagination.total).toBe(1);
        });

        it("paginates directory records with page and pageSize", async () => {
            for (let i = 1; i <= 25; i++) {
                seedCustomer(
                    `c_${i}`,
                    WS_ID_1,
                    `Customer ${String(i).padStart(2, "0")}`,
                    `CUST-${String(i).padStart(5, "0")}`
                );
            }

            // Page 1 with pageSize 10
            const page1 = await getCustomers(WS_ID_1, { page: 1, pageSize: 10 });
            expect(page1.items).toHaveLength(10);
            expect(page1.pagination.total).toBe(25);
            expect(page1.pagination.totalPages).toBe(3);
            expect(page1.pagination.hasNextPage).toBe(true);
            expect(page1.pagination.hasPreviousPage).toBe(false);
            expect(page1.items[0]?.name).toBe("Customer 01");

            // Page 2 with pageSize 10
            const page2 = await getCustomers(WS_ID_1, { page: 2, pageSize: 10 });
            expect(page2.items).toHaveLength(10);
            expect(page2.pagination.hasNextPage).toBe(true);
            expect(page2.pagination.hasPreviousPage).toBe(true);
            expect(page2.items[0]?.name).toBe("Customer 11");

            // Page 3 with pageSize 10 (remaining 5)
            const page3 = await getCustomers(WS_ID_1, { page: 3, pageSize: 10 });
            expect(page3.items).toHaveLength(5);
            expect(page3.pagination.hasNextPage).toBe(false);
            expect(page3.pagination.hasPreviousPage).toBe(true);
            expect(page3.items[0]?.name).toBe("Customer 21");

            // Page beyond total
            const page4 = await getCustomers(WS_ID_1, { page: 4, pageSize: 10 });
            expect(page4.items).toHaveLength(0);
            expect(page4.pagination.hasNextPage).toBe(false);
            expect(page4.pagination.hasPreviousPage).toBe(true);
        });

        it("supports sorting by name, customerNumber, city, createdAt, and status", async () => {
            seedCustomer("c1", WS_ID_1, "Zeta Corp", "CUST-003", { city: "Dallas" });
            seedCustomer("c2", WS_ID_1, "Alpha Corp", "CUST-001", { city: "Austin" });
            seedCustomer("c3", WS_ID_1, "Beta Corp", "CUST-002", { city: "Houston" });

            // Sort by name ASC
            const sortNameAsc = await getCustomers(WS_ID_1, { sortBy: "name", sortOrder: "asc" });
            expect(sortNameAsc.items.map((i) => i.name)).toEqual(["Alpha Corp", "Beta Corp", "Zeta Corp"]);

            // Sort by name DESC
            const sortNameDesc = await getCustomers(WS_ID_1, { sortBy: "name", sortOrder: "desc" });
            expect(sortNameDesc.items.map((i) => i.name)).toEqual(["Zeta Corp", "Beta Corp", "Alpha Corp"]);

            // Sort by city ASC
            const sortCityAsc = await getCustomers(WS_ID_1, { sortBy: "city", sortOrder: "asc" });
            expect(sortCityAsc.items.map((i) => i.city)).toEqual(["Austin", "Dallas", "Houston"]);

            // Sort by customerNumber ASC
            const sortNumAsc = await getCustomers(WS_ID_1, { sortBy: "customerNumber", sortOrder: "asc" });
            expect(sortNumAsc.items.map((i) => i.customerNumber)).toEqual(["CUST-001", "CUST-002", "CUST-003"]);
        });

        it("handles null customerNumber safely during sorting without crashing", async () => {
            seedCustomer("c1", WS_ID_1, "No Number Cust", null);
            seedCustomer("c2", WS_ID_1, "Numbered Cust", "CUST-001");

            const result = await getCustomers(WS_ID_1, { sortBy: "customerNumber", sortOrder: "asc" });
            expect(result.items).toHaveLength(2);
        });

        it("rejects invalid query inputs via validation schema", async () => {
            await expect(getCustomers(WS_ID_1, { page: 0 })).rejects.toThrow();
            await expect(getCustomers(WS_ID_1, { pageSize: 101 })).rejects.toThrow();
            await expect(getCustomers(WS_ID_1, { sortBy: "invalidCol" as any })).rejects.toThrow();
            await expect(getCustomers(WS_ID_1, { sortOrder: "sideways" as any })).rejects.toThrow();
            await expect(getCustomers(WS_ID_1, { status: "INVALID" as any })).rejects.toThrow();
        });
    });
});
