import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    mockAuth: vi.fn(),
    mockFindUnique: vi.fn(),
}));

const { mockAuth, mockFindUnique } = mocks;

vi.mock("@/auth", () => ({
    auth: mocks.mockAuth,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: {
            findUnique: mocks.mockFindUnique,
        },
    },
}));

import {
    requireAuthenticatedUser,
} from "@/lib/auth/api";

import {
    ForbiddenError,
    UnauthorizedError,
} from "@/lib/auth/errors";

describe("requireAuthenticatedUser", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("rejects requests without a session", async () => {
        mockAuth.mockResolvedValue(null);

        await expect(
            requireAuthenticatedUser()
        ).rejects.toBeInstanceOf(
            UnauthorizedError
        );

        expect(
            mockFindUnique
        ).not.toHaveBeenCalled();
    });

    it("rejects sessions without a user id", async () => {
        mockAuth.mockResolvedValue({
            user: {},
        });

        await expect(
            requireAuthenticatedUser()
        ).rejects.toBeInstanceOf(
            UnauthorizedError
        );

        expect(
            mockFindUnique
        ).not.toHaveBeenCalled();
    });

    it("rejects when the database user no longer exists", async () => {
        mockAuth.mockResolvedValue({
            user: {
                id: "user-1",
            },
        });

        mockFindUnique.mockResolvedValue(null);

        await expect(
            requireAuthenticatedUser()
        ).rejects.toBeInstanceOf(
            UnauthorizedError
        );
    });

    it("rejects PENDING users", async () => {
        mockAuth.mockResolvedValue({
            user: {
                id: "user-1",
            },
        });

        mockFindUnique.mockResolvedValue({
            id: "user-1",
            status: "PENDING",
            emailVerified: new Date(),
        });

        await expect(
            requireAuthenticatedUser()
        ).rejects.toBeInstanceOf(
            ForbiddenError
        );
    });

    it("rejects SUSPENDED users", async () => {
        mockAuth.mockResolvedValue({
            user: {
                id: "user-1",
            },
        });

        mockFindUnique.mockResolvedValue({
            id: "user-1",
            status: "SUSPENDED",
            emailVerified: new Date(),
        });

        await expect(
            requireAuthenticatedUser()
        ).rejects.toBeInstanceOf(
            ForbiddenError
        );
    });

    it("rejects DEACTIVATED users", async () => {
        mockAuth.mockResolvedValue({
            user: {
                id: "user-1",
            },
        });

        mockFindUnique.mockResolvedValue({
            id: "user-1",
            status: "DEACTIVATED",
            emailVerified: new Date(),
        });

        await expect(
            requireAuthenticatedUser()
        ).rejects.toBeInstanceOf(
            ForbiddenError
        );
    });

    it("rejects ACTIVE users whose email is not verified", async () => {
        mockAuth.mockResolvedValue({
            user: {
                id: "user-1",
            },
        });

        mockFindUnique.mockResolvedValue({
            id: "user-1",
            status: "ACTIVE",
            emailVerified: null,
        });

        await expect(
            requireAuthenticatedUser()
        ).rejects.toBeInstanceOf(
            ForbiddenError
        );
    });

    it("allows ACTIVE and verified users", async () => {
        mockAuth.mockResolvedValue({
            user: {
                id: "user-1",
            },
        });

        mockFindUnique.mockResolvedValue({
            id: "user-1",
            status: "ACTIVE",
            emailVerified: new Date(),
        });

        await expect(
            requireAuthenticatedUser()
        ).resolves.toBe("user-1");
    });

    it("uses the authenticated session user id for the database lookup", async () => {
        mockAuth.mockResolvedValue({
            user: {
                id: "session-user-123",
            },
        });

        mockFindUnique.mockResolvedValue({
            id: "session-user-123",
            status: "ACTIVE",
            emailVerified: new Date(),
        });

        await requireAuthenticatedUser();

        expect(mockFindUnique).toHaveBeenCalledWith({
            where: {
                id: "session-user-123",
            },
            select: {
                id: true,
                status: true,
                emailVerified: true,
            },
        });
    });
});