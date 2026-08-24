import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    customerFindFirst: vi.fn(),
    serviceLocationFindFirst: vi.fn(),
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
        serviceLocation: {
            findFirst: mocks.serviceLocationFindFirst,
        },
    },
}));

import { getCustomerOperationalSummary } from "@/lib/services/customer/getCustomerOperationalSummary";
import { getServiceLocationOperationalSummary } from "@/lib/services/customer/getServiceLocationOperationalSummary";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
} from "@/lib/services/authorization/authorizationErrors";
import {
    Prisma,
    type Customer,
    type CustomerContact,
    type ServiceLocation,
    type User,
    type Workspace,
    type WorkspaceMember,
} from "@/generated/prisma/client";

describe("Phase 1.4.24 — Customer & Service Location Operational Read Models Suite", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;

    const WS_ALPHA = "ws_alpha_001";
    const WS_BETA = "ws_beta_002";

    beforeEach(() => {
        vi.clearAllMocks();
        usersMap = new Map();
        workspacesMap = new Map();
        membersMap = new Map();

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

    describe("1. Customer Operational Read Model", () => {
        beforeEach(() => {
            registerUser("user_viewer");
            registerMember("user_viewer", WS_ALPHA, "DISPATCHER");
            loginAs("user_viewer");
        });

        it("returns populated CustomerOperationalReadModel with primary contact, primary location, and counts", async () => {
            const mockContact: CustomerContact = {
                id: "cnt_prim",
                customerId: "cust_1",
                firstName: "Jane",
                lastName: "Doe",
                title: "VP Ops",
                email: "jane@client.com",
                phone: "+1-555-1000",
                mobilePhone: null,
                isPrimary: true,
                notes: null,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const mockLocation: ServiceLocation = {
                id: "loc_prim",
                customerId: "cust_1",
                name: "Main Facility",
                addressLine1: "100 Broadway",
                addressLine2: "Suite 400",
                city: "New York",
                state: "NY",
                postalCode: "10001",
                country: "USA",
                latitude: new Prisma.Decimal("40.7128"),
                longitude: new Prisma.Decimal("-74.0060"),
                notes: "Primary gate code: 1234",
                isPrimary: true,
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            mocks.customerFindFirst.mockResolvedValueOnce({
                id: "cust_1",
                workspaceId: WS_ALPHA,
                customerNumber: "CUST-00001",
                name: "Enterprise Client",
                email: "info@client.com",
                phone: "+1-555-0100",
                website: "https://client.com",
                addressLine1: "100 Broadway",
                addressLine2: null,
                city: "New York",
                state: "NY",
                postalCode: "10001",
                country: "USA",
                status: "ACTIVE",
                notes: "Key enterprise account",
                createdAt: new Date("2026-08-19T00:00:00.000Z"),
                updatedAt: new Date("2026-08-19T00:00:00.000Z"),
                contacts: [mockContact],
                locations: [mockLocation],
                _count: {
                    contacts: 5,
                    locations: 3,
                },
            });

            const result = await getCustomerOperationalSummary(WS_ALPHA, "cust_1");

            expect(result).not.toBeNull();
            expect(result?.id).toBe("cust_1");
            expect(result?.customerNumber).toBe("CUST-00001");
            expect(result?.primaryContact?.id).toBe("cnt_prim");
            expect(result?.primaryLocation?.id).toBe("loc_prim");
            expect(result?.contactsCount).toBe(5);
            expect(result?.locationsCount).toBe(3);
        });

        it("returns null when customer is not found or belongs to another workspace", async () => {
            mocks.customerFindFirst.mockResolvedValueOnce(null);

            const result = await getCustomerOperationalSummary(WS_ALPHA, "cust_nonexistent");
            expect(result).toBeNull();
        });

        it("returns read model with null primaryContact and null primaryLocation when customer has none", async () => {
            mocks.customerFindFirst.mockResolvedValueOnce({
                id: "cust_empty",
                workspaceId: WS_ALPHA,
                customerNumber: "CUST-00002",
                name: "Empty Client",
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
                contacts: [],
                locations: [],
                _count: {
                    contacts: 0,
                    locations: 0,
                },
            });

            const result = await getCustomerOperationalSummary(WS_ALPHA, "cust_empty");
            expect(result).not.toBeNull();
            expect(result?.primaryContact).toBeNull();
            expect(result?.primaryLocation).toBeNull();
            expect(result?.contactsCount).toBe(0);
            expect(result?.locationsCount).toBe(0);
        });
    });

    describe("2. Service Location Operational Read Model", () => {
        beforeEach(() => {
            registerUser("user_viewer");
            registerMember("user_viewer", WS_ALPHA, "TECHNICIAN");
            loginAs("user_viewer");
        });

        it("returns ServiceLocationOperationalReadModel with parent customer metadata", async () => {
            mocks.serviceLocationFindFirst.mockResolvedValueOnce({
                id: "loc_1",
                customerId: "cust_1",
                name: "Austin Data Center",
                addressLine1: "500 Tech Blvd",
                addressLine2: "Bldg A",
                city: "Austin",
                state: "TX",
                postalCode: "78701",
                country: "USA",
                latitude: new Prisma.Decimal("30.2672"),
                longitude: new Prisma.Decimal("-97.7431"),
                notes: "Access badge required",
                isPrimary: true,
                createdAt: new Date("2026-08-19T00:00:00.000Z"),
                updatedAt: new Date("2026-08-19T00:00:00.000Z"),
                customer: {
                    id: "cust_1",
                    customerNumber: "CUST-00001",
                    name: "Cloud Corp",
                    status: "ACTIVE",
                },
            });

            const result = await getServiceLocationOperationalSummary(WS_ALPHA, "cust_1", "loc_1");

            expect(result).not.toBeNull();
            expect(result?.id).toBe("loc_1");
            expect(result?.name).toBe("Austin Data Center");
            expect(result?.customer.name).toBe("Cloud Corp");
            expect(result?.customer.customerNumber).toBe("CUST-00001");
            expect(result?.latitude).toEqual(new Prisma.Decimal("30.2672"));
        });

        it("returns null when location does not exist or does not match customer/workspace", async () => {
            mocks.serviceLocationFindFirst.mockResolvedValueOnce(null);

            const result = await getServiceLocationOperationalSummary(WS_ALPHA, "cust_1", "loc_missing");
            expect(result).toBeNull();
        });
    });

    describe("3. Security & Authorization", () => {
        it("rejects unauthenticated caller", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(getCustomerOperationalSummary(WS_ALPHA, "cust_1")).rejects.toThrow(
                UnauthorizedError
            );
        });

        it("allows all read-authorized roles (OWNER, ADMIN, MANAGER, DISPATCHER, TECHNICIAN, ACCOUNTANT)", async () => {
            const roles: Array<"OWNER" | "ADMIN" | "MANAGER" | "DISPATCHER" | "TECHNICIAN" | "ACCOUNTANT"> = [
                "OWNER",
                "ADMIN",
                "MANAGER",
                "DISPATCHER",
                "TECHNICIAN",
                "ACCOUNTANT",
            ];

            for (const role of roles) {
                const uid = `user_${role.toLowerCase()}`;
                registerUser(uid);
                registerMember(uid, WS_ALPHA, role);
                loginAs(uid);

                mocks.customerFindFirst.mockResolvedValueOnce({
                    id: "cust_1",
                    workspaceId: WS_ALPHA,
                    customerNumber: "CUST-00001",
                    name: "Client",
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
                    contacts: [],
                    locations: [],
                    _count: { contacts: 0, locations: 0 },
                });

                const res = await getCustomerOperationalSummary(WS_ALPHA, "cust_1");
                expect(res).not.toBeNull();
            }
        });
    });
});
