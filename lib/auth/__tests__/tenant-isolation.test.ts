import { describe, expect, it } from "vitest";

import {
    SECURITY_RULES,
} from "@/lib/auth/security";

import {
    workspaceScope,
} from "@/lib/auth/tenant";

describe("Aforden Tenant Isolation Rules", () => {
    it("requires workspace scoping", () => {
        expect(
            SECURITY_RULES.REQUIRE_WORKSPACE_SCOPE,
        ).toBe(true);
    });

    it("requires active membership", () => {
        expect(
            SECURITY_RULES.REQUIRE_ACTIVE_MEMBERSHIP,
        ).toBe(true);
    });

    it("never trusts client user IDs", () => {
        expect(
            SECURITY_RULES.NEVER_TRUST_CLIENT_USER_ID,
        ).toBe(true);
    });

    it("never trusts client roles", () => {
        expect(
            SECURITY_RULES.NEVER_TRUST_CLIENT_ROLE,
        ).toBe(true);
    });

    it("requires server-side authorization", () => {
        expect(
            SECURITY_RULES.REQUIRE_SERVER_SIDE_AUTHORIZATION,
        ).toBe(true);
    });

    it("hides authorization details", () => {
        expect(
            SECURITY_RULES.HIDE_AUTHORIZATION_DETAILS,
        ).toBe(true);
    });
});

describe("Aforden Workspace Scope", () => {
    it("creates a workspace-scoped Prisma condition", () => {
        expect(
            workspaceScope("workspace-a"),
        ).toEqual({
            workspaceId: "workspace-a",
        });
    });

    it("does not include a user ID in the workspace scope", () => {
        const scope = workspaceScope("workspace-a");

        expect(scope).not.toHaveProperty("userId");
    });

    it("does not include a role in the workspace scope", () => {
        const scope = workspaceScope("workspace-a");

        expect(scope).not.toHaveProperty("role");
    });
});