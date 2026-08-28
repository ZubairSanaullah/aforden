/**
 * Phase 1.16.4 — Condition Write-Time Validator
 *
 * Validates condition configuration payloads at creation / update time to reject
 * invalid operator & targetValue shape combinations.
 */

import { ConditionOperator } from "@/generated/prisma/enums";
import { AutomationValidationError } from "./automationErrors";
import {
  isDangerousRegexPattern,
  MAX_REGEX_PATTERN_LENGTH,
} from "./operatorEvaluator";

/**
 * Validates a condition's target value against its declared operator.
 * Enforces strict shape requirements and throws AutomationValidationError on mismatch.
 */
export function validateConditionDefinition(
  operator: ConditionOperator,
  targetValueJson: unknown,
  fieldPath?: string
): void {
  if (fieldPath !== undefined) {
    if (typeof fieldPath !== "string" || fieldPath.trim() === "") {
      throw new AutomationValidationError("Condition fieldPath must be a non-empty string");
    }
  }

  switch (operator) {
    // 1. Operators requiring NO target value (strictly null, undefined, or empty object; reject arrays & scalars)
    case ConditionOperator.IS_NULL:
    case ConditionOperator.IS_NOT_NULL:
    case ConditionOperator.IS_EMPTY:
    case ConditionOperator.IS_NOT_EMPTY:
    case ConditionOperator.IS_TRUE:
    case ConditionOperator.IS_FALSE: {
      if (targetValueJson !== null && targetValueJson !== undefined) {
        if (
          typeof targetValueJson !== "object" ||
          Array.isArray(targetValueJson) ||
          Object.keys(targetValueJson as object).length > 0
        ) {
          throw new AutomationValidationError(
            `Operator '${operator}' does not accept a target value; targetValueJson must be null or undefined`
          );
        }
      }
      break;
    }

    // 2. Collection operators requiring an Array
    case ConditionOperator.IN:
    case ConditionOperator.NOT_IN: {
      if (!Array.isArray(targetValueJson)) {
        throw new AutomationValidationError(
          `Operator '${operator}' requires targetValueJson to be an array`
        );
      }
      if (targetValueJson.length === 0) {
        throw new AutomationValidationError(
          `Operator '${operator}' target array cannot be empty`
        );
      }
      break;
    }

    // 3. Numeric comparison operators requiring a finite number
    case ConditionOperator.GREATER_THAN:
    case ConditionOperator.GREATER_THAN_OR_EQUAL:
    case ConditionOperator.LESS_THAN:
    case ConditionOperator.LESS_THAN_OR_EQUAL: {
      if (targetValueJson === null || targetValueJson === undefined) {
        throw new AutomationValidationError(
          `Operator '${operator}' requires a numeric targetValueJson`
        );
      }
      const num = Number(targetValueJson);
      if (isNaN(num)) {
        throw new AutomationValidationError(
          `Operator '${operator}' targetValueJson must be a valid number, received '${String(targetValueJson)}'`
        );
      }
      break;
    }

    // 4. Temporal relative day operators requiring a positive number
    case ConditionOperator.WITHIN_LAST_DAYS:
    case ConditionOperator.WITHIN_NEXT_DAYS: {
      if (targetValueJson === null || targetValueJson === undefined) {
        throw new AutomationValidationError(
          `Operator '${operator}' requires a positive integer day count for targetValueJson`
        );
      }
      const days = Number(targetValueJson);
      if (isNaN(days) || days < 0) {
        throw new AutomationValidationError(
          `Operator '${operator}' requires targetValueJson to be a non-negative number of days`
        );
      }
      break;
    }

    // 5. Date operators requiring a valid parseable date
    case ConditionOperator.BEFORE_DATE:
    case ConditionOperator.AFTER_DATE: {
      if (targetValueJson === null || targetValueJson === undefined) {
        throw new AutomationValidationError(
          `Operator '${operator}' requires an ISO date string or timestamp for targetValueJson`
        );
      }
      const parsedDate = new Date(targetValueJson as any);
      if (isNaN(parsedDate.getTime())) {
        throw new AutomationValidationError(
          `Operator '${operator}' targetValueJson '${String(targetValueJson)}' is not a valid date`
        );
      }
      break;
    }

    // 6. Regex operator requiring safe regex pattern string
    case ConditionOperator.MATCHES_REGEX: {
      if (typeof targetValueJson !== "string" || targetValueJson.trim() === "") {
        throw new AutomationValidationError(
          "Operator 'MATCHES_REGEX' requires a non-empty string pattern for targetValueJson"
        );
      }
      if (targetValueJson.length > MAX_REGEX_PATTERN_LENGTH) {
        throw new AutomationValidationError(
          `Regex pattern exceeds maximum allowed length of ${MAX_REGEX_PATTERN_LENGTH} characters`
        );
      }
      if (isDangerousRegexPattern(targetValueJson)) {
        throw new AutomationValidationError(
          "Regex pattern contains unsafe nested quantifier or exponential backtracking constructs (ReDoS vulnerability)"
        );
      }
      try {
        new RegExp(targetValueJson);
      } catch (err: any) {
        throw new AutomationValidationError(
          `Invalid regular expression syntax: ${err?.message || "syntax error"}`
        );
      }
      break;
    }

    // 7. General equality / string matching operators
    case ConditionOperator.EQUALS:
    case ConditionOperator.NOT_EQUALS:
    case ConditionOperator.CONTAINS:
    case ConditionOperator.NOT_CONTAINS:
    case ConditionOperator.STARTS_WITH:
    case ConditionOperator.ENDS_WITH: {
      if (targetValueJson === undefined) {
        throw new AutomationValidationError(
          `Operator '${operator}' requires targetValueJson to be defined`
        );
      }
      break;
    }

    default: {
      throw new AutomationValidationError(`Unknown condition operator '${String(operator)}'`);
    }
  }
}
