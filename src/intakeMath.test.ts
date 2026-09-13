import { describe, expect, it } from "vitest";
import { intakeAmounts, onePercent } from "./intakeMath";
import {
  agreedPrice,
  BRANCH_OPTIONS,
  paymentDefault,
  RECEIVER_CATALOG,
  senderPair,
} from "./intakeData";
import {
  monthlyBillingPeriod,
  normalizeEntry,
  pairRateKey,
} from "./intakeEntryData";

describe("reception agreements", () => {
  it("starts without sample customer relationships", () => {
    expect(paymentDefault("receiver", "sender")).toBe("CREDIT_DESTINATION");
    expect(senderPair("receiver", "sender")).toBeUndefined();
  });
  it("keeps service branches while starting the catalog empty", () => {
    expect(RECEIVER_CATALOG).toEqual({});
    expect(BRANCH_OPTIONS.map((branch) => branch.code)).toEqual([
      "KPT",
      "PLK",
      "STI",
      "SWL",
    ]);
  });
  it("has no preset price for a newly entered customer pair", () => {
    expect(
      agreedPrice(
        "receiver",
        "sender",
        "product",
        "กล่อง",
        "CASH_ORIGIN",
        "STI",
      ),
    ).toBeNull();
  });
});

describe("reception totals", () => {
  it("distinguishes unknown prices from a real zero", () => {
    expect(
      intakeAmounts([{ price: null, quantity: 2 }], 0, 0, false).pending,
    ).toBe(true);
    expect(
      intakeAmounts([{ price: 0, quantity: 2 }], 0, 0, false).pending,
    ).toBe(false);
  });
  it("calculates multiple rows, bill discount and withholding separately", () => {
    const rows = [
      { price: 85, quantity: 6 },
      { price: 150, quantity: 2 },
    ];
    expect(intakeAmounts(rows, 10, 8, false)).toEqual({
      subtotal: 810,
      total: 800,
      due: 792,
      rounding: 0,
      pending: false,
    });
    expect(rows[0].price).toBe(85);
  });
  it("rounds cash independently of the tax amount", () => {
    const tax = onePercent(130);
    expect(tax).toBe(1.3);
    expect(
      intakeAmounts([{ price: 65, quantity: 2 }], 0, tax, true),
    ).toMatchObject({ due: 129, rounding: 0.3 });
    expect(intakeAmounts([{ price: 65, quantity: 2 }], 0, 1, false).due).toBe(
      129,
    );
  });
});

describe("reception entry data", () => {
  it("groups credit bills by their calendar month", () => {
    expect(monthlyBillingPeriod(new Date(2026, 1, 10))).toEqual({
      month: "2026-02",
      start: "2026-02-01",
      end: "2026-02-28",
    });
  });

  it("normalizes duplicate names and keeps pair rates scoped", () => {
    expect(normalizeEntry("บจก. ก้าว-ดี")).toBe(normalizeEntry("บจก ก้าวดี"));
    expect(
      pairRateKey("r1", "s1", "รองเท้า:มัด", "CREDIT_DESTINATION", "STI"),
    ).not.toBe(
      pairRateKey("r1", "s2", "รองเท้า:มัด", "CREDIT_DESTINATION", "STI"),
    );
  });
});
