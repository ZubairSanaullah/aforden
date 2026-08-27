import { ReportScopeViolationError } from "./reportingErrors";
import { getFilterDefinition } from "./filterRegistry";
import type { FilterKey, ScopedReportDb } from "./reporting.types";

/**
 * Validates that all foreign key ID filters provided in a report request belong to the tenant workspace.
 * Reusable across all report execution services (WorkOrder, Scheduling, Financial, Inventory, etc.).
 */
export async function validateTenantFilters(
  workspaceId: string,
  filters: Record<string, unknown>,
  db: ScopedReportDb,
): Promise<void> {
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) continue;

    const filterDef = getFilterDefinition(key as FilterKey);
    if (!filterDef.requiresTenantValidation) continue;

    const idStr = String(value);

    switch (key) {
      case "customerId": {
        const cust = await db.customer.findFirst({
          where: { id: idStr },
          select: { id: true },
        });
        if (!cust) {
          throw new ReportScopeViolationError(
            `Customer ID "${idStr}" does not exist in workspace.`,
          );
        }
        break;
      }
      case "technicianId": {
        const tech = await db.technicianProfile.findFirst({
          where: {
            id: idStr,
            employee: { workspaceId },
          },
          select: { id: true },
        });
        if (!tech) {
          throw new ReportScopeViolationError(
            `Technician profile ID "${idStr}" does not exist in workspace.`,
          );
        }
        break;
      }
      case "workTypeId": {
        const wt = await db.workType.findFirst({
          where: { id: idStr },
          select: { id: true },
        });
        if (!wt) {
          throw new ReportScopeViolationError(
            `WorkType ID "${idStr}" does not exist in workspace.`,
          );
        }
        break;
      }
      case "serviceCatalogId": {
        const sc = await db.serviceCatalog.findFirst({
          where: { id: idStr },
          select: { id: true },
        });
        if (!sc) {
          throw new ReportScopeViolationError(
            `ServiceCatalog ID "${idStr}" does not exist in workspace.`,
          );
        }
        break;
      }
      case "partId": {
        const part = await db.part.findFirst({
          where: { id: idStr },
          select: { id: true },
        });
        if (!part) {
          throw new ReportScopeViolationError(
            `Part ID "${idStr}" does not exist in workspace.`,
          );
        }
        break;
      }
      case "inventoryLocationId": {
        const loc = await db.inventoryLocation.findFirst({
          where: { id: idStr },
          select: { id: true },
        });
        if (!loc) {
          throw new ReportScopeViolationError(
            `InventoryLocation ID "${idStr}" does not exist in workspace.`,
          );
        }
        break;
      }
      case "assetCategoryId": {
        const cat = await db.assetCategory.findFirst({
          where: { id: idStr },
          select: { id: true },
        });
        if (!cat) {
          throw new ReportScopeViolationError(
            `AssetCategory ID "${idStr}" does not exist in workspace.`,
          );
        }
        break;
      }
    }
  }
}
