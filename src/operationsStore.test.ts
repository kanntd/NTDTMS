import { describe, expect, it } from "vitest";
import {
  addInitialPriceIfMissing,
  addPriceVersion,
  activeRelationProduct,
  activeRelation,
  currentDriver,
  currentPrice,
  nextEmployeeCode,
  nextVehicleCode,
  pendingPriceRequest,
  type OperationsState,
} from "./operationsStore";
import { pairRateKey } from "./intakeEntryData";

function emptyState(): OperationsState {
  return {
    version: 1,
    relationProductScopeVersion: 1,
    relations: [],
    receiverProducts: [],
    relationProducts: [],
    agreements: [],
    priceVersions: [],
    priceRequests: [],
    employees: [],
    vehicles: [],
    driverAssignments: [],
    documents: [],
  };
}

describe("operational master data", () => {
  it("treats an unlinked customer pair as a first-time relationship", () => {
    const state = emptyState();
    expect(activeRelation(state, "receiver", "sender")).toBeUndefined();
    state.relations.push({
      id: "relation",
      receiverId: "receiver",
      senderId: "sender",
      defaultPayment: "CREDIT_DESTINATION",
      billingCycle: "MONTH_END",
      creditDays: 30,
      active: true,
      createdAt: "2026-09-11T00:00:00Z",
      updatedAt: "2026-09-11T00:00:00Z",
    });
    expect(activeRelation(state, "receiver", "sender")?.defaultPayment).toBe(
      "CREDIT_DESTINATION",
    );
    state.relations[0].active = false;
    expect(activeRelation(state, "receiver", "sender")).toBeUndefined();
  });

  it("keeps product choices scoped to the exact receiver-sender pair", () => {
    const state = emptyState();
    state.relationProducts.push({
      id: "pair-product",
      receiverId: "receiver",
      senderId: "sender-a",
      catalogId: "shoes:bag",
      active: true,
      createdAt: "2026-09-11T00:00:00Z",
    });

    expect(
      activeRelationProduct(state, "receiver", "sender-a", "shoes:bag"),
    ).toBe(true);
    expect(
      activeRelationProduct(state, "receiver", "sender-b", "shoes:bag"),
    ).toBe(false);
  });

  it("creates immutable price versions and points current price to the latest", () => {
    const state = emptyState();
    const input = {
      receiverId: "receiver",
      senderId: "sender",
      catalogId: "shoes:box",
      payment: "CREDIT_DESTINATION" as const,
      branch: "STI",
    };
    addPriceVersion(state, {
      ...input,
      price: 100,
      reason: "ราคาเริ่มต้น",
      source: "INITIAL",
    });
    const firstVersion = state.priceVersions[0];
    addPriceVersion(state, {
      ...input,
      price: 105,
      reason: "ปรับต้นทุนน้ำมัน",
      source: "MANUAL",
    });
    const key = pairRateKey(
      input.receiverId,
      input.senderId,
      input.catalogId,
      input.payment,
      input.branch,
    );
    expect(currentPrice(state, key)).toBe(105);
    expect(state.priceVersions.map((row) => row.price)).toEqual([100, 105]);
    expect(firstVersion).toMatchObject({ version: 1, price: 100 });
  });

  it("creates an initial standard price once without overwriting it later", () => {
    const state = emptyState();
    const input = {
      receiverId: "receiver",
      senderId: "sender",
      catalogId: "shoes:box",
      payment: "CASH_ORIGIN" as const,
      branch: "STI",
    };
    expect(
      addInitialPriceIfMissing(state, {
        ...input,
        price: 100,
        reason: "ราคาครั้งแรก",
      }),
    ).toBe(true);
    expect(
      addInitialPriceIfMissing(state, {
        ...input,
        price: 80,
        reason: "ลูกค้าขอลดเฉพาะบิล",
      }),
    ).toBe(false);
    expect(
      currentPrice(
        state,
        pairRateKey(
          input.receiverId,
          input.senderId,
          input.catalogId,
          input.payment,
          input.branch,
        ),
      ),
    ).toBe(100);
  });

  it("keeps a pending price request discoverable until accounting resolves it", () => {
    const state = emptyState();
    state.priceRequests.push({
      id: "request",
      key: "pair-key",
      receiverId: "receiver",
      senderId: "sender",
      catalogId: "shoes:bag",
      payment: "CASH_DESTINATION",
      branch: "STI",
      billNumber: "BKK-69-000001",
      quantity: 1,
      collectedPrice: null,
      actualCollectedAmount: null,
      status: "PENDING_PRICE",
      requestedAt: "2026-09-11T00:00:00Z",
      note: "",
    });
    expect(pendingPriceRequest(state, "pair-key")?.id).toBe("request");
    state.priceRequests[0].status = "PENDING_APPROVAL";
    expect(pendingPriceRequest(state, "pair-key")?.id).toBe("request");
    state.priceRequests[0].status = "RETURNED";
    expect(pendingPriceRequest(state, "pair-key")?.id).toBe("request");
    state.priceRequests[0].status = "RESOLVED";
    expect(pendingPriceRequest(state, "pair-key")).toBeUndefined();
  });

  it("derives the current driver from an open assignment", () => {
    const state = emptyState();
    state.employees.push({
      id: "driver",
      code: "EMP-001",
      name: "สมชาย ขับดี",
      phone: "",
      position: "พนักงานขับรถ",
      branch: "BKK",
      licenseNo: "",
      licenseExpiry: "",
      active: true,
    });
    state.driverAssignments.push({
      id: "assignment",
      vehicleId: "vehicle",
      employeeId: "driver",
      startsAt: "2026-09-11",
      endsAt: null,
    });
    expect(currentDriver(state, "vehicle")?.name).toBe("สมชาย ขับดี");
  });

  it("generates the next employee and vehicle codes without reusing gaps", () => {
    const state = emptyState();
    state.employees = [
      {
        id: "employee",
        code: "EMP-019",
        name: "พนักงาน",
        phone: "",
        position: "บัญชี",
        branch: "BKK",
        licenseNo: "",
        licenseExpiry: "",
        active: true,
      },
    ];
    state.vehicles = [
      {
        id: "vehicle",
        internalNo: "TRUCK-007",
        plateNo: "ทดสอบ",
        vehicleType: "รถบรรทุก 6 ล้อ",
        branch: "BKK",
        ownership: "OWNED",
        note: "",
        active: true,
      },
    ];

    expect(nextEmployeeCode(state)).toBe("EMP-020");
    expect(nextVehicleCode(state)).toBe("TRUCK-008");
  });
});
