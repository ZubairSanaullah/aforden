import { describe, expect, it } from "vitest";

import {
    ALL_PERMISSIONS,
    hasDuplicatePermissions,
    isPermission,
    PERMISSIONS,
} from "@/lib/auth/permissions";

import {
    getRolePermissions,
    roleHasPermission,
} from "@/lib/auth/roles";

describe("Aforden RBAC Permission Registry", () => {
    it("contains all expected customer permissions", () => {
        expect(ALL_PERMISSIONS).toContain(
            PERMISSIONS.CUSTOMERS_VIEW,
        );

        expect(ALL_PERMISSIONS).toContain(
            PERMISSIONS.CUSTOMERS_CREATE,
        );

        expect(ALL_PERMISSIONS).toContain(
            PERMISSIONS.CUSTOMERS_UPDATE,
        );

        expect(ALL_PERMISSIONS).toContain(
            PERMISSIONS.CUSTOMERS_DELETE,
        );
    });

    it("contains all expected work order permissions", () => {
        expect(ALL_PERMISSIONS).toContain(
            PERMISSIONS.WORK_ORDERS_VIEW,
        );

        expect(ALL_PERMISSIONS).toContain(
            PERMISSIONS.WORK_ORDERS_CREATE,
        );

        expect(ALL_PERMISSIONS).toContain(
            PERMISSIONS.WORK_ORDERS_UPDATE,
        );

        expect(ALL_PERMISSIONS).toContain(
            PERMISSIONS.WORK_ORDERS_ASSIGN,
        );

        expect(ALL_PERMISSIONS).toContain(
            PERMISSIONS.WORK_ORDERS_COMPLETE,
        );
    });

    it("contains all expected scheduler permissions", () => {
        expect(ALL_PERMISSIONS).toContain(
            PERMISSIONS.SCHEDULER_VIEW,
        );

        expect(ALL_PERMISSIONS).toContain(
            PERMISSIONS.SCHEDULER_CREATE,
        );

        expect(ALL_PERMISSIONS).toContain(
            PERMISSIONS.SCHEDULER_UPDATE,
        );

        expect(ALL_PERMISSIONS).toContain(
            PERMISSIONS.SCHEDULER_DELETE,
        );
    });

    it("contains all expected member permissions", () => {
        expect(ALL_PERMISSIONS).toContain(
            PERMISSIONS.MEMBERS_VIEW,
        );

        expect(ALL_PERMISSIONS).toContain(
            PERMISSIONS.MEMBERS_INVITE,
        );

        expect(ALL_PERMISSIONS).toContain(
            PERMISSIONS.MEMBERS_UPDATE,
        );

        expect(ALL_PERMISSIONS).toContain(
            PERMISSIONS.MEMBERS_REMOVE,
        );
    });

    it("contains all expected settings permissions", () => {
        expect(ALL_PERMISSIONS).toContain(
            PERMISSIONS.SETTINGS_VIEW,
        );

        expect(ALL_PERMISSIONS).toContain(
            PERMISSIONS.SETTINGS_UPDATE,
        );
    });

    it("contains all expected billing permissions", () => {
        expect(ALL_PERMISSIONS).toContain(
            PERMISSIONS.BILLING_VIEW,
        );

        expect(ALL_PERMISSIONS).toContain(
            PERMISSIONS.BILLING_MANAGE,
        );
    });

    it("recognizes valid permissions", () => {
        expect(
            isPermission(PERMISSIONS.CUSTOMERS_VIEW),
        ).toBe(true);

        expect(
            isPermission(PERMISSIONS.WORK_ORDERS_ASSIGN),
        ).toBe(true);
    });

    it("rejects unknown permissions", () => {
        expect(
            isPermission("customers.invalid"),
        ).toBe(false);

        expect(
            isPermission("admin.everything"),
        ).toBe(false);
    });
});

describe("Aforden OWNER permissions", () => {
    it("grants OWNER every registered permission", () => {
        const permissions = getRolePermissions("OWNER");

        for (const permission of ALL_PERMISSIONS) {
            expect(permissions).toContain(permission);
        }
    });

    it("allows OWNER to manage members", () => {
        expect(
            roleHasPermission(
                "OWNER",
                PERMISSIONS.MEMBERS_REMOVE,
            ),
        ).toBe(true);
    });

    it("allows OWNER to manage billing", () => {
        expect(
            roleHasPermission(
                "OWNER",
                PERMISSIONS.BILLING_MANAGE,
            ),
        ).toBe(true);
    });
});

describe("Aforden ADMIN permissions", () => {
    it("allows ADMIN to manage customers", () => {
        expect(
            roleHasPermission(
                "ADMIN",
                PERMISSIONS.CUSTOMERS_CREATE,
            ),
        ).toBe(true);

        expect(
            roleHasPermission(
                "ADMIN",
                PERMISSIONS.CUSTOMERS_DELETE,
            ),
        ).toBe(true);
    });

    it("allows ADMIN to manage members", () => {
        expect(
            roleHasPermission(
                "ADMIN",
                PERMISSIONS.MEMBERS_INVITE,
            ),
        ).toBe(true);

        expect(
            roleHasPermission(
                "ADMIN",
                PERMISSIONS.MEMBERS_REMOVE,
            ),
        ).toBe(true);
    });

    it("allows ADMIN to manage billing", () => {
        expect(
            roleHasPermission(
                "ADMIN",
                PERMISSIONS.BILLING_MANAGE,
            ),
        ).toBe(true);
    });
});

describe("Aforden MANAGER permissions", () => {
    it("allows MANAGER to manage work orders", () => {
        expect(
            roleHasPermission(
                "MANAGER",
                PERMISSIONS.WORK_ORDERS_CREATE,
            ),
        ).toBe(true);

        expect(
            roleHasPermission(
                "MANAGER",
                PERMISSIONS.WORK_ORDERS_ASSIGN,
            ),
        ).toBe(true);

        expect(
            roleHasPermission(
                "MANAGER",
                PERMISSIONS.WORK_ORDERS_COMPLETE,
            ),
        ).toBe(true);
    });

    it("does not allow MANAGER to manage members", () => {
        expect(
            roleHasPermission(
                "MANAGER",
                PERMISSIONS.MEMBERS_INVITE,
            ),
        ).toBe(false);

        expect(
            roleHasPermission(
                "MANAGER",
                PERMISSIONS.MEMBERS_REMOVE,
            ),
        ).toBe(false);
    });

    it("does not allow MANAGER to manage billing", () => {
        expect(
            roleHasPermission(
                "MANAGER",
                PERMISSIONS.BILLING_MANAGE,
            ),
        ).toBe(false);
    });
});

describe("Aforden DISPATCHER permissions", () => {
    it("allows DISPATCHER to manage scheduling", () => {
        expect(
            roleHasPermission(
                "DISPATCHER",
                PERMISSIONS.SCHEDULER_CREATE,
            ),
        ).toBe(true);

        expect(
            roleHasPermission(
                "DISPATCHER",
                PERMISSIONS.SCHEDULER_UPDATE,
            ),
        ).toBe(true);

        expect(
            roleHasPermission(
                "DISPATCHER",
                PERMISSIONS.SCHEDULER_DELETE,
            ),
        ).toBe(true);
    });

    it("allows DISPATCHER to assign work orders", () => {
        expect(
            roleHasPermission(
                "DISPATCHER",
                PERMISSIONS.WORK_ORDERS_ASSIGN,
            ),
        ).toBe(true);
    });

    it("does not allow DISPATCHER to manage members", () => {
        expect(
            roleHasPermission(
                "DISPATCHER",
                PERMISSIONS.MEMBERS_INVITE,
            ),
        ).toBe(false);
    });

    it("does not allow DISPATCHER to manage billing", () => {
        expect(
            roleHasPermission(
                "DISPATCHER",
                PERMISSIONS.BILLING_MANAGE,
            ),
        ).toBe(false);
    });
});

describe("Aforden TECHNICIAN permissions", () => {
    it("allows TECHNICIAN to view customers", () => {
        expect(
            roleHasPermission(
                "TECHNICIAN",
                PERMISSIONS.CUSTOMERS_VIEW,
            ),
        ).toBe(true);
    });

    it("allows TECHNICIAN to update work orders", () => {
        expect(
            roleHasPermission(
                "TECHNICIAN",
                PERMISSIONS.WORK_ORDERS_UPDATE,
            ),
        ).toBe(true);
    });

    it("allows TECHNICIAN to complete work orders", () => {
        expect(
            roleHasPermission(
                "TECHNICIAN",
                PERMISSIONS.WORK_ORDERS_COMPLETE,
            ),
        ).toBe(true);
    });

    it("does not allow TECHNICIAN to assign work orders", () => {
        expect(
            roleHasPermission(
                "TECHNICIAN",
                PERMISSIONS.WORK_ORDERS_ASSIGN,
            ),
        ).toBe(false);
    });

    it("does not allow TECHNICIAN to manage members", () => {
        expect(
            roleHasPermission(
                "TECHNICIAN",
                PERMISSIONS.MEMBERS_INVITE,
            ),
        ).toBe(false);
    });

    it("does not allow TECHNICIAN to manage settings", () => {
        expect(
            roleHasPermission(
                "TECHNICIAN",
                PERMISSIONS.SETTINGS_UPDATE,
            ),
        ).toBe(false);
    });

    it("does not allow TECHNICIAN to manage billing", () => {
        expect(
            roleHasPermission(
                "TECHNICIAN",
                PERMISSIONS.BILLING_MANAGE,
            ),
        ).toBe(false);
    });
});

describe("Aforden ACCOUNTANT permissions", () => {
    it("allows ACCOUNTANT to view customers", () => {
        expect(
            roleHasPermission(
                "ACCOUNTANT",
                PERMISSIONS.CUSTOMERS_VIEW,
            ),
        ).toBe(true);
    });

    it("allows ACCOUNTANT to view billing", () => {
        expect(
            roleHasPermission(
                "ACCOUNTANT",
                PERMISSIONS.BILLING_VIEW,
            ),
        ).toBe(true);
    });

    it("allows ACCOUNTANT to manage billing", () => {
        expect(
            roleHasPermission(
                "ACCOUNTANT",
                PERMISSIONS.BILLING_MANAGE,
            ),
        ).toBe(true);
    });

    it("does not allow ACCOUNTANT to manage members", () => {
        expect(
            roleHasPermission(
                "ACCOUNTANT",
                PERMISSIONS.MEMBERS_REMOVE,
            ),
        ).toBe(false);
    });

    it("does not allow ACCOUNTANT to manage work orders", () => {
        expect(
            roleHasPermission(
                "ACCOUNTANT",
                PERMISSIONS.WORK_ORDERS_UPDATE,
            ),
        ).toBe(false);
    });
});

describe("Aforden RBAC Security Integrity", () => {
    it("does not contain duplicate permissions", () => {
        expect(
            hasDuplicatePermissions(),
        ).toBe(false);
    });

    it("contains no empty permission values", () => {
        for (const permission of ALL_PERMISSIONS) {
            expect(permission.length).toBeGreaterThan(0);
        }
    });

    it("uses resource.action permission naming", () => {
        for (const permission of ALL_PERMISSIONS) {
            expect(permission).toMatch(
                /^[a-z_]+\.[a-z_]+$/,
            );
        }
    });

    it("does not recognize arbitrary permission strings", () => {
        const invalidPermissions = [
            "",
            "admin",
            "owner",
            "customers",
            "customers.*",
            "*",
            "all.permissions",
            "workspace.owner",
        ];

        for (const permission of invalidPermissions) {
            expect(
                isPermission(permission),
            ).toBe(false);
        }
    });

    it("does not grant technician administrative permissions", () => {
        expect(
            roleHasPermission(
                "TECHNICIAN",
                PERMISSIONS.MEMBERS_REMOVE,
            ),
        ).toBe(false);

        expect(
            roleHasPermission(
                "TECHNICIAN",
                PERMISSIONS.SETTINGS_UPDATE,
            ),
        ).toBe(false);

        expect(
            roleHasPermission(
                "TECHNICIAN",
                PERMISSIONS.BILLING_MANAGE,
            ),
        ).toBe(false);
    });

    it("does not grant accountant operational permissions", () => {
        expect(
            roleHasPermission(
                "ACCOUNTANT",
                PERMISSIONS.WORK_ORDERS_ASSIGN,
            ),
        ).toBe(false);

        expect(
            roleHasPermission(
                "ACCOUNTANT",
                PERMISSIONS.SCHEDULER_UPDATE,
            ),
        ).toBe(false);
    });
});