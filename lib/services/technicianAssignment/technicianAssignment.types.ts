import type {
    AssignmentWorkType,
    TechnicianAssignmentStatus,
} from "@/generated/prisma/client";

export type {
    AssignmentWorkType,
    TechnicianAssignmentStatus,
};

export interface TechnicianAssignment {
    id: string;
    technicianProfileId: string;
    employeeId: string;
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

export interface TechnicianAssignmentFilterOptions {
    technicianProfileId?: string;
    workType?: AssignmentWorkType;
    workReferenceId?: string;
    status?: TechnicianAssignmentStatus;
    startsAt?: Date;
    endsAt?: Date;
    page?: number;
    pageSize?: number;
}

export interface TechnicianAssignmentListResult {
    items: TechnicianAssignment[];
    pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
    };
}
