import { describe, expect, it } from "vitest";
import { compareListSort, firstItemName } from "./listSort";

describe("list sorting", () => {
  const first = {
    receiver: "ก",
    sender: "ข",
    product: "ถุงพลาสติก",
    unit: "ห่อ",
    price: 30,
  };
  const second = {
    receiver: "ข",
    sender: "ก",
    product: "น้ำปลา",
    unit: "ลัง",
    price: 50,
  };

  it("sorts Thai names and prices in both directions", () => {
    expect(compareListSort(first, second, "RECEIVER")).toBeLessThan(0);
    expect(compareListSort(first, second, "SENDER")).toBeGreaterThan(0);
    expect(compareListSort(first, second, "PRICE_ASC")).toBeLessThan(0);
    expect(compareListSort(first, second, "PRICE_DESC")).toBeGreaterThan(0);
  });

  it("keeps missing prices after known prices", () => {
    expect(
      compareListSort({ ...first, price: null }, second, "PRICE_ASC"),
    ).toBeGreaterThan(0);
    expect(
      compareListSort({ ...first, price: null }, second, "PRICE_DESC"),
    ).toBeGreaterThan(0);
  });

  it("uses the first Thai item for bills with several products", () => {
    expect(
      firstItemName(
        [
          { description: "น้ำปลา", unit: "ลัง" },
          { description: "ถุงพลาสติก", unit: "ห่อ" },
        ],
        "description",
      ),
    ).toBe("ถุงพลาสติก");
  });
});
