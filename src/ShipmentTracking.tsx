import { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Download,
  Eye,
  LockKeyhole,
  Pencil,
  Printer,
  RefreshCw,
  RotateCcw,
  Search,
} from "lucide-react";
import { useWorkspace } from "./context";
import { billEditAccessMessage, canEditShipment } from "./billEditPolicy";
import {
  downloadCsv,
  localDate,
  money,
  number,
  thaiDate,
  thaiTime,
} from "./domain";
import { destinationBranches } from "./branchRoutes";
import { loadIntakeRegistry } from "./intakeRegistry";
import { loadOperations } from "./operationsStore";
import { loadRemoteWorkspace } from "./remoteWorkspace";
import Receipt from "./Receipt";
import ShipmentEditModal from "./ShipmentEditModal";
import {
  PAYMENT_LABELS,
  STATUS_LABELS,
  type PaymentMode,
  type Shipment,
  type ShipmentDetail,
} from "./types";
import { Button, Empty, IconButton, Loading, Pagination } from "./ui";

const PAGE_SIZE = 20;

type Filters = {
  query: string;
  dateFrom: string;
  dateTo: string;
  receiverId: string;
  senderId: string;
  catalogId: string;
  unit: string;
  payment: PaymentMode | "";
  branch: string;
  district: string;
  openedBy: string;
  status: string;
  priceState: "PENDING" | "PRICED" | "";
  paymentState: "PAID" | "PARTIAL" | "UNPAID" | "";
};

type FilterOption = { id: string; label: string; detail?: string };

const emptyFilters: Filters = {
  query: "",
  dateFrom: "",
  dateTo: "",
  receiverId: "",
  senderId: "",
  catalogId: "",
  unit: "",
  payment: "",
  branch: "",
  district: "",
  openedBy: "",
  status: "",
  priceState: "",
  paymentState: "",
};

export default function ShipmentTracking({
  initialSearch = "",
}: {
  initialSearch?: string;
}) {
  const w = useWorkspace();
  const [filters, setFilters] = useState<Filters>({
    ...emptyFilters,
    query: initialSearch,
  });
  const [registry, setRegistry] = useState(loadIntakeRegistry);
  const [operations, setOperations] = useState(loadOperations);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Shipment[]>([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState("");
  const [detail, setDetail] = useState<ShipmentDetail | null>(null);
  const [editDetail, setEditDetail] = useState<ShipmentDetail | null>(null);
  const [autoPrint, setAutoPrint] = useState(false);
  const loadedOnce = useRef(false);

  useEffect(() => {
    setFilters((current) => ({ ...current, query: initialSearch }));
    setPage(0);
  }, [initialSearch]);

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
      .catch((error) => active && w.toast(error.message, true));
    return () => {
      active = false;
    };
  }, [w.demo, w.revision]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      void w.service
        .shipments({
          search: filters.query,
          dateFrom: filters.dateFrom,
          dateTo: filters.dateTo,
          receiverId: filters.receiverId,
          senderId: filters.senderId,
          catalogId: filters.catalogId,
          unit: filters.unit,
          payment: filters.payment,
          branch: filters.branch,
          district: filters.district,
          openedBy: filters.openedBy,
          status: filters.status,
          priceState: filters.priceState,
          paymentState: filters.paymentState,
          page,
          pageSize: PAGE_SIZE,
        })
        .then((result) => {
          if (!active) return;
          setRows(result.rows);
          setCount(result.count);
          setFailure("");
          loadedOnce.current = true;
        })
        .catch((error) => active && setFailure(error.message))
        .finally(() => active && setLoading(false));
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [filters, page, w.revision, w.service]);

  const receiverOptions = useMemo(
    () =>
      registry.parties
        .filter((party) => registry.partyRoles[party.id]?.receiver)
        .map((party) => ({
          id: party.id,
          label: party.display_name,
          detail: party.phone,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "th")),
    [registry],
  );
  const senderOptions = useMemo(
    () =>
      registry.parties
        .filter((party) => registry.partyRoles[party.id]?.sender)
        .map((party) => ({
          id: party.id,
          label: party.display_name,
          detail: party.phone,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "th")),
    [registry],
  );
  const productOptions = useMemo(
    () =>
      registry.catalog
        .map((item) => ({
          id: item.id,
          label: `${item.name} · ${item.unit}`,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "th")),
    [registry.catalog],
  );
  const unitOptions = useMemo(
    () =>
      [...new Set(registry.catalog.map((item) => item.unit).filter(Boolean))]
        .sort((a, b) => a.localeCompare(b, "th"))
        .map((unit) => ({ id: unit, label: unit })),
    [registry.catalog],
  );
  const employeeOptions = useMemo(
    () =>
      operations.employees
        .filter((employee) => employee.active)
        .map((employee) => ({
          id: employee.id,
          label: employee.nickname || employee.name,
          detail: employee.nickname ? employee.name : employee.position,
        }))
        .sort((a, b) => a.label.localeCompare(b.label, "th")),
    [operations.employees],
  );
  const employeeNames = useMemo(
    () =>
      Object.fromEntries(
        operations.employees.map((employee) => [
          employee.id,
          employee.nickname || employee.name,
        ]),
      ),
    [operations.employees],
  );
  const districts = useMemo(
    () =>
      w.zones.flatMap((zone) =>
        zone.districts.map((district) => ({
          id: district.id,
          label: `${district.name} · ${zone.name}`,
        })),
      ),
    [w.zones],
  );

  const hasFilters = Object.values(filters).some(Boolean);
  const patch = (next: Partial<Filters>) => {
    setFilters((current) => ({ ...current, ...next }));
    setPage(0);
  };

  async function open(row: Shipment, print = false) {
    try {
      setAutoPrint(print);
      setDetail(await w.service.detail(row.id));
    } catch (error) {
      w.toast((error as Error).message, true);
    }
  }

  async function edit(row: Shipment) {
    if (!canEditShipment(w.profile.role, row.shipment_status)) {
      w.toast(billEditAccessMessage(w.profile.role, row.shipment_status), true);
      return;
    }
    try {
      setEditDetail(await w.service.detail(row.id));
    } catch (error) {
      w.toast((error as Error).message, true);
    }
  }

  function exportRows() {
    downloadCsv(`NTD-ค้นหาและติดตามบิล-${localDate()}.csv`, [
      [
        "เลขบิล",
        "วันที่เปิดบิล",
        "ผู้รับ",
        "ผู้ส่ง",
        "สินค้า",
        "จำนวน",
        "หน่วย",
        "สาขาปลายทาง",
        "อำเภอ",
        "ประเภทชำระเงิน",
        "ยอดบิล",
        "สถานะบิล",
        "วันที่ขึ้นรถ",
        "ทะเบียนรถ",
        "เลขใบคลุมรถ",
        "วันที่ส่งสำเร็จ",
      ],
      ...rows.flatMap((shipment) =>
        (shipment.items?.length ? shipment.items : [undefined]).map((item) => [
          shipment.shipment_no,
          shipment.received_at,
          shipment.receiver_snapshot.display_name,
          shipment.sender_snapshot.display_name,
          item?.description || "",
          item?.quantity || "",
          item?.unit || "",
          shipment.zone_name,
          shipment.district_name,
          PAYMENT_LABELS[shipment.payment_mode],
          shipment.total_amount,
          STATUS_LABELS[shipment.shipment_status],
          shipment.loaded_at || "",
          shipment.vehicle_plate_no || "",
          shipment.manifest_no || "",
          shipment.delivered_at || "",
        ]),
      ),
    ]);
    w.toast(`ส่งออก ${rows.length} บิลในหน้านี้แล้ว`);
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="breadcrumb">
            งานหน้าสาขา <span>/</span> ตรวจสอบสถานะ
          </div>
          <h1>
            ค้นหาและติดตามบิล
            <span className="heading-dot" />
          </h1>
          <p>ค้นหาบิลย้อนหลัง ตรวจสอบสินค้า การขึ้นรถ และการส่งมอบ</p>
        </div>
        <div className="heading-actions">
          <Button onClick={exportRows} disabled={loading || rows.length === 0}>
            <Download size={16} />
            ส่งออกหน้านี้
          </Button>
        </div>
      </div>

      <section className="shipment-search-panel" aria-label="ตัวกรองค้นหาบิล">
        <div className="shipment-search-topline">
          <label className="shipment-keyword">
            <Search size={17} />
            <input
              aria-label="ค้นหาบิล"
              placeholder="ค้นหาเลขบิล ผู้รับ ผู้ส่ง เบอร์โทร หรือสินค้า"
              value={filters.query}
              onChange={(event) => patch({ query: event.target.value })}
            />
          </label>
          <div className="shipment-search-summary">
            <strong>พบ {count} บิล</strong>
            {!hasFilters && <span>แสดง 20 บิลล่าสุด</span>}
            <Button
              type="button"
              disabled={!hasFilters}
              onClick={() => {
                setFilters(emptyFilters);
                setPage(0);
              }}
            >
              <RotateCcw size={15} />
              ล้างตัวกรอง
            </Button>
            <IconButton label="รีเฟรชข้อมูล" onClick={w.refresh}>
              <RefreshCw size={17} />
            </IconButton>
          </div>
        </div>

        <div className="shipment-filter-grid">
          <FilterDate
            label="ตั้งแต่วันที่"
            value={filters.dateFrom}
            max={filters.dateTo || undefined}
            onChange={(dateFrom) => patch({ dateFrom })}
          />
          <FilterDate
            label="ถึงวันที่"
            value={filters.dateTo}
            min={filters.dateFrom || undefined}
            onChange={(dateTo) => patch({ dateTo })}
          />
          <FilterPicker
            label="ผู้รับ"
            value={filters.receiverId}
            emptyLabel="ผู้รับทั้งหมด"
            options={receiverOptions}
            onChange={(receiverId) => patch({ receiverId })}
          />
          <FilterPicker
            label="ผู้ส่ง"
            value={filters.senderId}
            emptyLabel="ผู้ส่งทั้งหมด"
            options={senderOptions}
            onChange={(senderId) => patch({ senderId })}
          />
          <FilterPicker
            label="สินค้า / หน่วย"
            value={filters.catalogId}
            emptyLabel="สินค้าทั้งหมด"
            options={productOptions}
            onChange={(catalogId) => patch({ catalogId })}
          />
          <FilterSelect
            label="หน่วยนับ"
            value={filters.unit}
            emptyLabel="ทุกหน่วย"
            options={unitOptions}
            onChange={(unit) => patch({ unit })}
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
              patch({ payment: payment as Filters["payment"] })
            }
          />
          <FilterSelect
            label="สาขาปลายทาง"
            value={filters.branch}
            emptyLabel="ทุกสาขา"
            options={destinationBranches(w.branches, w.zones).map((branch) => ({
              id: branch.code,
              label: branch.name,
            }))}
            onChange={(branch) => patch({ branch })}
          />
          <FilterSelect
            label="อำเภอ"
            value={filters.district}
            emptyLabel="ทุกอำเภอ"
            options={districts}
            onChange={(district) => patch({ district })}
          />
          <FilterPicker
            label="ผู้เปิดบิล"
            value={filters.openedBy}
            emptyLabel="พนักงานทุกคน"
            options={employeeOptions}
            onChange={(openedBy) => patch({ openedBy })}
          />
          <FilterSelect
            label="สถานะการขนส่ง"
            value={filters.status}
            emptyLabel="ทุกสถานะ"
            options={Object.entries(STATUS_LABELS).map(([id, label]) => ({
              id,
              label,
            }))}
            onChange={(status) => patch({ status })}
          />
          <FilterSelect
            label="สถานะราคา"
            value={filters.priceState}
            emptyLabel="ทุกสถานะราคา"
            options={[
              { id: "PENDING", label: "รอราคา" },
              { id: "PRICED", label: "มีราคาแล้ว" },
            ]}
            onChange={(priceState) =>
              patch({ priceState: priceState as Filters["priceState"] })
            }
          />
          <FilterSelect
            label="สถานะการชำระเงิน"
            value={filters.paymentState}
            emptyLabel="ทุกสถานะชำระเงิน"
            options={[
              { id: "PAID", label: "ชำระครบแล้ว" },
              { id: "PARTIAL", label: "ชำระบางส่วน" },
              { id: "UNPAID", label: "ยังไม่ชำระ" },
            ]}
            onChange={(paymentState) =>
              patch({ paymentState: paymentState as Filters["paymentState"] })
            }
          />
        </div>
        <p className="shipment-filter-note">
          ไม่เลือกวันที่จะแสดง 20 บิลล่าสุด
          แต่ช่องค้นหาและตัวกรองค้นจากประวัติทั้งหมด
        </p>
      </section>

      <section className="register-section shipment-tracking-register">
        {failure ? (
          <div className="alert error" role="alert">
            {failure}
            <Button onClick={w.refresh}>ลองใหม่</Button>
          </div>
        ) : loading && !loadedOnce.current ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty title="ไม่พบบิลตามตัวกรองนี้" />
        ) : (
          <div className="data-table-scroll">
            <table className="data-table shipment-tracking-table">
              <thead>
                <tr>
                  <th>เลขบิล / วันที่</th>
                  <th>ผู้รับ / ผู้ส่ง</th>
                  <th>รายการสินค้า</th>
                  <th>ปลายทาง</th>
                  <th>ขึ้นรถ / ใบคลุมรถ</th>
                  <th>การส่งมอบ</th>
                  <th className="numeric">ยอดบิล</th>
                  <th>สถานะ</th>
                  <th>จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((shipment) => (
                  <tr key={shipment.id}>
                    <td>
                      <button
                        className="document-link"
                        onClick={() => void open(shipment)}
                      >
                        {shipment.shipment_no}
                      </button>
                      <small>
                        {thaiDate(shipment.received_at)} ·{" "}
                        {thaiTime(shipment.received_at)}
                      </small>
                      <small>
                        ผู้เปิดบิล:{" "}
                        {employeeNames[shipment.opened_by_employee_id || ""] ||
                          "ไม่ระบุ"}
                      </small>
                    </td>
                    <td>
                      <strong>{shipment.receiver_snapshot.display_name}</strong>
                      <small>
                        ผู้ส่ง: {shipment.sender_snapshot.display_name}
                      </small>
                    </td>
                    <td>
                      <ul className="shipment-search-items">
                        {(shipment.items || []).map((item) => (
                          <li key={item.id}>
                            <span>{item.description}</span>
                            <b>
                              {number(item.quantity)} {item.unit}
                            </b>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td>
                      <span
                        className="province-label"
                        style={{ color: shipment.zone_color }}
                      >
                        <i style={{ background: shipment.zone_color }} />
                        {shipment.zone_name}
                      </span>
                      <small>{shipment.district_name || "เมือง"}</small>
                    </td>
                    <td>
                      {shipment.shipment_status === "RECEIVED" ? (
                        <span className="muted">ยังไม่ขึ้นรถ</span>
                      ) : (
                        <>
                          <strong>
                            {shipment.loaded_at
                              ? thaiDate(shipment.loaded_at)
                              : "ขึ้นรถแล้ว"}
                          </strong>
                          <small>
                            ทะเบียน:{" "}
                            {shipment.vehicle_plate_no || "ยังไม่มีข้อมูล"}
                          </small>
                          <small>
                            ใบคลุมรถ: {shipment.manifest_no || "ยังไม่มีข้อมูล"}
                          </small>
                        </>
                      )}
                    </td>
                    <td>
                      {shipment.shipment_status === "DELIVERED" ? (
                        <>
                          <strong className="success-text">ส่งสำเร็จ</strong>
                          <small>
                            {shipment.delivered_at
                              ? thaiDate(shipment.delivered_at)
                              : "ยังไม่มีวันที่ส่ง"}
                          </small>
                        </>
                      ) : shipment.shipment_status === "CANCELLED" ? (
                        <span className="danger-text">ยกเลิก</span>
                      ) : (
                        <span className="muted">ยังไม่ส่งมอบ</span>
                      )}
                    </td>
                    <td className="numeric">
                      <strong>{money(shipment.total_amount)}</strong>
                      <small>{PAYMENT_LABELS[shipment.payment_mode]}</small>
                    </td>
                    <td>
                      <span
                        className={`badge status-${shipment.shipment_status}`}
                      >
                        {STATUS_LABELS[shipment.shipment_status]}
                      </span>
                      {shipment.price_pending && (
                        <small className="warning-text">รอราคา</small>
                      )}
                    </td>
                    <td>
                      <div className="shipment-row-actions">
                        <IconButton
                          label={`ดูบิล ${shipment.shipment_no}`}
                          onClick={() => void open(shipment)}
                        >
                          <Eye size={16} />
                        </IconButton>
                        <IconButton
                          label={`${billEditAccessMessage(w.profile.role, shipment.shipment_status)}: ${shipment.shipment_no}`}
                          disabled={
                            !canEditShipment(
                              w.profile.role,
                              shipment.shipment_status,
                            )
                          }
                          onClick={() => void edit(shipment)}
                        >
                          {canEditShipment(
                            w.profile.role,
                            shipment.shipment_status,
                          ) ? (
                            <Pencil size={16} />
                          ) : (
                            <LockKeyhole size={16} />
                          )}
                        </IconButton>
                        <IconButton
                          label={`พิมพ์ซ้ำบิล ${shipment.shipment_no}`}
                          onClick={() => void open(shipment, true)}
                        >
                          <Printer size={16} />
                        </IconButton>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          count={count}
          page={page}
          pageSize={PAGE_SIZE}
          onChange={setPage}
        />
      </section>

      {detail && (
        <Receipt
          shipment={detail}
          autoPrint={autoPrint}
          onClose={() => {
            setDetail(null);
            setAutoPrint(false);
          }}
        />
      )}
      {editDetail && (
        <ShipmentEditModal
          shipment={editDetail}
          registry={registry}
          operations={operations}
          onClose={() => setEditDetail(null)}
          onSaved={() => setEditDetail(null)}
        />
      )}
    </>
  );
}

function FilterDate({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: string;
  min?: string;
  max?: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="shipment-filter-control">
      <span>{label}</span>
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
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
    <label className="shipment-filter-control">
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
  const normalized = query.trim().toLocaleLowerCase("th");
  const visible = options.filter((option) =>
    `${option.label} ${option.detail || ""}`
      .toLocaleLowerCase("th")
      .includes(normalized),
  );
  function choose(next: string) {
    onChange(next);
    setQuery("");
    setOpen(false);
  }
  return (
    <div
      className="shipment-filter-control shipment-filter-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <span>{label}</span>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-options`}
        onClick={() => setOpen((currentOpen) => !currentOpen)}
      >
        <span>{current?.label || emptyLabel}</span>
        <ChevronDown size={15} />
      </button>
      {open && (
        <div className="shipment-filter-menu" id={`${id}-options`}>
          <label>
            <Search size={14} />
            <input
              autoFocus
              aria-label={`ค้นหา${label}`}
              value={query}
              placeholder={`ค้นหา${label}`}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.key === "Escape" && setOpen(false)}
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
              <span>{option.label}</span>
              {option.detail && <small>{option.detail}</small>}
            </button>
          ))}
          {!visible.length && <p>ไม่พบข้อมูล</p>}
        </div>
      )}
    </div>
  );
}
