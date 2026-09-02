import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { applySecurityHeaders } from "@/lib/api/securityHeaders";

/**
 * GET /api/health
 *
 * Public Infrastructure Health & Liveness Probe.
 * Designed for container orchestrators and load balancers (Kubernetes, AWS ALB, ECS, Vercel).
 *
 * Guarantees:
 * - Zero information disclosure (no internal hostnames, versions, connection strings, or stack traces).
 * - Real PostgreSQL connectivity check (`SELECT 1`) returning HTTP 200 when responsive, HTTP 503 when down.
 * - Full canonical security headers attached.
 */
export async function GET() {
  const headers = new Headers({
    "cache-control": "no-store, no-cache, must-revalidate",
  });
  applySecurityHeaders(headers);

  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json(
      {
        status: "healthy",
        timestamp: new Date().toISOString(),
      },
      {
        status: 200,
        headers,
      }
    );
  } catch {
    return NextResponse.json(
      {
        status: "unhealthy",
        error: "Service unavailable: database connectivity check failed",
      },
      {
        status: 503,
        headers,
      }
    );
  }
}
