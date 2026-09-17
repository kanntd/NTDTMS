import { useEffect, useRef, useState } from "react";
import {
  Search,
  Download,
  RefreshCw,
  FileText,
  ArrowRight,
  Banknote,
  CalendarDays,
} from "lucide-react";
import { useWorkspace } from "./context";
import { Button, Empty, IconButton, Loading, Pagination } from "./ui";
import { downloadCsv, localDate, money, thaiDate, thaiTime } from "./domain";
import {
  PAYMENT_LABELS,
  STATUS_LABELS,
  type Shipment,
  type ShipmentDetail,
  type Item,
} from "./types";
import Receipt from "./Receipt";
import ShipmentTracking from "./ShipmentTracking";

export default function Shipments({
  finance = false,
  initialSearch = "",
}: {
  finance?: boolean;
  initialSearch?: string;
}) {
  if (!finance) return <ShipmentTracking initialSearch={initialSearch} />;
  return <ShipmentRegister finance initialSearch={initialSearch} />;
}

function ShipmentRegister({
  finance = false,
  initialSearch = "",
}: {
  finance?: boolean;
  initialSearch?: string;
}) {
  const w = useWorkspace(),
    [search, setSearch] = useState(initialSearch),
    [date, setDate] = useState(
      finance || initialSearch.trim() ? "" : localDate(),
    ),
    [zone, setZone] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(0),
    [rows, setRows] = useState<Shipment[]>([]),
    [count, setCount] = useState(0),
    [loading, setLoading] = useState(true),
    [failure, setFailure] = useState(""),
    [detail, setDetail] = useState<ShipmentDetail | null>(null),
    [searchItems, setSearchItems] = useState<Record<string, Item[]>>({});
  const loadedOnce = useRef(false);
  useEffect(() => {
    setSearch(initialSearch);
    if (initialSearch.trim()) setDate("");
  }, [initialSearch]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      w.service
        .shipments({ search, date, zone, status, page, unpaid: finance })
        .then((r) => {
          if (active) {
            setRows(r.rows);
            setCount(r.count);
            setFailure("");
            loadedOnce.current = true;
          }
        })
        .catch((e) => {
          if (active) setFailure(e.message);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 180);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [w.service, w.revision, search, date, zone, status, page, finance]);
  useEffect(() => {
    if (finance || !search.trim() || rows.length === 0) {
      setSearchItems({});
      return;
    }
    let active = true;
    void Promise.allSettled(
      rows.map(async (row) => {
        if (row.items) return [row.id, row.items] as const;
        const shipment = await w.service.detail(row.id);
        return [row.id, shipment.items] as const;
      }),
    ).then((results) => {
      if (!active) return;
      setSearchItems(
        Object.fromEntries(
          results.flatMap((result) =>
            result.status === "fulfilled" ? [result.value] : [],
          ),
        ),
      );
    });
    return () => {
      active = false;
    };
  }, [finance, rows, search, w.service]);
  function exportRows() {
    downloadCsv(
      "NTD-" +
        (finance ? "ยอดค้างชำระ" : "รายการขนส่ง") +
        "-" +
        localDate() +
        ".csv",
      [
        [
          "เลขบิล",
          "วันที่",
          "ผู้ส่ง",
          "ผู้รับ",
          "จังหวัด",
          "อำเภอ",
          "ชำระเงิน",
          "จำนวน",
          "ค่าขนส่ง",
          "รับเงินแล้ว",
          "คงเหลือ",
          "สถานะ",
        ],
        ...rows.map((s) => [
          s.shipment_no,
          thaiDate(s.received_at),
          s.sender_snapshot.display_name,
          s.receiver_snapshot.display_name,
          s.zone_name,
          s.district_name,
          PAYMENT_LABELS[s.payment_mode],
          s.total_quantity,
          s.total_amount,
          s.paid_amount,
          s.outstanding_amount,
          STATUS_LABELS[s.shipment_status],
        ]),
      ],
    );
    w.toast("ส่งออก " + rows.length + " รายการในหน้านี้แล้ว");
  }
  async function open(s: Shipment) {
    try {
      setDetail(await w.service.detail(s.id));
    } catch (e) {
      w.toast((e as Error).message, true);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="breadcrumb">
            {finance ? "การเงิน" : "งานหน้าสาขา"} <span>/</span>{" "}
            {finance ? "ยอดค้างชำระ" : "ใบรับสินค้า"}
          </div>
          <h1>
            {finance ? "รับชำระและยอดค้าง" : "รายการขนส่ง"}
            <span className="heading-dot" />
          </h1>
          <p>
            {finance
              ? "ยอดคงเหลือจากใบเรียกเก็บเงินและรายการรับชำระ"
              : "ใบรับสินค้าทั้งหมดของสาขา"}
          </p>
        </div>
        <div className="heading-actions">
          <Button onClick={exportRows} disabled={loading || rows.length === 0}>
            <Download size={16} />
            ส่งออกหน้านี้
          </Button>
        </div>
      </div>
      {finance && (
        <div className="finance-summary">
          <div>
            <Banknote size={23} />
            <div>
              <span>ยอดค้างในหน้านี้</span>
              <strong>
                ฿ {money(rows.reduce((a, s) => a + s.outstanding_amount, 0))}
              </strong>
            </div>
          </div>
          <div>
            <CalendarDays size={23} />
            <div>
              <span>เกินกำหนดในหน้านี้</span>
              <strong className="danger-text">
                ฿{" "}
                {money(
                  rows
                    .filter(
                      (s) =>
                        s.due_date < localDate() &&
                        s.payment_mode.startsWith("CREDIT"),
                    )
                    .reduce((a, s) => a + s.outstanding_amount, 0),
                )}
              </strong>
            </div>
          </div>
          <div>
            <FileText size={23} />
            <div>
              <span>จำนวนบิลค้างทั้งหมดที่ค้นพบ</span>
              <strong>
                {count} <small>ใบ</small>
              </strong>
            </div>
          </div>
        </div>
      )}
      <section className="register-section">
        <div className="register-tabs">
          <button
            className={!status ? "active" : ""}
            onClick={() => {
              setStatus("");
              setPage(0);
            }}
          >
            {finance ? "รอรับชำระ" : "ทั้งหมด"}
            <span>{!status ? count : ""}</span>
          </button>
          {!finance &&
            Object.entries(STATUS_LABELS).map(([key, label]) => (
              <button
                key={key}
                className={status === key ? "active" : ""}
                onClick={() => {
                  setStatus(key);
                  setPage(0);
                }}
              >
                {label}
              </button>
            ))}
        </div>
        <div className="table-toolbar">
          <div className="input-icon search-field">
            <Search size={17} />
            <input
              placeholder="ค้นหาเลขบิล ผู้รับ ผู้ส่ง เบอร์โทร หรือสินค้า"
              aria-label="ค้นหาบิล"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                if (e.target.value.trim()) setDate("");
                setPage(0);
              }}
            />
          </div>
          <select
            aria-label="กรองจังหวัด"
            value={zone}
            onChange={(e) => {
              setZone(e.target.value);
              setPage(0);
            }}
          >
            <option value="">ทุกจังหวัด</option>
            {w.zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
          <input
            type="date"
            aria-label="วันที่รับสินค้า"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setPage(0);
            }}
          />
          {date && (
            <Button
              className="text-button"
              onClick={() => {
                setDate("");
                setPage(0);
              }}
            >
              ทุกวัน
            </Button>
          )}
          <IconButton label="รีเฟรชข้อมูล" onClick={w.refresh}>
            <RefreshCw size={17} />
          </IconButton>
        </div>
        {failure ? (
          <div className="alert error" role="alert">
            {failure}
            <Button onClick={w.refresh}>ลองใหม่</Button>
          </div>
        ) : loading && !loadedOnce.current ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty
            title={
              finance
                ? "ไม่มียอดค้างชำระตามตัวกรองนี้"
                : "ยังไม่มีรายการตามตัวกรองนี้"
            }
          />
        ) : (
          <div className="data-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>เลขบิล / เวลา</th>
                  <th>ผู้ส่ง / ผู้รับ</th>
                  {!finance && <th>รายการสินค้า</th>}
                  <th>ปลายทาง</th>
                  <th>การชำระเงิน</th>
                  <th className="numeric">ค่าขนส่ง</th>
                  {finance ? (
                    <th className="numeric">คงเหลือ</th>
                  ) : (
                    <th>สถานะ</th>
                  )}
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} onDoubleClick={() => void open(s)}>
                    <td>
                      <button
                        className="document-link"
                        onClick={() => void open(s)}
                      >
                        {s.shipment_no}
                      </button>
                      <small>
                        {thaiDate(s.received_at)} · {thaiTime(s.received_at)}
                      </small>
                    </td>
                    <td>
                      <strong>{s.sender_snapshot.display_name}</strong>
                      <small className="receiver-line">
                        <ArrowRight size={11} />
                        {s.receiver_snapshot.display_name}
                      </small>
                    </td>
                    {!finance && (
                      <td>
                        {(() => {
                          const items = s.items || searchItems[s.id];
                          if (!items)
                            return (
                              <span className="muted small">
                                ค้นหาเพื่อแสดงรายการสินค้า
                              </span>
                            );
                          return (
                            <ul className="shipment-search-items">
                              {items.map((item) => (
                                <li key={item.id}>
                                  <span>{item.description}</span>
                                  <b>
                                    {item.quantity} {item.unit}
                                  </b>
                                </li>
                              ))}
                            </ul>
                          );
                        })()}
                      </td>
                    )}
                    <td>
                      <span
                        className="province-label"
                        style={{ color: s.zone_color }}
                      >
                        <i style={{ background: s.zone_color }} />
                        {s.zone_name}
                      </span>
                      <small>{s.district_name}</small>
                    </td>
                    <td>
                      <span
                        className={
                          "payment-badge " +
                          (s.payment_mode.startsWith("CREDIT") ? "credit" : "")
                        }
                      >
                        {PAYMENT_LABELS[s.payment_mode]}
                      </span>
                      <small>
                        {s.outstanding_amount === 0 &&
                        s.shipment_status !== "CANCELLED"
                          ? "ชำระครบแล้ว"
                          : finance && s.payment_mode.startsWith("CREDIT")
                            ? "ครบกำหนด " + thaiDate(s.due_date)
                            : s.paid_amount > 0
                              ? "ชำระบางส่วน"
                              : "รอรับชำระ"}
                      </small>
                    </td>
                    <td className="numeric">
                      <strong>{money(s.total_amount)}</strong>
                    </td>
                    {finance ? (
                      <td className="numeric">
                        <strong
                          className={
                            s.due_date < localDate() &&
                            s.payment_mode.startsWith("CREDIT")
                              ? "danger-text"
                              : ""
                          }
                        >
                          {money(s.outstanding_amount)}
                        </strong>
                      </td>
                    ) : (
                      <td>
                        <span className={"badge status-" + s.shipment_status}>
                          {STATUS_LABELS[s.shipment_status]}
                        </span>
                      </td>
                    )}
                    <td>
                      <IconButton
                        label={"เปิดบิล " + s.shipment_no}
                        onClick={() => void open(s)}
                      >
                        <ArrowRight size={17} />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination count={count} page={page} onChange={setPage} />
      </section>
      {detail && <Receipt shipment={detail} onClose={() => setDetail(null)} />}
    </>
  );
}
