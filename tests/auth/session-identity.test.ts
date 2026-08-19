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

describe("Aforden session identity validation", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        prismaMock.user.findUnique.mockImplementation(
            async ({ where }: { where: { id: string } }) => ({
                id: where.id,
                status: "ACTIVE",
                emailVerified: new Date(),
            }),
        );
    });

    it("rejects requests without an authenticated session", async () => {
        authMock.mockResolvedValue(null);

        await expect(
            requireAuthenticatedUser(),
        ).rejects.toMatchObject({
            code: "UNAUTHORIZED",
        });

        expect(authMock).toHaveBeenCalledTimes(1);
    });

    it("rejects sessions without a user ID", async () => {
        authMock.mockResolvedValue({
            user: {
                email: "user@example.com",
            },
        });

        await expect(
            requireAuthenticatedUser(),
        ).rejects.toMatchObject({
            code: "UNAUTHORIZED",
        });
    });

    it("rejects sessions with an empty user ID", async () => {
        authMock.mockResolvedValue({
            user: {
                id: "",
                email: "user@example.com",
            },
        });

        await expect(
            requireAuthenticatedUser(),
        ).rejects.toMatchObject({
            code: "UNAUTHORIZED",
        });
    });

    it("returns the user ID from the server-side session", async () => {
        authMock.mockResolvedValue({
            user: {
                id: "server-user-123",
                email: "user@example.com",
            },
        });

        const userId =
            await requireAuthenticatedUser();

        expect(userId).toBe("server-user-123");
    });

    it("does not accept a client-provided user ID", async () => {
        authMock.mockResolvedValue({
            user: {
                id: "server-user-123",
                email: "user@example.com",
            },
        });

        const userId =
            await requireAuthenticatedUser();

        expect(userId).not.toBe("client-user-456");
        expect(userId).toBe("server-user-123");
    });

    it("uses only the authenticated session identity", async () => {
        authMock.mockResolvedValue({
            user: {
                id: "authenticated-user",
                email: "user@example.com",
            },
        });

        const result =
            await requireAuthenticatedUser();

        expect(result).toEqual(
            "authenticated-user",
        );
    });
});