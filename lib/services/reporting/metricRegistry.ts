import { METRIC_KEYS } from "./reporting.schemas";
import { UnknownMetricError, ReportMetricUnavailableError, ReportParameterValidationError } from "./reportingErrors";
import type { MetricDefinition, MetricKey } from "./reporting.types";

/**
 * Metric Registry (Closed compile-time allowlist).
 * Populated incrementally across Phase 1.14.3 – 1.14.7.
 */
export const METRIC_REGISTRY: Partial<Record<MetricKey, MetricDefinition>> = {};

/**
 * Retrieves a registered metric definition by key.
 * Throws ReportMetricUnavailableError (501) if definition.deferredReason is set (§17.2).
 * Throws UnknownMetricError (404) if the key is not registered.
 */
export function findMetricDefinition(key: MetricKey): MetricDefinition | undefined {
  return METRIC_REGISTRY[key];
}

export function getMetricDefinition(key: MetricKey): MetricDefinition {
  const definition = METRIC_REGISTRY[key];
  if (!definition) {
    throw new UnknownMetricError(`Unknown or unregistered metric key: "${key}".`);
  }
  if (definition.deferredReason) {
    throw new ReportMetricUnavailableError(definition.deferredReason);
  }
  return definition;
}

/**
 * Internal helper to register metric definitions into the registry.
 * Strictly enforces compile-time closed allowlist membership.
 */
export function registerMetric(definition: MetricDefinition): void {
  if (!METRIC_KEYS.includes(definition.key)) {
    throw new ReportParameterValidationError(
      `Cannot register metric "${definition.key}": key is not part of the closed METRIC_KEYS allowlist (Phase 1.14.2 constraint).`,
    );
  }
  METRIC_REGISTRY[definition.key] = definition;
}

/**
 * Internal helper for testing (to remove temporary registrations).
 */
export function unregisterMetric(key: MetricKey): void {
  delete METRIC_REGISTRY[key];
}
