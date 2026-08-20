import {
    AssetCategoryNotFoundError,
    AssetCategoryAlreadyExistsError,
    AssetCategoryInactiveError,
    AssetCategoryDeletionNotAllowedError,
} from "@/lib/services/assetCategory/assetCategoryErrors";

export {
    AssetCategoryNotFoundError,
    AssetCategoryAlreadyExistsError,
    AssetCategoryInactiveError,
    AssetCategoryDeletionNotAllowedError,
};

export class AssetNotFoundError extends Error {
    readonly code = "ASSET_NOT_FOUND";
    readonly statusCode = 404;
    readonly httpStatus = 404;

    constructor(message = "Asset not found.") {
        super(message);
        this.name = "AssetNotFoundError";
    }
}

export class AssetCustomerNotFoundError extends Error {
    readonly code = "ASSET_CUSTOMER_NOT_FOUND";
    readonly statusCode = 404;
    readonly httpStatus = 404;

    constructor(message = "Customer not found.") {
        super(message);
        this.name = "AssetCustomerNotFoundError";
    }
}

export class AssetCustomerInactiveError extends Error {
    readonly code = "ASSET_CUSTOMER_INACTIVE";
    readonly statusCode = 400;
    readonly httpStatus = 400;

    constructor(message = "Cannot assign asset to an inactive customer.") {
        super(message);
        this.name = "AssetCustomerInactiveError";
    }
}

export class AssetLocationNotFoundError extends Error {
    readonly code = "ASSET_LOCATION_NOT_FOUND";
    readonly statusCode = 404;
    readonly httpStatus = 404;

    constructor(message = "Service location not found.") {
        super(message);
        this.name = "AssetLocationNotFoundError";
    }
}

export class AssetLocationCustomerMismatchError extends Error {
    readonly code = "ASSET_LOCATION_CUSTOMER_MISMATCH";
    readonly statusCode = 422;
    readonly httpStatus = 422;

    constructor(
        message = "Specified service location does not belong to the specified customer.",
    ) {
        super(message);
        this.name = "AssetLocationCustomerMismatchError";
    }
}

export class AssetLocationRequiresCustomerError extends Error {
    readonly code = "ASSET_LOCATION_REQUIRES_CUSTOMER";
    readonly statusCode = 422;
    readonly httpStatus = 422;

    constructor(
        message = "A service location cannot be assigned to an unassigned depot asset without a customer.",
    ) {
        super(message);
        this.name = "AssetLocationRequiresCustomerError";
    }
}


export class AssetInvalidStatusTransitionError extends Error {
    readonly code = "ASSET_INVALID_STATUS_TRANSITION";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "The requested asset status transition is not permitted by the lifecycle state machine.",
    ) {
        super(message);
        this.name = "AssetInvalidStatusTransitionError";
    }
}

export class AssetMissingStatusReasonError extends Error {
    readonly code = "ASSET_MISSING_STATUS_REASON";
    readonly statusCode = 422;
    readonly httpStatus = 422;

    constructor(
        message = "Status reason is required for this status transition.",
    ) {
        super(message);
        this.name = "AssetMissingStatusReasonError";
    }
}

export class AssetMissingTransferReasonError extends Error {
    readonly code = "ASSET_MISSING_TRANSFER_REASON";
    readonly statusCode = 422;
    readonly httpStatus = 422;

    constructor(
        message = "Transfer reason is required when moving location or transferring ownership.",
    ) {
        super(message);
        this.name = "AssetMissingTransferReasonError";
    }
}

export class AssetImmutableError extends Error {
    readonly code = "ASSET_IMMUTABLE";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "Asset is in a terminal state (RETIRED) and cannot be modified.",
    ) {
        super(message);
        this.name = "AssetImmutableError";
    }
}

export class AssetNumberLockedError extends Error {
    readonly code = "ASSET_NUMBER_LOCKED";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "Asset number cannot be modified once historical work orders exist.",
    ) {
        super(message);
        this.name = "AssetNumberLockedError";
    }
}

export class AssetDecommissionedTransferError extends Error {
    readonly code = "ASSET_DECOMMISSIONED_TRANSFER";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "Decommissioned equipment cannot be transferred to a new location or customer without first being reactivated.",
    ) {
        super(message);
        this.name = "AssetDecommissionedTransferError";
    }
}

export class AssetDeletionNotAllowedError extends Error {
    readonly code = "ASSET_DELETION_NOT_ALLOWED";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "Asset deletion is not permitted. Only unreferenced assets with no historical work orders can be deleted.",
    ) {
        super(message);
        this.name = "AssetDeletionNotAllowedError";
    }
}

export class DuplicateAssetNumberError extends Error {
    readonly code = "DUPLICATE_ASSET_NUMBER";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "An asset with this asset number already exists in this workspace.",
    ) {
        super(message);
        this.name = "DuplicateAssetNumberError";
    }
}
