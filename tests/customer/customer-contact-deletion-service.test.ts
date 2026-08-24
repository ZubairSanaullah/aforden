import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    customerFindFirst: vi.fn(),
    customerContactFindFirst: vi.fn(),
    customerContactDelete: vi.fn(),
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
            delete: mocks.customerContactDelete,
        },
    },
}));

import { deleteCustomerContact } from "@/lib/services/customer/deleteCustomerContact";
import {
    CustomerNotFoundError,
    CustomerContactNotFoundError,
    InactiveCustomerError,
    CustomerContactDeletionError,
    CustomerContactDeletionNotAllowedError,
} from "@/lib/services/customer/customerErrors";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
    WorkspaceNotFoundError,
} from "@/lib/services/authorization/authorizationErrors";
import type { Customer, CustomerContact, User, Workspace, WorkspaceMember } from "@/generated/prisma/client";

describe("Phase 1.4.14 — Customer Contact Deletion Service Suite", () => {
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

        mocks.customerContactDelete.mockImplementation(async ({ where }: any) => {
            const index = contactsList.findIndex((c) => c.id === where.id);
            if (index === -1) {
                const err = new Error("Record to delete does not exist.");
                (err as any).code = "P2025";
                throw err;
            }

            const [deleted] = contactsList.splice(index, 1);
            return deleted!;
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
            notes: "Client for contact deletion tests",
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
        isPrimary = false
    ): CustomerContact {
        const contact: CustomerContact = {
            id,
            customerId,
            firstName,
            lastName,
            title: "Contact Title",
            email: `${firstName.toLowerCase()}@client.com`,
            phone: "+1-555-1000",
            mobilePhone: "+1-555-2000",
            isPrimary,
            notes: "Contact notes",
            createdAt: new Date("2026-08-19T10:00:00.000Z"),
            updatedAt: new Date("2026-08-19T10:00:00.000Z"),
        };
        contactsList.push(contact);
        return contact;
    }

    describe("1. Authorization & RBAC Checks", () => {
        beforeEach(() => {
            seedCustomer("cust_1", WS_ID_1, "Client Corp");
            seedContact("cnt_1", "cust_1", "Jane", "Doe");
        });

        it("rejects unauthenticated caller with UnauthorizedError", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(deleteCustomerContact(WS_ID_1, "cust_1", "cnt_1")).rejects.toThrow(
                UnauthorizedError
            );
        });

        it("rejects inactive workspace membership with WorkspaceAccessDeniedError", async () => {
            registerUser("user_suspended");
            registerMember("user_suspended", WS_ID_1, "ADMIN", "SUSPENDED");
            loginAs("user_suspended");

            await expect(deleteCustomerContact(WS_ID_1, "cust_1", "cnt_1")).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
        });

        it("rejects deactivated user with WorkspaceAccessDeniedError", async () => {
            registerUser("user_deactivated", "Deactivated", "DEACTIVATED");
            registerMember("user_deactivated", WS_ID_1, "ADMIN");
            loginAs("user_deactivated");

            await expect(deleteCustomerContact(WS_ID_1, "cust_1", "cnt_1")).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
        });

        it("rejects non-existent workspace with WorkspaceNotFoundError", async () => {
            registerUser("user_admin");
            registerMember("user_admin", "ws_nonexistent", "ADMIN");
            loginAs("user_admin");

            await expect(deleteCustomerContact("ws_nonexistent", "cust_1", "cnt_1")).rejects.toThrow(
                WorkspaceNotFoundError
            );
        });

        it("allows OWNER to delete customer contact", async () => {
            registerUser("user_owner");
            registerMember("user_owner", WS_ID_1, "OWNER");
            loginAs("user_owner");

            const deleted = await deleteCustomerContact(WS_ID_1, "cust_1", "cnt_1");
            expect(deleted.id).toBe("cnt_1");
            expect(contactsList).toHaveLength(0);
        });

        it("allows ADMIN to delete customer contact", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            const deleted = await deleteCustomerContact(WS_ID_1, "cust_1", "cnt_1");
            expect(deleted.id).toBe("cnt_1");
            expect(contactsList).toHaveLength(0);
        });

        it("rejects MANAGER with ForbiddenError (does not have customers.delete)", async () => {
            registerUser("user_mgr");
            registerMember("user_mgr", WS_ID_1, "MANAGER");
            loginAs("user_mgr");

            await expect(deleteCustomerContact(WS_ID_1, "cust_1", "cnt_1")).rejects.toThrow(
                ForbiddenError
            );
            expect(contactsList).toHaveLength(1);
        });

        it("rejects DISPATCHER with ForbiddenError", async () => {
            registerUser("user_disp");
            registerMember("user_disp", WS_ID_1, "DISPATCHER");
            loginAs("user_disp");

            await expect(deleteCustomerContact(WS_ID_1, "cust_1", "cnt_1")).rejects.toThrow(
                ForbiddenError
            );
        });

        it("rejects TECHNICIAN with ForbiddenError", async () => {
            registerUser("user_tech");
            registerMember("user_tech", WS_ID_1, "TECHNICIAN");
            loginAs("user_tech");

            await expect(deleteCustomerContact(WS_ID_1, "cust_1", "cnt_1")).rejects.toThrow(
                ForbiddenError
            );
        });

        it("rejects ACCOUNTANT with ForbiddenError", async () => {
            registerUser("user_acct");
            registerMember("user_acct", WS_ID_1, "ACCOUNTANT");
            loginAs("user_acct");

            await expect(deleteCustomerContact(WS_ID_1, "cust_1", "cnt_1")).rejects.toThrow(
                ForbiddenError
            );
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

            seedContact("cnt_ws1", "cust_ws1", "Jane", "WS1");
            seedContact("cnt_ws2", "cust_ws2", "John", "WS2");
        });

        it("allows deletion when customer and contact belong to authorized workspace", async () => {
            const deleted = await deleteCustomerContact(WS_ID_1, "cust_ws1", "cnt_ws1");
            expect(deleted.id).toBe("cnt_ws1");
            expect(contactsList.find((c) => c.id === "cnt_ws1")).toBeUndefined();
        });

        it("rejects deleting contact for customer in another workspace with CustomerNotFoundError", async () => {
            await expect(deleteCustomerContact(WS_ID_1, "cust_ws2", "cnt_ws2")).rejects.toThrow(
                CustomerNotFoundError
            );
            expect(contactsList.find((c) => c.id === "cnt_ws2")).toBeDefined();
        });

        it("rejects deleting contact using mismatched customerId with CustomerContactNotFoundError", async () => {
            await expect(deleteCustomerContact(WS_ID_1, "cust_ws1_alt", "cnt_ws1")).rejects.toThrow(
                CustomerContactNotFoundError
            );
            expect(contactsList.find((c) => c.id === "cnt_ws1")).toBeDefined();
        });
    });

    describe("3. Customer Lifecycle Rule (ACTIVE vs INACTIVE)", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");
        });

        it("allows contact deletion for an ACTIVE customer", async () => {
            seedCustomer("cust_act", WS_ID_1, "Active Customer", "ACTIVE");
            seedContact("cnt_act", "cust_act", "Active", "Contact");

            const deleted = await deleteCustomerContact(WS_ID_1, "cust_act", "cnt_act");
            expect(deleted.id).toBe("cnt_act");
        });

        it("rejects contact deletion for an INACTIVE customer with InactiveCustomerError", async () => {
            seedCustomer("cust_inact", WS_ID_1, "Inactive Customer", "INACTIVE");
            seedContact("cnt_inact", "cust_inact", "Inactive", "Contact");

            await expect(deleteCustomerContact(WS_ID_1, "cust_inact", "cnt_inact")).rejects.toThrow(
                InactiveCustomerError
            );
            expect(contactsList).toHaveLength(1);
        });
    });

    describe("4. Primary Contact Deletion Policy & Invariants", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Client Corp");
        });

        it("deleting a primary contact succeeds and leaves zero primary contacts without promoting others", async () => {
            seedContact("cnt_prim", "cust_1", "Primary", "Lead", true);
            seedContact("cnt_sec1", "cust_1", "Secondary", "One", false);
            seedContact("cnt_sec2", "cust_1", "Secondary", "Two", false);

            const deleted = await deleteCustomerContact(WS_ID_1, "cust_1", "cnt_prim");
            expect(deleted.id).toBe("cnt_prim");
            expect(deleted.isPrimary).toBe(true);

            expect(contactsList).toHaveLength(2);
            expect(contactsList.every((c) => c.isPrimary === false)).toBe(true);
        });

        it("deleting the only contact of a customer succeeds", async () => {
            seedContact("cnt_solo", "cust_1", "Solo", "Contact", false);

            const deleted = await deleteCustomerContact(WS_ID_1, "cust_1", "cnt_solo");
            expect(deleted.id).toBe("cnt_solo");
            expect(contactsList).toHaveLength(0);
        });
    });

    describe("5. Error Handling & Database Constraints", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Client Corp");
        });

        it("throws CustomerContactNotFoundError when contact does not exist", async () => {
            await expect(
                deleteCustomerContact(WS_ID_1, "cust_1", "cnt_nonexistent")
            ).rejects.toThrow(CustomerContactNotFoundError);
        });

        it("translates Prisma P2025 into CustomerContactNotFoundError", async () => {
            seedContact("cnt_1", "cust_1", "Jane", "Doe");

            mocks.customerContactDelete.mockRejectedValueOnce(
                Object.assign(new Error("Record to delete does not exist"), { code: "P2025" })
            );

            await expect(deleteCustomerContact(WS_ID_1, "cust_1", "cnt_1")).rejects.toThrow(
                CustomerContactNotFoundError
            );
        });

        it("translates Prisma P2003 (foreign key / protected references) into CustomerContactDeletionNotAllowedError", async () => {
            seedContact("cnt_1", "cust_1", "Jane", "Doe");

            mocks.customerContactDelete.mockRejectedValueOnce(
                Object.assign(new Error("Foreign key constraint failed"), { code: "P2003" })
            );

            await expect(deleteCustomerContact(WS_ID_1, "cust_1", "cnt_1")).rejects.toThrow(
                CustomerContactDeletionNotAllowedError
            );
        });

        it("masks unexpected database errors into CustomerContactDeletionError", async () => {
            seedContact("cnt_1", "cust_1", "Jane", "Doe");

            mocks.customerContactDelete.mockRejectedValueOnce(new Error("Disk I/O error"));

            await expect(deleteCustomerContact(WS_ID_1, "cust_1", "cnt_1")).rejects.toThrow(
                CustomerContactDeletionError
            );
        });
    });
});
