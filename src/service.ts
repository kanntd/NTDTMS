import * as api from "./api";
import { createDemoShipment, demoProducts, loadDemo, saveDemo } from "./demo";
import { localDate } from "./domain";
import { BRANCH_OPTIONS } from "./intakeData";
import { loadOperations } from "./operationsStore";
import type {
  DashboardStats,
  Party,
  Shipment,
  ShipmentInput,
  ShipmentEditInput,
  StaffInvite,
} from "./types";
import { ROLE_MODULE_DEFAULTS } from "./types";
import type {
  LoadConfirmation,
  LoadingQueueRecord,
  LoadTripRecord,
  LoadTripStatus,
  LoadTripUpdate,
  LoadTripCommand,
  LoadTripItemChange,
} from "./types";
import { applyRecordedLoads } from "./loadingQueue";
import {
  editStoredReceptionBill,
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

const DEMO_LOADS_KEY = "ntdtms-loading-manifests-v2";

type DemoLoad = LoadConfirmation & {
  id: string;
  status: LoadTripStatus;
  note: string;
  loadedAt?: string;
  updatedAt: string;
};

function readDemoLoads(): DemoLoad[] {
  try {
    const value = JSON.parse(localStorage.getItem(DEMO_LOADS_KEY) || "[]") as
      Partial<DemoLoad>[] | null;
    if (!Array.isArray(value)) return [];
    return value.map((row) => ({
      ...(row as LoadConfirmation),
      id: row.id || crypto.randomUUID(),
      status: row.status || "DEPARTED",
      note: row.note || "",
      updatedAt: row.updatedAt || row.confirmedAt || new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

function saveDemoLoads(loads: DemoLoad[]) {
  localStorage.setItem(DEMO_LOADS_KEY, JSON.stringify(loads));
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
    updateBill: async (
      doc: string,
      input: ShipmentEditInput,
      reason: string,
    ) => {
      if (!demo) return api.updateReceptionBill(doc, input, reason);
      if (editStoredReceptionBill(doc, input)) {
        const bill = readReceptionBills().find((row) => row.id === doc);
        if (!bill) throw new Error("ไม่พบบิล");
        return receptionBillToShipment(bill);
      }
      const state = loadDemo();
      const shipment = state.shipments.find((row) => row.id === doc);
      if (!shipment) throw new Error("ไม่พบบิล");
      const subtotal = input.items.reduce(
        (sum, item) => sum + item.quantity * (item.price || 0),
        0,
      );
      const total = Math.max(0, subtotal - input.discount);
      const due = Math.max(0, total - input.withholding_amount);
      if (due < shipment.paid_amount)
        throw new Error("ยอดใหม่ต่ำกว่าเงินที่รับแล้ว");
      const branch = BRANCH_OPTIONS.find(
        (option) => option.code === input.destination_branch_code,
      );
      Object.assign(shipment, {
        sender_party_id: input.sender_id,
        receiver_party_id: input.receiver_id,
        sender_snapshot: input.sender,
        receiver_snapshot: input.receiver,
        payer_party_id: input.payment_mode.endsWith("ORIGIN")
          ? input.sender_id
          : input.receiver_id,
        destination_branch_code: input.destination_branch_code,
        zone_id: branch?.zoneId || shipment.zone_id,
        district_id: branch?.districtId || shipment.district_id,
        zone_name: branch?.name || shipment.zone_name,
        zone_color: branch?.color || shipment.zone_color,
        payment_mode: input.payment_mode,
        credit_days: input.payment_mode.startsWith("CREDIT")
          ? input.credit_days
          : 0,
        total_quantity: input.items.reduce(
          (sum, item) => sum + item.quantity,
          0,
        ),
        total_weight: input.items.reduce(
          (sum, item) => sum + (Number(item.weight) || 0),
          0,
        ),
        total_amount: total,
        withholding_amount: input.withholding_amount,
        outstanding_amount: due - shipment.paid_amount,
        discount: input.discount,
        price_reason: input.discount_reason,
        price_pending: input.items.some((item) => item.request_price),
        note: input.note,
        version_no: (shipment.version_no || 1) + 1,
        items: input.items.map((item) => ({
          id: item.id,
          product_id: item.catalog_id,
          product_unit_id: item.catalog_id,
          description: item.name,
          quantity: item.quantity,
          unit: item.unit,
          unit_price: item.price || 0,
          weight: Number(item.weight) || 0,
          fragile: false,
          price_pending: item.request_price,
          width: Number(item.width) || null,
          length: Number(item.length) || null,
          height: Number(item.height) || null,
        })),
      });
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
          payment_mode: row.payment_mode,
          total_amount: row.total_amount,
          total_quantity: row.total_quantity,
          total_weight: row.total_weight,
          shipment_status: row.shipment_status,
          price_pending: row.price_pending,
          items: row.items,
        }));
      return applyRecordedLoads(
        [...local, ...seeded],
        readDemoLoads()
          .filter((load) => load.status !== "CANCELLED")
          .flatMap((load) => load.allocations || []),
      );
    },
    confirmLoad: async (load: LoadConfirmation) => {
      if (!demo) {
        await api.confirmLoad(load);
        return;
      }
      const previous = readDemoLoads();
      const loadedByItem = new Map<string, number>();
      for (const allocation of previous
        .filter((manifest) => manifest.status !== "CANCELLED")
        .flatMap((manifest) => manifest.allocations || []))
        loadedByItem.set(
          allocation.itemId,
          (loadedByItem.get(allocation.itemId) || 0) + allocation.quantity,
        );
      const sourceRows = [
        ...receptionLoadingQueue(),
        ...loadDemo().shipments.map((row): LoadingQueueRecord => ({
          id: row.id,
          shipment_no: row.shipment_no,
          received_at: row.received_at,
          sender_snapshot: row.sender_snapshot,
          receiver_snapshot: row.receiver_snapshot,
          zone_id: row.zone_id,
          district_id: row.district_id,
          destination_branch_code: row.destination_branch_code,
          payment_mode: row.payment_mode,
          total_amount: row.total_amount,
          total_quantity: row.total_quantity,
          total_weight: row.total_weight,
          shipment_status: row.shipment_status,
          price_pending: row.price_pending,
          items: row.items,
        })),
      ];
      for (const allocation of load.allocations) {
        const item = sourceRows
          .find((row) => row.id === allocation.shipmentId)
          ?.items.find((row) => row.id === allocation.itemId);
        const remaining = item
          ? item.quantity - (loadedByItem.get(item.id) || 0)
          : 0;
        if (
          !item ||
          allocation.quantity <= 0 ||
          allocation.quantity > remaining
        )
          throw new Error("จำนวนที่ขึ้นรถมากกว่าจำนวนคงเหลือ");
      }
      const state = loadDemo();
      for (const id of new Set(load.allocations.map((row) => row.shipmentId))) {
        if (updateReceptionBillStatus(id, "IN_TRANSIT", load)) continue;
        const shipment = state.shipments.find((row) => row.id === id);
        if (shipment) shipment.shipment_status = "IN_TRANSIT";
      }
      previous.unshift({
        ...load,
        id: crypto.randomUUID(),
        status: "DEPARTED",
        note: "",
        updatedAt: load.confirmedAt,
      });
      saveDemoLoads(previous);
      saveDemo(state);
    },
    createLoadTrip: async (
      manifestNo: string,
      destinationBranchCode: string,
      vehicleId: string,
    ) => {
      if (!demo)
        return api.createLoadTrip(manifestNo, destinationBranchCode, vehicleId);
      if (readDemoLoads().some((row) => row.manifestNo === manifestNo))
        throw new Error("เลขเที่ยวรถซ้ำ");
      const operations = loadOperations();
      const vehicle = operations.vehicles.find(
        (row) => row.id === vehicleId && row.active,
      );
      if (!vehicle) throw new Error("ไม่พบทะเบียนรถหรือรถหยุดใช้งานแล้ว");
      const assignment = operations.driverAssignments.find(
        (row) => row.vehicleId === vehicleId && row.endsAt === null,
      );
      const driver = operations.employees.find(
        (row) => row.id === assignment?.employeeId && row.active,
      );
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      saveDemoLoads([
        {
          id,
          manifestNo,
          destinationBranchCode,
          vehicleId: vehicle.id,
          vehicleNo: vehicle.plateNo,
          driverId: driver?.id || "",
          driverName: driver?.name || "",
          confirmedAt: now,
          allocations: [],
          status: "DRAFT",
          note: "",
          updatedAt: now,
        },
        ...readDemoLoads(),
      ]);
      return id;
    },
    saveLoadTripItems: async (
      id: string,
      mode: "ADD" | "SET",
      changes: LoadTripItemChange[],
    ) => {
      if (!demo) return api.saveLoadTripItems(id, mode, changes);
      const loads = readDemoLoads();
      const trip = loads.find((row) => row.id === id);
      if (!trip || trip.status !== "DRAFT")
        throw new Error("เที่ยวรถนี้แก้สินค้าไม่ได้");
      const shipments = allDemoShipments();
      for (const change of changes) {
        const shipment = shipments.find((row) => row.id === change.shipmentId);
        const item = shipment?.items.find((row) => row.id === change.itemId);
        if (
          !shipment ||
          !item ||
          shipment.destination_branch_code !== trip.destinationBranchCode
        )
          throw new Error("บิลนี้ไปคนละสาขากับเที่ยวรถ");
        if (!["RECEIVED", "IN_TRANSIT"].includes(shipment.shipment_status))
          throw new Error("บิลนี้ไม่อยู่ในสถานะที่จัดขึ้นรถได้");
        const existing = trip.allocations.find((row) => row.itemId === item.id);
        const elsewhere = loads
          .filter((row) => row.id !== id && row.status !== "CANCELLED")
          .flatMap((row) => row.allocations)
          .filter((row) => row.itemId === item.id)
          .reduce((sum, row) => sum + row.quantity, 0);
        const next =
          mode === "ADD"
            ? (existing?.quantity || 0) + change.quantity
            : change.quantity;
        if (
          !Number.isFinite(next) ||
          next < 0 ||
          next > item.quantity - elsewhere
        )
          throw new Error("จำนวนขึ้นรถมากกว่าจำนวนคงเหลือ");
        if (existing) {
          if (next === 0)
            trip.allocations = trip.allocations.filter(
              (row) => row !== existing,
            );
          else existing.quantity = next;
        } else if (next > 0)
          trip.allocations.push({ ...change, quantity: next });
      }
      trip.updatedAt = new Date().toISOString();
      saveDemoLoads(loads);
    },
    setLoadTripStatus: async (
      id: string,
      action: LoadTripCommand,
      options: {
        vehicleId?: string;
        driverId?: string;
        note?: string;
        reason?: string;
      } = {},
    ) => {
      if (!demo) return api.setLoadTripStatus(id, action, options);
      const loads = readDemoLoads();
      const trip = loads.find((row) => row.id === id);
      if (!trip) throw new Error("ไม่พบเที่ยวรถ");
      if (action === "CLOSE") {
        if (trip.status !== "DRAFT" || !trip.allocations.length)
          throw new Error("กรุณาบันทึกสินค้าในเที่ยวก่อนปิดรถ");
        const vehicle = loadOperations().vehicles.find(
          (row) => row.id === options.vehicleId && row.active,
        );
        const driver = vehicle
          ? loadOperations().driverAssignments.find(
              (row) =>
                row.vehicleId === vehicle.id &&
                row.employeeId === options.driverId &&
                row.endsAt === null,
            )
          : undefined;
        if (!vehicle || !driver) throw new Error("กรุณาเลือกทะเบียนรถและคนขับ");
        trip.vehicleId = vehicle.id;
        trip.vehicleNo = vehicle.plateNo;
        trip.driverId = driver.employeeId;
        trip.note = options.note || "";
        trip.status = "LOADED";
        trip.loadedAt = new Date().toISOString();
      } else if (action === "DEPART") {
        if (trip.status !== "LOADED")
          throw new Error("กรุณาปิดรถก่อนยืนยันรถออก");
        trip.status = "DEPARTED";
        trip.confirmedAt = new Date().toISOString();
        const state = loadDemo();
        for (const shipmentId of new Set(
          trip.allocations.map((line) => line.shipmentId),
        )) {
          if (updateReceptionBillStatus(shipmentId, "IN_TRANSIT", trip))
            continue;
          const shipment = state.shipments.find((row) => row.id === shipmentId);
          if (shipment) shipment.shipment_status = "IN_TRANSIT";
        }
        saveDemo(state);
      } else if (action === "REOPEN") {
        if (
          trip.status !== "LOADED" ||
          (options.reason || "").trim().length < 3
        )
          throw new Error("กรุณาระบุเหตุผลเปิดรถกลับ");
        trip.status = "DRAFT";
        trip.loadedAt = "";
      } else if (action === "CANCEL") {
        if (!(["DRAFT", "LOADED"] as LoadTripStatus[]).includes(trip.status))
          throw new Error("ยกเลิกได้เฉพาะเที่ยวที่รถยังไม่ออก");
        trip.status = "CANCELLED";
      }
      trip.updatedAt = new Date().toISOString();
      saveDemoLoads(loads);
    },
    loadTrips: async (): Promise<LoadTripRecord[]> => {
      if (!demo) return api.getLoadTrips();
      const sourceRows = [
        ...receptionLoadingQueue(),
        ...loadDemo().shipments.map((row): LoadingQueueRecord => ({
          id: row.id,
          shipment_no: row.shipment_no,
          received_at: row.received_at,
          sender_snapshot: row.sender_snapshot,
          receiver_snapshot: row.receiver_snapshot,
          zone_id: row.zone_id,
          district_id: row.district_id,
          destination_branch_code: row.destination_branch_code,
          payment_mode: row.payment_mode,
          total_amount: row.total_amount,
          total_quantity: row.total_quantity,
          total_weight: row.total_weight,
          shipment_status: row.shipment_status,
          price_pending: row.price_pending,
          items: row.items,
        })),
      ];
      return readDemoLoads().map((load) => ({
        id: load.id,
        manifestNo: load.manifestNo,
        status: load.status,
        destinationBranchId: "",
        destinationBranchCode: load.destinationBranchCode,
        vehicleId: load.vehicleId,
        vehicleNo: load.vehicleNo,
        driverId: load.driverId,
        driverName: load.driverName,
        loadedAt: load.loadedAt || load.confirmedAt,
        departedAt: load.status === "DEPARTED" ? load.confirmedAt : "",
        note: load.note,
        allocations: load.allocations.flatMap((allocation) => {
          const shipment = sourceRows.find(
            (row) => row.id === allocation.shipmentId,
          );
          const item = shipment?.items.find(
            (row) => row.id === allocation.itemId,
          );
          if (!shipment || !item) return [];
          return [
            {
              id: `${load.id}:${allocation.itemId}`,
              shipmentId: shipment.id,
              shipmentNo: shipment.shipment_no,
              itemId: item.id,
              description: item.description,
              quantity: allocation.quantity,
              originalQuantity: item.quantity,
              unit: item.unit,
              receiverName: shipment.receiver_snapshot.display_name,
              senderName: shipment.sender_snapshot.display_name,
              active: load.status !== "CANCELLED",
            },
          ];
        }),
      }));
    },
    updateLoadTrip: async (update: LoadTripUpdate) => {
      if (!demo) return api.updateLoadTrip(update);
      const loads = readDemoLoads();
      const target = loads.find((row) => row.id === update.id);
      if (!target) throw new Error("ไม่พบเที่ยวรถ");
      if (target.status === "RECEIVED" || target.status === "CANCELLED")
        throw new Error("เที่ยวรถนี้แก้ไขไม่ได้แล้ว");
      const affectedShipmentIds = new Set(
        target.allocations.map((line) => line.shipmentId),
      );
      if (update.action === "CANCEL") target.status = "CANCELLED";
      else {
        const quantities = new Map(
          (update.allocations || []).map((row) => [row.lineId, row.quantity]),
        );
        const sourceRows = [
          ...receptionLoadingQueue(),
          ...loadDemo().shipments.map((row): LoadingQueueRecord => ({
            id: row.id,
            shipment_no: row.shipment_no,
            received_at: row.received_at,
            sender_snapshot: row.sender_snapshot,
            receiver_snapshot: row.receiver_snapshot,
            zone_id: row.zone_id,
            district_id: row.district_id,
            destination_branch_code: row.destination_branch_code,
            payment_mode: row.payment_mode,
            total_amount: row.total_amount,
            total_quantity: row.total_quantity,
            total_weight: row.total_weight,
            shipment_status: row.shipment_status,
            price_pending: row.price_pending,
            items: row.items,
          })),
        ];
        const loadedElsewhere = new Map<string, number>();
        for (const load of loads) {
          if (load.id === target.id || load.status === "CANCELLED") continue;
          for (const allocation of load.allocations) {
            loadedElsewhere.set(
              allocation.itemId,
              (loadedElsewhere.get(allocation.itemId) || 0) +
                allocation.quantity,
            );
          }
        }
        target.allocations = target.allocations.flatMap((allocation) => {
          const lineId = `${target.id}:${allocation.itemId}`;
          const quantity = quantities.get(lineId) ?? allocation.quantity;
          const item = sourceRows
            .find((row) => row.id === allocation.shipmentId)
            ?.items.find((row) => row.id === allocation.itemId);
          const maximum = Math.max(
            0,
            (item?.quantity || allocation.quantity) -
              (loadedElsewhere.get(allocation.itemId) || 0),
          );
          if (!Number.isFinite(quantity) || quantity < 0 || quantity > maximum)
            throw new Error("จำนวนขึ้นรถมากกว่าจำนวนที่ยังจัดขึ้นรถได้");
          return quantity > 0 ? [{ ...allocation, quantity }] : [];
        });
        if (!target.allocations.length)
          throw new Error("ถ้าต้องการนำออกทั้งหมด กรุณายกเลิกทั้งเที่ยวรถ");
        target.vehicleId = update.vehicleId || target.vehicleId;
        target.vehicleNo =
          loadOperations().vehicles.find((row) => row.id === target.vehicleId)
            ?.plateNo || target.vehicleNo;
        target.driverId = update.driverId || target.driverId;
        target.driverName = update.driverName || target.driverName;
        target.note = update.note || "";
      }
      target.updatedAt = new Date().toISOString();
      saveDemoLoads(loads);

      const activeShipmentIds = new Set(
        loads
          .filter((row) => row.status !== "CANCELLED")
          .flatMap((row) => row.allocations.map((line) => line.shipmentId)),
      );
      const allShipmentIds = new Set([
        ...affectedShipmentIds,
        ...loads.flatMap((row) =>
          row.allocations.map((line) => line.shipmentId),
        ),
      ]);
      const state = loadDemo();
      for (const shipmentId of allShipmentIds) {
        const current = allDemoShipments().find((row) => row.id === shipmentId);
        if (
          current?.shipment_status === "DELIVERED" ||
          current?.shipment_status === "CANCELLED"
        )
          continue;
        const status = activeShipmentIds.has(shipmentId)
          ? "IN_TRANSIT"
          : "RECEIVED";
        if (updateReceptionBillStatus(shipmentId, status)) continue;
        const shipment = state.shipments.find((row) => row.id === shipmentId);
        if (shipment) shipment.shipment_status = status;
      }
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
