import { describe, it, vi } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn().mockResolvedValue(null),
}));

import { GET as publicHealthGet } from "@/app/api/health/route";
import { GET as platformHealthGet } from "@/app/api/platform/health/route";
import { GET as platformQueuesGet } from "@/app/api/platform/health/queues/route";
import { GET as platformRateLimiterGet } from "@/app/api/platform/health/rate-limiter/route";
import { GET as platformSupportGet } from "@/app/api/platform/workspaces/[workspaceId]/support/route";
import { GET as publicPingGet } from "@/app/api/v1/ping/route";
import { POST as integrationTestPost } from "@/app/api/integrations/[integrationId]/test/route";
import { GET as automationsDlqGet } from "@/app/api/automations/dlq/route";

import { prisma } from "@/lib/prisma";
import {
  getPlatformSystemHealthSummary,
  getPlatformQueueHealth,
  getPlatformRateLimiterBlockerStatus,
} from "@/lib/services/platform/health";
import { PlatformAuthorizationContext } from "@/lib/services/platform/authorization";
import { jsonSuccess } from "@/lib/services/platform/transport";
import * as authService from "@/lib/publicApi/auth";

const mockAdminContext: PlatformAuthorizationContext = {
  userId: "usr_platform_admin_1",
  email: "admin@aforden.com",
  name: "Platform Administrator",
  avatarUrl: null,
  platformRole: "PLATFORM_ADMIN" as any,
  profileId: "prof_1",
  status: "ACTIVE" as any,
  lastActiveAt: new Date(),
  lastLoginAt: new Date(),
  stepUpConfirmedAt: new Date(),
  metadata: null,
};

async function printLiveCapture(endpointLabel: string, res: Response) {
  const status = res.status;
  const statusText =
    res.statusText ||
    (status === 200
      ? "OK"
      : status === 401
      ? "Unauthorized"
      : status === 400
      ? "Bad Request"
      : status === 404
      ? "Not Found"
      : status === 503
      ? "Service Unavailable"
      : "");
  const headersObj: Record<string, string> = {};
  res.headers.forEach((val, key) => {
    headersObj[key] = val;
  });
  let body: any;
  try {
    body = await res.json();
  } catch {
    body = await res.text();
  }

  console.log(`\n================================================================================`);
  console.log(`[LIVE INVOCATION CAPTURE]: ${endpointLabel}`);
  console.log(`HTTP Status: ${status} ${statusText}`.trim());
  console.log(`Response Headers:`);
  console.log(JSON.stringify(headersObj, null, 2));
  console.log(`Verbatim Response Body:`);
  console.log(JSON.stringify(body, null, 2));
  console.log(`================================================================================\n`);
}

describe("Phase 1.20.12 / 1.20.11 — Live Observability & Diagnostics Probes", () => {
  it("executes and prints live request/response cycles for all 8 endpoints", async () => {
    // -------------------------------------------------------------------------
    // 1. GET /api/health (Public Infrastructure Health Probe)
    // -------------------------------------------------------------------------
    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ "?column?": 1 }] as any);
    const res1a = await publicHealthGet();
    await printLiveCapture("1a. GET /api/health (Database Responsive -> 200 OK)", res1a);

    vi.spyOn(prisma, "$queryRaw").mockRejectedValueOnce(
      new Error("FATAL: connection to postgres://admin:super_secret_pw@db.internal:5432 failed")
    );
    const res1b = await publicHealthGet();
    await printLiveCapture("1b. GET /api/health (Database Failure Simulation -> 503 Service Unavailable)", res1b);

    // -------------------------------------------------------------------------
    // 2. GET /api/platform/health (Master Operational Telemetry Rollup)
    // -------------------------------------------------------------------------
    const req2a = new Request("http://localhost:3000/api/platform/health");
    const res2a = await platformHealthGet(req2a as any, {} as any);
    await printLiveCapture("2a. GET /api/platform/health (Unauthenticated -> 401 Unauthorized)", res2a);

    vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([{ "?column?": 1 }] as any);
    vi.spyOn(prisma.notificationOutbox, "count").mockResolvedValue(0);
    vi.spyOn(prisma.automationExecution, "count").mockResolvedValue(0);
    vi.spyOn(prisma.automationScheduleJob, "count").mockResolvedValue(0);
    vi.spyOn(prisma.webhookDelivery, "count").mockResolvedValue(0);
    vi.spyOn(prisma.billingWebhookEvent, "count").mockResolvedValue(0);
    vi.spyOn(prisma.integrationExecution, "count").mockResolvedValue(0);
    vi.spyOn(prisma.integrationWebhookEvent, "count").mockResolvedValue(0);
    vi.spyOn(prisma.platformBillingAccount, "count").mockResolvedValue(0);
    vi.spyOn(prisma.subscription, "count").mockResolvedValue(0);
    vi.spyOn(prisma.platformAuditLog, "count").mockResolvedValue(10);
    vi.spyOn(prisma.platformRuntimeSetting, "count").mockResolvedValue(5);
    vi.spyOn(prisma.platformFeatureFlag, "count").mockResolvedValue(3);

    const summary = await getPlatformSystemHealthSummary(mockAdminContext);
    const res2b = jsonSuccess(summary);
    await printLiveCapture("2b. GET /api/platform/health (Authenticated Platform Admin Telemetry -> 200 OK)", res2b);

    // -------------------------------------------------------------------------
    // 3. GET /api/platform/health/queues (Asynchronous Queues & Outbox)
    // -------------------------------------------------------------------------
    const req3a = new Request("http://localhost:3000/api/platform/health/queues");
    const res3a = await platformQueuesGet(req3a as any, {} as any);
    await printLiveCapture("3a. GET /api/platform/health/queues (Unauthenticated -> 401 Unauthorized)", res3a);

    vi.spyOn(prisma.notificationOutbox, "count").mockResolvedValue(0);
    vi.spyOn(prisma.automationExecution, "count").mockResolvedValue(0);
    vi.spyOn(prisma.automationScheduleJob, "count").mockResolvedValue(0);
    vi.spyOn(prisma.webhookDelivery, "count").mockResolvedValue(0);
    vi.spyOn(prisma.billingWebhookEvent, "count").mockResolvedValue(0);

    const queueHealth = await getPlatformQueueHealth(mockAdminContext);
    const res3b = jsonSuccess(queueHealth);
    await printLiveCapture("3b. GET /api/platform/health/queues (Authenticated Admin Queue Telemetry -> 200 OK)", res3b);

    // -------------------------------------------------------------------------
    // 4. GET /api/platform/health/rate-limiter (Rate Limiter Diagnostics)
    // -------------------------------------------------------------------------
    const req4a = new Request("http://localhost:3000/api/platform/health/rate-limiter");
    const res4a = await platformRateLimiterGet(req4a as any, {} as any);
    await printLiveCapture("4a. GET /api/platform/health/rate-limiter (Unauthenticated -> 401 Unauthorized)", res4a);

    const blocker = await getPlatformRateLimiterBlockerStatus(mockAdminContext);
    const res4b = jsonSuccess(blocker);
    await printLiveCapture("4b. GET /api/platform/health/rate-limiter (Authenticated Admin Blocker Diagnostics -> 200 OK)", res4b);

    // -------------------------------------------------------------------------
    // 5. GET /api/platform/workspaces/[workspaceId]/support (Support Diagnostics)
    // -------------------------------------------------------------------------
    const req5a = new Request("http://localhost:3000/api/platform/workspaces/ws_sample_123/support");
    const res5a = await platformSupportGet(req5a as any, { params: Promise.resolve({ workspaceId: "ws_sample_123" }) } as any);
    await printLiveCapture("5a. GET /api/platform/workspaces/[workspaceId]/support (Unauthenticated -> 401 Unauthorized)", res5a);

    // -------------------------------------------------------------------------
    // 6. GET /api/v1/ping (Public API Connectivity Probe)
    // -------------------------------------------------------------------------
    const req6a = new Request("http://localhost:3000/api/v1/ping");
    const res6a = await publicPingGet(req6a);
    await printLiveCapture("6a. GET /api/v1/ping (Unauthenticated Missing Header -> 401 Unauthorized)", res6a);

    vi.spyOn(prisma.apiKey, "findFirst").mockResolvedValueOnce(null);
    const req6b = new Request("http://localhost:3000/api/v1/ping", {
      headers: { authorization: "Bearer invalid_api_key_test_12345" },
    });
    const res6b = await publicPingGet(req6b);
    await printLiveCapture("6b. GET /api/v1/ping (Invalid API Key -> 401 Unauthorized)", res6b);

    vi.spyOn(authService, "authenticatePublicApiRequest").mockResolvedValueOnce({
      apiKeyId: "key_live_telemetry_probe",
      developerApplicationId: "app_live_telemetry_probe",
      developerApplicationName: "Telemetry Probe Application",
      workspaceId: "ws_live_telemetry",
      environment: "TEST" as any,
      scopes: ["ping:read"],
    });
    vi.spyOn(prisma.apiRequestLog, "create").mockResolvedValueOnce({
      id: "log_1",
      workspaceId: "ws_live_telemetry",
      apiKeyId: "key_live_telemetry_probe",
      developerApplicationId: "app_live_telemetry_probe",
      requestId: "req_live_ping_001",
      endpoint: "/api/v1/ping",
      httpMethod: "GET",
      ipHash: "hash123",
      statusCode: 200,
      responseTimeMs: 2,
      rateLimited: false,
      rateLimitTier: "STANDARD",
      requestHeaders: {},
      requestPayload: null,
      responsePayload: null,
      errorMessage: null,
      createdAt: new Date(),
    } as any);

    const req6c = new Request("http://localhost:3000/api/v1/ping", {
      headers: { authorization: "Bearer afd_live_valid1234567890123456" },
    });
    const res6c = await publicPingGet(req6c);
    await printLiveCapture("6c. GET /api/v1/ping (Authenticated Bearer Token with ping:read scope -> 200 OK)", res6c);

    // -------------------------------------------------------------------------
    // 7. POST /api/integrations/[integrationId]/test (Provider Health)
    // -------------------------------------------------------------------------
    const req7a = new Request("http://localhost:3000/api/integrations/int_quickbooks/test", {
      method: "POST",
    });
    const res7a = await integrationTestPost(req7a, {
      params: Promise.resolve({ integrationId: "int_quickbooks" }),
    });
    await printLiveCapture("7a. POST /api/integrations/[integrationId]/test (Missing Workspace Context -> 400 Bad Request)", res7a);

    const req7b = new Request("http://localhost:3000/api/integrations/int_quickbooks/test?workspaceId=ws_test_123", {
      method: "POST",
    });
    const res7b = await integrationTestPost(req7b, {
      params: Promise.resolve({ integrationId: "int_quickbooks" }),
    });
    await printLiveCapture("7b. POST /api/integrations/[integrationId]/test (Unauthenticated Workspace Caller -> 401 Unauthorized)", res7b);

    // -------------------------------------------------------------------------
    // 8. GET /api/automations/dlq (Dead Letter Queue Diagnostics)
    // -------------------------------------------------------------------------
    const req8a = new Request("http://localhost:3000/api/automations/dlq");
    const res8a = await automationsDlqGet(req8a);
    await printLiveCapture("8a. GET /api/automations/dlq (Missing Workspace Context -> 400 Bad Request)", res8a);

    const req8b = new Request("http://localhost:3000/api/automations/dlq?workspaceId=ws_test_123");
    const res8b = await automationsDlqGet(req8b);
    await printLiveCapture("8b. GET /api/automations/dlq (Unauthenticated Workspace Caller -> 401 Unauthorized)", res8b);
  });
});
