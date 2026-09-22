import { beforeEach, describe, expect, it, vi } from "vitest";
import { createService } from "./service";
import { loadDemo, saveDemo } from "./demo";
import { loadOperations, saveOperations } from "./operationsStore";
import type { ShipmentDetail } from "./types";

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  });
  const state = loadDemo();
  state.shipments.push({
    id: "bill-1",
    shipment_no: "B01000001",
    received_at: new Date().toISOString(),
    sender_snapshot: { display_name: "ผู้ส่ง", phone: "", address: "" },
    receiver_snapshot: { display_name: "ผู้รับ", phone: "", address: "" },
    zone_id: "z-kpt",
    district_id: "kpt-1",
    destination_branch_code: "KPT",
    payment_mode: "CASH_DESTINATION",
    total_amount: 100,
    total_quantity: 10,
    total_weight: 0,
    shipment_status: "RECEIVED",
    items: [
      { id: "item-1", quantity: 10, description: "สินค้า", unit: "ชิ้น" },
    ],
  } as ShipmentDetail);
  saveDemo(state);
  const operations = loadOperations();
  operations.vehicles.push({
    id: "vehicle-1",
    internalNo: "1",
    plateNo: "กข 1234",
    vehicleType: "รถบรรทุก",
    branch: "BKK",
    ownership: "OWNED",
    note: "",
    active: true,
  });
  operations.employees.push({
    id: "driver-1",
    code: "D1",
    name: "คนขับ",
    nickname: "",
    phone: "",
    position: "พนักงานขับรถ",
    branch: "BKK",
    licenseNo: "",
    licenseExpiry: "",
    active: true,
  });
  operations.driverAssignments.push({
    id: "assignment-1",
    vehicleId: "vehicle-1",
    employeeId: "driver-1",
    startsAt: new Date().toISOString(),
    endsAt: null,
  });
  saveOperations(operations);
});

describe("load trip drafts", () => {
  it("reserves quantities across trips and releases them when removed", async () => {
    const service = createService(true);
    const first = await service.createLoadTrip("LOAD-ONE", "KPT", "vehicle-1");
    const second = await service.createLoadTrip("LOAD-TWO", "KPT", "vehicle-1");
    expect(
      (await service.loadTrips()).find((trip) => trip.id === first)?.vehicleNo,
    ).toBe("กข 1234");
    await service.saveLoadTripItems(first, "ADD", [
      { shipmentId: "bill-1", itemId: "item-1", quantity: 6 },
    ]);
    expect((await service.loadingQueue())[0].items[0].quantity).toBe(4);
    await expect(
      service.saveLoadTripItems(second, "ADD", [
        { shipmentId: "bill-1", itemId: "item-1", quantity: 5 },
      ]),
    ).rejects.toThrow("จำนวนขึ้นรถมากกว่าจำนวนคงเหลือ");
    await service.saveLoadTripItems(second, "ADD", [
      { shipmentId: "bill-1", itemId: "item-1", quantity: 4 },
    ]);
    expect(await service.loadingQueue()).toHaveLength(0);
    await service.saveLoadTripItems(first, "SET", [
      { shipmentId: "bill-1", itemId: "item-1", quantity: 3 },
    ]);
    expect((await service.loadingQueue())[0].items[0].quantity).toBe(3);
  });

  it("closes a trip before departure and locks its allocations", async () => {
    const service = createService(true);
    const id = await service.createLoadTrip("LOAD-CLOSE", "KPT", "vehicle-1");
    await service.saveLoadTripItems(id, "ADD", [
      { shipmentId: "bill-1", itemId: "item-1", quantity: 6 },
    ]);
    await service.setLoadTripStatus(id, "CLOSE", {
      vehicleId: "vehicle-1",
      driverId: "driver-1",
    });
    expect((await service.loadTrips())[0].status).toBe("LOADED");
    expect(loadDemo().shipments[0].shipment_status).toBe("RECEIVED");
    await expect(
      service.saveLoadTripItems(id, "SET", [
        { shipmentId: "bill-1", itemId: "item-1", quantity: 5 },
      ]),
    ).rejects.toThrow("แก้สินค้าไม่ได้");
    await service.setLoadTripStatus(id, "REOPEN", { reason: "แก้จำนวนสินค้า" });
    await service.saveLoadTripItems(id, "SET", [
      { shipmentId: "bill-1", itemId: "item-1", quantity: 5 },
    ]);
    await service.setLoadTripStatus(id, "CLOSE", {
      vehicleId: "vehicle-1",
      driverId: "driver-1",
    });
    await service.setLoadTripStatus(id, "DEPART");
    expect((await service.loadTrips())[0].status).toBe("DEPARTED");
    expect(loadDemo().shipments[0].shipment_status).toBe("IN_TRANSIT");
  });

  it("requires an active vehicle when creating a trip", async () => {
    await expect(
      createService(true).createLoadTrip("LOAD-NO-VEHICLE", "KPT", ""),
    ).rejects.toThrow("ไม่พบทะเบียนรถ");
  });
});
