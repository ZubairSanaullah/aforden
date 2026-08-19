export { createDepartment } from "./createDepartment";
export { getDepartment } from "./getDepartment";
export { getDepartments } from "./getDepartments";
export { updateDepartment } from "./updateDepartment";
export { updateDepartmentStatus } from "./updateDepartmentStatus";
export { deleteDepartment } from "./deleteDepartment";
export {
    DepartmentNotFoundError,
    DepartmentAlreadyExistsError,
    DepartmentHasAssignedEmployeesError,
    InvalidDepartmentError,
} from "./departmentErrors";
export {
    createDepartmentSchema,
    updateDepartmentSchema,
    updateDepartmentStatusSchema,
    departmentStatusSchema,
    type CreateDepartmentInput,
    type UpdateDepartmentInput,
    type UpdateDepartmentStatusInput,
    type DepartmentStatusType,
} from "@/lib/validations/department";
