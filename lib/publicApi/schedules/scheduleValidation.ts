import { z } from "zod";

export const listPublicSchedulesQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).default(50).optional(),
    cursor: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).default(50).optional(),
    technicianId: z.string().trim().min(1).optional(),
    workOrderId: z.string().trim().min(1).optional(),
    customerId: z.string().trim().min(1).optional(),
    locationId: z.string().trim().min(1).optional(),
    status: z
        .enum(["SCHEDULED", "RESCHEDULED", "CANCELLED", "COMPLETED"])
        .optional(),
    dispatchStatus: z
        .enum(["PENDING_DISPATCH", "DISPATCHED", "ACKNOWLEDGED"])
        .optional(),
    startDate: z.coerce.date().optional(),
    endDate: z.coerce.date().optional(),
    search: z.string().trim().optional(),
    sort: z.string().optional(),
});

export type ListPublicSchedulesQueryInput = z.infer<
    typeof listPublicSchedulesQuerySchema
>;
