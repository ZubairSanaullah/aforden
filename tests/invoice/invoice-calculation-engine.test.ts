import { describe, it, expect, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import {
    calculateInvoiceTotals,
    reconcileInvoicePaymentBalance,
} from "@/lib/services/invoice/invoiceCalculationEngine";
import {
    snapshotLineItemsFromQuote,
    snapshotLineItemsFromWorkOrder,
    resolveStandaloneLineItemSnapshot,
} from "@/lib/services/invoice/invoiceSnapshots";
import { InvalidInvoiceCalculationError } from "@/lib/services/invoice/invoiceErrors";

describe("Phase 1.12.4 — Invoicing Calculation Engine & Snapshot Helpers", () => {
    // ==========================================
    // 1. CANONICAL MONETARY CALCULATION ENGINE
    // ==========================================
    describe("1. Canonical 7-Step Calculation Engine", () => {
        it("computes single-line invoice with zero discount and default tax", () => {
            const result = calculateInvoiceTotals(
                { taxRate: 0.0825 },
                [
                    {
                        name: "Labor",
                        quantity: 2,
                        unitPrice: 100,
                    },
                ],
            );

            expect(result.formatted.subtotal).toBe("200.00");
            expect(result.formatted.discountAmount).toBe("0.00");
            expect(result.formatted.taxAmount).toBe("16.50");
            expect(result.formatted.total).toBe("216.50");
            expect(result.formatted.amountPaid).toBe("0.00");
            expect(result.formatted.amountDue).toBe("216.50");
            expect(result.lineItems).toHaveLength(1);
            expect(result.lineItems[0].formatted.subtotal).toBe("200.00");
            expect(result.lineItems[0].formatted.taxAmount).toBe("16.50");
            expect(result.lineItems[0].formatted.total).toBe("216.50");
        });

        it("handles multi-line proration with exact penny remainders and tie-breaking", () => {
            // 3 lines with equal subtotal $100.00 ($300.00 total)
            // FIXED discount of $10.00
            // $10.00 / 3 = $3.3333... -> floor2 gives $3.33 each ($9.99 total).
            // Remainder $0.01 must go to the line with lowest sortOrder (sortOrder: 0)
            const result = calculateInvoiceTotals(
                { discountType: "FIXED", discountValue: 10, taxRate: 0 },
                [
                    { id: "line_c", sortOrder: 2, name: "Line C", quantity: 1, unitPrice: 100 },
                    { id: "line_a", sortOrder: 0, name: "Line A", quantity: 1, unitPrice: 100 },
                    { id: "line_b", sortOrder: 1, name: "Line B", quantity: 1, unitPrice: 100 },
                ],
            );

            expect(result.formatted.subtotal).toBe("300.00");
            expect(result.formatted.discountAmount).toBe("10.00");
            expect(result.formatted.total).toBe("290.00");

            const lineA = result.lineItems.find((l) => l.id === "line_a")!;
            const lineB = result.lineItems.find((l) => l.id === "line_b")!;
            const lineC = result.lineItems.find((l) => l.id === "line_c")!;

            // Line A had sortOrder 0 -> received the $0.01 remainder ($3.34 discount)
            expect(lineA.formatted.discountAmount).toBe("3.34");
            expect(lineA.formatted.total).toBe("96.66");

            // Line B and C received $3.33 discount
            expect(lineB.formatted.discountAmount).toBe("3.33");
            expect(lineB.formatted.total).toBe("96.67");
            expect(lineC.formatted.discountAmount).toBe("3.33");
            expect(lineC.formatted.total).toBe("96.67");

            // Sum of line totals strictly equals header total
            const sumLineTotals = Number(lineA.formatted.total) + Number(lineB.formatted.total) + Number(lineC.formatted.total);
            expect(sumLineTotals.toFixed(2)).toBe("290.00");
        });

        it("breaks ties using lowest id when subtotals and sortOrders are identical", () => {
            // $1.01 / 2 -> floor2 is $0.50 each ($1.00 total). Remainder $0.01 goes to line_a (lowest id)
            const resWithOddDiscount = calculateInvoiceTotals(
                { discountType: "FIXED", discountValue: 1.01, taxRate: 0 },
                [
                    { id: "line_z", sortOrder: 0, name: "Line Z", quantity: 1, unitPrice: 100 },
                    { id: "line_a", sortOrder: 0, name: "Line A", quantity: 1, unitPrice: 100 },
                ],
            );

            const resA = resWithOddDiscount.lineItems.find((l) => l.id === "line_a")!;
            const resZ = resWithOddDiscount.lineItems.find((l) => l.id === "line_z")!;

            expect(resA.formatted.discountAmount).toBe("0.51");
            expect(resZ.formatted.discountAmount).toBe("0.50");
        });

        it("switches correctly between PERCENTAGE and FIXED discounts", () => {
            // PERCENTAGE discount: 15% on $200.00 = $30.00
            const pctRes = calculateInvoiceTotals(
                { discountType: "PERCENTAGE", discountValue: 15, taxRate: 0 },
                [{ quantity: 2, unitPrice: 100 }],
            );
            expect(pctRes.formatted.discountAmount).toBe("30.00");
            expect(pctRes.formatted.total).toBe("170.00");

            // FIXED discount: $45.50 on $200.00 = $45.50
            const fixedRes = calculateInvoiceTotals(
                { discountType: "FIXED", discountValue: 45.5, taxRate: 0 },
                [{ quantity: 2, unitPrice: 100 }],
            );
            expect(fixedRes.formatted.discountAmount).toBe("45.50");
            expect(fixedRes.formatted.total).toBe("154.50");
        });

        it("caps header discount at gross subtotal", () => {
            const res = calculateInvoiceTotals(
                { discountType: "FIXED", discountValue: 500, taxRate: 0.1 },
                [{ quantity: 1, unitPrice: 100 }],
            );
            expect(res.formatted.subtotal).toBe("100.00");
            expect(res.formatted.discountAmount).toBe("100.00");
            expect(res.formatted.taxAmount).toBe("0.00");
            expect(res.formatted.total).toBe("0.00");
        });

        it("handles line-level tax rate variance (0% labor vs 8.25% parts)", () => {
            const result = calculateInvoiceTotals(
                { taxRate: 0.05 }, // Fallback rate
                [
                    { name: "Labor", quantity: 2, unitPrice: 100, taxRate: 0 }, // Explicit 0%
                    { name: "Materials", quantity: 1, unitPrice: 100, taxRate: 0.0825 }, // Explicit 8.25%
                    { name: "Misc", quantity: 1, unitPrice: 50 }, // Inherits header 5%
                ],
            );

            expect(result.lineItems[0].formatted.taxAmount).toBe("0.00"); // 200 * 0% = 0.00
            expect(result.lineItems[1].formatted.taxAmount).toBe("8.25"); // 100 * 8.25% = 8.25
            expect(result.lineItems[2].formatted.taxAmount).toBe("2.50"); // 50 * 5% = 2.50

            expect(result.formatted.subtotal).toBe("350.00");
            expect(result.formatted.taxAmount).toBe("10.75");
            expect(result.formatted.total).toBe("360.75");
        });

        it("handles empty line items and zero-subtotal edge cases", () => {
            const emptyRes = calculateInvoiceTotals({ discountValue: 10, taxRate: 0.08 }, []);
            expect(emptyRes.formatted.subtotal).toBe("0.00");
            expect(emptyRes.formatted.total).toBe("0.00");
            expect(emptyRes.formatted.amountDue).toBe("0.00");

            const zeroRes = calculateInvoiceTotals({ discountValue: 10, taxRate: 0.08 }, [
                { quantity: 0, unitPrice: 100 },
            ]);
            expect(zeroRes.formatted.subtotal).toBe("0.00");
            expect(zeroRes.formatted.discountAmount).toBe("0.00");
            expect(zeroRes.formatted.total).toBe("0.00");
        });

        it("throws InvalidInvoiceCalculationError on Step 1 negative subtotal rejection", () => {
            expect(() =>
                calculateInvoiceTotals(
                    {},
                    [
                        {
                            name: "Faulty Line",
                            quantity: 1,
                            unitPrice: 50,
                            discountAmount: 75, // 50 - 75 = -25 < 0
                        },
                    ],
                ),
            ).toThrow(InvalidInvoiceCalculationError);
        });
    });

    // ==========================================
    // 2. PAYMENT BALANCE RECONCILIATION
    // ==========================================
    describe("2. Payment Balance Reconciliation", () => {
        it("reconciles multiple RECORDED payments and excludes VOIDED payments", () => {
            const result = calculateInvoiceTotals(
                { taxRate: 0 },
                [{ quantity: 1, unitPrice: 1000 }],
                [
                    { id: "pay_1", amount: 300, status: "RECORDED" },
                    { id: "pay_2", amount: 200, status: "VOIDED" }, // Should be ignored
                    { id: "pay_3", amount: 250, status: "RECORDED" },
                ],
            );

            expect(result.formatted.total).toBe("1000.00");
            expect(result.formatted.amountPaid).toBe("550.00");
            expect(result.formatted.amountDue).toBe("450.00");
        });

        it("caps amountDue at 0.00 when fully paid or overpaid", () => {
            const result = calculateInvoiceTotals(
                { taxRate: 0 },
                [{ quantity: 1, unitPrice: 500 }],
                [
                    { id: "pay_1", amount: 500, status: "RECORDED" },
                ],
            );

            expect(result.formatted.total).toBe("500.00");
            expect(result.formatted.amountPaid).toBe("500.00");
            expect(result.formatted.amountDue).toBe("0.00");
        });

        it("reconcileInvoicePaymentBalance standalone helper calculates correct balances", () => {
            const balance = reconcileInvoicePaymentBalance(1250.75, [
                { amount: 500, status: "RECORDED" },
                { amount: 250.75, status: "RECORDED" },
                { amount: 100, status: "VOIDED" },
            ]);

            expect(balance.formatted.amountPaid).toBe("750.75");
            expect(balance.formatted.amountDue).toBe("500.00");
        });
    });

    // ==========================================
    // 3. INDEPENDENT SNAPSHOT HELPERS
    // ==========================================
    describe("3. Independent Snapshot Helpers", () => {
        it("snapshotLineItemsFromQuote deep-copies and freezes all fields without retaining source references", () => {
            const quoteLines = [
                {
                    id: "ql_1",
                    quoteId: "quote_1",
                    lineItemType: "LABOR",
                    workTypeId: "wt_1",
                    partId: null,
                    name: "Electrical Diagnostic",
                    description: "Trace circuit",
                    workTypeName: "Diagnostics",
                    workTypeCode: "ELEC-DIAG",
                    partName: null,
                    partSku: null,
                    partUnitOfMeasure: null,
                    quantity: 3,
                    unitPrice: 125,
                    unitCost: 50,
                    discountAmount: 25,
                    taxRate: 0.0825,
                    sortOrder: 0,
                },
                {
                    id: "ql_2",
                    quoteId: "quote_1",
                    lineItemType: "PART",
                    workTypeId: null,
                    partId: "part_1",
                    name: "Breaker Switch",
                    description: "20A Breaker",
                    workTypeName: null,
                    workTypeCode: null,
                    partName: "Breaker Switch",
                    partSku: "BRK-20A",
                    partUnitOfMeasure: "each",
                    quantity: 2,
                    unitPrice: 45,
                    unitCost: 18,
                    discountAmount: 0,
                    taxRate: 0.0825,
                    sortOrder: 1,
                },
            ];

            const snapshotted = snapshotLineItemsFromQuote(quoteLines);

            expect(snapshotted).toHaveLength(2);
            expect(snapshotted[0].name).toBe("Electrical Diagnostic");
            expect(snapshotted[0].workTypeCode).toBe("ELEC-DIAG");
            expect(snapshotted[0].unitPrice.toFixed(2)).toBe("125.00");
            expect(snapshotted[0].unitCost?.toFixed(2)).toBe("50.00");
            expect(snapshotted[1].partSku).toBe("BRK-20A");
            expect(snapshotted[1].partUnitOfMeasure).toBe("each");

            // Verify deep clone / zero object reference sharing
            quoteLines[0].name = "MUTATED_NAME";
            quoteLines[0].unitPrice = 99999;
            expect(snapshotted[0].name).toBe("Electrical Diagnostic");
            expect(snapshotted[0].unitPrice.toFixed(2)).toBe("125.00");
        });

        it("snapshotLineItemsFromWorkOrder derives LABOR and PART lines correctly", () => {
            const workOrder = {
                id: "wo_1",
                workOrderNumber: "WO-001",
                title: "Furnace Repair",
                description: "Ignition system fix",
                billableHours: 2.5,
                laborRate: 140,
                workType: {
                    id: "wt_1",
                    name: "Furnace Labor",
                    code: "FURN-01",
                    description: "Standard furnace repair rate",
                },
                workOrderParts: [
                    {
                        id: "wop_1",
                        partId: "part_1",
                        quantity: 1,
                        unitPrice: 85,
                        unitCostAtTimeOfUse: 32,
                        part: {
                            id: "part_1",
                            name: "Igniter Element",
                            sku: "IGN-500",
                            unitOfMeasure: "piece",
                            unitCost: 32,
                        },
                    },
                ],
            };

            const lines = snapshotLineItemsFromWorkOrder(workOrder);

            expect(lines).toHaveLength(2);

            // Line 1: LABOR
            expect(lines[0].lineItemType).toBe("LABOR");
            expect(lines[0].name).toBe("Furnace Labor");
            expect(lines[0].workTypeCode).toBe("FURN-01");
            expect(lines[0].quantity.toFixed(2)).toBe("2.50");
            expect(lines[0].unitPrice.toFixed(2)).toBe("140.00");

            // Line 2: PART
            expect(lines[1].lineItemType).toBe("PART");
            expect(lines[1].name).toBe("Igniter Element");
            expect(lines[1].partSku).toBe("IGN-500");
            expect(lines[1].partUnitOfMeasure).toBe("piece");
            expect(lines[1].quantity.toFixed(2)).toBe("1.00");
            expect(lines[1].unitPrice.toFixed(2)).toBe("85.00");
            expect(lines[1].unitCost?.toFixed(2)).toBe("32.00");
        });

        it("resolveStandaloneLineItemSnapshot resolves catalog metadata with mock db", async () => {
            const mockDb: any = {
                workType: {
                    findFirst: vi.fn().mockResolvedValue({
                        id: "wt_1",
                        name: "Plumbing Service",
                        code: "PLUMB-01",
                        status: "ACTIVE",
                    }),
                },
                part: {
                    findFirst: vi.fn().mockResolvedValue({
                        id: "part_1",
                        name: "PVC Pipe 2in",
                        sku: "PVC-2IN",
                        unitOfMeasure: "ft",
                        unitCost: new Prisma.Decimal("3.50"),
                        status: "ACTIVE",
                    }),
                },
            };

            const resolved = await resolveStandaloneLineItemSnapshot(
                "ws_1",
                {
                    name: "Custom Plumbing Task",
                    workTypeId: "wt_1",
                    unitPrice: 110,
                    quantity: 3,
                },
                mockDb,
            );

            expect(resolved.name).toBe("Custom Plumbing Task");
            expect(resolved.workTypeName).toBe("Plumbing Service");
            expect(resolved.workTypeCode).toBe("PLUMB-01");
            expect(resolved.unitPrice.toFixed(2)).toBe("110.00");
            expect(resolved.quantity.toFixed(2)).toBe("3.00");
        });
    });
});
