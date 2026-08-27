import { getDimensionDefinition } from "./dimensionRegistry";
import type { DimensionKey, ScopedReportDb } from "./reporting.types";

/**
 * Batched relation label hydrator for dimensional reporting.
 * Hydrates opaque IDs into human-readable display names with 1 batched query per dimension.
 */
export async function hydrateDimensionLabels(
  dimensionKey: DimensionKey,
  rawGroupIds: string[],
  workspaceId: string,
  db: ScopedReportDb,
): Promise<Map<string, string>> {
  const labelMap = new Map<string, string>();
  const dimDef = getDimensionDefinition(dimensionKey);

  if (dimDef.labelSource.kind === "ENUM" || dimDef.labelSource.kind === "SELF" || dimDef.labelSource.kind === "DATE_BUCKET") {
    for (const id of rawGroupIds) {
      labelMap.set(id, id);
    }
    return labelMap;
  }

  const validIds = rawGroupIds.filter((id) => id !== "UNASSIGNED" && id !== "null" && id !== "undefined");
  if (validIds.length === 0) {
    return labelMap;
  }

  switch (dimensionKey) {
    case "technician": {
      const profiles = await db.technicianProfile.findMany<any>({
        where: { id: { in: validIds } },
        select: {
          id: true,
          employee: {
            select: { displayName: true },
          },
        },
      });
      for (const p of profiles) {
        labelMap.set(p.id, p.employee?.displayName ?? p.employee?.name ?? p.id);
      }
      break;
    }
    case "workType": {
      const types = await db.workType.findMany<{ id: string; name: string }>({
        where: { id: { in: validIds } },
        select: { id: true, name: true },
      });
      for (const t of types) {
        labelMap.set(t.id, t.name);
      }
      break;
    }
    case "serviceCatalog": {
      const catalogs = await db.serviceCatalog.findMany<{ id: string; name: string }>({
        where: { id: { in: validIds } },
        select: { id: true, name: true },
      });
      for (const c of catalogs) {
        labelMap.set(c.id, c.name);
      }
      break;
    }
    case "customer": {
      const customers = await db.customer.findMany<{ id: string; name: string }>({
        where: { id: { in: validIds } },
        select: { id: true, name: true },
      });
      for (const c of customers) {
        labelMap.set(c.id, c.name);
      }
      break;
    }
    case "part": {
      const parts = await db.part.findMany<{ id: string; name: string; sku?: string | null }>({
        where: { id: { in: validIds } },
        select: { id: true, name: true, sku: true },
      });
      for (const p of parts) {
        labelMap.set(p.id, p.sku ? `${p.name} (${p.sku})` : p.name);
      }
      break;
    }
    case "inventoryLocation": {
      const locations = await db.inventoryLocation.findMany<{ id: string; name: string }>({
        where: { id: { in: validIds } },
        select: { id: true, name: true },
      });
      for (const l of locations) {
        labelMap.set(l.id, l.name);
      }
      break;
    }
    case "assetCategory": {
      const categories = await db.assetCategory.findMany<{ id: string; name: string }>({
        where: { id: { in: validIds } },
        select: { id: true, name: true },
      });
      for (const cat of categories) {
        labelMap.set(cat.id, cat.name);
      }
      break;
    }
  }

  // Ensure any ID that couldn't be resolved falls back to its ID
  for (const id of rawGroupIds) {
    if (!labelMap.has(id)) {
      labelMap.set(id, id);
    }
  }

  return labelMap;
}
