import { describe, expect, it } from "vitest";
import {
    createCustomerContactSchema,
    updateCustomerContactSchema,
    customerContactQuerySchema,
    getCustomerContactsQuerySchema,
} from "@/lib/validations/customerContact";

describe("Phase 1.4.10 — Customer Contact Validation Schema Suite", () => {
    describe("1. createCustomerContactSchema — Required & Boundary Fields", () => {
        const validMinimalInput = {
            firstName: "Jane",
            lastName: "Doe",
        };

        it("validates minimal valid contact and assigns default isPrimary to false", () => {
            const parsed = createCustomerContactSchema.parse(validMinimalInput);
            expect(parsed.firstName).toBe("Jane");
            expect(parsed.lastName).toBe("Doe");
            expect(parsed.isPrimary).toBe(false);
            expect(parsed.title).toBeUndefined();
            expect(parsed.email).toBeUndefined();
            expect(parsed.phone).toBeUndefined();
            expect(parsed.mobilePhone).toBeUndefined();
            expect(parsed.notes).toBeUndefined();
        });

        it("validates complete valid contact with all fields", () => {
            const input = {
                firstName: "  Sarah  ",
                lastName: "  Connor  ",
                title: "  Chief Operations Officer  ",
                email: "SARAH.CONNOR@CYBERDYNE.COM",
                phone: "  +1-555-0100  ",
                mobilePhone: "  +1-555-0199  ",
                isPrimary: true,
                notes: "Key escalation contact for enterprise facilities.\nAvailable 24/7.",
            };

            const parsed = createCustomerContactSchema.parse(input);
            expect(parsed.firstName).toBe("Sarah");
            expect(parsed.lastName).toBe("Connor");
            expect(parsed.title).toBe("Chief Operations Officer");
            expect(parsed.email).toBe("sarah.connor@cyberdyne.com");
            expect(parsed.phone).toBe("+1-555-0100");
            expect(parsed.mobilePhone).toBe("+1-555-0199");
            expect(parsed.isPrimary).toBe(true);
            expect(parsed.notes).toBe("Key escalation contact for enterprise facilities.\nAvailable 24/7.");
        });

        it("rejects missing firstName", () => {
            const input = { lastName: "Doe" };
            const result = createCustomerContactSchema.safeParse(input);
            expect(result.success).toBe(false);
        });

        it("rejects empty or whitespace-only firstName", () => {
            expect(createCustomerContactSchema.safeParse({ firstName: "", lastName: "Doe" }).success).toBe(false);
            expect(createCustomerContactSchema.safeParse({ firstName: "   ", lastName: "Doe" }).success).toBe(false);
        });

        it("rejects missing lastName", () => {
            const input = { firstName: "Jane" };
            const result = createCustomerContactSchema.safeParse(input);
            expect(result.success).toBe(false);
        });

        it("rejects empty or whitespace-only lastName", () => {
            expect(createCustomerContactSchema.safeParse({ firstName: "Jane", lastName: "" }).success).toBe(false);
            expect(createCustomerContactSchema.safeParse({ firstName: "Jane", lastName: "   " }).success).toBe(false);
        });

        it("enforces length boundaries on firstName (max 100)", () => {
            const maxValid = { firstName: "a".repeat(100), lastName: "Doe" };
            expect(createCustomerContactSchema.safeParse(maxValid).success).toBe(true);

            const tooLong = { firstName: "a".repeat(101), lastName: "Doe" };
            const result = createCustomerContactSchema.safeParse(tooLong);
            expect(result.success).toBe(false);
        });

        it("enforces length boundaries on lastName (max 100)", () => {
            const maxValid = { firstName: "Jane", lastName: "b".repeat(100) };
            expect(createCustomerContactSchema.safeParse(maxValid).success).toBe(true);

            const tooLong = { firstName: "Jane", lastName: "b".repeat(101) };
            const result = createCustomerContactSchema.safeParse(tooLong);
            expect(result.success).toBe(false);
        });

        it("enforces length boundaries on title (max 150)", () => {
            const maxValid = { ...validMinimalInput, title: "t".repeat(150) };
            expect(createCustomerContactSchema.safeParse(maxValid).success).toBe(true);

            const tooLong = { ...validMinimalInput, title: "t".repeat(151) };
            expect(createCustomerContactSchema.safeParse(tooLong).success).toBe(false);
        });

        it("enforces length boundaries on phone and mobilePhone (max 50)", () => {
            const maxPhoneValid = { ...validMinimalInput, phone: "1".repeat(50), mobilePhone: "2".repeat(50) };
            expect(createCustomerContactSchema.safeParse(maxPhoneValid).success).toBe(true);

            const tooLongPhone = { ...validMinimalInput, phone: "1".repeat(51) };
            expect(createCustomerContactSchema.safeParse(tooLongPhone).success).toBe(false);

            const tooLongMobile = { ...validMinimalInput, mobilePhone: "2".repeat(51) };
            expect(createCustomerContactSchema.safeParse(tooLongMobile).success).toBe(false);
        });

        it("enforces length boundaries on notes (max 2000)", () => {
            const maxNotesValid = { ...validMinimalInput, notes: "n".repeat(2000) };
            expect(createCustomerContactSchema.safeParse(maxNotesValid).success).toBe(true);

            const tooLongNotes = { ...validMinimalInput, notes: "n".repeat(2001) };
            expect(createCustomerContactSchema.safeParse(tooLongNotes).success).toBe(false);
        });
    });

    describe("2. Email Normalization & Nullability", () => {
        it("normalizes uppercase email to lowercase", () => {
            const parsed = createCustomerContactSchema.parse({
                firstName: "Alex",
                lastName: "Vance",
                email: "ALEX.VANCE@BLACKMESA.ORG",
            });
            expect(parsed.email).toBe("alex.vance@blackmesa.org");
        });

        it("rejects invalid email formats", () => {
            const invalidEmails = ["not-an-email", "test@", "@domain.com", "user@domain..com"];
            for (const email of invalidEmails) {
                const result = createCustomerContactSchema.safeParse({
                    firstName: "Alex",
                    lastName: "Vance",
                    email,
                });
                expect(result.success).toBe(false);
            }
        });

        it("enforces max 100 characters on email", () => {
            const longLocal = "a".repeat(90);
            const longEmail = `${longLocal}@example.com`; // 102 chars
            const result = createCustomerContactSchema.safeParse({
                firstName: "Alex",
                lastName: "Vance",
                email: longEmail,
            });
            expect(result.success).toBe(false);
        });

        it("allows explicit null for nullable optional fields", () => {
            const input = {
                firstName: "Alex",
                lastName: "Vance",
                title: null,
                email: null,
                phone: null,
                mobilePhone: null,
                notes: null,
            };
            const parsed = createCustomerContactSchema.parse(input);
            expect(parsed.title).toBeNull();
            expect(parsed.email).toBeNull();
            expect(parsed.phone).toBeNull();
            expect(parsed.mobilePhone).toBeNull();
            expect(parsed.notes).toBeNull();
        });
    });

    describe("3. isPrimary Boolean Validation", () => {
        it("accepts true and false boolean values", () => {
            const withTrue = createCustomerContactSchema.parse({ firstName: "A", lastName: "B", isPrimary: true });
            expect(withTrue.isPrimary).toBe(true);

            const withFalse = createCustomerContactSchema.parse({ firstName: "A", lastName: "B", isPrimary: false });
            expect(withFalse.isPrimary).toBe(false);
        });

        it("rejects non-boolean values for isPrimary", () => {
            expect(createCustomerContactSchema.safeParse({ firstName: "A", lastName: "B", isPrimary: "yes" }).success).toBe(false);
            expect(createCustomerContactSchema.safeParse({ firstName: "A", lastName: "B", isPrimary: 1 }).success).toBe(false);
        });
    });

    describe("4. System-Managed Field Protection", () => {
        it("strips system-controlled fields from output payload", () => {
            const maliciousPayload = {
                firstName: "John",
                lastName: "Smith",
                id: "forged-id-123",
                customerId: "cust-another-corp",
                workspaceId: "ws-another-workspace",
                createdAt: new Date(),
                updatedAt: new Date(),
            };

            const parsed: any = createCustomerContactSchema.parse(maliciousPayload);
            expect(parsed.firstName).toBe("John");
            expect(parsed.lastName).toBe("Smith");
            expect(parsed.id).toBeUndefined();
            expect(parsed.customerId).toBeUndefined();
            expect(parsed.workspaceId).toBeUndefined();
            expect(parsed.createdAt).toBeUndefined();
            expect(parsed.updatedAt).toBeUndefined();
        });
    });

    describe("5. updateCustomerContactSchema — Partial Update Behaviors", () => {
        it("accepts an empty update object {}", () => {
            const result = updateCustomerContactSchema.safeParse({});
            expect(result.success).toBe(true);
            expect(result.data).toEqual({});
        });

        it("validates partial updates of single or multiple fields", () => {
            const result = updateCustomerContactSchema.parse({
                firstName: "  UpdatedFirst  ",
                isPrimary: true,
            });
            expect(result.firstName).toBe("UpdatedFirst");
            expect(result.isPrimary).toBe(true);
            expect(result.lastName).toBeUndefined();
        });

        it("allows explicitly clearing nullable fields to null", () => {
            const clearPayload = {
                title: null,
                email: null,
                phone: null,
                mobilePhone: null,
                notes: null,
            };
            const parsed = updateCustomerContactSchema.parse(clearPayload);
            expect(parsed.title).toBeNull();
            expect(parsed.email).toBeNull();
            expect(parsed.phone).toBeNull();
            expect(parsed.mobilePhone).toBeNull();
            expect(parsed.notes).toBeNull();
        });

        it("rejects invalid partial update values", () => {
            expect(updateCustomerContactSchema.safeParse({ firstName: "" }).success).toBe(false);
            expect(updateCustomerContactSchema.safeParse({ email: "invalid-email" }).success).toBe(false);
            expect(updateCustomerContactSchema.safeParse({ title: "t".repeat(151) }).success).toBe(false);
        });
    });

    describe("6. customerContactQuerySchema — Pagination, Search & Sorting", () => {
        it("applies query defaults (page 1, pageSize 20, sortBy createdAt, sortOrder asc)", () => {
            const parsed = customerContactQuerySchema.parse({});
            expect(parsed.page).toBe(1);
            expect(parsed.pageSize).toBe(20);
            expect(parsed.sortBy).toBe("createdAt");
            expect(parsed.sortOrder).toBe("asc");
            expect(parsed.search).toBeUndefined();
            expect(parsed.isPrimary).toBeUndefined();
        });

        it("coerces numeric page and pageSize from query string inputs", () => {
            const parsed = customerContactQuerySchema.parse({
                page: "3",
                pageSize: "50",
            });
            expect(parsed.page).toBe(3);
            expect(parsed.pageSize).toBe(50);
        });

        it("enforces pageSize upper limit of 100", () => {
            expect(customerContactQuerySchema.safeParse({ pageSize: 100 }).success).toBe(true);
            expect(customerContactQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
        });

        it("rejects non-positive page or pageSize", () => {
            expect(customerContactQuerySchema.safeParse({ page: 0 }).success).toBe(false);
            expect(customerContactQuerySchema.safeParse({ page: -1 }).success).toBe(false);
            expect(customerContactQuerySchema.safeParse({ pageSize: 0 }).success).toBe(false);
        });

        it("validates search query trimming and max length (100)", () => {
            const parsed = customerContactQuerySchema.parse({ search: "  Operations Lead  " });
            expect(parsed.search).toBe("Operations Lead");

            expect(customerContactQuerySchema.safeParse({ search: "s".repeat(100) }).success).toBe(true);
            expect(customerContactQuerySchema.safeParse({ search: "s".repeat(101) }).success).toBe(false);
        });

        it("handles isPrimary query filter as boolean or string ('true' / 'false')", () => {
            expect(customerContactQuerySchema.parse({ isPrimary: true }).isPrimary).toBe(true);
            expect(customerContactQuerySchema.parse({ isPrimary: false }).isPrimary).toBe(false);
            expect(customerContactQuerySchema.parse({ isPrimary: "true" }).isPrimary).toBe(true);
            expect(customerContactQuerySchema.parse({ isPrimary: "false" }).isPrimary).toBe(false);
        });

        it("whitelists allowed sortBy fields and rejects unlisted fields", () => {
            const allowedSortFields = ["firstName", "lastName", "email", "createdAt", "updatedAt", "isPrimary"];
            for (const field of allowedSortFields) {
                const result = customerContactQuerySchema.safeParse({ sortBy: field });
                expect(result.success).toBe(true);
            }

            const rejectedSortFields = ["status", "salary", "password", "customerId", "workspaceId"];
            for (const field of rejectedSortFields) {
                const result = customerContactQuerySchema.safeParse({ sortBy: field });
                expect(result.success).toBe(false);
            }
        });

        it("validates sortOrder ('asc' | 'desc') and rejects invalid values", () => {
            expect(customerContactQuerySchema.safeParse({ sortOrder: "asc" }).success).toBe(true);
            expect(customerContactQuerySchema.safeParse({ sortOrder: "desc" }).success).toBe(true);
            expect(customerContactQuerySchema.safeParse({ sortOrder: "ascending" }).success).toBe(false);
        });

        it("verifies alias getCustomerContactsQuerySchema works identically", () => {
            const parsed = getCustomerContactsQuerySchema.parse({ page: 2, pageSize: 25 });
            expect(parsed.page).toBe(2);
            expect(parsed.pageSize).toBe(25);
        });
    });
});
