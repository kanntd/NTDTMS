import { useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  ArrowUpDown,
  Check,
  ClipboardCheck,
  PackageCheck,
  Search,
  Truck,
} from "lucide-react";
import { useWorkspace } from "./context";
import { localDate, money, number, thaiDate } from "./domain";
import { BRANCH_OPTIONS } from "./intakeData";
import { currentDriver, loadOperations, type Vehicle } from "./operationsStore";
import { calendarAgeInBangkok } from "./dashboardQueue";
import { Button, Empty, Field, Loading, Modal } from "./ui";
import type { LoadingQueueRecord } from "./types";

type SortMode = "OLDEST" | "RECEIVER" | "SENDER" | "NEWEST";
type AgeFilter = "" | "0" | "1" | "2" | "3" | "MORE_THAN_3";

function branchCode(
  row: LoadingQueueRecord,
  zones: ReturnType<typeof useWorkspace>["zones"],
) {
  const sawankhalok = BRANCH_OPTIONS.find((item) => item.code === "SWL");
  return (
    row.destination_branch_code ||
    (row.district_id === sawankhalok?.districtId ? "SWL" : "") ||
    zones.find((zone) => zone.id === row.zone_id)?.code ||
    ""
  );
}

function districtName(
  row: LoadingQueueRecord,
  zones: ReturnType<typeof useWorkspace>["zones"],
) {
  return (
    zones
      .flatMap((zone) => zone.districts)
      .find((district) => district.id === row.district_id)?.name ||
    "ไม่ระบุอำเภอ"
  );
}

function normalized(value: string) {
  return value.toLocaleLowerCase("th").replace(/[\s.-]/g, "");
}

export default function LoadingWork({
  initialBranch,
}: {
  initialBranch: string;
}) {
  const w = useWorkspace();
  const [rows, setRows] = useState<LoadingQueueRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [branch, setBranch] = useState(initialBranch);
  const [district, setDistrict] = useState("");
  const [age, setAge] = useState<AgeFilter>("");
  const [sort, setSort] = useState<SortMode>("OLDEST");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [busy, setBusy] = useState(false);
  const operations = useMemo(() => loadOperations(), []);
  const vehicles = operations.vehicles.filter((vehicle) => vehicle.active);

  useEffect(() => {
    setBranch(initialBranch);
    setDistrict("");
    setSelected(new Set());
  }, [initialBranch]);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setRows(await w.service.loadingQueue());
    } catch (cause) {
      setError((cause as Error).message || "โหลดรายการขึ้นรถไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [w.revision]);

  const districts = useMemo(
    () =>
      [
        ...new Set(
          rows
            .filter((row) => !branch || branchCode(row, w.zones) === branch)
            .map((row) => districtName(row, w.zones)),
        ),
      ].sort((a, b) => a.localeCompare(b, "th")),
    [rows, branch, w.zones],
  );

  const visible = useMemo(() => {
    const query = normalized(search);
    return rows
      .filter((row) => row.shipment_status === "RECEIVED")
      .filter((row) => !branch || branchCode(row, w.zones) === branch)
      .filter((row) => !district || districtName(row, w.zones) === district)
      .filter((row) => {
        const billAge = calendarAgeInBangkok(row.received_at);
        if (!age) return true;
        if (age === "MORE_THAN_3") return billAge > 3;
        return billAge === Number(age);
      })
      .filter((row) => {
        if (!query) return true;
        return normalized(
          [
            row.shipment_no,
            row.receiver_snapshot.display_name,
            row.receiver_snapshot.phone,
            row.sender_snapshot.display_name,
            row.sender_snapshot.phone,
            ...row.items.flatMap((item) => [item.description, item.unit]),
          ].join(" "),
        ).includes(query);
      })
      .sort((a, b) => {
        if (sort === "RECEIVER")
          return a.receiver_snapshot.display_name.localeCompare(
            b.receiver_snapshot.display_name,
            "th",
          );
        if (sort === "SENDER")
          return a.sender_snapshot.display_name.localeCompare(
            b.sender_snapshot.display_name,
            "th",
          );
        const time = +new Date(a.received_at) - +new Date(b.received_at);
        return sort === "NEWEST" ? -time : time;
      });
  }, [rows, branch, district, age, search, sort, w.zones]);

  const selectedRows = rows.filter((row) => selected.has(row.id));
  const selectedBranches = new Set(
    selectedRows.map((row) => branchCode(row, w.zones)),
  );
  const mixedBranches = selectedBranches.size > 1;
  const selectedQuantity = selectedRows.reduce(
    (sum, row) => sum + row.total_quantity,
    0,
  );
  const selectedAmount = selectedRows.reduce(
    (sum, row) => sum + row.total_amount,
    0,
  );
  const vehicle = vehicles.find((row) => row.id === vehicleId);
  const driver = vehicle ? currentDriver(operations, vehicle.id) : undefined;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleVisible() {
    setSelected((current) => {
      const next = new Set(current);
      const allSelected = visible.every((row) => next.has(row.id));
      visible.forEach((row) =>
        allSelected ? next.delete(row.id) : next.add(row.id),
      );
      return next;
    });
  }

  async function confirmLoad() {
    if (!vehicle || !driver || selectedRows.length === 0 || mixedBranches)
      return;
    setBusy(true);
    try {
      const confirmedAt = new Date().toISOString();
      const manifestNo = `LOAD-${localDate().replaceAll("-", "").slice(2)}-${String(Date.now()).slice(-4)}`;
      await w.service.confirmLoad([...selected], {
        manifestNo,
        vehicleId: vehicle.id,
        vehicleNo: vehicle.plateNo,
        driverId: driver.id,
        driverName: driver.name,
        confirmedAt,
      });
      setSelected(new Set());
      setVehicleId("");
      setConfirming(false);
      w.refresh();
      w.toast(`ยืนยันขึ้นรถ ${manifestNo} แล้ว`);
    } catch (cause) {
      w.toast((cause as Error).message || "ยืนยันขึ้นรถไม่สำเร็จ", true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="breadcrumb">
            สำนักงานใหญ่ <span>/</span> งานขนส่ง
          </div>
          <h1>
            งานขึ้นรถ
            <span className="heading-dot" />
          </h1>
          <p>เลือกบิลตามสาขาปลายทางและยืนยันเมื่อสินค้าขึ้นรถแล้ว</p>
        </div>
      </div>

      <section className="loading-workspace">
        <div className="loading-toolbar">
          <div className="input-icon loading-search">
            <Search size={17} />
            <input
              aria-label="ค้นหาบิลรอขึ้นรถ"
              placeholder="ค้นหาเลขบิล ผู้รับ ผู้ส่ง เบอร์โทร หรือสินค้า"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <select
            aria-label="เลือกสาขาปลายทาง"
            value={branch}
            onChange={(event) => {
              setBranch(event.target.value);
              setDistrict("");
              setSelected(new Set());
            }}
          >
            <option value="">ทุกสาขา</option>
            {BRANCH_OPTIONS.filter((item) =>
              ["KPT", "PLK", "STI", "SWL"].includes(item.code),
            )
              .sort(
                (a, b) =>
                  ["KPT", "PLK", "STI", "SWL"].indexOf(a.code) -
                  ["KPT", "PLK", "STI", "SWL"].indexOf(b.code),
              )
              .map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
          </select>
          <select
            aria-label="กรองอำเภอ"
            value={district}
            onChange={(event) => setDistrict(event.target.value)}
          >
            <option value="">ทุกอำเภอ</option>
            {districts.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <select
            aria-label="กรองอายุบิล"
            value={age}
            onChange={(event) => setAge(event.target.value as AgeFilter)}
          >
            <option value="">ทุกอายุบิล</option>
            <option value="0">วันนี้</option>
            <option value="1">ค้าง 1 วัน</option>
            <option value="2">ค้าง 2 วัน</option>
            <option value="3">ค้าง 3 วัน</option>
            <option value="MORE_THAN_3">ค้างมากกว่า 3 วัน</option>
          </select>
          <label className="loading-sort">
            <ArrowUpDown size={16} />
            <select
              aria-label="เรียงรายการ"
              value={sort}
              onChange={(event) => setSort(event.target.value as SortMode)}
            >
              <option value="OLDEST">เก่าสุดก่อน</option>
              <option value="NEWEST">ใหม่สุดก่อน</option>
              <option value="RECEIVER">ผู้รับ ก-ฮ</option>
              <option value="SENDER">ผู้ส่ง ก-ฮ</option>
            </select>
          </label>
        </div>

        {error ? (
          <div className="alert error">{error}</div>
        ) : loading ? (
          <Loading />
        ) : visible.length === 0 ? (
          <Empty title="ไม่พบบิลรอขึ้นรถตามตัวกรองนี้" />
        ) : (
          <div className="data-table-scroll">
            <table className="loading-table">
              <thead>
                <tr>
                  <th className="loading-check">
                    <input
                      type="checkbox"
                      aria-label="เลือกบิลที่แสดงทั้งหมด"
                      checked={
                        visible.length > 0 &&
                        visible.every((row) => selected.has(row.id))
                      }
                      onChange={toggleVisible}
                    />
                  </th>
                  <th>เลขบิล / วันที่</th>
                  <th>ผู้รับ</th>
                  <th>ผู้ส่ง</th>
                  <th>รายการสินค้า</th>
                  <th>อำเภอ</th>
                  <th className="numeric">ราคาบิล</th>
                  <th>อายุบิล</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((row) => {
                  const billAge = calendarAgeInBangkok(row.received_at);
                  const metadata = BRANCH_OPTIONS.find(
                    (item) => item.code === branchCode(row, w.zones),
                  );
                  return (
                    <tr
                      key={row.id}
                      className={selected.has(row.id) ? "selected" : ""}
                      style={
                        {
                          "--branch-color": metadata?.color || "#5f7369",
                        } as CSSProperties
                      }
                    >
                      <td className="loading-check">
                        <input
                          type="checkbox"
                          aria-label={`เลือกบิล ${row.shipment_no}`}
                          checked={selected.has(row.id)}
                          onChange={() => toggle(row.id)}
                        />
                      </td>
                      <td>
                        <strong>{row.shipment_no}</strong>
                        <small>{thaiDate(row.received_at)}</small>
                      </td>
                      <td>
                        <strong>{row.receiver_snapshot.display_name}</strong>
                        <small>{row.receiver_snapshot.phone}</small>
                      </td>
                      <td>
                        <strong>{row.sender_snapshot.display_name}</strong>
                        <small>{row.sender_snapshot.phone}</small>
                      </td>
                      <td>
                        <ul className="loading-items">
                          {row.items.map((item) => (
                            <li key={item.id}>
                              <span>{item.description}</span>
                              <b>
                                {number(item.quantity)} {item.unit}
                              </b>
                              <small>
                                {row.price_pending
                                  ? "รอราคา"
                                  : `@ ${money(item.unit_price)}`}
                              </small>
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td>
                        {districtName(row, w.zones)}
                        <small
                          className="loading-branch"
                          style={{ color: metadata?.color }}
                        >
                          {metadata?.name || branchCode(row, w.zones)}
                        </small>
                      </td>
                      <td className="numeric">
                        <strong>
                          {row.price_pending
                            ? "รอราคา"
                            : money(row.total_amount)}
                        </strong>
                      </td>
                      <td>
                        <span
                          className={
                            "loading-age " +
                            (billAge > 3
                              ? "danger"
                              : billAge >= 2
                                ? "warning"
                                : "")
                          }
                        >
                          {billAge === 0 ? "วันนี้" : `${billAge} วัน`}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedRows.length > 0 && (
        <div className="loading-selection-bar">
          <div>
            <Check size={18} />
            <strong>เลือกแล้ว {number(selectedRows.length)} บิล</strong>
            <span>{number(selectedQuantity)} ชิ้น</span>
            <span>
              {selectedRows.some((row) => row.price_pending)
                ? `ยอดที่ทราบ ฿${money(selectedAmount)}`
                : `฿${money(selectedAmount)}`}
            </span>
          </div>
          {mixedBranches && <small>กรุณาเลือกบิลที่ไปสาขาเดียวกัน</small>}
          <Button
            className="primary"
            disabled={mixedBranches}
            onClick={() => setConfirming(true)}
          >
            <PackageCheck size={17} />
            สร้างรายการขึ้นรถ
          </Button>
        </div>
      )}

      {confirming && (
        <Modal title="ยืนยันรายการขึ้นรถ" onClose={() => setConfirming(false)}>
          <div className="modal-body load-confirmation">
            <div className="load-confirm-summary">
              <ClipboardCheck size={22} />
              <div>
                <strong>{selectedRows.length} บิล</strong>
                <span>
                  {number(selectedQuantity)} ชิ้น · ฿{money(selectedAmount)}
                </span>
              </div>
            </div>
            <Field label="ทะเบียนรถ" required>
              <select
                value={vehicleId}
                onChange={(event) => setVehicleId(event.target.value)}
              >
                <option value="">เลือกทะเบียนรถ</option>
                {vehicles.map((row: Vehicle) => (
                  <option key={row.id} value={row.id}>
                    {row.plateNo} · {row.vehicleType}
                  </option>
                ))}
              </select>
            </Field>
            <div className="load-driver">
              <Truck size={18} />
              <div>
                <span>พนักงานขับรถ</span>
                <strong>
                  {vehicleId
                    ? driver?.name || "ทะเบียนนี้ยังไม่ได้ผูกคนขับ"
                    : "เลือกทะเบียนรถก่อน"}
                </strong>
              </div>
            </div>
            <div className="modal-footer">
              <Button onClick={() => setConfirming(false)}>ยกเลิก</Button>
              <Button
                className="primary"
                busy={busy}
                disabled={!vehicle || !driver}
                onClick={() => void confirmLoad()}
              >
                <Truck size={17} />
                ยืนยันขึ้นรถ
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
