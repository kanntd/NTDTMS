export type QueueStatus = "RECEIVED" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED";

export interface BangkokQueueBill {
  id: string;
  branchCode: string;
  openedAt: string;
  quantity: number;
  amount: number;
  status?: QueueStatus;
  pendingPrice?: boolean;
}

export interface BangkokBranchDefinition {
  code: string;
  name: string;
  color: string;
}

export interface BangkokDashboardRow extends BangkokBranchDefinition {
  billCount: number;
  quantity: number;
  amount: number;
  overdue2: number;
  overdue3: number;
  overdueMoreThan3: number;
  pendingPriceCount: number;
}

export interface BangkokDashboardSummary {
  rows: BangkokDashboardRow[];
  total: Omit<BangkokDashboardRow, "code" | "name" | "color">;
}

const EMPTY_TOTAL: BangkokDashboardSummary["total"] = {
  billCount: 0,
  quantity: 0,
  amount: 0,
  overdue2: 0,
  overdue3: 0,
  overdueMoreThan3: 0,
  pendingPriceCount: 0,
};

function bangkokDateKey(value: string | Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(value));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function calendarAgeInBangkok(
  openedAt: string,
  today: string | Date = new Date(),
) {
  const opened = Date.parse(`${bangkokDateKey(openedAt)}T00:00:00Z`);
  const current = Date.parse(`${bangkokDateKey(today)}T00:00:00Z`);
  if (!Number.isFinite(opened) || !Number.isFinite(current)) return 0;
  return Math.max(0, Math.floor((current - opened) / 86_400_000));
}

export function summarizeBangkokQueue(
  bills: BangkokQueueBill[],
  branches: BangkokBranchDefinition[],
  today: string | Date = new Date(),
): BangkokDashboardSummary {
  const rows = branches.map((branch): BangkokDashboardRow => ({
    ...branch,
    ...EMPTY_TOTAL,
  }));
  const byCode = new Map(rows.map((row) => [row.code, row]));

  for (const bill of bills) {
    if ((bill.status || "RECEIVED") !== "RECEIVED") continue;
    const row = byCode.get(bill.branchCode);
    if (!row) continue;

    row.billCount += 1;
    row.quantity += Number.isFinite(bill.quantity) ? bill.quantity : 0;
    row.amount += Number.isFinite(bill.amount) ? bill.amount : 0;
    if (bill.pendingPrice) row.pendingPriceCount += 1;

    const age = calendarAgeInBangkok(bill.openedAt, today);
    if (age === 2) row.overdue2 += 1;
    else if (age === 3) row.overdue3 += 1;
    else if (age > 3) row.overdueMoreThan3 += 1;
  }

  const total = rows.reduce(
    (sum, row) => ({
      billCount: sum.billCount + row.billCount,
      quantity: sum.quantity + row.quantity,
      amount: sum.amount + row.amount,
      overdue2: sum.overdue2 + row.overdue2,
      overdue3: sum.overdue3 + row.overdue3,
      overdueMoreThan3: sum.overdueMoreThan3 + row.overdueMoreThan3,
      pendingPriceCount: sum.pendingPriceCount + row.pendingPriceCount,
    }),
    { ...EMPTY_TOTAL },
  );

  return { rows, total };
}
