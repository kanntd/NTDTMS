import { describe, expect, it } from "vitest";
import {
  buildCodSummary,
  codCollectionStatus,
  compareBillNumbers,
  matchesCodDeliveryFilter,
  matchingBills,
  outstandingCodBills,
  withRecordedDeliveryDates,
} from "./codCollection";
import type { Shipment } from "./types";

const shipment = (patch: Partial<Shipment>): Shipment =>
  ({
    id: "bill-1",
    shipment_no: "NTD-9",
    received_at: "2026-09-27T03:00:00.000Z",
    sender_snapshot: { display_name: "ผู้ส่ง", phone: "", address: "" },
    receiver_snapshot: { display_name: "ผู้รับ", phone: "", address: "" },
    zone_id: "zone",
    district_id: "district",
    zone_name: "นครสวรรค์",
    district_name: "เมือง",
    zone_color: "#196b55",
    payment_mode: "CASH_DESTINATION",
    credit_days: 0,
    payer_party_id: "receiver",
    total_amount: 1000,
    total_quantity: 1,
    total_weight: 1,
    paid_amount: 0,
    outstanding_amount: 1000,
    shipment_status: "DELIVERED",
    note: "",
    dropoff_name: "",
    dropoff_phone: "",
    extra_charge: 0,
    discount: 0,
    price_reason: "",
    invoice_id: "invoice",
    due_date: "2026-09-27",
    created_by: "user",
    delivered_at: "2026-09-27T05:00:00.000Z",
    ...patch,
  }) as Shipment;

describe("COD collection model", () => {
  it("distinguishes pending, partial and collected bills", () => {
    expect(codCollectionStatus(shipment({}))).toBe("PENDING");
    expect(
      codCollectionStatus(
        shipment({ paid_amount: 400, outstanding_amount: 600 }),
      ),
    ).toBe("PARTIAL");
    expect(
      codCollectionStatus(
        shipment({ paid_amount: 1000, outstanding_amount: 0 }),
      ),
    ).toBe("COLLECTED");
  });

  it("summarizes outstanding, overdue and today's payments", () => {
    const rows = [
      shipment({ id: "old" }),
      shipment({
        id: "today",
        shipment_no: "NTD-10",
        delivered_at: "2026-09-28T04:00:00.000Z",
        paid_amount: 250,
        outstanding_amount: 750,
      }),
      shipment({
        id: "paid",
        shipment_no: "NTD-11",
        delivered_at: "2026-09-28T05:00:00.000Z",
        paid_amount: 1000,
        outstanding_amount: 0,
      }),
    ];
    const summary = buildCodSummary(
      rows,
      [
        {
          shipmentId: "today",
          amount: 250,
          receivedAt: "2026-09-28T06:00:00.000Z",
        },
        {
          shipmentId: "paid",
          amount: 1000,
          receivedAt: "2026-09-28T07:00:00.000Z",
        },
      ],
      "2026-09-28",
    );
    expect(summary.outstanding).toEqual({ count: 2, amount: 1750 });
    expect(summary.overdue).toEqual({ count: 1, amount: 1000 });
    expect(summary.todayOutstanding).toEqual({ count: 1, amount: 750 });
    expect(summary.todayCollected).toEqual({ count: 2, amount: 1250 });
  });

  it("uses recorded item delivery time for both partial and completed demo bills", () => {
    const rows = [
      shipment({ id: "partial", shipment_status: "IN_TRANSIT", delivered_at: undefined }),
      shipment({ id: "demo-complete", delivered_at: undefined }),
      shipment({ id: "not-sent", shipment_status: "IN_TRANSIT", delivered_at: undefined }),
    ];
    const dated = withRecordedDeliveryDates(rows, [
      { shipmentId: "partial", itemId: "item-1", quantity: 1, deliveredAt: "2026-09-27T05:00:00.000Z" },
      { shipmentId: "partial", itemId: "item-2", quantity: 1, deliveredAt: "2026-09-28T05:00:00.000Z" },
      { shipmentId: "demo-complete", itemId: "item-3", quantity: 1, deliveredAt: "2026-09-28T06:00:00.000Z" },
    ]);
    expect(dated.map((row) => row.delivered_at)).toEqual([
      "2026-09-28T05:00:00.000Z",
      "2026-09-28T06:00:00.000Z",
      undefined,
    ]);
    expect(buildCodSummary(dated, [], "2026-09-28").todayOutstanding).toEqual({
      count: 2,
      amount: 2000,
    });
  });

  it("matches a scanned bill suffix and sorts bill numbers naturally", () => {
    const rows = [
      shipment({ id: "ten", shipment_no: "NTD-10" }),
      shipment({ id: "nine", shipment_no: "NTD-9" }),
    ];
    expect(matchingBills(rows, "10").map((row) => row.id)).toEqual(["ten"]);
    expect(rows.map((row) => row.shipment_no).sort(compareBillNumbers)).toEqual(
      ["NTD-9", "NTD-10"],
    );
  });

  it("treats a short number as the bill sequence before falling back to a suffix", () => {
    const rows = [
      shipment({ id: "eighteen", shipment_no: "B0126000018" }),
      shipment({ id: "one-eighteen", shipment_no: "B0126000118" }),
      shipment({ id: "other-year", shipment_no: "B0125000018" }),
    ];
    expect(matchingBills(rows, "18").map((row) => row.id)).toEqual([
      "eighteen",
      "other-year",
    ]);
    expect(matchingBills(rows, "B0126000018").map((row) => row.id)).toEqual([
      "eighteen",
    ]);
  });

  it("filters delivered and undelivered bills, including partial deliveries", () => {
    const sent = shipment({ shipment_status: "IN_TRANSIT" });
    const notSent = shipment({ delivered_at: undefined });
    expect(matchesCodDeliveryFilter(sent, "SENT")).toBe(true);
    expect(matchesCodDeliveryFilter(sent, "NOT_SENT")).toBe(false);
    expect(matchesCodDeliveryFilter(notSent, "NOT_SENT")).toBe(true);
    expect(matchesCodDeliveryFilter(notSent, "SENT")).toBe(false);
    expect(matchesCodDeliveryFilter(sent, "", "2026-09-28")).toBe(false);
  });

  it("keeps old unpaid bills available while hiding fully collected bills", () => {
    const rows = [
      shipment({
        id: "old-unpaid",
        shipment_no: "B0125000018",
        received_at: "2025-10-19T03:00:00.000Z",
        paid_amount: 500,
        outstanding_amount: 500,
      }),
      shipment({
        id: "current-paid",
        shipment_no: "B0126000018",
        paid_amount: 1000,
        outstanding_amount: 0,
      }),
      shipment({ id: "other-sequence", shipment_no: "B0126000118" }),
    ];
    expect(outstandingCodBills(rows).map((row) => row.id)).toEqual([
      "old-unpaid",
      "other-sequence",
    ]);
    expect(
      outstandingCodBills(matchingBills(rows, "18")).map((row) => row.id),
    ).toEqual(["old-unpaid"]);
    expect(outstandingCodBills(matchingBills(rows, "B0126000018"))).toEqual(
      [],
    );
  });
});
