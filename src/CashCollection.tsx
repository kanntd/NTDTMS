import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDown,
  Banknote,
  CalendarClock,
  CheckCircle2,
  Clock3,
  Eye,
  HandCoins,
  LockKeyhole,
  Pencil,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Search,
  WalletCards,
} from "lucide-react";
import {
  buildCodSummary,
  codCollectionStatus,
  compareBillNumbers,
  dateKey,
  matchingBills,
  type CodCollectionStatus,
} from "./codCollection";
import { billEditAccessMessage, canEditShipment } from "./billEditPolicy";
import { useWorkspace } from "./context";
import DateInput from "./DateInput";
import { loadIntakeRegistry } from "./intakeRegistry";
import { loadOperations } from "./operationsStore";
import { loadRemoteWorkspace } from "./remoteWorkspace";
import { destinationBranches } from "./branchRoutes";
import Receipt from "./Receipt";
import ShipmentEditModal from "./ShipmentEditModal";
import type { DataService } from "./service";
import type { CodPaymentRecord, Shipment, ShipmentDetail } from "./types";
import { localDate, money, number, thaiDate } from "./domain";
import { Button, Empty, IconButton, Loading, Pagination } from "./ui";

const PAGE_SIZE = 30;
const LOAD_PAGE_SIZE = 500;

const statusLabels: Record<CodCollectionStatus, string> = {
  PENDING: "รอเก็บเงิน",
  PARTIAL: "เก็บบางส่วน",
  COLLECTED: "เก็บครบแล้ว",
};

function receiverKey(row: Shipment) {
  return (
    row.receiver_party_id ||
    row.receiver_snapshot.id ||
    row.receiver_snapshot.display_name
  );
}

function senderKey(row: Shipment) {
  return (
    row.sender_party_id ||
    row.sender_snapshot.id ||
    row.sender_snapshot.display_name
  );
}

async function loadCodShipments(service: DataService) {
  const rows: Shipment[] = [];
  for (let page = 0; page < 40; page += 1) {
    const result = await service.shipments({
      payment: "CASH_DESTINATION",
      page,
      pageSize: LOAD_PAGE_SIZE,
    });
    rows.push(...result.rows);
    if (result.rows.length < LOAD_PAGE_SIZE || rows.length >= result.count)
      break;
  }
  return rows.filter((row) => row.shipment_status !== "CANCELLED");
}

export default function CashCollection() {
  const w = useWorkspace();
  const invoiceRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const captureRef = useRef<HTMLElement>(null);
  const requestRef = useRef(crypto.randomUUID());
  const loadedOnce = useRef(false);
  const [rows, setRows] = useState<Shipment[]>([]);
  const [payments, setPayments] = useState<CodPaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState("");
  const [invoice, setInvoice] = useState("");
  const [selected, setSelected] = useState<Shipment | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("CASH");
  const [reference, setReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [deliveryFrom, setDeliveryFrom] = useState("");
  const [deliveryTo, setDeliveryTo] = useState("");
  const [receiver, setReceiver] = useState("");
  const [sender, setSender] = useState("");
  const [catalogId, setCatalogId] = useState("");
  const [unit, setUnit] = useState("");
  const [branch, setBranch] = useState("");
  const [district, setDistrict] = useState("");
  const [priceState, setPriceState] = useState<"PENDING" | "PRICED" | "">("");
  const [vehicle, setVehicle] = useState("");
  const [sort, setSort] = useState<"OLDEST" | "NEWEST">("OLDEST");
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<ShipmentDetail | null>(null);
  const [editDetail, setEditDetail] = useState<ShipmentDetail | null>(null);
  const [registry, setRegistry] = useState(loadIntakeRegistry);
  const [operations, setOperations] = useState(loadOperations);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [nextRows, nextPayments] = await Promise.all([
        loadCodShipments(w.service),
        w.service.codPayments(),
      ]);
      setRows(nextRows);
      setPayments(nextPayments);
      setSelected((current) =>
        current ? nextRows.find((row) => row.id === current.id) || null : null,
      );
      setFailure("");
      loadedOnce.current = true;
    } catch (cause) {
      setFailure((cause as Error).message || "โหลดรายการรับเก็บเงินไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [w.service]);

  useEffect(() => {
    void reload();
  }, [reload, w.revision]);

  useEffect(() => {
    if (w.demo) {
      setRegistry(loadIntakeRegistry());
      setOperations(loadOperations());
      return;
    }
    let active = true;
    void loadRemoteWorkspace()
      .then((workspace) => {
        if (!active) return;
        setRegistry(workspace.registry);
        setOperations(workspace.operations);
      })
      .catch((cause) => active && w.toast((cause as Error).message, true));
    return () => {
      active = false;
    };
  }, [w.demo, w.revision]);

  const summary = useMemo(
    () => buildCodSummary(rows, payments),
    [rows, payments],
  );
  const receiverOptions = useMemo(
    () =>
      [
        ...new Map(
          rows.map((row) => [
            receiverKey(row),
            row.receiver_snapshot.display_name,
          ]),
        ),
      ].sort((a, b) => a[1].localeCompare(b[1], "th")),
    [rows],
  );
  const senderOptions = useMemo(
    () =>
      [
        ...new Map(
          rows.map((row) => [senderKey(row), row.sender_snapshot.display_name]),
        ),
      ].sort((a, b) => a[1].localeCompare(b[1], "th")),
    [rows],
  );
  const productOptions = useMemo(
    () =>
      [
        ...new Map(
          rows.flatMap((row) =>
            (row.items || []).map((item) => [
              item.product_id,
              `${item.description} / ${item.unit}`,
            ]),
          ),
        ),
      ].sort((a, b) => a[1].localeCompare(b[1], "th")),
    [rows],
  );
  const unitOptions = useMemo(
    () =>
      [
        ...new Set(
          rows.flatMap((row) => (row.items || []).map((item) => item.unit)),
        ),
      ]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "th")),
    [rows],
  );
  const districtOptions = useMemo(
    () =>
      [
        ...new Map(
          rows
            .map(
              (row) => [row.district_id, row.district_name] as [string, string],
            )
            .filter(([id]) => Boolean(id)),
        ),
      ].sort((a, b) => a[1].localeCompare(b[1], "th")),
    [rows],
  );
  const branchOptions = useMemo(
    () => destinationBranches(w.branches, w.zones),
    [w.branches, w.zones],
  );
  const vehicleOptions = useMemo(
    () =>
      [...new Set(rows.map((row) => row.vehicle_plate_no).filter(Boolean))]
        .map(String)
        .sort((a, b) => a.localeCompare(b, "th", { numeric: true })),
    [rows],
  );
  const collectedToday = useMemo(() => {
    const today = localDate();
    return payments
      .filter((payment) => dateKey(payment.receivedAt) === today)
      .reduce<Record<string, number>>((totals, payment) => {
        totals[payment.shipmentId] =
          (totals[payment.shipmentId] || 0) + payment.amount;
        return totals;
      }, {});
  }, [payments]);
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("th");
    return rows
      .filter((row) => {
        const delivered = dateKey(row.delivered_at);
        return (
          (!deliveryFrom || delivered >= deliveryFrom) &&
          (!deliveryTo || delivered <= deliveryTo)
        );
      })
      .filter(
        (row) =>
          !normalized ||
          [
            row.shipment_no,
            row.receiver_snapshot.display_name,
            row.receiver_snapshot.phone,
            row.sender_snapshot.display_name,
            row.sender_snapshot.phone,
            row.vehicle_plate_no || "",
            ...(row.items || []).flatMap((item) => [
              item.description,
              item.unit,
            ]),
          ]
            .join(" ")
            .toLocaleLowerCase("th")
            .includes(normalized),
      )
      .filter((row) => !receiver || receiverKey(row) === receiver)
      .filter((row) => !sender || senderKey(row) === sender)
      .filter(
        (row) =>
          !catalogId ||
          row.items?.some((item) => item.product_id === catalogId),
      )
      .filter((row) => !unit || row.items?.some((item) => item.unit === unit))
      .filter((row) => !branch || row.destination_branch_code === branch)
      .filter((row) => !district || row.district_id === district)
      .filter(
        (row) =>
          !priceState ||
          (priceState === "PENDING" ? row.price_pending : !row.price_pending),
      )
      .filter((row) => !vehicle || row.vehicle_plate_no === vehicle)
      .sort((a, b) => {
        const order = compareBillNumbers(a.shipment_no, b.shipment_no);
        return sort === "OLDEST" ? order : -order;
      });
  }, [
    branch,
    catalogId,
    deliveryFrom,
    deliveryTo,
    district,
    priceState,
    query,
    receiver,
    rows,
    sender,
    sort,
    unit,
    vehicle,
  ]);
  const paged = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const hasFilters = Boolean(
    query ||
    deliveryFrom ||
    deliveryTo ||
    receiver ||
    sender ||
    catalogId ||
    unit ||
    branch ||
    district ||
    priceState ||
    vehicle ||
    sort !== "OLDEST",
  );

  function chooseBill(row: Shipment) {
    if (row.outstanding_amount <= 0) {
      w.toast(`บิล ${row.shipment_no} เก็บเงินครบแล้ว`, true);
      setInvoice("");
      invoiceRef.current?.focus();
      return;
    }
    setSelected(row);
    setInvoice(row.shipment_no);
    setAmount(row.outstanding_amount.toFixed(2));
    setMethod("CASH");
    setReference("");
    requestRef.current = crypto.randomUUID();
    window.setTimeout(() => {
      amountRef.current?.focus();
      amountRef.current?.select();
    });
  }

  function findBill() {
    const matches = matchingBills(rows, invoice);
    if (!matches.length) {
      w.toast(`ไม่พบบิล ${invoice.trim() || "ที่ระบุ"} ในรายการ COD`, true);
      invoiceRef.current?.select();
      return;
    }
    if (matches.length > 1) {
      w.toast("พบเลขท้ายบิลซ้ำ กรุณาพิมพ์หรือสแกนเลขบิลเต็ม", true);
      invoiceRef.current?.select();
      return;
    }
    chooseBill(matches[0]);
  }

  function clearSelection() {
    setSelected(null);
    setInvoice("");
    setAmount("");
    setReference("");
    requestRef.current = crypto.randomUUID();
    window.setTimeout(() => invoiceRef.current?.focus());
  }

  async function saveCollection() {
    if (!selected || saving) return;
    const value = Number(amount);
    if (
      !Number.isFinite(value) ||
      value <= 0 ||
      value > selected.outstanding_amount
    ) {
      w.toast(
        `ยอดรับเงินจริงต้องมากกว่า 0 และไม่เกิน ${money(selected.outstanding_amount)} บาท`,
        true,
      );
      amountRef.current?.focus();
      amountRef.current?.select();
      return;
    }
    setSaving(true);
    try {
      await w.service.collect(
        selected.id,
        value,
        method,
        reference.trim(),
        requestRef.current,
      );
      const remaining = Math.max(0, selected.outstanding_amount - value);
      w.toast(
        remaining > 0
          ? `รับเงินบิล ${selected.shipment_no} แล้ว เหลือ ${money(remaining)} บาท`
          : `รับเงินบิล ${selected.shipment_no} ครบแล้ว`,
      );
      clearSelection();
      w.refresh();
    } catch (cause) {
      w.toast((cause as Error).message || "บันทึกรับเงินไม่สำเร็จ", true);
      amountRef.current?.focus();
      amountRef.current?.select();
    } finally {
      setSaving(false);
    }
  }

  async function open(row: Shipment, edit = false) {
    if (edit && !canEditShipment(w.profile.role, row.shipment_status)) {
      w.toast(billEditAccessMessage(w.profile.role, row.shipment_status), true);
      return;
    }
    try {
      const value = await w.service.detail(row.id);
      if (edit) setEditDetail(value);
      else setDetail(value);
    } catch (cause) {
      w.toast((cause as Error).message, true);
    }
  }

  function clearFilters() {
    setQuery("");
    setDeliveryFrom("");
    setDeliveryTo("");
    setReceiver("");
    setSender("");
    setCatalogId("");
    setUnit("");
    setBranch("");
    setDistrict("");
    setPriceState("");
    setVehicle("");
    setSort("OLDEST");
    setPage(0);
  }

  return (
    <div className="cod-workspace">
      <div className="page-heading">
        <div>
          <div className="breadcrumb">
            การเงิน <span>/</span> เงินสดปลายทาง
          </div>
          <h1>
            รับเก็บเงิน COD
            <span className="heading-dot" />
          </h1>
          <p>ตรวจยอด รับเงินจริง และติดตามบิลค้างเก็บปลายทาง</p>
        </div>
        <Button onClick={() => void reload()} disabled={loading}>
          <RefreshCw className={loading ? "spin" : ""} size={17} />
          อัปเดตข้อมูล
        </Button>
      </div>

      <section className="cod-summary" aria-label="สรุปยอดรับเก็บเงิน COD">
        <article className="all">
          <WalletCards size={22} />
          <div>
            <span>บิลค้างเก็บทั้งหมด</span>
            <strong>{number(summary.outstanding.count)} บิล</strong>
            <b>฿ {money(summary.outstanding.amount)}</b>
          </div>
        </article>
        <article className="overdue">
          <Clock3 size={22} />
          <div>
            <span>บิลค้างเก็บที่ค้าง</span>
            <strong>{number(summary.overdue.count)} บิล</strong>
            <b>฿ {money(summary.overdue.amount)}</b>
          </div>
        </article>
        <article className="today">
          <CalendarClock size={22} />
          <div>
            <span>บิลค้างเก็บวันนี้</span>
            <strong>{number(summary.todayOutstanding.count)} บิล</strong>
            <b>฿ {money(summary.todayOutstanding.amount)}</b>
          </div>
        </article>
        <article className="collected">
          <CheckCircle2 size={22} />
          <div>
            <span>บิลที่เก็บวันนี้</span>
            <strong>{number(summary.todayCollected.count)} บิล</strong>
            <b>฿ {money(summary.todayCollected.amount)}</b>
          </div>
        </article>
      </section>

      <section className="cod-capture-panel" ref={captureRef}>
        <header>
          <ScanLine size={22} />
          <div>
            <h2>รับเงินด้วยเลขที่บิล</h2>
            <p>รองรับการพิมพ์เลขเต็ม เลขท้ายบิล และเครื่องสแกน</p>
          </div>
        </header>
        <div className="cod-capture-grid">
          <form
            className="cod-scan-form"
            onSubmit={(event) => {
              event.preventDefault();
              findBill();
            }}
          >
            <label htmlFor="cod-invoice">เลขที่บิล</label>
            <div>
              <input
                id="cod-invoice"
                ref={invoiceRef}
                autoFocus
                autoComplete="off"
                placeholder="พิมพ์หรือสแกนเลขที่บิล"
                value={invoice}
                onChange={(event) => {
                  setInvoice(event.target.value);
                  if (selected) setSelected(null);
                }}
              />
              <Button
                className="primary"
                type="submit"
                disabled={!invoice.trim()}
              >
                <ScanLine size={17} />
                เลือกบิล
              </Button>
            </div>
            <small>กด Enter เพื่อไปที่ช่องยอดรับเงินจริง</small>
          </form>

          {selected ? (
            <form
              className="cod-payment-form"
              onSubmit={(event) => {
                event.preventDefault();
                void saveCollection();
              }}
            >
              <div className="cod-selected-heading">
                <div>
                  <span>{selected.shipment_no}</span>
                  <strong>{selected.receiver_snapshot.display_name}</strong>
                </div>
                <button type="button" onClick={clearSelection}>
                  เปลี่ยนบิล
                </button>
              </div>
              <div className="cod-selected-totals">
                <span>
                  ยอดบิล <b>{money(selected.total_amount)}</b>
                </span>
                <span>
                  รับแล้ว <b>{money(selected.paid_amount)}</b>
                </span>
                <span>
                  ค้างเก็บ <strong>{money(selected.outstanding_amount)}</strong>
                </span>
              </div>
              <div className="cod-payment-fields">
                <label className="cod-amount-field">
                  <span>ยอดรับเงินจริง (บาท)</span>
                  <div>
                    <b>฿</b>
                    <input
                      ref={amountRef}
                      aria-label="ยอดรับเงินจริง"
                      type="number"
                      inputMode="decimal"
                      min="0.01"
                      max={selected.outstanding_amount}
                      step="0.01"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      required
                    />
                  </div>
                </label>
                <label>
                  <span>วิธีรับเงิน</span>
                  <select
                    value={method}
                    onChange={(event) => setMethod(event.target.value)}
                  >
                    <option value="CASH">เงินสด</option>
                    <option value="TRANSFER">โอนธนาคาร</option>
                    <option value="QR">QR Payment</option>
                  </select>
                </label>
                <label>
                  <span>เลขอ้างอิง</span>
                  <input
                    placeholder="ไม่บังคับ"
                    value={reference}
                    onChange={(event) => setReference(event.target.value)}
                  />
                </label>
                <Button className="primary" type="submit" busy={saving}>
                  <HandCoins size={18} />
                  บันทึกรับเงิน
                </Button>
              </div>
            </form>
          ) : (
            <div className="cod-ready">
              <Banknote size={26} />
              <strong>พร้อมรับบิลถัดไป</strong>
              <span>ยอดบิลและช่องรับเงินจริงจะแสดงเมื่อพบเลขบิล</span>
            </div>
          )}
        </div>
      </section>

      <section className="cod-register">
        <div className="shipment-search-panel cod-search-panel">
          <div className="shipment-search-topline">
            <label className="shipment-keyword">
              <Search size={17} />
              <input
                aria-label="ค้นหาบิล COD"
                placeholder="ค้นหาเลขบิล ผู้รับ ผู้ส่ง เบอร์โทร สินค้า หรือทะเบียนรถ"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setPage(0);
                }}
              />
            </label>
            <div className="shipment-search-summary">
              <strong>พบ {number(visible.length)} บิล</strong>
              <Button disabled={!hasFilters} onClick={clearFilters}>
                <RotateCcw size={16} />
                ล้างตัวกรอง
              </Button>
            </div>
          </div>
          <div className="shipment-filter-grid cod-filter-grid">
            <label className="shipment-filter-control">
              <span>ส่งของตั้งแต่วันที่</span>
              <DateInput
                max={deliveryTo || undefined}
                value={deliveryFrom}
                onChange={(value) => {
                  setDeliveryFrom(value);
                  setPage(0);
                }}
              />
            </label>
            <label className="shipment-filter-control">
              <span>ถึงวันที่</span>
              <DateInput
                min={deliveryFrom || undefined}
                value={deliveryTo}
                onChange={(value) => {
                  setDeliveryTo(value);
                  setPage(0);
                }}
              />
            </label>
            <label className="shipment-filter-control">
              <span>ผู้รับ</span>
              <select
                value={receiver}
                onChange={(event) => {
                  setReceiver(event.target.value);
                  setPage(0);
                }}
              >
                <option value="">ผู้รับทั้งหมด</option>
                {receiverOptions.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="shipment-filter-control">
              <span>ผู้ส่ง</span>
              <select
                value={sender}
                onChange={(event) => {
                  setSender(event.target.value);
                  setPage(0);
                }}
              >
                <option value="">ผู้ส่งทั้งหมด</option>
                {senderOptions.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="shipment-filter-control">
              <span>สินค้า / หน่วย</span>
              <select
                value={catalogId}
                onChange={(event) => {
                  setCatalogId(event.target.value);
                  setPage(0);
                }}
              >
                <option value="">สินค้าทั้งหมด</option>
                {productOptions.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="shipment-filter-control">
              <span>หน่วยนับ</span>
              <select
                value={unit}
                onChange={(event) => {
                  setUnit(event.target.value);
                  setPage(0);
                }}
              >
                <option value="">ทุกหน่วย</option>
                {unitOptions.map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label className="shipment-filter-control">
              <span>สาขาปลายทาง</span>
              <select
                value={branch}
                onChange={(event) => {
                  setBranch(event.target.value);
                  setPage(0);
                }}
              >
                <option value="">ทุกสาขา</option>
                {branchOptions.map((row) => (
                  <option key={row.code} value={row.code}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="shipment-filter-control">
              <span>อำเภอ</span>
              <select
                value={district}
                onChange={(event) => {
                  setDistrict(event.target.value);
                  setPage(0);
                }}
              >
                <option value="">ทุกอำเภอ</option>
                {districtOptions.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="shipment-filter-control">
              <span>สถานะราคา</span>
              <select
                value={priceState}
                onChange={(event) => {
                  setPriceState(event.target.value as typeof priceState);
                  setPage(0);
                }}
              >
                <option value="">ทุกสถานะราคา</option>
                <option value="PENDING">รอราคา</option>
                <option value="PRICED">มีราคาแล้ว</option>
              </select>
            </label>
            <label className="shipment-filter-control">
              <span>ทะเบียนรถต้นทาง (กรุงเทพฯ)</span>
              <select
                value={vehicle}
                onChange={(event) => {
                  setVehicle(event.target.value);
                  setPage(0);
                }}
              >
                <option value="">รถทุกคัน</option>
                {vehicleOptions.map((plate) => (
                  <option key={plate}>{plate}</option>
                ))}
              </select>
            </label>
            <label className="shipment-filter-control">
              <span>เรียงตามเลขที่บิล</span>
              <div className="cod-sort-select">
                <ArrowUpDown size={16} />
                <select
                  value={sort}
                  onChange={(event) => {
                    setSort(event.target.value as typeof sort);
                    setPage(0);
                  }}
                >
                  <option value="OLDEST">เก่าไปใหม่</option>
                  <option value="NEWEST">ใหม่ไปเก่า</option>
                </select>
              </div>
            </label>
          </div>
          <p className="shipment-filter-note">
            ค้นหาจากบิล COD ทั้งหมดและใช้ตัวกรองหลายช่องร่วมกันได้
          </p>
        </div>
        <div className="cod-result-summary">
          <span>พบ {number(visible.length)} บิล</span>
          <span>
            ค้างเก็บ ฿{" "}
            {money(
              visible.reduce((sum, row) => sum + row.outstanding_amount, 0),
            )}
          </span>
        </div>

        {failure ? (
          <div className="alert error" role="alert">
            {failure}
            <Button onClick={() => void reload()}>ลองใหม่</Button>
          </div>
        ) : loading && !loadedOnce.current ? (
          <Loading />
        ) : paged.length === 0 ? (
          <Empty title="ไม่พบบิล COD ตามตัวกรองนี้" />
        ) : (
          <div className="data-table-scroll">
            <table className="data-table cod-table">
              <thead>
                <tr>
                  <th>เลขที่บิล / วันที่เปิด</th>
                  <th>วันที่ส่งของ</th>
                  <th>ผู้รับสินค้า</th>
                  <th>ทะเบียนรถต้นทาง</th>
                  <th className="numeric">ยอดบิล</th>
                  <th className="numeric">รับแล้ว</th>
                  <th className="numeric">ค้างเก็บ</th>
                  <th>สถานะ</th>
                  <th>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {paged.map((row) => {
                  const paymentStatus = codCollectionStatus(row);
                  return (
                    <tr key={row.id}>
                      <td>
                        <button
                          className="document-link"
                          onClick={() => void open(row)}
                        >
                          {row.shipment_no}
                        </button>
                        <small>{thaiDate(row.received_at)}</small>
                      </td>
                      <td>
                        {row.delivered_at ? (
                          thaiDate(row.delivered_at)
                        ) : (
                          <span className="muted">ยังไม่ส่งสำเร็จ</span>
                        )}
                      </td>
                      <td>
                        <strong>{row.receiver_snapshot.display_name}</strong>
                        <small>
                          {row.receiver_snapshot.phone || "ไม่มีเบอร์โทร"}
                        </small>
                      </td>
                      <td>
                        {row.vehicle_plate_no || (
                          <span className="muted">ยังไม่ระบุ</span>
                        )}
                      </td>
                      <td className="numeric">{money(row.total_amount)}</td>
                      <td className="numeric">
                        {money(row.paid_amount)}
                        {collectedToday[row.id] > 0 && (
                          <small>วันนี้ +{money(collectedToday[row.id])}</small>
                        )}
                      </td>
                      <td className="numeric">
                        <strong>{money(row.outstanding_amount)}</strong>
                      </td>
                      <td>
                        <span
                          className={`cod-status ${paymentStatus.toLowerCase()}`}
                        >
                          <i />
                          {statusLabels[paymentStatus]}
                        </span>
                      </td>
                      <td>
                        <div className="cod-row-actions">
                          {row.outstanding_amount > 0 && (
                            <IconButton
                              label={`รับเงินบิล ${row.shipment_no}`}
                              onClick={() => {
                                chooseBill(row);
                                captureRef.current?.scrollIntoView({
                                  behavior: "smooth",
                                  block: "start",
                                });
                              }}
                            >
                              <Banknote size={17} />
                            </IconButton>
                          )}
                          <IconButton
                            label={`ดูรายละเอียดบิล ${row.shipment_no}`}
                            onClick={() => void open(row)}
                          >
                            <Eye size={17} />
                          </IconButton>
                          <IconButton
                            label={`${billEditAccessMessage(w.profile.role, row.shipment_status)}: ${row.shipment_no}`}
                            disabled={
                              !canEditShipment(
                                w.profile.role,
                                row.shipment_status,
                              )
                            }
                            onClick={() => void open(row, true)}
                          >
                            {canEditShipment(
                              w.profile.role,
                              row.shipment_status,
                            ) ? (
                              <Pencil size={16} />
                            ) : (
                              <LockKeyhole size={16} />
                            )}
                          </IconButton>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          count={visible.length}
          page={page}
          pageSize={PAGE_SIZE}
          onChange={setPage}
        />
      </section>

      {detail && <Receipt shipment={detail} onClose={() => setDetail(null)} />}
      {editDetail && (
        <ShipmentEditModal
          shipment={editDetail}
          registry={registry}
          operations={operations}
          onClose={() => setEditDetail(null)}
          onSaved={() => {
            setEditDetail(null);
            setSelected(null);
          }}
        />
      )}
    </div>
  );
}
