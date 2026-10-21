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
  dateKey,
  isCodPendingPriceOnly,
  matchesCodDeliveryFilter,
  matchingBills,
  pendingCodBills,
  withRecordedDeliveryDates,
  type CodCollectionStatus,
} from "./codCollection";
import { billEditAccessMessage, canEditShipment } from "./billEditPolicy";
import { compareBillsByOpenedAt } from "./billNumber";
import { useWorkspace } from "./context";
import {
  adjustedCodAmounts,
  codLineTotal,
  isCurrencyAmount,
  knownCodPrices,
  type CodPaymentMethod,
  type CodPaymentMethodOption,
} from "./codPricing";
import DateInput from "./DateInput";
import { loadIntakeRegistry } from "./intakeRegistry";
import { loadOperations } from "./operationsStore";
import { loadRemoteWorkspace } from "./remoteWorkspace";
import {
  compareListSort,
  firstItemName,
  listSortOptions,
  SORT_ALL,
  SORT_ALL_LABEL,
  type ListSort,
} from "./listSort";
import { destinationBranches, isDestinationBranch } from "./branchRoutes";
import Receipt from "./Receipt";
import ShipmentEditModal from "./ShipmentEditModal";
import type { DataService } from "./service";
import type { CodPaymentRecord, Shipment, ShipmentDetail } from "./types";
import { localDate, money, number, thaiDate } from "./domain";
import {
  Button,
  Empty,
  IconButton,
  Loading,
  Pagination,
  SearchableSelect,
} from "./ui";

const PAGE_SIZE = 30;
const LOAD_PAGE_SIZE = 500;

const statusLabels: Record<CodCollectionStatus, string> = {
  PENDING: "รอเก็บเงิน",
  PARTIAL: "เก็บบางส่วน",
  COLLECTED: "เก็บครบแล้ว",
  AWAITING_PRICE: "รอราคา",
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
  const priceRef = useRef<HTMLInputElement>(null);
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
  const [amountTouched, setAmountTouched] = useState(false);
  const [itemPrices, setItemPrices] = useState<Record<string, string>>({});
  const [discount, setDiscount] = useState("0.00");
  const [expectedDiscount, setExpectedDiscount] = useState(0);
  const [method, setMethod] = useState("CASH");
  const [methodOptions, setMethodOptions] = useState<CodPaymentMethodOption[]>(
    [],
  );
  const [addingMethod, setAddingMethod] = useState(false);
  const [newMethodName, setNewMethodName] = useState("");
  const [newMethodCategory, setNewMethodCategory] =
    useState<CodPaymentMethod>("TRANSFER");
  const [savingMethod, setSavingMethod] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [deliveryFrom, setDeliveryFrom] = useState("");
  const [deliveryTo, setDeliveryTo] = useState("");
  const [includeUnsent, setIncludeUnsent] = useState(false);
  const [matchingIds, setMatchingIds] = useState<string[]>([]);
  const [receiver, setReceiver] = useState("");
  const [sender, setSender] = useState("");
  const [catalogId, setCatalogId] = useState("");
  const [unit, setUnit] = useState("");
  const [branch, setBranch] = useState("");
  const [district, setDistrict] = useState("");
  const [priceState, setPriceState] = useState<"PENDING" | "PRICED" | "">("");
  const [vehicle, setVehicle] = useState("");
  const [sort, setSort] = useState<"OLDEST" | "NEWEST" | ListSort>("OLDEST");
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
      const undatedIds = nextRows
        .filter((row) => !row.delivered_at)
        .map((row) => row.id);
      const deliveryLines = undatedIds.length
        ? await w.service.deliveryLines(undatedIds)
        : [];
      const datedRows = withRecordedDeliveryDates(nextRows, deliveryLines);
      setRows(datedRows);
      setPayments(nextPayments);
      setSelected((current) =>
        current
          ? datedRows.find((row) => row.id === current.id) || current
          : null,
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
    let active = true;
    void w.service
      .codPaymentMethods()
      .then((options) => {
        if (active) setMethodOptions(options);
      })
      .catch((cause) => {
        if (active) w.toast((cause as Error).message, true);
      });
    return () => {
      active = false;
    };
  }, [w.service]);

  useEffect(() => {
    if (!selected) return;
    const frame = requestAnimationFrame(() => {
      const target = isCodPendingPriceOnly(selected)
        ? priceRef.current
        : amountRef.current;
      target?.focus();
      target?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [selected?.id]);

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
    () =>
      buildCodSummary(
        rows.filter((row) => matchesCodDeliveryFilter(row, includeUnsent)),
        payments,
      ),
    [rows, payments, includeUnsent],
  );
  const openRows = useMemo(() => pendingCodBills(rows), [rows]);
  const selectedUnavailable = Boolean(
    selected && !openRows.some((row) => row.id === selected.id),
  );
  const receiverOptions = useMemo(
    () =>
      [
        ...new Map(
          openRows
            .filter((row) =>
              isDestinationBranch(
                row.destination_branch_code,
                branch,
                w.branches,
                w.zones,
              ),
            )
            .map((row) => [
              receiverKey(row),
              row.receiver_snapshot.display_name,
            ]),
        ),
      ].sort((a, b) => a[1].localeCompare(b[1], "th")),
    [branch, openRows, w.branches, w.zones],
  );
  useEffect(() => {
    if (receiver && !receiverOptions.some(([id]) => id === receiver)) {
      setReceiver("");
      setPage(0);
    }
  }, [receiver, receiverOptions]);
  const senderOptions = useMemo(
    () =>
      [
        ...new Map(
          openRows.map((row) => [
            senderKey(row),
            row.sender_snapshot.display_name,
          ]),
        ),
      ].sort((a, b) => a[1].localeCompare(b[1], "th")),
    [openRows],
  );
  const productOptions = useMemo(
    () =>
      [
        ...new Map(
          openRows.flatMap((row) =>
            (row.items || []).map((item) => [
              item.product_id,
              `${item.description} / ${item.unit}`,
            ]),
          ),
        ),
      ].sort((a, b) => a[1].localeCompare(b[1], "th")),
    [openRows],
  );
  const unitOptions = useMemo(
    () =>
      [
        ...new Set(
          openRows.flatMap((row) => (row.items || []).map((item) => item.unit)),
        ),
      ]
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b, "th")),
    [openRows],
  );
  const districtOptions = useMemo(
    () =>
      [
        ...new Map(
          openRows
            .map(
              (row) => [row.district_id, row.district_name] as [string, string],
            )
            .filter(([id]) => Boolean(id)),
        ),
      ].sort((a, b) => a[1].localeCompare(b[1], "th")),
    [openRows],
  );
  const branchOptions = useMemo(
    () => destinationBranches(w.branches, w.zones),
    [w.branches, w.zones],
  );
  const vehicleOptions = useMemo(
    () =>
      [...new Set(openRows.map((row) => row.vehicle_plate_no).filter(Boolean))]
        .map(String)
        .sort((a, b) => a.localeCompare(b, "th", { numeric: true })),
    [openRows],
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
    return openRows
      .filter((row) =>
        matchesCodDeliveryFilter(row, includeUnsent, deliveryFrom, deliveryTo),
      )
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
      .filter((row) =>
        isDestinationBranch(
          row.destination_branch_code,
          branch,
          w.branches,
          w.zones,
        ),
      )
      .filter((row) => !district || row.district_id === district)
      .filter(
        (row) =>
          !priceState ||
          (priceState === "PENDING" ? row.price_pending : !row.price_pending),
      )
      .filter((row) => !vehicle || row.vehicle_plate_no === vehicle)
      .sort(
        (a, b) =>
          (sort !== "OLDEST" && sort !== "NEWEST"
            ? compareListSort(
                {
                  receiver: a.receiver_snapshot.display_name,
                  sender: a.sender_snapshot.display_name,
                  product: firstItemName(a.items || [], "description"),
                  unit: firstItemName(a.items || [], "unit"),
                  price: a.price_pending ? null : a.total_amount,
                },
                {
                  receiver: b.receiver_snapshot.display_name,
                  sender: b.sender_snapshot.display_name,
                  product: firstItemName(b.items || [], "description"),
                  unit: firstItemName(b.items || [], "unit"),
                  price: b.price_pending ? null : b.total_amount,
                },
                sort,
              )
            : 0) ||
          compareBillsByOpenedAt(
            a.received_at,
            a.shipment_no,
            b.received_at,
            b.shipment_no,
            sort === "NEWEST",
          ),
      );
  }, [
    branch,
    catalogId,
    deliveryFrom,
    includeUnsent,
    deliveryTo,
    district,
    priceState,
    query,
    receiver,
    openRows,
    sender,
    sort,
    unit,
    vehicle,
    w.branches,
    w.zones,
  ]);
  const paged = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const hasFilters = Boolean(
    query ||
    deliveryFrom ||
    includeUnsent ||
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
  const discountValue = Number(discount || 0);
  const adjustedSelected =
    selected && Number.isFinite(discountValue)
      ? adjustedCodAmounts(selected, discountValue)
      : null;
  const knownItemTotal = (selected?.items || []).reduce((sum, item) => {
    const entered = itemPrices[item.id]?.trim();
    const price = Number(entered);
    return entered && Number.isFinite(price) && price >= 0
      ? sum + codLineTotal(item, price)
      : sum;
  }, 0);
  const originalItemSubtotal = selected
    ? selected.total_amount + selected.discount - selected.extra_charge
    : 0;
  const remainingItemValue =
    Math.round((originalItemSubtotal - knownItemTotal) * 100) / 100;

  function chooseBill(row: Shipment) {
    setMatchingIds([]);
    if (!pendingCodBills([row]).length) {
      w.toast(`บิล ${row.shipment_no} เก็บเงินครบแล้ว`, true);
      setInvoice("");
      invoiceRef.current?.focus();
      return;
    }
    setSelected(row);
    setInvoice(row.shipment_no);
    setAmount(row.outstanding_amount.toFixed(2));
    setAmountTouched(false);
    setDiscount(Number(row.discount || 0).toFixed(2));
    setExpectedDiscount(Number(row.discount || 0));
    setItemPrices(
      Object.fromEntries(
        (row.items || []).map((item) => [
          item.id,
          item.price_pending ? "" : Number(item.unit_price || 0).toFixed(2),
        ]),
      ),
    );
    setMethod("CASH");
    setNote("");
    setAddingMethod(false);
    requestRef.current = crypto.randomUUID();
  }

  function findBill() {
    setMatchingIds([]);
    const allMatches = matchingBills(rows, invoice);
    const matches = pendingCodBills(allMatches);
    if (!matches.length) {
      w.toast(
        allMatches.length
          ? `บิล ${invoice.trim()} เก็บเงินครบแล้วหรือไม่มีราคาให้เรียกเก็บ`
          : `ไม่พบบิล ${invoice.trim() || "ที่ระบุ"} ในรายการ COD`,
        true,
      );
      invoiceRef.current?.select();
      return;
    }
    if (matches.length > 1) {
      setMatchingIds(matches.map((row) => row.id));
      return;
    }
    chooseBill(matches[0]);
  }

  function clearSelection() {
    setMatchingIds([]);
    setSelected(null);
    setInvoice("");
    setAmount("");
    setAmountTouched(false);
    setItemPrices({});
    setDiscount("0.00");
    setExpectedDiscount(0);
    setNote("");
    setAddingMethod(false);
    requestRef.current = crypto.randomUUID();
    window.setTimeout(() => invoiceRef.current?.focus());
  }

  async function addMethod() {
    if (savingMethod) return;
    const label = newMethodName.trim();
    if (!label) {
      w.toast("กรุณาระบุชื่อวิธีรับเงิน", true);
      return;
    }
    setSavingMethod(true);
    try {
      const id = await w.service.addCodPaymentMethod(label, newMethodCategory);
      setMethodOptions(await w.service.codPaymentMethods());
      setMethod(`CUSTOM:${id}`);
      setNewMethodName("");
      setAddingMethod(false);
    } catch (cause) {
      w.toast((cause as Error).message || "เพิ่มวิธีรับเงินไม่สำเร็จ", true);
    } finally {
      setSavingMethod(false);
    }
  }

  async function submitPrices() {
    if (
      !selected ||
      selectedUnavailable ||
      saving ||
      !isCodPendingPriceOnly(selected)
    )
      return;
    let prices;
    try {
      prices = knownCodPrices(selected.items || [], itemPrices).lines;
    } catch (cause) {
      w.toast((cause as Error).message, true);
      return;
    }
    if (!prices.length) {
      w.toast("กรุณาระบุราคาต่อหน่วยอย่างน้อยหนึ่งรายการ", true);
      priceRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const result = await w.service.submitCodPrices(selected.id, prices);
      w.toast(
        result.submitted_prices
          ? `ส่งราคา ${result.submitted_prices} รายการให้บัญชียืนยันแล้ว`
          : "ราคานี้อยู่ระหว่างบัญชียืนยันแล้ว",
      );
      clearSelection();
    } catch (cause) {
      w.toast((cause as Error).message || "ส่งราคาไม่สำเร็จ", true);
    } finally {
      setSaving(false);
    }
  }

  async function saveCollection() {
    if (!selected || selectedUnavailable || saving) return;
    const value = Number(amount);
    const newDiscount = Number(discount || 0);
    if (!isCurrencyAmount(newDiscount) || newDiscount < 0) {
      w.toast("ส่วนลดต้องเป็นจำนวนเงินที่ถูกต้อง", true);
      return;
    }
    const adjusted = adjustedCodAmounts(selected, newDiscount);
    if (
      !isCurrencyAmount(value) ||
      value <= 0 ||
      adjusted.total <= 0 ||
      value > adjusted.outstanding
    ) {
      w.toast(
        `ยอดรับเงินจริงต้องมากกว่า 0 และไม่เกิน ${money(Math.max(0, adjusted.outstanding))} บาท หลังหักส่วนลด`,
        true,
      );
      amountRef.current?.focus();
      amountRef.current?.select();
      return;
    }
    let prices;
    try {
      prices = knownCodPrices(selected.items || [], itemPrices).lines;
    } catch (cause) {
      w.toast((cause as Error).message, true);
      return;
    }
    const customMethod = method.startsWith("CUSTOM:")
      ? methodOptions.find((option) => option.id === method.slice(7))
      : null;
    if (method.startsWith("CUSTOM:") && !customMethod) {
      w.toast("กรุณาเลือกวิธีรับเงินอีกครั้ง", true);
      return;
    }
    setSaving(true);
    try {
      await w.service.collectCod({
        shipment_id: selected.id,
        amount: value,
        method: customMethod?.base_method || (method as CodPaymentMethod),
        method_option_id: customMethod?.id || null,
        note: note.trim(),
        discount: newDiscount,
        expected_discount: expectedDiscount,
        items: prices,
        request_id: requestRef.current,
      });
      const remaining = Math.max(0, adjusted.outstanding - value);
      setRows((current) =>
        current.map((row) =>
          row.id === selected.id
            ? {
                ...row,
                discount: newDiscount,
                total_amount: adjusted.total,
                paid_amount: row.paid_amount + value,
                outstanding_amount: remaining,
              }
            : row,
        ),
      );
      setPayments((current) => [
        {
          shipmentId: selected.id,
          amount: value,
          receivedAt: new Date().toISOString(),
        },
        ...current,
      ]);
      w.toast(
        remaining > 0
          ? `รับเงินบิล ${selected.shipment_no} แล้ว เหลือ ${money(remaining)} บาท`
          : `รับเงินบิล ${selected.shipment_no} ครบแล้ว`,
      );
      clearSelection();
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
    setIncludeUnsent(false);
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
                  setMatchingIds([]);
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
            <small>
              กด Enter เพื่อไปที่ยอดรับเงินจริง หรือราคาสินค้าหากบิลยังรอราคา
            </small>
          </form>

          {matchingIds.length > 1 ? (
            <div className="cod-candidates" aria-label="เลือกบิลจากเลขที่ซ้ำ">
              <strong>
                พบ {number(matchingIds.length)} บิลที่ตรงกับเลขนี้
              </strong>
              <span>ตรวจเลขเต็มและผู้รับก่อนเลือกรับเงิน</span>
              <div className="cod-candidate-list">
                {matchingIds.flatMap((id) => {
                  const row = rows.find((item) => item.id === id);
                  return row
                    ? [
                        <button
                          key={row.id}
                          type="button"
                          onClick={() => chooseBill(row)}
                        >
                          <b>{row.shipment_no}</b>
                          <span>{row.receiver_snapshot.display_name}</span>
                          <span>{row.zone_name}</span>
                          <strong>
                            {isCodPendingPriceOnly(row)
                              ? "รอราคา"
                              : `ค้าง ฿ ${money(row.outstanding_amount)}`}
                          </strong>
                        </button>,
                      ]
                    : [];
                })}
              </div>
            </div>
          ) : selected ? (
            <form
              className="cod-payment-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (isCodPendingPriceOnly(selected)) void submitPrices();
                else void saveCollection();
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
              {selectedUnavailable && (
                <div className="cod-price-notice" role="status">
                  บิลนี้มีการเปลี่ยนแปลงและไม่อยู่ในรายการค้างเก็บแล้ว
                  ข้อมูลที่กรอกยังอยู่ กรุณาเลือกบิลใหม่ก่อนบันทึก
                </div>
              )}
              <div className="cod-selected-totals">
                <span>
                  ยอดบิล{" "}
                  <b>
                    {money(adjustedSelected?.total ?? selected.total_amount)}
                  </b>
                </span>
                <span>
                  รับแล้ว <b>{money(selected.paid_amount)}</b>
                </span>
                <span>
                  ค้างเก็บ{" "}
                  <strong>
                    {money(
                      adjustedSelected?.outstanding ??
                        selected.outstanding_amount,
                    )}
                  </strong>
                </span>
              </div>
              <div className="cod-items-heading">
                <strong>รายการสินค้าในบิล</strong>
                <span>ใส่ราคาต่อหน่วยเฉพาะรายการที่ทราบ เว้นว่างได้</span>
              </div>
              <div className="cod-items-wrap">
                <table className="cod-items-table">
                  <thead>
                    <tr>
                      <th>สินค้า / หน่วย</th>
                      <th>จำนวน</th>
                      <th>ราคาต่อหน่วย (บาท)</th>
                      <th>ราคารวม (บาท)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selected.items || []).map((item, index) => {
                      const raw = itemPrices[item.id] || "";
                      const price = Number(raw);
                      return (
                        <tr key={item.id}>
                          <td>
                            {item.description} / {item.unit}
                          </td>
                          <td>{number(item.quantity)}</td>
                          <td>
                            <input
                              ref={
                                index ===
                                selected.items?.findIndex(
                                  (row) => row.price_pending,
                                )
                                  ? priceRef
                                  : undefined
                              }
                              aria-label={`ราคาต่อหน่วย ${item.description}`}
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="0.01"
                              placeholder="ยังไม่ทราบ"
                              value={raw}
                              onChange={(event) =>
                                setItemPrices((current) => ({
                                  ...current,
                                  [item.id]: event.target.value,
                                }))
                              }
                            />
                          </td>
                          <td>
                            {raw && Number.isFinite(price) && price >= 0
                              ? money(codLineTotal(item, price))
                              : "—"}
                          </td>
                        </tr>
                      );
                    })}
                    {!selected.items?.length && (
                      <tr>
                        <td colSpan={4}>ไม่พบรายการสินค้าในบิล</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              {!isCodPendingPriceOnly(selected) && (
                <label className="cod-discount-field">
                  <span>ส่วนลดทั้งบิล (บาท)</span>
                  <input
                    aria-label="ส่วนลดทั้งบิล"
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    value={discount}
                    onChange={(event) => {
                      const next = event.target.value;
                      setDiscount(next);
                      if (!amountTouched && Number.isFinite(Number(next))) {
                        const adjusted = adjustedCodAmounts(
                          selected,
                          Number(next || 0),
                        );
                        setAmount(Math.max(0, adjusted.outstanding).toFixed(2));
                      }
                    }}
                  />
                </label>
              )}
              <div className="cod-items-summary">
                <span>
                  {isCodPendingPriceOnly(selected)
                    ? "รวมราคาเสนอที่ระบุ"
                    : "รวมรายการที่ทราบ"}{" "}
                  <b>฿ {money(knownItemTotal)}</b>
                </span>
                {!isCodPendingPriceOnly(selected) && (
                  <>
                    <span>
                      ส่วนลด{" "}
                      <b>
                        ฿{" "}
                        {money(
                          Number.isFinite(discountValue) ? discountValue : 0,
                        )}
                      </b>
                    </span>
                    <span>
                      {remainingItemValue >= 0
                        ? "ส่วนต่างที่ยังไม่ระบุ"
                        : "ราคาที่กรอกเกินยอดสินค้า"}
                      <b>฿ {money(Math.abs(remainingItemValue))}</b>
                    </span>
                  </>
                )}
              </div>
              <small className="cod-items-hint">
                ราคารวมคำนวณจากจำนวน × ราคาต่อหน่วย ราคาใหม่ส่งให้บัญชียืนยัน
              </small>
              {isCodPendingPriceOnly(selected) ? (
                <div className="cod-price-notice">
                  <span>
                    บิลนี้ยังไม่มีราคาที่ยืนยัน จึงยังรับเงินในระบบไม่ได้
                    ระบุราคาที่ทราบแล้วส่งให้บัญชียืนยันก่อน
                  </span>
                  <Button
                    className="primary"
                    type="submit"
                    busy={saving}
                    disabled={selectedUnavailable}
                  >
                    ส่งราคาให้บัญชียืนยัน
                  </Button>
                </div>
              ) : (
                <>
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
                          max={Math.max(
                            0,
                            adjustedSelected?.outstanding ??
                              selected.outstanding_amount,
                          )}
                          step="0.01"
                          value={amount}
                          onChange={(event) => {
                            setAmount(event.target.value);
                            setAmountTouched(true);
                          }}
                          required
                        />
                      </div>
                    </label>
                    <label>
                      <span>วิธีรับเงิน</span>
                      <select
                        value={method}
                        onChange={(event) => {
                          if (event.target.value === "ADD")
                            setAddingMethod(true);
                          else {
                            setMethod(event.target.value);
                            setAddingMethod(false);
                          }
                        }}
                      >
                        <option value="CASH">เงินสด</option>
                        <option value="TRANSFER">โอน</option>
                        <option value="QR">QR Payment</option>
                        {methodOptions.map((option) => (
                          <option key={option.id} value={`CUSTOM:${option.id}`}>
                            {option.label}
                          </option>
                        ))}
                        <option value="ADD">+ เพิ่มวิธีรับเงิน</option>
                      </select>
                    </label>
                    <label>
                      <span>หมายเหตุ</span>
                      <input
                        placeholder="พิมพ์หมายเหตุ (ไม่บังคับ)"
                        maxLength={500}
                        value={note}
                        onChange={(event) => setNote(event.target.value)}
                      />
                    </label>
                    <Button
                      className="primary"
                      type="submit"
                      busy={saving}
                      disabled={selectedUnavailable}
                    >
                      <HandCoins size={18} />
                      บันทึกรับเงิน
                    </Button>
                  </div>
                  {addingMethod && (
                    <div className="cod-add-method">
                      <label>
                        ชื่อวิธีรับเงิน
                        <input
                          autoFocus
                          maxLength={80}
                          value={newMethodName}
                          onChange={(event) =>
                            setNewMethodName(event.target.value)
                          }
                          placeholder="พิมพ์ชื่อวิธีรับเงิน"
                        />
                      </label>
                      <label>
                        ประเภท
                        <select
                          value={newMethodCategory}
                          onChange={(event) =>
                            setNewMethodCategory(
                              event.target.value as CodPaymentMethod,
                            )
                          }
                        >
                          <option value="CASH">เงินสด</option>
                          <option value="TRANSFER">โอน</option>
                          <option value="QR">QR Payment</option>
                        </select>
                      </label>
                      <Button
                        type="button"
                        onClick={() => void addMethod()}
                        busy={savingMethod}
                      >
                        เพิ่มรายการ
                      </Button>
                      <button
                        type="button"
                        onClick={() => setAddingMethod(false)}
                      >
                        ยกเลิก
                      </button>
                    </div>
                  )}
                </>
              )}
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
            <div className="shipment-filter-control">
              <span>สถานะการส่งของ</span>
              <label className="cod-include-unsent">
                <input
                  type="checkbox"
                  checked={includeUnsent}
                  onChange={(event) => {
                    setIncludeUnsent(event.target.checked);
                    setPage(0);
                  }}
                />
                <strong>แสดงบิลที่ยังไม่ส่ง</strong>
              </label>
            </div>
            <label className="shipment-filter-control">
              <span>ผู้รับ</span>
              <select
                value={receiver || (sort === "RECEIVER" ? SORT_ALL : "")}
                onChange={(event) => {
                  const value = event.target.value;
                  setReceiver(value === SORT_ALL ? "" : value);
                  if (value === SORT_ALL) setSort("RECEIVER");
                  else if (sort === "RECEIVER") setSort("OLDEST");
                  setPage(0);
                }}
              >
                <option value="">ผู้รับทั้งหมด</option>
                <option value={SORT_ALL}>{SORT_ALL_LABEL}</option>
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
                value={sender || (sort === "SENDER" ? SORT_ALL : "")}
                onChange={(event) => {
                  const value = event.target.value;
                  setSender(value === SORT_ALL ? "" : value);
                  if (value === SORT_ALL) setSort("SENDER");
                  else if (sort === "SENDER") setSort("OLDEST");
                  setPage(0);
                }}
              >
                <option value="">ผู้ส่งทั้งหมด</option>
                <option value={SORT_ALL}>{SORT_ALL_LABEL}</option>
                {senderOptions.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="shipment-filter-control">
              <span>สินค้า / หน่วย</span>
              <SearchableSelect
                ariaLabel="สินค้า / หน่วย"
                value={catalogId || (sort === "PRODUCT" ? SORT_ALL : "")}
                emptyLabel="สินค้าทั้งหมด"
                options={[
                  { id: SORT_ALL, label: SORT_ALL_LABEL },
                  ...productOptions.map(([id, label]) => ({ id, label })),
                ]}
                onChange={(value) => {
                  setCatalogId(value === SORT_ALL ? "" : value);
                  if (value === SORT_ALL) setSort("PRODUCT");
                  else if (sort === "PRODUCT") setSort("OLDEST");
                  setPage(0);
                }}
              />
            </div>
            <label className="shipment-filter-control">
              <span>หน่วยนับ</span>
              <select
                value={unit || (sort === "UNIT" ? SORT_ALL : "")}
                onChange={(event) => {
                  const value = event.target.value;
                  setUnit(value === SORT_ALL ? "" : value);
                  if (value === SORT_ALL) setSort("UNIT");
                  else if (sort === "UNIT") setSort("OLDEST");
                  setPage(0);
                }}
              >
                <option value="">ทุกหน่วย</option>
                <option value={SORT_ALL}>{SORT_ALL_LABEL}</option>
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
                  setReceiver("");
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
              <span>เรียงรายการ</span>
              <div className="cod-sort-select">
                <ArrowUpDown size={16} />
                <select
                  value={sort}
                  onChange={(event) => {
                    setSort(event.target.value as typeof sort);
                    setPage(0);
                  }}
                >
                  <option value="OLDEST">เก่าสุดก่อน</option>
                  <option value="NEWEST">ใหม่สุดก่อน</option>
                  {listSortOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
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
                  <th>ผู้รับ</th>
                  <th>ผู้ส่ง</th>
                  <th>รายการสินค้า</th>
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
                      </td>
                      <td>
                        <strong>{row.sender_snapshot.display_name}</strong>
                      </td>
                      <td>
                        <div className="cod-table-items">
                          {(row.items || []).map((item) => (
                            <span key={item.id}>
                              {item.description} {number(item.quantity)}{" "}
                              {item.unit}
                            </span>
                          ))}
                          {!row.items?.length && (
                            <span className="muted">ไม่พบรายการสินค้า</span>
                          )}
                        </div>
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
                          {(row.outstanding_amount > 0 ||
                            isCodPendingPriceOnly(row)) && (
                            <IconButton
                              label={`${isCodPendingPriceOnly(row) ? "เสนอราคาบิล" : "รับเงินบิล"} ${row.shipment_no}`}
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
