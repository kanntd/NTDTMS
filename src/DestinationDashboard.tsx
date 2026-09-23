import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Banknote,
  Clock3,
  LoaderCircle,
  MapPin,
  PackageCheck,
  RefreshCw,
  Truck,
} from "lucide-react";
import { destinationBranches } from "./branchRoutes";
import { useWorkspace } from "./context";
import {
  summarizeDestinationDashboard,
  type DestinationAgeBasis,
  type DestinationMetric,
} from "./destinationDashboardModel";
import { money, number, thaiDate, thaiTime } from "./domain";
import type { DeliveryLineRecord, LoadTripRecord } from "./types";
import { Button } from "./ui";

function MetricValue({ metric }: { metric: DestinationMetric }) {
  return (
    <span className="destination-metric-value">
      <b>{number(metric.billCount)} บิล</b>
      <small>{number(metric.quantity)} ชิ้น</small>
    </span>
  );
}

export default function DestinationDashboard() {
  const w = useWorkspace();
  const branches = useMemo(
    () => destinationBranches(w.branches, w.zones),
    [w.branches, w.zones],
  );
  const profileBranch = w.branches.find(
    (row) => row.id === w.profile.branch_id,
  );
  const manager = ["owner", "admin"].includes(w.profile.role);
  const selectableBranches = manager
    ? branches
    : branches.filter((row) => row.code === profileBranch?.code);
  const [branchCode, setBranchCode] = useState("");
  const [basis, setBasis] = useState<DestinationAgeBasis>(
    manager ? "OPENED" : "BRANCH_RECEIVED",
  );
  const [trips, setTrips] = useState<LoadTripRecord[]>([]);
  const [deliveredLines, setDeliveredLines] = useState<DeliveryLineRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [receivingId, setReceivingId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!selectableBranches.length) return;
    if (!selectableBranches.some((row) => row.code === branchCode))
      setBranchCode(selectableBranches[0].code);
  }, [branchCode, selectableBranches]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextTrips, nextDeliveredLines] = await Promise.all([
        w.service.loadTrips(),
        w.service.deliveryLines(),
      ]);
      setTrips(nextTrips);
      setDeliveredLines(nextDeliveredLines);
    } catch (cause) {
      setError((cause as Error).message || "โหลดข้อมูลสาขาไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [w.service]);

  useEffect(() => {
    void refresh();
  }, [refresh, w.revision]);

  const summary = useMemo(
    () => summarizeDestinationDashboard(trips, branchCode, basis, new Date(), deliveredLines),
    [trips, branchCode, basis, deliveredLines],
  );
  const branch = branches.find((row) => row.code === branchCode);
  async function receiveTrip(trip: LoadTripRecord) {
    setReceivingId(trip.id);
    try {
      await w.service.setLoadTripStatus(trip.id, "RECEIVE");
      w.toast(`รับรถทะเบียน ${trip.vehicleNo || "ไม่ระบุ"} เข้าสาขาแล้ว`);
      await refresh();
      w.refresh();
    } catch (cause) {
      w.toast((cause as Error).message || "รับรถไม่สำเร็จ", true);
    } finally {
      setReceivingId("");
    }
  }

  if (!selectableBranches.length) {
    return (
      <div className="empty-state">
        <MapPin size={30} />
        <h2>ยังไม่ได้ผูกบัญชีนี้กับสาขาปลายทาง</h2>
        <p>ให้ผู้ดูแลกำหนดสาขาของพนักงานก่อนใช้งานภาพรวมสาขาปลายทาง</p>
      </div>
    );
  }

  return (
    <div className="destination-dashboard">
      <div className="page-heading destination-heading">
        <div>
          <div className="breadcrumb">
            ปฏิบัติการสาขา <span>/</span> {branch?.name || "ปลายทาง"}
          </div>
          <h1>
            ภาพรวมสาขาปลายทาง <span className="heading-dot" />
          </h1>
          <p>ข้อมูล ณ {thaiDate(new Date())}</p>
        </div>
        <div className="destination-heading-actions">
          {selectableBranches.length > 1 && (
            <label>
              <span>สาขา</span>
              <select
                value={branchCode}
                onChange={(event) => setBranchCode(event.target.value)}
              >
                {selectableBranches.map((row) => (
                  <option key={row.code} value={row.code}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button onClick={() => void refresh()} disabled={loading}>
            {loading ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <RefreshCw size={17} />
            )}
            อัปเดตข้อมูล
          </Button>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}

      <div className="destination-kpis">
        <article>
          <Truck size={23} />
          <span>รถกำลังมา</span>
          <strong>{number(summary.incomingTrips.length)}</strong>
          <small>เที่ยว</small>
        </article>
        <article>
          <PackageCheck size={23} />
          <span>บิลและสินค้ารอส่ง</span>
          <MetricValue metric={summary.waiting} />
        </article>
        <article>
          <Clock3 size={23} />
          <span>รับเข้าสาขาวันนี้</span>
          <MetricValue metric={summary.receivedToday} />
        </article>
        <article>
          <Banknote size={23} />
          <span>เงินสดปลายทางรอเก็บ</span>
          <strong>฿{money(summary.cashDestination.amount)}</strong>
          <small>{number(summary.cashDestination.billCount)} บิล</small>
        </article>
      </div>

      <section className="destination-age-panel">
        <header>
          <div>
            <h2>สถานะบิลของสาขา</h2>
            <p>
              {basis === "OPENED"
                ? "วัดเวลารวมของบริษัทตั้งแต่รับสินค้าและเปิดบิล"
                : "วัดเวลาที่สินค้าอยู่กับสาขาตั้งแต่กดรับรถ"}
            </p>
          </div>
          <div className="age-basis-control" aria-label="วิธีนับอายุบิล">
            <button
              className={basis === "OPENED" ? "active" : ""}
              onClick={() => setBasis("OPENED")}
            >
              นับจากวันเปิดบิล
            </button>
            <button
              className={basis === "BRANCH_RECEIVED" ? "active" : ""}
              onClick={() => setBasis("BRANCH_RECEIVED")}
            >
              นับจากวันรับรถ
            </button>
          </div>
        </header>
        <div className="data-table-scroll">
          <table>
            <thead>
              <tr>
                <th>ประเภท</th>
                <th>จำนวนบิล</th>
                <th>จำนวนสินค้า (ชิ้น)</th>
                <th>ค้างส่ง 4 วัน</th>
                <th>ค้างส่ง 5 วัน</th>
                <th>ค้างส่งมากกว่า 5 วัน</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>บิลรวม</th>
                <td>{number(summary.waiting.billCount)}</td>
                <td>{number(summary.waiting.quantity)}</td>
                <td><MetricValue metric={summary.overdue4} /></td>
                <td><MetricValue metric={summary.overdue5} /></td>
                <td><MetricValue metric={summary.overdueMoreThan5} /></td>
              </tr>
              <tr>
                <th>บิลค้างส่ง</th>
                <td>{number(summary.overdue.billCount)}</td>
                <td>{number(summary.overdue.quantity)}</td>
                <td><MetricValue metric={summary.overdue4} /></td>
                <td><MetricValue metric={summary.overdue5} /></td>
                <td><MetricValue metric={summary.overdueMoreThan5} /></td>
              </tr>
              <tr>
                <th>บิลใหม่ (รับรถวันนี้)</th>
                <td>{number(summary.receivedToday.billCount)}</td>
                <td>{number(summary.receivedToday.quantity)}</td>
                <td>–</td><td>–</td><td>–</td>
              </tr>
            </tbody>
          </table>
        </div>
        <footer>
          <Clock3 size={16} />
          {basis === "OPENED"
            ? "อายุค้างนับจากวันที่เปิดบิล"
            : "อายุค้างนับแยกตามวันที่รับสินค้าแต่ละเที่ยวรถ"}
        </footer>
      </section>

      <section className="destination-incoming">
        <header>
          <div>
            <Truck size={20} />
            <div><h2>รถที่กำลังมาสาขา</h2><span>แสดงเฉพาะเที่ยวของสาขา{branch?.name}</span></div>
          </div>
          <strong>{number(summary.incomingTrips.length)} เที่ยว</strong>
        </header>
        {!summary.incomingTrips.length ? (
          <div className="destination-empty">ไม่มีรถที่รอรับเข้าสาขา</div>
        ) : (
          <div className="data-table-scroll">
            <table>
              <thead><tr><th>ทะเบียนรถ</th><th>เวลาออกต้นทาง</th><th>จำนวนบิล</th><th>จำนวนสินค้า</th><th>คนขับ</th><th /></tr></thead>
              <tbody>
                {summary.incomingTrips.map((trip) => (
                  <tr key={trip.id}>
                    <td><b>{trip.vehicleNo || "ไม่ระบุทะเบียน"}</b><small>{trip.manifestNo}</small></td>
                    <td>{trip.departedAt ? `${thaiDate(trip.departedAt)} · ${thaiTime(trip.departedAt)}` : "–"}</td>
                    <td>{number(new Set(trip.allocations.filter((line) => line.active).map((line) => line.shipmentId)).size)} บิล</td>
                    <td>{number(trip.allocations.filter((line) => line.active).reduce((sum, line) => sum + line.quantity, 0))} ชิ้น</td>
                    <td>{trip.driverName || "–"}</td>
                    <td><Button className="primary compact" busy={receivingId === trip.id} onClick={() => void receiveTrip(trip)}><MapPin size={15} />รับรถ</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
