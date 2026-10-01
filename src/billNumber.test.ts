import { describe, expect, it } from "vitest";
import {
  billNumberPrefix,
  compareBillsByOpenedAt,
  nextLocalBillNumber,
} from "./billNumber";

describe("bill numbering", () => {
  const date = new Date("2026-09-17T09:00:00+07:00");

  it("uses the issuing branch code, Gregorian year and six digits", () => {
    expect(billNumberPrefix("b01", date)).toBe("B0126");
    expect(nextLocalBillNumber("B01", [], date)).toBe("B0126000001");
  });

  it("counts independently for each branch and year", () => {
    expect(
      nextLocalBillNumber(
        "B01",
        ["B0126000001", "B0126000008", "K0126000012", "B0125000999"],
        date,
      ),
    ).toBe("B0126000009");
  });

  it("sorts by opened date and uses the bill number when dates match", () => {
    const rows = [
      { date: "2026-09-18T08:00:00Z", bill: "B0126000010" },
      { date: "2026-09-17T08:00:00Z", bill: "B0126000009" },
      { date: "2026-09-18T08:00:00Z", bill: "B0126000008" },
    ];

    expect(
      [...rows]
        .sort((left, right) =>
          compareBillsByOpenedAt(left.date, left.bill, right.date, right.bill),
        )
        .map((row) => row.bill),
    ).toEqual(["B0126000009", "B0126000008", "B0126000010"]);
    expect(
      [...rows]
        .sort((left, right) =>
          compareBillsByOpenedAt(
            left.date,
            left.bill,
            right.date,
            right.bill,
            true,
          ),
        )
        .map((row) => row.bill),
    ).toEqual(["B0126000010", "B0126000008", "B0126000009"]);
  });
});
