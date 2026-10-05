import { describe, expect, it } from "vitest";
import {
  isCityDistrict,
  loadTripAfterCommand,
  manifestLineProgress,
  sortManifestLines,
  summarizeManifestLines,
} from "./loadManifest";
import type { LoadTripAllocation, LoadTripRecord } from "./types";

const line = (
  overrides: Partial<LoadTripAllocation> = {},
): LoadTripAllocation => ({
  id: "line-1",
  shipmentId: "shipment-1",
  shipmentNo: "B0126000001",
  itemId: "item-1",
  description: "รองเท้า",
  quantity: 20,
  originalQuantity: 50,
  unit: "กล่อง",
  receiverName: "ข ผู้รับ",
  senderName: "ผู้ส่ง",
  districtName: "เมืองพิษณุโลก",
  active: true,
  ...overrides,
});

const trip = (
  overrides: Partial<LoadTripRecord> = {},
): LoadTripRecord => ({
  id: "trip-1",
  manifestNo: "LOAD-1",
  status: "LOADED",
  destinationBranchId: "branch-1",
  destinationBranchCode: "PLK",
  vehicleId: "vehicle-1",
  vehicleNo: "70-1234",
  driverId: "driver-1",
  driverName: "คนขับ",
  loadedAt: "2026-10-05T08:00:00Z",
  departedAt: "",
  note: "",
  allocations: [],
  ...overrides,
});

describe("load manifest", () => {
  it("puts city districts first and then sorts receivers ก-ฮ", () => {
    const rows = sortManifestLines([
      line({ id: "4", districtName: "นครไทย", receiverName: "ข ผู้รับ" }),
      line({ id: "3", districtName: "วังทอง", receiverName: "ก ผู้รับ" }),
      line({ id: "2", districtName: "เมืองพิษณุโลก", receiverName: "ข ผู้รับ" }),
      line({ id: "1", districtName: "เมืองพิษณุโลก", receiverName: "ก ผู้รับ" }),
    ]);
    expect(rows.map((row) => row.id)).toEqual(["1", "2", "3", "4"]);
    expect(isCityDistrict("อำเภอเมืองสุโขทัย")).toBe(true);
  });

  it("shows the remaining quantity for a split shipment", () => {
    const current = trip({ allocations: [line()] });
    expect(manifestLineProgress(line(), current, [current])).toEqual({
      loadedBefore: 0,
      remaining: 30,
      split: true,
      completed: false,
    });
  });

  it("marks the final split trip complete and summarizes bills and units", () => {
    const earlierLine = line({ id: "earlier", quantity: 20 });
    const currentLine = line({ id: "current", quantity: 30 });
    const earlier = trip({
      id: "trip-0",
      manifestNo: "LOAD-0",
      loadedAt: "2026-10-04T08:00:00Z",
      allocations: [earlierLine],
    });
    const current = trip({ allocations: [currentLine] });
    expect(manifestLineProgress(currentLine, current, [earlier, current])).toEqual({
      loadedBefore: 20,
      remaining: 0,
      split: true,
      completed: true,
    });
    expect(
      summarizeManifestLines([
        currentLine,
        line({ id: "second", shipmentId: "shipment-2", quantity: 5 }),
      ]),
    ).toMatchObject({ billCount: 2, quantity: 35 });
  });

  it("updates a closed trip locally without waiting for a full reload", () => {
    const closed = loadTripAfterCommand(
      trip({ status: "DRAFT" }),
      "CLOSE",
      "2026-10-05T09:00:00Z",
      {
        vehicleId: "vehicle-2",
        vehicleNo: "70-5678",
        driverId: "driver-2",
        driverName: "สมชาย",
        note: "พร้อมออก",
      },
    );
    expect(closed).toMatchObject({
      status: "LOADED",
      vehicleId: "vehicle-2",
      vehicleNo: "70-5678",
      driverId: "driver-2",
      driverName: "สมชาย",
      loadedAt: "2026-10-05T09:00:00Z",
      note: "พร้อมออก",
    });
  });
});
