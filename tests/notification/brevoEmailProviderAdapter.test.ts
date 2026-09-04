/**
 * Phase 1.23.3 — BrevoEmailProviderAdapter Unit Tests
 * Verifies multi-channel notification adapter error classifications, payload dispatch,
 * and NotificationProviderFactory integration.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  BrevoEmailProviderAdapter,
  ResendEmailProviderAdapter,
  MockEmailProviderAdapter,
  NotificationProviderFactory,
} from "@/lib/services/notification";

describe("Phase 1.23.3 — BrevoEmailProviderAdapter", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    NotificationProviderFactory.reset();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    NotificationProviderFactory.reset();
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  describe("1. Delivery Dispatch & Payload Mapping", () => {
    it("successfully sends an email via Brevo REST API", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ messageId: "<brevo-msg-999@smtp-relay.brevo.com>" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new BrevoEmailProviderAdapter("xkeysib-test-12345");
      const result = await adapter.sendEmail({
        workspaceId: "ws_acme",
        to: "technician@example.com",
        subject: "Work Order WO-101 Assigned",
        bodyHtml: "<h1>Work Order Assigned</h1><p>Please check your schedule.</p>",
        bodyText: "Work Order Assigned. Please check your schedule.",
      });

      expect(result.success).toBe(true);
      expect(result.providerMessageId).toBe("<brevo-msg-999@smtp-relay.brevo.com>");
      expect(result.isRetryable).toBe(false);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe("https://api.brevo.com/v3/smtp/email");
      expect(options.method).toBe("POST");
      expect(options.headers["api-key"]).toBe("xkeysib-test-12345");

      const body = JSON.parse(options.body);
      expect(body.to).toEqual([{ email: "technician@example.com" }]);
      expect(body.subject).toBe("Work Order WO-101 Assigned");
      expect(body.htmlContent).toBe("<h1>Work Order Assigned</h1><p>Please check your schedule.</p>");
      expect(body.textContent).toBe("Work Order Assigned. Please check your schedule.");
    });

    it("gracefully handles unconfigured/missing API key", async () => {
      delete process.env.BREVO_API_KEY;
      const adapter = new BrevoEmailProviderAdapter("");

      const result = await adapter.sendEmail({
        workspaceId: "ws_acme",
        to: "technician@example.com",
        subject: "Test",
        bodyText: "Test body",
      });

      expect(result.success).toBe(false);
      expect(result.errorCode).toBe("BREVO_NOT_CONFIGURED");
      expect(result.isRetryable).toBe(false);
    });
  });

  describe("2. Error Classification (Retryable vs Non-Retryable)", () => {
    it("classifies 401 Unauthorized as non-retryable", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ message: "Invalid API key", code: "unauthorized" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new BrevoEmailProviderAdapter("bad-key");
      const result = await adapter.sendEmail({
        workspaceId: "ws_acme",
        to: "technician@example.com",
        subject: "Test",
        bodyText: "Test",
      });

      expect(result.success).toBe(false);
      expect(result.isRetryable).toBe(false);
      expect(result.errorCode).toBe("unauthorized");
    });

    it("classifies 400 Bad Request as non-retryable", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        json: async () => ({ message: "Malformed recipient", code: "invalid_parameter" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new BrevoEmailProviderAdapter("good-key");
      const result = await adapter.sendEmail({
        workspaceId: "ws_acme",
        to: "not-an-email",
        subject: "Test",
        bodyText: "Test",
      });

      expect(result.success).toBe(false);
      expect(result.isRetryable).toBe(false);
      expect(result.errorCode).toBe("invalid_parameter");
    });

    it("classifies 429 Rate Limit as retryable", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ message: "Too Many Requests" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new BrevoEmailProviderAdapter("good-key");
      const result = await adapter.sendEmail({
        workspaceId: "ws_acme",
        to: "technician@example.com",
        subject: "Test",
        bodyText: "Test",
      });

      expect(result.success).toBe(false);
      expect(result.isRetryable).toBe(true);
      expect(result.errorCode).toBe("BREVO_HTTP_429");
    });

    it("classifies 500 Internal Server Error as retryable", async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ message: "Internal error" }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new BrevoEmailProviderAdapter("good-key");
      const result = await adapter.sendEmail({
        workspaceId: "ws_acme",
        to: "technician@example.com",
        subject: "Test",
        bodyText: "Test",
      });

      expect(result.success).toBe(false);
      expect(result.isRetryable).toBe(true);
      expect(result.errorCode).toBe("BREVO_HTTP_500");
    });

    it("classifies network exception as retryable", async () => {
      const fetchMock = vi.fn().mockRejectedValue(new Error("Connection reset by peer"));
      vi.stubGlobal("fetch", fetchMock);

      const adapter = new BrevoEmailProviderAdapter("good-key");
      const result = await adapter.sendEmail({
        workspaceId: "ws_acme",
        to: "technician@example.com",
        subject: "Test",
        bodyText: "Test",
      });

      expect(result.success).toBe(false);
      expect(result.isRetryable).toBe(true);
      expect(result.errorMessage).toContain("Connection reset by peer");
    });
  });

  describe("3. NotificationProviderFactory Selection", () => {
    it("selects BrevoEmailProviderAdapter when EMAIL_PROVIDER=BREVO", () => {
      process.env.EMAIL_PROVIDER = "BREVO";
      process.env.BREVO_API_KEY = "xkeysib-test";
      process.env.RESEND_API_KEY = "re_test";

      const provider = NotificationProviderFactory.getEmailProvider();
      expect(provider).toBeInstanceOf(BrevoEmailProviderAdapter);
      expect(provider.name).toBe("BREVO");
    });

    it("selects BrevoEmailProviderAdapter by default when BREVO_API_KEY is present without EMAIL_PROVIDER", () => {
      delete process.env.EMAIL_PROVIDER;
      process.env.BREVO_API_KEY = "xkeysib-test";
      delete process.env.RESEND_API_KEY;

      const provider = NotificationProviderFactory.getEmailProvider();
      expect(provider).toBeInstanceOf(BrevoEmailProviderAdapter);
      expect(provider.name).toBe("BREVO");
    });

    it("selects ResendEmailProviderAdapter when EMAIL_PROVIDER=RESEND", () => {
      process.env.EMAIL_PROVIDER = "RESEND";
      process.env.BREVO_API_KEY = "xkeysib-test";
      process.env.RESEND_API_KEY = "re_test";

      const provider = NotificationProviderFactory.getEmailProvider();
      expect(provider).toBeInstanceOf(ResendEmailProviderAdapter);
      expect(provider.name).toBe("RESEND");
    });

    it("falls back to MockEmailProviderAdapter when no credentials or providers are configured", () => {
      delete process.env.EMAIL_PROVIDER;
      delete process.env.BREVO_API_KEY;
      delete process.env.RESEND_API_KEY;

      const provider = NotificationProviderFactory.getEmailProvider();
      expect(provider).toBeInstanceOf(MockEmailProviderAdapter);
      expect(provider.name).toBe("MOCK_EMAIL");
    });
  });
});
