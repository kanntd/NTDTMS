import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Ban,
  Edit3,
  Eye,
  RefreshCw,
  Search,
  Trash2,
  Truck,
} from "lucide-react";
import { useWorkspace } from "./context";
import { money, number, thaiDate } from "./domain";
import {
  currentDriver,
  type OperationsState,
  type Vehicle,
} from "./operationsStore";
import { Button, Empty, Field, Loading, Modal } from "./ui";
import type {
  LoadTripAllocation,
  LoadTripRecord,
  LoadTripStatus,
} from "./types";

const STATUS_LABELS: Record<LoadTripStatus, string> = {
  DRAFT: "แบบร่าง",
  LOADED: "จัดขึ้นรถแล้ว",
  DEPARTED: "รถออกแล้ว",
  RECEIVED: "ปลายทางรับรถแล้ว",
  CANCELLED: "ยกเลิก",
};

function activeLines(trip: LoadTripRecord) {
  return trip.status === "CANCELLED"
    ? trip.allocations
    : trip.allocations.filter((line) => line.active);
}

function uniqueBillCount(lines: LoadTripAllocation[]) {
  return new Set(lines.map((line) => line.shipmentId)).size;
}

export default function LoadTripManager({
  operations,
  onBack,
  onChanged,
}: {
  operations: OperationsState;
  onBack: () => void;
  onChanged: () => void;
}) {
  const w = useWorkspace();
  const [trips, setTrips] = useState<LoadTripRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<LoadTripStatus | "">("");
  const [branch, setBranch] = useState("");
  const [selectedTrip, setSelectedTrip] = useState<LoadTripRecord | null>(null);
  const [editing, setEditing] = useState(false);
  const [vehicleId, setVehicleId] = useState("");
  const [note, setNote] = useState("");
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const canManage = w.profile.role === "owner" || w.profile.role === "admin";
  const vehicles = operations.vehicles.filter((row) => row.active);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const next = await w.service.loadTrips();
      setTrips(next);
      if (selectedTrip) {
        const updated = next.find((row) => row.id === selectedTrip.id);
        if (updated) setSelectedTrip(updated);
      }
    } catch (cause) {
      setError((cause as Error).message || "โหลดเที่ยวรถไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [w.revision]);

  const branches = useMemo(
    () =>
      [
        ...new Set(
          trips.map((trip) => trip.destinationBranchCode).filter(Boolean),
        ),
      ]
        .map((code) => ({
          code,
          name:
            w.branches.find((row) => row.code === code)?.name ||
            w.zones.find((row) => row.code === code)?.name ||
            code,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "th")),
    [trips, w.branches, w.zones],
  );

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("th");
    return trips.filter((trip) => {
      const lines = activeLines(trip);
      if (status && trip.status !== status) return false;
      if (branch && trip.destinationBranchCode !== branch) return false;
      if (!query) return true;
      return [
        trip.manifestNo,
        trip.vehicleNo,
        trip.driverName,
        ...lines.flatMap((line) => [
          line.shipmentNo,
          line.receiverName,
          line.senderName,
          line.description,
        ]),
      ]
        .join(" ")
        .toLocaleLowerCase("th")
        .includes(query);
    });
  }, [trips, search, status, branch]);

  function branchName(trip: LoadTripRecord) {
    return (
      w.branches.find(
        (row) =>
          row.id === trip.destinationBranchId ||
          row.code === trip.destinationBranchCode,
      )?.name ||
      w.zones.find((row) => row.code === trip.destinationBranchCode)?.name ||
      trip.destinationBranchCode
    );
  }

  function vehicleNo(trip: LoadTripRecord) {
    return (
      operations.vehicles.find((row) => row.id === trip.vehicleId)?.plateNo ||
      trip.vehicleNo ||
      "ไม่ระบุ"
    );
  }

  function driverName(trip: LoadTripRecord) {
    const employee = operations.employees.find(
      (row) => row.id === trip.driverId,
    );
    return employee?.nickname || employee?.name || trip.driverName || "ไม่ระบุ";
  }

  function openTrip(trip: LoadTripRecord, edit = false) {
    setSelectedTrip(trip);
    setEditing(
      edit && canManage && !["RECEIVED", "CANCELLED"].includes(trip.status),
    );
    setVehicleId(trip.vehicleId);
    setNote(trip.note);
    setQuantities(
      Object.fromEntries(
        activeLines(trip).map((line) => [line.id, String(line.quantity)]),
      ),
    );
  }

  async function saveChanges() {
    if (!selectedTrip) return;
    const vehicle = vehicles.find((row) => row.id === vehicleId);
    const driver = vehicle ? currentDriver(operations, vehicle.id) : undefined;
    if (!vehicle || !driver) return;
    const allocations = activeLines(selectedTrip).map((line) => ({
      lineId: line.id,
      quantity: Number(quantities[line.id] || 0),
    }));
    if (!allocations.some((line) => line.quantity > 0)) {
      w.toast("ถ้าต้องการนำออกทั้งหมด กรุณายกเลิกทั้งเที่ยวรถ", true);
      return;
    }
    if (
      allocations.some(
        (line) => !Number.isFinite(line.quantity) || line.quantity < 0,
      )
    ) {
      w.toast("จำนวนสินค้าต้องไม่ติดลบ", true);
      return;
    }
    setBusy(true);
    try {
      await w.service.updateLoadTrip({
        id: selectedTrip.id,
        action: "UPDATE",
        vehicleId: vehicle.id,
        driverId: driver.id,
        driverName: driver.name,
        note,
        allocations,
      });
      w.toast(`บันทึกการแก้ไข ${selectedTrip.manifestNo} แล้ว`);
      setEditing(false);
      onChanged();
      await refresh();
    } catch (cause) {
      w.toast((cause as Error).message || "แก้ไขเที่ยวรถไม่สำเร็จ", true);
    } finally {
      setBusy(false);
    }
  }

  async function cancelTrip() {
    if (!selectedTrip) return;
    if (
      !window.confirm(
        `ยืนยันยกเลิกเที่ยว ${selectedTrip.manifestNo}\nสินค้าทั้งหมดจะกลับเข้าคิวรอขึ้นรถ`,
      )
    )
      return;
    setBusy(true);
    try {
      await w.service.updateLoadTrip({
        id: selectedTrip.id,
        action: "CANCEL",
      });
      w.toast(`ยกเลิก ${selectedTrip.manifestNo} แล้ว`);
      setSelectedTrip(null);
      onChanged();
      await refresh();
    } catch (cause) {
      w.toast((cause as Error).message || "ยกเลิกเที่ยวรถไม่สำเร็จ", true);
    } finally {
      setBusy(false);
    }
  }

  const editVehicle = vehicles.find((row) => row.id === vehicleId);
  const editDriver = editVehicle
    ? currentDriver(operations, editVehicle.id)
    : undefined;
  const selectedLines = selectedTrip ? activeLines(selectedTrip) : [];

  return (
    <>
      <div className="page-heading loading-page-heading">
        <div>
          <div className="breadcrumb">
            สำนักงานใหญ่ <span>/</span> งานขนส่ง
          </div>
          <h1>
            เที่ยวรถที่สร้างแล้ว <span className="heading-dot" />
          </h1>
          <p>ตรวจสอบรถ บิล และจำนวนสินค้าที่จัดขึ้นในแต่ละเที่ยว</p>
        </div>
        <div className="heading-actions">
          <Button onClick={onBack}>
            <ArrowLeft size={17} /> กลับคิวรอขึ้นรถ
          </Button>
          <Button onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={loading ? "spin" : ""} size={17} />
            อัปเดตข้อมูล
          </Button>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      <section className="trip-manager">
        <div className="trip-toolbar">
          <div className="input-icon">
            <Search size={17} />
            <input
              aria-label="ค้นหาเที่ยวรถ"
              placeholder="ค้นหาเลขเที่ยว ทะเบียน คนขับ เลขบิล ผู้รับ หรือผู้ส่ง"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <select
            aria-label="กรองสาขาปลายทางของเที่ยวรถ"
            value={branch}
            onChange={(event) => setBranch(event.target.value)}
          >
            <option value="">ทุกสาขา</option>
            {branches.map((row) => (
              <option key={row.code} value={row.code}>
                {row.name}
              </option>
            ))}
          </select>
          <select
            aria-label="กรองสถานะเที่ยวรถ"
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as LoadTripStatus | "")
            }
          >
            <option value="">ทุกสถานะ</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {loading && !trips.length ? (
          <Loading />
        ) : visible.length === 0 ? (
          <Empty title="ยังไม่มีเที่ยวรถตามเงื่อนไขนี้" />
        ) : (
          <div className="data-table-scroll">
            <table className="data-table trip-table">
              <thead>
                <tr>
                  <th>เลขเที่ยว / วันที่</th>
                  <th>สาขาปลายทาง</th>
                  <th>ทะเบียนรถ</th>
                  <th>พนักงานขับรถ</th>
                  <th className="numeric">จำนวนบิล</th>
                  <th className="numeric">จำนวนของ</th>
                  <th>สถานะ</th>
                  <th aria-label="คำสั่ง" />
                </tr>
              </thead>
              <tbody>
                {visible.map((trip) => {
                  const lines = activeLines(trip);
                  return (
                    <tr key={trip.id}>
                      <td>
                        <strong>{trip.manifestNo}</strong>
                        <small>{thaiDate(trip.loadedAt)}</small>
                      </td>
                      <td>{branchName(trip)}</td>
                      <td>{vehicleNo(trip)}</td>
                      <td>{driverName(trip)}</td>
                      <td className="numeric">
                        {number(uniqueBillCount(lines))}
                      </td>
                      <td className="numeric">
                        {number(
                          lines.reduce((sum, line) => sum + line.quantity, 0),
                        )}
                      </td>
                      <td>
                        <span className={`trip-status ${trip.status}`}>
                          {STATUS_LABELS[trip.status]}
                        </span>
                      </td>
                      <td className="trip-actions">
                        <Button onClick={() => openTrip(trip)}>
                          <Eye size={16} /> ดู
                        </Button>
                        {canManage &&
                          !["RECEIVED", "CANCELLED"].includes(trip.status) && (
                            <Button onClick={() => openTrip(trip, true)}>
                              <Edit3 size={16} /> แก้ไข
                            </Button>
                          )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedTrip && (
        <Modal
          wide
          title={`${editing ? "แก้ไข" : "รายละเอียด"} ${selectedTrip.manifestNo}`}
          onClose={() => setSelectedTrip(null)}
        >
          <div className="modal-body trip-detail">
            <div className="trip-detail-summary">
              <div>
                <span>สาขาปลายทาง</span>
                <strong>{branchName(selectedTrip)}</strong>
              </div>
              <div>
                <span>จำนวนบิล</span>
                <strong>{number(uniqueBillCount(selectedLines))}</strong>
              </div>
              <div>
                <span>จำนวนของ</span>
                <strong>
                  {number(
                    selectedLines.reduce((sum, line) => sum + line.quantity, 0),
                  )}
                </strong>
              </div>
              <div>
                <span>สถานะ</span>
                <strong>{STATUS_LABELS[selectedTrip.status]}</strong>
              </div>
            </div>

            {editing ? (
              <div className="trip-edit-fields">
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
                <Field label="พนักงานขับรถ">
                  <input
                    readOnly
                    value={
                      vehicleId
                        ? editDriver?.name || "ทะเบียนนี้ยังไม่ได้ผูกคนขับ"
                        : "เลือกทะเบียนรถก่อน"
                    }
                  />
                </Field>
                <Field label="หมายเหตุ">
                  <input
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="รายละเอียดเพิ่มเติมของเที่ยวรถ"
                  />
                </Field>
              </div>
            ) : (
              <div className="trip-vehicle-summary">
                <Truck size={20} />
                <div>
                  <strong>{vehicleNo(selectedTrip)}</strong>
                  <span>{driverName(selectedTrip)}</span>
                </div>
                {selectedTrip.note && <small>{selectedTrip.note}</small>}
              </div>
            )}

            <div className="data-table-scroll trip-line-scroll">
              <table className="data-table trip-line-table">
                <thead>
                  <tr>
                    <th>เลขบิล</th>
                    <th>ผู้รับ</th>
                    <th>ผู้ส่ง</th>
                    <th>สินค้า</th>
                    <th className="numeric">จำนวนขึ้นรถ</th>
                    {editing && <th aria-label="นำออก" />}
                  </tr>
                </thead>
                <tbody>
                  {selectedLines.map((line) => {
                    const removed = Number(quantities[line.id] || 0) === 0;
                    return (
                      <tr key={line.id} className={removed ? "removed" : ""}>
                        <td>
                          <strong>{line.shipmentNo}</strong>
                        </td>
                        <td>{line.receiverName}</td>
                        <td>{line.senderName}</td>
                        <td>{line.description}</td>
                        <td className="numeric">
                          {editing ? (
                            <label className="trip-quantity-input">
                              <input
                                type="number"
                                min="0"
                                step="any"
                                value={quantities[line.id] ?? line.quantity}
                                onChange={(event) =>
                                  setQuantities((current) => ({
                                    ...current,
                                    [line.id]: event.target.value,
                                  }))
                                }
                                aria-label={`จำนวน ${line.description} ในเที่ยวรถ`}
                              />
                              <span>{line.unit}</span>
                            </label>
                          ) : (
                            `${number(line.quantity)} ${line.unit}`
                          )}
                        </td>
                        {editing && (
                          <td>
                            <Button
                              title="นำรายการนี้ออกจากเที่ยวรถ"
                              onClick={() =>
                                setQuantities((current) => ({
                                  ...current,
                                  [line.id]: removed
                                    ? String(line.quantity)
                                    : "0",
                                }))
                              }
                            >
                              <Trash2 size={16} />
                              {removed ? "คืนรายการ" : "นำออก"}
                            </Button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="modal-footer trip-detail-footer">
              {editing && canManage && (
                <Button
                  className="danger"
                  busy={busy}
                  onClick={() => void cancelTrip()}
                >
                  <Ban size={17} /> ยกเลิกทั้งเที่ยว
                </Button>
              )}
              <span />
              <Button onClick={() => setSelectedTrip(null)}>ปิด</Button>
              {editing && (
                <Button
                  className="primary"
                  busy={busy}
                  disabled={!editVehicle || !editDriver}
                  onClick={() => void saveChanges()}
                >
                  บันทึกการแก้ไข
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
