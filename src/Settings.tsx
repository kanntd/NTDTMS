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
} from "lucide-react";
import { useWorkspace } from "./context";
import { Button, Empty, Field, IconButton, Modal } from "./ui";
import { money, thaiDate } from "./domain";
import { ROLE_LABELS, type StaffInvite, type Zone, type Role } from "./types";

export default function Settings() {
  const w = useWorkspace(),
    [tab, setTab] = useState("zones"),
    [zone, setZone] = useState<Zone | null>(null),
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
            <span className="muted">{w.zones.length} จังหวัด</span>
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
              <IconButton
                label={"แก้ไขพื้นที่ " + z.name}
                onClick={() => setZone(structuredClone(z))}
              >
                <Pencil size={17} />
              </IconButton>
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
                  <td>{ROLE_LABELS[p.role]}</td>
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
          title="แก้ไขพื้นที่ให้บริการ"
          onClose={busy ? () => {} : () => setZone(null)}
        >
          <form
            className="modal-form"
            onSubmit={(e) =>
              save(e, async () => {
                await w.service.setting("zone", {
                  id: zone.id,
                  name: zone.name,
                  color: zone.color,
                });
                for (const d of zone.districts)
                  await w.service.setting("district", {
                    id: d.id,
                    name: d.name,
                  });
              })
            }
          >
            <div className="two-fields">
              <Field label="จังหวัด">
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
            {zone.districts.map((d, n) => (
              <Field key={d.id} label={"อำเภอ " + (n + 1)}>
                <input
                  required
                  value={d.name}
                  onChange={(e) =>
                    setZone({
                      ...zone,
                      districts: zone.districts.map((x) =>
                        x.id === d.id ? { ...x, name: e.target.value } : x,
                      ),
                    })
                  }
                />
              </Field>
            ))}
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
                  setPerson({ ...person, role: e.target.value as Role })
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
