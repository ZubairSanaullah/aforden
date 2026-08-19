import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    customerFindFirst: vi.fn(),
    customerFindUnique: vi.fn(),
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
            findUnique: mocks.customerFindUnique,
            update: mocks.customerUpdate,
        },
    },
}));

import { updateCustomer } from "@/lib/services/customer/updateCustomer";
import {
    CustomerNotFoundError,
    DuplicateCustomerNumberError,
    CustomerUpdateError,
    InvalidCustomerError,
} from "@/lib/services/customer/customerErrors";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
    WorkspaceNotFoundError,
} from "@/lib/services/authorization/authorizationErrors";
import type { Customer, User, Workspace, WorkspaceMember } from "@/generated/prisma/client";

describe("Phase 1.4.6 — Customer Update Service Layer", () => {
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

        mocks.customerUpdate.mockImplementation(async ({ where, data }: any) => {
            const index = customersList.findIndex((c) => c.id === where.id);
            if (index === -1) {
                throw new Error("Record not found in mock store");
            }

            const current = customersList[index]!;

            // Check unique constraint collision simulation
            if (data.customerNumber && data.customerNumber !== current.customerNumber) {
                const duplicate = customersList.find(
                    (c) =>
                        c.id !== current.id &&
                        c.workspaceId === current.workspaceId &&
                        c.customerNumber === data.customerNumber
                );
                if (duplicate) {
                    const err = new Error("Unique constraint failed on the fields: (`workspaceId`,`customerNumber`)");
                    (err as any).code = "P2002";
                    throw err;
                }
            }

            const updated: Customer = {
                ...current,
                ...data,
                updatedAt: new Date(),
            };

            customersList[index] = updated;
            return updated;
        });

        // Register default workspaces
        registerWorkspace(WS_ID_1, "Alpha Operations", "alpha-ops");
        registerWorkspace(WS_ID_2, "Beta Field Services", "beta-services");
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
        customerNumber = "CUST-00001",
        overrides: Partial<Customer> = {}
    ): Customer {
        const customer: Customer = {
            id,
            workspaceId,
            customerNumber,
            name,
            email: overrides.email ?? "info@client.com",
            phone: overrides.phone ?? "+1-555-0100",
            website: overrides.website ?? "https://client.com",
            addressLine1: overrides.addressLine1 ?? "100 Broadway",
            addressLine2: overrides.addressLine2 ?? null,
            city: overrides.city ?? "New York",
            state: overrides.state ?? "NY",
            postalCode: overrides.postalCode ?? "10001",
            country: overrides.country ?? "USA",
            status: overrides.status ?? "ACTIVE",
            notes: overrides.notes ?? "Initial notes",
            createdAt: overrides.createdAt ?? new Date("2026-08-19T10:00:00.000Z"),
            updatedAt: overrides.updatedAt ?? new Date("2026-08-19T10:00:00.000Z"),
        };
        customersList.push(customer);
        return customer;
    }

    describe("1. Authorization & RBAC Checks", () => {
        it("allows OWNER to update a customer", async () => {
            registerUser("user_owner");
            registerMember("user_owner", WS_ID_1, "OWNER");
            loginAs("user_owner");

            seedCustomer("cust_1", WS_ID_1, "Original Name");

            const updated = await updateCustomer(WS_ID_1, "cust_1", { name: "Owner Updated" });
            expect(updated.name).toBe("Owner Updated");
        });

        it("allows ADMIN to update a customer", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Original Name");

            const updated = await updateCustomer(WS_ID_1, "cust_1", { name: "Admin Updated" });
            expect(updated.name).toBe("Admin Updated");
        });

        it("allows MANAGER to update a customer", async () => {
            registerUser("user_mgr");
            registerMember("user_mgr", WS_ID_1, "MANAGER");
            loginAs("user_mgr");

            seedCustomer("cust_1", WS_ID_1, "Original Name");

            const updated = await updateCustomer(WS_ID_1, "cust_1", { name: "Manager Updated" });
            expect(updated.name).toBe("Manager Updated");
        });

        it("allows DISPATCHER to update a customer", async () => {
            registerUser("user_disp");
            registerMember("user_disp", WS_ID_1, "DISPATCHER");
            loginAs("user_disp");

            seedCustomer("cust_1", WS_ID_1, "Original Name");

            const updated = await updateCustomer(WS_ID_1, "cust_1", { name: "Dispatcher Updated" });
            expect(updated.name).toBe("Dispatcher Updated");
        });

        it("rejects TECHNICIAN with ForbiddenError", async () => {
            registerUser("user_tech");
            registerMember("user_tech", WS_ID_1, "TECHNICIAN");
            loginAs("user_tech");

            seedCustomer("cust_1", WS_ID_1, "Original Name");

            await expect(
                updateCustomer(WS_ID_1, "cust_1", { name: "Tech Attempt" })
            ).rejects.toThrow(ForbiddenError);
        });

        it("rejects ACCOUNTANT with ForbiddenError", async () => {
            registerUser("user_acct");
            registerMember("user_acct", WS_ID_1, "ACCOUNTANT");
            loginAs("user_acct");

            seedCustomer("cust_1", WS_ID_1, "Original Name");

            await expect(
                updateCustomer(WS_ID_1, "cust_1", { name: "Acct Attempt" })
            ).rejects.toThrow(ForbiddenError);
        });

        it("rejects unauthenticated caller with UnauthorizedError", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(
                updateCustomer(WS_ID_1, "cust_1", { name: "Unauth Attempt" })
            ).rejects.toThrow(UnauthorizedError);
        });

        it("rejects inactive workspace membership with WorkspaceAccessDeniedError", async () => {
            registerUser("user_suspended");
            registerMember("user_suspended", WS_ID_1, "ADMIN", "SUSPENDED");
            loginAs("user_suspended");

            seedCustomer("cust_1", WS_ID_1, "Original Name");

            await expect(
                updateCustomer(WS_ID_1, "cust_1", { name: "Suspended Attempt" })
            ).rejects.toThrow(WorkspaceAccessDeniedError);
        });

        it("rejects deactivated user with WorkspaceAccessDeniedError", async () => {
            registerUser("user_deactivated", "Deactivated", "DEACTIVATED");
            registerMember("user_deactivated", WS_ID_1, "ADMIN");
            loginAs("user_deactivated");

            seedCustomer("cust_1", WS_ID_1, "Original Name");

            await expect(
                updateCustomer(WS_ID_1, "cust_1", { name: "Deactivated Attempt" })
            ).rejects.toThrow(WorkspaceAccessDeniedError);
        });

        it("rejects non-existent workspace with WorkspaceNotFoundError", async () => {
            registerUser("user_admin");
            registerMember("user_admin", "ws_nonexistent", "ADMIN");
            loginAs("user_admin");

            await expect(
                updateCustomer("ws_nonexistent", "cust_1", { name: "Test" })
            ).rejects.toThrow(WorkspaceNotFoundError);
        });
    });

    describe("2. Tenant Isolation & Scope Enforcement", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");
        });

        it("throws CustomerNotFoundError when attempting to update a customer in another workspace", async () => {
            seedCustomer("cust_ws2", WS_ID_2, "Foreign Customer");

            await expect(
                updateCustomer(WS_ID_1, "cust_ws2", { name: "Hacked Name" })
            ).rejects.toThrow(CustomerNotFoundError);
        });

        it("cannot override workspaceId via input payload", async () => {
            const original = seedCustomer("cust_1", WS_ID_1, "Tenant Bound Customer");

            const updated = await updateCustomer(WS_ID_1, "cust_1", {
                name: "Updated Name",
                workspaceId: "ws_foreign_override",
            } as any);

            expect(updated.workspaceId).toBe(WS_ID_1);
            expect(updated.workspaceId).not.toBe("ws_foreign_override");
        });
    });

    describe("3. Partial Update Semantics & Field Updates", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");
        });

        it("preserves omitted fields while updating specified fields", async () => {
            seedCustomer("cust_1", WS_ID_1, "Initial Corp", "CUST-00001", {
                email: "initial@corp.com",
                phone: "+1-555-0100",
                city: "New York",
                notes: "Preserve this note",
            });

            const updated = await updateCustomer(WS_ID_1, "cust_1", {
                city: "San Francisco",
            });

            expect(updated.city).toBe("San Francisco");
            expect(updated.name).toBe("Initial Corp");
            expect(updated.email).toBe("initial@corp.com");
            expect(updated.phone).toBe("+1-555-0100");
            expect(updated.customerNumber).toBe("CUST-00001");
            expect(updated.notes).toBe("Preserve this note");
        });

        it("allows explicit clearing of optional nullable fields with null", async () => {
            seedCustomer("cust_1", WS_ID_1, "Initial Corp", "CUST-00001", {
                email: "initial@corp.com",
                phone: "+1-555-0100",
                website: "https://initial.com",
                notes: "Initial note",
            });

            const updated = await updateCustomer(WS_ID_1, "cust_1", {
                email: null,
                phone: null,
                website: null,
                notes: null,
            });

            expect(updated.email).toBeNull();
            expect(updated.phone).toBeNull();
            expect(updated.website).toBeNull();
            expect(updated.notes).toBeNull();
            expect(updated.name).toBe("Initial Corp"); // Unchanged
        });

        it("updates all address and contact fields simultaneously", async () => {
            seedCustomer("cust_1", WS_ID_1, "Initial Corp");

            const updated = await updateCustomer(WS_ID_1, "cust_1", {
                name: "Omni Global Logistics",
                email: "Support@OmniGlobal.com", // normalized to lowercase
                phone: "+44 20 7123 4567",
                website: "https://omniglobal.com",
                addressLine1: "50 Finsbury Square",
                addressLine2: "Floor 8",
                city: "London",
                state: "Greater London",
                postalCode: "EC2A 1HD",
                country: "United Kingdom",
                notes: "High-priority enterprise account.",
            });

            expect(updated.name).toBe("Omni Global Logistics");
            expect(updated.email).toBe("support@omniglobal.com");
            expect(updated.phone).toBe("+44 20 7123 4567");
            expect(updated.website).toBe("https://omniglobal.com");
            expect(updated.addressLine1).toBe("50 Finsbury Square");
            expect(updated.addressLine2).toBe("Floor 8");
            expect(updated.city).toBe("London");
            expect(updated.state).toBe("Greater London");
            expect(updated.postalCode).toBe("EC2A 1HD");
            expect(updated.country).toBe("United Kingdom");
            expect(updated.notes).toBe("High-priority enterprise account.");
        });
    });

    describe("4. Customer Number Rules & Concurrency", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");
        });

        it("preserves existing customerNumber when omitted", async () => {
            seedCustomer("cust_1", WS_ID_1, "Initial Corp", "CUST-00042");

            const updated = await updateCustomer(WS_ID_1, "cust_1", { name: "Renamed Corp" });
            expect(updated.customerNumber).toBe("CUST-00042");
        });

        it("allows updating to a new unique customerNumber", async () => {
            seedCustomer("cust_1", WS_ID_1, "Initial Corp", "CUST-00001");

            const updated = await updateCustomer(WS_ID_1, "cust_1", {
                customerNumber: "ENTERPRISE-999",
            });

            expect(updated.customerNumber).toBe("ENTERPRISE-999");
        });

        it("allows updating other fields while passing the same customerNumber", async () => {
            seedCustomer("cust_1", WS_ID_1, "Initial Corp", "CUST-00001");

            const updated = await updateCustomer(WS_ID_1, "cust_1", {
                name: "New Name",
                customerNumber: "CUST-00001",
            });

            expect(updated.name).toBe("New Name");
            expect(updated.customerNumber).toBe("CUST-00001");
        });

        it("rejects updating to a customerNumber already used by another customer in the same workspace", async () => {
            seedCustomer("cust_1", WS_ID_1, "Customer 1", "CUST-00001");
            seedCustomer("cust_2", WS_ID_1, "Customer 2", "CUST-00002");

            await expect(
                updateCustomer(WS_ID_1, "cust_2", { customerNumber: "CUST-00001" })
            ).rejects.toThrow(DuplicateCustomerNumberError);
        });

        it("permits updating to a customerNumber that exists in a different workspace", async () => {
            seedCustomer("cust_ws1", WS_ID_1, "Customer 1", "CUST-00001");
            seedCustomer("cust_ws2", WS_ID_2, "Foreign Customer", "GLOBAL-777");

            const updated = await updateCustomer(WS_ID_1, "cust_ws1", {
                customerNumber: "GLOBAL-777",
            });

            expect(updated.customerNumber).toBe("GLOBAL-777");
        });

        it("rejects clearing customerNumber with null to preserve assigned number invariant", async () => {
            seedCustomer("cust_1", WS_ID_1, "Customer 1", "CUST-00001");

            await expect(
                updateCustomer(WS_ID_1, "cust_1", { customerNumber: null })
            ).rejects.toThrow(InvalidCustomerError);
        });

        it("translates Prisma P2002 unique constraint violations into DuplicateCustomerNumberError during concurrent race", async () => {
            seedCustomer("cust_1", WS_ID_1, "Customer 1", "CUST-00001");

            mocks.customerUpdate.mockRejectedValueOnce(
                Object.assign(new Error("Unique constraint failed"), { code: "P2002" })
            );

            await expect(
                updateCustomer(WS_ID_1, "cust_1", { customerNumber: "CUST-RACE-WINNER" })
            ).rejects.toThrow(DuplicateCustomerNumberError);
        });
    });

    describe("5. Status Protection & Validation", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");
        });

        it("does NOT modify customer status through generic profile update", async () => {
            seedCustomer("cust_1", WS_ID_1, "Active Customer", "CUST-00001", {
                status: "ACTIVE",
            });

            // Passing status in payload
            const updated = await updateCustomer(WS_ID_1, "cust_1", {
                name: "Updated Name",
                status: "INACTIVE",
            } as any);

            expect(updated.status).toBe("ACTIVE");
        });

        it("rejects empty name", async () => {
            seedCustomer("cust_1", WS_ID_1, "Original Name");

            await expect(
                updateCustomer(WS_ID_1, "cust_1", { name: "   " })
            ).rejects.toThrow(/Customer name must not be empty/);
        });

        it("rejects invalid email format", async () => {
            seedCustomer("cust_1", WS_ID_1, "Original Name");

            await expect(
                updateCustomer(WS_ID_1, "cust_1", { email: "not-an-email" })
            ).rejects.toThrow(/valid email address/);
        });

        it("rejects invalid website URL", async () => {
            seedCustomer("cust_1", WS_ID_1, "Original Name");

            await expect(
                updateCustomer(WS_ID_1, "cust_1", { website: "ftp://files.com" })
            ).rejects.toThrow(/must start with http:\/\/ or https:\/\//);
        });

        it("rejects non-existent customer with CustomerNotFoundError", async () => {
            await expect(
                updateCustomer(WS_ID_1, "cust_nonexistent", { name: "Any Name" })
            ).rejects.toThrow(CustomerNotFoundError);
        });

        it("translates unexpected database errors into CustomerUpdateError", async () => {
            seedCustomer("cust_1", WS_ID_1, "Original Name");

            mocks.customerUpdate.mockRejectedValueOnce(new Error("Connection reset"));

            await expect(
                updateCustomer(WS_ID_1, "cust_1", { name: "New Name" })
            ).rejects.toThrow(CustomerUpdateError);
        });
    });
});
