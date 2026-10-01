import { calendarAgeInBangkok } from "./dashboardQueue";
import type {
  CashCollectionRecord,
  DeliveryLineRecord,
  LoadTripAllocation,
  LoadTripRecord,
} from "./types";

export type DestinationAgeBasis = "OPENED" | "BRANCH_RECEIVED";

export interface DestinationMetric {
  billCount: number;
  quantity: number;
}

export interface DestinationDashboardSummary {
  waiting: DestinationMetric;
  carriedOver: DestinationMetric;
  receivedToday: DestinationMetric;
  receivedTripsToday: number;
  overdue: DestinationMetric;
  overdue4: DestinationMetric;
  overdue5: DestinationMetric;
  overdueMoreThan5: DestinationMetric;
  cashDestination: { billCount: number; amount: number };
  incomingTrips: LoadTripRecord[];
  deliveredToday: DestinationMetric;
  collectedToday: { billCount: number; amount: number };
}

function summarizeLines(
  lines: Array<{ line: LoadTripAllocation; date: string }>,
): DestinationMetric {
  return {
    billCount: new Set(lines.map(({ line }) => line.shipmentId)).size,
    quantity: lines.reduce((sum, { line }) => sum + line.quantity, 0),
  };
}

export function summarizeDestinationDashboard(
  trips: LoadTripRecord[],
  branchCode: string,
  basis: DestinationAgeBasis,
  today: string | Date = new Date(),
  deliveredLines: DeliveryLineRecord[] = [],
  collections: CashCollectionRecord[] = [],
): DestinationDashboardSummary {
  const branchTrips = trips.filter(
    (trip) => trip.destinationBranchCode === branchCode,
  );
  const incomingTrips = branchTrips.filter((trip) => trip.status === "DEPARTED");
  const received = branchTrips.filter(
    (trip) => trip.status === "RECEIVED" && trip.receivedAt,
  );
  const branchShipmentIds = new Set(
    branchTrips.flatMap((trip) =>
      trip.allocations
        .filter((line) => line.active)
        .map((line) => line.shipmentId),
    ),
  );
  const branchDeliveryLines = deliveredLines.filter((line) =>
    branchShipmentIds.has(line.shipmentId),
  );
  const receivedTripsToday = received.filter(
    (trip) => trip.receivedAt && calendarAgeInBangkok(trip.receivedAt, today) === 0,
  ).length;
  const deliveredByItem = new Map<string, number>();
  branchDeliveryLines.forEach((line) =>
    deliveredByItem.set(
      line.itemId,
      (deliveredByItem.get(line.itemId) || 0) + line.quantity,
    ),
  );
  const lines = received
    .sort((a, b) => +new Date(a.receivedAt || 0) - +new Date(b.receivedAt || 0))
    .flatMap((trip) =>
      trip.allocations.flatMap((line) => {
        if (!line.active) return [];
        const delivered = deliveredByItem.get(line.itemId) || 0;
        const consumed = Math.min(delivered, line.quantity);
        deliveredByItem.set(line.itemId, delivered - consumed);
        const quantity = line.quantity - consumed;
        if (quantity <= 0) return [];
        const remainingLine = {
          ...line,
          quantity,
          amount: (line.amount || 0) * (quantity / line.quantity),
        };
        return [{
          line: remainingLine,
          receivedAt: trip.receivedAt || "",
          date:
            basis === "OPENED"
              ? line.openedAt || trip.loadedAt
              : trip.receivedAt || "",
        }];
      }),
    );
  const age = (date: string) => calendarAgeInBangkok(date, today);
  const cashLines = lines.filter(
    ({ line }) => line.paymentMode === "CASH_DESTINATION",
  );
  const receivedTodayLines = lines.filter(
    ({ receivedAt }) => age(receivedAt) === 0,
  );
  const carriedOverLines = lines.filter(
    ({ receivedAt }) => age(receivedAt) > 0,
  );
  const todayCollections = collections.filter(
    (row) => row.branchCode === branchCode && age(row.collectedAt) === 0,
  );

  return {
    waiting: summarizeLines(lines),
    carriedOver: summarizeLines(carriedOverLines),
    receivedTripsToday,
    receivedToday: summarizeLines(
      receivedTodayLines.map(({ line, receivedAt }) => ({
        line,
        date: receivedAt,
      })),
    ),
    overdue: summarizeLines(lines.filter(({ date }) => age(date) >= 4)),
    overdue4: summarizeLines(lines.filter(({ date }) => age(date) === 4)),
    overdue5: summarizeLines(lines.filter(({ date }) => age(date) === 5)),
    overdueMoreThan5: summarizeLines(lines.filter(({ date }) => age(date) > 5)),
    cashDestination: {
      billCount: new Set(cashLines.map(({ line }) => line.shipmentId)).size,
      amount: cashLines.reduce((sum, { line }) => sum + (line.amount || 0), 0),
    },
    incomingTrips,
    deliveredToday: {
      billCount: new Set(
        branchDeliveryLines
          .filter((line) => line.deliveredAt && age(line.deliveredAt) === 0)
          .map((line) => line.shipmentId),
      ).size,
      quantity: branchDeliveryLines
        .filter((line) => line.deliveredAt && age(line.deliveredAt) === 0)
        .reduce((sum, line) => sum + line.quantity, 0),
    },
    collectedToday: {
      billCount: new Set(todayCollections.map((row) => row.shipmentId)).size,
      amount: todayCollections.reduce((sum, row) => sum + row.amount, 0),
    },
  };
}
