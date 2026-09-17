import { useMemo, useState } from "react";
import { AlertTriangle, Plus, Save, Trash2 } from "lucide-react";
import {
  billEditAccessMessage,
  canEditShipment,
  editReasonRequired,
} from "./billEditPolicy";
import { useWorkspace } from "./context";
import type { IntakeRegistrySnapshot } from "./intakeRegistry";
import type { OperationsState } from "./operationsStore";
import {
  PAYMENT_LABELS,
  type PaymentMode,
  type ShipmentDetail,
  type ShipmentEditInput,
} from "./types";
import { Button, Field, IconButton, Modal } from "./ui";

type EditLine = {
  id: string;
  catalogId: string;
  quantity: string;
  price: string;
  requestPrice: boolean;
  weight: string;
  width: string;
  length: string;
  height: string;
};

const textNumber = (value?: number | null) =>
  value === null || value === undefined ? "" : String(value);

export default function ShipmentEditModal({
  shipment,
  registry,
  operations,
  onClose,
  onSaved,
}: {
  shipment: ShipmentDetail;
  registry: IntakeRegistrySnapshot;
  operations: OperationsState;
  onClose: () => void;
  onSaved: (shipment: ShipmentDetail) => void;
}) {
  const w = useWorkspace();
  const existingRelation = operations.relations.find(
    (row) =>
      row.active &&
      row.receiverId === shipment.receiver_party_id &&
      row.senderId === shipment.sender_party_id,
  );
  const [receiverId, setReceiverId] = useState(
    shipment.receiver_party_id || shipment.receiver_snapshot.id || "",
  );
  const [senderId, setSenderId] = useState(
    shipment.sender_party_id || shipment.sender_snapshot.id || "",
  );
  const [branch, setBranch] = useState(shipment.destination_branch_code || "");
  const [payment, setPayment] = useState<PaymentMode>(shipment.payment_mode);
  const [creditDays, setCreditDays] = useState(
    String(shipment.credit_days || 30),
  );
  const [billingCycle, setBillingCycle] = useState<"MONTH_END" | "NET_DAYS">(
    existingRelation?.billingCycle || "MONTH_END",
  );
  const [discount, setDiscount] = useState(String(shipment.discount || 0));
  const [discountReason, setDiscountReason] = useState(
    shipment.price_reason || "",
  );
  const [withholding, setWithholding] = useState(
    String(shipment.withholding_amount || 0),
  );
  const [note, setNote] = useState(shipment.note || "");
  const [reason, setReason] = useState("");
  const [lines, setLines] = useState<EditLine[]>(() =>
    shipment.items.map((item) => ({
      id: item.id,
      catalogId: item.product_unit_id || item.product_id,
      quantity: textNumber(item.quantity),
      price: item.price_pending ? "" : textNumber(item.unit_price),
      requestPrice: Boolean(item.price_pending),
      weight: textNumber(item.weight),
      width: textNumber(item.width),
      length: textNumber(item.length),
      height: textNumber(item.height),
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const allowed = canEditShipment(w.profile.role, shipment.shipment_status);
  const reasonRequired = editReasonRequired(shipment.shipment_status);
  const activeCatalog = useMemo(
    () =>
      registry.catalog
        .filter(
          (item) =>
            (
              registry.raw.catalogActive as Record<string, boolean> | undefined
            )?.[item.id] !== false,
        )
        .sort((a, b) =>
          `${a.name} ${a.unit}`.localeCompare(`${b.name} ${b.unit}`, "th"),
        ),
    [registry],
  );
  const pairCatalogIds = useMemo(
    () =>
      new Set(
        operations.relationProducts
          .filter(
            (row) =>
              row.active &&
              row.receiverId === receiverId &&
              row.senderId === senderId,
          )
          .map((row) => row.catalogId),
      ),
    [operations.relationProducts, receiverId, senderId],
  );
  const pairedCatalog = activeCatalog.filter((item) =>
    pairCatalogIds.has(item.id),
  );
  const otherCatalog = activeCatalog.filter(
    (item) => !pairCatalogIds.has(item.id),
  );
  const receiverOptions = registry.parties
    .filter(
      (party) =>
        party.is_active !== false && registry.partyRoles[party.id]?.receiver,
    )
    .sort((a, b) => a.display_name.localeCompare(b.display_name, "th"));
  const relatedSenderIds = new Set(
    operations.relations
      .filter((row) => row.active && row.receiverId === receiverId)
      .map((row) => row.senderId),
  );
  const senderOptions = registry.parties
    .filter(
      (party) =>
        party.is_active !== false && registry.partyRoles[party.id]?.sender,
    )
    .sort((a, b) => {
      const relationOrder =
        Number(relatedSenderIds.has(b.id)) - Number(relatedSenderIds.has(a.id));
      return (
        relationOrder || a.display_name.localeCompare(b.display_name, "th")
      );
    });
  const branchOptions = w.branches
    .filter(
      (row) =>
        row.is_active &&
        (row.code === branch ||
          row.branch_kind === "DESTINATION" ||
          row.branch_kind === "BOTH"),
    )
    .sort((a, b) => a.name.localeCompare(b.name, "th"));

  function currentPrice(catalogId: string) {
    const agreement = operations.agreements.find(
      (row) =>
        row.active &&
        row.receiverId === receiverId &&
        row.senderId === senderId &&
        row.catalogId === catalogId &&
        row.payment === payment &&
        row.branch === branch,
    );
    return operations.priceVersions.find(
      (version) => version.id === agreement?.currentVersionId,
    )?.price;
  }

  function catalogFor(id: string) {
    return registry.catalog.find((item) => item.id === id);
  }

  function updateLine(id: string, patch: Partial<EditLine>) {
    setLines((current) =>
      current.map((line) => (line.id === id ? { ...line, ...patch } : line)),
    );
  }

  function chooseProduct(lineId: string, catalogId: string) {
    const catalog = catalogFor(catalogId);
    const price = currentPrice(catalogId);
    updateLine(lineId, {
      catalogId,
      price: price === undefined ? "" : String(price),
      requestPrice: price === undefined,
      weight: catalog?.weight || "",
      width: catalog?.width || "",
      length: catalog?.length || "",
      height: catalog?.height || "",
    });
  }

  function addLine() {
    const catalog = pairedCatalog[0] || activeCatalog[0];
    const price = catalog ? currentPrice(catalog.id) : undefined;
    setLines((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        catalogId: catalog?.id || "",
        quantity: "1",
        price: price === undefined ? "" : String(price),
        requestPrice: price === undefined,
        weight: catalog?.weight || "",
        width: catalog?.width || "",
        length: catalog?.length || "",
        height: catalog?.height || "",
      },
    ]);
  }

  const subtotal = lines.reduce(
    (sum, line) =>
      sum + (Number(line.quantity) || 0) * (Number(line.price) || 0),
    0,
  );
  const total = Math.max(0, subtotal - (Number(discount) || 0));
  const due = Math.max(0, total - (Number(withholding) || 0));

  async function save() {
    if (!allowed) return;
    if (!receiverId || !senderId || !branch) {
      setError("กรุณาเลือกผู้รับ ผู้ส่ง และสาขาปลายทาง");
      return;
    }
    if (
      !lines.length ||
      lines.some((line) => !line.catalogId || Number(line.quantity) <= 0)
    ) {
      setError("กรุณาระบุสินค้าและจำนวนให้ครบ");
      return;
    }
    if (lines.some((line) => !line.requestPrice && line.price.trim() === "")) {
      setError("รายการที่ไม่ขอราคาต้องระบุราคา");
      return;
    }
    if (reasonRequired && reason.trim().length < 3) {
      setError("บิลขึ้นรถแล้ว กรุณาระบุเหตุผลแก้ไขอย่างน้อย 3 ตัวอักษร");
      return;
    }
    const receiver = registry.parties.find((party) => party.id === receiverId);
    const sender = registry.parties.find((party) => party.id === senderId);
    if (!receiver || !sender) {
      setError("ไม่พบผู้รับหรือผู้ส่งในข้อมูลกลาง");
      return;
    }
    const data: ShipmentEditInput = {
      version_no: shipment.version_no || 1,
      receiver_id: receiverId,
      sender_id: senderId,
      receiver: {
        id: receiver.id,
        display_name: receiver.display_name,
        phone: receiver.phone,
        address: receiver.address,
      },
      sender: {
        id: sender.id,
        display_name: sender.display_name,
        phone: sender.phone,
        address: sender.address,
      },
      destination_branch_code: branch,
      payment_mode: payment,
      credit_days: payment.startsWith("CREDIT") ? Number(creditDays) || 30 : 0,
      billing_cycle: billingCycle,
      discount: Number(discount) || 0,
      discount_reason: discountReason.trim(),
      withholding_amount: Number(withholding) || 0,
      note: note.trim(),
      items: lines.map((line) => {
        const catalog = catalogFor(line.catalogId)!;
        return {
          id: line.id,
          catalog_id: line.catalogId,
          name: catalog.name,
          unit: catalog.unit,
          quantity: Number(line.quantity),
          price: line.requestPrice ? null : Number(line.price),
          request_price: line.requestPrice,
          weight: line.weight.trim() || undefined,
          width: line.width.trim() || undefined,
          length: line.length.trim() || undefined,
          height: line.height.trim() || undefined,
        };
      }),
    };
    setBusy(true);
    setError("");
    try {
      const updated = await w.service.updateBill(
        shipment.id,
        data,
        reason.trim(),
      );
      w.refresh();
      w.toast(`แก้ไขบิล ${shipment.shipment_no} แล้ว`);
      onSaved(updated);
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      title={`แก้ไขบิล ${shipment.shipment_no}`}
      onClose={busy ? () => {} : onClose}
      wide
    >
      <form
        className="bill-edit-form"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <div className={`bill-edit-notice ${allowed ? "" : "locked"}`}>
          <AlertTriangle size={18} />
          <span>
            {billEditAccessMessage(w.profile.role, shipment.shipment_status)}
          </span>
        </div>

        <div className="bill-edit-grid">
          <Field label="ผู้รับ" required>
            <select
              value={receiverId}
              onChange={(event) => setReceiverId(event.target.value)}
              disabled={!allowed}
            >
              <option value="">เลือกผู้รับ</option>
              {receiverOptions.map((party) => (
                <option key={party.id} value={party.id}>
                  {party.display_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ผู้ส่ง" required>
            <select
              value={senderId}
              onChange={(event) => setSenderId(event.target.value)}
              disabled={!allowed}
            >
              <option value="">เลือกผู้ส่ง</option>
              {senderOptions.map((party) => (
                <option key={party.id} value={party.id}>
                  {party.display_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="สาขาปลายทาง" required>
            <select
              value={branch}
              onChange={(event) => setBranch(event.target.value)}
              disabled={!allowed}
            >
              <option value="">เลือกสาขา</option>
              {branchOptions.map((row) => (
                <option key={row.id} value={row.code}>
                  {row.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ประเภทการชำระเงิน" required>
            <select
              value={payment}
              onChange={(event) =>
                setPayment(event.target.value as PaymentMode)
              }
              disabled={!allowed}
            >
              {(Object.keys(PAYMENT_LABELS) as PaymentMode[]).map((mode) => (
                <option key={mode} value={mode}>
                  {PAYMENT_LABELS[mode]}
                </option>
              ))}
            </select>
          </Field>
          {payment.startsWith("CREDIT") && (
            <>
              <Field label="รอบวางบิล">
                <select
                  value={billingCycle}
                  onChange={(event) =>
                    setBillingCycle(
                      event.target.value as "MONTH_END" | "NET_DAYS",
                    )
                  }
                  disabled={!allowed}
                >
                  <option value="MONTH_END">สิ้นเดือน</option>
                  <option value="NET_DAYS">ตามจำนวนวันเครดิต</option>
                </select>
              </Field>
              <Field label="เครดิต (วัน)">
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={creditDays}
                  onChange={(event) => setCreditDays(event.target.value)}
                  disabled={!allowed}
                />
              </Field>
            </>
          )}
        </div>

        <div className="bill-edit-items-heading">
          <div>
            <h3>รายการสินค้า</h3>
            <p>
              รายการของคู่ผู้รับ–ผู้ส่งจะแสดงก่อน
              แล้วจึงเป็นสินค้าอื่นในข้อมูลกลาง
            </p>
          </div>
          <Button type="button" onClick={addLine} disabled={!allowed}>
            <Plus size={16} /> เพิ่มรายการ
          </Button>
        </div>
        <div className="bill-edit-items-wrap">
          <table className="bill-edit-items">
            <thead>
              <tr>
                <th>สินค้า / หน่วย</th>
                <th>จำนวน</th>
                <th>ราคา/หน่วย</th>
                <th>ขอราคา</th>
                <th aria-label="ลบ" />
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.id}>
                  <td>
                    <select
                      value={line.catalogId}
                      onChange={(event) =>
                        chooseProduct(line.id, event.target.value)
                      }
                      disabled={!allowed}
                    >
                      <option value="">เลือกสินค้า</option>
                      {!!pairedCatalog.length && (
                        <optgroup label="สินค้าของคู่นี้">
                          {pairedCatalog.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.name} · {item.unit}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="สินค้าอื่นในข้อมูลกลาง">
                        {otherCatalog.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} · {item.unit}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </td>
                  <td>
                    <input
                      aria-label="จำนวน"
                      type="number"
                      min="0.0001"
                      step="0.0001"
                      value={line.quantity}
                      onChange={(event) =>
                        updateLine(line.id, { quantity: event.target.value })
                      }
                      disabled={!allowed}
                    />
                  </td>
                  <td>
                    <input
                      aria-label="ราคาต่อหน่วย"
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.price}
                      placeholder={line.requestPrice ? "รอราคา" : "0.00"}
                      onChange={(event) =>
                        updateLine(line.id, { price: event.target.value })
                      }
                      disabled={!allowed || line.requestPrice}
                    />
                  </td>
                  <td>
                    <label className="bill-edit-price-request">
                      <input
                        type="checkbox"
                        checked={line.requestPrice}
                        onChange={(event) =>
                          updateLine(line.id, {
                            requestPrice: event.target.checked,
                            price: event.target.checked
                              ? ""
                              : line.price ||
                                String(currentPrice(line.catalogId) || 0),
                          })
                        }
                        disabled={!allowed}
                      />
                      <span>ขอราคา</span>
                    </label>
                  </td>
                  <td>
                    <IconButton
                      label="ลบรายการ"
                      disabled={!allowed || lines.length === 1}
                      onClick={() =>
                        setLines((current) =>
                          current.filter((item) => item.id !== line.id),
                        )
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

        <div className="bill-edit-grid bill-edit-totals-inputs">
          <Field label="ส่วนลด (บาท)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={discount}
              onChange={(event) => setDiscount(event.target.value)}
              disabled={!allowed}
            />
          </Field>
          <Field label="เหตุผลส่วนลด">
            <input
              value={discountReason}
              onChange={(event) => setDiscountReason(event.target.value)}
              disabled={!allowed}
            />
          </Field>
          <Field label="หัก ณ ที่จ่าย (บาท)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={withholding}
              onChange={(event) => setWithholding(event.target.value)}
              disabled={!allowed}
            />
          </Field>
          <Field label="หมายเหตุ">
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              disabled={!allowed}
            />
          </Field>
        </div>
        <div className="bill-edit-summary">
          <span>
            รวมก่อนหัก{" "}
            <b>
              {subtotal.toLocaleString("th-TH", { minimumFractionDigits: 2 })}
            </b>
          </span>
          <span>
            ยอดบิล{" "}
            <b>{total.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</b>
          </span>
          <span>
            ยอดสุทธิหลังหัก{" "}
            <b>{due.toLocaleString("th-TH", { minimumFractionDigits: 2 })}</b>
          </span>
        </div>
        <Field
          label={
            reasonRequired
              ? "เหตุผลการแก้ไขหลังขึ้นรถ"
              : "เหตุผลการแก้ไข (ไม่บังคับ)"
          }
          required={reasonRequired}
        >
          <textarea
            value={reason}
            minLength={reasonRequired ? 3 : undefined}
            required={reasonRequired}
            onChange={(event) => setReason(event.target.value)}
            disabled={!allowed}
            rows={3}
          />
        </Field>
        {error && <p className="bill-edit-error">{error}</p>}
        <div className="modal-footer">
          <Button type="button" onClick={onClose} disabled={busy}>
            ปิด
          </Button>
          <Button
            type="submit"
            className="primary"
            busy={busy}
            disabled={!allowed}
          >
            <Save size={16} /> บันทึกการแก้ไข
          </Button>
        </div>
      </form>
    </Modal>
  );
}
