import { NextResponse } from "next/server";

import {
    registerUser,
    RegistrationError,
} from "@/lib/services/auth/registerUser";

export async function POST(request: Request) {
    try {
        const body =
            await request.json();

        const result =
            await registerUser(body);

        return NextResponse.json(
            {
                success: true,
                message:
                    "Account created successfully. Please check your email to verify your account.",
                user: result.user,
            },
            {
                status: 201,
            }
        );
    } catch (error) {
        if (
            error instanceof SyntaxError
        ) {
            return NextResponse.json(
                {
                    success: false,
                    message:
                        "Invalid request body.",
                },
                {
                    status: 400,
                }
            );
        }

        if (
            error instanceof RegistrationError
        ) {
            switch (error.code) {
                case "VALIDATION_ERROR":
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

                case "EMAIL_EXISTS":
                    return NextResponse.json(
                        {
                            success: false,
                            message:
                                error.message,
                        },
                        {
                            status: 409,
                        }
                    );

                case "EMAIL_DELIVERY_FAILED":
                    return NextResponse.json(
                        {
                            success: false,
                            message:
                                error.message,
                        },
                        {
                            status: 503,
                        }
                    );

                default:
                    return NextResponse.json(
                        {
                            success: false,
                            message:
                                "Unable to create your account.",
                        },
                        {
                            status: 500,
                        }
                    );
            }
        }

        console.error(
            "Unexpected registration API error:",
            error
        );

        return NextResponse.json(
            {
                success: false,
                message:
                    "Unable to create your account.",
            },
            {
                status: 500,
            }
        );
    }
}