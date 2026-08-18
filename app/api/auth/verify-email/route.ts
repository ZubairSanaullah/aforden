import { NextResponse } from "next/server";

import {
    verifyEmail,
    EmailVerificationError,
} from "@/lib/services/auth/verifyEmail";

export async function GET(
    request: Request
) {
    try {
        const url = new URL(request.url);

        const token =
            url.searchParams.get("token");

        if (!token) {
            return NextResponse.json(
                {
                    success: false,
                    message:
                        "Verification token is required.",
                },
                {
                    status: 400,
                }
            );
        }

        const result =
            await verifyEmail(token);

        return NextResponse.json(
            {
                success: true,
                message:
                    "Your email has been verified successfully.",
                user: result.user,
            },
            {
                status: 200,
            }
        );
    } catch (error) {
        if (
            error instanceof
            EmailVerificationError
        ) {
            switch (error.code) {
                case "INVALID_TOKEN":
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

                case "USER_NOT_FOUND":
                    return NextResponse.json(
                        {
                            success: false,
                            message:
                                "Unable to verify this account.",
                        },
                        {
                            status: 404,
                        }
                    );

                default:
                    return NextResponse.json(
                        {
                            success: false,
                            message:
                                "Unable to verify your email address.",
                        },
                        {
                            status: 500,
                        }
                    );
            }
        }

        console.error(
            "Unexpected email verification API error:",
            error
        );

        return NextResponse.json(
            {
                success: false,
                message:
                    "Unable to verify your email address.",
            },
            {
                status: 500,
            }
        );
    }
}