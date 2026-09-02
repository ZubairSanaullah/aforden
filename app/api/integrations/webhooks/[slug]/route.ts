import { NextResponse } from "next/server";
import { processInboundWebhook } from "@/lib/integrations/webhooks/webhookPipeline";

/**
 * POST /api/integrations/webhooks/[slug]
 *
 * Inbound webhook pipeline route handler. Captures raw body bytes for cryptographic
 * signature verification, executes the 8-stage webhook processing pipeline, and maps
 * outcomes to standardized HTTP response status codes.
 */
export async function POST(
  request: Request,
  props: { params: Promise<{ slug: string }> }
) {
  let endpointSlug = "unknown";
  try {
    const { slug } = await props.params;
    endpointSlug = slug;

    // Capture raw body text/bytes before any middleware/JSON parsing interferes
    const rawBody = await request.text();

    const result = await processInboundWebhook(slug, rawBody, request.headers);

    const isSuccess = result.httpStatus >= 200 && result.httpStatus < 300;
    const responseBody = isSuccess
      ? {
          success: true,
          outcome: result.outcome,
          eventId: result.event?.eventId,
          webhookEventRecordId: result.webhookEventRecordId,
          message: result.message,
        }
      : {
          success: false,
          error: {
            code: result.outcome,
            message: result.message || "Webhook processing failed.",
          },
        };

    return NextResponse.json(responseBody, {
      status: result.httpStatus,
      headers: result.responseHeaders,
    });
  } catch (err: unknown) {
    console.error(`[Inbound Webhook Route Error] [${endpointSlug}]:`, err);
    return NextResponse.json(
      {
        success: false,
        error: {
          code: "INTERNAL_SERVER_ERROR",
          message: "An unexpected error occurred while processing the webhook.",
        },
      },
      { status: 500 }
    );
  }
}
