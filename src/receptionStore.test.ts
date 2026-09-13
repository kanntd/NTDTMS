import { beforeEach, describe, expect, it } from "vitest";
import {
  RECEPTION_STORAGE_KEY,
  readReceptionBills,
  receptionBillToShipment,
  updateReceptionBillStatus,
  type StoredReceptionBill,
} from "./receptionStore";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

const bill: StoredReceptionBill = {
  id: "bill-1",
  number: "BKK-69-000001",
  date: "2026-09-12T03:00:00.000Z",
  draft: {
    branch: "SWL",
    payment: "CREDIT_DESTINATION",
    days: 30,
    collect: false,
    note: "",
    discount: 20,
    reason: "ส่วนลดเฉพาะบิล",
  },
  receiver: {
    id: "receiver-1",
    display_name: "ร้านผู้รับ",
    phone: "0800000001",
    address: "สวรรคโลก",
    tax_id: "",
    credit_days: 30,
    credit_limit: 0,
    is_active: true,
    district: "สวรรคโลก",
  },
  sender: {
    id: "sender-1",
    display_name: "ร้านผู้ส่ง",
    phone: "0800000002",
    address: "กรุงเทพฯ",
    tax_id: "",
    credit_days: 30,
    credit_limit: 0,
    is_active: true,
  },
  items: [
    {
      id: "line-1",
      catalogId: "shoe:sack",
      name: "รองเท้า",
      unit: "กระสอบ",
      quantity: 4,
      price: 100,
      requestPrice: false,
    },
  ],
  amounts: { total: 380, due: 380, pending: false },
};

describe("reception bill storage bridge", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: memoryStorage(),
      configurable: true,
    });
    localStorage.setItem(
      RECEPTION_STORAGE_KEY,
      JSON.stringify({ version: 5, bills: [bill] }),
    );
  });

  it("converts a reception bill into a searchable shipment", () => {
    const shipment = receptionBillToShipment(readReceptionBills()[0]);
    expect(shipment).toMatchObject({
      shipment_no: "BKK-69-000001",
      destination_branch_code: "SWL",
      district_name: "สวรรคโลก",
      total_quantity: 4,
      total_amount: 380,
      discount: 20,
      shipment_status: "RECEIVED",
    });
    expect(shipment.items[0]).toMatchObject({
      description: "รองเท้า",
      quantity: 4,
      unit: "กระสอบ",
      unit_price: 100,
    });
  });

  it("records truck loading without removing the bill history", () => {
    expect(
      updateReceptionBillStatus("bill-1", "IN_TRANSIT", {
        manifestNo: "LOAD-690912-0001",
        vehicleId: "vehicle-1",
        vehicleNo: "70-1234 กรุงเทพมหานคร",
        driverId: "driver-1",
        driverName: "สมชาย ขับดี",
        confirmedAt: "2026-09-12T04:00:00.000Z",
      }),
    ).toBe(true);
    expect(readReceptionBills()[0]).toMatchObject({
      id: "bill-1",
      shipmentStatus: "IN_TRANSIT",
      load: {
        manifestNo: "LOAD-690912-0001",
        driverName: "สมชาย ขับดี",
      },
    });
  });
});
