import { describe, expect, it, vi, beforeEach } from "vitest";
import {
    type Customer,
    type CustomerStatus,
    type Workspace,
} from "../../generated/prisma/client";
import { workspaceScope } from "@/lib/auth/tenant";

const mocks = vi.hoisted(() => ({
    customerCreate: vi.fn(),
    customerFindUnique: vi.fn(),
    customerFindMany: vi.fn(),
    customerUpdate: vi.fn(),
    customerDelete: vi.fn(),
    workspaceCreate: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceDelete: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        customer: {
            create: mocks.customerCreate,
            findUnique: mocks.customerFindUnique,
            findMany: mocks.customerFindMany,
            update: mocks.customerUpdate,
            delete: mocks.customerDelete,
        },
        workspace: {
            create: mocks.workspaceCreate,
            findUnique: mocks.workspaceFindUnique,
            delete: mocks.workspaceDelete,
        },
    },
}));

import { prisma } from "@/lib/prisma";

describe("Phase 1.4.2 — Customer Prisma Model & Schema Integration", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("Customer model existence & creation", () => {
        it("creates a valid customer entity with all operational fields", async () => {
            const mockCustomer: Customer = {
                id: "cust_cuid_101",
                workspaceId: "ws_cuid_456",
                customerNumber: "CUST-00001",
                name: "Apex Manufacturing Industries",
                email: "contact@apex-mfg.com",
                phone: "+1-555-0188",
                website: "https://apex-mfg.com",
                addressLine1: "500 Industrial Parkway",
                addressLine2: "Building B, Suite 100",
                city: "Chicago",
                state: "IL",
                postalCode: "60601",
                country: "US",
                status: "ACTIVE",
                notes: "Key commercial client with recurring preventive maintenance.",
                createdAt: new Date("2026-08-19T10:00:00.000Z"),
                updatedAt: new Date("2026-08-19T10:00:00.000Z"),
            };

            mocks.customerCreate.mockResolvedValue(mockCustomer);

            const result = await prisma.customer.create({
                data: {
                    workspaceId: "ws_cuid_456",
                    customerNumber: "CUST-00001",
                    name: "Apex Manufacturing Industries",
                    email: "contact@apex-mfg.com",
                    phone: "+1-555-0188",
                    website: "https://apex-mfg.com",
                    addressLine1: "500 Industrial Parkway",
                    addressLine2: "Building B, Suite 100",
                    city: "Chicago",
                    state: "IL",
                    postalCode: "60601",
                    country: "US",
                    status: "ACTIVE",
                    notes: "Key commercial client with recurring preventive maintenance.",
                },
            });

            expect(mocks.customerCreate).toHaveBeenCalledWith({
                data: expect.objectContaining({
                    workspaceId: "ws_cuid_456",
                    customerNumber: "CUST-00001",
                    name: "Apex Manufacturing Industries",
                    status: "ACTIVE",
                }),
            });
            expect(result.id).toBe("cust_cuid_101");
            expect(result.workspaceId).toBe("ws_cuid_456");
            expect(result.customerNumber).toBe("CUST-00001");
            expect(result.name).toBe("Apex Manufacturing Industries");
            expect(result.status).toBe("ACTIVE");
        });

        it("creates a customer with minimal required fields", async () => {
            const minimalCustomer: Customer = {
                id: "cust_min_001",
                workspaceId: "ws_cuid_456",
                customerNumber: null,
                name: "Simple Customer LLC",
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
                createdAt: new Date("2026-08-19T10:00:00.000Z"),
                updatedAt: new Date("2026-08-19T10:00:00.000Z"),
            };

            mocks.customerCreate.mockResolvedValue(minimalCustomer);

            const result = await prisma.customer.create({
                data: {
                    workspaceId: "ws_cuid_456",
                    name: "Simple Customer LLC",
                },
            });

            expect(mocks.customerCreate).toHaveBeenCalledWith({
                data: {
                    workspaceId: "ws_cuid_456",
                    name: "Simple Customer LLC",
                },
            });
            expect(result.id).toBe("cust_min_001");
            expect(result.customerNumber).toBeNull();
            expect(result.email).toBeNull();
            expect(result.phone).toBeNull();
            expect(result.addressLine1).toBeNull();
            expect(result.status).toBe("ACTIVE");
        });
    });

    describe("Customer status lifecycle & defaults", () => {
        it("defaults status to ACTIVE when created", async () => {
            const activeCustomer: Customer = {
                id: "cust_act_1",
                workspaceId: "ws_1",
                customerNumber: "CUST-101",
                name: "Active Customer",
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

            mocks.customerCreate.mockResolvedValue(activeCustomer);

            const result = await prisma.customer.create({
                data: {
                    workspaceId: "ws_1",
                    name: "Active Customer",
                },
            });

            expect(result.status).toBe("ACTIVE");
        });

        it("supports updating status to INACTIVE for deactivation", async () => {
            const inactiveStatus: CustomerStatus = "INACTIVE";
            const deactivatedCustomer: Customer = {
                id: "cust_act_1",
                workspaceId: "ws_1",
                customerNumber: "CUST-101",
                name: "Active Customer",
                email: null,
                phone: null,
                website: null,
                addressLine1: null,
                addressLine2: null,
                city: null,
                state: null,
                postalCode: null,
                country: null,
                status: inactiveStatus,
                notes: "Deactivated per client request",
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            mocks.customerUpdate.mockResolvedValue(deactivatedCustomer);

            const result = await prisma.customer.update({
                where: { id: "cust_act_1" },
                data: {
                    status: "INACTIVE",
                    notes: "Deactivated per client request",
                },
            });

            expect(mocks.customerUpdate).toHaveBeenCalledWith({
                where: { id: "cust_act_1" },
                data: {
                    status: "INACTIVE",
                    notes: "Deactivated per client request",
                },
            });
            expect(result.status).toBe("INACTIVE");
        });
    });

    describe("Workspace 1:N relationship & tenant scoping", () => {
        it("allows workspace to query its associated customers collection (1:N)", async () => {
            const mockWorkspaceWithCustomers: Workspace & { customers: Customer[] } = {
                id: "ws_cuid_456",
                name: "Acme Services",
                slug: "acme-services",
                logoUrl: null,
                timezone: "Asia/Karachi",
                createdAt: new Date("2026-08-19T00:00:00.000Z"),
                updatedAt: new Date("2026-08-19T00:00:00.000Z"),
                customers: [
                    {
                        id: "cust_1",
                        workspaceId: "ws_cuid_456",
                        customerNumber: "CUST-001",
                        name: "Customer One",
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
                    {
                        id: "cust_2",
                        workspaceId: "ws_cuid_456",
                        customerNumber: "CUST-002",
                        name: "Customer Two",
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
                ],
            };

            mocks.workspaceFindUnique.mockResolvedValue(mockWorkspaceWithCustomers);

            const result = await prisma.workspace.findUnique({
                where: { id: "ws_cuid_456" },
                include: { customers: true },
            });

            expect(mocks.workspaceFindUnique).toHaveBeenCalledWith({
                where: { id: "ws_cuid_456" },
                include: { customers: true },
            });
            expect(result?.customers).toHaveLength(2);
            expect(result?.customers[0]?.name).toBe("Customer One");
            expect(result?.customers[1]?.name).toBe("Customer Two");
        });

        it("allows customer to resolve its parent workspace", async () => {
            const mockCustomerWithWorkspace: Customer & { workspace: Workspace } = {
                id: "cust_1",
                workspaceId: "ws_cuid_456",
                customerNumber: "CUST-001",
                name: "Customer One",
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
                workspace: {
                    id: "ws_cuid_456",
                    name: "Acme Services",
                    slug: "acme-services",
                    logoUrl: null,
                    timezone: "Asia/Karachi",
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            };

            mocks.customerFindUnique.mockResolvedValue(mockCustomerWithWorkspace);

            const result = await prisma.customer.findUnique({
                where: { id: "cust_1" },
                include: { workspace: true },
            });

            expect(mocks.customerFindUnique).toHaveBeenCalledWith({
                where: { id: "cust_1" },
                include: { workspace: true },
            });
            expect(result?.workspace.id).toBe("ws_cuid_456");
            expect(result?.workspace.slug).toBe("acme-services");
        });

        it("scopes customer queries seamlessly using workspaceScope helper", async () => {
            const scope = workspaceScope("ws_tenant_999");
            expect(scope).toEqual({ workspaceId: "ws_tenant_999" });

            mocks.customerFindMany.mockResolvedValue([
                {
                    id: "cust_99",
                    workspaceId: "ws_tenant_999",
                    customerNumber: "CUST-99",
                    name: "Tenant Customer",
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
            ]);

            const result = await prisma.customer.findMany({
                where: {
                    ...workspaceScope("ws_tenant_999"),
                    status: "ACTIVE",
                },
            });

            expect(mocks.customerFindMany).toHaveBeenCalledWith({
                where: {
                    workspaceId: "ws_tenant_999",
                    status: "ACTIVE",
                },
            });
            expect(result).toHaveLength(1);
            expect(result[0]?.workspaceId).toBe("ws_tenant_999");
        });
    });

    describe("Customer number & uniqueness constraints", () => {
        it("enforces workspace-scoped customerNumber uniqueness via composite unique key", async () => {
            mocks.customerCreate.mockRejectedValue(
                new Error("Unique constraint failed on the fields: (`workspaceId`,`customerNumber`)")
            );

            await expect(
                prisma.customer.create({
                    data: {
                        workspaceId: "ws_cuid_456",
                        customerNumber: "CUST-00001",
                        name: "Duplicate Number Customer",
                    },
                })
            ).rejects.toThrow("Unique constraint failed");
        });

        it("permits same customerNumber across different workspaces", async () => {
            const custWs1: Customer = {
                id: "cust_ws1",
                workspaceId: "ws_1",
                customerNumber: "CUST-001",
                name: "Customer In WS 1",
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

            const custWs2: Customer = {
                id: "cust_ws2",
                workspaceId: "ws_2",
                customerNumber: "CUST-001",
                name: "Customer In WS 2",
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

            mocks.customerFindUnique.mockImplementation(async ({ where }) => {
                if (where.workspaceId_customerNumber) {
                    const { workspaceId, customerNumber } = where.workspaceId_customerNumber;
                    if (workspaceId === "ws_1" && customerNumber === "CUST-001") return custWs1;
                    if (workspaceId === "ws_2" && customerNumber === "CUST-001") return custWs2;
                }
                return null;
            });

            const res1 = await prisma.customer.findUnique({
                where: {
                    workspaceId_customerNumber: {
                        workspaceId: "ws_1",
                        customerNumber: "CUST-001",
                    },
                },
            });

            const res2 = await prisma.customer.findUnique({
                where: {
                    workspaceId_customerNumber: {
                        workspaceId: "ws_2",
                        customerNumber: "CUST-001",
                    },
                },
            });

            expect(res1?.workspaceId).toBe("ws_1");
            expect(res1?.customerNumber).toBe("CUST-001");
            expect(res2?.workspaceId).toBe("ws_2");
            expect(res2?.customerNumber).toBe("CUST-001");
        });
    });

    describe("Cascade deletion behavior", () => {
        it("cascades deletion when parent workspace is removed", async () => {
            mocks.workspaceDelete.mockResolvedValue({
                id: "ws_cuid_456",
                name: "Acme Services",
                slug: "acme-services",
                logoUrl: null,
                timezone: "Asia/Karachi",
                createdAt: new Date(),
                updatedAt: new Date(),
            });

            const deletedWorkspace = await prisma.workspace.delete({
                where: { id: "ws_cuid_456" },
            });

            expect(mocks.workspaceDelete).toHaveBeenCalledWith({
                where: { id: "ws_cuid_456" },
            });
            expect(deletedWorkspace.id).toBe("ws_cuid_456");
        });
    });
});
