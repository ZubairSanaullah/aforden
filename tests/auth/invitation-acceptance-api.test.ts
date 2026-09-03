import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    prisma: {
        user: {
            findUnique: vi.fn(),
        },
        workspaceInvitation: {
            findUnique: vi.fn(),
            update: vi.fn(),
        },
        workspaceMember: {
            findUnique: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
        },
        $transaction: vi.fn(),
    },
    acceptInvitation: vi.fn(),
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: mocks.prisma,
}));

vi.mock("@/lib/services/invitation/acceptInvitation", () => ({
    acceptInvitation: mocks.acceptInvitation,
}));

import { POST as acceptInvitationRoute } from "@/app/api/invitations/accept/route";
import {
    acceptInvitationSchema,
    createInvitationSchema,
    INVITABLE_ROLES,
} from "@/lib/validations/invitation";
import {
    InvitationNotFoundError,
    InvitationExpiredError,
    InvitationAlreadyAcceptedError,
    InvitationRevokedError,
    InvitationEmailMismatchError,
    InvitationAlreadyMemberError,
    InvitationRateLimitError,
} from "@/lib/services/invitation/invitationErrors";

describe("Phase 1.21.2 — Invitation Acceptance API & Validation Hardening", () => {
    const validRawToken = "a".repeat(64);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("1. Validation Schemas (`lib/validations/invitation.ts`)", () => {
        it("accepts exactly 64-character hexadecimal tokens", () => {
            const validTokens = [
                "a".repeat(64),
                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                `  ${"f".repeat(64)}  `, // handles trim
            ];

            for (const token of validTokens) {
                const result = acceptInvitationSchema.safeParse({ token });
                expect(result.success).toBe(true);
                if (result.success) {
                    expect(result.data.token).toBe(token.trim());
                }
            }
        });

        it("rejects invalid, short, long, or non-hex tokens", () => {
            const invalidTokens = [
                "",
                "abc",
                "a".repeat(63), // too short
                "a".repeat(65), // too long
                "z".repeat(64), // non-hex
                "g".repeat(64), // non-hex
                "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF", // uppercase rejected by /^[a-f0-9]{64}$/
            ];

            for (const token of invalidTokens) {
                const result = acceptInvitationSchema.safeParse({ token });
                expect(result.success).toBe(false);
            }
        });

        it("validates createInvitationSchema email normalization and role constraints", () => {
            const valid = createInvitationSchema.safeParse({
                email: "  Tech.User@Example.COM  ",
                role: "TECHNICIAN",
            });
            expect(valid.success).toBe(true);
            if (valid.success) {
                expect(valid.data.email).toBe("tech.user@example.com");
                expect(valid.data.role).toBe("TECHNICIAN");
            }

            for (const role of INVITABLE_ROLES) {
                const r = createInvitationSchema.safeParse({
                    email: "test@example.com",
                    role,
                });
                expect(r.success).toBe(true);
            }

            // OWNER cannot be invited
            const ownerResult = createInvitationSchema.safeParse({
                email: "owner@example.com",
                role: "OWNER",
            });
            expect(ownerResult.success).toBe(false);
        });
    });

    describe("2. Route Handler (`app/api/invitations/accept/route.ts`)", () => {
        function makeRequest(body: any, headers: Record<string, string> = {}) {
            return new Request("http://localhost:3000/api/invitations/accept", {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    ...headers,
                },
                body: body !== undefined ? JSON.stringify(body) : undefined,
            });
        }

        it("returns 400 when request body is missing or null", async () => {
            const req = new Request("http://localhost:3000/api/invitations/accept", {
                method: "POST",
            });
            const res = await acceptInvitationRoute(req);
            expect(res.status).toBe(400);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("INVALID_REQUEST");
        });

        it("returns 422 when token format fails validation constraints", async () => {
            const req = makeRequest({ token: "not-a-valid-hex-token" });
            const res = await acceptInvitationRoute(req);
            expect(res.status).toBe(422);

            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("VALIDATION_ERROR");
            expect(json.error.fields).toHaveProperty("token");
        });

        it("processes unauthenticated flow and returns 202 with membershipCreated: false", async () => {
            mocks.auth.mockResolvedValue(null);
            mocks.acceptInvitation.mockResolvedValue({
                membershipCreated: false,
                invitation: {
                    id: "inv_123",
                    workspaceId: "ws_456",
                    email: "invited@example.com",
                    role: "TECHNICIAN",
                },
            });

            const req = makeRequest({ token: validRawToken }, { "x-forwarded-for": "203.0.113.195, 10.0.0.1" });
            const res = await acceptInvitationRoute(req);
            expect(res.status).toBe(202);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.membershipCreated).toBe(false);
            expect(json.invitation.email).toBe("invited@example.com");

            expect(mocks.acceptInvitation).toHaveBeenCalledWith({
                rawToken: validRawToken,
                authenticatedUserId: undefined,
                authenticatedUserEmail: undefined,
                ipAddress: "203.0.113.195",
            });
        });

        it("processes authenticated flow for active verified user and returns 200 with membershipCreated: true", async () => {
            mocks.auth.mockResolvedValue({
                user: { id: "user_789" },
            });
            mocks.prisma.user.findUnique.mockResolvedValue({
                id: "user_789",
                email: "member@example.com",
                status: "ACTIVE",
                emailVerified: new Date(),
            });
            mocks.acceptInvitation.mockResolvedValue({
                membershipCreated: true,
                membershipId: "mem_abc",
                invitation: {
                    id: "inv_123",
                    workspaceId: "ws_456",
                    email: "member@example.com",
                    role: "ADMIN",
                },
            });

            const req = makeRequest({ token: validRawToken }, { "x-real-ip": "198.51.100.42" });
            const res = await acceptInvitationRoute(req);
            expect(res.status).toBe(200);

            const json = await res.json();
            expect(json.success).toBe(true);
            expect(json.membershipCreated).toBe(true);
            expect(json.membershipId).toBe("mem_abc");

            expect(mocks.acceptInvitation).toHaveBeenCalledWith({
                rawToken: validRawToken,
                authenticatedUserId: "user_789",
                authenticatedUserEmail: "member@example.com",
                ipAddress: "198.51.100.42",
            });
        });

        it("ignores unverified or non-active session user and falls back to unauthenticated validation flow", async () => {
            mocks.auth.mockResolvedValue({
                user: { id: "user_unverified" },
            });
            mocks.prisma.user.findUnique.mockResolvedValue({
                id: "user_unverified",
                email: "unverified@example.com",
                status: "ACTIVE",
                emailVerified: null, // unverified!
            });
            mocks.acceptInvitation.mockResolvedValue({
                membershipCreated: false,
                invitation: {
                    id: "inv_123",
                    workspaceId: "ws_456",
                    email: "unverified@example.com",
                    role: "MANAGER",
                },
            });

            const req = makeRequest({ token: validRawToken });
            const res = await acceptInvitationRoute(req);
            expect(res.status).toBe(202);

            expect(mocks.acceptInvitation).toHaveBeenCalledWith({
                rawToken: validRawToken,
                authenticatedUserId: undefined,
                authenticatedUserEmail: undefined,
                ipAddress: "unknown",
            });
        });

        it("returns 429 RATE_LIMITED with Retry-After header on InvitationRateLimitError", async () => {
            mocks.auth.mockResolvedValue(null);
            mocks.acceptInvitation.mockRejectedValue(new InvitationRateLimitError(60));

            const req = makeRequest({ token: validRawToken });
            const res = await acceptInvitationRoute(req);
            expect(res.status).toBe(429);
            expect(res.headers.get("Retry-After")).toBe("60");

            const json = await res.json();
            expect(json.error.code).toBe("RATE_LIMITED");
        });

        it("returns 404 INVITATION_INVALID on InvitationNotFoundError and InvitationExpiredError", async () => {
            mocks.auth.mockResolvedValue(null);
            mocks.acceptInvitation.mockRejectedValueOnce(new InvitationNotFoundError());

            let res = await acceptInvitationRoute(makeRequest({ token: validRawToken }));
            expect(res.status).toBe(404);
            let json = await res.json();
            expect(json.error.code).toBe("INVITATION_INVALID");

            mocks.acceptInvitation.mockRejectedValueOnce(new InvitationExpiredError());
            res = await acceptInvitationRoute(makeRequest({ token: validRawToken }));
            expect(res.status).toBe(404);
            json = await res.json();
            expect(json.error.code).toBe("INVITATION_INVALID");
        });

        it("returns 409 ALREADY_ACCEPTED on InvitationAlreadyAcceptedError", async () => {
            mocks.auth.mockResolvedValue(null);
            mocks.acceptInvitation.mockRejectedValue(new InvitationAlreadyAcceptedError());

            const res = await acceptInvitationRoute(makeRequest({ token: validRawToken }));
            expect(res.status).toBe(409);

            const json = await res.json();
            expect(json.error.code).toBe("ALREADY_ACCEPTED");
        });

        it("returns 410 INVITATION_CANCELLED on InvitationRevokedError", async () => {
            mocks.auth.mockResolvedValue(null);
            mocks.acceptInvitation.mockRejectedValue(new InvitationRevokedError());

            const res = await acceptInvitationRoute(makeRequest({ token: validRawToken }));
            expect(res.status).toBe(410);

            const json = await res.json();
            expect(json.error.code).toBe("INVITATION_CANCELLED");
        });

        it("returns 403 EMAIL_MISMATCH on InvitationEmailMismatchError", async () => {
            mocks.auth.mockResolvedValue(null);
            mocks.acceptInvitation.mockRejectedValue(new InvitationEmailMismatchError());

            const res = await acceptInvitationRoute(makeRequest({ token: validRawToken }));
            expect(res.status).toBe(403);

            const json = await res.json();
            expect(json.error.code).toBe("EMAIL_MISMATCH");
        });

        it("returns 409 ALREADY_MEMBER on InvitationAlreadyMemberError", async () => {
            mocks.auth.mockResolvedValue(null);
            mocks.acceptInvitation.mockRejectedValue(new InvitationAlreadyMemberError());

            const res = await acceptInvitationRoute(makeRequest({ token: validRawToken }));
            expect(res.status).toBe(409);

            const json = await res.json();
            expect(json.error.code).toBe("ALREADY_MEMBER");
        });

        it("returns 500 INTERNAL_SERVER_ERROR on unhandled unexpected exception", async () => {
            mocks.auth.mockResolvedValue(null);
            mocks.acceptInvitation.mockRejectedValue(new Error("Database connection lost"));

            const res = await acceptInvitationRoute(makeRequest({ token: validRawToken }));
            expect(res.status).toBe(500);

            const json = await res.json();
            expect(json.error.code).toBe("INTERNAL_SERVER_ERROR");
        });
    });
});
