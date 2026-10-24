import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { demoBranches, demoZones, loadDemo, saveDemo } from "./demo";
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
  it.each([
    {
      amount: 100,
      variance: -150,
      discount: 150,
      extra: 0,
      kind: "SHORT" as const,
    },
    {
      amount: 280,
      variance: 30,
      discount: 0,
      extra: 30,
      kind: "OVER" as const,
    },
  ])(
    "closes a priced bill at actual cash $amount without changing unit prices",
    async ({ amount, variance, discount, extra, kind }) => {
      const service = createService(true);
      const before = (await service.detail("bill-1")).items.map(
        (item) => item.unit_price,
      );
      const input = {
        shipment_id: "bill-1",
        request_id: crypto.randomUUID(),
        amount,
        method: "CASH" as const,
        method_option_id: null,
        note: "",
        expected_total: 250,
        expected_paid: 0,
        expected_discount: 0,
      };
      const first = await service.closeCod(input);
      expect(first.variance).toBe(variance);
      expect((await service.closeCod(input)).closure_id).toBe(first.closure_id);
      const bill = (
        await service.shipments({ payment: "CASH_DESTINATION" })
      ).rows.find((row) => row.id === "bill-1")!;
      expect(bill.items?.map((item) => item.unit_price)).toEqual(before);
      expect(bill.total_amount).toBe(amount);
      expect(bill.paid_amount).toBe(amount);
      expect(bill.outstanding_amount).toBe(0);
      expect(bill.discount).toBe(discount);
      expect(bill.extra_charge).toBe(extra);
      expect(
        (await service.codClosures({ kind, page: 0, pageSize: 30 })).rows,
      ).toMatchObject([{ shipmentNo: "B0126000001", variance }]);
      expect(await service.codPayments()).toHaveLength(1);
      await expect(
        service.closeCod({ ...input, request_id: crypto.randomUUID() }),
      ).rejects.toThrow("ปิดตามยอดรับจริงแล้ว");
    },
  );

  it("keeps unpriced bills open and closes an overpaid approved bill without another payment", async () => {
    const state = loadDemo();
    state.shipments[0].price_pending = true;
    state.shipments[0].total_amount = 0;
    state.shipments[0].outstanding_amount = 0;
    saveDemo(state);
    const service = createService(true);
    const input = {
      shipment_id: "bill-1",
      request_id: crypto.randomUUID(),
      amount: 0,
      method: "CASH" as const,
      method_option_id: null,
      note: "",
      expected_total: 0,
      expected_paid: 0,
      expected_discount: 0,
    };
    await expect(service.closeCod(input)).rejects.toThrow(
      "ยังไม่มีราคาที่ยืนยัน",
    );
    const priced = loadDemo();
    priced.shipments[0].price_pending = false;
    priced.shipments[0].total_amount = 120;
    priced.shipments[0].outstanding_amount = 0;
    priced.shipments[0].paid_amount = 140;
    saveDemo(priced);
    const result = await service.closeCod({
      ...input,
      expected_total: 120,
      expected_paid: 140,
    });
    expect(result.variance).toBe(20);
    expect(result.payment_id).toBeNull();
    expect(
      (await service.codClosures({ kind: "OVER", page: 0, pageSize: 30 }))
        .count,
    ).toBe(1);
  });
  it("records real cash on an unpriced zero-value bill as an advance", async () => {
    const state = loadDemo();
    state.shipments[0].total_amount = 0;
    state.shipments[0].outstanding_amount = 0;
    state.shipments[0].price_pending = true;
    saveDemo(state);
    const service = createService(true);
    const input = {
      shipment_id: "bill-1",
      request_id: crypto.randomUUID(),
      advance: true,
      amount: 80,
      method: "CASH" as const,
      method_option_id: null,
      note: "รับเงินก่อนยืนยันราคา",
      discount: 0,
      expected_discount: 0,
      items: [{ item_id: "line-2", unit_price: 40 }],
    };
    const result = await service.collectCod(input);
    expect(result.submitted_prices).toBe(1);
    expect((await service.collectCod(input)).payment_id).toBe(
      result.payment_id,
    );
    expect(await service.codPayments()).toMatchObject([
      { shipmentId: "bill-1", amount: 80 },
    ]);
    expect(
      (await service.shipments({ payment: "CASH_DESTINATION" })).rows[0],
    ).toMatchObject({
      total_amount: 0,
      paid_amount: 80,
      outstanding_amount: 0,
    });
    expect(loadOperations().priceRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          shipmentItemId: "line-2",
          proposedPrice: 40,
          status: "PENDING_APPROVAL",
        }),
      ]),
    );
  });

  it("accepts cash while every item price is still blank", async () => {
    const state = loadDemo();
    state.shipments[0].total_amount = 0;
    state.shipments[0].outstanding_amount = 0;
    state.shipments[0].price_pending = true;
    saveDemo(state);
    const service = createService(true);
    expect(
      (
        await service.collectCod({
          shipment_id: "bill-1",
          request_id: crypto.randomUUID(),
          advance: true,
          amount: 250,
          method: "CASH",
          method_option_id: null,
          note: "ยังไม่ทราบราคา",
          discount: 0,
          expected_discount: 0,
          items: [],
        })
      ).submitted_prices,
    ).toBe(0);
    expect(await service.codPayments()).toMatchObject([
      { shipmentId: "bill-1", amount: 250 },
    ]);
    expect(loadOperations().priceRequests).toHaveLength(0);
  });

  it("rejects advances on bills without pending prices", async () => {
    const service = createService(true);
    await expect(
      service.collectCod({
        shipment_id: "bill-1",
        request_id: crypto.randomUUID(),
        advance: true,
        amount: 300,
        method: "CASH",
        method_option_id: null,
        note: "",
        discount: 0,
        expected_discount: 0,
        items: [],
      }),
    ).rejects.toThrow();
  });

  it("submits a delivered zero-value bill's item price without recording a payment", async () => {
    const state = loadDemo();
    state.shipments[0].total_amount = 0;
    state.shipments[0].outstanding_amount = 0;
    state.shipments[0].price_pending = true;
    saveDemo(state);
    const service = createService(true);
    const prices = [{ item_id: "line-2", unit_price: 40 }];
    expect(await service.submitCodPrices("bill-1", prices)).toEqual({
      submitted_prices: 1,
    });
    expect(await service.submitCodPrices("bill-1", prices)).toEqual({
      submitted_prices: 0,
    });
    expect(await service.codPayments()).toHaveLength(0);
    expect(loadOperations().priceRequests).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          shipmentItemId: "line-2",
          proposedPrice: 40,
          status: "PENDING_APPROVAL",
        }),
      ]),
    );
  });

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
