import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    customerFindFirst: vi.fn(),
    customerDelete: vi.fn(),
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
            delete: mocks.customerDelete,
        },
    },
}));

import {
    deleteCustomer,
    canDeleteCustomer,
    assertCustomerCanBeDeleted,
} from "@/lib/services/customer/deleteCustomer";
import {
    CustomerNotFoundError,
    CustomerDeletionError,
    CustomerDeletionNotAllowedError,
} from "@/lib/services/customer/customerErrors";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
    WorkspaceNotFoundError,
} from "@/lib/services/authorization/authorizationErrors";
import type { Customer, User, Workspace, WorkspaceMember } from "@/generated/prisma/client";

describe("Phase 1.4.8 — Customer Deletion / Archival Policy & Service Layer", () => {
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

        mocks.customerDelete.mockImplementation(async ({ where }: any) => {
            const index = customersList.findIndex((c) => c.id === where.id);
            if (index === -1) {
                const err = new Error("Record to delete does not exist.");
                (err as any).code = "P2025";
                throw err;
            }

            const [deleted] = customersList.splice(index, 1);
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
        status: "ACTIVE" | "INACTIVE" = "INACTIVE",
        customerNumber = "CUST-00001"
    ): Customer {
        const customer: Customer = {
            id,
            workspaceId,
            customerNumber,
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
            notes: "Client for deletion policy tests",
            createdAt: new Date("2026-08-19T10:00:00.000Z"),
            updatedAt: new Date("2026-08-19T10:00:00.000Z"),
        };
        customersList.push(customer);
        return customer;
    }

    describe("1. Deletion Eligibility Policy (ACTIVE vs INACTIVE)", () => {
        it("evaluates canDeleteCustomer as false when customer is ACTIVE", () => {
            const activeCustomer = seedCustomer("c_act", WS_ID_1, "Active Co", "ACTIVE");
            const result = canDeleteCustomer(activeCustomer);

            expect(result.allowed).toBe(false);
            expect(result.reason).toContain("Active customers cannot be deleted");
        });

        it("evaluates canDeleteCustomer as true when customer is INACTIVE", () => {
            const inactiveCustomer = seedCustomer("c_inact", WS_ID_1, "Inactive Co", "INACTIVE");
            const result = canDeleteCustomer(inactiveCustomer);

            expect(result.allowed).toBe(true);
            expect(result.reason).toBeUndefined();
        });

        it("assertCustomerCanBeDeleted throws CustomerDeletionNotAllowedError for ACTIVE customer", () => {
            const activeCustomer = seedCustomer("c_act", WS_ID_1, "Active Co", "ACTIVE");

            expect(() => assertCustomerCanBeDeleted(activeCustomer)).toThrow(
                CustomerDeletionNotAllowedError
            );
        });

        it("assertCustomerCanBeDeleted does not throw for INACTIVE customer", () => {
            const inactiveCustomer = seedCustomer("c_inact", WS_ID_1, "Inactive Co", "INACTIVE");

            expect(() => assertCustomerCanBeDeleted(inactiveCustomer)).not.toThrow();
        });

        it("rejects hard deletion of an ACTIVE customer with CustomerDeletionNotAllowedError", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_active", WS_ID_1, "Active Enterprise", "ACTIVE");

            await expect(deleteCustomer(WS_ID_1, "cust_active")).rejects.toThrow(
                CustomerDeletionNotAllowedError
            );
            expect(customersList).toHaveLength(1);
        });
    });

    describe("2. Authorization & RBAC Checks", () => {
        it("allows OWNER to delete an eligible INACTIVE customer", async () => {
            registerUser("user_owner");
            registerMember("user_owner", WS_ID_1, "OWNER");
            loginAs("user_owner");

            seedCustomer("cust_1", WS_ID_1, "Delete Me", "INACTIVE");

            const deleted = await deleteCustomer(WS_ID_1, "cust_1");
            expect(deleted.id).toBe("cust_1");
            expect(customersList).toHaveLength(0);
        });

        it("allows ADMIN to delete an eligible INACTIVE customer", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Delete Me", "INACTIVE");

            const deleted = await deleteCustomer(WS_ID_1, "cust_1");
            expect(deleted.id).toBe("cust_1");
            expect(customersList).toHaveLength(0);
        });

        it("rejects MANAGER with ForbiddenError (does not have customers.delete)", async () => {
            registerUser("user_mgr");
            registerMember("user_mgr", WS_ID_1, "MANAGER");
            loginAs("user_mgr");

            seedCustomer("cust_1", WS_ID_1, "Protected Customer", "INACTIVE");

            await expect(deleteCustomer(WS_ID_1, "cust_1")).rejects.toThrow(ForbiddenError);
            expect(customersList).toHaveLength(1);
        });

        it("rejects DISPATCHER with ForbiddenError (does not have customers.delete)", async () => {
            registerUser("user_disp");
            registerMember("user_disp", WS_ID_1, "DISPATCHER");
            loginAs("user_disp");

            seedCustomer("cust_1", WS_ID_1, "Protected Customer", "INACTIVE");

            await expect(deleteCustomer(WS_ID_1, "cust_1")).rejects.toThrow(ForbiddenError);
            expect(customersList).toHaveLength(1);
        });

        it("rejects TECHNICIAN with ForbiddenError", async () => {
            registerUser("user_tech");
            registerMember("user_tech", WS_ID_1, "TECHNICIAN");
            loginAs("user_tech");

            seedCustomer("cust_1", WS_ID_1, "Protected Customer", "INACTIVE");

            await expect(deleteCustomer(WS_ID_1, "cust_1")).rejects.toThrow(ForbiddenError);
            expect(customersList).toHaveLength(1);
        });

        it("rejects ACCOUNTANT with ForbiddenError", async () => {
            registerUser("user_acct");
            registerMember("user_acct", WS_ID_1, "ACCOUNTANT");
            loginAs("user_acct");

            seedCustomer("cust_1", WS_ID_1, "Protected Customer", "INACTIVE");

            await expect(deleteCustomer(WS_ID_1, "cust_1")).rejects.toThrow(ForbiddenError);
            expect(customersList).toHaveLength(1);
        });

        it("rejects unauthenticated caller with UnauthorizedError", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(deleteCustomer(WS_ID_1, "cust_1")).rejects.toThrow(UnauthorizedError);
        });

        it("rejects inactive workspace membership with WorkspaceAccessDeniedError", async () => {
            registerUser("user_suspended");
            registerMember("user_suspended", WS_ID_1, "ADMIN", "SUSPENDED");
            loginAs("user_suspended");

            seedCustomer("cust_1", WS_ID_1, "Protected Customer", "INACTIVE");

            await expect(deleteCustomer(WS_ID_1, "cust_1")).rejects.toThrow(WorkspaceAccessDeniedError);
        });

        it("rejects deactivated user with WorkspaceAccessDeniedError", async () => {
            registerUser("user_deactivated", "Deactivated", "DEACTIVATED");
            registerMember("user_deactivated", WS_ID_1, "ADMIN");
            loginAs("user_deactivated");

            seedCustomer("cust_1", WS_ID_1, "Protected Customer", "INACTIVE");

            await expect(deleteCustomer(WS_ID_1, "cust_1")).rejects.toThrow(WorkspaceAccessDeniedError);
        });

        it("rejects non-existent workspace with WorkspaceNotFoundError", async () => {
            registerUser("user_admin");
            registerMember("user_admin", "ws_nonexistent", "ADMIN");
            loginAs("user_admin");

            await expect(deleteCustomer("ws_nonexistent", "cust_1")).rejects.toThrow(WorkspaceNotFoundError);
        });
    });

    describe("3. Tenant Isolation & Scope Enforcement", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");
        });

        it("throws CustomerNotFoundError when attempting to delete a customer in another workspace", async () => {
            seedCustomer("cust_ws2", WS_ID_2, "Foreign Customer", "INACTIVE");

            await expect(deleteCustomer(WS_ID_1, "cust_ws2")).rejects.toThrow(CustomerNotFoundError);
            expect(customersList).toHaveLength(1);
        });
    });

    describe("4. Hard Deletion Mechanics & Database Error Handling", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");
        });

        it("successfully deletes the INACTIVE customer and returns the deleted record", async () => {
            seedCustomer("cust_1", WS_ID_1, "Acme Logistics", "INACTIVE", "CUST-00042");

            const deleted = await deleteCustomer(WS_ID_1, "cust_1");

            expect(deleted.id).toBe("cust_1");
            expect(deleted.name).toBe("Acme Logistics");
            expect(deleted.customerNumber).toBe("CUST-00042");
            expect(deleted.workspaceId).toBe(WS_ID_1);
            expect(customersList).toHaveLength(0);
        });

        it("throws CustomerNotFoundError when customer does not exist", async () => {
            await expect(deleteCustomer(WS_ID_1, "cust_missing")).rejects.toThrow(CustomerNotFoundError);
        });

        it("translates Prisma P2025 into CustomerNotFoundError", async () => {
            seedCustomer("cust_1", WS_ID_1, "Acme Logistics", "INACTIVE");

            mocks.customerDelete.mockRejectedValueOnce(
                Object.assign(new Error("Record to delete does not exist"), { code: "P2025" })
            );

            await expect(deleteCustomer(WS_ID_1, "cust_1")).rejects.toThrow(CustomerNotFoundError);
        });

        it("translates Prisma P2003 (foreign key / protected references) into CustomerDeletionNotAllowedError", async () => {
            seedCustomer("cust_1", WS_ID_1, "Acme Logistics", "INACTIVE");

            mocks.customerDelete.mockRejectedValueOnce(
                Object.assign(new Error("Foreign key constraint failed"), { code: "P2003" })
            );

            await expect(deleteCustomer(WS_ID_1, "cust_1")).rejects.toThrow(
                CustomerDeletionNotAllowedError
            );
        });

        it("translates unexpected database errors into CustomerDeletionError", async () => {
            seedCustomer("cust_1", WS_ID_1, "Acme Logistics", "INACTIVE");

            mocks.customerDelete.mockRejectedValueOnce(new Error("Database connection closed"));

            await expect(deleteCustomer(WS_ID_1, "cust_1")).rejects.toThrow(CustomerDeletionError);
        });
    });
});
