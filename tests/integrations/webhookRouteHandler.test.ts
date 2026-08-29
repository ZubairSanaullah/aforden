/**
 * Phase 1.17.9 — Inbound Webhook Route Handler Test Suite
 * Tests POST /api/integrations/webhooks/[slug] raw body extraction and
 * HTTP status code / headers mapping for each 1.17.4 pipeline outcome.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST as webhookRoute } from "@/app/api/integrations/webhooks/[slug]/route";

vi.mock("@/lib/integrations/webhooks/webhookPipeline", () => ({
  processInboundWebhook: vi.fn(),
}));

import { processInboundWebhook } from "@/lib/integrations/webhooks/webhookPipeline";

describe("Phase 1.17.9 — Inbound Webhook Route Handler (POST /api/integrations/webhooks/[slug])", () => {
  const slug = "wh_hook_slug_123";
  const paramsPromise = Promise.resolve({ slug });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("passes exact raw body and headers to processInboundWebhook and returns HTTP 200 on SUCCESS", async () => {
    const rawPayload = JSON.stringify({ type: "email.delivered", data: { emailId: "em_1" } });

    vi.mocked(processInboundWebhook).mockResolvedValueOnce({
      outcome: "SUCCESS",
      stage: 8,
      httpStatus: 200,
      endpointSlug: slug,
      event: { eventId: "ev_norm_1" } as any,
      webhookEventRecordId: "wher_1",
    });

    const req = new Request(`http://localhost/api/integrations/webhooks/${slug}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-webhook-signature": "sig_hex_123",
      },
      body: rawPayload,
    });

    const res = await webhookRoute(req, { params: paramsPromise });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.outcome).toBe("SUCCESS");
    expect(json.eventId).toBe("ev_norm_1");
    expect(json.webhookEventRecordId).toBe("wher_1");

    expect(processInboundWebhook).toHaveBeenCalledWith(slug, rawPayload, expect.anything());
  });

  it("returns HTTP 200 on IDEMPOTENT_IGNORED with outcome message", async () => {
    vi.mocked(processInboundWebhook).mockResolvedValueOnce({
      outcome: "IDEMPOTENT_IGNORED",
      stage: 6,
      httpStatus: 200,
      endpointSlug: slug,
      message: "Duplicate event already processed.",
    });

    const req = new Request(`http://localhost/api/integrations/webhooks/${slug}`, {
      method: "POST",
      body: "payload_data",
    });

    const res = await webhookRoute(req, { params: paramsPromise });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.outcome).toBe("IDEMPOTENT_IGNORED");
    expect(json.message).toBe("Duplicate event already processed.");
  });

  it("returns HTTP 200 on REPLAY_DISCARDED", async () => {
    vi.mocked(processInboundWebhook).mockResolvedValueOnce({
      outcome: "REPLAY_DISCARDED",
      stage: 3,
      httpStatus: 200,
      endpointSlug: slug,
      message: "Replay nonce already consumed.",
    });

    const req = new Request(`http://localhost/api/integrations/webhooks/${slug}`, {
      method: "POST",
      body: "payload_data",
    });

    const res = await webhookRoute(req, { params: paramsPromise });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.outcome).toBe("REPLAY_DISCARDED");
  });

  it("maps signature failure to HTTP 401", async () => {
    vi.mocked(processInboundWebhook).mockResolvedValueOnce({
      outcome: "FAILED",
      stage: 1,
      httpStatus: 401,
      endpointSlug: slug,
      message: "Cryptographic signature mismatch.",
    });

    const req = new Request(`http://localhost/api/integrations/webhooks/${slug}`, {
      method: "POST",
      body: "tampered_data",
    });

    const res = await webhookRoute(req, { params: paramsPromise });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.success).toBe(false);
    expect(json.error.message).toBe("Cryptographic signature mismatch.");
  });

  it("maps timestamp skew beyond window to HTTP 400", async () => {
    vi.mocked(processInboundWebhook).mockResolvedValueOnce({
      outcome: "FAILED",
      stage: 2,
      httpStatus: 400,
      endpointSlug: slug,
      message: "Webhook timestamp skew exceeds 300s window.",
    });

    const req = new Request(`http://localhost/api/integrations/webhooks/${slug}`, {
      method: "POST",
      body: "skewed_data",
    });

    const res = await webhookRoute(req, { params: paramsPromise });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("maps unknown endpoint slug to HTTP 404", async () => {
    vi.mocked(processInboundWebhook).mockResolvedValueOnce({
      outcome: "FAILED",
      stage: 4,
      httpStatus: 404,
      endpointSlug: slug,
      message: "Endpoint slug not registered.",
    });

    const req = new Request(`http://localhost/api/integrations/webhooks/${slug}`, {
      method: "POST",
      body: "data",
    });

    const res = await webhookRoute(req, { params: paramsPromise });
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.success).toBe(false);
  });

  it("maps disabled endpoint to HTTP 410 GONE", async () => {
    vi.mocked(processInboundWebhook).mockResolvedValueOnce({
      outcome: "FAILED",
      stage: 5,
      httpStatus: 410,
      endpointSlug: slug,
      message: "Webhook endpoint is disabled.",
    });

    const req = new Request(`http://localhost/api/integrations/webhooks/${slug}`, {
      method: "POST",
      body: "data",
    });

    const res = await webhookRoute(req, { params: paramsPromise });
    expect(res.status).toBe(410);
  });

  it("maps connection CONNECTING state to HTTP 409 CONFLICT", async () => {
    vi.mocked(processInboundWebhook).mockResolvedValueOnce({
      outcome: "FAILED",
      stage: 5,
      httpStatus: 409,
      endpointSlug: slug,
      message: "Connection is in CONNECTING state.",
    });

    const req = new Request(`http://localhost/api/integrations/webhooks/${slug}`, {
      method: "POST",
      body: "data",
    });

    const res = await webhookRoute(req, { params: paramsPromise });
    expect(res.status).toBe(409);
  });

  it("maps transient connection error to HTTP 503 with Retry-After header", async () => {
    vi.mocked(processInboundWebhook).mockResolvedValueOnce({
      outcome: "FAILED",
      stage: 5,
      httpStatus: 503,
      responseHeaders: { "Retry-After": "300" },
      endpointSlug: slug,
      message: "Transient connection error.",
    });

    const req = new Request(`http://localhost/api/integrations/webhooks/${slug}`, {
      method: "POST",
      body: "data",
    });

    const res = await webhookRoute(req, { params: paramsPromise });
    expect(res.status).toBe(503);
    expect(res.headers.get("Retry-After")).toBe("300");
  });

  it("maps lacking entitlement to HTTP 402 PAYMENT REQUIRED", async () => {
    vi.mocked(processInboundWebhook).mockResolvedValueOnce({
      outcome: "FAILED",
      stage: 5,
      httpStatus: 402,
      endpointSlug: slug,
      message: "Workspace lacks integrations entitlement.",
    });

    const req = new Request(`http://localhost/api/integrations/webhooks/${slug}`, {
      method: "POST",
      body: "data",
    });

    const res = await webhookRoute(req, { params: paramsPromise });
    expect(res.status).toBe(402);
  });
});
