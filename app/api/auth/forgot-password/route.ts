import { NextResponse } from "next/server";

import {
    requestPasswordReset,
} from "@/lib/services/auth/requestPasswordReset";

import {
    checkForgotPasswordRateLimit,
} from "@/lib/services/auth/passwordRecoveryRateLimit";

import { z } from "zod";

const forgotPasswordSchema =
    z.object({
        email: z
            .string()
            .trim()
            .email()
            .transform((value) =>
                value.toLowerCase()
            ),
    });

const genericResponse = {
    success: true,
    message:
        "If an account exists with that email, a password reset email has been sent.",
};

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

    return (
        request.headers.get(
            "x-real-ip"
        )?.trim() ||
        "unknown"
    );
}

export async function POST(
    request: Request
) {
    try {
        const body =
            await request.json();

        const parsed =
            forgotPasswordSchema.safeParse(
                body
            );

        if (!parsed.success) {
            return NextResponse.json(
                genericResponse,
                {
                    status: 200,
                }
            );
        }

        const email =
            parsed.data.email;

        const rateLimit =
            checkForgotPasswordRateLimit(
                email,
                getClientIp(request)
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

        await requestPasswordReset(
            email
        );

        return NextResponse.json(
            genericResponse,
            {
                status: 200,
            }
        );
    } catch (error) {
        console.error(
            "Aforden forgot-password error:",
            error
        );

        return NextResponse.json(
            genericResponse,
            {
                status: 200,
            }
        );
    }
}