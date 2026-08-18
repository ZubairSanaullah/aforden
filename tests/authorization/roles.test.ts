import { describe, expect, it } from "vitest";

import {
    roleHasMinimumLevel,
    roleIsHigherThan,
} from "../../lib/services/authorization/roleHierarchy";

describe("Aforden role hierarchy", () => {
    it("OWNER satisfies every minimum role", () => {
        expect(
            roleHasMinimumLevel(
                "OWNER",
                "OWNER"
            )
        ).toBe(true);

        expect(
            roleHasMinimumLevel(
                "OWNER",
                "ADMIN"
            )
        ).toBe(true);

        expect(
            roleHasMinimumLevel(
                "OWNER",
                "MANAGER"
            )
        ).toBe(true);

        expect(
            roleHasMinimumLevel(
                "OWNER",
                "TECHNICIAN"
            )
        ).toBe(true);
    });

    it("ADMIN is higher than MANAGER", () => {
        expect(
            roleIsHigherThan(
                "ADMIN",
                "MANAGER"
            )
        ).toBe(true);
    });

    it("MANAGER is higher than TECHNICIAN", () => {
        expect(
            roleIsHigherThan(
                "MANAGER",
                "TECHNICIAN"
            )
        ).toBe(true);
    });

    it("TECHNICIAN is not higher than ADMIN", () => {
        expect(
            roleIsHigherThan(
                "TECHNICIAN",
                "ADMIN"
            )
        ).toBe(false);
    });

    it("a role is not higher than itself", () => {
        expect(
            roleIsHigherThan(
                "ADMIN",
                "ADMIN"
            )
        ).toBe(false);
    });
});