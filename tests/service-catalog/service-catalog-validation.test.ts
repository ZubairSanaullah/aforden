import { describe, expect, it } from "vitest";
import {
    SERVICE_CATALOG_STATUSES,
    serviceCatalogStatusSchema,
    createServiceCatalogSchema,
    updateServiceCatalogSchema,
    updateServiceCatalogStatusSchema,
    changeServiceCatalogStatusSchema,
    serviceCatalogQuerySchema,
    getServiceCatalogsQuerySchema,
} from "@/lib/validations/serviceCatalog";

describe("Phase 1.5.3 — ServiceCatalog Validation Layer", () => {
    describe("ServiceCatalog Status Schema (`serviceCatalogStatusSchema`)", () => {
        it("accepts valid ServiceCatalogStatus values", () => {
            expect(serviceCatalogStatusSchema.parse("ACTIVE")).toBe("ACTIVE");
            expect(serviceCatalogStatusSchema.parse("INACTIVE")).toBe("INACTIVE");
        });

        it("rejects invalid status values", () => {
            expect(() => serviceCatalogStatusSchema.parse("PENDING")).toThrow();
            expect(() => serviceCatalogStatusSchema.parse("DELETED")).toThrow();
            expect(() => serviceCatalogStatusSchema.parse("ARCHIVED")).toThrow();
            expect(() => serviceCatalogStatusSchema.parse("")).toThrow();
            expect(() => serviceCatalogStatusSchema.parse(null)).toThrow();
            expect(() => serviceCatalogStatusSchema.parse(undefined)).toThrow();
        });

        it("exports the exact list of SERVICE_CATALOG_STATUSES", () => {
            expect(SERVICE_CATALOG_STATUSES).toEqual(["ACTIVE", "INACTIVE"]);
        });
    });

    describe("ServiceCatalog Create Schema (`createServiceCatalogSchema`)", () => {
        it("accepts a minimal valid payload with only required name", () => {
            const result = createServiceCatalogSchema.parse({
                name: "Residential HVAC",
            });

            expect(result.name).toBe("Residential HVAC");
            expect(result.sortOrder).toBe(0);
            expect(result.description).toBeUndefined();
        });

        it("accepts a full valid payload with all fields populated", () => {
            const input = {
                name: "Commercial Refrigeration",
                description: "Comprehensive installation and maintenance for commercial refrigeration systems.",
                sortOrder: 5,
            };

            const result = createServiceCatalogSchema.parse(input);

            expect(result.name).toBe("Commercial Refrigeration");
            expect(result.description).toBe("Comprehensive installation and maintenance for commercial refrigeration systems.");
            expect(result.sortOrder).toBe(5);
        });

        it("trims whitespace from name and description while preserving internal spacing", () => {
            const result = createServiceCatalogSchema.parse({
                name: "   Plumbing & Drainage Services   ",
                description: "   Full commercial line.   ",
            });

            expect(result.name).toBe("Plumbing & Drainage Services");
            expect(result.description).toBe("Full commercial line.");
        });

        it("allows explicit null for description", () => {
            const result = createServiceCatalogSchema.parse({
                name: "Electrical",
                description: null,
            });

            expect(result.name).toBe("Electrical");
            expect(result.description).toBeNull();
        });

        it("accepts exact 100-character name boundary", () => {
            const exact100 = "A".repeat(100);
            const result = createServiceCatalogSchema.parse({ name: exact100 });
            expect(result.name).toBe(exact100);
        });

        it("rejects name exceeding 100 characters", () => {
            const over100 = "A".repeat(101);
            expect(() => createServiceCatalogSchema.parse({ name: over100 })).toThrow(/less than 100 characters/);
        });

        it("rejects missing or undefined name", () => {
            expect(() => createServiceCatalogSchema.parse({})).toThrow();
            expect(() => createServiceCatalogSchema.parse({ name: undefined })).toThrow();
        });

        it("rejects empty or whitespace-only name", () => {
            expect(() => createServiceCatalogSchema.parse({ name: "" })).toThrow(/Catalog name must not be empty/);
            expect(() => createServiceCatalogSchema.parse({ name: "   " })).toThrow(/Catalog name must not be empty/);
        });

        it("accepts exact 2000-character description boundary", () => {
            const exact2000 = "D".repeat(2000);
            const result = createServiceCatalogSchema.parse({
                name: "HVAC",
                description: exact2000,
            });
            expect(result.description).toBe(exact2000);
        });

        it("rejects description exceeding 2000 characters", () => {
            const over2000 = "D".repeat(2001);
            expect(() =>
                createServiceCatalogSchema.parse({
                    name: "HVAC",
                    description: over2000,
                }),
            ).toThrow(/less than 2000 characters/);
        });

        it("accepts valid integer sortOrder (positive, zero, negative)", () => {
            expect(createServiceCatalogSchema.parse({ name: "HVAC", sortOrder: 0 }).sortOrder).toBe(0);
            expect(createServiceCatalogSchema.parse({ name: "HVAC", sortOrder: 10 }).sortOrder).toBe(10);
            expect(createServiceCatalogSchema.parse({ name: "HVAC", sortOrder: -5 }).sortOrder).toBe(-5);
        });

        it("rejects non-integer sortOrder (floats or strings)", () => {
            expect(() => createServiceCatalogSchema.parse({ name: "HVAC", sortOrder: 1.5 })).toThrow(/must be an integer/);
            expect(() => createServiceCatalogSchema.parse({ name: "HVAC", sortOrder: "10" as any })).toThrow();
        });

        it("strips client-injected system and lifecycle fields (`id`, `workspaceId`, `status`, `createdAt`, `updatedAt`)", () => {
            const result = createServiceCatalogSchema.parse({
                name: "HVAC",
                id: "injected_id",
                workspaceId: "injected_workspace",
                status: "INACTIVE",
                createdAt: new Date("2020-01-01"),
                updatedAt: new Date("2020-01-01"),
            } as any);

            expect((result as any).id).toBeUndefined();
            expect((result as any).workspaceId).toBeUndefined();
            expect((result as any).status).toBeUndefined();
            expect((result as any).createdAt).toBeUndefined();
            expect((result as any).updatedAt).toBeUndefined();
            expect(result.name).toBe("HVAC");
        });
    });

    describe("ServiceCatalog Update Schema (`updateServiceCatalogSchema`)", () => {
        it("accepts an empty update payload", () => {
            const result = updateServiceCatalogSchema.parse({});
            expect(result).toEqual({});
        });

        it("accepts a partial single-field update", () => {
            const result = updateServiceCatalogSchema.parse({
                name: "Updated Catalog Name",
            });
            expect(result).toEqual({
                name: "Updated Catalog Name",
            });
        });

        it("accepts multi-field updates", () => {
            const result = updateServiceCatalogSchema.parse({
                name: "HVAC & Energy",
                description: "New updated scope",
                sortOrder: 2,
            });
            expect(result).toEqual({
                name: "HVAC & Energy",
                description: "New updated scope",
                sortOrder: 2,
            });
        });

        it("supports clearing optional description with null", () => {
            const result = updateServiceCatalogSchema.parse({
                description: null,
            });
            expect(result.description).toBeNull();
        });

        it("rejects invalid update fields", () => {
            expect(() => updateServiceCatalogSchema.parse({ name: "" })).toThrow();
            expect(() => updateServiceCatalogSchema.parse({ name: "A".repeat(101) })).toThrow();
            expect(() => updateServiceCatalogSchema.parse({ description: "D".repeat(2001) })).toThrow();
            expect(() => updateServiceCatalogSchema.parse({ sortOrder: 3.14 })).toThrow();
        });

        it("strips client-injected system and lifecycle fields from update", () => {
            const result = updateServiceCatalogSchema.parse({
                name: "Renamed Catalog",
                id: "forbidden_id",
                workspaceId: "forbidden_workspace",
                status: "INACTIVE",
                createdAt: new Date(),
                updatedAt: new Date(),
            } as any);

            expect((result as any).id).toBeUndefined();
            expect((result as any).workspaceId).toBeUndefined();
            expect((result as any).status).toBeUndefined();
            expect((result as any).createdAt).toBeUndefined();
            expect((result as any).updatedAt).toBeUndefined();
            expect(result.name).toBe("Renamed Catalog");
        });
    });

    describe("ServiceCatalog Status Update Schema (`updateServiceCatalogStatusSchema` / `changeServiceCatalogStatusSchema`)", () => {
        it("accepts status update as an object `{ status: 'ACTIVE' }`", () => {
            const result = updateServiceCatalogStatusSchema.parse({ status: "ACTIVE" });
            expect(result).toEqual({ status: "ACTIVE" });
        });

        it("accepts status update as an object `{ status: 'INACTIVE' }`", () => {
            const result = updateServiceCatalogStatusSchema.parse({ status: "INACTIVE" });
            expect(result).toEqual({ status: "INACTIVE" });
        });

        it("accepts status update as a raw enum string and transforms to object", () => {
            const resActive = updateServiceCatalogStatusSchema.parse("ACTIVE");
            expect(resActive).toEqual({ status: "ACTIVE" });

            const resInactive = updateServiceCatalogStatusSchema.parse("INACTIVE");
            expect(resInactive).toEqual({ status: "INACTIVE" });
        });

        it("aliases changeServiceCatalogStatusSchema identically", () => {
            expect(changeServiceCatalogStatusSchema).toBe(updateServiceCatalogStatusSchema);
        });

        it("rejects invalid status mutations", () => {
            expect(() => updateServiceCatalogStatusSchema.parse({ status: "SUSPENDED" })).toThrow();
            expect(() => updateServiceCatalogStatusSchema.parse("ARCHIVED")).toThrow();
            expect(() => updateServiceCatalogStatusSchema.parse({})).toThrow();
        });
    });

    describe("ServiceCatalog Query Schema (`serviceCatalogQuerySchema` / `getServiceCatalogsQuerySchema`)", () => {
        it("applies query defaults when parsed with empty object", () => {
            const result = serviceCatalogQuerySchema.parse({});

            expect(result.page).toBe(1);
            expect(result.pageSize).toBe(20);
            expect(result.sortBy).toBe("sortOrder");
            expect(result.sortOrder).toBe("asc");
            expect(result.search).toBeUndefined();
            expect(result.status).toBeUndefined();
        });

        it("coerces string page and pageSize to numbers", () => {
            const result = serviceCatalogQuerySchema.parse({
                page: "2",
                pageSize: "50",
                search: "hvac",
                status: "ACTIVE",
                sortBy: "name",
                sortOrder: "desc",
            });

            expect(result.page).toBe(2);
            expect(result.pageSize).toBe(50);
            expect(result.search).toBe("hvac");
            expect(result.status).toBe("ACTIVE");
            expect(result.sortBy).toBe("name");
            expect(result.sortOrder).toBe("desc");
        });

        it("accepts all supported sortBy criteria", () => {
            const validSorts = ["name", "status", "sortOrder", "createdAt", "updatedAt"] as const;

            for (const sortBy of validSorts) {
                const res = serviceCatalogQuerySchema.parse({ sortBy });
                expect(res.sortBy).toBe(sortBy);
            }
        });

        it("rejects invalid sortBy value", () => {
            expect(() => serviceCatalogQuerySchema.parse({ sortBy: "unsupportedField" })).toThrow();
        });

        it("rejects invalid sortOrder value", () => {
            expect(() => serviceCatalogQuerySchema.parse({ sortOrder: "sideways" })).toThrow();
        });

        it("rejects page < 1", () => {
            expect(() => serviceCatalogQuerySchema.parse({ page: 0 })).toThrow(/Page must be at least 1/);
            expect(() => serviceCatalogQuerySchema.parse({ page: -1 })).toThrow(/Page must be at least 1/);
        });

        it("rejects pageSize out of bounds (< 1 or > 100)", () => {
            expect(() => serviceCatalogQuerySchema.parse({ pageSize: 0 })).toThrow(/Page size must be at least 1/);
            expect(() => serviceCatalogQuerySchema.parse({ pageSize: 101 })).toThrow(/Page size must not exceed 100/);
        });

        it("aliases getServiceCatalogsQuerySchema identically to serviceCatalogQuerySchema", () => {
            expect(getServiceCatalogsQuerySchema).toBe(serviceCatalogQuerySchema);
        });
    });
});
