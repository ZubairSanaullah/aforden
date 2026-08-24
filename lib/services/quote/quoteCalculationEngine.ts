/**
 * Phase 1.11.4 — Quotes & Estimates Server-Side Calculation Engine
 * Pure, deterministic mathematical calculation utility implementing the exact
 * canonical 6-step formula locked in Phase 1.11.1 §4.2.
 *
 * Invariants:
 * 1. Step 1: Rejects (does not clamp) any line where (quantity * unitPrice) - discountAmount < 0.
 * 2. Step 2: Quote gross subtotal = sum of line base subtotals.
 * 3. Step 3: Header discount calculation (PERCENTAGE vs FIXED) capped at quote gross subtotal.
 * 4. Step 4: Proportional per-line discount allocation with exact penny reconciliation
 *    to the largest-subtotal line (tie-break: lowest sortOrder, then lowest id).
 * 5. Step 5: Per-line tax and total calculation.
 * 6. Step 6: Header totals strictly aggregated from line sums.
 * 7. Exact Decimal arithmetic throughout.
 */

import { Prisma } from "@/generated/prisma/client";
import { QuoteDiscountType } from "./quote.types";
import { InvalidQuoteCalculationError } from "./quoteErrors";

export interface QuoteHeaderCalculationInput {
    discountType?: QuoteDiscountType;
    discountValue?: number | string | Prisma.Decimal | null;
    taxRate?: number | string | Prisma.Decimal | null;
}

export interface QuoteLineItemCalculationInput {
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

export interface ComputedQuoteLineItemResult {
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
    rawItem: QuoteLineItemCalculationInput;
}

export interface ComputedQuoteResult {
    subtotal: Prisma.Decimal;
    discountType: QuoteDiscountType;
    discountValue: Prisma.Decimal;
    discountAmount: Prisma.Decimal;
    taxRate: Prisma.Decimal;
    taxAmount: Prisma.Decimal;
    total: Prisma.Decimal;
    lineItems: ComputedQuoteLineItemResult[];
    formatted: {
        subtotal: string;
        discountValue: string;
        discountAmount: string;
        taxRate: string;
        taxAmount: string;
        total: string;
    };
}

const ZERO_2DP = new Prisma.Decimal("0.00");
const ZERO_4DP = new Prisma.Decimal("0.0000");
const ONE_HUNDRED = new Prisma.Decimal("100.00");

/**
 * Normalizes input value to Prisma.Decimal with fallback to 0.
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
 * Pure calculation engine for Quotes and Estimates.
 * Computes all line item subtotals, prorates header discounts, computes per-line tax amounts,
 * and aggregates authoritative quote totals.
 */
export function calculateQuoteTotals(
    header: QuoteHeaderCalculationInput,
    lineItems: QuoteLineItemCalculationInput[],
): ComputedQuoteResult {
    const discountType: QuoteDiscountType = header.discountType ?? "PERCENTAGE";
    const discountValue = round2(toDecimal(header.discountValue, ZERO_2DP));
    const headerTaxRate = round4(toDecimal(header.taxRate, ZERO_4DP));

    // Handle 0 line items case gracefully
    if (!lineItems || lineItems.length === 0) {
        return {
            subtotal: ZERO_2DP,
            discountType,
            discountValue,
            discountAmount: ZERO_2DP,
            taxRate: headerTaxRate,
            taxAmount: ZERO_2DP,
            total: ZERO_2DP,
            lineItems: [],
            formatted: {
                subtotal: ZERO_2DP.toFixed(2),
                discountValue: discountValue.toFixed(2),
                discountAmount: ZERO_2DP.toFixed(2),
                taxRate: headerTaxRate.toFixed(4),
                taxAmount: ZERO_2DP.toFixed(2),
                total: ZERO_2DP.toFixed(2),
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
            throw new InvalidQuoteCalculationError(
                `Invalid quote calculation: line item "${item.name || index + 1}" subtotal ((quantity × unitPrice) − discountAmount = ${rawGross.toFixed(2)} − ${lineDiscountAmount.toFixed(2)} = ${lineBaseSubtotal.toFixed(2)}) cannot be negative.`,
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
    // Step 2: Quote Gross Subtotal
    // -------------------------------------------------------------
    const grossQuoteSubtotal = step1Lines.reduce(
        (sum, line) => sum.add(line.lineBaseSubtotal),
        ZERO_2DP,
    );

    // -------------------------------------------------------------
    // Step 3: Quote Header Discount Calculation
    // -------------------------------------------------------------
    let quoteDiscountAmount = ZERO_2DP;
    if (grossQuoteSubtotal.isPositive()) {
        if (discountType === "PERCENTAGE") {
            const rawDiscount = grossQuoteSubtotal.mul(discountValue).div(ONE_HUNDRED);
            quoteDiscountAmount = round2(rawDiscount);
        } else {
            // FIXED discount
            quoteDiscountAmount = discountValue;
        }

        // Cap discount at gross quote subtotal
        if (quoteDiscountAmount.greaterThan(grossQuoteSubtotal)) {
            quoteDiscountAmount = grossQuoteSubtotal;
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

    if (grossQuoteSubtotal.isZero() || quoteDiscountAmount.isZero()) {
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
            // Raw allocated = quoteDiscountAmount * (lineBaseSubtotal / grossQuoteSubtotal)
            const rawAlloc = quoteDiscountAmount.mul(line.lineBaseSubtotal).div(grossQuoteSubtotal);
            const lineAlloc = floor2(rawAlloc);
            initialAllocations.push(lineAlloc);
            sumAllocated = sumAllocated.add(lineAlloc);
        }

        // Compute remainder from penny rounding
        const remainder = quoteDiscountAmount.sub(sumAllocated);

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
    const computedLines: ComputedQuoteLineItemResult[] = step1Lines.map((line, idx) => {
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
    // Step 6: Quote Header Totals Aggregation
    // -------------------------------------------------------------
    const quoteTaxAmount = computedLines.reduce(
        (sum, l) => sum.add(l.taxAmount),
        ZERO_2DP,
    );

    const quoteTotal = computedLines.reduce(
        (sum, l) => sum.add(l.total),
        ZERO_2DP,
    );

    return {
        subtotal: grossQuoteSubtotal,
        discountType,
        discountValue,
        discountAmount: quoteDiscountAmount,
        taxRate: headerTaxRate,
        taxAmount: quoteTaxAmount,
        total: quoteTotal,
        lineItems: computedLines,
        formatted: {
            subtotal: grossQuoteSubtotal.toFixed(2),
            discountValue: discountValue.toFixed(2),
            discountAmount: quoteDiscountAmount.toFixed(2),
            taxRate: headerTaxRate.toFixed(4),
            taxAmount: quoteTaxAmount.toFixed(2),
            total: quoteTotal.toFixed(2),
        },
    };
}
