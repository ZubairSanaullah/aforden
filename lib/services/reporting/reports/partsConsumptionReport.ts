import { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { composeReport } from "../reportEngine";
import { registerReportExecutor } from "../reportRegistry";
import { HISTORICAL_AGING_TOLERANCE_MS } from "../reportingConstants";
import type {
  ReportCustomExecutor,
  ReportKey,
  ReportQueryContext,
  ReportResponse,
  UnscopedReportDb,
} from "../reporting.types";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

const ZERO_DECIMAL = new Prisma.Decimal("0");
const ZERO_2DP = new Prisma.Decimal("0.00");

interface StockMovementRow {
  partId: string;
  movementType: string;
  quantity?: Prisma.Decimal | number | string | null;
}

interface InventoryBalanceRow {
  partId: string;
  quantityOnHand?: Prisma.Decimal | number | string | null;
}

interface PartRow {
  id: string;
  name: string;
  sku: string;
  minimumStockLevel?: Prisma.Decimal | number | string | null;
}

interface WorkOrderPartRow {
  id: string;
  partId: string;
  locationId: string | null;
  quantity?: Prisma.Decimal | number | string | null;
  unitCostAtTimeOfUse?: Prisma.Decimal | number | string | null;
  consumedAt?: Date | string | null;
}

/**
 * Custom Query Executor for Parts Consumption Report (Phase 1.14.8 Engine Migration).
 */
export const partsConsumptionExecutor: ReportCustomExecutor = async (
  ctx: ReportQueryContext,
) => {
  const isScalars = ctx.requestedDimensions.length === 0;
  const asOfDate = ctx.params.asOf
    ? new Date(String(ctx.params.asOf))
    : ctx.params.to
      ? new Date(ctx.range.endUtc)
      : new Date();
  const now = new Date();
  const isHistorical = asOfDate.getTime() < now.getTime() - HISTORICAL_AGING_TOLERANCE_MS;

  // A. Stock On Hand
  const partOnHandMap = new Map<string, Prisma.Decimal>();

  if (isHistorical) {
    // Reconstruct stock levels from immutable StockMovement ledger
    const movements = await ctx.scopedDb.stockMovement.findMany<StockMovementRow>({
      where: {
        createdAt: { lte: asOfDate },
        ...(ctx.params.partId ? { partId: String(ctx.params.partId) } : {}),
        ...(ctx.params.inventoryLocationId
          ? { locationId: String(ctx.params.inventoryLocationId) }
          : {}),
      },
      select: {
        partId: true,
        movementType: true,
        quantity: true,
      },
    });

    for (const m of movements) {
      const current = partOnHandMap.get(m.partId) ?? ZERO_DECIMAL;
      const qty = new Prisma.Decimal((m.quantity as string | number) ?? 0);
      let delta = ZERO_DECIMAL;

      switch (m.movementType) {
        case "RECEIPT":
        case "RETURN":
        case "TRANSFER_IN":
          delta = qty;
          break;
        case "CONSUMPTION":
        case "TRANSFER_OUT":
          delta = qty.negated();
          break;
        case "ADJUSTMENT":
          delta = qty;
          break;
        default:
          delta = ZERO_DECIMAL;
      }

      partOnHandMap.set(m.partId, current.add(delta));
    }
  } else {
    // Live InventoryBalance query
    const balances = await ctx.scopedDb.inventoryBalance.findMany<InventoryBalanceRow>({
      where: {
        ...(ctx.params.partId ? { partId: String(ctx.params.partId) } : {}),
        ...(ctx.params.inventoryLocationId
          ? { locationId: String(ctx.params.inventoryLocationId) }
          : {}),
      },
      select: {
        partId: true,
        quantityOnHand: true,
      },
    });

    for (const b of balances) {
      const current = partOnHandMap.get(b.partId) ?? ZERO_DECIMAL;
      partOnHandMap.set(b.partId, current.add(new Prisma.Decimal((b.quantityOnHand as string | number) ?? 0)));
    }
  }

  // B. Active Parts for minimum stock evaluation
  const activeParts = await ctx.scopedDb.part.findMany<PartRow>({
    where: {
      status: "ACTIVE",
      ...(ctx.params.partId ? { id: String(ctx.params.partId) } : {}),
    },
    select: {
      id: true,
      name: true,
      sku: true,
      minimumStockLevel: true,
    },
  });

  let belowMinCount = 0;
  for (const part of activeParts) {
    if (part.minimumStockLevel !== null && part.minimumStockLevel !== undefined) {
      const onHand = partOnHandMap.get(part.id) ?? ZERO_DECIMAL;
      const minLevel = new Prisma.Decimal((part.minimumStockLevel as string | number) ?? 0);
      if (onHand.lessThanOrEqualTo(minLevel)) {
        belowMinCount++;
      }
    }
  }

  // C. Period Consumed Parts
  const consumedParts = await ctx.scopedDb.workOrderPart.findMany<WorkOrderPartRow>({
    where: {
      consumedAt: {
        gte: ctx.range.startUtc,
        lt: ctx.range.endUtc,
      },
      ...(ctx.params.partId ? { partId: String(ctx.params.partId) } : {}),
      ...(ctx.params.inventoryLocationId
        ? { locationId: String(ctx.params.inventoryLocationId) }
        : {}),
    },
    select: {
      id: true,
      partId: true,
      locationId: true,
      quantity: true,
      unitCostAtTimeOfUse: true,
      consumedAt: true,
    },
  });

  let totalConsumedQty = ZERO_DECIMAL;
  let totalConsumedCost = ZERO_2DP;

  for (const cp of consumedParts) {
    const qty = new Prisma.Decimal((cp.quantity as string | number) ?? 0);
    const unitCost = new Prisma.Decimal((cp.unitCostAtTimeOfUse as string | number) ?? 0);
    totalConsumedQty = totalConsumedQty.add(qty);
    totalConsumedCost = totalConsumedCost.add(qty.mul(unitCost));
  }

  // D. Stock Movements in Period
  const periodMovementCount = await ctx.scopedDb.stockMovement.count({
    where: {
      createdAt: {
        gte: ctx.range.startUtc,
        lt: ctx.range.endUtc,
      },
      ...(ctx.params.partId ? { partId: String(ctx.params.partId) } : {}),
      ...(ctx.params.inventoryLocationId
        ? { locationId: String(ctx.params.inventoryLocationId) }
        : {}),
    },
  });

  let totalOnHand = ZERO_DECIMAL;
  for (const onHand of partOnHandMap.values()) {
    totalOnHand = totalOnHand.add(onHand);
  }

  if (isScalars) {
    return {
      scalarValues: {
        "inventory.quantityOnHand": totalOnHand.toNumber(),
        "inventory.belowMinimumStockPartCount": belowMinCount,
        "inventory.partsConsumedQuantity": totalConsumedQty.toNumber(),
        "inventory.partsConsumedCost": totalConsumedCost.toFixed(2),
        "inventory.stockMovementCount": periodMovementCount,
      },
    };
  }

  // Grouped rows
  const primaryDim = ctx.requestedDimensions[0];
  const groupMap = new Map<
    string,
    { onHand: Prisma.Decimal; consumedQty: Prisma.Decimal; consumedCost: Prisma.Decimal }
  >();

  if (primaryDim === "part") {
    for (const p of activeParts) {
      groupMap.set(p.id, {
        onHand: partOnHandMap.get(p.id) ?? ZERO_DECIMAL,
        consumedQty: ZERO_DECIMAL,
        consumedCost: ZERO_2DP,
      });
    }
  }

  for (const cp of consumedParts) {
    const key = primaryDim === "part" ? cp.partId : (cp.locationId ?? "UNASSIGNED");
    let entry = groupMap.get(key);
    if (!entry) {
      entry = {
        onHand: partOnHandMap.get(key) ?? ZERO_DECIMAL,
        consumedQty: ZERO_DECIMAL,
        consumedCost: ZERO_2DP,
      };
      groupMap.set(key, entry);
    }
    const qty = new Prisma.Decimal((cp.quantity as string | number) ?? 0);
    const cost = qty.mul(new Prisma.Decimal((cp.unitCostAtTimeOfUse as string | number) ?? 0));
    entry.consumedQty = entry.consumedQty.add(qty);
    entry.consumedCost = entry.consumedCost.add(cost);
  }

  const rows = Array.from(groupMap.keys()).map((id) => {
    const e = groupMap.get(id)!;
    return {
      groupKey: id,
      values: {
        "inventory.quantityOnHand": e.onHand.toNumber(),
        "inventory.partsConsumedQuantity": e.consumedQty.toNumber(),
        "inventory.partsConsumedCost": e.consumedCost.toFixed(2),
      },
    };
  });

  return { rows };
};

registerReportExecutor("inventory.partsConsumption", partsConsumptionExecutor);

/**
 * Retrieves the Parts Consumption Report via Generic Composition Engine.
 */
export async function getPartsConsumptionReport(
  workspaceId: string,
  rawParams?: unknown,
  authContext?: WorkspaceAuthorizationContext,
  reportKeyOrDb?: ReportKey | UnscopedReportDb,
  passedDb?: UnscopedReportDb,
): Promise<ReportResponse> {
  const reportKey: ReportKey =
    typeof reportKeyOrDb === "string" ? reportKeyOrDb : "inventory.partsConsumption";
  const db: UnscopedReportDb =
    typeof reportKeyOrDb === "object" && reportKeyOrDb !== null
      ? reportKeyOrDb
      : (passedDb ?? prisma);
  return composeReport(reportKey, workspaceId, rawParams, authContext, db);
}
