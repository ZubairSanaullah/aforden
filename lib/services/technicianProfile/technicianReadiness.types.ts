import type { EmployeeStatus } from "@/generated/prisma/client";

export const TECHNICIAN_READINESS_BLOCKERS = [
    "EMPLOYEE_NOT_ACTIVE",
    "TECHNICIAN_PROFILE_MISSING",
    "NO_ACTIVE_SKILLS",
    "NO_ACTIVE_SERVICE_AREAS",
    "NO_ACTIVE_AVAILABILITY",
] as const;

export type TechnicianReadinessBlocker =
    (typeof TECHNICIAN_READINESS_BLOCKERS)[number];

export interface TechnicianReadiness {
    technicianProfileId: string | null;
    employeeId: string;

    isReady: boolean;

    employeeStatus: EmployeeStatus;

    hasTechnicianProfile: boolean;
    hasActiveSkills: boolean;
    hasActiveServiceAreas: boolean;
    hasActiveAvailability: boolean;

    blockers: TechnicianReadinessBlocker[];
}
