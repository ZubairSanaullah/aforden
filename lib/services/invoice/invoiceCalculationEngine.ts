/**
 * Phase 1.12.4 — Invoicing & Payments Server-Side Calculation Engine
 * Pure, deterministic mathematical calculation utility implementing the exact
 * canonical 7-step formula locked in Phase 1.12.1 §4.
 *
 * Invariants:
 * 1. Step 1: Rejects (does not clamp) any line where (quantity * unitPrice) - discountAmount < 0.
 * 2. Step 2: Invoice gross subtotal = sum of line base subtotals.
 * 3. Step 3: Header discount calculation (PERCENTAGE vs FIXED) capped at invoice gross subtotal.
 * 4. Step 4: Proportional per-line discount allocation with exact penny reconciliation
 *    to the largest-subtotal line (tie-break: lowest sortOrder, then lowest id).
 * 5. Step 5: Per-line tax and total calculation.
 * 6. Step 6: Header totals strictly aggregated from line sums.
 * 7. Step 7: Payment-balance reconciliation: amountPaid = sum(RECORDED payments),
 *    amountDue = max(0.00, total - amountPaid).
 * 8. Exact Decimal arithmetic throughout using Prisma.Decimal.
 *
 * NOTE TO MAINTAINERS [FORMULA SYNCHRONIZATION]:
 * The mathematical formula and proration logic in Steps 1-6 are intentionally mirrored
 * from `lib/services/quote/quoteCalculationEngine.ts` to preserve total domain isolation.
 * Any formula modifications, rounding adjustments, or tie-break refinements made here MUST
 * be synchronized with the Quotes engine (and vice-versa).
 */

import { Prisma } from "@/generated/prisma/client";
import { InvoiceDiscountType, PaymentStatus } from "./invoice.types";
import { InvalidInvoiceCalculationError } from "./invoiceErrors";

export interface InvoiceHeaderCalculationInput {
    discountType?: InvoiceDiscountType;
    discountValue?: number | string | Prisma.Decimal | null;
    taxRate?: number | string | Prisma.Decimal | null;
}

export interface InvoiceLineItemCalculationInput {
    id?: string;
    sortOrder?: number;
    quantity: number | string | Prisma.Decimal;
    unitPrice: number | string | Prisma.Decimal;
    unitCost?: number | string | Prisma.Decimal | null;
    discountAmount?: number | string | Prisma.Decimal | null;
    taxRate?: number | string | Prisma.Decimal | null;
    name?: string;
    [key: string]: any;
}

export interface InvoicePaymentCalculationInput {
    id?: string;
    amount: number | string | Prisma.Decimal;
    status: PaymentStatus | string;
    [key: string]: any;
}

export interface ComputedInvoiceLineItemResult {
    id?: string;
    sortOrder: number;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    unitCost: Prisma.Decimal | null;
    lineDiscountAmount: Prisma.Decimal;
    allocatedHeaderDiscount: Prisma.Decimal;
    totalDiscountAmount: Prisma.Decimal;
    lineBaseSubtotal: Prisma.Decimal;
    lineNetBase: Prisma.Decimal;
    taxRate: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    total: Prisma.Decimal;
    formatted: {
        quantity: string;
        unitPrice: string;
        unitCost: string | null;
        discountAmount: string;
        subtotal: string;
        taxRate: string;
        taxAmount: string;
        total: string;
    };
    rawItem: InvoiceLineItemCalculationInput;
}

export interface ComputedInvoiceResult {
    subtotal: Prisma.Decimal;
    discountType: InvoiceDiscountType;
    discountValue: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
    taxRate: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    total: Prisma.Decimal;
    amountPaid: Prisma.Decimal;
    amountDue: Prisma.Decimal;
    lineItems: ComputedInvoiceLineItemResult[];
    formatted: {
        subtotal: string;
        discountValue: string;
        discountAmount: string;
        taxRate: string;
        taxAmount: string;
        total: string;
        amountPaid: string;
        amountDue: string;
    };
}

const ZERO_2DP = new Prisma.Decimal("0.00");
const ZERO_4DP = new Prisma.Decimal("0.0000");
const ONE_HUNDRED = new Prisma.Decimal("100.00");

/**
 * Normalizes input value to Prisma.Decimal with fallback to defaultVal.
 */
function toDecimal(val: number | string | Prisma.Decimal | null | undefined, defaultVal = ZERO_2DP): Prisma.Decimal {
    if (val === null || val === undefined) return defaultVal;
    if (val instanceof Prisma.Decimal) return val;
    try {
        const str = String(val).trim();
        if (str === "") return defaultVal;
        return new Prisma.Decimal(str);
    } catch {
        return defaultVal;
    }
}

/**
 * Rounds a Decimal to 2 decimal places using standard half-up rounding.
 */
function round2(d: Prisma.Decimal): Prisma.Decimal {
    return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Truncates (floors) a Decimal to 2 decimal places for raw proportional allocation.
 */
function floor2(d: Prisma.Decimal): Prisma.Decimal {
    return d.toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
}

/**
 * Rounds a Decimal to 4 decimal places for tax rates.
 */
function round4(d: Prisma.Decimal): Prisma.Decimal {
    return d.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Deterministic candidate selection for penny remainder allocation:
 * 1. Largest lineBaseSubtotal
 * 2. Lowest sortOrder
 * 3. Lowest id (lexicographical)
 * 4. Lowest original array index
 */
function findRemainderCandidateIndex(
    lines: Array<{
        lineBaseSubtotal: Prisma.Decimal;
        sortOrder: number;
        id?: string;
        index: number;
    }>,
): number {
    if (lines.length === 0) return -1;
    let best = lines[0];

    for (let i = 1; i < lines.length; i++) {
        const curr = lines[i];
        if (curr.lineBaseSubtotal.greaterThan(best.lineBaseSubtotal)) {
            best = curr;
        } else if (curr.lineBaseSubtotal.equals(best.lineBaseSubtotal)) {
            if (curr.sortOrder < best.sortOrder) {
                best = curr;
            } else if (curr.sortOrder === best.sortOrder) {
                if (curr.id && best.id) {
                    if (curr.id.localeCompare(best.id) < 0) {
                        best = curr;
                    }
                } else if (curr.id && !best.id) {
                    best = curr;
                } else if (!curr.id && !best.id) {
                    if (curr.index < best.index) {
                        best = curr;
                    }
                }
            }
        }
    }
    return best.index;
}

/**
 * Pure calculation engine for Invoicing & Payments.
 * Computes all line item subtotals, prorates header discounts, computes per-line tax amounts,
 * aggregates invoice totals, and reconciles payment balances.
 */
export function calculateInvoiceTotals(
    header: InvoiceHeaderCalculationInput,
    lineItems: InvoiceLineItemCalculationInput[],
    payments: InvoicePaymentCalculationInput[] = [],
): ComputedInvoiceResult {
    const discountType: InvoiceDiscountType = header.discountType ?? "PERCENTAGE";
    const discountValue = round2(toDecimal(header.discountValue, ZERO_2DP));
    const headerTaxRate = round4(toDecimal(header.taxRate, ZERO_4DP));

    // Calculate amountPaid from active RECORDED payments
    const amountPaid = payments
        .filter((p) => p.status === "RECORDED")
        .reduce((sum, p) => sum.add(round2(toDecimal(p.amount, ZERO_2DP))), ZERO_2DP);

    // Handle 0 line items case gracefully
    if (!lineItems || lineItems.length === 0) {
        const total = ZERO_2DP;
        const amountDue = round2(Prisma.Decimal.max(ZERO_2DP, total.sub(amountPaid)));
        return {
            subtotal: ZERO_2DP,
            discountType,
            discountValue,
            discountAmount: ZERO_2DP,
            taxRate: headerTaxRate,
            taxAmount: ZERO_2DP,
            total,
            amountPaid,
            amountDue,
            lineItems: [],
            formatted: {
                subtotal: ZERO_2DP.toFixed(2),
                discountValue: discountValue.toFixed(2),
                discountAmount: ZERO_2DP.toFixed(2),
                taxRate: headerTaxRate.toFixed(4),
                taxAmount: ZERO_2DP.toFixed(2),
                total: ZERO_2DP.toFixed(2),
                amountPaid: amountPaid.toFixed(2),
                amountDue: amountDue.toFixed(2),
            },
        };
    }

    // -------------------------------------------------------------
    // Step 1: Per-Line Base Subtotal & Negative Guard
    // -------------------------------------------------------------
    const step1Lines = lineItems.map((item, index) => {
        const quantity = round2(toDecimal(item.quantity, new Prisma.Decimal("1.00")));
        const unitPrice = round2(toDecimal(item.unitPrice, ZERO_2DP));
        const unitCost = item.unitCost !== undefined && item.unitCost !== null
            ? round2(toDecimal(item.unitCost, ZERO_2DP))
            : null;
        const lineDiscountAmount = round2(toDecimal(item.discountAmount, ZERO_2DP));
        const sortOrder = typeof item.sortOrder === "number" ? item.sortOrder : index;

        const rawGross = round2(quantity.mul(unitPrice));
        const lineBaseSubtotal = round2(rawGross.sub(lineDiscountAmount));

        if (lineBaseSubtotal.isNegative()) {
            throw new InvalidInvoiceCalculationError(
                `Invalid invoice calculation: line item "${item.name || index + 1}" subtotal ((quantity × unitPrice) − discountAmount = ${rawGross.toFixed(2)} − ${lineDiscountAmount.toFixed(2)} = ${lineBaseSubtotal.toFixed(2)}) cannot be negative.`,
            );
        }

        // Determine effective tax rate for line
        const itemTaxRate = item.taxRate !== undefined && item.taxRate !== null
            ? round4(toDecimal(item.taxRate, ZERO_4DP))
            : headerTaxRate;

        return {
            id: item.id,
            sortOrder,
            quantity,
            unitPrice,
            unitCost,
            lineDiscountAmount,
            lineBaseSubtotal,
            taxRate: itemTaxRate,
            rawItem: item,
            index,
        };
    });

    // -------------------------------------------------------------
    // Step 2: Invoice Gross Subtotal
    // -------------------------------------------------------------
    const grossInvoiceSubtotal = step1Lines.reduce(
        (sum, line) => sum.add(line.lineBaseSubtotal),
        ZERO_2DP,
    );

    // -------------------------------------------------------------
    // Step 3: Invoice Header Discount Calculation
    // -------------------------------------------------------------
    let invoiceDiscountAmount = ZERO_2DP;
    if (grossInvoiceSubtotal.isPositive()) {
        if (discountType === "PERCENTAGE") {
            const rawDiscount = grossInvoiceSubtotal.mul(discountValue).div(ONE_HUNDRED);
            invoiceDiscountAmount = round2(rawDiscount);
        } else {
            // FIXED discount
            invoiceDiscountAmount = discountValue;
        }

        // Cap discount at gross invoice subtotal
        if (invoiceDiscountAmount.greaterThan(grossInvoiceSubtotal)) {
            invoiceDiscountAmount = grossInvoiceSubtotal;
        }
    }

    // -------------------------------------------------------------
    // Step 4: Proportional Per-Line Discount Allocation & Penny Reconciliation
    // -------------------------------------------------------------
    interface AllocatedLine {
        allocatedHeaderDiscount: Prisma.Decimal;
        lineNetBase: Prisma.Decimal;
    }

    const allocations: AllocatedLine[] = [];

    if (grossInvoiceSubtotal.isZero() || invoiceDiscountAmount.isZero()) {
        for (const line of step1Lines) {
            allocations.push({
                allocatedHeaderDiscount: ZERO_2DP,
                lineNetBase: line.lineBaseSubtotal,
            });
        }
    } else {
        let sumAllocated = ZERO_2DP;
        const initialAllocations: Prisma.Decimal[] = [];

        for (const line of step1Lines) {
            // Raw allocated = invoiceDiscountAmount * (lineBaseSubtotal / grossInvoiceSubtotal)
            const rawAlloc = invoiceDiscountAmount.mul(line.lineBaseSubtotal).div(grossInvoiceSubtotal);
            const lineAlloc = floor2(rawAlloc);
            initialAllocations.push(lineAlloc);
            sumAllocated = sumAllocated.add(lineAlloc);
        }

        // Compute remainder from penny rounding
        const remainder = invoiceDiscountAmount.sub(sumAllocated);

        // Find candidate line for remainder
        const candidateIndex = findRemainderCandidateIndex(
            step1Lines.map((l) => ({
                lineBaseSubtotal: l.lineBaseSubtotal,
                sortOrder: l.sortOrder,
                id: l.id,
                index: l.index,
            })),
        );

        for (let i = 0; i < step1Lines.length; i++) {
            let finalAlloc = initialAllocations[i];
            if (i === candidateIndex && remainder.isPositive()) {
                finalAlloc = finalAlloc.add(remainder);
            }
            const lineNet = round2(step1Lines[i].lineBaseSubtotal.sub(finalAlloc));
            allocations.push({
                allocatedHeaderDiscount: finalAlloc,
                lineNetBase: lineNet,
            });
        }
    }

    // -------------------------------------------------------------
    // Step 5: Per-Line Tax & Total Calculation
    // -------------------------------------------------------------
    const computedLines: ComputedInvoiceLineItemResult[] = step1Lines.map((line, idx) => {
        const alloc = allocations[idx];
        const taxAmount = round2(alloc.lineNetBase.mul(line.taxRate));
        const total = round2(alloc.lineNetBase.add(taxAmount));
        const totalDiscountAmount = round2(line.lineDiscountAmount.add(alloc.allocatedHeaderDiscount));

        return {
            id: line.id,
            sortOrder: line.sortOrder,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            unitCost: line.unitCost,
            lineDiscountAmount: line.lineDiscountAmount,
            allocatedHeaderDiscount: alloc.allocatedHeaderDiscount,
            totalDiscountAmount,
            lineBaseSubtotal: line.lineBaseSubtotal,
            lineNetBase: alloc.lineNetBase,
            taxRate: line.taxRate,
            taxAmount,
            total,
            formatted: {
                quantity: line.quantity.toFixed(2),
                unitPrice: line.unitPrice.toFixed(2),
                unitCost: line.unitCost ? line.unitCost.toFixed(2) : null,
                discountAmount: totalDiscountAmount.toFixed(2),
                subtotal: line.lineBaseSubtotal.toFixed(2),
                taxRate: line.taxRate.toFixed(4),
                taxAmount: taxAmount.toFixed(2),
                total: total.toFixed(2),
            },
            rawItem: line.rawItem,
        };
    });

    // -------------------------------------------------------------
    // Step 6: Invoice Header Totals Aggregation
    // -------------------------------------------------------------
    const invoiceTaxAmount = computedLines.reduce(
        (sum, l) => sum.add(l.taxAmount),
        ZERO_2DP,
    );

    const invoiceTotal = computedLines.reduce(
        (sum, l) => sum.add(l.total),
        ZERO_2DP,
    );

    // -------------------------------------------------------------
    // Step 7: Payment Balance Reconciliation
    // -------------------------------------------------------------
    const amountDue = round2(Prisma.Decimal.max(ZERO_2DP, invoiceTotal.sub(amountPaid)));

    return {
        subtotal: grossInvoiceSubtotal,
        discountType,
        discountValue,
        discountAmount: invoiceDiscountAmount,
        taxRate: headerTaxRate,
        taxAmount: invoiceTaxAmount,
        total: invoiceTotal,
        amountPaid,
        amountDue,
        lineItems: computedLines,
        formatted: {
            subtotal: grossInvoiceSubtotal.toFixed(2),
            discountValue: discountValue.toFixed(2),
            discountAmount: invoiceDiscountAmount.toFixed(2),
            taxRate: headerTaxRate.toFixed(4),
            taxAmount: invoiceTaxAmount.toFixed(2),
            total: invoiceTotal.toFixed(2),
            amountPaid: amountPaid.toFixed(2),
            amountDue: amountDue.toFixed(2),
        },
    };
}

/**
 * Helper to reconcile payment balance against an invoice total.
 */
export function reconcileInvoicePaymentBalance(
    invoiceTotal: number | string | Prisma.Decimal,
    payments: InvoicePaymentCalculationInput[] = [],
): {
    amountPaid: Prisma.Decimal;
    amountDue: Prisma.Decimal;
    formatted: { amountPaid: string; amountDue: string };
} {
    const total = round2(toDecimal(invoiceTotal, ZERO_2DP));
    const amountPaid = payments
        .filter((p) => p.status === "RECORDED")
        .reduce((sum, p) => sum.add(round2(toDecimal(p.amount, ZERO_2DP))), ZERO_2DP);
    const amountDue = round2(Prisma.Decimal.max(ZERO_2DP, total.sub(amountPaid)));

    return {
        amountPaid,
        amountDue,
        formatted: {
            amountPaid: amountPaid.toFixed(2),
            amountDue: amountDue.toFixed(2),
        },
    };
}
