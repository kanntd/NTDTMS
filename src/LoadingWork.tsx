import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ArrowLeft,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  ListChecks,
  PackageCheck,
  RefreshCw,
  ScanLine,
  Search,
  Trash2,
  Truck,
  X,
} from "lucide-react";
import { useWorkspace } from "./context";
import { localDate, money, number, thaiDate } from "./domain";
import { BRANCH_OPTIONS } from "./intakeData";
import { billNumberPrefix } from "./billNumber";
import LoadTripManager from "./LoadTripManager";
import { currentDriver, loadOperations } from "./operationsStore";
import { loadRemoteWorkspace } from "./remoteWorkspace";
import { calendarAgeInBangkok } from "./dashboardQueue";
import {
  completeBillNumber,
  groupLoadingRows,
  LOADING_PAYMENT_MODES,
  summarizeLoadingDashboard,
  type LoadingGroupMode,
} from "./loadingQueue";
import { Button, Empty, Field, Loading, Modal } from "./ui";
import {
  PAYMENT_LABELS,
  type LoadingQueueRecord,
  type LoadTripRecord,
  type PaymentMode,
} from "./types";

type SortMode = "OLDEST" | "RECEIVER" | "SENDER" | "NEWEST" | "QUANTITY_DESC";
type AgeFilter = "" | "0" | "1" | "2" | "3" | "MORE_THAN_3";

const BRANCH_ORDER = ["KPT", "PLK", "STI", "SWL"];

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

function partyKey(row: LoadingQueueRecord, kind: "receiver" | "sender") {
  const snapshot =
    kind === "receiver" ? row.receiver_snapshot : row.sender_snapshot;
  return snapshot.id || snapshot.display_name;
}

function sortedUnique(values: string[]) {
  return [...new Set(values.filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "th"),
  );
}

export default function LoadingWork({
  initialBranch,
}: {
  initialBranch: string;
}) {
  const w = useWorkspace();
  const [rows, setRows] = useState<LoadingQueueRecord[]>([]);
  const [trips, setTrips] = useState<LoadTripRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [branch, setBranch] = useState(initialBranch);
  const [district, setDistrict] = useState("");
  const [age, setAge] = useState<AgeFilter>("");
  const [payment, setPayment] = useState<PaymentMode | "">("");
  const [receiver, setReceiver] = useState("");
  const [sender, setSender] = useState("");
  const [product, setProduct] = useState("");
  const [unit, setUnit] = useState("");
  const [groupMode, setGroupMode] = useState<LoadingGroupMode>("NONE");
  const [sort, setSort] = useState<SortMode>("OLDEST");
  const [search, setSearch] = useState("");
  const [billEntry, setBillEntry] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );
  const [loadQuantities, setLoadQuantities] = useState<Record<string, string>>(
    {},
  );
  const [confirming, setConfirming] = useState(false);
  const [creatingTrip, setCreatingTrip] = useState(false);
  const [resumeSelection, setResumeSelection] = useState(false);
  const [createBranch, setCreateBranch] = useState(initialBranch);
  const [createVehicleId, setCreateVehicleId] = useState("");
  const [tripId, setTripId] = useState("");
  const [reviewingSelection, setReviewingSelection] = useState(false);
  const [workspaceView, setWorkspaceView] = useState<"QUEUE" | "TRIPS">(
    "QUEUE",
  );
  const [busy, setBusy] = useState(false);
  const [operations, setOperations] = useState(loadOperations);
  const loadedOnce = useRef(false);
  const activeVehicles = operations.vehicles.filter(
    (vehicle) => vehicle.active,
  );
  const createVehicle = activeVehicles.find(
    (vehicle) => vehicle.id === createVehicleId,
  );
  const createDriver = createVehicle
    ? currentDriver(operations, createVehicle.id)
    : undefined;

  useEffect(() => {
    if (w.demo) return;
    let active = true;
    loadRemoteWorkspace()
      .then((workspace) => {
        if (active) setOperations(workspace.operations);
      })
      .catch((cause) => {
        if (active)
          setError(
            (cause as Error).message || "โหลดข้อมูลรถและพนักงานไม่สำเร็จ",
          );
      });
    return () => {
      active = false;
    };
  }, [w.demo, w.revision]);

  useEffect(() => {
    setBranch(initialBranch);
    setDistrict("");
    setPayment("");
    setSelected(new Set());
  }, [initialBranch]);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      const [nextRows, nextTrips] = await Promise.all([
        w.service.loadingQueue(),
        w.service.loadTrips(),
      ]);
      setRows(nextRows);
      setTrips(nextTrips);
      loadedOnce.current = true;
    } catch (cause) {
      setError((cause as Error).message || "โหลดรายการขึ้นรถไม่สำเร็จ");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [w.revision]);

  const branches = useMemo(
    () =>
      BRANCH_ORDER.map((code) => {
        const local = BRANCH_OPTIONS.find((item) => item.code === code);
        const live = w.zones.find((zone) => zone.code === code);
        return {
          code,
          name: live?.name || local?.name || code,
          color: live?.color || local?.color || "#5f7369",
        };
      }),
    [w.zones],
  );

  const dashboard = useMemo(
    () =>
      summarizeLoadingDashboard(
        rows.map((row) => ({
          id: row.id,
          branchCode: branchCode(row, w.zones),
          quantity: row.total_quantity,
          amount: row.total_amount,
          paymentMode: row.payment_mode,
          pricePending: row.price_pending,
        })),
        branches,
      ),
    [rows, branches, w.zones],
  );

  const branchRows = useMemo(
    () => rows.filter((row) => !branch || branchCode(row, w.zones) === branch),
    [rows, branch, w.zones],
  );
  const districts = useMemo(
    () => sortedUnique(branchRows.map((row) => districtName(row, w.zones))),
    [branchRows, w.zones],
  );
  const receivers = useMemo(
    () =>
      [
        ...new Map(
          branchRows.map((row) => [
            partyKey(row, "receiver"),
            row.receiver_snapshot.display_name,
          ]),
        ),
      ].sort((a, b) => a[1].localeCompare(b[1], "th")),
    [branchRows],
  );
  const senders = useMemo(
    () =>
      [
        ...new Map(
          branchRows.map((row) => [
            partyKey(row, "sender"),
            row.sender_snapshot.display_name,
          ]),
        ),
      ].sort((a, b) => a[1].localeCompare(b[1], "th")),
    [branchRows],
  );
  const products = useMemo(
    () =>
      sortedUnique(
        branchRows.flatMap((row) => row.items.map((item) => item.description)),
      ),
    [branchRows],
  );
  const units = useMemo(
    () =>
      sortedUnique(
        branchRows.flatMap((row) => row.items.map((item) => item.unit)),
      ),
    [branchRows],
  );

  const visible = useMemo(() => {
    const query = normalized(search);
    return branchRows
      .filter((row) => !district || districtName(row, w.zones) === district)
      .filter((row) => !payment || row.payment_mode === payment)
      .filter((row) => !receiver || partyKey(row, "receiver") === receiver)
      .filter((row) => !sender || partyKey(row, "sender") === sender)
      .filter(
        (row) =>
          !product || row.items.some((item) => item.description === product),
      )
      .filter((row) => !unit || row.items.some((item) => item.unit === unit))
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
        if (sort === "QUANTITY_DESC")
          return b.total_quantity - a.total_quantity;
        const time = +new Date(a.received_at) - +new Date(b.received_at);
        return sort === "NEWEST" ? -time : time;
      });
  }, [
    branchRows,
    district,
    payment,
    receiver,
    sender,
    product,
    unit,
    age,
    search,
    sort,
    w.zones,
  ]);

  const groupedRows = useMemo(() => {
    const grouped = groupLoadingRows(visible, groupMode);
    return grouped.sort((a, b) => a.label.localeCompare(b.label, "th"));
  }, [visible, groupMode]);

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
  const selectedWeight = selectedRows.reduce(
    (sum, row) => sum + row.total_weight,
    0,
  );
  const draftTrips = trips.filter(
    (trip) => trip.status === "DRAFT" && trip.destinationBranchCode === branch,
  );
  const issuingBranch =
    w.branches.find((row) => row.id === w.profile.branch_id) ||
    w.branches.find((row) => row.can_issue_bills);
  const billPrefix = billNumberPrefix(issuingBranch?.document_code || "B01");
  const branchMeta = branches.find((row) => row.code === branch);

  const allocations = selectedRows.flatMap((row) =>
    row.items.flatMap((item) => {
      const quantity = Number(loadQuantities[item.id] ?? item.quantity);
      if (!Number.isFinite(quantity) || quantity <= 0) return [];
      return [{ shipmentId: row.id, itemId: item.id, quantity }];
    }),
  );
  const invalidAllocation = selectedRows.some((row) =>
    row.items.some((item) => {
      const quantity = Number(loadQuantities[item.id] ?? item.quantity);
      return (
        !Number.isFinite(quantity) || quantity < 0 || quantity > item.quantity
      );
    }),
  );
  const allocationQuantity = allocations.reduce(
    (sum, allocation) => sum + allocation.quantity,
    0,
  );

  function chooseBranch(code: string, paymentMode: PaymentMode | "" = "") {
    setBranch(code);
    setPayment(paymentMode);
    setDistrict("");
    setReceiver("");
    setSender("");
    setProduct("");
    setUnit("");
    setAge("");
    setSearch("");
    setSelected(new Set());
    setLoadQuantities({});
  }

  function clearFilters() {
    setDistrict("");
    setAge("");
    setPayment("");
    setReceiver("");
    setSender("");
    setProduct("");
    setUnit("");
    setSearch("");
  }

  function selectRows(ids: string[], select: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      ids.forEach((id) => (select ? next.add(id) : next.delete(id)));
      return next;
    });
    if (select) {
      const idSet = new Set(ids);
      setLoadQuantities((current) => {
        const next = { ...current };
        rows
          .filter((row) => idSet.has(row.id))
          .flatMap((row) => row.items)
          .forEach((item) => {
            if (next[item.id] === undefined)
              next[item.id] = String(item.quantity);
          });
        return next;
      });
    }
  }

  function toggle(id: string) {
    selectRows([id], !selected.has(id));
  }

  function toggleVisible() {
    const allSelected = visible.every((row) => selected.has(row.id));
    selectRows(
      visible.map((row) => row.id),
      !allSelected,
    );
  }

  function addBillFromEntry() {
    const shipmentNo = completeBillNumber(billPrefix, billEntry);
    const row = rows.find((item) => item.shipment_no === shipmentNo);
    if (!row) {
      w.toast(`ไม่พบบิล ${shipmentNo || billEntry} ในคิวรอขึ้นรถ`, true);
      return;
    }
    const destination = branchCode(row, w.zones);
    if (destination !== branch) {
      const destinationName = branches.find(
        (item) => item.code === destination,
      )?.name;
      w.toast(`บิลนี้ไปสาขา${destinationName || destination}`, true);
      return;
    }
    selectRows([row.id], true);
    setBillEntry("");
    w.toast(`เพิ่มบิล ${row.shipment_no} แล้ว`);
    window.setTimeout(
      () =>
        document.getElementById(`loading-row-${row.id}`)?.scrollIntoView({
          behavior: "smooth",
          block: "center",
        }),
      0,
    );
  }

  async function createTrip() {
    if (!createBranch || !createVehicleId) return;
    setBusy(true);
    try {
      const manifestNo = `LOAD-${localDate().replaceAll("-", "").slice(2)}-${createBranch}-${String(Date.now()).slice(-6)}${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
      const id = await w.service.createLoadTrip(
        manifestNo,
        createBranch,
        createVehicleId,
      );
      if (branch !== createBranch) chooseBranch(createBranch);
      setTripId(id);
      setCreatingTrip(false);
      setCreateVehicleId("");
      await refresh();
      setConfirming(resumeSelection);
      setResumeSelection(false);
      w.toast(`สร้างเที่ยวรถ ${manifestNo} แล้ว`);
    } catch (cause) {
      w.toast((cause as Error).message || "สร้างเที่ยวรถไม่สำเร็จ", true);
    } finally {
      setBusy(false);
    }
  }

  async function saveSelection() {
    if (
      !tripId ||
      allocations.length === 0 ||
      mixedBranches ||
      invalidAllocation
    )
      return;
    setBusy(true);
    try {
      await w.service.saveLoadTripItems(tripId, "ADD", allocations);
      setSelected(new Set());
      setLoadQuantities({});
      setConfirming(false);
      w.refresh();
      w.toast("บันทึกสินค้าลงเที่ยวรถแล้ว");
      setWorkspaceView("TRIPS");
    } catch (cause) {
      w.toast((cause as Error).message || "บันทึกสินค้าไม่สำเร็จ", true);
    } finally {
      setBusy(false);
    }
  }

  function renderBillRow(row: LoadingQueueRecord) {
    const billAge = calendarAgeInBangkok(row.received_at);
    const metadata = BRANCH_OPTIONS.find(
      (item) => item.code === branchCode(row, w.zones),
    );
    return (
      <tr
        id={`loading-row-${row.id}`}
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
                  {item.loaded_quantity
                    ? `ทั้งหมด ${number(item.original_quantity || item.quantity)} · จัดแล้ว ${number(item.loaded_quantity)} · คงเหลือ ${number(item.quantity)}`
                    : row.price_pending
                      ? "รอราคา"
                      : `@ ${money(item.unit_price)}`}
                </small>
              </li>
            ))}
          </ul>
        </td>
        <td>
          {districtName(row, w.zones)}
          <small className="loading-branch" style={{ color: metadata?.color }}>
            {metadata?.name || branchCode(row, w.zones)}
          </small>
        </td>
        <td>
          <span className={`payment-mode ${row.payment_mode}`}>
            {PAYMENT_LABELS[row.payment_mode]}
          </span>
        </td>
        <td className="numeric">
          <strong>
            {row.price_pending ? "รอราคา" : money(row.total_amount)}
          </strong>
        </td>
        <td>
          <span
            className={
              "loading-age " +
              (billAge > 3 ? "danger" : billAge >= 2 ? "warning" : "")
            }
          >
            {billAge === 0 ? "วันนี้" : `${billAge} วัน`}
          </span>
        </td>
      </tr>
    );
  }

  if (workspaceView === "TRIPS") {
    return (
      <LoadTripManager
        operations={operations}
        onBack={() => setWorkspaceView("QUEUE")}
        onChanged={() => {
          w.refresh();
          void refresh();
        }}
      />
    );
  }

  return (
    <>
      <div className="page-heading loading-page-heading">
        <div>
          <div className="breadcrumb">
            สำนักงานใหญ่ <span>/</span> งานขนส่ง
          </div>
          <h1>
            {branch
              ? `บิลรอขึ้นรถ · ${branchMeta?.name || branch}`
              : "แดชบอร์ดจัดของขึ้นรถ"}
            <span className="heading-dot" />
          </h1>
          <p>
            {branch
              ? "ตรวจรายการและบันทึกสินค้าลงเที่ยวรถ"
              : "ตรวจจำนวนของและยอดเงินก่อนตัดสินใจจัดรถไปแต่ละสาขา"}
          </p>
        </div>
        <div className="heading-actions">
          <Button
            className="primary"
            onClick={() => {
              setCreateBranch(branch);
              setCreateVehicleId("");
              setResumeSelection(false);
              setCreatingTrip(true);
            }}
          >
            <PackageCheck size={17} /> สร้างเที่ยวรถ
          </Button>
          <Button onClick={() => setWorkspaceView("TRIPS")}>
            <Truck size={17} /> เที่ยวรถที่สร้างแล้ว
          </Button>
          {branch && (
            <Button onClick={() => chooseBranch("")}>
              <ArrowLeft size={17} /> กลับแดชบอร์ดงานขึ้นรถ
            </Button>
          )}
          <Button onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={loading ? "spin" : ""} size={17} />
            อัปเดตข้อมูล
          </Button>
        </div>
      </div>

      {error && <div className="alert error">{error}</div>}
      {loading && !loadedOnce.current ? (
        <Loading />
      ) : !branch ? (
        <section className="queue-dashboard-table loading-dashboard-table">
          <header>
            <div>
              <Truck size={20} />
              <div>
                <h2>ของที่ยังรอจัดขึ้นรถ</h2>
                <span>กดสาขาหรือประเภทการชำระเงินเพื่อเปิดรายการบิล</span>
              </div>
            </div>
            <strong>
              {number(dashboard.total.billCount)} <small>บิล</small>
            </strong>
          </header>
          <div className="data-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>สาขา</th>
                  <th>จำนวนบิล</th>
                  <th>จำนวนของ</th>
                  <th>ยอดเงินรวม</th>
                  {LOADING_PAYMENT_MODES.map((mode) => (
                    <th key={mode}>{PAYMENT_LABELS[mode]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dashboard.rows.map((row) => (
                  <tr
                    key={row.code}
                    style={{ "--branch-color": row.color } as CSSProperties}
                  >
                    <th scope="row">
                      <i />
                      <button
                        type="button"
                        onClick={() => chooseBranch(row.code)}
                      >
                        {row.name}
                        <small>{row.code}</small>
                      </button>
                    </th>
                    <td>
                      <button
                        type="button"
                        className="queue-count-link"
                        onClick={() => chooseBranch(row.code)}
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
                    {LOADING_PAYMENT_MODES.map((mode) => (
                      <td key={mode}>
                        <button
                          type="button"
                          className="payment-summary-link"
                          onClick={() => chooseBranch(row.code, mode)}
                          disabled={row.payments[mode].billCount === 0}
                        >
                          <b>{number(row.payments[mode].billCount)} บิล</b>
                          <small>฿{money(row.payments[mode].amount)}</small>
                        </button>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">รวม</th>
                  <td>{number(dashboard.total.billCount)}</td>
                  <td>{number(dashboard.total.quantity)}</td>
                  <td>฿{money(dashboard.total.amount)}</td>
                  {LOADING_PAYMENT_MODES.map((mode) => (
                    <td key={mode}>
                      <b>
                        {number(dashboard.total.payments[mode].billCount)} บิล
                      </b>
                      <small>
                        ฿{money(dashboard.total.payments[mode].amount)}
                      </small>
                    </td>
                  ))}
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      ) : (
        <>
          <section className="loading-workspace">
            <div className="loading-bill-entry">
              <div>
                <ScanLine size={19} />
                <div>
                  <strong>พิมพ์หรือสแกนเลขบิล</strong>
                  <small>พิมพ์เฉพาะเลขท้ายได้ ระบบเติมเป็น 6 หลัก</small>
                </div>
              </div>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  addBillFromEntry();
                }}
              >
                <span>{billPrefix}</span>
                <input
                  aria-label="เลขท้ายบิลหรือเลขจาก QR"
                  placeholder="123 หรือสแกน QR"
                  value={billEntry}
                  onChange={(event) => setBillEntry(event.target.value)}
                />
                <Button
                  className="primary"
                  type="submit"
                  disabled={!billEntry.trim()}
                >
                  เพิ่มบิล
                </Button>
              </form>
            </div>

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
                onChange={(event) => chooseBranch(event.target.value)}
              >
                {branches.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name}
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
              <select
                aria-label="กรองสินค้า"
                value={product}
                onChange={(event) => setProduct(event.target.value)}
              >
                <option value="">สินค้าทั้งหมด</option>
                {products.map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
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
              <select
                aria-label="จัดกลุ่มรายการ"
                value={groupMode}
                onChange={(event) => {
                  const mode = event.target.value as LoadingGroupMode;
                  setGroupMode(mode);
                  if (mode === "RECEIVER") setSort("RECEIVER");
                  if (mode === "SENDER") setSort("SENDER");
                }}
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
                  onChange={(event) => setSort(event.target.value as SortMode)}
                >
                  <option value="OLDEST">เก่าสุดก่อน</option>
                  <option value="NEWEST">ใหม่สุดก่อน</option>
                  <option value="RECEIVER">ผู้รับ ก-ฮ</option>
                  <option value="SENDER">ผู้ส่ง ก-ฮ</option>
                  <option value="QUANTITY_DESC">จำนวนมากก่อน</option>
                </select>
              </label>
              <Button className="loading-clear" onClick={clearFilters}>
                <X size={16} /> ล้างตัวกรอง
              </Button>
            </div>

            <div className="loading-result-summary">
              <span>พบ {number(visible.length)} บิล</span>
              <span>
                {number(
                  visible.reduce((sum, row) => sum + row.total_quantity, 0),
                )}{" "}
                ชิ้น
              </span>
              <span>
                ฿
                {money(visible.reduce((sum, row) => sum + row.total_amount, 0))}
              </span>
              {selectedRows.length > 0 && (
                <strong>เลือกค้างไว้ {number(selectedRows.length)} บิล</strong>
              )}
            </div>

            {visible.length === 0 ? (
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
                          checked={visible.every((row) => selected.has(row.id))}
                          onChange={toggleVisible}
                        />
                      </th>
                      <th>เลขบิล / วันที่</th>
                      <th>ผู้รับ</th>
                      <th>ผู้ส่ง</th>
                      <th>รายการสินค้า</th>
                      <th>อำเภอ</th>
                      <th>ชำระเงิน</th>
                      <th className="numeric">ยอดคงเหลือ</th>
                      <th>อายุบิล</th>
                    </tr>
                  </thead>
                  <tbody>
                    {groupMode === "NONE"
                      ? visible.map(renderBillRow)
                      : groupedRows.map((group) => {
                          const groupIds = group.rows.map((row) => row.id);
                          const allSelected = groupIds.every((id) =>
                            selected.has(id),
                          );
                          const collapsed = collapsedGroups.has(group.key);
                          return (
                            <Fragment key={group.key}>
                              <tr className="loading-group-row">
                                <td className="loading-check">
                                  <input
                                    type="checkbox"
                                    aria-label={`เลือกกลุ่ม ${group.label}`}
                                    checked={allSelected}
                                    onChange={() =>
                                      selectRows(groupIds, !allSelected)
                                    }
                                  />
                                </td>
                                <td colSpan={8}>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setCollapsedGroups((current) => {
                                        const next = new Set(current);
                                        if (next.has(group.key))
                                          next.delete(group.key);
                                        else next.add(group.key);
                                        return next;
                                      })
                                    }
                                  >
                                    {collapsed ? (
                                      <ChevronRight size={18} />
                                    ) : (
                                      <ChevronDown size={18} />
                                    )}
                                    <strong>{group.label}</strong>
                                    <span>{number(group.billCount)} บิล</span>
                                    <span>{number(group.quantity)} ชิ้น</span>
                                    <span>฿{money(group.amount)}</span>
                                    <small>
                                      {groupMode === "SENDER"
                                        ? `ผู้รับ ${number(group.counterpartCount)} ราย`
                                        : `ผู้ส่ง ${number(group.counterpartCount)} ราย`}
                                      {group.itemSummary
                                        ? ` · ${group.itemSummary}`
                                        : ""}
                                    </small>
                                  </button>
                                </td>
                              </tr>
                              {!collapsed && group.rows.map(renderBillRow)}
                            </Fragment>
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
                  {selectedWeight > 0
                    ? `${number(selectedWeight)} กก.`
                    : "ยังไม่มีน้ำหนัก"}
                </span>
                <span>
                  {selectedRows.some((row) => row.price_pending)
                    ? `ยอดที่ทราบ ฿${money(selectedAmount)}`
                    : `฿${money(selectedAmount)}`}
                </span>
              </div>
              {mixedBranches && <small>กรุณาเลือกบิลที่ไปสาขาเดียวกัน</small>}
              <Button onClick={() => setReviewingSelection(true)}>
                <ListChecks size={17} /> ดูบิลที่เลือก
              </Button>
              <Button
                className="primary"
                disabled={mixedBranches}
                onClick={() => {
                  setTripId(draftTrips[0]?.id || "");
                  setConfirming(true);
                }}
              >
                <PackageCheck size={17} /> บันทึกลงเที่ยวรถ
              </Button>
            </div>
          )}
        </>
      )}

      {creatingTrip && (
        <Modal title="สร้างเที่ยวรถ" onClose={() => setCreatingTrip(false)}>
          <div className="modal-body load-confirmation">
            <Field label="สาขาปลายทาง" required>
              <select
                value={createBranch}
                onChange={(event) => setCreateBranch(event.target.value)}
              >
                <option value="">เลือกสาขาปลายทาง</option>
                {branches.map((row) => (
                  <option key={row.code} value={row.code}>
                    {row.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="ทะเบียนรถ" required>
              <select
                value={createVehicleId}
                onChange={(event) => setCreateVehicleId(event.target.value)}
              >
                <option value="">เลือกทะเบียนรถ</option>
                {activeVehicles.map((vehicle) => (
                  <option key={vehicle.id} value={vehicle.id}>
                    {vehicle.plateNo} · {vehicle.vehicleType}
                  </option>
                ))}
              </select>
            </Field>
            {createVehicleId && (
              <div className="load-driver">
                <Truck size={18} />
                <div>
                  <span>พนักงานขับรถ</span>
                  <strong>
                    {createDriver?.name || "ทะเบียนนี้ยังไม่ได้ผูกคนขับ"}
                  </strong>
                </div>
              </div>
            )}
            <div className="modal-footer">
              <Button onClick={() => setCreatingTrip(false)}>ยกเลิก</Button>
              <Button
                className="primary"
                disabled={!createBranch || !createVehicleId}
                busy={busy}
                onClick={() => void createTrip()}
              >
                สร้างเที่ยวรถ
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {confirming && (
        <Modal
          title="บันทึกสินค้าลงเที่ยวรถ"
          onClose={() => setConfirming(false)}
        >
          <div className="modal-body load-confirmation">
            <div className="load-confirm-summary">
              <ClipboardCheck size={22} />
              <div>
                <strong>
                  {selectedRows.length} บิล · สาขา{branchMeta?.name}
                </strong>
                <span>
                  จะขึ้นรถ {number(allocationQuantity)} ชิ้น จากที่เลือก{" "}
                  {number(selectedQuantity)} ชิ้น
                </span>
              </div>
            </div>
            <Field label="เที่ยวรถ" required>
              <select
                value={tripId}
                onChange={(event) => setTripId(event.target.value)}
              >
                <option value="">เลือกเที่ยวรถที่กำลังจัดของ</option>
                {draftTrips.map((trip) => (
                  <option key={trip.id} value={trip.id}>
                    {trip.manifestNo}
                  </option>
                ))}
              </select>
            </Field>
            {!draftTrips.length && (
              <div className="alert error">
                กรุณาสร้างเที่ยวรถของสาขานี้ก่อน
                <Button
                  onClick={() => {
                    setConfirming(false);
                    setCreateBranch(branch);
                    setCreateVehicleId("");
                    setResumeSelection(true);
                    setCreatingTrip(true);
                  }}
                >
                  สร้างเที่ยวรถ
                </Button>
              </div>
            )}
            <div className="load-allocation-list">
              <header>
                <strong>จำนวนสินค้าที่ขึ้นเที่ยวนี้</strong>
                <small>ใส่ 0 สำหรับรายการที่ยังไม่ขึ้นรถ</small>
              </header>
              {selectedRows.flatMap((row) =>
                row.items.map((item) => {
                  const entered = Number(
                    loadQuantities[item.id] ?? item.quantity,
                  );
                  const invalid =
                    !Number.isFinite(entered) ||
                    entered < 0 ||
                    entered > item.quantity;
                  return (
                    <label key={item.id} className={invalid ? "invalid" : ""}>
                      <span>
                        <strong>
                          {row.shipment_no} · {item.description}
                        </strong>
                        <small>
                          ทั้งหมด{" "}
                          {number(item.original_quantity || item.quantity)} ·
                          จัดแล้ว {number(item.loaded_quantity || 0)} · คงเหลือ{" "}
                          {number(item.quantity)} {item.unit}
                        </small>
                      </span>
                      <input
                        type="number"
                        min="0"
                        max={item.quantity}
                        step="any"
                        value={loadQuantities[item.id] ?? String(item.quantity)}
                        onChange={(event) =>
                          setLoadQuantities((current) => ({
                            ...current,
                            [item.id]: event.target.value,
                          }))
                        }
                        aria-label={`จำนวน ${item.description} ที่ขึ้นรถ`}
                      />
                      <b>{item.unit}</b>
                    </label>
                  );
                }),
              )}
            </div>
            {invalidAllocation && (
              <div className="alert error">
                จำนวนขึ้นรถต้องไม่เกินจำนวนคงเหลือ
              </div>
            )}
            <div className="modal-footer">
              <Button onClick={() => setConfirming(false)}>ยกเลิก</Button>
              <Button
                className="primary"
                busy={busy}
                disabled={
                  !tripId || invalidAllocation || allocations.length === 0
                }
                onClick={() => void saveSelection()}
              >
                <PackageCheck size={17} /> บันทึกสินค้า
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {reviewingSelection && (
        <Modal
          wide
          title={`บิลที่เลือก ${number(selectedRows.length)} บิล`}
          onClose={() => setReviewingSelection(false)}
        >
          <div className="modal-body selected-bill-review">
            <div className="selected-bill-summary">
              <span>{number(selectedQuantity)} ชิ้น</span>
              <span>
                {selectedWeight > 0
                  ? `${number(selectedWeight)} กก.`
                  : "ยังไม่มีน้ำหนัก"}
              </span>
              <strong>฿{money(selectedAmount)}</strong>
            </div>
            <div className="data-table-scroll selected-bill-scroll">
              <table className="data-table selected-bill-table">
                <thead>
                  <tr>
                    <th>เลขบิล</th>
                    <th>ผู้รับ</th>
                    <th>ผู้ส่ง</th>
                    <th>รายการสินค้า</th>
                    <th className="numeric">จำนวน</th>
                    <th aria-label="นำออก" />
                  </tr>
                </thead>
                <tbody>
                  {selectedRows.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <strong>{row.shipment_no}</strong>
                        <small>{thaiDate(row.received_at)}</small>
                      </td>
                      <td>{row.receiver_snapshot.display_name}</td>
                      <td>{row.sender_snapshot.display_name}</td>
                      <td>
                        {row.items
                          .map((item) => `${item.description} ${item.unit}`)
                          .join(", ")}
                      </td>
                      <td className="numeric">{number(row.total_quantity)}</td>
                      <td>
                        <Button
                          title={`นำบิล ${row.shipment_no} ออกจากรายการที่เลือก`}
                          onClick={() => {
                            selectRows([row.id], false);
                            if (selectedRows.length === 1)
                              setReviewingSelection(false);
                          }}
                        >
                          <Trash2 size={16} /> นำออก
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="modal-footer">
              <Button
                onClick={() => {
                  setSelected(new Set());
                  setLoadQuantities({});
                  setReviewingSelection(false);
                }}
              >
                ล้างทั้งหมด
              </Button>
              <Button
                className="primary"
                onClick={() => setReviewingSelection(false)}
              >
                ใช้รายการนี้ต่อ
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
