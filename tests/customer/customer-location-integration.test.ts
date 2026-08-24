import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    customerFindFirst: vi.fn(),
    customerFindUnique: vi.fn(),
    customerCreate: vi.fn(),
    customerUpdate: vi.fn(),
    customerDelete: vi.fn(),
    customerContactFindFirst: vi.fn(),
    customerContactFindMany: vi.fn(),
    customerContactCreate: vi.fn(),
    customerContactUpdate: vi.fn(),
    customerContactDelete: vi.fn(),
    serviceLocationFindFirst: vi.fn(),
    serviceLocationFindMany: vi.fn(),
    serviceLocationCreate: vi.fn(),
    serviceLocationUpdate: vi.fn(),
    serviceLocationDelete: vi.fn(),
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
            findUnique: mocks.customerFindUnique,
            create: mocks.customerCreate,
            update: mocks.customerUpdate,
            delete: mocks.customerDelete,
        },
        customerContact: {
            findFirst: mocks.customerContactFindFirst,
            findMany: mocks.customerContactFindMany,
            create: mocks.customerContactCreate,
            update: mocks.customerContactUpdate,
            delete: mocks.customerContactDelete,
        },
        serviceLocation: {
            findFirst: mocks.serviceLocationFindFirst,
            findMany: mocks.serviceLocationFindMany,
            create: mocks.serviceLocationCreate,
            update: mocks.serviceLocationUpdate,
            delete: mocks.serviceLocationDelete,
        },
        $transaction: mocks.transaction,
    },
}));

import { createCustomerContact } from "@/lib/services/customer/createCustomerContact";
import { updateCustomerContact } from "@/lib/services/customer/updateCustomerContact";
import { deleteCustomerContact } from "@/lib/services/customer/deleteCustomerContact";
import { setPrimaryCustomerContact } from "@/lib/services/customer/setPrimaryCustomerContact";
import { createServiceLocation } from "@/lib/services/customer/createServiceLocation";
import { updateServiceLocation } from "@/lib/services/customer/updateServiceLocation";
import { deleteServiceLocation } from "@/lib/services/customer/deleteServiceLocation";
import { setPrimaryServiceLocation } from "@/lib/services/customer/setPrimaryServiceLocation";
import { deleteCustomer } from "@/lib/services/customer/deleteCustomer";
import {
    CustomerNotFoundError,
    CustomerContactNotFoundError,
    ServiceLocationNotFoundError,
    InactiveCustomerError,
    CustomerContactPrimaryExistsError,
    ServiceLocationPrimaryExistsError,
} from "@/lib/services/customer/customerErrors";
import {
    Prisma,
    type Customer,
    type CustomerContact,
    type ServiceLocation,
    type User,
    type Workspace,
    type WorkspaceMember,
} from "@/generated/prisma/client";

describe("Phase 1.4.23 — Customer / Location Integration Validation Suite", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let customersList: Customer[];
    let contactsList: CustomerContact[];
    let locationsList: ServiceLocation[];

    const WS_ALPHA = "ws_alpha_001";
    const WS_BETA = "ws_beta_002";

    beforeEach(() => {
        vi.clearAllMocks();
        usersMap = new Map();
        workspacesMap = new Map();
        membersMap = new Map();
        customersList = [];
        contactsList = [];
        locationsList = [];

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
                    if (where.customerNumber && c.customerNumber !== where.customerNumber) return false;
                    return true;
                }) || null
            );
        });

        mocks.customerFindUnique.mockImplementation(async ({ where }: any) => {
            return customersList.find((c) => c.id === where.id) || null;
        });

        mocks.customerDelete.mockImplementation(async ({ where }: any) => {
            const index = customersList.findIndex((c) => c.id === where.id);
            if (index === -1) throw new Error("Customer not found");
            const [deleted] = customersList.splice(index, 1);
            // Simulate cascade delete
            contactsList = contactsList.filter((cnt) => cnt.customerId !== where.id);
            locationsList = locationsList.filter((loc) => loc.customerId !== where.id);
            return deleted!;
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

        mocks.customerContactCreate.mockImplementation(async ({ data }: any) => {
            if (data.isPrimary === true) {
                const existingPrimary = contactsList.find(
                    (c) => c.customerId === data.customerId && c.isPrimary === true
                );
                if (existingPrimary) {
                    const err = new Error("Unique constraint failed");
                    (err as any).code = "P2002";
                    throw err;
                }
            }
            const contact: CustomerContact = {
                id: `cnt_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                customerId: data.customerId,
                firstName: data.firstName,
                lastName: data.lastName,
                title: data.title || null,
                email: data.email || null,
                phone: data.phone || null,
                mobilePhone: data.mobilePhone || null,
                isPrimary: data.isPrimary ?? false,
                notes: data.notes || null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            contactsList.push(contact);
            return contact;
        });

        mocks.customerContactUpdate.mockImplementation(async ({ where, data }: any) => {
            const index = contactsList.findIndex((c) => c.id === where.id);
            if (index === -1) throw new Error("Contact not found");
            const existing = contactsList[index]!;
            if (data.isPrimary === true && !existing.isPrimary) {
                const otherPrimary = contactsList.find(
                    (c) => c.customerId === existing.customerId && c.isPrimary === true && c.id !== existing.id
                );
                if (otherPrimary) {
                    const err = new Error("Unique constraint failed");
                    (err as any).code = "P2002";
                    throw err;
                }
            }
            const updated: CustomerContact = { ...existing, ...data, updatedAt: new Date() };
            contactsList[index] = updated;
            return updated;
        });

        mocks.customerContactDelete.mockImplementation(async ({ where }: any) => {
            const index = contactsList.findIndex((c) => c.id === where.id);
            if (index === -1) throw new Error("Contact not found");
            const [deleted] = contactsList.splice(index, 1);
            return deleted!;
        });

        mocks.serviceLocationFindFirst.mockImplementation(async ({ where }: any) => {
            return (
                locationsList.find((loc) => {
                    if (where.id && loc.id !== where.id) return false;
                    if (where.customerId && loc.customerId !== where.customerId) return false;
                    if (where.isPrimary !== undefined && loc.isPrimary !== where.isPrimary) return false;
                    if (where.NOT && where.NOT.id && loc.id === where.NOT.id) return false;
                    return true;
                }) || null
            );
        });

        mocks.serviceLocationCreate.mockImplementation(async ({ data }: any) => {
            if (data.isPrimary === true) {
                const existingPrimary = locationsList.find(
                    (l) => l.customerId === data.customerId && l.isPrimary === true
                );
                if (existingPrimary) {
                    const err = new Error("Unique constraint failed");
                    (err as any).code = "P2002";
                    throw err;
                }
            }
            const location: ServiceLocation = {
                id: `loc_${Date.now()}_${Math.random().toString(36).substring(7)}`,
                customerId: data.customerId,
                name: data.name,
                addressLine1: data.addressLine1,
                addressLine2: data.addressLine2 || null,
                city: data.city,
                state: data.state || null,
                postalCode: data.postalCode || null,
                country: data.country,
                latitude: data.latitude ?? null,
                longitude: data.longitude ?? null,
                notes: data.notes || null,
                isPrimary: data.isPrimary ?? false,
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            locationsList.push(location);
            return location;
        });

        mocks.serviceLocationUpdate.mockImplementation(async ({ where, data }: any) => {
            const index = locationsList.findIndex((l) => l.id === where.id);
            if (index === -1) throw new Error("Location not found");
            const existing = locationsList[index]!;
            if (data.isPrimary === true && !existing.isPrimary) {
                const otherPrimary = locationsList.find(
                    (l) => l.customerId === existing.customerId && l.isPrimary === true && l.id !== existing.id
                );
                if (otherPrimary) {
                    const err = new Error("Unique constraint failed");
                    (err as any).code = "P2002";
                    throw err;
                }
            }
            const updated: ServiceLocation = { ...existing, ...data, updatedAt: new Date() };
            locationsList[index] = updated;
            return updated;
        });

        mocks.serviceLocationDelete.mockImplementation(async ({ where }: any) => {
            const index = locationsList.findIndex((l) => l.id === where.id);
            if (index === -1) throw new Error("Location not found");
            const [deleted] = locationsList.splice(index, 1);
            return deleted!;
        });

        mocks.transaction.mockImplementation(async (callback: (tx: any) => Promise<any>) => {
            const tx = {
                customerContact: {
                    findFirst: mocks.customerContactFindFirst,
                    update: mocks.customerContactUpdate,
                },
                serviceLocation: {
                    findFirst: mocks.serviceLocationFindFirst,
                    update: mocks.serviceLocationUpdate,
                },
            };
            return callback(tx);
        });

        registerWorkspace(WS_ALPHA, "Alpha Workspace", "alpha-ws");
        registerWorkspace(WS_BETA, "Beta Workspace", "beta-ws");
    });

    function registerUser(userId = "user_admin", name = "Admin User") {
        const user: User = {
            id: userId,
            name,
            email: `${userId}@example.com`,
            passwordHash: "hashed-pwd",
            emailVerified: new Date(),
            avatarUrl: null,
            status: "ACTIVE",
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
        role: "OWNER" | "ADMIN" | "MANAGER" | "DISPATCHER" | "TECHNICIAN" | "ACCOUNTANT" = "ADMIN"
    ) {
        const member: WorkspaceMember = {
            id: `member_${userId}_${workspaceId}`,
            userId,
            workspaceId,
            role: role as any,
            status: "ACTIVE",
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
            customerNumber: `CUST-${id}`,
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
            notes: "Client for integration testing",
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
            title: "Manager",
            email: `${firstName.toLowerCase()}@client.com`,
            phone: "+1-555-1000",
            mobilePhone: null,
            isPrimary,
            notes: "Integration contact",
            createdAt: new Date("2026-08-19T10:00:00.000Z"),
            updatedAt: new Date("2026-08-19T10:00:00.000Z"),
        };
        contactsList.push(contact);
        return contact;
    }

    function seedLocation(
        id: string,
        customerId: string,
        name: string,
        isPrimary = false
    ): ServiceLocation {
        const location: ServiceLocation = {
            id,
            customerId,
            name,
            addressLine1: "100 Main St",
            addressLine2: null,
            city: "Austin",
            state: "TX",
            postalCode: "78701",
            country: "USA",
            latitude: new Prisma.Decimal("30.2672"),
            longitude: new Prisma.Decimal("-97.7431"),
            notes: "Integration location",
            isPrimary,
            createdAt: new Date("2026-08-19T10:00:00.000Z"),
            updatedAt: new Date("2026-08-19T10:00:00.000Z"),
        };
        locationsList.push(location);
        return location;
    }

    describe("1. Multi-Tenant Cross-Workspace Isolation", () => {
        beforeEach(() => {
            registerUser("user_alpha");
            registerMember("user_alpha", WS_ALPHA, "ADMIN");

            registerUser("user_beta");
            registerMember("user_beta", WS_BETA, "ADMIN");

            seedCustomer("cust_alpha", WS_ALPHA, "Alpha Customer");
            seedContact("cnt_alpha", "cust_alpha", "Alpha", "Contact", true);
            seedLocation("loc_alpha", "cust_alpha", "Alpha Location", true);

            seedCustomer("cust_beta", WS_BETA, "Beta Customer");
            seedContact("cnt_beta", "cust_beta", "Beta", "Contact", true);
            seedLocation("loc_beta", "cust_beta", "Beta Location", true);
        });

        it("Alpha user cannot mutate Beta Customer Contacts", async () => {
            loginAs("user_alpha");

            await expect(
                createCustomerContact(WS_ALPHA, "cust_beta", { firstName: "Injected", lastName: "Contact" })
            ).rejects.toThrow(CustomerNotFoundError);

            await expect(
                updateCustomerContact(WS_ALPHA, "cust_beta", "cnt_beta", { firstName: "Hacked" })
            ).rejects.toThrow(CustomerNotFoundError);

            await expect(
                setPrimaryCustomerContact(WS_ALPHA, "cust_beta", "cnt_beta")
            ).rejects.toThrow(CustomerNotFoundError);

            await expect(
                deleteCustomerContact(WS_ALPHA, "cust_beta", "cnt_beta")
            ).rejects.toThrow(CustomerNotFoundError);
        });

        it("Alpha user cannot mutate Beta Service Locations", async () => {
            loginAs("user_alpha");

            await expect(
                createServiceLocation(WS_ALPHA, "cust_beta", {
                    name: "Injected Site",
                    addressLine1: "100 Hack Rd",
                    city: "Austin",
                    country: "USA",
                })
            ).rejects.toThrow(CustomerNotFoundError);

            await expect(
                updateServiceLocation(WS_ALPHA, "cust_beta", "loc_beta", { name: "Hacked Site" })
            ).rejects.toThrow(CustomerNotFoundError);

            await expect(
                setPrimaryServiceLocation(WS_ALPHA, "cust_beta", "loc_beta")
            ).rejects.toThrow(CustomerNotFoundError);

            await expect(
                deleteServiceLocation(WS_ALPHA, "cust_beta", "loc_beta")
            ).rejects.toThrow(CustomerNotFoundError);
        });
    });

    describe("2. Same-Workspace Cross-Customer Isolation", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ALPHA, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ALPHA, "Customer 1");
            seedContact("cnt_1", "cust_1", "Contact", "One", true);
            seedLocation("loc_1", "cust_1", "Location One", true);

            seedCustomer("cust_2", WS_ALPHA, "Customer 2");
            seedContact("cnt_2", "cust_2", "Contact", "Two", true);
            seedLocation("loc_2", "cust_2", "Location Two", true);
        });

        it("cannot access or mutate Customer 1's Contact under Customer 2", async () => {
            await expect(
                updateCustomerContact(WS_ALPHA, "cust_2", "cnt_1", { firstName: "Cross" })
            ).rejects.toThrow(CustomerContactNotFoundError);

            await expect(
                setPrimaryCustomerContact(WS_ALPHA, "cust_2", "cnt_1")
            ).rejects.toThrow(CustomerContactNotFoundError);

            await expect(
                deleteCustomerContact(WS_ALPHA, "cust_2", "cnt_1")
            ).rejects.toThrow(CustomerContactNotFoundError);
        });

        it("cannot access or mutate Customer 1's Location under Customer 2", async () => {
            await expect(
                updateServiceLocation(WS_ALPHA, "cust_2", "loc_1", { name: "Cross Site" })
            ).rejects.toThrow(ServiceLocationNotFoundError);

            await expect(
                setPrimaryServiceLocation(WS_ALPHA, "cust_2", "loc_1")
            ).rejects.toThrow(ServiceLocationNotFoundError);

            await expect(
                deleteServiceLocation(WS_ALPHA, "cust_2", "loc_1")
            ).rejects.toThrow(ServiceLocationNotFoundError);
        });
    });

    describe("3. Customer Lifecycle Consistency Across Domain", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ALPHA, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_inact", WS_ALPHA, "Inactive Corp", "INACTIVE");
            seedContact("cnt_inact", "cust_inact", "Inactive", "Contact", true);
            seedLocation("loc_inact", "cust_inact", "Inactive", true);
        });

        it("rejects all mutations against INACTIVE customers with InactiveCustomerError", async () => {
            await expect(
                createCustomerContact(WS_ALPHA, "cust_inact", { firstName: "New", lastName: "Contact" })
            ).rejects.toThrow(InactiveCustomerError);

            await expect(
                updateCustomerContact(WS_ALPHA, "cust_inact", "cnt_inact", { title: "VP" })
            ).rejects.toThrow(InactiveCustomerError);

            await expect(
                setPrimaryCustomerContact(WS_ALPHA, "cust_inact", "cnt_inact")
            ).rejects.toThrow(InactiveCustomerError);

            await expect(
                deleteCustomerContact(WS_ALPHA, "cust_inact", "cnt_inact")
            ).rejects.toThrow(InactiveCustomerError);

            await expect(
                createServiceLocation(WS_ALPHA, "cust_inact", {
                    name: "New Hub",
                    addressLine1: "123 St",
                    city: "Austin",
                    country: "USA",
                })
            ).rejects.toThrow(InactiveCustomerError);

            await expect(
                updateServiceLocation(WS_ALPHA, "cust_inact", "loc_inact", { name: "New Name" })
            ).rejects.toThrow(InactiveCustomerError);

            await expect(
                setPrimaryServiceLocation(WS_ALPHA, "cust_inact", "loc_inact")
            ).rejects.toThrow(InactiveCustomerError);

            await expect(
                deleteServiceLocation(WS_ALPHA, "cust_inact", "loc_inact")
            ).rejects.toThrow(InactiveCustomerError);
        });
    });

    describe("4. Cascade Deletion Integration", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ALPHA, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_del", WS_ALPHA, "Customer Deletable", "INACTIVE");
            seedContact("cnt_d1", "cust_del", "Contact", "D1");
            seedContact("cnt_d2", "cust_del", "Contact", "D2");
            seedLocation("loc_d1", "cust_del", "Location D1");
            seedLocation("loc_d2", "cust_del", "Location D2");
        });

        it("deleting customer cascades to delete all child contacts and locations", async () => {
            expect(contactsList.filter((c) => c.customerId === "cust_del")).toHaveLength(2);
            expect(locationsList.filter((l) => l.customerId === "cust_del")).toHaveLength(2);

            const deleted = await deleteCustomer(WS_ALPHA, "cust_del");
            expect(deleted.id).toBe("cust_del");

            expect(customersList.find((c) => c.id === "cust_del")).toBeUndefined();
            expect(contactsList.filter((c) => c.customerId === "cust_del")).toHaveLength(0);
            expect(locationsList.filter((l) => l.customerId === "cust_del")).toHaveLength(0);
        });
    });

    describe("5. Primary Invariant Integration (Contacts & Service Locations)", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ALPHA, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_p", WS_ALPHA, "Primary Testing Customer");
        });

        it("manages service location primary promotion, demotion, and idempotency", async () => {
            const loc1 = seedLocation("loc_p1", "cust_p", "Location 1", true);
            const loc2 = seedLocation("loc_p2", "cust_p", "Location 2", false);

            // Setting already primary location is idempotent
            const idempotentResult = await setPrimaryServiceLocation(WS_ALPHA, "cust_p", "loc_p1");
            expect(idempotentResult.id).toBe("loc_p1");
            expect(idempotentResult.isPrimary).toBe(true);

            // Setting loc2 as primary reassigns primary atomically
            const promotedResult = await setPrimaryServiceLocation(WS_ALPHA, "cust_p", "loc_p2");
            expect(promotedResult.id).toBe("loc_p2");
            expect(promotedResult.isPrimary).toBe(true);

            const updatedLoc1 = locationsList.find((l) => l.id === "loc_p1");
            const updatedLoc2 = locationsList.find((l) => l.id === "loc_p2");
            expect(updatedLoc1?.isPrimary).toBe(false);
            expect(updatedLoc2?.isPrimary).toBe(true);
        });

        it("rejects direct update of isPrimary: true when another primary location exists", async () => {
            seedLocation("loc_active_prim", "cust_p", "Current Primary", true);
            seedLocation("loc_other", "cust_p", "Other Site", false);

            await expect(
                updateServiceLocation(WS_ALPHA, "cust_p", "loc_other", { isPrimary: true })
            ).rejects.toThrow(ServiceLocationPrimaryExistsError);
        });
    });
});
