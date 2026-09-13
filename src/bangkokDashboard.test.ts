import { describe, expect, it } from "vitest";
import {
  calendarAgeInBangkok,
  summarizeBangkokQueue,
  type BangkokQueueBill,
} from "./dashboardQueue";

const branches = [
  { code: "KPT", name: "กำแพงเพชร", color: "#8b65a4" },
  { code: "PLK", name: "พิษณุโลก", color: "#3477b8" },
];

describe("Bangkok dashboard queue", () => {
  it("uses calendar days in Bangkok", () => {
    expect(
      calendarAgeInBangkok(
        "2026-09-08T20:00:00.000Z",
        "2026-09-10T12:00:00.000Z",
      ),
    ).toBe(1);
    expect(
      calendarAgeInBangkok(
        "2026-09-08T05:00:00.000Z",
        "2026-09-10T05:00:00.000Z",
      ),
    ).toBe(2);
  });

  it("counts only bills that have not been loaded", () => {
    const bills: BangkokQueueBill[] = [
      {
        id: "today",
        branchCode: "KPT",
        openedAt: "2026-09-10T02:00:00.000Z",
        quantity: 4,
        amount: 400,
        status: "RECEIVED",
      },
      {
        id: "two-days",
        branchCode: "KPT",
        openedAt: "2026-09-08T02:00:00.000Z",
        quantity: 3,
        amount: 300,
        pendingPrice: true,
      },
      {
        id: "three-days",
        branchCode: "KPT",
        openedAt: "2026-09-07T02:00:00.000Z",
        quantity: 2,
        amount: 200,
      },
      {
        id: "older",
        branchCode: "PLK",
        openedAt: "2026-09-06T02:00:00.000Z",
        quantity: 1,
        amount: 100,
      },
      {
        id: "loaded",
        branchCode: "KPT",
        openedAt: "2026-09-01T02:00:00.000Z",
        quantity: 99,
        amount: 9_900,
        status: "IN_TRANSIT",
      },
      {
        id: "cancelled",
        branchCode: "PLK",
        openedAt: "2026-09-01T02:00:00.000Z",
        quantity: 99,
        amount: 9_900,
        status: "CANCELLED",
      },
    ];

    const summary = summarizeBangkokQueue(
      bills,
      branches,
      "2026-09-10T05:00:00.000Z",
    );

    expect(summary.rows[0]).toMatchObject({
      billCount: 3,
      quantity: 9,
      amount: 900,
      overdue2: 1,
      overdue3: 1,
      overdueMoreThan3: 0,
      pendingPriceCount: 1,
    });
    expect(summary.rows[1]).toMatchObject({
      billCount: 1,
      quantity: 1,
      amount: 100,
      overdueMoreThan3: 1,
    });
    expect(summary.total).toMatchObject({
      billCount: 4,
      quantity: 10,
      amount: 1_000,
      overdue2: 1,
      overdue3: 1,
      overdueMoreThan3: 1,
      pendingPriceCount: 1,
    });
  });
});
