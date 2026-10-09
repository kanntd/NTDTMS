import { describe, expect, it } from "vitest";
import {
  canReviewPriceRequest,
  canSubmitPriceReview,
  isWithinPriceHistoryRange,
  isWithinPriceRequestRange,
  matchesPriceFilters,
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
};

const filters = {
  query: "",
  receiverId: "",
  senderId: "",
  productId: "",
  unit: "",
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

  it("allows only accounting reviewers to record an accounting result", () => {
    expect(canReviewPriceRequest("owner")).toBe(true);
    expect(canReviewPriceRequest("admin")).toBe(true);
    expect(canReviewPriceRequest("accountant")).toBe(true);
    expect(canReviewPriceRequest("clerk")).toBe(false);
    expect(canReviewPriceRequest("viewer")).toBe(false);
  });

  it("shows the accounting result below an open proposal only to reviewers", () => {
    expect(canSubmitPriceReview("owner", "PENDING_PRICE")).toBe(true);
    expect(canSubmitPriceReview("admin", "RETURNED")).toBe(true);
    expect(canSubmitPriceReview("accountant", "PENDING_APPROVAL")).toBe(true);
    expect(canSubmitPriceReview("clerk", "PENDING_PRICE")).toBe(false);
    expect(canSubmitPriceReview("viewer", "PENDING_APPROVAL")).toBe(false);
    expect(canSubmitPriceReview("owner", "RESOLVED")).toBe(false);
    expect(canSubmitPriceReview("admin", "CANCELLED")).toBe(false);
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
