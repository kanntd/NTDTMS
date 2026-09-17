import { describe, expect, it } from "vitest";
import {
  billEditAccessMessage,
  canEditShipment,
  editReasonRequired,
} from "./billEditPolicy";

describe("bill edit policy", () => {
  it("lets reception staff edit before loading", () => {
    expect(canEditShipment("clerk", "RECEIVED")).toBe(true);
    expect(editReasonRequired("RECEIVED")).toBe(false);
  });

  it("requires an owner or admin after loading", () => {
    expect(canEditShipment("clerk", "IN_TRANSIT")).toBe(false);
    expect(canEditShipment("accountant", "DELIVERED")).toBe(false);
    expect(canEditShipment("admin", "IN_TRANSIT")).toBe(true);
    expect(canEditShipment("owner", "DELIVERED")).toBe(true);
    expect(editReasonRequired("IN_TRANSIT")).toBe(true);
  });

  it("never edits cancelled bills", () => {
    expect(canEditShipment("owner", "CANCELLED")).toBe(false);
    expect(billEditAccessMessage("owner", "CANCELLED")).toContain("ยกเลิก");
  });
});
