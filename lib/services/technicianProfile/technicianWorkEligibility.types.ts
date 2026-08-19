import type {
    EmployeeStatus,
    SkillProficiency,
    ServiceAreaStatus,
} from "@/generated/prisma/client";

export const TECHNICIAN_WORK_ELIGIBILITY_BLOCKERS = [
    "INVALID_REQUESTED_INTERVAL",
    "SERVICE_AREA_INACTIVE",
    "EMPLOYEE_NOT_ACTIVE",
    "TECHNICIAN_PROFILE_MISSING",
    "MISSING_REQUIRED_SKILLS",
    "SERVICE_AREA_NOT_ASSIGNED",
    "TECHNICIAN_NOT_AVAILABLE",
] as const;

export type TechnicianWorkEligibilityBlocker =
    (typeof TECHNICIAN_WORK_ELIGIBILITY_BLOCKERS)[number];

export interface TechnicianMatchedSkill {
    skillId: string;
    name: string;
    proficiency: SkillProficiency;
}

export interface TechnicianMissingSkill {
    skillId: string;
    name: string;
}

export interface TechnicianMatchedServiceArea {
    id: string;
    name: string;
    status: ServiceAreaStatus;
}

export interface TechnicianAvailabilityCheckSummary {
    isAvailable: boolean;
    matchingAvailabilityCount: number;
    blockingExceptionCount: number;
    blockers: string[];
}

export interface TechnicianWorkEligibility {
    technicianProfileId: string | null;
    employeeId: string;
    displayName: string | null;

    isEligible: boolean;

    employeeStatus: EmployeeStatus;

    hasTechnicianProfile: boolean;
    hasRequiredSkills: boolean;
    hasRequiredServiceArea: boolean;
    isAvailable: boolean;

    matchedSkills: TechnicianMatchedSkill[];
    missingSkills: TechnicianMissingSkill[];

    matchedServiceAreas: TechnicianMatchedServiceArea[];

    availabilityCheck: TechnicianAvailabilityCheckSummary;

    blockers: TechnicianWorkEligibilityBlocker[];
}

export interface EligibleTechniciansResult {
    items: TechnicianWorkEligibility[];
    pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
    };
}
