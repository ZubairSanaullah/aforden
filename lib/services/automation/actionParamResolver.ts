/**
 * Phase 1.16.5 — Action Parameter Template Resolver
 *
 * Recursively resolves template tokens (e.g. `{{trigger.payload.customerId}}`, `{{steps.1.workOrderId}}`)
 * in action parameters JSON against the runtime ActionExecutionContext using the fieldPathResolver.
 */

import { resolveFieldPath } from "./fieldPathResolver";
import type { ActionExecutionContext, ExecutionContext } from "./automation.types";

/**
 * Matches a standalone single template token covering the whole string: `{{ path.to.val }}`
 */
const STANDALONE_TOKEN_REGEX = /^\s*\{\{\s*([^}]+)\s*\}\}\s*$/;

/**
 * Matches embedded template tokens anywhere within a string: `Hello {{ name }}!`
 */
const EMBEDDED_TOKEN_REGEX = /\{\{\s*([^}]+)\s*\}\}/g;

/**
 * Resolves a single string value against the execution context.
 *
 * If the string is a standalone token (e.g. `"{{trigger.payload.amount}}"`),
 * the resolved raw value is returned with its native type preserved (number, boolean, object, etc.).
 *
 * If the string contains multiple or embedded tokens (e.g. `"Order #{{trigger.payload.id}}"`),
 * all tokens are interpolated as strings.
 */
export function resolveTemplateString(
  template: string,
  context: ActionExecutionContext | ExecutionContext | Record<string, unknown>,
): unknown {
  if (!template || typeof template !== "string") {
    return template;
  }

  // 1. Check for standalone token to preserve original scalar/object type
  const standaloneMatch = template.match(STANDALONE_TOKEN_REGEX);
  if (standaloneMatch) {
    const fieldPath = standaloneMatch[1].trim();
    const resolved = resolveFieldPath(context, fieldPath);
    // If resolved, return the typed value; if not resolved, return undefined
    return resolved;
  }

  // 2. Embedded string interpolation for mixed text + tokens
  if (template.includes("{{")) {
    return template.replace(EMBEDDED_TOKEN_REGEX, (_, tokenPath) => {
      const fieldPath = String(tokenPath).trim();
      const resolved = resolveFieldPath(context, fieldPath);
      if (resolved === undefined || resolved === null) {
        return "";
      }
      if (typeof resolved === "object") {
        return JSON.stringify(resolved);
      }
      return String(resolved);
    });
  }

  return template;
}

/**
 * Recursively resolves all template tokens in an action parameters payload.
 *
 * @param params - The raw params object, array, or scalar value.
 * @param context - The execution context with trigger payload, steps, and metadata.
 * @returns The deep-resolved parameters with template tokens replaced by evaluated context values.
 */
export function resolveActionParams(
  params: unknown,
  context: ActionExecutionContext | ExecutionContext | Record<string, unknown>,
): unknown {
  if (params === null || params === undefined) {
    return params;
  }

  if (typeof params === "string") {
    return resolveTemplateString(params, context);
  }

  if (Array.isArray(params)) {
    return params.map((item) => resolveActionParams(item, context));
  }

  if (typeof params === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
      const resolvedValue = resolveActionParams(value, context);
      if (resolvedValue !== undefined) {
        result[key] = resolvedValue;
      }
    }
    return result;
  }

  return params;
}
