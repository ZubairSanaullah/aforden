import type { TechnicianDirectoryItem } from "@/lib/services/technicianProfile/technicianDirectory.types";
import type { TechnicianProfileOverview } from "@/lib/services/technicianProfile/technicianProfileOverview.types";

/**
 * Canonical external representation of a Technician resource.
 *
 * Privacy & Security Guarantees:
 * - Excludes `emergencyContact` (Personal emergency phone numbers - internal HR only)
 * - Excludes `notes` (Private management/HR notes)
 * - Excludes `hireDate` (Internal HR/payroll onboarding metadata)
 * - Excludes `workspaceId` (Tenant boundary security invariant)
 * - Excludes compensation/pay-rate (Confidential financial HR data)
 * - Excludes personal home address / GPS tracking
 */
export interface PublicTechnicianSkillDto {
    id: string;
    name: string;
    proficiency: string;
}

export interface PublicTechnicianServiceAreaDto {
    id: string;
    name: string;
}

export interface PublicTechnicianDto {
    id: string;
    employeeNumber: string | null;
    displayName: string;
    phone: string | null;
    status: string;
    jobTitle: string | null;
    department: string | null;
    licenseNumber: string | null;
    yearsExperience: number | null;
    skills: PublicTechnicianSkillDto[];
    serviceAreas: PublicTechnicianServiceAreaDto[];
}

export const APPROVED_PUBLIC_TECHNICIAN_DTO_KEYS = [
    "id",
    "employeeNumber",
    "displayName",
    "phone",
    "status",
    "jobTitle",
    "department",
    "licenseNumber",
    "yearsExperience",
    "skills",
    "serviceAreas",
] as const;

/**
 * Maps a directory list item or detail overview model to the canonical PublicTechnicianDto.
 */
export function toPublicTechnicianDto(
    item: TechnicianDirectoryItem | TechnicianProfileOverview | any,
): PublicTechnicianDto {
    // Determine if input is a detail overview or a directory item
    if ("employee" in item && "technicianProfile" in item) {
        const skills: PublicTechnicianSkillDto[] = Array.isArray(item.skills)
            ? item.skills.map((s: any) => ({
                  id: s.skill?.id ?? s.id,
                  name: s.skill?.name ?? s.name,
                  proficiency: s.proficiency,
              }))
            : [];

        const serviceAreas: PublicTechnicianServiceAreaDto[] = Array.isArray(item.serviceAreas)
            ? item.serviceAreas.map((sa: any) => ({
                  id: sa.serviceArea?.id ?? sa.id,
                  name: sa.serviceArea?.name ?? sa.name,
              }))
            : [];

        return {
            id: item.technicianProfile?.id ?? item.id,
            employeeNumber: item.employee?.employeeNumber ?? null,
            displayName: item.employee?.displayName || "Unknown Technician",
            phone: item.employee?.phone ?? null,
            status: item.employee?.status ?? "ACTIVE",
            jobTitle: item.jobTitle?.name ?? null,
            department: item.department?.name ?? null,
            licenseNumber: item.technicianProfile?.licenseNumber ?? null,
            yearsExperience: item.technicianProfile?.yearsExperience ?? null,
            skills,
            serviceAreas,
        };
    }

    return {
        id: item.id,
        employeeNumber: item.employeeNumber ?? null,
        displayName: item.displayName || "Unknown Technician",
        phone: item.phone ?? null,
        status: item.status ?? "ACTIVE",
        jobTitle: typeof item.jobTitle === "string" ? item.jobTitle : item.jobTitle?.name ?? null,
        department: typeof item.department === "string" ? item.department : item.department?.name ?? null,
        licenseNumber: item.licenseNumber ?? null,
        yearsExperience: item.yearsExperience ?? null,
        skills: Array.isArray(item.skills) ? item.skills : [],
        serviceAreas: Array.isArray(item.serviceAreas) ? item.serviceAreas : [],
    };
}
