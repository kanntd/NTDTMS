import { createClient } from "@supabase/supabase-js";
import type {
  Party,
  PriceRule,
  Profile,
  ShipmentDetail,
  ShipmentInput,
  Shipment,
  Zone,
  Product,
  StaffInvite,
  DashboardStats,
} from "./types";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
);
function check<T>(result: {
  data: T | null;
  error: { message: string } | null;
}): T {
  if (result.error) throw new Error(result.error.message);
  if (result.data === null) throw new Error("ไม่พบข้อมูล");
  return result.data;
}
export async function getProfile(id: string): Promise<Profile | null> {
  const r = await supabase
    .from("profiles")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (r.error) throw r.error;
  return r.data;
}
export async function getMasters() {
  const [zones, products, rules] = await Promise.all([
    supabase.from("service_zones").select("*,districts(*)").order("sort_order"),
    supabase.from("products").select("*").order("name"),
    supabase
      .from("price_rules")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  return {
    zones: check(zones) as Zone[],
    products: check(products) as Product[],
    rules: check(rules) as PriceRule[],
  };
}
const clean = (q: string) =>
  q
    .replace(/[,%().\\]/g, " ")
    .trim()
    .slice(0, 100);
export async function searchParties(
  search = "",
  page = 0,
): Promise<{ rows: Party[]; count: number }> {
  let q = supabase
    .from("parties")
    .select("*", { count: "exact" })
    .order("display_name");
  if (clean(search))
    q = q.or(
      `display_name.ilike.%${clean(search)}%,phone.ilike.%${clean(search)}%`,
    );
  const r = await q.range(page * 50, page * 50 + 49);
  return { rows: check(r) as Party[], count: r.count || 0 };
}
export async function listShipments(
  options: {
    date?: string;
    search?: string;
    zone?: string;
    status?: string;
    unpaid?: boolean;
    page?: number;
  } = {},
): Promise<{ rows: Shipment[]; count: number }> {
  let q = supabase
    .from("shipment_register")
    .select("*", { count: "exact" })
    .order("received_at", { ascending: false })
    .order("id");
  if (options.date) {
    const start = new Date(options.date + "T00:00:00+07:00");
    const end = new Date(+start + 86400000);
    q = q
      .gte("received_at", start.toISOString())
      .lt("received_at", end.toISOString());
  }
  if (options.search && clean(options.search)) {
    const s = clean(options.search);
    q = q.or(
      `shipment_no.ilike.%${s}%,sender_snapshot->>display_name.ilike.%${s}%,receiver_snapshot->>display_name.ilike.%${s}%`,
    );
  }
  if (options.zone) q = q.eq("zone_id", options.zone);
  if (options.status) q = q.eq("shipment_status", options.status);
  if (options.unpaid) q = q.gt("outstanding_amount", 0);
  const page = options.page || 0;
  const r = await q.range(page * 50, page * 50 + 49);
  return { rows: check(r) as Shipment[], count: r.count || 0 };
}
export async function getShipment(id: string): Promise<ShipmentDetail> {
  const [s, i, f] = await Promise.all([
    supabase.from("shipment_register").select("*").eq("id", id).single(),
    supabase
      .from("shipment_items")
      .select("*")
      .eq("shipment_id", id)
      .order("line_no"),
    supabase.from("shipment_files").select("*").eq("shipment_id", id),
  ]);
  return { ...check(s), items: check(i), files: check(f) } as ShipmentDetail;
}
export async function issueShipment(input: ShipmentInput) {
  const id = check(await supabase.rpc("issue_shipment", { data: input }));
  return getShipment(id);
}
export async function saveParty(data: Partial<Party>) {
  return check(await supabase.rpc("save_party", { data }));
}
export async function collectPayment(
  doc: string,
  amount: number,
  method: string,
  reference: string,
  request: string,
) {
  check(
    await supabase.rpc("receive_payment", {
      doc,
      amount,
      method,
      reference,
      request,
    }),
  );
}
export async function updateStatus(doc: string, status: string, reason = "") {
  const r = await supabase.rpc("set_shipment_status", { doc, status, reason });
  if (r.error) throw r.error;
}
export async function getStats(date: string): Promise<DashboardStats> {
  return check(await supabase.rpc("reception_stats", { day: date }));
}
export async function setting(kind: string, data: unknown) {
  const r = await supabase.rpc("manage_setting", { kind, data });
  if (r.error) throw r.error;
}
export async function getStaff(): Promise<StaffInvite[]> {
  return check(
    await supabase.from("staff_invites").select("*").order("created_at"),
  );
}
export async function databaseHealth() {
  return check(await supabase.rpc("database_health")) as {
    bytes: number;
    tables: number;
    checked_at: string;
  };
}
export async function systemStatus() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    if (!response.ok) return { r2Configured: false };
    return (await response.json()) as { r2Configured: boolean };
  } catch {
    return { r2Configured: false };
  }
}
export async function uploadPhoto(shipment: string, file: File) {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) throw new Error("กรุณาเข้าสู่ระบบอีกครั้ง");
  const response = await fetch(
    "/api/photos?shipment=" + encodeURIComponent(shipment),
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + session.access_token,
        "Content-Type": file.type,
        "X-Filename": encodeURIComponent(file.name),
      },
      body: file,
    },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "อัปโหลดไม่สำเร็จ");
  return result;
}
export async function photoBlob(id: string) {
  const session = (await supabase.auth.getSession()).data.session;
  const r = await fetch("/api/photos/" + id, {
    headers: { Authorization: "Bearer " + session?.access_token },
  });
  if (!r.ok) throw new Error("เปิดรูปไม่สำเร็จ");
  return r.blob();
}
