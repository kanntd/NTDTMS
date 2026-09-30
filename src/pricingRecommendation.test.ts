import { describe, expect, it } from "vitest";
import { buildPriceRecommendation } from "./Pricing";
import type {
  OperationsState,
  PriceAgreement,
  PriceRequest,
} from "./operationsStore";
import type { PaymentMode } from "./types";

const registry = {
  raw: {},
  defaults: {},
  partyRoles: {},
  parties: [
    {
      id: "receiver-main",
      display_name: "ผู้รับหลัก",
      phone: "",
      address: "",
      tax_id: "",
      credit_limit: 0,
      credit_days: 0,
      is_active: true,
      district: "เมืองพิษณุโลก",
      province: "พิษณุโลก",
    },
    {
      id: "receiver-same-area",
      display_name: "ผู้รับในอำเภอเดียวกัน",
      phone: "",
      address: "",
      tax_id: "",
      credit_limit: 0,
      credit_days: 0,
      is_active: true,
      district: "เมืองพิษณุโลก",
      province: "พิษณุโลก",
    },
    {
      id: "receiver-other-area",
      display_name: "ผู้รับต่างอำเภอ",
      phone: "",
      address: "",
      tax_id: "",
      credit_limit: 0,
      credit_days: 0,
      is_active: true,
      district: "วังทอง",
      province: "พิษณุโลก",
    },
    ...["sender-main", "sender-a", "sender-b", "sender-other"].map((id) => ({
      id,
      display_name: id,
      phone: "",
      address: "",
      tax_id: "",
      credit_limit: 0,
      credit_days: 0,
      is_active: true,
    })),
  ],
  catalog: [
    {
      id: "product-1",
      productId: "product",
      name: "น้ำปลา 450 มล.",
      unit: "ลัง",
    },
  ],
};

function emptyOperations(): OperationsState {
  return {
    version: 1,
    relationProductScopeVersion: 1,
    relations: [],
    receiverProducts: [],
    relationProducts: [],
    agreements: [],
    priceVersions: [],
    priceRequests: [],
    employees: [],
    vehicles: [],
    driverAssignments: [],
    documents: [],
  };
}

function addCurrentPrice(
  state: OperationsState,
  input: {
    id: string;
    receiverId: string;
    senderId: string;
    payment: PaymentMode;
    price: number;
    createdAt: string;
  },
) {
  const versionId = `${input.id}-version`;
  const agreement: PriceAgreement = {
    id: input.id,
    key: input.id,
    receiverId: input.receiverId,
    senderId: input.senderId,
    catalogId: "product-1",
    payment: input.payment,
    branch: "PLK",
    currentVersionId: versionId,
    active: true,
  };
  state.agreements.push(agreement);
  state.priceVersions.push({
    id: versionId,
    agreementId: agreement.id,
    version: 1,
    price: input.price,
    effectiveFrom: input.createdAt.slice(0, 10),
    reason: "ทดสอบราคา",
    source: "MANUAL",
    createdAt: input.createdAt,
    approvedBy: "บัญชี",
  });
}

function request(input: Partial<PriceRequest> = {}): PriceRequest {
  return {
    id: "request-1",
    key: "request-key",
    receiverId: "receiver-main",
    senderId: "sender-main",
    catalogId: "product-1",
    payment: "CASH_DESTINATION",
    branch: "PLK",
    billNumber: "BKK-69-000001",
    quantity: 1,
    proposedPrice: null,
    approvedPrice: null,
    actualCollectedAmount: null,
    status: "PENDING_PRICE",
    requestedAt: "2026-09-29T03:00:00.000Z",
    note: "",
    ...input,
  };
}

describe("price recommendations", () => {
  it("uses receiver, product and destination payment history across senders", () => {
    const operations = emptyOperations();
    addCurrentPrice(operations, {
      id: "agreement-a",
      receiverId: "receiver-main",
      senderId: "sender-a",
      payment: "CASH_DESTINATION",
      price: 30,
      createdAt: "2026-09-20T03:00:00.000Z",
    });
    addCurrentPrice(operations, {
      id: "agreement-b",
      receiverId: "receiver-main",
      senderId: "sender-b",
      payment: "CASH_DESTINATION",
      price: 30,
      createdAt: "2026-09-21T03:00:00.000Z",
    });

    const result = buildPriceRecommendation(request(), operations, registry);

    expect(result.price).toBe(30);
    expect(result.matchCount).toBe(2);
    expect(result.sourceLabel).toBe("ประวัติผู้รับ");
  });

  it("uses sender, product and destination district for origin-paid bills", () => {
    const operations = emptyOperations();
    addCurrentPrice(operations, {
      id: "same-area",
      receiverId: "receiver-same-area",
      senderId: "sender-main",
      payment: "CASH_ORIGIN",
      price: 45,
      createdAt: "2026-09-20T03:00:00.000Z",
    });
    addCurrentPrice(operations, {
      id: "other-area",
      receiverId: "receiver-other-area",
      senderId: "sender-main",
      payment: "CREDIT_ORIGIN",
      price: 60,
      createdAt: "2026-09-21T03:00:00.000Z",
    });
    addCurrentPrice(operations, {
      id: "other-sender",
      receiverId: "receiver-same-area",
      senderId: "sender-other",
      payment: "CASH_ORIGIN",
      price: 80,
      createdAt: "2026-09-22T03:00:00.000Z",
    });

    const result = buildPriceRecommendation(
      request({ payment: "CREDIT_ORIGIN" }),
      operations,
      registry,
    );

    expect(result.price).toBe(45);
    expect(result.matchCount).toBe(1);
    expect(result.sourceLabel).toBe("ประวัติสินค้าในพื้นที่");
  });

  it("prioritizes a destination report and flags a history conflict", () => {
    const operations = emptyOperations();
    addCurrentPrice(operations, {
      id: "agreement-a",
      receiverId: "receiver-main",
      senderId: "sender-a",
      payment: "CASH_DESTINATION",
      price: 30,
      createdAt: "2026-09-20T03:00:00.000Z",
    });

    const result = buildPriceRecommendation(
      request({ proposedPrice: 35, status: "PENDING_APPROVAL" }),
      operations,
      registry,
    );

    expect(result.price).toBe(35);
    expect(result.historyPrice).toBe(30);
    expect(result.confidence).toBe("review");
    expect(result.conflict).toContain("5.00");
  });
});
