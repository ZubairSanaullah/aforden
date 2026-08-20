import { describe, expect, it } from "vitest";
import {
    WORK_TYPE_STATUSES,
    workTypeStatusSchema,
    workTypeCodeSchema,
    workTypeEstimatedDurationSchema,
    createWorkTypeSchema,
    updateWorkTypeSchema,
    updateWorkTypeStatusSchema,
    changeWorkTypeStatusSchema,
    workTypeQuerySchema,
    getWorkTypesQuerySchema,
} from "@/lib/validations/workType";

describe("Phase 1.5.3 — WorkType Validation Layer", () => {
    describe("WorkType Status Schema (`workTypeStatusSchema`)", () => {
        it("accepts valid WorkTypeStatus values", () => {
            expect(workTypeStatusSchema.parse("ACTIVE")).toBe("ACTIVE");
            expect(workTypeStatusSchema.parse("INACTIVE")).toBe("INACTIVE");
        });

        it("rejects invalid status values", () => {
            expect(() => workTypeStatusSchema.parse("PENDING")).toThrow();
            expect(() => workTypeStatusSchema.parse("DELETED")).toThrow();
            expect(() => workTypeStatusSchema.parse("ARCHIVED")).toThrow();
            expect(() => workTypeStatusSchema.parse("")).toThrow();
            expect(() => workTypeStatusSchema.parse(null)).toThrow();
            expect(() => workTypeStatusSchema.parse(undefined)).toThrow();
        });

        it("exports the exact list of WORK_TYPE_STATUSES", () => {
            expect(WORK_TYPE_STATUSES).toEqual(["ACTIVE", "INACTIVE"]);
        });
    });

    describe("WorkType Code Schema & Normalization (`workTypeCodeSchema`)", () => {
        it("normalizes lowercase alphanumeric code to uppercase", () => {
            expect(workTypeCodeSchema.parse("hvac-ac-01")).toBe("HVAC-AC-01");
            expect(workTypeCodeSchema.parse("elec_200amp_01")).toBe("ELEC_200AMP_01");
            expect(workTypeCodeSchema.parse("plumb-leak-rep")).toBe("PLUMB-LEAK-REP");
        });

        it("trims surrounding whitespace and converts to uppercase", () => {
            expect(workTypeCodeSchema.parse("   hvac-tune-01   ")).toBe("HVAC-TUNE-01");
        });

        it("normalizes empty string and whitespace-only string to null", () => {
            expect(workTypeCodeSchema.parse("")).toBeNull();
            expect(workTypeCodeSchema.parse("   ")).toBeNull();
        });

        it("accepts null and undefined", () => {
            expect(workTypeCodeSchema.parse(null)).toBeNull();
            expect(workTypeCodeSchema.parse(undefined)).toBeUndefined();
        });

        it("allows valid characters (letters, numbers, hyphens, underscores)", () => {
            expect(workTypeCodeSchema.parse("ABC-123_XYZ")).toBe("ABC-123_XYZ");
            expect(workTypeCodeSchema.parse("SERVICE-01")).toBe("SERVICE-01");
            expect(workTypeCodeSchema.parse("TUNE_UP")).toBe("TUNE_UP");
        });

        it("accepts exact 50-character code boundary", () => {
            const exact50 = "A".repeat(50);
            expect(workTypeCodeSchema.parse(exact50)).toBe(exact50);
        });

        it("rejects code exceeding 50 characters", () => {
            const over50 = "A".repeat(51);
            expect(() => workTypeCodeSchema.parse(over50)).toThrow(/less than 50 characters/);
        });

        it("rejects invalid characters (spaces, special characters, symbols)", () => {
            expect(() => workTypeCodeSchema.parse("HVAC 01")).toThrow(/may only contain letters, numbers, hyphens, and underscores/);
            expect(() => workTypeCodeSchema.parse("HVAC@01")).toThrow(/may only contain letters, numbers, hyphens, and underscores/);
            expect(() => workTypeCodeSchema.parse("HVAC.01")).toThrow(/may only contain letters, numbers, hyphens, and underscores/);
            expect(() => workTypeCodeSchema.parse("HVAC#01")).toThrow(/may only contain letters, numbers, hyphens, and underscores/);
            expect(() => workTypeCodeSchema.parse("HVAC/01")).toThrow(/may only contain letters, numbers, hyphens, and underscores/);
            expect(() => workTypeCodeSchema.parse("HVAC$01")).toThrow(/may only contain letters, numbers, hyphens, and underscores/);
        });
    });

    describe("WorkType Estimated Duration Schema (`workTypeEstimatedDurationSchema`)", () => {
        it("accepts valid durations at boundaries and intermediate values", () => {
            expect(workTypeEstimatedDurationSchema.parse(5)).toBe(5);
            expect(workTypeEstimatedDurationSchema.parse(30)).toBe(30);
            expect(workTypeEstimatedDurationSchema.parse(60)).toBe(60);
            expect(workTypeEstimatedDurationSchema.parse(120)).toBe(120);
            expect(workTypeEstimatedDurationSchema.parse(480)).toBe(480);
            expect(workTypeEstimatedDurationSchema.parse(1440)).toBe(1440);
        });

        it("accepts null and undefined for variable/unspecified durations", () => {
            expect(workTypeEstimatedDurationSchema.parse(null)).toBeNull();
            expect(workTypeEstimatedDurationSchema.parse(undefined)).toBeUndefined();
        });

        it("rejects duration below 5 minutes", () => {
            expect(() => workTypeEstimatedDurationSchema.parse(4)).toThrow(/at least 5 minutes/);
            expect(() => workTypeEstimatedDurationSchema.parse(1)).toThrow(/at least 5 minutes/);
            expect(() => workTypeEstimatedDurationSchema.parse(0)).toThrow(/at least 5 minutes/);
        });

        it("rejects negative durations", () => {
            expect(() => workTypeEstimatedDurationSchema.parse(-30)).toThrow(/at least 5 minutes/);
            expect(() => workTypeEstimatedDurationSchema.parse(-1)).toThrow(/at least 5 minutes/);
        });

        it("rejects duration exceeding 1440 minutes (24 hours)", () => {
            expect(() => workTypeEstimatedDurationSchema.parse(1441)).toThrow(/not exceed 1440 minutes/);
            expect(() => workTypeEstimatedDurationSchema.parse(2000)).toThrow(/not exceed 1440 minutes/);
        });

        it("rejects decimal/floating-point durations without silent rounding", () => {
            expect(() => workTypeEstimatedDurationSchema.parse(60.5)).toThrow(/must be an integer/);
            expect(() => workTypeEstimatedDurationSchema.parse(15.25)).toThrow(/must be an integer/);
            expect(() => workTypeEstimatedDurationSchema.parse(5.1)).toThrow(/must be an integer/);
        });

        it("rejects non-numeric values", () => {
            expect(() => workTypeEstimatedDurationSchema.parse("60" as any)).toThrow();
            expect(() => workTypeEstimatedDurationSchema.parse("one hour" as any)).toThrow();
        });
    });

    describe("WorkType Create Schema (`createWorkTypeSchema`)", () => {
        it("accepts a minimal valid payload with required catalogId and name", () => {
            const result = createWorkTypeSchema.parse({
                catalogId: "sc_cuid_123",
                name: "AC Diagnostic & Inspection",
            });

            expect(result.catalogId).toBe("sc_cuid_123");
            expect(result.name).toBe("AC Diagnostic & Inspection");
            expect(result.code).toBeUndefined();
            expect(result.description).toBeUndefined();
            expect(result.estimatedDuration).toBeUndefined();
            expect(result.sortOrder).toBe(0);
        });

        it("accepts a full valid payload with all fields populated and normalized", () => {
            const input = {
                catalogId: "sc_cuid_123",
                name: "Emergency Furnace Diagnostic",
                code: "hvac-furn-em",
                description: "Comprehensive 24/7 diagnostic of gas valve, igniter, and pressure switch.",
                estimatedDuration: 90,
                sortOrder: 2,
            };

            const result = createWorkTypeSchema.parse(input);

            expect(result.catalogId).toBe("sc_cuid_123");
            expect(result.name).toBe("Emergency Furnace Diagnostic");
            expect(result.code).toBe("HVAC-FURN-EM");
            expect(result.description).toBe("Comprehensive 24/7 diagnostic of gas valve, igniter, and pressure switch.");
            expect(result.estimatedDuration).toBe(90);
            expect(result.sortOrder).toBe(2);
        });

        it("trims surrounding whitespace from name and description while preserving internal spacing", () => {
            const result = createWorkTypeSchema.parse({
                catalogId: "  sc_cuid_123  ",
                name: "   AC Diagnostic & Inspection   ",
                description: "   Full electrical diagnostic.   ",
            });

            expect(result.catalogId).toBe("sc_cuid_123");
            expect(result.name).toBe("AC Diagnostic & Inspection");
            expect(result.description).toBe("Full electrical diagnostic.");
        });

        it("allows explicit null for optional nullable fields", () => {
            const result = createWorkTypeSchema.parse({
                catalogId: "sc_cuid_123",
                name: "Basic Inspection",
                code: null,
                description: null,
                estimatedDuration: null,
            });

            expect(result.code).toBeNull();
            expect(result.description).toBeNull();
            expect(result.estimatedDuration).toBeNull();
        });

        it("rejects missing catalogId", () => {
            expect(() => createWorkTypeSchema.parse({ name: "AC Repair" })).toThrow();
            expect(() => createWorkTypeSchema.parse({ catalogId: "", name: "AC Repair" })).toThrow(/Catalog ID is required/);
            expect(() => createWorkTypeSchema.parse({ catalogId: "   ", name: "AC Repair" })).toThrow(/Catalog ID is required/);
        });

        it("rejects missing or empty name", () => {
            expect(() => createWorkTypeSchema.parse({ catalogId: "sc_1" })).toThrow();
            expect(() => createWorkTypeSchema.parse({ catalogId: "sc_1", name: "" })).toThrow(/Work type name must not be empty/);
            expect(() => createWorkTypeSchema.parse({ catalogId: "sc_1", name: "   " })).toThrow(/Work type name must not be empty/);
        });

        it("accepts exact 150-character name boundary", () => {
            const exact150 = "W".repeat(150);
            const result = createWorkTypeSchema.parse({
                catalogId: "sc_1",
                name: exact150,
            });
            expect(result.name).toBe(exact150);
        });

        it("rejects name exceeding 150 characters", () => {
            const over150 = "W".repeat(151);
            expect(() =>
                createWorkTypeSchema.parse({
                    catalogId: "sc_1",
                    name: over150,
                }),
            ).toThrow(/less than 150 characters/);
        });

        it("accepts exact 2000-character description boundary", () => {
            const exact2000 = "D".repeat(2000);
            const result = createWorkTypeSchema.parse({
                catalogId: "sc_1",
                name: "AC Tune Up",
                description: exact2000,
            });
            expect(result.description).toBe(exact2000);
        });

        it("rejects description exceeding 2000 characters", () => {
            const over2000 = "D".repeat(2001);
            expect(() =>
                createWorkTypeSchema.parse({
                    catalogId: "sc_1",
                    name: "AC Tune Up",
                    description: over2000,
                }),
            ).toThrow(/less than 2000 characters/);
        });

        it("rejects non-integer sortOrder", () => {
            expect(() =>
                createWorkTypeSchema.parse({
                    catalogId: "sc_1",
                    name: "AC Tune Up",
                    sortOrder: 2.5,
                }),
            ).toThrow(/must be an integer/);
        });

        it("strips client-injected system and lifecycle fields (`id`, `workspaceId`, `status`, `createdAt`, `updatedAt`)", () => {
            const result = createWorkTypeSchema.parse({
                catalogId: "sc_1",
                name: "AC Repair",
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
            expect(result.name).toBe("AC Repair");
        });
    });

    describe("WorkType Update Schema (`updateWorkTypeSchema`)", () => {
        it("accepts an empty update payload", () => {
            const result = updateWorkTypeSchema.parse({});
            expect(result).toEqual({});
        });

        it("accepts a partial single-field update", () => {
            const result = updateWorkTypeSchema.parse({
                name: "Comprehensive AC Diagnostic",
            });
            expect(result).toEqual({
                name: "Comprehensive AC Diagnostic",
            });
        });

        it("accepts multi-field updates with code normalization", () => {
            const result = updateWorkTypeSchema.parse({
                name: "AC Comprehensive Tune-Up",
                code: "hvac-tune-up-01",
                estimatedDuration: 120,
                sortOrder: 3,
            });

            expect(result.name).toBe("AC Comprehensive Tune-Up");
            expect(result.code).toBe("HVAC-TUNE-UP-01");
            expect(result.estimatedDuration).toBe(120);
            expect(result.sortOrder).toBe(3);
        });

        it("supports clearing optional fields with null", () => {
            const result = updateWorkTypeSchema.parse({
                code: null,
                description: null,
                estimatedDuration: null,
            });

            expect(result.code).toBeNull();
            expect(result.description).toBeNull();
            expect(result.estimatedDuration).toBeNull();
        });

        it("rejects invalid update values", () => {
            expect(() => updateWorkTypeSchema.parse({ name: "" })).toThrow();
            expect(() => updateWorkTypeSchema.parse({ name: "A".repeat(151) })).toThrow();
            expect(() => updateWorkTypeSchema.parse({ code: "invalid code with spaces" })).toThrow();
            expect(() => updateWorkTypeSchema.parse({ estimatedDuration: 3 })).toThrow();
            expect(() => updateWorkTypeSchema.parse({ estimatedDuration: 1500 })).toThrow();
            expect(() => updateWorkTypeSchema.parse({ estimatedDuration: 60.5 })).toThrow();
            expect(() => updateWorkTypeSchema.parse({ sortOrder: 1.2 })).toThrow();
        });

        it("strips client-injected system and lifecycle fields from update", () => {
            const result = updateWorkTypeSchema.parse({
                name: "Renamed Work Type",
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
            expect(result.name).toBe("Renamed Work Type");
        });
    });

    describe("WorkType Status Update Schema (`updateWorkTypeStatusSchema` / `changeWorkTypeStatusSchema`)", () => {
        it("accepts status update as an object `{ status: 'ACTIVE' }`", () => {
            const result = updateWorkTypeStatusSchema.parse({ status: "ACTIVE" });
            expect(result).toEqual({ status: "ACTIVE" });
        });

        it("accepts status update as an object `{ status: 'INACTIVE' }`", () => {
            const result = updateWorkTypeStatusSchema.parse({ status: "INACTIVE" });
            expect(result).toEqual({ status: "INACTIVE" });
        });

        it("accepts status update as a raw enum string and transforms to object", () => {
            const resActive = updateWorkTypeStatusSchema.parse("ACTIVE");
            expect(resActive).toEqual({ status: "ACTIVE" });

            const resInactive = updateWorkTypeStatusSchema.parse("INACTIVE");
            expect(resInactive).toEqual({ status: "INACTIVE" });
        });

        it("aliases changeWorkTypeStatusSchema identically", () => {
            expect(changeWorkTypeStatusSchema).toBe(updateWorkTypeStatusSchema);
        });

        it("rejects invalid status mutations", () => {
            expect(() => updateWorkTypeStatusSchema.parse({ status: "SUSPENDED" })).toThrow();
            expect(() => updateWorkTypeStatusSchema.parse("ARCHIVED")).toThrow();
            expect(() => updateWorkTypeStatusSchema.parse({})).toThrow();
        });
    });

    describe("WorkType Directory Query Schema (`workTypeQuerySchema` / `getWorkTypesQuerySchema`)", () => {
        it("applies query defaults when parsed with empty object", () => {
            const result = workTypeQuerySchema.parse({});

            expect(result.page).toBe(1);
            expect(result.pageSize).toBe(20);
            expect(result.sortBy).toBe("sortOrder");
            expect(result.sortOrder).toBe("asc");
            expect(result.search).toBeUndefined();
            expect(result.catalogId).toBeUndefined();
            expect(result.status).toBeUndefined();
        });

        it("coerces string page and pageSize to numbers", () => {
            const result = workTypeQuerySchema.parse({
                page: "4",
                pageSize: "25",
                search: "diagnostic",
                catalogId: "sc_123",
                status: "ACTIVE",
                sortBy: "name",
                sortOrder: "desc",
            });

            expect(result.page).toBe(4);
            expect(result.pageSize).toBe(25);
            expect(result.search).toBe("diagnostic");
            expect(result.catalogId).toBe("sc_123");
            expect(result.status).toBe("ACTIVE");
            expect(result.sortBy).toBe("name");
            expect(result.sortOrder).toBe("desc");
        });

        it("accepts all supported sortBy criteria", () => {
            const validSorts = ["name", "code", "estimatedDuration", "status", "sortOrder", "createdAt", "updatedAt"] as const;

            for (const sortBy of validSorts) {
                const res = workTypeQuerySchema.parse({ sortBy });
                expect(res.sortBy).toBe(sortBy);
            }
        });

        it("rejects invalid sortBy value", () => {
            expect(() => workTypeQuerySchema.parse({ sortBy: "unsupportedField" })).toThrow();
        });

        it("rejects invalid sortOrder value", () => {
            expect(() => workTypeQuerySchema.parse({ sortOrder: "sideways" })).toThrow();
        });

        it("rejects page < 1", () => {
            expect(() => workTypeQuerySchema.parse({ page: 0 })).toThrow(/Page must be at least 1/);
            expect(() => workTypeQuerySchema.parse({ page: -1 })).toThrow(/Page must be at least 1/);
        });

        it("rejects pageSize out of bounds (< 1 or > 100)", () => {
            expect(() => workTypeQuerySchema.parse({ pageSize: 0 })).toThrow(/Page size must be at least 1/);
            expect(() => workTypeQuerySchema.parse({ pageSize: 101 })).toThrow(/Page size must not exceed 100/);
        });

        it("aliases getWorkTypesQuerySchema identically to workTypeQuerySchema", () => {
            expect(getWorkTypesQuerySchema).toBe(workTypeQuerySchema);
        });
    });
});
