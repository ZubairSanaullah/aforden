import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@/generated/prisma/client";

// =============================================================================
// Stateful In-Memory Database Simulator for Prisma
// =============================================================================

class StatefulDatabase {
    users = new Map<string, any>();
    workspaces = new Map<string, any>();
    workspaceMembers = new Map<string, any>();
    customers = new Map<string, any>();
    customerContacts = new Map<string, any>();
    serviceLocations = new Map<string, any>();
    serviceCatalogs = new Map<string, any>();
    workTypes = new Map<string, any>();
    workOrders = new Map<string, any>();
    workOrderHistories = new Map<string, any>();
    workOrderParts = new Map<string, any>();
    quotes = new Map<string, any>();
    quoteLineItems = new Map<string, any>();
    quoteHistories = new Map<string, any>();
    invoices = new Map<string, any>();
    invoiceLineItems = new Map<string, any>();
    invoiceHistories = new Map<string, any>();
    payments = new Map<string, any>();
    parts = new Map<string, any>();
    inventoryLocations = new Map<string, any>();
    inventoryBalances = new Map<string, any>();
    stockMovements = new Map<string, any>();
    technicianProfiles = new Map<string, any>();
    technicianTimeEntries = new Map<string, any>();
    scheduleAppointments = new Map<string, any>();
    scheduleAppointmentHistories = new Map<string, any>();
    employees = new Map<string, any>();
    subscriptions = new Map<string, any>();
    workspaceEntitlementOverrides = new Map<string, any>();

    reset() {
        this.users.clear();
        this.workspaces.clear();
        this.workspaceMembers.clear();
        this.customers.clear();
        this.customerContacts.clear();
        this.serviceLocations.clear();
        this.serviceCatalogs.clear();
        this.workTypes.clear();
        this.workOrders.clear();
        this.workOrderHistories.clear();
        this.workOrderParts.clear();
        this.quotes.clear();
        this.quoteLineItems.clear();
        this.quoteHistories.clear();
        this.invoices.clear();
        this.invoiceLineItems.clear();
        this.invoiceHistories.clear();
        this.payments.clear();
        this.parts.clear();
        this.inventoryLocations.clear();
        this.inventoryBalances.clear();
        this.stockMovements.clear();
        this.technicianProfiles.clear();
        this.technicianTimeEntries.clear();
        this.scheduleAppointments.clear();
        this.scheduleAppointmentHistories.clear();
        this.employees.clear();
        this.subscriptions.clear();
        this.workspaceEntitlementOverrides.clear();
    }
}

const db = new StatefulDatabase();

let idCounter = 1000;
function genId(prefix: string) {
    idCounter += 1;
    return `${prefix}_${idCounter}`;
}

const { authMock } = vi.hoisted(() => ({
    authMock: vi.fn(),
}));

vi.mock("@/auth", () => ({ auth: authMock }));

vi.mock("@/lib/prisma", () => {
    const createPrismaProxy = () => {
        const client: any = {
            user: {
                findUnique: vi.fn(async ({ where }: any) => {
                    if (where.id) return db.users.get(where.id) || null;
                    if (where.email) return Array.from(db.users.values()).find(u => u.email === where.email) || null;
                    return null;
                }),
                create: vi.fn(async ({ data }: any) => {
                    const record = { id: data.id || genId("usr"), ...data, createdAt: new Date(), updatedAt: new Date() };
                    db.users.set(record.id, record);
                    return record;
                }),
                count: vi.fn(async () => db.users.size),
            },
            workspace: {
                findUnique: vi.fn(async ({ where }: any) => {
                    if (where.id) return db.workspaces.get(where.id) || null;
                    return null;
                }),
                create: vi.fn(async ({ data }: any) => {
                    const record = { id: data.id || genId("ws"), ...data, createdAt: new Date(), updatedAt: new Date() };
                    db.workspaces.set(record.id, record);
                    return record;
                }),
            },
            workspaceMember: {
                findUnique: vi.fn(async ({ where }: any) => {
                    if (where.userId_workspaceId) {
                        const { userId, workspaceId } = where.userId_workspaceId;
                        return Array.from(db.workspaceMembers.values()).find(
                            m => m.userId === userId && m.workspaceId === workspaceId
                        ) || null;
                    }
                    if (where.id) return db.workspaceMembers.get(where.id) || null;
                    return null;
                }),
                findFirst: vi.fn(async ({ where }: any) => {
                    return Array.from(db.workspaceMembers.values()).find(m => {
                        if (where.workspaceId && m.workspaceId !== where.workspaceId) return false;
                        if (where.userId && m.userId !== where.userId) return false;
                        if (where.status && m.status !== where.status) return false;
                        return true;
                    }) || null;
                }),
                count: vi.fn(async () => db.workspaceMembers.size),
            },
            customer: {
                findFirst: vi.fn(async ({ where }: any) => {
                    return Array.from(db.customers.values()).find(c => {
                        if (where.id && c.id !== where.id) return false;
                        if (where.workspaceId && c.workspaceId !== where.workspaceId) return false;
                        if (where.customerNumber && c.customerNumber !== where.customerNumber) return false;
                        return true;
                    }) || null;
                }),
                findUnique: vi.fn(async ({ where }: any) => db.customers.get(where.id) || null),
                create: vi.fn(async ({ data }: any) => {
                    const record = { id: data.id || genId("cust"), status: "ACTIVE", ...data, createdAt: new Date(), updatedAt: new Date() };
                    db.customers.set(record.id, record);
                    return record;
                }),
                count: vi.fn(async () => db.customers.size),
            },
            serviceLocation: {
                findFirst: vi.fn(async ({ where }: any) => {
                    return Array.from(db.serviceLocations.values()).find(l => {
                        if (where.id && l.id !== where.id) return false;
                        if (where.workspaceId && l.workspaceId !== where.workspaceId) return false;
                        if (where.customerId && l.customerId !== where.customerId) return false;
                        if (where.isPrimary !== undefined && l.isPrimary !== where.isPrimary) return false;
                        return true;
                    }) || null;
                }),
                findMany: vi.fn(async ({ where }: any) => {
                    return Array.from(db.serviceLocations.values()).filter(l => {
                        if (where.workspaceId && l.workspaceId !== where.workspaceId) return false;
                        if (where.customerId && l.customerId !== where.customerId) return false;
                        return true;
                    });
                }),
                create: vi.fn(async ({ data }: any) => {
                    const record = { id: data.id || genId("loc"), status: "ACTIVE", ...data, createdAt: new Date(), updatedAt: new Date() };
                    db.serviceLocations.set(record.id, record);
                    return record;
                }),
                count: vi.fn(async () => db.serviceLocations.size),
            },
            serviceCatalog: {
                findFirst: vi.fn(async ({ where }: any) => {
                    return Array.from(db.serviceCatalogs.values()).find(sc => {
                        if (where.id && sc.id !== where.id) return false;
                        if (where.workspaceId && sc.workspaceId !== where.workspaceId) return false;
                        return true;
                    }) || null;
                }),
                findUnique: vi.fn(async ({ where }: any) => db.serviceCatalogs.get(where.id) || null),
                create: vi.fn(async ({ data }: any) => {
                    const record = { id: data.id || genId("cat"), ...data, createdAt: new Date(), updatedAt: new Date() };
                    db.serviceCatalogs.set(record.id, record);
                    return record;
                }),
            },
            workType: {
                findFirst: vi.fn(async ({ where, include }: any) => {
                    const wt = Array.from(db.workTypes.values()).find(item => {
                        if (where.id && item.id !== where.id) return false;
                        if (where.workspaceId && item.workspaceId !== where.workspaceId) return false;
                        if (where.code && item.code !== where.code) return false;
                        return true;
                    });
                    if (!wt) return null;
                    const res = { ...wt };
                    if (include?.catalog) res.catalog = db.serviceCatalogs.get(wt.catalogId);
                    return res;
                }),
                findUnique: vi.fn(async ({ where }: any) => db.workTypes.get(where.id) || null),
                create: vi.fn(async ({ data, include }: any) => {
                    const record = { id: data.id || genId("wt"), status: "ACTIVE", ...data, createdAt: new Date(), updatedAt: new Date() };
                    db.workTypes.set(record.id, record);
                    const res = { ...record };
                    if (include?.catalog) res.catalog = db.serviceCatalogs.get(record.catalogId);
                    return res;
                }),
            },
            workOrder: {
                findFirst: vi.fn(async ({ where, include }: any) => {
                    const wo = Array.from(db.workOrders.values()).find(w => {
                        if (where.id && w.id !== where.id) return false;
                        if (where.workspaceId && w.workspaceId !== where.workspaceId) return false;
                        return true;
                    });
                    if (!wo) return null;
                    const res = { ...wo };
                    if (include?.customer) res.customer = db.customers.get(wo.customerId);
                    if (include?.location) res.location = db.serviceLocations.get(wo.locationId);
                    if (include?.workType) res.workType = db.workTypes.get(wo.workTypeId);
                    return res;
                }),
                findUnique: vi.fn(async ({ where }: any) => db.workOrders.get(where.id) || null),
                create: vi.fn(async ({ data, include }: any) => {
                    const record = {
                        id: data.id || genId("wo"),
                        workOrderNumber: data.workOrderNumber || `WO-${Math.floor(Math.random() * 90000 + 10000)}`,
                        status: "OPEN",
                        assignedTechnicianId: null,
                        startedAt: null,
                        completedAt: null,
                        holdReason: null,
                        cancellationReason: null,
                        ...data,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    };
                    db.workOrders.set(record.id, record);
                    const res = { ...record };
                    if (include?.customer) res.customer = db.customers.get(record.customerId);
                    if (include?.location) res.location = db.serviceLocations.get(record.locationId);
                    if (include?.workType) res.workType = db.workTypes.get(record.workTypeId);
                    return res;
                }),
                update: vi.fn(async ({ where, data, include }: any) => {
                    const existing = db.workOrders.get(where.id);
                    if (!existing) throw new Error("WorkOrder not found");
                    const updated = { ...existing, ...data, updatedAt: new Date() };
                    db.workOrders.set(where.id, updated);
                    const res = { ...updated };
                    if (include?.customer) res.customer = db.customers.get(updated.customerId);
                    if (include?.location) res.location = db.serviceLocations.get(updated.locationId);
                    if (include?.workType) res.workType = db.workTypes.get(updated.workTypeId);
                    return res;
                }),
                count: vi.fn(async () => db.workOrders.size),
            },
            workOrderHistory: {
                create: vi.fn(async ({ data }: any) => {
                    const record = { id: data.id || genId("woh"), ...data, createdAt: new Date() };
                    db.workOrderHistories.set(record.id, record);
                    return record;
                }),
                update: vi.fn(async ({ where, data }: any) => {
                    const existing = db.workOrderHistories.get(where.id);
                    const updated = { ...existing, ...data, updatedAt: new Date() };
                    db.workOrderHistories.set(where.id, updated);
                    return updated;
                }),
                findFirst: vi.fn(async ({ where }: any) => {
                    return Array.from(db.workOrderHistories.values()).find(h => {
                        if (where.id && h.id !== where.id) return false;
                        if (where.workOrderId && h.workOrderId !== where.workOrderId) return false;
                        return true;
                    }) || null;
                }),
            },
            employee: {
                findFirst: vi.fn(async ({ where }: any) => {
                    return Array.from(db.employees.values()).find(e => {
                        if (where.workspaceMemberId && e.workspaceMemberId !== where.workspaceMemberId) return false;
                        if (where.workspaceId && e.workspaceId !== where.workspaceId) return false;
                        return true;
                    }) || null;
                }),
            },
            technicianProfile: {
                findFirst: vi.fn(async ({ where, include }: any) => {
                    const tp = Array.from(db.technicianProfiles.values()).find(item => {
                        if (where.id && item.id !== where.id) return false;
                        if (where.employee?.workspaceId && item.employee?.workspaceId !== where.employee.workspaceId) return false;
                        if (where.employee?.workspaceMemberId && item.employee?.workspaceMemberId !== where.employee.workspaceMemberId) return false;
                        return true;
                    });
                    if (!tp) return null;
                    const res = { ...tp };
                    if (include?.employee) res.employee = db.employees.get(tp.employeeId);
                    return res;
                }),
                count: vi.fn(async () => db.technicianProfiles.size),
            },
            technicianTimeEntry: {
                findFirst: vi.fn(async ({ where }: any) => {
                    return Array.from(db.technicianTimeEntries.values()).find(tte => {
                        if (where.workspaceId && tte.workspaceId !== where.workspaceId) return false;
                        if (where.technicianProfileId && tte.technicianProfileId !== where.technicianProfileId) return false;
                        if (where.status && tte.status !== where.status) return false;
                        return true;
                    }) || null;
                }),
                create: vi.fn(async ({ data }: any) => {
                    const record = {
                        id: data.id || genId("tte"),
                        status: "ACTIVE",
                        startedAt: data.startedAt || new Date(),
                        endedAt: null,
                        durationMinutes: null,
                        ...data,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    };
                    db.technicianTimeEntries.set(record.id, record);
                    return record;
                }),
                update: vi.fn(async ({ where, data }: any) => {
                    const existing = db.technicianTimeEntries.get(where.id);
                    const updated = { ...existing, ...data, updatedAt: new Date() };
                    db.technicianTimeEntries.set(where.id, updated);
                    return updated;
                }),
            },
            scheduleAppointment: {
                findFirst: vi.fn(async ({ where, include }: any) => {
                    const sa = Array.from(db.scheduleAppointments.values()).find(item => {
                        if (where.id && item.id !== where.id) return false;
                        if (where.workOrderId && item.workOrderId !== where.workOrderId) return false;
                        if (where.workspaceId && item.workspaceId !== where.workspaceId) return false;
                        return true;
                    });
                    if (!sa) return null;
                    const res = { ...sa };
                    if (include?.workOrder) {
                        const wo = db.workOrders.get(sa.workOrderId);
                        res.workOrder = wo ? {
                            ...wo,
                            customer: db.customers.get(wo.customerId),
                            location: db.serviceLocations.get(wo.locationId),
                        } : null;
                    }
                    if (include?.technician) {
                        const tp = db.technicianProfiles.get(sa.technicianId);
                        res.technician = tp ? { ...tp, employee: db.employees.get(tp.employeeId) } : null;
                    }
                    return res;
                }),
                findMany: vi.fn(async ({ where }: any) => {
                    return Array.from(db.scheduleAppointments.values()).filter(item => {
                        if (where?.workOrderId && item.workOrderId !== where.workOrderId) return false;
                        if (where?.workspaceId && item.workspaceId !== where.workspaceId) return false;
                        if (where?.status?.not && item.status === where.status.not) return false;
                        return true;
                    });
                }),
                update: vi.fn(async ({ where, data, include }: any) => {
                    const existing = db.scheduleAppointments.get(where.id);
                    const updated = { ...existing, ...data, updatedAt: new Date() };
                    db.scheduleAppointments.set(where.id, updated);
                    const res = { ...updated };
                    if (include?.workOrder) {
                        const wo = db.workOrders.get(updated.workOrderId);
                        res.workOrder = wo ? {
                            ...wo,
                            customer: db.customers.get(wo.customerId),
                            location: db.serviceLocations.get(wo.locationId),
                        } : null;
                    }
                    if (include?.technician) {
                        const tp = db.technicianProfiles.get(updated.technicianId);
                        res.technician = tp ? { ...tp, employee: db.employees.get(tp.employeeId) } : null;
                    }
                    return res;
                }),
            },
            scheduleAppointmentHistory: {
                create: vi.fn(async ({ data }: any) => {
                    const record = { id: data.id || genId("sah"), ...data, createdAt: new Date() };
                    db.scheduleAppointmentHistories.set(record.id, record);
                    return record;
                }),
            },
            scheduleHistory: {
                create: vi.fn(async ({ data }: any) => {
                    const record = { id: data.id || genId("sh"), ...data, createdAt: new Date() };
                    db.scheduleAppointmentHistories.set(record.id, record);
                    return record;
                }),
            },
            quote: {
                findFirst: vi.fn(async ({ where, include }: any) => {
                    const q = Array.from(db.quotes.values()).find(item => {
                        if (where.id && item.id !== where.id) return false;
                        if (where.workspaceId && item.workspaceId !== where.workspaceId) return false;
                        return true;
                    });
                    if (!q) return null;
                    const res = { ...q };
                    if (include?.customer) res.customer = db.customers.get(q.customerId);
                    if (include?.lineItems || include?.lines) {
                        const lines = Array.from(db.quoteLineItems.values()).filter(l => l.quoteId === q.id);
                        res.lineItems = lines;
                        res.lines = lines;
                    }
                    return res;
                }),
                findUnique: vi.fn(async ({ where }: any) => db.quotes.get(where.id) || null),
                create: vi.fn(async ({ data, include }: any) => {
                    const quoteId = data.id || genId("quote");
                    const record = {
                        id: quoteId,
                        quoteNumber: data.quoteNumber || `Q-2026-${Math.floor(Math.random() * 90000 + 10000)}`,
                        status: "DRAFT",
                        subtotal: new Prisma.Decimal("0.00"),
                        discountAmount: new Prisma.Decimal("0.00"),
                        taxAmount: new Prisma.Decimal("0.00"),
                        total: new Prisma.Decimal("0.00"),
                        ...data,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    };
                    db.quotes.set(quoteId, record);

                    const res = { ...record };
                    if (include?.customer) res.customer = db.customers.get(record.customerId);
                    if (include?.lineItems || include?.lines) {
                        res.lineItems = [];
                        res.lines = [];
                    }
                    return res;
                }),
                update: vi.fn(async ({ where, data, include }: any) => {
                    const existing = db.quotes.get(where.id);
                    const updated = { ...existing, ...data, updatedAt: new Date() };
                    db.quotes.set(where.id, updated);
                    const res = { ...updated };
                    if (include?.customer) res.customer = db.customers.get(updated.customerId);
                    if (include?.lineItems || include?.lines) {
                        const lines = Array.from(db.quoteLineItems.values()).filter(l => l.quoteId === updated.id);
                        res.lineItems = lines;
                        res.lines = lines;
                    }
                    return res;
                }),
            },
            quoteLineItem: {
                create: vi.fn(async ({ data }: any) => {
                    const record = {
                        id: data.id || genId("ql"),
                        quoteId: data.quoteId,
                        lineNumber: data.lineNumber || db.quoteLineItems.size + 1,
                        description: data.description,
                        quantity: new Prisma.Decimal(data.quantity),
                        unitPrice: new Prisma.Decimal(data.unitPrice),
                        discountAmount: new Prisma.Decimal(data.discountAmount || 0),
                        total: new Prisma.Decimal(data.total || (Number(data.quantity) * Number(data.unitPrice))),
                        ...data,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    };
                    db.quoteLineItems.set(record.id, record);
                    return record;
                }),
                findMany: vi.fn(async ({ where }: any) => {
                    return Array.from(db.quoteLineItems.values()).filter(l => l.quoteId === where.quoteId);
                }),
                findFirst: vi.fn(async ({ where }: any) => {
                    return Array.from(db.quoteLineItems.values()).find(l => {
                        if (where.id && l.id !== where.id) return false;
                        if (where.quoteId && l.quoteId !== where.quoteId) return false;
                        return true;
                    }) || null;
                }),
                update: vi.fn(async ({ where, data }: any) => {
                    const existing = db.quoteLineItems.get(where.id);
                    const updated = { ...existing, ...data, updatedAt: new Date() };
                    db.quoteLineItems.set(where.id, updated);
                    return updated;
                }),
                delete: vi.fn(async ({ where }: any) => {
                    db.quoteLineItems.delete(where.id);
                }),
            },
            quoteHistory: {
                create: vi.fn(async ({ data }: any) => {
                    const record = { id: data.id || genId("qh"), ...data, createdAt: new Date() };
                    db.quoteHistories.set(record.id, record);
                    return record;
                }),
            },
            invoice: {
                findFirst: vi.fn(async ({ where, include }: any) => {
                    const inv = Array.from(db.invoices.values()).find(i => {
                        if (where.id && i.id !== where.id) return false;
                        if (where.workspaceId && i.workspaceId !== where.workspaceId) return false;
                        return true;
                    });
                    if (!inv) return null;
                    const res = { ...inv };
                    if (include?.customer) res.customer = db.customers.get(inv.customerId);
                    if (include?.lineItems || include?.lines) {
                        res.lineItems = Array.from(db.invoiceLineItems.values()).filter(l => l.invoiceId === inv.id);
                    }
                    if (include?.payments) {
                        res.payments = Array.from(db.payments.values()).filter(p => p.invoiceId === inv.id);
                    }
                    return res;
                }),
                findUnique: vi.fn(async ({ where }: any) => db.invoices.get(where.id) || null),
                create: vi.fn(async ({ data, include }: any) => {
                    const invoiceId = data.id || genId("inv");
                    const lines = data.lineItems?.create || [];
                    const createdLines = lines.map((l: any, idx: number) => {
                        const lineRecord = {
                            id: genId("il"),
                            invoiceId,
                            lineNumber: idx + 1,
                            description: l.description,
                            quantity: new Prisma.Decimal(l.quantity),
                            unitPrice: new Prisma.Decimal(l.unitPrice),
                            discountAmount: new Prisma.Decimal(l.discountAmount || 0),
                            lineTotal: new Prisma.Decimal(l.lineTotal || (Number(l.quantity) * Number(l.unitPrice))),
                            createdAt: new Date(),
                            updatedAt: new Date(),
                        };
                        db.invoiceLineItems.set(lineRecord.id, lineRecord);
                        return lineRecord;
                    });

                    const subtotal = createdLines.reduce((sum: number, l: any) => sum + Number(l.lineTotal), 0);
                    const total = data.total ? new Prisma.Decimal(data.total) : new Prisma.Decimal(subtotal);

                    const record = {
                        id: invoiceId,
                        invoiceNumber: data.invoiceNumber || `INV-${Math.floor(Math.random() * 90000 + 10000)}`,
                        status: "DRAFT",
                        subtotal: new Prisma.Decimal(subtotal),
                        total,
                        amountPaid: new Prisma.Decimal(0),
                        amountDue: total,
                        ...data,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    };
                    delete record.lineItems;
                    db.invoices.set(invoiceId, record);

                    const res = { ...record };
                    if (include?.customer) res.customer = db.customers.get(record.customerId);
                    if (include?.lineItems) res.lineItems = createdLines;
                    return res;
                }),
                update: vi.fn(async ({ where, data, include }: any) => {
                    const existing = db.invoices.get(where.id);
                    const updated = { ...existing, ...data, updatedAt: new Date() };
                    db.invoices.set(where.id, updated);
                    const res = { ...updated };
                    if (include?.customer) res.customer = db.customers.get(updated.customerId);
                    if (include?.lineItems) {
                        res.lineItems = Array.from(db.invoiceLineItems.values()).filter(l => l.invoiceId === updated.id);
                    }
                    if (include?.payments) {
                        res.payments = Array.from(db.payments.values()).filter(p => p.invoiceId === updated.id);
                    }
                    return res;
                }),
            },
            invoiceLineItem: {
                create: vi.fn(async ({ data }: any) => {
                    const record = {
                        id: data.id || genId("il"),
                        invoiceId: data.invoiceId,
                        lineNumber: data.lineNumber || db.invoiceLineItems.size + 1,
                        description: data.description,
                        quantity: new Prisma.Decimal(data.quantity),
                        unitPrice: new Prisma.Decimal(data.unitPrice),
                        discountAmount: new Prisma.Decimal(data.discountAmount || 0),
                        lineTotal: new Prisma.Decimal(data.lineTotal || (Number(data.quantity) * Number(data.unitPrice))),
                        ...data,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    };
                    db.invoiceLineItems.set(record.id, record);
                    return record;
                }),
                findMany: vi.fn(async ({ where }: any) => {
                    return Array.from(db.invoiceLineItems.values()).filter(l => l.invoiceId === where.invoiceId);
                }),
                update: vi.fn(async ({ where, data }: any) => {
                    const existing = db.invoiceLineItems.get(where.id);
                    const updated = { ...existing, ...data, updatedAt: new Date() };
                    db.invoiceLineItems.set(where.id, updated);
                    return updated;
                }),
                delete: vi.fn(async ({ where }: any) => {
                    db.invoiceLineItems.delete(where.id);
                }),
            },
            invoiceHistory: {
                create: vi.fn(async ({ data }: any) => {
                    const record = { id: data.id || genId("ih"), ...data, createdAt: new Date() };
                    db.invoiceHistories.set(record.id, record);
                    return record;
                }),
            },
            payment: {
                findFirst: vi.fn(async ({ where }: any) => {
                    return Array.from(db.payments.values()).find(p => {
                        if (where.workspaceId && p.workspaceId !== where.workspaceId) return false;
                        if (where.paymentNumber?.startsWith && !p.paymentNumber.startsWith(where.paymentNumber.startsWith)) return false;
                        return true;
                    }) || null;
                }),
                create: vi.fn(async ({ data }: any) => {
                    const record = {
                        id: data.id || genId("pay"),
                        paymentNumber: data.paymentNumber || `PAY-${Math.floor(Math.random() * 90000 + 10000)}`,
                        status: "RECORDED",
                        ...data,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    };
                    db.payments.set(record.id, record);
                    return record;
                }),
                findMany: vi.fn(async ({ where }: any) => {
                    return Array.from(db.payments.values()).filter(p => p.invoiceId === where.invoiceId);
                }),
            },
            part: {
                findFirst: vi.fn(async ({ where }: any) => {
                    return Array.from(db.parts.values()).find(p => {
                        if (where.id && p.id !== where.id) return false;
                        if (where.workspaceId && p.workspaceId !== where.workspaceId) return false;
                        if (where.name && p.name !== where.name) return false;
                        return true;
                    }) || null;
                }),
                create: vi.fn(async ({ data }: any) => {
                    const record = {
                        id: data.id || genId("prt"),
                        status: "ACTIVE",
                        unitCost: data.unitCost !== null && data.unitCost !== undefined ? new Prisma.Decimal(data.unitCost) : null,
                        ...data,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    };
                    db.parts.set(record.id, record);
                    return record;
                }),
            },
            inventoryLocation: {
                findFirst: vi.fn(async ({ where }: any) => {
                    return Array.from(db.inventoryLocations.values()).find(il => {
                        if (where.id && il.id !== where.id) return false;
                        if (where.workspaceId && il.workspaceId !== where.workspaceId) return false;
                        return true;
                    }) || null;
                }),
                create: vi.fn(async ({ data }: any) => {
                    const record = {
                        id: data.id || genId("invloc"),
                        status: "ACTIVE",
                        ...data,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    };
                    db.inventoryLocations.set(record.id, record);
                    return record;
                }),
            },
            inventoryBalance: {
                findFirst: vi.fn(async ({ where }: any) => {
                    return Array.from(db.inventoryBalances.values()).find(ib => {
                        if (where.workspaceId && ib.workspaceId !== where.workspaceId) return false;
                        if (where.partId && ib.partId !== where.partId) return false;
                        if (where.locationId && ib.locationId !== where.locationId) return false;
                        return true;
                    }) || null;
                }),
                create: vi.fn(async ({ data }: any) => {
                    const record = {
                        id: data.id || genId("bal"),
                        quantityOnHand: new Prisma.Decimal(data.quantityOnHand || 0),
                        quantityReserved: new Prisma.Decimal(data.quantityReserved || 0),
                        ...data,
                        createdAt: new Date(),
                        updatedAt: new Date(),
                    };
                    db.inventoryBalances.set(record.id, record);
                    return record;
                }),
                update: vi.fn(async ({ where, data }: any) => {
                    const existing = db.inventoryBalances.get(where.id);
                    const updated = {
                        ...existing,
                        ...data,
                        quantityOnHand: data.quantityOnHand !== undefined ? new Prisma.Decimal(data.quantityOnHand) : existing.quantityOnHand,
                        quantityReserved: data.quantityReserved !== undefined ? new Prisma.Decimal(data.quantityReserved) : existing.quantityReserved,
                        updatedAt: new Date(),
                    };
                    db.inventoryBalances.set(where.id, updated);
                    return updated;
                }),
            },
            stockMovement: {
                create: vi.fn(async ({ data }: any) => {
                    const record = {
                        id: data.id || genId("sm"),
                        quantity: new Prisma.Decimal(data.quantity),
                        ...data,
                        createdAt: new Date(),
                    };
                    db.stockMovements.set(record.id, record);
                    return record;
                }),
            },
            workOrderPart: {
                create: vi.fn(async ({ data }: any) => {
                    const record = {
                        id: data.id || genId("wop"),
                        quantity: new Prisma.Decimal(data.quantity),
                        ...data,
                        createdAt: new Date(),
                    };
                    db.workOrderParts.set(record.id, record);
                    return record;
                }),
            },
            subscription: {
                findUnique: vi.fn(async () => null),
                findFirst: vi.fn(async () => null),
                findMany: vi.fn(async () => []),
            },
            workspaceEntitlementOverride: {
                findUnique: vi.fn(async () => null),
                findFirst: vi.fn(async () => null),
                findMany: vi.fn(async () => []),
            },
            $queryRaw: vi.fn(async (strings: any, ...values: any[]) => {
                const [workspaceId, partId, locationId] = values;
                const match = Array.from(db.inventoryBalances.values()).find(
                    ib => ib.workspaceId === workspaceId && ib.partId === partId && ib.locationId === locationId
                );
                return match ? [match] : [];
            }),
            $executeRaw: vi.fn(async () => 1),
            $transaction: vi.fn(async (cb: any) => {
                if (typeof cb === "function") return cb(client);
                return Promise.all(cb);
            }),
        };
        return client;
    };

    return { prisma: createPrismaProxy() };
});

// Services under Test
import { createCustomer } from "@/lib/services/customer/createCustomer";
import { createServiceLocation } from "@/lib/services/customer/createServiceLocation";
import { createWorkType } from "@/lib/services/workType/createWorkType";
import { createWorkOrder } from "@/lib/services/workOrder/createWorkOrder";
import { assignWorkOrder } from "@/lib/services/workOrder/assignWorkOrder";
import { transitionWorkOrderStatus } from "@/lib/services/workOrder/transitionWorkOrderStatus";
import { WorkOrderInvalidStatusTransitionError } from "@/lib/services/workOrder/workOrderErrors";
import {
    acknowledgeTechnicianDispatch,
    startTechnicianWorkOrder,
    holdTechnicianWorkOrder,
    recordTechnicianTimeEntry,
    resumeTechnicianWorkOrder,
    completeTechnicianWorkOrder,
    type TechnicianExecutionContext,
} from "@/lib/services/technicianOperations";
import { createQuote } from "@/lib/services/quote/createQuote";
import { addQuoteLineItem } from "@/lib/services/quote/addQuoteLineItem";
import { sendQuote } from "@/lib/services/quote/sendQuote";
import { approveQuote } from "@/lib/services/quote/approveQuote";
import { createInvoiceFromQuote } from "@/lib/services/invoice/createInvoiceFromQuote";
import { issueInvoice } from "@/lib/services/invoice/issueInvoice";
import { recordPayment } from "@/lib/services/invoice/recordPayment";
import { createPart } from "@/lib/services/inventory/part/createPart";
import { createInventoryLocation } from "@/lib/services/inventory/inventoryLocation/createInventoryLocation";
import { receiveStock } from "@/lib/services/inventory/movement/receiveStock";
import { reserveStock } from "@/lib/services/inventory/movement/reserveStock";
import { consumeStock } from "@/lib/services/inventory/movement/consumeStock";
import type { WorkspaceAuthorizationContext } from "@/lib/services/authorization/types";

describe("Phase 1.21.5 — End-to-End Critical Workflow Testing", () => {
    const WORKSPACE_ID = "ws_e2e_prod_100";
    const USER_ID = "usr_dispatcher_1";
    const TECH_USER_ID = "usr_tech_bob";
    const TECH_PROFILE_ID = "tp_tech_bob_1";

    let authContext: WorkspaceAuthorizationContext;
    let techContext: TechnicianExecutionContext;

    beforeEach(() => {
        db.reset();
        vi.clearAllMocks();

        // 1. Seed Workspace
        db.workspaces.set(WORKSPACE_ID, {
            id: WORKSPACE_ID,
            name: "Apex Field Solutions",
            slug: "apex-field",
            timezone: "America/New_York",
            logoUrl: null,
            createdAt: new Date(),
            updatedAt: new Date(),
        });

        // 2. Seed Dispatcher User & Membership (ADMIN role for full dispatch & finance rights)
        db.users.set(USER_ID, {
            id: USER_ID,
            name: "Alice Admin",
            email: "alice@apexfield.com",
            status: "ACTIVE",
            emailVerified: new Date(),
        });

        const adminMember = {
            id: "mem_admin_1",
            userId: USER_ID,
            workspaceId: WORKSPACE_ID,
            role: "ADMIN" as const,
            status: "ACTIVE" as const,
        };
        db.workspaceMembers.set(adminMember.id, adminMember);

        // 3. Seed Technician User, Membership, Employee & TechnicianProfile
        db.users.set(TECH_USER_ID, {
            id: TECH_USER_ID,
            name: "Bob Technician",
            email: "bob@apexfield.com",
            status: "ACTIVE",
            emailVerified: new Date(),
        });

        const techMember = {
            id: "mem_tech_bob",
            userId: TECH_USER_ID,
            workspaceId: WORKSPACE_ID,
            role: "TECHNICIAN" as const,
            status: "ACTIVE" as const,
        };
        db.workspaceMembers.set(techMember.id, techMember);

        const techEmployee = {
            id: "emp_tech_bob",
            workspaceId: WORKSPACE_ID,
            workspaceMemberId: techMember.id,
            displayName: "Bob Technician",
            status: "ACTIVE",
        };
        db.employees.set(techEmployee.id, techEmployee);

        const techProfile = {
            id: TECH_PROFILE_ID,
            employeeId: techEmployee.id,
            employee: techEmployee,
        };
        db.technicianProfiles.set(techProfile.id, techProfile);

        // 4. Seed Service Catalog for Work Types
        db.serviceCatalogs.set("cat_main_100", {
            id: "cat_main_100",
            workspaceId: WORKSPACE_ID,
            name: "Commercial Facilities",
            status: "ACTIVE",
        });

        // Default session auth mock
        authMock.mockResolvedValue({
            user: { id: USER_ID, email: "alice@apexfield.com" },
        });

        authContext = {
            user: db.users.get(USER_ID),
            membership: adminMember,
            workspace: db.workspaces.get(WORKSPACE_ID),
        };

        techContext = {
            userId: TECH_USER_ID,
            workspaceId: WORKSPACE_ID,
            membershipId: techMember.id,
            role: "TECHNICIAN",
            employeeId: techEmployee.id,
            technicianProfileId: TECH_PROFILE_ID,
            technicianName: "Bob Technician",
        };
    });

    // =========================================================================
    // Workflow 1: Customer → Work Order Chained Creation
    // =========================================================================
    describe("1. Customer → Work Order Lifecycle Pipeline", () => {
        it("chains Customer → Service Location → Work Type → Work Order creation with referential integrity", async () => {
            // Step 1: Create Customer
            const customer = await createCustomer(WORKSPACE_ID, {
                name: "Meridian Towers Inc",
                customerNumber: "CUST-9001",
                notes: "High-rise commercial client",
            });
            expect(customer.id).toBeDefined();
            expect(customer.name).toBe("Meridian Towers Inc");

            // Step 2: Create Service Location referencing the new customer
            const location = await createServiceLocation(WORKSPACE_ID, customer.id, {
                name: "Tower 1 Mechanical Penthouse",
                addressLine1: "500 5th Ave",
                city: "New York",
                state: "NY",
                postalCode: "10110",
                country: "US",
                isPrimary: true,
            });
            expect(location.id).toBeDefined();
            expect(location.customerId).toBe(customer.id);
            expect(location.isPrimary).toBe(true);

            // Step 3: Create Work Type definition in the catalog
            const workType = await createWorkType(WORKSPACE_ID, {
                catalogId: "cat_main_100",
                name: "Chiller Overhaul & Re-tubing",
                code: "HVAC-CHILL",
                estimatedDuration: 240,
            });
            expect(workType.id).toBeDefined();
            expect(workType.name).toBe("Chiller Overhaul & Re-tubing");

            // Step 4: Create Work Order referencing Customer, Location, and WorkType
            const workOrder = await createWorkOrder(WORKSPACE_ID, {
                customerId: customer.id,
                locationId: location.id,
                workTypeId: workType.id,
                title: "Annual Chiller Teardown",
                priority: "HIGH",
            });

            // Step 5: Verify cascading referential state
            expect(workOrder.id).toBeDefined();
            expect(workOrder.customerId).toBe(customer.id);
            expect(workOrder.locationId).toBe(location.id);
            expect(workOrder.workTypeId).toBe(workType.id);
            expect(workOrder.workTypeName).toBe("Chiller Overhaul & Re-tubing");
            expect(workOrder.workTypeCode).toBe("HVAC-CHILL");
            expect(workOrder.status).toBe("OPEN");
            expect(workOrder.assignedTechnicianId).toBeNull();
            expect(workOrder.estimatedDuration).toBe(240);
        });
    });

    // =========================================================================
    // Workflow 2: Dispatch Lifecycle (OPEN → ASSIGNED → IN_PROGRESS → COMPLETED)
    // =========================================================================
    describe("2. Dispatch Lifecycle Workflow", () => {
        it("executes OPEN → ASSIGNED → IN_PROGRESS → COMPLETED with timestamps & history at each transition", async () => {
            // Setup base WorkOrder
            const customer = await createCustomer(WORKSPACE_ID, { name: "Hudson Yards", customerNumber: "CUST-9002" });
            const location = await createServiceLocation(WORKSPACE_ID, customer.id, {
                name: "Main Plant", addressLine1: "10 Hudson", city: "NY", state: "NY", postalCode: "10001", country: "US",
            });
            const workType = await createWorkType(WORKSPACE_ID, {
                catalogId: "cat_main_100", name: "Filter Replacement", code: "HVAC-FLT", estimatedDuration: 60,
            });
            const wo = await createWorkOrder(WORKSPACE_ID, {
                customerId: customer.id, locationId: location.id, workTypeId: workType.id, title: "Filter Service",
            });

            expect(wo.status).toBe("OPEN");
            expect(wo.assignedTechnicianId).toBeNull();

            // Transition 1: Assign Technician (sets assignedTechnicianId) & transition to ASSIGNED
            const assignedWo = await assignWorkOrder(WORKSPACE_ID, wo.id, { technicianId: TECH_PROFILE_ID }, authContext);
            expect(assignedWo.assignedTechnicianId).toBe(TECH_PROFILE_ID);

            const assignedStatus = await transitionWorkOrderStatus(
                WORKSPACE_ID,
                wo.id,
                { toStatus: "ASSIGNED" },
                authContext
            );
            expect(assignedStatus.status).toBe("ASSIGNED");

            // Transition 2: Start Work (ASSIGNED → IN_PROGRESS)
            const inProgress = await transitionWorkOrderStatus(
                WORKSPACE_ID,
                wo.id,
                { toStatus: "IN_PROGRESS" },
                authContext
            );
            expect(inProgress.status).toBe("IN_PROGRESS");
            expect(inProgress.startedAt).toBeDefined();

            // Transition 3: Complete Work (IN_PROGRESS → COMPLETED)
            const completed = await transitionWorkOrderStatus(
                WORKSPACE_ID,
                wo.id,
                { toStatus: "COMPLETED" },
                authContext
            );
            expect(completed.status).toBe("COMPLETED");
            expect(completed.completedAt).toBeDefined();

            // Verify history chain recorded
            const histories = Array.from(db.workOrderHistories.values()).filter(h => h.workOrderId === wo.id);
            expect(histories.length).toBeGreaterThanOrEqual(3);
        });
    });

    // =========================================================================
    // Workflow 3: Hold & Resumption Workflow
    // =========================================================================
    describe("3. Hold & Resumption Workflow", () => {
        it("executes IN_PROGRESS → ON_HOLD (with reason) → IN_PROGRESS (hold cleared) → COMPLETED", async () => {
            const customer = await createCustomer(WORKSPACE_ID, { name: "Empire Logistics", customerNumber: "CUST-9003" });
            const location = await createServiceLocation(WORKSPACE_ID, customer.id, {
                name: "Warehouse A", addressLine1: "1 Warehouse Way", city: "NY", state: "NY", postalCode: "10001", country: "US",
            });
            const workType = await createWorkType(WORKSPACE_ID, {
                catalogId: "cat_main_100", name: "Duct Repair", code: "HVAC-DUCT", estimatedDuration: 90,
            });
            const wo = await createWorkOrder(WORKSPACE_ID, {
                customerId: customer.id, locationId: location.id, workTypeId: workType.id, title: "Duct Maintenance",
            });

            await assignWorkOrder(WORKSPACE_ID, wo.id, { technicianId: TECH_PROFILE_ID }, authContext);
            await transitionWorkOrderStatus(WORKSPACE_ID, wo.id, { toStatus: "ASSIGNED" }, authContext);
            await transitionWorkOrderStatus(WORKSPACE_ID, wo.id, { toStatus: "IN_PROGRESS" }, authContext);

            // Step 1: Place on Hold with Reason
            const holdReason = "Awaiting custom steel sheet fitting from fabricator";
            const held = await transitionWorkOrderStatus(
                WORKSPACE_ID,
                wo.id,
                { toStatus: "ON_HOLD", holdReason },
                authContext
            );
            expect(held.status).toBe("ON_HOLD");
            expect(held.holdReason).toBe(holdReason);

            // Step 2: Resume Work (ON_HOLD → IN_PROGRESS)
            const resumed = await transitionWorkOrderStatus(
                WORKSPACE_ID,
                wo.id,
                { toStatus: "IN_PROGRESS" },
                authContext
            );
            expect(resumed.status).toBe("IN_PROGRESS");
            expect(resumed.holdReason).toBeNull(); // Hold reason cleared on resumption

            // Step 3: Complete Work
            const completed = await transitionWorkOrderStatus(
                WORKSPACE_ID,
                wo.id,
                { toStatus: "COMPLETED" },
                authContext
            );
            expect(completed.status).toBe("COMPLETED");
        });
    });

    // =========================================================================
    // Workflow 4: Cancellation Workflow
    // =========================================================================
    describe("4. Cancellation Workflow from Multiple Origins", () => {
        it("allows cancellation from OPEN, ASSIGNED, and ON_HOLD, but strictly rejects cancellation from COMPLETED", async () => {
            const customer = await createCustomer(WORKSPACE_ID, { name: "Gotham Plaza", customerNumber: "CUST-9004" });
            const location = await createServiceLocation(WORKSPACE_ID, customer.id, {
                name: "Plaza 1", addressLine1: "100 Broadway", city: "NY", state: "NY", postalCode: "10001", country: "US",
            });
            const workType = await createWorkType(WORKSPACE_ID, {
                catalogId: "cat_main_100", name: "Thermostat Calibration", code: "HVAC-STAT", estimatedDuration: 30,
            });

            // Case A: OPEN → CANCELLED
            const woOpen = await createWorkOrder(WORKSPACE_ID, {
                customerId: customer.id, locationId: location.id, workTypeId: workType.id, title: "Cancel from OPEN",
            });
            const cancelledOpen = await transitionWorkOrderStatus(
                WORKSPACE_ID,
                woOpen.id,
                { toStatus: "CANCELLED", cancellationReason: "Customer requested cancellation" },
                authContext
            );
            expect(cancelledOpen.status).toBe("CANCELLED");
            expect(cancelledOpen.cancellationReason).toBe("Customer requested cancellation");

            // Case B: ASSIGNED → CANCELLED
            const woAssigned = await createWorkOrder(WORKSPACE_ID, {
                customerId: customer.id, locationId: location.id, workTypeId: workType.id, title: "Cancel from ASSIGNED",
            });
            await assignWorkOrder(WORKSPACE_ID, woAssigned.id, { technicianId: TECH_PROFILE_ID }, authContext);
            await transitionWorkOrderStatus(WORKSPACE_ID, woAssigned.id, { toStatus: "ASSIGNED" }, authContext);
            const cancelledAssigned = await transitionWorkOrderStatus(
                WORKSPACE_ID,
                woAssigned.id,
                { toStatus: "CANCELLED", cancellationReason: "Technician unable to access site" },
                authContext
            );
            expect(cancelledAssigned.status).toBe("CANCELLED");

            // Case C: ON_HOLD → CANCELLED
            const woHold = await createWorkOrder(WORKSPACE_ID, {
                customerId: customer.id, locationId: location.id, workTypeId: workType.id, title: "Cancel from ON_HOLD",
            });
            await assignWorkOrder(WORKSPACE_ID, woHold.id, { technicianId: TECH_PROFILE_ID }, authContext);
            await transitionWorkOrderStatus(WORKSPACE_ID, woHold.id, { toStatus: "ASSIGNED" }, authContext);
            await transitionWorkOrderStatus(WORKSPACE_ID, woHold.id, { toStatus: "IN_PROGRESS" }, authContext);
            await transitionWorkOrderStatus(WORKSPACE_ID, woHold.id, { toStatus: "ON_HOLD", holdReason: "Waiting on parts" }, authContext);
            const cancelledHold = await transitionWorkOrderStatus(
                WORKSPACE_ID,
                woHold.id,
                { toStatus: "CANCELLED", cancellationReason: "Parts obsolete, contract cancelled" },
                authContext
            );
            expect(cancelledHold.status).toBe("CANCELLED");

            // Case D: COMPLETED → CANCELLED (Illegal State Transition)
            const woCompleted = await createWorkOrder(WORKSPACE_ID, {
                customerId: customer.id, locationId: location.id, workTypeId: workType.id, title: "Complete Then Cancel",
            });
            await assignWorkOrder(WORKSPACE_ID, woCompleted.id, { technicianId: TECH_PROFILE_ID }, authContext);
            await transitionWorkOrderStatus(WORKSPACE_ID, woCompleted.id, { toStatus: "ASSIGNED" }, authContext);
            await transitionWorkOrderStatus(WORKSPACE_ID, woCompleted.id, { toStatus: "IN_PROGRESS" }, authContext);
            await transitionWorkOrderStatus(WORKSPACE_ID, woCompleted.id, { toStatus: "COMPLETED" }, authContext);

            await expect(
                transitionWorkOrderStatus(
                    WORKSPACE_ID,
                    woCompleted.id,
                    { toStatus: "CANCELLED", cancellationReason: "Retroactive cancel attempt" },
                    authContext
                )
            ).rejects.toThrow(WorkOrderInvalidStatusTransitionError);
        });
    });

    // =========================================================================
    // Workflow 5: Technician Self-Service Field Execution
    // =========================================================================
    describe("5. Technician Self-Service Field Execution Workflow", () => {
        it("chains Dispatch Acknowledgment → Execution Start → Hold & Time Entry → Resume → Resolution Evidence → Work Order Completion", async () => {
            const customer = await createCustomer(WORKSPACE_ID, { name: "Stark Tower", customerNumber: "CUST-9005" });
            const location = await createServiceLocation(WORKSPACE_ID, customer.id, {
                name: "Server Room", addressLine1: "200 Park Ave", city: "NY", state: "NY", postalCode: "10017", country: "US",
            });
            const workType = await createWorkType(WORKSPACE_ID, {
                catalogId: "cat_main_100", name: "Precision Cooling Service", code: "HVAC-CRAC", estimatedDuration: 180,
            });
            const wo = await createWorkOrder(WORKSPACE_ID, {
                customerId: customer.id, locationId: location.id, workTypeId: workType.id, title: "CRAC Unit Alert",
            });

            await assignWorkOrder(WORKSPACE_ID, wo.id, { technicianId: TECH_PROFILE_ID }, authContext);
            await transitionWorkOrderStatus(WORKSPACE_ID, wo.id, { toStatus: "ASSIGNED" }, authContext);

            // Seed Schedule Appointment for tech dispatch
            db.scheduleAppointments.set("appt_100", {
                id: "appt_100",
                appointmentNumber: "APT-00100",
                workspaceId: WORKSPACE_ID,
                workOrderId: wo.id,
                technicianId: TECH_PROFILE_ID,
                status: "SCHEDULED",
                dispatchStatus: "DISPATCHED",
                start: new Date(),
                end: new Date(Date.now() + 3600000),
                acknowledgedAt: null,
                fieldExecutionStartedAt: null,
            });

            // Step 1: Technician acknowledges dispatch
            const ackResult = await acknowledgeTechnicianDispatch(techContext, wo.id);
            expect(ackResult.dispatchStatus).toBe("ACKNOWLEDGED");

            // Step 2: Technician commences work (ASSIGNED → IN_PROGRESS, opens ACTIVE ON_SITE time entry)
            const startedWo = await startTechnicianWorkOrder(techContext, wo.id, {});
            expect(startedWo.status).toBe("IN_PROGRESS");

            // Step 3: Technician places job on hold (closes active ON_SITE entry, transitions to ON_HOLD)
            const heldWo = await holdTechnicianWorkOrder(techContext, wo.id, {
                holdReason: "Awaiting replacement solenoid valve from regional hub",
            });
            expect(heldWo.status).toBe("ON_HOLD");

            // Step 4: Technician logs administrative / travel time entry while job is on hold
            const timeEntry = await recordTechnicianTimeEntry(techContext, wo.id, {
                entryType: "ADMIN",
                notes: "Logged diagnostic findings and coordinated parts shipment",
            });
            expect(timeEntry.id).toBeDefined();
            expect(timeEntry.technicianProfileId).toBe(TECH_PROFILE_ID);
            expect(timeEntry.entryType).toBe("ADMIN");

            // Step 5: Technician resumes work upon parts arrival (ON_HOLD → IN_PROGRESS, opens new ON_SITE entry)
            const resumedWo = await resumeTechnicianWorkOrder(techContext, wo.id, {});
            expect(resumedWo.status).toBe("IN_PROGRESS");

            // Step 6: Technician completes work with resolution notes and photo evidence
            const completedWo = await completeTechnicianWorkOrder(techContext, wo.id, {
                resolutionNotes: "Replaced solenoid valve, pressure tested system, recharged refrigerant, and verified normal delta-T.",
                mediaUris: ["https://storage.apexfield.com/evidence/wo_valve_repair.jpg"],
            });

            expect(completedWo.status).toBe("COMPLETED");
            expect(completedWo.completedAt).toBeDefined();
        });
    });
});

