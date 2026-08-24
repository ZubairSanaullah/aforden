import { describe, expect, it, vi } from "vitest";

vi.mock("@/auth", () => ({
    auth: vi.fn(),
}));

import { Prisma } from "@/generated/prisma/client";
import {
    calculateQuoteTotals,
    InvalidQuoteCalculationError,
    resolveWorkTypeSnapshot,
    resolvePartSnapshot,
    resolveLineItemSnapshot,
} from "@/lib/services/quote";

describe("Phase 1.11.4 — Quotes & Estimates Calculation Engine & Pricing Snapshots", () => {
    describe("1. Step 1: Base Subtotal & Negative Calculation Guard", () => {
        it("computes lineBaseSubtotal = (quantity * unitPrice) - lineDiscountAmount", () => {
            const result = calculateQuoteTotals(
                {},
                [
                    {
                        name: "Labor",
                        quantity: 3,
                        unitPrice: 50.0,
                        discountAmount: 20.0, // (3 * 50) - 20 = 130.00
                    },
                ],
            );

            expect(result.subtotal.toString()).toBe("130");
            expect(result.lineItems[0].lineBaseSubtotal.toString()).toBe("130");
            expect(result.lineItems[0].formatted.subtotal).toBe("130.00");
        });

        it("strictly rejects when (quantity * unitPrice) - discountAmount < 0 with InvalidQuoteCalculationError", () => {
            expect(() => {
                calculateQuoteTotals(
                    {},
                    [
                        {
                            name: "Defective Line",
                            quantity: 1,
                            unitPrice: 40.0,
                            discountAmount: 50.0, // 40 - 50 = -10 -> MUST REJECT!
                        },
                    ],
                );
            }).toThrow(InvalidQuoteCalculationError);
        });

        it("allows 100% line discount where (quantity * unitPrice) - discountAmount == 0", () => {
            const result = calculateQuoteTotals(
                {},
                [
                    {
                        name: "Complimentary Line",
                        quantity: 2,
                        unitPrice: 50.0,
                        discountAmount: 100.0, // 100 - 100 = 0.00 -> PASS
                    },
                ],
            );

            expect(result.subtotal.toString()).toBe("0");
            expect(result.lineItems[0].lineBaseSubtotal.toString()).toBe("0");
            expect(result.total.toString()).toBe("0");
        });
    });

    describe("2. Step 2 & 3: Gross Subtotal & Header Discount Calculations", () => {
        it("calculates PERCENTAGE header discount accurately", () => {
            // Line 1: 100, Line 2: 200 -> Gross subtotal: 300. 10% discount = 30.00
            const result = calculateQuoteTotals(
                {
                    discountType: "PERCENTAGE",
                    discountValue: 10,
                },
                [
                    { name: "Item 1", quantity: 1, unitPrice: 100 },
                    { name: "Item 2", quantity: 2, unitPrice: 100 },
                ],
            );

            expect(result.subtotal.toString()).toBe("300");
            expect(result.discountAmount.toString()).toBe("30");
            expect(result.formatted.discountAmount).toBe("30.00");
            expect(result.total.toString()).toBe("270");
        });

        it("calculates FIXED header discount accurately", () => {
            // Gross subtotal: 300. Fixed discount = 45.50
            const result = calculateQuoteTotals(
                {
                    discountType: "FIXED",
                    discountValue: 45.5,
                },
                [
                    { name: "Item 1", quantity: 1, unitPrice: 100 },
                    { name: "Item 2", quantity: 2, unitPrice: 100 },
                ],
            );

            expect(result.subtotal.toString()).toBe("300");
            expect(result.discountAmount.toString()).toBe("45.5");
            expect(result.formatted.discountAmount).toBe("45.50");
            expect(result.total.toString()).toBe("254.5");
        });

        it("caps FIXED header discount at gross quote subtotal if discount exceeds subtotal", () => {
            const result = calculateQuoteTotals(
                {
                    discountType: "FIXED",
                    discountValue: 500, // Subtotal is only 300
                },
                [
                    { name: "Item 1", quantity: 3, unitPrice: 100 },
                ],
            );

            expect(result.subtotal.toString()).toBe("300");
            expect(result.discountAmount.toString()).toBe("300");
            expect(result.total.toString()).toBe("0");
        });
    });

    describe("3. Step 4: Proportional Proration & Penny Reconciliation Remainder", () => {
        it("prorates header discount across 3 uneven lines with exact penny reconciliation", () => {
            // Subtotal: 100 + 200 + 300 = 600.00
            // Header discount FIXED = 50.00
            // Raw allocations:
            // Line 1 (100 / 600) * 50 = 8.3333... -> floor2 = 8.33
            // Line 2 (200 / 600) * 50 = 16.6666... -> floor2 = 16.66
            // Line 3 (300 / 600) * 50 = 25.0000... -> floor2 = 25.00
            // Sum floor = 8.33 + 16.66 + 25.00 = 49.99
            // Remainder = 50.00 - 49.99 = 0.01
            // Largest subtotal is Line 3 (300.00) -> Receives remainder!
            // Final allocated: Line 1 = 8.33, Line 2 = 16.66, Line 3 = 25.01
            // Net bases: Line 1 = 91.67, Line 2 = 183.34, Line 3 = 274.99
            // Sum of Net bases = 550.00 (identical to 600.00 - 50.00!)

            const result = calculateQuoteTotals(
                {
                    discountType: "FIXED",
                    discountValue: 50,
                },
                [
                    { id: "line_1", sortOrder: 1, name: "Small", quantity: 1, unitPrice: 100 },
                    { id: "line_2", sortOrder: 2, name: "Medium", quantity: 2, unitPrice: 100 },
                    { id: "line_3", sortOrder: 3, name: "Large", quantity: 3, unitPrice: 100 },
                ],
            );

            expect(result.subtotal.toString()).toBe("600");
            expect(result.discountAmount.toString()).toBe("50");

            const l1 = result.lineItems[0];
            const l2 = result.lineItems[1];
            const l3 = result.lineItems[2];

            expect(l1.allocatedHeaderDiscount.toString()).toBe("8.33");
            expect(l1.lineNetBase.toString()).toBe("91.67");

            expect(l2.allocatedHeaderDiscount.toString()).toBe("16.66");
            expect(l2.lineNetBase.toString()).toBe("183.34");

            expect(l3.allocatedHeaderDiscount.toString()).toBe("25.01"); // Received the +0.01 penny remainder!
            expect(l3.lineNetBase.toString()).toBe("274.99");

            // Total check
            expect(result.total.toString()).toBe("550");
        });

        it("deterministic tie-break scenario 1: equal subtotals resolve to lowest sortOrder", () => {
            // Two lines with equal subtotals: 100.00 each -> Total = 200.00
            // Header discount FIXED = 33.33
            // Line A (sortOrder 1): raw 16.665 -> floor 16.66
            // Line B (sortOrder 2): raw 16.665 -> floor 16.66
            // Remainder = 33.33 - 33.32 = 0.01
            // Both have equal subtotal (100.00).
            // Line A has lower sortOrder (1 < 2) -> Line A MUST receive remainder!

            const result = calculateQuoteTotals(
                {
                    discountType: "FIXED",
                    discountValue: 33.33,
                },
                [
                    { id: "line_b", sortOrder: 2, name: "Second", quantity: 1, unitPrice: 100 },
                    { id: "line_a", sortOrder: 1, name: "First", quantity: 1, unitPrice: 100 },
                ],
            );

            const lineFirst = result.lineItems.find((l) => l.sortOrder === 1)!;
            const lineSecond = result.lineItems.find((l) => l.sortOrder === 2)!;

            expect(lineFirst.allocatedHeaderDiscount.toString()).toBe("16.67"); // Got +0.01!
            expect(lineSecond.allocatedHeaderDiscount.toString()).toBe("16.66");
        });

        it("deterministic tie-break scenario 2: equal subtotals and equal sortOrder resolve to lowest id lexicographically", () => {
            // Line X (id: "line_alpha", sortOrder: 0, subtotal: 100)
            // Line Y (id: "line_beta", sortOrder: 0, subtotal: 100)
            // Header discount = 10.01 -> floor 5.00 + 5.00 = 10.00 -> remainder 0.01
            // "line_alpha" < "line_beta" -> line_alpha MUST receive remainder!

            const result = calculateQuoteTotals(
                {
                    discountType: "FIXED",
                    discountValue: 10.01,
                },
                [
                    { id: "line_beta", sortOrder: 0, name: "Beta", quantity: 1, unitPrice: 100 },
                    { id: "line_alpha", sortOrder: 0, name: "Alpha", quantity: 1, unitPrice: 100 },
                ],
            );

            const lineAlpha = result.lineItems.find((l) => l.id === "line_alpha")!;
            const lineBeta = result.lineItems.find((l) => l.id === "line_beta")!;

            expect(lineAlpha.allocatedHeaderDiscount.toString()).toBe("5.01"); // Got +0.01!
            expect(lineBeta.allocatedHeaderDiscount.toString()).toBe("5");
        });
    });

    describe("4. Step 5 & 6: Line Tax Variance & Header Aggregation", () => {
        it("computes per-line taxes independently and aggregates quote totals strictly as sum of lines", () => {
            // Header: 10% discount
            // Line 1: Part, subtotal 100, taxRate = 0.0825 (custom line tax)
            // Line 2: Labor, subtotal 200, taxRate = 0.0000 (tax exempt)
            // Line 3: Misc, subtotal 100, taxRate = null (inherits header taxRate 0.0500)
            // Gross subtotal = 400.00
            // Header discount = 40.00
            // Line 1 alloc = 10.00 -> Net base = 90.00 -> tax = round(90 * 0.0825) = 7.43 -> total = 97.43
            // Line 2 alloc = 20.00 -> Net base = 180.00 -> tax = 0.00 -> total = 180.00
            // Line 3 alloc = 10.00 -> Net base = 90.00 -> tax = round(90 * 0.05) = 4.50 -> total = 94.50
            // Quote Subtotal = 400.00
            // Quote Discount = 40.00
            // Quote Tax = 7.43 + 0 + 4.50 = 11.93
            // Quote Total = 97.43 + 180.00 + 94.50 = 371.93

            const result = calculateQuoteTotals(
                {
                    discountType: "PERCENTAGE",
                    discountValue: 10,
                    taxRate: 0.05, // 5% default header tax
                },
                [
                    { name: "Part A", quantity: 1, unitPrice: 100, taxRate: 0.0825 },
                    { name: "Labor B", quantity: 2, unitPrice: 100, taxRate: 0 },
                    { name: "Misc C", quantity: 1, unitPrice: 100, taxRate: null },
                ],
            );

            expect(result.subtotal.toString()).toBe("400");
            expect(result.discountAmount.toString()).toBe("40");

            expect(result.lineItems[0].taxAmount.toString()).toBe("7.43");
            expect(result.lineItems[0].total.toString()).toBe("97.43");

            expect(result.lineItems[1].taxAmount.toString()).toBe("0");
            expect(result.lineItems[1].total.toString()).toBe("180");

            expect(result.lineItems[2].taxAmount.toString()).toBe("4.5");
            expect(result.lineItems[2].total.toString()).toBe("94.5");

            expect(result.taxAmount.toString()).toBe("11.93");
            expect(result.total.toString()).toBe("371.93");
            expect(result.formatted.total).toBe("371.93");
        });

        it("handles single-line quote edge case seamlessly", () => {
            const result = calculateQuoteTotals(
                {
                    discountType: "PERCENTAGE",
                    discountValue: 15,
                    taxRate: 0.08,
                },
                [
                    { name: "Single Item", quantity: 4, unitPrice: 25.0 }, // 100.00
                ],
            );

            expect(result.subtotal.toString()).toBe("100");
            expect(result.discountAmount.toString()).toBe("15");
            expect(result.lineItems[0].lineNetBase.toString()).toBe("85");
            expect(result.lineItems[0].taxAmount.toString()).toBe("6.8");
            expect(result.lineItems[0].total.toString()).toBe("91.8");
            expect(result.taxAmount.toString()).toBe("6.8");
            expect(result.total.toString()).toBe("91.8");
        });

        it("handles empty line items array gracefully", () => {
            const result = calculateQuoteTotals(
                {
                    discountType: "PERCENTAGE",
                    discountValue: 10,
                    taxRate: 0.08,
                },
                [],
            );

            expect(result.subtotal.toString()).toBe("0");
            expect(result.discountAmount.toString()).toBe("0");
            expect(result.taxAmount.toString()).toBe("0");
            expect(result.total.toString()).toBe("0");
            expect(result.lineItems).toEqual([]);
        });
    });

    describe("5. Catalog Freeze & Pricing Snapshot Helpers", () => {
        const mockDb = {
            workType: {
                findFirst: vi.fn(),
            },
            part: {
                findFirst: vi.fn(),
            },
        } as any;

        it("resolves WorkType snapshot and freezes workTypeName and workTypeCode", async () => {
            mockDb.workType.findFirst.mockResolvedValue({
                id: "wt_101",
                name: "Standard AC Diagnostic",
                code: "AC-DIAG",
                status: "ACTIVE",
            });

            const snapshot = await resolveWorkTypeSnapshot("ws_test", "wt_101", mockDb);
            expect(snapshot).toEqual({
                workTypeId: "wt_101",
                workTypeName: "Standard AC Diagnostic",
                workTypeCode: "AC-DIAG",
            });
        });

        it("resolves Part snapshot and freezes partName, partSku, partUnitOfMeasure, and unitCost", async () => {
            mockDb.part.findFirst.mockResolvedValue({
                id: "part_101",
                name: "Compressor Capacitor 45uF",
                sku: "CAP-45UF",
                unitOfMeasure: "EACH",
                unitCost: new Prisma.Decimal("14.50"),
                status: "ACTIVE",
            });

            const snapshot = await resolvePartSnapshot("ws_test", "part_101", mockDb);
            expect(snapshot).not.toBeNull();
            expect(snapshot?.partName).toBe("Compressor Capacitor 45uF");
            expect(snapshot?.partSku).toBe("CAP-45UF");
            expect(snapshot?.partUnitOfMeasure).toBe("EACH");
            expect(snapshot?.unitCost?.toString()).toBe("14.5");
        });

        it("resolves and merges line item snapshots with user overrides", async () => {
            mockDb.workType.findFirst.mockResolvedValue({
                id: "wt_labor",
                name: "Emergency Repair",
                code: "EMERG-REP",
            });
            mockDb.part.findFirst.mockResolvedValue({
                id: "part_pipe",
                name: "Copper Pipe 1/2 in",
                sku: "COPPER-050",
                unitOfMeasure: "FEET",
                unitCost: new Prisma.Decimal("3.25"),
            });

            // 1. WorkType line item
            const laborResolved = await resolveLineItemSnapshot(
                "ws_test",
                {
                    workTypeId: "wt_labor",
                    unitPrice: 85.0,
                    quantity: 2,
                },
                mockDb,
            );
            expect(laborResolved.lineItemType).toBe("LABOR");
            expect(laborResolved.name).toBe("Emergency Repair");
            expect(laborResolved.workTypeName).toBe("Emergency Repair");
            expect(laborResolved.workTypeCode).toBe("EMERG-REP");
            expect(laborResolved.unitPrice.toString()).toBe("85");

            // 2. Part line item with overridden custom name and explicit unitCost
            const partResolved = await resolveLineItemSnapshot(
                "ws_test",
                {
                    partId: "part_pipe",
                    name: "Custom Copper Pipe (Heavy Duty)",
                    unitPrice: 12.0,
                    unitCost: 4.5,
                    quantity: 10,
                },
                mockDb,
            );
            expect(partResolved.lineItemType).toBe("PART");
            expect(partResolved.name).toBe("Custom Copper Pipe (Heavy Duty)");
            expect(partResolved.partName).toBe("Copper Pipe 1/2 in");
            expect(partResolved.partSku).toBe("COPPER-050");
            expect(partResolved.partUnitOfMeasure).toBe("FEET");
            expect(partResolved.unitCost?.toString()).toBe("4.5");
        });
    });
});
