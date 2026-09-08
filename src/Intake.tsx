import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import {
  ArrowRight,
  Plus,
  Search,
  UserRound,
  MapPin,
  Package,
  Trash2,
  Banknote,
  CreditCard,
  Save,
  Printer,
  Eye,
  FlaskConical,
  FileText,
  Check,
  ChevronDown,
  CircleAlert,
} from "lucide-react";
import { useWorkspace } from "./context";
import { Button, Field, IconButton } from "./ui";
import {
  emptyItem,
  emptyShipment,
  lineTotal,
  localDate,
  money,
  number,
  shipmentSchema,
  thaiTime,
  totals,
} from "./domain";
import { demoParties, demoRate } from "./demo";
import type {
  DashboardStats,
  Item,
  Party,
  PartySnapshot,
  Shipment,
  ShipmentDetail,
  ShipmentInput,
} from "./types";
import { PAYMENT_LABELS } from "./types";
import Receipt from "./Receipt";

function PartyInput({
  title,
  kind,
  value,
  onChange,
  error,
}: {
  title: string;
  kind: "sender" | "receiver";
  value: PartySnapshot;
  onChange: (v: PartySnapshot) => void;
  error?: string;
}) {
  const w = useWorkspace(),
    [results, setResults] = useState<Party[]>([]),
    [open, setOpen] = useState(false),
    seq = useRef(0);
  useEffect(() => {
    if (!open) return;
    const n = ++seq.current;
    const timer = setTimeout(() => {
      void w.service
        .parties(value.display_name)
        .then((r) => {
          if (n === seq.current)
            setResults(r.rows.filter((p) => p.is_active).slice(0, 6));
        })
        .catch(() => setResults([]));
    }, 180);
    return () => clearTimeout(timer);
  }, [value.display_name, open, w.service]);
  return (
    <section className="party-form">
      <h3>
        <span className={"section-symbol " + kind}>
          <UserRound size={17} />
        </span>
        {title}
        {value.id && (
          <span className="mini-status">
            <Check size={12} />
            ลูกค้าเดิม
          </span>
        )}
      </h3>
      <div className="field autocomplete">
        <label htmlFor={kind + "-name"}>
          ชื่อ{title}
          <b className="required">*</b>
        </label>
        <div className="input-icon">
          <Search size={16} />
          <input
            id={kind + "-name"}
            autoComplete="off"
            placeholder="ค้นหาชื่อ / พิมพ์ชื่อลูกค้าใหม่"
            value={value.display_name}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onChange={(e) => {
              onChange({
                ...value,
                id: undefined,
                display_name: e.target.value,
              });
              setOpen(true);
            }}
            role="combobox"
            aria-expanded={open && results.length > 0}
            aria-controls={kind + "-options"}
          />
        </div>
        {open && results.length > 0 && (
          <div className="suggestions" id={kind + "-options"} role="listbox">
            {results.map((p) => (
              <button
                type="button"
                key={p.id}
                role="option"
                aria-selected={p.id === value.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onChange({
                    id: p.id,
                    display_name: p.display_name,
                    phone: p.phone,
                    address: p.address,
                  });
                  setOpen(false);
                }}
              >
                <b>{p.display_name}</b>
                <span>{p.phone}</span>
              </button>
            ))}
          </div>
        )}
        {error && <small className="field-error">{error}</small>}
      </div>
      <Field label="เบอร์โทรศัพท์" required>
        <input
          aria-label={"เบอร์โทรศัพท์" + title}
          inputMode="tel"
          autoComplete="off"
          placeholder="08x-xxx-xxxx"
          value={value.phone}
          onChange={(e) => onChange({ ...value, phone: e.target.value })}
        />
      </Field>
      <Field
        label={kind === "sender" ? "ที่อยู่ต้นทาง" : "ที่อยู่จัดส่ง"}
        required
      >
        <textarea
          aria-label={kind === "sender" ? "ที่อยู่ต้นทาง" : "ที่อยู่จัดส่ง"}
          rows={2}
          placeholder="บ้านเลขที่ ถนน ตำบล"
          value={value.address}
          onChange={(e) => onChange({ ...value, address: e.target.value })}
        />
      </Field>
    </section>
  );
}
const emptyStats: DashboardStats = {
  count: 0,
  quantity: 0,
  total: 0,
  collected: 0,
  pending: 0,
  zones: {},
};
export default function Intake() {
  const w = useWorkspace(),
    draftKey = "ntdtms-draft-" + (w.demo ? "demo" : w.profile.id),
    [form, setForm] = useState<ShipmentInput>(() => {
      try {
        return (
          JSON.parse(sessionStorage.getItem(draftKey) || "null") ||
          emptyShipment()
        );
      } catch {
        return emptyShipment();
      }
    });
  const [stats, setStats] = useState(emptyStats),
    [recent, setRecent] = useState<Shipment[]>([]),
    [errors, setErrors] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [preview, setPreview] = useState<ShipmentDetail | null>(null),
    [isDraft, setIsDraft] = useState(false),
    [dropoff, setDropoff] = useState(false);
  const [hasDraft, setHasDraft] = useState(false),
    submitting = useRef(false),
    [resetConfirm, setResetConfirm] = useState(false);
  const manager = ["owner", "admin"].includes(w.profile.role),
    t = totals(form.items, form.extra_charge, form.discount),
    zone = w.zones.find((z) => z.id === form.zone_id);
  useEffect(() => {
    let active = true;
    Promise.all([
      w.service.stats(localDate()),
      w.service.shipments({ date: localDate() }),
    ])
      .then(([s, r]) => {
        if (active) {
          setStats(s);
          setRecent(r.rows.slice(0, 4));
        }
      })
      .catch((e) => w.toast(e.message, true));
    return () => {
      active = false;
    };
  }, [w.service, w.revision]);
  useEffect(() => {
    sessionStorage.setItem(draftKey, JSON.stringify(form));
  }, [form, draftKey]);
  function patch(p: Partial<ShipmentInput>) {
    setForm((f) => ({ ...f, ...p }));
    setHasDraft(false);
  }
  function patchItem(id: string, p: Partial<Item>) {
    setForm((f) => ({
      ...f,
      items: f.items.map((i) => (i.id === id ? { ...i, ...p } : i)),
    }));
  }
  function setZone(id: string) {
    setForm((f) => ({
      ...f,
      zone_id: id,
      district_id: "",
      items: f.items.map((i) => ({
        ...i,
        unit_price: demoRate(w.rules, i, id) ?? i.unit_price,
      })),
    }));
  }
  function sample() {
    const z = w.zones.find((z) => z.code === "STI") || w.zones[0],
      p = w.products[0];
    const item = {
      ...emptyItem(),
      product_id: p.id,
      description: p.name,
      unit: p.unit,
      quantity: 6,
      unit_price:
        demoRate(w.rules, { ...emptyItem(), product_id: p.id }, z.id) ?? 40,
    };
    patch({
      ...emptyShipment(),
      sender: { ...demoParties[0] },
      receiver: { ...demoParties[3] },
      zone_id: z.id,
      district_id: z.districts[0].id,
      items: [item],
      collect_now: true,
      price_reason: "ราคาตัวอย่าง",
    });
  }
  function previewDraft() {
    if (!zone) {
      w.toast("กรุณาเลือกจังหวัดปลายทาง", true);
      return;
    }
    const d = new Date();
    d.setDate(
      d.getDate() +
        (form.payment_mode.startsWith("CREDIT") ? form.credit_days : 0),
    );
    setIsDraft(true);
    setPreview({
      id: "draft",
      shipment_no: "ร่าง · ยังไม่ได้ออกเลขบิล",
      received_at: new Date().toISOString(),
      sender_snapshot: form.sender,
      receiver_snapshot: form.receiver,
      zone_id: zone.id,
      district_id: form.district_id,
      zone_name: zone.name,
      district_name:
        zone.districts.find((d) => d.id === form.district_id)?.name || "",
      zone_color: zone.color,
      payment_mode: form.payment_mode,
      credit_days: form.payment_mode.startsWith("CREDIT")
        ? form.credit_days
        : 0,
      payer_party_id: "",
      total_amount: t.total,
      total_quantity: t.quantity,
      total_weight: t.weight,
      paid_amount: 0,
      outstanding_amount: t.total,
      shipment_status: "RECEIVED",
      note: form.note,
      dropoff_name: form.dropoff_name,
      dropoff_phone: form.dropoff_phone,
      extra_charge: form.extra_charge,
      discount: form.discount,
      price_reason: form.price_reason,
      invoice_id: "",
      due_date: localDate(d),
      created_by: w.profile.id,
      items: form.items,
      files: [],
    });
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (submitting.current) return;
    const result = shipmentSchema.safeParse(form);
    if (!result.success) {
      setErrors([...new Set(result.error.issues.map((i) => i.message))]);
      document
        .getElementById("form-errors")
        ?.scrollIntoView({ block: "center" });
      return;
    }
    const override =
      form.items.some(
        (i) => demoRate(w.rules, i, form.zone_id) !== i.unit_price,
      ) ||
      form.extra_charge !== 0 ||
      form.discount !== 0;
    if (override && (!manager || form.price_reason.trim().length < 3)) {
      setErrors(["ราคานอกตารางต้องให้ผู้ดูแลระบุเหตุผลอนุมัติ"]);
      return;
    }
    submitting.current = true;
    setBusy(true);
    setErrors([]);
    try {
      const s = await w.service.issue(form);
      setIsDraft(false);
      setPreview(s);
      setForm(emptyShipment());
      sessionStorage.removeItem(draftKey);
      w.refresh();
      w.toast(
        w.demo
          ? "ออกบิลตัวอย่างเรียบร้อย"
          : "ออกบิล " + s.shipment_no + " เรียบร้อย",
      );
    } catch (e) {
      setErrors([(e as Error).message]);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }
  const override =
    form.items.some(
      (i) =>
        i.description && demoRate(w.rules, i, form.zone_id) !== i.unit_price,
    ) ||
    form.extra_charge !== 0 ||
    form.discount !== 0;
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="breadcrumb">
            งานหน้าสาขา <span>/</span> รับสินค้า
          </div>
          <h1>
            รับสินค้าและออกบิล
            <span className="heading-dot" />
          </h1>
          <p>สำนักงานใหญ่ กรุงเทพฯ</p>
        </div>
        <div className="heading-actions">
          {w.demo && (
            <Button onClick={sample}>
              <FlaskConical size={16} />
              ใส่ข้อมูลตัวอย่าง
            </Button>
          )}
          <Button onClick={() => setResetConfirm(true)}>
            <Plus size={17} />
            เริ่มบิลใหม่
          </Button>
        </div>
      </div>
      <section className="daily-stats">
        <div>
          <span>
            <FileText size={16} />
            บิลวันนี้
          </span>
          <strong>
            {number(stats.count)}
            <small>ใบ</small>
          </strong>
        </div>
        <div>
          <span>
            <Package size={16} />
            สินค้ารับเข้า
          </span>
          <strong>
            {number(stats.quantity)}
            <small>หน่วย</small>
          </strong>
        </div>
        <div>
          <span>
            <Banknote size={16} />
            ค่าขนส่งวันนี้
          </span>
          <strong>
            <small>฿</small>
            {money(stats.total)}
          </strong>
        </div>
        <div>
          <span>
            <Check size={16} />
            รับเงินจากบิลวันนี้
          </span>
          <strong className="green-text">
            <small>฿</small>
            {money(stats.collected)}
          </strong>
        </div>
      </section>
      <form onSubmit={submit} noValidate>
        <div className="intake-layout">
          <div className="intake-main">
            <section className="form-section destination-section">
              <div className="section-heading">
                <h2>
                  <span className="step">01</span>ปลายทางจัดส่ง
                </h2>
                <span className="muted small">3 จังหวัด</span>
              </div>
              <div
                className="destination-grid"
                role="radiogroup"
                aria-label="จังหวัดปลายทาง"
              >
                {w.zones.map((z) => (
                  <button
                    key={z.id}
                    type="button"
                    className={
                      "destination " + (zone?.id === z.id ? "selected" : "")
                    }
                    role="radio"
                    aria-checked={zone?.id === z.id}
                    onClick={() => setZone(z.id)}
                    style={{ "--zone": z.color } as CSSProperties}
                  >
                    <div className="destination-top">
                      <span className="zone-dot" />
                      <strong>{z.name}</strong>
                      <span className="radio-indicator">
                        {zone?.id === z.id && <Check size={11} />}
                      </span>
                    </div>
                    <div className="destination-bottom">
                      <span>
                        {z.code} <ArrowRight size={12} />
                      </span>
                      <span>{stats.zones[z.id]?.count || 0} บิลวันนี้</span>
                    </div>
                  </button>
                ))}
              </div>
              <div className="district-row">
                <span>
                  <MapPin size={15} />
                  อำเภอ<b className="required">*</b>
                </span>
                {zone ? (
                  <div role="radiogroup" aria-label="อำเภอปลายทาง">
                    {zone.districts.map((d) => (
                      <label
                        key={d.id}
                        className={
                          "district " +
                          (form.district_id === d.id ? "active" : "")
                        }
                        style={{ "--zone": zone.color } as CSSProperties}
                      >
                        <input
                          type="radio"
                          name="district"
                          value={d.id}
                          checked={form.district_id === d.id}
                          onChange={() => patch({ district_id: d.id })}
                        />
                        {d.name}
                      </label>
                    ))}
                  </div>
                ) : (
                  <span className="muted">ยังไม่ได้เลือกจังหวัด</span>
                )}
              </div>
            </section>
            <section className="form-section">
              <div className="section-heading">
                <h2>
                  <span className="step">02</span>ผู้ส่งและผู้รับ
                </h2>
                <span className="route-label">
                  กรุงเทพฯ <ArrowRight size={13} />
                  {zone?.name || "ปลายทาง"}
                </span>
              </div>
              <div className="parties-grid">
                <PartyInput
                  title="ผู้ส่ง"
                  kind="sender"
                  value={form.sender}
                  onChange={(v) => patch({ sender: v })}
                />
                <PartyInput
                  title="ผู้รับ"
                  kind="receiver"
                  value={form.receiver}
                  onChange={(v) => patch({ receiver: v })}
                />
              </div>
              <button
                type="button"
                className="disclosure"
                onClick={() => setDropoff(!dropoff)}
                aria-expanded={dropoff}
              >
                <Plus size={14} />
                ผู้นำสินค้ามาส่งเป็นคนละคนกับผู้ส่ง
                <ChevronDown size={15} className={dropoff ? "rotate" : ""} />
              </button>
              {dropoff && (
                <div className="two-fields">
                  <Field label="ชื่อผู้นำส่ง">
                    <input
                      value={form.dropoff_name}
                      onChange={(e) => patch({ dropoff_name: e.target.value })}
                    />
                  </Field>
                  <Field label="เบอร์โทรผู้นำส่ง">
                    <input
                      value={form.dropoff_phone}
                      onChange={(e) => patch({ dropoff_phone: e.target.value })}
                    />
                  </Field>
                </div>
              )}
            </section>
            <section className="form-section product-section">
              <div className="section-heading">
                <h2>
                  <span className="step">03</span>รายการสินค้า
                  <span className="count-badge">{form.items.length}</span>
                </h2>
                <span className="muted small">ราคาเป็นบาท</span>
              </div>
              <div className="item-table-scroll">
                <table className="item-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>ชื่อสินค้า</th>
                      <th>จำนวน</th>
                      <th>หน่วย</th>
                      <th>ราคา/หน่วย</th>
                      <th className="numeric">รวม</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {form.items.map((item, n) => (
                      <tr key={item.id}>
                        <td>{String(n + 1).padStart(2, "0")}</td>
                        <td>
                          <input
                            aria-label={"ชื่อสินค้า " + (n + 1)}
                            list="product-list"
                            value={item.description}
                            placeholder="เลือกหรือพิมพ์ชื่อสินค้า"
                            onChange={(e) => {
                              const p = w.products.find(
                                (p) => p.name === e.target.value,
                              );
                              patchItem(item.id, {
                                description: e.target.value,
                                product_id: p?.id || "",
                                unit: p?.unit || item.unit,
                                unit_price: p
                                  ? (demoRate(
                                      w.rules,
                                      { ...item, product_id: p.id },
                                      form.zone_id,
                                    ) ?? 0)
                                  : item.unit_price,
                              });
                            }}
                          />
                          <label className="fragile">
                            <input
                              type="checkbox"
                              checked={item.fragile}
                              onChange={(e) =>
                                patchItem(item.id, {
                                  fragile: e.target.checked,
                                })
                              }
                            />
                            ระวังแตก
                          </label>
                        </td>
                        <td>
                          <input
                            aria-label={"จำนวน " + (n + 1)}
                            type="number"
                            min="0.0001"
                            step="0.0001"
                            value={item.quantity || ""}
                            onChange={(e) =>
                              patchItem(item.id, {
                                quantity: Number(e.target.value),
                              })
                            }
                          />
                        </td>
                        <td>
                          <select
                            aria-label={"หน่วย " + (n + 1)}
                            value={item.unit}
                            onChange={(e) =>
                              patchItem(item.id, { unit: e.target.value })
                            }
                          >
                            {[
                              "กล่อง",
                              "ลัง",
                              "มัด",
                              "กระสอบ",
                              "พาเลท",
                              "ชิ้น",
                              "ถุง",
                              "กก.",
                            ].map((u) => (
                              <option key={u}>{u}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <input
                            aria-label={"ราคาต่อหน่วย " + (n + 1)}
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unit_price || ""}
                            placeholder="0.00"
                            onChange={(e) =>
                              patchItem(item.id, {
                                unit_price: Number(e.target.value),
                              })
                            }
                          />
                        </td>
                        <td className="numeric item-total">
                          {money(lineTotal(item))}
                        </td>
                        <td>
                          <IconButton
                            label={"ลบสินค้า " + (n + 1)}
                            disabled={form.items.length === 1}
                            onClick={() =>
                              patch({
                                items: form.items.filter(
                                  (i) => i.id !== item.id,
                                ),
                              })
                            }
                          >
                            <Trash2 size={16} />
                          </IconButton>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <datalist id="product-list">
                {w.products.map((p) => (
                  <option value={p.name} key={p.id} />
                ))}
              </datalist>
              <div className="item-table-footer">
                <Button
                  type="button"
                  className="text-button"
                  disabled={form.items.length >= 100}
                  onClick={() => patch({ items: [...form.items, emptyItem()] })}
                >
                  <Plus size={16} />
                  เพิ่มรายการสินค้า
                </Button>
                <span>
                  รวม <b>{number(t.quantity)}</b> หน่วย
                </span>
              </div>
              <div className="two-fields">
                <Field label="น้ำหนักรวม (กก.)">
                  <input
                    type="number"
                    min="0"
                    step="0.0001"
                    value={t.weight || ""}
                    placeholder="0"
                    onChange={(e) =>
                      patch({
                        items: form.items.map((i, n) => ({
                          ...i,
                          weight: n === 0 ? Number(e.target.value) : 0,
                        })),
                      })
                    }
                  />
                </Field>
                <Field label="หมายเหตุ / ข้อควรระวัง">
                  <input
                    value={form.note}
                    maxLength={2000}
                    placeholder="ระบุรายละเอียดเพิ่มเติม"
                    onChange={(e) => patch({ note: e.target.value })}
                  />
                </Field>
              </div>
            </section>
          </div>
          <aside className="intake-aside">
            <section className="bill-summary">
              <header>
                <div className="summary-symbol">
                  <FileText size={20} />
                </div>
                <div>
                  <h2>สรุปใบรับสินค้า</h2>
                  <span>
                    บิลใหม่ <span className="separator">·</span>{" "}
                    {w.demo ? "ตัวอย่าง" : "รอออกเลขเอกสาร"}
                  </span>
                </div>
              </header>
              <div className="summary-body">
                <h3>การชำระเงิน</h3>
                <div
                  className="payment-options"
                  role="radiogroup"
                  aria-label="ประเภทชำระเงิน"
                >
                  {Object.entries(PAYMENT_LABELS).map(([key, label]) => (
                    <label
                      className={
                        "payment-option " +
                        (form.payment_mode === key ? "active" : "")
                      }
                      key={key}
                    >
                      <input
                        type="radio"
                        name="payment-mode"
                        checked={form.payment_mode === key}
                        onChange={() =>
                          patch({
                            payment_mode: key as ShipmentInput["payment_mode"],
                            collect_now: false,
                          })
                        }
                      />
                      {key.startsWith("CASH") ? (
                        <Banknote size={17} />
                      ) : (
                        <CreditCard size={17} />
                      )}
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                {form.payment_mode.startsWith("CREDIT") && (
                  <Field label="เครดิตเทอม">
                    <select
                      value={form.credit_days}
                      onChange={(e) =>
                        patch({ credit_days: Number(e.target.value) })
                      }
                    >
                      {[7, 15, 30, 45, 60].map((n) => (
                        <option key={n} value={n}>
                          {n} วัน
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                <div className="payer-line">
                  <UserRound size={14} />
                  <span>ผู้ชำระเงิน</span>
                  <b>
                    {form.payment_mode.endsWith("ORIGIN") ? "ผู้ส่ง" : "ผู้รับ"}
                  </b>
                </div>
                <div className="summary-divider" />
                <div className="summary-line">
                  <span>ค่าขนส่ง</span>
                  <b>{money(t.subtotal)}</b>
                </div>
                <div className="summary-line">
                  <label htmlFor="extra-charge">ค่าบริการเพิ่ม</label>
                  <div className="amount-input">
                    <span>฿</span>
                    <input
                      id="extra-charge"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.extra_charge || ""}
                      placeholder="0.00"
                      onChange={(e) =>
                        patch({ extra_charge: Number(e.target.value) })
                      }
                    />
                  </div>
                </div>
                <div className="summary-line">
                  <label htmlFor="discount">ส่วนลด</label>
                  <div className="amount-input">
                    <span>฿</span>
                    <input
                      id="discount"
                      type="number"
                      min="0"
                      step="0.01"
                      value={form.discount || ""}
                      placeholder="0.00"
                      onChange={(e) =>
                        patch({ discount: Number(e.target.value) })
                      }
                    />
                  </div>
                </div>
                {override && (
                  <Field label="เหตุผลอนุมัติราคานอกตาราง" required>
                    <input
                      placeholder="เหตุผลการใช้ราคานี้"
                      value={form.price_reason}
                      onChange={(e) => patch({ price_reason: e.target.value })}
                      disabled={!manager}
                    />
                  </Field>
                )}
                <div className="grand-total">
                  <span>ยอดรวมสุทธิ</span>
                  <strong>
                    <small>฿</small>
                    {money(t.total)}
                  </strong>
                </div>
                {form.payment_mode === "CASH_ORIGIN" ? (
                  <label className="collect-check">
                    <input
                      type="checkbox"
                      checked={form.collect_now}
                      onChange={(e) => patch({ collect_now: e.target.checked })}
                    />
                    <span>รับเงินสดครบแล้ว</span>
                    <Check size={16} />
                  </label>
                ) : (
                  <div className="collection-note">
                    <CircleAlert size={15} />
                    {form.payment_mode === "CASH_DESTINATION"
                      ? "รอเรียกเก็บเงินที่ปลายทาง"
                      : "บันทึกเป็นยอดค้างชำระ"}
                  </div>
                )}
                <div id="form-errors">
                  {errors.length > 0 && (
                    <div className="alert error" role="alert">
                      {errors.map((e) => (
                        <div key={e}>{e}</div>
                      ))}
                    </div>
                  )}
                </div>
                <Button
                  type="submit"
                  className="primary full issue-button"
                  busy={busy}
                >
                  <Printer size={18} />
                  ออกบิลและเปิดใบรับสินค้า
                  <ArrowRight size={16} />
                </Button>
                <div className="secondary-actions">
                  <Button type="button" onClick={previewDraft}>
                    <Eye size={16} />
                    ตรวจบิล
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      sessionStorage.setItem(draftKey, JSON.stringify(form));
                      setHasDraft(true);
                      w.toast("เก็บร่างไว้ในแท็บนี้แล้ว");
                    }}
                  >
                    {hasDraft ? <Check size={16} /> : <Save size={16} />}
                    เก็บร่าง
                  </Button>
                </div>
              </div>
              <footer>
                <span className="status-dot" />
                {w.demo
                  ? "โหมดทดลอง · เก็บในเครื่องนี้"
                  : "บันทึกผ่านระบบบริษัท"}
              </footer>
            </section>
            <section className="recent-bills">
              <div className="section-heading">
                <h3>บิลล่าสุดวันนี้</h3>
                <span className="count-badge">{stats.count}</span>
              </div>
              {recent.length === 0 ? (
                <p className="muted small">ยังไม่มีบิลวันนี้</p>
              ) : (
                recent.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={async () => {
                      try {
                        setPreview(await w.service.detail(s.id));
                        setIsDraft(false);
                      } catch (e) {
                        w.toast((e as Error).message, true);
                      }
                    }}
                  >
                    <span
                      className="recent-zone"
                      style={{ background: s.zone_color }}
                    />
                    <div>
                      <b>{s.receiver_snapshot.display_name}</b>
                      <span>
                        {s.zone_name} · {thaiTime(s.received_at)}
                      </span>
                    </div>
                    <strong>{money(s.total_amount)}</strong>
                  </button>
                ))
              )}
            </section>
          </aside>
        </div>
      </form>
      {preview && (
        <Receipt
          shipment={preview}
          draft={isDraft}
          onClose={() => setPreview(null)}
        />
      )}{" "}
      {resetConfirm && (
        <div className="reset-confirm">
          <span>เริ่มบิลใหม่และล้างร่างปัจจุบัน?</span>
          <Button
            onClick={() => {
              setForm(emptyShipment());
              setErrors([]);
              setResetConfirm(false);
            }}
          >
            เริ่มบิลใหม่
          </Button>
          <Button onClick={() => setResetConfirm(false)}>กลับ</Button>
        </div>
      )}
    </>
  );
}
