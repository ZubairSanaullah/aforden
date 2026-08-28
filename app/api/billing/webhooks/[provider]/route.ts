import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  getBillingAdapter,
  processBillingWebhookEvent,
  BillingWebhookPayload,
} from "@/lib/services/billing";

interface RouteContext {
  params: Promise<{
    provider: string;
  }>;
}

/**
 * POST /api/billing/webhooks/[provider]
 *
 * Inbound webhook receiver for billing providers (Stripe, Mock).
 * Preserves raw body for HMAC signature verification before performing
 * database deduplication and lifecycle state machine dispatching.
 */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { provider } = await context.params;
    const rawBody = await request.text();

    const signature =
      request.headers.get("stripe-signature") ||
      request.headers.get("x-signature") ||
      "";

    // 1. Resolve Provider Adapter
    let adapter;
    try {
      adapter = getBillingAdapter(provider);
    } catch {
      return NextResponse.json(
        { success: false, error: `Unsupported billing provider '${provider}'` },
        { status: 400 },
      );
    }

    // 2. Cryptographic Signature Verification (HMAC)
    let event: BillingWebhookPayload;
    try {
      event = await adapter.verifyAndConstructWebhookEvent({
        rawBody,
        signature,
      });
    } catch (err: any) {
      return NextResponse.json(
        { success: false, error: err?.message || "Invalid signature" },
        { status: 400 },
      );
    }

    // 3. Idempotent Inbox Ingestion & Lifecycle Dispatch
    const result = await processBillingWebhookEvent(prisma, event);

    return NextResponse.json(
      {
        received: true,
        deduplicated: result.deduplicated,
        processed: result.processed,
        eventId: result.eventId,
      },
      { status: 200 },
    );
  } catch (error: any) {
    console.error("[Billing Webhook Ingestion Error]:", error);
    return NextResponse.json(
      {
        success: false,
        error: "Internal error processing webhook event",
      },
      { status: 500 },
    );
  }
}
