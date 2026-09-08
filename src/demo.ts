import type {
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
export const demoProducts: Product[] = [
  { id: "p1", name: "สินค้าทั่วไป", unit: "กล่อง" },
  { id: "p2", name: "สินค้าอุปโภคบริโภค", unit: "ลัง" },
  { id: "p3", name: "วัสดุและอุปกรณ์", unit: "มัด" },
  { id: "p4", name: "สินค้ากระสอบ", unit: "กระสอบ" },
  { id: "p5", name: "พาเลทสินค้า", unit: "พาเลท" },
];
export const demoRules: PriceRule[] = demoProducts.map((p, i) => ({
  id: "rule-" + i,
  product_id: p.id,
  zone_id: null,
  unit_price: [40, 60, 80, 50, 450][i],
  version_no: 1,
  created_at: new Date().toISOString(),
}));
const names = [
  "บริษัท สยามบรรจุภัณฑ์ จำกัด",
  "ร้านรุ่งเรืองพาณิชย์",
  "คุณสมชาย ใจดี",
  "ร้านสุโขทัยเครื่องเขียน",
  "บริษัท ก้าวหน้าวัสดุ จำกัด",
  "ร้านกำแพงเพชรเทรดดิ้ง",
  "ร้านพิษณุโลกอะไหล่",
  "คุณมาลี รุ่งเรือง",
];
export const demoParties: Party[] = names.map((name, i) => ({
  id: "party-" + i,
  display_name: name,
  phone: "099000000" + i,
  address:
    i % 2 === 0
      ? "88 ถนนประชาราษฎร์ แขวงบางซื่อ เขตบางซื่อ กรุงเทพฯ"
      : "128 ถนนสายหลัก ตำบลในเมือง",
  tax_id: "",
  credit_limit: 50000,
  credit_days: 30,
  is_active: true,
}));

export interface DemoState {
  shipments: ShipmentDetail[];
  parties: Party[];
  zones: Zone[];
  rules: PriceRule[];
}
const key = "ntdtms-demo-v2";
export function loadDemo(): DemoState {
  try {
    const v = JSON.parse(localStorage.getItem(key) || "null");
    if (v && Array.isArray(v.shipments) && Array.isArray(v.zones)) return v;
  } catch {
    /* A corrupt demo snapshot can be reset without affecting business data. */
  }
  const shipments: ShipmentDetail[] = [0, 1, 2, 3, 4, 5, 6].map((n) => {
    const z = demoZones[n % 3],
      amount = [480, 1200, 320, 600, 900, 240, 720][n];
    const mode = (
      [
        "CASH_ORIGIN",
        "CREDIT_ORIGIN",
        "CASH_DESTINATION",
        "CREDIT_DESTINATION",
      ] as const
    )[n % 4];
    const paid = mode === "CASH_ORIGIN" ? amount : 0;
    return {
      id: "demo-" + n,
      shipment_no: "DEMO-" + String(127 + n).padStart(5, "0"),
      received_at:
        localDate() +
        "T" +
        ["08:35", "09:02", "09:18", "09:47", "10:06", "10:24", "10:42"][n] +
        ":00+07:00",
      sender_snapshot: demoParties[n % 3],
      receiver_snapshot: demoParties[3 + (n % 5)],
      zone_id: z.id,
      district_id: z.districts[n % 3].id,
      zone_name: z.name,
      district_name: z.districts[n % 3].name,
      zone_color: z.color,
      payment_mode: mode,
      credit_days: mode.startsWith("CREDIT") ? 30 : 0,
      payer_party_id:
        demoParties[mode.endsWith("ORIGIN") ? n % 3 : 3 + (n % 5)].id,
      total_amount: amount,
      total_quantity: amount / 40,
      total_weight: 0,
      paid_amount: paid,
      outstanding_amount: amount - paid,
      shipment_status: n < 2 ? "IN_TRANSIT" : "RECEIVED",
      note: "",
      dropoff_name: "",
      dropoff_phone: "",
      extra_charge: 0,
      discount: 0,
      price_reason: "ราคาตัวอย่าง",
      invoice_id: "demo-inv-" + n,
      due_date: localDate(),
      created_by: "demo",
      items: [
        {
          id: "line-" + n,
          product_id: "p1",
          description: "สินค้าทั่วไป",
          quantity: amount / 40,
          unit: "กล่อง",
          unit_price: 40,
          weight: 0,
          fragile: false,
        },
      ],
      files: [],
    };
  });
  const state = {
    shipments,
    parties: structuredClone(demoParties),
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
