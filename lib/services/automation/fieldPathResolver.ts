/**
 * Phase 1.16.4 — Field Path Resolver
 *
 * Resolves dotted and indexed field paths against an ExecutionContext object.
 * Guaranteed safe resolution: returns undefined on missing, null, or invalid paths without throwing.
 */

/**
 * Tokenizes a field path into individual string and index segments.
 * Supports dot-notation ("trigger.payload.workOrder.id") and bracket notation ("items[0].name").
 */
export function tokenizeFieldPath(path: string): string[] {
  if (!path || typeof path !== "string") {
    return [];
  }

  const normalized = path.trim();
  if (normalized === "") {
    return [];
  }

  // Replace bracket access [0] or ['prop'] with dot access .0 or .prop
  const cleaned = normalized
    .replace(/\[\s*['"]?([^'"\]]+)['"]?\s*\]/g, ".$1")
    .replace(/^\./, "");

  return cleaned.split(".").map((seg) => seg.trim()).filter((seg) => seg.length > 0);
}

/**
 * Internal recursive walker for an object along tokenized path segments.
 */
function walkObjectSegments(obj: unknown, segments: string[]): unknown {
  let current: any = obj;

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined;
    }

    if (typeof current !== "object" && typeof current !== "function") {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

/**
 * Resolves a field path against an ExecutionContext or generic object.
 *
 * Resolution strategy:
 * 1. Resolves directly against root context (e.g. `trigger.payload.workOrder.status` or `steps.1.output.id`).
 * 2. If unresolved and path does not start with standard prefixes (`trigger.`, `steps.`, `metadata.`),
 *    attempts fallback resolution against `context.trigger.payload` and `context.payload`.
 *
 * @param context - The ExecutionContext or root data object.
 * @param fieldPath - The dotted/bracketed field path expression.
 * @returns The resolved value, or `undefined` if not found.
 */
export function resolveFieldPath(context: unknown, fieldPath: string): unknown {
  if (context === null || context === undefined || !fieldPath) {
    return undefined;
  }

  const segments = tokenizeFieldPath(fieldPath);
  if (segments.length === 0) {
    return undefined;
  }

  // 1. Direct path lookup from root context
  const directValue = walkObjectSegments(context, segments);
  if (directValue !== undefined) {
    return directValue;
  }

  // 1b. Steps output fallback: if path is "steps.1.field", fallback to "steps.1.output.field"
  const firstSeg = segments[0];
  if (firstSeg === "steps" && segments.length >= 3 && segments[2] !== "output" && typeof context === "object") {
    const stepsOutputSegments = ["steps", segments[1], "output", ...segments.slice(2)];
    const stepsOutputVal = walkObjectSegments(context, stepsOutputSegments);
    if (stepsOutputVal !== undefined) {
      return stepsOutputVal;
    }
  }

  // 2. Convenience fallback: if context has `trigger.payload` and path is shorthand (e.g. "workOrder.priority")
  if (firstSeg !== "trigger" && firstSeg !== "steps" && firstSeg !== "metadata" && typeof context === "object") {
    const ctxAny = context as Record<string, any>;

    if (ctxAny.trigger && typeof ctxAny.trigger === "object" && ctxAny.trigger.payload) {
      const triggerPayloadVal = walkObjectSegments(ctxAny.trigger.payload, segments);
      if (triggerPayloadVal !== undefined) {
        return triggerPayloadVal;
      }
    }

    if (ctxAny.payload && typeof ctxAny.payload === "object") {
      const payloadVal = walkObjectSegments(ctxAny.payload, segments);
      if (payloadVal !== undefined) {
        return payloadVal;
      }
    }
  }

  return undefined;
}

