import * as api from "./api";
import { createDemoShipment, demoProducts, loadDemo, saveDemo } from "./demo";
import { localDate } from "./domain";
import type {
  DashboardStats,
  Party,
  Shipment,
  ShipmentInput,
  StaffInvite,
} from "./types";
import { ROLE_MODULE_DEFAULTS } from "./types";
import type { LoadConfirmation, LoadingQueueRecord } from "./types";
import {
  readReceptionBills,
  receptionBillToShipment,
  receptionLoadingQueue,
  updateReceptionBillStatus,
} from "./receptionStore";

function allDemoShipments() {
  const local = readReceptionBills().map(receptionBillToShipment);
  const localIds = new Set(local.map((row) => row.id));
  return [
    ...local,
    ...loadDemo().shipments.filter((row) => !localIds.has(row.id)),
  ];
}

export function createService(demo: boolean) {
  return {
    masters: async () =>
      demo
        ? {
            branches: loadDemo().branches,
            zones: loadDemo().zones,
            products: demoProducts,
            rules: loadDemo().rules,
          }
        : api.getMasters(),
    parties: async (search = "", page = 0) => {
      if (!demo) return api.searchParties(search, page);
      const rows = loadDemo().parties.filter((p) =>
        (p.display_name + p.phone).includes(search),
      );
      return {
        rows: rows.slice(page * 50, page * 50 + 50),
        count: rows.length,
      };
    },
    shipments: async (
      options: Parameters<typeof api.listShipments>[0] = {},
    ) => {
      if (!demo) return api.listShipments(options);
      const o = options || {};
      const all = allDemoShipments()
        .filter((s) => {
          const received = localDate(new Date(s.received_at));
          return (
            (!o.date || received === o.date) &&
            (!o.dateFrom || received >= o.dateFrom) &&
            (!o.dateTo || received <= o.dateTo) &&
            (!o.zone || s.zone_id === o.zone) &&
            (!o.district || s.district_id === o.district) &&
            (!o.branch || s.destination_branch_code === o.branch) &&
            (!o.receiverId ||
              s.receiver_party_id === o.receiverId ||
              s.receiver_snapshot.id === o.receiverId) &&
            (!o.senderId ||
              s.sender_party_id === o.senderId ||
              s.sender_snapshot.id === o.senderId) &&
            (!o.catalogId ||
              s.items?.some((item) => item.product_id === o.catalogId)) &&
            (!o.unit || s.items?.some((item) => item.unit === o.unit)) &&
            (!o.payment || s.payment_mode === o.payment) &&
            (!o.openedBy || s.opened_by_employee_id === o.openedBy) &&
            (!o.priceState ||
              (o.priceState === "PENDING"
                ? s.price_pending
                : !s.price_pending)) &&
            (!o.paymentState ||
              (o.paymentState === "PAID"
                ? s.outstanding_amount === 0
                : o.paymentState === "PARTIAL"
                  ? s.paid_amount > 0 && s.outstanding_amount > 0
                  : s.paid_amount === 0 && s.outstanding_amount > 0)) &&
            (!o.status || s.shipment_status === o.status) &&
            (!o.unpaid || s.outstanding_amount > 0) &&
            (!o.search ||
              (
                s.shipment_no +
                s.sender_snapshot.display_name +
                s.sender_snapshot.phone +
                s.receiver_snapshot.display_name +
                s.receiver_snapshot.phone +
                ("items" in s
                  ? s.items
                      .map((item) => item.description + item.unit)
                      .join(" ")
                  : "")
              )
                .toLowerCase()
                .includes(o.search.toLowerCase()))
          );
        })
        .sort((a, b) => +new Date(b.received_at) - +new Date(a.received_at));
      const pageSize = o.pageSize || 50;
      return {
        rows: all.slice(
          (o.page || 0) * pageSize,
          (o.page || 0) * pageSize + pageSize,
        ) as Shipment[],
        count: all.length,
      };
    },
    detail: async (id: string) => {
      if (!demo) return api.getShipment(id);
      const local = readReceptionBills().find((bill) => bill.id === id);
      if (local) return receptionBillToShipment(local);
      const s = loadDemo().shipments.find((s) => s.id === id);
      if (!s) throw new Error("ไม่พบเอกสาร");
      return s;
    },
    issue: async (input: ShipmentInput) => {
      if (!demo) return api.issueShipment(input);
      const state = loadDemo(),
        shipment = createDemoShipment(state, input);
      if (!state.shipments.some((s) => s.id === shipment.id))
        state.shipments.unshift(shipment);
      saveDemo(state);
      return shipment;
    },
    saveParty: async (p: Partial<Party>) => {
      if (!demo) return api.saveParty(p);
      const state = loadDemo();
      const id = p.id || crypto.randomUUID();
      const i = state.parties.findIndex((x) => x.id === id);
      const next = {
        id,
        display_name: "",
        phone: "",
        address: "",
        tax_id: "",
        credit_limit: 0,
        credit_days: 30,
        is_active: true,
        ...(i >= 0 ? state.parties[i] : {}),
        ...p,
      };
      if (i >= 0) state.parties[i] = next;
      else state.parties.push(next);
      saveDemo(state);
      return id;
    },
    collect: async (
      doc: string,
      amount: number,
      method: string,
      reference: string,
      request: string,
    ) => {
      if (!demo)
        return api.collectPayment(doc, amount, method, reference, request);
      const state = loadDemo(),
        s = state.shipments.find((s) => s.id === doc)!;
      if (amount <= 0 || amount > s.outstanding_amount)
        throw new Error("ยอดรับเงินไม่ถูกต้อง");
      s.paid_amount = Math.round((s.paid_amount + amount) * 100) / 100;
      s.outstanding_amount =
        Math.round((s.total_amount - s.paid_amount) * 100) / 100;
      saveDemo(state);
    },
    status: async (doc: string, status: string, reason = "") => {
      if (!demo) return api.updateStatus(doc, status, reason);
      if (
        updateReceptionBillStatus(
          doc,
          status as "RECEIVED" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED",
        )
      )
        return;
      const state = loadDemo(),
        s = state.shipments.find((s) => s.id === doc)!;
      if (
        status === "CANCELLED" &&
        (s.paid_amount > 0 ||
          s.shipment_status !== "RECEIVED" ||
          reason.trim().length < 3)
      )
        throw new Error("บิลนี้ไม่สามารถยกเลิกได้");
      s.shipment_status = status as Shipment["shipment_status"];
      if (status === "CANCELLED") s.outstanding_amount = 0;
      saveDemo(state);
    },
    stats: async (date: string): Promise<DashboardStats> => {
      if (!demo) return api.getStats(date);
      const rows = allDemoShipments().filter(
        (s) =>
          localDate(new Date(s.received_at)) === date &&
          s.shipment_status !== "CANCELLED",
      );
      const zones: DashboardStats["zones"] = {};
      rows.forEach((s) => {
        zones[s.zone_id] ||= { count: 0, quantity: 0 };
        zones[s.zone_id].count++;
        zones[s.zone_id].quantity += s.total_quantity;
      });
      return {
        count: rows.length,
        quantity: rows.reduce((a, s) => a + s.total_quantity, 0),
        total: rows.reduce((a, s) => a + s.total_amount, 0),
        collected: rows.reduce((a, s) => a + s.paid_amount, 0),
        pending: rows.reduce((a, s) => a + s.outstanding_amount, 0),
        zones,
      };
    },
    loadingQueue: async (): Promise<LoadingQueueRecord[]> => {
      if (!demo) return api.getLoadingQueue();
      const local = receptionLoadingQueue();
      const localIds = new Set(local.map((row) => row.id));
      const seeded = loadDemo()
        .shipments.filter((row) => !localIds.has(row.id))
        .map((row): LoadingQueueRecord => ({
          id: row.id,
          shipment_no: row.shipment_no,
          received_at: row.received_at,
          sender_snapshot: row.sender_snapshot,
          receiver_snapshot: row.receiver_snapshot,
          zone_id: row.zone_id,
          district_id: row.district_id,
          destination_branch_code: row.destination_branch_code,
          total_amount: row.total_amount,
          total_quantity: row.total_quantity,
          shipment_status: row.shipment_status,
          price_pending: row.price_pending,
          items: row.items,
        }));
      return [...local, ...seeded].filter(
        (row) => row.shipment_status === "RECEIVED",
      );
    },
    confirmLoad: async (ids: string[], load: LoadConfirmation) => {
      if (!demo) {
        await Promise.all(ids.map((id) => api.updateStatus(id, "IN_TRANSIT")));
        return;
      }
      const state = loadDemo();
      for (const id of ids) {
        if (updateReceptionBillStatus(id, "IN_TRANSIT", load)) continue;
        const shipment = state.shipments.find((row) => row.id === id);
        if (shipment) shipment.shipment_status = "IN_TRANSIT";
      }
      const manifests = JSON.parse(
        localStorage.getItem("ntdtms-loading-manifests-v1") || "[]",
      );
      manifests.unshift({ ...load, shipmentIds: ids });
      localStorage.setItem(
        "ntdtms-loading-manifests-v1",
        JSON.stringify(manifests),
      );
      saveDemo(state);
    },
    setting: async (kind: string, data: Record<string, unknown>) => {
      if (!demo) return api.setting(kind, data);
      const state = loadDemo();
      if (kind === "zone_save") {
        const id = String(data.id);
        const districts = Array.isArray(data.districts)
          ? data.districts.map((district) => ({
              id: String((district as { id: unknown }).id),
              name: String((district as { name: unknown }).name),
              zone_id: id,
            }))
          : [];
        const value = {
          id,
          name: String(data.name),
          code: String(data.code),
          color: String(data.color),
          sort_order: Number(data.sort_order),
          districts,
        };
        const index = state.zones.findIndex((zone) => zone.id === id);
        if (index >= 0) state.zones[index] = value;
        else state.zones.push(value);
      }
      if (kind === "zone_delete")
        state.zones = state.zones.filter((zone) => zone.id !== data.id);
      if (kind === "branch_save") {
        const id = String(data.id);
        const previous = state.branches.find((branch) => branch.id === id);
        if (
          previous?.document_code_locked_at &&
          previous.document_code !== String(data.document_code)
        )
          throw new Error("รหัสออกบิลถูกใช้งานแล้ว จึงเปลี่ยนไม่ได้");
        if (
          state.branches.some(
            (branch) =>
              branch.id !== id &&
              branch.document_code.toUpperCase() ===
                String(data.document_code).toUpperCase(),
          )
        )
          throw new Error("รหัสออกบิลนี้ถูกใช้โดยสาขาอื่นแล้ว");
        const value = {
          id,
          code: String(data.code).toUpperCase(),
          document_code: String(data.document_code).toUpperCase(),
          name: String(data.name),
          branch_kind:
            data.branch_kind as (typeof state.branches)[number]["branch_kind"],
          province_name: String(data.province_name),
          can_issue_bills: Boolean(data.can_issue_bills),
          is_active: Boolean(data.is_active),
          document_code_locked_at: previous?.document_code_locked_at || null,
        };
        const index = state.branches.findIndex((branch) => branch.id === id);
        if (index >= 0) state.branches[index] = value;
        else state.branches.push(value);
      }
      if (kind === "branch_delete") {
        const branch = state.branches.find((row) => row.id === data.id);
        if (branch) {
          branch.is_active = false;
          branch.can_issue_bills = false;
        }
      }
      if (kind === "branch_lock") {
        const branch = state.branches.find((row) => row.id === data.id);
        if (branch && !branch.document_code_locked_at)
          branch.document_code_locked_at = new Date().toISOString();
      }
      if (kind === "zone") {
        const z = state.zones.find((z) => z.id === data.id)!;
        z.name = String(data.name);
        z.color = String(data.color);
      }
      if (kind === "district") {
        const d = state.zones
          .flatMap((z) => z.districts)
          .find((d) => d.id === data.id)!;
        d.name = String(data.name);
      }
      if (kind === "price")
        state.rules.unshift({
          id: crypto.randomUUID(),
          product_id: String(data.product_id),
          zone_id: data.zone_id ? String(data.zone_id) : null,
          unit_price: Number(data.unit_price),
          version_no: state.rules.length + 1,
          created_at: new Date().toISOString(),
        });
      if (kind === "invite") {
        const existing = JSON.parse(
          localStorage.getItem("ntdtms-demo-staff") || "[]",
        );
        const rows = existing.filter(
          (s: StaffInvite) => s.email !== data.email,
        );
        rows.push({
          ...data,
          module_permissions: data.module_permissions || {},
        });
        localStorage.setItem("ntdtms-demo-staff", JSON.stringify(rows));
      }
      saveDemo(state);
    },
    staff: async (): Promise<StaffInvite[]> =>
      demo
        ? [
            {
              email: "ntdlogistics@gmail.com",
              display_name: "ผู้ดูแล NTD",
              role: "owner",
              is_active: true,
              module_permissions: ROLE_MODULE_DEFAULTS.owner,
            },
            ...JSON.parse(localStorage.getItem("ntdtms-demo-staff") || "[]"),
          ]
        : api.getStaff(),
    health: async () =>
      demo
        ? { bytes: 0, tables: 0, checked_at: new Date().toISOString() }
        : api.databaseHealth(),
    systemStatus: async () =>
      demo ? { r2Configured: false } : api.systemStatus(),
  };
}
export type DataService = ReturnType<typeof createService>;
