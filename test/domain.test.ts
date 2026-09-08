import { describe, expect, it } from "vitest";
import { lineTotal, totals } from "../src/domain";
import type { Item } from "../src/types";

const item = (quantity: number, unit_price: number): Item => ({
  id: crypto.randomUUID(),
  product_id: "p1",
  description: "สินค้าทั่วไป",
  quantity,
  unit: "กล่อง",
  unit_price,
  weight: 0,
  fragile: false,
});

describe("billing math", () => {
  it("rounds each line to 2 decimals with half-up semantics", () => {
    expect(lineTotal(item(3, 10.335))).toBe(31.01);
    expect(lineTotal(item(2.5, 40))).toBe(100);
  });

  it("calculates subtotal, quantity, weight, extra charges, and discounts", () => {
    const rows = [item(2, 40), item(1.25, 80)];
    rows[0].weight = 3;
    rows[1].weight = 1.5;

    expect(totals(rows, 25, 5)).toEqual({
      subtotal: 180,
      total: 200,
      quantity: 3.25,
      weight: 4.5,
    });
  });
});
