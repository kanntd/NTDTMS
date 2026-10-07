import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUpDown,
  CheckCircle2,
  Eye,
  PackageCheck,
  RefreshCw,
  ScanLine,
  Search,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { billNumberPrefix, compareBillsByOpenedAt } from "./billNumber";
import {
  destinationBranchAliases,
  destinationBranches,
  isDestinationBranch,
} from "./branchRoutes";
import { useWorkspace } from "./context";
import { calendarAgeInBangkok } from "./dashboardQueue";
import { number, thaiDate } from "./domain";
import { completeBillNumber, LOADING_PAYMENT_MODES } from "./loadingQueue";
import { Button, Empty, Loading, Modal, SearchableSelect } from "./ui";
import {
  PAYMENT_LABELS,
  type LoadTripAllocation,
  type PaymentMode,
  type Shipment,
} from "./types";

type Item = {
  id: string;
  description: string;
  unit: string;
  arrived: number;
  delivered: number;
  remaining: number;
};
type Bill = {
  id: string;
  shipmentNo: string;
  openedAt: string;
  receivedAt: string;
  receiverId: string;
  receiverName: string;
  receiverPhone: string;
  senderId: string;
  senderName: string;
  senderPhone: string;
  district: string;
  paymentMode: NonNullable<LoadTripAllocation["paymentMode"]>;
  items: Item[];
  partial: boolean;
};
type Sort = "OLDEST" | "NEWEST" | "RECEIVER" | "SENDER" | "QUANTITY";
type Age = "" | "0" | "1" | "2" | "3" | "MORE";
type Progress = "" | "NONE" | "PARTIAL";

const normalize = (value: string) =>
  value.toLocaleLowerCase("th").replace(/[\s.-]/g, "");
const unique = (values: string[]) =>
  [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b, "th"));
const quantity = (bill: Bill) =>
  bill.items.reduce((sum, item) => sum + item.remaining, 0);

export default function DeliveryWork() {
  const w = useWorkspace();
  const manager = w.profile.role === "owner" || w.profile.role === "admin";
  const profileBranch = w.branches.find(
    (row) => row.id === w.profile.branch_id,
  );
  const allBranches = useMemo(
    () => destinationBranches(w.branches, w.zones),
    [w.branches, w.zones],
  );
  const branches = manager
    ? allBranches
    : allBranches.filter((row) => row.code === profileBranch?.code);
  const [branch, setBranch] = useState(branches[0]?.code || "");
  const branchAliases = useMemo(
    () => destinationBranchAliases(branch, w.branches, w.zones),
    [branch, w.branches, w.zones],
  );
  const [bills, setBills] = useState<Bill[]>([]);
  const [entry, setEntry] = useState("");
  const [search, setSearch] = useState("");
  const [receiver, setReceiver] = useState("");
  const [sender, setSender] = useState("");
  const [product, setProduct] = useState("");
  const [unit, setUnit] = useState("");
  const [district, setDistrict] = useState("");
  const [payment, setPayment] = useState<PaymentMode | "">("");
  const [age, setAge] = useState<Age>("");
  const [ageBasis, setAgeBasis] = useState<"OPENED" | "RECEIVED">("RECEIVED");
  const [progress, setProgress] = useState<Progress>("");
  const [group, setGroup] = useState<"NONE" | "RECEIVER" | "SENDER">("NONE");
  const [sort, setSort] = useState<Sort>("OLDEST");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [reviewing, setReviewing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const saveInFlight = useRef(false);
  const deliveryRequestIds = useRef(new Map<string, string>());
  const issuingBranch = w.branches.find((row) => row.can_issue_bills);
  const prefix = billNumberPrefix(issuingBranch?.document_code || "B01");

  async function refresh() {
    if (!branch) return;
    setLoading(true);
    try {
      const [trips, deliveryLines, shipmentPage] = await Promise.all([
        w.service.loadTrips(),
        w.service.deliveryLines(),
        w.service.shipments({ branch, branchAliases, pageSize: 500 }),
      ]);
      const shipmentMap = new Map(
        shipmentPage.rows.map((row) => [row.id, row]),
      );
      const delivered = new Map<string, number>();
      deliveryLines.forEach((line) =>
        delivered.set(
          line.itemId,
          (delivered.get(line.itemId) || 0) + line.quantity,
        ),
      );
      const grouped = new Map<string, Bill>();
      trips
        .filter(
          (trip) =>
            trip.status === "RECEIVED" &&
            isDestinationBranch(
              trip.destinationBranchCode,
              branch,
              w.branches,
              w.zones,
            ),
        )
        .flatMap((trip) =>
          trip.allocations.map((line) => ({
            line,
            receivedAt: trip.receivedAt || trip.loadedAt,
          })),
        )
        .filter(
          ({ line }) =>
            line.active &&
            !["DELIVERED", "CANCELLED"].includes(line.shipmentStatus || ""),
        )
        .forEach(({ line, receivedAt }) => {
          const shipment = shipmentMap.get(line.shipmentId);
          const bill =
            grouped.get(line.shipmentId) ||
            createBill(line, shipment, receivedAt);
          const item = bill.items.find((row) => row.id === line.itemId);
          if (item) item.arrived += line.quantity;
          else
            bill.items.push({
              id: line.itemId,
              description: line.description,
              unit: line.unit,
              arrived: line.quantity,
              delivered: delivered.get(line.itemId) || 0,
              remaining: 0,
            });
          if (+new Date(receivedAt) < +new Date(bill.receivedAt))
            bill.receivedAt = receivedAt;
          grouped.set(line.shipmentId, bill);
        });
      const next = [...grouped.values()].flatMap((bill) => {
        bill.items = bill.items
          .map((item) => ({
            ...item,
            remaining: Math.max(0, item.arrived - item.delivered),
          }))
          .filter((item) => item.remaining > 0);
        bill.partial = bill.items.some((item) => item.delivered > 0);
        return bill.items.length ? [bill] : [];
      });
      setBills(next);
      setSelected(
        (current) =>
          new Set(
            [...current].filter((id) => next.some((bill) => bill.id === id)),
          ),
      );
    } catch (cause) {
      w.toast((cause as Error).message || "โหลดงานส่งสินค้าไม่สำเร็จ", true);
    } finally {
      setLoading(false);
    }
  }

  function createBill(
    line: LoadTripAllocation,
    shipment: Shipment | undefined,
    receivedAt: string,
  ): Bill {
    return {
      id: line.shipmentId,
      shipmentNo: line.shipmentNo,
      openedAt: line.openedAt || shipment?.received_at || receivedAt,
      receivedAt,
      receiverId: shipment?.receiver_snapshot.id || line.receiverName,
      receiverName: line.receiverName,
      receiverPhone: shipment?.receiver_snapshot.phone || "",
      senderId: shipment?.sender_snapshot.id || line.senderName,
      senderName: line.senderName,
      senderPhone: shipment?.sender_snapshot.phone || "",
      district: shipment?.district_name || "เมือง",
      paymentMode: line.paymentMode || "CASH_ORIGIN",
      items: [],
      partial: false,
    };
  }

  useEffect(() => {
    if (!branches.some((row) => row.code === branch))
      setBranch(branches[0]?.code || "");
  }, [branches, branch]);
  useEffect(() => {
    setSelected(new Set());
    setAmounts({});
    deliveryRequestIds.current.clear();
  }, [branch]);
  useEffect(() => {
    if (branch) void refresh();
  }, [branch, w.revision]);

  const receivers = useMemo(
    () =>
      [
        ...new Map(bills.map((bill) => [bill.receiverId, bill.receiverName])),
      ].sort((a, b) => a[1].localeCompare(b[1], "th")),
    [bills],
  );
  useEffect(() => {
    if (receiver && !receivers.some(([id]) => id === receiver)) {
      setReceiver("");
    }
  }, [receiver, receivers]);
  const senders = useMemo(
    () =>
      [...new Map(bills.map((bill) => [bill.senderId, bill.senderName]))].sort(
        (a, b) => a[1].localeCompare(b[1], "th"),
      ),
    [bills],
  );
  const products = useMemo(
    () =>
      unique(
        bills.flatMap((bill) => bill.items.map((item) => item.description)),
      ),
    [bills],
  );
  const units = useMemo(
    () => unique(bills.flatMap((bill) => bill.items.map((item) => item.unit))),
    [bills],
  );
  const districts = useMemo(
    () => unique(bills.map((bill) => bill.district)),
    [bills],
  );
  const visible = useMemo(() => {
    const query = normalize(search);
    return bills
      .filter((bill) => !receiver || bill.receiverId === receiver)
      .filter((bill) => !sender || bill.senderId === sender)
      .filter(
        (bill) =>
          !product || bill.items.some((item) => item.description === product),
      )
      .filter((bill) => !unit || bill.items.some((item) => item.unit === unit))
      .filter((bill) => !district || bill.district === district)
      .filter((bill) => !payment || bill.paymentMode === payment)
      .filter(
        (bill) =>
          !progress || (progress === "PARTIAL" ? bill.partial : !bill.partial),
      )
      .filter((bill) => {
        if (!age) return true;
        const days = calendarAgeInBangkok(
          ageBasis === "OPENED" ? bill.openedAt : bill.receivedAt,
        );
        return age === "MORE" ? days > 3 : days === Number(age);
      })
      .filter(
        (bill) =>
          !query ||
          normalize(
            [
              bill.shipmentNo,
              bill.receiverName,
              bill.receiverPhone,
              bill.senderName,
              bill.senderPhone,
              ...bill.items.flatMap((item) => [item.description, item.unit]),
            ].join(" "),
          ).includes(query),
      )
      .sort((a, b) => {
        if (group === "RECEIVER" || sort === "RECEIVER")
          return a.receiverName.localeCompare(b.receiverName, "th");
        if (group === "SENDER" || sort === "SENDER")
          return a.senderName.localeCompare(b.senderName, "th");
        if (sort === "QUANTITY") return quantity(b) - quantity(a);
        return compareBillsByOpenedAt(
          a.openedAt,
          a.shipmentNo,
          b.openedAt,
          b.shipmentNo,
          sort === "NEWEST",
        );
      });
  }, [
    bills,
    receiver,
    sender,
    product,
    unit,
    district,
    payment,
    progress,
    age,
    ageBasis,
    search,
    sort,
    group,
  ]);
  const selectedBills = bills.filter((bill) => selected.has(bill.id));
  const selectedDeliveryQuantity = selectedBills.reduce(
    (sum, bill) =>
      sum +
      bill.items.reduce((itemSum, item) => {
        const value = Number(amounts[item.id] ?? item.remaining);
        return itemSum + (Number.isFinite(value) && value > 0 ? value : 0);
      }, 0),
    0,
  );
  const invalidDeliveryQuantity = selectedBills.some((bill) =>
    bill.items.some((item) => {
      const value = Number(amounts[item.id] ?? item.remaining);
      return !Number.isFinite(value) || value < 0 || value > item.remaining;
    }),
  );

  function selectBill(bill: Bill, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      checked ? next.add(bill.id) : next.delete(bill.id);
      return next;
    });
    if (checked)
      setAmounts((current) => ({
        ...current,
        ...Object.fromEntries(
          bill.items
            .filter((item) => current[item.id] === undefined)
            .map((item) => [item.id, String(item.remaining)]),
        ),
      }));
    else deliveryRequestIds.current.delete(bill.id);
  }
  function addBill() {
    const shipmentNo = completeBillNumber(prefix, entry);
    const bill = bills.find((row) => row.shipmentNo === shipmentNo);
    if (!bill) {
      w.toast(`ไม่พบบิล ${shipmentNo || entry} ในรายการรอส่งของสาขานี้`, true);
      window.requestAnimationFrame(() => {
        inputRef.current?.focus({ preventScroll: true });
        inputRef.current?.select();
      });
      return;
    } else if (selected.has(bill.id))
      w.toast(`เลือกบิล ${bill.shipmentNo} ไว้แล้ว`, true);
    else {
      selectBill(bill, true);
      w.toast(`เลือกบิล ${bill.shipmentNo} แล้ว`);
    }
    setEntry("");
    window.requestAnimationFrame(() =>
      inputRef.current?.focus({ preventScroll: true }),
    );
  }
  function clearFilters() {
    setSearch("");
    setReceiver("");
    setSender("");
    setProduct("");
    setUnit("");
    setDistrict("");
    setPayment("");
    setAge("");
    setProgress("");
  }
  async function save() {
    if (saveInFlight.current) return;
    const invalid = selectedBills.some((bill) =>
      bill.items.some((item) => {
        const value = Number(amounts[item.id] || 0);
        return !Number.isFinite(value) || value < 0 || value > item.remaining;
      }),
    );
    if (invalid) return w.toast("กรุณาตรวจสอบจำนวนสินค้าที่ส่ง", true);
    saveInFlight.current = true;
    setBusy(true);
    let savedCount = 0;
    try {
      for (const bill of selectedBills) {
        const items = bill.items.flatMap((item) => {
          const value = Number(amounts[item.id] || 0);
          return value > 0 ? [{ itemId: item.id, quantity: value }] : [];
        });
        if (items.length) {
          const requestId =
            deliveryRequestIds.current.get(bill.id) || crypto.randomUUID();
          deliveryRequestIds.current.set(bill.id, requestId);
          await w.service.recordDelivery({
            shipmentId: bill.id,
            result: "DELIVERED",
            collectedAmount: 0,
            note: "",
            roundReference: "",
            requestId,
            items,
          });
          deliveryRequestIds.current.delete(bill.id);
          savedCount += 1;
          setSelected((current) => {
            const next = new Set(current);
            next.delete(bill.id);
            return next;
          });
          setAmounts((current) => {
            const next = { ...current };
            bill.items.forEach((item) => delete next[item.id]);
            return next;
          });
        }
      }
      w.toast(`บันทึกส่งสินค้า ${savedCount} บิลแล้ว`);
      setReviewing(false);
      await refresh();
      w.refresh();
    } catch (cause) {
      const message = (cause as Error).message || "บันทึกผลส่งสินค้าไม่สำเร็จ";
      w.toast(
        savedCount > 0 ? `บันทึกแล้ว ${savedCount} บิล · ${message}` : message,
        true,
      );
    } finally {
      saveInFlight.current = false;
      setBusy(false);
    }
  }

  if (!branches.length)
    return (
      <Empty title="บัญชีนี้ยังไม่ได้ผูกกับสาขาปลายทาง กรุณาให้ผู้ดูแลกำหนดสาขาก่อน" />
    );
  return (
    <div className="delivery-work">
      <div className="page-heading">
        <div>
          <div className="breadcrumb">
            ปฏิบัติการสาขา <span>/</span> งานส่งสินค้า
          </div>
          <h1>
            บิลรอส่งสินค้า <span className="heading-dot" />
          </h1>
          <p>พิมพ์หรือสแกนเลขบิลเพื่อเลือก แล้วตรวจรายการก่อนบันทึก</p>
        </div>
        <Button onClick={() => void refresh()} disabled={loading}>
          <RefreshCw className={loading ? "spin" : ""} size={17} />
          อัปเดตข้อมูล
        </Button>
      </div>
      <div className="delivery-summary">
        <article>
          <Truck size={22} />
          <span>บิลรอส่ง</span>
          <strong>{number(bills.length)}</strong>
          <small>บิล</small>
        </article>
        <article>
          <PackageCheck size={22} />
          <span>สินค้ารอส่ง</span>
          <strong>
            {number(bills.reduce((sum, bill) => sum + quantity(bill), 0))}
          </strong>
          <small>หน่วย</small>
        </article>
      </div>
      <section className="delivery-entry-panel">
        <header>
          <ScanLine size={22} />
          <div>
            <h2>พิมพ์หรือสแกนเลขบิล</h2>
            <p>กด Enter แล้วระบบจะติ๊กเลือกบิลให้อัตโนมัติ</p>
          </div>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            addBill();
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
            เพิ่มบิล
          </Button>
        </form>
      </section>
      <section className="delivery-queue-panel">
        <div className="loading-toolbar delivery-toolbar">
          <div className="input-icon loading-search">
            <Search size={17} />
            <input
              aria-label="ค้นหาบิลรอส่ง"
              placeholder="ค้นหาเลขบิล ผู้รับ ผู้ส่ง เบอร์โทร หรือสินค้า"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <select
            aria-label="สาขาปลายทาง"
            value={branch}
            disabled={!manager}
            onChange={(event) => setBranch(event.target.value)}
          >
            {branches.map((row) => (
              <option key={row.code} value={row.code}>
                {row.name}
              </option>
            ))}
          </select>
          <select
            aria-label="กรองผู้รับ"
            value={receiver}
            onChange={(event) => setReceiver(event.target.value)}
          >
            <option value="">ผู้รับทั้งหมด</option>
            {receivers.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <select
            aria-label="กรองผู้ส่ง"
            value={sender}
            onChange={(event) => setSender(event.target.value)}
          >
            <option value="">ผู้ส่งทั้งหมด</option>
            {senders.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </select>
          <SearchableSelect
            className="loading-searchable-filter"
            ariaLabel="กรองสินค้า"
            value={product}
            emptyLabel="สินค้าทั้งหมด"
            options={products.map((name) => ({ id: name, label: name }))}
            onChange={setProduct}
          />
          <select
            aria-label="กรองหน่วยนับ"
            value={unit}
            onChange={(event) => setUnit(event.target.value)}
          >
            <option value="">ทุกหน่วยนับ</option>
            {units.map((name) => (
              <option key={name}>{name}</option>
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
            aria-label="กรองประเภทการชำระเงิน"
            value={payment}
            onChange={(event) =>
              setPayment(event.target.value as PaymentMode | "")
            }
          >
            <option value="">ทุกประเภทการชำระเงิน</option>
            {LOADING_PAYMENT_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {PAYMENT_LABELS[mode]}
              </option>
            ))}
          </select>
          <select
            aria-label="ฐานการนับอายุบิล"
            value={ageBasis}
            onChange={(event) =>
              setAgeBasis(event.target.value as "OPENED" | "RECEIVED")
            }
          >
            <option value="RECEIVED">อายุจากวันที่รับรถ</option>
            <option value="OPENED">อายุจากวันที่เปิดบิล</option>
          </select>
          <select
            aria-label="กรองอายุบิล"
            value={age}
            onChange={(event) => setAge(event.target.value as Age)}
          >
            <option value="">ทุกอายุบิล</option>
            <option value="0">วันนี้</option>
            <option value="1">ค้าง 1 วัน</option>
            <option value="2">ค้าง 2 วัน</option>
            <option value="3">ค้าง 3 วัน</option>
            <option value="MORE">ค้างมากกว่า 3 วัน</option>
          </select>
          <select
            aria-label="กรองสถานะการส่ง"
            value={progress}
            onChange={(event) => setProgress(event.target.value as Progress)}
          >
            <option value="">ทุกสถานะการส่ง</option>
            <option value="NONE">ยังไม่ส่ง</option>
            <option value="PARTIAL">ส่งบางส่วน</option>
          </select>
          <select
            aria-label="จัดกลุ่มรายการ"
            value={group}
            onChange={(event) => setGroup(event.target.value as typeof group)}
          >
            <option value="NONE">แสดงรายบิล</option>
            <option value="RECEIVER">รวมตามผู้รับ ก-ฮ</option>
            <option value="SENDER">รวมตามผู้ส่ง ก-ฮ</option>
          </select>
          <label className="loading-sort">
            <ArrowUpDown size={16} />
            <select
              aria-label="เรียงรายการ"
              value={sort}
              onChange={(event) => setSort(event.target.value as Sort)}
            >
              <option value="OLDEST">วันที่เปิดบิลเก่าสุดก่อน</option>
              <option value="NEWEST">วันที่เปิดบิลใหม่สุดก่อน</option>
              <option value="RECEIVER">ผู้รับ ก-ฮ</option>
              <option value="SENDER">ผู้ส่ง ก-ฮ</option>
              <option value="QUANTITY">จำนวนมากก่อน</option>
            </select>
          </label>
          <Button className="loading-clear" onClick={clearFilters}>
            <X size={16} />
            ล้างตัวกรอง
          </Button>
        </div>
        <div className="loading-result-summary">
          <span>พบ {number(visible.length)} บิล</span>
          <span>
            {number(visible.reduce((sum, bill) => sum + quantity(bill), 0))}{" "}
            หน่วย
          </span>
        </div>
        {loading && !bills.length ? (
          <Loading />
        ) : visible.length === 0 ? (
          <Empty title="ไม่พบบิลรอส่งตามตัวกรองนี้" />
        ) : (
          <div className="data-table-scroll">
            <table className="data-table delivery-queue-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="เลือกบิลที่แสดงทั้งหมด"
                      checked={
                        visible.length > 0 &&
                        visible.every((bill) => selected.has(bill.id))
                      }
                      onChange={(event) =>
                        visible.forEach((bill) =>
                          selectBill(bill, event.target.checked),
                        )
                      }
                    />
                  </th>
                  <th>เลขบิล / วันที่</th>
                  <th>ผู้รับ</th>
                  <th>ผู้ส่ง</th>
                  <th>รายการสินค้า</th>
                  <th>อำเภอ</th>
                  <th>ชำระเงิน</th>
                  <th>คงเหลือ</th>
                  <th>อายุบิล</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((bill) => (
                  <tr key={bill.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`เลือกบิล ${bill.shipmentNo}`}
                        checked={selected.has(bill.id)}
                        onChange={(event) =>
                          selectBill(bill, event.target.checked)
                        }
                      />
                    </td>
                    <td>
                      <strong>{bill.shipmentNo}</strong>
                      <small>{thaiDate(bill.openedAt)}</small>
                    </td>
                    <td>{bill.receiverName}</td>
                    <td>{bill.senderName}</td>
                    <td>
                      {bill.items.map((item) => (
                        <small key={item.id}>
                          {item.description} {number(item.remaining)}{" "}
                          {item.unit}
                        </small>
                      ))}
                    </td>
                    <td>{bill.district}</td>
                    <td>{PAYMENT_LABELS[bill.paymentMode]}</td>
                    <td>
                      <strong>{number(quantity(bill))}</strong>
                      {bill.partial && <small>ส่งบางส่วน</small>}
                    </td>
                    <td>
                      {number(
                        calendarAgeInBangkok(
                          ageBasis === "OPENED"
                            ? bill.openedAt
                            : bill.receivedAt,
                        ),
                      )}{" "}
                      วัน
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {selected.size > 0 && (
        <div className="loading-selection-bar">
          <div>
            <CheckCircle2 size={19} />
            <strong>เลือก {number(selected.size)} บิล</strong>
            <span>
              {number(
                selectedBills.reduce((sum, bill) => sum + quantity(bill), 0),
              )}{" "}
              หน่วย
            </span>
          </div>
          <div>
            <Button
              onClick={() => {
                setSelected(new Set());
                setAmounts({});
              }}
            >
              <X size={16} />
              ยกเลิกการเลือก
            </Button>
            <Button onClick={() => setReviewing(true)}>
              <Eye size={16} />
              ดูรายการที่เลือก
            </Button>
            <Button className="primary" onClick={() => setReviewing(true)}>
              <Truck size={17} />
              บันทึกส่งสินค้า
            </Button>
          </div>
        </div>
      )}
      {reviewing && (
        <Modal
          wide
          title={`บิลที่เลือก ${number(selectedBills.length)} บิล`}
          onClose={() => setReviewing(false)}
        >
          <div className="modal-body selected-bill-review">
            <div className="selected-bill-summary">
              <span>{number(selectedDeliveryQuantity)} ชิ้นที่จะส่ง</span>
              <span>{number(selectedBills.length)} บิล</span>
              <strong>ตรวจจำนวนก่อนยืนยัน</strong>
            </div>
            <div className="data-table-scroll selected-bill-scroll">
              <table className="data-table selected-bill-table delivery-selected-table">
                <thead>
                  <tr>
                    <th>เลขบิล</th>
                    <th>ผู้รับ</th>
                    <th>ผู้ส่ง</th>
                    <th>รายการสินค้า</th>
                    <th>จำนวนที่จะส่ง</th>
                    <th aria-label="นำออก" />
                  </tr>
                </thead>
                <tbody>
                  {selectedBills.map((bill) => (
                    <tr key={bill.id}>
                      <td>
                        <strong>{bill.shipmentNo}</strong>
                        <small>{thaiDate(bill.openedAt)}</small>
                      </td>
                      <td>{bill.receiverName}</td>
                      <td>{bill.senderName}</td>
                      <td>
                        <div className="selected-bill-items">
                          {bill.items.map((item) => (
                            <span key={item.id}>
                              {item.description} <small>{item.unit}</small>
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        <div className="selected-bill-quantities">
                          {bill.items.map((item) => {
                            const entered = Number(
                              amounts[item.id] ?? item.remaining,
                            );
                            const invalid =
                              !Number.isFinite(entered) ||
                              entered < 0 ||
                              entered > item.remaining;
                            return (
                              <label
                                key={item.id}
                                className={invalid ? "invalid" : ""}
                              >
                                <input
                                  type="number"
                                  min="0"
                                  max={item.remaining}
                                  step="any"
                                  value={
                                    amounts[item.id] ?? String(item.remaining)
                                  }
                                  onChange={(event) =>
                                    setAmounts((current) => ({
                                      ...current,
                                      [item.id]: event.target.value,
                                    }))
                                  }
                                  aria-label={`จำนวน ${item.description} ที่ส่ง`}
                                />
                                <small>
                                  / {number(item.remaining)} {item.unit}
                                </small>
                              </label>
                            );
                          })}
                        </div>
                      </td>
                      <td>
                        <Button
                          title={`นำบิล ${bill.shipmentNo} ออกจากรายการที่เลือก`}
                          onClick={() => {
                            selectBill(bill, false);
                            if (selectedBills.length === 1) setReviewing(false);
                          }}
                        >
                          <Trash2 size={16} />
                          นำออก
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {invalidDeliveryQuantity && (
              <div className="alert error">
                จำนวนที่ส่งต้องไม่เกินจำนวนคงเหลือ
              </div>
            )}
            <div className="modal-footer">
              <Button onClick={() => setReviewing(false)}>กลับไปแก้ไข</Button>
              <Button
                className="primary"
                busy={busy}
                disabled={
                  invalidDeliveryQuantity || selectedDeliveryQuantity === 0
                }
                onClick={() => void save()}
              >
                <CheckCircle2 size={17} />
                ยืนยันส่งสินค้า
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
