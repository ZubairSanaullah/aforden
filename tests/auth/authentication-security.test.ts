import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    auth: vi.fn(),
    bcryptHash: vi.fn(async (password: string) => `hashed_${password}`),
    bcryptCompare: vi.fn(async (plain: string, hashed: string) => {
        return hashed === `hashed_${plain}` || hashed === `$2b$12$hashed_${plain}` || hashed === "existing_hash";
    }),
    sendEmail: vi.fn(async () => ({
        success: true,
        messageId: "mock-message-id-123",
    })),
    prisma: {
        user: {
            findUnique: vi.fn(),
            findFirst: vi.fn(),
            create: vi.fn(),
            update: vi.fn(),
            delete: vi.fn(),
        },
        session: {
            findMany: vi.fn(),
            deleteMany: vi.fn(),
        },
        passwordResetToken: {
            findUnique: vi.fn(),
            create: vi.fn(),
            updateMany: vi.fn(),
            delete: vi.fn(),
            deleteMany: vi.fn(),
        },
        verificationToken: {
            findUnique: vi.fn(),
            create: vi.fn(),
            delete: vi.fn(),
            deleteMany: vi.fn(),
        },
        workspace: {
            findUnique: vi.fn(),
            findFirst: vi.fn(),
        },
        workspaceMember: {
            findFirst: vi.fn(),
            findUnique: vi.fn(),
        },
        $transaction: vi.fn(async (arg: unknown) => {
            if (typeof arg === "function") {
                return (arg as (tx: unknown) => unknown)(mocks.prisma);
            }
            if (Array.isArray(arg)) {
                return Promise.all(arg);
            }
            return arg;
        }),
    },
}));

vi.mock("@/auth", () => ({
    auth: mocks.auth,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: mocks.prisma,
}));

vi.mock("bcrypt", () => ({
    default: {
        hash: mocks.bcryptHash,
        compare: mocks.bcryptCompare,
    },
}));

vi.mock("@/lib/services/email/sendEmail", () => ({
    sendEmail: mocks.sendEmail,
}));

// Route Handlers
import { POST as registerRoute } from "@/app/api/auth/register/route";
import { POST as forgotPasswordRoute } from "@/app/api/auth/forgot-password/route";
import { POST as resetPasswordRoute } from "@/app/api/auth/reset-password/route";
import { POST as resendVerificationRoute } from "@/app/api/auth/resend-verification/route";
import { GET as verifyEmailRoute } from "@/app/api/auth/verify-email/route";
import { POST as changePasswordRoute } from "@/app/api/auth/change-password/route";
import { GET as statusRoute } from "@/app/api/auth/status/route";
import { GET as sessionsRoute } from "@/app/api/auth/sessions/route";
import { POST as revokeAllSessionsRoute } from "@/app/api/auth/sessions/revoke-all/route";
import { DELETE as revokeSessionRoute } from "@/app/api/auth/sessions/[sessionId]/route";

// Auth Services
import { requireActiveUser } from "@/lib/services/auth/requireActiveUser";
import { requireAuthenticatedUser } from "@/lib/auth/api";
import {
    getUserSessions,
    revokeSession,
    revokeAllSessions,
} from "@/lib/services/auth/sessionManagement";
import { changePassword } from "@/lib/services/auth/changePassword";
import { registerUser } from "@/lib/services/auth/registerUser";
import { resetPassword } from "@/lib/services/auth/resetPassword";
import {
    checkForgotPasswordRateLimit,
    checkResetPasswordRateLimit,
} from "@/lib/services/auth/passwordRecoveryRateLimit";
import { checkVerificationEmailRateLimit } from "@/lib/services/auth/verificationRateLimit";
import { createPasswordResetToken } from "@/lib/services/auth/passwordResetToken";

// Authorization & RBAC
import {
    requirePermission,
    requireAnyPermission,
    requireAllPermissions,
} from "@/lib/auth/authorization";
import {
    requireWorkspaceAdmin,
    requireWorkspaceOwner,
} from "@/lib/auth/roles-authorization";
import {
    workspaceScope,
} from "@/lib/auth/tenant";
import { authorizationErrorResponse } from "@/lib/auth/api";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { SECURITY_RULES } from "@/lib/auth/security";

// Email Templates
import { createPasswordResetEmail } from "@/lib/services/email/templates/passwordReset";
import { createPasswordChangedEmail } from "@/lib/services/email/templates/passwordChanged";
import { createVerificationEmail } from "@/lib/services/email/templates/verification";

// Validations
import { registerSchema } from "@/lib/validations/auth";

describe("Authentication Security Suite", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        mocks.sendEmail.mockResolvedValue({
            success: true,
            messageId: "mock-message-id-123",
        });

        mocks.bcryptHash.mockImplementation(async (password: string) => `hashed_${password}`);

        mocks.bcryptCompare.mockImplementation(async (plain: string, hashed: string) => {
            return hashed === `hashed_${plain}` || hashed === `$2b$12$hashed_${plain}` || hashed === "existing_hash";
        });

        mocks.prisma.$transaction.mockImplementation(async (arg: unknown) => {
            if (typeof arg === "function") {
                return (arg as (tx: unknown) => unknown)(mocks.prisma);
            }
            if (Array.isArray(arg)) {
                return Promise.all(arg);
            }
            return arg;
        });
    });

    // =========================================================================
    // 1. Authentication Boundaries
    // =========================================================================
    describe("authentication boundaries", () => {
        it("rejects unauthenticated requests in requireActiveUser", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(requireActiveUser()).rejects.toMatchObject({
                name: "AuthenticationRequiredError",
            });
            expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled();
        });

        it("rejects sessions missing user ID in requireActiveUser", async () => {
            mocks.auth.mockResolvedValue({ user: {} });

            await expect(requireActiveUser()).rejects.toMatchObject({
                name: "AuthenticationRequiredError",
            });
            expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled();
        });

        it("rejects sessions whose user record no longer exists in requireActiveUser", async () => {
            mocks.auth.mockResolvedValue({ user: { id: "deleted-user-id" } });
            mocks.prisma.user.findUnique.mockResolvedValue(null);

            await expect(requireActiveUser()).rejects.toMatchObject({
                name: "AuthenticationRequiredError",
            });
        });

        it("rejects unauthenticated requests in requireAuthenticatedUser", async () => {
            mocks.auth.mockResolvedValue(null);

            await expect(requireAuthenticatedUser()).rejects.toMatchObject({
                code: "UNAUTHORIZED",
            });
        });

        it("rejects empty user IDs in requireAuthenticatedUser", async () => {
            mocks.auth.mockResolvedValue({ user: { id: "" } });

            await expect(requireAuthenticatedUser()).rejects.toMatchObject({
                code: "UNAUTHORIZED",
            });
        });

        it("rejects unauthenticated requests on protected sessions GET route with 401", async () => {
            mocks.auth.mockResolvedValue(null);

            const response = await sessionsRoute();
            expect(response.status).toBe(401);

            const json = await response.json();
            expect(json.success).toBe(false);
            expect(json.message).toBe("Authentication is required.");
        });

        it("rejects unauthenticated requests on revoke-all sessions POST route with 401", async () => {
            mocks.auth.mockResolvedValue(null);

            const response = await revokeAllSessionsRoute();
            expect(response.status).toBe(401);

            const json = await response.json();
            expect(json.success).toBe(false);
            expect(json.message).toBe("Authentication is required.");
        });

        it("rejects unauthenticated requests on individual session DELETE route with 401", async () => {
            mocks.auth.mockResolvedValue(null);

            const request = new Request("http://localhost:3000/api/auth/sessions/sess-123", {
                method: "DELETE",
            });
            const response = await revokeSessionRoute(request, {
                params: Promise.resolve({ sessionId: "sess-123" }),
            });
            expect(response.status).toBe(401);

            const json = await response.json();
            expect(json.success).toBe(false);
            expect(json.message).toBe("Authentication is required.");
        });

        it("rejects unauthenticated requests on change-password route with 401", async () => {
            mocks.auth.mockResolvedValue(null);

            const request = new Request("http://localhost:3000/api/auth/change-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    currentPassword: "OldPassword1",
                    newPassword: "NewPassword2",
                }),
            });
            const response = await changePasswordRoute(request);
            expect(response.status).toBe(401);

            const json = await response.json();
            expect(json.success).toBe(false);
            expect(json.message).toBe("Authentication is required.");
        });

        it("returns unauthenticated status cleanly on status GET route without leaking internal data", async () => {
            mocks.auth.mockResolvedValue(null);

            const response = await statusRoute();
            expect(response.status).toBe(200);

            const json = await response.json();
            expect(json).toEqual({
                authenticated: false,
                user: null,
            });
        });
    });

    // =========================================================================
    // 2. Session Security
    // =========================================================================
    describe("session security", () => {
        it("invalidates all sessions on password change when currentSessionToken is omitted", async () => {
            mocks.prisma.user.findUnique.mockResolvedValue({
                id: "user-123",
                name: "John Doe",
                email: "john@example.com",
                passwordHash: "existing_hash",
            });
            mocks.bcryptCompare.mockImplementation(async (plain: string, hash: string) => {
                if (plain === "OldPassword1" && hash === "existing_hash") return true;
                return false;
            });
            mocks.prisma.user.update.mockResolvedValue({});
            mocks.prisma.session.deleteMany.mockResolvedValue({ count: 3 });
            mocks.prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });

            await changePassword("user-123", "OldPassword1", "NewPassword2");

            expect(mocks.prisma.session.deleteMany).toHaveBeenCalledWith({
                where: {
                    userId: "user-123",
                },
            });
            expect(mocks.prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
                where: {
                    userId: "user-123",
                    usedAt: null,
                },
                data: {
                    usedAt: expect.any(Date),
                },
            });
        });

        it("invalidates all other sessions but preserves current session on password change", async () => {
            mocks.prisma.user.findUnique.mockResolvedValue({
                id: "user-123",
                name: "John Doe",
                email: "john@example.com",
                passwordHash: "existing_hash",
            });
            mocks.bcryptCompare.mockImplementation(async (plain: string, hash: string) => {
                if (plain === "OldPassword1" && hash === "existing_hash") return true;
                return false;
            });
            mocks.prisma.user.update.mockResolvedValue({});
            mocks.prisma.session.deleteMany.mockResolvedValue({ count: 2 });
            mocks.prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });

            await changePassword("user-123", "OldPassword1", "NewPassword2", "active-session-token-xyz");

            expect(mocks.prisma.session.deleteMany).toHaveBeenCalledWith({
                where: {
                    userId: "user-123",
                    NOT: {
                        sessionToken: "active-session-token-xyz",
                    },
                },
            });
        });

        it("invalidates all sessions for the target user on password reset", async () => {
            mocks.prisma.passwordResetToken.findUnique.mockResolvedValue({
                id: "token-1",
                userId: "user-target-456",
                tokenHash: expect.any(String),
                expiresAt: new Date(Date.now() + 1000 * 60 * 15),
                usedAt: null,
            });
            mocks.prisma.user.findUnique.mockResolvedValue({
                id: "user-target-456",
                name: "Target User",
                email: "target@example.com",
                status: "ACTIVE",
            });
            mocks.prisma.user.update.mockResolvedValue({});
            mocks.prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
            mocks.prisma.session.deleteMany.mockResolvedValue({ count: 4 });

            await resetPassword("valid-raw-reset-token", "NewResetPassword1");

            expect(mocks.prisma.session.deleteMany).toHaveBeenCalledWith({
                where: {
                    userId: "user-target-456",
                },
            });
            expect(mocks.prisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
                where: {
                    userId: "user-target-456",
                    usedAt: null,
                },
                data: {
                    usedAt: expect.any(Date),
                },
            });
        });

        it("ensures revokeSession only deletes sessions belonging to the authenticated user", async () => {
            mocks.prisma.session.deleteMany.mockResolvedValue({ count: 1 });

            const result = await revokeSession("user-owner-1", "sess-target-99");
            expect(result).toBe(true);

            expect(mocks.prisma.session.deleteMany).toHaveBeenCalledWith({
                where: {
                    id: "sess-target-99",
                    userId: "user-owner-1",
                },
            });
        });

        it("ensures revokeSession returns false when trying to delete another user's session", async () => {
            mocks.prisma.session.deleteMany.mockResolvedValue({ count: 0 });

            const result = await revokeSession("attacker-user-id", "victim-session-id");
            expect(result).toBe(false);

            expect(mocks.prisma.session.deleteMany).toHaveBeenCalledWith({
                where: {
                    id: "victim-session-id",
                    userId: "attacker-user-id",
                },
            });
        });

        it("ensures revokeAllSessions strictly scopes deletion to authenticated user", async () => {
            mocks.prisma.session.deleteMany.mockResolvedValue({ count: 5 });

            const count = await revokeAllSessions("user-isolated-123");
            expect(count).toBe(5);

            expect(mocks.prisma.session.deleteMany).toHaveBeenCalledWith({
                where: {
                    userId: "user-isolated-123",
                },
            });
        });

        it("ensures revokeAllSessions with exceptSessionId maintains user isolation", async () => {
            mocks.prisma.session.deleteMany.mockResolvedValue({ count: 4 });

            const count = await revokeAllSessions("user-isolated-123", "current-session-id");
            expect(count).toBe(4);

            expect(mocks.prisma.session.deleteMany).toHaveBeenCalledWith({
                where: {
                    userId: "user-isolated-123",
                    NOT: {
                        id: "current-session-id",
                    },
                },
            });
        });

        it("ensures getUserSessions never exposes session tokens or secrets", async () => {
            mocks.prisma.session.findMany.mockResolvedValue([
                {
                    id: "sess-1",
                    expires: new Date(Date.now() + 3600000),
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            ]);

            const sessions = await getUserSessions("user-123");
            expect(sessions).toHaveLength(1);
            expect(sessions[0]).toHaveProperty("id", "sess-1");
            expect(sessions[0]).toHaveProperty("expires");
            expect(sessions[0]).toHaveProperty("createdAt");
            expect(sessions[0]).toHaveProperty("updatedAt");
            expect(sessions[0]).not.toHaveProperty("sessionToken");

            expect(mocks.prisma.session.findMany).toHaveBeenCalledWith({
                where: {
                    userId: "user-123",
                    expires: {
                        gt: expect.any(Date),
                    },
                    updatedAt: {
                        gt: expect.any(Date),
                    },
                },
                orderBy: {
                    updatedAt: "desc",
                },
                select: {
                    id: true,
                    expires: true,
                    createdAt: true,
                    updatedAt: true,
                },
            });
        });
    });

    // =========================================================================
    // 3. Password Security
    // =========================================================================
    describe("password security", () => {
        it("ensures plaintext passwords are never passed to database create during registration", async () => {
            mocks.prisma.user.findUnique.mockResolvedValue(null);
            mocks.prisma.user.create.mockResolvedValue({
                id: "user-reg-1",
                name: "Secure User",
                email: "secure@example.com",
                status: "PENDING",
            });
            mocks.prisma.verificationToken.create.mockResolvedValue({});

            await registerUser({
                name: "Secure User",
                email: "secure@example.com",
                password: "ComplexPassword1",
            });

            expect(mocks.bcryptHash).toHaveBeenCalledWith("ComplexPassword1", 12);
            expect(mocks.prisma.user.create).toHaveBeenCalledWith({
                data: {
                    name: "Secure User",
                    email: "secure@example.com",
                    passwordHash: "hashed_ComplexPassword1",
                    status: "PENDING",
                    emailVerified: null,
                },
                select: expect.any(Object),
            });
        });

        it("ensures password reset tokens are hashed before storage in database", async () => {
            mocks.prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
            mocks.prisma.passwordResetToken.create.mockResolvedValue({
                id: "prt-1",
                userId: "user-1",
                tokenHash: expect.any(String),
                expiresAt: expect.any(Date),
            });

            const result = await createPasswordResetToken("user-1");
            expect(result.token).toBeDefined();
            expect(result.token.length).toBe(64); // 32 bytes in hex

            expect(mocks.prisma.passwordResetToken.create).toHaveBeenCalledWith({
                data: {
                    userId: "user-1",
                    tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/), // SHA-256 hex string
                    expiresAt: expect.any(Date),
                },
            });
        });

        it("rejects weak passwords missing required character classes during registration", () => {
            // Missing uppercase
            expect(registerSchema.safeParse({
                name: "User",
                email: "u@example.com",
                password: "password123",
            }).success).toBe(false);

            // Missing lowercase
            expect(registerSchema.safeParse({
                name: "User",
                email: "u@example.com",
                password: "PASSWORD123",
            }).success).toBe(false);

            // Missing number
            expect(registerSchema.safeParse({
                name: "User",
                email: "u@example.com",
                password: "PasswordXYZ",
            }).success).toBe(false);

            // Less than 8 characters
            expect(registerSchema.safeParse({
                name: "User",
                email: "u@example.com",
                password: "Pass1",
            }).success).toBe(false);
        });

        it("rejects weak passwords during changePassword", async () => {
            await expect(
                changePassword("user-1", "OldPassword1", "weak")
            ).rejects.toMatchObject({
                code: "WEAK_PASSWORD",
                message: "Password must contain at least 8 characters.",
            });

            await expect(
                changePassword("user-1", "OldPassword1", "lowercase123")
            ).rejects.toMatchObject({
                code: "WEAK_PASSWORD",
                message: "Password must contain an uppercase letter.",
            });

            await expect(
                changePassword("user-1", "OldPassword1", "UPPERCASE123")
            ).rejects.toMatchObject({
                code: "WEAK_PASSWORD",
                message: "Password must contain a lowercase letter.",
            });

            await expect(
                changePassword("user-1", "OldPassword1", "NoNumbersHere")
            ).rejects.toMatchObject({
                code: "WEAK_PASSWORD",
                message: "Password must contain a number.",
            });
        });

        it("rejects incorrect current password during changePassword", async () => {
            mocks.prisma.user.findUnique.mockResolvedValue({
                id: "user-1",
                name: "User",
                email: "u@example.com",
                passwordHash: "correct_password_hash",
            });
            mocks.bcryptCompare.mockResolvedValue(false);

            await expect(
                changePassword("user-1", "WrongPassword1", "NewPassword2")
            ).rejects.toMatchObject({
                code: "INVALID_CURRENT_PASSWORD",
                message: "Current password is incorrect.",
            });
            expect(mocks.prisma.user.update).not.toHaveBeenCalled();
        });

        it("rejects setting new password identical to current password", async () => {
            mocks.prisma.user.findUnique.mockResolvedValue({
                id: "user-1",
                name: "User",
                email: "u@example.com",
                passwordHash: "correct_password_hash",
            });
            mocks.bcryptCompare.mockImplementation(async (plain: string) => {
                return plain === "SamePassword1";
            });

            await expect(
                changePassword("user-1", "SamePassword1", "SamePassword1")
            ).rejects.toMatchObject({
                code: "SAME_PASSWORD",
                message: "New password must be different from your current password.",
            });
            expect(mocks.prisma.user.update).not.toHaveBeenCalled();
        });

        it("rejects password reset when token does not exist", async () => {
            mocks.prisma.passwordResetToken.findUnique.mockResolvedValue(null);

            await expect(
                resetPassword("nonexistent-token", "NewPassword2")
            ).rejects.toMatchObject({
                code: "INVALID_TOKEN",
                message: "Invalid or expired reset link.",
            });
        });

        it("rejects password reset with an expired token", async () => {
            mocks.prisma.passwordResetToken.findUnique.mockResolvedValue({
                id: "prt-1",
                userId: "user-1",
                tokenHash: "token-hash",
                expiresAt: new Date(Date.now() - 1000 * 60 * 5), // Expired 5 mins ago
                usedAt: null,
            });

            await expect(
                resetPassword("expired-token", "NewPassword2")
            ).rejects.toMatchObject({
                code: "INVALID_TOKEN",
                message: "Invalid or expired reset link.",
            });
        });

        it("rejects password reset with an already used token", async () => {
            mocks.prisma.passwordResetToken.findUnique.mockResolvedValue({
                id: "prt-1",
                userId: "user-1",
                tokenHash: "token-hash",
                expiresAt: new Date(Date.now() + 1000 * 60 * 15),
                usedAt: new Date(Date.now() - 1000 * 60 * 2), // Used 2 mins ago
            });

            await expect(
                resetPassword("already-used-token", "NewPassword2")
            ).rejects.toMatchObject({
                code: "INVALID_TOKEN",
                message: "Invalid or expired reset link.",
            });
        });
    });

    // =========================================================================
    // 4. Password-Reset & Verification-Email Enumeration Resistance
    // =========================================================================
    describe("enumeration resistance", () => {
        const genericForgotPasswordResponse = {
            success: true,
            message: "If an account exists with that email, a password reset email has been sent.",
        };

        const genericResendVerificationResponse = {
            success: true,
            message: "If an account requires email verification, a verification email has been sent.",
        };

        it("returns identical response for existing active user on forgot-password", async () => {
            mocks.prisma.user.findUnique.mockResolvedValue({
                id: "user-exists-1",
                name: "Active Account",
                email: "active@example.com",
                status: "ACTIVE",
            });
            mocks.prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });
            mocks.prisma.passwordResetToken.create.mockResolvedValue({
                id: "prt-1",
                userId: "user-exists-1",
                tokenHash: "hash",
                expiresAt: new Date(),
            });

            const request = new Request("http://localhost:3000/api/auth/forgot-password", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-forwarded-for": "192.168.1.101" },
                body: JSON.stringify({ email: "active@example.com" }),
            });
            const response = await forgotPasswordRoute(request);
            expect(response.status).toBe(200);

            const json = await response.json();
            expect(json).toEqual(genericForgotPasswordResponse);
            expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
        });

        it("returns identical generic response for non-existent user on forgot-password", async () => {
            mocks.prisma.user.findUnique.mockResolvedValue(null);

            const request = new Request("http://localhost:3000/api/auth/forgot-password", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-forwarded-for": "192.168.1.102" },
                body: JSON.stringify({ email: "nonexistent@example.com" }),
            });
            const response = await forgotPasswordRoute(request);
            expect(response.status).toBe(200);

            const json = await response.json();
            expect(json).toEqual(genericForgotPasswordResponse);
            expect(mocks.sendEmail).not.toHaveBeenCalled();
        });

        it("returns identical generic response for deactivated user on forgot-password without sending email", async () => {
            mocks.prisma.user.findUnique.mockResolvedValue({
                id: "user-deact-1",
                name: "Deactivated Account",
                email: "deactivated@example.com",
                status: "DEACTIVATED",
            });

            const request = new Request("http://localhost:3000/api/auth/forgot-password", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-forwarded-for": "192.168.1.103" },
                body: JSON.stringify({ email: "deactivated@example.com" }),
            });
            const response = await forgotPasswordRoute(request);
            expect(response.status).toBe(200);

            const json = await response.json();
            expect(json).toEqual(genericForgotPasswordResponse);
            expect(mocks.sendEmail).not.toHaveBeenCalled();
        });

        it("returns identical generic response for malformed email on forgot-password", async () => {
            const request = new Request("http://localhost:3000/api/auth/forgot-password", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-forwarded-for": "192.168.1.104" },
                body: JSON.stringify({ email: "not-an-email" }),
            });
            const response = await forgotPasswordRoute(request);
            expect(response.status).toBe(200);

            const json = await response.json();
            expect(json).toEqual(genericForgotPasswordResponse);
        });

        it("returns identical generic response for existing unverified user on resend-verification", async () => {
            mocks.prisma.user.findUnique.mockResolvedValue({
                id: "user-pend-1",
                name: "Pending Account",
                email: "pending@example.com",
                status: "PENDING",
                emailVerified: null,
            });
            mocks.prisma.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
            mocks.prisma.verificationToken.create.mockResolvedValue({});

            const request = new Request("http://localhost:3000/api/auth/resend-verification", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-forwarded-for": "192.168.1.105" },
                body: JSON.stringify({ email: "pending@example.com" }),
            });
            const response = await resendVerificationRoute(request);
            expect(response.status).toBe(200);

            const json = await response.json();
            expect(json).toEqual(genericResendVerificationResponse);
            expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
        });

        it("returns identical generic response for non-existent user on resend-verification", async () => {
            mocks.prisma.user.findUnique.mockResolvedValue(null);

            const request = new Request("http://localhost:3000/api/auth/resend-verification", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-forwarded-for": "192.168.1.106" },
                body: JSON.stringify({ email: "nonexistent@example.com" }),
            });
            const response = await resendVerificationRoute(request);
            expect(response.status).toBe(200);

            const json = await response.json();
            expect(json).toEqual(genericResendVerificationResponse);
            expect(mocks.sendEmail).not.toHaveBeenCalled();
        });

        it("returns identical generic response for already verified user on resend-verification without sending email", async () => {
            mocks.prisma.user.findUnique.mockResolvedValue({
                id: "user-act-1",
                name: "Active Account",
                email: "alreadyverified@example.com",
                status: "ACTIVE",
                emailVerified: new Date(),
            });

            const request = new Request("http://localhost:3000/api/auth/resend-verification", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-forwarded-for": "192.168.1.107" },
                body: JSON.stringify({ email: "alreadyverified@example.com" }),
            });
            const response = await resendVerificationRoute(request);
            expect(response.status).toBe(200);

            const json = await response.json();
            expect(json).toEqual(genericResendVerificationResponse);
            expect(mocks.sendEmail).not.toHaveBeenCalled();
        });

        it("returns identical generic response for deactivated user on resend-verification without sending email", async () => {
            mocks.prisma.user.findUnique.mockResolvedValue({
                id: "user-deact-1",
                name: "Deactivated Account",
                email: "deactivated@example.com",
                status: "DEACTIVATED",
                emailVerified: null,
            });

            const request = new Request("http://localhost:3000/api/auth/resend-verification", {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-forwarded-for": "192.168.1.108" },
                body: JSON.stringify({ email: "deactivated@example.com" }),
            });
            const response = await resendVerificationRoute(request);
            expect(response.status).toBe(200);

            const json = await response.json();
            expect(json).toEqual(genericResendVerificationResponse);
            expect(mocks.sendEmail).not.toHaveBeenCalled();
        });
    });

    // =========================================================================
    // 5. Rate Limiting
    // =========================================================================
    describe("rate limiting", () => {
        it("enforces email cooldown for forgot-password requests", () => {
            const email = "rate-limit-email-1@example.com";
            const ip1 = "10.0.0.1";
            const ip2 = "10.0.0.2";

            const first = checkForgotPasswordRateLimit(email, ip1);
            expect(first.allowed).toBe(true);

            // Immediate second request with same email from different IP should be blocked by email cooldown
            const second = checkForgotPasswordRateLimit(email, ip2);
            expect(second.allowed).toBe(false);
            expect(second.retryAfterSeconds).toBeGreaterThan(0);
        });

        it("enforces IP window rate limit for forgot-password requests", () => {
            const ip = "192.168.100.50";

            for (let i = 0; i < 10; i++) {
                const res = checkForgotPasswordRateLimit(`unique-user-${i}@example.com`, ip);
                expect(res.allowed).toBe(true);
            }

            // 11th request from same IP within window should be rejected
            const eleventh = checkForgotPasswordRateLimit("eleventh-user@example.com", ip);
            expect(eleventh.allowed).toBe(false);
            expect(eleventh.retryAfterSeconds).toBeGreaterThan(0);
        });

        it("enforces email cooldown for verification email requests", () => {
            const email = "verify-cooldown@example.com";
            const ip = "172.16.0.1";

            const first = checkVerificationEmailRateLimit(email, ip);
            expect(first.allowed).toBe(true);

            const second = checkVerificationEmailRateLimit(email, "172.16.0.2");
            expect(second.allowed).toBe(false);
            expect(second.retryAfterSeconds).toBeGreaterThan(0);
        });

        it("enforces token attempt limits for reset-password", () => {
            const token = "rate-limited-reset-token-xyz";

            for (let i = 0; i < 10; i++) {
                const res = checkResetPasswordRateLimit(token, `10.10.10.${i + 1}`);
                expect(res.allowed).toBe(true);
            }

            // 11th attempt on same token is rejected
            const blocked = checkResetPasswordRateLimit(token, "10.10.10.99");
            expect(blocked.allowed).toBe(false);
            expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
        });

        it("returns HTTP 429 with Retry-After header on reset-password route when rate-limited", async () => {
            const token = "heavily-spammed-token";
            // Exceed limit
            for (let i = 0; i < 10; i++) {
                checkResetPasswordRateLimit(token, "192.168.200.1");
            }

            const request = new Request("http://localhost:3000/api/auth/reset-password", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-forwarded-for": "192.168.200.1",
                },
                body: JSON.stringify({
                    token,
                    password: "NewValidPassword1",
                }),
            });

            const response = await resetPasswordRoute(request);
            expect(response.status).toBe(429);
            expect(response.headers.get("Retry-After")).toBeDefined();

            const json = await response.json();
            expect(json.success).toBe(false);
            expect(json.message).toContain("Too many password reset attempts");
        });
    });

    // =========================================================================
    // 6. Sensitive Data Protection
    // =========================================================================
    describe("sensitive data protection", () => {
        it("ensures registration API response never exposes passwordHash or raw tokens", async () => {
            mocks.prisma.user.findUnique.mockResolvedValue(null);
            mocks.prisma.user.create.mockResolvedValue({
                id: "user-reg-secure",
                name: "Secure Name",
                email: "secure-reg@example.com",
                status: "PENDING",
            });
            mocks.prisma.verificationToken.create.mockResolvedValue({});

            const request = new Request("http://localhost:3000/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: "Secure Name",
                    email: "secure-reg@example.com",
                    password: "Password1234",
                }),
            });

            const response = await registerRoute(request);
            expect(response.status).toBe(201);

            const json = await response.json();
            expect(json.user).toBeDefined();
            expect(json.user).not.toHaveProperty("passwordHash");
            expect(json.user).not.toHaveProperty("password");
            expect(json).not.toHaveProperty("token");
            expect(json).not.toHaveProperty("verificationToken");
        });

        it("ensures change-password API response does not expose password hashes", async () => {
            mocks.auth.mockResolvedValue({ user: { id: "user-change-sec" } });
            mocks.prisma.user.findUnique.mockResolvedValue({
                id: "user-change-sec",
                name: "Change User",
                email: "change@example.com",
                passwordHash: "existing_hash",
            });
            mocks.bcryptCompare.mockImplementation(async (plain: string, hash: string) => {
                if (plain === "OldPassword1" && hash === "existing_hash") return true;
                return false;
            });
            mocks.prisma.user.update.mockResolvedValue({});
            mocks.prisma.session.deleteMany.mockResolvedValue({ count: 1 });
            mocks.prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });

            const request = new Request("http://localhost:3000/api/auth/change-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    currentPassword: "OldPassword1",
                    newPassword: "NewPassword2",
                }),
            });

            const response = await changePasswordRoute(request);
            expect(response.status).toBe(200);

            const json = await response.json();
            expect(json.user).toBeDefined();
            expect(json.user).not.toHaveProperty("passwordHash");
            expect(json.user).not.toHaveProperty("password");
            expect(json.user).toEqual({
                id: "user-change-sec",
                name: "Change User",
                email: "change@example.com",
            });
        });

        it("ensures verify-email API response does not expose passwordHash", async () => {
            mocks.prisma.verificationToken.findUnique.mockResolvedValue({
                identifier: "verify-sec@example.com",
                token: "token-hash-xyz",
                expires: new Date(Date.now() + 3600000),
            });
            mocks.prisma.user.findUnique.mockResolvedValue({
                id: "user-verify-sec",
                name: "Verified User",
                email: "verify-sec@example.com",
                status: "PENDING",
                emailVerified: null,
            });
            mocks.prisma.user.update.mockResolvedValue({
                id: "user-verify-sec",
                name: "Verified User",
                email: "verify-sec@example.com",
                status: "ACTIVE",
                emailVerified: new Date(),
            });
            mocks.prisma.verificationToken.delete.mockResolvedValue({});

            const request = new Request("http://localhost:3000/api/auth/verify-email?token=valid-raw-token", {
                method: "GET",
            });

            const response = await verifyEmailRoute(request);
            expect(response.status).toBe(200);

            const json = await response.json();
            expect(json.user).toBeDefined();
            expect(json.user).not.toHaveProperty("passwordHash");
            expect(json.user).not.toHaveProperty("token");
        });

        it("ensures auth status API does not expose passwordHash or session secrets", async () => {
            mocks.auth.mockResolvedValue({ user: { id: "status-user-1" } });
            mocks.prisma.user.findUnique.mockResolvedValue({
                id: "status-user-1",
                name: "Status User",
                email: "status@example.com",
                status: "ACTIVE",
                emailVerified: new Date(),
                avatarUrl: "https://example.com/pic.jpg",
                passwordHash: "secret_db_hash",
            });

            const response = await statusRoute();
            expect(response.status).toBe(200);

            const json = await response.json();
            expect(json.authenticated).toBe(true);
            expect(json.user).toBeDefined();
            expect(json.user).not.toHaveProperty("passwordHash");
            expect(json.user).not.toHaveProperty("sessionToken");
        });
    });

    // =========================================================================
    // 7. API Error Safety
    // =========================================================================
    describe("API error safety", () => {
        it("handles malformed JSON body in register API cleanly without throwing unhandled exceptions", async () => {
            const request = new Request("http://localhost:3000/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: "INVALID_JSON_BODY{{{",
            });

            const response = await registerRoute(request);
            expect(response.status).toBe(400);

            const json = await response.json();
            expect(json).toEqual({
                success: false,
                message: "Invalid request body.",
            });
        });

        it("masks internal database errors on registration route", async () => {
            mocks.prisma.user.findUnique.mockRejectedValue(new Error("PrismaClientInitializationError: DB down"));

            const request = new Request("http://localhost:3000/api/auth/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name: "User Name",
                    email: "user@example.com",
                    password: "Password123",
                }),
            });

            const response = await registerRoute(request);
            expect(response.status).toBe(500);

            const json = await response.json();
            expect(json.success).toBe(false);
            expect(json.message).toBe("Unable to create your account.");
            expect(JSON.stringify(json)).not.toContain("PrismaClientInitializationError");
            expect(JSON.stringify(json)).not.toContain("DB down");
        });

        it("masks unexpected database failures on reset-password route", async () => {
            mocks.prisma.passwordResetToken.findUnique.mockRejectedValue(new Error("Database connection lost"));

            const request = new Request("http://localhost:3000/api/auth/reset-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    token: "some-raw-token",
                    password: "NewPassword1",
                }),
            });

            const response = await resetPasswordRoute(request);
            expect(response.status).toBe(500);

            const json = await response.json();
            expect(json.success).toBe(false);
            expect(json.message).toBe("Unable to reset your password.");
            expect(JSON.stringify(json)).not.toContain("Database connection lost");
        });

        it("masks unexpected database failures on change-password route", async () => {
            mocks.auth.mockResolvedValue({ user: { id: "user-err-1" } });
            mocks.prisma.user.findUnique.mockRejectedValue(new Error("Internal Prisma error code P2002"));

            const request = new Request("http://localhost:3000/api/auth/change-password", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    currentPassword: "OldPassword1",
                    newPassword: "NewPassword2",
                }),
            });

            const response = await changePasswordRoute(request);
            expect(response.status).toBe(500);

            const json = await response.json();
            expect(json.success).toBe(false);
            expect(json.message).toBe("Unable to change your password.");
            expect(JSON.stringify(json)).not.toContain("P2002");
        });

        it("masks unexpected database failures on verify-email route", async () => {
            mocks.prisma.verificationToken.findUnique.mockRejectedValue(new Error("Fatal DB Error"));

            const request = new Request("http://localhost:3000/api/auth/verify-email?token=xyz", {
                method: "GET",
            });

            const response = await verifyEmailRoute(request);
            expect(response.status).toBe(500);

            const json = await response.json();
            expect(json.success).toBe(false);
            expect(json.message).toBe("Unable to verify your email address.");
            expect(JSON.stringify(json)).not.toContain("Fatal DB Error");
        });
    });

    // =========================================================================
    // 8. Registration Security
    // =========================================================================
    describe("registration security", () => {
        it("rejects duplicate email registration with EMAIL_EXISTS error", async () => {
            mocks.prisma.user.findUnique.mockResolvedValue({
                id: "existing-user-id",
                email: "duplicate@example.com",
            });

            await expect(
                registerUser({
                    name: "Duplicate User",
                    email: "duplicate@example.com",
                    password: "Password123",
                })
            ).rejects.toMatchObject({
                code: "EMAIL_EXISTS",
                message: "An account with this email already exists.",
            });
            expect(mocks.prisma.user.create).not.toHaveBeenCalled();
        });

        it("performs atomic cleanup of user and verification token if email sending fails during registration", async () => {
            mocks.prisma.user.findUnique.mockResolvedValue(null);
            mocks.prisma.user.create.mockResolvedValue({
                id: "temp-user-id",
                name: "Cleanup Test",
                email: "cleanup@example.com",
                status: "PENDING",
            });
            mocks.prisma.verificationToken.deleteMany.mockResolvedValue({});
            mocks.prisma.verificationToken.create.mockResolvedValue({});
            mocks.sendEmail.mockRejectedValue(new Error("Email could not be sent."));

            mocks.prisma.user.delete.mockResolvedValue({});

            await expect(
                registerUser({
                    name: "Cleanup Test",
                    email: "cleanup@example.com",
                    password: "Password123",
                })
            ).rejects.toMatchObject({
                code: "EMAIL_DELIVERY_FAILED",
                message: "Unable to send the verification email. Please try again.",
            });

            // Verify transactional cleanup was invoked for the failed registration
            expect(mocks.prisma.$transaction).toHaveBeenCalled();
        });

        it("creates initial user in PENDING status with null emailVerified", async () => {
            mocks.prisma.user.findUnique.mockResolvedValue(null);
            mocks.prisma.user.create.mockResolvedValue({
                id: "user-new",
                name: "Newbie",
                email: "newbie@example.com",
                status: "PENDING",
            });
            mocks.prisma.verificationToken.create.mockResolvedValue({});

            const result = await registerUser({
                name: "Newbie",
                email: "newbie@example.com",
                password: "Password123",
            });

            expect(result.user.status).toBe("PENDING");
            expect(mocks.prisma.user.create).toHaveBeenCalledWith(
                expect.objectContaining({
                    data: expect.objectContaining({
                        status: "PENDING",
                        emailVerified: null,
                    }),
                })
            );
        });
    });

    // =========================================================================
    // 9. Email Security
    // =========================================================================
    describe("email security", () => {
        it("escapes user-controlled HTML characters in password reset email template", () => {
            const email = createPasswordResetEmail({
                name: "<script>alert('xss')</script> & \"admin\"",
                resetUrl: "https://example.com/reset?token=abc&x=<1>",
            });

            expect(email.html).not.toContain("<script>");
            expect(email.html).toContain("&lt;script&gt;");
            expect(email.html).toContain("&amp;");
            expect(email.html).toContain("&quot;admin&quot;");
            expect(email.html).toContain("&lt;1&gt;");

            // Plaintext should preserve readable string
            expect(email.text).toContain("<script>alert('xss')</script>");
        });

        it("escapes HTML in password changed notification email template", () => {
            const email = createPasswordChangedEmail({
                name: "<img src=x onerror=alert(1)>",
            });

            expect(email.html).not.toContain("<img src=x");
            expect(email.html).toContain("&lt;img src=x");
            expect(email.subject).toBe("Your Aforden password was changed");
        });

        it("escapes HTML in email verification template", () => {
            const email = createVerificationEmail({
                name: "<b>BoldUser</b>",
                verificationUrl: "https://example.com/verify?token=123&test='val'",
            });

            expect(email.html).not.toContain("<b>BoldUser</b>");
            expect(email.html).toContain("&lt;b&gt;BoldUser&lt;/b&gt;");
            expect(email.html).toContain("&#039;val&#039;");
        });

        it("ensures password changed email template does NOT contain old or new passwords", () => {
            const email = createPasswordChangedEmail({
                name: "Alice",
            });

            expect(email.html).not.toContain("passwordHash");
            expect(email.text).not.toContain("passwordHash");
            expect(email.text).toContain("Your Aforden account password was successfully changed.");
            expect(email.html).toMatch(/Your Aforden account password was\s+successfully changed\./);
        });

        it("ensures reset email template does not expose internal database IDs", () => {
            const email = createPasswordResetEmail({
                name: "Bob",
                resetUrl: "https://example.com/reset-password?token=secret123",
            });

            expect(email.html).not.toContain("userId");
            expect(email.html).not.toContain("passwordHash");
            expect(email.text).not.toContain("userId");
        });
    });

    // =========================================================================
    // 10. Authorization Boundaries & Tenant Isolation
    // =========================================================================
    describe("authorization boundaries", () => {
        it("verifies security rules are configured to reject client trust and require tenant isolation", () => {
            expect(SECURITY_RULES.REQUIRE_WORKSPACE_SCOPE).toBe(true);
            expect(SECURITY_RULES.REQUIRE_ACTIVE_MEMBERSHIP).toBe(true);
            expect(SECURITY_RULES.NEVER_TRUST_CLIENT_USER_ID).toBe(true);
            expect(SECURITY_RULES.NEVER_TRUST_CLIENT_ROLE).toBe(true);
            expect(SECURITY_RULES.REQUIRE_SERVER_SIDE_AUTHORIZATION).toBe(true);
            expect(SECURITY_RULES.HIDE_AUTHORIZATION_DETAILS).toBe(true);
        });

        it("enforces tenant isolation via workspaceScope", () => {
            const scope = workspaceScope("workspace-alpha");
            expect(scope).toEqual({
                workspaceId: "workspace-alpha",
            });
            expect(scope).not.toHaveProperty("userId");
            expect(scope).not.toHaveProperty("role");
        });

        it("rejects unauthorized access when user has no active membership in target workspace", async () => {
            mocks.prisma.workspaceMember.findFirst.mockResolvedValue(null);

            await expect(
                requirePermission("user-1", "workspace-other", PERMISSIONS.WORK_ORDERS_VIEW)
            ).rejects.toMatchObject({
                code: "WORKSPACE_ACCESS_DENIED",
                name: "WorkspaceAccessError",
            });
        });

        it("denies lower-privileged roles from performing privileged operations", async () => {
            mocks.prisma.workspaceMember.findFirst.mockResolvedValue({
                userId: "tech-user-1",
                workspaceId: "workspace-1",
                role: "TECHNICIAN",
            });

            // TECHNICIAN cannot invite members
            await expect(
                requirePermission("tech-user-1", "workspace-1", PERMISSIONS.MEMBERS_INVITE)
            ).rejects.toMatchObject({
                code: "FORBIDDEN",
                name: "ForbiddenError",
            });

            // TECHNICIAN cannot manage settings
            await expect(
                requirePermission("tech-user-1", "workspace-1", PERMISSIONS.SETTINGS_UPDATE)
            ).rejects.toMatchObject({
                code: "FORBIDDEN",
                name: "ForbiddenError",
            });
        });

        it("allows authorized operations for appropriate roles", async () => {
            mocks.prisma.workspaceMember.findFirst.mockResolvedValue({
                userId: "tech-user-1",
                workspaceId: "workspace-1",
                role: "TECHNICIAN",
            });

            const context = await requirePermission("tech-user-1", "workspace-1", PERMISSIONS.WORK_ORDERS_VIEW);
            expect(context).toEqual({
                userId: "tech-user-1",
                workspaceId: "workspace-1",
                role: "TECHNICIAN",
            });
        });

        it("rejects requireAnyPermission when an empty permissions array is passed", async () => {
            mocks.prisma.workspaceMember.findFirst.mockResolvedValue({
                userId: "owner-1",
                workspaceId: "workspace-1",
                role: "OWNER",
            });

            await expect(
                requireAnyPermission("owner-1", "workspace-1", [])
            ).rejects.toMatchObject({
                code: "FORBIDDEN",
                name: "ForbiddenError",
            });
        });

        it("rejects requireAllPermissions when an empty permissions array is passed", async () => {
            mocks.prisma.workspaceMember.findFirst.mockResolvedValue({
                userId: "owner-1",
                workspaceId: "workspace-1",
                role: "OWNER",
            });

            await expect(
                requireAllPermissions("owner-1", "workspace-1", [])
            ).rejects.toMatchObject({
                code: "FORBIDDEN",
                name: "ForbiddenError",
            });
        });

        it("requires workspace admin authority for requireWorkspaceAdmin", async () => {
            mocks.prisma.workspaceMember.findFirst.mockResolvedValue({
                userId: "dispatcher-1",
                workspaceId: "workspace-1",
                role: "DISPATCHER",
            });

            await expect(
                requireWorkspaceAdmin("dispatcher-1", "workspace-1")
            ).rejects.toMatchObject({
                code: "FORBIDDEN",
                name: "ForbiddenError",
            });
        });

        it("requires workspace owner authority for requireWorkspaceOwner", async () => {
            mocks.prisma.workspaceMember.findFirst.mockResolvedValue({
                userId: "admin-1",
                workspaceId: "workspace-1",
                role: "ADMIN",
            });

            await expect(
                requireWorkspaceOwner("admin-1", "workspace-1")
            ).rejects.toMatchObject({
                code: "FORBIDDEN",
                name: "ForbiddenError",
            });
        });

        it("converts authorization errors into safe responses without exposing internal permission names", async () => {
            mocks.prisma.workspaceMember.findFirst.mockResolvedValue({
                userId: "accountant-1",
                workspaceId: "workspace-1",
                role: "ACCOUNTANT",
            });

            let caughtError: unknown;
            try {
                await requirePermission("accountant-1", "workspace-1", PERMISSIONS.MEMBERS_INVITE);
            } catch (err) {
                caughtError = err;
            }

            const response = authorizationErrorResponse(caughtError);
            expect(response).not.toBeNull();
            expect(response?.status).toBe(403);

            const json = await response?.json();
            expect(json.error).toBe("FORBIDDEN");
            expect(json.message).toBe("You do not have permission to perform this action.");
            expect(JSON.stringify(json)).not.toContain("MEMBERS_INVITE");
        });
    });

    // =========================================================================
    // 11. Account State Security
    // =========================================================================
    describe("account state security", () => {
        it("allows active and verified users through requireActiveUser and requireAuthenticatedUser", async () => {
            const verifiedDate = new Date();
            mocks.auth.mockResolvedValue({ user: { id: "active-user-1" } });
            mocks.prisma.user.findUnique.mockResolvedValue({
                id: "active-user-1",
                name: "Active User",
                email: "active@example.com",
                status: "ACTIVE",
                emailVerified: verifiedDate,
                avatarUrl: null,
            });

            const activeUser = await requireActiveUser();
            expect(activeUser.id).toBe("active-user-1");
            expect(activeUser.status).toBe("ACTIVE");
            expect(activeUser.emailVerified).toEqual(verifiedDate);

            const authId = await requireAuthenticatedUser();
            expect(authId).toBe("active-user-1");
        });

        it("rejects unverified user in requireActiveUser with EmailVerificationRequiredError", async () => {
            mocks.auth.mockResolvedValue({ user: { id: "unverified-user-1" } });
            mocks.prisma.user.findUnique.mockResolvedValue({
                id: "unverified-user-1",
                name: "Unverified User",
                email: "unverified@example.com",
                status: "PENDING",
                emailVerified: null,
                avatarUrl: null,
            });

            await expect(requireActiveUser()).rejects.toMatchObject({
                name: "EmailVerificationRequiredError",
            });
        });

        it("rejects unverified user in requireAuthenticatedUser with ForbiddenError", async () => {
            mocks.auth.mockResolvedValue({ user: { id: "unverified-user-1" } });
            mocks.prisma.user.findUnique.mockResolvedValue({
                id: "unverified-user-1",
                status: "PENDING",
                emailVerified: null,
            });

            await expect(requireAuthenticatedUser()).rejects.toMatchObject({
                code: "FORBIDDEN",
                name: "ForbiddenError",
            });
        });

        it("rejects suspended user in requireActiveUser with AccountInactiveError", async () => {
            mocks.auth.mockResolvedValue({ user: { id: "suspended-user-1" } });
            mocks.prisma.user.findUnique.mockResolvedValue({
                id: "suspended-user-1",
                name: "Suspended User",
                email: "suspended@example.com",
                status: "SUSPENDED",
                emailVerified: new Date(),
                avatarUrl: null,
            });

            await expect(requireActiveUser()).rejects.toMatchObject({
                name: "AccountInactiveError",
            });
        });

        it("rejects deactivated user in requireActiveUser with AccountInactiveError", async () => {
            mocks.auth.mockResolvedValue({ user: { id: "deactivated-user-1" } });
            mocks.prisma.user.findUnique.mockResolvedValue({
                id: "deactivated-user-1",
                name: "Deactivated User",
                email: "deactivated@example.com",
                status: "DEACTIVATED",
                emailVerified: new Date(),
                avatarUrl: null,
            });

            await expect(requireActiveUser()).rejects.toMatchObject({
                name: "AccountInactiveError",
            });
        });

        it("rejects suspended user in requireAuthenticatedUser with ForbiddenError", async () => {
            mocks.auth.mockResolvedValue({ user: { id: "suspended-user-1" } });
            mocks.prisma.user.findUnique.mockResolvedValue({
                id: "suspended-user-1",
                status: "SUSPENDED",
                emailVerified: new Date(),
            });

            await expect(requireAuthenticatedUser()).rejects.toMatchObject({
                code: "FORBIDDEN",
                name: "ForbiddenError",
            });
        });

        it("rejects deactivated user in requireAuthenticatedUser with ForbiddenError", async () => {
            mocks.auth.mockResolvedValue({ user: { id: "deactivated-user-1" } });
            mocks.prisma.user.findUnique.mockResolvedValue({
                id: "deactivated-user-1",
                status: "DEACTIVATED",
                emailVerified: new Date(),
            });

            await expect(requireAuthenticatedUser()).rejects.toMatchObject({
                code: "FORBIDDEN",
                name: "ForbiddenError",
            });
        });

        it("queries live database user record on every access check instead of trusting session payload", async () => {
            // Even if session payload falsely claims user is ACTIVE and verified
            mocks.auth.mockResolvedValue({
                user: {
                    id: "manipulated-user-1",
                    status: "ACTIVE",
                    emailVerified: new Date(),
                },
            });

            // Live database reveals account has actually been suspended
            mocks.prisma.user.findUnique.mockResolvedValue({
                id: "manipulated-user-1",
                status: "SUSPENDED",
                emailVerified: new Date(),
            });

            await expect(requireAuthenticatedUser()).rejects.toMatchObject({
                code: "FORBIDDEN",
            });

            expect(mocks.prisma.user.findUnique).toHaveBeenCalledWith({
                where: {
                    id: "manipulated-user-1",
                },
                select: {
                    id: true,
                    status: true,
                    emailVerified: true,
                },
            });
        });
    });
});
