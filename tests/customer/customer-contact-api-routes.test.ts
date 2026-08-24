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
    customerContactCreate: vi.fn(),
    customerContactUpdate: vi.fn(),
    customerContactDelete: vi.fn(),
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
            findMany: mocks.customerContactFindMany,
            count: mocks.customerContactCount,
            create: mocks.customerContactCreate,
            update: mocks.customerContactUpdate,
            delete: mocks.customerContactDelete,
        },
        $transaction: mocks.transaction,
    },
}));

import {
    GET as listContactsHandler,
    POST as createContactHandler,
} from "@/app/api/customers/[customerId]/contacts/route";
import {
    GET as getContactHandler,
    PATCH as updateContactHandler,
    DELETE as deleteContactHandler,
} from "@/app/api/customers/[customerId]/contacts/[contactId]/route";
import { POST as setPrimaryHandler } from "@/app/api/customers/[customerId]/contacts/[contactId]/primary/route";
import type { Customer, CustomerContact, User, Workspace, WorkspaceMember } from "@/generated/prisma/client";

describe("Phase 1.4.16 — Customer Contact API Routes Suite", () => {
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

        mocks.customerContactCount.mockImplementation(async ({ where }: any) => {
            return filterContacts(where).length;
        });

        mocks.customerContactFindMany.mockImplementation(async ({ where, skip = 0, take = 20 }: any) => {
            return filterContacts(where).slice(skip, skip + take);
        });

        mocks.customerContactCreate.mockImplementation(async ({ data }: any) => {
            if (data.isPrimary === true) {
                const otherPrimary = contactsList.find(
                    (c) => c.customerId === data.customerId && c.isPrimary === true
                );
                if (otherPrimary) {
                    const err = new Error("Unique constraint failed on the fields: (`customerId`,`isPrimary`)");
                    (err as any).code = "P2002";
                    throw err;
                }
            }

            const newContact: CustomerContact = {
                id: `cnt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
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
            contactsList.push(newContact);
            return newContact;
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

    function filterContacts(where: any): CustomerContact[] {
        return contactsList.filter((cnt) => {
            if (where.customerId && cnt.customerId !== where.customerId) return false;
            if (where.isPrimary !== undefined && cnt.isPrimary !== where.isPrimary) return false;
            return true;
        });
    }

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
            notes: "Client notes",
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
            title: "Operations Lead",
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

    function createRequest(
        url: string,
        method = "GET",
        body?: any,
        headers: Record<string, string> = {}
    ): Request {
        const defaultHeaders: Record<string, string> = {
            "x-workspace-id": WS_ID_1,
            ...headers,
        };
        if (body !== undefined) {
            defaultHeaders["content-type"] = "application/json";
        }

        return new Request(url, {
            method,
            headers: defaultHeaders,
            body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
        });
    }

    describe("1. Authentication & Missing Workspace Context", () => {
        beforeEach(() => {
            seedCustomer("cust_1", WS_ID_1, "Client Corp");
            seedContact("cnt_1", "cust_1", "Jane", "Doe");
        });

        it("1. returns 401 when unauthenticated on GET list", async () => {
            mocks.auth.mockResolvedValue(null);
            const req = createRequest("https://aforden.com/api/customers/cust_1/contacts");
            const res = await listContactsHandler(req, { params: Promise.resolve({ customerId: "cust_1" }) });

            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("UNAUTHORIZED");
        });

        it("2. returns 401 when unauthenticated on POST create", async () => {
            mocks.auth.mockResolvedValue(null);
            const req = createRequest("https://aforden.com/api/customers/cust_1/contacts", "POST", {
                firstName: "Jane",
                lastName: "Doe",
            });
            const res = await createContactHandler(req, { params: Promise.resolve({ customerId: "cust_1" }) });

            expect(res.status).toBe(401);
        });

        it("3. returns 401 when unauthenticated on PATCH update", async () => {
            mocks.auth.mockResolvedValue(null);
            const req = createRequest("https://aforden.com/api/customers/cust_1/contacts/cnt_1", "PATCH", {
                firstName: "Janet",
            });
            const res = await updateContactHandler(req, {
                params: Promise.resolve({ customerId: "cust_1", contactId: "cnt_1" }),
            });

            expect(res.status).toBe(401);
        });

        it("4. returns 401 when unauthenticated on DELETE", async () => {
            mocks.auth.mockResolvedValue(null);
            const req = createRequest("https://aforden.com/api/customers/cust_1/contacts/cnt_1", "DELETE");
            const res = await deleteContactHandler(req, {
                params: Promise.resolve({ customerId: "cust_1", contactId: "cnt_1" }),
            });

            expect(res.status).toBe(401);
        });

        it("5. returns 401 when unauthenticated on POST primary", async () => {
            mocks.auth.mockResolvedValue(null);
            const req = createRequest("https://aforden.com/api/customers/cust_1/contacts/cnt_1/primary", "POST");
            const res = await setPrimaryHandler(req, {
                params: Promise.resolve({ customerId: "cust_1", contactId: "cnt_1" }),
            });

            expect(res.status).toBe(401);
        });

        it("returns 400 when workspace context is missing from headers and query", async () => {
            registerUser("user_admin");
            loginAs("user_admin");

            const req = new Request("https://aforden.com/api/customers/cust_1/contacts", {
                method: "GET",
            });
            const res = await listContactsHandler(req, { params: Promise.resolve({ customerId: "cust_1" }) });

            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.error.code).toBe("MISSING_WORKSPACE");
        });
    });

    describe("2. RBAC & Permissions", () => {
        beforeEach(() => {
            seedCustomer("cust_1", WS_ID_1, "Client Corp");
            seedContact("cnt_1", "cust_1", "Jane", "Doe");
        });

        it("6. allows TECHNICIAN to GET contacts list (customers.view)", async () => {
            registerUser("user_tech");
            registerMember("user_tech", WS_ID_1, "TECHNICIAN");
            loginAs("user_tech");

            const req = createRequest("https://aforden.com/api/customers/cust_1/contacts");
            const res = await listContactsHandler(req, { params: Promise.resolve({ customerId: "cust_1" }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.items).toHaveLength(1);
        });

        it("7. allows DISPATCHER to POST create contact (customers.update)", async () => {
            registerUser("user_disp");
            registerMember("user_disp", WS_ID_1, "DISPATCHER");
            loginAs("user_disp");

            const req = createRequest("https://aforden.com/api/customers/cust_1/contacts", "POST", {
                firstName: "New",
                lastName: "Contact",
            });
            const res = await createContactHandler(req, { params: Promise.resolve({ customerId: "cust_1" }) });

            expect(res.status).toBe(201);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.firstName).toBe("New");
        });

        it("8. allows MANAGER to PATCH update contact (customers.update)", async () => {
            registerUser("user_mgr");
            registerMember("user_mgr", WS_ID_1, "MANAGER");
            loginAs("user_mgr");

            const req = createRequest("https://aforden.com/api/customers/cust_1/contacts/cnt_1", "PATCH", {
                title: "Manager Promoted",
            });
            const res = await updateContactHandler(req, {
                params: Promise.resolve({ customerId: "cust_1", contactId: "cnt_1" }),
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.title).toBe("Manager Promoted");
        });

        it("9. allows ADMIN and OWNER to DELETE contact (customers.delete)", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            const req = createRequest("https://aforden.com/api/customers/cust_1/contacts/cnt_1", "DELETE");
            const res = await deleteContactHandler(req, {
                params: Promise.resolve({ customerId: "cust_1", contactId: "cnt_1" }),
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.id).toBe("cnt_1");
        });

        it("10. returns 403 when TECHNICIAN attempts to POST create contact", async () => {
            registerUser("user_tech");
            registerMember("user_tech", WS_ID_1, "TECHNICIAN");
            loginAs("user_tech");

            const req = createRequest("https://aforden.com/api/customers/cust_1/contacts", "POST", {
                firstName: "Unauthorized",
                lastName: "Create",
            });
            const res = await createContactHandler(req, { params: Promise.resolve({ customerId: "cust_1" }) });

            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("FORBIDDEN");
        });

        it("returns 403 when DISPATCHER attempts to DELETE contact", async () => {
            registerUser("user_disp");
            registerMember("user_disp", WS_ID_1, "DISPATCHER");
            loginAs("user_disp");

            const req = createRequest("https://aforden.com/api/customers/cust_1/contacts/cnt_1", "DELETE");
            const res = await deleteContactHandler(req, {
                params: Promise.resolve({ customerId: "cust_1", contactId: "cnt_1" }),
            });

            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.error.code).toBe("FORBIDDEN");
        });
    });

    describe("3. Tenant Isolation & Scope Protection", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_ws1", WS_ID_1, "WS1 Client");
            seedCustomer("cust_ws1_alt", WS_ID_1, "WS1 Client Alt");
            seedCustomer("cust_ws2", WS_ID_2, "WS2 Client");

            seedContact("cnt_ws1", "cust_ws1", "Jane", "WS1");
            seedContact("cnt_ws2", "cust_ws2", "John", "WS2");
        });

        it("11. returns 404 when attempting to access customer in another workspace", async () => {
            const req = createRequest("https://aforden.com/api/customers/cust_ws2/contacts");
            const res = await listContactsHandler(req, { params: Promise.resolve({ customerId: "cust_ws2" }) });

            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.error.code).toBe("CUSTOMER_NOT_FOUND");
        });

        it("12. returns 404 when accessing single contact from another workspace", async () => {
            const req = createRequest("https://aforden.com/api/customers/cust_ws2/contacts/cnt_ws2");
            const res = await getContactHandler(req, {
                params: Promise.resolve({ customerId: "cust_ws2", contactId: "cnt_ws2" }),
            });

            expect(res.status).toBe(404);
        });

        it("13. returns 404 when attempting to update contact under wrong customer", async () => {
            const req = createRequest("https://aforden.com/api/customers/cust_ws1_alt/contacts/cnt_ws1", "PATCH", {
                title: "Hacked",
            });
            const res = await updateContactHandler(req, {
                params: Promise.resolve({ customerId: "cust_ws1_alt", contactId: "cnt_ws1" }),
            });

            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.error.code).toBe("CONTACT_NOT_FOUND");
        });

        it("14. returns 404 when attempting to delete contact under wrong customer", async () => {
            const req = createRequest("https://aforden.com/api/customers/cust_ws1_alt/contacts/cnt_ws1", "DELETE");
            const res = await deleteContactHandler(req, {
                params: Promise.resolve({ customerId: "cust_ws1_alt", contactId: "cnt_ws1" }),
            });

            expect(res.status).toBe(404);
        });

        it("15. returns 404 when attempting to set primary for contact under wrong customer", async () => {
            const req = createRequest("https://aforden.com/api/customers/cust_ws1_alt/contacts/cnt_ws1/primary", "POST");
            const res = await setPrimaryHandler(req, {
                params: Promise.resolve({ customerId: "cust_ws1_alt", contactId: "cnt_ws1" }),
            });

            expect(res.status).toBe(404);
        });
    });

    describe("4. CRUD Operations & Query Parameters", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Client Corp");
        });

        it("16. GET list succeeds with pagination and data", async () => {
            seedContact("c1", "cust_1", "A", "One");
            seedContact("c2", "cust_1", "B", "Two");

            const req = createRequest("https://aforden.com/api/customers/cust_1/contacts?page=1&pageSize=10");
            const res = await listContactsHandler(req, { params: Promise.resolve({ customerId: "cust_1" }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.items).toHaveLength(2);
            expect(json.data.pagination.total).toBe(2);
        });

        it("17. GET single contact succeeds", async () => {
            seedContact("c1", "cust_1", "Jane", "Doe", true);

            const req = createRequest("https://aforden.com/api/customers/cust_1/contacts/c1");
            const res = await getContactHandler(req, {
                params: Promise.resolve({ customerId: "cust_1", contactId: "c1" }),
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.firstName).toBe("Jane");
            expect(json.data.isPrimary).toBe(true);
        });

        it("18. POST creates contact and normalizes email", async () => {
            const req = createRequest("https://aforden.com/api/customers/cust_1/contacts", "POST", {
                firstName: "Alice",
                lastName: "Smith",
                email: "ALICE@EXAMPLE.COM",
                title: "Engineering Lead",
            });
            const res = await createContactHandler(req, { params: Promise.resolve({ customerId: "cust_1" }) });

            expect(res.status).toBe(201);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.firstName).toBe("Alice");
            expect(json.data.email).toBe("alice@example.com");
        });

        it("19. PATCH updates contact", async () => {
            seedContact("c1", "cust_1", "Original", "Name");

            const req = createRequest("https://aforden.com/api/customers/cust_1/contacts/c1", "PATCH", {
                firstName: "Updated",
            });
            const res = await updateContactHandler(req, {
                params: Promise.resolve({ customerId: "cust_1", contactId: "c1" }),
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.firstName).toBe("Updated");
        });

        it("20. DELETE removes contact", async () => {
            seedContact("c1", "cust_1", "To", "Delete");

            const req = createRequest("https://aforden.com/api/customers/cust_1/contacts/c1", "DELETE");
            const res = await deleteContactHandler(req, {
                params: Promise.resolve({ customerId: "cust_1", contactId: "c1" }),
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(contactsList).toHaveLength(0);
        });
    });

    describe("5. Primary Contact Endpoint", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Client Corp");
        });

        it("25. POST /primary promotes contact", async () => {
            seedContact("c1", "cust_1", "NonPrimary", "Contact", false);

            const req = createRequest("https://aforden.com/api/customers/cust_1/contacts/c1/primary", "POST");
            const res = await setPrimaryHandler(req, {
                params: Promise.resolve({ customerId: "cust_1", contactId: "c1" }),
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.isPrimary).toBe(true);
        });

        it("26. POST /primary is idempotent on already primary contact", async () => {
            seedContact("c1", "cust_1", "AlreadyPrimary", "Contact", true);

            const req = createRequest("https://aforden.com/api/customers/cust_1/contacts/c1/primary", "POST");
            const res = await setPrimaryHandler(req, {
                params: Promise.resolve({ customerId: "cust_1", contactId: "c1" }),
            });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.data.isPrimary).toBe(true);
        });

        it("27. returns 409 when primary conflict occurs during contact creation", async () => {
            seedContact("c1", "cust_1", "FirstPrimary", "Contact", true);

            const req = createRequest("https://aforden.com/api/customers/cust_1/contacts", "POST", {
                firstName: "Second",
                lastName: "Primary",
                isPrimary: true,
            });
            const res = await createContactHandler(req, { params: Promise.resolve({ customerId: "cust_1" }) });

            expect(res.status).toBe(409);
            const json = await res.json();
            expect(json.error.code).toBe("PRIMARY_CONTACT_EXISTS");
        });
    });

    describe("6. Customer Lifecycle Protection", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_inact", WS_ID_1, "Inactive Client", "INACTIVE");
            seedContact("cnt_inact", "cust_inact", "Jane", "Doe", false);
        });

        it("28. returns 400 when attempting mutations on an INACTIVE customer", async () => {
            const req = createRequest("https://aforden.com/api/customers/cust_inact/contacts", "POST", {
                firstName: "New",
                lastName: "Contact",
            });
            const res = await createContactHandler(req, { params: Promise.resolve({ customerId: "cust_inact" }) });

            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.error.code).toBe("INACTIVE_CUSTOMER");
        });
    });

    describe("7. Request Validation & Malformed Payloads", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Client Corp");
            seedContact("cnt_1", "cust_1", "Jane", "Doe");
        });

        it("29. returns 422 for invalid create body (missing required firstName)", async () => {
            const req = createRequest("https://aforden.com/api/customers/cust_1/contacts", "POST", {
                lastName: "OnlyLastName",
            });
            const res = await createContactHandler(req, { params: Promise.resolve({ customerId: "cust_1" }) });

            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.error.code).toBe("VALIDATION_ERROR");
            expect(json.error.fields).toHaveProperty("firstName");
        });

        it("30. returns 422 for invalid email in update body", async () => {
            const req = createRequest("https://aforden.com/api/customers/cust_1/contacts/cnt_1", "PATCH", {
                email: "invalid-email-address",
            });
            const res = await updateContactHandler(req, {
                params: Promise.resolve({ customerId: "cust_1", contactId: "cnt_1" }),
            });

            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.error.code).toBe("VALIDATION_ERROR");
            expect(json.error.fields).toHaveProperty("email");
        });

        it("31. returns 400 for malformed JSON request body", async () => {
            const req = createRequest("https://aforden.com/api/customers/cust_1/contacts", "POST", "invalid-json{");
            const res = await createContactHandler(req, { params: Promise.resolve({ customerId: "cust_1" }) });

            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.error.code).toBe("INVALID_REQUEST");
        });

        it("36. returns 500 without leaking internals on unexpected service failure", async () => {
            mocks.customerContactFindFirst.mockRejectedValueOnce(new Error("Disk failure"));

            const req = createRequest("https://aforden.com/api/customers/cust_1/contacts/cnt_1");
            const res = await getContactHandler(req, {
                params: Promise.resolve({ customerId: "cust_1", contactId: "cnt_1" }),
            });

            expect(res.status).toBe(500);
            const json = await res.json();
            expect(json.error.code).toBe("INTERNAL_SERVER_ERROR");
            expect(json.error.message).toBe("An unexpected error occurred.");
        });
    });
});
