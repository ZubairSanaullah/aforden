import type {
    EmployeeStatus,
    DepartmentStatus,
    JobTitleStatus,
    SkillProficiency,
    SkillStatus,
    ServiceAreaStatus,
    AvailabilityDay,
    TechnicianAvailabilityStatus,
    TechnicianExceptionType,
    TechnicianAvailabilityExceptionStatus,
} from "@/generated/prisma/client";

export interface TechnicianOverviewEmployee {
    id: string;
    employeeNumber: string | null;
    displayName: string | null;
    phone: string | null;
    hireDate: Date | null;
    status: EmployeeStatus;
    notes: string | null;
}

export interface TechnicianOverviewDepartment {
    id: string;
    name: string;
    description: string | null;
    status: DepartmentStatus;
}

export interface TechnicianOverviewJobTitle {
    id: string;
    name: string;
    description: string | null;
    status: JobTitleStatus;
}

export interface TechnicianOverviewProfile {
    id: string;
    licenseNumber: string | null;
    yearsExperience: number | null;
    emergencyContact: string | null;
    notes: string | null;
}

export interface TechnicianOverviewSkill {
    id: string;
    proficiency: SkillProficiency;
    yearsExperience: number | null;
    notes: string | null;
    skill: {
        id: string;
        name: string;
        description: string | null;
        status: SkillStatus;
    };
}

export interface TechnicianOverviewServiceArea {
    id: string;
    notes: string | null;
    serviceArea: {
        id: string;
        name: string;
        description: string | null;
        status: ServiceAreaStatus;
    };
}

export interface TechnicianOverviewAvailability {
    id: string;
    dayOfWeek: AvailabilityDay;
    startTime: string;
    endTime: string;
    status: TechnicianAvailabilityStatus;
    notes: string | null;
}

export interface TechnicianOverviewAvailabilityException {
    id: string;
    type: TechnicianExceptionType;
    status: TechnicianAvailabilityExceptionStatus;
    title: string;
    startsAt: Date;
    endsAt: Date;
    isAllDay: boolean;
    notes: string | null;
}

/**
 * Complete read-model representation of a technician profile aggregate.
 */
export interface TechnicianProfileOverview {
    employee: TechnicianOverviewEmployee;
    department: TechnicianOverviewDepartment | null;
    jobTitle: TechnicianOverviewJobTitle | null;
    technicianProfile: TechnicianOverviewProfile;
    skills: TechnicianOverviewSkill[];
    serviceAreas: TechnicianOverviewServiceArea[];
    availability: TechnicianOverviewAvailability[];
    availabilityExceptions: TechnicianOverviewAvailabilityException[];
}
