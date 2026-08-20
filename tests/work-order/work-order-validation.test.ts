import { describe, expect, it } from "vitest";
import {
    WORK_ORDER_STATUSES,
    WORK_ORDER_PRIORITIES,
    workOrderStatusSchema,
    workOrderPrioritySchema,
    createWorkOrderSchema,
    updateWorkOrderSchema,
    assignWorkOrderSchema,
    statusTransitionSchema,
    workOrderQuerySchema,
} from "@/lib/validations/workOrder";

describe("Phase 1.6.3 — WorkOrder Validation Layer", () => {
    describe("WorkOrder Status Schema (`workOrderStatusSchema`)", () => {
        it("accepts all valid WorkOrderStatus values", () => {
            for (const status of WORK_ORDER_STATUSES) {
                expect(workOrderStatusSchema.parse(status)).toBe(status);
            }
        });

        it("rejects invalid status values", () => {
            expect(() => workOrderStatusSchema.parse("PENDING")).toThrow();
            expect(() => workOrderStatusSchema.parse("DELETED")).toThrow();
            expect(() => workOrderStatusSchema.parse("ARCHIVED")).toThrow();
            expect(() => workOrderStatusSchema.parse("")).toThrow();
            expect(() => workOrderStatusSchema.parse(null)).toThrow();
            expect(() => workOrderStatusSchema.parse(undefined)).toThrow();
        });

        it("exports the exact list of WORK_ORDER_STATUSES", () => {
            expect(WORK_ORDER_STATUSES).toEqual([
                "OPEN",
                "ASSIGNED",
                "IN_PROGRESS",
                "ON_HOLD",
                "COMPLETED",
                "CANCELLED",
            ]);
        });
    });

    describe("WorkOrder Priority Schema (`workOrderPrioritySchema`)", () => {
        it("accepts all valid WorkOrderPriority values", () => {
            for (const priority of WORK_ORDER_PRIORITIES) {
                expect(workOrderPrioritySchema.parse(priority)).toBe(priority);
            }
        });

        it("rejects invalid priority values", () => {
            expect(() => workOrderPrioritySchema.parse("CRITICAL")).toThrow();
            expect(() => workOrderPrioritySchema.parse("NORMAL")).toThrow();
            expect(() => workOrderPrioritySchema.parse("")).toThrow();
            expect(() => workOrderPrioritySchema.parse(null)).toThrow();
            expect(() => workOrderPrioritySchema.parse(undefined)).toThrow();
        });

        it("exports the exact list of WORK_ORDER_PRIORITIES", () => {
            expect(WORK_ORDER_PRIORITIES).toEqual([
                "LOW",
                "MEDIUM",
                "HIGH",
                "URGENT",
            ]);
        });
    });

    describe("WorkOrder Create Schema (`createWorkOrderSchema`)", () => {
        const validPayload = {
            customerId: "cust_cuid_123",
            locationId: "loc_cuid_456",
            workTypeId: "wt_cuid_789",
            title: "HVAC Emergency Compressor Replacement",
            priority: "HIGH" as const,
            description: "Main compressor failure in building B",
            internalNotes: "Requires 2-man lift crew",
        };

        it("accepts a complete valid creation payload", () => {
            const result = createWorkOrderSchema.parse(validPayload);
            expect(result.customerId).toBe("cust_cuid_123");
            expect(result.locationId).toBe("loc_cuid_456");
            expect(result.workTypeId).toBe("wt_cuid_789");
            expect(result.title).toBe("HVAC Emergency Compressor Replacement");
            expect(result.priority).toBe("HIGH");
            expect(result.description).toBe("Main compressor failure in building B");
            expect(result.internalNotes).toBe("Requires 2-man lift crew");
        });

        it("defaults priority to MEDIUM when omitted", () => {
            const result = createWorkOrderSchema.parse({
                customerId: "cust_cuid_123",
                locationId: "loc_cuid_456",
                workTypeId: "wt_cuid_789",
                title: "Routine Filter Inspection",
            });
            expect(result.priority).toBe("MEDIUM");
            expect(result.description).toBeUndefined();
            expect(result.internalNotes).toBeUndefined();
        });

        it("rejects when required fields are missing or empty", () => {
            expect(() =>
                createWorkOrderSchema.parse({
                    locationId: "loc_cuid_456",
                    workTypeId: "wt_cuid_789",
                    title: "Test",
                }),
            ).toThrow();

            expect(() =>
                createWorkOrderSchema.parse({
                    ...validPayload,
                    customerId: "",
                }),
            ).toThrow(/Customer ID is required/);

            expect(() =>
                createWorkOrderSchema.parse({
                    ...validPayload,
                    locationId: "   ",
                }),
            ).toThrow(/Location ID is required/);

            expect(() =>
                createWorkOrderSchema.parse({
                    ...validPayload,
                    workTypeId: "",
                }),
            ).toThrow(/Work type ID is required/);

            expect(() =>
                createWorkOrderSchema.parse({
                    ...validPayload,
                    title: "   ",
                }),
            ).toThrow(/Title must not be empty/);
        });

        it("rejects a payload containing snapshot fields (workTypeName, workTypeCode, estimatedDuration)", () => {
            expect(() =>
                createWorkOrderSchema.parse({
                    ...validPayload,
                    workTypeName: "Overridden Work Type Name",
                }),
            ).toThrow();

            expect(() =>
                createWorkOrderSchema.parse({
                    ...validPayload,
                    workTypeCode: "OVERRIDE-01",
                }),
            ).toThrow();

            expect(() =>
                createWorkOrderSchema.parse({
                    ...validPayload,
                    estimatedDuration: 120,
                }),
            ).toThrow();
        });

        it("rejects a payload containing lifecycle or assignment fields", () => {
            expect(() =>
                createWorkOrderSchema.parse({
                    ...validPayload,
                    assignedTechnicianId: "tech_cuid_999",
                }),
            ).toThrow();

            expect(() =>
                createWorkOrderSchema.parse({
                    ...validPayload,
                    status: "ASSIGNED",
                }),
            ).toThrow();

            expect(() =>
                createWorkOrderSchema.parse({
                    ...validPayload,
                    startedAt: new Date(),
                }),
            ).toThrow();

            expect(() =>
                createWorkOrderSchema.parse({
                    ...validPayload,
                    holdReason: "Waiting on parts",
                }),
            ).toThrow();

            expect(() =>
                createWorkOrderSchema.parse({
                    ...validPayload,
                    workOrderNumber: "WO-2026-999999",
                }),
            ).toThrow();
        });
    });

    describe("WorkOrder Update Schema (`updateWorkOrderSchema`)", () => {
        it("accepts valid partial update fields", () => {
            const result = updateWorkOrderSchema.parse({
                title: "Updated Title",
                priority: "URGENT",
                description: "Updated description text",
                internalNotes: "Updated internal notes",
            });
            expect(result.title).toBe("Updated Title");
            expect(result.priority).toBe("URGENT");
            expect(result.description).toBe("Updated description text");
            expect(result.internalNotes).toBe("Updated internal notes");
        });

        it("accepts single-field update", () => {
            const result = updateWorkOrderSchema.parse({
                priority: "LOW",
            });
            expect(result.priority).toBe("LOW");
        });

        it("rejects a payload containing status", () => {
            expect(() =>
                updateWorkOrderSchema.parse({
                    title: "Updated Title",
                    status: "IN_PROGRESS",
                }),
            ).toThrow();
        });

        it("rejects a payload containing assignment or snapshot fields", () => {
            expect(() =>
                updateWorkOrderSchema.parse({
                    assignedTechnicianId: "tech_cuid_123",
                }),
            ).toThrow();

            expect(() =>
                updateWorkOrderSchema.parse({
                    workTypeName: "Illegal Snapshot Change",
                }),
            ).toThrow();

            expect(() =>
                updateWorkOrderSchema.parse({
                    customerId: "cust_cuid_new",
                }),
            ).toThrow();
        });
    });

    describe("WorkOrder Assignment Schema (`assignWorkOrderSchema`)", () => {
        it("accepts a valid assignment payload", () => {
            const result = assignWorkOrderSchema.parse({
                technicianId: "tech_profile_cuid_101",
            });
            expect(result.technicianId).toBe("tech_profile_cuid_101");
        });

        it("rejects empty or whitespace-only technicianId", () => {
            expect(() =>
                assignWorkOrderSchema.parse({
                    technicianId: "   ",
                }),
            ).toThrow(/Technician ID is required/);
        });

        it("rejects unknown extraneous fields", () => {
            expect(() =>
                assignWorkOrderSchema.parse({
                    technicianId: "tech_101",
                    status: "ASSIGNED",
                }),
            ).toThrow();
        });
    });

    describe("WorkOrder Status Transition Schema (`statusTransitionSchema`)", () => {
        it("accepts simple transitions without required reasons", () => {
            expect(statusTransitionSchema.parse({ toStatus: "IN_PROGRESS" })).toEqual({
                toStatus: "IN_PROGRESS",
            });
            expect(statusTransitionSchema.parse({ toStatus: "COMPLETED" })).toEqual({
                toStatus: "COMPLETED",
            });
            expect(statusTransitionSchema.parse({ toStatus: "ASSIGNED" })).toEqual({
                toStatus: "ASSIGNED",
            });
        });

        it("requires holdReason when toStatus = ON_HOLD", () => {
            const result = statusTransitionSchema.parse({
                toStatus: "ON_HOLD",
                holdReason: "Awaiting customer approval on additional parts cost",
            });
            expect(result.toStatus).toBe("ON_HOLD");
            expect(result.holdReason).toBe("Awaiting customer approval on additional parts cost");
        });

        it("rejects when toStatus = ON_HOLD and holdReason is missing or empty", () => {
            expect(() =>
                statusTransitionSchema.parse({
                    toStatus: "ON_HOLD",
                }),
            ).toThrow(/Hold reason is required when transitioning to ON_HOLD/);

            expect(() =>
                statusTransitionSchema.parse({
                    toStatus: "ON_HOLD",
                    holdReason: "   ",
                }),
            ).toThrow(/Hold reason is required when transitioning to ON_HOLD/);
        });

        it("requires cancellationReason when toStatus = CANCELLED", () => {
            const result = statusTransitionSchema.parse({
                toStatus: "CANCELLED",
                cancellationReason: "Customer requested cancellation prior to tech dispatch",
            });
            expect(result.toStatus).toBe("CANCELLED");
            expect(result.cancellationReason).toBe(
                "Customer requested cancellation prior to tech dispatch",
            );
        });

        it("rejects when toStatus = CANCELLED and cancellationReason is missing or empty", () => {
            expect(() =>
                statusTransitionSchema.parse({
                    toStatus: "CANCELLED",
                }),
            ).toThrow(/Cancellation reason is required when transitioning to CANCELLED/);

            expect(() =>
                statusTransitionSchema.parse({
                    toStatus: "CANCELLED",
                    cancellationReason: "   ",
                }),
            ).toThrow(/Cancellation reason is required when transitioning to CANCELLED/);
        });

        it("rejects extraneous fields via .strict()", () => {
            expect(() =>
                statusTransitionSchema.parse({
                    toStatus: "COMPLETED",
                    completedAt: new Date(),
                }),
            ).toThrow();
        });
    });

    describe("WorkOrder Directory Query Schema (`workOrderQuerySchema`)", () => {
        it("applies default pagination and sorting when query is empty", () => {
            const result = workOrderQuerySchema.parse({});
            expect(result.page).toBe(1);
            expect(result.pageSize).toBe(20);
            expect(result.sortBy).toBe("createdAt");
            expect(result.sortOrder).toBe("desc");
        });

        it("accepts valid filters, pagination, and sorting", () => {
            const result = workOrderQuerySchema.parse({
                search: "compressor",
                customerId: "cust_123",
                locationId: "loc_456",
                workTypeId: "wt_789",
                assignedTechnicianId: "tech_101",
                status: "IN_PROGRESS",
                priority: "URGENT",
                page: "2",
                pageSize: "50",
                sortBy: "priority",
                sortOrder: "asc",
            });
            expect(result.search).toBe("compressor");
            expect(result.customerId).toBe("cust_123");
            expect(result.locationId).toBe("loc_456");
            expect(result.workTypeId).toBe("wt_789");
            expect(result.assignedTechnicianId).toBe("tech_101");
            expect(result.status).toBe("IN_PROGRESS");
            expect(result.priority).toBe("URGENT");
            expect(result.page).toBe(2);
            expect(result.pageSize).toBe(50);
            expect(result.sortBy).toBe("priority");
            expect(result.sortOrder).toBe("asc");
        });

        it("rejects pageSize > 100", () => {
            expect(() =>
                workOrderQuerySchema.parse({
                    pageSize: 101,
                }),
            ).toThrow(/Page size must not exceed 100/);
        });

        it("rejects arbitrary / non-allow-listed sortBy value", () => {
            expect(() =>
                workOrderQuerySchema.parse({
                    sortBy: "arbitrarySecretColumn",
                }),
            ).toThrow();

            expect(() =>
                workOrderQuerySchema.parse({
                    sortBy: "internalNotes",
                }),
            ).toThrow();
        });
    });
});
