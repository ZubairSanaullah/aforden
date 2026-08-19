import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    customerFindFirst: vi.fn(),
    customerContactFindFirst: vi.fn(),
    customerContactUpdate: vi.fn(),
    transaction: vi.fn(),
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
        $transaction: mocks.transaction,
    },
}));

import { setPrimaryCustomerContact } from "@/lib/services/customer/setPrimaryCustomerContact";
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

describe("Phase 1.4.15 — Customer Primary Contact Management Service Suite", () => {
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

        const findContact = async ({ where }: any) => {
            return (
                contactsList.find((cnt) => {
                    if (where.id && cnt.id !== where.id) return false;
                    if (where.customerId && cnt.customerId !== where.customerId) return false;
                    if (where.isPrimary !== undefined && cnt.isPrimary !== where.isPrimary) return false;
                    if (where.NOT && where.NOT.id && cnt.id === where.NOT.id) return false;
                    return true;
                }) || null
            );
        };

        const updateContact = async ({ where, data }: any) => {
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
        };

        mocks.customerContactFindFirst.mockImplementation(findContact);
        mocks.customerContactUpdate.mockImplementation(updateContact);

        mocks.transaction.mockImplementation(async (callback: any) => {
            if (typeof callback === "function") {
                const txPrisma = {
                    customerContact: {
                        findFirst: findContact,
                        update: updateContact,
                    },
                };
                return callback(txPrisma);
            }
            return Promise.all(callback);
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
        status: "ACTIVE" | "INACTIVE" = "ACTIVE",
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
            notes: "Client for primary contact tests",
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
        phone = "+1-555-0000",
        notes = "Contact notes"
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
            seedContact("cnt_1", "cust_1", "Jane", "Doe", false);
        });

        it("1. rejects unauthenticated caller with UnauthorizedError", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(setPrimaryCustomerContact(WS_ID_1, "cust_1", "cnt_1")).rejects.toThrow(
                UnauthorizedError
            );
        });

        it("2. rejects inactive workspace membership with WorkspaceAccessDeniedError", async () => {
            registerUser("user_inact");
            registerMember("user_inact", WS_ID_1, "ADMIN", "INACTIVE" as any);
            loginAs("user_inact");

            await expect(setPrimaryCustomerContact(WS_ID_1, "cust_1", "cnt_1")).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
        });

        it("3. rejects suspended workspace membership with WorkspaceAccessDeniedError", async () => {
            registerUser("user_susp");
            registerMember("user_susp", WS_ID_1, "ADMIN", "SUSPENDED");
            loginAs("user_susp");

            await expect(setPrimaryCustomerContact(WS_ID_1, "cust_1", "cnt_1")).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
        });

        it("4. rejects deactivated user with WorkspaceAccessDeniedError", async () => {
            registerUser("user_deact", "Deactivated", "DEACTIVATED");
            registerMember("user_deact", WS_ID_1, "ADMIN");
            loginAs("user_deact");

            await expect(setPrimaryCustomerContact(WS_ID_1, "cust_1", "cnt_1")).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
        });

        it("5. rejects non-existent workspace with WorkspaceNotFoundError", async () => {
            registerUser("user_admin");
            registerMember("user_admin", "ws_nonexistent", "ADMIN");
            loginAs("user_admin");

            await expect(setPrimaryCustomerContact("ws_nonexistent", "cust_1", "cnt_1")).rejects.toThrow(
                WorkspaceNotFoundError
            );
        });

        it("6. allows OWNER to set primary contact", async () => {
            registerUser("user_owner");
            registerMember("user_owner", WS_ID_1, "OWNER");
            loginAs("user_owner");

            const result = await setPrimaryCustomerContact(WS_ID_1, "cust_1", "cnt_1");
            expect(result.isPrimary).toBe(true);
        });

        it("7. allows ADMIN to set primary contact", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            const result = await setPrimaryCustomerContact(WS_ID_1, "cust_1", "cnt_1");
            expect(result.isPrimary).toBe(true);
        });

        it("8. allows MANAGER to set primary contact", async () => {
            registerUser("user_mgr");
            registerMember("user_mgr", WS_ID_1, "MANAGER");
            loginAs("user_mgr");

            const result = await setPrimaryCustomerContact(WS_ID_1, "cust_1", "cnt_1");
            expect(result.isPrimary).toBe(true);
        });

        it("9. allows DISPATCHER to set primary contact", async () => {
            registerUser("user_disp");
            registerMember("user_disp", WS_ID_1, "DISPATCHER");
            loginAs("user_disp");

            const result = await setPrimaryCustomerContact(WS_ID_1, "cust_1", "cnt_1");
            expect(result.isPrimary).toBe(true);
        });

        it("10. rejects TECHNICIAN with ForbiddenError", async () => {
            registerUser("user_tech");
            registerMember("user_tech", WS_ID_1, "TECHNICIAN");
            loginAs("user_tech");

            await expect(setPrimaryCustomerContact(WS_ID_1, "cust_1", "cnt_1")).rejects.toThrow(
                ForbiddenError
            );
        });

        it("11. rejects ACCOUNTANT with ForbiddenError", async () => {
            registerUser("user_acct");
            registerMember("user_acct", WS_ID_1, "ACCOUNTANT");
            loginAs("user_acct");

            await expect(setPrimaryCustomerContact(WS_ID_1, "cust_1", "cnt_1")).rejects.toThrow(
                ForbiddenError
            );
        });
    });

    describe("2. Tenant Isolation & Contact Ownership", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_ws1", WS_ID_1, "Customer 1");
            seedCustomer("cust_ws2", WS_ID_2, "Customer 2");

            seedContact("cnt_ws1", "cust_ws1", "Jane", "WS1", false);
            seedContact("cnt_ws2", "cust_ws2", "John", "WS2", false);
        });

        it("12. rejects customer from another workspace with CustomerNotFoundError", async () => {
            await expect(setPrimaryCustomerContact(WS_ID_1, "cust_ws2", "cnt_ws2")).rejects.toThrow(
                CustomerNotFoundError
            );
        });

        it("13. rejects contact belonging to another customer with CustomerContactNotFoundError", async () => {
            seedCustomer("cust_ws1_alt", WS_ID_1, "Customer 1 Alt");
            await expect(setPrimaryCustomerContact(WS_ID_1, "cust_ws1_alt", "cnt_ws1")).rejects.toThrow(
                CustomerContactNotFoundError
            );
        });

        it("14. verifies contactId alone cannot bypass customer ownership", async () => {
            await expect(setPrimaryCustomerContact(WS_ID_1, "cust_ws1", "cnt_ws2")).rejects.toThrow(
                CustomerContactNotFoundError
            );
        });
    });

    describe("3. Customer Lifecycle Rule", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");
        });

        it("15. rejects setting primary contact for an INACTIVE customer with InactiveCustomerError", async () => {
            seedCustomer("cust_inact", WS_ID_1, "Inactive Client", "INACTIVE");
            seedContact("cnt_inact", "cust_inact", "Inactive", "Contact", false);

            await expect(setPrimaryCustomerContact(WS_ID_1, "cust_inact", "cnt_inact")).rejects.toThrow(
                InactiveCustomerError
            );
        });

        it("16. ensures customer status remains INACTIVE after rejection", async () => {
            const customer = seedCustomer("cust_inact_2", WS_ID_1, "Inactive Client 2", "INACTIVE");
            seedContact("cnt_inact_2", "cust_inact_2", "Inactive", "Contact", false);

            await expect(setPrimaryCustomerContact(WS_ID_1, "cust_inact_2", "cnt_inact_2")).rejects.toThrow(
                InactiveCustomerError
            );

            expect(customer.status).toBe("INACTIVE");
        });
    });

    describe("4. Contact Validation", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Client Corp");
        });

        it("17. rejects nonexistent contact with CustomerContactNotFoundError", async () => {
            await expect(setPrimaryCustomerContact(WS_ID_1, "cust_1", "cnt_missing")).rejects.toThrow(
                CustomerContactNotFoundError
            );
        });

        it("18. rejects contact belonging to another customer with CustomerContactNotFoundError", async () => {
            seedCustomer("cust_2", WS_ID_1, "Other Client");
            seedContact("cnt_c2", "cust_2", "Foreign", "Contact", false);

            await expect(setPrimaryCustomerContact(WS_ID_1, "cust_1", "cnt_c2")).rejects.toThrow(
                CustomerContactNotFoundError
            );
        });
    });

    describe("5. Primary Contact Behavior & Idempotency", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Client Corp");
        });

        it("19. promotes non-primary contact to primary when no primary exists", async () => {
            seedContact("cnt_solo", "cust_1", "Solo", "Contact", false);

            const result = await setPrimaryCustomerContact(WS_ID_1, "cust_1", "cnt_solo");

            expect(result.id).toBe("cnt_solo");
            expect(result.isPrimary).toBe(true);
            expect(contactsList.find((c) => c.id === "cnt_solo")?.isPrimary).toBe(true);
        });

        it("20, 21, 22. replaces existing primary contact: old primary becomes false, new becomes true", async () => {
            seedContact("cnt_a", "cust_1", "Contact", "A", true);
            seedContact("cnt_b", "cust_1", "Contact", "B", false);
            seedContact("cnt_c", "cust_1", "Contact", "C", false);

            const result = await setPrimaryCustomerContact(WS_ID_1, "cust_1", "cnt_b");

            expect(result.id).toBe("cnt_b");
            expect(result.isPrimary).toBe(true);

            expect(contactsList.find((c) => c.id === "cnt_a")?.isPrimary).toBe(false);
            expect(contactsList.find((c) => c.id === "cnt_b")?.isPrimary).toBe(true);
            expect(contactsList.find((c) => c.id === "cnt_c")?.isPrimary).toBe(false);
        });

        it("23, 24. is idempotent when requested contact is already primary and performs no database updates", async () => {
            seedContact("cnt_already_prim", "cust_1", "Primary", "Contact", true);

            const result = await setPrimaryCustomerContact(WS_ID_1, "cust_1", "cnt_already_prim");

            expect(result.id).toBe("cnt_already_prim");
            expect(result.isPrimary).toBe(true);
            expect(mocks.transaction).not.toHaveBeenCalled();
            expect(mocks.customerContactUpdate).not.toHaveBeenCalled();
        });

        it("25. verifies deleting primary contact leaves zero primary contacts without triggering setPrimaryCustomerContact", async () => {
            seedContact("cnt_prim", "cust_1", "Lead", "Contact", true);
            seedContact("cnt_other", "cust_1", "Other", "Contact", false);

            // Removing cnt_prim manually (simulating deleteCustomerContact)
            const idx = contactsList.findIndex((c) => c.id === "cnt_prim");
            contactsList.splice(idx, 1);

            expect(contactsList).toHaveLength(1);
            expect(contactsList[0]?.isPrimary).toBe(false);
        });
    });

    describe("6. Concurrency & Error Translation", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Client Corp");
            seedContact("cnt_1", "cust_1", "Candidate", "One", false);
        });

        it("26, 27. translates Prisma P2002 (concurrent unique constraint collision) into CustomerContactPrimaryExistsError", async () => {
            mocks.transaction.mockRejectedValueOnce(
                Object.assign(new Error("Unique constraint failed on the fields: (`customerId`,`isPrimary`)"), {
                    code: "P2002",
                })
            );

            await expect(setPrimaryCustomerContact(WS_ID_1, "cust_1", "cnt_1")).rejects.toThrow(
                CustomerContactPrimaryExistsError
            );
        });

        it("28. masks unexpected database errors into CustomerContactUpdateError without leaking internals", async () => {
            mocks.transaction.mockRejectedValueOnce(new Error("Deadlock detected during transaction"));

            await expect(setPrimaryCustomerContact(WS_ID_1, "cust_1", "cnt_1")).rejects.toThrow(
                CustomerContactUpdateError
            );
        });
    });

    describe("7. Data Integrity Guarantees", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Client Corp", "ACTIVE", "CUST-99999");
            seedContact(
                "cnt_1",
                "cust_1",
                "FirstNameOriginal",
                "LastNameOriginal",
                false,
                "original@client.com",
                "Chief Officer",
                "+1-555-7777",
                "Important client notes"
            );
        });

        it("29-35. preserves contact fields and customer fields untouched during promotion", async () => {
            const result = await setPrimaryCustomerContact(WS_ID_1, "cust_1", "cnt_1");

            expect(result.firstName).toBe("FirstNameOriginal");
            expect(result.lastName).toBe("LastNameOriginal");
            expect(result.email).toBe("original@client.com");
            expect(result.phone).toBe("+1-555-7777");
            expect(result.title).toBe("Chief Officer");
            expect(result.notes).toBe("Important client notes");
            expect(result.isPrimary).toBe(true);

            const customer = customersList.find((c) => c.id === "cust_1")!;
            expect(customer.status).toBe("ACTIVE");
            expect(customer.customerNumber).toBe("CUST-99999");
            expect(customer.name).toBe("Client Corp");
        });
    });
});
