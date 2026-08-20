import { describe, expect, it } from "vitest";
import {
    createAssetSchema,
    updateAssetSchema,
    transitionAssetStatusSchema,
    transferAssetLocationSchema,
    transferAssetOwnershipSchema,
    getAssetsQuerySchema,
} from "@/lib/services/asset/asset.schemas";

describe("Phase 1.7.3 — Asset Zod Validation Schemas", () => {
    describe("1. createAssetSchema", () => {
        it("passes with valid complete asset creation payload", () => {
            const validPayload = {
                name: "Rooftop Chiller Unit #1",
                assetNumber: "AST-000101",
                customerId: "cust_101",
                locationId: "loc_101",
                categoryId: "cat_101",
                manufacturer: "Carrier",
                modelNumber: "30RAP-055",
                serialNumber: "SN-CARRIER-998811",
                status: "OPERATIONAL",
                subLocationNotes: "North Rooftop - Section B",
                installationDate: "2024-03-15T00:00:00.000Z",
                warrantyExpiresAt: "2029-03-15T00:00:00.000Z",
                purchaseDate: "2024-02-01T00:00:00.000Z",
                purchaseCost: 45000.00,
                notes: "Primary building chiller",
                tags: ["critical-infrastructure", "rooftop", "tier-1-sla"],
                metadata: {
                    tonnage: 55,
                    refrigerantType: "R-410A",
                    voltage: "480V 3-Phase",
                    compressors: 2,
                },
            };

            const parsed = createAssetSchema.safeParse(validPayload);
            expect(parsed.success).toBe(true);
            if (parsed.success) {
                expect(parsed.data.name).toBe("Rooftop Chiller Unit #1");
                expect(parsed.data.status).toBe("OPERATIONAL");
                expect(parsed.data.tags).toEqual(["critical-infrastructure", "rooftop", "tier-1-sla"]);
            }
        });

        it("passes with minimal payload and defaults status to OPERATIONAL", () => {
            const minimalPayload = {
                name: "Basic Portable Pump",
            };

            const parsed = createAssetSchema.safeParse(minimalPayload);
            expect(parsed.success).toBe(true);
            if (parsed.success) {
                expect(parsed.data.name).toBe("Basic Portable Pump");
                expect(parsed.data.status).toBe("OPERATIONAL");
                expect(parsed.data.tags).toEqual([]);
            }
        });

        it("allows depot asset creation with null customerId and null locationId", () => {
            const depotPayload = {
                name: "Emergency Loaner Generator 50kW",
                customerId: null,
                locationId: null,
                status: "IN_STORAGE",
            };

            const parsed = createAssetSchema.safeParse(depotPayload);
            expect(parsed.success).toBe(true);
            if (parsed.success) {
                expect(parsed.data.customerId).toBeNull();
                expect(parsed.data.locationId).toBeNull();
                expect(parsed.data.status).toBe("IN_STORAGE");
            }
        });

        it("fails when name is missing or empty", () => {
            const missingName = createAssetSchema.safeParse({});
            expect(missingName.success).toBe(false);

            const emptyName = createAssetSchema.safeParse({ name: "   " });
            expect(emptyName.success).toBe(false);
            if (!emptyName.success) {
                expect(emptyName.error.issues[0].message).toContain("Name must not be empty");
            }
        });

        it("fails when name exceeds 200 characters", () => {
            const parsed = createAssetSchema.safeParse({
                name: "a".repeat(201),
            });
            expect(parsed.success).toBe(false);
            if (!parsed.success) {
                expect(parsed.error.issues[0].message).toContain("less than 200 characters");
            }
        });

        it("fails when unknown fields are supplied (.strict rejection)", () => {
            const parsed = createAssetSchema.safeParse({
                name: "Chiller",
                maliciousField: "injection_payload",
            });
            expect(parsed.success).toBe(false);
            if (!parsed.success) {
                expect(parsed.error.issues[0].code).toBe("unrecognized_keys");
            }
        });

        it("fails when purchaseCost is negative", () => {
            const parsed = createAssetSchema.safeParse({
                name: "Chiller",
                purchaseCost: -500,
            });
            expect(parsed.success).toBe(false);
            if (!parsed.success) {
                expect(parsed.error.issues[0].message).toContain("Purchase cost must be non-negative");
            }
        });
    });

    describe("2. Tags Validation (Phase 1.7.1 §7.1)", () => {
        it("accepts valid lowercase alphanumeric and hyphen tags", () => {
            const parsed = createAssetSchema.safeParse({
                name: "HVAC Unit",
                tags: ["hvac-primary", "tier-1", "zone-4b", "2026-upgrade"],
            });
            expect(parsed.success).toBe(true);
        });

        it("fails when tags contain uppercase letters or spaces or invalid characters", () => {
            const uppercaseTag = createAssetSchema.safeParse({
                name: "HVAC Unit",
                tags: ["HVAC_Primary"],
            });
            expect(uppercaseTag.success).toBe(false);

            const spaceTag = createAssetSchema.safeParse({
                name: "HVAC Unit",
                tags: ["hvac primary"],
            });
            expect(spaceTag.success).toBe(false);

            const specialCharTag = createAssetSchema.safeParse({
                name: "HVAC Unit",
                tags: ["tag#1!"],
            });
            expect(specialCharTag.success).toBe(false);
        });

        it("fails when a single tag exceeds 30 characters", () => {
            const parsed = createAssetSchema.safeParse({
                name: "HVAC Unit",
                tags: ["a".repeat(31)],
            });
            expect(parsed.success).toBe(false);
            if (!parsed.success) {
                expect(parsed.error.issues[0].message).toContain("cannot exceed 30 characters");
            }
        });

        it("fails when tag count exceeds 20 tags", () => {
            const tags = Array.from({ length: 21 }, (_, i) => `tag-${i}`);
            const parsed = createAssetSchema.safeParse({
                name: "HVAC Unit",
                tags,
            });
            expect(parsed.success).toBe(false);
            if (!parsed.success) {
                expect(parsed.error.issues[0].message).toContain("cannot have more than 20 tags");
            }
        });
    });

    describe("3. Metadata Validation (Phase 1.7.1 §7.2)", () => {
        it("accepts valid primitive metadata and shallow primitive arrays (depth <= 2)", () => {
            const validMetadata = {
                tonnage: 55.5,
                refrigerant: "R-410A",
                active: true,
                voltage: 480,
                phases: 3,
                compressors: {
                    count: 2,
                    type: "Scroll",
                    brand: "Copeland",
                },
                filterSizes: ["20x25x4", "16x20x2"],
            };

            const parsed = createAssetSchema.safeParse({
                name: "Chiller",
                metadata: validMetadata,
            });
            expect(parsed.success).toBe(true);
        });

        it("fails when metadata depth exceeds 2 levels", () => {
            const deepMetadata = {
                level1: {
                    level2: {
                        level3: "too_deep_value",
                    },
                },
            };

            const parsed = createAssetSchema.safeParse({
                name: "Chiller",
                metadata: deepMetadata,
            });
            expect(parsed.success).toBe(false);
            if (!parsed.success) {
                expect(parsed.error.issues[0].message).toContain("Metadata must be an object");
            }
        });

        it("fails when metadata size exceeds 32KB", () => {
            const largeMetadata: Record<string, string> = {};
            for (let i = 0; i < 500; i++) {
                largeMetadata[`key_${i}`] = "x".repeat(100);
            }

            const parsed = createAssetSchema.safeParse({
                name: "Chiller",
                metadata: largeMetadata,
            });
            expect(parsed.success).toBe(false);
        });
    });

    describe("4. updateAssetSchema", () => {
        it("passes with valid partial update of mutable fields", () => {
            const validUpdate = {
                name: "Updated Chiller Name",
                manufacturer: "Trane",
                notes: "Updated service instructions",
                tags: ["updated-tag"],
                metadata: { tonnage: 60 },
            };

            const parsed = updateAssetSchema.safeParse(validUpdate);
            expect(parsed.success).toBe(true);
        });

        it("fails when immutable or transfer-controlled fields are supplied (.strict rejection)", () => {
            // Immutable fields
            expect(updateAssetSchema.safeParse({ id: "ast_123" }).success).toBe(false);
            expect(updateAssetSchema.safeParse({ workspaceId: "ws_123" }).success).toBe(false);
            expect(updateAssetSchema.safeParse({ createdAt: new Date() }).success).toBe(false);

            // Transfer-controlled fields
            expect(updateAssetSchema.safeParse({ customerId: "cust_123" }).success).toBe(false);
            expect(updateAssetSchema.safeParse({ locationId: "loc_123" }).success).toBe(false);

            // Lifecycle-controlled fields
            expect(updateAssetSchema.safeParse({ status: "RETIRED" }).success).toBe(false);
            expect(updateAssetSchema.safeParse({ decommissionedAt: new Date() }).success).toBe(false);
            expect(updateAssetSchema.safeParse({ retiredAt: new Date() }).success).toBe(false);
        });
    });

    describe("5. transitionAssetStatusSchema", () => {
        it("passes when transitioning to OPERATIONAL without a reason", () => {
            const parsed = transitionAssetStatusSchema.safeParse({
                fromStatus: "IN_STORAGE",
                toStatus: "OPERATIONAL",
            });
            expect(parsed.success).toBe(true);
        });

        it("passes when transitioning from DEGRADED to OPERATIONAL without a reason", () => {
            const parsed = transitionAssetStatusSchema.safeParse({
                fromStatus: "DEGRADED",
                toStatus: "OPERATIONAL",
            });
            expect(parsed.success).toBe(true);
        });

        it("fails when transitioning from OPERATIONAL to DEGRADED without a reason", () => {
            const parsed = transitionAssetStatusSchema.safeParse({
                fromStatus: "OPERATIONAL",
                toStatus: "DEGRADED",
            });
            expect(parsed.success).toBe(false);
            if (!parsed.success) {
                expect(parsed.error.issues[0].message).toContain("Status reason is required");
            }
        });

        it("passes when transitioning from OPERATIONAL to DEGRADED with a valid reason", () => {
            const parsed = transitionAssetStatusSchema.safeParse({
                fromStatus: "OPERATIONAL",
                toStatus: "DEGRADED",
                statusReason: "High discharge temperature warning alert on circuit 1",
            });
            expect(parsed.success).toBe(true);
        });

        it("fails when transitioning to OUT_OF_SERVICE without a reason", () => {
            const parsed = transitionAssetStatusSchema.safeParse({
                fromStatus: "OPERATIONAL",
                toStatus: "OUT_OF_SERVICE",
            });
            expect(parsed.success).toBe(false);
        });

        it("fails when transitioning from OPERATIONAL to IN_STORAGE without a reason", () => {
            const parsed = transitionAssetStatusSchema.safeParse({
                fromStatus: "OPERATIONAL",
                toStatus: "IN_STORAGE",
            });
            expect(parsed.success).toBe(false);
        });

        it("passes when transitioning from OPERATIONAL to IN_STORAGE with a valid reason", () => {
            const parsed = transitionAssetStatusSchema.safeParse({
                fromStatus: "OPERATIONAL",
                toStatus: "IN_STORAGE",
                statusReason: "Uninstalled from building A and returned to depot",
            });
            expect(parsed.success).toBe(true);
        });

        it("fails when transitioning to DECOMMISSIONED or RETIRED without a reason", () => {
            const decom = transitionAssetStatusSchema.safeParse({
                toStatus: "DECOMMISSIONED",
            });
            expect(decom.success).toBe(false);

            const retire = transitionAssetStatusSchema.safeParse({
                toStatus: "RETIRED",
            });
            expect(retire.success).toBe(false);
        });

        it("passes when transitioning to DECOMMISSIONED or RETIRED with a valid reason", () => {
            const decom = transitionAssetStatusSchema.safeParse({
                toStatus: "DECOMMISSIONED",
                statusReason: "Facility mothballed for winter season",
            });
            expect(decom.success).toBe(true);

            const retire = transitionAssetStatusSchema.safeParse({
                toStatus: "RETIRED",
                statusReason: "Compressor seized; unit destroyed and scrapped on site",
            });
            expect(retire.success).toBe(true);
        });
    });

    describe("6. transferAssetLocationSchema", () => {
        it("passes with valid locationId and non-empty transferReason", () => {
            const parsed = transferAssetLocationSchema.safeParse({
                locationId: "loc_destination_202",
                subLocationNotes: "East Wing Room 102",
                transferReason: "Relocated to service new server room expansion",
            });
            expect(parsed.success).toBe(true);
        });

        it("fails when transferReason is omitted or whitespace-only", () => {
            const missingReason = transferAssetLocationSchema.safeParse({
                locationId: "loc_202",
            });
            expect(missingReason.success).toBe(false);

            const emptyReason = transferAssetLocationSchema.safeParse({
                locationId: "loc_202",
                transferReason: "   ",
            });
            expect(emptyReason.success).toBe(false);
            if (!emptyReason.success) {
                expect(emptyReason.error.issues[0].message).toContain("Transfer reason is required");
            }
        });

        it("fails when locationId is missing", () => {
            const parsed = transferAssetLocationSchema.safeParse({
                transferReason: "Relocated",
            });
            expect(parsed.success).toBe(false);
        });
    });

    describe("7. transferAssetOwnershipSchema", () => {
        it("passes with valid customerId, optional locationId, and non-empty transferReason", () => {
            const parsed = transferAssetOwnershipSchema.safeParse({
                customerId: "cust_new_owner_303",
                locationId: "loc_new_site_404",
                subLocationNotes: "Basement Utility Room",
                transferReason: "Building purchased by new management company",
            });
            expect(parsed.success).toBe(true);
        });

        it("fails when transferReason or customerId is omitted", () => {
            const missingReason = transferAssetOwnershipSchema.safeParse({
                customerId: "cust_303",
            });
            expect(missingReason.success).toBe(false);

            const missingCustomer = transferAssetOwnershipSchema.safeParse({
                transferReason: "Transferred ownership",
            });
            expect(missingCustomer.success).toBe(false);
        });
    });

    describe("8. getAssetsQuerySchema", () => {
        it("applies default pagination and sort order", () => {
            const parsed = getAssetsQuerySchema.safeParse({});
            expect(parsed.success).toBe(true);
            if (parsed.success) {
                expect(parsed.data.page).toBe(1);
                expect(parsed.data.pageSize).toBe(20);
                expect(parsed.data.sortBy).toBe("createdAt");
                expect(parsed.data.sortOrder).toBe("desc");
            }
        });

        it("accepts all valid sort fields from the allowlist", () => {
            const allowedSorts = [
                "createdAt",
                "updatedAt",
                "name",
                "assetNumber",
                "serialNumber",
                "status",
                "manufacturer",
            ];

            for (const sortBy of allowedSorts) {
                const parsed = getAssetsQuerySchema.safeParse({ sortBy });
                expect(parsed.success).toBe(true);
                if (parsed.success) {
                    expect(parsed.data.sortBy).toBe(sortBy);
                }
            }
        });

        it("rejects unauthorized sort fields", () => {
            const parsed = getAssetsQuerySchema.safeParse({
                sortBy: "unauthorizedSecretColumn",
            });
            expect(parsed.success).toBe(false);
            if (!parsed.success) {
                expect(parsed.error.issues[0].message).toContain("Sort field must be one of");
            }
        });

        it("parses comma-separated tag query parameter into string array", () => {
            const parsed = getAssetsQuerySchema.safeParse({
                tags: "critical, rooftop, tier-1",
            });
            expect(parsed.success).toBe(true);
            if (parsed.success) {
                expect(parsed.data.tags).toEqual(["critical", "rooftop", "tier-1"]);
            }
        });
    });
});
