import { describe, expect, it } from "vitest";
import {
  applyRecordedLoads,
  completeBillNumber,
  groupLoadingRows,
  summarizeLoadingDashboard,
} from "./loadingQueue";
import type { LoadingQueueRecord } from "./types";

const branches = [
  { code: "KPT", name: "กำแพงเพชร", color: "#8b65a4" },
  { code: "PLK", name: "พิษณุโลก", color: "#3477b8" },
];

const bill = (
  id: string,
  receiver: string,
  sender: string,
  quantity: number,
): LoadingQueueRecord => ({
  id,
  shipment_no: `B0126${id.padStart(6, "0")}`,
  received_at: "2026-09-20T00:00:00Z",
  sender_snapshot: { id: sender, display_name: sender, phone: "", address: "" },
  receiver_snapshot: {
    id: receiver,
    display_name: receiver,
    phone: "",
    address: "",
  },
  zone_id: "zone",
  district_id: "district",
  destination_branch_code: "KPT",
  payment_mode: "CREDIT_DESTINATION",
  total_amount: quantity * 10,
  total_quantity: quantity,
  total_weight: 0,
  shipment_status: "RECEIVED",
  items: [
    {
      id: `item-${id}`,
      product_id: "product",
      description: "ขนม",
      quantity,
      unit: "กล่อง",
      unit_price: 10,
      weight: 0,
      fragile: false,
    },
  ],
});

describe("loading queue", () => {
  it("summarizes every payment mode by destination branch", () => {
    const result = summarizeLoadingDashboard(
      [
        {
          id: "1",
          branchCode: "KPT",
          quantity: 500,
          amount: 9_500,
          paymentMode: "CREDIT_ORIGIN",
        },
        {
          id: "2",
          branchCode: "KPT",
          quantity: 200,
          amount: 18_000,
          paymentMode: "CREDIT_DESTINATION",
        },
      ],
      branches,
    );
    expect(result.rows[0]).toMatchObject({
      billCount: 2,
      quantity: 700,
      amount: 27_500,
    });
    expect(result.rows[0].payments.CREDIT_ORIGIN).toEqual({
      billCount: 1,
      amount: 9_500,
    });
    expect(result.total.payments.CREDIT_DESTINATION.amount).toBe(18_000);
  });

  it("groups a sender across several receivers without duplicating bills", () => {
    const rows = [
      bill("1", "ร้าน ก", "สยามร่วมมิตร", 2_000),
      bill("2", "ร้าน ข", "สยามร่วมมิตร", 1_500),
      bill("3", "ร้าน ค", "สยามร่วมมิตร", 1_500),
    ];
    const [group] = groupLoadingRows(rows, "SENDER");
    expect(group).toMatchObject({
      label: "สยามร่วมมิตร",
      billCount: 3,
      quantity: 5_000,
      counterpartCount: 3,
    });
    expect(group.itemSummary).toBe("ขนม 5,000 กล่อง");
  });

  it("pads a typed suffix and accepts a full QR bill number", () => {
    expect(completeBillNumber("B0126", "123")).toBe("B0126000123");
    expect(completeBillNumber("B0126", "B0126000123")).toBe("B0126000123");
  });

  it("keeps only the remaining quantity after a partial load", () => {
    const rows = applyRecordedLoads(
      [bill("1", "ร้าน ก", "ผู้ส่ง", 500)],
      [{ shipmentId: "1", itemId: "item-1", quantity: 200 }],
    );
    expect(rows[0]).toMatchObject({
      total_quantity: 300,
      total_amount: 3_000,
      items: [{ quantity: 300, original_quantity: 500, loaded_quantity: 200 }],
    });
  });
});
