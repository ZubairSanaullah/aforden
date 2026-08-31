import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    customerCreate: vi.fn(),
    customerFindUnique: vi.fn(),
    customerFindFirst: vi.fn(),
    customerFindMany: vi.fn(),
    customerUpdate: vi.fn(),
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
            create: mocks.customerCreate,
            findUnique: mocks.customerFindUnique,
            findFirst: mocks.customerFindFirst,
            findMany: mocks.customerFindMany,
            update: mocks.customerUpdate,
            delete: mocks.customerDelete,
        },
    },
}));

import { createCustomer } from "@/lib/services/customer/createCustomer";
import {
    DuplicateCustomerNumberError,
    CustomerCreationError,
} from "@/lib/services/customer/customerErrors";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
    WorkspaceNotFoundError,
} from "@/lib/services/authorization/authorizationErrors";
import type { Customer, User, Workspace, WorkspaceMember } from "@/generated/prisma/client";

describe("Phase 1.4.4 — Customer Creation Service Layer", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let customersList: Customer[];

    const WS_ID = "ws_apex_100";
    const WS_ID_2 = "ws_beta_200";

    beforeEach(() => {
        vi.clearAllMocks();
        usersMap = new Map();
        workspacesMap = new Map();
        membersMap = new Map();
        customersList = [];

        // Setup mock implementations
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

        mocks.customerFindFirst.mockImplementation(async ({ where, orderBy }: any) => {
            let matched = customersList.filter((c) => {
                if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
                if (where.customerNumber?.startsWith) {
                    if (!c.customerNumber || !c.customerNumber.startsWith(where.customerNumber.startsWith)) {
                        return false;
                    }
                }
                return true;
            });

            if (orderBy?.customerNumber === "desc") {
                matched = matched.sort((a, b) =>
                    (b.customerNumber || "").localeCompare(a.customerNumber || "")
                );
            }

            return matched[0] || null;
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

        mocks.customerCreate.mockImplementation(async ({ data }: { data: any }) => {
            // Check unique constraint
            const duplicate = customersList.find(
                (c) => c.workspaceId === data.workspaceId && c.customerNumber === data.customerNumber
            );
            if (duplicate) {
                const err = new Error("Unique constraint failed on the fields: (`workspaceId`,`customerNumber`)");
                (err as any).code = "P2002";
                throw err;
            }

            const created: Customer = {
                id: `cust_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                workspaceId: data.workspaceId,
                customerNumber: data.customerNumber,
                name: data.name,
                email: data.email ?? null,
                phone: data.phone ?? null,
                website: data.website ?? null,
                addressLine1: data.addressLine1 ?? null,
                addressLine2: data.addressLine2 ?? null,
                city: data.city ?? null,
                state: data.state ?? null,
                postalCode: data.postalCode ?? null,
                country: data.country ?? null,
                status: data.status ?? "ACTIVE",
                notes: data.notes ?? null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            customersList.push(created);
            return created;
        });

        // Setup default workspace
        registerWorkspace(WS_ID, "Apex Operations", "apex-ops");
        registerWorkspace(WS_ID_2, "Beta Field Services", "beta-services");
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

    describe("1. Successful Customer Creation", () => {
        it("creates a customer with minimal required fields and auto-generates sequential customerNumber `CUST-00001`", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            const customer = await createCustomer(WS_ID, {
                name: "Apex Logistics Ltd",
            });

            expect(customer.id).toBeDefined();
            expect(customer.workspaceId).toBe(WS_ID);
            expect(customer.name).toBe("Apex Logistics Ltd");
            expect(customer.customerNumber).toBe("CUST-00001");
            expect(customer.status).toBe("ACTIVE");
            expect(customer.email).toBeNull();
            expect(customer.phone).toBeNull();
            expect(customer.website).toBeNull();
            expect(customer.addressLine1).toBeNull();
            expect(customer.notes).toBeNull();
        });

        it("creates subsequent customers with incrementing sequential numbers (`CUST-00002`, `CUST-00003`)", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            const cust1 = await createCustomer(WS_ID, { name: "Client One" });
            const cust2 = await createCustomer(WS_ID, { name: "Client Two" });
            const cust3 = await createCustomer(WS_ID, { name: "Client Three" });

            expect(cust1.customerNumber).toBe("CUST-00001");
            expect(cust2.customerNumber).toBe("CUST-00002");
            expect(cust3.customerNumber).toBe("CUST-00003");
        });

        it("preserves an explicitly supplied valid customerNumber", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            const customer = await createCustomer(WS_ID, {
                name: "Special Contract Client",
                customerNumber: "ENTERPRISE-8800",
            });

            expect(customer.customerNumber).toBe("ENTERPRISE-8800");
            expect(customer.name).toBe("Special Contract Client");
        });

        it("persists all optional fields correctly", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            const payload = {
                name: "Global Energy Solutions Inc.",
                customerNumber: "CUST-99001",
                email: "Support@GlobalEnergy.com",
                phone: "+44 20 7946 0912",
                website: "https://globalenergy.com",
                addressLine1: "100 Bishopsgate",
                addressLine2: "Suite 400",
                city: "London",
                state: "Greater London",
                postalCode: "EC2N 4AG",
                country: "United Kingdom",
                notes: "Key commercial client with recurring preventive maintenance.",
            };

            const customer = await createCustomer(WS_ID, payload);

            expect(customer.name).toBe("Global Energy Solutions Inc.");
            expect(customer.customerNumber).toBe("CUST-99001");
            expect(customer.email).toBe("support@globalenergy.com"); // normalized lowercase
            expect(customer.phone).toBe("+44 20 7946 0912");
            expect(customer.website).toBe("https://globalenergy.com");
            expect(customer.addressLine1).toBe("100 Bishopsgate");
            expect(customer.addressLine2).toBe("Suite 400");
            expect(customer.city).toBe("London");
            expect(customer.state).toBe("Greater London");
            expect(customer.postalCode).toBe("EC2N 4AG");
            expect(customer.country).toBe("United Kingdom");
            expect(customer.notes).toBe("Key commercial client with recurring preventive maintenance.");
            expect(customer.status).toBe("ACTIVE");
        });

        it("trims whitespace from customer name and text fields", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            const customer = await createCustomer(WS_ID, {
                name: "   Pinnacle HVAC Solutions   ",
                customerNumber: "   PIN-001   ",
                city: "   Chicago   ",
            });

            expect(customer.name).toBe("Pinnacle HVAC Solutions");
            expect(customer.customerNumber).toBe("PIN-001");
            expect(customer.city).toBe("Chicago");
        });
    });

    describe("2. Authorization & RBAC Checks", () => {
        it("allows OWNER to create a customer", async () => {
            registerUser("user_owner");
            registerMember("user_owner", WS_ID, "OWNER");
            loginAs("user_owner");

            const customer = await createCustomer(WS_ID, { name: "Owner Client" });
            expect(customer.name).toBe("Owner Client");
        });

        it("allows ADMIN to create a customer", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            const customer = await createCustomer(WS_ID, { name: "Admin Client" });
            expect(customer.name).toBe("Admin Client");
        });

        it("allows MANAGER to create a customer", async () => {
            registerUser("user_mgr");
            registerMember("user_mgr", WS_ID, "MANAGER");
            loginAs("user_mgr");

            const customer = await createCustomer(WS_ID, { name: "Manager Client" });
            expect(customer.name).toBe("Manager Client");
        });

        it("allows DISPATCHER to create a customer", async () => {
            registerUser("user_disp");
            registerMember("user_disp", WS_ID, "DISPATCHER");
            loginAs("user_disp");

            const customer = await createCustomer(WS_ID, { name: "Dispatcher Client" });
            expect(customer.name).toBe("Dispatcher Client");
        });

        it("rejects TECHNICIAN from creating a customer with ForbiddenError", async () => {
            registerUser("user_tech");
            registerMember("user_tech", WS_ID, "TECHNICIAN");
            loginAs("user_tech");

            await expect(createCustomer(WS_ID, { name: "Unauthorized Client" })).rejects.toThrow(
                ForbiddenError
            );
        });

        it("rejects ACCOUNTANT from creating a customer with ForbiddenError", async () => {
            registerUser("user_acct");
            registerMember("user_acct", WS_ID, "ACCOUNTANT");
            loginAs("user_acct");

            await expect(createCustomer(WS_ID, { name: "Unauthorized Client" })).rejects.toThrow(
                ForbiddenError
            );
        });

        it("rejects unauthenticated caller with UnauthorizedError", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(createCustomer(WS_ID, { name: "Unauth Client" })).rejects.toThrow(
                UnauthorizedError
            );
        });

        it("rejects user with non-active user status with WorkspaceAccessDeniedError", async () => {
            registerUser("user_suspended", "Suspended User", "SUSPENDED");
            registerMember("user_suspended", WS_ID, "ADMIN");
            loginAs("user_suspended");

            await expect(createCustomer(WS_ID, { name: "Client" })).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
        });

        it("rejects member with non-active membership status with WorkspaceAccessDeniedError", async () => {
            registerUser("user_invited");
            registerMember("user_invited", WS_ID, "ADMIN", "INVITED");
            loginAs("user_invited");

            await expect(createCustomer(WS_ID, { name: "Client" })).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
        });

        it("rejects non-existent workspace with WorkspaceNotFoundError", async () => {
            registerUser("user_admin");
            registerMember("user_admin", "ws_nonexistent", "ADMIN");
            loginAs("user_admin");

            await expect(createCustomer("ws_nonexistent", { name: "Client" })).rejects.toThrow(
                WorkspaceNotFoundError
            );
        });
    });

    describe("3. Tenant Isolation & Scope Enforcement", () => {
        it("strictly enforces workspaceId from the authorized context", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            // Malicious payload attempts to inject another workspaceId
            const customer = await createCustomer(WS_ID, {
                name: "Tenant Boundary Test",
                workspaceId: "ws_other_victim",
            } as any);

            expect(customer.workspaceId).toBe(WS_ID);
            expect(customer.workspaceId).not.toBe("ws_other_victim");
        });

        it("isolates customer numbers by workspace (different workspaces can have identical customer numbers)", async () => {
            registerUser("user_admin_ws1");
            registerMember("user_admin_ws1", WS_ID, "ADMIN");

            registerUser("user_admin_ws2");
            registerMember("user_admin_ws2", WS_ID_2, "ADMIN");

            // WS 1 creates CUST-00001
            loginAs("user_admin_ws1");
            const custWs1 = await createCustomer(WS_ID, { name: "WS 1 Customer" });

            // WS 2 creates CUST-00001
            loginAs("user_admin_ws2");
            const custWs2 = await createCustomer(WS_ID_2, { name: "WS 2 Customer" });

            expect(custWs1.customerNumber).toBe("CUST-00001");
            expect(custWs1.workspaceId).toBe(WS_ID);

            expect(custWs2.customerNumber).toBe("CUST-00001");
            expect(custWs2.workspaceId).toBe(WS_ID_2);
        });
    });

    describe("4. Duplicate Protection & Customer Number Constraints", () => {
        it("rejects explicitly supplied duplicate customerNumber in the same workspace with DuplicateCustomerNumberError", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            await createCustomer(WS_ID, {
                name: "Customer A",
                customerNumber: "DUP-12345",
            });

            await expect(
                createCustomer(WS_ID, {
                    name: "Customer B",
                    customerNumber: "DUP-12345",
                })
            ).rejects.toThrow(DuplicateCustomerNumberError);
        });

        it("permits same customerNumber across different workspaces", async () => {
            registerUser("user_admin_ws1");
            registerMember("user_admin_ws1", WS_ID, "ADMIN");

            registerUser("user_admin_ws2");
            registerMember("user_admin_ws2", WS_ID_2, "ADMIN");

            loginAs("user_admin_ws1");
            const cust1 = await createCustomer(WS_ID, {
                name: "Custom Number WS1",
                customerNumber: "GLOBAL-CORP-99",
            });

            loginAs("user_admin_ws2");
            const cust2 = await createCustomer(WS_ID_2, {
                name: "Custom Number WS2",
                customerNumber: "GLOBAL-CORP-99",
            });

            expect(cust1.customerNumber).toBe("GLOBAL-CORP-99");
            expect(cust2.customerNumber).toBe("GLOBAL-CORP-99");
        });

        it("retries auto-generation when a race condition causes a unique constraint violation on auto-generated number", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            let attemptCount = 0;
            mocks.customerCreate.mockImplementation(async ({ data }: any) => {
                attemptCount++;
                if (attemptCount === 1) {
                    // Simulate another request winning the race for CUST-00001
                    customersList.push({
                        id: "cust_race_winner",
                        workspaceId: WS_ID,
                        customerNumber: "CUST-00001",
                        name: "Race Winner",
                        email: null,
                        phone: null,
                        website: null,
                        addressLine1: null,
                        addressLine2: null,
                        city: null,
                        state: null,
                        postalCode: null,
                        country: null,
                        status: "ACTIVE",
                        notes: null,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    });
                    const err = new Error("Unique constraint failed on the fields: (`workspaceId`,`customerNumber`)");
                    (err as any).code = "P2002";
                    throw err;
                }

                return {
                    id: "cust_race_retry_success",
                    workspaceId: data.workspaceId,
                    customerNumber: data.customerNumber,
                    name: data.name,
                    email: null,
                    phone: null,
                    website: null,
                    addressLine1: null,
                    addressLine2: null,
                    city: null,
                    state: null,
                    postalCode: null,
                    country: null,
                    status: "ACTIVE",
                    notes: null,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                };
            });

            const customer = await createCustomer(WS_ID, {
                name: "Retried Customer",
            });

            expect(attemptCount).toBe(2);
            expect(customer.customerNumber).toBe("CUST-00002");
        });
    });

    describe("5. Validation Failures", () => {
        it("rejects missing name before hitting database", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            await expect(createCustomer(WS_ID, {} as any)).rejects.toThrow();
            expect(mocks.customerCreate).not.toHaveBeenCalled();
        });

        it("rejects empty name", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            await expect(createCustomer(WS_ID, { name: "   " })).rejects.toThrow(
                /Customer name must not be empty/
            );
        });

        it("rejects invalid email", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            await expect(
                createCustomer(WS_ID, {
                    name: "Acme",
                    email: "invalid-email-format",
                })
            ).rejects.toThrow(/valid email address/);
        });

        it("rejects invalid website URL", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            await expect(
                createCustomer(WS_ID, {
                    name: "Acme",
                    website: "ftp://example.com",
                })
            ).rejects.toThrow(/must start with http:\/\/ or https:\/\//);
        });

        it("rejects overly long fields", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            await expect(
                createCustomer(WS_ID, {
                    name: "A".repeat(151),
                })
            ).rejects.toThrow(/less than 150 characters/);

            await expect(
                createCustomer(WS_ID, {
                    name: "Acme",
                    phone: "1".repeat(51),
                })
            ).rejects.toThrow(/less than 50 characters/);

            await expect(
                createCustomer(WS_ID, {
                    name: "Acme",
                    notes: "N".repeat(2001),
                })
            ).rejects.toThrow(/less than 2000 characters/);
        });
    });

    describe("6. Error Translation & Database Safety", () => {
        it("translates unexpected database errors into CustomerCreationError without leaking raw DB details", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID, "ADMIN");
            loginAs("user_admin");

            mocks.customerCreate.mockRejectedValue(new Error("Connection reset by peer"));

            await expect(createCustomer(WS_ID, { name: "Test Corp" })).rejects.toThrow(
                CustomerCreationError
            );
        });
    });
});
