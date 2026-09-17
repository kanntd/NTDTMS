import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Printer,
  Truck,
  Check,
  Banknote,
  XCircle,
  ImagePlus,
  Download,
  FileText,
} from "lucide-react";
import { useWorkspace } from "./context";
import { Button, Field, Modal } from "./ui";
import {
  downloadBlob,
  lineTotal,
  money,
  number,
  thaiDate,
  thaiTime,
} from "./domain";
import { PAYMENT_LABELS, STATUS_LABELS, type ShipmentDetail } from "./types";
import { photoBlob, uploadPhoto } from "./api";

function Paper({
  shipment: s,
  demo,
  draft,
}: {
  shipment: ShipmentDetail;
  demo: boolean;
  draft: boolean;
}) {
  return (
    <article className="receipt-paper">
      <header className="receipt-brand">
        <div>
          <Truck size={28} />
          <div>
            <strong>NTD LOGISTICS</strong>
            <span>ใบรับสินค้า / ใบขนส่ง</span>
          </div>
        </div>
        <div>
          <b>{s.shipment_no}</b>
          <span>
            {thaiDate(s.received_at)} · {thaiTime(s.received_at)} น.
          </span>
        </div>
      </header>
      {(draft || demo) && (
        <div className="receipt-watermark">
          {draft ? "ร่างเอกสาร" : "เอกสารตัวอย่าง · ไม่ใช่บิลจริง"}
        </div>
      )}
      <div className="receipt-route" style={{ borderColor: s.zone_color }}>
        <div>
          <small>ต้นทาง</small>
          <b>กรุงเทพมหานคร</b>
        </div>
        <span>→</span>
        <div>
          <small>ปลายทาง</small>
          <b>
            {s.zone_name} · {s.district_name}
          </b>
        </div>
      </div>
      <div className="receipt-parties">
        <section>
          <span>ผู้ส่ง</span>
          <h3>{s.sender_snapshot.display_name || "—"}</h3>
          <p>{s.sender_snapshot.phone}</p>
          <p>{s.sender_snapshot.address}</p>
        </section>
        <section>
          <span>ผู้รับ</span>
          <h3>{s.receiver_snapshot.display_name || "—"}</h3>
          <p>{s.receiver_snapshot.phone}</p>
          <p>{s.receiver_snapshot.address}</p>
        </section>
      </div>
      <table className="receipt-items">
        <thead>
          <tr>
            <th>#</th>
            <th>รายการสินค้า</th>
            <th className="numeric">จำนวน</th>
            <th>หน่วย</th>
            <th className="numeric">ราคา/หน่วย</th>
            <th className="numeric">รวม (บาท)</th>
          </tr>
        </thead>
        <tbody>
          {s.items.map((i, n) => (
            <tr key={i.id}>
              <td>{n + 1}</td>
              <td>
                {i.description}
                {i.fragile && <small> · ระวังแตก</small>}
              </td>
              <td className="numeric">{number(i.quantity)}</td>
              <td>{i.unit}</td>
              <td className="numeric">{money(i.unit_price)}</td>
              <td className="numeric">{money(lineTotal(i))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="receipt-bottom">
        <section>
          <b>{PAYMENT_LABELS[s.payment_mode]}</b>
          {s.credit_days > 0 && (
            <p>
              เครดิต {s.credit_days} วัน · ครบกำหนด {thaiDate(s.due_date)}
            </p>
          )}
          <p>
            รวม {number(s.total_quantity)} หน่วย · น้ำหนัก{" "}
            {number(s.total_weight)} กก.
          </p>
          {s.dropoff_name && (
            <p>
              ผู้นำส่ง: {s.dropoff_name} {s.dropoff_phone}
            </p>
          )}
          {s.note && <p>หมายเหตุ: {s.note}</p>}
          {s.shipment_status === "CANCELLED" && (
            <strong className="danger-text">เอกสารยกเลิก</strong>
          )}
        </section>
        <section className="receipt-totals">
          <div>
            <span>ค่าขนส่ง</span>
            <b>{money(s.total_amount - s.extra_charge + s.discount)}</b>
          </div>
          <div>
            <span>ค่าบริการเพิ่มเติม</span>
            <b>{money(s.extra_charge)}</b>
          </div>
          <div>
            <span>ส่วนลด</span>
            <b>{money(s.discount)}</b>
          </div>
          <div className="grand">
            <span>ยอดรวมสุทธิ</span>
            <b>฿ {money(s.total_amount)}</b>
          </div>
          <div>
            <span>รับชำระแล้ว</span>
            <b>{money(s.paid_amount)}</b>
          </div>
          <div>
            <span>คงเหลือ</span>
            <b>{money(s.outstanding_amount)}</b>
          </div>
        </section>
      </div>
      <div className="receipt-signatures">
        <span>ผู้ส่ง / ผู้นำส่งสินค้า</span>
        <span>พนักงานรับสินค้า</span>
        <span>ผู้รับสินค้า</span>
      </div>
      <footer>เอกสารรับสินค้า · ไม่ใช่ใบกำกับภาษี</footer>
    </article>
  );
}
export default function Receipt({
  shipment,
  onClose,
  draft = false,
  autoPrint = false,
}: {
  shipment: ShipmentDetail;
  onClose: () => void;
  draft?: boolean;
  autoPrint?: boolean;
}) {
  const w = useWorkspace(),
    [s, setS] = useState(shipment),
    [action, setAction] = useState(""),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState(""),
    [amount, setAmount] = useState(shipment.outstanding_amount),
    [method, setMethod] = useState("CASH"),
    [reference, setReference] = useState(""),
    [request, setRequest] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (!autoPrint) return;
    const timer = window.setTimeout(() => window.print(), 120);
    return () => window.clearTimeout(timer);
  }, [autoPrint]);
  const canWrite = ["owner", "admin", "clerk"].includes(w.profile.role),
    canCollect = [...["owner", "admin", "clerk"], "accountant"].includes(
      w.profile.role,
    ),
    manager = ["owner", "admin"].includes(w.profile.role);
  async function run(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await fn();
      setS(await w.service.detail(s.id));
      w.refresh();
      setAction("");
      setRequest(crypto.randomUUID());
      w.toast(message);
    } catch (e) {
      w.toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      w.toast("รองรับ JPG, PNG, WebP ขนาดไม่เกิน 5 MB", true);
      return;
    }
    if (w.demo) {
      w.toast("ไฟล์รูปเก็บได้เมื่อเข้าสู่ระบบจริงและเปิดบริการ R2 แล้ว", true);
      return;
    }
    await run(() => uploadPhoto(s.id, file), "แนบรูปเรียบร้อย");
  }
  return (
    <Modal
      title={draft ? "ตรวจบิลก่อนบันทึก" : s.shipment_no}
      onClose={busy ? () => {} : onClose}
      wide
    >
      <div className="receipt-toolbar">
        <span className={"badge status-" + s.shipment_status}>
          {draft ? "ร่าง" : STATUS_LABELS[s.shipment_status]}
        </span>
        <div>
          {!draft && canWrite && s.shipment_status !== "CANCELLED" && (
            <label className="button">
              <ImagePlus size={16} />
              แนบรูป
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                disabled={busy}
                onChange={(e) => {
                  if (e.target.files?.[0]) void upload(e.target.files[0]);
                  e.target.value = "";
                }}
              />
            </label>
          )}
          <Button onClick={() => window.print()}>
            <Printer size={16} />
            {draft ? "พิมพ์ร่าง" : "พิมพ์ใบรับสินค้า"}
          </Button>
        </div>
      </div>
      <div className="paper-container">
        <Paper shipment={s} demo={w.demo} draft={draft} />
      </div>
      {createPortal(
        <div className="print-output">
          <Paper shipment={s} demo={w.demo} draft={draft} />
        </div>,
        document.body,
      )}
      {!draft && (
        <div className="receipt-actions">
          {s.files.length > 0 && (
            <div className="attached-files">
              {s.files.map((f) => (
                <Button
                  key={f.id}
                  onClick={async () => {
                    try {
                      downloadBlob(f.filename, await photoBlob(f.id));
                    } catch (e) {
                      w.toast((e as Error).message, true);
                    }
                  }}
                >
                  <Download size={15} />
                  {f.filename}
                </Button>
              ))}
            </div>
          )}
          {action === "collect" ? (
            <form
              className="action-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await w.service.collect(
                    s.id,
                    amount,
                    method,
                    reference,
                    request,
                  );
                  setAmount(Math.max(0, s.outstanding_amount - amount));
                  setReference("");
                }, "บันทึกรับเงินแล้ว");
              }}
            >
              <Field label="ยอดรับเงิน (บาท)">
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  max={s.outstanding_amount}
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  required
                />
              </Field>
              <Field label="วิธีรับเงิน">
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                >
                  <option value="CASH">เงินสด</option>
                  <option value="TRANSFER">โอนธนาคาร</option>
                  <option value="QR">QR Payment</option>
                </select>
              </Field>
              <Field label="เลขอ้างอิง">
                <input
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                />
              </Field>
              <Button type="submit" busy={busy} className="primary">
                <Check size={16} />
                ยืนยันรับเงิน
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => setAction("")}
              >
                กลับ
              </Button>
            </form>
          ) : action === "cancel" ? (
            <form
              className="action-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run(
                  () => w.service.status(s.id, "CANCELLED", reason),
                  "ยกเลิกบิลแล้ว",
                );
              }}
            >
              <Field label="เหตุผลยกเลิก" className="grow">
                <input
                  minLength={3}
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </Field>
              <Button className="danger" busy={busy} type="submit">
                ยืนยันยกเลิกบิล
              </Button>
              <Button
                type="button"
                disabled={busy}
                onClick={() => setAction("")}
              >
                กลับ
              </Button>
            </form>
          ) : (
            <>
              <div>
                {manager &&
                  s.shipment_status === "RECEIVED" &&
                  s.paid_amount === 0 && (
                    <Button
                      className="text-danger"
                      onClick={() => setAction("cancel")}
                    >
                      <XCircle size={16} />
                      ยกเลิกบิล
                    </Button>
                  )}
              </div>
              <div>
                {canWrite && s.shipment_status === "RECEIVED" && (
                  <Button
                    busy={busy}
                    onClick={() =>
                      run(
                        () => w.service.status(s.id, "IN_TRANSIT"),
                        "เปลี่ยนเป็นกำลังขนส่งแล้ว",
                      )
                    }
                  >
                    <Truck size={16} />
                    เริ่มขนส่ง
                  </Button>
                )}
                {canWrite && s.shipment_status === "IN_TRANSIT" && (
                  <Button
                    busy={busy}
                    onClick={() =>
                      run(
                        () => w.service.status(s.id, "DELIVERED"),
                        "บันทึกส่งสำเร็จแล้ว",
                      )
                    }
                  >
                    <Check size={16} />
                    ส่งสำเร็จ
                  </Button>
                )}
                {canCollect && s.outstanding_amount > 0 && (
                  <Button
                    className="primary"
                    onClick={() => setAction("collect")}
                  >
                    <Banknote size={16} />
                    รับชำระเงิน
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {draft && (
        <div className="modal-footer">
          <Button className="primary" onClick={onClose}>
            <FileText size={16} />
            กลับไปออกบิล
          </Button>
        </div>
      )}
    </Modal>
  );
}
