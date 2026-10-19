import { describe, expect, it } from "vitest";
import {
  canReviewPriceRequest,
  isWithinPriceHistoryRange,
  isWithinPriceRequestRange,
  matchesPriceFilters,
  sortPriceRows,
  shouldShowPriceRequest,
} from "./Pricing";

const row = {
  receiverId: "receiver-a",
  senderId: "sender-a",
  catalogId: "shoe-sack",
  productId: "shoe",
  unit: "กระสอบ",
  payment: "CREDIT_DESTINATION" as const,
  branch: "STI",
  province: "พิษณุโลก",
  district: "เมืองพิษณุโลก",
};

const filters = {
  query: "",
  receiverId: "",
  senderId: "",
  productId: "",
  unit: "",
  payment: "" as const,
  branch: "",
  province: "",
  district: "",
};

describe("pricing filters", () => {
  it("shows every row when the shared filters are empty", () => {
    expect(matchesPriceFilters(filters, row)).toBe(true);
  });

  it("requires every selected dimension to match", () => {
    expect(
      matchesPriceFilters(
        {
          ...filters,
          receiverId: "receiver-a",
          senderId: "sender-a",
          productId: "shoe",
          unit: "กระสอบ",
          payment: "CREDIT_DESTINATION",
          branch: "STI",
        },
        row,
      ),
    ).toBe(true);
    expect(matchesPriceFilters({ ...filters, senderId: "sender-b" }, row)).toBe(
      false,
    );
    expect(matchesPriceFilters({ ...filters, unit: "กล่อง" }, row)).toBe(false);
  });

  it("separates product and unit filters", () => {
    expect(matchesPriceFilters({ ...filters, productId: "shoe" }, row)).toBe(
      true,
    );
    expect(matchesPriceFilters({ ...filters, productId: "bag" }, row)).toBe(
      false,
    );
    expect(matchesPriceFilters({ ...filters, unit: "กระสอบ" }, row)).toBe(true);
  });

  it("keeps credit-origin comparisons inside the selected province and district", () => {
    const selected = {
      ...filters,
      payment: "CREDIT_ORIGIN" as const,
      province: "พิษณุโลก",
      district: "เมืองพิษณุโลก",
    };
    const creditRow = { ...row, payment: "CREDIT_ORIGIN" as const };
    expect(matchesPriceFilters(selected, creditRow)).toBe(true);
    expect(
      matchesPriceFilters(selected, { ...creditRow, district: "วังทอง" }),
    ).toBe(false);
    expect(
      matchesPriceFilters(selected, { ...creditRow, province: "สุโขทัย" }),
    ).toBe(false);
    expect(matchesPriceFilters(selected, row)).toBe(false);
  });

  it("sorts the same product and unit together across senders", () => {
    const prices = [
      { ...row, id: "z", catalogId: "bag", senderId: "sender-b" },
      { ...row, id: "b", catalogId: "snack", senderId: "sender-b" },
      { ...row, id: "a", catalogId: "snack", senderId: "sender-a" },
    ];
    const catalog = [
      { id: "bag", productId: "bag", name: "ถุงพลาสติก", unit: "ห่อ" },
      { id: "snack", productId: "snack", name: "ขนมไก่ย่าง", unit: "มัด" },
    ];
    const parties = [
      { id: "sender-a", display_name: "ก" },
      { id: "sender-b", display_name: "ข" },
    ];
    expect(
      sortPriceRows(
        prices,
        catalog,
        parties as Parameters<typeof sortPriceRows>[2],
      ).map((price) => price.id),
    ).toEqual(["a", "b", "z"]);
    const amounts: Record<string, number> = { z: 30, b: 50, a: 40 };
    expect(
      sortPriceRows(
        prices,
        catalog,
        parties as Parameters<typeof sortPriceRows>[2],
        "PRICE_ASC",
        (price) => amounts[price.id],
      ).map((price) => price.id),
    ).toEqual(["z", "a", "b"]);
    expect(
      sortPriceRows(
        prices,
        catalog,
        parties as Parameters<typeof sortPriceRows>[2],
        "PRICE_DESC",
        (price) => amounts[price.id],
      ).map((price) => price.id),
    ).toEqual(["b", "a", "z"]);
  });

  it("allows only accounting reviewers to record an accounting result", () => {
    expect(canReviewPriceRequest("owner")).toBe(true);
    expect(canReviewPriceRequest("admin")).toBe(true);
    expect(canReviewPriceRequest("accountant")).toBe(true);
    expect(canReviewPriceRequest("clerk")).toBe(false);
    expect(canReviewPriceRequest("viewer")).toBe(false);
  });

  it("includes resolved and cancelled requests only when all rows are requested", () => {
    expect(shouldShowPriceRequest("PENDING_PRICE", false)).toBe(true);
    expect(shouldShowPriceRequest("PENDING_APPROVAL", false)).toBe(true);
    expect(shouldShowPriceRequest("RESOLVED", false)).toBe(false);
    expect(shouldShowPriceRequest("CANCELLED", false)).toBe(false);
    expect(shouldShowPriceRequest("RESOLVED", true)).toBe(true);
    expect(shouldShowPriceRequest("CANCELLED", true)).toBe(true);
  });

  it("treats history date boundaries as inclusive", () => {
    const createdAt = "2026-09-14T10:30:00.000Z";
    expect(
      isWithinPriceHistoryRange(createdAt, "2026-09-14", "2026-09-14"),
    ).toBe(true);
    expect(isWithinPriceHistoryRange(createdAt, "2026-09-15", "")).toBe(false);
    expect(isWithinPriceHistoryRange(createdAt, "", "2026-09-13")).toBe(false);
  });

  it("filters bill dates inclusively in Bangkok time", () => {
    const openedAt = "2026-09-14T18:30:00.000Z";
    expect(
      isWithinPriceRequestRange(openedAt, "2026-09-15", "2026-09-15"),
    ).toBe(true);
    expect(isWithinPriceRequestRange(openedAt, "2026-09-16", "")).toBe(false);
    expect(isWithinPriceRequestRange(openedAt, "", "2026-09-14")).toBe(false);
  });
});
