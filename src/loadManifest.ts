import type {
  LoadTripAllocation,
  LoadTripCommand,
  LoadTripRecord,
} from "./types";

function tripOrder(trip: LoadTripRecord) {
  return `${trip.loadedAt}|${trip.manifestNo}`;
}

export function isCityDistrict(name: string) {
  const normalized = name.replace(/^อำเภอ/, "").trim();
  return normalized === "เมือง" || normalized.startsWith("เมือง");
}

export function sortManifestLines(lines: LoadTripAllocation[]) {
  return [...lines].sort((a, b) => {
    const cityOrder = Number(isCityDistrict(b.districtName || "")) -
      Number(isCityDistrict(a.districtName || ""));
    if (cityOrder) return cityOrder;
    const receiverOrder = a.receiverName.localeCompare(b.receiverName, "th");
    if (receiverOrder) return receiverOrder;
    const districtOrder = (a.districtName || "").localeCompare(
      b.districtName || "",
      "th",
    );
    if (districtOrder) return districtOrder;
    const billOrder = a.shipmentNo.localeCompare(b.shipmentNo, "th");
    if (billOrder) return billOrder;
    return a.description.localeCompare(b.description, "th");
  });
}

export function manifestLineProgress(
  line: LoadTripAllocation,
  trip: LoadTripRecord,
  trips: LoadTripRecord[],
) {
  const currentOrder = tripOrder(trip);
  const loadedBefore = trips
    .filter(
      (other) =>
        other.id !== trip.id &&
        other.status !== "CANCELLED" &&
        tripOrder(other) < currentOrder,
    )
    .flatMap((other) => other.allocations)
    .filter((other) => other.active && other.itemId === line.itemId)
    .reduce((sum, other) => sum + other.quantity, 0);
  const remaining = Math.max(
    0,
    line.originalQuantity - loadedBefore - line.quantity,
  );
  return {
    loadedBefore,
    remaining,
    split: loadedBefore > 0 || line.quantity < line.originalQuantity,
    completed: remaining === 0,
  };
}

export function summarizeManifestLines(lines: LoadTripAllocation[]) {
  const byUnit = new Map<string, number>();
  lines.forEach((line) =>
    byUnit.set(line.unit, (byUnit.get(line.unit) || 0) + line.quantity),
  );
  return {
    billCount: new Set(lines.map((line) => line.shipmentId)).size,
    quantity: lines.reduce((sum, line) => sum + line.quantity, 0),
    unitSummary: [...byUnit]
      .sort(([a], [b]) => a.localeCompare(b, "th"))
      .map(([unit, quantity]) => `${quantity.toLocaleString("th-TH")} ${unit}`)
      .join(" · "),
  };
}

export function loadTripAfterCommand(
  trip: LoadTripRecord,
  action: Exclude<LoadTripCommand, "RECEIVE" | "CANCEL">,
  changedAt: string,
  options: {
    vehicleId?: string;
    vehicleNo?: string;
    driverId?: string;
    driverName?: string;
    note?: string;
  } = {},
): LoadTripRecord {
  if (action === "CLOSE") {
    return {
      ...trip,
      status: "LOADED",
      vehicleId: options.vehicleId || trip.vehicleId,
      vehicleNo: options.vehicleNo || trip.vehicleNo,
      driverId: options.driverId || trip.driverId,
      driverName: options.driverName || trip.driverName,
      loadedAt: changedAt,
      note: options.note ?? trip.note,
    };
  }
  if (action === "DEPART") {
    return { ...trip, status: "DEPARTED", departedAt: changedAt };
  }
  return { ...trip, status: "DRAFT", departedAt: "" };
}
