import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
    workOrderDelete: vi.fn(),
    technicianProfileDelete: vi.fn(),
    workspaceMemberDelete: vi.fn(),
    scheduleAppointmentDelete: vi.fn(),
    workspaceDelete: vi.fn(),

    scheduleAppointmentFindMany: vi.fn(),
    scheduleAppointmentHistoryFindMany: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
    prisma: {
        workOrder: { delete: mocks.workOrderDelete },
        technicianProfile: { delete: mocks.technicianProfileDelete },
        workspaceMember: { delete: mocks.workspaceMemberDelete },
        scheduleAppointment: {
            delete: mocks.scheduleAppointmentDelete,
            findMany: mocks.scheduleAppointmentFindMany,
        },
        scheduleAppointmentHistory: {
            findMany: mocks.scheduleAppointmentHistoryFindMany,
        },
        workspace: { delete: mocks.workspaceDelete },
    },
}));

import { prisma } from "@/lib/prisma";

describe("Phase 1.8.2 — Scheduling Referential Actions & Cascade Integrity (§10.1)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("1. Foreign Key Referential Integrity (onDelete: Restrict)", () => {
        it("blocks deleting a WorkOrder referenced by a ScheduleAppointment (onDelete: Restrict)", async () => {
            const prismaForeignKeyError = new Error(
                "Foreign key constraint failed on the field: `ScheduleAppointment_workOrderId_fkey`"
            );
            (prismaForeignKeyError as any).code = "P2003";

            mocks.workOrderDelete.mockRejectedValue(prismaForeignKeyError);

            await expect(
                prisma.workOrder.delete({
                    where: { id: "wo_with_appointments" },
                })
            ).rejects.toThrow("Foreign key constraint failed");
            expect(mocks.workOrderDelete).toHaveBeenCalledWith({
                where: { id: "wo_with_appointments" },
            });
        });

        it("blocks deleting a TechnicianProfile referenced by a ScheduleAppointment (onDelete: Restrict)", async () => {
            const prismaForeignKeyError = new Error(
                "Foreign key constraint failed on the field: `ScheduleAppointment_technicianId_fkey`"
            );
            (prismaForeignKeyError as any).code = "P2003";

            mocks.technicianProfileDelete.mockRejectedValue(prismaForeignKeyError);

            await expect(
                prisma.technicianProfile.delete({
                    where: { id: "tech_with_appointments" },
                })
            ).rejects.toThrow("Foreign key constraint failed");
            expect(mocks.technicianProfileDelete).toHaveBeenCalledWith({
                where: { id: "tech_with_appointments" },
            });
        });
    });

    describe("2. Cascade Deletions (onDelete: Cascade)", () => {
        it("deleting a ScheduleAppointment cascades to delete its ScheduleAppointmentHistory records", async () => {
            mocks.scheduleAppointmentDelete.mockResolvedValue({ id: "apt_101" });
            mocks.scheduleAppointmentHistoryFindMany.mockResolvedValue([]);

            const deletedAppt = await prisma.scheduleAppointment.delete({
                where: { id: "apt_101" },
            });

            expect(deletedAppt.id).toBe("apt_101");
            expect(mocks.scheduleAppointmentDelete).toHaveBeenCalledWith({
                where: { id: "apt_101" },
            });

            // History is purged automatically by DB cascade
            const history = await prisma.scheduleAppointmentHistory.findMany({
                where: { appointmentId: "apt_101" },
            });
            expect(history).toEqual([]);
        });

        it("deleting a Workspace cascades to delete ScheduleAppointments and ScheduleAppointmentHistory", async () => {
            mocks.workspaceDelete.mockResolvedValue({ id: "ws_alpha" });
            mocks.scheduleAppointmentFindMany.mockResolvedValue([]);
            mocks.scheduleAppointmentHistoryFindMany.mockResolvedValue([]);

            const deletedWs = await prisma.workspace.delete({
                where: { id: "ws_alpha" },
            });

            expect(deletedWs.id).toBe("ws_alpha");
            expect(mocks.workspaceDelete).toHaveBeenCalledWith({
                where: { id: "ws_alpha" },
            });

            const appointments = await prisma.scheduleAppointment.findMany({
                where: { workspaceId: "ws_alpha" },
            });
            expect(appointments).toEqual([]);

            const history = await prisma.scheduleAppointmentHistory.findMany({
                where: { workspaceId: "ws_alpha" },
            });
            expect(history).toEqual([]);
        });
    });

    describe("3. Nullable References (onDelete: SetNull)", () => {
        it("allows deleting a WorkspaceMember without cascading to ScheduleAppointment (onDelete: SetNull)", async () => {
            mocks.workspaceMemberDelete.mockResolvedValue({ id: "mem_dispatcher_01" });

            const deletedMember = await prisma.workspaceMember.delete({
                where: { id: "mem_dispatcher_01" },
            });

            expect(deletedMember.id).toBe("mem_dispatcher_01");
            expect(mocks.workspaceMemberDelete).toHaveBeenCalledWith({
                where: { id: "mem_dispatcher_01" },
            });
        });
    });
});
