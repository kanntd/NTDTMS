import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { demoBranches, demoZones, saveDemo } from "./demo";
import { loadOperations } from "./operationsStore";
import { createService } from "./service";
import type { ShipmentDetail } from "./types";

const originalStorage = globalThis.localStorage;

beforeEach(() => {
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) || null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    },
  });
  const shipment = {
    id: "bill-1",
    shipment_no: "B0126000001",
    received_at: new Date().toISOString(),
    sender_party_id: "sender-1",
    receiver_party_id: "receiver-1",
    sender_snapshot: {
      id: "sender-1",
      display_name: "ผู้ส่ง",
      phone: "",
      address: "",
    },
    receiver_snapshot: {
      id: "receiver-1",
      display_name: "ผู้รับ",
      phone: "",
      address: "",
    },
    zone_id: "z-plk",
    district_id: "plk-1",
    destination_branch_code: "PHS",
    zone_name: "พิษณุโลก",
    district_name: "เมืองพิษณุโลก",
    zone_color: "#3174c6",
    payment_mode: "CASH_DESTINATION",
    credit_days: 0,
    payer_party_id: "receiver-1",
    total_amount: 250,
    total_quantity: 3,
    total_weight: 0,
    paid_amount: 0,
    outstanding_amount: 250,
    shipment_status: "DELIVERED",
    note: "",
    dropoff_name: "",
    dropoff_phone: "",
    extra_charge: 0,
    discount: 0,
    price_reason: "",
    invoice_id: "invoice-1",
    due_date: "2026-10-20",
    created_by: "demo",
    files: [],
    items: [
      {
        id: "line-1",
        product_id: "catalog-1",
        product_unit_id: "catalog-1",
        description: "ถุงพลาสติก",
        quantity: 2,
        unit: "ห่อ",
        unit_price: 25,
        weight: 0,
        fragile: false,
      },
      {
        id: "line-2",
        product_id: "catalog-2",
        product_unit_id: "catalog-2",
        description: "ขนมไก่ย่าง",
        quantity: 1,
        unit: "มัด",
        unit_price: 0,
        price_pending: true,
        weight: 0,
        fragile: false,
      },
    ],
  } as ShipmentDetail;
  saveDemo({
    shipments: [shipment],
    parties: [],
    branches: demoBranches,
    zones: demoZones,
    rules: [],
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: originalStorage,
  });
});

describe("demo COD collection", () => {
  it("saves a discount and payment once while sending changed line prices for approval", async () => {
    const service = createService(true);
    const optionId = await service.addCodPaymentMethod("พร้อมเพย์", "TRANSFER");
    const input = {
      shipment_id: "bill-1",
      request_id: crypto.randomUUID(),
      amount: 240,
      method: "TRANSFER" as const,
      method_option_id: optionId,
      note: "โอนแล้ว",
      discount: 10,
      expected_discount: 0,
      items: [{ item_id: "line-1", unit_price: 30 }],
    };
    const first = await service.collectCod(input);
    expect(first.submitted_prices).toBe(1);
    expect((await service.collectCod(input)).payment_id).toBe(first.payment_id);
    const result = await service.shipments({ payment: "CASH_DESTINATION" });
    expect(result.rows[0]).toMatchObject({
      total_amount: 240,
      paid_amount: 240,
      outstanding_amount: 0,
      discount: 10,
    });
    expect(await service.codPayments()).toHaveLength(1);
    expect(loadOperations().priceRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          billNumber: "B0126000001",
          shipmentItemId: "line-1",
          proposedPrice: 30,
          status: "PENDING_APPROVAL",
        }),
      ]),
    );
  });

  it("rejects a stale second collection after the bill was collected", async () => {
    const service = createService(true);
    const input = {
      shipment_id: "bill-1",
      request_id: crypto.randomUUID(),
      amount: 240,
      method: "CASH" as const,
      method_option_id: null,
      note: "",
      discount: 10,
      expected_discount: 0,
      items: [],
    };
    await service.collectCod(input);
    await expect(
      service.collectCod({ ...input, request_id: crypto.randomUUID() }),
    ).rejects.toThrow("ส่วนลดของบิลเปลี่ยนแล้ว");
  });
});
