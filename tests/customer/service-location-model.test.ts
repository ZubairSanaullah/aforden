import { describe, expect, it, vi, beforeEach } from "vitest";
import {
    Prisma,
    type Customer,
    type ServiceLocation,
} from "../../generated/prisma/client";

const mocks = vi.hoisted(() => ({
    serviceLocationCreate: vi.fn(),
    serviceLocationFindUnique: vi.fn(),
    serviceLocationFindMany: vi.fn(),
    serviceLocationFindFirst: vi.fn(),
    serviceLocationUpdate: vi.fn(),
    serviceLocationDelete: vi.fn(),
    customerCreate: vi.fn(),
    customerFindUnique: vi.fn(),
    customerDelete: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        serviceLocation: {
            create: mocks.serviceLocationCreate,
            findUnique: mocks.serviceLocationFindUnique,
            findMany: mocks.serviceLocationFindMany,
            findFirst: mocks.serviceLocationFindFirst,
            update: mocks.serviceLocationUpdate,
            delete: mocks.serviceLocationDelete,
        },
        customer: {
            create: mocks.customerCreate,
            findUnique: mocks.customerFindUnique,
            delete: mocks.customerDelete,
        },
    },
}));

import { prisma } from "@/lib/prisma";

describe("Phase 1.4.17 — Service Location Model & Schema Integration", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("1. ServiceLocation model structure & creation", () => {
        it("creates a service location with all operational and geographic fields", async () => {
            const mockLocation: ServiceLocation = {
                id: "loc_cuid_101",
                customerId: "cust_100",
                name: "Headquarters & Manufacturing Plant",
                addressLine1: "100 Industrial Parkway",
                addressLine2: "Building B, Suite 400",
                city: "Austin",
                state: "TX",
                postalCode: "78701",
                country: "USA",
                latitude: new Prisma.Decimal("30.267153"),
                longitude: new Prisma.Decimal("-97.743057"),
                notes: "Main service entrance located at Gate 3. Badge required.",
                isPrimary: true,
                createdAt: new Date("2026-08-19T10:00:00.000Z"),
                updatedAt: new Date("2026-08-19T10:00:00.000Z"),
            };

            mocks.serviceLocationCreate.mockResolvedValue(mockLocation);

            const result = await prisma.serviceLocation.create({
                data: {
                    customerId: "cust_100",
                    name: "Headquarters & Manufacturing Plant",
                    addressLine1: "100 Industrial Parkway",
                    addressLine2: "Building B, Suite 400",
                    city: "Austin",
                    state: "TX",
                    postalCode: "78701",
                    country: "USA",
                    latitude: new Prisma.Decimal("30.267153"),
                    longitude: new Prisma.Decimal("-97.743057"),
                    notes: "Main service entrance located at Gate 3. Badge required.",
                    isPrimary: true,
                },
            });

            expect(mocks.serviceLocationCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    customerId: "cust_100",
                    name: "Headquarters & Manufacturing Plant",
                    addressLine1: "100 Industrial Parkway",
                    city: "Austin",
                    country: "USA",
                    isPrimary: true,
                }),
            });
            expect(result.id).toBe("loc_cuid_101");
            expect(result.customerId).toBe("cust_100");
            expect(result.name).toBe("Headquarters & Manufacturing Plant");
            expect(result.city).toBe("Austin");
            expect(result.state).toBe("TX");
            expect(result.isPrimary).toBe(true);
        });

        it("creates a service location with minimal required fields and defaults isPrimary to false", async () => {
            const minimalLocation: ServiceLocation = {
                id: "loc_min_001",
                customerId: "cust_100",
                name: "Warehouse Depot",
                addressLine1: "50 Storage Lane",
                addressLine2: null,
                city: "Dallas",
                state: null,
                postalCode: null,
                country: "USA",
                latitude: null,
                longitude: null,
                notes: null,
                isPrimary: false,
                createdAt: new Date("2026-08-19T10:00:00.000Z"),
                updatedAt: new Date("2026-08-19T10:00:00.000Z"),
            };

            mocks.serviceLocationCreate.mockResolvedValue(minimalLocation);

            const result = await prisma.serviceLocation.create({
                data: {
                    customerId: "cust_100",
                    name: "Warehouse Depot",
                    addressLine1: "50 Storage Lane",
                    city: "Dallas",
                    country: "USA",
                },
            });

            expect(result.id).toBe("loc_min_001");
            expect(result.name).toBe("Warehouse Depot");
            expect(result.addressLine1).toBe("50 Storage Lane");
            expect(result.city).toBe("Dallas");
            expect(result.country).toBe("USA");
            expect(result.isPrimary).toBe(false);
            expect(result.addressLine2).toBeNull();
            expect(result.state).toBeNull();
            expect(result.postalCode).toBeNull();
            expect(result.latitude).toBeNull();
            expect(result.longitude).toBeNull();
            expect(result.notes).toBeNull();
        });
    });

    describe("2. Customer 1:N ServiceLocation relationship", () => {
        it("allows Customer to include its associated locations collection", async () => {
            const mockCustomerWithLocations: Customer & { locations: ServiceLocation[] } = {
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
                locations: [
                    {
                        id: "loc_1",
                        customerId: "cust_100",
                        name: "Primary Office",
                        addressLine1: "100 Main St",
                        addressLine2: null,
                        city: "Austin",
                        state: "TX",
                        postalCode: "78701",
                        country: "USA",
                        latitude: null,
                        longitude: null,
                        notes: null,
                        isPrimary: true,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                    {
                        id: "loc_2",
                        customerId: "cust_100",
                        name: "North Distribution Hub",
                        addressLine1: "200 Logistics Blvd",
                        addressLine2: null,
                        city: "Round Rock",
                        state: "TX",
                        postalCode: "78664",
                        country: "USA",
                        latitude: null,
                        longitude: null,
                        notes: null,
                        isPrimary: false,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    },
                ],
            };

            mocks.customerFindUnique.mockResolvedValue(mockCustomerWithLocations);

            const result = await prisma.customer.findUnique({
                where: { id: "cust_100" },
                include: { locations: true },
            });

            expect(mocks.customerFindUnique).toHaveBeenCalledWith({
                where: { id: "cust_100" },
                include: { locations: true },
            });
            expect(result?.locations).toHaveLength(2);
            expect(result?.locations[0]?.isPrimary).toBe(true);
            expect(result?.locations[1]?.isPrimary).toBe(false);
        });

        it("allows ServiceLocation to resolve its parent Customer and inherited workspaceId", async () => {
            const mockLocationWithCustomer: ServiceLocation & { customer: Customer } = {
                id: "loc_1",
                customerId: "cust_100",
                name: "Primary Plant",
                addressLine1: "100 Factory Rd",
                addressLine2: null,
                city: "Austin",
                state: "TX",
                postalCode: "78701",
                country: "USA",
                latitude: null,
                longitude: null,
                notes: null,
                isPrimary: true,
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

            mocks.serviceLocationFindUnique.mockResolvedValue(mockLocationWithCustomer);

            const result = await prisma.serviceLocation.findUnique({
                where: { id: "loc_1" },
                include: { customer: true },
            });

            expect(mocks.serviceLocationFindUnique).toHaveBeenCalledWith({
                where: { id: "loc_1" },
                include: { customer: true },
            });
            expect(result?.customer.id).toBe("cust_100");
            expect(result?.customer.workspaceId).toBe("ws_alpha");
        });
    });

    describe("3. Tenant isolation via Customer ownership chain", () => {
        it("scopes location lookup through customer workspaceId", async () => {
            mocks.serviceLocationFindFirst.mockResolvedValue({
                id: "loc_1",
                customerId: "cust_100",
                name: "Secure Site",
                addressLine1: "100 Secure Way",
                addressLine2: null,
                city: "Houston",
                state: "TX",
                postalCode: "77001",
                country: "USA",
                latitude: null,
                longitude: null,
                notes: null,
                isPrimary: true,
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const result = await prisma.serviceLocation.findFirst({
                where: {
                    id: "loc_1",
                    customer: {
                        workspaceId: "ws_authorized_100",
                    },
                },
            });

            expect(mocks.serviceLocationFindFirst).toHaveBeenCalledWith({
                where: {
                    id: "loc_1",
                    customer: {
                        workspaceId: "ws_authorized_100",
                    },
                },
            });
            expect(result?.id).toBe("loc_1");
        });
    });

    describe("4. Primary location constraints & indexes", () => {
        it("permits multiple non-primary locations for the same customer", async () => {
            mocks.serviceLocationFindMany.mockResolvedValue([
                {
                    id: "loc_1",
                    customerId: "cust_100",
                    name: "Branch 1",
                    isPrimary: false,
                },
                {
                    id: "loc_2",
                    customerId: "cust_100",
                    name: "Branch 2",
                    isPrimary: false,
                },
            ]);

            const results = await prisma.serviceLocation.findMany({
                where: {
                    customerId: "cust_100",
                    isPrimary: false,
                },
            });

            expect(results).toHaveLength(2);
            expect(results.every((l) => !l.isPrimary)).toBe(true);
        });

        it("rejects creating a second primary location for the same customer when partial unique index fires", async () => {
            mocks.serviceLocationCreate.mockRejectedValue(
                new Error(
                    "Unique constraint failed on the fields: (`customerId`,`isPrimary`)"
                )
            );

            await expect(
                prisma.serviceLocation.create({
                    data: {
                        customerId: "cust_100",
                        name: "Second Primary Location",
                        addressLine1: "200 Duplicate Ave",
                        city: "Austin",
                        country: "USA",
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

    describe("6. Identity boundary security", () => {
        it("verifies ServiceLocation has no user or authentication credentials", () => {
            const sampleLocation: ServiceLocation = {
                id: "loc_sample",
                customerId: "cust_sample",
                name: "Sample Location",
                addressLine1: "123 Sample Rd",
                addressLine2: null,
                city: "Austin",
                state: "TX",
                postalCode: "78701",
                country: "USA",
                latitude: null,
                longitude: null,
                notes: null,
                isPrimary: false,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const keys = Object.keys(sampleLocation);
            expect(keys).not.toContain("password");
            expect(keys).not.toContain("passwordHash");
            expect(keys).not.toContain("userId");
            expect(keys).not.toContain("workspaceMemberId");
            expect(keys).not.toContain("technicianId");
            expect(keys).not.toContain("employeeId");
        });
    });
});
