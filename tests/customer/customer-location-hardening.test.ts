import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    userFindUnique: vi.fn(),
    workspaceFindUnique: vi.fn(),
    workspaceMemberFindUnique: vi.fn(),
    customerFindFirst: vi.fn(),
    customerUpdate: vi.fn(),
    customerDelete: vi.fn(),
    customerContactFindFirst: vi.fn(),
    customerContactCreate: vi.fn(),
    customerContactUpdate: vi.fn(),
    customerContactDelete: vi.fn(),
    serviceLocationFindFirst: vi.fn(),
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
            update: mocks.customerUpdate,
            delete: mocks.customerDelete,
        },
        customerContact: {
            findFirst: mocks.customerContactFindFirst,
            create: mocks.customerContactCreate,
            update: mocks.customerContactUpdate,
            delete: mocks.customerContactDelete,
        },
        serviceLocation: {
            findFirst: mocks.serviceLocationFindFirst,
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
import {
    CustomerNotFoundError,
    CustomerContactNotFoundError,
    ServiceLocationNotFoundError,
    CustomerContactPrimaryExistsError,
    ServiceLocationPrimaryExistsError,
    CustomerContactDeletionNotAllowedError,
    ServiceLocationDeletionNotAllowedError,
    CustomerContactUpdateError,
    ServiceLocationUpdateError,
} from "@/lib/services/customer/customerErrors";
import { ForbiddenError } from "@/lib/services/authorization/authorizationErrors";
import type { Customer, CustomerContact, ServiceLocation, User, Workspace, WorkspaceMember } from "@/generated/prisma/client";

describe("Phase 1.4.25 — Customer & Service Location Hardening Suite", () => {
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

    describe("1. IDOR & Parameter Tampering Hardening", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ALPHA, "ADMIN");
            loginAs("user_admin");
        });

        it("fails securely when valid workspaceId + foreign customerId + valid locationId are supplied", async () => {
            // Customer is not in WS_ALPHA
            mocks.customerFindFirst.mockResolvedValueOnce(null);

            await expect(
                getServiceLocationOperationalSummary(WS_ALPHA, "cust_beta", "loc_alpha")
            ).resolves.toBeNull();

            await expect(
                updateServiceLocation(WS_ALPHA, "cust_beta", "loc_alpha", { name: "Tampered" })
            ).rejects.toThrow(CustomerNotFoundError);

            await expect(
                deleteServiceLocation(WS_ALPHA, "cust_beta", "loc_alpha")
            ).rejects.toThrow(CustomerNotFoundError);
        });

        it("fails securely when valid workspaceId + valid customerId + foreign contactId/locationId are supplied", async () => {
            // Customer exists in WS_ALPHA
            mocks.customerFindFirst.mockResolvedValueOnce({
                id: "cust_alpha",
                workspaceId: WS_ALPHA,
                status: "ACTIVE",
            });
            // Contact/Location does not belong to cust_alpha
            mocks.serviceLocationFindFirst.mockResolvedValueOnce(null);

            await expect(
                updateServiceLocation(WS_ALPHA, "cust_alpha", "loc_foreign", { name: "Tampered" })
            ).rejects.toThrow(ServiceLocationNotFoundError);
        });
    });

    describe("2. System Managed Fields Immutability", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ALPHA, "ADMIN");
            loginAs("user_admin");

            mocks.customerFindFirst.mockResolvedValue({
                id: "cust_1",
                workspaceId: WS_ALPHA,
                status: "ACTIVE",
            });
        });

        it("disallows modifying system fields (id, customerId, workspaceId, createdAt, updatedAt) on service locations", async () => {
            mocks.serviceLocationFindFirst.mockResolvedValueOnce({
                id: "loc_1",
                customerId: "cust_1",
                isPrimary: false,
            });

            mocks.serviceLocationUpdate.mockImplementation(async ({ data }: any) => {
                expect(data.id).toBeUndefined();
                expect(data.customerId).toBeUndefined();
                expect(data.workspaceId).toBeUndefined();
                expect(data.createdAt).toBeUndefined();
                expect(data.updatedAt).toBeUndefined();
                return { id: "loc_1", customerId: "cust_1", ...data };
            });

            await updateServiceLocation(WS_ALPHA, "cust_1", "loc_1", {
                name: "Legit Name",
                id: "forged_id",
                customerId: "forged_cust",
                workspaceId: "forged_ws",
                createdAt: new Date(),
            } as any);
        });
    });

    describe("3. Database Error & Foreign Constraint Hardening", () => {
        beforeEach(() => {
            registerUser("user_admin");
            registerMember("user_admin", WS_ALPHA, "ADMIN");
            loginAs("user_admin");

            mocks.customerFindFirst.mockResolvedValue({
                id: "cust_1",
                workspaceId: WS_ALPHA,
                status: "ACTIVE",
            });
        });

        it("translates P2003 foreign key conflict during location deletion to ServiceLocationDeletionNotAllowedError", async () => {
            mocks.serviceLocationFindFirst.mockResolvedValueOnce({
                id: "loc_1",
                customerId: "cust_1",
            });

            mocks.serviceLocationDelete.mockRejectedValueOnce(
                Object.assign(new Error("Foreign key violation"), { code: "P2003" })
            );

            await expect(deleteServiceLocation(WS_ALPHA, "cust_1", "loc_1")).rejects.toThrow(
                ServiceLocationDeletionNotAllowedError
            );
        });

        it("translates P2002 race condition on primary location reassignment to ServiceLocationPrimaryExistsError", async () => {
            mocks.serviceLocationFindFirst.mockResolvedValueOnce({
                id: "loc_2",
                customerId: "cust_1",
                isPrimary: false,
            });

            mocks.transaction.mockRejectedValueOnce(
                Object.assign(new Error("Unique constraint violation"), { code: "P2002" })
            );

            await expect(setPrimaryServiceLocation(WS_ALPHA, "cust_1", "loc_2")).rejects.toThrow(
                ServiceLocationPrimaryExistsError
            );
        });
    });
});

import { getServiceLocationOperationalSummary } from "@/lib/services/customer/getServiceLocationOperationalSummary";
