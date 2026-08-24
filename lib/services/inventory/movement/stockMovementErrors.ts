/**
 * Phase 1.10 StockMovement Domain Errors
 * Convention B: Structured errors with readonly code, statusCode, and httpStatus.
 */

export {
    PartNotFoundError,
    PartInactiveError,
} from "@/lib/services/inventory/part/partErrors";

export {
    InventoryLocationNotFoundError,
    InventoryLocationInactiveError,
} from "@/lib/services/inventory/inventoryLocation/inventoryLocationErrors";

export {
    WorkOrderNotFoundError,
} from "@/lib/services/workOrder/workOrderErrors";

export {
    WorkOrderPartNotFoundError,
} from "@/lib/services/inventory/workOrderPart/workOrderPartErrors";

/**
 * Thrown when a stock transfer is attempted where source and destination locations are identical (422).
 */
export class TransferSameLocationError extends Error {
    readonly code = "TRANSFER_SAME_LOCATION";
    readonly statusCode = 422;
    readonly httpStatus = 422;

    constructor(
        message = "Source and destination locations cannot be the same for a stock transfer.",
    ) {
        super(message);
        this.name = "TransferSameLocationError";
    }
}

/**
 * Thrown when an inventory operation cannot proceed because available stock (onHand - reserved) is insufficient (409).
 */
export class InsufficientStockError extends Error {
    readonly code = "INSUFFICIENT_STOCK";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "Insufficient available stock for the requested inventory operation.",
    ) {
        super(message);
        this.name = "InsufficientStockError";
    }
}

/**
 * Thrown when a stock return attempt exceeds the remaining unreturned quantity for a WorkOrderPart (409).
 */
export class ExcessiveReturnError extends Error {
    readonly code = "EXCESSIVE_RETURN";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "Cannot return more parts than the remaining net-consumed quantity on this work order part record.",
    ) {
        super(message);
        this.name = "ExcessiveReturnError";
    }
}
