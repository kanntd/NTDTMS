export type PaymentMode =
  "CASH_ORIGIN" | "CASH_DESTINATION" | "CREDIT_ORIGIN" | "CREDIT_DESTINATION";
export type Role = "owner" | "admin" | "clerk" | "accountant" | "viewer";
export interface Zone {
  id: string;
  name: string;
  color: string;
  code: string;
  sort_order: number;
  districts: District[];
}
export interface District {
  id: string;
  name: string;
  zone_id: string;
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
export const STATUS_LABELS = {
  RECEIVED: "รับสินค้าแล้ว",
  IN_TRANSIT: "กำลังขนส่ง",
  DELIVERED: "ส่งสำเร็จ",
  CANCELLED: "ยกเลิก",
};
