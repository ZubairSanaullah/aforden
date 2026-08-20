import { describe, expect, it } from "vitest";
import { workTypeQuerySchema } from "@/lib/validations/workType";

describe("Phase 1.5.10 — WorkType Query Schema Hardening", () => {
    describe("1. Pagination Boundaries", () => {
        it("accepts valid page and pageSize values", () => {
            const parsed = workTypeQuerySchema.parse({ page: 3, pageSize: 25 });
            expect(parsed.page).toBe(3);
            expect(parsed.pageSize).toBe(25);
        });

        it("defaults page=1 and pageSize=20 when omitted", () => {
            const parsed = workTypeQuerySchema.parse({});
            expect(parsed.page).toBe(1);
            expect(parsed.pageSize).toBe(20);
        });

        it("rejects page < 1", () => {
            expect(() => workTypeQuerySchema.parse({ page: 0 })).toThrow();
            expect(() => workTypeQuerySchema.parse({ page: -1 })).toThrow();
        });

        it("rejects pageSize < 1", () => {
            expect(() => workTypeQuerySchema.parse({ pageSize: 0 })).toThrow();
            expect(() => workTypeQuerySchema.parse({ pageSize: -5 })).toThrow();
        });

        it("rejects unbounded pageSize > 100", () => {
            expect(() => workTypeQuerySchema.parse({ pageSize: 101 })).toThrow();
            expect(() => workTypeQuerySchema.parse({ pageSize: 5000 })).toThrow();
        });
    });

    describe("2. Sort Field Whitelisting", () => {
        it("accepts explicitly whitelisted sort fields", () => {
            for (const field of [
                "name",
                "code",
                "estimatedDuration",
                "status",
                "sortOrder",
                "createdAt",
                "updatedAt",
            ]) {
                const parsed = workTypeQuerySchema.parse({ sortBy: field, sortOrder: "desc" });
                expect(parsed.sortBy).toBe(field);
                expect(parsed.sortOrder).toBe("desc");
            }
        });

        it("rejects arbitrary database column names for sortBy", () => {
            expect(() => workTypeQuerySchema.parse({ sortBy: "catalogId" })).toThrow();
            expect(() => workTypeQuerySchema.parse({ sortBy: "workspaceId" })).toThrow();
            expect(() => workTypeQuerySchema.parse({ sortBy: "id" })).toThrow();
            expect(() => workTypeQuerySchema.parse({ sortBy: "DROP TABLE" })).toThrow();
        });

        it("rejects invalid sortOrder values", () => {
            expect(() => workTypeQuerySchema.parse({ sortOrder: "ascend" })).toThrow();
        });
    });

    describe("3. Filter Validations", () => {
        it("accepts search string within 100 characters", () => {
            const parsed = workTypeQuerySchema.parse({ search: "hvac compressor" });
            expect(parsed.search).toBe("hvac compressor");
        });

        it("rejects search string > 100 characters", () => {
            const longSearch = "a".repeat(101);
            expect(() => workTypeQuerySchema.parse({ search: longSearch })).toThrow();
        });

        it("accepts valid status values (ACTIVE, INACTIVE)", () => {
            expect(workTypeQuerySchema.parse({ status: "ACTIVE" }).status).toBe("ACTIVE");
            expect(workTypeQuerySchema.parse({ status: "INACTIVE" }).status).toBe("INACTIVE");
        });

        it("rejects invalid status values", () => {
            expect(() => workTypeQuerySchema.parse({ status: "ARCHIVED" })).toThrow();
        });

        it("accepts valid catalogId filter and trims whitespace", () => {
            const parsed = workTypeQuerySchema.parse({ catalogId: "  sc_123  " });
            expect(parsed.catalogId).toBe("sc_123");
        });

        it("rejects empty catalogId filter", () => {
            expect(() => workTypeQuerySchema.parse({ catalogId: "   " })).toThrow();
        });
    });
});
