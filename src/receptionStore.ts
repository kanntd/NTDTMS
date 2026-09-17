import { localDate } from "./domain";
import { BRANCH_OPTIONS } from "./intakeData";
import type { IntakeParty } from "./intakeEntryData";
import type {
  LoadingQueueRecord,
  PaymentMode,
  ShipmentDetail,
  ShipmentEditInput,
} from "./types";

export const RECEPTION_STORAGE_KEY = "ntdtms-reception-local-v5";

type StoredLine = {
  id: string;
  catalogId: string;
  name: string;
  unit: string;
  quantity: number;
  price: number | null;
  requestPrice: boolean;
  weight?: string;
  width?: string;
  length?: string;
  height?: string;
};

export type ReceptionLoadRecord = {
  manifestNo: string;
  vehicleId: string;
  vehicleNo: string;
  driverId: string;
  driverName: string;
  confirmedAt: string;
};

export type StoredReceptionBill = {
  id: string;
  number: string;
  date: string;
  openedBy?: {
    employeeId: string;
    code: string;
    name: string;
    nickname?: string;
  };
  shipmentStatus?: "RECEIVED" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED";
  load?: ReceptionLoadRecord;
  versionNo?: number;
  withholdingAmount?: number;
  draft: {
    branch: string;
    payment: PaymentMode | "";
    days: number;
    collect: boolean;
    note: string;
    discount?: number;
    reason?: string;
  };
  receiver: IntakeParty;
  sender: IntakeParty;
  billingPeriod?: { end: string };
  items: StoredLine[];
  amounts: {
    total: number;
    due: number;
    pending: boolean;
  };
};

type ReceptionSnapshot = {
  bills?: StoredReceptionBill[];
  [key: string]: unknown;
};

export function readReceptionSnapshot(): ReceptionSnapshot | null {
  try {
    const value = JSON.parse(
      localStorage.getItem(RECEPTION_STORAGE_KEY) || "null",
    ) as ReceptionSnapshot | null;
    return value && Array.isArray(value.bills) ? value : null;
  } catch {
    return null;
  }
}

export function readReceptionBills() {
  return readReceptionSnapshot()?.bills || [];
}

export function updateReceptionBillStatus(
  id: string,
  status: NonNullable<StoredReceptionBill["shipmentStatus"]>,
  load?: ReceptionLoadRecord,
) {
  const snapshot = readReceptionSnapshot();
  if (!snapshot) return false;
  const bill = snapshot.bills?.find((row) => row.id === id);
  if (!bill) return false;
  bill.shipmentStatus = status;
  if (load) bill.load = load;
  localStorage.setItem(RECEPTION_STORAGE_KEY, JSON.stringify(snapshot));
  return true;
}

export function editStoredReceptionBill(id: string, input: ShipmentEditInput) {
  const snapshot = readReceptionSnapshot();
  if (!snapshot) return false;
  const bill = snapshot.bills?.find((row) => row.id === id);
  if (!bill) return false;
  const subtotal = input.items.reduce(
    (sum, item) => sum + item.quantity * (item.price || 0),
    0,
  );
  const total = Math.max(0, subtotal - input.discount);
  const due = Math.max(0, total - input.withholding_amount);
  bill.versionNo = (bill.versionNo || 1) + 1;
  bill.withholdingAmount = input.withholding_amount;
  bill.receiver = {
    ...bill.receiver,
    ...input.receiver,
    id: input.receiver_id,
  };
  bill.sender = { ...bill.sender, ...input.sender, id: input.sender_id };
  bill.draft = {
    ...bill.draft,
    branch: input.destination_branch_code,
    payment: input.payment_mode,
    days: input.credit_days,
    note: input.note,
    discount: input.discount,
    reason: input.discount_reason,
  };
  bill.items = input.items.map((item) => ({
    id: item.id,
    catalogId: item.catalog_id,
    name: item.name,
    unit: item.unit,
    quantity: item.quantity,
    price: item.price,
    requestPrice: item.request_price,
    weight: item.weight,
    width: item.width,
    length: item.length,
    height: item.height,
  }));
  bill.amounts = {
    total,
    due,
    pending: input.items.some((item) => item.request_price),
  };
  localStorage.setItem(RECEPTION_STORAGE_KEY, JSON.stringify(snapshot));
  return true;
}

export function receptionBillToShipment(
  bill: StoredReceptionBill,
): ShipmentDetail {
  const branch = BRANCH_OPTIONS.find(
    (option) => option.code === bill.draft.branch,
  );
  const payment = bill.draft.payment || "CASH_ORIGIN";
  const paid = bill.draft.collect ? bill.amounts.due : 0;
  return {
    id: bill.id,
    shipment_no: bill.number,
    received_at: bill.date,
    sender_snapshot: {
      id: bill.sender.id,
      display_name: bill.sender.display_name,
      phone: bill.sender.phone,
      address: bill.sender.address,
    },
    receiver_snapshot: {
      id: bill.receiver.id,
      display_name: bill.receiver.display_name,
      phone: bill.receiver.phone,
      address: bill.receiver.address,
    },
    zone_id: branch?.zoneId || "",
    district_id: branch?.districtId || "",
    destination_branch_code: bill.draft.branch,
    zone_name: branch?.name || bill.receiver.province || bill.draft.branch,
    district_name: bill.receiver.district || "ไม่ระบุอำเภอ",
    zone_color: branch?.color || "#5f7369",
    payment_mode: payment,
    credit_days: payment.startsWith("CREDIT") ? bill.draft.days : 0,
    payer_party_id: payment.endsWith("ORIGIN")
      ? bill.sender.id
      : bill.receiver.id,
    total_amount: bill.amounts.total,
    total_quantity: bill.items.reduce(
      (sum, item) => sum + (Number(item.quantity) || 0),
      0,
    ),
    total_weight: bill.items.reduce(
      (sum, item) => sum + (Number(item.weight) || 0),
      0,
    ),
    paid_amount: paid,
    outstanding_amount: Math.max(0, bill.amounts.due - paid),
    shipment_status: bill.shipmentStatus || "RECEIVED",
    price_pending: bill.amounts.pending,
    note: bill.draft.note || "",
    dropoff_name: "",
    dropoff_phone: "",
    extra_charge: 0,
    discount: bill.draft.discount || 0,
    withholding_amount: bill.withholdingAmount || 0,
    price_reason: bill.draft.reason || "",
    invoice_id: `local-${bill.id}`,
    due_date: bill.billingPeriod?.end || localDate(new Date(bill.date)),
    created_by: bill.openedBy?.employeeId || "demo",
    version_no: bill.versionNo || 1,
    sender_party_id: bill.sender.id,
    receiver_party_id: bill.receiver.id,
    opened_by_employee_id: bill.openedBy?.employeeId || "",
    manifest_no: bill.load?.manifestNo,
    loaded_at: bill.load?.confirmedAt,
    vehicle_plate_no: bill.load?.vehicleNo,
    driver_name: bill.load?.driverName,
    items: bill.items.map((item) => ({
      id: item.id,
      product_id: item.catalogId,
      product_unit_id: item.catalogId,
      description: item.name,
      quantity: item.quantity,
      unit: item.unit,
      unit_price: item.price || 0,
      weight: Number(item.weight) || 0,
      fragile: false,
      price_pending: item.requestPrice,
      width: Number(item.width) || null,
      length: Number(item.length) || null,
      height: Number(item.height) || null,
    })),
    files: [],
  };
}

export function receptionLoadingQueue(): LoadingQueueRecord[] {
  return readReceptionBills().map((bill) => {
    const shipment = receptionBillToShipment(bill);
    return {
      id: shipment.id,
      shipment_no: shipment.shipment_no,
      received_at: shipment.received_at,
      sender_snapshot: shipment.sender_snapshot,
      receiver_snapshot: shipment.receiver_snapshot,
      zone_id: shipment.zone_id,
      district_id: shipment.district_id,
      destination_branch_code: shipment.destination_branch_code,
      total_amount: shipment.total_amount,
      total_quantity: shipment.total_quantity,
      shipment_status: shipment.shipment_status,
      price_pending: shipment.price_pending,
      items: shipment.items,
    };
  });
}
