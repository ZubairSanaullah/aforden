import { beforeEach, describe, expect, it, vi } from "vitest";

const { authMock, prismaMock } = vi.hoisted(() => ({
    authMock: vi.fn(),

    prismaMock: {
        user: {
            findUnique: vi.fn(),
        },
    },
}));

vi.mock("@/auth", () => ({
    auth: authMock,
}));

vi.mock("@/lib/prisma", () => ({
    prisma: prismaMock,
}));

import { requireAuthenticatedUser } from "@/lib/auth/api";

describe("Aforden session invalidation conditions", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        authMock.mockResolvedValue({
            user: {
                id: "user-1",
            },
        });
    });

    it("allows a currently active and verified user", async () => {
        prismaMock.user.findUnique.mockResolvedValue({
            id: "user-1",
            status: "ACTIVE",
            emailVerified: new Date(),
        });

        const userId =
            await requireAuthenticatedUser();

        expect(userId).toBe("user-1");
    });

    it("denies a user whose account has been suspended", async () => {
        prismaMock.user.findUnique.mockResolvedValue({
            id: "user-1",
            status: "SUSPENDED",
            emailVerified: new Date(),
        });

        await expect(
            requireAuthenticatedUser(),
        ).rejects.toMatchObject({
            code: "FORBIDDEN",
        });
    });

    it("denies a user whose account has been deactivated", async () => {
        prismaMock.user.findUnique.mockResolvedValue({
            id: "user-1",
            status: "DEACTIVATED",
            emailVerified: new Date(),
        });

        await expect(
            requireAuthenticatedUser(),
        ).rejects.toMatchObject({
            code: "FORBIDDEN",
        });
    });

    it("denies a user whose email verification is removed", async () => {
        prismaMock.user.findUnique.mockResolvedValue({
            id: "user-1",
            status: "ACTIVE",
            emailVerified: null,
        });

        await expect(
            requireAuthenticatedUser(),
        ).rejects.toMatchObject({
            code: "FORBIDDEN",
        });
    });

    it("denies a user deleted from the database", async () => {
        prismaMock.user.findUnique.mockResolvedValue(null);

        await expect(
            requireAuthenticatedUser(),
        ).rejects.toMatchObject({
            code: "UNAUTHORIZED",
        });
    });

    it("uses current database state instead of trusting the session state", async () => {
        authMock.mockResolvedValue({
            user: {
                id: "user-1",
                status: "ACTIVE",
                emailVerified: true,
            },
        });

        prismaMock.user.findUnique.mockResolvedValue({
            id: "user-1",
            status: "SUSPENDED",
            emailVerified: new Date(),
        });

        await expect(
            requireAuthenticatedUser(),
        ).rejects.toMatchObject({
            code: "FORBIDDEN",
        });

        expect(
            prismaMock.user.findUnique,
        ).toHaveBeenCalledWith({
            where: {
                id: "user-1",
            },
            select: {
                id: true,
                status: true,
                emailVerified: true,
            },
        });
    });
});