import { describe, expect, it } from "vitest";
import {
  adjustedCodAmounts,
  isCurrencyAmount,
  knownCodPrices,
} from "./codPricing";
import type { Item, Shipment } from "./types";

const item = (id: string, description: string, quantity: number): Item => ({
  id,
  description,
  quantity,
  product_id: id,
  unit: "ห่อ",
  unit_price: 0,
  weight: 0,
  fragile: false,
});

const bill = {
  total_amount: 250,
  outstanding_amount: 170,
  paid_amount: 80,
  discount: 0,
} as Shipment;

describe("COD item prices and discount", () => {
  it("keeps unknown product prices empty and totals the known lines", () => {
    const items = [item("one", "ถุงพลาสติก", 2), item("two", "ขนมไก่ย่าง", 1)];
    expect(knownCodPrices(items, { one: "30.00", two: "" })).toEqual({
      lines: [{ item_id: "one", unit_price: 30 }],
      knownTotal: 60,
      unknownCount: 1,
    });
  });

  it("reduces both the bill total and outstanding amount by the discount change", () => {
    expect(adjustedCodAmounts(bill, 10)).toEqual({
      total: 240,
      outstanding: 160,
    });
    expect(
      adjustedCodAmounts(
        { ...bill, discount: 10, total_amount: 240, outstanding_amount: 160 },
        5,
      ),
    ).toEqual({ total: 245, outstanding: 165 });
  });

  it("rejects a line price with more than two decimal places", () => {
    const items = [item("one", "ถุงพลาสติก", 2)];
    expect(() => knownCodPrices(items, { one: "30.001" })).toThrow(
      "ราคาต่อหน่วย",
    );
  });

  it("accepts ordinary satang amounts without floating point rejection", () => {
    expect(isCurrencyAmount(0.29)).toBe(true);
    expect(isCurrencyAmount(0.291)).toBe(false);
  });
});
