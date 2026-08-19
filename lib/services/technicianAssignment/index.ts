// --- Phase 1.3.19 & 1.3.21 Mutation & Lifecycle Services ---
export { createTechnicianAssignment } from "./createTechnicianAssignment";
export { getTechnicianAssignment } from "./getTechnicianAssignment";
export { getTechnicianAssignments } from "./getTechnicianAssignments";
export { getTechnicianAssignmentsByTechnician } from "./getTechnicianAssignmentsByTechnician";
export { getTechnicianAssignmentsByWork } from "./getTechnicianAssignmentsByWork";
export { updateTechnicianAssignment } from "./updateTechnicianAssignment";
export { updateTechnicianAssignmentStatus } from "./updateTechnicianAssignmentStatus";
export { completeTechnicianAssignment } from "./completeTechnicianAssignment";
export { cancelTechnicianAssignment } from "./cancelTechnicianAssignment";
export { assertTechnicianAssignmentEligibility } from "./assignmentEligibilityUtils";
export {
    TechnicianAssignmentNotFoundError,
    TechnicianAssignmentAlreadyExistsError,
    InvalidTechnicianProfileError,
    TechnicianNotEligibleForAssignmentError,
    TechnicianAssignmentOverlapError,
    InvalidAssignmentTimeError,
    AssignmentInvalidStatusTransitionError,
    AssignmentImmutableError,
} from "./technicianAssignmentErrors";
export {
    createTechnicianAssignmentSchema,
    updateTechnicianAssignmentSchema,
    updateTechnicianAssignmentStatusSchema,
    cancelTechnicianAssignmentSchema,
    assignmentWorkTypeSchema,
    technicianAssignmentStatusSchema,
    type CreateTechnicianAssignmentInput,
    type UpdateTechnicianAssignmentInput,
    type UpdateTechnicianAssignmentStatusInput,
    type CancelTechnicianAssignmentInput,
} from "@/lib/validations/technicianAssignment";
export type {
    TechnicianAssignment,
    TechnicianAssignmentFilterOptions,
    TechnicianAssignmentListResult,
    AssignmentWorkType,
    TechnicianAssignmentStatus,
} from "./technicianAssignment.types";

// --- Phase 1.3.20 Read Models, Workload, Schedule, Conflicts, & Statistics ---
export { getTechnicianAssignmentOverview } from "./getTechnicianAssignmentOverview";
export { getTechnicianAssignmentOverviews } from "./getTechnicianAssignmentOverviews";
export { getTechnicianSchedule } from "./getTechnicianSchedule";
export { getTechnicianWorkload } from "./getTechnicianWorkload";
export { getTechnicianAssignmentConflicts } from "./getTechnicianAssignmentConflicts";
export { getTechnicianAssignmentStats } from "./getTechnicianAssignmentStats";
export {
    getTechnicianAssignmentOverviewsQuerySchema,
    getTechnicianScheduleQuerySchema,
    getTechnicianWorkloadQuerySchema,
    getTechnicianAssignmentConflictsQuerySchema,
    getTechnicianAssignmentStatsQuerySchema,
    type GetTechnicianAssignmentOverviewsQueryInput,
    type GetTechnicianScheduleQueryInput,
    type GetTechnicianWorkloadQueryInput,
    type GetTechnicianAssignmentConflictsQueryInput,
    type GetTechnicianAssignmentStatsQueryInput,
} from "@/lib/validations/technicianAssignmentQuery";
export type {
    TechnicianAssignmentEmployeeSummary,
    TechnicianAssignmentOverview,
    TechnicianAssignmentOverviewListResult,
    AssignmentScheduleTemporalCategory,
    TechnicianScheduleItem,
    TechnicianScheduleResult,
    TechnicianWorkload,
    TechnicianAssignmentConflict,
    TechnicianAssignmentStatsByTechnician,
    TechnicianAssignmentStats,
} from "./technicianAssignmentOverview.types";

// --- Phase 1.3.22 Operational History & Audit Read Models ---
export { getTechnicianAssignmentHistory } from "./getTechnicianAssignmentHistory";
export { getTechnicianAssignmentHistoryForWorkspace } from "./getTechnicianAssignmentHistoryForWorkspace";
export { getTechnicianAssignmentTimeline } from "./getTechnicianAssignmentTimeline";
export { getTechnicianAssignmentHistorySummary } from "./getTechnicianAssignmentHistorySummary";
export {
    getTechnicianAssignmentHistoryQuerySchema,
    getWorkspaceTechnicianAssignmentHistoryQuerySchema,
    getTechnicianAssignmentTimelineQuerySchema,
    getTechnicianAssignmentHistorySummaryQuerySchema,
    type GetTechnicianAssignmentHistoryQueryInput,
    type GetWorkspaceTechnicianAssignmentHistoryQueryInput,
    type GetTechnicianAssignmentTimelineQueryInput,
    type GetTechnicianAssignmentHistorySummaryQueryInput,
} from "@/lib/validations/technicianAssignmentHistory";
export type {
    TechnicianAssignmentHistoryEmployeeSummary,
    TechnicianAssignmentHistoryItem,
    TechnicianAssignmentHistoryListResult,
    AssignmentHistoryEventType,
    TechnicianAssignmentHistoryEvent,
    TechnicianAssignmentHistorySummary,
} from "./technicianAssignmentHistory.types";
