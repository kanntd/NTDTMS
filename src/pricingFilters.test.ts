import { describe, expect, it } from "vitest";
import { isWithinPriceHistoryRange, matchesPriceFilters } from "./Pricing";

const row = {
  receiverId: "receiver-a",
  senderId: "sender-a",
  catalogId: "shoe-sack",
  payment: "CREDIT_DESTINATION" as const,
  branch: "STI",
};

const filters = {
  query: "",
  receiverId: "",
  senderId: "",
  catalogId: "",
  payment: "" as const,
  branch: "",
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
          catalogId: "shoe-sack",
          payment: "CREDIT_DESTINATION",
          branch: "STI",
        },
        row,
      ),
    ).toBe(true);
    expect(matchesPriceFilters({ ...filters, senderId: "sender-b" }, row)).toBe(
      false,
    );
  });

  it("treats history date boundaries as inclusive", () => {
    const createdAt = "2026-09-14T10:30:00.000Z";
    expect(
      isWithinPriceHistoryRange(createdAt, "2026-09-14", "2026-09-14"),
    ).toBe(true);
    expect(isWithinPriceHistoryRange(createdAt, "2026-09-15", "")).toBe(false);
    expect(isWithinPriceHistoryRange(createdAt, "", "2026-09-13")).toBe(false);
  });
});
