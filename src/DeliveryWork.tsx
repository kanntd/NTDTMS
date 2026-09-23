import { useEffect, useMemo, useRef, useState } from "react";
import {
  Banknote,
  CheckCircle2,
  ClipboardCheck,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  ScanLine,
  Truck,
} from "lucide-react";
import { billNumberPrefix } from "./billNumber";
import { completeBillNumber } from "./loadingQueue";
import { useWorkspace } from "./context";
import { destinationBranches } from "./branchRoutes";
import { money, number } from "./domain";
import { Button, Field, Loading } from "./ui";
import {
  PAYMENT_LABELS,
  type DeliveryInput,
  type LoadTripAllocation,
} from "./types";

type QueueBill = {
  id: string;
  shipmentNo: string;
  receiverName: string;
  senderName: string;
  paymentMode: NonNullable<LoadTripAllocation["paymentMode"]>;
  expectedAmount: number;
  items: Array<{
    id: string;
    description: string;
    unit: string;
    quantity: number;
  }>;
};

const RESULTS: Array<[DeliveryInput["result"], string]> = [
  ["DELIVERED", "ส่งสำเร็จ"],
  ["CUSTOMER_ABSENT", "ไม่พบผู้รับ"],
  ["REFUSED", "ลูกค้าปฏิเสธรับ"],
  ["DAMAGED", "สินค้าชำรุด"],
  ["RESCHEDULED", "นัดส่งใหม่"],
  ["OTHER", "เหตุผลอื่น"],
];

export default function DeliveryWork() {
  const w = useWorkspace();
  const branches = useMemo(
    () => destinationBranches(w.branches, w.zones),
    [w.branches, w.zones],
  );
  const profileBranch = w.branches.find(
    (row) => row.id === w.profile.branch_id,
  );
  const manager = ["owner", "admin"].includes(w.profile.role);
  const availableBranches = manager
    ? branches
    : branches.filter((row) => row.code === profileBranch?.code);
  const [branchCode, setBranchCode] = useState(
    manager ? "" : availableBranches[0]?.code || "",
  );
  const [bills, setBills] = useState<QueueBill[]>([]);
  const [entry, setEntry] = useState("");
  const [selected, setSelected] = useState<QueueBill | null>(null);
  const [result, setResult] = useState<DeliveryInput["result"]>("DELIVERED");
  const [collected, setCollected] = useState("");
  const [roundReference, setRoundReference] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const issuingBranch = w.branches.find((row) => row.can_issue_bills);
  const prefix = billNumberPrefix(issuingBranch?.document_code || "B01");

  async function refresh() {
    setLoading(true);
    try {
      const [trips, deliveredLines] = await Promise.all([
        w.service.loadTrips(),
        w.service.deliveryLines(),
      ]);
      const delivered = new Map<string, number>();
      deliveredLines.forEach((line) =>
        delivered.set(
          line.itemId,
          (delivered.get(line.itemId) || 0) + line.quantity,
        ),
      );
      const grouped = new Map<string, QueueBill>();
      trips
        .filter(
          (trip) =>
            trip.status === "RECEIVED" &&
            (!branchCode || trip.destinationBranchCode === branchCode),
        )
        .flatMap((trip) => trip.allocations)
        .filter(
          (line) =>
            line.active &&
            line.shipmentStatus !== "DELIVERED" &&
            line.shipmentStatus !== "CANCELLED",
        )
        .forEach((line) => {
          const remaining = Math.max(
            0,
            line.quantity - (delivered.get(line.itemId) || 0),
          );
          if (remaining <= 0) return;
          const bill = grouped.get(line.shipmentId) || {
            id: line.shipmentId,
            shipmentNo: line.shipmentNo,
            receiverName: line.receiverName,
            senderName: line.senderName,
            paymentMode: line.paymentMode || "CASH_ORIGIN",
            expectedAmount: 0,
            items: [],
          };
          const existing = bill.items.find((item) => item.id === line.itemId);
          if (existing) existing.quantity += remaining;
          else
            bill.items.push({
              id: line.itemId,
              description: line.description,
              unit: line.unit,
              quantity: remaining,
            });
          bill.expectedAmount +=
            (line.amount || 0) * (remaining / line.quantity);
          grouped.set(line.shipmentId, bill);
        });
      setBills(
        [...grouped.values()].sort((a, b) =>
          a.receiverName.localeCompare(b.receiverName, "th"),
        ),
      );
    } catch (cause) {
      w.toast((cause as Error).message || "โหลดงานส่งสินค้าไม่สำเร็จ", true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (manager && !branchCode) return;
    if (!availableBranches.some((branch) => branch.code === branchCode))
      setBranchCode(availableBranches[0]?.code || "");
  }, [availableBranches, branchCode, manager]);
  useEffect(() => {
    if (manager || branchCode) void refresh();
  }, [branchCode, w.revision]);

  function findBill() {
    const shipmentNo = completeBillNumber(prefix, entry);
    const bill = bills.find((row) => row.shipmentNo === shipmentNo);
    if (!bill) {
      w.toast(`ไม่พบบิล ${shipmentNo || entry} ในรายการรอส่งของสาขานี้`, true);
      return;
    }
    setSelected(bill);
    setResult("DELIVERED");
    setCollected(
      bill.paymentMode === "CASH_DESTINATION"
        ? bill.expectedAmount.toFixed(2)
        : "",
    );
    setNote("");
    setEntry("");
  }

  function clearForm() {
    setSelected(null);
    setResult("DELIVERED");
    setCollected("");
    setNote("");
    inputRef.current?.focus();
  }

  async function save() {
    if (!selected) return;
    const amount = Number(collected || 0);
    if (!Number.isFinite(amount) || amount < 0) {
      w.toast("ยอดเงินที่เก็บได้ไม่ถูกต้อง", true);
      return;
    }
    setBusy(true);
    try {
      await w.service.recordDelivery({
        shipmentId: selected.id,
        result,
        collectedAmount: result === "DELIVERED" ? amount : 0,
        note,
        roundReference,
        requestId: crypto.randomUUID(),
      });
      w.toast(
        result === "DELIVERED"
          ? `บันทึกส่งบิล ${selected.shipmentNo} แล้ว`
          : `บันทึกผลการนำส่งบิล ${selected.shipmentNo} แล้ว`,
      );
      clearForm();
      await refresh();
      w.refresh();
    } catch (cause) {
      w.toast((cause as Error).message || "บันทึกผลส่งสินค้าไม่สำเร็จ", true);
    } finally {
      setBusy(false);
    }
  }

  if (!availableBranches.length)
    return (
      <div className="empty-state">
        <Truck size={30} />
        <h2>บัญชีนี้ยังไม่ได้ผูกกับสาขาปลายทาง</h2>
      </div>
    );

  return (
    <div className="delivery-work">
      <div className="page-heading">
        <div>
          <div className="breadcrumb">
            ปฏิบัติการสาขา <span>/</span> งานส่งสินค้า
          </div>
          <h1>
            บันทึกผลส่งสินค้า <span className="heading-dot" />
          </h1>
          <p>คีย์เลขบิลแล้วบันทึกผลได้ทันที โดยไม่ต้องสร้างรอบส่ง</p>
        </div>
        <div className="heading-actions">
          <select
            aria-label="กรองสาขาปลายทางของงานส่งสินค้า"
            value={branchCode}
            disabled={!manager}
            onChange={(event) => setBranchCode(event.target.value)}
          >
            {manager && <option value="">ทุกสาขา</option>}
            {availableBranches.map((branch) => (
              <option key={branch.code} value={branch.code}>
                {branch.name}
              </option>
            ))}
          </select>
          <Button onClick={() => void refresh()} disabled={loading}>
            <RefreshCw size={17} />
            อัปเดตข้อมูล
          </Button>
        </div>
      </div>

      <div className="delivery-summary">
        <article>
          <ClipboardCheck size={22} />
          <span>บิลรอส่ง</span>
          <strong>{number(bills.length)}</strong>
          <small>บิล</small>
        </article>
        <article>
          <PackageCheck size={22} />
          <span>สินค้ารอส่ง</span>
          <strong>
            {number(
              bills
                .flatMap((bill) => bill.items)
                .reduce((sum, item) => sum + item.quantity, 0),
            )}
          </strong>
          <small>ชิ้น</small>
        </article>
        <article>
          <Banknote size={22} />
          <span>เงินสดปลายทาง</span>
          <strong>
            ฿
            {money(
              bills
                .filter((bill) => bill.paymentMode === "CASH_DESTINATION")
                .reduce((sum, bill) => sum + bill.expectedAmount, 0),
            )}
          </strong>
          <small>
            {number(
              bills.filter((bill) => bill.paymentMode === "CASH_DESTINATION")
                .length,
            )}{" "}
            บิล
          </small>
        </article>
      </div>

      <section className="delivery-entry-panel">
        <header>
          <ScanLine size={22} />
          <div>
            <h2>พิมพ์หรือสแกนเลขบิล</h2>
            <p>พิมพ์เฉพาะเลขท้ายได้ ระบบเติมเลขด้านหน้าให้อัตโนมัติ</p>
          </div>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            findBill();
          }}
        >
          <span>{prefix}</span>
          <input
            ref={inputRef}
            autoFocus
            aria-label="เลขบิลส่งสินค้า"
            placeholder="123 หรือสแกน QR"
            value={entry}
            onChange={(event) => setEntry(event.target.value)}
          />
          <Button className="primary" type="submit" disabled={!entry.trim()}>
            ค้นหาบิล
          </Button>
        </form>
      </section>

      {loading && !selected ? (
        <Loading />
      ) : selected ? (
        <section className="delivery-confirm-panel">
          <header>
            <div>
              <span>ตรวจสอบก่อนบันทึก</span>
              <h2>{selected.shipmentNo}</h2>
            </div>
            <span className={`payment-mode ${selected.paymentMode}`}>
              {PAYMENT_LABELS[selected.paymentMode]}
            </span>
          </header>
          <div className="delivery-parties">
            <div>
              <small>ผู้รับ</small>
              <strong>{selected.receiverName}</strong>
            </div>
            <div>
              <small>ผู้ส่ง</small>
              <strong>{selected.senderName}</strong>
            </div>
          </div>
          <div className="delivery-items">
            {selected.items.map((item) => (
              <div key={item.id}>
                <span>{item.description}</span>
                <b>
                  {number(item.quantity)} {item.unit}
                </b>
              </div>
            ))}
          </div>
          <div className="delivery-form-grid">
            <Field label="ผลการส่ง">
              <select
                value={result}
                onChange={(event) =>
                  setResult(event.target.value as DeliveryInput["result"])
                }
              >
                {RESULTS.map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            {result === "DELIVERED" &&
              selected.paymentMode === "CASH_DESTINATION" && (
                <Field label="ยอดเงินที่เก็บได้จริง">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={collected}
                    onChange={(event) => setCollected(event.target.value)}
                  />
                </Field>
              )}
            <Field label="รอบส่ง (ไม่บังคับ)">
              <input
                placeholder="เช่น รอบเช้า / รถ 81-2345"
                value={roundReference}
                onChange={(event) => setRoundReference(event.target.value)}
              />
            </Field>
            <Field label="หมายเหตุ (ไม่บังคับ)">
              <input
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </Field>
          </div>
          <footer>
            <Button onClick={clearForm}>
              <RotateCcw size={16} />
              ยกเลิก
            </Button>
            <Button className="primary" busy={busy} onClick={() => void save()}>
              <CheckCircle2 size={17} />
              บันทึกผลส่งสินค้า
            </Button>
          </footer>
        </section>
      ) : (
        <div className="delivery-ready">
          <ScanLine size={34} />
          <strong>พร้อมรับเลขบิล</strong>
          <span>รายการจะปรากฏตรงนี้หลังค้นหา</span>
        </div>
      )}
    </div>
  );
}
