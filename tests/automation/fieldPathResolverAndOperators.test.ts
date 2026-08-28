/**
 * Phase 1.16.4 — Field Path Resolver, Operator Evaluator & Validator Unit Tests
 */

import { describe, it, expect } from "vitest";
import { ConditionOperator } from "@/generated/prisma/enums";
import {
  tokenizeFieldPath,
  resolveFieldPath,
} from "@/lib/services/automation/fieldPathResolver";
import {
  evaluateOperator,
  areValuesDeepEqual,
  isDangerousRegexPattern,
  MAX_REGEX_PATTERN_LENGTH,
} from "@/lib/services/automation/operatorEvaluator";
import { validateConditionDefinition } from "@/lib/services/automation/conditionValidator";
import { AutomationValidationError } from "@/lib/services/automation/automationErrors";
import type { ExecutionContext } from "@/lib/services/automation/automation.types";

describe("Phase 1.16.4 — Field Path Resolver & Operator Engine Unit Tests", () => {
  describe("1. Field Path Resolver", () => {
    const mockContext: ExecutionContext = {
      workspaceId: "ws_test",
      ruleId: "rule_1",
      executionId: "exec_1",
      trigger: {
        type: "WORK_ORDER_COMPLETED",
        eventType: "work_order.completed",
        payload: {
          workOrder: {
            id: "wo_100",
            priority: "URGENT",
            totalAmount: 3500.5,
            items: [
              { sku: "PART-1", quantity: 2 },
              { sku: "PART-2", quantity: 5 },
            ],
            customer: {
              name: "Acme Corp",
              email: "ops@acme.com",
            },
          },
        },
      },
      steps: {
        "1": {
          output: {
            invoiceId: "inv_200",
            status: "DRAFT",
          },
        },
      },
      metadata: {
        actorId: "usr_admin",
      },
    };

    it("should tokenize dot and bracket paths correctly", () => {
      expect(tokenizeFieldPath("trigger.payload.workOrder.id")).toEqual([
        "trigger",
        "payload",
        "workOrder",
        "id",
      ]);
      expect(tokenizeFieldPath("trigger.payload.workOrder.items[0].sku")).toEqual([
        "trigger",
        "payload",
        "workOrder",
        "items",
        "0",
        "sku",
      ]);
      expect(tokenizeFieldPath("steps['1'].output.invoiceId")).toEqual([
        "steps",
        "1",
        "output",
        "invoiceId",
      ]);
    });

    it("should resolve dotted paths against root context", () => {
      expect(resolveFieldPath(mockContext, "trigger.payload.workOrder.priority")).toBe("URGENT");
      expect(resolveFieldPath(mockContext, "trigger.payload.workOrder.totalAmount")).toBe(3500.5);
      expect(resolveFieldPath(mockContext, "trigger.payload.workOrder.customer.email")).toBe("ops@acme.com");
      expect(resolveFieldPath(mockContext, "steps.1.output.invoiceId")).toBe("inv_200");
      expect(resolveFieldPath(mockContext, "metadata.actorId")).toBe("usr_admin");
    });

    it("should resolve indexed array elements", () => {
      expect(resolveFieldPath(mockContext, "trigger.payload.workOrder.items[0].sku")).toBe("PART-1");
      expect(resolveFieldPath(mockContext, "trigger.payload.workOrder.items.1.quantity")).toBe(5);
    });

    it("should resolve shorthand paths using convenience fallback", () => {
      expect(resolveFieldPath(mockContext, "workOrder.priority")).toBe("URGENT");
      expect(resolveFieldPath(mockContext, "workOrder.customer.name")).toBe("Acme Corp");
    });

    it("should safely return undefined for missing or invalid paths without throwing", () => {
      expect(resolveFieldPath(mockContext, "trigger.payload.workOrder.nonExistent")).toBeUndefined();
      expect(resolveFieldPath(mockContext, "trigger.payload.missingObj.nested.property")).toBeUndefined();
      expect(resolveFieldPath(mockContext, "steps.99.output.something")).toBeUndefined();
      expect(resolveFieldPath(null, "some.path")).toBeUndefined();
      expect(resolveFieldPath(mockContext, "")).toBeUndefined();
    });
  });

  describe("2. All 23 Condition Operators Evaluation", () => {
    const fixedNow = new Date("2026-08-28T12:00:00.000Z");

    // 1. EQUALS
    it("1. EQUALS — strict deep & primitive equality with coercion", () => {
      expect(evaluateOperator(ConditionOperator.EQUALS, "URGENT", "URGENT")).toBe(true);
      expect(evaluateOperator(ConditionOperator.EQUALS, "URGENT", "LOW")).toBe(false);
      expect(evaluateOperator(ConditionOperator.EQUALS, "100", 100)).toBe(true);
      expect(evaluateOperator(ConditionOperator.EQUALS, true, "true")).toBe(true);
      expect(evaluateOperator(ConditionOperator.EQUALS, { a: 1 }, { a: 1 })).toBe(true);
      expect(evaluateOperator(ConditionOperator.EQUALS, { a: 1 }, { a: 2 })).toBe(false);
    });

    // 2. NOT_EQUALS
    it("2. NOT_EQUALS — negation of equality", () => {
      expect(evaluateOperator(ConditionOperator.NOT_EQUALS, "OPEN", "COMPLETED")).toBe(true);
      expect(evaluateOperator(ConditionOperator.NOT_EQUALS, "OPEN", "OPEN")).toBe(false);
      expect(evaluateOperator(ConditionOperator.NOT_EQUALS, 100, "100")).toBe(false);
    });

    // 3. GREATER_THAN
    it("3. GREATER_THAN — numeric comparison", () => {
      expect(evaluateOperator(ConditionOperator.GREATER_THAN, 150, 100)).toBe(true);
      expect(evaluateOperator(ConditionOperator.GREATER_THAN, "150", 100)).toBe(true);
      expect(evaluateOperator(ConditionOperator.GREATER_THAN, 100, 100)).toBe(false);
      expect(evaluateOperator(ConditionOperator.GREATER_THAN, 50, 100)).toBe(false);
      expect(evaluateOperator(ConditionOperator.GREATER_THAN, null, 100)).toBe(false);
    });

    // 4. GREATER_THAN_OR_EQUAL
    it("4. GREATER_THAN_OR_EQUAL — numeric comparison", () => {
      expect(evaluateOperator(ConditionOperator.GREATER_THAN_OR_EQUAL, 100, 100)).toBe(true);
      expect(evaluateOperator(ConditionOperator.GREATER_THAN_OR_EQUAL, 101, 100)).toBe(true);
      expect(evaluateOperator(ConditionOperator.GREATER_THAN_OR_EQUAL, 99, 100)).toBe(false);
    });

    // 5. LESS_THAN
    it("5. LESS_THAN — numeric comparison", () => {
      expect(evaluateOperator(ConditionOperator.LESS_THAN, 50, 100)).toBe(true);
      expect(evaluateOperator(ConditionOperator.LESS_THAN, 100, 100)).toBe(false);
      expect(evaluateOperator(ConditionOperator.LESS_THAN, 150, 100)).toBe(false);
    });

    // 6. LESS_THAN_OR_EQUAL
    it("6. LESS_THAN_OR_EQUAL — numeric comparison", () => {
      expect(evaluateOperator(ConditionOperator.LESS_THAN_OR_EQUAL, 100, 100)).toBe(true);
      expect(evaluateOperator(ConditionOperator.LESS_THAN_OR_EQUAL, 99, 100)).toBe(true);
      expect(evaluateOperator(ConditionOperator.LESS_THAN_OR_EQUAL, 101, 100)).toBe(false);
    });

    // 7. CONTAINS
    it("7. CONTAINS — substring and array element inclusion", () => {
      expect(evaluateOperator(ConditionOperator.CONTAINS, "Emergency Repair", "repair")).toBe(true);
      expect(evaluateOperator(ConditionOperator.CONTAINS, "Emergency Repair", "Plumbing")).toBe(false);
      expect(evaluateOperator(ConditionOperator.CONTAINS, ["URGENT", "NORMAL"], "URGENT")).toBe(true);
      expect(evaluateOperator(ConditionOperator.CONTAINS, null, "repair")).toBe(false);
    });

    // 8. NOT_CONTAINS
    it("8. NOT_CONTAINS — negation of inclusion", () => {
      expect(evaluateOperator(ConditionOperator.NOT_CONTAINS, "Emergency Repair", "Plumbing")).toBe(true);
      expect(evaluateOperator(ConditionOperator.NOT_CONTAINS, "Emergency Repair", "repair")).toBe(false);
      expect(evaluateOperator(ConditionOperator.NOT_CONTAINS, null, "Plumbing")).toBe(true);
    });

    // 9. STARTS_WITH
    it("9. STARTS_WITH — prefix matching", () => {
      expect(evaluateOperator(ConditionOperator.STARTS_WITH, "INV-2026-001", "inv-2026")).toBe(true);
      expect(evaluateOperator(ConditionOperator.STARTS_WITH, "INV-2026-001", "WO")).toBe(false);
      expect(evaluateOperator(ConditionOperator.STARTS_WITH, null, "INV")).toBe(false);
    });

    // 10. ENDS_WITH
    it("10. ENDS_WITH — suffix matching", () => {
      expect(evaluateOperator(ConditionOperator.ENDS_WITH, "invoice.pdf", ".PDF")).toBe(true);
      expect(evaluateOperator(ConditionOperator.ENDS_WITH, "invoice.pdf", ".docx")).toBe(false);
      expect(evaluateOperator(ConditionOperator.ENDS_WITH, null, ".pdf")).toBe(false);
    });

    // 11. MATCHES_REGEX (with ReDoS safeguards)
    it("11. MATCHES_REGEX — safe regular expression testing", () => {
      expect(evaluateOperator(ConditionOperator.MATCHES_REGEX, "WO-12345", "^WO-\\d+$")).toBe(true);
      expect(evaluateOperator(ConditionOperator.MATCHES_REGEX, "INV-12345", "^WO-\\d+$")).toBe(false);
      expect(evaluateOperator(ConditionOperator.MATCHES_REGEX, null, "^WO-\\d+$")).toBe(false);

      // ReDoS vulnerability pattern must be rejected
      const evilPattern = "^(a+)+$";
      expect(isDangerousRegexPattern(evilPattern)).toBe(true);
      expect(evaluateOperator(ConditionOperator.MATCHES_REGEX, "aaaaaaaaaaaaaaaaaaaaaaaaaaaa!", evilPattern)).toBe(false);
    });

    // 12. IN
    it("12. IN — array membership check", () => {
      expect(evaluateOperator(ConditionOperator.IN, "URGENT", ["LOW", "MEDIUM", "HIGH", "URGENT"])).toBe(true);
      expect(evaluateOperator(ConditionOperator.IN, "CRITICAL", ["LOW", "MEDIUM", "HIGH"])).toBe(false);
      expect(evaluateOperator(ConditionOperator.IN, 100, [50, 100, 150])).toBe(true);
      expect(evaluateOperator(ConditionOperator.IN, "URGENT", "not-an-array")).toBe(false);
    });

    // 13. NOT_IN
    it("13. NOT_IN — negation of array membership", () => {
      expect(evaluateOperator(ConditionOperator.NOT_IN, "CRITICAL", ["LOW", "MEDIUM", "HIGH"])).toBe(true);
      expect(evaluateOperator(ConditionOperator.NOT_IN, "HIGH", ["LOW", "MEDIUM", "HIGH"])).toBe(false);
      expect(evaluateOperator(ConditionOperator.NOT_IN, "HIGH", "not-an-array")).toBe(true);
    });

    // 14. IS_EMPTY
    it("14. IS_EMPTY — checks emptiness across string, array, object, null", () => {
      expect(evaluateOperator(ConditionOperator.IS_EMPTY, "", null)).toBe(true);
      expect(evaluateOperator(ConditionOperator.IS_EMPTY, "   ", null)).toBe(true);
      expect(evaluateOperator(ConditionOperator.IS_EMPTY, [], null)).toBe(true);
      expect(evaluateOperator(ConditionOperator.IS_EMPTY, {}, null)).toBe(true);
      expect(evaluateOperator(ConditionOperator.IS_EMPTY, null, null)).toBe(true);
      expect(evaluateOperator(ConditionOperator.IS_EMPTY, undefined, null)).toBe(true);
      expect(evaluateOperator(ConditionOperator.IS_EMPTY, "hello", null)).toBe(false);
      expect(evaluateOperator(ConditionOperator.IS_EMPTY, [1], null)).toBe(false);
      expect(evaluateOperator(ConditionOperator.IS_EMPTY, { a: 1 }, null)).toBe(false);
    });

    // 15. IS_NOT_EMPTY
    it("15. IS_NOT_EMPTY — checks non-emptiness", () => {
      expect(evaluateOperator(ConditionOperator.IS_NOT_EMPTY, "hello", null)).toBe(true);
      expect(evaluateOperator(ConditionOperator.IS_NOT_EMPTY, [1], null)).toBe(true);
      expect(evaluateOperator(ConditionOperator.IS_NOT_EMPTY, "", null)).toBe(false);
      expect(evaluateOperator(ConditionOperator.IS_NOT_EMPTY, null, null)).toBe(false);
    });

    // 16. IS_NULL
    it("16. IS_NULL — null or undefined check", () => {
      expect(evaluateOperator(ConditionOperator.IS_NULL, null, null)).toBe(true);
      expect(evaluateOperator(ConditionOperator.IS_NULL, undefined, null)).toBe(true);
      expect(evaluateOperator(ConditionOperator.IS_NULL, "", null)).toBe(false);
      expect(evaluateOperator(ConditionOperator.IS_NULL, 0, null)).toBe(false);
      expect(evaluateOperator(ConditionOperator.IS_NULL, false, null)).toBe(false);
    });

    // 17. IS_NOT_NULL
    it("17. IS_NOT_NULL — non-null check", () => {
      expect(evaluateOperator(ConditionOperator.IS_NOT_NULL, "", null)).toBe(true);
      expect(evaluateOperator(ConditionOperator.IS_NOT_NULL, 0, null)).toBe(true);
      expect(evaluateOperator(ConditionOperator.IS_NOT_NULL, null, null)).toBe(false);
      expect(evaluateOperator(ConditionOperator.IS_NOT_NULL, undefined, null)).toBe(false);
    });

    // 18. IS_TRUE
    it("18. IS_TRUE — truthy boolean evaluation", () => {
      expect(evaluateOperator(ConditionOperator.IS_TRUE, true, null)).toBe(true);
      expect(evaluateOperator(ConditionOperator.IS_TRUE, "true", null)).toBe(true);
      expect(evaluateOperator(ConditionOperator.IS_TRUE, 1, null)).toBe(true);
      expect(evaluateOperator(ConditionOperator.IS_TRUE, false, null)).toBe(false);
      expect(evaluateOperator(ConditionOperator.IS_TRUE, "false", null)).toBe(false);
      expect(evaluateOperator(ConditionOperator.IS_TRUE, 0, null)).toBe(false);
    });

    // 19. IS_FALSE
    it("19. IS_FALSE — falsy boolean evaluation", () => {
      expect(evaluateOperator(ConditionOperator.IS_FALSE, false, null)).toBe(true);
      expect(evaluateOperator(ConditionOperator.IS_FALSE, "false", null)).toBe(true);
      expect(evaluateOperator(ConditionOperator.IS_FALSE, 0, null)).toBe(true);
      expect(evaluateOperator(ConditionOperator.IS_FALSE, true, null)).toBe(false);
      expect(evaluateOperator(ConditionOperator.IS_FALSE, "true", null)).toBe(false);
    });

    // 20. BEFORE_DATE
    it("20. BEFORE_DATE — date comparison", () => {
      const pastDate = "2026-08-20T00:00:00.000Z";
      const targetDate = "2026-08-25T00:00:00.000Z";
      const futureDate = "2026-08-30T00:00:00.000Z";

      expect(evaluateOperator(ConditionOperator.BEFORE_DATE, pastDate, targetDate)).toBe(true);
      expect(evaluateOperator(ConditionOperator.BEFORE_DATE, futureDate, targetDate)).toBe(false);
      expect(evaluateOperator(ConditionOperator.BEFORE_DATE, "invalid-date", targetDate)).toBe(false);
    });

    // 21. AFTER_DATE
    it("21. AFTER_DATE — date comparison", () => {
      const pastDate = "2026-08-20T00:00:00.000Z";
      const targetDate = "2026-08-25T00:00:00.000Z";
      const futureDate = "2026-08-30T00:00:00.000Z";

      expect(evaluateOperator(ConditionOperator.AFTER_DATE, futureDate, targetDate)).toBe(true);
      expect(evaluateOperator(ConditionOperator.AFTER_DATE, pastDate, targetDate)).toBe(false);
    });

    // 22. WITHIN_LAST_DAYS
    it("22. WITHIN_LAST_DAYS — relative past window", () => {
      // fixedNow is 2026-08-28T12:00:00Z
      const twoDaysAgo = "2026-08-26T12:00:00.000Z";
      const tenDaysAgo = "2026-08-18T12:00:00.000Z";
      const futureDate = "2026-08-29T12:00:00.000Z";

      expect(evaluateOperator(ConditionOperator.WITHIN_LAST_DAYS, twoDaysAgo, 7, fixedNow)).toBe(true);
      expect(evaluateOperator(ConditionOperator.WITHIN_LAST_DAYS, tenDaysAgo, 7, fixedNow)).toBe(false);
      expect(evaluateOperator(ConditionOperator.WITHIN_LAST_DAYS, futureDate, 7, fixedNow)).toBe(false);
    });

    // 23. WITHIN_NEXT_DAYS
    it("23. WITHIN_NEXT_DAYS — relative future window", () => {
      // fixedNow is 2026-08-28T12:00:00Z
      const threeDaysAhead = "2026-08-31T12:00:00.000Z";
      const tenDaysAhead = "2026-09-10T12:00:00.000Z";
      const pastDate = "2026-08-27T12:00:00.000Z";

      expect(evaluateOperator(ConditionOperator.WITHIN_NEXT_DAYS, threeDaysAhead, 7, fixedNow)).toBe(true);
      expect(evaluateOperator(ConditionOperator.WITHIN_NEXT_DAYS, tenDaysAhead, 7, fixedNow)).toBe(false);
      expect(evaluateOperator(ConditionOperator.WITHIN_NEXT_DAYS, pastDate, 7, fixedNow)).toBe(false);
    });
  });

  describe("3. Condition Write-Time Validator (Rejection of Mismatched Target Shapes)", () => {
    it("should reject non-empty target value for operators requiring no target", () => {
      expect(() =>
        validateConditionDefinition(ConditionOperator.IS_NULL, "unexpected-value", "workOrder.status")
      ).toThrow(AutomationValidationError);

      expect(() =>
        validateConditionDefinition(ConditionOperator.IS_EMPTY, 123, "workOrder.status")
      ).toThrow(AutomationValidationError);

      expect(() =>
        validateConditionDefinition(ConditionOperator.IS_TRUE, true, "workOrder.status")
      ).toThrow(AutomationValidationError);

      // Should pass with null or empty object
      expect(() =>
        validateConditionDefinition(ConditionOperator.IS_NULL, null, "workOrder.status")
      ).not.toThrow();
    });

    it("should reject non-array target value for IN and NOT_IN", () => {
      expect(() =>
        validateConditionDefinition(ConditionOperator.IN, "URGENT", "workOrder.priority")
      ).toThrow(AutomationValidationError);

      expect(() =>
        validateConditionDefinition(ConditionOperator.IN, [], "workOrder.priority")
      ).toThrow(AutomationValidationError);

      expect(() =>
        validateConditionDefinition(ConditionOperator.IN, ["URGENT", "HIGH"], "workOrder.priority")
      ).not.toThrow();
    });

    it("should reject non-numeric target value for numeric comparisons", () => {
      expect(() =>
        validateConditionDefinition(ConditionOperator.GREATER_THAN, "not-a-number", "workOrder.totalAmount")
      ).toThrow(AutomationValidationError);

      expect(() =>
        validateConditionDefinition(ConditionOperator.GREATER_THAN, 100, "workOrder.totalAmount")
      ).not.toThrow();
    });

    it("should reject invalid date strings for date operators", () => {
      expect(() =>
        validateConditionDefinition(ConditionOperator.BEFORE_DATE, "invalid-date-string", "workOrder.dueDate")
      ).toThrow(AutomationValidationError);

      expect(() =>
        validateConditionDefinition(ConditionOperator.BEFORE_DATE, "2026-08-28T00:00:00Z", "workOrder.dueDate")
      ).not.toThrow();
    });

    it("should reject ReDoS and oversized regex patterns", () => {
      expect(() =>
        validateConditionDefinition(ConditionOperator.MATCHES_REGEX, "(a+)+", "workOrder.title")
      ).toThrow(AutomationValidationError);

      const oversizedPattern = "a".repeat(MAX_REGEX_PATTERN_LENGTH + 1);
      expect(() =>
        validateConditionDefinition(ConditionOperator.MATCHES_REGEX, oversizedPattern, "workOrder.title")
      ).toThrow(AutomationValidationError);

      expect(() =>
        validateConditionDefinition(ConditionOperator.MATCHES_REGEX, "^WO-\\d+$", "workOrder.title")
      ).not.toThrow();
    });
  });
});
