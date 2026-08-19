import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
    $transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: prismaMock,
}));

import {
    verifyEmail,
} from "@/lib/services/auth/verifyEmail";

describe("verifyEmail", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    function createTransactionClient() {
        return {
            verificationToken: {
                findUnique: vi.fn(),
                delete: vi.fn(),
            },

            user: {
                findUnique: vi.fn(),
                update: vi.fn(),
            },
        };
    }

    function mockSuccessfulTransaction(
        tx: ReturnType<typeof createTransactionClient>,
    ) {
        prismaMock.$transaction.mockImplementation(
            async (
                callback: (
                    transaction: typeof tx,
                ) => Promise<unknown>,
            ) => callback(tx),
        );
    }

    it("rejects an empty token", async () => {
        await expect(
            verifyEmail(""),
        ).rejects.toMatchObject({
            code: "INVALID_TOKEN",
            message: "Invalid verification token.",
        });

        expect(
            prismaMock.$transaction,
        ).not.toHaveBeenCalled();
    });

    it("rejects a whitespace-only token", async () => {
        await expect(
            verifyEmail("   "),
        ).rejects.toMatchObject({
            code: "INVALID_TOKEN",
        });

        expect(
            prismaMock.$transaction,
        ).not.toHaveBeenCalled();
    });

    it("rejects an invalid token", async () => {
        const tx = createTransactionClient();

        tx.verificationToken.findUnique.mockResolvedValue(
            null,
        );

        mockSuccessfulTransaction(tx);

        await expect(
            verifyEmail("invalid-token"),
        ).rejects.toMatchObject({
            code: "INVALID_TOKEN",
            message:
                "This verification link is invalid or has expired.",
        });

        expect(
            tx.verificationToken.findUnique,
        ).toHaveBeenCalledTimes(1);

        expect(
            tx.user.findUnique,
        ).not.toHaveBeenCalled();
    });

    it("rejects and deletes an expired token", async () => {
        const tx = createTransactionClient();

        tx.verificationToken.findUnique.mockResolvedValue({
            identifier: "user@example.com",
            token: "expired-token-hash",
            expires: new Date(Date.now() - 60_000),
        });

        mockSuccessfulTransaction(tx);

        await expect(
            verifyEmail("expired-token"),
        ).rejects.toMatchObject({
            code: "INVALID_TOKEN",
            message:
                "This verification link is invalid or has expired.",
        });

        expect(
            tx.verificationToken.delete,
        ).toHaveBeenCalledWith({
            where: {
                token: expect.any(String),
            },
        });

        expect(
            tx.user.findUnique,
        ).not.toHaveBeenCalled();
    });

    it("rejects when the user associated with the token does not exist", async () => {
        const tx = createTransactionClient();

        tx.verificationToken.findUnique.mockResolvedValue({
            identifier: "missing@example.com",
            token: "valid-token-hash",
            expires: new Date(Date.now() + 60_000),
        });

        tx.user.findUnique.mockResolvedValue(null);

        mockSuccessfulTransaction(tx);

        await expect(
            verifyEmail("valid-token"),
        ).rejects.toMatchObject({
            code: "USER_NOT_FOUND",
            message:
                "Unable to verify this account.",
        });

        expect(
            tx.verificationToken.delete,
        ).not.toHaveBeenCalled();
    });

    it("verifies a pending user and activates the account", async () => {
        const tx = createTransactionClient();

        const user = {
            id: "user-1",
            name: "John Doe",
            email: "user@example.com",
            status: "PENDING",
            emailVerified: null,
        };

        const verifiedAt = new Date();

        tx.verificationToken.findUnique.mockResolvedValue({
            identifier: user.email,
            token: "valid-token-hash",
            expires: new Date(Date.now() + 60_000),
        });

        tx.user.findUnique.mockResolvedValue(user);

        tx.user.update.mockResolvedValue({
            id: user.id,
            name: user.name,
            email: user.email,
            status: "ACTIVE",
            emailVerified: verifiedAt,
        });

        mockSuccessfulTransaction(tx);

        const result = await verifyEmail(
            "valid-token",
        );

        expect(
            tx.user.update,
        ).toHaveBeenCalledWith({
            where: {
                id: user.id,
            },
            data: {
                emailVerified:
                    expect.any(Date),
                status: "ACTIVE",
            },
            select: {
                id: true,
                name: true,
                email: true,
                status: true,
                emailVerified: true,
            },
        });

        expect(
            tx.verificationToken.delete,
        ).toHaveBeenCalledWith({
            where: {
                token: expect.any(String),
            },
        });

        expect(result.user.id).toBe(
            user.id,
        );

        expect(result.user.email).toBe(
            user.email,
        );

        expect(result.user.status).toBe(
            "ACTIVE",
        );

        expect(
            result.user.emailVerified,
        ).toBeInstanceOf(Date);
    });

    it("does not change the status of an already active user", async () => {
        const tx = createTransactionClient();

        const verifiedAt = new Date(
            Date.now() - 86_400_000,
        );

        const user = {
            id: "user-2",
            name: "Active User",
            email: "active@example.com",
            status: "ACTIVE",
            emailVerified: verifiedAt,
        };

        tx.verificationToken.findUnique.mockResolvedValue({
            identifier: user.email,
            token: "valid-token-hash",
            expires: new Date(Date.now() + 60_000),
        });

        tx.user.findUnique.mockResolvedValue(user);

        mockSuccessfulTransaction(tx);

        const result = await verifyEmail(
            "valid-token",
        );

        expect(
            tx.user.update,
        ).not.toHaveBeenCalled();

        expect(
            tx.verificationToken.delete,
        ).toHaveBeenCalledWith({
            where: {
                token: expect.any(String),
            },
        });

        expect(result.user.id).toBe(
            user.id,
        );

        expect(result.user.status).toBe(
            "ACTIVE",
        );

        expect(
            result.user.emailVerified,
        ).toBe(verifiedAt);
    });

    it("consumes the verification token after successful verification", async () => {
        const tx = createTransactionClient();

        const user = {
            id: "user-3",
            name: "Jane Doe",
            email: "jane@example.com",
            status: "PENDING",
            emailVerified: null,
        };

        tx.verificationToken.findUnique.mockResolvedValue({
            identifier: user.email,
            token: "valid-token-hash",
            expires: new Date(Date.now() + 60_000),
        });

        tx.user.findUnique.mockResolvedValue(user);

        tx.user.update.mockResolvedValue({
            id: user.id,
            name: user.name,
            email: user.email,
            status: "ACTIVE",
            emailVerified: new Date(),
        });

        mockSuccessfulTransaction(tx);

        await verifyEmail("valid-token");

        expect(
            tx.verificationToken.delete,
        ).toHaveBeenCalledTimes(1);
    });

    it("uses a transaction for verification operations", async () => {
        const tx = createTransactionClient();

        tx.verificationToken.findUnique.mockResolvedValue(
            null,
        );

        mockSuccessfulTransaction(tx);

        await expect(
            verifyEmail("invalid-token"),
        ).rejects.toMatchObject({
            code: "INVALID_TOKEN",
        });

        expect(
            prismaMock.$transaction,
        ).toHaveBeenCalledTimes(1);

        expect(
            prismaMock.$transaction,
        ).toHaveBeenCalledWith(
            expect.any(Function),
        );
    });

    it("hashes the raw token before querying the database", async () => {
        const tx = createTransactionClient();

        tx.verificationToken.findUnique.mockResolvedValue(
            null,
        );

        mockSuccessfulTransaction(tx);

        await expect(
            verifyEmail("my-secret-token"),
        ).rejects.toMatchObject({
            code: "INVALID_TOKEN",
        });

        const call =
            tx.verificationToken.findUnique.mock
                .calls[0][0];

        expect(
            call.where.token,
        ).not.toBe("my-secret-token");

        expect(
            call.where.token,
        ).toMatch(/^[a-f0-9]{64}$/);
    });

    it("trims the raw token before hashing it", async () => {
        const tx = createTransactionClient();

        tx.verificationToken.findUnique.mockResolvedValue(
            null,
        );

        mockSuccessfulTransaction(tx);

        await expect(
            verifyEmail(
                "  my-secret-token  ",
            ),
        ).rejects.toMatchObject({
            code: "INVALID_TOKEN",
        });

        const call =
            tx.verificationToken.findUnique.mock
                .calls[0][0];

        expect(
            call.where.token,
        ).toMatch(/^[a-f0-9]{64}$/);
    });

    it("preserves non-pending user status when verifying", async () => {
        const tx = createTransactionClient();

        const user = {
            id: "user-4",
            name: "Suspended User",
            email: "suspended@example.com",
            status: "SUSPENDED",
            emailVerified: null,
        };

        tx.verificationToken.findUnique.mockResolvedValue({
            identifier: user.email,
            token: "valid-token-hash",
            expires: new Date(Date.now() + 60_000),
        });

        tx.user.findUnique.mockResolvedValue(user);

        tx.user.update.mockResolvedValue({
            id: user.id,
            name: user.name,
            email: user.email,
            status: "SUSPENDED",
            emailVerified: new Date(),
        });

        mockSuccessfulTransaction(tx);

        const result = await verifyEmail(
            "valid-token",
        );

        expect(
            tx.user.update,
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                data: expect.objectContaining({
                    status: "SUSPENDED",
                }),
            }),
        );

        expect(result.user.status).toBe(
            "SUSPENDED",
        );
    });
});