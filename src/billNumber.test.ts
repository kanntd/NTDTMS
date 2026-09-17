import { describe, expect, it } from "vitest";
import { billNumberPrefix, nextLocalBillNumber } from "./billNumber";

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
});
