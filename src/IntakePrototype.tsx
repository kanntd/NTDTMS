import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import {
  ArrowRight,
  Banknote,
  Check,
  ChevronDown,
  CreditCard,
  FileText,
  MapPin,
  Plus,
  Printer,
  Search,
  Trash2,
  UserRound,
} from "lucide-react";
import { Button, Field, IconButton, Loading, Modal } from "./ui";
import { useWorkspace } from "./context";
import { money, thaiDate } from "./domain";
import { BRANCH_OPTIONS, agreedPrice } from "./intakeData";
import { intakeAmounts, onePercent } from "./intakeMath";
import IntakeEntryForm, { MeasurementFields } from "./IntakeEntryForm";
import {
  monthlyBillingPeriod,
  pairRateKey,
  validMeasurements,
  type IntakeParty,
  type CatalogItem,
  type Measurements,
} from "./intakeEntryData";
import { PAYMENT_LABELS, type PaymentMode } from "./types";
import {
  addInitialPriceIfMissing,
  activeRelation,
  activeRelationProduct,
  currentPrice,
  loadOperations,
  newId,
  pendingPriceRequest,
  saveOperations,
} from "./operationsStore";
import {
  issueRemoteReceptionBill,
  loadRemoteWorkspace,
  syncRemoteWorkspace,
} from "./remoteWorkspace";
import type { IntakeRegistrySnapshot } from "./intakeRegistry";

type Choice = { id: string; label: string; detail?: string };
type Line = Measurements & {
  id: string;
  catalogId: string;
  quantity: number;
  price: number | null;
  requestPrice: boolean;
};
type Draft = {
  openedByEmployeeId: string;
  receiverId: string;
  senderId: string;
  branch: string;
  payment: PaymentMode | "";
  days: number;
  billingCycle: "MONTH_END" | "NET_DAYS";
  lines: Line[];
  discount: number;
  reason: string;
  withholding: boolean;
  taxOverride: number | null;
  roundCash: boolean;
  collect: boolean;
  note: string;
};
type Bill = {
  id: string;
  number: string;
  date: string;
  openedBy?: {
    employeeId: string;
    code: string;
    name: string;
    nickname?: string;
  };
  draft: Draft;
  receiver: IntakeParty;
  sender: IntakeParty;
  billingPeriod?: ReturnType<typeof monthlyBillingPeriod>;
  items: (Line & { name: string; unit: string })[];
  withheld: number;
  amounts: ReturnType<typeof intakeAmounts>;
  shipmentStatus?: "RECEIVED" | "IN_TRANSIT" | "DELIVERED" | "CANCELLED";
};
type State = {
  version: 5;
  rates: Record<string, number>;
  defaults: Record<string, string>;
  parties: IntakeParty[];
  catalog: CatalogItem[];
  merchandise: Record<string, string[]>;
  relations: Record<string, string[]>;
  partyRoles?: Record<string, { receiver: boolean; sender: boolean }>;
  catalogActive?: Record<string, boolean>;
  drafts: Draft;
  bills: Bill[];
};
const key = "ntdtms-reception-local-v5";
const blankLine = (): Line => ({
  id: crypto.randomUUID(),
  catalogId: "",
  quantity: 1,
  price: null,
  requestPrice: false,
});
const blank = (openedByEmployeeId = ""): Draft => ({
  openedByEmployeeId,
  receiverId: "",
  senderId: "",
  branch: "",
  payment: "",
  days: 30,
  billingCycle: "MONTH_END",
  lines: [blankLine()],
  discount: 0,
  reason: "",
  withholding: false,
  taxOverride: null,
  roundCash: false,
  collect: false,
  note: "",
});
const sortThai = (a: Choice, b: Choice) => a.label.localeCompare(b.label, "th");
const normalized = (value: string) =>
  value.toLocaleLowerCase("th").replace(/\s|-/g, "");
function seed(): State {
  return {
    version: 5,
    rates: {},
    defaults: {},
    parties: [],
    catalog: [],
    merchandise: {},
    relations: {},
    partyRoles: {},
    catalogActive: {},
    drafts: blank(),
    bills: [],
  };
}

function load(): State {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "null") as
      (Omit<State, "version"> & { version: number }) | null;
    if (
      (stored?.version === 4 || stored?.version === 5) &&
      Array.isArray(stored.parties) &&
      Array.isArray(stored.catalog) &&
      Array.isArray(stored.bills) &&
      stored.drafts?.lines?.length
    )
      return {
        ...stored,
        version: 5,
        rates: stored.rates || {},
        defaults: stored.defaults || seed().defaults,
        partyRoles:
          stored.partyRoles ||
          Object.fromEntries(
            stored.parties.map((party) => {
              const receiver =
                party.id in (stored.defaults || {}) ||
                party.id in (stored.relations || {});
              const sender = Object.values(stored.relations || {}).some((ids) =>
                ids.includes(party.id),
              );
              return [party.id, { receiver: receiver || !sender, sender }];
            }),
          ),
        drafts: {
          ...stored.drafts,
          openedByEmployeeId: stored.drafts.openedByEmployeeId || "",
          billingCycle: stored.drafts.billingCycle || "MONTH_END",
          withholding: stored.version === 4 ? false : stored.drafts.withholding,
          lines: stored.drafts.lines.map((row) => ({
            ...row,
            requestPrice: row.requestPrice ?? row.price === null,
          })),
        },
      };
  } catch {
    /* A new demo workspace can recover a damaged browser snapshot. */
  }
  return seed();
}

function Picker({
  label,
  choices,
  selected,
  onSelect,
  onAdd,
  disabled,
  global,
  onGlobal,
}: {
  label: string;
  choices: Choice[];
  selected: string;
  onSelect: (id: string) => void;
  onAdd: (query: string) => void;
  disabled?: boolean;
  global?: boolean;
  onGlobal?: () => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (open)
      document
        .getElementById(id + "-" + active)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, open, id]);
  const current = choices.find((c) => c.id === selected);
  const options = choices
    .filter((c) =>
      normalized(c.label + (c.detail || "")).includes(normalized(query)),
    )
    .sort(sortThai);
  function choose(value: string) {
    onSelect(value);
    setOpen(false);
    setQuery("");
  }
  return (
    <div
      className="desk-picker"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
    >
      <label htmlFor={id}>{label}</label>
      <div className="desk-picker-input">
        <Search size={16} />
        <input
          id={id}
          disabled={disabled}
          value={open ? query : current?.label || ""}
          placeholder="ค้นหา / เลือกรายการ"
          autoComplete="off"
          role="combobox"
          aria-expanded={open}
          aria-controls={id + "-list"}
          aria-activedescendant={
            open && options[active] ? id + "-" + active : undefined
          }
          onFocus={() => {
            setOpen(true);
            setQuery("");
            setActive(0);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setOpen(true);
              setActive((n) =>
                Math.max(
                  0,
                  Math.min(
                    options.length - 1,
                    n + (e.key === "ArrowDown" ? 1 : -1),
                  ),
                ),
              );
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setOpen(false);
            }
            if (e.key === "Enter") {
              e.preventDefault();
              if (open && options[active]) choose(options[active].id);
            }
          }}
        />
        <IconButton
          label={`เพิ่ม${label}`}
          disabled={disabled}
          onClick={() => {
            setOpen(false);
            onAdd(query);
          }}
        >
          <Plus size={17} />
        </IconButton>
      </div>
      {open && !disabled && (
        <div className="desk-options">
          <div className="desk-options-title">
            {onGlobal && !global ? "รายการที่สัมพันธ์กัน" : "ทะเบียนทั้งหมด"}
            <span>ก–ฮ</span>
          </div>
          <div role="listbox" id={id + "-list"} className="desk-options-scroll">
            {options.map((c, i) => (
              <button
                type="button"
                role="option"
                aria-selected={i === active}
                id={id + "-" + i}
                className={i === active ? "selected" : ""}
                key={c.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(c.id)}
              >
                <span>
                  {c.label}
                  <small>{c.detail}</small>
                </span>
                {selected === c.id && <Check size={15} />}
              </button>
            ))}
            {!options.length && <p>ไม่พบรายการ</p>}
          </div>
          {onGlobal && !global && (
            <Button
              type="button"
              onClick={() => {
                onGlobal();
                setActive(0);
              }}
            >
              <Search size={14} />
              ค้นหาจากทะเบียนทั้งหมด
            </Button>
          )}
          {(!onGlobal || global) && (
            <Button
              type="button"
              onClick={() => {
                setOpen(false);
                onAdd(query);
              }}
            >
              <Plus size={14} />
              เพิ่มรายการใหม่
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default function IntakePrototype() {
  const w = useWorkspace();
  const [state, setState] = useState(() => (w.demo ? load() : seed()));
  const [operations, setOperations] = useState(loadOperations);
  const [remoteReady, setRemoteReady] = useState(w.demo);
  const [busy, setBusy] = useState(false);
  const f = state.drafts;
  const [senderGlobal, setSenderGlobal] = useState(false);
  const [productGlobal, setProductGlobal] = useState<Record<string, boolean>>(
    {},
  );
  const [adding, setAdding] = useState<{
    kind: "receiver" | "sender" | "product";
    lineId?: string;
    query: string;
  } | null>(null);
  const [preview, setPreview] = useState<Bill | null>(null);
  const [reset, setReset] = useState(false);
  const [fractionalWarning, setFractionalWarning] = useState(false);
  const [error, setError] = useState("");
  const formRef = useRef<HTMLFormElement>(null);
  const applyingRemoteRef = useRef(false);
  useEffect(() => {
    if (w.demo) return;
    let active = true;
    setRemoteReady(false);
    loadRemoteWorkspace()
      .then((workspace) => {
        if (!active) return;
        applyingRemoteRef.current = true;
        setState((current) => ({
          ...current,
          parties: workspace.registry.parties,
          catalog: workspace.registry.catalog,
          defaults: workspace.registry.defaults,
          partyRoles: workspace.registry.partyRoles,
          catalogActive:
            (workspace.registry.raw.catalogActive as Record<string, boolean>) ||
            {},
        }));
        setOperations(workspace.operations);
        setRemoteReady(true);
      })
      .catch((cause) => {
        if (!active) return;
        setError((cause as Error).message);
        setRemoteReady(true);
      });
    return () => {
      active = false;
    };
  }, [w.demo, w.revision]);
  useEffect(() => {
    if (!w.demo) return;
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      setError("พื้นที่จัดเก็บในเบราว์เซอร์ไม่พอ กรุณาเก็บบิลก่อนปิดหน้านี้");
    }
  }, [state]);
  useEffect(() => {
    if (!w.demo) return;
    saveOperations(operations);
  }, [operations, w.demo]);
  useEffect(() => {
    if (w.demo || !remoteReady) return;
    if (applyingRemoteRef.current) {
      applyingRemoteRef.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      const registry: IntakeRegistrySnapshot = {
        raw: { catalogActive: state.catalogActive || {} },
        parties: state.parties,
        catalog: state.catalog,
        defaults: state.defaults,
        partyRoles: state.partyRoles || {},
      };
      void syncRemoteWorkspace(registry, operations).catch((cause) =>
        setError(`บันทึกข้อมูลกลางไม่สำเร็จ: ${(cause as Error).message}`),
      );
    }, 400);
    return () => window.clearTimeout(timer);
  }, [
    w.demo,
    remoteReady,
    state.parties,
    state.catalog,
    state.defaults,
    state.partyRoles,
    state.catalogActive,
    operations,
  ]);
  useEffect(() => {
    setState((current) => ({
      ...current,
      drafts: reprice(current.drafts),
    }));
  }, [operations]);
  const receiver = state.parties.find((p) => p.id === f.receiverId);
  const sender = state.parties.find((p) => p.id === f.senderId);
  const loginEmployee = operations.employees.find(
    (employee) =>
      employee.active &&
      (employee.id === w.profile.id ||
        normalized(employee.name) === normalized(w.profile.display_name) ||
        normalized(employee.nickname) === normalized(w.profile.display_name)),
  );
  const loginOpener = {
    id: loginEmployee?.id || w.profile.id,
    code: loginEmployee?.code || "บัญชีผู้ใช้",
    name: loginEmployee?.name || w.profile.display_name,
    nickname: loginEmployee?.nickname || "",
  };
  const openerChoices = [
    loginOpener,
    ...operations.employees.filter(
      (employee) => employee.active && employee.id !== loginOpener.id,
    ),
  ].sort((a, b) =>
    (a.nickname || a.name).localeCompare(b.nickname || b.name, "th"),
  );
  const opener = openerChoices.find(
    (employee) => employee.id === f.openedByEmployeeId,
  );
  useEffect(() => {
    setState((current) => ({
      ...current,
      drafts: {
        ...current.drafts,
        openedByEmployeeId: loginOpener.id,
      },
    }));
  }, [loginOpener.id]);
  const branch = BRANCH_OPTIONS.find((b) => b.code === f.branch);
  const before = intakeAmounts(f.lines, f.discount, 0, false);
  const withheld = f.withholding
    ? (f.taxOverride ?? onePercent(before.total))
    : 0;
  const amount = intakeAmounts(f.lines, f.discount, withheld, f.roundCash);
  function patch(p: Partial<Draft>) {
    const changesAmount = [
      "lines",
      "discount",
      "taxOverride",
      "withholding",
      "roundCash",
      "payment",
      "branch",
    ].some((field) => field in p);
    setState((s) => ({
      ...s,
      drafts: {
        ...s.drafts,
        collect: changesAmount ? false : s.drafts.collect,
        ...p,
      },
    }));
  }
  function price(row: Line, next: Draft): number | null {
    if (!next.payment || !row.catalogId) return null;
    const c = state.catalog.find((c) => c.id === row.catalogId);
    const key = pairRateKey(
      next.receiverId,
      next.senderId,
      row.catalogId,
      next.payment,
      next.branch,
    );
    if (pendingPriceRequest(operations, key)) return null;
    const approved = currentPrice(operations, key);
    if (approved !== null) return approved;
    const saved = state.rates[key];
    if (saved !== undefined) return saved;
    return c
      ? agreedPrice(
          next.receiverId,
          next.senderId,
          c.productId,
          c.unit,
          next.payment,
          next.branch,
        )
      : null;
  }
  function reprice(next: Draft) {
    return {
      ...next,
      collect: false,
      taxOverride: null,
      lines: next.lines.map((row) => {
        const nextPrice = price(row, next);
        const key =
          next.payment && row.catalogId
            ? pairRateKey(
                next.receiverId,
                next.senderId,
                row.catalogId,
                next.payment,
                next.branch,
              )
            : "";
        return {
          ...row,
          price: nextPrice,
          requestPrice: !!key && !!pendingPriceRequest(operations, key),
        };
      }),
    };
  }
  function selectReceiver(id: string) {
    const next = {
      ...blank(f.openedByEmployeeId),
      receiverId: id,
      branch: BRANCH_OPTIONS.some((b) => b.code === state.defaults[id])
        ? state.defaults[id]
        : "",
    };
    patch(next);
    setSenderGlobal(false);
    setProductGlobal({});
    setError("");
  }
  function selectSender(id: string) {
    setSenderGlobal(false);
    setProductGlobal({});
    const relation = activeRelation(operations, f.receiverId, id);
    patch(
      reprice({
        ...f,
        senderId: id,
        payment: relation?.defaultPayment || "",
        billingCycle: relation?.billingCycle || "MONTH_END",
        days: relation?.creditDays || 30,
        lines: f.lines.map((row) =>
          !row.catalogId ||
          activeRelationProduct(operations, f.receiverId, id, row.catalogId)
            ? row
            : {
                ...row,
                catalogId: "",
                price: null,
                requestPrice: false,
                weight: "",
                width: "",
                length: "",
                height: "",
              },
        ),
      }),
    );
  }
  function selectItem(lineId: string, id: string) {
    setProductGlobal((v) => ({ ...v, [lineId]: false }));
    patch({
      taxOverride: null,
      lines: f.lines.map((row) =>
        row.id === lineId
          ? {
              ...row,
              catalogId: id,
              price: price({ ...row, catalogId: id }, f),
              requestPrice:
                !!f.payment &&
                !!pendingPriceRequest(
                  operations,
                  pairRateKey(
                    f.receiverId,
                    f.senderId,
                    id,
                    f.payment,
                    f.branch,
                  ),
                ),
              weight: state.catalog.find((c) => c.id === id)?.weight || "",
              width: state.catalog.find((c) => c.id === id)?.width || "",
              length: state.catalog.find((c) => c.id === id)?.length || "",
              height: state.catalog.find((c) => c.id === id)?.height || "",
            }
          : row,
      ),
    });
    requestAnimationFrame(() => {
      const el = document.getElementById(
        `qty-${lineId}`,
      ) as HTMLInputElement | null;
      el?.focus();
      el?.select();
    });
  }
  function partyChoices(role: "receiver" | "sender") {
    return state.parties
      .filter(
        (p) =>
          p.is_active &&
          state.partyRoles?.[p.id]?.[role] !== false &&
          (role === "receiver" ||
            senderGlobal ||
            p.id === f.senderId ||
            !!activeRelation(operations, f.receiverId, p.id)),
      )
      .map((p) => ({ id: p.id, label: p.display_name, detail: p.phone }));
  }
  function productChoices(row: Line) {
    return state.catalog
      .filter(
        (c) =>
          state.catalogActive?.[c.id] !== false &&
          (productGlobal[row.id] ||
            activeRelationProduct(operations, f.receiverId, f.senderId, c.id) ||
            row.catalogId === c.id),
      )
      .map((c) => ({ id: c.id, label: `${c.name} · ${c.unit}` }));
  }
  function startAdd(kind: "receiver" | "sender", query: string) {
    setAdding({ kind, query });
  }
  async function buildBill(issue: boolean, fractionalConfirmed = false) {
    if (!opener) {
      setError(
        "กรุณาเลือกผู้เปิดบิล หากไม่มีรายชื่อให้เพิ่มที่ข้อมูลหลัก > พนักงาน",
      );
      return;
    }
    if (!receiver || !sender || !branch) {
      setError("กรุณาเลือกผู้รับ ผู้ส่ง และสาขาปลายทางให้ครบ");
      return;
    }
    if (!f.payment) {
      setError(
        activeRelation(operations, f.receiverId, f.senderId)
          ? "กรุณาเลือกประเภทการชำระเงิน"
          : "การจับคู่ผู้รับ–ผู้ส่งครั้งแรก ต้องเลือกประเภทการชำระเงิน",
      );
      return;
    }
    const payment = f.payment;
    if (
      f.lines.some(
        (row) =>
          !validMeasurements(row) ||
          (row.price !== null &&
            (!Number.isFinite(row.price) || row.price < 0)),
      )
    ) {
      setError("กรุณาตรวจสอบราคา น้ำหนัก และขนาดสินค้า");
      return;
    }
    if (f.lines.some((row) => row.price === null && !row.requestPrice)) {
      setError("กรุณาใส่ราคาให้ครบ หรือเลือกขอราคาในรายการที่ยังไม่ทราบราคา");
      return;
    }
    if (f.payment === "CASH_ORIGIN" && amount.pending) {
      setError("เงินสดต้นทางต้องระบุราคาทุกรายการก่อนบันทึกบิล");
      return;
    }
    if (
      f.lines.some(
        (l) => !l.catalogId || !Number.isFinite(l.quantity) || l.quantity <= 0,
      )
    ) {
      setError("กรุณาเลือกสินค้าและจำนวนให้ครบ");
      return;
    }
    if (
      issue &&
      !fractionalConfirmed &&
      f.lines.some((line) => !Number.isInteger(line.quantity))
    ) {
      setFractionalWarning(true);
      return;
    }
    if (
      !Number.isFinite(f.discount) ||
      f.discount < 0 ||
      f.discount > before.subtotal ||
      !Number.isFinite(withheld) ||
      withheld < 0 ||
      withheld > before.total
    ) {
      setError("กรุณาตรวจสอบยอดส่วนลดและยอดหัก");
      return;
    }
    if (f.discount > 0 && !f.reason.trim()) {
      setError("กรุณาระบุเหตุผลส่วนลด");
      return;
    }
    if (
      amount.pending &&
      (f.discount > 0 || f.taxOverride !== null || f.collect)
    ) {
      setError("บิลรอราคายังระบุส่วนลดหรือยืนยันยอดรับไม่ได้");
      return;
    }
    const bill: Bill = {
      id: crypto.randomUUID(),
      number: issue
        ? `BKK-${String(new Date().getFullYear() + 543).slice(-2)}-${String(state.bills.length + 1).padStart(6, "0")}`
        : "ร่าง",
      date: new Date().toISOString(),
      openedBy: {
        employeeId: opener.id,
        code: opener.code,
        name: opener.name,
        nickname: opener.nickname,
      },
      shipmentStatus: "RECEIVED",
      billingPeriod:
        f.payment.startsWith("CREDIT") && f.billingCycle === "MONTH_END"
          ? monthlyBillingPeriod(new Date())
          : undefined,
      draft: structuredClone(f),
      receiver: structuredClone(receiver),
      sender: structuredClone(sender),
      withheld,
      amounts: amount,
      items: f.lines.map((l) => {
        const c = state.catalog.find((c) => c.id === l.catalogId)!;
        return { ...l, name: c.name, unit: c.unit };
      }),
    };
    if (issue && !w.demo) {
      setBusy(true);
      try {
        const registry: IntakeRegistrySnapshot = {
          raw: { catalogActive: state.catalogActive || {} },
          parties: state.parties,
          catalog: state.catalog,
          defaults: state.defaults,
          partyRoles: state.partyRoles || {},
        };
        await syncRemoteWorkspace(registry, operations);
        const issued = await issueRemoteReceptionBill({
          id: bill.id,
          sender_id: sender.id,
          receiver_id: receiver.id,
          destination_branch_code: f.branch,
          payment_mode: payment,
          credit_days: f.days,
          billing_cycle: f.billingCycle,
          billing_period_end: bill.billingPeriod?.end,
          discount: f.discount,
          discount_reason: f.reason,
          withholding_amount: withheld,
          rounding: amount.rounding,
          collect_now: f.collect,
          note: f.note,
          opened_by_employee_id: opener.id,
          items: bill.items.map((item) => ({
            id: item.id,
            catalog_id: item.catalogId,
            name: item.name,
            unit: item.unit,
            quantity: item.quantity,
            price: item.price,
            request_price: item.requestPrice,
            weight: item.weight,
            width: item.width,
            length: item.length,
            height: item.height,
          })),
        });
        bill.id = issued.id;
        bill.number = issued.number;
        setState((current) => ({
          ...current,
          bills: [bill, ...current.bills],
          drafts: blank(loginOpener.id),
        }));
        const workspace = await loadRemoteWorkspace();
        setOperations(workspace.operations);
        setState((current) => ({
          ...current,
          parties: workspace.registry.parties,
          catalog: workspace.registry.catalog,
          defaults: workspace.registry.defaults,
          partyRoles: workspace.registry.partyRoles,
          catalogActive:
            (workspace.registry.raw.catalogActive as Record<string, boolean>) ||
            {},
        }));
        setSenderGlobal(false);
        setProductGlobal({});
        setError("");
        setPreview(bill);
        w.refresh();
        w.toast(`บันทึกบิล ${issued.number} ลงฐานข้อมูลแล้ว`);
      } catch (cause) {
        setError(`บันทึกบิลไม่สำเร็จ: ${(cause as Error).message}`);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (issue) {
      setOperations((current) => {
        const next = structuredClone(current);
        const timestamp = new Date().toISOString();
        let relation = activeRelation(next, f.receiverId, f.senderId);
        if (!relation) {
          next.relations.push({
            id: newId(),
            receiverId: f.receiverId,
            senderId: f.senderId,
            defaultPayment: payment,
            billingCycle: f.billingCycle,
            creditDays: f.days,
            active: true,
            createdAt: timestamp,
            updatedAt: timestamp,
          });
        } else {
          relation.defaultPayment = payment;
          relation.billingCycle = f.billingCycle;
          relation.creditDays = f.days;
          relation.updatedAt = timestamp;
        }
        for (const row of f.lines) {
          let relationProduct = next.relationProducts.find(
            (item) =>
              item.receiverId === f.receiverId &&
              item.senderId === f.senderId &&
              item.catalogId === row.catalogId,
          );
          if (relationProduct) relationProduct.active = true;
          else
            next.relationProducts.push({
              id: newId(),
              receiverId: f.receiverId,
              senderId: f.senderId,
              catalogId: row.catalogId,
              active: true,
              createdAt: timestamp,
            });
          let link = next.receiverProducts.find(
            (item) =>
              item.receiverId === f.receiverId &&
              item.catalogId === row.catalogId,
          );
          if (link) link.active = true;
          else
            next.receiverProducts.push({
              id: newId(),
              receiverId: f.receiverId,
              catalogId: row.catalogId,
              active: true,
              createdAt: timestamp,
            });
          if (row.price !== null && !row.requestPrice) {
            addInitialPriceIfMissing(next, {
              receiverId: f.receiverId,
              senderId: f.senderId,
              catalogId: row.catalogId,
              payment,
              branch: f.branch,
              price: row.price,
              reason: "ราคาที่ต้นทางระบุครั้งแรก",
              approvedBy: "ผู้ดูแล NTD",
            });
          }
          if (row.requestPrice) {
            const requestKey = pairRateKey(
              f.receiverId,
              f.senderId,
              row.catalogId,
              payment,
              f.branch,
            );
            if (!pendingPriceRequest(next, requestKey))
              next.priceRequests.push({
                id: newId(),
                key: requestKey,
                receiverId: f.receiverId,
                senderId: f.senderId,
                catalogId: row.catalogId,
                payment,
                branch: f.branch,
                billNumber: bill.number,
                quantity: row.quantity,
                proposedPrice: null,
                approvedPrice: null,
                actualCollectedAmount: null,
                status: "PENDING_PRICE",
                requestedAt: timestamp,
                note: "ต้นทางไม่ได้ระบุราคา",
              });
          }
        }
        return next;
      });
      setState((s) => ({
        ...s,
        bills: [bill, ...s.bills],
        drafts: blank(loginOpener.id),
        merchandise: {
          ...s.merchandise,
          [f.receiverId]: [
            ...new Set([
              ...(s.merchandise[f.receiverId] || []),
              ...f.lines.map((l) => l.catalogId),
            ]),
          ],
        },
        relations: {
          ...s.relations,
          [f.receiverId]: [
            ...new Set([...(s.relations[f.receiverId] || []), f.senderId]),
          ],
        },
      }));
      setSenderGlobal(false);
      setProductGlobal({});
      w.toast(`บันทึกบิล ${bill.number}`);
    }
    setError("");
    setPreview(bill);
  }

  if (!remoteReady) return <Loading />;

  return (
    <div className="reception-desk">
      <header className="desk-heading">
        <div>
          <h1>เปิดบิลรับสินค้า</h1>
          <span>สำนักงานใหญ่ กรุงเทพฯ · {thaiDate(new Date())}</span>
        </div>
        <div className="desk-heading-actions">
          <Field label="ผู้เปิดบิล" required>
            <select
              aria-label="ผู้เปิดบิล"
              value={f.openedByEmployeeId}
              onChange={(event) =>
                patch({ openedByEmployeeId: event.target.value })
              }
            >
              <option value="">
                {openerChoices.length
                  ? "เลือกผู้เปิดบิล"
                  : "ยังไม่มีรายชื่อพนักงาน"}
              </option>
              {openerChoices.map((employee) => (
                <option key={employee.id} value={employee.id}>
                  {employee.nickname || employee.name}
                </option>
              ))}
            </select>
          </Field>
          <Button disabled={busy} onClick={() => setReset(true)}>
            <Plus size={16} />
            บิลใหม่
          </Button>
        </div>
      </header>
      <form
        ref={formRef}
        className="desk-layout"
        onSubmit={(e) => {
          e.preventDefault();
          void buildBill(true);
        }}
      >
        <div className="desk-main">
          <div className="desk-parties">
            <section className="desk-party" aria-label="ข้อมูลผู้รับ">
              <h2>
                <span>01</span>ผู้รับ
              </h2>
              <Picker
                label="ชื่อผู้รับ"
                selected={f.receiverId}
                choices={partyChoices("receiver")}
                onSelect={selectReceiver}
                onAdd={(q) => startAdd("receiver", q)}
              />
              <div className="desk-party-details">
                <UserRound size={14} />
                <span>
                  {receiver
                    ? receiver.phone || "ไม่ระบุเบอร์โทร"
                    : "ยังไม่ได้เลือกผู้รับ"}
                </span>
              </div>
              <p className="desk-address">{receiver?.address || " "}</p>
              {receiver?.note && (
                <p className="desk-party-note">{receiver.note}</p>
              )}
              <Field label="สาขาปลายทาง">
                <select
                  aria-label="สาขาปลายทาง"
                  value={f.branch}
                  disabled={!receiver}
                  onChange={(e) =>
                    patch(reprice({ ...f, branch: e.target.value }))
                  }
                >
                  <option value="">เลือกสาขา</option>
                  {BRANCH_OPTIONS.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
              {branch && (
                <div
                  className="desk-branch"
                  style={{ "--branch": branch.color } as CSSProperties}
                >
                  <MapPin size={13} />
                  {branch.code}
                  <span>
                    {state.defaults[f.receiverId] === f.branch
                      ? "ค่าเริ่มต้นของผู้รับ"
                      : "เปลี่ยนเฉพาะบิลนี้"}
                  </span>
                </div>
              )}
            </section>
            <section className="desk-party" aria-label="ข้อมูลผู้ส่ง">
              <h2>
                <span>02</span>ผู้ส่ง
              </h2>
              <Picker
                key={f.receiverId}
                label="ชื่อผู้ส่ง"
                selected={f.senderId}
                choices={partyChoices("sender")}
                disabled={!receiver}
                global={senderGlobal}
                onGlobal={() => setSenderGlobal(true)}
                onSelect={selectSender}
                onAdd={(q) => startAdd("sender", q)}
              />
              <div className="desk-party-details">
                <UserRound size={14} />
                <span>
                  {sender
                    ? sender.phone || "ไม่ระบุเบอร์โทร"
                    : "ยังไม่ได้เลือกผู้ส่ง"}
                </span>
              </div>
              <p className="desk-address">{sender?.address || " "}</p>
              {sender?.note && <p className="desk-party-note">{sender.note}</p>}
              <Field label="การชำระเงิน">
                <select
                  aria-label="การชำระเงิน"
                  value={f.payment}
                  disabled={!sender}
                  onChange={(e) =>
                    patch(
                      reprice({ ...f, payment: e.target.value as PaymentMode }),
                    )
                  }
                >
                  <option value="">กรุณาเลือกประเภทการชำระเงิน</option>
                  {Object.entries(PAYMENT_LABELS).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
              <div className="desk-payment-source">
                <CreditCard size={13} />
                {sender && activeRelation(operations, f.receiverId, f.senderId)
                  ? "ข้อตกลงเดิมของคู่ผู้ส่ง–ผู้รับ"
                  : sender
                    ? "จับคู่ครั้งแรก: ต้องเลือกเองก่อนบันทึก"
                    : "เลือกผู้ส่งเพื่อดูข้อตกลง"}
              </div>
            </section>
          </div>
          <section className="desk-goods">
            <header>
              <h2>
                <span>03</span>รายการสินค้า
              </h2>
              <span>{f.lines.length} รายการ</span>
            </header>
            <div className="desk-lines">
              <div className="desk-line-header">
                <span>#</span>
                <span>สินค้า / หน่วยนับ</span>
                <span>จำนวน</span>
                <span>ราคา/หน่วย</span>
                <span>รวม</span>
                <span />
              </div>
              {f.lines.map((row, i) => (
                <div className="desk-line" key={row.id}>
                  <span className="desk-index">{i + 1}</span>
                  <Picker
                    label={`สินค้า ${i + 1}`}
                    selected={row.catalogId}
                    choices={productChoices(row)}
                    disabled={!sender}
                    global={!!productGlobal[row.id]}
                    onGlobal={() =>
                      setProductGlobal((v) => ({ ...v, [row.id]: true }))
                    }
                    onSelect={(id) => selectItem(row.id, id)}
                    onAdd={(q) =>
                      setAdding({ kind: "product", lineId: row.id, query: q })
                    }
                  />
                  <input
                    id={`qty-${row.id}`}
                    aria-label={`จำนวน ${i + 1}`}
                    type="number"
                    min="0.0001"
                    step="0.0001"
                    value={row.quantity || ""}
                    onChange={(e) =>
                      patch({
                        taxOverride: null,
                        lines: f.lines.map((l) =>
                          l.id === row.id
                            ? { ...l, quantity: Number(e.target.value) }
                            : l,
                        ),
                      })
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        const next = blankLine();
                        patch({ lines: [...f.lines, next] });
                        requestAnimationFrame(() => {
                          const all =
                            formRef.current?.querySelectorAll<HTMLInputElement>(
                              '.desk-lines [role="combobox"]',
                            );
                          all?.[all.length - 1]?.focus();
                        });
                      }
                    }}
                  />
                  <div className="desk-price-edit">
                    <input
                      aria-label={`ราคา ${i + 1}`}
                      type="number"
                      min="0"
                      step="0.01"
                      disabled={!row.catalogId || row.requestPrice}
                      value={row.price ?? ""}
                      placeholder={row.requestPrice ? "รอราคา" : "ราคา"}
                      onChange={(e) =>
                        patch({
                          taxOverride: null,
                          lines: f.lines.map((l) =>
                            l.id === row.id
                              ? {
                                  ...l,
                                  price:
                                    e.target.value === ""
                                      ? null
                                      : Number(e.target.value),
                                  requestPrice: false,
                                }
                              : l,
                          ),
                        })
                      }
                    />
                    <label className={row.requestPrice ? "active" : ""}>
                      <input
                        type="checkbox"
                        aria-label={`ขอราคา ${i + 1}`}
                        disabled={!row.catalogId}
                        checked={row.requestPrice}
                        onChange={(e) =>
                          patch({
                            taxOverride: null,
                            lines: f.lines.map((l) =>
                              l.id === row.id
                                ? {
                                    ...l,
                                    requestPrice: e.target.checked,
                                    price: e.target.checked
                                      ? null
                                      : price(row, f),
                                  }
                                : l,
                            ),
                          })
                        }
                      />
                      ขอราคา
                    </label>
                  </div>
                  <strong className="desk-row-total">
                    {row.price === null ? "—" : money(row.price * row.quantity)}
                  </strong>
                  <IconButton
                    label={`ลบสินค้า ${i + 1}`}
                    disabled={f.lines.length === 1}
                    onClick={() =>
                      patch({
                        lines: f.lines.filter((l) => l.id !== row.id),
                        taxOverride: null,
                      })
                    }
                  >
                    <Trash2 size={16} />
                  </IconButton>
                  <details className="desk-line-measures">
                    <summary>น้ำหนัก / ขนาด</summary>
                    <MeasurementFields
                      value={row}
                      onChange={(values) =>
                        patch({
                          lines: f.lines.map((l) =>
                            l.id === row.id ? { ...l, ...values } : l,
                          ),
                        })
                      }
                    />
                  </details>
                </div>
              ))}
            </div>
            <footer>
              <Button
                type="button"
                className="text-button"
                disabled={!sender || f.lines.length >= 100}
                onClick={() => patch({ lines: [...f.lines, blankLine()] })}
              >
                <Plus size={16} />
                เพิ่มรายการ
              </Button>
              <span>
                รวม {f.lines.reduce((sum, l) => sum + l.quantity, 0)} หน่วย
              </span>
            </footer>
            <details className="desk-optional">
              <summary>
                หมายเหตุบิล <ChevronDown size={15} />
              </summary>
              <Field label="หมายเหตุ">
                <input
                  value={f.note}
                  onChange={(e) => patch({ note: e.target.value })}
                />
              </Field>
            </details>
          </section>
          {state.bills.length > 0 && (
            <section className="desk-recent">
              <h2>บิลที่บันทึกในเครื่องนี้</h2>
              {state.bills.slice(0, 4).map((b) => (
                <button type="button" key={b.id} onClick={() => setPreview(b)}>
                  <span>{b.number}</span>
                  <b>{b.receiver.display_name}</b>
                  <span>
                    {b.amounts.pending ? "รอราคา" : money(b.amounts.due)}
                  </span>
                </button>
              ))}
            </section>
          )}
        </div>
        <aside className="desk-summary">
          <h2>
            <FileText size={18} />
            สรุปบิล
          </h2>
          <div className="desk-route">
            กรุงเทพฯ <ArrowRight size={16} />
            <b>{branch?.name || "ปลายทาง"}</b>
          </div>
          <p className="desk-payer">
            <Banknote size={15} />
            {f.payment ? PAYMENT_LABELS[f.payment] : "ยังไม่เลือกการชำระเงิน"}
            <small>
              ผู้จ่าย:{" "}
              {f.payment && f.payment.endsWith("ORIGIN")
                ? sender?.display_name || "ผู้ส่ง"
                : receiver?.display_name || "ผู้รับ"}
            </small>
          </p>
          {f.payment && f.payment.startsWith("CREDIT") && (
            <div className="desk-credit-cycle">
              <Field label="รอบวางบิล">
                <select
                  value={f.billingCycle}
                  onChange={(e) =>
                    patch({
                      billingCycle: e.target.value as Draft["billingCycle"],
                    })
                  }
                >
                  <option value="MONTH_END">สิ้นเดือน</option>
                  <option value="NET_DAYS">กำหนดจำนวนวัน</option>
                </select>
              </Field>
              {f.billingCycle === "NET_DAYS" ? (
                <Field label="เครดิต (วัน)">
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={f.days}
                    onChange={(e) => patch({ days: Number(e.target.value) })}
                  />
                </Field>
              ) : (
                <p>
                  รอบเดือน{" "}
                  {new Intl.DateTimeFormat("th-TH", {
                    month: "long",
                    year: "numeric",
                  }).format(new Date())}
                </p>
              )}
            </div>
          )}
          <div className="desk-total-line">
            <span>ค่าขนส่งรวม</span>
            <b>{amount.pending ? "รอราคา" : money(before.subtotal)}</b>
          </div>
          <div className="desk-total-line">
            <label htmlFor="desk-discount">ส่วนลดเฉพาะบิล</label>
            <input
              id="desk-discount"
              disabled={amount.pending && f.discount === 0}
              type="number"
              min="0"
              step="0.01"
              value={f.discount || ""}
              placeholder="0.00"
              onChange={(e) =>
                patch({ discount: Number(e.target.value), taxOverride: null })
              }
            />
          </div>
          {f.discount > 0 && (
            <Field label="เหตุผลส่วนลด">
              <input
                value={f.reason}
                onChange={(e) => patch({ reason: e.target.value })}
              />
            </Field>
          )}
          <div className="desk-before-tax">
            <span>ยอดรวมก่อนหัก</span>
            <strong>{amount.pending ? "รอราคา" : money(before.total)}</strong>
          </div>
          <div className="desk-tax">
            <label>
              <input
                type="checkbox"
                checked={f.withholding}
                onChange={(e) =>
                  patch({ withholding: e.target.checked, taxOverride: null })
                }
              />
              หัก ณ ที่จ่าย 1%
            </label>
            <input
              aria-label="ยอดหัก ณ ที่จ่าย"
              disabled={!f.withholding || amount.pending}
              type="number"
              min="0"
              step="0.01"
              value={amount.pending ? "" : withheld}
              onChange={(e) =>
                patch({
                  taxOverride:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
          </div>
          <label className="desk-round">
            <input
              type="checkbox"
              checked={f.roundCash}
              disabled={amount.pending}
              onChange={(e) => patch({ roundCash: e.target.checked })}
            />
            ปัดยอดรับเป็นบาทเต็ม
          </label>
          {f.roundCash && !amount.pending && (
            <div className="desk-total-line">
              <span>ปรับเศษยอดรับ</span>
              <b>
                {amount.rounding > 0 ? "+" : ""}
                {money(amount.rounding)}
              </b>
            </div>
          )}
          <div className="desk-grand">
            <span>ยอดรับสุทธิ</span>
            <strong>
              {amount.pending ? "รอราคา" : `฿ ${money(amount.due)}`}
            </strong>
          </div>
          {f.payment === "CASH_ORIGIN" && (
            <label className="desk-round">
              <input
                type="checkbox"
                checked={f.collect}
                disabled={amount.pending}
                onChange={(e) => patch({ collect: e.target.checked })}
              />
              รับเงินต้นทางแล้ว
            </label>
          )}
          {error && (
            <p className="desk-error" role="alert">
              {error}
            </p>
          )}
          <Button busy={busy} type="submit" className="primary full">
            <Printer size={17} />
            {amount.pending ? "บันทึกบิลรอราคา" : "บันทึกและเปิดใบพิมพ์"}
          </Button>
          <Button
            type="button"
            className="full"
            onClick={() => void buildBill(false)}
          >
            <FileText size={16} />
            ตรวจบิล
          </Button>
        </aside>
      </form>
      {adding && (
        <IntakeEntryForm
          key={`${adding.kind}-${adding.lineId || ""}`}
          mode={adding.kind}
          query={adding.query}
          parties={state.parties}
          catalog={state.catalog}
          defaultBranch={adding.kind === "sender" ? "BKK" : undefined}
          onClose={() => setAdding(null)}
          onParty={(party, branchCode) => {
            const partyRole = adding.kind === "sender" ? "sender" : "receiver";
            setState((s) => ({
              ...s,
              parties: s.parties.some((p) => p.id === party.id)
                ? s.parties
                : [...s.parties, party],
              partyRoles: {
                ...(s.partyRoles || {}),
                [party.id]: {
                  ...(s.partyRoles?.[party.id] || {
                    receiver: false,
                    sender: false,
                  }),
                  [partyRole]: true,
                },
              },
              defaults:
                adding.kind === "receiver" &&
                branchCode &&
                !s.defaults[party.id]
                  ? { ...s.defaults, [party.id]: branchCode }
                  : s.defaults,
            }));
            if (adding.kind === "receiver") {
              selectReceiver(party.id);
              if (state.defaults[party.id] || branchCode)
                patch({ branch: state.defaults[party.id] || branchCode });
            } else {
              selectSender(party.id);
            }
            setAdding(null);
          }}
          onProduct={({ item, price: enteredPrice, requestPrice }) => {
            if (adding.lineId)
              setProductGlobal((v) => ({ ...v, [adding.lineId!]: false }));
            const nextLine = {
              ...f.lines.find((l) => l.id === adding.lineId)!,
              catalogId: item.id,
              price: enteredPrice,
              requestPrice,
              weight: item.weight || "",
              width: item.width || "",
              length: item.length || "",
              height: item.height || "",
            };
            setState((s) => ({
              ...s,
              // A bill-only entered price must not silently become a standard rate.
              rates: s.rates,
              catalog: s.catalog.some((c) => c.id === item.id)
                ? s.catalog
                : [...s.catalog, item],
              merchandise: {
                ...s.merchandise,
                [f.receiverId]: [
                  ...new Set([...(s.merchandise[f.receiverId] || []), item.id]),
                ],
              },
              drafts: {
                ...s.drafts,
                collect: false,
                taxOverride: null,
                lines: s.drafts.lines.map((l) =>
                  l.id === adding.lineId ? nextLine : l,
                ),
              },
            }));
            setAdding(null);
          }}
        />
      )}
      {reset && (
        <Modal title="เริ่มบิลใหม่" onClose={() => setReset(false)}>
          <div className="modal-body modal-confirm">
            <p>ล้างข้อมูลร่างบิลปัจจุบัน?</p>
            <Button
              className="primary"
              onClick={() => {
                patch(blank(loginOpener.id));
                setReset(false);
                setError("");
                setSenderGlobal(false);
                setProductGlobal({});
              }}
            >
              เริ่มบิลใหม่
            </Button>
          </div>
        </Modal>
      )}
      {fractionalWarning && (
        <Modal
          title="ตรวจสอบจำนวนสินค้า"
          onClose={() => setFractionalWarning(false)}
        >
          <div className="modal-body modal-confirm">
            <p>พบจำนวนสินค้าที่มีทศนิยม กรุณาตรวจสอบว่าใส่จำนวนถูกต้องหรือไม่</p>
            <div className="alert warning">
              {f.lines
                .filter((line) => !Number.isInteger(line.quantity))
                .map((line, index) => {
                  const item = state.catalog.find(
                    (catalog) => catalog.id === line.catalogId,
                  );
                  return (
                    <div key={line.id}>
                      รายการ {index + 1}: {item?.name || "สินค้า"} {line.quantity}{" "}
                      {item?.unit || "หน่วย"}
                    </div>
                  );
                })}
            </div>
            <div className="modal-footer">
              <Button onClick={() => setFractionalWarning(false)}>
                กลับไปแก้
              </Button>
              <Button
                className="primary"
                onClick={() => {
                  setFractionalWarning(false);
                  void buildBill(true, true);
                }}
              >
                ยืนยันว่าถูกต้อง
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {preview && (
        <BillPreview bill={preview} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}

function BillPreview({
  bill: b,
  onClose,
}: {
  bill: Bill;
  onClose: () => void;
}) {
  return (
    <Modal title="ใบรับสินค้า / ใบขนส่ง" wide onClose={onClose}>
      <div className="desk-print-actions">
        <Button onClick={() => window.print()}>
          <Printer size={16} />
          พิมพ์
        </Button>
      </div>
      <article className="desk-paper">
        <header>
          <strong>NTD LOGISTICS</strong>
          <b>{b.number}</b>
        </header>
        <p>เอกสารตัวอย่าง · {thaiDate(b.date)}</p>
        <p>
          ผู้เปิดบิล:{" "}
          {b.openedBy?.nickname || b.openedBy?.name || "ไม่พบข้อมูล"}
        </p>
        <p>
          กรุงเทพฯ →{" "}
          {
            BRANCH_OPTIONS.find((branch) => branch.code === b.draft.branch)
              ?.name
          }
        </p>
        <div className="desk-paper-parties">
          <section>
            <b>ผู้รับ: {b.receiver.display_name}</b>
            <p>{b.receiver.phone}</p>
            <p>{b.receiver.address}</p>
          </section>
          <section>
            <b>ผู้ส่ง: {b.sender.display_name}</b>
            <p>{b.sender.phone}</p>
            <p>{b.sender.address}</p>
          </section>
        </div>
        <table>
          <thead>
            <tr>
              <th>สินค้า</th>
              <th>จำนวน</th>
              <th>หน่วย</th>
              <th>ราคา/หน่วย</th>
              <th>รวม</th>
            </tr>
          </thead>
          <tbody>
            {b.items.map((i) => (
              <tr key={i.id}>
                <td>
                  {i.name}
                  {i.weight && <small>น้ำหนัก {i.weight} กก.</small>}
                  {(i.width || i.length || i.height) && (
                    <small>
                      กว้าง × ยาว × สูง: {i.width || "–"} × {i.length || "–"} ×{" "}
                      {i.height || "–"} ซม.
                    </small>
                  )}
                </td>
                <td>{i.quantity}</td>
                <td>{i.unit}</td>
                <td>{i.price === null ? "รอราคา" : money(i.price)}</td>
                <td>
                  {i.price === null ? "รอราคา" : money(i.price * i.quantity)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          {b.draft.payment
            ? PAYMENT_LABELS[b.draft.payment]
            : "ยังไม่เลือกการชำระเงิน"}
        </p>
        {b.draft.payment && b.draft.payment.startsWith("CREDIT") && (
          <p>
            {b.draft.billingCycle === "MONTH_END"
              ? `วางบิลสิ้นเดือน · รอบ ${b.billingPeriod?.month || monthlyBillingPeriod(new Date(b.date)).month}`
              : `เครดิต ${b.draft.days} วัน`}
          </p>
        )}
        {b.draft.note && <p>หมายเหตุ: {b.draft.note}</p>}
        {b.draft.reason && <p>เหตุผลส่วนลด: {b.draft.reason}</p>}
        <div className="desk-paper-totals">
          {b.amounts.pending ? (
            <b>รอราคาปลายทาง</b>
          ) : (
            <>
              <p>
                ค่าขนส่งรวม <b>{money(b.amounts.subtotal)}</b>
              </p>
              <p>
                ส่วนลด <b>{money(b.draft.discount)}</b>
              </p>
              <p>
                ยอดรวมก่อนหัก <b>{money(b.amounts.total)}</b>
              </p>
              <p>
                หัก ณ ที่จ่าย <b>{money(b.withheld)}</b>
              </p>
              <p>
                ปรับเศษยอดรับ <b>{money(b.amounts.rounding)}</b>
              </p>
              <p>
                ยอดรับสุทธิ <b>{money(b.amounts.due)}</b>
              </p>
              <p>{b.draft.collect ? "รับเงินต้นทางแล้ว" : "ยังไม่รับเงิน"}</p>
            </>
          )}
        </div>
      </article>
    </Modal>
  );
}
