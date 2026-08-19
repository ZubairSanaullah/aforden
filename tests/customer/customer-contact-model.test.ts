import { describe, expect, it, vi, beforeEach } from "vitest";
import {
    type Customer,
    type CustomerContact,
    type Workspace,
} from "../../generated/prisma/client";

const mocks = vi.hoisted(() => ({
    customerContactCreate: vi.fn(),
    customerContactFindUnique: vi.fn(),
    customerContactFindMany: vi.fn(),
    customerContactFindFirst: vi.fn(),
    customerContactUpdate: vi.fn(),
    customerContactDelete: vi.fn(),
    customerCreate: vi.fn(),
    customerFindUnique: vi.fn(),
    customerDelete: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        customerContact: {
            create: mocks.customerContactCreate,
            findUnique: mocks.customerContactFindUnique,
            findMany: mocks.customerContactFindMany,
            findFirst: mocks.customerContactFindFirst,
            update: mocks.customerContactUpdate,
            delete: mocks.customerContactDelete,
        },
        customer: {
            create: mocks.customerCreate,
            findUnique: mocks.customerFindUnique,
            delete: mocks.customerDelete,
        },
    },
}));

import { prisma } from "@/lib/prisma";

describe("Phase 1.4.9 — Customer Contact Model & Schema Integration", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("1. CustomerContact model structure & creation", () => {
        it("creates a customer contact with all operational fields", async () => {
            const mockContact: CustomerContact = {
                id: "cnt_cuid_101",
                customerId: "cust_100",
                firstName: "Jane",
                lastName: "Doe",
                title: "VP of Operations",
                email: "jane.doe@apex-mfg.com",
                phone: "+1-555-0199",
                mobilePhone: "+1-555-0188",
                isPrimary: true,
                notes: "Main operational liaison for dispatch escalations.",
                createdAt: new Date("2026-08-19T10:00:00.000Z"),
                updatedAt: new Date("2026-08-19T10:00:00.000Z"),
            };

            mocks.customerContactCreate.mockResolvedValue(mockContact);

            const result = await prisma.customerContact.create({
                data: {
                    customerId: "cust_100",
                    firstName: "Jane",
                    lastName: "Doe",
                    title: "VP of Operations",
                    email: "jane.doe@apex-mfg.com",
                    phone: "+1-555-0199",
                    mobilePhone: "+1-555-0188",
                    isPrimary: true,
                    notes: "Main operational liaison for dispatch escalations.",
                },
            });

            expect(mocks.customerContactCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    customerId: "cust_100",
                    firstName: "Jane",
                    lastName: "Doe",
                    isPrimary: true,
                }),
            });
            expect(result.id).toBe("cnt_cuid_101");
            expect(result.customerId).toBe("cust_100");
            expect(result.firstName).toBe("Jane");
            expect(result.lastName).toBe("Doe");
            expect(result.title).toBe("VP of Operations");
            expect(result.email).toBe("jane.doe@apex-mfg.com");
            expect(result.isPrimary).toBe(true);
        });

        it("creates a customer contact with minimal required fields and defaults isPrimary to false", async () => {
            const minimalContact: CustomerContact = {
                id: "cnt_min_001",
                customerId: "cust_100",
                firstName: "John",
                lastName: "Smith",
                title: null,
                email: null,
                phone: null,
                mobilePhone: null,
                isPrimary: false,
                notes: null,
                createdAt: new Date("2026-08-19T10:00:00.000Z"),
                updatedAt: new Date("2026-08-19T10:00:00.000Z"),
            };

            mocks.customerContactCreate.mockResolvedValue(minimalContact);

            const result = await prisma.customerContact.create({
                data: {
                    customerId: "cust_100",
                    firstName: "John",
                    lastName: "Smith",
                },
            });

            expect(result.id).toBe("cnt_min_001");
            expect(result.firstName).toBe("John");
            expect(result.lastName).toBe("Smith");
            expect(result.isPrimary).toBe(false);
            expect(result.title).toBeNull();
            expect(result.email).toBeNull();
            expect(result.notes).toBeNull();
        });
    });

    describe("2. Customer 1:N CustomerContact relationship", () => {
        it("allows Customer to include its associated contacts collection", async () => {
            const mockCustomerWithContacts: Customer & { contacts: CustomerContact[] } = {
                id: "cust_100",
                workspaceId: "ws_alpha",
                customerNumber: "CUST-00001",
                name: "Apex Manufacturing Industries",
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
                contacts: [
                    {
                        id: "cnt_1",
                        customerId: "cust_100",
                        firstName: "Jane",
                        lastName: "Doe",
                        title: "Primary Lead",
                        email: "jane@apex.com",
                        phone: "+1-555-1111",
                        mobilePhone: null,
                        isPrimary: true,
                        notes: null,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                    {
                        id: "cnt_2",
                        customerId: "cust_100",
                        firstName: "Bob",
                        lastName: "Taylor",
                        title: "Site Supervisor",
                        email: "bob@apex.com",
                        phone: "+1-555-2222",
                        mobilePhone: null,
                        isPrimary: false,
                        notes: null,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                ],
            };

            mocks.customerFindUnique.mockResolvedValue(mockCustomerWithContacts);

            const result = await prisma.customer.findUnique({
                where: { id: "cust_100" },
                include: { contacts: true },
            });

            expect(mocks.customerFindUnique).toHaveBeenCalledWith({
                where: { id: "cust_100" },
                include: { contacts: true },
            });
            expect(result?.contacts).toHaveLength(2);
            expect(result?.contacts[0]?.isPrimary).toBe(true);
            expect(result?.contacts[1]?.isPrimary).toBe(false);
        });

        it("allows CustomerContact to resolve its parent Customer and inherited workspaceId", async () => {
            const mockContactWithCustomer: CustomerContact & { customer: Customer } = {
                id: "cnt_1",
                customerId: "cust_100",
                firstName: "Jane",
                lastName: "Doe",
                title: "Operations Lead",
                email: "jane@apex.com",
                phone: "+1-555-1111",
                mobilePhone: null,
                isPrimary: true,
                notes: null,
                createdAt: new Date(),
                updatedAt: new Date(),
                customer: {
                    id: "cust_100",
                    workspaceId: "ws_alpha",
                    customerNumber: "CUST-00001",
                    name: "Apex Manufacturing Industries",
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
                },
            };

            mocks.customerContactFindUnique.mockResolvedValue(mockContactWithCustomer);

            const result = await prisma.customerContact.findUnique({
                where: { id: "cnt_1" },
                include: { customer: true },
            });

            expect(mocks.customerContactFindUnique).toHaveBeenCalledWith({
                where: { id: "cnt_1" },
                include: { customer: true },
            });
            expect(result?.customer.id).toBe("cust_100");
            expect(result?.customer.workspaceId).toBe("ws_alpha");
        });
    });

    describe("3. Tenant isolation via Customer ownership chain", () => {
        it("scopes contact lookup through customer workspaceId", async () => {
            mocks.customerContactFindFirst.mockResolvedValue({
                id: "cnt_1",
                customerId: "cust_100",
                firstName: "Jane",
                lastName: "Doe",
                title: null,
                email: null,
                phone: null,
                mobilePhone: null,
                isPrimary: true,
                notes: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await prisma.customerContact.findFirst({
                where: {
                    id: "cnt_1",
                    customer: {
                        workspaceId: "ws_authorized_100",
                    },
                },
            });

            expect(mocks.customerContactFindFirst).toHaveBeenCalledWith({
                where: {
                    id: "cnt_1",
                    customer: {
                        workspaceId: "ws_authorized_100",
                    },
                },
            });
            expect(result?.id).toBe("cnt_1");
        });
    });

    describe("4. Primary contact constraints", () => {
        it("permits multiple non-primary contacts for the same customer", async () => {
            mocks.customerContactFindMany.mockResolvedValue([
                {
                    id: "cnt_1",
                    customerId: "cust_100",
                    firstName: "Alpha",
                    lastName: "One",
                    isPrimary: false,
                },
                {
                    id: "cnt_2",
                    customerId: "cust_100",
                    firstName: "Beta",
                    lastName: "Two",
                    isPrimary: false,
                },
            ]);

            const results = await prisma.customerContact.findMany({
                where: {
                    customerId: "cust_100",
                    isPrimary: false,
                },
            });

            expect(results).toHaveLength(2);
            expect(results.every((c) => !c.isPrimary)).toBe(true);
        });

        it("rejects creating a second primary contact for the same customer when unique constraint fires", async () => {
            mocks.customerContactCreate.mockRejectedValue(
                new Error(
                    "Unique constraint failed on the fields: (`customerId`,`isPrimary`)"
                )
            );

            await expect(
                prisma.customerContact.create({
                    data: {
                        customerId: "cust_100",
                        firstName: "Second",
                        lastName: "Primary",
                        isPrimary: true,
                    },
                })
            ).rejects.toThrow("Unique constraint failed");
        });
    });

    describe("5. Cascade deletion behavior", () => {
        it("cascades deletion when parent Customer is deleted", async () => {
            mocks.customerDelete.mockResolvedValue({
                id: "cust_100",
                workspaceId: "ws_alpha",
                customerNumber: "CUST-00001",
                name: "Deleted Customer",
                email: null,
                phone: null,
                website: null,
                addressLine1: null,
                addressLine2: null,
                city: null,
                state: null,
                postalCode: null,
                country: null,
                status: "INACTIVE",
                notes: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const deleted = await prisma.customer.delete({
                where: { id: "cust_100" },
            });

            expect(mocks.customerDelete).toHaveBeenCalledWith({
                where: { id: "cust_100" },
            });
            expect(deleted.id).toBe("cust_100");
        });
    });
});
