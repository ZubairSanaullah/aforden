import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    customerFindFirst: vi.fn(),
    customerUpdate: vi.fn(),
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
            update: mocks.customerUpdate,
        },
    },
}));

import {
    updateCustomerStatus,
    changeCustomerStatus,
    deactivateCustomer,
    reactivateCustomer,
} from "@/lib/services/customer/changeCustomerStatus";
import {
    CustomerNotFoundError,
    CustomerUpdateError,
} from "@/lib/services/customer/customerErrors";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
    WorkspaceNotFoundError,
} from "@/lib/services/authorization/authorizationErrors";
import type { Customer, User, Workspace, WorkspaceMember } from "@/generated/prisma/client";

describe("Phase 1.4.7 — Customer Lifecycle Service Layer", () => {
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

        mocks.customerUpdate.mockImplementation(async ({ where, data }: any) => {
            const index = customersList.findIndex((c) => c.id === where.id);
            if (index === -1) {
                throw new Error("Record not found in mock store");
            }

            const current = customersList[index]!;
            const updated: Customer = {
                ...current,
                status: data.status,
                updatedAt: new Date(),
            };

            customersList[index] = updated;
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
        status: "ACTIVE" | "INACTIVE" = "ACTIVE",
        customerNumber = "CUST-00042"
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
            addressLine2: "Suite 500",
            city: "New York",
            state: "NY",
            postalCode: "10001",
            country: "USA",
            status,
            notes: "Enterprise SLA client",
            createdAt: new Date("2026-08-19T10:00:00.000Z"),
            updatedAt: new Date("2026-08-19T10:00:00.000Z"),
        };
        customersList.push(customer);
        return customer;
    }

    describe("1. Customer Status Transitions (ACTIVE <-> INACTIVE)", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");
        });

        it("deactivates an active customer (ACTIVE -> INACTIVE)", async () => {
            seedCustomer("cust_1", WS_ID_1, "Apex Corp", "ACTIVE");

            const updated = await updateCustomerStatus(WS_ID_1, "cust_1", {
                status: "INACTIVE",
            });

            expect(updated.status).toBe("INACTIVE");
            expect(updated.name).toBe("Apex Corp");
            expect(updated.customerNumber).toBe("CUST-00042");
            expect(updated.email).toBe("info@client.com");
            expect(mocks.customerUpdate).toHaveBeenCalledTimes(1);
        });

        it("reactivates an inactive customer (INACTIVE -> ACTIVE)", async () => {
            seedCustomer("cust_1", WS_ID_1, "Apex Corp", "INACTIVE");

            const updated = await updateCustomerStatus(WS_ID_1, "cust_1", {
                status: "ACTIVE",
            });

            expect(updated.status).toBe("ACTIVE");
            expect(updated.name).toBe("Apex Corp");
            expect(mocks.customerUpdate).toHaveBeenCalledTimes(1);
        });

        it("supports changeCustomerStatus alias with direct string input and optional reason", async () => {
            seedCustomer("cust_1", WS_ID_1, "Apex Corp", "ACTIVE");

            const updated = await changeCustomerStatus(
                WS_ID_1,
                "cust_1",
                "INACTIVE",
                "Contract ended"
            );
            expect(updated.status).toBe("INACTIVE");
        });

        it("supports deactivateCustomer helper with optional reason", async () => {
            seedCustomer("cust_1", WS_ID_1, "Apex Corp", "ACTIVE");

            const updated = await deactivateCustomer(
                WS_ID_1,
                "cust_1",
                "Customer requested suspension"
            );
            expect(updated.status).toBe("INACTIVE");
        });

        it("supports reactivateCustomer helper with optional reason", async () => {
            seedCustomer("cust_1", WS_ID_1, "Apex Corp", "INACTIVE");

            const updated = await reactivateCustomer(
                WS_ID_1,
                "cust_1",
                "Renewal contract signed"
            );
            expect(updated.status).toBe("ACTIVE");
        });

        it("handles same-status transitions idempotently without triggering database update or timestamp mutation", async () => {
            const original = seedCustomer("cust_1", WS_ID_1, "Apex Corp", "ACTIVE");

            const updated = await updateCustomerStatus(WS_ID_1, "cust_1", {
                status: "ACTIVE",
            });

            expect(updated.status).toBe("ACTIVE");
            expect(updated.updatedAt).toEqual(original.updatedAt);
            expect(mocks.customerUpdate).not.toHaveBeenCalled();
        });

        it("preserves customerNumber across full lifecycle sequence (ACTIVE -> INACTIVE -> ACTIVE)", async () => {
            seedCustomer("cust_seq", WS_ID_1, "Sequential Client", "ACTIVE", "CUST-99001");

            // Deactivate
            const deactivated = await deactivateCustomer(WS_ID_1, "cust_seq");
            expect(deactivated.status).toBe("INACTIVE");
            expect(deactivated.customerNumber).toBe("CUST-99001");

            // Reactivate
            const reactivated = await reactivateCustomer(WS_ID_1, "cust_seq");
            expect(reactivated.status).toBe("ACTIVE");
            expect(reactivated.customerNumber).toBe("CUST-99001");
        });

        it("preserves all profile fields during lifecycle transition and does not delete customer", async () => {
            seedCustomer("cust_full", WS_ID_1, "Full Profile Corp", "ACTIVE", "CUST-77777");

            const deactivated = await deactivateCustomer(WS_ID_1, "cust_full");

            expect(deactivated.id).toBe("cust_full");
            expect(deactivated.workspaceId).toBe(WS_ID_1);
            expect(deactivated.name).toBe("Full Profile Corp");
            expect(deactivated.customerNumber).toBe("CUST-77777");
            expect(deactivated.email).toBe("info@client.com");
            expect(deactivated.phone).toBe("+1-555-0100");
            expect(deactivated.website).toBe("https://client.com");
            expect(deactivated.addressLine1).toBe("100 Broadway");
            expect(deactivated.addressLine2).toBe("Suite 500");
            expect(deactivated.city).toBe("New York");
            expect(deactivated.state).toBe("NY");
            expect(deactivated.postalCode).toBe("10001");
            expect(deactivated.country).toBe("USA");
            expect(deactivated.notes).toBe("Enterprise SLA client");

            // Verify customer still exists in the database/store
            expect(customersList.find((c) => c.id === "cust_full")).toBeDefined();
        });
    });

    describe("2. Authorization & RBAC Checks", () => {
        it("allows OWNER to change customer status", async () => {
            registerUser("user_owner");
            registerMember("user_owner", WS_ID_1, "OWNER");
            loginAs("user_owner");

            seedCustomer("cust_1", WS_ID_1, "Client", "ACTIVE");
            const updated = await updateCustomerStatus(WS_ID_1, "cust_1", { status: "INACTIVE" });
            expect(updated.status).toBe("INACTIVE");
        });

        it("allows ADMIN to change customer status", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Client", "ACTIVE");
            const updated = await updateCustomerStatus(WS_ID_1, "cust_1", { status: "INACTIVE" });
            expect(updated.status).toBe("INACTIVE");
        });

        it("allows MANAGER to change customer status", async () => {
            registerUser("user_mgr");
            registerMember("user_mgr", WS_ID_1, "MANAGER");
            loginAs("user_mgr");

            seedCustomer("cust_1", WS_ID_1, "Client", "ACTIVE");
            const updated = await updateCustomerStatus(WS_ID_1, "cust_1", { status: "INACTIVE" });
            expect(updated.status).toBe("INACTIVE");
        });

        it("allows DISPATCHER to change customer status", async () => {
            registerUser("user_disp");
            registerMember("user_disp", WS_ID_1, "DISPATCHER");
            loginAs("user_disp");

            seedCustomer("cust_1", WS_ID_1, "Client", "ACTIVE");
            const updated = await updateCustomerStatus(WS_ID_1, "cust_1", { status: "INACTIVE" });
            expect(updated.status).toBe("INACTIVE");
        });

        it("rejects TECHNICIAN with ForbiddenError", async () => {
            registerUser("user_tech");
            registerMember("user_tech", WS_ID_1, "TECHNICIAN");
            loginAs("user_tech");

            seedCustomer("cust_1", WS_ID_1, "Client", "ACTIVE");
            await expect(
                updateCustomerStatus(WS_ID_1, "cust_1", { status: "INACTIVE" })
            ).rejects.toThrow(ForbiddenError);
        });

        it("rejects ACCOUNTANT with ForbiddenError", async () => {
            registerUser("user_acct");
            registerMember("user_acct", WS_ID_1, "ACCOUNTANT");
            loginAs("user_acct");

            seedCustomer("cust_1", WS_ID_1, "Client", "ACTIVE");
            await expect(
                updateCustomerStatus(WS_ID_1, "cust_1", { status: "INACTIVE" })
            ).rejects.toThrow(ForbiddenError);
        });

        it("rejects unauthenticated caller with UnauthorizedError", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(
                updateCustomerStatus(WS_ID_1, "cust_1", { status: "INACTIVE" })
            ).rejects.toThrow(UnauthorizedError);
        });

        it("rejects inactive workspace membership with WorkspaceAccessDeniedError", async () => {
            registerUser("user_suspended");
            registerMember("user_suspended", WS_ID_1, "ADMIN", "SUSPENDED");
            loginAs("user_suspended");

            seedCustomer("cust_1", WS_ID_1, "Client", "ACTIVE");
            await expect(
                updateCustomerStatus(WS_ID_1, "cust_1", { status: "INACTIVE" })
            ).rejects.toThrow(WorkspaceAccessDeniedError);
        });

        it("rejects deactivated user with WorkspaceAccessDeniedError", async () => {
            registerUser("user_deactivated", "Deactivated", "DEACTIVATED");
            registerMember("user_deactivated", WS_ID_1, "ADMIN");
            loginAs("user_deactivated");

            seedCustomer("cust_1", WS_ID_1, "Client", "ACTIVE");
            await expect(
                updateCustomerStatus(WS_ID_1, "cust_1", { status: "INACTIVE" })
            ).rejects.toThrow(WorkspaceAccessDeniedError);
        });

        it("rejects non-existent workspace with WorkspaceNotFoundError", async () => {
            registerUser("user_admin");
            registerMember("user_admin", "ws_nonexistent", "ADMIN");
            loginAs("user_admin");

            await expect(
                updateCustomerStatus("ws_nonexistent", "cust_1", { status: "INACTIVE" })
            ).rejects.toThrow(WorkspaceNotFoundError);
        });
    });

    describe("3. Tenant Isolation & Scope Enforcement", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");
        });

        it("throws CustomerNotFoundError when attempting to change status of customer in another workspace", async () => {
            seedCustomer("cust_ws2", WS_ID_2, "Foreign Customer", "ACTIVE");

            await expect(
                updateCustomerStatus(WS_ID_1, "cust_ws2", { status: "INACTIVE" })
            ).rejects.toThrow(CustomerNotFoundError);
        });
    });

    describe("4. Validation & Database Error Handling", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");
        });

        it("rejects invalid status values (e.g. PENDING, DELETED, ARCHIVED)", async () => {
            seedCustomer("cust_1", WS_ID_1, "Client", "ACTIVE");

            await expect(
                updateCustomerStatus(WS_ID_1, "cust_1", { status: "DELETED" as any })
            ).rejects.toThrow();

            await expect(
                updateCustomerStatus(WS_ID_1, "cust_1", { status: "ARCHIVED" as any })
            ).rejects.toThrow();
        });

        it("throws CustomerNotFoundError when customer ID does not exist", async () => {
            await expect(
                updateCustomerStatus(WS_ID_1, "cust_missing", { status: "INACTIVE" })
            ).rejects.toThrow(CustomerNotFoundError);
        });

        it("translates unexpected database errors into CustomerUpdateError", async () => {
            seedCustomer("cust_1", WS_ID_1, "Client", "ACTIVE");

            mocks.customerUpdate.mockRejectedValueOnce(new Error("Connection terminated"));

            await expect(
                updateCustomerStatus(WS_ID_1, "cust_1", { status: "INACTIVE" })
            ).rejects.toThrow(CustomerUpdateError);
        });
    });
});
