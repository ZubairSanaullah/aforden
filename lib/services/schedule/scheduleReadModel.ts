import type {
    ScheduleAppointment,
    WorkOrder,
    Customer,
    ServiceLocation,
    Asset,
    TechnicianProfile,
    Employee,
    WorkspaceMember,
    User,
} from "@/generated/prisma/client";
import type { ScheduleAppointmentReadModel } from "./schedule.types";

export type ScheduleAppointmentWithRelations = ScheduleAppointment & {
    workOrder: WorkOrder & {
        customer: Customer;
        location: ServiceLocation;
        asset?: Asset | null;
    };
    technician: TechnicianProfile & {
        employee: Employee;
    };
    dispatchedByMember?: (WorkspaceMember & { user?: User | null }) | null;
    undispatchedByMember?: (WorkspaceMember & { user?: User | null }) | null;
};

export const SCHEDULE_APPOINTMENT_INCLUDE = {
    workOrder: {
        include: {
            customer: true,
            location: true,
            asset: true,
        },
    },
    technician: {
        include: {
            employee: true,
        },
    },
    dispatchedByMember: {
        include: {
            user: true,
        },
    },
    undispatchedByMember: {
        include: {
            user: true,
        },
    },
} as const;

/**
 * Maps a Prisma ScheduleAppointment record with its relations to the standard ScheduleAppointmentReadModel.
 *
 * Denormalizes customer, service location, and technician attributes for O(1)
 * calendar cell and dispatch board projection.
 */
export function toScheduleAppointmentReadModel(
    appt: ScheduleAppointmentWithRelations,
): ScheduleAppointmentReadModel {
    const locationAddress = [
        appt.workOrder.location.addressLine1,
        appt.workOrder.location.addressLine2,
        appt.workOrder.location.city,
        appt.workOrder.location.state,
        appt.workOrder.location.postalCode,
        appt.workOrder.location.country,
    ]
        .filter(Boolean)
        .join(", ");

    return {
        id: appt.id,
        workspaceId: appt.workspaceId,
        appointmentNumber: appt.appointmentNumber,

        workOrderId: appt.workOrderId,
        workOrderNumber: appt.workOrder.workOrderNumber,
        workOrderTitle: appt.workOrder.title,
        workOrderStatus: appt.workOrder.status,
        workOrderPriority: appt.workOrder.priority,

        customerId: appt.workOrder.customerId,
        customerName: appt.workOrder.customer.name,
        customerNumber: appt.workOrder.customer.customerNumber,

        locationId: appt.workOrder.locationId,
        locationName: appt.workOrder.location.name,
        locationAddress,
        locationLatitude: appt.workOrder.location.latitude
            ? Number(appt.workOrder.location.latitude)
            : null,
        locationLongitude: appt.workOrder.location.longitude
            ? Number(appt.workOrder.location.longitude)
            : null,

        assetId: appt.workOrder.assetId ?? null,
        assetName: appt.workOrder.asset?.name ?? null,
        assetNumber: appt.workOrder.asset?.assetNumber ?? null,

        technicianId: appt.technicianId,
        technicianName: appt.technician.employee.displayName || "Unknown Technician",
        technicianEmployeeNumber: appt.technician.employee.employeeNumber ?? null,

        scheduledStart: appt.scheduledStart,
        scheduledEnd: appt.scheduledEnd,
        durationMinutes: appt.durationMinutes,
        timezone: appt.timezone,

        status: appt.status,
        dispatchStatus: appt.dispatchStatus,

        dispatchedAt: appt.dispatchedAt,
        dispatchedByMemberId: appt.dispatchedByMemberId,
        dispatchedByName: appt.dispatchedByMember?.user?.name || null,

        undispatchedAt: appt.undispatchedAt,
        undispatchedByMemberId: appt.undispatchedByMemberId,

        fieldExecutionStartedAt: appt.fieldExecutionStartedAt,

        cancellationReason: appt.cancellationReason,
        notes: appt.notes,
        metadata: (appt.metadata as Record<string, any>) ?? null,

        createdAt: appt.createdAt,
        updatedAt: appt.updatedAt,
    };
}
