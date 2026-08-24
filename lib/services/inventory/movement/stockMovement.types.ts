import type { StockMovementType } from "@/generated/prisma/client";
import type { InventoryBalanceDetailViewModel } from "@/lib/services/inventory/balance/inventoryBalance.types";
import type { WorkOrderPartDetailViewModel } from "@/lib/services/inventory/workOrderPart/workOrderPart.types";

/**
 * Canonical detailed view model for single StockMovement presentation.
 * All Decimal fields (quantity, unitCostSnapshot) are serialized as numbers.
 */
export interface StockMovementDetailViewModel {
    id: string;
    workspaceId: string;
    partId: string;
    locationId: string | null;
    movementType: StockMovementType;
    quantity: number;
    fromLocationId: string | null;
    toLocationId: string | null;
    workOrderId: string | null;
    originalWorkOrderPartId: string | null;
    unitCostSnapshot: number | null;
    reason: string | null;
    referenceNumber: string | null;
    actorMemberId: string | null;
    createdAt: Date;
}

/**
 * Result structure returned by receiveStock mutation service,
 * returning both the created ledger entry and the updated stock balance.
 */
export interface StockReceiptResult {
    movement: StockMovementDetailViewModel;
    balance: InventoryBalanceDetailViewModel;
}

/**
 * Result structure returned by transferStock mutation service,
 * returning paired ledger entries (TRANSFER_OUT, TRANSFER_IN) and updated source/destination balances.
 */
export interface StockTransferResult {
    transferOutMovement: StockMovementDetailViewModel;
    transferInMovement: StockMovementDetailViewModel;
    sourceBalance: InventoryBalanceDetailViewModel;
    destinationBalance: InventoryBalanceDetailViewModel;
}

/**
 * Result structure returned by adjustStock mutation service,
 * returning both the created adjustment ledger entry and the updated stock balance.
 */
export interface StockAdjustmentResult {
    movement: StockMovementDetailViewModel;
    balance: InventoryBalanceDetailViewModel;
}

/**
 * Result structure returned by reserveStock mutation service,
 * returning both the created reservation ledger entry and the updated stock balance.
 */
export interface StockReservationResult {
    movement: StockMovementDetailViewModel;
    balance: InventoryBalanceDetailViewModel;
}

/**
 * Result structure returned by releaseStock mutation service,
 * returning both the created release ledger entry and the updated stock balance.
 */
export type StockReleaseResult = StockReservationResult;

/**
 * Result structure returned by consumeStock mutation service,
 * returning the consumption ledger entry, the updated stock balance, and the created WorkOrderPart.
 */
export interface StockConsumptionResult {
    movement: StockMovementDetailViewModel;
    balance: InventoryBalanceDetailViewModel;
    workOrderPart: WorkOrderPartDetailViewModel;
}

/**
 * Result structure returned by returnStock mutation service,
 * returning the return ledger entry, the updated stock balance, and the updated WorkOrderPart view model.
 */
export interface StockReturnResult {
    movement: StockMovementDetailViewModel;
    balance: InventoryBalanceDetailViewModel;
    workOrderPart: WorkOrderPartDetailViewModel;
}

export interface StockMovementListResult {
    items: StockMovementDetailViewModel[];
    pagination: {
        page: number;
        pageSize: number;
        total: number;
        totalPages: number;
        hasNextPage: boolean;
        hasPreviousPage: boolean;
    };
}

// ---------------------------------------------------------------------------
// Input DTOs
// ---------------------------------------------------------------------------

export interface ReceiveStockInput {
    partId: string;
    locationId: string;
    quantity: number;
    unitCostSnapshot?: number | null;
    reason?: string | null;
    referenceNumber?: string | null;
}

export interface TransferStockInput {
    partId: string;
    fromLocationId: string;
    toLocationId: string;
    quantity: number;
    reason?: string | null;
    referenceNumber?: string | null;
}

export interface AdjustStockInput {
    partId: string;
    locationId: string;
    quantity: number;
    reason: string;
    referenceNumber?: string | null;
}

export interface ReserveStockInput {
    partId: string;
    locationId: string;
    quantity: number;
    workOrderId?: string | null;
    reason?: string | null;
    referenceNumber?: string | null;
}

export interface ReleaseStockInput {
    partId: string;
    locationId: string;
    quantity: number;
    workOrderId?: string | null;
    reason?: string | null;
    referenceNumber?: string | null;
}

export interface ConsumeStockInput {
    partId: string;
    locationId: string;
    quantity: number;
    workOrderId: string;
    originalWorkOrderPartId?: string | null;
    notes?: string | null;
    reason?: string | null;
    referenceNumber?: string | null;
}

export interface ReturnStockInput {
    partId: string;
    locationId: string;
    quantity: number;
    workOrderId: string;
    originalWorkOrderPartId: string;
    reason?: string | null;
    referenceNumber?: string | null;
}

export interface ListStockMovementsFilter {
    partId?: string;
    locationId?: string;
    movementType?: StockMovementType;
    workOrderId?: string;
    originalWorkOrderPartId?: string;
    actorMemberId?: string;
    startDate?: string | Date;
    endDate?: string | Date;
    page?: number;
    pageSize?: number;
    sortBy?: "createdAt" | "quantity";
    sortOrder?: "asc" | "desc";
}
