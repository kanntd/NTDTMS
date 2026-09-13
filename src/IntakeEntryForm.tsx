import { useState } from "react";
import { Check, Plus } from "lucide-react";
import { Button, EditableSelect, Field, Modal } from "./ui";
import { BRANCH_OPTIONS, PROVINCE_OPTIONS } from "./intakeData";
import {
  entryId,
  measurementFields,
  normalizeEntry,
  validMeasurements,
  type CatalogItem,
  type IntakeParty,
  type Measurements,
  type ProductEntry,
} from "./intakeEntryData";

export function MeasurementFields({
  value,
  onChange,
}: {
  value: Measurements;
  onChange: (value: Measurements) => void;
}) {
  return (
    <div className="desk-measure-fields">
      {measurementFields.map(([key, label]) => (
        <Field key={key} label={label}>
          <input
            type="number"
            min="0"
            step="any"
            value={value[key] || ""}
            onChange={(e) => onChange({ ...value, [key]: e.target.value })}
          />
        </Field>
      ))}
    </div>
  );
}

export default function IntakeEntryForm({
  mode,
  query,
  parties,
  catalog,
  defaultBranch,
  onClose,
  onParty,
  onProduct,
}: {
  mode: "receiver" | "sender" | "product";
  query: string;
  parties: IntakeParty[];
  catalog: CatalogItem[];
  defaultBranch?: string;
  onClose: () => void;
  onParty: (party: IntakeParty, branch: string) => void;
  onProduct: (entry: ProductEntry) => void;
}) {
  const [name, setName] = useState(query);
  const [prefix, setPrefix] = useState("");
  const [taxId, setTaxId] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [district, setDistrict] = useState("");
  const [province, setProvince] = useState("");
  const [branch, setBranch] = useState(defaultBranch || "");
  const [note, setNote] = useState("");
  const [unit, setUnit] = useState("กล่อง");
  const [price, setPrice] = useState("");
  const [requestPrice, setRequestPrice] = useState(false);
  const [measurements, setMeasurements] = useState<Measurements>({});
  const [error, setError] = useState("");
  const productMode = mode === "product";
  const units = [
    ...new Set([
      "กล่อง",
      "มัด",
      "กระสอบ",
      "ลัง",
      "ชิ้น",
      "ถุง",
      "พาเลท",
      ...catalog.map((c) => c.unit),
    ]),
  ].sort((a, b) => a.localeCompare(b, "th"));
  const prefixes = [
    ...new Set([
      "บจก",
      "หจก",
      "นาย",
      "นาง",
      "นางสาว",
      "ร้าน",
      ...parties.map((party) => party.prefix || ""),
    ]),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "th"));
  const provinces = [
    ...new Set([
      ...PROVINCE_OPTIONS,
      ...parties.map((party) => party.province || ""),
    ]),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "th"));
  const provinceRequired = mode === "receiver";
  const selectedUnit = unit.trim();
  const existingProduct = catalog.find(
    (c) => normalizeEntry(c.name) === normalizeEntry(name),
  );
  const exactProduct = catalog.find(
    (c) =>
      normalizeEntry(c.name) === normalizeEntry(name) &&
      normalizeEntry(c.unit) === normalizeEntry(selectedUnit),
  );
  const displayName = [prefix, name.trim()].filter(Boolean).join(" ");
  const duplicates = productMode
    ? []
    : parties.filter(
        (p) =>
          (name.trim() &&
            normalizeEntry(p.display_name).includes(normalizeEntry(name))) ||
          (taxId.trim() && p.tax_id === taxId.trim()) ||
          (phone.trim().length > 5 &&
            normalizeEntry(p.phone) === normalizeEntry(phone)),
      );
  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("กรุณาระบุชื่อ");
      return;
    }
    if (productMode) {
      if (!selectedUnit || !validMeasurements(measurements)) {
        setError("กรุณาตรวจสอบหน่วยนับ น้ำหนัก และขนาด");
        return;
      }
      if (
        !requestPrice &&
        (!price.trim() || !Number.isFinite(Number(price)) || Number(price) < 0)
      ) {
        setError("กรุณาระบุราคา หรือเลือกขอราคา");
        return;
      }
      const productId = existingProduct?.productId || crypto.randomUUID();
      const knownUnit =
        units.find((u) => normalizeEntry(u) === normalizeEntry(selectedUnit)) ||
        selectedUnit;
      onProduct({
        item: {
          ...(exactProduct || {
            id: entryId(productId, knownUnit),
            productId,
            name: existingProduct?.name || name.trim(),
            unit: knownUnit,
          }),
          ...measurements,
        },
        price: requestPrice ? null : Number(price),
        requestPrice,
      });
      return;
    }
    if ((provinceRequired && !province.trim()) || !branch) {
      setError(
        provinceRequired
          ? "กรุณาระบุชื่อ จังหวัด และสาขา"
          : "กรุณาระบุชื่อและสาขา",
      );
      return;
    }
    const duplicate = parties.find(
      (p) =>
        normalizeEntry(p.display_name) === normalizeEntry(displayName) ||
        (taxId.trim() && p.tax_id === taxId.trim()),
    );
    if (duplicate) {
      setError(
        "มีชื่อนี้หรือเลขผู้เสียภาษีนี้แล้ว กรุณาเลือกรายชื่อเดิมด้านล่าง",
      );
      return;
    }
    onParty(
      {
        id: crypto.randomUUID(),
        prefix,
        name: name.trim(),
        display_name: displayName,
        tax_id: taxId.trim(),
        phone: phone.trim(),
        address_detail: address.trim(),
        district: district.trim(),
        province: province.trim(),
        address: [address.trim(), district.trim(), province.trim()]
          .filter(Boolean)
          .join(" "),
        branch_code: branch,
        note: note.trim(),
        credit_days: 30,
        credit_limit: 50000,
        is_active: true,
      },
      branch,
    );
  }
  return (
    <Modal
      title={
        productMode
          ? "เพิ่มสินค้า / หน่วยนับ"
          : mode === "receiver"
            ? "เพิ่มผู้รับ"
            : "เพิ่มผู้ส่ง"
      }
      wide
      onClose={onClose}
    >
      <form className="desk-add" onSubmit={submit}>
        {productMode ? (
          <>
            <Field label="ชื่อสินค้า" required>
              <input
                autoFocus
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <div className="desk-entry-grid">
              <Field label="หน่วยนับ" required>
                <EditableSelect
                  required
                  value={unit}
                  options={units}
                  onChange={setUnit}
                  customLabel="เพิ่ม / แก้ไขหน่วยนับ"
                />
              </Field>
              <Field label="ราคา / หน่วย" required={!requestPrice}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  disabled={requestPrice}
                  required={!requestPrice}
                  value={requestPrice ? "" : price}
                  onChange={(e) => setPrice(e.target.value)}
                />
              </Field>
            </div>
            <label className="desk-entry-check">
              <input
                type="checkbox"
                checked={requestPrice}
                onChange={(e) => setRequestPrice(e.target.checked)}
              />
              ขอราคา
            </label>
            <MeasurementFields
              value={measurements}
              onChange={setMeasurements}
            />
          </>
        ) : (
          <>
            <div className="desk-name-grid">
              <Field label="คำนำหน้า">
                <EditableSelect
                  value={prefix}
                  options={prefixes}
                  onChange={setPrefix}
                  customLabel="เพิ่ม / แก้ไขคำนำหน้า"
                />
              </Field>
              <Field label="ชื่อ" required>
                <input
                  autoFocus
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </Field>
            </div>
            <div className="desk-entry-grid">
              <Field label="เลขประจำตัวผู้เสียภาษี">
                <input
                  inputMode="numeric"
                  value={taxId}
                  onChange={(e) => setTaxId(e.target.value)}
                />
              </Field>
              <Field label="เบอร์โทร">
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </Field>
            </div>
            <Field label="ที่อยู่">
              <textarea
                rows={2}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </Field>
            <div className="desk-entry-grid">
              <Field label="อำเภอ / เขต">
                <input
                  value={district}
                  onChange={(e) => setDistrict(e.target.value)}
                />
              </Field>
              <Field label="จังหวัด" required={provinceRequired}>
                <EditableSelect
                  required={provinceRequired}
                  value={province}
                  options={provinces}
                  onChange={setProvince}
                  emptyLabel="ไม่ระบุจังหวัด"
                  customLabel="เพิ่ม / แก้ไขจังหวัด"
                  ariaLabel="จังหวัด"
                />
              </Field>
              <Field label="สาขา" required>
                <select
                  required
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                >
                  <option value="">เลือกสาขา</option>
                  {mode === "sender" && (
                    <option value="BKK">กรุงเทพฯ (ต้นทาง)</option>
                  )}
                  {BRANCH_OPTIONS.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <Field label="หมายเหตุ">
              <textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </Field>
            {duplicates.length > 0 && (
              <div className="desk-duplicates">
                <p>รายชื่อที่ตรงหรือใกล้เคียง</p>
                {duplicates.map((p) => (
                  <Button
                    type="button"
                    key={p.id}
                    onClick={() => onParty(p, p.branch_code || "")}
                  >
                    {p.display_name}
                    {p.phone ? ` · ${p.phone}` : ""}
                  </Button>
                ))}
              </div>
            )}
          </>
        )}
        {error && (
          <p className="desk-error" role="alert">
            {error}
          </p>
        )}
        <div className="desk-entry-actions">
          <Button type="button" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button type="submit" className="primary">
            <Check size={16} />
            {exactProduct && productMode
              ? "เลือกสินค้าเข้าบิล"
              : "บันทึกและเลือก"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
