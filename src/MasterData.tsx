import { useMemo, useState } from "react";
import {
  Archive,
  CarFront,
  CircleAlert,
  CircleCheck,
  Download,
  Eye,
  EyeOff,
  FileJson,
  FileImage,
  FileSpreadsheet,
  Link2,
  Package,
  Pencil,
  Plus,
  Search,
  Trash2,
  Unlink,
  UserRound,
  UsersRound,
} from "lucide-react";
import { useWorkspace } from "./context";
import { BRANCH_OPTIONS, PROVINCE_OPTIONS } from "./intakeData";
import {
  catalogName,
  loadIntakeRegistry,
  partyName,
  saveIntakeRegistry,
  type IntakeRegistrySnapshot,
} from "./intakeRegistry";
import {
  DOCUMENT_LABELS,
  OWNERSHIP_LABELS,
  currentDriver,
  loadOperations,
  newId,
  nextEmployeeCode,
  nextVehicleCode,
  saveOperations,
  type CustomerRelation,
  type DocumentKind,
  type Employee,
  type MasterDocument,
  type OperationsState,
  type Vehicle,
} from "./operationsStore";
import type { CatalogItem, IntakeParty, Measurements } from "./intakeEntryData";
import {
  buildMasterDataExport,
  downloadMasterDataExcel,
  downloadMasterDataJson,
} from "./masterDataExport";
import { PAYMENT_LABELS, type PaymentMode, type Zone } from "./types";
import { Button, EditableSelect, Field, IconButton, Modal } from "./ui";

type Tab =
  "receivers" | "senders" | "products" | "relations" | "employees" | "vehicles";

const tabs: { id: Tab; label: string; Icon: typeof UserRound }[] = [
  { id: "receivers", label: "ผู้รับ", Icon: UserRound },
  { id: "senders", label: "ผู้ส่ง", Icon: UsersRound },
  { id: "products", label: "สินค้าและหน่วย", Icon: Package },
  { id: "relations", label: "ความสัมพันธ์", Icon: Link2 },
  { id: "employees", label: "พนักงาน", Icon: UsersRound },
  { id: "vehicles", label: "ทะเบียนรถ", Icon: CarFront },
];

const branchLabel = (code: string) =>
  code === "BKK"
    ? "กรุงเทพฯ"
    : BRANCH_OPTIONS.find((branch) => branch.code === code)?.name || code;
const thaiSort = (a: string, b: string) => a.localeCompare(b, "th");

function visibleActiveFirst<T>(
  rows: T[],
  showInactive: boolean,
  isActive: (row: T) => boolean,
  label: (row: T) => string,
) {
  return rows
    .filter((row) => showInactive || isActive(row))
    .sort(
      (a, b) =>
        Number(isActive(b)) - Number(isActive(a)) ||
        thaiSort(label(a), label(b)),
    );
}

const EMPLOYEE_POSITIONS = [
  "พนักงานรับสินค้า",
  "พนักงานขับรถ",
  "พนักงานส่งสินค้า",
  "หัวหน้าสาขา",
  "บัญชี",
  "ธุรการ",
  "ผู้จัดการ",
];

const PARTY_PREFIXES = ["บจก", "หจก", "นาย", "นาง", "นางสาว", "ร้าน"];

const VEHICLE_TYPES = [
  "รถจักรยานยนต์",
  "รถกระบะ",
  "รถบรรทุก 4 ล้อ",
  "รถบรรทุก 6 ล้อ",
  "รถบรรทุก 10 ล้อ",
  "รถบรรทุก 12 ล้อ",
  "รถพ่วง",
  "รถกึ่งพ่วง",
];

const mergeOptions = (...groups: string[][]) =>
  [
    ...new Set(
      groups
        .flat()
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ].sort(thaiSort);

export default function MasterData() {
  const w = useWorkspace();
  const [tab, setTab] = useState<Tab>("receivers");
  const [query, setQuery] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [registry, setRegistry] = useState(loadIntakeRegistry);
  const [operations, setOperations] = useState(loadOperations);
  const [editor, setEditor] = useState<
    | { kind: "party"; role: "receiver" | "sender"; id?: string }
    | { kind: "product"; id?: string }
    | { kind: "relation" }
    | { kind: "employee"; id?: string }
    | { kind: "vehicle"; id?: string }
    | null
  >(null);

  function commitRegistry(next: IntakeRegistrySnapshot, message: string) {
    setRegistry(next);
    saveIntakeRegistry(next);
    w.toast(message);
  }
  function commitOperations(next: OperationsState, message: string) {
    setOperations(next);
    saveOperations(next);
    w.toast(message);
  }

  const normalized = query.trim().toLocaleLowerCase("th");
  const role = tab === "senders" ? "sender" : "receiver";
  const partyMatches = registry.parties
    .filter((party) => registry.partyRoles[party.id]?.[role] !== false)
    .filter((party) =>
      (party.display_name + party.phone + party.tax_id)
        .toLocaleLowerCase("th")
        .includes(normalized),
    );
  const catalogActive =
    (registry.raw.catalogActive as Record<string, boolean> | undefined) || {};
  const catalogMatches = registry.catalog.filter((row) =>
    `${row.name} ${row.unit}`.toLocaleLowerCase("th").includes(normalized),
  );
  const employeeMatches = operations.employees.filter((row) =>
    `${row.code} ${row.name} ${row.phone} ${row.position}`
      .toLocaleLowerCase("th")
      .includes(normalized),
  );
  const vehicleMatches = operations.vehicles.filter((row) =>
    `${row.internalNo} ${row.plateNo} ${row.vehicleType}`
      .toLocaleLowerCase("th")
      .includes(normalized),
  );
  const inactiveCount =
    tab === "receivers" || tab === "senders"
      ? partyMatches.filter((row) => !row.is_active).length
      : tab === "products"
        ? catalogMatches.filter((row) => catalogActive[row.id] === false).length
        : tab === "employees"
          ? employeeMatches.filter((row) => !row.active).length
          : tab === "vehicles"
            ? vehicleMatches.filter((row) => !row.active).length
            : 0;

  function addLabel() {
    if (tab === "receivers") return "เพิ่มผู้รับ";
    if (tab === "senders") return "เพิ่มผู้ส่ง";
    if (tab === "products") return "เพิ่มสินค้า / หน่วย";
    if (tab === "relations") return "จับคู่ผู้รับ–ผู้ส่ง";
    if (tab === "employees") return "เพิ่มพนักงาน";
    return "เพิ่มทะเบียนรถ";
  }
  function add() {
    if (tab === "receivers" || tab === "senders")
      setEditor({ kind: "party", role });
    else if (tab === "products") setEditor({ kind: "product" });
    else if (tab === "relations") setEditor({ kind: "relation" });
    else if (tab === "employees") setEditor({ kind: "employee" });
    else setEditor({ kind: "vehicle" });
  }

  return (
    <div className="ops-page">
      <header className="ops-heading">
        <div>
          <h1>ข้อมูลหลัก</h1>
          <p>ทะเบียนกลางสำหรับงานรับสินค้า ขนส่ง บุคลากร และรถ</p>
        </div>
        <div className="ops-heading-actions">
          <Button onClick={() => setExportOpen(true)}>
            <Download size={16} />
            ส่งออกข้อมูล
          </Button>
          <Button className="primary" onClick={add}>
            <Plus size={16} />
            {addLabel()}
          </Button>
        </div>
      </header>

      <div className="ops-tabs" role="tablist" aria-label="ประเภทข้อมูลหลัก">
        {tabs.map(({ id, label, Icon }) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "active" : ""}
            onClick={() => {
              setTab(id);
              setQuery("");
              setShowInactive(false);
            }}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </div>

      <div className="ops-toolbar">
        <label>
          <Search size={16} />
          <input
            aria-label="ค้นหาข้อมูลหลัก"
            placeholder="ค้นหาชื่อ รหัส เบอร์โทร หรือทะเบียน"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="ops-toolbar-actions">
          {tab !== "relations" && (
            <Button
              disabled={inactiveCount === 0 && !showInactive}
              onClick={() => setShowInactive((current) => !current)}
            >
              {showInactive ? <EyeOff size={16} /> : <Eye size={16} />}
              {showInactive
                ? "ซ่อนรายการหยุดใช้"
                : `แสดงรายการหยุดใช้ (${inactiveCount})`}
            </Button>
          )}
          <span>
            การลบจะเป็นการหยุดใช้งานหรือยกเลิกความสัมพันธ์ ไม่ลบประวัติเดิม
          </span>
        </div>
      </div>

      {(tab === "receivers" || tab === "senders") && (
        <PartyTable
          rows={visibleActiveFirst(
            partyMatches,
            showInactive,
            (row) => row.is_active,
            (row) => row.display_name,
          )}
          role={role}
          defaults={registry.defaults}
          onEdit={(id) => setEditor({ kind: "party", role, id })}
          onToggle={(id) => {
            const next = structuredClone(registry);
            const party = next.parties.find((row) => row.id === id)!;
            party.is_active = !party.is_active;
            commitRegistry(
              next,
              party.is_active
                ? "เปิดใช้งานรายชื่อแล้ว"
                : "หยุดใช้งานรายชื่อแล้ว",
            );
          }}
        />
      )}

      {tab === "products" && (
        <ProductTable
          rows={visibleActiveFirst(
            catalogMatches,
            showInactive,
            (row) => catalogActive[row.id] !== false,
            (row) => `${row.name}${row.unit}`,
          )}
          active={catalogActive}
          linkCount={(id) =>
            operations.relationProducts.filter(
              (row) => row.catalogId === id && row.active,
            ).length
          }
          onEdit={(id) => setEditor({ kind: "product", id })}
          onToggle={(id) => {
            const next = structuredClone(registry);
            const active = {
              ...((next.raw.catalogActive as Record<string, boolean>) || {}),
              [id]: catalogActive[id] === false,
            };
            next.raw = { ...next.raw, catalogActive: active };
            commitRegistry(
              next,
              active[id] ? "เปิดใช้สินค้าแล้ว" : "หยุดใช้สินค้าแล้ว",
            );
          }}
        />
      )}

      {tab === "relations" && (
        <RelationsTable
          operations={operations}
          registry={registry}
          query={normalized}
          onUnlink={(id) => {
            const next = structuredClone(operations);
            next.relations.find((row) => row.id === id)!.active = false;
            commitOperations(
              next,
              "ยกเลิกความสัมพันธ์แล้ว โดยยังเก็บประวัติเดิม",
            );
          }}
          onUnlinkProduct={(id) => {
            const next = structuredClone(operations);
            next.relationProducts.find((row) => row.id === id)!.active = false;
            commitOperations(next, "ยกเลิกสินค้าของคู่ผู้รับ–ผู้ส่งแล้ว");
          }}
        />
      )}

      {tab === "employees" && (
        <EmployeeTable
          rows={visibleActiveFirst(
            employeeMatches,
            showInactive,
            (row) => row.active,
            (row) => `${row.name}${row.code}`,
          )}
          documents={operations.documents}
          onEdit={(id) => setEditor({ kind: "employee", id })}
          onToggle={(id) => {
            const next = structuredClone(operations);
            const employee = next.employees.find((row) => row.id === id)!;
            employee.active = !employee.active;
            commitOperations(
              next,
              employee.active
                ? "เปิดใช้งานพนักงานแล้ว"
                : "หยุดใช้งานพนักงานแล้ว",
            );
          }}
        />
      )}

      {tab === "vehicles" && (
        <VehicleTable
          rows={visibleActiveFirst(
            vehicleMatches,
            showInactive,
            (row) => row.active,
            (row) => `${row.plateNo}${row.internalNo}`,
          )}
          operations={operations}
          onEdit={(id) => setEditor({ kind: "vehicle", id })}
          onToggle={(id) => {
            const next = structuredClone(operations);
            const vehicle = next.vehicles.find((row) => row.id === id)!;
            vehicle.active = !vehicle.active;
            commitOperations(
              next,
              vehicle.active ? "เปิดใช้งานรถแล้ว" : "หยุดใช้งานรถแล้ว",
            );
          }}
        />
      )}

      {editor?.kind === "party" && (
        <PartyEditor
          role={editor.role}
          value={registry.parties.find((row) => row.id === editor.id)}
          prefixes={mergeOptions(
            PARTY_PREFIXES,
            registry.parties.map((row) => row.prefix || ""),
          )}
          provinces={mergeOptions(
            PROVINCE_OPTIONS,
            registry.parties.map((row) => row.province || ""),
          )}
          defaultBranch={editor.id ? registry.defaults[editor.id] : ""}
          onClose={() => setEditor(null)}
          onSave={(party, defaultBranch) => {
            const next = structuredClone(registry);
            const index = next.parties.findIndex((row) => row.id === party.id);
            if (index >= 0) next.parties[index] = party;
            else next.parties.push(party);
            next.defaults[party.id] = defaultBranch;
            next.partyRoles[party.id] = {
              ...(next.partyRoles[party.id] || {
                receiver: false,
                sender: false,
              }),
              [editor.role]: true,
            };
            commitRegistry(
              next,
              index >= 0 ? "แก้ไขรายชื่อแล้ว" : "เพิ่มรายชื่อแล้ว",
            );
            setEditor(null);
          }}
        />
      )}

      {editor?.kind === "product" && (
        <ProductEditor
          value={registry.catalog.find((row) => row.id === editor.id)}
          catalog={registry.catalog}
          onClose={() => setEditor(null)}
          onSave={(product) => {
            const next = structuredClone(registry);
            const index = next.catalog.findIndex(
              (row) => row.id === product.id,
            );
            if (index >= 0) next.catalog[index] = product;
            else next.catalog.push(product);
            commitRegistry(
              next,
              index >= 0 ? "แก้ไขสินค้าแล้ว" : "เพิ่มสินค้าแล้ว",
            );
            setEditor(null);
          }}
        />
      )}

      {editor?.kind === "relation" && (
        <RelationEditor
          registry={registry}
          operations={operations}
          onClose={() => setEditor(null)}
          onSave={(relation, catalogIds) => {
            const next = structuredClone(operations);
            const existing = next.relations.find(
              (row) =>
                row.receiverId === relation.receiverId &&
                row.senderId === relation.senderId,
            );
            if (existing)
              Object.assign(existing, relation, {
                id: existing.id,
                active: true,
                updatedAt: new Date().toISOString(),
              });
            else next.relations.push(relation);
            for (const id of catalogIds) {
              const link = next.relationProducts.find(
                (row) =>
                  row.receiverId === relation.receiverId &&
                  row.senderId === relation.senderId &&
                  row.catalogId === id,
              );
              if (link) link.active = true;
              else
                next.relationProducts.push({
                  id: newId(),
                  receiverId: relation.receiverId,
                  senderId: relation.senderId,
                  catalogId: id,
                  active: true,
                  createdAt: new Date().toISOString(),
                });
            }
            commitOperations(
              next,
              existing ? "แก้ไขข้อตกลงแล้ว" : "จับคู่ลูกค้าแล้ว",
            );
            setEditor(null);
          }}
        />
      )}

      {editor?.kind === "employee" && (
        <EmployeeEditor
          value={operations.employees.find((row) => row.id === editor.id)}
          positions={mergeOptions(
            EMPLOYEE_POSITIONS,
            operations.employees.map((row) => row.position),
          )}
          generatedCode={nextEmployeeCode(operations)}
          documents={operations.documents.filter(
            (row) => row.ownerType === "EMPLOYEE" && row.ownerId === editor.id,
          )}
          onClose={() => setEditor(null)}
          onSave={(employee, documents) => {
            const next = structuredClone(operations);
            const index = next.employees.findIndex(
              (row) => row.id === employee.id,
            );
            if (index >= 0) next.employees[index] = employee;
            else next.employees.push(employee);
            next.documents = [
              ...next.documents.filter(
                (row) =>
                  !(
                    row.ownerType === "EMPLOYEE" && row.ownerId === employee.id
                  ),
              ),
              ...documents,
            ];
            commitOperations(
              next,
              index >= 0 ? "แก้ไขพนักงานแล้ว" : "เพิ่มพนักงานแล้ว",
            );
            setEditor(null);
          }}
        />
      )}

      {editor?.kind === "vehicle" && (
        <VehicleEditor
          value={operations.vehicles.find((row) => row.id === editor.id)}
          vehicleTypes={mergeOptions(
            VEHICLE_TYPES,
            operations.vehicles.map((row) => row.vehicleType),
          )}
          generatedCode={nextVehicleCode(operations)}
          employees={operations.employees}
          driverId={
            operations.driverAssignments.find(
              (row) => row.vehicleId === editor.id && row.endsAt === null,
            )?.employeeId || ""
          }
          documents={operations.documents.filter(
            (row) => row.ownerType === "VEHICLE" && row.ownerId === editor.id,
          )}
          onClose={() => setEditor(null)}
          onSave={(vehicle, driverId, documents) => {
            const next = structuredClone(operations);
            const index = next.vehicles.findIndex(
              (row) => row.id === vehicle.id,
            );
            if (index >= 0) next.vehicles[index] = vehicle;
            else next.vehicles.push(vehicle);
            const today = new Date().toISOString().slice(0, 10);
            const currentAssignment = next.driverAssignments.find(
              (assignment) =>
                assignment.vehicleId === vehicle.id &&
                assignment.endsAt === null,
            );
            if (currentAssignment?.employeeId !== driverId) {
              if (currentAssignment) currentAssignment.endsAt = today;
              if (driverId)
                next.driverAssignments.push({
                  id: newId(),
                  vehicleId: vehicle.id,
                  employeeId: driverId,
                  startsAt: today,
                  endsAt: null,
                });
            }
            next.documents = [
              ...next.documents.filter(
                (row) =>
                  !(row.ownerType === "VEHICLE" && row.ownerId === vehicle.id),
              ),
              ...documents,
            ];
            commitOperations(
              next,
              index >= 0 ? "แก้ไขทะเบียนรถแล้ว" : "เพิ่มทะเบียนรถแล้ว",
            );
            setEditor(null);
          }}
        />
      )}

      {exportOpen && (
        <ExportMasterDataDialog
          registry={registry}
          operations={operations}
          zones={w.zones}
          generatedBy={w.profile.display_name}
          source={w.demo ? "DEMO" : "PRODUCTION"}
          onClose={() => setExportOpen(false)}
          onNotice={w.toast}
        />
      )}
    </div>
  );
}

function ExportMasterDataDialog({
  registry,
  operations,
  zones,
  generatedBy,
  source,
  onClose,
  onNotice,
}: {
  registry: IntakeRegistrySnapshot;
  operations: OperationsState;
  zones: Zone[];
  generatedBy: string;
  source: "DEMO" | "PRODUCTION";
  onClose: () => void;
  onNotice: (message: string, error?: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const bundle = useMemo(
    () =>
      buildMasterDataExport({
        registry,
        operations,
        zones,
        generatedBy,
        source,
      }),
    [generatedBy, operations, registry, source, zones],
  );
  const errors = bundle.audit.filter((row) => row.level === "error").length;
  const warnings = bundle.audit.filter((row) => row.level === "warning").length;
  const summary = [
    ["คู่ค้า", bundle.summary.parties],
    ["ความสัมพันธ์", bundle.summary.relations],
    ["สินค้า / หน่วย", bundle.summary.products],
    ["ราคาปัจจุบัน", bundle.summary.currentPrices],
    ["ประวัติราคา", bundle.summary.priceVersions],
    ["คำขอราคาค้าง", bundle.summary.pendingPriceRequests],
    ["พนักงาน", bundle.summary.employees],
    ["ทะเบียนรถ", bundle.summary.vehicles],
  ] as const;

  async function exportExcel() {
    setBusy(true);
    try {
      await downloadMasterDataExcel(bundle);
      onNotice("ดาวน์โหลดข้อมูลหลักเป็น Excel แล้ว");
    } catch (error) {
      onNotice(`สร้างไฟล์ Excel ไม่สำเร็จ: ${(error as Error).message}`, true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="ส่งออกข้อมูลหลัก" wide onClose={onClose}>
      <div className="master-export">
        <p className="master-export-intro">
          ส่งออกทั้งรายการที่ใช้งานและหยุดใช้ พร้อมรหัสเชื่อมโยงสำหรับตรวจสอบ
          และนำกลับเข้าระบบภายหลัง
        </p>

        <div className="master-export-summary">
          {summary.map(([label, count]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{count.toLocaleString("th-TH")}</strong>
              <small>รายการ</small>
            </div>
          ))}
        </div>

        <section className="master-export-audit">
          <header>
            <div>
              {errors || warnings ? (
                <CircleAlert size={20} />
              ) : (
                <CircleCheck size={20} />
              )}
              <h3>ตรวจสอบก่อนส่งออก</h3>
            </div>
            <span className={errors ? "has-errors" : ""}>
              ต้องแก้ {errors} · ควรตรวจ {warnings}
            </span>
          </header>
          {bundle.audit.length === 0 ? (
            <p className="master-export-ok">ไม่พบข้อมูลผิดปกติ</p>
          ) : (
            <div className="master-export-issues">
              {bundle.audit.slice(0, 10).map((issue, index) => (
                <div className={issue.level} key={`${issue.category}-${index}`}>
                  <strong>{issue.category}</strong>
                  <span>{issue.message}</span>
                </div>
              ))}
              {bundle.audit.length > 10 && (
                <p>และอีก {bundle.audit.length - 10} รายการในชีต “ตรวจสอบ”</p>
              )}
            </div>
          )}
        </section>

        <div className="master-export-notes">
          <p>
            <FileSpreadsheet size={18} />
            <span>
              <strong>Excel</strong>
              สำหรับเปิดตรวจ แยกข้อมูลเป็นหลายชีต
            </span>
          </p>
          <p>
            <FileJson size={18} />
            <span>
              <strong>JSON</strong>
              เก็บรหัสและความสัมพันธ์ครบ สำหรับระบบนำเข้าในอนาคต
            </span>
          </p>
          <small>
            เอกสารรูปและ PDF จะไม่ถูกแนบในไฟล์ มีเฉพาะชื่อไฟล์และรหัสอ้างอิง
          </small>
        </div>

        <div className="ops-form-actions">
          <Button onClick={onClose}>ปิด</Button>
          <Button
            disabled={busy}
            onClick={() => {
              downloadMasterDataJson(bundle);
              onNotice("ดาวน์โหลดข้อมูลหลักเป็น JSON แล้ว");
            }}
          >
            <FileJson size={16} />
            ดาวน์โหลด JSON
          </Button>
          <Button className="primary" busy={busy} onClick={exportExcel}>
            <FileSpreadsheet size={16} />
            ดาวน์โหลด Excel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function PartyTable({
  rows,
  role,
  defaults,
  onEdit,
  onToggle,
}: {
  rows: IntakeParty[];
  role: "receiver" | "sender";
  defaults: Record<string, string>;
  onEdit: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="ops-table-wrap">
      <table className="ops-table">
        <thead>
          <tr>
            <th>ชื่อ{role === "receiver" ? "ผู้รับ" : "ผู้ส่ง"}</th>
            <th>เบอร์โทร</th>
            <th>เลขผู้เสียภาษี</th>
            <th>จังหวัด</th>
            <th>สาขาเริ่มต้น</th>
            <th>สถานะ</th>
            <th aria-label="คำสั่ง" />
          </tr>
        </thead>
        <tbody>
          {rows.map((party) => (
            <tr key={party.id} className={!party.is_active ? "inactive" : ""}>
              <td>
                <strong>{party.display_name}</strong>
                <small>{party.note}</small>
              </td>
              <td>{party.phone || "–"}</td>
              <td>{party.tax_id || "–"}</td>
              <td>{party.province || party.address || "–"}</td>
              <td>
                {branchLabel(defaults[party.id] || party.branch_code || "")}
              </td>
              <td>
                <span className={party.is_active ? "status active" : "status"}>
                  {party.is_active ? "ใช้งาน" : "หยุดใช้"}
                </span>
              </td>
              <td className="ops-actions">
                <IconButton label="แก้ไข" onClick={() => onEdit(party.id)}>
                  <Pencil size={15} />
                </IconButton>
                <IconButton
                  label={party.is_active ? "หยุดใช้งาน" : "เปิดใช้งาน"}
                  onClick={() => onToggle(party.id)}
                >
                  <Archive size={15} />
                </IconButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProductTable({
  rows,
  active,
  linkCount,
  onEdit,
  onToggle,
}: {
  rows: CatalogItem[];
  active: Record<string, boolean>;
  linkCount: (id: string) => number;
  onEdit: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="ops-table-wrap">
      <table className="ops-table">
        <thead>
          <tr>
            <th>สินค้า</th>
            <th>หน่วยนับ</th>
            <th>น้ำหนัก</th>
            <th>ขนาด ก × ย × ส</th>
            <th>ผูกกับผู้รับ</th>
            <th>สถานะ</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const enabled = active[row.id] !== false;
            return (
              <tr key={row.id} className={!enabled ? "inactive" : ""}>
                <td>
                  <strong>{row.name}</strong>
                </td>
                <td>{row.unit}</td>
                <td>{row.weight ? `${row.weight} กก.` : "–"}</td>
                <td>
                  {row.width || row.length || row.height
                    ? `${row.width || "–"} × ${row.length || "–"} × ${row.height || "–"}`
                    : "–"}
                </td>
                <td>{linkCount(row.id)} ราย</td>
                <td>
                  <span className={enabled ? "status active" : "status"}>
                    {enabled ? "ใช้งาน" : "หยุดใช้"}
                  </span>
                </td>
                <td className="ops-actions">
                  <IconButton label="แก้ไข" onClick={() => onEdit(row.id)}>
                    <Pencil size={15} />
                  </IconButton>
                  <IconButton
                    label={enabled ? "หยุดใช้งาน" : "เปิดใช้งาน"}
                    onClick={() => onToggle(row.id)}
                  >
                    <Archive size={15} />
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

function RelationsTable({
  operations,
  registry,
  query,
  onUnlink,
  onUnlinkProduct,
}: {
  operations: OperationsState;
  registry: IntakeRegistrySnapshot;
  query: string;
  onUnlink: (id: string) => void;
  onUnlinkProduct: (id: string) => void;
}) {
  const rows = operations.relations
    .filter((row) => row.active)
    .filter((row) =>
      `${partyName(registry.parties, row.receiverId)} ${partyName(registry.parties, row.senderId)}`
        .toLocaleLowerCase("th")
        .includes(query),
    );
  return (
    <div className="ops-relations-grid">
      <section>
        <header>
          <h2>คู่ผู้รับ–ผู้ส่ง</h2>
          <span>{rows.length} คู่</span>
        </header>
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th>ผู้รับ</th>
                <th>ผู้ส่ง</th>
                <th>การชำระเงินเริ่มต้น</th>
                <th>รอบเครดิต</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>
                    <strong>
                      {partyName(registry.parties, row.receiverId)}
                    </strong>
                  </td>
                  <td>{partyName(registry.parties, row.senderId)}</td>
                  <td>{PAYMENT_LABELS[row.defaultPayment]}</td>
                  <td>
                    {row.defaultPayment.startsWith("CREDIT")
                      ? row.billingCycle === "MONTH_END"
                        ? "สิ้นเดือน"
                        : `${row.creditDays} วัน`
                      : "ชำระสด"}
                  </td>
                  <td className="ops-actions">
                    <IconButton
                      label="ลบเฉพาะความสัมพันธ์"
                      onClick={() => onUnlink(row.id)}
                    >
                      <Unlink size={15} />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <header>
          <h2>สินค้าของคู่ผู้รับ–ผู้ส่ง</h2>
          <span>
            {operations.relationProducts.filter((row) => row.active).length}{" "}
            รายการ
          </span>
        </header>
        <div className="ops-table-wrap">
          <table className="ops-table">
            <thead>
              <tr>
                <th>ผู้รับ</th>
                <th>ผู้ส่ง</th>
                <th>สินค้า / หน่วย</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {operations.relationProducts
                .filter((row) => row.active)
                .filter((row) =>
                  `${partyName(registry.parties, row.receiverId)} ${partyName(registry.parties, row.senderId)} ${catalogName(registry.catalog, row.catalogId)}`
                    .toLocaleLowerCase("th")
                    .includes(query),
                )
                .map((row) => (
                  <tr key={row.id}>
                    <td>
                      <strong>
                        {partyName(registry.parties, row.receiverId)}
                      </strong>
                    </td>
                    <td>{partyName(registry.parties, row.senderId)}</td>
                    <td>{catalogName(registry.catalog, row.catalogId)}</td>
                    <td className="ops-actions">
                      <IconButton
                        label="ลบเฉพาะความสัมพันธ์สินค้า"
                        onClick={() => onUnlinkProduct(row.id)}
                      >
                        <Unlink size={15} />
                      </IconButton>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function EmployeeTable({
  rows,
  documents,
  onEdit,
  onToggle,
}: {
  rows: Employee[];
  documents: MasterDocument[];
  onEdit: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="ops-table-wrap">
      <table className="ops-table">
        <thead>
          <tr>
            <th>รหัส / ชื่อ</th>
            <th>ตำแหน่ง</th>
            <th>สาขา</th>
            <th>เบอร์โทร</th>
            <th>ใบขับขี่</th>
            <th>เอกสาร</th>
            <th>สถานะ</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={!row.active ? "inactive" : ""}>
              <td>
                <small>{row.code}</small>
                <strong>{row.name}</strong>
              </td>
              <td>{row.position}</td>
              <td>{branchLabel(row.branch)}</td>
              <td>{row.phone || "–"}</td>
              <td>
                {row.licenseNo || "–"}
                {row.licenseExpiry && (
                  <small>หมดอายุ {row.licenseExpiry}</small>
                )}
              </td>
              <td>
                {
                  documents.filter(
                    (doc) =>
                      doc.ownerType === "EMPLOYEE" && doc.ownerId === row.id,
                  ).length
                }{" "}
                ไฟล์
              </td>
              <td>
                <label className="ops-table-status-toggle">
                  <input
                    type="checkbox"
                    checked={row.active}
                    aria-label={`${row.active ? "หยุดใช้งาน" : "เปิดใช้งาน"} ${row.name}`}
                    onChange={() => onToggle(row.id)}
                  />
                  <span className={row.active ? "status active" : "status"}>
                    {row.active ? "ใช้งาน" : "หยุดใช้"}
                  </span>
                </label>
              </td>
              <td className="ops-actions">
                <IconButton label="แก้ไข" onClick={() => onEdit(row.id)}>
                  <Pencil size={15} />
                </IconButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function VehicleTable({
  rows,
  operations,
  onEdit,
  onToggle,
}: {
  rows: Vehicle[];
  operations: OperationsState;
  onEdit: (id: string) => void;
  onToggle: (id: string) => void;
}) {
  return (
    <div className="ops-table-wrap">
      <table className="ops-table">
        <thead>
          <tr>
            <th>ทะเบียนรถ</th>
            <th>รหัสรถ</th>
            <th>ประเภทรถ</th>
            <th>สาขา</th>
            <th>คนขับปัจจุบัน</th>
            <th>เอกสาร</th>
            <th>สถานะ</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={!row.active ? "inactive" : ""}>
              <td>
                <strong>{row.plateNo}</strong>
                <small>{OWNERSHIP_LABELS[row.ownership]}</small>
                {row.note && <small>{row.note}</small>}
              </td>
              <td>{row.internalNo}</td>
              <td>{row.vehicleType}</td>
              <td>{branchLabel(row.branch)}</td>
              <td>
                {currentDriver(operations, row.id)?.name || "ยังไม่ผูกคนขับ"}
              </td>
              <td>
                {
                  operations.documents.filter(
                    (doc) =>
                      doc.ownerType === "VEHICLE" && doc.ownerId === row.id,
                  ).length
                }{" "}
                ไฟล์
              </td>
              <td>
                <label className="ops-table-status-toggle">
                  <input
                    type="checkbox"
                    checked={row.active}
                    aria-label={`${row.active ? "หยุดใช้งาน" : "เปิดใช้งาน"} ${row.plateNo}`}
                    onChange={() => onToggle(row.id)}
                  />
                  <span className={row.active ? "status active" : "status"}>
                    {row.active ? "ใช้งาน" : "หยุดใช้"}
                  </span>
                </label>
              </td>
              <td className="ops-actions">
                <IconButton label="แก้ไข" onClick={() => onEdit(row.id)}>
                  <Pencil size={15} />
                </IconButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PartyEditor({
  role,
  value,
  prefixes,
  provinces,
  defaultBranch,
  onClose,
  onSave,
}: {
  role: "receiver" | "sender";
  value?: IntakeParty;
  prefixes: string[];
  provinces: string[];
  defaultBranch: string;
  onClose: () => void;
  onSave: (party: IntakeParty, branch: string) => void;
}) {
  const existingName =
    value?.name ||
    value?.display_name.replace(new RegExp(`^${value.prefix || ""}\\s*`), "") ||
    "";
  const [form, setForm] = useState({
    prefix: value?.prefix || "",
    name: existingName,
    taxId: value?.tax_id || "",
    phone: value?.phone || "",
    address: value?.address_detail || value?.address || "",
    district: value?.district || "",
    province: value?.province || "",
    branch:
      defaultBranch || value?.branch_code || (role === "sender" ? "BKK" : ""),
    note: value?.note || "",
  });
  const set = (key: keyof typeof form, next: string) =>
    setForm((current) => ({ ...current, [key]: next }));
  const provinceRequired = role === "receiver";
  return (
    <Modal
      title={`${value ? "แก้ไข" : "เพิ่ม"}${role === "receiver" ? "ผู้รับ" : "ผู้ส่ง"}`}
      wide
      onClose={onClose}
    >
      <form
        className="ops-form"
        onSubmit={(event) => {
          event.preventDefault();
          const displayName = [form.prefix, form.name.trim()]
            .filter(Boolean)
            .join(" ");
          onSave(
            {
              id: value?.id || newId(),
              prefix: form.prefix,
              name: form.name.trim(),
              display_name: displayName,
              tax_id: form.taxId.trim(),
              phone: form.phone.trim(),
              address_detail: form.address.trim(),
              district: form.district.trim(),
              province: form.province.trim(),
              address: [form.address, form.district, form.province]
                .filter(Boolean)
                .join(" "),
              branch_code: form.branch,
              note: form.note.trim(),
              credit_days: value?.credit_days || 30,
              credit_limit: value?.credit_limit || 0,
              is_active: value?.is_active ?? true,
            },
            form.branch,
          );
        }}
      >
        <div className="ops-form-grid name">
          <Field label="คำนำหน้า">
            <EditableSelect
              value={form.prefix}
              options={prefixes}
              onChange={(next) => set("prefix", next)}
              customLabel="เพิ่ม / แก้ไขคำนำหน้า"
            />
          </Field>
          <Field label="ชื่อ" required>
            <input
              autoFocus
              required
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </Field>
        </div>
        <div className="ops-form-grid">
          <Field label="เลขประจำตัวผู้เสียภาษี">
            <input
              value={form.taxId}
              onChange={(e) => set("taxId", e.target.value)}
            />
          </Field>
          <Field label="เบอร์โทร">
            <input
              type="tel"
              value={form.phone}
              onChange={(e) => set("phone", e.target.value)}
            />
          </Field>
        </div>
        <Field label="ที่อยู่">
          <textarea
            rows={2}
            value={form.address}
            onChange={(e) => set("address", e.target.value)}
          />
        </Field>
        <div className="ops-form-grid thirds">
          <Field label="อำเภอ / เขต">
            <input
              value={form.district}
              onChange={(e) => set("district", e.target.value)}
            />
          </Field>
          <Field label="จังหวัด" required={provinceRequired}>
            <EditableSelect
              required={provinceRequired}
              value={form.province}
              options={provinces}
              onChange={(next) => set("province", next)}
              emptyLabel="ไม่ระบุจังหวัด"
              customLabel="เพิ่ม / แก้ไขจังหวัด"
              ariaLabel="จังหวัด"
            />
          </Field>
          <Field label="สาขา" required>
            <BranchSelect
              value={form.branch}
              onChange={(next) => set("branch", next)}
              includeBkk={role === "sender"}
            />
          </Field>
        </div>
        <Field label="หมายเหตุ">
          <textarea
            rows={2}
            value={form.note}
            onChange={(e) => set("note", e.target.value)}
          />
        </Field>
        <FormActions onClose={onClose} />
      </form>
    </Modal>
  );
}

function ProductEditor({
  value,
  catalog,
  onClose,
  onSave,
}: {
  value?: CatalogItem;
  catalog: CatalogItem[];
  onClose: () => void;
  onSave: (product: CatalogItem) => void;
}) {
  const [name, setName] = useState(value?.name || "");
  const [unit, setUnit] = useState(value?.unit || "กล่อง");
  const [measurements, setMeasurements] = useState<Measurements>({
    weight: value?.weight || "",
    width: value?.width || "",
    length: value?.length || "",
    height: value?.height || "",
  });
  const units = [
    ...new Set([
      "กล่อง",
      "มัด",
      "กระสอบ",
      "ลัง",
      "ชิ้น",
      "ถุง",
      "พาเลท",
      ...catalog.map((row) => row.unit),
    ]),
  ].sort(thaiSort);
  return (
    <Modal
      title={value ? "แก้ไขสินค้า / หน่วยนับ" : "เพิ่มสินค้า / หน่วยนับ"}
      onClose={onClose}
    >
      <form
        className="ops-form"
        onSubmit={(event) => {
          event.preventDefault();
          const productId =
            value?.productId ||
            catalog.find((row) => row.name.trim() === name.trim())?.productId ||
            newId();
          onSave({
            id: value?.id || `${productId}:${unit}`,
            productId,
            name: name.trim(),
            unit,
            ...measurements,
          });
        }}
      >
        <Field label="ชื่อสินค้า" required>
          <input
            autoFocus
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field label="หน่วยนับ" required>
          <EditableSelect
            required
            value={unit}
            options={units}
            onChange={setUnit}
            customLabel="เพิ่ม / แก้ไขหน่วยนับ"
          />
        </Field>
        <div className="ops-form-grid measurements">
          {(["weight", "width", "length", "height"] as const).map(
            (key, index) => (
              <Field
                key={key}
                label={
                  ["น้ำหนัก (กก.)", "กว้าง (ซม.)", "ยาว (ซม.)", "สูง (ซม.)"][
                    index
                  ]
                }
              >
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={measurements[key]}
                  onChange={(e) =>
                    setMeasurements((current) => ({
                      ...current,
                      [key]: e.target.value,
                    }))
                  }
                />
              </Field>
            ),
          )}
        </div>
        <FormActions onClose={onClose} />
      </form>
    </Modal>
  );
}

function RelationEditor({
  registry,
  operations,
  onClose,
  onSave,
}: {
  registry: IntakeRegistrySnapshot;
  operations: OperationsState;
  onClose: () => void;
  onSave: (relation: CustomerRelation, catalogIds: string[]) => void;
}) {
  const receivers = registry.parties
    .filter(
      (row) => registry.partyRoles[row.id]?.receiver !== false && row.is_active,
    )
    .sort((a, b) => thaiSort(a.display_name, b.display_name));
  const senders = registry.parties
    .filter(
      (row) => registry.partyRoles[row.id]?.sender !== false && row.is_active,
    )
    .sort((a, b) => thaiSort(a.display_name, b.display_name));
  const [receiverId, setReceiverId] = useState(receivers[0]?.id || "");
  const [senderId, setSenderId] = useState("");
  const [payment, setPayment] = useState<PaymentMode | "">("");
  const [billingCycle, setBillingCycle] = useState<"MONTH_END" | "NET_DAYS">(
    "MONTH_END",
  );
  const [days, setDays] = useState(30);
  const [catalogIds, setCatalogIds] = useState<string[]>([]);
  return (
    <Modal title="จับคู่ผู้รับ–ผู้ส่งครั้งแรก" wide onClose={onClose}>
      <form
        className="ops-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!payment) return;
          const timestamp = new Date().toISOString();
          onSave(
            {
              id: newId(),
              receiverId,
              senderId,
              defaultPayment: payment,
              billingCycle,
              creditDays: days,
              active: true,
              createdAt: timestamp,
              updatedAt: timestamp,
            },
            catalogIds,
          );
        }}
      >
        <div className="ops-form-grid">
          <Field label="ผู้รับ" required>
            <select
              required
              value={receiverId}
              onChange={(e) => setReceiverId(e.target.value)}
            >
              {receivers.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.display_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="ผู้ส่ง" required>
            <select
              required
              value={senderId}
              onChange={(e) => setSenderId(e.target.value)}
            >
              <option value="">เลือกผู้ส่ง</option>
              {senders.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.display_name}
                </option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="ประเภทการชำระเงิน" required>
          <select
            required
            value={payment}
            onChange={(e) => setPayment(e.target.value as PaymentMode)}
          >
            <option value="">ต้องเลือกในการจับคู่ครั้งแรก</option>
            {Object.entries(PAYMENT_LABELS).map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {payment.startsWith("CREDIT") && (
          <div className="ops-form-grid">
            <Field label="รอบวางบิล">
              <select
                value={billingCycle}
                onChange={(e) =>
                  setBillingCycle(e.target.value as typeof billingCycle)
                }
              >
                <option value="MONTH_END">สิ้นเดือน</option>
                <option value="NET_DAYS">กำหนดวัน</option>
              </select>
            </Field>
            {billingCycle === "NET_DAYS" && (
              <Field label="เครดิต (วัน)">
                <input
                  type="number"
                  min="1"
                  max="365"
                  value={days}
                  onChange={(e) => setDays(Number(e.target.value))}
                />
              </Field>
            )}
          </div>
        )}
        <fieldset className="ops-check-list">
          <legend>สินค้าของคู่ผู้รับ–ผู้ส่งนี้ (เลือกได้หลายรายการ)</legend>
          {registry.catalog.map((row) => (
            <label key={row.id}>
              <input
                type="checkbox"
                checked={catalogIds.includes(row.id)}
                onChange={(e) =>
                  setCatalogIds((current) =>
                    e.target.checked
                      ? [...current, row.id]
                      : current.filter((id) => id !== row.id),
                  )
                }
              />
              {row.name} · {row.unit}
            </label>
          ))}
        </fieldset>
        <FormActions onClose={onClose} />
      </form>
    </Modal>
  );
}

function EmployeeEditor({
  value,
  positions,
  generatedCode,
  documents,
  onClose,
  onSave,
}: {
  value?: Employee;
  positions: string[];
  generatedCode: string;
  documents: MasterDocument[];
  onClose: () => void;
  onSave: (employee: Employee, documents: MasterDocument[]) => void;
}) {
  const id = value?.id || newId();
  const [form, setForm] = useState<Employee>(
    value || {
      id,
      code: generatedCode,
      name: "",
      phone: "",
      position: "พนักงานขับรถ",
      branch: "BKK",
      licenseNo: "",
      licenseExpiry: "",
      active: true,
    },
  );
  const [files, setFiles] = useState(documents);
  return (
    <Modal
      title={value ? "แก้ไขพนักงาน" : "เพิ่มพนักงาน"}
      wide
      onClose={onClose}
    >
      <form
        className="ops-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(form, files);
        }}
      >
        <div className="ops-form-grid">
          <Field label="รหัสพนักงาน" required>
            <input
              required
              value={form.code}
              readOnly
              aria-describedby="employee-code-note"
            />
            <small id="employee-code-note">ระบบกำหนดให้อัตโนมัติ</small>
          </Field>
          <Field label="ชื่อพนักงาน" required>
            <input
              required
              autoFocus
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </Field>
          <Field label="ตำแหน่ง" required>
            <EditableSelect
              required
              value={form.position}
              options={positions}
              onChange={(position) => setForm({ ...form, position })}
              customLabel="เพิ่ม / แก้ไขตำแหน่ง"
            />
          </Field>
          <Field label="เบอร์โทร">
            <input
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
            />
          </Field>
          <Field label="สาขา" required>
            <BranchSelect
              value={form.branch}
              onChange={(branch) => setForm({ ...form, branch })}
              includeBkk
            />
          </Field>
          <Field label="เลขใบขับขี่">
            <input
              value={form.licenseNo}
              onChange={(e) => setForm({ ...form, licenseNo: e.target.value })}
            />
          </Field>
          <Field label="วันหมดอายุใบขับขี่">
            <input
              type="date"
              value={form.licenseExpiry}
              onChange={(e) =>
                setForm({ ...form, licenseExpiry: e.target.value })
              }
            />
          </Field>
          <ActiveStatusField
            active={form.active}
            onChange={(active) => setForm({ ...form, active })}
          />
        </div>
        <DocumentEditor
          ownerType="EMPLOYEE"
          ownerId={id}
          rows={files}
          onChange={setFiles}
        />
        <FormActions onClose={onClose} />
      </form>
    </Modal>
  );
}

function VehicleEditor({
  value,
  vehicleTypes,
  generatedCode,
  employees,
  driverId: initialDriver,
  documents,
  onClose,
  onSave,
}: {
  value?: Vehicle;
  vehicleTypes: string[];
  generatedCode: string;
  employees: Employee[];
  driverId: string;
  documents: MasterDocument[];
  onClose: () => void;
  onSave: (
    vehicle: Vehicle,
    driverId: string,
    documents: MasterDocument[],
  ) => void;
}) {
  const id = value?.id || newId();
  const [form, setForm] = useState<Vehicle>(
    value || {
      id,
      internalNo: generatedCode,
      plateNo: "",
      vehicleType: "รถบรรทุก 6 ล้อ",
      branch: "BKK",
      ownership: "OWNED",
      note: "",
      active: true,
    },
  );
  const [driverId, setDriverId] = useState(initialDriver);
  const [files, setFiles] = useState(documents);
  return (
    <Modal
      title={value ? "แก้ไขทะเบียนรถ" : "เพิ่มทะเบียนรถ"}
      wide
      onClose={onClose}
    >
      <form
        className="ops-form"
        onSubmit={(event) => {
          event.preventDefault();
          onSave(form, driverId, files);
        }}
      >
        <div className="ops-form-grid">
          <Field label="ทะเบียนรถ" required>
            <input
              required
              autoFocus
              value={form.plateNo}
              onChange={(e) => setForm({ ...form, plateNo: e.target.value })}
            />
          </Field>
          <Field label="รหัสรถ" required>
            <input
              required
              value={form.internalNo}
              readOnly
              aria-describedby="vehicle-code-note"
            />
            <small id="vehicle-code-note">ระบบกำหนดให้อัตโนมัติ</small>
          </Field>
          <Field label="ประเภทรถ" required>
            <EditableSelect
              required
              value={form.vehicleType}
              options={vehicleTypes}
              onChange={(vehicleType) => setForm({ ...form, vehicleType })}
              customLabel="เพิ่ม / แก้ไขประเภทรถ"
            />
          </Field>
          <Field label="สาขา" required>
            <BranchSelect
              value={form.branch}
              onChange={(branch) => setForm({ ...form, branch })}
              includeBkk
            />
          </Field>
          <Field label="กรรมสิทธิ์">
            <select
              value={form.ownership}
              onChange={(e) =>
                setForm({
                  ...form,
                  ownership: e.target.value as Vehicle["ownership"],
                })
              }
            >
              {Object.entries(OWNERSHIP_LABELS).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="คนขับปัจจุบัน">
            <select
              value={driverId}
              onChange={(e) => setDriverId(e.target.value)}
            >
              <option value="">ยังไม่ผูกคนขับ</option>
              {employees
                .filter((row) => row.active && row.position === "พนักงานขับรถ")
                .map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name} · {row.position}
                  </option>
                ))}
            </select>
          </Field>
          <ActiveStatusField
            active={form.active}
            onChange={(active) => setForm({ ...form, active })}
          />
          <Field label="หมายเหตุ" className="full-row">
            <textarea
              rows={3}
              placeholder="ข้อมูลเพิ่มเติมเกี่ยวกับรถคันนี้"
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </Field>
        </div>
        <p className="ops-inline-note">
          เมื่อเลือกทะเบียนรถในงานขึ้นรถ ระบบจะเติมชื่อคนขับปัจจุบันให้อัตโนมัติ
          แต่แก้เฉพาะเที่ยวได้
        </p>
        <DocumentEditor
          ownerType="VEHICLE"
          ownerId={id}
          rows={files}
          onChange={setFiles}
        />
        <FormActions onClose={onClose} />
      </form>
    </Modal>
  );
}

function DocumentEditor({
  ownerType,
  ownerId,
  rows,
  onChange,
}: {
  ownerType: "EMPLOYEE" | "VEHICLE";
  ownerId: string;
  rows: MasterDocument[];
  onChange: (rows: MasterDocument[]) => void;
}) {
  const defaultKind: DocumentKind =
    ownerType === "EMPLOYEE" ? "ID_CARD" : "VEHICLE_REGISTRATION";
  const allowedKinds = Object.entries(DOCUMENT_LABELS).filter(([id]) =>
    ownerType === "EMPLOYEE"
      ? id === "ID_CARD" || id === "DRIVER_LICENSE" || id === "OTHER"
      : id === "VEHICLE_REGISTRATION" || id === "INSURANCE" || id === "OTHER",
  ) as [DocumentKind, string][];
  const [drafts, setDrafts] = useState<
    { id: string; kind: DocumentKind; expiresOn: string }[]
  >([{ id: newId(), kind: defaultKind, expiresOn: "" }]);

  function addFiles(
    draft: { id: string; kind: DocumentKind; expiresOn: string },
    list: FileList | null,
  ) {
    if (!list) return;
    const uploaded = [...list].map((file): MasterDocument => ({
      id: newId(),
      ownerType,
      ownerId,
      kind: draft.kind,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      byteSize: file.size,
      objectKey: `master/${ownerType.toLowerCase()}/${ownerId}/${newId()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`,
      expiresOn: draft.expiresOn,
      uploadedAt: new Date().toISOString(),
      previewUrl: file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : undefined,
    }));
    onChange([...rows, ...uploaded]);
    setDrafts((current) => current.filter((row) => row.id !== draft.id));
  }
  return (
    <fieldset className="ops-documents">
      <legend>
        {ownerType === "EMPLOYEE"
          ? "เอกสารบัตรประชาชนและเอกสารพนักงาน"
          : "เอกสารและรูปรถ"}
      </legend>
      <div className="ops-document-heading">
        <span>{rows.length} ไฟล์ที่เลือกแล้ว</span>
        <Button
          type="button"
          onClick={() =>
            setDrafts((current) => [
              ...current,
              { id: newId(), kind: defaultKind, expiresOn: "" },
            ])
          }
        >
          <Plus size={15} />
          เพิ่มเอกสาร
        </Button>
      </div>

      <div className="ops-document-entries">
        {rows.map((row) => (
          <div className="ops-document-entry saved" key={row.id}>
            {row.previewUrl ? (
              <img src={row.previewUrl} alt="" />
            ) : (
              <FileImage size={23} />
            )}
            <Field label="ประเภทเอกสาร">
              <select
                value={row.kind}
                onChange={(event) =>
                  onChange(
                    rows.map((item) =>
                      item.id === row.id
                        ? {
                            ...item,
                            kind: event.target.value as DocumentKind,
                          }
                        : item,
                    ),
                  )
                }
              >
                {allowedKinds.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="ไฟล์">
              <span className="ops-file-name">
                <strong>{row.filename}</strong>
                <small>{(row.byteSize / 1024).toFixed(0)} KB</small>
              </span>
            </Field>
            <Field label="วันหมดอายุ (ถ้ามี)">
              <input
                type="date"
                value={row.expiresOn}
                onChange={(event) =>
                  onChange(
                    rows.map((item) =>
                      item.id === row.id
                        ? { ...item, expiresOn: event.target.value }
                        : item,
                    ),
                  )
                }
              />
            </Field>
            <IconButton
              label="ลบไฟล์"
              onClick={() =>
                onChange(rows.filter((item) => item.id !== row.id))
              }
            >
              <Trash2 size={15} />
            </IconButton>
          </div>
        ))}
        {drafts.map((draft) => (
          <div className="ops-document-entry" key={draft.id}>
            <FileImage size={23} />
            <Field label="ประเภทเอกสาร">
              <select
                value={draft.kind}
                onChange={(event) =>
                  setDrafts((current) =>
                    current.map((row) =>
                      row.id === draft.id
                        ? {
                            ...row,
                            kind: event.target.value as DocumentKind,
                          }
                        : row,
                    ),
                  )
                }
              >
                {allowedKinds.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="เลือกไฟล์">
              <label className="button ops-upload">
                <FileImage size={15} />
                เลือกรูปหรือ PDF
                <input
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(event) => {
                    addFiles(draft, event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>
            </Field>
            <Field label="วันหมดอายุ (ถ้ามี)">
              <input
                type="date"
                value={draft.expiresOn}
                onChange={(event) =>
                  setDrafts((current) =>
                    current.map((row) =>
                      row.id === draft.id
                        ? { ...row, expiresOn: event.target.value }
                        : row,
                    ),
                  )
                }
              />
            </Field>
            <IconButton
              label="ลบช่องเอกสาร"
              onClick={() =>
                setDrafts((current) =>
                  current.filter((row) => row.id !== draft.id),
                )
              }
            >
              <Trash2 size={15} />
            </IconButton>
          </div>
        ))}
      </div>
      <p>โหมดทดลองเก็บเฉพาะข้อมูลไฟล์ ส่วนระบบจริงจะเก็บไฟล์ใน R2 แบบส่วนตัว</p>
    </fieldset>
  );
}

function BranchSelect({
  value,
  onChange,
  includeBkk = false,
}: {
  value: string;
  onChange: (value: string) => void;
  includeBkk?: boolean;
}) {
  return (
    <select required value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">เลือกสาขา</option>
      {includeBkk && <option value="BKK">กรุงเทพฯ</option>}
      {BRANCH_OPTIONS.map((branch) => (
        <option key={branch.code} value={branch.code}>
          {branch.name}
        </option>
      ))}
    </select>
  );
}

function ActiveStatusField({
  active,
  onChange,
}: {
  active: boolean;
  onChange: (active: boolean) => void;
}) {
  return (
    <Field label="สถานะ">
      <label className={`ops-active-toggle${active ? " active" : ""}`}>
        <input
          type="checkbox"
          checked={active}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span>{active ? "ใช้งาน" : "หยุดใช้งาน"}</span>
      </label>
    </Field>
  );
}

function FormActions({ onClose }: { onClose: () => void }) {
  return (
    <div className="ops-form-actions">
      <Button type="button" onClick={onClose}>
        ยกเลิก
      </Button>
      <Button type="submit" className="primary">
        บันทึก
      </Button>
    </div>
  );
}
