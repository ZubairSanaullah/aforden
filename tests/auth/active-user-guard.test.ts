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

import { requireActiveUser } from "@/lib/services/auth/requireActiveUser";

describe("Aforden active user guard", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("rejects an unauthenticated session", async () => {
        authMock.mockResolvedValue(null);

        await expect(
            requireActiveUser(),
        ).rejects.toMatchObject({
            name: "AuthenticationRequiredError",
        });

        expect(
            prismaMock.user.findUnique,
        ).not.toHaveBeenCalled();
    });

    it("rejects a session without a user ID", async () => {
        authMock.mockResolvedValue({
            user: {},
        });

        await expect(
            requireActiveUser(),
        ).rejects.toMatchObject({
            name: "AuthenticationRequiredError",
        });

        expect(
            prismaMock.user.findUnique,
        ).not.toHaveBeenCalled();
    });

    it("rejects a session whose user does not exist", async () => {
        authMock.mockResolvedValue({
            user: {
                id: "missing-user",
            },
        });

        prismaMock.user.findUnique.mockResolvedValue(null);

        await expect(
            requireActiveUser(),
        ).rejects.toMatchObject({
            name: "AuthenticationRequiredError",
        });

        expect(
            prismaMock.user.findUnique,
        ).toHaveBeenCalledWith({
            where: {
                id: "missing-user",
            },
            select: {
                id: true,
                name: true,
                email: true,
                status: true,
                emailVerified: true,
                avatarUrl: true,
            },
        });
    });

    it("rejects an unverified user", async () => {
        authMock.mockResolvedValue({
            user: {
                id: "user-1",
            },
        });

        prismaMock.user.findUnique.mockResolvedValue({
            id: "user-1",
            name: "Pending User",
            email: "pending@example.com",
            status: "PENDING",
            emailVerified: null,
            avatarUrl: null,
        });

        await expect(
            requireActiveUser(),
        ).rejects.toMatchObject({
            name: "EmailVerificationRequiredError",
        });
    });

    it("rejects a suspended user", async () => {
        authMock.mockResolvedValue({
            user: {
                id: "user-2",
            },
        });

        prismaMock.user.findUnique.mockResolvedValue({
            id: "user-2",
            name: "Suspended User",
            email: "suspended@example.com",
            status: "SUSPENDED",
            emailVerified: new Date(),
            avatarUrl: null,
        });

        await expect(
            requireActiveUser(),
        ).rejects.toMatchObject({
            name: "AccountInactiveError",
        });
    });

    it("rejects a deactivated user", async () => {
        authMock.mockResolvedValue({
            user: {
                id: "user-3",
            },
        });

        prismaMock.user.findUnique.mockResolvedValue({
            id: "user-3",
            name: "Deactivated User",
            email: "deactivated@example.com",
            status: "DEACTIVATED",
            emailVerified: new Date(),
            avatarUrl: null,
        });

        await expect(
            requireActiveUser(),
        ).rejects.toMatchObject({
            name: "AccountInactiveError",
        });
    });

    it("allows an active verified user", async () => {
        const verifiedAt = new Date();

        authMock.mockResolvedValue({
            user: {
                id: "active-user",
            },
        });

        prismaMock.user.findUnique.mockResolvedValue({
            id: "active-user",
            name: "Active User",
            email: "active@example.com",
            status: "ACTIVE",
            emailVerified: verifiedAt,
            avatarUrl: "https://example.com/avatar.png",
        });

        const result = await requireActiveUser();

        expect(result).toEqual({
            id: "active-user",
            name: "Active User",
            email: "active@example.com",
            status: "ACTIVE",
            emailVerified: verifiedAt,
            avatarUrl: "https://example.com/avatar.png",
        });
    });

    it("resolves the database user using the session user ID", async () => {
        authMock.mockResolvedValue({
            user: {
                id: "server-user-id",
            },
        });

        prismaMock.user.findUnique.mockResolvedValue({
            id: "server-user-id",
            name: "Server User",
            email: "server@example.com",
            status: "ACTIVE",
            emailVerified: new Date(),
            avatarUrl: null,
        });

        await requireActiveUser();

        expect(
            prismaMock.user.findUnique,
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                where: {
                    id: "server-user-id",
                },
            }),
        );
    });
});