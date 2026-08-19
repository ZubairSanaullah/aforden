import type {
    EmployeeStatus,
    DepartmentStatus,
    JobTitleStatus,
    SkillProficiency,
    ServiceAreaStatus,
} from "@/generated/prisma/client";

export interface TechnicianDirectoryEmployee {
    id: string;
    employeeNumber: string | null;
    displayName: string | null;
    phone: string | null;
    hireDate: Date | null;
    status: EmployeeStatus;
}

export interface TechnicianDirectoryDepartment {
    id: string;
    name: string;
    status: DepartmentStatus;
}

export interface TechnicianDirectoryJobTitle {
    id: string;
    name: string;
    status: JobTitleStatus;
}

export interface TechnicianDirectoryProfile {
    id: string;
    licenseNumber: string | null;
    yearsExperience: number | null;
}

export interface TechnicianDirectorySkill {
    id: string;
    name: string;
    proficiency: SkillProficiency;
}

export interface TechnicianDirectoryServiceArea {
    id: string;
    name: string;
    status: ServiceAreaStatus;
}

export interface TechnicianDirectoryAvailabilitySummary {
    activeDays: number;
}

export interface TechnicianDirectoryItem {
    id: string;
    employeeId: string;
    employee: TechnicianDirectoryEmployee;
    department: TechnicianDirectoryDepartment | null;
    jobTitle: TechnicianDirectoryJobTitle | null;
    technicianProfile: TechnicianDirectoryProfile;
    skills: TechnicianDirectorySkill[];
    serviceAreas: TechnicianDirectoryServiceArea[];
    availabilitySummary: TechnicianDirectoryAvailabilitySummary;
}

export interface PaginationMetadata {
    page: number;
    pageSize: number;
    total: number;
    totalPages: number;
    hasNextPage: boolean;
    hasPreviousPage: boolean;
}

export interface TechnicianDirectoryResult {
    items: TechnicianDirectoryItem[];
    pagination: PaginationMetadata;
}
