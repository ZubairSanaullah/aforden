import { describe, expect, it } from "vitest";
import {
    createPartSchema,
    updatePartSchema,
    transitionPartStatusSchema,
    getPartsQuerySchema,
} from "@/lib/services/inventory/part/part.schemas";
import {
    PartNotFoundError,
    PartInactiveError,
    PartImmutableError,
    DuplicatePartSkuError,
    DuplicatePartNameError,
    PartDeletionNotAllowedError,
} from "@/lib/services/inventory/part/partErrors";
import { PartStatus, PartUnitOfMeasure } from "@/generated/prisma/client";

describe("Phase 1.10.4 — Part Validation Schemas & Errors", () => {
    describe("createPartSchema", () => {
        it("accepts valid full payload", () => {
            const result = createPartSchema.parse({
                name: "1/2 inch Copper Pipe",
                sku: "PIPE-CU-050",
                description: "Type L copper pipe 10ft",
                unitOfMeasure: PartUnitOfMeasure.FOOT,
                unitCost: 15.75,
                minimumStockLevel: 20,
            });

            expect(result.name).toBe("1/2 inch Copper Pipe");
            expect(result.sku).toBe("PIPE-CU-050");
            expect(result.description).toBe("Type L copper pipe 10ft");
            expect(result.unitOfMeasure).toBe(PartUnitOfMeasure.FOOT);
            expect(result.unitCost).toBe(15.75);
            expect(result.minimumStockLevel).toBe(20);
        });

        it("applies default values for unitOfMeasure and null transforms", () => {
            const result = createPartSchema.parse({
                name: "Standard Bolt",
            });

            expect(result.name).toBe("Standard Bolt");
            expect(result.unitOfMeasure).toBe(PartUnitOfMeasure.EACH);
            expect(result.sku).toBeNull();
            expect(result.description).toBeNull();
            expect(result.unitCost).toBeNull();
            expect(result.minimumStockLevel).toBeNull();
        });

        it("transforms empty string sku and description to null", () => {
            const result = createPartSchema.parse({
                name: "Capacitor 45uF",
                sku: "   ",
                description: "",
            });

            expect(result.sku).toBeNull();
            expect(result.description).toBeNull();
        });

        it("rejects empty or whitespace-only name", () => {
            expect(() =>
                createPartSchema.parse({
                    name: "   ",
                }),
            ).toThrow();
        });

        it("rejects name longer than 200 characters", () => {
            expect(() =>
                createPartSchema.parse({
                    name: "A".repeat(201),
                }),
            ).toThrow();
        });

        it("rejects sku longer than 50 characters", () => {
            expect(() =>
                createPartSchema.parse({
                    name: "Valid Name",
                    sku: "S".repeat(51),
                }),
            ).toThrow();
        });

        it("rejects negative unitCost and negative minimumStockLevel", () => {
            expect(() =>
                createPartSchema.parse({
                    name: "Valid Name",
                    unitCost: -5,
                }),
            ).toThrow();

            expect(() =>
                createPartSchema.parse({
                    name: "Valid Name",
                    minimumStockLevel: -1,
                }),
            ).toThrow();
        });
    });

    describe("updatePartSchema", () => {
        it("accepts valid partial update", () => {
            const result = updatePartSchema.parse({
                name: "Updated Name",
                unitCost: 19.99,
            });

            expect(result.name).toBe("Updated Name");
            expect(result.unitCost).toBe(19.99);
        });

        it("strictly rejects status mutations via updatePartSchema", () => {
            expect(() =>
                updatePartSchema.parse({
                    name: "Updated Name",
                    status: PartStatus.INACTIVE,
                }),
            ).toThrow();
        });
    });

    describe("transitionPartStatusSchema", () => {
        it("accepts valid status transition", () => {
            const result = transitionPartStatusSchema.parse({
                status: PartStatus.INACTIVE,
            });

            expect(result.status).toBe(PartStatus.INACTIVE);
        });

        it("rejects invalid status", () => {
            expect(() =>
                transitionPartStatusSchema.parse({
                    status: "INVALID_STATUS",
                }),
            ).toThrow();
        });
    });

    describe("getPartsQuerySchema", () => {
        it("applies pagination defaults", () => {
            const result = getPartsQuerySchema.parse({});
            expect(result.page).toBe(1);
            expect(result.pageSize).toBe(20);
            expect(result.sortBy).toBe("name");
            expect(result.sortOrder).toBe("asc");
        });

        it("parses coerced string queries", () => {
            const result = getPartsQuerySchema.parse({
                page: "2",
                pageSize: "50",
                search: "filter",
                status: "ACTIVE",
                unitOfMeasure: "BOX",
                sortBy: "unitCost",
                sortOrder: "desc",
            });

            expect(result.page).toBe(2);
            expect(result.pageSize).toBe(50);
            expect(result.search).toBe("filter");
            expect(result.status).toBe(PartStatus.ACTIVE);
            expect(result.unitOfMeasure).toBe(PartUnitOfMeasure.BOX);
            expect(result.sortBy).toBe("unitCost");
            expect(result.sortOrder).toBe("desc");
        });
    });

    describe("Part Error Classes (Convention B)", () => {
        it("verifies error taxonomy metadata", () => {
            const notFound = new PartNotFoundError();
            expect(notFound.code).toBe("PART_NOT_FOUND");
            expect(notFound.statusCode).toBe(404);
            expect(notFound.httpStatus).toBe(404);

            const inactive = new PartInactiveError();
            expect(inactive.code).toBe("PART_INACTIVE");
            expect(inactive.statusCode).toBe(409);

            const immutable = new PartImmutableError();
            expect(immutable.code).toBe("PART_IMMUTABLE");
            expect(immutable.statusCode).toBe(409);

            const dupSku = new DuplicatePartSkuError();
            expect(dupSku.code).toBe("DUPLICATE_PART_SKU");
            expect(dupSku.statusCode).toBe(409);

            const dupName = new DuplicatePartNameError();
            expect(dupName.code).toBe("DUPLICATE_PART_NAME");
            expect(dupName.statusCode).toBe(409);

            const noDelete = new PartDeletionNotAllowedError();
            expect(noDelete.code).toBe("PART_DELETION_NOT_ALLOWED");
            expect(noDelete.statusCode).toBe(409);
        });
    });
});
