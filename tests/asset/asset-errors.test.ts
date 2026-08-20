import { describe, expect, it } from "vitest";
import {
    AssetNotFoundError,
    AssetCustomerNotFoundError,
    AssetCustomerInactiveError,
    AssetLocationNotFoundError,
    AssetLocationCustomerMismatchError,
    AssetLocationRequiresCustomerError,
    AssetCategoryNotFoundError,
    AssetInvalidStatusTransitionError,
    AssetMissingStatusReasonError,
    AssetMissingTransferReasonError,
    AssetImmutableError,
    AssetNumberLockedError,
    AssetDecommissionedTransferError,
    AssetDeletionNotAllowedError,
    DuplicateAssetNumberError,
} from "@/lib/services/asset/assetErrors";

import {
    AssetCategoryNotFoundError as CatNotFoundError,
    AssetCategoryAlreadyExistsError,
    AssetCategoryInactiveError,
    AssetCategoryDeletionNotAllowedError,
} from "@/lib/services/assetCategory/assetCategoryErrors";

describe("Phase 1.7.3 — Asset & AssetCategory Domain Errors Taxonomy", () => {
    describe("1. Asset Error Classes", () => {
        it("AssetNotFoundError maps to ASSET_NOT_FOUND (404)", () => {
            const err = new AssetNotFoundError("Asset ast_123 not found");
            expect(err.name).toBe("AssetNotFoundError");
            expect(err.code).toBe("ASSET_NOT_FOUND");
            expect(err.statusCode).toBe(404);
            expect(err.httpStatus).toBe(404);
            expect(err.message).toBe("Asset ast_123 not found");
        });

        it("AssetCustomerNotFoundError maps to ASSET_CUSTOMER_NOT_FOUND (404)", () => {
            const err = new AssetCustomerNotFoundError();
            expect(err.name).toBe("AssetCustomerNotFoundError");
            expect(err.code).toBe("ASSET_CUSTOMER_NOT_FOUND");
            expect(err.statusCode).toBe(404);
            expect(err.httpStatus).toBe(404);
        });

        it("AssetCustomerInactiveError maps to ASSET_CUSTOMER_INACTIVE (400)", () => {
            const err = new AssetCustomerInactiveError();
            expect(err.name).toBe("AssetCustomerInactiveError");
            expect(err.code).toBe("ASSET_CUSTOMER_INACTIVE");
            expect(err.statusCode).toBe(400);
            expect(err.httpStatus).toBe(400);
        });

        it("AssetLocationNotFoundError maps to ASSET_LOCATION_NOT_FOUND (404)", () => {
            const err = new AssetLocationNotFoundError();
            expect(err.name).toBe("AssetLocationNotFoundError");
            expect(err.code).toBe("ASSET_LOCATION_NOT_FOUND");
            expect(err.statusCode).toBe(404);
            expect(err.httpStatus).toBe(404);
        });

        it("AssetLocationCustomerMismatchError maps to ASSET_LOCATION_CUSTOMER_MISMATCH (422)", () => {
            const err = new AssetLocationCustomerMismatchError();
            expect(err.name).toBe("AssetLocationCustomerMismatchError");
            expect(err.code).toBe("ASSET_LOCATION_CUSTOMER_MISMATCH");
            expect(err.statusCode).toBe(422);
            expect(err.httpStatus).toBe(422);
        });

        it("AssetLocationRequiresCustomerError maps to ASSET_LOCATION_REQUIRES_CUSTOMER (422)", () => {
            const err = new AssetLocationRequiresCustomerError();
            expect(err.name).toBe("AssetLocationRequiresCustomerError");
            expect(err.code).toBe("ASSET_LOCATION_REQUIRES_CUSTOMER");
            expect(err.statusCode).toBe(422);
            expect(err.httpStatus).toBe(422);
        });

        it("AssetCategoryNotFoundError maps to ASSET_CATEGORY_NOT_FOUND (404) and is referentially identical to CatNotFoundError", () => {
            const err = new AssetCategoryNotFoundError();
            expect(err.name).toBe("AssetCategoryNotFoundError");
            expect(err.code).toBe("ASSET_CATEGORY_NOT_FOUND");
            expect(err.statusCode).toBe(404);
            expect(err.httpStatus).toBe(404);
            // Confirm single canonical class definition (re-export without duplication)
            expect(AssetCategoryNotFoundError).toBe(CatNotFoundError);
            expect(err instanceof CatNotFoundError).toBe(true);
        });

        it("AssetInvalidStatusTransitionError maps to ASSET_INVALID_STATUS_TRANSITION (409)", () => {
            const err = new AssetInvalidStatusTransitionError();
            expect(err.name).toBe("AssetInvalidStatusTransitionError");
            expect(err.code).toBe("ASSET_INVALID_STATUS_TRANSITION");
            expect(err.statusCode).toBe(409);
            expect(err.httpStatus).toBe(409);
        });

        it("AssetMissingStatusReasonError maps to ASSET_MISSING_STATUS_REASON (422)", () => {
            const err = new AssetMissingStatusReasonError();
            expect(err.name).toBe("AssetMissingStatusReasonError");
            expect(err.code).toBe("ASSET_MISSING_STATUS_REASON");
            expect(err.statusCode).toBe(422);
            expect(err.httpStatus).toBe(422);
        });

        it("AssetMissingTransferReasonError maps to ASSET_MISSING_TRANSFER_REASON (422)", () => {
            const err = new AssetMissingTransferReasonError();
            expect(err.name).toBe("AssetMissingTransferReasonError");
            expect(err.code).toBe("ASSET_MISSING_TRANSFER_REASON");
            expect(err.statusCode).toBe(422);
            expect(err.httpStatus).toBe(422);
        });

        it("AssetImmutableError maps to ASSET_IMMUTABLE (409)", () => {
            const err = new AssetImmutableError();
            expect(err.name).toBe("AssetImmutableError");
            expect(err.code).toBe("ASSET_IMMUTABLE");
            expect(err.statusCode).toBe(409);
            expect(err.httpStatus).toBe(409);
        });

        it("AssetNumberLockedError maps to ASSET_NUMBER_LOCKED (409)", () => {
            const err = new AssetNumberLockedError();
            expect(err.name).toBe("AssetNumberLockedError");
            expect(err.code).toBe("ASSET_NUMBER_LOCKED");
            expect(err.statusCode).toBe(409);
            expect(err.httpStatus).toBe(409);
        });

        it("AssetDecommissionedTransferError maps to ASSET_DECOMMISSIONED_TRANSFER (409)", () => {
            const err = new AssetDecommissionedTransferError();
            expect(err.name).toBe("AssetDecommissionedTransferError");
            expect(err.code).toBe("ASSET_DECOMMISSIONED_TRANSFER");
            expect(err.statusCode).toBe(409);
            expect(err.httpStatus).toBe(409);
        });

        it("AssetDeletionNotAllowedError maps to ASSET_DELETION_NOT_ALLOWED (409)", () => {
            const err = new AssetDeletionNotAllowedError();
            expect(err.name).toBe("AssetDeletionNotAllowedError");
            expect(err.code).toBe("ASSET_DELETION_NOT_ALLOWED");
            expect(err.statusCode).toBe(409);
            expect(err.httpStatus).toBe(409);
        });

        it("DuplicateAssetNumberError maps to DUPLICATE_ASSET_NUMBER (409)", () => {
            const err = new DuplicateAssetNumberError();
            expect(err.name).toBe("DuplicateAssetNumberError");
            expect(err.code).toBe("DUPLICATE_ASSET_NUMBER");
            expect(err.statusCode).toBe(409);
            expect(err.httpStatus).toBe(409);
        });
    });

    describe("2. AssetCategory Error Classes", () => {
        it("CatNotFoundError maps to ASSET_CATEGORY_NOT_FOUND (404)", () => {
            const err = new CatNotFoundError();
            expect(err.name).toBe("AssetCategoryNotFoundError");
            expect(err.code).toBe("ASSET_CATEGORY_NOT_FOUND");
            expect(err.statusCode).toBe(404);
            expect(err.httpStatus).toBe(404);
        });

        it("AssetCategoryAlreadyExistsError maps to ASSET_CATEGORY_ALREADY_EXISTS (409)", () => {
            const err = new AssetCategoryAlreadyExistsError();
            expect(err.name).toBe("AssetCategoryAlreadyExistsError");
            expect(err.code).toBe("ASSET_CATEGORY_ALREADY_EXISTS");
            expect(err.statusCode).toBe(409);
            expect(err.httpStatus).toBe(409);
        });

        it("AssetCategoryInactiveError maps to ASSET_CATEGORY_INACTIVE (400)", () => {
            const err = new AssetCategoryInactiveError();
            expect(err.name).toBe("AssetCategoryInactiveError");
            expect(err.code).toBe("ASSET_CATEGORY_INACTIVE");
            expect(err.statusCode).toBe(400);
            expect(err.httpStatus).toBe(400);
        });

        it("AssetCategoryDeletionNotAllowedError maps to ASSET_CATEGORY_DELETION_NOT_ALLOWED (409)", () => {
            const err = new AssetCategoryDeletionNotAllowedError();
            expect(err.name).toBe("AssetCategoryDeletionNotAllowedError");
            expect(err.code).toBe("ASSET_CATEGORY_DELETION_NOT_ALLOWED");
            expect(err.statusCode).toBe(409);
            expect(err.httpStatus).toBe(409);
        });
    });
});
