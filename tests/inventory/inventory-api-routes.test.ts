import { describe, expect, it, vi, beforeEach } from "vitest";
import { ZodError } from "zod";

const mocks = vi.hoisted(() => ({
    getParts: vi.fn(),
    createPart: vi.fn(),
    getPart: vi.fn(),
    updatePart: vi.fn(),
    transitionPartStatus: vi.fn(),

    getInventoryLocations: vi.fn(),
    createInventoryLocation: vi.fn(),
    getInventoryLocation: vi.fn(),
    updateInventoryLocation: vi.fn(),
    transitionInventoryLocationStatus: vi.fn(),

    getInventoryBalances: vi.fn(),
    getInventoryBalance: vi.fn(),
    listReservations: vi.fn(),
    listTechnicianStock: vi.fn(),

    listStockMovements: vi.fn(),
    receiveStock: vi.fn(),
    transferStock: vi.fn(),
    adjustStock: vi.fn(),
    reserveStock: vi.fn(),
    releaseStock: vi.fn(),
    consumeStock: vi.fn(),
    returnStock: vi.fn(),

    getWorkOrderParts: vi.fn(),
    getWorkOrderPart: vi.fn(),
}));

vi.mock("@/lib/services/inventory/part/getParts", () => ({
    getParts: mocks.getParts,
}));
vi.mock("@/lib/services/inventory/part/createPart", () => ({
    createPart: mocks.createPart,
}));
vi.mock("@/lib/services/inventory/part/getPart", () => ({
    getPart: mocks.getPart,
}));
vi.mock("@/lib/services/inventory/part/updatePart", () => ({
    updatePart: mocks.updatePart,
}));
vi.mock("@/lib/services/inventory/part/transitionPartStatus", () => ({
    transitionPartStatus: mocks.transitionPartStatus,
}));

vi.mock("@/lib/services/inventory/inventoryLocation/getInventoryLocations", () => ({
    getInventoryLocations: mocks.getInventoryLocations,
}));
vi.mock("@/lib/services/inventory/inventoryLocation/createInventoryLocation", () => ({
    createInventoryLocation: mocks.createInventoryLocation,
}));
vi.mock("@/lib/services/inventory/inventoryLocation/getInventoryLocation", () => ({
    getInventoryLocation: mocks.getInventoryLocation,
}));
vi.mock("@/lib/services/inventory/inventoryLocation/updateInventoryLocation", () => ({
    updateInventoryLocation: mocks.updateInventoryLocation,
}));
vi.mock("@/lib/services/inventory/inventoryLocation/transitionInventoryLocationStatus", () => ({
    transitionInventoryLocationStatus: mocks.transitionInventoryLocationStatus,
}));

vi.mock("@/lib/services/inventory/balance/getInventoryBalances", () => ({
    getInventoryBalances: mocks.getInventoryBalances,
}));
vi.mock("@/lib/services/inventory/balance/getInventoryBalance", () => ({
    getInventoryBalance: mocks.getInventoryBalance,
}));
vi.mock("@/lib/services/inventory/balance/listReservations", () => ({
    listReservations: mocks.listReservations,
}));
vi.mock("@/lib/services/inventory/balance/listTechnicianStock", () => ({
    listTechnicianStock: mocks.listTechnicianStock,
}));

vi.mock("@/lib/services/inventory/movement/listStockMovements", () => ({
    listStockMovements: mocks.listStockMovements,
}));
vi.mock("@/lib/services/inventory/movement/receiveStock", () => ({
    receiveStock: mocks.receiveStock,
}));
vi.mock("@/lib/services/inventory/movement/transferStock", () => ({
    transferStock: mocks.transferStock,
}));
vi.mock("@/lib/services/inventory/movement/adjustStock", () => ({
    adjustStock: mocks.adjustStock,
}));
vi.mock("@/lib/services/inventory/movement/reserveStock", () => ({
    reserveStock: mocks.reserveStock,
}));
vi.mock("@/lib/services/inventory/movement/releaseStock", () => ({
    releaseStock: mocks.releaseStock,
}));
vi.mock("@/lib/services/inventory/movement/consumeStock", () => ({
    consumeStock: mocks.consumeStock,
}));
vi.mock("@/lib/services/inventory/movement/returnStock", () => ({
    returnStock: mocks.returnStock,
}));

vi.mock("@/lib/services/inventory/workOrderPart/getWorkOrderParts", () => ({
    getWorkOrderParts: mocks.getWorkOrderParts,
}));
vi.mock("@/lib/services/inventory/workOrderPart/getWorkOrderPart", () => ({
    getWorkOrderPart: mocks.getWorkOrderPart,
}));

import {
    GET as listPartsRoute,
    POST as createPartRoute,
} from "@/app/api/workspaces/[workspaceId]/inventory/parts/route";
import {
    GET as getPartRoute,
    PATCH as updatePartRoute,
} from "@/app/api/workspaces/[workspaceId]/inventory/parts/[partId]/route";
import { POST as transitionPartStatusRoute } from "@/app/api/workspaces/[workspaceId]/inventory/parts/[partId]/status/route";

import {
    GET as listLocationsRoute,
    POST as createLocationRoute,
} from "@/app/api/workspaces/[workspaceId]/inventory/locations/route";
import {
    GET as getLocationRoute,
    PATCH as updateLocationRoute,
} from "@/app/api/workspaces/[workspaceId]/inventory/locations/[locationId]/route";
import { POST as transitionLocationStatusRoute } from "@/app/api/workspaces/[workspaceId]/inventory/locations/[locationId]/status/route";

import { GET as listBalancesRoute } from "@/app/api/workspaces/[workspaceId]/inventory/balances/route";
import { GET as getBalanceRoute } from "@/app/api/workspaces/[workspaceId]/inventory/balances/[partId]/[locationId]/route";
import { GET as listReservationsRoute } from "@/app/api/workspaces/[workspaceId]/inventory/reservations/route";
import { GET as listTechnicianStockRoute } from "@/app/api/workspaces/[workspaceId]/inventory/technician-stock/[technicianProfileId]/route";

import { GET as listMovementsRoute } from "@/app/api/workspaces/[workspaceId]/inventory/movements/route";
import { POST as receiveStockRoute } from "@/app/api/workspaces/[workspaceId]/inventory/movements/receive/route";
import { POST as transferStockRoute } from "@/app/api/workspaces/[workspaceId]/inventory/movements/transfer/route";
import { POST as adjustStockRoute } from "@/app/api/workspaces/[workspaceId]/inventory/movements/adjust/route";
import { POST as reserveStockRoute } from "@/app/api/workspaces/[workspaceId]/inventory/movements/reserve/route";
import { POST as releaseStockRoute } from "@/app/api/workspaces/[workspaceId]/inventory/movements/release/route";
import { POST as consumeStockRoute } from "@/app/api/workspaces/[workspaceId]/inventory/movements/consume/route";
import { POST as returnStockRoute } from "@/app/api/workspaces/[workspaceId]/inventory/movements/return/route";

import { GET as listWorkOrderPartsRoute } from "@/app/api/workspaces/[workspaceId]/inventory/work-order-parts/route";
import { GET as getWorkOrderPartRoute } from "@/app/api/workspaces/[workspaceId]/inventory/work-order-parts/[id]/route";

import {
    PartNotFoundError,
    PartInactiveError,
    DuplicatePartSkuError,
} from "@/lib/services/inventory/part/partErrors";
import {
    InventoryLocationNotFoundError,
    InventoryLocationInactiveError,
} from "@/lib/services/inventory/inventoryLocation/inventoryLocationErrors";
import {
    InsufficientStockError,
    ExcessiveReturnError,
    TransferSameLocationError,
} from "@/lib/services/inventory/movement/stockMovementErrors";
import {
    UnauthorizedError,
    ForbiddenError,
} from "@/lib/services/authorization/authorizationErrors";

describe("Phase 1.10.22–1.10.23: Inventory & Parts API Route Layer", () => {
    const WS_ID = "ws_test_alpha";
    const PART_ID = "part_123";
    const LOC_ID = "loc_456";
    const TECH_ID = "tech_789";
    const WOP_ID = "wop_999";

    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("1. Parts API Routes", () => {
        it("GET /api/workspaces/[workspaceId]/inventory/parts — succeeds with 200", async () => {
            const mockData = { items: [{ id: PART_ID, name: "Pipe" }], total: 1 };
            mocks.getParts.mockResolvedValueOnce(mockData);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/parts?page=1&pageSize=10`);
            const res = await listPartsRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockData });
            expect(mocks.getParts).toHaveBeenCalledWith(WS_ID, expect.objectContaining({ page: "1", pageSize: "10" }));
        });

        it("POST /api/workspaces/[workspaceId]/inventory/parts — succeeds with 201", async () => {
            const mockPart = { id: PART_ID, name: "Valve" };
            mocks.createPart.mockResolvedValueOnce(mockPart);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/parts`, {
                method: "POST",
                body: JSON.stringify({ name: "Valve", unitOfMeasure: "EACH" }),
            });
            const res = await createPartRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(201);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockPart });
        });

        it("GET /api/workspaces/[workspaceId]/inventory/parts/[partId] — succeeds with 200", async () => {
            const mockPart = { id: PART_ID, name: "Valve" };
            mocks.getPart.mockResolvedValueOnce(mockPart);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/parts/${PART_ID}`);
            const res = await getPartRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, partId: PART_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockPart });
        });

        it("PATCH /api/workspaces/[workspaceId]/inventory/parts/[partId] — succeeds with 200", async () => {
            const mockUpdated = { id: PART_ID, name: "Valve Updated" };
            mocks.updatePart.mockResolvedValueOnce(mockUpdated);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/parts/${PART_ID}`, {
                method: "PATCH",
                body: JSON.stringify({ name: "Valve Updated" }),
            });
            const res = await updatePartRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, partId: PART_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockUpdated });
        });

        it("POST /api/workspaces/[workspaceId]/inventory/parts/[partId]/status — succeeds with 200", async () => {
            const mockTransitioned = { id: PART_ID, status: "INACTIVE" };
            mocks.transitionPartStatus.mockResolvedValueOnce(mockTransitioned);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/parts/${PART_ID}/status`, {
                method: "POST",
                body: JSON.stringify({ status: "INACTIVE" }),
            });
            const res = await transitionPartStatusRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, partId: PART_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockTransitioned });
        });
    });

    describe("2. Locations API Routes", () => {
        it("GET /api/workspaces/[workspaceId]/inventory/locations — succeeds with 200", async () => {
            const mockData = { items: [{ id: LOC_ID, name: "Warehouse" }], total: 1 };
            mocks.getInventoryLocations.mockResolvedValueOnce(mockData);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/locations`);
            const res = await listLocationsRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockData });
        });

        it("POST /api/workspaces/[workspaceId]/inventory/locations — succeeds with 201", async () => {
            const mockLoc = { id: LOC_ID, name: "New Depot" };
            mocks.createInventoryLocation.mockResolvedValueOnce(mockLoc);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/locations`, {
                method: "POST",
                body: JSON.stringify({ name: "New Depot", locationType: "WAREHOUSE" }),
            });
            const res = await createLocationRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(201);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockLoc });
        });

        it("GET /api/workspaces/[workspaceId]/inventory/locations/[locationId] — succeeds with 200", async () => {
            const mockLoc = { id: LOC_ID, name: "Warehouse" };
            mocks.getInventoryLocation.mockResolvedValueOnce(mockLoc);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/locations/${LOC_ID}`);
            const res = await getLocationRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, locationId: LOC_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockLoc });
        });

        it("PATCH /api/workspaces/[workspaceId]/inventory/locations/[locationId] — succeeds with 200", async () => {
            const mockUpdated = { id: LOC_ID, name: "Warehouse Main" };
            mocks.updateInventoryLocation.mockResolvedValueOnce(mockUpdated);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/locations/${LOC_ID}`, {
                method: "PATCH",
                body: JSON.stringify({ name: "Warehouse Main" }),
            });
            const res = await updateLocationRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, locationId: LOC_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockUpdated });
        });

        it("POST /api/workspaces/[workspaceId]/inventory/locations/[locationId]/status — succeeds with 200", async () => {
            const mockResult = { id: LOC_ID, status: "DECOMMISSIONED" };
            mocks.transitionInventoryLocationStatus.mockResolvedValueOnce(mockResult);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/locations/${LOC_ID}/status`, {
                method: "POST",
                body: JSON.stringify({ status: "DECOMMISSIONED" }),
            });
            const res = await transitionLocationStatusRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, locationId: LOC_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockResult });
        });
    });

    describe("3. Balances & Query API Routes", () => {
        it("GET /api/workspaces/[workspaceId]/inventory/balances — succeeds with 200", async () => {
            const mockData = { items: [{ partId: PART_ID, locationId: LOC_ID, quantityOnHand: 50 }], total: 1 };
            mocks.getInventoryBalances.mockResolvedValueOnce(mockData);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/balances?partId=${PART_ID}`);
            const res = await listBalancesRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockData });
        });

        it("GET /api/workspaces/[workspaceId]/inventory/balances/[partId]/[locationId] — succeeds with 200", async () => {
            const mockBalance = { partId: PART_ID, locationId: LOC_ID, quantityOnHand: 50, quantityReserved: 10, quantityAvailable: 40 };
            mocks.getInventoryBalance.mockResolvedValueOnce(mockBalance);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/balances/${PART_ID}/${LOC_ID}`);
            const res = await getBalanceRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, partId: PART_ID, locationId: LOC_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockBalance });
        });

        it("GET /api/workspaces/[workspaceId]/inventory/reservations — succeeds with 200", async () => {
            const mockData = { items: [{ partId: PART_ID, locationId: LOC_ID, quantityReserved: 15 }], total: 1 };
            mocks.listReservations.mockResolvedValueOnce(mockData);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/reservations`);
            const res = await listReservationsRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockData });
        });

        it("GET /api/workspaces/[workspaceId]/inventory/technician-stock/[technicianProfileId] — succeeds with 200", async () => {
            const mockData = { items: [{ locationId: LOC_ID, partId: PART_ID, quantityOnHand: 5 }], total: 1 };
            mocks.listTechnicianStock.mockResolvedValueOnce(mockData);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/technician-stock/${TECH_ID}`);
            const res = await listTechnicianStockRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, technicianProfileId: TECH_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockData });
        });
    });

    describe("4. Stock Movement API Routes", () => {
        it("GET /api/workspaces/[workspaceId]/inventory/movements — succeeds with 200", async () => {
            const mockData = { items: [{ id: "mov_1", movementType: "RECEIPT", quantity: 10 }], total: 1 };
            mocks.listStockMovements.mockResolvedValueOnce(mockData);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/movements`);
            const res = await listMovementsRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockData });
        });

        it("POST /api/workspaces/[workspaceId]/inventory/movements/receive — succeeds with 201", async () => {
            const mockRes = { movement: { id: "mov_rec", movementType: "RECEIPT" } };
            mocks.receiveStock.mockResolvedValueOnce(mockRes);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/movements/receive`, {
                method: "POST",
                body: JSON.stringify({ partId: PART_ID, locationId: LOC_ID, quantity: 10 }),
            });
            const res = await receiveStockRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(201);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockRes });
        });

        it("POST /api/workspaces/[workspaceId]/inventory/movements/transfer — succeeds with 201", async () => {
            const mockRes = { sourceMovement: { id: "mov_out" }, destinationMovement: { id: "mov_in" } };
            mocks.transferStock.mockResolvedValueOnce(mockRes);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/movements/transfer`, {
                method: "POST",
                body: JSON.stringify({ partId: PART_ID, fromLocationId: LOC_ID, toLocationId: "loc_to", quantity: 5 }),
            });
            const res = await transferStockRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(201);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockRes });
        });

        it("POST /api/workspaces/[workspaceId]/inventory/movements/adjust — succeeds with 201", async () => {
            const mockRes = { movement: { id: "mov_adj", movementType: "ADJUSTMENT" } };
            mocks.adjustStock.mockResolvedValueOnce(mockRes);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/movements/adjust`, {
                method: "POST",
                body: JSON.stringify({ partId: PART_ID, locationId: LOC_ID, quantity: -2, reason: "Damaged stock" }),
            });
            const res = await adjustStockRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(201);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockRes });
        });

        it("POST /api/workspaces/[workspaceId]/inventory/movements/reserve — succeeds with 201", async () => {
            const mockRes = { movement: { id: "mov_res", movementType: "RESERVATION" } };
            mocks.reserveStock.mockResolvedValueOnce(mockRes);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/movements/reserve`, {
                method: "POST",
                body: JSON.stringify({ partId: PART_ID, locationId: LOC_ID, quantity: 5 }),
            });
            const res = await reserveStockRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(201);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockRes });
        });

        it("POST /api/workspaces/[workspaceId]/inventory/movements/release — succeeds with 201", async () => {
            const mockRes = { movement: { id: "mov_rel", movementType: "RELEASE" } };
            mocks.releaseStock.mockResolvedValueOnce(mockRes);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/movements/release`, {
                method: "POST",
                body: JSON.stringify({ partId: PART_ID, locationId: LOC_ID, quantity: 5 }),
            });
            const res = await releaseStockRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(201);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockRes });
        });

        it("POST /api/workspaces/[workspaceId]/inventory/movements/consume — succeeds with 201", async () => {
            const mockRes = { movement: { id: "mov_con", movementType: "CONSUMPTION" }, createdWorkOrderPart: { id: WOP_ID } };
            mocks.consumeStock.mockResolvedValueOnce(mockRes);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/movements/consume`, {
                method: "POST",
                body: JSON.stringify({ partId: PART_ID, locationId: LOC_ID, workOrderId: "wo_100", quantity: 3 }),
            });
            const res = await consumeStockRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(201);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockRes });
        });

        it("POST /api/workspaces/[workspaceId]/inventory/movements/return — succeeds with 201", async () => {
            const mockRes = { movement: { id: "mov_ret", movementType: "RETURN" } };
            mocks.returnStock.mockResolvedValueOnce(mockRes);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/movements/return`, {
                method: "POST",
                body: JSON.stringify({
                    partId: PART_ID,
                    locationId: LOC_ID,
                    workOrderId: "wo_100",
                    originalWorkOrderPartId: WOP_ID,
                    quantity: 1,
                }),
            });
            const res = await returnStockRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(201);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockRes });
        });
    });

    describe("5. WorkOrderParts API Routes", () => {
        it("GET /api/workspaces/[workspaceId]/inventory/work-order-parts — succeeds with 200", async () => {
            const mockData = { items: [{ id: WOP_ID, partName: "Pipe", quantity: 3, netQuantityConsumed: 2 }], total: 1 };
            mocks.getWorkOrderParts.mockResolvedValueOnce(mockData);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/work-order-parts?workOrderId=wo_100`);
            const res = await listWorkOrderPartsRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockData });
        });

        it("GET /api/workspaces/[workspaceId]/inventory/work-order-parts/[id] — succeeds with 200", async () => {
            const mockItem = { id: WOP_ID, partName: "Pipe", quantity: 3, netQuantityConsumed: 2 };
            mocks.getWorkOrderPart.mockResolvedValueOnce(mockItem);

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/work-order-parts/${WOP_ID}`);
            const res = await getWorkOrderPartRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, id: WOP_ID }) });

            expect(res.status).toBe(200);
            const json = await res.json();
            expect(json).toEqual({ success: true, data: mockItem });
        });
    });

    describe("6. Error Mapping & Contract Hardening", () => {
        it("surfaces UnauthorizedError as HTTP 401 UNAUTHORIZED", async () => {
            mocks.getParts.mockRejectedValueOnce(new UnauthorizedError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/parts`);
            const res = await listPartsRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(401);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("UNAUTHORIZED");
        });

        it("surfaces ForbiddenError as HTTP 403 FORBIDDEN", async () => {
            mocks.createPart.mockRejectedValueOnce(new ForbiddenError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/parts`, {
                method: "POST",
                body: JSON.stringify({ name: "Valve" }),
            });
            const res = await createPartRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(403);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("FORBIDDEN");
        });

        it("surfaces PartNotFoundError as HTTP 404 PART_NOT_FOUND", async () => {
            mocks.getPart.mockRejectedValueOnce(new PartNotFoundError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/parts/${PART_ID}`);
            const res = await getPartRoute(req, { params: Promise.resolve({ workspaceId: WS_ID, partId: PART_ID }) });

            expect(res.status).toBe(404);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("PART_NOT_FOUND");
        });

        it("surfaces InsufficientStockError as HTTP 409 INSUFFICIENT_STOCK", async () => {
            mocks.reserveStock.mockRejectedValueOnce(new InsufficientStockError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/movements/reserve`, {
                method: "POST",
                body: JSON.stringify({ partId: PART_ID, locationId: LOC_ID, quantity: 100 }),
            });
            const res = await reserveStockRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(409);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("INSUFFICIENT_STOCK");
        });

        it("surfaces ExcessiveReturnError as HTTP 409 EXCESSIVE_RETURN", async () => {
            mocks.returnStock.mockRejectedValueOnce(new ExcessiveReturnError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/movements/return`, {
                method: "POST",
                body: JSON.stringify({
                    partId: PART_ID,
                    locationId: LOC_ID,
                    workOrderId: "wo_1",
                    originalWorkOrderPartId: WOP_ID,
                    quantity: 50,
                }),
            });
            const res = await returnStockRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(409);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("EXCESSIVE_RETURN");
        });

        it("surfaces TransferSameLocationError as HTTP 422 TRANSFER_SAME_LOCATION", async () => {
            mocks.transferStock.mockRejectedValueOnce(new TransferSameLocationError());

            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/movements/transfer`, {
                method: "POST",
                body: JSON.stringify({ partId: PART_ID, fromLocationId: LOC_ID, toLocationId: LOC_ID, quantity: 5 }),
            });
            const res = await transferStockRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(422);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("TRANSFER_SAME_LOCATION");
        });

        it("surfaces Invalid JSON body as HTTP 400 INVALID_REQUEST", async () => {
            const req = new Request(`http://localhost/api/workspaces/${WS_ID}/inventory/parts`, {
                method: "POST",
                body: "not-json{",
            });
            const res = await createPartRoute(req, { params: Promise.resolve({ workspaceId: WS_ID }) });

            expect(res.status).toBe(400);
            const json = await res.json();
            expect(json.success).toBe(false);
            expect(json.error.code).toBe("INVALID_REQUEST");
        });
    });
});
