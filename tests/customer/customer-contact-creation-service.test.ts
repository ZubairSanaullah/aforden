import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    customerFindFirst: vi.fn(),
    customerContactFindFirst: vi.fn(),
    customerContactCreate: vi.fn(),
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
            create: mocks.customerContactCreate,
        },
    },
}));

import { createCustomerContact } from "@/lib/services/customer/createCustomerContact";
import {
    CustomerNotFoundError,
    InactiveCustomerError,
    CustomerContactCreationError,
    CustomerContactPrimaryExistsError,
} from "@/lib/services/customer/customerErrors";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
    WorkspaceNotFoundError,
} from "@/lib/services/authorization/authorizationErrors";
import type { Customer, CustomerContact, User, Workspace, WorkspaceMember } from "@/generated/prisma/client";

describe("Phase 1.4.11 — Customer Contact Creation Service Layer", () => {
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
                    if (where.customerId && cnt.customerId !== where.customerId) return false;
                    if (where.isPrimary !== undefined && cnt.isPrimary !== where.isPrimary) return false;
                    return true;
                }) || null
            );
        });

        mocks.customerContactCreate.mockImplementation(async ({ data }: any) => {
            if (data.isPrimary) {
                const existingPrimary = contactsList.find(
                    (c) => c.customerId === data.customerId && c.isPrimary === true
                );
                if (existingPrimary) {
                    const err = new Error("Unique constraint failed on the fields: (`customerId`,`isPrimary`)");
                    (err as any).code = "P2002";
                    throw err;
                }
            }

            const contact: CustomerContact = {
                id: `cnt_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                customerId: data.customerId,
                firstName: data.firstName,
                lastName: data.lastName,
                title: data.title ?? null,
                email: data.email ?? null,
                phone: data.phone ?? null,
                mobilePhone: data.mobilePhone ?? null,
                isPrimary: data.isPrimary ?? false,
                notes: data.notes ?? null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            contactsList.push(contact);
            return contact;
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
            notes: "Client for contact tests",
            createdAt: new Date("2026-08-19T10:00:00.000Z"),
            updatedAt: new Date("2026-08-19T10:00:00.000Z"),
        };
        customersList.push(customer);
        return customer;
    }

    describe("1. Authorization & RBAC Checks", () => {
        const validPayload = { firstName: "Jane", lastName: "Doe" };

        it("rejects unauthenticated caller with UnauthorizedError", async () => {
            mocks.auth.mockResolvedValue(null);
            seedCustomer("cust_1", WS_ID_1, "Client Corp");

            await expect(createCustomerContact(WS_ID_1, "cust_1", validPayload)).rejects.toThrow(
                UnauthorizedError
            );
        });

        it("rejects inactive workspace membership with WorkspaceAccessDeniedError", async () => {
            registerUser("user_suspended");
            registerMember("user_suspended", WS_ID_1, "ADMIN", "SUSPENDED");
            loginAs("user_suspended");
            seedCustomer("cust_1", WS_ID_1, "Client Corp");

            await expect(createCustomerContact(WS_ID_1, "cust_1", validPayload)).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
        });

        it("rejects deactivated user with WorkspaceAccessDeniedError", async () => {
            registerUser("user_deactivated", "Deactivated", "DEACTIVATED");
            registerMember("user_deactivated", WS_ID_1, "ADMIN");
            loginAs("user_deactivated");
            seedCustomer("cust_1", WS_ID_1, "Client Corp");

            await expect(createCustomerContact(WS_ID_1, "cust_1", validPayload)).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
        });

        it("rejects non-existent workspace with WorkspaceNotFoundError", async () => {
            registerUser("user_admin");
            registerMember("user_admin", "ws_nonexistent", "ADMIN");
            loginAs("user_admin");

            await expect(createCustomerContact("ws_nonexistent", "cust_1", validPayload)).rejects.toThrow(
                WorkspaceNotFoundError
            );
        });

        it("allows OWNER to create a customer contact", async () => {
            registerUser("user_owner");
            registerMember("user_owner", WS_ID_1, "OWNER");
            loginAs("user_owner");
            seedCustomer("cust_1", WS_ID_1, "Client Corp");

            const contact = await createCustomerContact(WS_ID_1, "cust_1", validPayload);
            expect(contact.firstName).toBe("Jane");
        });

        it("allows ADMIN to create a customer contact", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");
            seedCustomer("cust_1", WS_ID_1, "Client Corp");

            const contact = await createCustomerContact(WS_ID_1, "cust_1", validPayload);
            expect(contact.firstName).toBe("Jane");
        });

        it("allows MANAGER to create a customer contact", async () => {
            registerUser("user_mgr");
            registerMember("user_mgr", WS_ID_1, "MANAGER");
            loginAs("user_mgr");
            seedCustomer("cust_1", WS_ID_1, "Client Corp");

            const contact = await createCustomerContact(WS_ID_1, "cust_1", validPayload);
            expect(contact.firstName).toBe("Jane");
        });

        it("allows DISPATCHER to create a customer contact", async () => {
            registerUser("user_disp");
            registerMember("user_disp", WS_ID_1, "DISPATCHER");
            loginAs("user_disp");
            seedCustomer("cust_1", WS_ID_1, "Client Corp");

            const contact = await createCustomerContact(WS_ID_1, "cust_1", validPayload);
            expect(contact.firstName).toBe("Jane");
        });

        it("rejects TECHNICIAN with ForbiddenError", async () => {
            registerUser("user_tech");
            registerMember("user_tech", WS_ID_1, "TECHNICIAN");
            loginAs("user_tech");
            seedCustomer("cust_1", WS_ID_1, "Client Corp");

            await expect(createCustomerContact(WS_ID_1, "cust_1", validPayload)).rejects.toThrow(
                ForbiddenError
            );
        });

        it("rejects ACCOUNTANT with ForbiddenError", async () => {
            registerUser("user_acct");
            registerMember("user_acct", WS_ID_1, "ACCOUNTANT");
            loginAs("user_acct");
            seedCustomer("cust_1", WS_ID_1, "Client Corp");

            await expect(createCustomerContact(WS_ID_1, "cust_1", validPayload)).rejects.toThrow(
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

        it("allows creating contact for customer in authorized workspace", async () => {
            seedCustomer("cust_ws1", WS_ID_1, "Customer in WS1");

            const contact = await createCustomerContact(WS_ID_1, "cust_ws1", {
                firstName: "John",
                lastName: "Doe",
            });
            expect(contact.customerId).toBe("cust_ws1");
            expect(contactsList).toHaveLength(1);
        });

        it("rejects creating contact for customer in another workspace with CustomerNotFoundError", async () => {
            seedCustomer("cust_ws2", WS_ID_2, "Customer in WS2");

            await expect(
                createCustomerContact(WS_ID_1, "cust_ws2", { firstName: "John", lastName: "Doe" })
            ).rejects.toThrow(CustomerNotFoundError);
            expect(contactsList).toHaveLength(0);
        });

        it("rejects creating contact for non-existent customer with CustomerNotFoundError", async () => {
            await expect(
                createCustomerContact(WS_ID_1, "cust_nonexistent", { firstName: "John", lastName: "Doe" })
            ).rejects.toThrow(CustomerNotFoundError);
        });

        it("ignores and strips malicious customerId or workspaceId from input payload", async () => {
            seedCustomer("cust_legit", WS_ID_1, "Legit Customer");

            const contact = await createCustomerContact(WS_ID_1, "cust_legit", {
                firstName: "John",
                lastName: "Doe",
                customerId: "cust_malicious_override",
                workspaceId: "ws_malicious_override",
                id: "forged_id",
            });

            expect(contact.customerId).toBe("cust_legit");
            expect(contact.id).not.toBe("forged_id");
        });
    });

    describe("3. Validation & Field Handling", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");
            seedCustomer("cust_1", WS_ID_1, "Client Corp");
        });

        it("rejects empty firstName", async () => {
            await expect(
                createCustomerContact(WS_ID_1, "cust_1", { firstName: "", lastName: "Doe" })
            ).rejects.toThrow();
        });

        it("rejects empty lastName", async () => {
            await expect(
                createCustomerContact(WS_ID_1, "cust_1", { firstName: "Jane", lastName: "" })
            ).rejects.toThrow();
        });

        it("rejects invalid email format", async () => {
            await expect(
                createCustomerContact(WS_ID_1, "cust_1", { firstName: "Jane", lastName: "Doe", email: "bad-email" })
            ).rejects.toThrow();
        });

        it("normalizes uppercase email to lowercase", async () => {
            const contact = await createCustomerContact(WS_ID_1, "cust_1", {
                firstName: "Jane",
                lastName: "Doe",
                email: "JANE.DOE@ENTERPRISE.COM",
            });
            expect(contact.email).toBe("jane.doe@enterprise.com");
        });

        it("accepts all optional contact fields and defaults isPrimary to false", async () => {
            const contact = await createCustomerContact(WS_ID_1, "cust_1", {
                firstName: "Robert",
                lastName: "Paulson",
                title: "Site Coordinator",
                email: "robert@site.com",
                phone: "+1-555-1234",
                mobilePhone: "+1-555-5678",
                notes: "Primary night contact",
            });

            expect(contact.title).toBe("Site Coordinator");
            expect(contact.phone).toBe("+1-555-1234");
            expect(contact.mobilePhone).toBe("+1-555-5678");
            expect(contact.isPrimary).toBe(false);
            expect(contact.notes).toBe("Primary night contact");
        });
    });

    describe("4. Customer Lifecycle Rule (ACTIVE vs INACTIVE)", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");
        });

        it("allows creating contact for an ACTIVE customer", async () => {
            seedCustomer("cust_active", WS_ID_1, "Active Customer", "ACTIVE");

            const contact = await createCustomerContact(WS_ID_1, "cust_active", {
                firstName: "Jane",
                lastName: "Doe",
            });
            expect(contact.customerId).toBe("cust_active");
        });

        it("rejects creating contact for an INACTIVE customer with InactiveCustomerError", async () => {
            seedCustomer("cust_inactive", WS_ID_1, "Inactive Customer", "INACTIVE");

            await expect(
                createCustomerContact(WS_ID_1, "cust_inactive", {
                    firstName: "Jane",
                    lastName: "Doe",
                })
            ).rejects.toThrow(InactiveCustomerError);
            expect(contactsList).toHaveLength(0);
        });
    });

    describe("5. Primary Contact Rules & Concurrency Handling", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");
            seedCustomer("cust_1", WS_ID_1, "Client Corp");
        });

        it("creates the first primary contact successfully", async () => {
            const primary = await createCustomerContact(WS_ID_1, "cust_1", {
                firstName: "Lead",
                lastName: "Contact",
                isPrimary: true,
            });

            expect(primary.isPrimary).toBe(true);
            expect(contactsList).toHaveLength(1);
        });

        it("allows creating subsequent non-primary contacts when a primary already exists", async () => {
            await createCustomerContact(WS_ID_1, "cust_1", {
                firstName: "Primary",
                lastName: "One",
                isPrimary: true,
            });

            const secondary = await createCustomerContact(WS_ID_1, "cust_1", {
                firstName: "Secondary",
                lastName: "Two",
                isPrimary: false,
            });

            expect(secondary.isPrimary).toBe(false);
            expect(contactsList).toHaveLength(2);
        });

        it("rejects creating a second primary contact via pre-check with CustomerContactPrimaryExistsError", async () => {
            await createCustomerContact(WS_ID_1, "cust_1", {
                firstName: "Primary",
                lastName: "One",
                isPrimary: true,
            });

            await expect(
                createCustomerContact(WS_ID_1, "cust_1", {
                    firstName: "Duplicate",
                    lastName: "Primary",
                    isPrimary: true,
                })
            ).rejects.toThrow(CustomerContactPrimaryExistsError);

            expect(contactsList).toHaveLength(1);
            expect(contactsList[0]!.firstName).toBe("Primary");
        });

        it("translates concurrent primary creation collision (Prisma P2002) into CustomerContactPrimaryExistsError", async () => {
            // Simulate pre-check passing (returning null), but Prisma create encountering race collision (P2002)
            mocks.customerContactFindFirst.mockResolvedValueOnce(null);
            mocks.customerContactCreate.mockRejectedValueOnce(
                Object.assign(new Error("Unique constraint failed on the fields: (`customerId`,`isPrimary`)"), {
                    code: "P2002",
                })
            );

            await expect(
                createCustomerContact(WS_ID_1, "cust_1", {
                    firstName: "Race",
                    lastName: "Condition",
                    isPrimary: true,
                })
            ).rejects.toThrow(CustomerContactPrimaryExistsError);
        });

        it("masks unexpected database failures into CustomerContactCreationError", async () => {
            mocks.customerContactCreate.mockRejectedValueOnce(new Error("Database connection lost"));

            await expect(
                createCustomerContact(WS_ID_1, "cust_1", {
                    firstName: "Jane",
                    lastName: "Doe",
                })
            ).rejects.toThrow(CustomerContactCreationError);
        });
    });
});
