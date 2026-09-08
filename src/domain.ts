import Decimal from "decimal.js";
import { z } from "zod";
import type { Item, ShipmentInput } from "./types";

const amount = z
  .number()
  .finite()
  .min(0)
  .max(99_999_999)
  .refine(
    (n) => new Decimal(n).decimalPlaces() <= 2,
    "จำนวนเงินใช้ทศนิยมไม่เกิน 2 ตำแหน่ง",
  );
const person = z.object({
  id: z.string().optional(),
  display_name: z.string().trim().min(1, "กรุณาระบุชื่อ").max(255),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+ ()-]{8,20}$/, "กรุณาระบุเบอร์โทรศัพท์ให้ครบ"),
  address: z.string().trim().min(1, "กรุณาระบุที่อยู่").max(1500),
});
export const shipmentSchema = z
  .object({
    request_id: z.uuid(),
    sender: person,
    receiver: person,
    zone_id: z.string().min(1, "กรุณาเลือกจังหวัด"),
    district_id: z.string().min(1, "กรุณาเลือกอำเภอ"),
    payment_mode: z.enum([
      "CASH_ORIGIN",
      "CASH_DESTINATION",
      "CREDIT_ORIGIN",
      "CREDIT_DESTINATION",
    ]),
    credit_days: z.number().int().min(0).max(365),
    items: z
      .array(
        z.object({
          id: z.string(),
          product_id: z.string(),
          description: z.string().trim().min(1, "กรุณาระบุชื่อสินค้า").max(255),
          quantity: z
            .number()
            .finite()
            .positive("จำนวนต้องมากกว่า 0")
            .max(1_000_000)
            .refine(
              (n) => new Decimal(n).decimalPlaces() <= 4,
              "จำนวนใช้ทศนิยมไม่เกิน 4 ตำแหน่ง",
            ),
          unit: z.string().min(1).max(30),
          unit_price: amount,
          weight: z.number().finite().min(0).max(1_000_000),
          fragile: z.boolean(),
        }),
      )
      .min(1)
      .max(100),
    note: z.string().max(2000),
    dropoff_name: z.string().max(255),
    dropoff_phone: z.string().max(30),
    extra_charge: amount,
    discount: amount,
    price_reason: z.string().max(1000),
    collect_now: z.boolean(),
  })
  .superRefine((v, ctx) => {
    const t = totals(v.items, v.extra_charge, v.discount);
    if (t.total <= 0)
      ctx.addIssue({
        code: "custom",
        path: ["items"],
        message: "ค่าขนส่งรวมต้องมากกว่า 0 บาท",
      });
    if (v.payment_mode.startsWith("CREDIT") && v.credit_days <= 0)
      ctx.addIssue({
        code: "custom",
        path: ["credit_days"],
        message: "กรุณาระบุวันเครดิต",
      });
  });
export function lineTotal(item: Pick<Item, "quantity" | "unit_price">) {
  return new Decimal(item.quantity || 0)
    .mul(item.unit_price || 0)
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toNumber();
}
export function totals(items: Item[], extra = 0, discount = 0) {
  const subtotal = items.reduce((s, i) => s.plus(lineTotal(i)), new Decimal(0));
  return {
    subtotal: subtotal.toNumber(),
    total: subtotal
      .plus(extra || 0)
      .minus(discount || 0)
      .toDecimalPlaces(2)
      .toNumber(),
    quantity: items
      .reduce((s, i) => s.plus(i.quantity || 0), new Decimal(0))
      .toNumber(),
    weight: items
      .reduce((s, i) => s.plus(i.weight || 0), new Decimal(0))
      .toNumber(),
  };
}
export const money = (n: number) =>
  new Intl.NumberFormat("th-TH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n || 0);
export const number = (n: number) =>
  new Intl.NumberFormat("th-TH", { maximumFractionDigits: 4 }).format(n || 0);
export const localDate = (date = new Date()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
export const thaiDate = (date: string | Date, full = false) =>
  new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    day: "numeric",
    month: full ? "long" : "short",
    year: "numeric",
  }).format(new Date(date));
export const thaiTime = (date: string) =>
  new Intl.DateTimeFormat("th-TH", {
    timeZone: "Asia/Bangkok",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(date));
export function emptyItem(): Item {
  return {
    id: crypto.randomUUID(),
    product_id: "",
    description: "",
    quantity: 1,
    unit: "กล่อง",
    unit_price: 0,
    weight: 0,
    fragile: false,
  };
}
export function emptyShipment(): ShipmentInput {
  return {
    request_id: crypto.randomUUID(),
    sender: { display_name: "", phone: "", address: "" },
    receiver: { display_name: "", phone: "", address: "" },
    zone_id: "",
    district_id: "",
    payment_mode: "CASH_ORIGIN",
    credit_days: 30,
    items: [emptyItem()],
    note: "",
    dropoff_name: "",
    dropoff_phone: "",
    extra_charge: 0,
    discount: 0,
    price_reason: "",
    collect_now: false,
  };
}
export function downloadCsv(filename: string, rows: (string | number)[][]) {
  const csv =
    "\uFEFF" +
    rows
      .map((r) =>
        r
          .map(
            (v) =>
              '"' +
              String(v)
                .replace(/^[=+@-]/, "'$&")
                .replaceAll('"', '""') +
              '"',
          )
          .join(","),
      )
      .join("\r\n");
  downloadBlob(filename, new Blob([csv], { type: "text/csv;charset=utf-8" }));
}
export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
