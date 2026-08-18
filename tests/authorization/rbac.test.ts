import { describe, expect, it } from "vitest";

import {
    PERMISSIONS,
} from "../../lib/services/authorization/permissions";

import {
    ROLE_PERMISSIONS,
} from "../../lib/services/authorization/rolePermissions";

import {
    roleHasPermission,
} from "../../lib/services/authorization/permissionService";

const roles = [
    "OWNER",
    "ADMIN",
    "MANAGER",
    "DISPATCHER",
    "TECHNICIAN",
    "ACCOUNTANT",
] as const;

describe("Aforden RBAC permission matrix", () => {
    it("defines permissions for every workspace role", () => {
        for (const role of roles) {
            expect(
                ROLE_PERMISSIONS[role]
            ).toBeDefined();

            expect(
                Array.isArray(
                    ROLE_PERMISSIONS[role]
                )
            ).toBe(true);
        }
    });

    it("OWNER has every permission", () => {
        const permissions =
            Object.values(PERMISSIONS);

        for (const permission of permissions) {
            expect(
                roleHasPermission(
                    "OWNER",
                    permission
                )
            ).toBe(true);
        }
    });

    it("ADMIN has customer permissions", () => {
        expect(
            roleHasPermission(
                "ADMIN",
                PERMISSIONS.CUSTOMERS_VIEW
            )
        ).toBe(true);

        expect(
            roleHasPermission(
                "ADMIN",
                PERMISSIONS.CUSTOMERS_CREATE
            )
        ).toBe(true);

        expect(
            roleHasPermission(
                "ADMIN",
                PERMISSIONS.CUSTOMERS_UPDATE
            )
        ).toBe(true);

        expect(
            roleHasPermission(
                "ADMIN",
                PERMISSIONS.CUSTOMERS_DELETE
            )
        ).toBe(true);
    });

    it("MANAGER cannot manage billing", () => {
        expect(
            roleHasPermission(
                "MANAGER",
                PERMISSIONS.BILLING_MANAGE
            )
        ).toBe(false);
    });

    it("DISPATCHER can assign work orders", () => {
        expect(
            roleHasPermission(
                "DISPATCHER",
                PERMISSIONS.WORK_ORDERS_ASSIGN
            )
        ).toBe(true);
    });

    it("DISPATCHER cannot manage billing", () => {
        expect(
            roleHasPermission(
                "DISPATCHER",
                PERMISSIONS.BILLING_MANAGE
            )
        ).toBe(false);
    });

    it("TECHNICIAN can complete work orders", () => {
        expect(
            roleHasPermission(
                "TECHNICIAN",
                PERMISSIONS.WORK_ORDERS_COMPLETE
            )
        ).toBe(true);
    });

    it("TECHNICIAN cannot assign work orders", () => {
        expect(
            roleHasPermission(
                "TECHNICIAN",
                PERMISSIONS.WORK_ORDERS_ASSIGN
            )
        ).toBe(false);
    });

    it("TECHNICIAN cannot manage members", () => {
        expect(
            roleHasPermission(
                "TECHNICIAN",
                PERMISSIONS.MEMBERS_UPDATE
            )
        ).toBe(false);
    });

    it("ACCOUNTANT can manage billing", () => {
        expect(
            roleHasPermission(
                "ACCOUNTANT",
                PERMISSIONS.BILLING_MANAGE
            )
        ).toBe(true);
    });

    it("ACCOUNTANT cannot manage work orders", () => {
        expect(
            roleHasPermission(
                "ACCOUNTANT",
                PERMISSIONS.WORK_ORDERS_UPDATE
            )
        ).toBe(false);
    });
});