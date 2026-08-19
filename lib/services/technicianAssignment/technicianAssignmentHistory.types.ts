import type {
    AssignmentWorkType,
    TechnicianAssignmentStatus,
    EmployeeStatus,
} from "@/generated/prisma/client";

export interface TechnicianAssignmentHistoryEmployeeSummary {
    id: string;
    employeeNumber: string | null;
    displayName: string | null;
    phone: string | null;
    status: EmployeeStatus;
}

export interface TechnicianAssignmentHistoryItem {
    id: string;
    technicianProfileId: string;
    employeeId: string;
    employee: TechnicianAssignmentHistoryEmployeeSummary;
    workType: AssignmentWorkType;
    workReferenceId: string;
    status: TechnicianAssignmentStatus;
    startsAt: Date;
    endsAt: Date;
    scheduledMinutes: number;
    createdAt: Date;
    completedAt: Date | null;
    cancelledAt: Date | null;
    cancellationReason: string | null;
    notes: string | null;
}

export interface TechnicianAssignmentHistoryListResult {
    items: TechnicianAssignmentHistoryItem[];
    pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
    };
}

export type AssignmentHistoryEventType = "CREATED" | "COMPLETED" | "CANCELLED";

export interface TechnicianAssignmentHistoryEvent {
    assignmentId: string;
    technicianProfileId: string;
    employeeId: string;
    type: AssignmentHistoryEventType;
    occurredAt: Date;
    status: TechnicianAssignmentStatus;
    workType: AssignmentWorkType;
    workReferenceId: string;
    cancellationReason: string | null;
}

export interface TechnicianAssignmentHistorySummary {
    totalAssignments: number;
    assignedCount: number;
    completedCount: number;
    cancelledCount: number;
    totalScheduledMinutes: number;
    completedScheduledMinutes: number;
    cancelledScheduledMinutes: number;
}
