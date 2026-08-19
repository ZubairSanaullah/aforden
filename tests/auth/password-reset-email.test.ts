import {
    describe,
    expect,
    it,
} from "vitest";

import {
    createPasswordResetEmail,
} from "@/lib/services/email/templates/passwordReset";

describe("createPasswordResetEmail", () => {
    const resetUrl =
        "http://localhost:3000/reset-password?token=secret-token";

    it("creates the correct subject", () => {
        const result =
            createPasswordResetEmail({
                name: "John Doe",
                resetUrl,
            });

        expect(result.subject).toBe(
            "Reset your Aforden password"
        );
    });

    it("includes the recipient name", () => {
        const result =
            createPasswordResetEmail({
                name: "John Doe",
                resetUrl,
            });

        expect(result.html).toContain(
            "John Doe"
        );

        expect(result.text).toContain(
            "John Doe"
        );
    });

    it("includes the reset URL in the HTML email", () => {
        const result =
            createPasswordResetEmail({
                name: "John Doe",
                resetUrl,
            });

        expect(result.html).toContain(
            `href="${resetUrl}"`
        );
    });

    it("includes the reset URL in the plaintext email", () => {
        const result =
            createPasswordResetEmail({
                name: "John Doe",
                resetUrl,
            });

        expect(result.text).toContain(
            resetUrl
        );
    });

    it("includes the expiration notice", () => {
        const result =
            createPasswordResetEmail({
                name: "John Doe",
                resetUrl,
            });

        expect(result.html).toContain(
            "30 minutes"
        );

        expect(result.text).toContain(
            "30 minutes"
        );
    });

    it("includes the safe ignore message", () => {
        const result =
            createPasswordResetEmail({
                name: "John Doe",
                resetUrl,
            });

        expect(result.html).toContain(
            "you can safely ignore this email"
        );

        expect(result.text).toContain(
            "you can safely ignore this email"
        );
    });

    it("escapes HTML in the recipient name", () => {
        const result =
            createPasswordResetEmail({
                name:
                    '<script>alert("xss")</script>',
                resetUrl,
            });

        expect(result.html).not.toContain(
            "<script>alert"
        );

        expect(result.html).toContain(
            "&lt;script&gt;"
        );
    });

    it("escapes HTML in the reset URL", () => {
        const maliciousUrl =
            'https://example.com/reset?x="test"';

        const result =
            createPasswordResetEmail({
                name: "John Doe",
                resetUrl: maliciousUrl,
            });

        expect(result.html).not.toContain(
            `href="${maliciousUrl}"`
        );

        expect(result.html).toContain(
            "&quot;"
        );
    });

    it("provides both HTML and plaintext versions", () => {
        const result =
            createPasswordResetEmail({
                name: "John Doe",
                resetUrl,
            });

        expect(result.html).toBeTruthy();
        expect(result.text).toBeTruthy();
    });

    it("does not include sensitive database information", () => {
        const result =
            createPasswordResetEmail({
                name: "John Doe",
                resetUrl,
            });

        expect(result.html).not.toContain(
            "passwordHash"
        );

        expect(result.html).not.toContain(
            "userId"
        );

        expect(result.text).not.toContain(
            "passwordHash"
        );

        expect(result.text).not.toContain(
            "userId"
        );
    });

    it("uses the Aforden team signature", () => {
        const result =
            createPasswordResetEmail({
                name: "John Doe",
                resetUrl,
            });

        expect(result.html).toContain(
            "The Aforden Team"
        );

        expect(result.text).toContain(
            "The Aforden Team"
        );
    });
});