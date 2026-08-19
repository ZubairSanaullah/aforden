import { beforeEach, describe, expect, it, vi } from "vitest";

const {
    prismaMock,
    bcryptMock,
    nextAuthMock,
    credentialsMock,
    prismaAdapterMock,
} = vi.hoisted(() => {
    const prismaMock = {
        user: {
            findUnique: vi.fn(),
        },
    };

    const bcryptMock = {
        compare: vi.fn(),
    };

    interface AuthenticatedUserResult {
        id: string;
        name: string | null;
        email: string;
        image: string | null;
    }

    interface CredentialsConfig {
        authorize: (credentials?: Record<string, unknown>) => Promise<AuthenticatedUserResult | null>;
    }

    interface NextAuthConfig {
        providers: CredentialsConfig[];
        callbacks?: {
            session?: (params: {
                session: { user: { id: string; name?: string | null; email?: string | null; image?: string | null } };
                user: { id: string };
            }) => Promise<unknown>;
        };
    }

    const nextAuthMock = vi.fn((config: NextAuthConfig) => ({
        handlers: {},
        signIn: vi.fn(),
        signOut: vi.fn(),
        auth: vi.fn(),
        __config: config,
    }));

    const credentialsMock = vi.fn((config: CredentialsConfig) => config);
    const prismaAdapterMock = vi.fn(() => ({}));

    return {
        prismaMock,
        bcryptMock,
        nextAuthMock,
        credentialsMock,
        prismaAdapterMock,
    };
});

vi.mock("@/lib/prisma", () => ({
    prisma: prismaMock,
}));

vi.mock("bcrypt", () => ({
    default: bcryptMock,
}));

vi.mock("@auth/prisma-adapter", () => ({
    PrismaAdapter: prismaAdapterMock,
}));

vi.mock("next-auth/providers/credentials", () => ({
    default: credentialsMock,
}));

vi.mock("next-auth", () => ({
    default: nextAuthMock,
}));

import "@/auth";

const nextAuthConfig = nextAuthMock.mock.calls[0]?.[0];

if (!nextAuthConfig) {
    throw new Error("NextAuth configuration was not captured.");
}

const authorize = nextAuthConfig.providers[0].authorize;

describe("Aforden authentication", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function getAuthorize() {
        return authorize;
    }

    it("rejects missing credentials", async () => {
        const authorize = getAuthorize();

        const result = await authorize(
            undefined,
        );

        expect(result).toBeNull();

        expect(
            prismaMock.user.findUnique,
        ).not.toHaveBeenCalled();
    });

    it("rejects non-string email credentials", async () => {
        const authorize = getAuthorize();

        const result = await authorize({
            email: 123,
            password: "password",
        });

        expect(result).toBeNull();

        expect(
            prismaMock.user.findUnique,
        ).not.toHaveBeenCalled();
    });

    it("rejects non-string password credentials", async () => {
        const authorize = getAuthorize();

        const result = await authorize({
            email: "user@example.com",
            password: 123,
        });

        expect(result).toBeNull();

        expect(
            prismaMock.user.findUnique,
        ).not.toHaveBeenCalled();
    });

    it("normalizes the email before querying the database", async () => {
        const authorize = getAuthorize();

        prismaMock.user.findUnique.mockResolvedValue(
            null,
        );

        await authorize({
            email: "  USER@Example.COM  ",
            password: "password",
        });

        expect(
            prismaMock.user.findUnique,
        ).toHaveBeenCalledWith({
            where: {
                email: "user@example.com",
            },
        });
    });

    it("rejects a nonexistent user", async () => {
        const authorize = getAuthorize();

        prismaMock.user.findUnique.mockResolvedValue(
            null,
        );

        const result = await authorize({
            email: "missing@example.com",
            password: "password",
        });

        expect(result).toBeNull();

        expect(
            bcryptMock.compare,
        ).not.toHaveBeenCalled();
    });

    it("rejects a user without a password hash", async () => {
        const authorize = getAuthorize();

        prismaMock.user.findUnique.mockResolvedValue({
            id: "user-1",
            name: "User",
            email: "user@example.com",
            passwordHash: null,
            status: "ACTIVE",
            emailVerified: new Date(),
            avatarUrl: null,
        });

        const result = await authorize({
            email: "user@example.com",
            password: "password",
        });

        expect(result).toBeNull();

        expect(
            bcryptMock.compare,
        ).not.toHaveBeenCalled();
    });

    it("rejects a pending account", async () => {
        const authorize = getAuthorize();

        prismaMock.user.findUnique.mockResolvedValue({
            id: "user-2",
            name: "Pending User",
            email: "pending@example.com",
            passwordHash: "$2b$hashed-password",
            status: "PENDING",
            emailVerified: null,
            avatarUrl: null,
        });

        const result = await authorize({
            email: "pending@example.com",
            password: "password",
        });

        expect(result).toBeNull();

        expect(
            bcryptMock.compare,
        ).not.toHaveBeenCalled();
    });

    it("rejects an unverified active account", async () => {
        const authorize = getAuthorize();

        prismaMock.user.findUnique.mockResolvedValue({
            id: "user-3",
            name: "Unverified User",
            email: "unverified@example.com",
            passwordHash: "$2b$hashed-password",
            status: "ACTIVE",
            emailVerified: null,
            avatarUrl: null,
        });

        const result = await authorize({
            email: "unverified@example.com",
            password: "password",
        });

        expect(result).toBeNull();

        expect(
            bcryptMock.compare,
        ).not.toHaveBeenCalled();
    });

    it("rejects a suspended account", async () => {
        const authorize = getAuthorize();

        prismaMock.user.findUnique.mockResolvedValue({
            id: "user-4",
            name: "Suspended User",
            email: "suspended@example.com",
            passwordHash: "$2b$hashed-password",
            status: "SUSPENDED",
            emailVerified: new Date(),
            avatarUrl: null,
        });

        const result = await authorize({
            email: "suspended@example.com",
            password: "password",
        });

        expect(result).toBeNull();

        expect(
            bcryptMock.compare,
        ).not.toHaveBeenCalled();
    });

    it("rejects a deactivated account", async () => {
        const authorize = getAuthorize();

        prismaMock.user.findUnique.mockResolvedValue({
            id: "user-5",
            name: "Deactivated User",
            email: "deactivated@example.com",
            passwordHash: "$2b$hashed-password",
            status: "DEACTIVATED",
            emailVerified: new Date(),
            avatarUrl: null,
        });

        const result = await authorize({
            email: "deactivated@example.com",
            password: "password",
        });

        expect(result).toBeNull();

        expect(
            bcryptMock.compare,
        ).not.toHaveBeenCalled();
    });

    it("rejects an incorrect password", async () => {
        const authorize = getAuthorize();

        prismaMock.user.findUnique.mockResolvedValue({
            id: "user-6",
            name: "User",
            email: "user@example.com",
            passwordHash: "$2b$hashed-password",
            status: "ACTIVE",
            emailVerified: new Date(),
            avatarUrl: null,
        });

        bcryptMock.compare.mockResolvedValue(
            false,
        );

        const result = await authorize({
            email: "user@example.com",
            password: "wrong-password",
        });

        expect(result).toBeNull();

        expect(
            bcryptMock.compare,
        ).toHaveBeenCalledWith(
            "wrong-password",
            "$2b$hashed-password",
        );
    });

    it("authenticates an active verified user with the correct password", async () => {
        const authorize = getAuthorize();

        prismaMock.user.findUnique.mockResolvedValue({
            id: "user-7",
            name: "John Doe",
            email: "john@example.com",
            passwordHash: "$2b$hashed-password",
            status: "ACTIVE",
            emailVerified: new Date(),
            avatarUrl: "https://example.com/avatar.png",
        });

        bcryptMock.compare.mockResolvedValue(
            true,
        );

        const result = await authorize({
            email: "john@example.com",
            password: "correct-password",
        });

        expect(result).toEqual({
            id: "user-7",
            name: "John Doe",
            email: "john@example.com",
            image:
                "https://example.com/avatar.png",
        });

        expect(
            bcryptMock.compare,
        ).toHaveBeenCalledWith(
            "correct-password",
            "$2b$hashed-password",
        );
    });

    it("returns the database user ID as the authenticated identity", async () => {
        const authorize = getAuthorize();

        prismaMock.user.findUnique.mockResolvedValue({
            id: "database-user-id",
            name: "Jane Doe",
            email: "jane@example.com",
            passwordHash: "$2b$hashed-password",
            status: "ACTIVE",
            emailVerified: new Date(),
            avatarUrl: null,
        });

        bcryptMock.compare.mockResolvedValue(
            true,
        );

        const result = await authorize({
            email: "jane@example.com",
            password: "correct-password",
        });

        expect(result?.id).toBe(
            "database-user-id",
        );
    });

    it("does not expose password information in the authenticated user", async () => {
        const authorize = getAuthorize();

        prismaMock.user.findUnique.mockResolvedValue({
            id: "user-8",
            name: "Secure User",
            email: "secure@example.com",
            passwordHash: "$2b$hashed-password",
            status: "ACTIVE",
            emailVerified: new Date(),
            avatarUrl: null,
        });

        bcryptMock.compare.mockResolvedValue(
            true,
        );

        const result = await authorize({
            email: "secure@example.com",
            password: "correct-password",
        });

        expect(result).not.toHaveProperty(
            "passwordHash",
        );

        expect(result).not.toHaveProperty(
            "password",
        );
    });

    it("does not reveal whether an invalid account exists through the authorize result", async () => {
        const authorize = getAuthorize();

        prismaMock.user.findUnique.mockResolvedValue(
            null,
        );

        const nonexistentResult =
            await authorize({
                email: "missing@example.com",
                password: "wrong-password",
            });

        prismaMock.user.findUnique.mockResolvedValue({
            id: "user-9",
            name: "Existing User",
            email: "existing@example.com",
            passwordHash: "$2b$hashed-password",
            status: "ACTIVE",
            emailVerified: new Date(),
            avatarUrl: null,
        });

        bcryptMock.compare.mockResolvedValue(
            false,
        );

        const wrongPasswordResult =
            await authorize({
                email: "existing@example.com",
                password: "wrong-password",
            });

        expect(nonexistentResult).toBeNull();
        expect(wrongPasswordResult).toBeNull();
    });
});