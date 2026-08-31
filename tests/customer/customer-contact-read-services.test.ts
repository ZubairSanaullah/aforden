import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    customerFindFirst: vi.fn(),
    customerContactFindFirst: vi.fn(),
    customerContactFindMany: vi.fn(),
    customerContactCount: vi.fn(),
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
        customerContact: {
            findFirst: mocks.customerContactFindFirst,
            findMany: mocks.customerContactFindMany,
            count: mocks.customerContactCount,
        },
    },
}));

import { getCustomerContact } from "@/lib/services/customer/getCustomerContact";
import { getCustomerContacts } from "@/lib/services/customer/getCustomerContacts";
import { CustomerNotFoundError } from "@/lib/services/customer/customerErrors";
import {
    UnauthorizedError,
    WorkspaceAccessDeniedError,
    WorkspaceNotFoundError,
} from "@/lib/services/authorization/authorizationErrors";
import type { Customer, CustomerContact, User, Workspace, WorkspaceMember } from "@/generated/prisma/client";

describe("Phase 1.4.12 — Customer Contact Read Services Suite", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let customersList: Customer[];
    let contactsList: CustomerContact[];

    const WS_ID_1 = "ws_alpha_100";
    const WS_ID_2 = "ws_beta_200";

    beforeEach(() => {
        vi.clearAllMocks();
        usersMap = new Map();
        workspacesMap = new Map();
        membersMap = new Map();
        customersList = [];
        contactsList = [];

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

        mocks.customerContactFindFirst.mockImplementation(async ({ where }: any) => {
            return (
                contactsList.find((cnt) => {
                    if (where.id && cnt.id !== where.id) return false;
                    if (where.customerId && cnt.customerId !== where.customerId) return false;
                    return true;
                }) || null
            );
        });

        mocks.customerContactCount.mockImplementation(async ({ where }: any) => {
            const filtered = filterContacts(where);
            return filtered.length;
        });

        mocks.customerContactFindMany.mockImplementation(async ({ where, skip = 0, take = 20, orderBy }: any) => {
            let filtered = filterContacts(where);

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

    function filterContacts(where: any): CustomerContact[] {
        return contactsList.filter((cnt) => {
            if (where.customerId && cnt.customerId !== where.customerId) return false;
            if (where.isPrimary !== undefined && cnt.isPrimary !== where.isPrimary) return false;

            if (where.OR && Array.isArray(where.OR)) {
                const searchMatch = where.OR.some((clause: any) => {
                    const field = Object.keys(clause)[0] as keyof CustomerContact;
                    const condition = clause[field];
                    const targetVal = String(cnt[field] || "");
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

    function seedCustomer(id: string, workspaceId: string, name: string): Customer {
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
            status: "ACTIVE",
            notes: "Client for contact read tests",
            createdAt: new Date("2026-08-19T10:00:00.000Z"),
            updatedAt: new Date("2026-08-19T10:00:00.000Z"),
        };
        customersList.push(customer);
        return customer;
    }

    function seedContact(
        id: string,
        customerId: string,
        firstName: string,
        lastName: string,
        isPrimary = false,
        email = "test@example.com",
        title = "Contact Title",
        phone = "+1-555-0000"
    ): CustomerContact {
        const contact: CustomerContact = {
            id,
            customerId,
            firstName,
            lastName,
            title,
            email,
            phone,
            mobilePhone: "+1-555-9999",
            isPrimary,
            notes: "Operational contact notes",
            createdAt: new Date("2026-08-19T10:00:00.000Z"),
            updatedAt: new Date("2026-08-19T10:00:00.000Z"),
        };
        contactsList.push(contact);
        return contact;
    }

    describe("1. Authorization & RBAC Checks", () => {
        beforeEach(() => {
            seedCustomer("cust_1", WS_ID_1, "Alpha Client");
            seedContact("cnt_1", "cust_1", "Jane", "Doe", true);
        });

        it("rejects unauthenticated getCustomerContact and getCustomerContacts", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(getCustomerContact(WS_ID_1, "cust_1", "cnt_1")).rejects.toThrow(
                UnauthorizedError
            );
            await expect(getCustomerContacts(WS_ID_1, "cust_1")).rejects.toThrow(
                UnauthorizedError
            );
        });

        it("rejects inactive workspace membership", async () => {
            registerUser("user_suspended");
            registerMember("user_suspended", WS_ID_1, "ADMIN", "SUSPENDED");
            loginAs("user_suspended");

            await expect(getCustomerContact(WS_ID_1, "cust_1", "cnt_1")).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
            await expect(getCustomerContacts(WS_ID_1, "cust_1")).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
        });

        it("rejects deactivated user", async () => {
            registerUser("user_deactivated", "Deactivated", "DEACTIVATED");
            registerMember("user_deactivated", WS_ID_1, "ADMIN");
            loginAs("user_deactivated");

            await expect(getCustomerContact(WS_ID_1, "cust_1", "cnt_1")).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
            await expect(getCustomerContacts(WS_ID_1, "cust_1")).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
        });

        it("rejects non-existent workspace", async () => {
            registerUser("user_admin");
            registerMember("user_admin", "ws_nonexistent", "ADMIN");
            loginAs("user_admin");

            await expect(getCustomerContact("ws_nonexistent", "cust_1", "cnt_1")).rejects.toThrow(
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
            it(`allows ${role} to execute getCustomerContact and getCustomerContacts`, async () => {
                const userId = `user_${role.toLowerCase()}`;
                registerUser(userId);
                registerMember(userId, WS_ID_1, role);
                loginAs(userId);

                const single = await getCustomerContact(WS_ID_1, "cust_1", "cnt_1");
                expect(single?.id).toBe("cnt_1");

                const list = await getCustomerContacts(WS_ID_1, "cust_1");
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

            seedContact("cnt_ws1", "cust_ws1", "Jane", "WS1");
            seedContact("cnt_ws2", "cust_ws2", "John", "WS2");
        });

        it("returns contact when workspace and customer ownership match", async () => {
            const contact = await getCustomerContact(WS_ID_1, "cust_ws1", "cnt_ws1");
            expect(contact?.id).toBe("cnt_ws1");
        });

        it("returns null when attempting to retrieve a contact from another workspace", async () => {
            const contact = await getCustomerContact(WS_ID_1, "cust_ws2", "cnt_ws2");
            expect(contact).toBeNull();
        });

        it("returns null when contact belongs to another customer even if contactId is known", async () => {
            seedCustomer("cust_ws1_other", WS_ID_1, "Customer 1 Other");
            const contact = await getCustomerContact(WS_ID_1, "cust_ws1_other", "cnt_ws1");
            expect(contact).toBeNull();
        });

        it("throws CustomerNotFoundError when listing contacts for a customer in another workspace", async () => {
            await expect(getCustomerContacts(WS_ID_1, "cust_ws2")).rejects.toThrow(
                CustomerNotFoundError
            );
        });
    });

    describe("3. Single Contact Retrieval (`getCustomerContact`)", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Client Corp");
            seedContact("cnt_1", "cust_1", "Primary", "Contact", true, "primary@client.com", "Chief Engineer");
        });

        it("retrieves single contact with all details", async () => {
            const contact = await getCustomerContact(WS_ID_1, "cust_1", "cnt_1");

            expect(contact).not.toBeNull();
            expect(contact?.firstName).toBe("Primary");
            expect(contact?.lastName).toBe("Contact");
            expect(contact?.isPrimary).toBe(true);
            expect(contact?.email).toBe("primary@client.com");
            expect(contact?.title).toBe("Chief Engineer");
        });

        it("returns null for non-existent contact ID", async () => {
            const contact = await getCustomerContact(WS_ID_1, "cust_1", "cnt_missing");
            expect(contact).toBeNull();
        });
    });

    describe("4. Listing & Pagination (`getCustomerContacts`)", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Client Corp");
            seedCustomer("cust_empty", WS_ID_1, "Empty Client");

            for (let i = 1; i <= 25; i++) {
                seedContact(
                    `cnt_${i.toString().padStart(2, "0")}`,
                    "cust_1",
                    `ContactFirst_${i}`,
                    `ContactLast_${i}`,
                    i === 1,
                    `contact${i}@client.com`
                );
            }
        });

        it("returns empty list with 0 total for a customer with no contacts without throwing", async () => {
            const result = await getCustomerContacts(WS_ID_1, "cust_empty");
            expect(result.items).toEqual([]);
            expect(result.pagination.total).toBe(0);
            expect(result.pagination.totalPages).toBe(0);
            expect(result.pagination.hasNextPage).toBe(false);
            expect(result.pagination.hasPreviousPage).toBe(false);
        });

        it("applies default pagination (page 1, pageSize 20)", async () => {
            const result = await getCustomerContacts(WS_ID_1, "cust_1");
            expect(result.items).toHaveLength(20);
            expect(result.pagination.page).toBe(1);
            expect(result.pagination.pageSize).toBe(20);
            expect(result.pagination.total).toBe(25);
            expect(result.pagination.totalPages).toBe(2);
            expect(result.pagination.hasNextPage).toBe(true);
            expect(result.pagination.hasPreviousPage).toBe(false);
        });

        it("handles custom page and pageSize navigation", async () => {
            const result = await getCustomerContacts(WS_ID_1, "cust_1", {
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

    describe("5. Search Filtering Across Fields", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Client Corp");

            seedContact("c1", "cust_1", "Jonathan", "Archer", false, "jarcher@starfleet.com", "Captain", "+1-555-1111");
            seedContact("c2", "cust_1", "T'Pol", "Vulcan", false, "tpol@starfleet.com", "Commander", "+1-555-2222");
            seedContact("c3", "cust_1", "Charles", "Tucker", false, "trip@starfleet.com", "Chief Engineer", "+1-555-3333");
        });

        it("searches by firstName case-insensitively", async () => {
            const result = await getCustomerContacts(WS_ID_1, "cust_1", { search: "jonathan" });
            expect(result.items).toHaveLength(1);
            expect(result.items[0]?.firstName).toBe("Jonathan");
        });

        it("searches by lastName case-insensitively", async () => {
            const result = await getCustomerContacts(WS_ID_1, "cust_1", { search: "VULCAN" });
            expect(result.items).toHaveLength(1);
            expect(result.items[0]?.lastName).toBe("Vulcan");
        });

        it("searches by email", async () => {
            const result = await getCustomerContacts(WS_ID_1, "cust_1", { search: "trip@starfleet" });
            expect(result.items).toHaveLength(1);
            expect(result.items[0]?.firstName).toBe("Charles");
        });

        it("searches by title", async () => {
            const result = await getCustomerContacts(WS_ID_1, "cust_1", { search: "Chief Engineer" });
            expect(result.items).toHaveLength(1);
            expect(result.items[0]?.firstName).toBe("Charles");
        });

        it("searches by phone", async () => {
            const result = await getCustomerContacts(WS_ID_1, "cust_1", { search: "555-2222" });
            expect(result.items).toHaveLength(1);
            expect(result.items[0]?.firstName).toBe("T'Pol");
        });
    });

    describe("6. isPrimary Filtering", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Client Corp");

            seedContact("c1", "cust_1", "Primary", "Lead", true);
            seedContact("c2", "cust_1", "Assistant", "One", false);
            seedContact("c3", "cust_1", "Assistant", "Two", false);
        });

        it("filters for primary contact only (isPrimary = true)", async () => {
            const result = await getCustomerContacts(WS_ID_1, "cust_1", { isPrimary: true });
            expect(result.items).toHaveLength(1);
            expect(result.items[0]?.isPrimary).toBe(true);
            expect(result.items[0]?.firstName).toBe("Primary");
        });

        it("filters for non-primary contacts only (isPrimary = false)", async () => {
            const result = await getCustomerContacts(WS_ID_1, "cust_1", { isPrimary: false });
            expect(result.items).toHaveLength(2);
            expect(result.items.every((c) => !c.isPrimary)).toBe(true);
        });

        it("returns all contacts when isPrimary is omitted", async () => {
            const result = await getCustomerContacts(WS_ID_1, "cust_1");
            expect(result.items).toHaveLength(3);
        });
    });

    describe("7. Whitelisted & Deterministic Sorting", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Client Corp");

            seedContact("c1", "cust_1", "Charlie", "Brown", false, "charlie@peanuts.com");
            seedContact("c2", "cust_1", "Alice", "Smith", true, "alice@wonderland.com");
            seedContact("c3", "cust_1", "Bob", "Marley", false, "bob@reggae.com");
        });

        it("sorts by firstName ascending", async () => {
            const result = await getCustomerContacts(WS_ID_1, "cust_1", {
                sortBy: "firstName",
                sortOrder: "asc",
            });
            expect(result.items.map((c) => c.firstName)).toEqual(["Alice", "Bob", "Charlie"]);
        });

        it("sorts by firstName descending", async () => {
            const result = await getCustomerContacts(WS_ID_1, "cust_1", {
                sortBy: "firstName",
                sortOrder: "desc",
            });
            expect(result.items.map((c) => c.firstName)).toEqual(["Charlie", "Bob", "Alice"]);
        });

        it("sorts by isPrimary descending (primary first)", async () => {
            const result = await getCustomerContacts(WS_ID_1, "cust_1", {
                sortBy: "isPrimary",
                sortOrder: "desc",
            });
            expect(result.items[0]?.isPrimary).toBe(true);
            expect(result.items[0]?.firstName).toBe("Alice");
        });
    });
});
