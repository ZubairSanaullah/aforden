import { describe, expect, it } from "vitest";
import { z, ZodError } from "zod";

import { handleAssetPublicApiError } from "@/lib/publicApi/assets/assetErrorHandler";
import { handleCustomerPublicApiError } from "@/lib/publicApi/customers/customerErrorHandler";
import { handleInventoryPublicApiError } from "@/lib/publicApi/inventory/inventoryErrorHandler";
import { handleInvoicePublicApiError } from "@/lib/publicApi/invoices/invoiceErrorHandler";
import { handlePartPublicApiError } from "@/lib/publicApi/parts/partErrorHandler";
import { handleQuotePublicApiError } from "@/lib/publicApi/quotes/quoteErrorHandler";
import { handleSchedulePublicApiError } from "@/lib/publicApi/schedules/scheduleErrorHandler";
import { handleTechnicianPublicApiError } from "@/lib/publicApi/technicians/technicianErrorHandler";
import { handleWorkOrderPublicApiError } from "@/lib/publicApi/workOrders/workOrderErrorHandler";

// Domain Errors
import {
    AssetNotFoundError,
    AssetCustomerNotFoundError,
    AssetLocationNotFoundError,
    AssetCategoryNotFoundError,
    AssetLocationCustomerMismatchError,
    AssetLocationRequiresCustomerError,
    AssetCustomerInactiveError,
    AssetCategoryInactiveError,
    AssetImmutableError,
    AssetNumberLockedError,
    DuplicateAssetNumberError,
    AssetInvalidStatusTransitionError,
    AssetMissingStatusReasonError,
    AssetMissingTransferReasonError,
    AssetDecommissionedTransferError,
    AssetDeletionNotAllowedError,
} from "@/lib/services/asset/assetErrors";

import {
    CustomerNotFoundError,
    ServiceLocationNotFoundError,
    DuplicateCustomerNumberError,
    ServiceLocationPrimaryExistsError,
    InactiveCustomerError,
    InvalidCustomerError,
    CustomerDeletionNotAllowedError,
    CustomerHasProtectedReferencesError,
    ServiceLocationDeletionNotAllowedError,
} from "@/lib/services/customer/customerErrors";

import { PartNotFoundError, DuplicatePartSkuError, DuplicatePartNameError } from "@/lib/services/inventory/part/partErrors";
import { InventoryLocationNotFoundError } from "@/lib/services/inventory/inventoryLocation/inventoryLocationErrors";
import { InvoiceNotFoundError } from "@/lib/services/invoice/invoiceErrors";
import { QuoteNotFoundError } from "@/lib/services/quote/quoteErrors";

import {
    ScheduleAppointmentNotFoundError,
    ScheduleWorkOrderNotFoundError,
    ScheduleTechnicianNotFoundError,
    ScheduleWorkOrderNotAssignedError,
    ScheduleTechnicianMismatchError,
    ScheduleTechnicianConflictError,
} from "@/lib/services/schedule/scheduleErrors";

import {
    TechnicianProfileNotFoundError,
    TechnicianProfileAlreadyExistsError,
    InvalidEmployeeError,
} from "@/lib/services/technicianProfile/technicianProfileErrors";

import {
    WorkOrderNotFoundError,
    WorkOrderCustomerNotFoundError,
    WorkOrderCustomerInactiveError,
    WorkOrderLocationNotFoundError,
    WorkOrderAssetCustomerMismatchError,
    WorkOrderAssetLocationMismatchError,
    WorkOrderImmutableError,
    DuplicateWorkOrderReferenceError,
} from "@/lib/services/workOrder/workOrderErrors";
import {
    WorkTypeNotFoundError,
    WorkTypeUnavailableForWorkOrderError,
} from "@/lib/services/workType/workTypeErrors";

describe("Phase 1.21.2 — Public API Domain Error Handlers & RFC-7807 Mapping Completeness", () => {
    function createSampleZodError(): ZodError {
        const schema = z.object({ fieldA: z.string().min(5) });
        const result = schema.safeParse({ fieldA: "abc" });
        if (!result.success) {
            return result.error;
        }
        throw new Error("Expected Zod parse failure");
    }

    async function inspectResponse(res: Response) {
        const json = await res.json();
        return {
            status: res.status,
            codeHeader: res.headers.get("x-aforden-error-code"),
            body: json,
        };
    }

    describe("1. Asset Public API Error Handler (`handleAssetPublicApiError`)", () => {
        it("maps Zod validation error to 422 with details", async () => {
            const res = handleAssetPublicApiError(createSampleZodError(), "req_1");
            const { status, body } = await inspectResponse(res);
            expect(status).toBe(422);
            expect(body.error.code).toBe("VALIDATION_ERROR");
            expect(body.error.requestId).toBe("req_1");
        });

        it("maps NotFound errors to 404", async () => {
            const notFoundErrors = [
                new AssetNotFoundError(),
                new AssetCustomerNotFoundError(),
                new AssetLocationNotFoundError(),
                new AssetCategoryNotFoundError(),
            ];

            for (const err of notFoundErrors) {
                const res = handleAssetPublicApiError(err);
                const { status, body } = await inspectResponse(res);
                expect(status).toBe(404);
                expect(body.error.code).toBe("NOT_FOUND");
            }
        });

        it("maps mismatch and reason errors to 422 VALIDATION_ERROR", async () => {
            const valErrors = [
                new AssetLocationCustomerMismatchError(),
                new AssetLocationRequiresCustomerError(),
                new AssetMissingStatusReasonError(),
                new AssetMissingTransferReasonError(),
            ];

            for (const err of valErrors) {
                const res = handleAssetPublicApiError(err);
                const { status, body } = await inspectResponse(res);
                expect(status).toBe(422);
                expect(body.error.code).toBe("VALIDATION_ERROR");
            }
        });

        it("maps domain conflict and invariant errors to 409 CONFLICT", async () => {
            const conflictErrors = [
                new AssetCustomerInactiveError(),
                new AssetCategoryInactiveError(),
                new AssetImmutableError(),
                new AssetNumberLockedError(),
                new DuplicateAssetNumberError(),
                new AssetInvalidStatusTransitionError(),
                new AssetDecommissionedTransferError(),
                new AssetDeletionNotAllowedError(),
            ];

            for (const err of conflictErrors) {
                const res = handleAssetPublicApiError(err);
                const { status, body } = await inspectResponse(res);
                expect(status).toBe(409);
                expect(body.error.code).toBe("CONFLICT");
            }
        });

        it("re-throws unhandled errors for global 500 processing", () => {
            expect(() => handleAssetPublicApiError(new Error("Unexpected DB crash"))).toThrow(
                "Unexpected DB crash",
            );
        });
    });

    describe("2. Customer Public API Error Handler (`handleCustomerPublicApiError`)", () => {
        it("maps Zod validation error to 422", async () => {
            const res = handleCustomerPublicApiError(createSampleZodError());
            const { status, body } = await inspectResponse(res);
            expect(status).toBe(422);
            expect(body.error.code).toBe("VALIDATION_ERROR");
        });

        it("maps CustomerNotFoundError and ServiceLocationNotFoundError to 404", async () => {
            const res1 = handleCustomerPublicApiError(new CustomerNotFoundError());
            expect((await inspectResponse(res1)).status).toBe(404);

            const res2 = handleCustomerPublicApiError(new ServiceLocationNotFoundError());
            expect((await inspectResponse(res2)).status).toBe(404);
        });

        it("maps InvalidCustomerError to 422", async () => {
            const res = handleCustomerPublicApiError(new InvalidCustomerError("Invalid tax code"));
            const { status, body } = await inspectResponse(res);
            expect(status).toBe(422);
            expect(body.error.code).toBe("VALIDATION_ERROR");
        });

        it("maps customer conflicts and protected references to 409", async () => {
            const conflicts = [
                new DuplicateCustomerNumberError(),
                new ServiceLocationPrimaryExistsError(),
                new InactiveCustomerError(),
                new CustomerDeletionNotAllowedError(),
                new CustomerHasProtectedReferencesError(),
                new ServiceLocationDeletionNotAllowedError(),
            ];

            for (const err of conflicts) {
                const res = handleCustomerPublicApiError(err);
                const { status, body } = await inspectResponse(res);
                expect(status).toBe(409);
                expect(body.error.code).toBe("CONFLICT");
            }
        });

        it("re-throws unhandled errors", () => {
            expect(() => handleCustomerPublicApiError(new Error("Disk IO failed"))).toThrow();
        });
    });

    describe("3. Inventory & Parts Error Handlers", () => {
        it("handleInventoryPublicApiError maps PartNotFoundError and InventoryLocationNotFoundError to 404", async () => {
            const res1 = handleInventoryPublicApiError(new PartNotFoundError());
            expect((await inspectResponse(res1)).status).toBe(404);

            const res2 = handleInventoryPublicApiError(new InventoryLocationNotFoundError());
            expect((await inspectResponse(res2)).status).toBe(404);

            const res3 = handleInventoryPublicApiError(createSampleZodError());
            expect((await inspectResponse(res3)).status).toBe(422);

            expect(() => handleInventoryPublicApiError(new Error("Unhandled"))).toThrow();
        });

        it("handlePartPublicApiError maps part errors to canonical codes", async () => {
            const res1 = handlePartPublicApiError(new PartNotFoundError());
            expect((await inspectResponse(res1)).status).toBe(404);

            const res2 = handlePartPublicApiError(new DuplicatePartSkuError("SKU-1"));
            expect((await inspectResponse(res2)).status).toBe(409);

            const res3 = handlePartPublicApiError(new DuplicatePartNameError("Filter"));
            expect((await inspectResponse(res3)).status).toBe(409);

            const res4 = handlePartPublicApiError(createSampleZodError());
            expect((await inspectResponse(res4)).status).toBe(422);

            expect(() => handlePartPublicApiError(new Error("Unhandled"))).toThrow();
        });
    });

    describe("4. Invoice & Quote Error Handlers", () => {
        it("handleInvoicePublicApiError maps InvoiceNotFoundError and CustomerNotFoundError to 404", async () => {
            const res1 = handleInvoicePublicApiError(new InvoiceNotFoundError());
            expect((await inspectResponse(res1)).status).toBe(404);

            const res2 = handleInvoicePublicApiError(new CustomerNotFoundError());
            expect((await inspectResponse(res2)).status).toBe(404);

            const res3 = handleInvoicePublicApiError(createSampleZodError());
            expect((await inspectResponse(res3)).status).toBe(422);

            expect(() => handleInvoicePublicApiError(new Error("Unhandled"))).toThrow();
        });

        it("handleQuotePublicApiError maps QuoteNotFoundError and CustomerNotFoundError to 404", async () => {
            const res1 = handleQuotePublicApiError(new QuoteNotFoundError());
            expect((await inspectResponse(res1)).status).toBe(404);

            const res2 = handleQuotePublicApiError(new CustomerNotFoundError());
            expect((await inspectResponse(res2)).status).toBe(404);

            const res3 = handleQuotePublicApiError(createSampleZodError());
            expect((await inspectResponse(res3)).status).toBe(422);

            expect(() => handleQuotePublicApiError(new Error("Unhandled"))).toThrow();
        });
    });

    describe("5. Schedule Error Handler (`handleSchedulePublicApiError`)", () => {
        it("maps not found errors to 404", async () => {
            const errors = [
                new ScheduleAppointmentNotFoundError(),
                new ScheduleWorkOrderNotFoundError(),
                new ScheduleTechnicianNotFoundError(),
            ];

            for (const err of errors) {
                const res = handleSchedulePublicApiError(err);
                expect((await inspectResponse(res)).status).toBe(404);
            }
        });

        it("maps unassigned and technician mismatch to 422", async () => {
            const res1 = handleSchedulePublicApiError(new ScheduleWorkOrderNotAssignedError());
            expect((await inspectResponse(res1)).status).toBe(422);

            const res2 = handleSchedulePublicApiError(new ScheduleTechnicianMismatchError());
            expect((await inspectResponse(res2)).status).toBe(422);
        });

        it("maps technician schedule conflict to 409", async () => {
            const res = handleSchedulePublicApiError(new ScheduleTechnicianConflictError());
            expect((await inspectResponse(res)).status).toBe(409);
        });

        it("maps Zod error to 422 and rethrows unhandled", async () => {
            const res = handleSchedulePublicApiError(createSampleZodError());
            expect((await inspectResponse(res)).status).toBe(422);

            expect(() => handleSchedulePublicApiError(new Error("Unhandled"))).toThrow();
        });
    });

    describe("6. Technician Public API Error Handler (`handleTechnicianPublicApiError`)", () => {
        it("maps technician errors to canonical codes", async () => {
            const res1 = handleTechnicianPublicApiError(new TechnicianProfileNotFoundError());
            expect((await inspectResponse(res1)).status).toBe(404);

            const res2 = handleTechnicianPublicApiError(new InvalidEmployeeError());
            expect((await inspectResponse(res2)).status).toBe(404);

            const res3 = handleTechnicianPublicApiError(new TechnicianProfileAlreadyExistsError());
            expect((await inspectResponse(res3)).status).toBe(409);

            const res4 = handleTechnicianPublicApiError(createSampleZodError());
            expect((await inspectResponse(res4)).status).toBe(422);

            expect(() => handleTechnicianPublicApiError(new Error("Unhandled"))).toThrow();
        });
    });

    describe("7. WorkOrder Public API Error Handler (`handleWorkOrderPublicApiError`)", () => {
        it("maps not found errors to 404", async () => {
            const notFounds = [
                new WorkOrderNotFoundError(),
                new WorkOrderCustomerNotFoundError(),
                new WorkOrderLocationNotFoundError(),
                new WorkTypeNotFoundError(),
                new AssetNotFoundError(),
            ];

            for (const err of notFounds) {
                const res = handleWorkOrderPublicApiError(err);
                expect((await inspectResponse(res)).status).toBe(404);
            }
        });

        it("maps inactive customer and asset mismatches to 422", async () => {
            const valErrors = [
                new WorkOrderCustomerInactiveError(),
                new WorkTypeUnavailableForWorkOrderError(),
                new WorkOrderAssetCustomerMismatchError(),
                new WorkOrderAssetLocationMismatchError(),
            ];

            for (const err of valErrors) {
                const res = handleWorkOrderPublicApiError(err);
                expect((await inspectResponse(res)).status).toBe(422);
            }
        });

        it("maps immutable work order/asset and duplicate reference to 409", async () => {
            const conflicts = [
                new WorkOrderImmutableError(),
                new AssetImmutableError(),
                new DuplicateWorkOrderReferenceError(),
            ];

            for (const err of conflicts) {
                const res = handleWorkOrderPublicApiError(err);
                expect((await inspectResponse(res)).status).toBe(409);
            }
        });

        it("maps Zod error to 422 and rethrows unhandled", async () => {
            const res = handleWorkOrderPublicApiError(createSampleZodError());
            expect((await inspectResponse(res)).status).toBe(422);

            expect(() => handleWorkOrderPublicApiError(new Error("Unhandled"))).toThrow();
        });
    });
});
