import {
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";

const mocks = vi.hoisted(() => ({
    userFindUnique: vi.fn(),

    passwordResetTokenFindUnique: vi.fn(),
    passwordResetTokenUpdateMany: vi.fn(),

    userUpdate: vi.fn(),

    sessionDeleteMany: vi.fn(),

    transaction: vi.fn(),

    bcryptHash: vi.fn(),

    createPasswordResetToken: vi.fn(),
    createPasswordResetUrl: vi.fn(),

    sendEmail: vi.fn(),
    createPasswordChangedEmail: vi.fn(),
}));

vi.mock("bcrypt", () => ({
    default: {
        hash: mocks.bcryptHash,
    },
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        user: {
            findUnique: mocks.userFindUnique,
            update: mocks.userUpdate,
        },

        passwordResetToken: {
            findUnique:
                mocks.passwordResetTokenFindUnique,

            updateMany:
                mocks.passwordResetTokenUpdateMany,
        },

        session: {
            deleteMany:
                mocks.sessionDeleteMany,
        },

        $transaction:
            mocks.transaction,
    },
}));

vi.mock(
    "@/lib/services/auth/passwordResetToken",
    () => ({
        createPasswordResetToken:
            mocks.createPasswordResetToken,

        hashPasswordResetToken: vi.fn(
            (token: string) =>
                `hashed-${token}`,
        ),
    }),
);

vi.mock(
    "@/lib/services/auth/passwordResetUrl",
    () => ({
        createPasswordResetUrl:
            mocks.createPasswordResetUrl,
    }),
);

vi.mock(
    "@/lib/services/email/sendEmail",
    () => ({
        sendEmail:
            mocks.sendEmail,
    }),
);

vi.mock(
    "@/lib/services/email/templates/passwordChanged",
    () => ({
        createPasswordChangedEmail:
            mocks.createPasswordChangedEmail,
    }),
);

import {
    requestPasswordReset,
} from "@/lib/services/auth/requestPasswordReset";

import {
    resetPassword,
} from "@/lib/services/auth/resetPassword";

describe("requestPasswordReset", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        mocks.userFindUnique.mockResolvedValue({
            id: "user-1",
            name: "John Doe",
            email: "john@example.com",
            status: "ACTIVE",
        });

        mocks.createPasswordResetToken.mockResolvedValue({
            token: "raw-reset-token",
            expiresAt: new Date(
                Date.now() + 30 * 60 * 1000,
            ),
        });

        mocks.createPasswordResetUrl.mockReturnValue(
            "http://localhost:3000/reset-password?token=raw-reset-token",
        );

        mocks.sendEmail.mockResolvedValue({
            success: true,
            messageId: "email-123",
        });
    });

    it("normalizes the email before querying the database", async () => {
        await requestPasswordReset(
            "  John@Example.COM  ",
        );

        expect(
            mocks.userFindUnique,
        ).toHaveBeenCalledWith({
            where: {
                email: "john@example.com",
            },
            select: {
                id: true,
                name: true,
                email: true,
                status: true,
            },
        });
    });

    it("does nothing when the account does not exist", async () => {
        mocks.userFindUnique.mockResolvedValue(
            null,
        );

        await requestPasswordReset(
            "unknown@example.com",
        );

        expect(
            mocks.createPasswordResetToken,
        ).not.toHaveBeenCalled();

        expect(
            mocks.createPasswordResetUrl,
        ).not.toHaveBeenCalled();

        expect(
            mocks.sendEmail,
        ).not.toHaveBeenCalled();
    });

    it("does not create a reset token for a deactivated account", async () => {
        mocks.userFindUnique.mockResolvedValue({
            id: "user-1",
            name: "John Doe",
            email: "john@example.com",
            status: "DEACTIVATED",
        });

        await requestPasswordReset(
            "john@example.com",
        );

        expect(
            mocks.createPasswordResetToken,
        ).not.toHaveBeenCalled();

        expect(
            mocks.sendEmail,
        ).not.toHaveBeenCalled();
    });

    it("creates a password reset token for an eligible account", async () => {
        await requestPasswordReset(
            "john@example.com",
        );

        expect(
            mocks.createPasswordResetToken,
        ).toHaveBeenCalledWith(
            "user-1",
        );
    });

    it("creates the reset URL using the raw token", async () => {
        await requestPasswordReset(
            "john@example.com",
        );

        expect(
            mocks.createPasswordResetUrl,
        ).toHaveBeenCalledWith(
            "raw-reset-token",
        );
    });

    it("sends the password reset email", async () => {
        await requestPasswordReset(
            "john@example.com",
        );

        expect(
            mocks.sendEmail,
        ).toHaveBeenCalledWith({
            to: {
                email: "john@example.com",
                name: "John Doe",
            },
            subject:
                "Reset your Aforden password",
            html: expect.stringContaining(
                "Reset your password",
            ),
            text: expect.stringContaining(
                "Reset your Aforden password",
            ),
        });
    });

    it("uses a safe fallback name when the user has no name", async () => {
        mocks.userFindUnique.mockResolvedValue({
            id: "user-1",
            name: null,
            email: "john@example.com",
            status: "ACTIVE",
        });

        await requestPasswordReset(
            "john@example.com",
        );

        expect(
            mocks.sendEmail,
        ).toHaveBeenCalledWith(
            expect.objectContaining({
                to: {
                    email: "john@example.com",
                    name: undefined,
                },
            }),
        );
    });

    it("does not expose account existence through the service result", async () => {
        mocks.userFindUnique.mockResolvedValue(
            null,
        );

        await expect(
            requestPasswordReset(
                "unknown@example.com",
            ),
        ).resolves.toBeUndefined();
    });

    it("does not expose the raw reset token through the database lookup", async () => {
        await requestPasswordReset(
            "john@example.com",
        );

        expect(
            mocks.createPasswordResetToken,
        ).toHaveBeenCalledWith(
            "user-1",
        );

        expect(
            mocks.createPasswordResetToken.mock
                .results[0].value,
        ).toBeDefined();
    });
});

describe("resetPassword", () => {
    function createTransactionClient() {
        return {
            passwordResetToken: {
                findUnique:
                    mocks.passwordResetTokenFindUnique,

                updateMany:
                    mocks.passwordResetTokenUpdateMany,
            },

            user: {
                findUnique:
                    mocks.userFindUnique,

                update:
                    mocks.userUpdate,
            },

            session: {
                deleteMany:
                    mocks.sessionDeleteMany,
            },
        };
    }

    function mockSuccessfulTransaction(
        tx: ReturnType<
            typeof createTransactionClient
        >,
    ) {
        mocks.transaction.mockImplementation(
            async (
                callback: (
                    transaction: typeof tx,
                ) => Promise<unknown>,
            ) => callback(tx),
        );
    }

    beforeEach(() => {
        vi.clearAllMocks();

        mocks.bcryptHash.mockResolvedValue(
            "hashed-new-password",
        );

        mocks.createPasswordChangedEmail.mockReturnValue(
            {
                subject:
                    "Your Aforden password was changed",
                html:
                    "<p>Your password was changed.</p>",
                text:
                    "Your password was changed.",
            },
        );

        mocks.sendEmail.mockResolvedValue({
            success: true,
            messageId: "email-456",
        });
    });

    it("rejects an empty reset token", async () => {
        await expect(
            resetPassword(
                "",
                "StrongPass123",
            ),
        ).rejects.toMatchObject({
            code: "INVALID_TOKEN",
        });

        expect(
            mocks.transaction,
        ).not.toHaveBeenCalled();
    });

    it("rejects a whitespace-only reset token", async () => {
        await expect(
            resetPassword(
                "   ",
                "StrongPass123",
            ),
        ).rejects.toMatchObject({
            code: "INVALID_TOKEN",
        });

        expect(
            mocks.transaction,
        ).not.toHaveBeenCalled();
    });

    it("rejects a password shorter than eight characters", async () => {
        await expect(
            resetPassword(
                "valid-token",
                "Short1A",
            ),
        ).rejects.toMatchObject({
            code: "WEAK_PASSWORD",
        });

        expect(
            mocks.transaction,
        ).not.toHaveBeenCalled();
    });

    it("rejects a password without an uppercase letter", async () => {
        await expect(
            resetPassword(
                "valid-token",
                "strongpass123",
            ),
        ).rejects.toMatchObject({
            code: "WEAK_PASSWORD",
        });

        expect(
            mocks.transaction,
        ).not.toHaveBeenCalled();
    });

    it("rejects a password without a lowercase letter", async () => {
        await expect(
            resetPassword(
                "valid-token",
                "STRONGPASS123",
            ),
        ).rejects.toMatchObject({
            code: "WEAK_PASSWORD",
        });

        expect(
            mocks.transaction,
        ).not.toHaveBeenCalled();
    });

    it("rejects a password without a number", async () => {
        await expect(
            resetPassword(
                "valid-token",
                "StrongPassword",
            ),
        ).rejects.toMatchObject({
            code: "WEAK_PASSWORD",
        });

        expect(
            mocks.transaction,
        ).not.toHaveBeenCalled();
    });

    it("rejects an invalid reset token", async () => {
        const tx =
            createTransactionClient();

        tx.passwordResetToken.findUnique.mockResolvedValue(
            null,
        );

        mockSuccessfulTransaction(tx);

        await expect(
            resetPassword(
                "invalid-token",
                "StrongPass123",
            ),
        ).rejects.toMatchObject({
            code: "INVALID_TOKEN",
        });

        expect(
            tx.passwordResetToken.findUnique,
        ).toHaveBeenCalledWith({
            where: {
                tokenHash:
                    "hashed-invalid-token",
            },
        });

        expect(
            tx.user.findUnique,
        ).not.toHaveBeenCalled();

        expect(
            tx.user.update,
        ).not.toHaveBeenCalled();
    });

    it("rejects an already-used reset token", async () => {
        const tx =
            createTransactionClient();

        tx.passwordResetToken.findUnique.mockResolvedValue(
            {
                id: "reset-1",
                userId: "user-1",
                tokenHash:
                    "hashed-valid-token",
                expiresAt: new Date(
                    Date.now() + 60_000,
                ),
                usedAt: new Date(),
            },
        );

        mockSuccessfulTransaction(tx);

        await expect(
            resetPassword(
                "valid-token",
                "StrongPass123",
            ),
        ).rejects.toMatchObject({
            code: "INVALID_TOKEN",
        });

        expect(
            tx.user.update,
        ).not.toHaveBeenCalled();
    });

    it("rejects an expired reset token", async () => {
        const tx =
            createTransactionClient();

        tx.passwordResetToken.findUnique.mockResolvedValue(
            {
                id: "reset-1",
                userId: "user-1",
                tokenHash:
                    "hashed-valid-token",
                expiresAt: new Date(
                    Date.now() - 60_000,
                ),
                usedAt: null,
            },
        );

        mockSuccessfulTransaction(tx);

        await expect(
            resetPassword(
                "valid-token",
                "StrongPass123",
            ),
        ).rejects.toMatchObject({
            code: "INVALID_TOKEN",
        });

        expect(
            tx.user.findUnique,
        ).not.toHaveBeenCalled();

        expect(
            tx.user.update,
        ).not.toHaveBeenCalled();
    });

    it("rejects when the user associated with the token does not exist", async () => {
        const tx =
            createTransactionClient();

        tx.passwordResetToken.findUnique.mockResolvedValue(
            {
                id: "reset-1",
                userId: "missing-user",
                tokenHash:
                    "hashed-valid-token",
                expiresAt: new Date(
                    Date.now() + 60_000,
                ),
                usedAt: null,
            },
        );

        tx.user.findUnique.mockResolvedValue(
            null,
        );

        mockSuccessfulTransaction(tx);

        await expect(
            resetPassword(
                "valid-token",
                "StrongPass123",
            ),
        ).rejects.toMatchObject({
            code: "USER_NOT_FOUND",
        });

        expect(
            tx.user.update,
        ).not.toHaveBeenCalled();
    });

    it("hashes the new password with bcrypt", async () => {
        const tx =
            createTransactionClient();

        tx.passwordResetToken.findUnique.mockResolvedValue(
            {
                id: "reset-1",
                userId: "user-1",
                tokenHash:
                    "hashed-valid-token",
                expiresAt: new Date(
                    Date.now() + 60_000,
                ),
                usedAt: null,
            },
        );

        tx.user.findUnique.mockResolvedValue({
            id: "user-1",
            name: "John Doe",
            email: "john@example.com",
            status: "ACTIVE",
        });

        tx.user.update.mockResolvedValue({
            id: "user-1",
            name: "John Doe",
            email: "john@example.com",
            status: "ACTIVE",
        });

        tx.passwordResetToken.updateMany.mockResolvedValue(
            {
                count: 1,
            },
        );

        tx.session.deleteMany.mockResolvedValue(
            {
                count: 2,
            },
        );

        mockSuccessfulTransaction(tx);

        await resetPassword(
            "valid-token",
            "StrongPass123",
        );

        expect(
            mocks.bcryptHash,
        ).toHaveBeenCalledWith(
            "StrongPass123",
            12,
        );
    });

    it("updates the user's password without storing the plaintext password", async () => {
        const tx =
            createTransactionClient();

        tx.passwordResetToken.findUnique.mockResolvedValue(
            {
                id: "reset-1",
                userId: "user-1",
                tokenHash:
                    "hashed-valid-token",
                expiresAt: new Date(
                    Date.now() + 60_000,
                ),
                usedAt: null,
            },
        );

        tx.user.findUnique.mockResolvedValue({
            id: "user-1",
            name: "John Doe",
            email: "john@example.com",
            status: "ACTIVE",
        });

        tx.user.update.mockResolvedValue({
            id: "user-1",
            name: "John Doe",
            email: "john@example.com",
            status: "ACTIVE",
        });

        tx.passwordResetToken.updateMany.mockResolvedValue(
            {
                count: 1,
            },
        );

        tx.session.deleteMany.mockResolvedValue(
            {
                count: 2,
            },
        );

        mockSuccessfulTransaction(tx);

        await resetPassword(
            "valid-token",
            "StrongPass123",
        );

        expect(
            tx.user.update,
        ).toHaveBeenCalledWith({
            where: {
                id: "user-1",
            },
            data: {
                passwordHash:
                    "hashed-new-password",
            },
        });

        const updateCall =
            tx.user.update.mock.calls[0][0];

        expect(
            updateCall.data.passwordHash,
        ).not.toBe("StrongPass123");
    });

    it("invalidates all unused password reset tokens for the user", async () => {
        const tx =
            createTransactionClient();

        tx.passwordResetToken.findUnique.mockResolvedValue(
            {
                id: "reset-1",
                userId: "user-1",
                tokenHash:
                    "hashed-valid-token",
                expiresAt: new Date(
                    Date.now() + 60_000,
                ),
                usedAt: null,
            },
        );

        tx.user.findUnique.mockResolvedValue({
            id: "user-1",
            name: "John Doe",
            email: "john@example.com",
            status: "ACTIVE",
        });

        tx.user.update.mockResolvedValue({
            id: "user-1",
            name: "John Doe",
            email: "john@example.com",
            status: "ACTIVE",
        });

        tx.passwordResetToken.updateMany.mockResolvedValue(
            {
                count: 2,
            },
        );

        tx.session.deleteMany.mockResolvedValue(
            {
                count: 2,
            },
        );

        mockSuccessfulTransaction(tx);

        await resetPassword(
            "valid-token",
            "StrongPass123",
        );

        expect(
            tx.passwordResetToken.updateMany,
        ).toHaveBeenCalledWith({
            where: {
                userId: "user-1",
                usedAt: null,
            },
            data: {
                usedAt:
                    expect.any(Date),
            },
        });
    });

    it("invalidates all existing sessions after password reset", async () => {
        const tx =
            createTransactionClient();

        tx.passwordResetToken.findUnique.mockResolvedValue(
            {
                id: "reset-1",
                userId: "user-1",
                tokenHash:
                    "hashed-valid-token",
                expiresAt: new Date(
                    Date.now() + 60_000,
                ),
                usedAt: null,
            },
        );

        tx.user.findUnique.mockResolvedValue({
            id: "user-1",
            name: "John Doe",
            email: "john@example.com",
            status: "ACTIVE",
        });

        tx.user.update.mockResolvedValue({
            id: "user-1",
            name: "John Doe",
            email: "john@example.com",
            status: "ACTIVE",
        });

        tx.passwordResetToken.updateMany.mockResolvedValue(
            {
                count: 1,
            },
        );

        tx.session.deleteMany.mockResolvedValue(
            {
                count: 3,
            },
        );

        mockSuccessfulTransaction(tx);

        await resetPassword(
            "valid-token",
            "StrongPass123",
        );

        expect(
            tx.session.deleteMany,
        ).toHaveBeenCalledWith({
            where: {
                userId: "user-1",
            },
        });
    });

    it("sends a password-changed notification after a successful reset", async () => {
        const tx =
            createTransactionClient();

        tx.passwordResetToken.findUnique.mockResolvedValue(
            {
                id: "reset-1",
                userId: "user-1",
                tokenHash:
                    "hashed-valid-token",
                expiresAt: new Date(
                    Date.now() + 60_000,
                ),
                usedAt: null,
            },
        );

        tx.user.findUnique.mockResolvedValue({
            id: "user-1",
            name: "John Doe",
            email: "john@example.com",
            status: "ACTIVE",
        });

        tx.user.update.mockResolvedValue({
            id: "user-1",
            name: "John Doe",
            email: "john@example.com",
            status: "ACTIVE",
        });

        tx.passwordResetToken.updateMany.mockResolvedValue(
            {
                count: 1,
            },
        );

        tx.session.deleteMany.mockResolvedValue(
            {
                count: 2,
            },
        );

        mockSuccessfulTransaction(tx);

        await resetPassword(
            "valid-token",
            "StrongPass123",
        );

        expect(
            mocks.createPasswordChangedEmail,
        ).toHaveBeenCalledWith({
            name: "John Doe",
        });

        expect(
            mocks.sendEmail,
        ).toHaveBeenCalledWith({
            to: {
                email: "john@example.com",
                name: "John Doe",
            },
            subject:
                "Your Aforden password was changed",
            html:
                "<p>Your password was changed.</p>",
            text:
                "Your password was changed.",
        });
    });

    it("does not roll back the password reset when notification email fails", async () => {
        const tx =
            createTransactionClient();

        tx.passwordResetToken.findUnique.mockResolvedValue(
            {
                id: "reset-1",
                userId: "user-1",
                tokenHash:
                    "hashed-valid-token",
                expiresAt: new Date(
                    Date.now() + 60_000,
                ),
                usedAt: null,
            },
        );

        tx.user.findUnique.mockResolvedValue({
            id: "user-1",
            name: "John Doe",
            email: "john@example.com",
            status: "ACTIVE",
        });

        tx.user.update.mockResolvedValue({
            id: "user-1",
            name: "John Doe",
            email: "john@example.com",
            status: "ACTIVE",
        });

        tx.passwordResetToken.updateMany.mockResolvedValue(
            {
                count: 1,
            },
        );

        tx.session.deleteMany.mockResolvedValue(
            {
                count: 2,
            },
        );

        mocks.sendEmail.mockRejectedValue(
            new Error(
                "Email delivery failed",
            ),
        );

        mockSuccessfulTransaction(tx);

        await expect(
            resetPassword(
                "valid-token",
                "StrongPass123",
            ),
        ).resolves.toMatchObject({
            id: "user-1",
            email: "john@example.com",
        });

        expect(
            tx.user.update,
        ).toHaveBeenCalled();

        expect(
            tx.session.deleteMany,
        ).toHaveBeenCalled();

        expect(
            tx.passwordResetToken.updateMany,
        ).toHaveBeenCalled();
    });

    it("uses a database transaction for the reset operation", async () => {
        const tx =
            createTransactionClient();

        tx.passwordResetToken.findUnique.mockResolvedValue(
            null,
        );

        mockSuccessfulTransaction(tx);

        await expect(
            resetPassword(
                "invalid-token",
                "StrongPass123",
            ),
        ).rejects.toMatchObject({
            code: "INVALID_TOKEN",
        });

        expect(
            mocks.transaction,
        ).toHaveBeenCalledTimes(1);

        expect(
            mocks.transaction,
        ).toHaveBeenCalledWith(
            expect.any(Function),
        );
    });

    it("does not update the password when the token is invalid", async () => {
        const tx =
            createTransactionClient();

        tx.passwordResetToken.findUnique.mockResolvedValue(
            null,
        );

        mockSuccessfulTransaction(tx);

        await expect(
            resetPassword(
                "invalid-token",
                "StrongPass123",
            ),
        ).rejects.toMatchObject({
            code: "INVALID_TOKEN",
        });

        expect(
            tx.user.update,
        ).not.toHaveBeenCalled();

        expect(
            tx.session.deleteMany,
        ).not.toHaveBeenCalled();
    });
});