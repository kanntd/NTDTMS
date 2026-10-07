import { describe, expect, it } from "vitest";
import {
  hasIntakeDraftData,
  type IntakeDraftGuardInput,
} from "./intakeDraftGuard";

function blankDraft(): IntakeDraftGuardInput {
  return {
    receiverId: "",
    senderId: "",
    branch: "",
    payment: "",
    discount: 0,
    reason: "",
    withholding: false,
    taxOverride: null,
    roundCash: false,
    paymentReference: "",
    note: "",
    lines: [
      {
        catalogId: "",
        quantity: 1,
        price: null,
        requestPrice: false,
        weight: "",
        width: "",
        length: "",
        height: "",
      },
    ],
  };
}

describe("intake draft guard", () => {
  it("allows background synchronization for a blank bill", () => {
    expect(hasIntakeDraftData(blankDraft())).toBe(false);
  });

  it.each([
    ["receiver", (draft: IntakeDraftGuardInput) => (draft.receiverId = "r1")],
    [
      "quantity",
      (draft: IntakeDraftGuardInput) => (draft.lines[0].quantity = 4),
    ],
    ["note", (draft: IntakeDraftGuardInput) => (draft.note = "ของแตกง่าย")],
  ])("protects a partial bill after entering %s", (_name, update) => {
    const draft = blankDraft();
    update(draft);
    expect(hasIntakeDraftData(draft)).toBe(true);
  });
});
