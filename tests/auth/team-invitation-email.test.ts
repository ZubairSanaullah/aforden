import { describe, expect, it } from "vitest";

import {
    createInvitationEmail,
} from "@/lib/services/email/templates/invitation";

/**
 * Invitation Email Template Test Suite — 1.2.16
 *
 * Verifies the HTML and plaintext invitation email template:
 *   - Correct subject line
 *   - Workspace name included
 *   - Inviter name included
 *   - Recipient email included
 *   - Role label included
 *   - Accept URL included
 *   - Expiration info included
 *   - HTML escaping for all user-controlled fields
 *   - Plaintext version exists and is non-empty
 *   - No sensitive DB information present
 */

const FUTURE_DATE = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

function makeInput(overrides: Record<string, unknown> = {}) {
    return {
        workspaceName: "Acme Corp",
        inviterName: "Alice Owner",
        recipientEmail: "bob@example.com",
        role: "TECHNICIAN" as const,
        acceptUrl: "https://app.example.com/invitations/accept?token=abc123def456",
        expiresAt: FUTURE_DATE,
        ...overrides,
    };
}

describe("createInvitationEmail", () => {
    it("returns a subject containing the workspace name", () => {
        const { subject } = createInvitationEmail(makeInput());
        expect(subject).toContain("Acme Corp");
    });

    it("returns a subject containing 'invited'", () => {
        const { subject } = createInvitationEmail(makeInput());
        expect(subject.toLowerCase()).toContain("invited");
    });

    it("HTML includes workspace name", () => {
        const { html } = createInvitationEmail(makeInput());
        expect(html).toContain("Acme Corp");
    });

    it("HTML includes inviter name", () => {
        const { html } = createInvitationEmail(makeInput());
        expect(html).toContain("Alice Owner");
    });

    it("HTML includes recipient email", () => {
        const { html } = createInvitationEmail(makeInput());
        expect(html).toContain("bob@example.com");
    });

    it("HTML includes human-readable role label", () => {
        const { html } = createInvitationEmail(makeInput());
        // TECHNICIAN should render as "Technician"
        expect(html).toContain("Technician");
    });

    it("HTML includes the accept URL", () => {
        const { html } = createInvitationEmail(makeInput());
        expect(html).toContain(
            "https://app.example.com/invitations/accept?token=abc123def456",
        );
    });

    it("HTML includes expiration date information", () => {
        const { html } = createInvitationEmail(makeInput());
        // Should contain some recognizable date fragment.
        const year = FUTURE_DATE.getFullYear().toString();
        expect(html).toContain(year);
    });

    it("plaintext version is non-empty", () => {
        const { text } = createInvitationEmail(makeInput());
        expect(typeof text).toBe("string");
        expect(text.length).toBeGreaterThan(50);
    });

    it("plaintext includes workspace name", () => {
        const { text } = createInvitationEmail(makeInput());
        expect(text).toContain("Acme Corp");
    });

    it("plaintext includes the accept URL", () => {
        const { text } = createInvitationEmail(makeInput());
        expect(text).toContain(
            "https://app.example.com/invitations/accept?token=abc123def456",
        );
    });

    it("plaintext includes expiration information", () => {
        const { text } = createInvitationEmail(makeInput());
        const year = FUTURE_DATE.getFullYear().toString();
        expect(text).toContain(year);
    });

    it("HTML escapes workspace name with XSS payload", () => {
        const { html } = createInvitationEmail(
            makeInput({ workspaceName: '<script>alert("xss")</script>' }),
        );

        expect(html).not.toContain("<script>");
        expect(html).toContain("&lt;script&gt;");
    });

    it("HTML escapes inviter name with XSS payload", () => {
        const { html } = createInvitationEmail(
            makeInput({ inviterName: '<img src=x onerror="pwn()">' }),
        );

        expect(html).not.toContain("<img");
        expect(html).toContain("&lt;img");
    });

    it("HTML escapes recipient email with special characters", () => {
        const { html } = createInvitationEmail(
            makeInput({ recipientEmail: 'user+"test"@example.com' }),
        );

        // The double-quote should be escaped.
        expect(html).not.toContain('"test"');
        expect(html).toContain("&quot;test&quot;");
    });

    it("does not include any tokenHash-like content (64-char hex string)", () => {
        // The template should never receive or display a raw hash.
        const { html, text } = createInvitationEmail(makeInput());

        // Check that no standalone 64-char hex string appears (SHA-256 hash signature).
        const hexPattern = /\b[a-f0-9]{64}\b/;
        expect(hexPattern.test(html)).toBe(false);
        expect(hexPattern.test(text)).toBe(false);
    });

    it("ADMIN role renders as 'Administrator'", () => {
        const { html } = createInvitationEmail(
            makeInput({ role: "ADMIN" }),
        );
        expect(html).toContain("Administrator");
    });

    it("MANAGER role renders as 'Manager'", () => {
        const { html } = createInvitationEmail(
            makeInput({ role: "MANAGER" }),
        );
        expect(html).toContain("Manager");
    });

    it("DISPATCHER role renders as 'Dispatcher'", () => {
        const { html } = createInvitationEmail(
            makeInput({ role: "DISPATCHER" }),
        );
        expect(html).toContain("Dispatcher");
    });

    it("ACCOUNTANT role renders as 'Accountant'", () => {
        const { html } = createInvitationEmail(
            makeInput({ role: "ACCOUNTANT" }),
        );
        expect(html).toContain("Accountant");
    });

    it("includes safe fallback messaging about ignoring the email", () => {
        const { html } = createInvitationEmail(makeInput());
        expect(html.toLowerCase()).toContain("safely ignore");
    });

    it("HTML is valid enough to contain DOCTYPE declaration", () => {
        const { html } = createInvitationEmail(makeInput());
        expect(html).toContain("<!DOCTYPE html>");
    });

    it("does not contain raw database IDs in the output", () => {
        const { html, text } = createInvitationEmail(makeInput());

        // cuid-style IDs (e.g. "cltxyz123...") should not be in the email.
        // The template only receives workspace name, inviter name, email, role,
        // URL, and date — no DB identifiers.
        expect(html).not.toContain("workspace-1");
        expect(html).not.toContain("user-1");
        expect(text).not.toContain("workspace-1");
        expect(text).not.toContain("user-1");
    });
});
