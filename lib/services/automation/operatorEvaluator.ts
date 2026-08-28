/**
 * Phase 1.16.4 — Operator Evaluator & Type Coercion Engine
 *
 * Implements strict, deterministic evaluation and type coercion for all 23 ConditionOperator values.
 */

import { ConditionOperator } from "@/generated/prisma/enums";

/**
 * Maximum permitted characters for regular expression pattern input.
 */
export const MAX_REGEX_PATTERN_LENGTH = 256;

/**
 * Maximum characters of input string allowed for regex evaluation.
 */
export const MAX_REGEX_INPUT_STRING_LENGTH = 10000;

/**
 * Static detection of catastrophic polynomial / exponential backtracking constructs (ReDoS).
 * Detects nested quantifiers such as `(a+)+`, `(a*)*`, `(a+)*`, `(\w+)+`, `(\d*)+`.
 */
export function isDangerousRegexPattern(pattern: string): boolean {
  if (!pattern || typeof pattern !== "string") {
    return false;
  }
  if (pattern.length > MAX_REGEX_PATTERN_LENGTH) {
    return true;
  }

  // Nested quantifier pattern matching: (expr+)+, (expr*)*, (expr+)*, (expr*)+, (expr+){2,}
  const nestedQuantifierRegex = /\([^)]*[\+\*]\)[\+\*\{]/;
  if (nestedQuantifierRegex.test(pattern)) {
    return true;
  }

  // Overlapping alternation with quantifier: (a|a)+ or (.*|.*)*
  const redundantAlternationRegex = /\(([^|)]+)\|\1\)[+*]/;
  if (redundantAlternationRegex.test(pattern)) {
    return true;
  }

  return false;
}

/**
 * Deep equality comparator for JSON-compatible primitives, arrays, and objects.
 */
export function areValuesDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }

  if (a === null || b === null || a === undefined || b === undefined) {
    return a === b;
  }

  // Numeric coercion: "100" vs 100
  if (typeof a === "number" && typeof b === "string" && !isNaN(Number(b))) {
    return a === Number(b);
  }
  if (typeof a === "string" && typeof b === "number" && !isNaN(Number(a))) {
    return Number(a) === b;
  }

  // Boolean coercion: "true" vs true
  if (typeof a === "boolean" && typeof b === "string") {
    return (b.toLowerCase() === "true" && a === true) || (b.toLowerCase() === "false" && a === false);
  }
  if (typeof a === "string" && typeof b === "boolean") {
    return (a.toLowerCase() === "true" && b === true) || (a.toLowerCase() === "false" && b === false);
  }

  if (typeof a !== "object" || typeof b !== "object") {
    return false;
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!areValuesDeepEqual(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }

  if (Array.isArray(a) !== Array.isArray(b)) {
    return false;
  }

  const keysA = Object.keys(a as object);
  const keysB = Object.keys(b as object);

  if (keysA.length !== keysB.length) {
    return false;
  }

  for (const key of keysA) {
    if (!Object.prototype.hasOwnProperty.call(b, key)) {
      return false;
    }
    if (!areValuesDeepEqual((a as any)[key], (b as any)[key])) {
      return false;
    }
  }

  return true;
}

/**
 * Evaluates a single condition operator against a resolved value and target value.
 *
 * @param operator - Canonical ConditionOperator enum
 * @param resolvedValue - Value resolved from execution context
 * @param targetValue - Expected value configured on condition
 * @param now - Reference timestamp (defaults to Date.now())
 */
export function evaluateOperator(
  operator: ConditionOperator,
  resolvedValue: unknown,
  targetValue: unknown,
  now: Date = new Date()
): boolean {
  switch (operator) {
    // -------------------------------------------------------------
    // 1. Equality & Comparison Operators
    // -------------------------------------------------------------
    case ConditionOperator.EQUALS:
      return areValuesDeepEqual(resolvedValue, targetValue);

    case ConditionOperator.NOT_EQUALS:
      return !areValuesDeepEqual(resolvedValue, targetValue);

    case ConditionOperator.GREATER_THAN: {
      if (resolvedValue === null || resolvedValue === undefined || targetValue === null || targetValue === undefined) {
        return false;
      }
      const numA = Number(resolvedValue);
      const numB = Number(targetValue);
      if (isNaN(numA) || isNaN(numB)) {
        return false;
      }
      return numA > numB;
    }

    case ConditionOperator.GREATER_THAN_OR_EQUAL: {
      if (resolvedValue === null || resolvedValue === undefined || targetValue === null || targetValue === undefined) {
        return false;
      }
      const numA = Number(resolvedValue);
      const numB = Number(targetValue);
      if (isNaN(numA) || isNaN(numB)) {
        return false;
      }
      return numA >= numB;
    }

    case ConditionOperator.LESS_THAN: {
      if (resolvedValue === null || resolvedValue === undefined || targetValue === null || targetValue === undefined) {
        return false;
      }
      const numA = Number(resolvedValue);
      const numB = Number(targetValue);
      if (isNaN(numA) || isNaN(numB)) {
        return false;
      }
      return numA < numB;
    }

    case ConditionOperator.LESS_THAN_OR_EQUAL: {
      if (resolvedValue === null || resolvedValue === undefined || targetValue === null || targetValue === undefined) {
        return false;
      }
      const numA = Number(resolvedValue);
      const numB = Number(targetValue);
      if (isNaN(numA) || isNaN(numB)) {
        return false;
      }
      return numA <= numB;
    }

    // -------------------------------------------------------------
    // 2. String Matching Operators (Case-Insensitive)
    // -------------------------------------------------------------
    case ConditionOperator.CONTAINS: {
      if (resolvedValue === null || resolvedValue === undefined) {
        return false;
      }
      if (Array.isArray(resolvedValue)) {
        return resolvedValue.some((item) => areValuesDeepEqual(item, targetValue));
      }
      const strA = String(resolvedValue).toLowerCase();
      const strB = String(targetValue ?? "").toLowerCase();
      return strA.includes(strB);
    }

    case ConditionOperator.NOT_CONTAINS: {
      if (resolvedValue === null || resolvedValue === undefined) {
        return true;
      }
      if (Array.isArray(resolvedValue)) {
        return !resolvedValue.some((item) => areValuesDeepEqual(item, targetValue));
      }
      const strA = String(resolvedValue).toLowerCase();
      const strB = String(targetValue ?? "").toLowerCase();
      return !strA.includes(strB);
    }

    case ConditionOperator.STARTS_WITH: {
      if (resolvedValue === null || resolvedValue === undefined) {
        return false;
      }
      const strA = String(resolvedValue).toLowerCase();
      const strB = String(targetValue ?? "").toLowerCase();
      return strA.startsWith(strB);
    }

    case ConditionOperator.ENDS_WITH: {
      if (resolvedValue === null || resolvedValue === undefined) {
        return false;
      }
      const strA = String(resolvedValue).toLowerCase();
      const strB = String(targetValue ?? "").toLowerCase();
      return strA.endsWith(strB);
    }

    case ConditionOperator.MATCHES_REGEX: {
      if (resolvedValue === null || resolvedValue === undefined) {
        return false;
      }
      const pattern = String(targetValue ?? "");
      if (isDangerousRegexPattern(pattern)) {
        return false;
      }
      try {
        const regex = new RegExp(pattern);
        const inputStr = String(resolvedValue).slice(0, MAX_REGEX_INPUT_STRING_LENGTH);
        return regex.test(inputStr);
      } catch {
        return false;
      }
    }

    // -------------------------------------------------------------
    // 3. Collection & Array Operators
    // -------------------------------------------------------------
    case ConditionOperator.IN: {
      if (!Array.isArray(targetValue)) {
        return false;
      }
      return targetValue.some((item) => areValuesDeepEqual(resolvedValue, item));
    }

    case ConditionOperator.NOT_IN: {
      if (!Array.isArray(targetValue)) {
        return true;
      }
      return !targetValue.some((item) => areValuesDeepEqual(resolvedValue, item));
    }

    case ConditionOperator.IS_EMPTY: {
      if (resolvedValue === null || resolvedValue === undefined) {
        return true;
      }
      if (typeof resolvedValue === "string") {
        return resolvedValue.trim() === "";
      }
      if (Array.isArray(resolvedValue)) {
        return resolvedValue.length === 0;
      }
      if (typeof resolvedValue === "object") {
        return Object.keys(resolvedValue).length === 0;
      }
      return false;
    }

    case ConditionOperator.IS_NOT_EMPTY: {
      if (resolvedValue === null || resolvedValue === undefined) {
        return false;
      }
      if (typeof resolvedValue === "string") {
        return resolvedValue.trim() !== "";
      }
      if (Array.isArray(resolvedValue)) {
        return resolvedValue.length > 0;
      }
      if (typeof resolvedValue === "object") {
        return Object.keys(resolvedValue).length > 0;
      }
      return true;
    }

    // -------------------------------------------------------------
    // 4. Nullability & Boolean Operators
    // -------------------------------------------------------------
    case ConditionOperator.IS_NULL:
      return resolvedValue === null || resolvedValue === undefined;

    case ConditionOperator.IS_NOT_NULL:
      return resolvedValue !== null && resolvedValue !== undefined;

    case ConditionOperator.IS_TRUE:
      return (
        resolvedValue === true ||
        resolvedValue === "true" ||
        resolvedValue === "TRUE" ||
        resolvedValue === 1 ||
        resolvedValue === "1"
      );

    case ConditionOperator.IS_FALSE:
      return (
        resolvedValue === false ||
        resolvedValue === "false" ||
        resolvedValue === "FALSE" ||
        resolvedValue === 0 ||
        resolvedValue === "0"
      );

    // -------------------------------------------------------------
    // 5. Date / Temporal Operators
    // -------------------------------------------------------------
    case ConditionOperator.BEFORE_DATE: {
      if (!resolvedValue || !targetValue) {
        return false;
      }
      const dateA = new Date(resolvedValue as any);
      const dateB = new Date(targetValue as any);
      if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) {
        return false;
      }
      return dateA.getTime() < dateB.getTime();
    }

    case ConditionOperator.AFTER_DATE: {
      if (!resolvedValue || !targetValue) {
        return false;
      }
      const dateA = new Date(resolvedValue as any);
      const dateB = new Date(targetValue as any);
      if (isNaN(dateA.getTime()) || isNaN(dateB.getTime())) {
        return false;
      }
      return dateA.getTime() > dateB.getTime();
    }

    case ConditionOperator.WITHIN_LAST_DAYS: {
      if (!resolvedValue || targetValue === null || targetValue === undefined) {
        return false;
      }
      const days = Number(targetValue);
      if (isNaN(days) || days < 0) {
        return false;
      }
      const dateA = new Date(resolvedValue as any);
      if (isNaN(dateA.getTime())) {
        return false;
      }
      const nowMs = now.getTime();
      const windowStartMs = nowMs - days * 24 * 60 * 60 * 1000;
      return dateA.getTime() >= windowStartMs && dateA.getTime() <= nowMs;
    }

    case ConditionOperator.WITHIN_NEXT_DAYS: {
      if (!resolvedValue || targetValue === null || targetValue === undefined) {
        return false;
      }
      const days = Number(targetValue);
      if (isNaN(days) || days < 0) {
        return false;
      }
      const dateA = new Date(resolvedValue as any);
      if (isNaN(dateA.getTime())) {
        return false;
      }
      const nowMs = now.getTime();
      const windowEndMs = nowMs + days * 24 * 60 * 60 * 1000;
      return dateA.getTime() >= nowMs && dateA.getTime() <= windowEndMs;
    }

    default:
      return false;
  }
}
