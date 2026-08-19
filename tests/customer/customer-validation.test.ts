import { describe, expect, it } from "vitest";
import {
    CUSTOMER_STATUSES,
    customerStatusSchema,
    createCustomerSchema,
    updateCustomerSchema,
    updateCustomerStatusSchema,
    customerQuerySchema,
    getCustomersQuerySchema,
} from "@/lib/validations/customer";

describe("Phase 1.4.3 — Customer Validation Layer", () => {
    describe("Customer Status Schema (`customerStatusSchema`)", () => {
        it("accepts valid CustomerStatus values", () => {
            expect(customerStatusSchema.parse("ACTIVE")).toBe("ACTIVE");
            expect(customerStatusSchema.parse("INACTIVE")).toBe("INACTIVE");
        });

        it("rejects invalid status values", () => {
            expect(() => customerStatusSchema.parse("PENDING")).toThrow();
            expect(() => customerStatusSchema.parse("DELETED")).toThrow();
            expect(() => customerStatusSchema.parse("ARCHIVED")).toThrow();
            expect(() => customerStatusSchema.parse("")).toThrow();
            expect(() => customerStatusSchema.parse(null)).toThrow();
            expect(() => customerStatusSchema.parse(undefined)).toThrow();
        });

        it("exports the exact list of CUSTOMER_STATUSES", () => {
            expect(CUSTOMER_STATUSES).toEqual(["ACTIVE", "INACTIVE"]);
        });
    });

    describe("Customer Create Schema (`createCustomerSchema`)", () => {
        it("accepts a minimal valid payload with only required name", () => {
            const result = createCustomerSchema.parse({
                name: "Apex Logistics Ltd",
            });

            expect(result.name).toBe("Apex Logistics Ltd");
            expect(result.status).toBe("ACTIVE");
            expect(result.customerNumber).toBeUndefined();
            expect(result.email).toBeUndefined();
            expect(result.phone).toBeUndefined();
            expect(result.website).toBeUndefined();
            expect(result.addressLine1).toBeUndefined();
            expect(result.addressLine2).toBeUndefined();
            expect(result.city).toBeUndefined();
            expect(result.state).toBeUndefined();
            expect(result.postalCode).toBeUndefined();
            expect(result.country).toBeUndefined();
            expect(result.notes).toBeUndefined();
        });

        it("accepts a full valid payload with all fields populated", () => {
            const input = {
                name: "Global Energy Solutions Inc.",
                customerNumber: "CUST-99001",
                email: "Accounts.Payable@GlobalEnergy.com",
                phone: "+44 20 7946 0912",
                website: "https://globalenergy.com/contact",
                addressLine1: "100 Bishopsgate",
                addressLine2: "Level 25",
                city: "London",
                state: "Greater London",
                postalCode: "EC2N 4AG",
                country: "United Kingdom",
                status: "ACTIVE" as const,
                notes: "High-priority enterprise account with 24/7 SLA.",
            };

            const result = createCustomerSchema.parse(input);

            expect(result.name).toBe("Global Energy Solutions Inc.");
            expect(result.customerNumber).toBe("CUST-99001");
            expect(result.email).toBe("accounts.payable@globalenergy.com"); // normalized to lowercase
            expect(result.phone).toBe("+44 20 7946 0912");
            expect(result.website).toBe("https://globalenergy.com/contact");
            expect(result.addressLine1).toBe("100 Bishopsgate");
            expect(result.addressLine2).toBe("Level 25");
            expect(result.city).toBe("London");
            expect(result.state).toBe("Greater London");
            expect(result.postalCode).toBe("EC2N 4AG");
            expect(result.country).toBe("United Kingdom");
            expect(result.status).toBe("ACTIVE");
            expect(result.notes).toBe("High-priority enterprise account with 24/7 SLA.");
        });

        it("trims whitespace from string fields", () => {
            const result = createCustomerSchema.parse({
                name: "   Trimmed Industries   ",
                customerNumber: "  CUST-002  ",
                city: "  Lahore  ",
                country: "  Pakistan  ",
            });

            expect(result.name).toBe("Trimmed Industries");
            expect(result.customerNumber).toBe("CUST-002");
            expect(result.city).toBe("Lahore");
            expect(result.country).toBe("Pakistan");
        });

        it("supports international addresses and unicode characters", () => {
            const result = createCustomerSchema.parse({
                name: "Münchner Rückversicherungs-Gesellschaft AG",
                city: "München",
                state: "Bayern",
                postalCode: "80802",
                country: "Deutschland",
                notes: "Internationale Niederlassung für technische Wartung.",
            });

            expect(result.name).toBe("Münchner Rückversicherungs-Gesellschaft AG");
            expect(result.city).toBe("München");
            expect(result.state).toBe("Bayern");
        });

        it("allows explicit null for optional nullable fields", () => {
            const result = createCustomerSchema.parse({
                name: "Nullable Customer",
                customerNumber: null,
                email: null,
                phone: null,
                website: null,
                addressLine1: null,
                addressLine2: null,
                city: null,
                state: null,
                postalCode: null,
                country: null,
                notes: null,
            });

            expect(result.customerNumber).toBeNull();
            expect(result.email).toBeNull();
            expect(result.phone).toBeNull();
            expect(result.website).toBeNull();
            expect(result.addressLine1).toBeNull();
            expect(result.notes).toBeNull();
        });

        it("rejects missing or undefined name", () => {
            expect(() => createCustomerSchema.parse({})).toThrow();
            expect(() => createCustomerSchema.parse({ name: undefined })).toThrow();
        });

        it("rejects empty or whitespace-only name", () => {
            expect(() => createCustomerSchema.parse({ name: "" })).toThrow(/Customer name must not be empty/);
            expect(() => createCustomerSchema.parse({ name: "   " })).toThrow(/Customer name must not be empty/);
        });

        it("rejects overly long name (> 150 chars)", () => {
            const longName = "A".repeat(151);
            expect(() => createCustomerSchema.parse({ name: longName })).toThrow(/less than 150 characters/);
        });

        it("rejects invalid customerNumber (empty string or > 50 chars)", () => {
            expect(() => createCustomerSchema.parse({ name: "Acme", customerNumber: "" })).toThrow(/Customer number must not be empty/);
            expect(() => createCustomerSchema.parse({ name: "Acme", customerNumber: "   " })).toThrow(/Customer number must not be empty/);
            expect(() => createCustomerSchema.parse({ name: "Acme", customerNumber: "X".repeat(51) })).toThrow(/less than 50 characters/);
        });

        it("rejects invalid email formats", () => {
            expect(() => createCustomerSchema.parse({ name: "Acme", email: "not-an-email" })).toThrow(/valid email address/);
            expect(() => createCustomerSchema.parse({ name: "Acme", email: "user@" })).toThrow(/valid email address/);
            expect(() => createCustomerSchema.parse({ name: "Acme", email: "@domain.com" })).toThrow(/valid email address/);
        });

        it("rejects overly long email (> 100 chars)", () => {
            const longEmail = `${"a".repeat(95)}@test.com`;
            expect(() => createCustomerSchema.parse({ name: "Acme", email: longEmail })).toThrow();
        });

        it("rejects invalid website URLs", () => {
            expect(() => createCustomerSchema.parse({ name: "Acme", website: "not-a-url" })).toThrow(/valid URL/);
            expect(() => createCustomerSchema.parse({ name: "Acme", website: "ftp://example.com" })).toThrow(/must start with http:\/\/ or https:\/\//);
            expect(() => createCustomerSchema.parse({ name: "Acme", website: "javascript:alert(1)" })).toThrow();
        });

        it("rejects overly long phone numbers (> 50 chars)", () => {
            expect(() => createCustomerSchema.parse({ name: "Acme", phone: "1".repeat(51) })).toThrow(/less than 50 characters/);
        });

        it("rejects overly long address lines (> 100 chars)", () => {
            expect(() => createCustomerSchema.parse({ name: "Acme", addressLine1: "A".repeat(101) })).toThrow(/less than 100 characters/);
            expect(() => createCustomerSchema.parse({ name: "Acme", city: "A".repeat(101) })).toThrow(/less than 100 characters/);
            expect(() => createCustomerSchema.parse({ name: "Acme", country: "A".repeat(101) })).toThrow(/less than 100 characters/);
        });

        it("rejects overly long postal code (> 50 chars)", () => {
            expect(() => createCustomerSchema.parse({ name: "Acme", postalCode: "P".repeat(51) })).toThrow(/less than 50 characters/);
        });

        it("rejects overly long notes (> 2000 chars)", () => {
            expect(() => createCustomerSchema.parse({ name: "Acme", notes: "N".repeat(2001) })).toThrow(/less than 2000 characters/);
        });

        it("supports multiline text in notes", () => {
            const multilineNotes = "Line 1: Special gate access.\nLine 2: Contact security guard.\nLine 3: Key required.";
            const result = createCustomerSchema.parse({
                name: "Secure Facility",
                notes: multilineNotes,
            });
            expect(result.notes).toBe(multilineNotes);
        });
    });

    describe("Customer Update Schema (`updateCustomerSchema`)", () => {
        it("accepts an empty update payload", () => {
            const result = updateCustomerSchema.parse({});
            expect(result).toEqual({});
        });

        it("accepts a partial single-field update", () => {
            const result = updateCustomerSchema.parse({
                name: "Renamed Customer LLC",
            });
            expect(result).toEqual({
                name: "Renamed Customer LLC",
            });
        });

        it("accepts multi-field updates", () => {
            const result = updateCustomerSchema.parse({
                phone: "+1-555-0199",
                website: "https://new-website.com",
                city: "Seattle",
                state: "WA",
            });

            expect(result).toEqual({
                phone: "+1-555-0199",
                website: "https://new-website.com",
                city: "Seattle",
                state: "WA",
            });
        });

        it("supports clearing optional fields with null", () => {
            const result = updateCustomerSchema.parse({
                email: null,
                phone: null,
                website: null,
                addressLine2: null,
                notes: null,
            });

            expect(result.email).toBeNull();
            expect(result.phone).toBeNull();
            expect(result.website).toBeNull();
            expect(result.addressLine2).toBeNull();
            expect(result.notes).toBeNull();
        });

        it("rejects invalid values in update fields", () => {
            expect(() => updateCustomerSchema.parse({ name: "" })).toThrow();
            expect(() => updateCustomerSchema.parse({ email: "invalid-email" })).toThrow();
            expect(() => updateCustomerSchema.parse({ website: "invalid-url" })).toThrow();
            expect(() => updateCustomerSchema.parse({ status: "UNKNOWN" as any })).toThrow();
            expect(() => updateCustomerSchema.parse({ notes: "X".repeat(2001) })).toThrow();
        });
    });

    describe("Customer Status Update Schema (`updateCustomerStatusSchema`)", () => {
        it("accepts status update as an object `{ status: 'ACTIVE' }`", () => {
            const result = updateCustomerStatusSchema.parse({ status: "ACTIVE" });
            expect(result).toEqual({ status: "ACTIVE" });
        });

        it("accepts status update as an object `{ status: 'INACTIVE' }`", () => {
            const result = updateCustomerStatusSchema.parse({ status: "INACTIVE" });
            expect(result).toEqual({ status: "INACTIVE" });
        });

        it("accepts status update as a raw enum string and transforms to object", () => {
            const resActive = updateCustomerStatusSchema.parse("ACTIVE");
            expect(resActive).toEqual({ status: "ACTIVE" });

            const resInactive = updateCustomerStatusSchema.parse("INACTIVE");
            expect(resInactive).toEqual({ status: "INACTIVE" });
        });

        it("rejects invalid status mutations", () => {
            expect(() => updateCustomerStatusSchema.parse({ status: "SUSPENDED" })).toThrow();
            expect(() => updateCustomerStatusSchema.parse("ARCHIVED")).toThrow();
            expect(() => updateCustomerStatusSchema.parse({})).toThrow();
        });
    });

    describe("Customer Directory Query Schema (`customerQuerySchema` / `getCustomersQuerySchema`)", () => {
        it("applies sensible query defaults when called with empty object", () => {
            const result = customerQuerySchema.parse({});

            expect(result.page).toBe(1);
            expect(result.pageSize).toBe(20);
            expect(result.sortBy).toBe("name");
            expect(result.sortOrder).toBe("asc");
            expect(result.search).toBeUndefined();
            expect(result.status).toBeUndefined();
        });

        it("coerces string page and pageSize to numbers", () => {
            const result = customerQuerySchema.parse({
                page: "3",
                pageSize: "50",
                search: "manufacturing",
                status: "ACTIVE",
                sortBy: "customerNumber",
                sortOrder: "desc",
            });

            expect(result.page).toBe(3);
            expect(result.pageSize).toBe(50);
            expect(result.search).toBe("manufacturing");
            expect(result.status).toBe("ACTIVE");
            expect(result.sortBy).toBe("customerNumber");
            expect(result.sortOrder).toBe("desc");
        });

        it("accepts all supported sortBy criteria", () => {
            const validSorts = ["name", "customerNumber", "createdAt", "updatedAt", "city", "status"] as const;

            for (const sortBy of validSorts) {
                const res = customerQuerySchema.parse({ sortBy });
                expect(res.sortBy).toBe(sortBy);
            }
        });

        it("rejects invalid sortBy value", () => {
            expect(() => customerQuerySchema.parse({ sortBy: "invalidColumn" })).toThrow();
        });

        it("rejects invalid sortOrder value", () => {
            expect(() => customerQuerySchema.parse({ sortOrder: "sideways" })).toThrow();
        });

        it("rejects non-positive page number", () => {
            expect(() => customerQuerySchema.parse({ page: 0 })).toThrow(/Page must be at least 1/);
            expect(() => customerQuerySchema.parse({ page: -5 })).toThrow(/Page must be at least 1/);
        });

        it("rejects pageSize out of bounds (< 1 or > 100)", () => {
            expect(() => customerQuerySchema.parse({ pageSize: 0 })).toThrow(/Page size must be at least 1/);
            expect(() => customerQuerySchema.parse({ pageSize: 101 })).toThrow(/Page size must not exceed 100/);
        });

        it("aliases getCustomersQuerySchema identically to customerQuerySchema", () => {
            expect(getCustomersQuerySchema).toBe(customerQuerySchema);
        });
    });

    describe("Security Boundary & System Field Isolation", () => {
        it("strips client-injected `id` from create schema", () => {
            const result = createCustomerSchema.parse({
                name: "Valid Customer",
                id: "malicious_injected_cuid",
            } as any);

            expect((result as any).id).toBeUndefined();
            expect(result.name).toBe("Valid Customer");
        });

        it("strips client-injected `workspaceId` from create schema", () => {
            const result = createCustomerSchema.parse({
                name: "Valid Customer",
                workspaceId: "other_workspace_cuid",
            } as any);

            expect((result as any).workspaceId).toBeUndefined();
            expect(result.name).toBe("Valid Customer");
        });

        it("strips client-injected timestamps (`createdAt`, `updatedAt`)", () => {
            const result = createCustomerSchema.parse({
                name: "Valid Customer",
                createdAt: new Date("2020-01-01"),
                updatedAt: new Date("2020-01-01"),
            } as any);

            expect((result as any).createdAt).toBeUndefined();
            expect((result as any).updatedAt).toBeUndefined();
        });

        it("strips arbitrary authorization/role fields from payload", () => {
            const result = createCustomerSchema.parse({
                name: "Valid Customer",
                role: "OWNER",
                permission: "all",
                tenantId: "injected_tenant",
                ownerId: "injected_owner",
            } as any);

            expect((result as any).role).toBeUndefined();
            expect((result as any).permission).toBeUndefined();
            expect((result as any).tenantId).toBeUndefined();
            expect((result as any).ownerId).toBeUndefined();
        });

        it("strips system fields from update schema", () => {
            const result = updateCustomerSchema.parse({
                name: "Updated Name",
                id: "forbidden_id",
                workspaceId: "forbidden_workspace",
                createdAt: new Date(),
                updatedAt: new Date(),
            } as any);

            expect((result as any).id).toBeUndefined();
            expect((result as any).workspaceId).toBeUndefined();
            expect((result as any).createdAt).toBeUndefined();
            expect((result as any).updatedAt).toBeUndefined();
            expect(result.name).toBe("Updated Name");
        });
    });
});
