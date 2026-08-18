import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    userFindUnique: vi.fn(),
    userCreate: vi.fn(),
    userDelete: vi.fn(),
    verificationTokenDeleteMany: vi.fn(),
    bcryptHash: vi.fn(),
    createVerificationToken: vi.fn(),
    createVerificationUrl: vi.fn(),
    createVerificationEmail: vi.fn(),
    sendEmail: vi.fn(),
    transaction: vi.fn(),
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
            create: mocks.userCreate,
            delete: mocks.userDelete,
        },
        verificationToken: {
            deleteMany: mocks.verificationTokenDeleteMany,
        },
        $transaction: mocks.transaction,
    },
}));

vi.mock("@/lib/services/auth/verificationToken", () => ({
    createVerificationToken: mocks.createVerificationToken,
}));

vi.mock("@/lib/services/auth/verificationUrl", () => ({
    createVerificationUrl: mocks.createVerificationUrl,
}));

vi.mock("@/lib/services/email/templates/verification", () => ({
    createVerificationEmail: mocks.createVerificationEmail,
}));

vi.mock("@/lib/services/email/sendEmail", () => ({
    sendEmail: mocks.sendEmail,
}));

import {
    registerUser,
} from "@/lib/services/auth/registerUser";

describe("registerUser", () => {
    beforeEach(() => {
        vi.clearAllMocks();

        mocks.userFindUnique.mockResolvedValue(null);

        mocks.bcryptHash.mockResolvedValue(
            "hashed-password"
        );

        mocks.userCreate.mockResolvedValue({
            id: "user_123",
            name: "John Doe",
            email: "john@example.com",
            status: "PENDING",
        });

        mocks.createVerificationToken.mockResolvedValue({
            token: "raw-verification-token",
            expires: new Date(
                Date.now() + 24 * 60 * 60 * 1000
            ),
        });

        mocks.createVerificationUrl.mockReturnValue(
            "http://localhost:3000/verify-email?token=raw-verification-token"
        );

        mocks.createVerificationEmail.mockReturnValue({
            subject: "Verify your Aforden account",
            html: "<p>Verify your account</p>",
            text: "Verify your account",
        });

        mocks.sendEmail.mockResolvedValue({
            success: true,
            messageId: "email_123",
        });

        mocks.verificationTokenDeleteMany.mockResolvedValue(
            { count: 1 }
        );

        mocks.userDelete.mockResolvedValue({
            id: "user_123",
        });

        mocks.transaction.mockResolvedValue([]);
    });

    it("creates a pending user with a hashed password", async () => {
        const result = await registerUser({
            name: "John Doe",
            email: "John@Example.com",
            password: "StrongPass123",
        });

        expect(mocks.userFindUnique).toHaveBeenCalledWith({
            where: {
                email: "john@example.com",
            },
            select: {
                id: true,
            },
        });

        expect(mocks.bcryptHash).toHaveBeenCalledWith(
            "StrongPass123",
            12
        );

        expect(mocks.userCreate).toHaveBeenCalledWith({
            data: {
                name: "John Doe",
                email: "john@example.com",
                passwordHash: "hashed-password",
                status: "PENDING",
                emailVerified: null,
            },
            select: {
                id: true,
                name: true,
                email: true,
                status: true,
            },
        });

        expect(result.user).toEqual({
            id: "user_123",
            name: "John Doe",
            email: "john@example.com",
            status: "PENDING",
        });
    });

    it("creates a verification token and sends the verification email", async () => {
        await registerUser({
            name: "John Doe",
            email: "john@example.com",
            password: "StrongPass123",
        });

        expect(
            mocks.createVerificationToken
        ).toHaveBeenCalledWith(
            "john@example.com"
        );

        expect(
            mocks.createVerificationUrl
        ).toHaveBeenCalledWith(
            "raw-verification-token"
        );

        expect(
            mocks.createVerificationEmail
        ).toHaveBeenCalledWith({
            name: "John Doe",
            verificationUrl:
                "http://localhost:3000/verify-email?token=raw-verification-token",
        });

        expect(
            mocks.sendEmail
        ).toHaveBeenCalledWith({
            to: {
                email: "john@example.com",
                name: "John Doe",
            },
            subject:
                "Verify your Aforden account",
            html:
                "<p>Verify your account</p>",
            text:
                "Verify your account",
        });
    });

    it("rejects invalid registration data", async () => {
        await expect(
            registerUser({
                name: "J",
                email: "not-an-email",
                password: "weak",
            })
        ).rejects.toMatchObject({
            code: "VALIDATION_ERROR",
        });

        expect(
            mocks.userFindUnique
        ).not.toHaveBeenCalled();

        expect(
            mocks.userCreate
        ).not.toHaveBeenCalled();

        expect(
            mocks.sendEmail
        ).not.toHaveBeenCalled();
    });

    it("rejects an existing email", async () => {
        mocks.userFindUnique.mockResolvedValue({
            id: "existing_user",
        });

        await expect(
            registerUser({
                name: "John Doe",
                email: "john@example.com",
                password: "StrongPass123",
            })
        ).rejects.toMatchObject({
            code: "EMAIL_EXISTS",
        });

        expect(
            mocks.bcryptHash
        ).not.toHaveBeenCalled();

        expect(
            mocks.userCreate
        ).not.toHaveBeenCalled();

        expect(
            mocks.sendEmail
        ).not.toHaveBeenCalled();
    });

    it("cleans up the user and verification token when email delivery fails", async () => {
        mocks.sendEmail.mockRejectedValue(
            new Error("Email could not be sent.")
        );

        await expect(
            registerUser({
                name: "John Doe",
                email: "john@example.com",
                password: "StrongPass123",
            })
        ).rejects.toMatchObject({
            code: "EMAIL_DELIVERY_FAILED",
        });

        expect(
            mocks.verificationTokenDeleteMany
        ).toHaveBeenCalledWith({
            where: {
                identifier: "john@example.com",
            },
        });

        expect(
            mocks.userDelete
        ).toHaveBeenCalledWith({
            where: {
                id: "user_123",
            },
        });
    });

    it("never stores the plaintext password", async () => {
        await registerUser({
            name: "John Doe",
            email: "john@example.com",
            password: "StrongPass123",
        });

        const createCall =
            mocks.userCreate.mock.calls[0][0];

        expect(
            createCall.data.passwordHash
        ).toBe("hashed-password");

        expect(
            createCall.data.passwordHash
        ).not.toBe("StrongPass123");
    });

    it("does not create a workspace membership during registration", async () => {
        await registerUser({
            name: "John Doe",
            email: "john@example.com",
            password: "StrongPass123",
        });

        expect(
            mocks.userCreate
        ).toHaveBeenCalledTimes(1);

        expect(
            mocks.transaction
        ).not.toHaveBeenCalled();

        expect(
            mocks.sendEmail
        ).toHaveBeenCalledTimes(1);
    });
});