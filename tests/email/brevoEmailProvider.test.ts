/**
 * Phase 1.23.3 — BrevoEmailProvider Unit Tests
 * Verifies payload construction, template integration, error mapping, and factory selection.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BrevoEmailProvider, BrevoDeliveryError } from "@/lib/services/email/brevoProvider";
import { ResendEmailProvider, getEmailProvider, resetEmailProvider } from "@/lib/services/email/provider";
import { createVerificationEmail } from "@/lib/services/email/templates/verification";
import { createPasswordResetEmail } from "@/lib/services/email/templates/passwordReset";
import { createInvitationEmail } from "@/lib/services/email/templates/invitation";
import { createPasswordChangedEmail } from "@/lib/services/email/templates/passwordChanged";
import { MembershipRole } from "@/generated/prisma/client";

describe("Phase 1.23.3 — BrevoEmailProvider", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    resetEmailProvider();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetEmailProvider();
    vi.restoreAllMocks();
  });

  describe("1. Payload Structure and Headers", () => {
    it("formats request correctly for Brevo v3 Transactional Email API", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ messageId: "<202609041200.brevo.test@smtp-relay.brevo.com>" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const provider = new BrevoEmailProvider({
        apiKey: "xkeysib-test-key-12345",
        from: { name: "Aforden", email: "notifications@aforden.com" },
      });

      const result = await provider.send({
        to: { name: "Test User", email: "user@example.com" },
        subject: "Welcome to Aforden",
        html: "<p>Hello User</p>",
        text: "Hello User",
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("<202609041200.brevo.test@smtp-relay.brevo.com>");
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.brevo.com/v3/smtp/email");
      expect(options.method).toBe("POST");
      expect(options.headers["api-key"]).toBe("xkeysib-test-key-12345");
      expect(options.headers["content-type"]).toBe("application/json");

      const parsedBody = JSON.parse(options.body);
      expect(parsedBody.sender).toEqual({ name: "Aforden", email: "notifications@aforden.com" });
      expect(parsedBody.to).toEqual([{ name: "Test User", email: "user@example.com" }]);
      expect(parsedBody.subject).toBe("Welcome to Aforden");
      expect(parsedBody.htmlContent).toBe("<p>Hello User</p>");
      expect(parsedBody.textContent).toBe("Hello User");
    });

    it("normalizes array of recipient emails and handles plain from address", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ messageId: "msg_array_recipients" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const provider = new BrevoEmailProvider({
        apiKey: "xkeysib-test-key-12345",
        from: { name: "Aforden Notifications", email: "plain@aforden.com" },
      });

      const result = await provider.send({
        to: [
          { email: "admin1@example.com" },
          { name: "Admin Two", email: "admin2@example.com" },
        ],
        subject: "Multi-recipient Notification",
        html: "<p>System Alert</p>",
        text: "System Alert",
      });

      expect(result.success).toBe(true);
      const parsedBody = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(parsedBody.sender).toEqual({ name: "Aforden Notifications", email: "plain@aforden.com" });
      expect(parsedBody.to).toEqual([
        { email: "admin1@example.com" },
        { name: "Admin Two", email: "admin2@example.com" },
      ]);
      expect(parsedBody.textContent).toBe("System Alert");
    });
  });

  describe("2. Send Paths for Standard Transactional Templates", () => {
    it("sends verification email using verification template", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ messageId: "msg_verify_123" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const provider = new BrevoEmailProvider({ apiKey: "test-api-key" });
      const template = createVerificationEmail({
        name: "Alice",
        verificationUrl: "https://aforden.com/verify?token=xyz",
      });

      const result = await provider.send({
        to: { name: "Alice", email: "newuser@example.com" },
        subject: template.subject,
        html: template.html,
        text: template.text,
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe("msg_verify_123");

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.to).toEqual([{ name: "Alice", email: "newuser@example.com" }]);
      expect(body.subject).toBe("Verify your Aforden account");
      expect(body.htmlContent).toContain("https://aforden.com/verify?token=xyz");
      expect(body.textContent).toContain("https://aforden.com/verify?token=xyz");
    });

    it("sends password reset email using reset template", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ messageId: "msg_reset_123" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const provider = new BrevoEmailProvider({ apiKey: "test-api-key" });
      const template = createPasswordResetEmail({
        name: "Bob",
        resetUrl: "https://aforden.com/reset?token=abc",
      });

      const result = await provider.send({
        to: { name: "Bob", email: "reset@example.com" },
        subject: template.subject,
        html: template.html,
      });

      expect(result.success).toBe(true);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.subject).toBe("Reset your Aforden password");
      expect(body.htmlContent).toContain("https://aforden.com/reset?token=abc");
    });

    it("sends workspace invitation email using invitation template", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ messageId: "msg_invite_123" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const provider = new BrevoEmailProvider({ apiKey: "test-api-key" });
      const template = createInvitationEmail({
        workspaceName: "Acme HVAC Services",
        inviterName: "Charlie",
        recipientEmail: "invitee@example.com",
        role: MembershipRole.ADMIN,
        acceptUrl: "https://aforden.com/invite?token=inv_99",
        expiresAt: new Date(Date.now() + 86400000),
      });

      const result = await provider.send({
        to: { email: "invitee@example.com" },
        subject: template.subject,
        html: template.html,
        text: template.text,
      });

      expect(result.success).toBe(true);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.subject).toContain("Acme HVAC Services");
      expect(body.htmlContent).toContain("https://aforden.com/invite?token=inv_99");
    });

    it("sends password changed confirmation email", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ messageId: "msg_changed_123" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const provider = new BrevoEmailProvider({ apiKey: "test-api-key" });
      const template = createPasswordChangedEmail({
        name: "Dana",
      });

      const result = await provider.send({
        to: { name: "Dana", email: "changed@example.com" },
        subject: template.subject,
        html: template.html,
      });

      expect(result.success).toBe(true);
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body.subject).toBe("Your Aforden password was changed");
      expect(body.htmlContent).toContain("Dana");
    });
  });

  describe("3. Error Handling and Status Code Mapping", () => {
    it("handles 401 Unauthorized as non-retryable error", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ code: "unauthorized", message: "Key not found" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const provider = new BrevoEmailProvider({ apiKey: "invalid-key" });
      await expect(
        provider.send({
          to: { email: "user@example.com" },
          subject: "Test",
          html: "<p>Test</p>",
        })
      ).rejects.toMatchObject({
        name: "BrevoDeliveryError",
        statusCode: 401,
        isRetryable: false,
        code: "unauthorized",
      });
    });

    it("handles 429 Rate Limit as retryable error", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ code: "too_many_requests", message: "Rate limit exceeded" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const provider = new BrevoEmailProvider({ apiKey: "valid-key" });
      await expect(
        provider.send({
          to: { email: "user@example.com" },
          subject: "Test",
          html: "<p>Test</p>",
        })
      ).rejects.toMatchObject({
        name: "BrevoDeliveryError",
        statusCode: 429,
        isRetryable: true,
      });
    });

    it("handles 400 Bad Request as non-retryable validation error", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ code: "invalid_parameter", message: "Invalid email address format" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const provider = new BrevoEmailProvider({ apiKey: "valid-key" });
      await expect(
        provider.send({
          to: { email: "malformed-email" },
          subject: "Test",
          html: "<p>Test</p>",
        })
      ).rejects.toMatchObject({
        name: "BrevoDeliveryError",
        statusCode: 400,
        isRetryable: false,
      });
    });

    it("handles 500 Server Error as retryable", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ code: "internal_server_error", message: "Brevo service unavailable" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const provider = new BrevoEmailProvider({ apiKey: "valid-key" });
      await expect(
        provider.send({
          to: { email: "user@example.com" },
          subject: "Test",
          html: "<p>Test</p>",
        })
      ).rejects.toMatchObject({
        name: "BrevoDeliveryError",
        statusCode: 500,
        isRetryable: true,
      });
    });

    it("handles network fetch timeout as retryable error", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error("Connect ECONNREFUSED 104.18.25.10:443"));
      vi.stubGlobal("fetch", fetchMock);

      const provider = new BrevoEmailProvider({ apiKey: "valid-key" });
      await expect(
        provider.send({
          to: { email: "user@example.com" },
          subject: "Test",
          html: "<p>Test</p>",
        })
      ).rejects.toMatchObject({
        name: "BrevoDeliveryError",
        statusCode: 504,
        isRetryable: true,
      });
    });

    it("returns error when API key is missing", async () => {
      delete process.env.BREVO_API_KEY;
      const provider = new BrevoEmailProvider({ apiKey: "" });

      await expect(
        provider.send({
          to: { email: "user@example.com" },
          subject: "Test",
          html: "<p>Test</p>",
        })
      ).rejects.toMatchObject({
        name: "BrevoDeliveryError",
        code: "CONFIG_ERROR",
        isRetryable: false,
      });
    });
  });

  describe("4. Provider Selection & Factory Integration", () => {
    it("returns BrevoEmailProvider when BREVO_API_KEY is configured", () => {
      process.env.BREVO_API_KEY = "xkeysib-brevo-active";
      delete process.env.RESEND_API_KEY;
      delete process.env.EMAIL_PROVIDER;

      const provider = getEmailProvider();
      expect(provider).toBeInstanceOf(BrevoEmailProvider);
      expect(provider.name).toBe("Brevo");
    });

    it("returns BrevoEmailProvider when EMAIL_PROVIDER=BREVO explicitly set", () => {
      process.env.EMAIL_PROVIDER = "BREVO";
      process.env.BREVO_API_KEY = "xkeysib-brevo-active";
      process.env.RESEND_API_KEY = "re_resend_active";

      const provider = getEmailProvider();
      expect(provider).toBeInstanceOf(BrevoEmailProvider);
      expect(provider.name).toBe("Brevo");
    });

    it("returns ResendEmailProvider when EMAIL_PROVIDER=RESEND explicitly set", () => {
      process.env.EMAIL_PROVIDER = "RESEND";
      process.env.BREVO_API_KEY = "xkeysib-brevo-active";
      process.env.RESEND_API_KEY = "re_resend_active";

      const provider = getEmailProvider();
      expect(provider).toBeInstanceOf(ResendEmailProvider);
      expect(provider.name).toBe("Resend");
    });

    it("falls back to ResendEmailProvider when only RESEND_API_KEY is present without EMAIL_PROVIDER", () => {
      delete process.env.BREVO_API_KEY;
      delete process.env.EMAIL_PROVIDER;
      process.env.RESEND_API_KEY = "re_resend_active";

      const provider = getEmailProvider();
      expect(provider).toBeInstanceOf(ResendEmailProvider);
      expect(provider.name).toBe("Resend");
    });
  });
});
