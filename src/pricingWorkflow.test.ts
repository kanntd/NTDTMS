import { beforeEach, describe, expect, it } from "vitest";
import { INTAKE_STORAGE_KEY } from "./intakeRegistry";
import { applyResolvedPriceToLocalBills } from "./Pricing";
import type { PriceRequest } from "./operationsStore";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

const request: PriceRequest = {
  id: "request-1",
  key: "pair-key",
  receiverId: "receiver-1",
  senderId: "sender-1",
  catalogId: "shoes:bag",
  payment: "CREDIT_DESTINATION",
  branch: "STI",
  billNumber: "BKK-69-000002",
  quantity: 1,
  proposedPrice: null,
  approvedPrice: null,
  actualCollectedAmount: null,
  status: "PENDING_APPROVAL",
  requestedAt: "2026-09-02T03:00:00.000Z",
  note: "",
};

function pendingBill(number: string, date: string) {
  const item = {
    id: `${number}-line`,
    catalogId: "shoes:bag",
    quantity: 1,
    price: null,
    requestPrice: true,
    name: "รองเท้า",
    unit: "กระสอบ",
  };
  return {
    number,
    date,
    draft: {
      receiverId: "receiver-1",
      senderId: "sender-1",
      payment: "CREDIT_DESTINATION",
      branch: "STI",
      lines: [{ ...item }],
      discount: 0,
      withholding: false,
      taxOverride: null,
      roundCash: false,
    },
    items: [{ ...item }],
    amounts: { total: 0, due: 0, pending: true },
  };
}

describe("price request approval", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: memoryStorage(),
      configurable: true,
    });
  });

  it("applies a standard price to the source and later pending bills only", () => {
    localStorage.setItem(
      INTAKE_STORAGE_KEY,
      JSON.stringify({
        bills: [
          pendingBill("BKK-69-000001", "2026-09-01T03:00:00.000Z"),
          pendingBill("BKK-69-000002", "2026-09-02T03:00:00.000Z"),
          pendingBill("BKK-69-000003", "2026-09-03T03:00:00.000Z"),
        ],
      }),
    );

    applyResolvedPriceToLocalBills(request, 100, "STANDARD");

    const bills = JSON.parse(localStorage.getItem(INTAKE_STORAGE_KEY)!).bills;
    expect(
      bills.map(
        (bill: { items: { price: number | null }[] }) => bill.items[0].price,
      ),
    ).toEqual([null, 100, 100]);
  });

  it("applies a bill-only price to the source bill only", () => {
    localStorage.setItem(
      INTAKE_STORAGE_KEY,
      JSON.stringify({
        bills: [
          pendingBill("BKK-69-000002", "2026-09-02T03:00:00.000Z"),
          pendingBill("BKK-69-000003", "2026-09-03T03:00:00.000Z"),
        ],
      }),
    );

    const followUp = applyResolvedPriceToLocalBills(request, 80, "BILL_ONLY");

    const bills = JSON.parse(localStorage.getItem(INTAKE_STORAGE_KEY)!).bills;
    expect(
      bills.map(
        (bill: { items: { price: number | null }[] }) => bill.items[0].price,
      ),
    ).toEqual([80, null]);
    expect(followUp).toEqual({
      billNumber: "BKK-69-000003",
      requestedAt: "2026-09-03T03:00:00.000Z",
      quantity: 1,
    });
  });
});
