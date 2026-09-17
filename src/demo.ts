import type {
  CompanyBranch,
  Item,
  Party,
  PriceRule,
  Product,
  ShipmentDetail,
  ShipmentInput,
  Zone,
} from "./types";
import { localDate, totals } from "./domain";

export const demoZones: Zone[] = [
  {
    id: "z-plk",
    code: "PLK",
    name: "พิษณุโลก",
    color: "#3174c6",
    sort_order: 1,
    districts: [
      { id: "plk-1", name: "เมืองพิษณุโลก", zone_id: "z-plk" },
      { id: "plk-2", name: "วังทอง", zone_id: "z-plk" },
      { id: "plk-3", name: "บางระกำ", zone_id: "z-plk" },
    ],
  },
  {
    id: "z-sti",
    code: "STI",
    name: "สุโขทัย",
    color: "#b67c15",
    sort_order: 2,
    districts: [
      { id: "sti-1", name: "เมืองสุโขทัย", zone_id: "z-sti" },
      { id: "sti-2", name: "สวรรคโลก", zone_id: "z-sti" },
      { id: "sti-3", name: "ศรีสำโรง", zone_id: "z-sti" },
    ],
  },
  {
    id: "z-kpt",
    code: "KPT",
    name: "กำแพงเพชร",
    color: "#9870b4",
    sort_order: 3,
    districts: [
      { id: "kpt-1", name: "เมืองกำแพงเพชร", zone_id: "z-kpt" },
      { id: "kpt-2", name: "คลองขลุง", zone_id: "z-kpt" },
      { id: "kpt-3", name: "ขาณุวรลักษบุรี", zone_id: "z-kpt" },
    ],
  },
];
export const demoProducts: Product[] = [];
export const demoRules: PriceRule[] = [];
export const demoParties: Party[] = [];
export const demoBranches: CompanyBranch[] = [
  {
    id: "branch-bkk",
    code: "BKK",
    document_code: "B01",
    name: "กรุงเทพฯ สาขา 1",
    branch_kind: "ORIGIN",
    province_name: "กรุงเทพมหานคร",
    can_issue_bills: true,
    is_active: true,
    document_code_locked_at: null,
  },
  {
    id: "branch-kpt",
    code: "KPT",
    document_code: "K01",
    name: "สาขากำแพงเพชร",
    branch_kind: "DESTINATION",
    province_name: "กำแพงเพชร",
    can_issue_bills: false,
    is_active: true,
    document_code_locked_at: null,
  },
  {
    id: "branch-plk",
    code: "PLK",
    document_code: "P01",
    name: "สาขาพิษณุโลก",
    branch_kind: "DESTINATION",
    province_name: "พิษณุโลก",
    can_issue_bills: false,
    is_active: true,
    document_code_locked_at: null,
  },
  {
    id: "branch-sti",
    code: "STI",
    document_code: "S01",
    name: "สาขาสุโขทัย",
    branch_kind: "DESTINATION",
    province_name: "สุโขทัย",
    can_issue_bills: false,
    is_active: true,
    document_code_locked_at: null,
  },
  {
    id: "branch-swl",
    code: "SWL",
    document_code: "W01",
    name: "สาขาสวรรคโลก",
    branch_kind: "DESTINATION",
    province_name: "สุโขทัย",
    can_issue_bills: false,
    is_active: true,
    document_code_locked_at: null,
  },
];

export interface DemoState {
  shipments: ShipmentDetail[];
  parties: Party[];
  branches: CompanyBranch[];
  zones: Zone[];
  rules: PriceRule[];
}
const key = "ntdtms-demo-v3";
export function loadDemo(): DemoState {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    if (v && Array.isArray(v.shipments) && Array.isArray(v.zones))
      return {
        ...v,
        branches: Array.isArray(v.branches)
          ? v.branches
          : structuredClone(demoBranches),
      };
  } catch {
    /* A corrupt demo snapshot can be reset without affecting business data. */
  }
  const shipments: ShipmentDetail[] = [];
  const state = {
    shipments,
    parties: structuredClone(demoParties),
    branches: structuredClone(demoBranches),
    zones: structuredClone(demoZones),
    rules: structuredClone(demoRules),
  };
  saveDemo(state);
  return state;
}
export function saveDemo(state: DemoState) {
  localStorage.setItem(key, JSON.stringify(state));
}
export function createDemoShipment(
  state: DemoState,
  input: ShipmentInput,
): ShipmentDetail {
  const existing = state.shipments.find((s) => s.id === input.request_id);
  if (existing) return existing;
  const t = totals(input.items, input.extra_charge, input.discount),
    z = state.zones.find((z) => z.id === input.zone_id)!;
  const payer = input.payment_mode.endsWith("ORIGIN")
    ? input.sender
    : input.receiver;
  if (input.payment_mode.startsWith("CREDIT")) {
    const p = state.parties.find((p) => p.id === payer.id);
    const debt = state.shipments
      .filter((s) => s.payer_party_id === payer.id)
      .reduce((n, s) => n + s.outstanding_amount, 0);
    if (!p || p.credit_limit < debt + t.total)
      throw new Error("วงเงินเครดิตไม่เพียงพอ กรุณาตั้งวงเงินในหน้าลูกค้า");
    if (input.credit_days > p.credit_days)
      throw new Error("เครดิตเทอมเกินที่ลูกค้าได้รับอนุมัติ");
  }
  const snapshots = [input.sender, input.receiver].map((p) => {
    if (p.id) return { ...p };
    const id = crypto.randomUUID();
    state.parties.push({
      ...p,
      id,
      tax_id: "",
      credit_limit: 0,
      credit_days: 30,
      is_active: true,
    });
    return { ...p, id };
  });
  const paid =
    input.collect_now && input.payment_mode === "CASH_ORIGIN" ? t.total : 0;
  const due = new Date();
  due.setDate(
    due.getDate() +
      (input.payment_mode.startsWith("CREDIT") ? input.credit_days : 0),
  );
  return {
    id: input.request_id,
    shipment_no:
      "DEMO-" + String(127 + state.shipments.length).padStart(5, "0"),
    received_at: new Date().toISOString(),
    sender_snapshot: snapshots[0],
    receiver_snapshot: snapshots[1],
    zone_id: z.id,
    district_id: input.district_id,
    zone_name: z.name,
    district_name: z.districts.find((d) => d.id === input.district_id)!.name,
    zone_color: z.color,
    payment_mode: input.payment_mode,
    credit_days: input.payment_mode.startsWith("CREDIT")
      ? input.credit_days
      : 0,
    payer_party_id:
      snapshots[input.payment_mode.endsWith("ORIGIN") ? 0 : 1].id!,
    total_amount: t.total,
    total_quantity: t.quantity,
    total_weight: t.weight,
    paid_amount: paid,
    outstanding_amount: t.total - paid,
    shipment_status: "RECEIVED",
    note: input.note,
    dropoff_name: input.dropoff_name,
    dropoff_phone: input.dropoff_phone,
    extra_charge: input.extra_charge,
    discount: input.discount,
    price_reason: input.price_reason,
    invoice_id: "demo-" + crypto.randomUUID(),
    due_date: localDate(due),
    created_by: "demo",
    items: structuredClone(input.items),
    files: [],
  };
}
export function demoRate(rules: PriceRule[], item: Item, zoneId: string) {
  return [...rules]
    .sort(
      (a, b) =>
        Number(!!b.zone_id) - Number(!!a.zone_id) ||
        b.version_no - a.version_no,
    )
    .find(
      (r) =>
        r.product_id === item.product_id &&
        (!r.zone_id || r.zone_id === zoneId),
    )?.unit_price;
}
