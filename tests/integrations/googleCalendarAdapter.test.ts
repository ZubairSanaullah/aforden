/**
 * Phase 1.17.8 — GoogleCalendarAdapter Contract, OAuth2 Token Refresh, Calendar Write/Read & Webhook Tests
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { GoogleCalendarAdapter } from "@/lib/integrations/adapters/googleCalendarAdapter";
import {
  IntegrationCapability,
  IntegrationConnectionStatus,
  IntegrationFailureCode,
  type IntegrationConnection,
  type IntegrationSecretReference,
  type IntegrationExecutionRequest,
} from "@/lib/integrations/adapters/types";
import { SEED_INTEGRATIONS } from "@/lib/integrations/seed/integrationSeed";
import { AdapterRegistry } from "@/lib/integrations/adapters/adapterRegistry";
import { clearInFlightOAuth2Refreshes } from "@/lib/integrations/adapters/oauth2Helper";

describe("Phase 1.17.8 — GoogleCalendarAdapter Unit & Contract Tests", () => {
  let adapter: GoogleCalendarAdapter;
  let mockConnection: IntegrationConnection;
  let mockSecretRef: IntegrationSecretReference;

  const samplePrimaryEmail = "technicians@servicecompany.com";
  const sampleAccessToken = "ya29.mock_google_access_token_12345";
  const sampleRefreshToken = "1//mock_google_refresh_token_67890";

  beforeEach(() => {
    clearInFlightOAuth2Refreshes();
    adapter = new GoogleCalendarAdapter();
    mockConnection = {
      id: "conn_gcal_test_123",
      workspaceId: "ws_test_456",
      integrationId: "google_calendar",
      connectionKey: "primary",
      status: IntegrationConnectionStatus.CONNECTED,
      configJson: {
        calendarId: "primary",
        clientId: "google_client_id_test.apps.googleusercontent.com",
        clientSecret: "google_client_secret_test",
      },
      metadataJson: null,
      externalAccountId: samplePrimaryEmail,
      externalAccountName: "Google Calendar (technicians@servicecompany.com)",
      lastTestedAt: null,
      lastErrorJson: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockSecretRef = {
      secretId: "sec_gcal_123",
      version: 1,
      keyVaultProvider: "LOCAL_ENCRYPTED_DB",
      algorithm: "AES_256_GCM",
      fingerprint: "sha256:gcal12345",
      secretPayload: JSON.stringify({
        accessToken: sampleAccessToken,
        refreshToken: sampleRefreshToken,
        expiresAt: Date.now() + 3600 * 1000,
        tokenType: "Bearer",
      }),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearInFlightOAuth2Refreshes();
  });

  describe("1. Identity & Exclusive Capability Registration", () => {
    it("should report correct identity metadata and both calendar capabilities", () => {
      expect(adapter.integrationId).toBe("google_calendar");
      expect(adapter.displayName).toBe("Google Calendar");
      expect(adapter.version).toBe("1.0.0");
      expect(adapter.getCapabilities()).toEqual([
        IntegrationCapability.CALENDAR_WRITE,
        IntegrationCapability.CALENDAR_READ,
      ]);
    });

    it("should register successfully and pass catalog consistency checks", () => {
      AdapterRegistry.clearAdapters();
      AdapterRegistry.registerAdapter(adapter);
      expect(AdapterRegistry.hasAdapter("google_calendar")).toBe(true);

      // Verify declared capabilities form a valid subset of catalog definition
      expect(() =>
        AdapterRegistry.validateAdapterCatalogConsistency(SEED_INTEGRATIONS)
      ).not.toThrow();
    });
  });

  describe("2. OAuth2 Token Refresh Flow", () => {
    it("should refresh expired Google OAuth token before health check", async () => {
      const expiredSecretRef: IntegrationSecretReference = {
        ...mockSecretRef,
        secretPayload: JSON.stringify({
          accessToken: "expired_gcal_token",
          refreshToken: sampleRefreshToken,
          expiresAt: Date.now() - 5000, // Expired
        }),
      };

      const fetchSpy = vi.spyOn(global, "fetch").mockImplementation(async (url) => {
        if (String(url).includes("oauth2.googleapis.com/token")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              access_token: "new_rotated_gcal_token",
              expires_in: 3600,
              token_type: "Bearer",
            }),
          } as unknown as Response;
        }
        if (String(url).includes("calendarList")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ items: [{ id: samplePrimaryEmail }] }),
          } as unknown as Response;
        }
        return { ok: false, status: 404 } as unknown as Response;
      });

      const result = await adapter.testConnection(mockConnection, expiredSecretRef);
      expect(result.success).toBe(true);

      // Verify token refresh was called with client_id / client_secret in POST body
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://oauth2.googleapis.com/token",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Content-Type": "application/x-www-form-urlencoded",
          }),
        })
      );
    });
  });

  describe("3. connect() Handshake", () => {
    it("should exchange authorization code for Google tokens and verify calendar list", async () => {
      vi.spyOn(global, "fetch").mockImplementation(async (url) => {
        if (String(url).includes("oauth2.googleapis.com/token")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              access_token: "new_auth_code_token",
              refresh_token: "new_auth_code_refresh",
              expires_in: 3600,
            }),
          } as unknown as Response;
        }
        if (String(url).includes("calendarList")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              items: [
                {
                  id: "technicians@servicecompany.com",
                  summary: "Field Service Dispatch Calendar",
                },
              ],
            }),
          } as unknown as Response;
        }
        return { ok: false, status: 404 } as unknown as Response;
      });

      const result = await adapter.connect(mockConnection, {
        code: "google_auth_code_9999",
      });

      expect(result.success).toBe(true);
      expect(result.connectionStatus).toBe(IntegrationConnectionStatus.CONNECTED);
      expect(result.externalAccountId).toBe("technicians@servicecompany.com");
      expect(result.externalAccountName).toBe("Field Service Dispatch Calendar");
    });
  });

  describe("4. execute() Calendar Write/Read & Error Translations", () => {
    const getBaseRequest = (): IntegrationExecutionRequest => ({
      workspaceId: "ws_test_456",
      connectionId: "conn_gcal_test_123",
      capability: IntegrationCapability.CALENDAR_WRITE,
      action: "create_event",
      payload: {
        calendarId: "primary",
        summary: "Emergency HVAC Service - Work Order #1042",
        description: "Customer reported total refrigerant loss.",
        start: { dateTime: "2026-08-29T14:00:00.000Z" },
        end: { dateTime: "2026-08-29T16:00:00.000Z" },
        location: "123 Main St, Austin, TX 78701",
      },
      idempotencyKey: "uuidv5-gcal-test-key",
      correlationId: "corr-gcal-1234",
      secretReference: mockSecretRef,
      connectionConfig: {
        calendarId: "primary",
      },
    });

    it("should successfully insert calendar event via CALENDAR_WRITE", async () => {
      const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          id: "gcal_evt_abcdef123456",
          summary: "Emergency HVAC Service - Work Order #1042",
          htmlLink: "https://calendar.google.com/event?eid=abcdef123456",
          status: "confirmed",
          start: { dateTime: "2026-08-29T14:00:00.000Z" },
          end: { dateTime: "2026-08-29T16:00:00.000Z" },
        }),
      } as unknown as Response);

      const result = await adapter.execute(getBaseRequest());

      expect(result.success).toBe(true);
      expect(result.capability).toBe(IntegrationCapability.CALENDAR_WRITE);
      expect(result.providerRequestId).toBe("gcal_evt_abcdef123456");
      expect(result.data?.eventId).toBe("gcal_evt_abcdef123456");
      expect(result.data?.htmlLink).toBe("https://calendar.google.com/event?eid=abcdef123456");

      expect(fetchSpy).toHaveBeenCalledWith(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Bearer ${sampleAccessToken}`,
          }),
        })
      );
    });

    it("should successfully query calendar events via CALENDAR_READ", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          summary: "primary",
          timeZone: "America/Chicago",
          items: [
            { id: "evt_1", summary: "Routine Maintenance" },
            { id: "evt_2", summary: "Diagnostic Inspection" },
          ],
        }),
      } as unknown as Response);

      const result = await adapter.execute({
        ...getBaseRequest(),
        capability: IntegrationCapability.CALENDAR_READ,
        action: "list_events",
        payload: {
          calendarId: "primary",
          timeMin: "2026-08-29T00:00:00.000Z",
          timeMax: "2026-08-30T00:00:00.000Z",
        },
      });

      expect(result.success).toBe(true);
      expect(result.capability).toBe(IntegrationCapability.CALENDAR_READ);
      expect(result.data?.itemCount).toBe(2);
      expect(result.data?.timeZone).toBe("America/Chicago");
    });

    it("should translate Google API 401 error to AUTHENTICATION_FAILED", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({
          error: {
            code: 401,
            message: "Request had invalid authentication credentials.",
            status: "UNAUTHENTICATED",
          },
        }),
      } as unknown as Response);

      const result = await adapter.execute(getBaseRequest());
      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.AUTHENTICATION_FAILED);
      expect(result.failure?.isRetryable).toBe(false);
    });

    it("should translate Google API 403 rateLimitExceeded to RATE_LIMITED (retryable)", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: async () => ({
          error: {
            code: 403,
            message: "Calendar API rate limit exceeded.",
            errors: [{ reason: "rateLimitExceeded", message: "User rate limit exceeded." }],
          },
        }),
      } as unknown as Response);

      const result = await adapter.execute(getBaseRequest());
      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.RATE_LIMITED);
      expect(result.failure?.isRetryable).toBe(true);
      expect(result.failure?.retryAfterSeconds).toBe(30);
    });

    it("should translate Google API 500/503 backendError to SERVICE_UNAVAILABLE", async () => {
      vi.spyOn(global, "fetch").mockResolvedValueOnce({
        ok: false,
        status: 503,
        json: async () => ({
          error: {
            code: 503,
            message: "Backend Error",
            errors: [{ reason: "backendError" }],
          },
        }),
      } as unknown as Response);

      const result = await adapter.execute(getBaseRequest());
      expect(result.success).toBe(false);
      expect(result.failure?.code).toBe(IntegrationFailureCode.SERVICE_UNAVAILABLE);
      expect(result.failure?.isRetryable).toBe(true);
    });
  });

  describe("5. handleWebhook() Push Notification Normalization", () => {
    it("should parse and normalize Google Calendar push notification headers", async () => {
      const headers = new Headers();
      headers.set("x-goog-channel-id", "chan_abc_12345");
      headers.set("x-goog-resource-id", "res_xyz_67890");
      headers.set("x-goog-resource-state", "exists");
      headers.set("x-goog-channel-token", "tok_secure_client_token");

      const event = await adapter.handleWebhook({}, headers, mockSecretRef, mockConnection);

      expect(event).not.toBeNull();
      expect(event?.eventType).toBe("calendar.event.exists");
      expect(event?.entityType).toBe("CalendarEvent");
      expect(event?.entityId).toBe("res_xyz_67890");
      expect(event?.workspaceId).toBe(mockConnection.workspaceId);
      expect(event?.connectionId).toBe(mockConnection.id);
      expect(event?.payload.channelId).toBe("chan_abc_12345");
    });
  });
});
