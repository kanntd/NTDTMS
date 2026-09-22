import { useEffect, useId, useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Calculator,
  CheckCircle2,
  ChevronDown,
  Clock3,
  History,
  Pencil,
  RotateCcw,
  Search,
  Tags,
} from "lucide-react";
import { useWorkspace } from "./context";
import { BRANCH_OPTIONS } from "./intakeData";
import { destinationBranches } from "./branchRoutes";
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
import { localDate, money, thaiDate, thaiTime } from "./domain";
import DateInput from "./DateInput";
import { intakeAmounts, onePercent } from "./intakeMath";
import { PAYMENT_LABELS, type PaymentMode } from "./types";
import { Button, Empty, Field, IconButton, Loading, Modal } from "./ui";
import {
  loadRemoteWorkspace,
  resolveRemotePriceRequest,
  syncRemoteWorkspace,
} from "./remoteWorkspace";

type Tab = "current" | "pending" | "history" | "batch";
type PriceFilters = {
  query: string;
  receiverId: string;
  senderId: string;
  catalogId: string;
  payment: PaymentMode | "";
  branch: string;
};
type FilterOption = { id: string; label: string; detail?: string };
type PriceDimensions = {
  receiverId: string;
  senderId: string;
  catalogId: string;
  payment: PaymentMode;
  branch: string;
};
type LocalPriceLine = {
  catalogId: string;
  quantity: number;
  price: number | null;
  requestPrice: boolean;
};
type LocalPriceBill = {
  number: string;
  date: string;
  draft: Omit<PriceDimensions, "catalogId"> & {
    lines: LocalPriceLine[];
    discount?: number;
    withholding?: boolean;
    taxOverride?: number | null;
    roundCash?: boolean;
  };
  items: LocalPriceLine[];
  withheld?: number;
  amounts: ReturnType<typeof intakeAmounts>;
};
type PriceFollowUp = {
  billNumber: string;
  requestedAt: string;
  quantity: number;
};

const emptyFilters: PriceFilters = {
  query: "",
  receiverId: "",
  senderId: "",
  catalogId: "",
  payment: "",
  branch: "",
};

export function matchesPriceFilters(
  filters: PriceFilters,
  row: PriceDimensions,
) {
  return (
    (!filters.receiverId || row.receiverId === filters.receiverId) &&
    (!filters.senderId || row.senderId === filters.senderId) &&
    (!filters.catalogId || row.catalogId === filters.catalogId) &&
    (!filters.payment || row.payment === filters.payment) &&
    (!filters.branch || row.branch === filters.branch)
  );
}

export function isWithinPriceHistoryRange(
  createdAt: string,
  from: string,
  to: string,
) {
  const date = createdAt.slice(0, 10);
  return (!from || date >= from) && (!to || date <= to);
}

export function isWithinPriceRequestRange(
  requestedAt: string,
  from: string,
  to: string,
) {
  const date = localDate(new Date(requestedAt));
  return (!from || date >= from) && (!to || date <= to);
}

const branchLabel = (code: string) =>
  BRANCH_OPTIONS.find((row) => row.code === code)?.name || code;
const requestStatusLabel: Record<PriceRequest["status"], string> = {
  PENDING_PRICE: "รอข้อมูลราคา",
  PENDING_APPROVAL: "รอบัญชียืนยัน",
  RETURNED: "ส่งกลับแก้ไข",
  RESOLVED: "ยืนยันแล้ว",
  CANCELLED: "ยกเลิกแล้ว",
};

export function applyResolvedPriceToLocalBills(
  request: PriceRequest,
  price: number,
  resolutionType: "STANDARD" | "BILL_ONLY",
): PriceFollowUp | null {
  try {
    const storageKey = INTAKE_STORAGE_KEY;
    const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
    if (!Array.isArray(stored?.bills)) return null;
    const bills = stored.bills as LocalPriceBill[];
    for (const bill of bills) {
      const draft = bill.draft;
      const isSourceBill = bill.number === request.billNumber;
      const isLaterPendingBill =
        resolutionType === "STANDARD" &&
        typeof bill.date === "string" &&
        bill.date >= request.requestedAt;
      if (!isSourceBill && !isLaterPendingBill) continue;
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
    if (resolutionType === "BILL_ONLY") {
      const nextBill = bills
        .filter(
          (bill) =>
            bill.number !== request.billNumber &&
            bill.date >= request.requestedAt &&
            bill.draft.receiverId === request.receiverId &&
            bill.draft.senderId === request.senderId &&
            bill.draft.payment === request.payment &&
            bill.draft.branch === request.branch &&
            bill.items.some(
              (item) =>
                item.catalogId === request.catalogId &&
                (item.requestPrice || item.price === null),
            ),
        )
        .sort((a, b) => a.date.localeCompare(b.date))[0];
      const pendingItem = nextBill?.items.find(
        (item) =>
          item.catalogId === request.catalogId &&
          (item.requestPrice || item.price === null),
      );
      if (nextBill && pendingItem)
        return {
          billNumber: nextBill.number,
          requestedAt: nextBill.date,
          quantity: Number(pendingItem.quantity) || 1,
        };
    }
    return null;
  } catch {
    /* Production persists this transition in one database transaction. */
    return null;
  }
}

export default function Pricing() {
  const w = useWorkspace();
  const [registry, setRegistry] = useState(loadIntakeRegistry);
  const [operations, setOperations] = useState(loadOperations);
  const [loadingRemote, setLoadingRemote] = useState(!w.demo);
  const [tab, setTab] = useState<Tab>("current");
  const [filters, setFilters] = useState<PriceFilters>(emptyFilters);
  const [pendingStatus, setPendingStatus] = useState<
    PriceRequest["status"] | ""
  >("");
  const [requestFrom, setRequestFrom] = useState("");
  const [requestTo, setRequestTo] = useState("");
  const [historyFrom, setHistoryFrom] = useState("");
  const [historyTo, setHistoryTo] = useState("");
  const [historyApprover, setHistoryApprover] = useState("");
  const [editing, setEditing] = useState<PriceAgreement | null>(null);
  const [resolving, setResolving] = useState<PriceRequest | null>(null);

  useEffect(() => {
    if (w.demo) return;
    let active = true;
    loadRemoteWorkspace()
      .then((workspace) => {
        if (!active) return;
        setRegistry(workspace.registry);
        setOperations(workspace.operations);
      })
      .catch((error) => w.toast(error.message, true))
      .finally(() => active && setLoadingRemote(false));
    return () => {
      active = false;
    };
  }, [w.demo, w.revision]);

  function commit(next: OperationsState, message: string) {
    setOperations(next);
    if (w.demo) {
      saveOperations(next);
      w.toast(message);
      return;
    }
    void syncRemoteWorkspace(registry, next)
      .then(() => w.toast(message))
      .catch((error) => w.toast(`บันทึกไม่สำเร็จ: ${error.message}`, true));
  }

  if (loadingRemote) return <Loading />;

  const dimensions = [...operations.agreements, ...operations.priceRequests];
  const receiverOptions = [...new Set(dimensions.map((row) => row.receiverId))]
    .map((id) => ({ id, label: partyName(registry.parties, id) }))
    .sort((a, b) => a.label.localeCompare(b.label, "th"));
  const senderOptions = [
    ...new Set(
      dimensions
        .filter(
          (row) => !filters.receiverId || row.receiverId === filters.receiverId,
        )
        .map((row) => row.senderId),
    ),
  ]
    .map((id) => ({ id, label: partyName(registry.parties, id) }))
    .sort((a, b) => a.label.localeCompare(b.label, "th"));
  const productOptions = [
    ...new Set(
      dimensions
        .filter(
          (row) =>
            (!filters.receiverId || row.receiverId === filters.receiverId) &&
            (!filters.senderId || row.senderId === filters.senderId),
        )
        .map((row) => row.catalogId),
    ),
  ]
    .map((id) => ({ id, label: catalogName(registry.catalog, id) }))
    .sort((a, b) => a.label.localeCompare(b.label, "th"));
  const approverOptions = [
    ...new Set(operations.priceVersions.map((row) => row.approvedBy)),
  ]
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b, "th"));
  const normalized = filters.query.trim().toLocaleLowerCase("th");
  const matchesDimensions = (row: PriceDimensions) =>
    matchesPriceFilters(filters, row);
  const currentRows = operations.agreements
    .filter((row) => row.active && row.currentVersionId)
    .filter(matchesDimensions)
    .filter((row) => {
      const version = operations.priceVersions.find(
        (item) => item.id === row.currentVersionId,
      );
      return [
        partyName(registry.parties, row.receiverId),
        partyName(registry.parties, row.senderId),
        catalogName(registry.catalog, row.catalogId),
        PAYMENT_LABELS[row.payment],
        branchLabel(row.branch),
        version?.reason || "",
        version?.approvedBy || "",
      ]
        .join(" ")
        .toLocaleLowerCase("th")
        .includes(normalized);
    });
  const pendingRows = operations.priceRequests
    .filter((row) => row.status !== "RESOLVED" && row.status !== "CANCELLED")
    .filter(matchesDimensions)
    .filter((row) => !pendingStatus || row.status === pendingStatus)
    .filter((row) =>
      isWithinPriceRequestRange(row.requestedAt, requestFrom, requestTo),
    )
    .filter((row) =>
      `${partyName(registry.parties, row.receiverId)} ${partyName(registry.parties, row.senderId)} ${catalogName(registry.catalog, row.catalogId)} ${row.billNumber} ${PAYMENT_LABELS[row.payment]} ${branchLabel(row.branch)} ${requestStatusLabel[row.status]} ${row.note}`
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
        ? matchesDimensions(agreement) &&
            isWithinPriceHistoryRange(
              version.createdAt,
              historyFrom,
              historyTo,
            ) &&
            (!historyApprover || version.approvedBy === historyApprover) &&
            `${partyName(registry.parties, agreement.receiverId)} ${partyName(registry.parties, agreement.senderId)} ${catalogName(registry.catalog, agreement.catalogId)} ${PAYMENT_LABELS[agreement.payment]} ${branchLabel(agreement.branch)} ${version.reason} ${version.approvedBy}`
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
  const filteredCount =
    tab === "current"
      ? currentRows.length
      : tab === "pending"
        ? pendingRows.length
        : tab === "history"
          ? historyRows.length
          : currentRows.length;
  const hasScopeFilter = Boolean(
    filters.query ||
    filters.receiverId ||
    filters.senderId ||
    filters.catalogId ||
    filters.payment ||
    filters.branch,
  );
  function clearFilters() {
    setFilters(emptyFilters);
    setPendingStatus("");
    setRequestFrom("");
    setRequestTo("");
    setHistoryFrom("");
    setHistoryTo("");
    setHistoryApprover("");
  }

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

      <PriceFilterBar
        tab={tab}
        filters={filters}
        receiverOptions={receiverOptions}
        senderOptions={senderOptions}
        productOptions={productOptions}
        pendingStatus={pendingStatus}
        requestFrom={requestFrom}
        requestTo={requestTo}
        historyFrom={historyFrom}
        historyTo={historyTo}
        historyApprover={historyApprover}
        approverOptions={approverOptions}
        resultCount={filteredCount}
        onFilters={setFilters}
        onPendingStatus={setPendingStatus}
        onRequestFrom={(date) => {
          setRequestFrom(date);
          if (requestTo && date > requestTo) setRequestTo("");
        }}
        onRequestTo={setRequestTo}
        onHistoryFrom={setHistoryFrom}
        onHistoryTo={setHistoryTo}
        onHistoryApprover={setHistoryApprover}
        onClear={clearFilters}
      />

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
          rows={currentRows}
          hasScopeFilter={hasScopeFilter}
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
          onSave={(
            proposedPrice,
            approvedPrice,
            actualCollectedAmount,
            decision,
            note,
          ) => {
            if (
              !w.demo &&
              (decision === "STANDARD" || decision === "BILL_ONLY")
            ) {
              void resolveRemotePriceRequest(
                resolving.id,
                approvedPrice!,
                decision,
                note,
              )
                .then(async (result) => {
                  const workspace = await loadRemoteWorkspace();
                  setRegistry(workspace.registry);
                  setOperations(workspace.operations);
                  w.refresh();
                  w.toast(
                    decision === "STANDARD"
                      ? `ยืนยันราคาและอัปเดตบิลรอราคา ${result.affected_requests} บิลแล้ว`
                      : "ยืนยันราคาเฉพาะบิลแล้ว ราคามาตรฐานไม่เปลี่ยน",
                  );
                  setResolving(null);
                })
                .catch((error) =>
                  w.toast(`ยืนยันราคาไม่สำเร็จ: ${error.message}`, true),
                );
              return;
            }
            const next = structuredClone(operations);
            const request = next.priceRequests.find(
              (row) => row.id === resolving.id,
            )!;
            request.actualCollectedAmount = actualCollectedAmount;
            const timestamp = new Date().toISOString();
            if (decision === "SUBMIT") {
              request.proposedPrice = proposedPrice;
              request.note = note;
              request.status = "PENDING_APPROVAL";
              request.submittedAt = timestamp;
              request.submittedBy = "ผู้ให้ข้อมูลราคา";
              request.returnReason = undefined;
            } else if (decision === "RETURN") {
              request.status = "RETURNED";
              request.returnedAt = timestamp;
              request.returnedBy = "ผู้ดูแล NTD";
              request.returnReason = note;
            } else {
              const finalPrice = approvedPrice!;
              request.approvedPrice = finalPrice;
              request.approvalNote = note;
              request.status = "RESOLVED";
              request.resolutionType = decision;
              request.resolvedAt = timestamp;
              request.resolvedBy = "ผู้ดูแล NTD";
              const nextPendingBill = w.demo
                ? applyResolvedPriceToLocalBills(request, finalPrice, decision)
                : null;
              if (decision === "BILL_ONLY" && nextPendingBill) {
                next.priceRequests.push({
                  id: crypto.randomUUID(),
                  key: request.key,
                  receiverId: request.receiverId,
                  senderId: request.senderId,
                  catalogId: request.catalogId,
                  payment: request.payment,
                  branch: request.branch,
                  billNumber: nextPendingBill.billNumber,
                  quantity: nextPendingBill.quantity,
                  proposedPrice: null,
                  approvedPrice: null,
                  actualCollectedAmount: null,
                  status: "PENDING_PRICE",
                  requestedAt: nextPendingBill.requestedAt,
                  note: "รอข้อมูลราคา หลังคำขอก่อนหน้าอนุมัติเฉพาะบิล",
                });
              }
            }
            if (decision === "STANDARD")
              addPriceVersion(next, {
                receiverId: request.receiverId,
                senderId: request.senderId,
                catalogId: request.catalogId,
                payment: request.payment,
                branch: request.branch,
                price: approvedPrice!,
                reason:
                  note.trim() || `อนุมัติจากคำขอราคา ${request.billNumber}`,
                effectiveFrom: request.requestedAt.slice(0, 10),
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

function PriceFilterBar({
  tab,
  filters,
  receiverOptions,
  senderOptions,
  productOptions,
  pendingStatus,
  requestFrom,
  requestTo,
  historyFrom,
  historyTo,
  historyApprover,
  approverOptions,
  resultCount,
  onFilters,
  onPendingStatus,
  onRequestFrom,
  onRequestTo,
  onHistoryFrom,
  onHistoryTo,
  onHistoryApprover,
  onClear,
}: {
  tab: Tab;
  filters: PriceFilters;
  receiverOptions: FilterOption[];
  senderOptions: FilterOption[];
  productOptions: FilterOption[];
  pendingStatus: PriceRequest["status"] | "";
  requestFrom: string;
  requestTo: string;
  historyFrom: string;
  historyTo: string;
  historyApprover: string;
  approverOptions: string[];
  resultCount: number;
  onFilters: (filters: PriceFilters) => void;
  onPendingStatus: (status: PriceRequest["status"] | "") => void;
  onRequestFrom: (date: string) => void;
  onRequestTo: (date: string) => void;
  onHistoryFrom: (date: string) => void;
  onHistoryTo: (date: string) => void;
  onHistoryApprover: (name: string) => void;
  onClear: () => void;
}) {
  const w = useWorkspace();
  const branches = destinationBranches(w.branches, w.zones);
  const patch = (next: Partial<PriceFilters>) =>
    onFilters({ ...filters, ...next });
  const hasAnyFilter = Boolean(
    filters.query ||
    filters.receiverId ||
    filters.senderId ||
    filters.catalogId ||
    filters.payment ||
    filters.branch ||
    pendingStatus ||
    requestFrom ||
    requestTo ||
    historyFrom ||
    historyTo ||
    historyApprover,
  );
  return (
    <section className="pricing-filters" aria-label="ตัวกรองราคา">
      <div className="pricing-filter-topline">
        <label className="pricing-keyword">
          <Search size={16} />
          <input
            aria-label="ค้นหาราคา"
            placeholder="ค้นหาลูกค้า สินค้า เลขบิล หรือเหตุผล"
            value={filters.query}
            onChange={(event) => patch({ query: event.target.value })}
          />
        </label>
        <div className="pricing-filter-summary">
          <strong>พบ {resultCount} รายการ</strong>
          <Button type="button" disabled={!hasAnyFilter} onClick={onClear}>
            <RotateCcw size={15} />
            ล้างตัวกรอง
          </Button>
        </div>
      </div>
      <div className="pricing-filter-grid">
        <FilterPicker
          label="ผู้รับ"
          emptyLabel="ผู้รับทั้งหมด"
          value={filters.receiverId}
          options={receiverOptions}
          onChange={(receiverId) =>
            patch({ receiverId, senderId: "", catalogId: "" })
          }
        />
        <FilterPicker
          label="ผู้ส่ง"
          emptyLabel="ผู้ส่งทั้งหมด"
          value={filters.senderId}
          options={senderOptions}
          onChange={(senderId) => patch({ senderId, catalogId: "" })}
        />
        <FilterSelect
          label="สินค้า / หน่วย"
          value={filters.catalogId}
          emptyLabel="สินค้าทั้งหมด"
          options={productOptions}
          onChange={(catalogId) => patch({ catalogId })}
        />
        <FilterSelect
          label="ประเภทการชำระเงิน"
          value={filters.payment}
          emptyLabel="ทุกประเภท"
          options={Object.entries(PAYMENT_LABELS).map(([id, label]) => ({
            id,
            label,
          }))}
          onChange={(payment) =>
            patch({ payment: payment as PaymentMode | "" })
          }
        />
        <FilterSelect
          label="สาขาปลายทาง"
          value={filters.branch}
          emptyLabel="ทุกสาขา"
          options={branches.map((row) => ({
            id: row.code,
            label: row.name,
          }))}
          onChange={(branch) => patch({ branch })}
        />
        {tab === "pending" && (
          <>
            <FilterSelect
              label="สถานะคำขอ"
              value={pendingStatus}
              emptyLabel="ทุกสถานะ"
              options={[
                { id: "PENDING_PRICE", label: requestStatusLabel.PENDING_PRICE },
                {
                  id: "PENDING_APPROVAL",
                  label: requestStatusLabel.PENDING_APPROVAL,
                },
                { id: "RETURNED", label: requestStatusLabel.RETURNED },
              ]}
              onChange={(status) =>
                onPendingStatus(status as PriceRequest["status"] | "")
              }
            />
            <label className="pricing-filter-control">
              <span>เปิดบิลตั้งแต่วันที่</span>
              <DateInput
                value={requestFrom}
                onChange={onRequestFrom}
              />
            </label>
            <label className="pricing-filter-control">
              <span>ถึงวันที่</span>
              <DateInput
                min={requestFrom || undefined}
                value={requestTo}
                onChange={onRequestTo}
              />
            </label>
          </>
        )}
        {tab === "history" && (
          <>
            <label className="pricing-filter-control">
              <span>ตั้งแต่วันที่</span>
              <DateInput
                value={historyFrom}
                onChange={onHistoryFrom}
              />
            </label>
            <label className="pricing-filter-control">
              <span>ถึงวันที่</span>
              <DateInput
                min={historyFrom || undefined}
                value={historyTo}
                onChange={onHistoryTo}
              />
            </label>
            <FilterSelect
              label="ผู้อนุมัติราคา"
              value={historyApprover}
              emptyLabel="ทุกคน"
              options={approverOptions.map((name) => ({
                id: name,
                label: name,
              }))}
              onChange={onHistoryApprover}
            />
          </>
        )}
      </div>
      <p className="pricing-filter-note">
        {tab === "batch"
          ? "เลือกรายการด้วยตัวกรองด้านบน แล้วตรวจราคาใหม่ก่อนยืนยัน"
          : "ราคาที่ระบุแล้วในบิลเก่าไม่เปลี่ยน ยกเว้นบิลที่ยังรอราคา"}
      </p>
    </section>
  );
}

function FilterSelect({
  label,
  value,
  emptyLabel,
  options,
  onChange,
}: {
  label: string;
  value: string;
  emptyLabel: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="pricing-filter-control">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{emptyLabel}</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function FilterPicker({
  label,
  value,
  emptyLabel,
  options,
  onChange,
}: {
  label: string;
  value: string;
  emptyLabel: string;
  options: FilterOption[];
  onChange: (value: string) => void;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const current = options.find((option) => option.id === value);
  const normalizedQuery = query.trim().toLocaleLowerCase("th");
  const visible = options.filter((option) =>
    `${option.label} ${option.detail || ""}`
      .toLocaleLowerCase("th")
      .includes(normalizedQuery),
  );
  function choose(next: string) {
    onChange(next);
    setQuery("");
    setOpen(false);
  }
  return (
    <div
      className="pricing-filter-control pricing-filter-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <span>{label}</span>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-options`}
        onClick={() => setOpen((value) => !value)}
      >
        <span>{current?.label || emptyLabel}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="pricing-filter-menu" id={`${id}-options`}>
          <label>
            <Search size={14} />
            <input
              autoFocus
              aria-label={`ค้นหา${label}`}
              value={query}
              placeholder={`ค้นหา${label}`}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setOpen(false);
              }}
            />
          </label>
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => choose("")}
          >
            {emptyLabel}
          </button>
          {visible.map((option) => (
            <button
              type="button"
              key={option.id}
              className={option.id === value ? "selected" : ""}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(option.id)}
            >
              {option.label}
            </button>
          ))}
          {!visible.length && <p>ไม่พบรายชื่อ</p>}
        </div>
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
                  <small>
                    เริ่ม {version?.effectiveFrom ? thaiDate(version.effectiveFrom) : "–"}
                  </small>
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
            <th>วันที่เปิดบิล</th>
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
              <td>{thaiDate(row.requestedAt)}</td>
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
                {row.proposedPrice === null
                  ? "ยังไม่ระบุ"
                  : `฿ ${money(row.proposedPrice)} / หน่วย`}
              </td>
              <td>
                {row.actualCollectedAmount === null
                  ? "–"
                  : `฿ ${money(row.actualCollectedAmount)}`}
              </td>
              <td>{thaiDate(row.requestedAt)}</td>
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
                  {thaiDate(version.createdAt)} · {thaiTime(version.createdAt)}
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
          <DateInput
            required
            value={effectiveFrom}
            onChange={setEffectiveFrom}
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
    proposedPrice: number | null,
    approvedPrice: number | null,
    actualCollectedAmount: number | null,
    decision: "STANDARD" | "BILL_ONLY" | "SUBMIT" | "RETURN",
    reason: string,
  ) => void;
}) {
  const awaitingApproval = request.status === "PENDING_APPROVAL";
  const [proposedPrice, setProposedPrice] = useState(
    request.proposedPrice === null ? "" : String(request.proposedPrice),
  );
  const [approvedPrice, setApprovedPrice] = useState(
    request.approvedPrice === null
      ? request.proposedPrice === null
        ? ""
        : String(request.proposedPrice)
      : String(request.approvedPrice),
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
            : "ระบุข้อมูลราคา"
      }
      onClose={onClose}
    >
      <form
        className="ops-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(
            proposedPrice === "" ? null : Number(proposedPrice),
            approvedPrice === "" ? null : Number(approvedPrice),
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
        {awaitingApproval ? (
          <>
            <div className="request-price-proposal">
              <span>ราคาที่เสนอ</span>
              <strong>
                {request.proposedPrice === null
                  ? "ไม่ได้ระบุ"
                  : `฿ ${money(request.proposedPrice)} / หน่วย`}
              </strong>
            </div>
            <Field
              label="ราคาที่อนุมัติ / หน่วย"
              required={decision !== "RETURN"}
            >
              <input
                autoFocus
                required={decision !== "RETURN"}
                type="number"
                min="0"
                step="0.01"
                value={approvedPrice}
                onChange={(event) => setApprovedPrice(event.target.value)}
              />
            </Field>
          </>
        ) : (
          <Field label="ราคาที่เสนอ / หน่วย (ไม่บังคับ)">
            <input
              autoFocus
              type="number"
              min="0"
              step="0.01"
              value={proposedPrice}
              onChange={(event) => setProposedPrice(event.target.value)}
            />
          </Field>
        )}
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
        <Field
          label={
            decision === "RETURN" ? "เหตุผลที่ส่งกลับ" : "หมายเหตุ (ไม่บังคับ)"
          }
          required={decision === "RETURN"}
        >
          <textarea
            required={decision === "RETURN"}
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
              ? proposedPrice === ""
                ? "ส่งให้ผู้จัดการกำหนดราคา"
                : "ส่งให้บัญชียืนยัน"
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
  rows,
  hasScopeFilter,
  operations,
  registry,
  onApply,
}: {
  rows: PriceAgreement[];
  hasScopeFilter: boolean;
  operations: OperationsState;
  registry: ReturnType<typeof loadIntakeRegistry>;
  onApply: (state: OperationsState, count: number) => void;
}) {
  const [method, setMethod] = useState<"AMOUNT" | "PERCENT">("AMOUNT");
  const [direction, setDirection] = useState<"UP" | "DOWN">("UP");
  const [value, setValue] = useState(5);
  const [reason, setReason] = useState("ปรับตามต้นทุนเชื้อเพลิง");
  const matches = rows;
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
        <div className="batch-filter-status">
          ตัวกรองด้านบนเลือกไว้ <strong>{matches.length}</strong> รายการ
        </div>
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
          disabled={!matches.length || !hasScopeFilter}
        >
          {hasScopeFilter
            ? `ยืนยันสร้างราคาใหม่ ${matches.length} รายการ`
            : "เลือกตัวกรองอย่างน้อย 1 รายการ"}
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
