export type PaymentMode =
  "CASH_ORIGIN" | "CASH_DESTINATION" | "CREDIT_ORIGIN" | "CREDIT_DESTINATION";
export type Role = "owner" | "admin" | "clerk" | "accountant" | "viewer";
export type ModuleKey =
  | "intake"
  | "shipments"
  | "master_data"
  | "pricing"
  | "finance"
  | "reports"
  | "settings";
export type ModulePermissions = Partial<Record<ModuleKey, boolean>>;
export type BranchKind = "ORIGIN" | "DESTINATION" | "BOTH" | "HUB" | "ADMIN";
export interface CompanyBranch {
  id: string;
  code: string;
  document_code: string;
  name: string;
  branch_kind: BranchKind;
  province_name: string;
  can_issue_bills: boolean;
  is_active: boolean;
  document_code_locked_at?: string | null;
}
export interface Zone {
  id: string;
  name: string;
  color: string;
  code: string;
  sort_order: number;
  is_active?: boolean;
  districts: District[];
}
export interface District {
  id: string;
  name: string;
  zone_id: string;
  is_active?: boolean;
}
export interface Party {
  id: string;
  display_name: string;
  phone: string;
  address: string;
  tax_id: string;
  credit_limit: number;
  credit_days: number;
  is_active: boolean;
}
export interface Product {
  id: string;
  name: string;
  unit: string;
}
export interface Profile {
  id: string;
  display_name: string;
  email: string;
  role: Role;
  company_id: string;
  branch_id: string;
  is_active: boolean;
  module_permissions?: ModulePermissions;
}
export interface Item {
  id: string;
  product_id: string;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  weight: number;
  fragile: boolean;
}
export interface PartySnapshot {
  id?: string;
  display_name: string;
  phone: string;
  address: string;
}
export interface ShipmentInput {
  request_id: string;
  sender: PartySnapshot;
  receiver: PartySnapshot;
  zone_id: string;
  district_id: string;
  payment_mode: PaymentMode;
  credit_days: number;
  items: Item[];
  note: string;
  dropoff_name: string;
  dropoff_phone: string;
  extra_charge: number;
  discount: number;
  price_reason: string;
  collect_now: boolean;
}
export interface Shipment {
  id: string;
  shipment_no: string;
  received_at: string;
  sender_snapshot: PartySnapshot;
  receiver_snapshot: PartySnapshot;
  zone_id: string;
  district_id: string;
  zone_name: string;
  district_name: string;
  zone_color: string;
  payment_mode: PaymentMode;
  credit_days: number;
  payer_party_id: string;
  total_amount: number;
  total_quantity: number;
  total_weight: number;
  paid_amount: number;
  outstanding_amount: number;
  shipment_status: "RECEIVED" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED";
  note: string;
  dropoff_name: string;
  dropoff_phone: string;
  extra_charge: number;
  discount: number;
  price_reason: string;
  invoice_id: string;
  due_date: string;
  created_by: string;
  sender_party_id?: string;
  receiver_party_id?: string;
  opened_by_employee_id?: string;
  destination_branch_code?: string;
  price_pending?: boolean;
  manifest_no?: string;
  loaded_at?: string;
  vehicle_plate_no?: string;
  driver_name?: string;
  delivered_at?: string;
  items?: Item[];
}
export interface ShipmentDetail extends Shipment {
  items: Item[];
  files: ShipmentFile[];
}
export interface ShipmentFile {
  id: string;
  shipment_id: string;
  object_key: string;
  filename: string;
  mime_type: string;
  byte_size: number;
}
export interface LoadingQueueRecord {
  id: string;
  shipment_no: string;
  received_at: string;
  sender_snapshot: PartySnapshot;
  receiver_snapshot: PartySnapshot;
  zone_id: string;
  district_id: string;
  destination_branch_code?: string;
  total_amount: number;
  total_quantity: number;
  shipment_status: Shipment["shipment_status"];
  price_pending?: boolean;
  items: Item[];
}
export interface LoadConfirmation {
  manifestNo: string;
  vehicleId: string;
  vehicleNo: string;
  driverId: string;
  driverName: string;
  confirmedAt: string;
}
export interface PriceRule {
  id: string;
  product_id: string;
  zone_id: string | null;
  unit_price: number;
  version_no: number;
  created_at: string;
  product?: Product;
  zone?: Zone;
}
export interface StaffInvite {
  email: string;
  display_name: string;
  role: Role;
  is_active: boolean;
  module_permissions?: ModulePermissions;
}
export interface DashboardStats {
  count: number;
  quantity: number;
  total: number;
  collected: number;
  pending: number;
  zones: Record<string, { count: number; quantity: number }>;
}
export const PAYMENT_LABELS: Record<PaymentMode, string> = {
  CASH_ORIGIN: "เงินสดต้นทาง",
  CASH_DESTINATION: "เงินสดปลายทาง",
  CREDIT_ORIGIN: "เครดิตต้นทาง",
  CREDIT_DESTINATION: "เครดิตปลายทาง",
};
export const ROLE_LABELS: Record<Role, string> = {
  owner: "เจ้าของ",
  admin: "ผู้ดูแลระบบ",
  clerk: "พนักงานรับสินค้า",
  accountant: "การเงิน",
  viewer: "ดูข้อมูล",
};

export const MODULE_LABELS: Record<ModuleKey, string> = {
  intake: "รับสินค้าและออกบิล",
  shipments: "ค้นหาและติดตามบิล",
  master_data: "ข้อมูลหลัก",
  pricing: "ราคาและคำขอราคา",
  finance: "รับชำระและยอดค้าง",
  reports: "รายงาน",
  settings: "ตั้งค่าบริษัท",
};

export const ROLE_MODULE_DEFAULTS: Record<Role, ModulePermissions> = {
  owner: Object.fromEntries(
    Object.keys(MODULE_LABELS).map((key) => [key, true]),
  ) as ModulePermissions,
  admin: {
    intake: true,
    shipments: true,
    master_data: true,
    pricing: true,
    finance: true,
    reports: true,
    settings: true,
  },
  clerk: { intake: true, shipments: true },
  accountant: {
    shipments: true,
    pricing: true,
    finance: true,
    reports: true,
  },
  viewer: { shipments: true, reports: true },
};
export const STATUS_LABELS = {
  RECEIVED: "รับสินค้าแล้ว",
  IN_TRANSIT: "กำลังขนส่ง",
  DELIVERED: "ส่งสำเร็จ",
  CANCELLED: "ยกเลิก",
};
