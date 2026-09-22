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
  LoadingQueueRecord,
  Item,
  CompanyBranch,
  ShipmentEditInput,
  LoadConfirmation,
  LoadTripRecord,
  LoadTripStatus,
  LoadTripUpdate,
} from "./types";
import { applyRecordedLoads } from "./loadingQueue";

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
  const [branches, zones, products, rules] = await Promise.all([
    supabase
      .from("branches")
      .select(
        "id,code,document_code,name,branch_kind,province_name,can_issue_bills,is_active,document_code_locked_at",
      )
      .order("code"),
    supabase
      .from("service_zones")
      .select("*,districts(*)")
      .eq("is_active", true)
      .order("sort_order"),
    supabase.from("products").select("*").order("name"),
    supabase
      .from("price_rules")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500),
  ]);
  return {
    branches: check(branches) as CompanyBranch[],
    zones: (check(zones) as Zone[]).map((zone) => ({
      ...zone,
      districts: zone.districts.filter(
        (district) => district.is_active !== false,
      ),
    })),
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
    dateFrom?: string;
    dateTo?: string;
    search?: string;
    zone?: string;
    district?: string;
    branch?: string;
    receiverId?: string;
    senderId?: string;
    catalogId?: string;
    unit?: string;
    payment?: string;
    openedBy?: string;
    priceState?: "PENDING" | "PRICED" | "";
    paymentState?: "PAID" | "PARTIAL" | "UNPAID" | "";
    status?: string;
    unpaid?: boolean;
    page?: number;
    pageSize?: number;
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
  if (options.dateFrom) {
    const start = new Date(options.dateFrom + "T00:00:00+07:00");
    q = q.gte("received_at", start.toISOString());
  }
  if (options.dateTo) {
    const end = new Date(options.dateTo + "T00:00:00+07:00");
    end.setDate(end.getDate() + 1);
    q = q.lt("received_at", end.toISOString());
  }
  const itemShipmentIds = new Set<string>();
  if (options.catalogId || options.unit) {
    let itemQuery = supabase.from("shipment_items").select("shipment_id");
    if (options.catalogId)
      itemQuery = itemQuery.eq("product_unit_id", options.catalogId);
    if (options.unit) itemQuery = itemQuery.eq("unit", options.unit);
    const matches = await itemQuery.limit(5000);
    if (matches.error) throw matches.error;
    for (const row of matches.data || []) itemShipmentIds.add(row.shipment_id);
    if (!itemShipmentIds.size) return { rows: [], count: 0 };
  }
  if (options.search && clean(options.search)) {
    const s = clean(options.search);
    const itemMatches = await supabase
      .from("shipment_items")
      .select("shipment_id")
      .ilike("description", `%${s}%`)
      .limit(500);
    if (itemMatches.error) throw itemMatches.error;
    const itemIds = [
      ...new Set((itemMatches.data || []).map((row) => row.shipment_id)),
    ];
    const itemFilter = itemIds.length ? `,id.in.(${itemIds.join(",")})` : "";
    q = q.or(
      `shipment_no.ilike.%${s}%,sender_snapshot->>display_name.ilike.%${s}%,receiver_snapshot->>display_name.ilike.%${s}%,sender_snapshot->>phone.ilike.%${s}%,receiver_snapshot->>phone.ilike.%${s}%${itemFilter}`,
    );
  }
  if (itemShipmentIds.size) q = q.in("id", [...itemShipmentIds]);
  if (options.zone) q = q.eq("zone_id", options.zone);
  if (options.district) q = q.eq("district_id", options.district);
  if (options.branch) q = q.eq("destination_branch_code", options.branch);
  if (options.receiverId) q = q.eq("receiver_party_id", options.receiverId);
  if (options.senderId) q = q.eq("sender_party_id", options.senderId);
  if (options.payment) q = q.eq("payment_mode", options.payment);
  if (options.openedBy) q = q.eq("opened_by_employee_id", options.openedBy);
  if (options.priceState === "PENDING") q = q.eq("price_pending", true);
  if (options.priceState === "PRICED") q = q.eq("price_pending", false);
  if (options.paymentState === "PAID") q = q.eq("outstanding_amount", 0);
  if (options.paymentState === "PARTIAL")
    q = q.gt("paid_amount", 0).gt("outstanding_amount", 0);
  if (options.paymentState === "UNPAID")
    q = q.eq("paid_amount", 0).gt("outstanding_amount", 0);
  if (options.status) q = q.eq("shipment_status", options.status);
  if (options.unpaid) q = q.gt("outstanding_amount", 0);
  const page = options.page || 0;
  const pageSize = options.pageSize || 50;
  const r = await q.range(page * pageSize, page * pageSize + pageSize - 1);
  const rows = check(r) as Shipment[];
  if (!rows.length) return { rows, count: r.count || 0 };
  const items = await supabase
    .from("shipment_items")
    .select("*")
    .in(
      "shipment_id",
      rows.map((row) => row.id),
    )
    .order("line_no");
  if (items.error) throw items.error;
  const byShipment = (items.data || []).reduce<Record<string, unknown[]>>(
    (groups, item) => {
      const id = String(item.shipment_id);
      (groups[id] ||= []).push(item);
      return groups;
    },
    {},
  );
  return {
    rows: rows.map((row) => ({
      ...row,
      items: (byShipment[row.id] || []) as Item[],
    })),
    count: r.count || 0,
  };
}
export async function getLoadingQueue(): Promise<LoadingQueueRecord[]> {
  const rows: LoadingQueueRecord[] = [];
  let page = 0;
  while (page < 20) {
    const result = await supabase
      .from("shipments")
      .select(
        "id,shipment_no,received_at,sender_snapshot,receiver_snapshot,zone_id,district_id,destination_branch_code,payment_mode,total_amount,total_quantity,total_weight,shipment_status,price_pending,shipment_items(id,product_id,product_unit_id,description,quantity,unit,unit_price,weight,fragile)",
      )
      .in("shipment_status", ["RECEIVED", "IN_TRANSIT"])
      .order("received_at", { ascending: true })
      .range(page * 500, page * 500 + 499);
    if (result.error) throw result.error;
    const batch = (result.data || []).map((row) => ({
      ...row,
      total_amount: Number(row.total_amount) || 0,
      total_quantity: Number(row.total_quantity) || 0,
      total_weight: Number(row.total_weight) || 0,
      items: (row.shipment_items || []).map((item) => ({
        ...item,
        quantity: Number(item.quantity) || 0,
        unit_price: Number(item.unit_price) || 0,
        weight: Number(item.weight) || 0,
      })),
    })) as unknown as LoadingQueueRecord[];
    const itemIds = batch.flatMap((row) => row.items.map((item) => item.id));
    const allocations: Array<{
      shipmentId: string;
      itemId: string;
      quantity: number;
    }> = [];
    let allocationTableAvailable = true;
    for (let start = 0; start < itemIds.length; start += 100) {
      const allocationResult = await supabase
        .from("load_manifest_item_lines")
        .select(
          "shipment_id,shipment_item_id,quantity,load_manifests!inner(status)",
        )
        .eq("is_active", true)
        .neq("load_manifests.status", "CANCELLED")
        .in("shipment_item_id", itemIds.slice(start, start + 100));
      if (allocationResult.error) {
        if (["42P01", "PGRST205"].includes(allocationResult.error.code || "")) {
          allocationTableAvailable = false;
          break;
        }
        throw allocationResult.error;
      }
      allocations.push(
        ...(allocationResult.data || []).map((allocation) => ({
          shipmentId: String(allocation.shipment_id),
          itemId: String(allocation.shipment_item_id),
          quantity: Number(allocation.quantity) || 0,
        })),
      );
    }
    rows.push(
      ...applyRecordedLoads(
        allocationTableAvailable
          ? batch
          : batch.filter((row) => row.shipment_status === "RECEIVED"),
        allocations,
      ),
    );
    if (batch.length < 500) break;
    page += 1;
  }
  return rows;
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
export async function updateReceptionBill(
  doc: string,
  data: ShipmentEditInput,
  reason: string,
) {
  const result = await supabase.rpc("update_reception_bill_v2", {
    doc,
    data,
    reason,
  });
  if (result.error) throw result.error;
  return getShipment(doc);
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
export async function confirmLoad(load: LoadConfirmation) {
  const result = await supabase.rpc("create_load_manifest", {
    data: {
      manifest_no: load.manifestNo,
      destination_branch_code: load.destinationBranchCode,
      vehicle_id: load.vehicleId,
      driver_employee_id: load.driverId,
      driver_name: load.driverName,
      confirmed_at: load.confirmedAt,
      allocations: load.allocations.map((allocation) => ({
        shipment_id: allocation.shipmentId,
        shipment_item_id: allocation.itemId,
        quantity: allocation.quantity,
      })),
    },
  });
  if (result.error) throw result.error;
  return result.data as string;
}
export async function createLoadTrip(
  manifestNo: string,
  destinationBranchCode: string,
  vehicleId: string,
) {
  const result = await supabase.rpc("create_load_trip", {
    data: {
      manifest_no: manifestNo,
      destination_branch_code: destinationBranchCode,
      vehicle_id: vehicleId,
    },
  });
  if (result.error) throw result.error;
  return result.data as string;
}

export async function saveLoadTripItems(
  id: string,
  mode: "ADD" | "SET",
  allocations: Array<{ shipmentId: string; itemId: string; quantity: number }>,
) {
  const result = await supabase.rpc("save_load_trip_items", {
    data: {
      id,
      mode,
      allocations: allocations.map((line) => ({
        shipment_id: line.shipmentId,
        shipment_item_id: line.itemId,
        quantity: line.quantity,
      })),
    },
  });
  if (result.error) throw result.error;
}

export async function setLoadTripStatus(
  id: string,
  action: "CLOSE" | "DEPART" | "REOPEN" | "CANCEL",
  options: {
    vehicleId?: string;
    driverId?: string;
    note?: string;
    reason?: string;
  } = {},
) {
  const result = await supabase.rpc("set_load_trip_status", {
    data: {
      id,
      action,
      vehicle_id: options.vehicleId || "",
      driver_employee_id: options.driverId || "",
      note: options.note || "",
      reason: options.reason || "",
    },
  });
  if (result.error) throw result.error;
}
export async function getLoadTrips(): Promise<LoadTripRecord[]> {
  const manifestResult = await supabase
    .from("load_manifests")
    .select(
      "id,manifest_no,status,destination_branch_id,vehicle_id,driver_employee_id,loaded_at,departed_at,note,created_at",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (manifestResult.error) throw manifestResult.error;
  const manifests = manifestResult.data || [];
  if (!manifests.length) return [];

  const manifestIds = manifests.map((row) => String(row.id));
  const lineResult = await supabase
    .from("load_manifest_item_lines")
    .select(
      "id,manifest_id,shipment_id,shipment_item_id,quantity,unit_snapshot,is_active",
    )
    .in("manifest_id", manifestIds)
    .order("loaded_at");
  if (lineResult.error) {
    if (["42P01", "PGRST205"].includes(lineResult.error.code || "")) return [];
    throw lineResult.error;
  }
  const lines = lineResult.data || [];
  const shipmentIds = [...new Set(lines.map((row) => String(row.shipment_id)))];
  const itemIds = [
    ...new Set(lines.map((row) => String(row.shipment_item_id))),
  ];
  const vehicleIds = [
    ...new Set(
      manifests.map((row) => String(row.vehicle_id || "")).filter(Boolean),
    ),
  ];
  const driverIds = [
    ...new Set(
      manifests
        .map((row) => String(row.driver_employee_id || ""))
        .filter(Boolean),
    ),
  ];
  const branchIds = [
    ...new Set(
      manifests
        .map((row) => String(row.destination_branch_id || ""))
        .filter(Boolean),
    ),
  ];

  const [
    shipmentResult,
    itemResult,
    vehicleResult,
    driverResult,
    branchResult,
  ] = await Promise.all([
    shipmentIds.length
      ? supabase
          .from("shipments")
          .select("id,shipment_no,receiver_snapshot,sender_snapshot")
          .in("id", shipmentIds)
      : Promise.resolve({ data: [], error: null }),
    itemIds.length
      ? supabase
          .from("shipment_items")
          .select("id,description,quantity,unit")
          .in("id", itemIds)
      : Promise.resolve({ data: [], error: null }),
    vehicleIds.length
      ? supabase
          .from("vehicle_assets")
          .select("id,plate_no")
          .in("id", vehicleIds)
      : Promise.resolve({ data: [], error: null }),
    driverIds.length
      ? supabase
          .from("employees")
          .select("id,display_name,nickname")
          .in("id", driverIds)
      : Promise.resolve({ data: [], error: null }),
    branchIds.length
      ? supabase.from("branches").select("id,code").in("id", branchIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [
    shipmentResult,
    itemResult,
    vehicleResult,
    driverResult,
    branchResult,
  ])
    if (result.error) throw result.error;

  const shipments = new Map(
    (shipmentResult.data || []).map((row) => [String(row.id), row]),
  );
  const items = new Map(
    (itemResult.data || []).map((row) => [String(row.id), row]),
  );
  const vehicles = new Map(
    (vehicleResult.data || []).map((row) => [
      String(row.id),
      String(row.plate_no || ""),
    ]),
  );
  const drivers = new Map(
    (driverResult.data || []).map((row) => [
      String(row.id),
      String(row.nickname || row.display_name || ""),
    ]),
  );
  const branches = new Map(
    (branchResult.data || []).map((row) => [
      String(row.id),
      String(row.code || ""),
    ]),
  );

  return manifests.map((manifest) => {
    const vehicleId = String(manifest.vehicle_id || "");
    const driverId = String(manifest.driver_employee_id || "");
    const destinationBranchId = String(manifest.destination_branch_id || "");
    return {
      id: String(manifest.id),
      manifestNo: String(manifest.manifest_no),
      status: String(manifest.status) as LoadTripStatus,
      destinationBranchId,
      destinationBranchCode: branches.get(destinationBranchId) || "",
      vehicleId,
      vehicleNo: vehicles.get(vehicleId) || "",
      driverId,
      driverName: drivers.get(driverId) || "",
      loadedAt: String(manifest.loaded_at || manifest.created_at),
      departedAt: String(manifest.departed_at || ""),
      note: String(manifest.note || ""),
      allocations: lines
        .filter((line) => String(line.manifest_id) === String(manifest.id))
        .map((line) => {
          const shipment = shipments.get(String(line.shipment_id));
          const item = items.get(String(line.shipment_item_id));
          const receiver = shipment?.receiver_snapshot as
            { display_name?: string } | undefined;
          const sender = shipment?.sender_snapshot as
            { display_name?: string } | undefined;
          return {
            id: String(line.id),
            shipmentId: String(line.shipment_id),
            shipmentNo: String(shipment?.shipment_no || ""),
            itemId: String(line.shipment_item_id),
            description: String(item?.description || ""),
            quantity: Number(line.quantity) || 0,
            originalQuantity: Number(item?.quantity) || 0,
            unit: String(line.unit_snapshot || item?.unit || ""),
            receiverName: String(receiver?.display_name || ""),
            senderName: String(sender?.display_name || ""),
            active: Boolean(line.is_active),
          };
        }),
    };
  });
}
export async function updateLoadTrip(update: LoadTripUpdate) {
  const result = await supabase.rpc("update_load_manifest", {
    data: {
      id: update.id,
      action: update.action,
      vehicle_id: update.vehicleId || "",
      driver_employee_id: update.driverId || "",
      driver_name: update.driverName || "",
      note: update.note || "",
      allocations: (update.allocations || []).map((allocation) => ({
        line_id: allocation.lineId,
        quantity: allocation.quantity,
      })),
    },
  });
  if (result.error) throw result.error;
}
export async function getStats(date: string): Promise<DashboardStats> {
  return check(await supabase.rpc("reception_stats", { day: date }));
}
export async function setting(kind: string, data: unknown) {
  const r = kind.startsWith("branch_")
    ? await supabase.rpc("manage_branch_setting", {
        action: kind === "branch_save" ? "save" : "delete",
        data,
      })
    : await supabase.rpc("manage_setting", { kind, data });
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

export async function uploadMasterDocument(
  ownerType: "EMPLOYEE" | "VEHICLE",
  ownerId: string,
  kind: string,
  expiresOn: string,
  file: File,
) {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) throw new Error("กรุณาเข้าสู่ระบบอีกครั้ง");
  const params = new URLSearchParams({ ownerType, owner: ownerId, kind });
  if (expiresOn) params.set("expires", expiresOn);
  const response = await fetch("/api/master-documents?" + params, {
    method: "POST",
    headers: {
      Authorization: "Bearer " + session.access_token,
      "Content-Type": file.type,
      "X-Filename": encodeURIComponent(file.name),
    },
    body: file,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "อัปโหลดเอกสารไม่สำเร็จ");
  return result as { id: string; filename: string };
}

export async function masterDocumentBlob(id: string) {
  const session = (await supabase.auth.getSession()).data.session;
  if (!session) throw new Error("กรุณาเข้าสู่ระบบอีกครั้ง");
  const response = await fetch("/api/master-documents/" + id, {
    headers: { Authorization: "Bearer " + session.access_token },
  });
  if (!response.ok) throw new Error("เปิดเอกสารไม่สำเร็จ");
  return response.blob();
}
