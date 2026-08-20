/**
 * AssetCategory domain-specific application errors.
 *
 * Each error class defines its canonical error code string and HTTP status code
 * matching Phase 1.7.1 Section 14.
 */

export class AssetCategoryNotFoundError extends Error {
    readonly code = "ASSET_CATEGORY_NOT_FOUND";
    readonly statusCode = 404;
    readonly httpStatus = 404;

    constructor(message = "Asset category not found.") {
        super(message);
        this.name = "AssetCategoryNotFoundError";
    }
}

export class AssetCategoryAlreadyExistsError extends Error {
    readonly code = "ASSET_CATEGORY_ALREADY_EXISTS";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "An asset category with this name or code already exists in this workspace.",
    ) {
        super(message);
        this.name = "AssetCategoryAlreadyExistsError";
    }
}

export class AssetCategoryInactiveError extends Error {
    readonly code = "ASSET_CATEGORY_INACTIVE";
    readonly statusCode = 400;
    readonly httpStatus = 400;

    constructor(message = "Cannot assign an inactive category to an asset.") {
        super(message);
        this.name = "AssetCategoryInactiveError";
    }
}

export class AssetCategoryDeletionNotAllowedError extends Error {
    readonly code = "ASSET_CATEGORY_DELETION_NOT_ALLOWED";
    readonly statusCode = 409;
    readonly httpStatus = 409;

    constructor(
        message = "Cannot delete an asset category that is referenced by active equipment.",
    ) {
        super(message);
        this.name = "AssetCategoryDeletionNotAllowedError";
    }
}
