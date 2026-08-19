export {
    assignServiceAreaToTechnician,
    type TechnicianServiceAreaWithServiceArea,
} from "./assignServiceAreaToTechnician";
export {
    getTechnicianServiceArea,
    type TechnicianServiceAreaDetails,
} from "./getTechnicianServiceArea";
export {
    getTechnicianServiceAreas,
    type TechnicianServiceAreaItem,
} from "./getTechnicianServiceAreas";
export { updateTechnicianServiceArea } from "./updateTechnicianServiceArea";
export { removeServiceAreaFromTechnician } from "./removeServiceAreaFromTechnician";
export {
    TechnicianServiceAreaNotFoundError,
    TechnicianServiceAreaAlreadyExistsError,
    InvalidTechnicianProfileError,
    InvalidServiceAreaAssignmentError,
} from "./technicianServiceAreaErrors";
export {
    createTechnicianServiceAreaSchema,
    updateTechnicianServiceAreaSchema,
    type CreateTechnicianServiceAreaInput,
    type UpdateTechnicianServiceAreaInput,
} from "@/lib/validations/technicianServiceArea";
