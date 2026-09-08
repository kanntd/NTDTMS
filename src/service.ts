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

export function createService(demo: boolean) {
  return {
    masters: async () =>
      demo
        ? {
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
      const all = loadDemo()
        .shipments.filter(
          (s) =>
            (!o.date || localDate(new Date(s.received_at)) === o.date) &&
            (!o.zone || s.zone_id === o.zone) &&
            (!o.status || s.shipment_status === o.status) &&
            (!o.unpaid || s.outstanding_amount > 0) &&
            (!o.search ||
              (
                s.shipment_no +
                s.sender_snapshot.display_name +
                s.receiver_snapshot.display_name
              )
                .toLowerCase()
                .includes(o.search.toLowerCase())),
        )
        .sort((a, b) => +new Date(b.received_at) - +new Date(a.received_at));
      return {
        rows: all.slice(
          (o.page || 0) * 50,
          (o.page || 0) * 50 + 50,
        ) as Shipment[],
        count: all.length,
      };
    },
    detail: async (id: string) => {
      if (!demo) return api.getShipment(id);
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
      const rows = loadDemo().shipments.filter(
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
    setting: async (kind: string, data: Record<string, unknown>) => {
      if (!demo) return api.setting(kind, data);
      const state = loadDemo();
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
        rows.push(data);
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
