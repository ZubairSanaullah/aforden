import { z } from "zod";

export const registerSchema = z.object({
    name: z
        .string()
        .trim()
        .min(2, "Name must contain at least 2 characters")
        .max(100, "Name must not exceed 100 characters"),

    email: z
        .string()
        .trim()
        .email("Please enter a valid email address")
        .transform((value) => value.toLowerCase()),

    password: z
        .string()
        .min(8, "Password must contain at least 8 characters")
        .max(128, "Password must not exceed 128 characters")
        .regex(
            /[A-Z]/,
            "Password must contain at least one uppercase letter"
        )
        .regex(
            /[a-z]/,
            "Password must contain at least one lowercase letter"
        )
        .regex(
            /[0-9]/,
            "Password must contain at least one number"
        ),
});

export type RegisterInput = z.infer<typeof registerSchema>;