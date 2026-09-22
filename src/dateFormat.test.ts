import { describe, expect, it } from "vitest";
import { parseDisplayDate } from "./DateInput";
import { thaiDate } from "./domain";

describe("Thai short date format", () => {
  it("displays a two-digit Buddhist year", () => {
    expect(thaiDate("2026-09-23")).toBe("23/09/69");
  });

  it("converts a typed Buddhist date back to the stored ISO date", () => {
    expect(parseDisplayDate("23/09/69")).toBe("2026-09-23");
    expect(parseDisplayDate("31/02/69")).toBeNull();
  });
});
