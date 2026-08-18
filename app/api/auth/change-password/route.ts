import { NextResponse } from "next/server";

import { auth } from "@/auth";

import {
    changePassword,
    ChangePasswordError,
} from "@/lib/services/auth/changePassword";

import { z } from "zod";

const changePasswordSchema =
    z.object({
        currentPassword: z
            .string()
            .min(1),

        newPassword: z
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

export async function POST(
    request: Request
) {
    try {
        const session =
            await auth();

        if (!session?.user?.id) {
            return NextResponse.json(
                {
                    success: false,
                    message:
                        "Authentication is required.",
                },
                {
                    status: 401,
                }
            );
        }

        const body =
            await request.json();

        const parsed =
            changePasswordSchema.safeParse(
                body
            );

        if (!parsed.success) {
            return NextResponse.json(
                {
                    success: false,
                    message:
                        "Invalid password data.",
                    errors:
                        parsed.error.flatten()
                            .fieldErrors,
                },
                {
                    status: 400,
                }
            );
        }

        /**
         * Auth.js database sessions use the
         * session token internally. It isn't
         * exposed through session.user, so this
         * service call intentionally preserves
         * all other sessions only when a token
         * is available through the request.
         *
         * For this endpoint, the safer fallback
         * is to invalidate all sessions.
         */
        const user =
            await changePassword(
                session.user.id,
                parsed.data.currentPassword,
                parsed.data.newPassword
            );

        return NextResponse.json(
            {
                success: true,
                message:
                    "Your password has been changed successfully. Please sign in again.",
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                },
            },
            {
                status: 200,
            }
        );
    } catch (error) {
        if (
            error instanceof
            ChangePasswordError
        ) {
            const status =
                error.code ===
                    "UNAUTHENTICATED"
                    ? 401
                    : error.code ===
                        "USER_NOT_FOUND"
                        ? 404
                        : error.code ===
                            "CHANGE_FAILED"
                            ? 500
                            : 400;

            return NextResponse.json(
                {
                    success: false,
                    message:
                        error.message,
                },
                {
                    status,
                }
            );
        }

        console.error(
            "Aforden change-password API error:",
            error
        );

        return NextResponse.json(
            {
                success: false,
                message:
                    "Unable to change your password.",
            },
            {
                status: 500,
            }
        );
    }
}