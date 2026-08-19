import { describe, expect, it } from "vitest";
import {
    createServiceLocationSchema,
    updateServiceLocationSchema,
    serviceLocationQuerySchema,
    getServiceLocationsQuerySchema,
} from "@/lib/validations/serviceLocation";

describe("Phase 1.4.18 — Service Location Validation Schema Suite", () => {
    describe("1. createServiceLocationSchema", () => {
        it("validates and parses a full valid service location payload", () => {
            const input = {
                name: "  Austin Distribution Center  ",
                addressLine1: "  100 Industrial Parkway  ",
                addressLine2: "  Suite 400  ",
                city: "  Austin  ",
                state: "  TX  ",
                postalCode: "  78701  ",
                country: "  USA  ",
                latitude: 30.267153,
                longitude: -97.743057,
                notes: "  Gate 3 access only  ",
                isPrimary: true,
            };

            const parsed = createServiceLocationSchema.parse(input);

            expect(parsed).toEqual({
                name: "Austin Distribution Center",
                addressLine1: "100 Industrial Parkway",
                addressLine2: "Suite 400",
                city: "Austin",
                state: "TX",
                postalCode: "78701",
                country: "USA",
                latitude: 30.267153,
                longitude: -97.743057,
                notes: "Gate 3 access only",
                isPrimary: true,
            });
        });

        it("validates and parses minimal required fields with defaults", () => {
            const input = {
                name: "Branch Office",
                addressLine1: "50 Main St",
                city: "Dallas",
                country: "USA",
            };

            const parsed = createServiceLocationSchema.parse(input);

            expect(parsed.name).toBe("Branch Office");
            expect(parsed.addressLine1).toBe("50 Main St");
            expect(parsed.city).toBe("Dallas");
            expect(parsed.country).toBe("USA");
            expect(parsed.isPrimary).toBe(false);
            expect(parsed.addressLine2).toBeUndefined();
            expect(parsed.state).toBeUndefined();
            expect(parsed.postalCode).toBeUndefined();
            expect(parsed.latitude).toBeUndefined();
            expect(parsed.longitude).toBeUndefined();
            expect(parsed.notes).toBeUndefined();
        });

        it("accepts explicit null for optional nullable fields", () => {
            const input = {
                name: "Branch Office",
                addressLine1: "50 Main St",
                addressLine2: null,
                city: "Dallas",
                state: null,
                postalCode: null,
                country: "USA",
                latitude: null,
                longitude: null,
                notes: null,
            };

            const parsed = createServiceLocationSchema.parse(input);

            expect(parsed.addressLine2).toBeNull();
            expect(parsed.state).toBeNull();
            expect(parsed.postalCode).toBeNull();
            expect(parsed.latitude).toBeNull();
            expect(parsed.longitude).toBeNull();
            expect(parsed.notes).toBeNull();
        });

        it("rejects missing required fields", () => {
            expect(() => createServiceLocationSchema.parse({})).toThrow();

            const result = createServiceLocationSchema.safeParse({});
            expect(result.success).toBe(false);
            if (!result.success) {
                const errors = result.error.flatten().fieldErrors;
                expect(errors).toHaveProperty("name");
                expect(errors).toHaveProperty("addressLine1");
                expect(errors).toHaveProperty("city");
                expect(errors).toHaveProperty("country");
            }
        });

        it("rejects empty and whitespace-only strings for required fields", () => {
            expect(() =>
                createServiceLocationSchema.parse({
                    name: "   ",
                    addressLine1: "100 St",
                    city: "Dallas",
                    country: "USA",
                })
            ).toThrow("Name must not be empty.");

            expect(() =>
                createServiceLocationSchema.parse({
                    name: "Branch",
                    addressLine1: "",
                    city: "Dallas",
                    country: "USA",
                })
            ).toThrow("Address line 1 must not be empty.");

            expect(() =>
                createServiceLocationSchema.parse({
                    name: "Branch",
                    addressLine1: "100 St",
                    city: "   ",
                    country: "USA",
                })
            ).toThrow("City must not be empty.");

            expect(() =>
                createServiceLocationSchema.parse({
                    name: "Branch",
                    addressLine1: "100 St",
                    city: "Dallas",
                    country: "  ",
                })
            ).toThrow("Country must not be empty.");
        });

        it("rejects strings exceeding maximum lengths", () => {
            expect(() =>
                createServiceLocationSchema.parse({
                    name: "a".repeat(151),
                    addressLine1: "100 St",
                    city: "Dallas",
                    country: "USA",
                })
            ).toThrow("Name must contain less than 150 characters.");

            expect(() =>
                createServiceLocationSchema.parse({
                    name: "Branch",
                    addressLine1: "a".repeat(256),
                    city: "Dallas",
                    country: "USA",
                })
            ).toThrow("Address line 1 must contain less than 255 characters.");

            expect(() =>
                createServiceLocationSchema.parse({
                    name: "Branch",
                    addressLine1: "100 St",
                    addressLine2: "b".repeat(256),
                    city: "Dallas",
                    country: "USA",
                })
            ).toThrow("Address line 2 must contain less than 255 characters.");

            expect(() =>
                createServiceLocationSchema.parse({
                    name: "Branch",
                    addressLine1: "100 St",
                    city: "c".repeat(101),
                    country: "USA",
                })
            ).toThrow("City must contain less than 100 characters.");

            expect(() =>
                createServiceLocationSchema.parse({
                    name: "Branch",
                    addressLine1: "100 St",
                    city: "Dallas",
                    state: "d".repeat(101),
                    country: "USA",
                })
            ).toThrow("State must contain less than 100 characters.");

            expect(() =>
                createServiceLocationSchema.parse({
                    name: "Branch",
                    addressLine1: "100 St",
                    city: "Dallas",
                    postalCode: "e".repeat(51),
                    country: "USA",
                })
            ).toThrow("Postal code must contain less than 50 characters.");

            expect(() =>
                createServiceLocationSchema.parse({
                    name: "Branch",
                    addressLine1: "100 St",
                    city: "Dallas",
                    country: "f".repeat(101),
                })
            ).toThrow("Country must contain less than 100 characters.");

            expect(() =>
                createServiceLocationSchema.parse({
                    name: "Branch",
                    addressLine1: "100 St",
                    city: "Dallas",
                    country: "USA",
                    notes: "g".repeat(2001),
                })
            ).toThrow("Notes must contain less than 2000 characters.");
        });
    });

    describe("2. Geographic coordinates validation", () => {
        it("accepts valid latitude boundary values", () => {
            const validLatitudes = [-90, -45.5, 0, 45.5, 90, 30.267153];

            for (const lat of validLatitudes) {
                const parsed = createServiceLocationSchema.parse({
                    name: "Site",
                    addressLine1: "100 Way",
                    city: "City",
                    country: "Country",
                    latitude: lat,
                });
                expect(parsed.latitude).toBe(lat);
            }
        });

        it("rejects latitude outside -90 to 90 range", () => {
            expect(() =>
                createServiceLocationSchema.parse({
                    name: "Site",
                    addressLine1: "100 Way",
                    city: "City",
                    country: "Country",
                    latitude: -90.0001,
                })
            ).toThrow("Latitude must be between -90 and 90.");

            expect(() =>
                createServiceLocationSchema.parse({
                    name: "Site",
                    addressLine1: "100 Way",
                    city: "City",
                    country: "Country",
                    latitude: 90.0001,
                })
            ).toThrow("Latitude must be between -90 and 90.");
        });

        it("accepts valid longitude boundary values", () => {
            const validLongitudes = [-180, -97.743057, 0, 97.743057, 180];

            for (const lng of validLongitudes) {
                const parsed = createServiceLocationSchema.parse({
                    name: "Site",
                    addressLine1: "100 Way",
                    city: "City",
                    country: "Country",
                    longitude: lng,
                });
                expect(parsed.longitude).toBe(lng);
            }
        });

        it("rejects longitude outside -180 to 180 range", () => {
            expect(() =>
                createServiceLocationSchema.parse({
                    name: "Site",
                    addressLine1: "100 Way",
                    city: "City",
                    country: "Country",
                    longitude: -180.0001,
                })
            ).toThrow("Longitude must be between -180 and 180.");

            expect(() =>
                createServiceLocationSchema.parse({
                    name: "Site",
                    addressLine1: "100 Way",
                    city: "City",
                    country: "Country",
                    longitude: 180.0001,
                })
            ).toThrow("Longitude must be between -180 and 180.");
        });
    });

    describe("3. updateServiceLocationSchema", () => {
        it("accepts empty object {} for partial update", () => {
            const parsed = updateServiceLocationSchema.parse({});
            expect(parsed).toEqual({});
        });

        it("validates individual field updates", () => {
            const parsed = updateServiceLocationSchema.parse({
                name: "  Updated Warehouse  ",
                isPrimary: true,
            });

            expect(parsed.name).toBe("Updated Warehouse");
            expect(parsed.isPrimary).toBe(true);
            expect(parsed.city).toBeUndefined();
        });

        it("allows clearing nullable fields with explicit null", () => {
            const parsed = updateServiceLocationSchema.parse({
                addressLine2: null,
                state: null,
                postalCode: null,
                latitude: null,
                longitude: null,
                notes: null,
            });

            expect(parsed.addressLine2).toBeNull();
            expect(parsed.state).toBeNull();
            expect(parsed.postalCode).toBeNull();
            expect(parsed.latitude).toBeNull();
            expect(parsed.longitude).toBeNull();
            expect(parsed.notes).toBeNull();
        });

        it("rejects empty string when updating string fields", () => {
            expect(() =>
                updateServiceLocationSchema.parse({
                    name: "   ",
                })
            ).toThrow("Name must not be empty.");

            expect(() =>
                updateServiceLocationSchema.parse({
                    addressLine1: "",
                })
            ).toThrow("Address line 1 must not be empty.");

            expect(() =>
                updateServiceLocationSchema.parse({
                    city: "   ",
                })
            ).toThrow("City must not be empty.");

            expect(() =>
                updateServiceLocationSchema.parse({
                    country: "",
                })
            ).toThrow("Country must not be empty.");
        });

        it("enforces coordinate boundaries during update", () => {
            expect(() =>
                updateServiceLocationSchema.parse({
                    latitude: 95,
                })
            ).toThrow("Latitude must be between -90 and 90.");

            expect(() =>
                updateServiceLocationSchema.parse({
                    longitude: -185,
                })
            ).toThrow("Longitude must be between -180 and 180.");
        });
    });

    describe("4. serviceLocationQuerySchema & getServiceLocationsQuerySchema", () => {
        it("provides sensible query defaults", () => {
            const parsed = serviceLocationQuerySchema.parse({});

            expect(parsed.page).toBe(1);
            expect(parsed.pageSize).toBe(20);
            expect(parsed.sortBy).toBe("createdAt");
            expect(parsed.sortOrder).toBe("asc");
            expect(parsed.search).toBeUndefined();
            expect(parsed.isPrimary).toBeUndefined();
        });

        it("coerces page and pageSize from strings", () => {
            const parsed = serviceLocationQuerySchema.parse({
                page: "3",
                pageSize: "50",
            });

            expect(parsed.page).toBe(3);
            expect(parsed.pageSize).toBe(50);
        });

        it("coerces isPrimary from 'true' and 'false' strings", () => {
            const parsedTrue = serviceLocationQuerySchema.parse({ isPrimary: "true" });
            expect(parsedTrue.isPrimary).toBe(true);

            const parsedFalse = serviceLocationQuerySchema.parse({ isPrimary: "false" });
            expect(parsedFalse.isPrimary).toBe(false);

            const parsedBool = serviceLocationQuerySchema.parse({ isPrimary: true });
            expect(parsedBool.isPrimary).toBe(true);
        });

        it("rejects pageSize exceeding 100 or below 1", () => {
            expect(() => serviceLocationQuerySchema.parse({ pageSize: 101 })).toThrow(
                "Page size must not exceed 100."
            );

            expect(() => serviceLocationQuerySchema.parse({ pageSize: 0 })).toThrow(
                "Page size must be at least 1."
            );
        });

        it("rejects page below 1", () => {
            expect(() => serviceLocationQuerySchema.parse({ page: 0 })).toThrow(
                "Page must be at least 1."
            );
        });

        it("accepts whitelisted sortBy fields", () => {
            const whitelisted = [
                "name",
                "city",
                "state",
                "postalCode",
                "country",
                "createdAt",
                "updatedAt",
                "isPrimary",
            ];

            for (const field of whitelisted) {
                const parsed = serviceLocationQuerySchema.parse({ sortBy: field });
                expect(parsed.sortBy).toBe(field);
            }
        });

        it("rejects invalid or arbitrary sortBy fields", () => {
            expect(() => serviceLocationQuerySchema.parse({ sortBy: "id" })).toThrow();
            expect(() => serviceLocationQuerySchema.parse({ sortBy: "customerId" })).toThrow();
            expect(() => serviceLocationQuerySchema.parse({ sortBy: "workspaceId" })).toThrow();
            expect(() => serviceLocationQuerySchema.parse({ sortBy: "latitude" })).toThrow();
            expect(() => serviceLocationQuerySchema.parse({ sortBy: "randomField" })).toThrow();
        });

        it("accepts valid sortOrder ('asc' / 'desc') and rejects invalid values", () => {
            expect(serviceLocationQuerySchema.parse({ sortOrder: "desc" }).sortOrder).toBe("desc");
            expect(serviceLocationQuerySchema.parse({ sortOrder: "asc" }).sortOrder).toBe("asc");
            expect(() => serviceLocationQuerySchema.parse({ sortOrder: "upward" as any })).toThrow();
        });

        it("verifies getServiceLocationsQuerySchema is an alias for serviceLocationQuerySchema", () => {
            expect(getServiceLocationsQuerySchema).toBe(serviceLocationQuerySchema);
        });
    });
});
