import { describe, expect, it } from "vitest";
import { refreshDraftLinePrice } from "./intakeDraftPrice";

describe("refreshDraftLinePrice", () => {
  it("keeps a price entered by the bill opener when master data refreshes", () => {
    const line = {
      price: 85,
      requestPrice: false,
      priceTouched: true,
      catalogId: "shoe-bag",
    };

    expect(refreshDraftLinePrice(line, null, false)).toBe(line);
  });

  it("refreshes an untouched automatic price from master data", () => {
    expect(
      refreshDraftLinePrice(
        { price: 100, requestPrice: false, priceTouched: false },
        105,
        false,
      ),
    ).toEqual({ price: 105, requestPrice: false, priceTouched: false });
  });

  it("marks an untouched line as waiting for price when a request exists", () => {
    expect(
      refreshDraftLinePrice(
        { price: 100, requestPrice: false, priceTouched: false },
        null,
        true,
      ),
    ).toEqual({ price: null, requestPrice: true, priceTouched: false });
  });
});
