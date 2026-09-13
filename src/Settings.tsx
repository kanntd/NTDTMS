import { useEffect, useState, type FormEvent } from "react";
import {
  MapPin,
  UsersRound,
  SlidersHorizontal,
  Database,
  Pencil,
  Plus,
  ShieldCheck,
  HardDrive,
  ExternalLink,
  Trash2,
} from "lucide-react";
import { useWorkspace } from "./context";
import { Button, Empty, Field, IconButton, Modal } from "./ui";
import { money, thaiDate } from "./domain";
import {
  MODULE_LABELS,
  ROLE_LABELS,
  ROLE_MODULE_DEFAULTS,
  type ModuleKey,
  type StaffInvite,
  type Zone,
  type Role,
} from "./types";

export default function Settings() {
  const w = useWorkspace(),
    [tab, setTab] = useState("zones"),
    [zone, setZone] = useState<Zone | null>(null),
    [creatingZone, setCreatingZone] = useState(false),
    [staff, setStaff] = useState<StaffInvite[]>([]),
    [person, setPerson] = useState<StaffInvite | null>(null),
    [price, setPrice] = useState<{
      product_id: string;
      zone_id: string;
      unit_price: number;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [health, setHealth] = useState<{
      bytes: number;
      tables: number;
      checked_at: string;
    } | null>(null),
    [r2Ready, setR2Ready] = useState(false);
  useEffect(() => {
    let active = true;
    Promise.all([
      w.service.staff(),
      w.service.health(),
      w.service.systemStatus(),
    ])
      .then(([s, h, status]) => {
        if (active) {
          setStaff(s);
          setHealth(h);
          setR2Ready(status.r2Configured);
        }
      })
      .catch((e) => w.toast(e.message, true));
    return () => {
      active = false;
    };
  }, [w.service, w.revision]);
  async function save(e: FormEvent, fn: () => Promise<unknown>) {
    e.preventDefault();
    setBusy(true);
    try {
      await fn();
      setZone(null);
      setCreatingZone(false);
      setPerson(null);
      setPrice(null);
      w.refresh();
      w.toast("บันทึกการตั้งค่าแล้ว");
    } catch (e) {
      w.toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  function openNewZone() {
    const sortOrder = Math.max(0, ...w.zones.map((row) => row.sort_order)) + 1;
    setCreatingZone(true);
    setZone({
      id: crypto.randomUUID(),
      name: "",
      code: `AREA-${String(sortOrder).padStart(3, "0")}`,
      color: "#00cc99",
      sort_order: sortOrder,
      districts: [],
    });
  }
  async function deleteZone(target: Zone) {
    if (
      !window.confirm(
        `หยุดใช้พื้นที่ ${target.name} ใช่หรือไม่? บิลเก่าจะยังเก็บข้อมูลพื้นที่นี้ไว้`,
      )
    )
      return;
    setBusy(true);
    try {
      await w.service.setting("zone_delete", { id: target.id });
      w.refresh();
      w.toast(`หยุดใช้พื้นที่ ${target.name} แล้ว`);
    } catch (error) {
      w.toast((error as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  const latest = w.rules.filter(
    (r, i, rs) =>
      rs.findIndex(
        (x) => x.product_id === r.product_id && x.zone_id === r.zone_id,
      ) === i,
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="breadcrumb">
            จัดการระบบ <span>/</span> ตั้งค่า
          </div>
          <h1>
            ตั้งค่าบริษัท
            <span className="heading-dot" />
          </h1>
          <p>NTD Logistics · สำนักงานใหญ่ กรุงเทพฯ</p>
        </div>
        <span className="badge status-DELIVERED">
          <ShieldCheck size={14} />
          ผู้ดูแลระบบ
        </span>
      </div>
      <div className="settings-tabs">
        {[
          { id: "zones", label: "พื้นที่ให้บริการ", Icon: MapPin },
          { id: "prices", label: "ตารางราคา", Icon: SlidersHorizontal },
          { id: "staff", label: "พนักงานและสิทธิ์", Icon: UsersRound },
          { id: "system", label: "ข้อมูลระบบ", Icon: Database },
        ].map(({ id, label, Icon }) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            <Icon size={17} />
            {label}
          </button>
        ))}
      </div>
      {tab === "zones" && (
        <section className="settings-section">
          <div className="section-heading">
            <h2>จังหวัดและอำเภอปลายทาง</h2>
            <div className="section-heading-actions">
              <span className="muted">{w.zones.length} จังหวัด</span>
              <Button className="primary" onClick={openNewZone}>
                <Plus size={16} />
                เพิ่มพื้นที่ให้บริการ
              </Button>
            </div>
          </div>
          {w.zones.map((z) => (
            <div className="zone-setting" key={z.id}>
              <span
                className="zone-setting-swatch"
                style={{ background: z.color }}
              />
              <div>
                <h3>
                  {z.name}
                  <small>{z.code}</small>
                </h3>
                <div className="zone-districts">
                  {z.districts.map((d) => (
                    <span key={d.id}>{d.name}</span>
                  ))}
                </div>
              </div>
              <div className="zone-setting-actions">
                <IconButton
                  label={"แก้ไขพื้นที่ " + z.name}
                  onClick={() => {
                    setCreatingZone(false);
                    setZone(structuredClone(z));
                  }}
                >
                  <Pencil size={17} />
                </IconButton>
                <IconButton
                  label={"ลบพื้นที่ " + z.name}
                  className="danger"
                  disabled={busy}
                  onClick={() => void deleteZone(z)}
                >
                  <Trash2 size={17} />
                </IconButton>
              </div>
            </div>
          ))}
        </section>
      )}
      {tab === "prices" && (
        <section className="settings-section">
          <div className="section-heading">
            <h2>ราคาขนส่งที่อนุมัติ</h2>
            <Button
              className="primary"
              onClick={() =>
                setPrice({
                  product_id: w.products[0]?.id || "",
                  zone_id: "",
                  unit_price: 0,
                })
              }
            >
              <Plus size={16} />
              เพิ่มราคา
            </Button>
          </div>
          {latest.length === 0 ? (
            <Empty title="ยังไม่มีตารางราคาที่อนุมัติ" />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>สินค้า</th>
                  <th>จังหวัด</th>
                  <th>หน่วย</th>
                  <th className="numeric">ราคา</th>
                  <th>เวอร์ชัน</th>
                  <th>วันที่</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {latest.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {w.products.find((p) => p.id === r.product_id)?.name}
                    </td>
                    <td>
                      {w.zones.find((z) => z.id === r.zone_id)?.name ||
                        "ทุกจังหวัด"}
                    </td>
                    <td>
                      {w.products.find((p) => p.id === r.product_id)?.unit}
                    </td>
                    <td className="numeric">{money(r.unit_price)}</td>
                    <td>v{r.version_no}</td>
                    <td>{thaiDate(r.created_at)}</td>
                    <td>
                      <IconButton
                        label="ปรับราคา"
                        onClick={() =>
                          setPrice({
                            product_id: r.product_id,
                            zone_id: r.zone_id || "",
                            unit_price: r.unit_price,
                          })
                        }
                      >
                        <Pencil size={16} />
                      </IconButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
      {tab === "staff" && (
        <section className="settings-section">
          <div className="section-heading">
            <h2>
              พนักงานที่ได้รับสิทธิ์
              <span className="count-badge">{staff.length}</span>
            </h2>
            <Button
              className="primary"
              onClick={() =>
                setPerson({
                  email: "",
                  display_name: "",
                  role: "clerk",
                  is_active: true,
                  module_permissions: { ...ROLE_MODULE_DEFAULTS.clerk },
                })
              }
            >
              <Plus size={16} />
              เพิ่มสิทธิ์พนักงาน
            </Button>
          </div>
          <table className="data-table">
            <thead>
              <tr>
                <th>พนักงาน</th>
                <th>อีเมล</th>
                <th>สิทธิ์</th>
                <th>สถานะ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {staff.map((p) => (
                <tr key={p.email}>
                  <td>
                    <strong>{p.display_name}</strong>
                  </td>
                  <td>{p.email}</td>
                  <td>
                    {ROLE_LABELS[p.role]}
                    <small className="permission-summary">
                      {
                        Object.values(
                          p.module_permissions || ROLE_MODULE_DEFAULTS[p.role],
                        ).filter(Boolean).length
                      }{" "}
                      โมดูล
                    </small>
                  </td>
                  <td>
                    <span
                      className={
                        "badge " +
                        (p.is_active ? "status-DELIVERED" : "status-CANCELLED")
                      }
                    >
                      {p.is_active ? "เปิดสิทธิ์" : "ระงับสิทธิ์"}
                    </span>
                  </td>
                  <td>
                    {p.role !== "owner" && (
                      <IconButton
                        label={"แก้ไขสิทธิ์ " + p.display_name}
                        onClick={() => setPerson({ ...p })}
                      >
                        <Pencil size={16} />
                      </IconButton>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
      {tab === "system" && (
        <section className="settings-section">
          <h2>พื้นที่และการเชื่อมต่อ</h2>
          <div className="system-row">
            <Database size={25} />
            <div>
              <h3>ฐานข้อมูล</h3>
              <span>
                {w.demo
                  ? "โหมดทดลอง"
                  : health
                    ? `${(health.bytes / 1024 / 1024).toFixed(1)} MB / 500 MB`
                    : "กำลังตรวจสอบ"}
              </span>
              {!w.demo && health && (
                <progress value={health.bytes} max={500 * 1024 * 1024} />
              )}
            </div>
            <span className="badge status-DELIVERED">Supabase</span>
          </div>
          <div className="system-row">
            <HardDrive size={25} />
            <div>
              <h3>รูปภาพสินค้า</h3>
              <span>
                {r2Ready
                  ? "R2 พร้อมเก็บรูปสินค้าแบบ private"
                  : "R2 รอเปิดบริการในบัญชี Cloudflare"}
              </span>
            </div>
            {r2Ready ? (
              <span className="badge status-DELIVERED">พร้อมใช้</span>
            ) : (
              <a
                className="button"
                href="https://dash.cloudflare.com/cacd923fd541e7598cfb7e9c41c79e46/r2/overview"
                target="_blank"
                rel="noreferrer"
              >
                เปิด Cloudflare
                <ExternalLink size={15} />
              </a>
            )}
          </div>
          <div className="system-row">
            <ShieldCheck size={25} />
            <div>
              <h3>สิทธิ์เข้าถึง</h3>
              <span>5 บทบาท · จำกัดการเข้าถึงตามบริษัทและสาขา</span>
            </div>
          </div>
          <div className="system-row">
            <Database size={25} />
            <div>
              <h3>การสำรองข้อมูล</h3>
              <span>ยังไม่ได้ตั้งสำรองอัตโนมัติ · แผน Free</span>
            </div>
          </div>
        </section>
      )}
      {zone && (
        <Modal
          title={
            creatingZone ? "เพิ่มพื้นที่ให้บริการ" : "แก้ไขพื้นที่ให้บริการ"
          }
          onClose={
            busy
              ? () => {}
              : () => {
                  setZone(null);
                  setCreatingZone(false);
                }
          }
        >
          <form
            className="modal-form"
            onSubmit={(e) =>
              save(e, () =>
                w.service.setting("zone_save", {
                  id: zone.id,
                  name: zone.name.trim(),
                  code: zone.code,
                  color: zone.color,
                  sort_order: zone.sort_order,
                  is_new: creatingZone,
                  districts: zone.districts
                    .filter((district) => district.name.trim())
                    .map((district) => ({
                      id: district.id,
                      name: district.name.trim(),
                    })),
                }),
              )
            }
          >
            <div className="two-fields">
              <Field label="รหัสพื้นที่">
                <input value={zone.code} readOnly />
              </Field>
              <Field label="จังหวัด" required>
                <input
                  required
                  value={zone.name}
                  onChange={(e) => setZone({ ...zone, name: e.target.value })}
                />
              </Field>
              <Field label="สีประจำจังหวัด">
                <input
                  type="color"
                  value={zone.color}
                  onChange={(e) => setZone({ ...zone, color: e.target.value })}
                />
              </Field>
            </div>
            <div className="district-editor-heading">
              <div>
                <strong>อำเภอที่ให้บริการ</strong>
                <small>ไม่บังคับ สามารถเว้นว่างและเพิ่มภายหลังได้</small>
              </div>
              <Button
                type="button"
                onClick={() =>
                  setZone({
                    ...zone,
                    districts: [
                      ...zone.districts,
                      {
                        id: crypto.randomUUID(),
                        zone_id: zone.id,
                        name: "",
                      },
                    ],
                  })
                }
              >
                <Plus size={15} />
                เพิ่มอำเภอ
              </Button>
            </div>
            <div className="district-editor-list">
              {zone.districts.map((district, index) => (
                <div key={district.id}>
                  <Field label={`อำเภอ ${index + 1}`}>
                    <input
                      autoFocus={index === zone.districts.length - 1}
                      value={district.name}
                      onChange={(event) =>
                        setZone({
                          ...zone,
                          districts: zone.districts.map((row) =>
                            row.id === district.id
                              ? { ...row, name: event.target.value }
                              : row,
                          ),
                        })
                      }
                    />
                  </Field>
                  <IconButton
                    label={`ลบอำเภอ ${district.name || index + 1}`}
                    className="danger"
                    onClick={() =>
                      setZone({
                        ...zone,
                        districts: zone.districts.filter(
                          (row) => row.id !== district.id,
                        ),
                      })
                    }
                  >
                    <Trash2 size={16} />
                  </IconButton>
                </div>
              ))}
              {zone.districts.length === 0 && (
                <p>ยังไม่ได้ระบุอำเภอ พื้นที่นี้ยังบันทึกได้</p>
              )}
            </div>
            <div className="modal-footer">
              <Button className="primary" type="submit" busy={busy}>
                บันทึกพื้นที่
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {person && (
        <Modal
          title="สิทธิ์พนักงาน"
          onClose={busy ? () => {} : () => setPerson(null)}
        >
          <form
            className="modal-form"
            onSubmit={(e) =>
              save(e, () => w.service.setting("invite", { ...person }))
            }
          >
            <Field label="ชื่อพนักงาน" required>
              <input
                required
                value={person.display_name}
                onChange={(e) =>
                  setPerson({ ...person, display_name: e.target.value })
                }
              />
            </Field>
            <Field label="อีเมลที่ใช้เข้าสู่ระบบ" required>
              <input
                required
                type="email"
                value={person.email}
                onChange={(e) =>
                  setPerson({ ...person, email: e.target.value })
                }
              />
            </Field>
            <Field label="บทบาท">
              <select
                value={person.role}
                onChange={(e) =>
                  setPerson({
                    ...person,
                    role: e.target.value as Role,
                    module_permissions: {
                      ...ROLE_MODULE_DEFAULTS[e.target.value as Role],
                    },
                  })
                }
              >
                {Object.entries(ROLE_LABELS)
                  .filter(([k]) => k !== "owner")
                  .map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
              </select>
            </Field>
            <fieldset className="permission-grid">
              <legend>โมดูลที่เข้าใช้งานได้</legend>
              {(Object.entries(MODULE_LABELS) as [ModuleKey, string][]).map(
                ([id, label]) => (
                  <label key={id}>
                    <input
                      type="checkbox"
                      checked={
                        person.module_permissions?.[id] ??
                        ROLE_MODULE_DEFAULTS[person.role][id] ??
                        false
                      }
                      onChange={(event) =>
                        setPerson({
                          ...person,
                          module_permissions: {
                            ...ROLE_MODULE_DEFAULTS[person.role],
                            ...person.module_permissions,
                            [id]: event.target.checked,
                          },
                        })
                      }
                    />
                    {label}
                  </label>
                ),
              )}
            </fieldset>
            <p className="settings-note">
              ข้อมูลพนักงานเก็บในข้อมูลหลัก
              ส่วนหน้านี้ใช้กำหนดบัญชีเข้าสู่ระบบและสิทธิ์เท่านั้น
            </p>
            <label className="checkbox-line">
              <input
                type="checkbox"
                checked={person.is_active}
                onChange={(e) =>
                  setPerson({ ...person, is_active: e.target.checked })
                }
              />
              เปิดสิทธิ์พนักงาน
            </label>
            <div className="modal-footer">
              <Button type="submit" className="primary" busy={busy}>
                บันทึกสิทธิ์
              </Button>
            </div>
          </form>
        </Modal>
      )}
      {price && (
        <Modal
          title="อนุมัติราคาขนส่ง"
          onClose={busy ? () => {} : () => setPrice(null)}
        >
          <form
            className="modal-form"
            onSubmit={(e) => save(e, () => w.service.setting("price", price))}
          >
            <Field label="สินค้า">
              <select
                value={price.product_id}
                onChange={(e) =>
                  setPrice({ ...price, product_id: e.target.value })
                }
              >
                {w.products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} / {p.unit}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="จังหวัด">
              <select
                value={price.zone_id}
                onChange={(e) =>
                  setPrice({ ...price, zone_id: e.target.value })
                }
              >
                <option value="">ทุกจังหวัด</option>
                {w.zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="ราคาต่อหน่วย (บาท)" required>
              <input
                required
                type="number"
                min="0.01"
                step="0.01"
                value={price.unit_price || ""}
                onChange={(e) =>
                  setPrice({ ...price, unit_price: Number(e.target.value) })
                }
              />
            </Field>
            <div className="modal-footer">
              <Button type="submit" busy={busy} className="primary">
                ยืนยันราคา
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
