import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Calculator,
  CheckCircle2,
  Clock3,
  History,
  Pencil,
  RotateCcw,
  Search,
  Tags,
} from "lucide-react";
import { useWorkspace } from "./context";
import { BRANCH_OPTIONS } from "./intakeData";
import {
  catalogName,
  INTAKE_STORAGE_KEY,
  loadIntakeRegistry,
  partyName,
} from "./intakeRegistry";
import {
  addPriceVersion,
  currentPrice,
  loadOperations,
  saveOperations,
  type OperationsState,
  type PriceAgreement,
  type PriceRequest,
} from "./operationsStore";
import { money } from "./domain";
import { intakeAmounts, onePercent } from "./intakeMath";
import { PAYMENT_LABELS, type PaymentMode } from "./types";
import { Button, Empty, Field, IconButton, Modal } from "./ui";

type Tab = "current" | "pending" | "history" | "batch";

const branchLabel = (code: string) =>
  BRANCH_OPTIONS.find((row) => row.code === code)?.name || code;
const requestStatusLabel: Record<PriceRequest["status"], string> = {
  PENDING_PRICE: "รอปลายทางใส่ราคา",
  PENDING_APPROVAL: "รอบัญชียืนยัน",
  RETURNED: "ส่งกลับแก้ไข",
  RESOLVED: "ยืนยันแล้ว",
  CANCELLED: "ยกเลิกแล้ว",
};

function applyResolvedPriceToLocalBills(request: PriceRequest, price: number) {
  try {
    const storageKey = INTAKE_STORAGE_KEY;
    const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (!Array.isArray(stored?.bills)) return;
    for (const bill of stored.bills) {
      const draft = bill.draft;
      if (
        draft?.receiverId !== request.receiverId ||
        draft?.senderId !== request.senderId ||
        draft?.payment !== request.payment ||
        draft?.branch !== request.branch
      )
        continue;
      let changed = false;
      for (const item of bill.items || []) {
        if (
          item.catalogId === request.catalogId &&
          (item.requestPrice || item.price === null)
        ) {
          item.price = price;
          item.requestPrice = false;
          changed = true;
        }
      }
      for (const item of draft.lines || []) {
        if (
          item.catalogId === request.catalogId &&
          (item.requestPrice || item.price === null)
        ) {
          item.price = price;
          item.requestPrice = false;
        }
      }
      if (!changed) continue;
      const before = intakeAmounts(
        bill.items,
        Number(draft.discount) || 0,
        0,
        false,
      );
      const withheld = draft.withholding
        ? (draft.taxOverride ?? onePercent(before.total))
        : 0;
      bill.withheld = withheld;
      bill.amounts = intakeAmounts(
        bill.items,
        Number(draft.discount) || 0,
        withheld,
        !!draft.roundCash,
      );
    }
    localStorage.setItem(storageKey, JSON.stringify(stored));
  } catch {
    /* Production persists this transition in one database transaction. */
  }
}

export default function Pricing() {
  const w = useWorkspace();
  const registry = useMemo(loadIntakeRegistry, []);
  const [operations, setOperations] = useState(loadOperations);
  const [tab, setTab] = useState<Tab>("current");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<PriceAgreement | null>(null);
  const [resolving, setResolving] = useState<PriceRequest | null>(null);

  function commit(next: OperationsState, message: string) {
    setOperations(next);
    saveOperations(next);
    w.toast(message);
  }

  const normalized = query.trim().toLocaleLowerCase("th");
  const currentRows = operations.agreements
    .filter((row) => row.active && row.currentVersionId)
    .filter((row) =>
      [
        partyName(registry.parties, row.receiverId),
        partyName(registry.parties, row.senderId),
        catalogName(registry.catalog, row.catalogId),
        PAYMENT_LABELS[row.payment],
        branchLabel(row.branch),
      ]
        .join(" ")
        .toLocaleLowerCase("th")
        .includes(normalized),
    );
  const pendingRows = operations.priceRequests
    .filter((row) => row.status !== "RESOLVED" && row.status !== "CANCELLED")
    .filter((row) =>
      `${partyName(registry.parties, row.receiverId)} ${partyName(registry.parties, row.senderId)} ${catalogName(registry.catalog, row.catalogId)} ${row.billNumber}`
        .toLocaleLowerCase("th")
        .includes(normalized),
    );
  const historyRows = [...operations.priceVersions]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .filter((version) => {
      const agreement = operations.agreements.find(
        (row) => row.id === version.agreementId,
      );
      return agreement
        ? `${partyName(registry.parties, agreement.receiverId)} ${partyName(registry.parties, agreement.senderId)} ${catalogName(registry.catalog, agreement.catalogId)} ${version.reason}`
            .toLocaleLowerCase("th")
            .includes(normalized)
        : false;
    });
  const waitingForPrice = pendingRows.filter(
    (row) => row.status === "PENDING_PRICE" || row.status === "RETURNED",
  ).length;
  const waitingForApproval = pendingRows.filter(
    (row) => row.status === "PENDING_APPROVAL",
  ).length;

  return (
    <div className="ops-page pricing-page">
      <header className="ops-heading">
        <div>
          <h1>ราคาและคำขอราคา</h1>
          <p>ราคาแยกตามผู้รับ ผู้ส่ง สินค้า หน่วย การชำระเงิน และสาขา</p>
        </div>
        <div className="pricing-kpis">
          <span>
            <strong>{currentRows.length}</strong> ราคาปัจจุบัน
          </span>
          <span className={pendingRows.length ? "attention" : ""}>
            <strong>{waitingForPrice}</strong> รอใส่ราคา
          </span>
          <span className={waitingForApproval ? "attention" : ""}>
            <strong>{waitingForApproval}</strong> รอบัญชียืนยัน
          </span>
        </div>
      </header>

      <div className="ops-tabs" role="tablist" aria-label="งานราคา">
        <button
          role="tab"
          aria-selected={tab === "current"}
          className={tab === "current" ? "active" : ""}
          onClick={() => setTab("current")}
        >
          <Tags size={16} />
          ราคาปัจจุบัน
        </button>
        <button
          role="tab"
          aria-selected={tab === "pending"}
          className={tab === "pending" ? "active" : ""}
          onClick={() => setTab("pending")}
        >
          <Clock3 size={16} />
          คำขอราคา{pendingRows.length > 0 && <b>{pendingRows.length}</b>}
        </button>
        <button
          role="tab"
          aria-selected={tab === "history"}
          className={tab === "history" ? "active" : ""}
          onClick={() => setTab("history")}
        >
          <History size={16} />
          ประวัติราคา
        </button>
        <button
          role="tab"
          aria-selected={tab === "batch"}
          className={tab === "batch" ? "active" : ""}
          onClick={() => setTab("batch")}
        >
          <Calculator size={16} />
          ปรับหลายรายการ
        </button>
      </div>

      {tab !== "batch" && (
        <div className="ops-toolbar">
          <label>
            <Search size={16} />
            <input
              aria-label="ค้นหาราคา"
              placeholder="ค้นหาลูกค้า สินค้า เลขบิล หรือเหตุผล"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <span>การแก้ราคาจะสร้างเวอร์ชันใหม่เสมอ บิลเก่าไม่เปลี่ยน</span>
        </div>
      )}

      {tab === "current" && (
        <CurrentPrices
          rows={currentRows}
          operations={operations}
          registry={registry}
          onEdit={setEditing}
        />
      )}
      {tab === "pending" && (
        <PendingPrices
          rows={pendingRows}
          registry={registry}
          onResolve={setResolving}
        />
      )}
      {tab === "history" && (
        <PriceHistory
          rows={historyRows}
          operations={operations}
          registry={registry}
        />
      )}
      {tab === "batch" && (
        <BatchAdjustment
          operations={operations}
          registry={registry}
          onApply={(next, count) =>
            commit(next, `สร้างราคามาตรฐานเวอร์ชันใหม่ ${count} รายการแล้ว`)
          }
        />
      )}

      {editing && (
        <PriceEditor
          agreement={editing}
          current={currentPrice(operations, editing.key) || 0}
          title="สร้างราคามาตรฐานเวอร์ชันใหม่"
          onClose={() => setEditing(null)}
          onSave={(price, reason, effectiveFrom) => {
            const next = structuredClone(operations);
            addPriceVersion(next, {
              receiverId: editing.receiverId,
              senderId: editing.senderId,
              catalogId: editing.catalogId,
              payment: editing.payment,
              branch: editing.branch,
              price,
              reason,
              effectiveFrom,
              source: "MANUAL",
            });
            commit(next, "บันทึกราคาเวอร์ชันใหม่แล้ว");
            setEditing(null);
          }}
        />
      )}

      {resolving && (
        <ResolvePrice
          request={resolving}
          onClose={() => setResolving(null)}
          onSave={(price, actualCollectedAmount, decision, reason) => {
            const next = structuredClone(operations);
            const request = next.priceRequests.find(
              (row) => row.id === resolving.id,
            )!;
            request.collectedPrice = price;
            request.actualCollectedAmount = actualCollectedAmount;
            request.note = reason;
            const timestamp = new Date().toISOString();
            if (decision === "SUBMIT") {
              request.status = "PENDING_APPROVAL";
              request.submittedAt = timestamp;
              request.submittedBy = "พนักงานปลายทาง";
              request.returnReason = undefined;
            } else if (decision === "RETURN") {
              request.status = "RETURNED";
              request.returnedAt = timestamp;
              request.returnedBy = "ผู้ดูแล NTD";
              request.returnReason = reason;
            } else {
              request.status = "RESOLVED";
              request.resolutionType = decision;
              request.resolvedAt = timestamp;
              request.resolvedBy = "ผู้ดูแล NTD";
              applyResolvedPriceToLocalBills(request, price);
            }
            if (decision === "STANDARD")
              addPriceVersion(next, {
                receiverId: request.receiverId,
                senderId: request.senderId,
                catalogId: request.catalogId,
                payment: request.payment,
                branch: request.branch,
                price,
                reason,
                source: "PRICE_REQUEST",
              });
            commit(
              next,
              decision === "STANDARD"
                ? "ยืนยันราคาและสร้างราคามาตรฐานแล้ว"
                : decision === "BILL_ONLY"
                  ? "ยืนยันราคาเฉพาะบิลแล้ว ราคามาตรฐานไม่เปลี่ยน"
                  : decision === "RETURN"
                    ? "ส่งกลับให้ปลายทางแก้ราคาแล้ว"
                    : "บันทึกราคาแล้ว ส่งให้บัญชียืนยัน",
            );
            setResolving(null);
          }}
        />
      )}
    </div>
  );
}

function CurrentPrices({
  rows,
  operations,
  registry,
  onEdit,
}: {
  rows: PriceAgreement[];
  operations: OperationsState;
  registry: ReturnType<typeof loadIntakeRegistry>;
  onEdit: (row: PriceAgreement) => void;
}) {
  return (
    <div className="ops-table-wrap">
      <table className="ops-table pricing-table">
        <thead>
          <tr>
            <th>ผู้รับ</th>
            <th>ผู้ส่ง</th>
            <th>สินค้า / หน่วย</th>
            <th>สาขา</th>
            <th>การชำระเงิน</th>
            <th>ราคา/หน่วย</th>
            <th>เวอร์ชัน</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const version = operations.priceVersions.find(
              (item) => item.id === row.currentVersionId,
            );
            return (
              <tr key={row.id}>
                <td>
                  <strong>{partyName(registry.parties, row.receiverId)}</strong>
                </td>
                <td>{partyName(registry.parties, row.senderId)}</td>
                <td>{catalogName(registry.catalog, row.catalogId)}</td>
                <td>{branchLabel(row.branch)}</td>
                <td>{PAYMENT_LABELS[row.payment]}</td>
                <td className="price-number">฿ {money(version?.price || 0)}</td>
                <td>
                  v{version?.version}
                  <small>เริ่ม {version?.effectiveFrom}</small>
                </td>
                <td className="ops-actions">
                  <IconButton
                    label="สร้างราคาเวอร์ชันใหม่"
                    onClick={() => onEdit(row)}
                  >
                    <Pencil size={15} />
                  </IconButton>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PendingPrices({
  rows,
  registry,
  onResolve,
}: {
  rows: PriceRequest[];
  registry: ReturnType<typeof loadIntakeRegistry>;
  onResolve: (row: PriceRequest) => void;
}) {
  if (!rows.length)
    return (
      <Empty title="ไม่มีรายการรอตรวจราคา">
        <p>เมื่อบันทึกบิลโดยเลือกขอราคา รายการจะมาที่หน้านี้โดยอัตโนมัติ</p>
      </Empty>
    );
  return (
    <div className="ops-table-wrap">
      <table className="ops-table">
        <thead>
          <tr>
            <th>เลขบิล</th>
            <th>ผู้รับ / ผู้ส่ง</th>
            <th>สินค้า / หน่วย</th>
            <th>เงื่อนไข</th>
            <th>สถานะ</th>
            <th>ราคาที่เสนอ</th>
            <th>ยอดเก็บจริง</th>
            <th>วันที่ขอ</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>
                <strong>{row.billNumber || "ยังไม่ออกเลข"}</strong>
              </td>
              <td>
                {partyName(registry.parties, row.receiverId)}
                <small>{partyName(registry.parties, row.senderId)}</small>
              </td>
              <td>{catalogName(registry.catalog, row.catalogId)}</td>
              <td>
                {PAYMENT_LABELS[row.payment]}
                <small>{branchLabel(row.branch)}</small>
              </td>
              <td>
                <span className={`request-status ${row.status.toLowerCase()}`}>
                  {requestStatusLabel[row.status]}
                </span>
                {row.returnReason && <small>{row.returnReason}</small>}
              </td>
              <td>
                {row.collectedPrice === null
                  ? "ยังไม่ระบุ"
                  : `฿ ${money(row.collectedPrice)} / หน่วย`}
              </td>
              <td>
                {row.actualCollectedAmount === null
                  ? "–"
                  : `฿ ${money(row.actualCollectedAmount)}`}
              </td>
              <td>{new Date(row.requestedAt).toLocaleDateString("th-TH")}</td>
              <td>
                <Button
                  className="compact primary"
                  onClick={() => onResolve(row)}
                >
                  {row.status === "PENDING_APPROVAL"
                    ? "บัญชียืนยัน"
                    : "ใส่ราคา"}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PriceHistory({
  rows,
  operations,
  registry,
}: {
  rows: OperationsState["priceVersions"];
  operations: OperationsState;
  registry: ReturnType<typeof loadIntakeRegistry>;
}) {
  return (
    <div className="ops-table-wrap">
      <table className="ops-table">
        <thead>
          <tr>
            <th>วันที่</th>
            <th>ผู้รับ / ผู้ส่ง</th>
            <th>สินค้า / หน่วย</th>
            <th>เงื่อนไข</th>
            <th>ราคา</th>
            <th>เวอร์ชัน</th>
            <th>เหตุผล / ผู้อนุมัติ</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((version) => {
            const agreement = operations.agreements.find(
              (row) => row.id === version.agreementId,
            );
            if (!agreement) return null;
            return (
              <tr key={version.id}>
                <td>
                  {new Date(version.createdAt).toLocaleString("th-TH", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </td>
                <td>
                  <strong>
                    {partyName(registry.parties, agreement.receiverId)}
                  </strong>
                  <small>
                    {partyName(registry.parties, agreement.senderId)}
                  </small>
                </td>
                <td>{catalogName(registry.catalog, agreement.catalogId)}</td>
                <td>
                  {PAYMENT_LABELS[agreement.payment]}
                  <small>{branchLabel(agreement.branch)}</small>
                </td>
                <td className="price-number">฿ {money(version.price)}</td>
                <td>v{version.version}</td>
                <td>
                  {version.reason}
                  <small>{version.approvedBy}</small>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PriceEditor({
  current,
  title,
  onClose,
  onSave,
}: {
  agreement: PriceAgreement;
  current: number;
  title: string;
  onClose: () => void;
  onSave: (price: number, reason: string, effectiveFrom: string) => void;
}) {
  const [price, setPrice] = useState(String(current));
  const [reason, setReason] = useState("");
  const [effectiveFrom, setEffectiveFrom] = useState(
    new Date().toISOString().slice(0, 10),
  );
  return (
    <Modal title={title} onClose={onClose}>
      <form
        className="ops-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(Number(price), reason, effectiveFrom);
        }}
      >
        <div className="price-compare">
          <span>
            ราคาเดิม<strong>฿ {money(current)}</strong>
          </span>
          <span>
            <ArrowUp size={16} />
            ราคาใหม่<strong>฿ {money(Number(price) || 0)}</strong>
          </span>
        </div>
        <Field label="ราคาใหม่ / หน่วย" required>
          <input
            autoFocus
            required
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
        </Field>
        <Field label="เริ่มใช้วันที่" required>
          <input
            required
            type="date"
            value={effectiveFrom}
            onChange={(event) => setEffectiveFrom(event.target.value)}
          />
        </Field>
        <Field label="เหตุผลที่แก้ราคา" required>
          <textarea
            required
            minLength={3}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <div className="ops-inline-note">
          บิลที่ออกไปแล้วจะเก็บราคาเดิมไว้ ไม่ถูกแก้ย้อนหลัง
        </div>
        <div className="ops-form-actions">
          <Button type="button" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button className="primary" type="submit">
            สร้างเวอร์ชันใหม่
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ResolvePrice({
  request,
  onClose,
  onSave,
}: {
  request: PriceRequest;
  onClose: () => void;
  onSave: (
    price: number,
    actualCollectedAmount: number | null,
    decision: "STANDARD" | "BILL_ONLY" | "SUBMIT" | "RETURN",
    reason: string,
  ) => void;
}) {
  const awaitingApproval = request.status === "PENDING_APPROVAL";
  const [price, setPrice] = useState(
    request.collectedPrice === null ? "" : String(request.collectedPrice),
  );
  const [actualCollectedAmount, setActualCollectedAmount] = useState(
    request.actualCollectedAmount === null
      ? ""
      : String(request.actualCollectedAmount),
  );
  const [decision, setDecision] = useState<
    "STANDARD" | "BILL_ONLY" | "SUBMIT" | "RETURN"
  >(awaitingApproval ? "STANDARD" : "SUBMIT");
  const [reason, setReason] = useState("");
  return (
    <Modal
      title={
        awaitingApproval
          ? "บัญชียืนยันคำขอราคา"
          : request.status === "RETURNED"
            ? "แก้ราคาที่ถูกส่งกลับ"
            : "ปลายทางระบุราคา"
      }
      onClose={onClose}
    >
      <form
        className="ops-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(
            Number(price),
            actualCollectedAmount === "" ? null : Number(actualCollectedAmount),
            decision,
            reason,
          );
        }}
      >
        <div className="request-context">
          <strong>{request.billNumber}</strong>
          <span>
            {PAYMENT_LABELS[request.payment]} · {branchLabel(request.branch)} ·
            จำนวน {request.quantity}
          </span>
        </div>
        {request.returnReason && (
          <div className="ops-inline-note returned">
            <RotateCcw size={15} />
            บัญชีส่งกลับ: {request.returnReason}
          </div>
        )}
        <Field label="ราคาที่ปลายทางเสนอ / หน่วย" required>
          <input
            autoFocus
            required
            type="number"
            min="0"
            step="0.01"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
          />
        </Field>
        {request.payment === "CASH_DESTINATION" && (
          <Field label="ยอดเงินที่เก็บได้จริง (ทั้งรายการ)">
            <input
              type="number"
              min="0"
              step="0.01"
              value={actualCollectedAmount}
              onChange={(event) => setActualCollectedAmount(event.target.value)}
            />
          </Field>
        )}
        {awaitingApproval ? (
          <fieldset className="price-decisions">
            <legend>ผลการตรวจของบัญชี</legend>
            <label>
              <input
                type="radio"
                name="decision"
                checked={decision === "STANDARD"}
                onChange={() => setDecision("STANDARD")}
              />
              <span>
                <strong>ยืนยันและใช้เป็นราคามาตรฐาน</strong>
                <small>บิลครั้งต่อไปจะขึ้นราคานี้อัตโนมัติ</small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="decision"
                checked={decision === "BILL_ONLY"}
                onChange={() => setDecision("BILL_ONLY")}
              />
              <span>
                <strong>ยืนยันใช้เฉพาะบิลนี้</strong>
                <small>ไม่เปลี่ยนราคามาตรฐาน</small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="decision"
                checked={decision === "RETURN"}
                onChange={() => setDecision("RETURN")}
              />
              <span>
                <strong>ส่งกลับให้ปลายทางแก้ไข</strong>
                <small>บิลยังคงสถานะรอราคา</small>
              </span>
            </label>
          </fieldset>
        ) : (
          <div className="ops-inline-note">
            ราคานี้จะถูกส่งให้บัญชียืนยันก่อนนำไปคำนวณยอดบิล
          </div>
        )}
        <Field label="เหตุผล / หมายเหตุ" required>
          <textarea
            required
            minLength={3}
            rows={3}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        <div className="ops-form-actions">
          <Button type="button" onClick={onClose}>
            ยกเลิก
          </Button>
          <Button type="submit" className="primary">
            <CheckCircle2 size={16} />
            {decision === "SUBMIT"
              ? "ส่งให้บัญชียืนยัน"
              : decision === "RETURN"
                ? "ส่งกลับแก้ไข"
                : "ยืนยันราคา"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function BatchAdjustment({
  operations,
  registry,
  onApply,
}: {
  operations: OperationsState;
  registry: ReturnType<typeof loadIntakeRegistry>;
  onApply: (state: OperationsState, count: number) => void;
}) {
  const [branch, setBranch] = useState("");
  const [payment, setPayment] = useState<PaymentMode | "">("");
  const [product, setProduct] = useState("");
  const [method, setMethod] = useState<"AMOUNT" | "PERCENT">("AMOUNT");
  const [direction, setDirection] = useState<"UP" | "DOWN">("UP");
  const [value, setValue] = useState(5);
  const [reason, setReason] = useState("ปรับตามต้นทุนเชื้อเพลิง");
  const matches = operations.agreements.filter(
    (row) =>
      row.active &&
      row.currentVersionId &&
      (!branch || row.branch === branch) &&
      (!payment || row.payment === payment) &&
      (!product || row.catalogId === product),
  );
  function adjusted(row: PriceAgreement) {
    const old = currentPrice(operations, row.key) || 0;
    const delta = method === "PERCENT" ? (old * value) / 100 : value;
    return Math.max(
      0,
      Math.round((old + (direction === "UP" ? delta : -delta)) * 100) / 100,
    );
  }
  return (
    <div className="batch-layout">
      <form
        className="batch-controls"
        onSubmit={(event) => {
          event.preventDefault();
          const next = structuredClone(operations);
          matches.forEach((row) =>
            addPriceVersion(next, {
              receiverId: row.receiverId,
              senderId: row.senderId,
              catalogId: row.catalogId,
              payment: row.payment,
              branch: row.branch,
              price: adjusted(row),
              reason,
              source: "BATCH",
            }),
          );
          onApply(next, matches.length);
        }}
      >
        <h2>เลือกเงื่อนไขที่ต้องการปรับ</h2>
        <Field label="สาขา">
          <select value={branch} onChange={(e) => setBranch(e.target.value)}>
            <option value="">ทุกสาขา</option>
            {BRANCH_OPTIONS.map((row) => (
              <option key={row.code} value={row.code}>
                {row.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="ประเภทการชำระเงิน">
          <select
            value={payment}
            onChange={(e) => setPayment(e.target.value as PaymentMode)}
          >
            <option value="">ทุกประเภท</option>
            {Object.entries(PAYMENT_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="สินค้า / หน่วย">
          <select value={product} onChange={(e) => setProduct(e.target.value)}>
            <option value="">ทุกสินค้า</option>
            {registry.catalog.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name} · {row.unit}
              </option>
            ))}
          </select>
        </Field>
        <div className="ops-form-grid">
          <Field label="วิธีปรับ">
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as typeof method)}
            >
              <option value="AMOUNT">จำนวนเงิน</option>
              <option value="PERCENT">เปอร์เซ็นต์</option>
            </select>
          </Field>
          <Field label={method === "AMOUNT" ? "บาท / หน่วย" : "เปอร์เซ็นต์"}>
            <input
              type="number"
              min="0"
              step="0.01"
              value={value}
              onChange={(e) => setValue(Number(e.target.value))}
            />
          </Field>
        </div>
        <div className="batch-direction">
          <button
            type="button"
            className={direction === "UP" ? "active" : ""}
            onClick={() => setDirection("UP")}
          >
            <ArrowUp size={16} />
            ขึ้นราคา
          </button>
          <button
            type="button"
            className={direction === "DOWN" ? "active down" : ""}
            onClick={() => setDirection("DOWN")}
          >
            <ArrowDown size={16} />
            ลดราคา
          </button>
        </div>
        <Field label="เหตุผล" required>
          <input
            required
            minLength={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <Button
          className="primary full"
          type="submit"
          disabled={!matches.length}
        >
          ยืนยันสร้างราคาใหม่ {matches.length} รายการ
        </Button>
      </form>
      <section className="batch-preview">
        <header>
          <h2>ตัวอย่างก่อนยืนยัน</h2>
          <span>{matches.length} รายการ</span>
        </header>
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th>คู่ลูกค้า / สินค้า</th>
                <th>ราคาเดิม</th>
                <th>ราคาใหม่</th>
                <th>เปลี่ยนแปลง</th>
              </tr>
            </thead>
            <tbody>
              {matches.slice(0, 50).map((row) => {
                const old = currentPrice(operations, row.key) || 0;
                const next = adjusted(row);
                return (
                  <tr key={row.id}>
                    <td>
                      <strong>
                        {partyName(registry.parties, row.receiverId)}
                      </strong>
                      <small>
                        {partyName(registry.parties, row.senderId)} ·{" "}
                        {catalogName(registry.catalog, row.catalogId)}
                      </small>
                    </td>
                    <td>{money(old)}</td>
                    <td className="price-number">{money(next)}</td>
                    <td className={next >= old ? "price-up" : "price-down"}>
                      {next >= old ? "+" : ""}
                      {money(next - old)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
