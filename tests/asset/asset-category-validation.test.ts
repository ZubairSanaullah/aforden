import { describe, expect, it } from "vitest";
import {
    createAssetCategorySchema,
    updateAssetCategorySchema,
    getAssetCategoriesQuerySchema,
} from "@/lib/services/assetCategory/assetCategory.schemas";

describe("Phase 1.7.3 — AssetCategory Zod Validation Schemas", () => {
    describe("1. createAssetCategorySchema", () => {
        it("passes with valid complete category payload", () => {
            const valid = {
                name: "Commercial HVAC",
                code: "HVAC-COMM",
                description: "Commercial heating, ventilation, and air conditioning equipment",
                status: "ACTIVE",
                sortOrder: 1,
            };

            const parsed = createAssetCategorySchema.safeParse(valid);
            expect(parsed.success).toBe(true);
            if (parsed.success) {
                expect(parsed.data.name).toBe("Commercial HVAC");
                expect(parsed.data.code).toBe("HVAC-COMM");
                expect(parsed.data.status).toBe("ACTIVE");
                expect(parsed.data.sortOrder).toBe(1);
            }
        });

        it("passes with minimal category payload and applies defaults", () => {
            const minimal = {
                name: "Pumps & Hydraulics",
            };

            const parsed = createAssetCategorySchema.safeParse(minimal);
            expect(parsed.success).toBe(true);
            if (parsed.success) {
                expect(parsed.data.name).toBe("Pumps & Hydraulics");
                expect(parsed.data.status).toBe("ACTIVE");
                expect(parsed.data.sortOrder).toBe(0);
            }
        });

        it("fails when name is missing or empty", () => {
            expect(createAssetCategorySchema.safeParse({}).success).toBe(false);
            expect(createAssetCategorySchema.safeParse({ name: "   " }).success).toBe(false);
        });

        it("fails when name exceeds 100 characters", () => {
            const parsed = createAssetCategorySchema.safeParse({
                name: "a".repeat(101),
            });
            expect(parsed.success).toBe(false);
        });

        it("fails when code contains invalid special characters", () => {
            const parsed = createAssetCategorySchema.safeParse({
                name: "Generators",
                code: "GEN#1!",
            });
            expect(parsed.success).toBe(false);
            if (!parsed.success) {
                expect(parsed.error.issues[0].message).toContain("alphanumeric characters and hyphens");
            }
        });

        it("fails when code exceeds 20 characters", () => {
            const parsed = createAssetCategorySchema.safeParse({
                name: "Generators",
                code: "A".repeat(21),
            });
            expect(parsed.success).toBe(false);
        });

        it("fails when unknown keys are supplied (.strict rejection)", () => {
            const parsed = createAssetCategorySchema.safeParse({
                name: "Pumps",
                unknownKey: "value",
            });
            expect(parsed.success).toBe(false);
        });
    });

    describe("2. updateAssetCategorySchema", () => {
        it("passes with valid partial updates", () => {
            const parsed = updateAssetCategorySchema.safeParse({
                name: "Updated Category Name",
                sortOrder: 5,
                status: "INACTIVE",
            });
            expect(parsed.success).toBe(true);
        });

        it("fails when immutable fields are supplied (.strict rejection)", () => {
            expect(updateAssetCategorySchema.safeParse({ id: "cat_1" }).success).toBe(false);
            expect(updateAssetCategorySchema.safeParse({ workspaceId: "ws_1" }).success).toBe(false);
            expect(updateAssetCategorySchema.safeParse({ createdAt: new Date() }).success).toBe(false);
        });
    });

    describe("3. getAssetCategoriesQuerySchema", () => {
        it("applies default status ACTIVE, sortOrder 0, and page parameters", () => {
            const parsed = getAssetCategoriesQuerySchema.safeParse({});
            expect(parsed.success).toBe(true);
            if (parsed.success) {
                expect(parsed.data.status).toBe("ACTIVE");
                expect(parsed.data.page).toBe(1);
                expect(parsed.data.pageSize).toBe(50);
                expect(parsed.data.sortBy).toBe("sortOrder");
                expect(parsed.data.sortOrder).toBe("asc");
            }
        });

        it("accepts status filters ACTIVE, INACTIVE, and ALL", () => {
            expect(getAssetCategoriesQuerySchema.safeParse({ status: "ACTIVE" }).success).toBe(true);
            expect(getAssetCategoriesQuerySchema.safeParse({ status: "INACTIVE" }).success).toBe(true);
            expect(getAssetCategoriesQuerySchema.safeParse({ status: "ALL" }).success).toBe(true);
            expect(getAssetCategoriesQuerySchema.safeParse({ status: "INVALID_STATUS" }).success).toBe(false);
        });
    });
});
