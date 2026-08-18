import { NextResponse } from "next/server";

import {
    resetPassword,
    PasswordResetError,
} from "@/lib/services/auth/resetPassword";

import {
    checkResetPasswordRateLimit,
} from "@/lib/services/auth/passwordRecoveryRateLimit";

import { z } from "zod";

const resetPasswordSchema =
    z.object({
        token: z
            .string()
            .min(1),

        password: z
            .string()
            .min(8)
            .regex(
                /[A-Z]/,
                "Password must contain an uppercase letter."
            )
            .regex(
                /[a-z]/,
                "Password must contain a lowercase letter."
            )
            .regex(
                /[0-9]/,
                "Password must contain a number."
            ),
    });

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
            resetPasswordSchema.safeParse(
                body
            );

        if (!parsed.success) {
            return NextResponse.json(
                {
                    success: false,
                    message:
                        "Invalid password reset data.",
                },
                {
                    status: 400,
                }
            );
        }

        const rateLimit =
            checkResetPasswordRateLimit(
                parsed.data.token,
                getClientIp(request)
            );

        if (!rateLimit.allowed) {
            return NextResponse.json(
                {
                    success: false,
                    message:
                        "Too many password reset attempts. Please try again later.",
                },
                {
                    status: 429,
                    headers: {
                        "Retry-After":
                            String(
                                rateLimit.retryAfterSeconds
                            ),
                    },
                }
            );
        }

        await resetPassword(
            parsed.data.token,
            parsed.data.password
        );

        return NextResponse.json(
            {
                success: true,
                message:
                    "Your password has been reset successfully. Please sign in again.",
            },
            {
                status: 200,
            }
        );
    } catch (error) {
        if (
            error instanceof
            PasswordResetError
        ) {
            if (
                error.code ===
                "INVALID_TOKEN"
            ) {
                return NextResponse.json(
                    {
                        success: false,
                        message:
                            "Invalid or expired reset link.",
                    },
                    {
                        status: 400,
                    }
                );
            }

            if (
                error.code ===
                "WEAK_PASSWORD"
            ) {
                return NextResponse.json(
                    {
                        success: false,
                        message:
                            error.message,
                    },
                    {
                        status: 400,
                    }
                );
            }

            return NextResponse.json(
                {
                    success: false,
                    message:
                        "Unable to reset your password.",
                },
                {
                    status: 500,
                }
            );
        }

        console.error(
            "Unexpected password reset API error:",
            error
        );

        return NextResponse.json(
            {
                success: false,
                message:
                    "Unable to reset your password.",
            },
            {
                status: 500,
            }
        );
    }
}