import { NextResponse } from "next/server";

import {
    resendVerificationEmail,
} from "@/lib/services/auth/resendVerificationEmail";

import {
    registerSchema,
} from "@/lib/validations/auth";

import {
    checkVerificationEmailRateLimit,
} from "@/lib/services/auth/verificationRateLimit";

function getClientIp(
    request: Request
): string {
    const forwardedFor =
        request.headers.get(
            "x-forwarded-for"
        );

    if (forwardedFor) {
        return (
            forwardedFor
                .split(",")[0]
                ?.trim() ||
            "unknown"
        );
    }

    const realIp =
        request.headers.get(
            "x-real-ip"
        );

    return (
        realIp?.trim() ||
        "unknown"
    );
}

const genericResponse = {
    success: true,
    message:
        "If an account requires email verification, a verification email has been sent.",
};

export async function POST(
    request: Request
) {
    try {
        const body =
            await request.json();

        const email =
            typeof body?.email === "string"
                ? body.email
                : "";

        const parsed =
            registerSchema.shape.email.safeParse(
                email
            );

        /**
         * Never reveal whether an email
         * exists or not.
         */
        if (!parsed.success) {
            return NextResponse.json(
                genericResponse,
                {
                    status: 200,
                }
            );
        }

        const normalizedEmail =
            parsed.data;

        const ipAddress =
            getClientIp(request);

        const rateLimit =
            checkVerificationEmailRateLimit(
                normalizedEmail,
                ipAddress
            );

        if (!rateLimit.allowed) {
            return NextResponse.json(
                genericResponse,
                {
                    status: 200,
                    headers: {
                        "Retry-After":
                            String(
                                rateLimit.retryAfterSeconds
                            ),
                    },
                }
            );
        }

        await resendVerificationEmail(
            normalizedEmail
        );

        return NextResponse.json(
            genericResponse,
            {
                status: 200,
            }
        );
    } catch (error) {
        console.error(
            "Aforden resend verification API error:",
            error
        );

        /**
         * Maintain the same response even when
         * internal/provider errors occur.
         */
        return NextResponse.json(
            genericResponse,
            {
                status: 200,
            }
        );
    }
}