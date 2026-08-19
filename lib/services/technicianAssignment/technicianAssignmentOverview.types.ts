import type {
    AssignmentWorkType,
    TechnicianAssignmentStatus,
    EmployeeStatus,
} from "@/generated/prisma/client";

export interface TechnicianAssignmentEmployeeSummary {
    id: string;
    employeeNumber: string | null;
    displayName: string | null;
    phone: string | null;
    status: EmployeeStatus;
}

export interface TechnicianAssignmentOverview {
    id: string;
    technicianProfileId: string;
    employeeId: string;
    employee: TechnicianAssignmentEmployeeSummary;
    workType: AssignmentWorkType;
    workReferenceId: string;
    status: TechnicianAssignmentStatus;
    startsAt: Date;
    endsAt: Date;
    notes: string | null;
    completedAt: Date | null;
    cancelledAt: Date | null;
    cancellationReason: string | null;
    createdAt: Date;
    updatedAt: Date;
}

export interface TechnicianAssignmentOverviewListResult {
    items: TechnicianAssignmentOverview[];
    pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
    };
}

export type AssignmentScheduleTemporalCategory =
    | "CURRENT"
    | "UPCOMING"
    | "HISTORICAL";

export interface TechnicianScheduleItem extends TechnicianAssignmentOverview {
    temporalCategory: AssignmentScheduleTemporalCategory;
}

export interface TechnicianScheduleResult {
    technicianProfileId: string;
    employeeId: string;
    currentAssignments: TechnicianScheduleItem[];
    upcomingAssignments: TechnicianScheduleItem[];
    historicalAssignments: TechnicianScheduleItem[];
    totalCount: number;
}

export interface TechnicianWorkload {
    technicianProfileId: string;
    employeeId: string;
    currentAssignmentCount: number;
    upcomingAssignmentCount: number;
    activeAssignmentCount: number;
    completedAssignmentCount: number;
    cancelledAssignmentCount: number;
    scheduledAssignmentCount: number;
    scheduledMinutes: number;
    currentAssignments: TechnicianAssignmentOverview[];
    upcomingAssignments: TechnicianAssignmentOverview[];
}

export interface TechnicianAssignmentConflict {
    id: string;
    workType: AssignmentWorkType;
    workReferenceId: string;
    status: TechnicianAssignmentStatus;
    startsAt: Date;
    endsAt: Date;
    notes: string | null;
}

export interface TechnicianAssignmentStatsByTechnician {
    technicianProfileId: string;
    employeeId: string;
    displayName: string | null;
    count: number;
}

export interface TechnicianAssignmentStats {
    total: number;
    assigned: number;
    cancelled: number;
    completed: number;
    byWorkType: Record<AssignmentWorkType, number>;
    byTechnician: TechnicianAssignmentStatsByTechnician[];
    current: number;
    upcoming: number;
    scheduledMinutes: number;
}
