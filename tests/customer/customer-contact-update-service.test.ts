import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    customerFindFirst: vi.fn(),
    customerContactFindFirst: vi.fn(),
    customerContactUpdate: vi.fn(),
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
            update: mocks.customerContactUpdate,
        },
    },
}));

import { updateCustomerContact } from "@/lib/services/customer/updateCustomerContact";
import {
    CustomerNotFoundError,
    CustomerContactNotFoundError,
    InactiveCustomerError,
    CustomerContactPrimaryExistsError,
    CustomerContactUpdateError,
} from "@/lib/services/customer/customerErrors";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
    WorkspaceNotFoundError,
} from "@/lib/services/authorization/authorizationErrors";
import type { Customer, CustomerContact, User, Workspace, WorkspaceMember } from "@/generated/prisma/client";

describe("Phase 1.4.13 — Customer Contact Update Service Suite", () => {
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
                    if (where.isPrimary !== undefined && cnt.isPrimary !== where.isPrimary) return false;
                    if (where.NOT && where.NOT.id && cnt.id === where.NOT.id) return false;
                    return true;
                }) || null
            );
        });

        mocks.customerContactUpdate.mockImplementation(async ({ where, data }: any) => {
            const index = contactsList.findIndex((c) => c.id === where.id);
            if (index === -1) {
                throw new Error("Contact not found in mock store");
            }

            const existing = contactsList[index]!;

            if (data.isPrimary === true && !existing.isPrimary) {
                const otherPrimary = contactsList.find(
                    (c) => c.customerId === existing.customerId && c.isPrimary === true && c.id !== existing.id
                );
                if (otherPrimary) {
                    const err = new Error("Unique constraint failed on the fields: (`customerId`,`isPrimary`)");
                    (err as any).code = "P2002";
                    throw err;
                }
            }

            const updated: CustomerContact = {
                ...existing,
                ...data,
                updatedAt: new Date(),
            };
            contactsList[index] = updated;
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
            notes: "Client for contact update tests",
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
        email: string | null = "contact@client.com",
        title: string | null = "Operations Manager",
        phone: string | null = "+1-555-1000",
        notes: string | null = "Regular contact"
    ): CustomerContact {
        const contact: CustomerContact = {
            id,
            customerId,
            firstName,
            lastName,
            title,
            email,
            phone,
            mobilePhone: "+1-555-2000",
            isPrimary,
            notes,
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

            await expect(
                updateCustomerContact(WS_ID_1, "cust_1", "cnt_1", { firstName: "Janet" })
            ).rejects.toThrow(UnauthorizedError);
        });

        it("rejects inactive workspace membership with WorkspaceAccessDeniedError", async () => {
            registerUser("user_suspended");
            registerMember("user_suspended", WS_ID_1, "ADMIN", "SUSPENDED");
            loginAs("user_suspended");

            await expect(
                updateCustomerContact(WS_ID_1, "cust_1", "cnt_1", { firstName: "Janet" })
            ).rejects.toThrow(WorkspaceAccessDeniedError);
        });

        it("rejects deactivated user with WorkspaceAccessDeniedError", async () => {
            registerUser("user_deactivated", "Deactivated", "DEACTIVATED");
            registerMember("user_deactivated", WS_ID_1, "ADMIN");
            loginAs("user_deactivated");

            await expect(
                updateCustomerContact(WS_ID_1, "cust_1", "cnt_1", { firstName: "Janet" })
            ).rejects.toThrow(WorkspaceAccessDeniedError);
        });

        it("rejects non-existent workspace with WorkspaceNotFoundError", async () => {
            registerUser("user_admin");
            registerMember("user_admin", "ws_nonexistent", "ADMIN");
            loginAs("user_admin");

            await expect(
                updateCustomerContact("ws_nonexistent", "cust_1", "cnt_1", { firstName: "Janet" })
            ).rejects.toThrow(WorkspaceNotFoundError);
        });

        it("allows OWNER to update a customer contact", async () => {
            registerUser("user_owner");
            registerMember("user_owner", WS_ID_1, "OWNER");
            loginAs("user_owner");

            const updated = await updateCustomerContact(WS_ID_1, "cust_1", "cnt_1", { firstName: "OwnerUpdated" });
            expect(updated.firstName).toBe("OwnerUpdated");
        });

        it("allows ADMIN to update a customer contact", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            const updated = await updateCustomerContact(WS_ID_1, "cust_1", "cnt_1", { firstName: "AdminUpdated" });
            expect(updated.firstName).toBe("AdminUpdated");
        });

        it("allows MANAGER to update a customer contact", async () => {
            registerUser("user_mgr");
            registerMember("user_mgr", WS_ID_1, "MANAGER");
            loginAs("user_mgr");

            const updated = await updateCustomerContact(WS_ID_1, "cust_1", "cnt_1", { firstName: "ManagerUpdated" });
            expect(updated.firstName).toBe("ManagerUpdated");
        });

        it("allows DISPATCHER to update a customer contact", async () => {
            registerUser("user_disp");
            registerMember("user_disp", WS_ID_1, "DISPATCHER");
            loginAs("user_disp");

            const updated = await updateCustomerContact(WS_ID_1, "cust_1", "cnt_1", { firstName: "DispatcherUpdated" });
            expect(updated.firstName).toBe("DispatcherUpdated");
        });

        it("rejects TECHNICIAN with ForbiddenError", async () => {
            registerUser("user_tech");
            registerMember("user_tech", WS_ID_1, "TECHNICIAN");
            loginAs("user_tech");

            await expect(
                updateCustomerContact(WS_ID_1, "cust_1", "cnt_1", { firstName: "Janet" })
            ).rejects.toThrow(ForbiddenError);
        });

        it("rejects ACCOUNTANT with ForbiddenError", async () => {
            registerUser("user_acct");
            registerMember("user_acct", WS_ID_1, "ACCOUNTANT");
            loginAs("user_acct");

            await expect(
                updateCustomerContact(WS_ID_1, "cust_1", "cnt_1", { firstName: "Janet" })
            ).rejects.toThrow(ForbiddenError);
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

        it("allows update when customer and contact match authorized workspace", async () => {
            const updated = await updateCustomerContact(WS_ID_1, "cust_ws1", "cnt_ws1", {
                title: "Senior VP",
            });
            expect(updated.title).toBe("Senior VP");
        });

        it("rejects updating contact for customer in another workspace with CustomerNotFoundError", async () => {
            await expect(
                updateCustomerContact(WS_ID_1, "cust_ws2", "cnt_ws2", { title: "Hacker" })
            ).rejects.toThrow(CustomerNotFoundError);
        });

        it("rejects updating contact using incorrect customerId with CustomerContactNotFoundError", async () => {
            await expect(
                updateCustomerContact(WS_ID_1, "cust_ws1_alt", "cnt_ws1", { title: "Mismatch" })
            ).rejects.toThrow(CustomerContactNotFoundError);
        });

        it("strips client-injected customerId and workspaceId", async () => {
            const updated = await updateCustomerContact(WS_ID_1, "cust_ws1", "cnt_ws1", {
                firstName: "CleanName",
                customerId: "cust_malicious",
                workspaceId: "ws_malicious",
                id: "forged_id",
            } as any);

            expect(updated.firstName).toBe("CleanName");
            expect(updated.customerId).toBe("cust_ws1");
            expect(updated.id).toBe("cnt_ws1");
        });
    });

    describe("3. Customer Lifecycle Rule (ACTIVE vs INACTIVE)", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");
        });

        it("allows contact update for an ACTIVE customer", async () => {
            seedCustomer("cust_act", WS_ID_1, "Active Customer", "ACTIVE");
            seedContact("cnt_act", "cust_act", "Active", "Contact");

            const updated = await updateCustomerContact(WS_ID_1, "cust_act", "cnt_act", {
                notes: "Updated active contact",
            });
            expect(updated.notes).toBe("Updated active contact");
        });

        it("rejects contact update for an INACTIVE customer with InactiveCustomerError", async () => {
            seedCustomer("cust_inact", WS_ID_1, "Inactive Customer", "INACTIVE");
            seedContact("cnt_inact", "cust_inact", "Inactive", "Contact");

            await expect(
                updateCustomerContact(WS_ID_1, "cust_inact", "cnt_inact", {
                    notes: "Should fail",
                })
            ).rejects.toThrow(InactiveCustomerError);
        });
    });

    describe("4. Partial Updates, Nullable Fields & Normalization", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Client Corp");
            seedContact(
                "cnt_1",
                "cust_1",
                "OriginalFirst",
                "OriginalLast",
                false,
                "original@client.com",
                "Director",
                "+1-555-1111",
                "Original notes"
            );
        });

        it("updates single field while preserving unspecified fields", async () => {
            const updated = await updateCustomerContact(WS_ID_1, "cust_1", "cnt_1", {
                lastName: "NewLastName",
            });

            expect(updated.lastName).toBe("NewLastName");
            expect(updated.firstName).toBe("OriginalFirst");
            expect(updated.email).toBe("original@client.com");
            expect(updated.title).toBe("Director");
            expect(updated.phone).toBe("+1-555-1111");
        });

        it("normalizes uppercase email to lowercase", async () => {
            const updated = await updateCustomerContact(WS_ID_1, "cust_1", "cnt_1", {
                email: "NEW.EMAIL@CLIENT.COM",
            });
            expect(updated.email).toBe("new.email@client.com");
        });

        it("explicitly clears nullable fields when set to null", async () => {
            const updated = await updateCustomerContact(WS_ID_1, "cust_1", "cnt_1", {
                title: null,
                email: null,
                phone: null,
                mobilePhone: null,
                notes: null,
            });

            expect(updated.title).toBeNull();
            expect(updated.email).toBeNull();
            expect(updated.phone).toBeNull();
            expect(updated.mobilePhone).toBeNull();
            expect(updated.notes).toBeNull();
            expect(updated.firstName).toBe("OriginalFirst");
        });

        it("accepts empty object {} without changing any field values", async () => {
            const updated = await updateCustomerContact(WS_ID_1, "cust_1", "cnt_1", {});
            expect(updated.firstName).toBe("OriginalFirst");
            expect(updated.lastName).toBe("OriginalLast");
        });
    });

    describe("5. Primary Contact Promotion, Demotion & Concurrency", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Client Corp");
        });

        it("promotes non-primary contact to primary when no other primary exists", async () => {
            seedContact("cnt_solo", "cust_1", "Solo", "Contact", false);

            const updated = await updateCustomerContact(WS_ID_1, "cust_1", "cnt_solo", {
                isPrimary: true,
            });
            expect(updated.isPrimary).toBe(true);
        });

        it("demotes primary contact to non-primary (isPrimary: false)", async () => {
            seedContact("cnt_prim", "cust_1", "Primary", "Contact", true);

            const updated = await updateCustomerContact(WS_ID_1, "cust_1", "cnt_prim", {
                isPrimary: false,
            });
            expect(updated.isPrimary).toBe(false);
        });

        it("is idempotent when updating an already primary contact with isPrimary: true", async () => {
            seedContact("cnt_prim", "cust_1", "Primary", "Contact", true);

            const updated = await updateCustomerContact(WS_ID_1, "cust_1", "cnt_prim", {
                isPrimary: true,
                title: "Updated Title",
            });
            expect(updated.isPrimary).toBe(true);
            expect(updated.title).toBe("Updated Title");
        });

        it("rejects promoting contact to primary when another primary already exists", async () => {
            seedContact("cnt_existing_primary", "cust_1", "Existing", "Primary", true);
            seedContact("cnt_secondary", "cust_1", "Secondary", "Contact", false);

            await expect(
                updateCustomerContact(WS_ID_1, "cust_1", "cnt_secondary", {
                    isPrimary: true,
                })
            ).rejects.toThrow(CustomerContactPrimaryExistsError);

            const existingPrimary = contactsList.find((c) => c.id === "cnt_existing_primary");
            expect(existingPrimary?.isPrimary).toBe(true);
        });

        it("translates concurrent primary promotion collision (P2002) into CustomerContactPrimaryExistsError", async () => {
            seedContact("cnt_race", "cust_1", "Race", "Candidate", false);

            // Simulate pre-check passing, but race condition triggering P2002 during update
            mocks.customerContactFindFirst.mockImplementation(async ({ where }: any) => {
                if (where.id === "cnt_race") return contactsList.find((c) => c.id === "cnt_race");
                if (where.isPrimary === true) return null; // Pre-check sees no primary
                return null;
            });

            mocks.customerContactUpdate.mockRejectedValueOnce(
                Object.assign(new Error("Unique constraint failed on the fields: (`customerId`,`isPrimary`)"), {
                    code: "P2002",
                })
            );

            await expect(
                updateCustomerContact(WS_ID_1, "cust_1", "cnt_race", {
                    isPrimary: true,
                })
            ).rejects.toThrow(CustomerContactPrimaryExistsError);
        });

        it("masks unexpected database failures into CustomerContactUpdateError", async () => {
            seedContact("cnt_1", "cust_1", "Jane", "Doe");

            mocks.customerContactUpdate.mockRejectedValueOnce(new Error("Database write lock timeout"));

            await expect(
                updateCustomerContact(WS_ID_1, "cust_1", "cnt_1", {
                    title: "Director",
                })
            ).rejects.toThrow(CustomerContactUpdateError);
        });
    });
});
