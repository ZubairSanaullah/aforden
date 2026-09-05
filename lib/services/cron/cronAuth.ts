import crypto from "crypto";
import { NextResponse } from "next/server";

/**
 * Validates that an incoming HTTP request presents a valid `Authorization: Bearer ${CRON_SECRET}` header.
 *
 * Security controls:
 * 1. Fails closed if CRON_SECRET is undefined, null, or empty string.
 * 2. Rejects missing, malformed, or non-Bearer authorization headers.
 * 3. Compares header token in constant time using `crypto.timingSafeEqual` to eliminate timing side-channels.
 */
export function verifyCronAuthorization(request: Request): boolean {
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || cronSecret.trim().length === 0) {
        return false;
    }

    const authHeader = request.headers.get("authorization");
    if (!authHeader) {
        return false;
    }

    const expectedHeader = `Bearer ${cronSecret}`;

    // Normalize buffers to same length before timingSafeEqual to avoid throwing TypeError
    const authBuffer = Buffer.from(authHeader, "utf-8");
    const expectedBuffer = Buffer.from(expectedHeader, "utf-8");

    if (authBuffer.length !== expectedBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(authBuffer, expectedBuffer);
}

/**
 * Helper returning standard 401 Unauthorized JSON response for cron route handlers.
 */
export function unauthorizedCronResponse(): NextResponse {
    return NextResponse.json(
        {
            success: false,
            error: "Unauthorized",
            message: "Missing or invalid cron authorization bearer token.",
        },
        { status: 401 }
    );
}
