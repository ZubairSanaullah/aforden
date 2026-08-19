import { z } from "zod";

export const technicianAvailabilityCheckInputSchema = z
    .object({
        startsAt: z.coerce.date(),
        endsAt: z.coerce.date(),
    })
    .refine((data) => data.startsAt.getTime() < data.endsAt.getTime(), {
        message: "Start date/time must be earlier than end date/time.",
        path: ["startsAt"],
    });

export type TechnicianAvailabilityCheckInput = z.infer<
    typeof technicianAvailabilityCheckInputSchema
>;
