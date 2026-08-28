/**
 * Phase 1.16 — Automation & Workflows Domain Service
 * Barrel export for automation domain services, types, errors, and catalogs.
 */

export * from "./automation.types";
export * from "./automationErrors";
export * from "./automation.schemas";
export * from "./eventCatalogRegistry";
export * from "./ingestionDeduplication";
export * from "./triggerMatcherService";
export * from "./eventIngestionService";
export * from "./fieldPathResolver";
export * from "./operatorEvaluator";
export * from "./conditionValidator";
export * from "./conditionEvaluatorService";
export * from "./actionParamResolver";
export * from "./actionSchemas";
export * from "./handlers";
export * from "./actionRegistry";
export * from "./executionEngineService";
export * from "./cronEngine";
export * from "./intervalEngine";
export * from "./entityOffsetEngine";
export * from "./scheduleJobService";
export * from "./automationManagementService";
export * from "./errorClassifier";
export * from "./retryEngine";
export * from "./deadLetterQueueService";
