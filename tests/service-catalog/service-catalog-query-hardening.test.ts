import { describe, expect, it } from "vitest";
import { serviceCatalogQuerySchema } from "@/lib/validations/serviceCatalog";

describe("Phase 1.5.10 — ServiceCatalog Query Schema Hardening", () => {
    describe("1. Pagination Boundaries", () => {
        it("accepts valid page and pageSize values", () => {
            const parsed = serviceCatalogQuerySchema.parse({ page: 2, pageSize: 50 });
            expect(parsed.page).toBe(2);
            expect(parsed.pageSize).toBe(50);
        });

        it("defaults page=1 and pageSize=20 when omitted", () => {
            const parsed = serviceCatalogQuerySchema.parse({});
            expect(parsed.page).toBe(1);
            expect(parsed.pageSize).toBe(20);
        });

        it("rejects page < 1", () => {
            expect(() => serviceCatalogQuerySchema.parse({ page: 0 })).toThrow();
            expect(() => serviceCatalogQuerySchema.parse({ page: -5 })).toThrow();
        });

        it("rejects pageSize < 1", () => {
            expect(() => serviceCatalogQuerySchema.parse({ pageSize: 0 })).toThrow();
            expect(() => serviceCatalogQuerySchema.parse({ pageSize: -10 })).toThrow();
        });

        it("rejects unbounded pageSize > 100", () => {
            expect(() => serviceCatalogQuerySchema.parse({ pageSize: 101 })).toThrow();
            expect(() => serviceCatalogQuerySchema.parse({ pageSize: 999999 })).toThrow();
        });
    });

    describe("2. Sort Field Whitelisting", () => {
        it("accepts explicitly whitelisted sort fields", () => {
            for (const field of ["name", "status", "sortOrder", "createdAt", "updatedAt"]) {
                const parsed = serviceCatalogQuerySchema.parse({ sortBy: field, sortOrder: "desc" });
                expect(parsed.sortBy).toBe(field);
                expect(parsed.sortOrder).toBe("desc");
            }
        });

        it("rejects arbitrary database column names for sortBy", () => {
            expect(() => serviceCatalogQuerySchema.parse({ sortBy: "passwordHash" })).toThrow();
            expect(() => serviceCatalogQuerySchema.parse({ sortBy: "workspaceId" })).toThrow();
            expect(() => serviceCatalogQuerySchema.parse({ sortBy: "id" })).toThrow();
            expect(() => serviceCatalogQuerySchema.parse({ sortBy: "SELECT 1" })).toThrow();
        });

        it("rejects invalid sortOrder values", () => {
            expect(() => serviceCatalogQuerySchema.parse({ sortOrder: "ascending" })).toThrow();
            expect(() => serviceCatalogQuerySchema.parse({ sortOrder: "none" })).toThrow();
        });
    });

    describe("3. Search & Status Filtering", () => {
        it("accepts search string within 100 characters", () => {
            const parsed = serviceCatalogQuerySchema.parse({ search: "electrical installation" });
            expect(parsed.search).toBe("electrical installation");
        });

        it("rejects search string > 100 characters", () => {
            const longSearch = "a".repeat(101);
            expect(() => serviceCatalogQuerySchema.parse({ search: longSearch })).toThrow();
        });

        it("accepts valid status values (ACTIVE, INACTIVE)", () => {
            expect(serviceCatalogQuerySchema.parse({ status: "ACTIVE" }).status).toBe("ACTIVE");
            expect(serviceCatalogQuerySchema.parse({ status: "INACTIVE" }).status).toBe("INACTIVE");
        });

        it("rejects invalid status values", () => {
            expect(() => serviceCatalogQuerySchema.parse({ status: "DELETED" })).toThrow();
            expect(() => serviceCatalogQuerySchema.parse({ status: "PENDING" })).toThrow();
        });
    });
});
