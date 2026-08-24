import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    customerFindFirst: vi.fn(),
    serviceLocationFindFirst: vi.fn(),
    serviceLocationDelete: vi.fn(),
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
            delete: mocks.serviceLocationDelete,
        },
    },
}));

import { deleteServiceLocation } from "@/lib/services/customer/deleteServiceLocation";
import {
    CustomerNotFoundError,
    ServiceLocationNotFoundError,
    InactiveCustomerError,
    ServiceLocationDeletionError,
    ServiceLocationDeletionNotAllowedError,
} from "@/lib/services/customer/customerErrors";
import {
    UnauthorizedError,
    ForbiddenError,
    WorkspaceAccessDeniedError,
    WorkspaceNotFoundError,
} from "@/lib/services/authorization/authorizationErrors";
import {
    Prisma,
    type Customer,
    type ServiceLocation,
    type User,
    type Workspace,
    type WorkspaceMember,
} from "@/generated/prisma/client";

describe("Phase 1.4.22 — Service Location Deletion Service Suite", () => {
    let usersMap: Map<string, User>;
    let workspacesMap: Map<string, Workspace>;
    let membersMap: Map<string, WorkspaceMember>;
    let customersList: Customer[];
    let locationsList: ServiceLocation[];

    const WS_ID_1 = "ws_alpha_100";
    const WS_ID_2 = "ws_beta_200";

    beforeEach(() => {
        vi.clearAllMocks();
        usersMap = new Map();
        workspacesMap = new Map();
        membersMap = new Map();
        customersList = [];
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
                    return true;
                }) || null
            );
        });

        mocks.serviceLocationFindFirst.mockImplementation(async ({ where }: any) => {
            return (
                locationsList.find((loc) => {
                    if (where.id && loc.id !== where.id) return false;
                    if (where.customerId && loc.customerId !== where.customerId) return false;
                    return true;
                }) || null
            );
        });

        mocks.serviceLocationDelete.mockImplementation(async ({ where }: any) => {
            const index = locationsList.findIndex((l) => l.id === where.id);
            if (index === -1) {
                const err = new Error("Record to delete does not exist.");
                (err as any).code = "P2025";
                throw err;
            }

            const [deleted] = locationsList.splice(index, 1);
            return deleted!;
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
            notes: "Client for location deletion tests",
            createdAt: new Date("2026-08-19T10:00:00.000Z"),
            updatedAt: new Date("2026-08-19T10:00:00.000Z"),
        };
        customersList.push(customer);
        return customer;
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
            addressLine1: "100 Industrial Parkway",
            addressLine2: null,
            city: "Austin",
            state: "TX",
            postalCode: "78701",
            country: "USA",
            latitude: new Prisma.Decimal("30.267153"),
            longitude: new Prisma.Decimal("-97.743057"),
            notes: "Operational site",
            isPrimary,
            createdAt: new Date("2026-08-19T10:00:00.000Z"),
            updatedAt: new Date("2026-08-19T10:00:00.000Z"),
        };
        locationsList.push(location);
        return location;
    }

    describe("1. Authorization & RBAC Checks", () => {
        beforeEach(() => {
            seedCustomer("cust_1", WS_ID_1, "Client Corp");
            seedLocation("loc_1", "cust_1", "Austin Plant");
        });

        it("rejects unauthenticated caller with UnauthorizedError", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(deleteServiceLocation(WS_ID_1, "cust_1", "loc_1")).rejects.toThrow(
                UnauthorizedError
            );
        });

        it("rejects inactive workspace membership with WorkspaceAccessDeniedError", async () => {
            registerUser("user_suspended");
            registerMember("user_suspended", WS_ID_1, "ADMIN", "SUSPENDED");
            loginAs("user_suspended");

            await expect(deleteServiceLocation(WS_ID_1, "cust_1", "loc_1")).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
        });

        it("rejects deactivated user with WorkspaceAccessDeniedError", async () => {
            registerUser("user_deactivated", "Deactivated", "DEACTIVATED");
            registerMember("user_deactivated", WS_ID_1, "ADMIN");
            loginAs("user_deactivated");

            await expect(deleteServiceLocation(WS_ID_1, "cust_1", "loc_1")).rejects.toThrow(
                WorkspaceAccessDeniedError
            );
        });

        it("rejects non-existent workspace with WorkspaceNotFoundError", async () => {
            registerUser("user_admin");
            registerMember("user_admin", "ws_nonexistent", "ADMIN");
            loginAs("user_admin");

            await expect(deleteServiceLocation("ws_nonexistent", "cust_1", "loc_1")).rejects.toThrow(
                WorkspaceNotFoundError
            );
        });

        it("allows OWNER to delete service location", async () => {
            registerUser("user_owner");
            registerMember("user_owner", WS_ID_1, "OWNER");
            loginAs("user_owner");

            const deleted = await deleteServiceLocation(WS_ID_1, "cust_1", "loc_1");
            expect(deleted.id).toBe("loc_1");
            expect(locationsList).toHaveLength(0);
        });

        it("allows ADMIN to delete service location", async () => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            const deleted = await deleteServiceLocation(WS_ID_1, "cust_1", "loc_1");
            expect(deleted.id).toBe("loc_1");
            expect(locationsList).toHaveLength(0);
        });

        it("rejects MANAGER with ForbiddenError (lacks customers.delete permission)", async () => {
            registerUser("user_mgr");
            registerMember("user_mgr", WS_ID_1, "MANAGER");
            loginAs("user_mgr");

            await expect(deleteServiceLocation(WS_ID_1, "cust_1", "loc_1")).rejects.toThrow(
                ForbiddenError
            );
            expect(locationsList).toHaveLength(1);
        });

        it("rejects DISPATCHER with ForbiddenError", async () => {
            registerUser("user_disp");
            registerMember("user_disp", WS_ID_1, "DISPATCHER");
            loginAs("user_disp");

            await expect(deleteServiceLocation(WS_ID_1, "cust_1", "loc_1")).rejects.toThrow(
                ForbiddenError
            );
        });

        it("rejects TECHNICIAN with ForbiddenError", async () => {
            registerUser("user_tech");
            registerMember("user_tech", WS_ID_1, "TECHNICIAN");
            loginAs("user_tech");

            await expect(deleteServiceLocation(WS_ID_1, "cust_1", "loc_1")).rejects.toThrow(
                ForbiddenError
            );
        });

        it("rejects ACCOUNTANT with ForbiddenError", async () => {
            registerUser("user_acct");
            registerMember("user_acct", WS_ID_1, "ACCOUNTANT");
            loginAs("user_acct");

            await expect(deleteServiceLocation(WS_ID_1, "cust_1", "loc_1")).rejects.toThrow(
                ForbiddenError
            );
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

            seedLocation("loc_ws1", "cust_ws1", "Location WS1");
            seedLocation("loc_ws2", "cust_ws2", "Location WS2");
        });

        it("allows deletion when customer and location belong to authorized workspace", async () => {
            const deleted = await deleteServiceLocation(WS_ID_1, "cust_ws1", "loc_ws1");
            expect(deleted.id).toBe("loc_ws1");
            expect(locationsList.find((l) => l.id === "loc_ws1")).toBeUndefined();
        });

        it("rejects deleting location for customer in another workspace with CustomerNotFoundError", async () => {
            await expect(deleteServiceLocation(WS_ID_1, "cust_ws2", "loc_ws2")).rejects.toThrow(
                CustomerNotFoundError
            );
            expect(locationsList.find((l) => l.id === "loc_ws2")).toBeDefined();
        });

        it("rejects deleting location using mismatched customerId with ServiceLocationNotFoundError", async () => {
            await expect(deleteServiceLocation(WS_ID_1, "cust_ws1_alt", "loc_ws1")).rejects.toThrow(
                ServiceLocationNotFoundError
            );
            expect(locationsList.find((l) => l.id === "loc_ws1")).toBeDefined();
        });
    });

    describe("3. Customer Lifecycle Rule (ACTIVE vs INACTIVE)", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");
        });

        it("allows location deletion for an ACTIVE customer", async () => {
            seedCustomer("cust_act", WS_ID_1, "Active Customer", "ACTIVE");
            seedLocation("loc_act", "cust_act", "Active Location");

            const deleted = await deleteServiceLocation(WS_ID_1, "cust_act", "loc_act");
            expect(deleted.id).toBe("loc_act");
        });

        it("rejects location deletion for an INACTIVE customer with InactiveCustomerError", async () => {
            seedCustomer("cust_inact", WS_ID_1, "Inactive Customer", "INACTIVE");
            seedLocation("loc_inact", "cust_inact", "Inactive Location");

            await expect(deleteServiceLocation(WS_ID_1, "cust_inact", "loc_inact")).rejects.toThrow(
                InactiveCustomerError
            );
            expect(locationsList).toHaveLength(1);
        });
    });

    describe("4. Primary Location Deletion Policy & Invariants", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Client Corp");
        });

        it("deleting a primary location succeeds and leaves zero primary locations without promoting others", async () => {
            seedLocation("loc_prim", "cust_1", "Primary HQ", true);
            seedLocation("loc_sec1", "cust_1", "Secondary Depot 1", false);
            seedLocation("loc_sec2", "cust_1", "Secondary Depot 2", false);

            const deleted = await deleteServiceLocation(WS_ID_1, "cust_1", "loc_prim");
            expect(deleted.id).toBe("loc_prim");
            expect(deleted.isPrimary).toBe(true);

            expect(locationsList).toHaveLength(2);
            expect(locationsList.every((l) => l.isPrimary === false)).toBe(true);
        });

        it("deleting the only location of a customer succeeds", async () => {
            seedLocation("loc_solo", "cust_1", "Solo Site", false);

            const deleted = await deleteServiceLocation(WS_ID_1, "cust_1", "loc_solo");
            expect(deleted.id).toBe("loc_solo");
            expect(locationsList).toHaveLength(0);
        });
    });

    describe("5. Error Handling & Database Constraints", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ID_1, "ADMIN");
            loginAs("user_admin");

            seedCustomer("cust_1", WS_ID_1, "Client Corp");
        });

        it("throws ServiceLocationNotFoundError when location does not exist", async () => {
            await expect(
                deleteServiceLocation(WS_ID_1, "cust_1", "loc_nonexistent")
            ).rejects.toThrow(ServiceLocationNotFoundError);
        });

        it("translates Prisma P2025 into ServiceLocationNotFoundError", async () => {
            seedLocation("loc_1", "cust_1", "Austin Hub");

            mocks.serviceLocationDelete.mockRejectedValueOnce(
                Object.assign(new Error("Record to delete does not exist"), { code: "P2025" })
            );

            await expect(deleteServiceLocation(WS_ID_1, "cust_1", "loc_1")).rejects.toThrow(
                ServiceLocationNotFoundError
            );
        });

        it("translates Prisma P2003 (foreign key / protected references) into ServiceLocationDeletionNotAllowedError", async () => {
            seedLocation("loc_1", "cust_1", "Austin Hub");

            mocks.serviceLocationDelete.mockRejectedValueOnce(
                Object.assign(new Error("Foreign key constraint failed"), { code: "P2003" })
            );

            await expect(deleteServiceLocation(WS_ID_1, "cust_1", "loc_1")).rejects.toThrow(
                ServiceLocationDeletionNotAllowedError
            );
        });

        it("masks unexpected database errors into ServiceLocationDeletionError", async () => {
            seedLocation("loc_1", "cust_1", "Austin Hub");

            mocks.serviceLocationDelete.mockRejectedValueOnce(new Error("Disk I/O error"));

            await expect(deleteServiceLocation(WS_ID_1, "cust_1", "loc_1")).rejects.toThrow(
                ServiceLocationDeletionError
            );
        });
    });
});
