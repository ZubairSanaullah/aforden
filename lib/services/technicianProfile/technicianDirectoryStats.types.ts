export interface TechnicianEmployeeStatusSummary {
    ACTIVE: number;
    INACTIVE: number;
    ON_LEAVE: number;
    TERMINATED: number;
}

export interface TechnicianDepartmentStat {
    id: string;
    name: string;
    count: number;
}

export interface TechnicianJobTitleStat {
    id: string;
    name: string;
    count: number;
}

export interface TechnicianServiceAreaStat {
    id: string;
    name: string;
    count: number;
}

export interface TechnicianDirectoryStats {
    total: number;
    byEmployeeStatus: TechnicianEmployeeStatusSummary;
    byDepartment: TechnicianDepartmentStat[];
    byJobTitle: TechnicianJobTitleStat[];
    byServiceArea: TechnicianServiceAreaStat[];
    departmentUnassigned: number;
    jobTitleUnassigned: number;
    serviceAreaUnassigned: number;
}
