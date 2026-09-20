import type { LoadingQueueRecord, PaymentMode } from "./types";

export const LOADING_PAYMENT_MODES: PaymentMode[] = [
  "CASH_ORIGIN",
  "CASH_DESTINATION",
  "CREDIT_ORIGIN",
  "CREDIT_DESTINATION",
];

export type LoadingGroupMode = "NONE" | "RECEIVER" | "SENDER";

export interface LoadingDashboardBill {
  id: string;
  branchCode: string;
  quantity: number;
  amount: number;
  paymentMode: PaymentMode;
  pricePending?: boolean;
}

export interface LoadingBranchDefinition {
  code: string;
  name: string;
  color: string;
}

export interface LoadingPaymentSummary {
  billCount: number;
  amount: number;
}

export interface LoadingDashboardRow extends LoadingBranchDefinition {
  billCount: number;
  quantity: number;
  amount: number;
  pendingPriceCount: number;
  payments: Record<PaymentMode, LoadingPaymentSummary>;
}

export interface LoadingQueueGroup {
  key: string;
  label: string;
  rows: LoadingQueueRecord[];
  billCount: number;
  quantity: number;
  amount: number;
  counterpartCount: number;
  itemSummary: string;
}

export interface RecordedLoadAllocation {
  shipmentId: string;
  itemId: string;
  quantity: number;
}

function emptyPaymentSummary(): Record<PaymentMode, LoadingPaymentSummary> {
  return Object.fromEntries(
    LOADING_PAYMENT_MODES.map((mode) => [mode, { billCount: 0, amount: 0 }]),
  ) as Record<PaymentMode, LoadingPaymentSummary>;
}

function emptyRow(branch: LoadingBranchDefinition): LoadingDashboardRow {
  return {
    ...branch,
    billCount: 0,
    quantity: 0,
    amount: 0,
    pendingPriceCount: 0,
    payments: emptyPaymentSummary(),
  };
}

export function summarizeLoadingDashboard(
  bills: LoadingDashboardBill[],
  branches: LoadingBranchDefinition[],
) {
  const rows = branches.map(emptyRow);
  const byCode = new Map(rows.map((row) => [row.code, row]));

  for (const bill of bills) {
    const row = byCode.get(bill.branchCode);
    if (!row) continue;
    row.billCount += 1;
    row.quantity += Number.isFinite(bill.quantity) ? bill.quantity : 0;
    row.amount += Number.isFinite(bill.amount) ? bill.amount : 0;
    if (bill.pricePending) row.pendingPriceCount += 1;
    const payment = row.payments[bill.paymentMode];
    payment.billCount += 1;
    payment.amount += Number.isFinite(bill.amount) ? bill.amount : 0;
  }

  const total = rows.reduce(
    (sum, row) => {
      sum.billCount += row.billCount;
      sum.quantity += row.quantity;
      sum.amount += row.amount;
      sum.pendingPriceCount += row.pendingPriceCount;
      for (const mode of LOADING_PAYMENT_MODES) {
        sum.payments[mode].billCount += row.payments[mode].billCount;
        sum.payments[mode].amount += row.payments[mode].amount;
      }
      return sum;
    },
    {
      billCount: 0,
      quantity: 0,
      amount: 0,
      pendingPriceCount: 0,
      payments: emptyPaymentSummary(),
    },
  );

  return { rows, total };
}

function itemSummary(rows: LoadingQueueRecord[]) {
  const quantities = new Map<string, number>();
  for (const row of rows) {
    for (const item of row.items) {
      const key = `${item.description.trim()}|${item.unit.trim()}`;
      quantities.set(key, (quantities.get(key) || 0) + item.quantity);
    }
  }
  return [...quantities]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([key, quantity]) => {
      const [name, unit] = key.split("|");
      return `${name} ${quantity.toLocaleString("th-TH")} ${unit}`;
    })
    .join(" · ");
}

export function groupLoadingRows(
  rows: LoadingQueueRecord[],
  mode: LoadingGroupMode,
): LoadingQueueGroup[] {
  if (mode === "NONE") return [];
  const groups = new Map<string, LoadingQueueRecord[]>();
  for (const row of rows) {
    const snapshot =
      mode === "RECEIVER" ? row.receiver_snapshot : row.sender_snapshot;
    const key = snapshot.id || snapshot.display_name;
    const group = groups.get(key) || [];
    group.push(row);
    groups.set(key, group);
  }

  return [...groups].map(([key, groupedRows]) => {
    const label =
      mode === "RECEIVER"
        ? groupedRows[0].receiver_snapshot.display_name
        : groupedRows[0].sender_snapshot.display_name;
    const counterparts = new Set(
      groupedRows.map((row) =>
        mode === "RECEIVER"
          ? row.sender_snapshot.id || row.sender_snapshot.display_name
          : row.receiver_snapshot.id || row.receiver_snapshot.display_name,
      ),
    );
    return {
      key,
      label,
      rows: groupedRows,
      billCount: groupedRows.length,
      quantity: groupedRows.reduce((sum, row) => sum + row.total_quantity, 0),
      amount: groupedRows.reduce((sum, row) => sum + row.total_amount, 0),
      counterpartCount: counterparts.size,
      itemSummary: itemSummary(groupedRows),
    };
  });
}

export function completeBillNumber(prefix: string, input: string) {
  const compact = input
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
  if (!compact) return "";
  if (
    compact.startsWith(prefix) &&
    /^\d{6}$/.test(compact.slice(prefix.length))
  )
    return compact;
  if (/^\d{1,6}$/.test(compact)) return prefix + compact.padStart(6, "0");
  return compact;
}

export function applyRecordedLoads(
  rows: LoadingQueueRecord[],
  allocations: RecordedLoadAllocation[],
) {
  const loadedByItem = new Map<string, number>();
  for (const allocation of allocations) {
    loadedByItem.set(
      allocation.itemId,
      (loadedByItem.get(allocation.itemId) || 0) + allocation.quantity,
    );
  }

  return rows.flatMap((row) => {
    let anyLoaded = false;
    const items = row.items.flatMap((item) => {
      const loaded = Math.min(
        item.quantity,
        Math.max(0, loadedByItem.get(item.id) || 0),
      );
      if (loaded > 0) anyLoaded = true;
      const remaining = Math.max(0, item.quantity - loaded);
      if (remaining === 0) return [];
      return [
        {
          ...item,
          quantity: remaining,
          original_quantity: item.quantity,
          loaded_quantity: loaded,
          weight:
            item.quantity > 0 ? item.weight * (remaining / item.quantity) : 0,
        },
      ];
    });
    if (!items.length) return [];
    if (row.shipment_status === "IN_TRANSIT" && !anyLoaded) return [];
    if (
      row.shipment_status !== "RECEIVED" &&
      row.shipment_status !== "IN_TRANSIT"
    )
      return [];
    const remainingQuantity = items.reduce(
      (sum, item) => sum + item.quantity,
      0,
    );
    const ratio =
      row.total_quantity > 0 ? remainingQuantity / row.total_quantity : 0;
    return [
      {
        ...row,
        items,
        total_quantity: remainingQuantity,
        total_weight: items.reduce((sum, item) => sum + item.weight, 0),
        total_amount: row.total_amount * ratio,
      },
    ];
  });
}
