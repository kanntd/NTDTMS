import type { Role, Shipment } from "./types";

type ShipmentStatus = Shipment["shipment_status"];

export function canEditShipment(role: Role, status: ShipmentStatus) {
  if (status === "CANCELLED") return false;
  if (status === "RECEIVED")
    return role === "owner" || role === "admin" || role === "clerk";
  return role === "owner" || role === "admin";
}

export function editReasonRequired(status: ShipmentStatus) {
  return status === "IN_TRANSIT" || status === "DELIVERED";
}

export function billEditAccessMessage(role: Role, status: ShipmentStatus) {
  if (status === "CANCELLED") return "บิลที่ยกเลิกแล้วไม่สามารถแก้ไขได้";
  if (!canEditShipment(role, status))
    return "บิลขึ้นรถแล้ว ต้องใช้บัญชีเจ้าของหรือผู้ดูแลระบบจึงจะแก้ไขได้";
  if (editReasonRequired(status))
    return "บิลขึ้นรถแล้ว การแก้ไขครั้งนี้ต้องระบุเหตุผลและจะถูกเก็บในประวัติบิล";
  return "แก้ไขได้จนกว่าจะนำบิลขึ้นรถ";
}
