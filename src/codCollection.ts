import { localDate } from "./domain";
import type { CodPaymentRecord, Shipment } from "./types";

export type CodCollectionStatus = "PENDING" | "PARTIAL" | "COLLECTED";

export type CodSummary = {
  outstanding: { count: number; amount: number };
  overdue: { count: number; amount: number };
  todayOutstanding: { count: number; amount: number };
  todayCollected: { count: number; amount: number };
};

export function dateKey(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : localDate(date);
}

export function codCollectionStatus(
  shipment: Pick<Shipment, "paid_amount" | "outstanding_amount">,
): CodCollectionStatus {
  if (shipment.outstanding_amount <= 0) return "COLLECTED";
  return shipment.paid_amount > 0 ? "PARTIAL" : "PENDING";
}

export function compareBillNumbers(a: string, b: string) {
  return a.localeCompare(b, "th", { numeric: true, sensitivity: "base" });
}

export function matchingBills(shipments: Shipment[], query: string) {
  const normalized = query.trim().toLocaleUpperCase("th");
  if (!normalized) return [];
  const exact = shipments.filter(
    (row) => row.shipment_no.toLocaleUpperCase("th") === normalized,
  );
  if (exact.length) return exact;
  const digits = normalized.replace(/\D/g, "");
  if (!digits) return [];
  return shipments.filter((row) =>
    row.shipment_no.replace(/\D/g, "").endsWith(digits),
  );
}

export function buildCodSummary(
  shipments: Shipment[],
  payments: CodPaymentRecord[],
  today = localDate(),
): CodSummary {
  const active = shipments.filter(
    (row) =>
      row.payment_mode === "CASH_DESTINATION" &&
      row.shipment_status !== "CANCELLED",
  );
  const outstanding = active.filter((row) => row.outstanding_amount > 0);
  const overdue = outstanding.filter((row) => {
    const delivered = dateKey(row.delivered_at);
    return Boolean(delivered && delivered < today);
  });
  const todayOutstanding = outstanding.filter(
    (row) => dateKey(row.delivered_at) === today,
  );
  const ids = new Set(active.map((row) => row.id));
  const todayPayments = payments.filter(
    (row) => ids.has(row.shipmentId) && dateKey(row.receivedAt) === today,
  );
  return {
    outstanding: {
      count: outstanding.length,
      amount: outstanding.reduce((sum, row) => sum + row.outstanding_amount, 0),
    },
    overdue: {
      count: overdue.length,
      amount: overdue.reduce((sum, row) => sum + row.outstanding_amount, 0),
    },
    todayOutstanding: {
      count: todayOutstanding.length,
      amount: todayOutstanding.reduce(
        (sum, row) => sum + row.outstanding_amount,
        0,
      ),
    },
    todayCollected: {
      count: new Set(todayPayments.map((row) => row.shipmentId)).size,
      amount: todayPayments.reduce((sum, row) => sum + row.amount, 0),
    },
  };
}
