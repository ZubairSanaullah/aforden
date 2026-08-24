import { describe, expect, it } from "vitest";
import {
    createInventoryLocationSchema,
    updateInventoryLocationSchema,
    transitionInventoryLocationStatusSchema,
    getInventoryLocationsQuerySchema,
} from "@/lib/services/inventory/inventoryLocation/inventoryLocation.schemas";
import {
    InventoryLocationNotFoundError,
    InventoryLocationInactiveError,
    DuplicateInventoryLocationError,
    InventoryLocationDeletionNotAllowedError,
    TechnicianStockLocationAlreadyExistsError,
} from "@/lib/services/inventory/inventoryLocation/inventoryLocationErrors";
import {
    InventoryLocationStatus,
    InventoryLocationType,
} from "@/generated/prisma/client";

describe("Phase 1.10.5 — InventoryLocation Validation Schemas & Errors", () => {
    describe("createInventoryLocationSchema", () => {
        it("accepts valid warehouse payload", () => {
            const result = createInventoryLocationSchema.parse({
                name: "Main Warehouse",
                code: "WH-01",
                locationType: InventoryLocationType.WAREHOUSE,
                addressLine1: "123 Industrial Pkwy",
                city: "Austin",
                state: "TX",
                postalCode: "78701",
                country: "USA",
                notes: "Primary distribution center",
            });

            expect(result.name).toBe("Main Warehouse");
            expect(result.code).toBe("WH-01");
            expect(result.locationType).toBe(InventoryLocationType.WAREHOUSE);
            expect(result.technicianProfileId).toBeNull();
            expect(result.addressLine1).toBe("123 Industrial Pkwy");
            expect(result.city).toBe("Austin");
            expect(result.notes).toBe("Primary distribution center");
        });

        it("applies defaults for locationType and transforms null/empty fields", () => {
            const result = createInventoryLocationSchema.parse({
                name: "Storage Depot B",
            });

            expect(result.name).toBe("Storage Depot B");
            expect(result.locationType).toBe(InventoryLocationType.WAREHOUSE);
            expect(result.code).toBeNull();
            expect(result.technicianProfileId).toBeNull();
            expect(result.addressLine1).toBeNull();
            expect(result.notes).toBeNull();
        });

        it("transforms whitespace strings to null", () => {
            const result = createInventoryLocationSchema.parse({
                name: "Job Site Beta",
                code: "   ",
                notes: "",
            });

            expect(result.code).toBeNull();
            expect(result.notes).toBeNull();
        });

        it("rejects empty or whitespace-only name", () => {
            expect(() =>
                createInventoryLocationSchema.parse({
                    name: "   ",
                }),
            ).toThrow();
        });

        it("rejects name longer than 100 characters", () => {
            expect(() =>
                createInventoryLocationSchema.parse({
                    name: "A".repeat(101),
                }),
            ).toThrow();
        });

        it("rejects code longer than 20 characters", () => {
            expect(() =>
                createInventoryLocationSchema.parse({
                    name: "Valid Location",
                    code: "C".repeat(21),
                }),
            ).toThrow();
        });

        it("enforces TECHNICIAN_STOCK cross-field invariant: requires technicianProfileId when type is TECHNICIAN_STOCK", () => {
            expect(() =>
                createInventoryLocationSchema.parse({
                    name: "Van 12 Stock",
                    locationType: InventoryLocationType.TECHNICIAN_STOCK,
                }),
            ).toThrow(/technicianProfileId is required/);

            const valid = createInventoryLocationSchema.parse({
                name: "Van 12 Stock",
                locationType: InventoryLocationType.TECHNICIAN_STOCK,
                technicianProfileId: "tech_profile_123",
            });
            expect(valid.technicianProfileId).toBe("tech_profile_123");
        });

        it("enforces TECHNICIAN_STOCK cross-field invariant: forbids technicianProfileId when type is NOT TECHNICIAN_STOCK", () => {
            expect(() =>
                createInventoryLocationSchema.parse({
                    name: "Warehouse North",
                    locationType: InventoryLocationType.WAREHOUSE,
                    technicianProfileId: "tech_profile_123",
                }),
            ).toThrow(/technicianProfileId can only be set when locationType is TECHNICIAN_STOCK/);
        });
    });

    describe("updateInventoryLocationSchema", () => {
        it("accepts valid partial update", () => {
            const result = updateInventoryLocationSchema.parse({
                name: "Renamed Warehouse",
                code: "WH-01-NEW",
            });

            expect(result.name).toBe("Renamed Warehouse");
            expect(result.code).toBe("WH-01-NEW");
        });

        it("strictly rejects status mutations via updateInventoryLocationSchema", () => {
            expect(() =>
                updateInventoryLocationSchema.parse({
                    name: "Updated Name",
                    status: InventoryLocationStatus.INACTIVE,
                }),
            ).toThrow();
        });

        it("rejects null technicianProfileId when locationType is TECHNICIAN_STOCK", () => {
            expect(() =>
                updateInventoryLocationSchema.parse({
                    locationType: InventoryLocationType.TECHNICIAN_STOCK,
                    technicianProfileId: null,
                }),
            ).toThrow(/technicianProfileId cannot be null/);
        });

        it("rejects technicianProfileId when locationType is explicitly updated to WAREHOUSE", () => {
            expect(() =>
                updateInventoryLocationSchema.parse({
                    locationType: InventoryLocationType.WAREHOUSE,
                    technicianProfileId: "tech_profile_123",
                }),
            ).toThrow(/technicianProfileId can only be set when locationType is TECHNICIAN_STOCK/);
        });
    });

    describe("transitionInventoryLocationStatusSchema", () => {
        it("accepts valid status transition", () => {
            const result = transitionInventoryLocationStatusSchema.parse({
                status: InventoryLocationStatus.INACTIVE,
            });

            expect(result.status).toBe(InventoryLocationStatus.INACTIVE);
        });

        it("rejects invalid status enum", () => {
            expect(() =>
                transitionInventoryLocationStatusSchema.parse({
                    status: "INVALID_STATUS",
                }),
            ).toThrow();
        });
    });

    describe("getInventoryLocationsQuerySchema", () => {
        it("applies default pagination and sorting", () => {
            const result = getInventoryLocationsQuerySchema.parse({});
            expect(result.page).toBe(1);
            expect(result.pageSize).toBe(20);
            expect(result.sortBy).toBe("name");
            expect(result.sortOrder).toBe("asc");
        });

        it("parses query parameters with type coercions", () => {
            const result = getInventoryLocationsQuerySchema.parse({
                page: "3",
                pageSize: "15",
                search: "Central",
                status: "ACTIVE",
                locationType: "VEHICLE",
                technicianProfileId: "tech_123",
                sortBy: "createdAt",
                sortOrder: "desc",
            });

            expect(result.page).toBe(3);
            expect(result.pageSize).toBe(15);
            expect(result.search).toBe("Central");
            expect(result.status).toBe(InventoryLocationStatus.ACTIVE);
            expect(result.locationType).toBe(InventoryLocationType.VEHICLE);
            expect(result.technicianProfileId).toBe("tech_123");
            expect(result.sortBy).toBe("createdAt");
            expect(result.sortOrder).toBe("desc");
        });
    });

    describe("InventoryLocation Error Classes (Convention B)", () => {
        it("verifies error taxonomy metadata", () => {
            const notFound = new InventoryLocationNotFoundError();
            expect(notFound.code).toBe("INVENTORY_LOCATION_NOT_FOUND");
            expect(notFound.statusCode).toBe(404);
            expect(notFound.httpStatus).toBe(404);

            const inactive = new InventoryLocationInactiveError();
            expect(inactive.code).toBe("INVENTORY_LOCATION_INACTIVE");
            expect(inactive.statusCode).toBe(409);

            const duplicate = new DuplicateInventoryLocationError();
            expect(duplicate.code).toBe("DUPLICATE_INVENTORY_LOCATION");
            expect(duplicate.statusCode).toBe(409);

            const noDelete = new InventoryLocationDeletionNotAllowedError();
            expect(noDelete.code).toBe("INVENTORY_LOCATION_DELETION_NOT_ALLOWED");
            expect(noDelete.statusCode).toBe(409);

            const techExists = new TechnicianStockLocationAlreadyExistsError();
            expect(techExists.code).toBe("TECHNICIAN_STOCK_LOCATION_ALREADY_EXISTS");
            expect(techExists.statusCode).toBe(409);
        });
    });
});
