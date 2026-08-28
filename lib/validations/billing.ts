import { z } from "zod";

/**
 * Schema for creating a provider checkout session for a new subscription.
 */
export const createCheckoutSchema = z.object({
  priceId: z
    .string()
    .trim()
    .min(1, "Subscription plan price ID is required"),
  quantity: z
    .number()
    .int("Quantity must be an integer")
    .min(1, "Quantity must be at least 1")
    .optional(),
  successUrl: z
    .string()
    .trim()
    .url("Success URL must be a valid URL"),
  cancelUrl: z
    .string()
    .trim()
    .url("Cancel URL must be a valid URL"),
  trialPeriodDays: z
    .number()
    .int("Trial period days must be an integer")
    .min(0, "Trial period days cannot be negative")
    .optional()
    .nullable(),
});

export type CreateCheckoutInput = z.infer<typeof createCheckoutSchema>;

/**
 * Schema for self-serve plan modification (upgrade/downgrade/seat adjustment).
 */
export const changePlanSchema = z.object({
  priceId: z
    .string()
    .trim()
    .min(1, "Target subscription plan price ID is required"),
  seatsCount: z
    .number()
    .int("Seats count must be an integer")
    .min(1, "Seats count must be at least 1")
    .optional(),
});

export type ChangePlanInput = z.infer<typeof changePlanSchema>;

/**
 * Schema for creating a provider billing customer portal session.
 */
export const createPortalSchema = z.object({
  returnUrl: z
    .string()
    .trim()
    .url("Return URL must be a valid URL"),
});

export type CreatePortalInput = z.infer<typeof createPortalSchema>;

