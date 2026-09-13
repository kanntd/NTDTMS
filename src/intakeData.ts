import type { PaymentMode } from "./types";

export const PRODUCT_UNITS: Record<string, string[]> = {};

export interface PairItemPreset {
  productId: string;
  unit: string;
  unitPrice: number;
  uses: number;
  paymentPrices?: Partial<Record<PaymentMode, number>>;
}

export interface SenderPairPreset {
  senderId: string;
  paymentMode: PaymentMode;
  creditDays: number;
  lastUsed: string;
  billCount: number;
  items: PairItemPreset[];
}

export interface ReceiverPreset {
  receiverId: string;
  zoneId: string;
  districtId: string;
  branchName: string;
  branchCode: string;
  branchColor: string;
  senders: SenderPairPreset[];
}

export const RECEIVER_PRESETS: ReceiverPreset[] = [];

export const BRANCH_OPTIONS = [
  {
    zoneId: "z-kpt",
    districtId: "kpt-1",
    name: "กำแพงเพชร",
    code: "KPT",
    color: "#8b65a4",
  },
  {
    zoneId: "z-plk",
    districtId: "plk-1",
    name: "พิษณุโลก",
    code: "PLK",
    color: "#3477b8",
  },
  {
    zoneId: "z-sti",
    districtId: "sti-1",
    name: "สุโขทัย",
    code: "STI",
    color: "#b97817",
  },
  {
    zoneId: "z-sti",
    districtId: "sti-2",
    name: "สวรรคโลก",
    code: "SWL",
    color: "#2b8a78",
  },
];

export function receiverPreset(partyId?: string) {
  return RECEIVER_PRESETS.find((preset) => preset.receiverId === partyId);
}

export function senderPair(receiverId?: string, senderId?: string) {
  return receiverPreset(receiverId)?.senders.find(
    (pair) => pair.senderId === senderId,
  );
}

export function pairUnitPrice(
  receiverId: string | undefined,
  senderId: string | undefined,
  productId: string,
  unit: string,
  paymentMode?: PaymentMode,
) {
  const item = senderPair(receiverId, senderId)?.items.find(
    (item) => item.productId === productId && item.unit === unit,
  );
  if (!item) return undefined;
  return (paymentMode && item.paymentPrices?.[paymentMode]) ?? item.unitPrice;
}

// Broad receiver merchandise remains useful in master data. Intake choices use
// the exact receiver-sender items from RECEIVER_PRESETS instead.
export const RECEIVER_CATALOG: Record<
  string,
  { productId: string; unit: string }[]
> = {};

export function paymentDefault(
  receiverId: string,
  senderId: string,
): PaymentMode {
  return senderPair(receiverId, senderId)?.paymentMode ?? "CREDIT_DESTINATION";
}

export function agreedPrice(
  receiverId: string,
  senderId: string,
  productId: string,
  unit: string,
  payment: PaymentMode,
  branchCode: string,
): number | null {
  const destination = receiverPreset(receiverId);
  if (!destination || destination.branchCode !== branchCode) return null;
  if (
    receiverId === "party-5" &&
    senderId === "party-0" &&
    productId === "snack"
  ) {
    return unit === "กล่อง" ? 65 : unit === "ลัง" ? 110 : null;
  }
  return pairUnitPrice(receiverId, senderId, productId, unit, payment) ?? null;
}
