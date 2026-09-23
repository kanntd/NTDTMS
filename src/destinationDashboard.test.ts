import { describe, expect, it } from "vitest";
import { summarizeDestinationDashboard } from "./destinationDashboardModel";
import type { LoadTripRecord } from "./types";

const trip = (overrides: Partial<LoadTripRecord> = {}): LoadTripRecord => ({
  id: "trip-1",
  manifestNo: "LOAD-1",
  status: "RECEIVED",
  destinationBranchId: "branch-kpt",
  destinationBranchCode: "KPT",
  vehicleId: "vehicle-1",
  vehicleNo: "70-4521",
  driverId: "driver-1",
  driverName: "สมชาย",
  loadedAt: "2026-09-15T02:00:00Z",
  departedAt: "2026-09-15T03:00:00Z",
  receivedAt: "2026-09-18T03:00:00Z",
  note: "",
  allocations: [
    {
      id: "line-1",
      shipmentId: "bill-1",
      shipmentNo: "B0126000001",
      itemId: "item-1",
      description: "ขนม",
      quantity: 200,
      originalQuantity: 500,
      unit: "กล่อง",
      receiverName: "ร้าน ก",
      senderName: "บริษัท A",
      openedAt: "2026-09-14T03:00:00Z",
      paymentMode: "CASH_DESTINATION",
      amount: 2_000,
      active: true,
    },
  ],
  ...overrides,
});

describe("destination dashboard", () => {
  it("switches overdue age between bill opening and branch receiving", () => {
    const trips = [trip()];
    const company = summarizeDestinationDashboard(
      trips,
      "KPT",
      "OPENED",
      "2026-09-19T03:00:00Z",
    );
    const branch = summarizeDestinationDashboard(
      trips,
      "KPT",
      "BRANCH_RECEIVED",
      "2026-09-19T03:00:00Z",
    );
    expect(company.overdue5).toEqual({ billCount: 1, quantity: 200 });
    expect(branch.overdue5).toEqual({ billCount: 0, quantity: 0 });
    expect(branch.waiting).toEqual({ billCount: 1, quantity: 200 });
  });

  it("only includes the selected branch and keeps incoming trips separate", () => {
    const summary = summarizeDestinationDashboard(
      [
        trip({ id: "incoming", status: "DEPARTED", receivedAt: "" }),
        trip({ id: "other", destinationBranchCode: "PLK" }),
      ],
      "KPT",
      "BRANCH_RECEIVED",
      "2026-09-19T03:00:00Z",
    );
    expect(summary.incomingTrips.map((row) => row.id)).toEqual(["incoming"]);
    expect(summary.waiting.billCount).toBe(0);
  });

  it("subtracts quantities already delivered at the branch", () => {
    const summary = summarizeDestinationDashboard(
      [trip()],
      "KPT",
      "BRANCH_RECEIVED",
      "2026-09-19T03:00:00Z",
      [{ shipmentId: "bill-1", itemId: "item-1", quantity: 80 }],
    );
    expect(summary.waiting).toEqual({ billCount: 1, quantity: 120 });
    expect(summary.cashDestination.amount).toBe(1_200);
  });
});
