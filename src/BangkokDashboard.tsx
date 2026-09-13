import { useCallback, useEffect, useMemo, useState } from "react";
import { Clock3, LoaderCircle, RefreshCw, Truck } from "lucide-react";
import { useWorkspace } from "./context";
import { money, number, thaiDate } from "./domain";
import { BRANCH_OPTIONS } from "./intakeData";
import { Button } from "./ui";
import {
  summarizeBangkokQueue,
  type BangkokBranchDefinition,
  type BangkokQueueBill,
} from "./dashboardQueue";
const BRANCH_ORDER = ["KPT", "PLK", "STI", "SWL"];

export default function BangkokDashboard({
  onOpenBranch,
}: {
  onOpenBranch: (branchCode: string) => void;
}) {
  const w = useWorkspace();
  const [bills, setBills] = useState<BangkokQueueBill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const branches = useMemo<BangkokBranchDefinition[]>(
    () =>
      BRANCH_ORDER.map((code) => {
        const local = BRANCH_OPTIONS.find((branch) => branch.code === code);
        const live = w.zones.find((zone) => zone.code === code);
        return {
          code,
          name: live?.name || local?.name || code,
          color: live?.color || local?.color || "#5f7369",
        };
      }),
    [w.zones],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const queue = await w.service.loadingQueue();
      setBills(
        queue.map((shipment) => {
          const sawankhalok = BRANCH_OPTIONS.find(
            (branch) => branch.code === "SWL",
          );
          return {
            id: shipment.id,
            branchCode:
              shipment.destination_branch_code ||
              (shipment.district_id === sawankhalok?.districtId ? "SWL" : "") ||
              w.zones.find((zone) => zone.id === shipment.zone_id)?.code ||
              "",
            openedAt: shipment.received_at,
            quantity: shipment.total_quantity,
            amount: shipment.total_amount,
            status: shipment.shipment_status,
            pendingPrice: shipment.price_pending,
          };
        }),
      );
    } catch (cause) {
      setError((cause as Error).message || "โหลดข้อมูลไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }, [w.service, w.zones]);

  useEffect(() => {
    void refresh();
  }, [refresh, w.revision]);

  const summary = useMemo(
    () => summarizeBangkokQueue(bills, branches),
    [bills, branches],
  );

  return (
    <div className="bangkok-dashboard">
      <div className="page-heading">
        <div>
          <div className="breadcrumb">
            สำนักงานใหญ่ <span>/</span> กรุงเทพฯ
          </div>
          <h1>
            ภาพรวมสินค้ารอขึ้นรถ
            <span className="heading-dot" />
          </h1>
          <p>ข้อมูล ณ {thaiDate(new Date(), true)}</p>
        </div>
        <Button onClick={() => void refresh()} disabled={loading}>
          {loading ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <RefreshCw size={17} />
          )}
          อัปเดตข้อมูล
        </Button>
      </div>

      {error && <div className="alert error">{error}</div>}

      <section className="queue-dashboard-table" aria-busy={loading}>
        <header>
          <div>
            <Truck size={20} />
            <div>
              <h2>บิลที่ยังไม่ทำขึ้นรถ</h2>
              <span>แยกตามสาขาปลายทาง</span>
            </div>
          </div>
          <strong>
            {number(summary.total.billCount)} <small>บิล</small>
          </strong>
        </header>
        <div className="data-table-scroll">
          <table>
            <thead>
              <tr>
                <th>สาขา</th>
                <th>จำนวนบิล</th>
                <th>จำนวนของ (ชิ้น)</th>
                <th>ยอดเงิน</th>
                <th>บิลค้าง 2 วัน</th>
                <th>บิลค้าง 3 วัน</th>
                <th>บิลค้างมากกว่า 3 วัน</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((row) => (
                <tr
                  key={row.code}
                  style={{ "--branch-color": row.color } as React.CSSProperties}
                >
                  <th scope="row">
                    <i />
                    <button
                      type="button"
                      onClick={() => onOpenBranch(row.code)}
                    >
                      {row.name}
                      <small>{row.code}</small>
                    </button>
                  </th>
                  <td>
                    <button
                      type="button"
                      className="queue-count-link"
                      onClick={() => onOpenBranch(row.code)}
                    >
                      {number(row.billCount)}
                    </button>
                  </td>
                  <td>{number(row.quantity)}</td>
                  <td>
                    <b>฿{money(row.amount)}</b>
                    {row.pendingPriceCount > 0 && (
                      <small className="pending-price">
                        รอราคา {number(row.pendingPriceCount)} บิล
                      </small>
                    )}
                  </td>
                  <td className={row.overdue2 ? "age-warning" : ""}>
                    {number(row.overdue2)}
                  </td>
                  <td className={row.overdue3 ? "age-warning" : ""}>
                    {number(row.overdue3)}
                  </td>
                  <td className={row.overdueMoreThan3 ? "age-danger" : ""}>
                    {number(row.overdueMoreThan3)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">รวม</th>
                <td>{number(summary.total.billCount)}</td>
                <td>{number(summary.total.quantity)}</td>
                <td>
                  ฿{money(summary.total.amount)}
                  {summary.total.pendingPriceCount > 0 && (
                    <small>
                      รอราคา {number(summary.total.pendingPriceCount)} บิล
                    </small>
                  )}
                </td>
                <td>{number(summary.total.overdue2)}</td>
                <td>{number(summary.total.overdue3)}</td>
                <td>{number(summary.total.overdueMoreThan3)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        <footer>
          <span>
            <Clock3 size={16} />
            อายุบิลนับจากวันที่เปิดตามวันปฏิทิน
          </span>
          <span>
            <Truck size={16} />
            บิลจะออกจากตารางเมื่อเริ่มขนส่ง
          </span>
        </footer>
      </section>
    </div>
  );
}
