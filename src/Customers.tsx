import { useEffect, useState, type FormEvent } from "react";
import { Search, Plus, Pencil, UserRound, Phone } from "lucide-react";
import { useWorkspace } from "./context";
import {
  Button,
  Empty,
  Field,
  IconButton,
  Loading,
  Modal,
  Pagination,
} from "./ui";
import { money } from "./domain";
import type { Party } from "./types";

export default function Customers() {
  const w = useWorkspace(),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(0),
    [rows, setRows] = useState<Party[]>([]),
    [count, setCount] = useState(0),
    [loading, setLoading] = useState(true),
    [edit, setEdit] = useState<Partial<Party> | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const manager = ["owner", "admin"].includes(w.profile.role),
    canWrite = w.profile.role !== "viewer";
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(
      () =>
        w.service
          .parties(search, page)
          .then((r) => {
            if (active) {
              setRows(r.rows);
              setCount(r.count);
              setError("");
            }
          })
          .catch((e) => {
            if (active) setError(e.message);
          })
          .finally(() => {
            if (active) setLoading(false);
          }),
      180,
    );
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [w.service, w.revision, search, page]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const data = { ...edit };
      if (!manager) {
        delete data.credit_limit;
        delete data.credit_days;
        delete data.is_active;
      }
      const id = await w.service.saveParty(data);
      if (!edit?.id && manager && Number(edit?.credit_limit) > 0)
        await w.service.saveParty({ ...data, id });
      setEdit(null);
      w.refresh();
      w.toast("บันทึกข้อมูลลูกค้าแล้ว");
    } catch (e) {
      w.toast((e as Error).message, true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="breadcrumb">
            ทะเบียนข้อมูล <span>/</span> คู่ค้า
          </div>
          <h1>
            ลูกค้าและคู่ค้า
            <span className="heading-dot" />
          </h1>
          <p>{count} ราย · ผู้ส่ง ผู้รับ และผู้ชำระเงิน</p>
        </div>
        {canWrite && (
          <Button
            className="primary"
            onClick={() =>
              setEdit({
                display_name: "",
                phone: "",
                address: "",
                tax_id: "",
                credit_limit: 0,
                credit_days: 30,
                is_active: true,
              })
            }
          >
            <Plus size={17} />
            เพิ่มลูกค้า
          </Button>
        )}
      </div>
      <section className="register-section">
        <div className="table-toolbar">
          <div className="input-icon search-field">
            <Search size={17} />
            <input
              placeholder="ค้นหาชื่อลูกค้า หรือเบอร์โทรศัพท์"
              aria-label="ค้นหาลูกค้า"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
          </div>
          <span className="muted small">ลูกค้าทั้งหมด</span>
        </div>
        {error ? (
          <div className="alert error">{error}</div>
        ) : loading ? (
          <Loading />
        ) : rows.length === 0 ? (
          <Empty title="ยังไม่มีลูกค้าตามที่ค้นหา" />
        ) : (
          <div className="data-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>ชื่อลูกค้า</th>
                  <th>เบอร์โทรศัพท์</th>
                  <th>ที่อยู่</th>
                  <th className="numeric">วงเงินเครดิต</th>
                  <th>เครดิตเทอม</th>
                  <th>สถานะ</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <div className="customer-name">
                        <span className="customer-avatar">
                          <UserRound size={18} />
                        </span>
                        <strong>{p.display_name}</strong>
                      </div>
                    </td>
                    <td>
                      <span className="phone">
                        <Phone size={13} />
                        {p.phone}
                      </span>
                    </td>
                    <td className="address-cell">{p.address}</td>
                    <td className="numeric">{money(p.credit_limit)}</td>
                    <td>{p.credit_days} วัน</td>
                    <td>
                      <span
                        className={
                          "badge " +
                          (p.is_active
                            ? "status-DELIVERED"
                            : "status-CANCELLED")
                        }
                      >
                        {p.is_active ? "ใช้งาน" : "ระงับ"}
                      </span>
                    </td>
                    <td>
                      {canWrite && (
                        <IconButton
                          label={"แก้ไข " + p.display_name}
                          onClick={() => setEdit({ ...p })}
                        >
                          <Pencil size={16} />
                        </IconButton>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination count={count} page={page} onChange={setPage} />
      </section>
      {edit && (
        <Modal
          title={edit.id ? "แก้ไขลูกค้า" : "เพิ่มลูกค้า"}
          onClose={busy ? () => {} : () => setEdit(null)}
        >
          <form onSubmit={save} className="modal-form">
            <Field label="ชื่อลูกค้า" required>
              <input
                required
                maxLength={255}
                value={edit.display_name || ""}
                onChange={(e) =>
                  setEdit({ ...edit, display_name: e.target.value })
                }
              />
            </Field>
            <div className="two-fields">
              <Field label="เบอร์โทรศัพท์" required>
                <input
                  required
                  pattern="[0-9+ ()-]{8,20}"
                  value={edit.phone || ""}
                  onChange={(e) => setEdit({ ...edit, phone: e.target.value })}
                />
              </Field>
              <Field label="เลขผู้เสียภาษี">
                <input
                  maxLength={13}
                  value={edit.tax_id || ""}
                  onChange={(e) => setEdit({ ...edit, tax_id: e.target.value })}
                />
              </Field>
            </div>
            <Field label="ที่อยู่" required>
              <textarea
                required
                maxLength={1500}
                rows={3}
                value={edit.address || ""}
                onChange={(e) => setEdit({ ...edit, address: e.target.value })}
              />
            </Field>
            {manager && (
              <>
                <div className="two-fields">
                  <Field label="วงเงินเครดิต (บาท)">
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={edit.credit_limit || 0}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          credit_limit: Number(e.target.value),
                        })
                      }
                    />
                  </Field>
                  <Field label="เครดิตเทอมสูงสุด (วัน)">
                    <input
                      type="number"
                      min="0"
                      max="365"
                      value={edit.credit_days || 0}
                      onChange={(e) =>
                        setEdit({
                          ...edit,
                          credit_days: Number(e.target.value),
                        })
                      }
                    />
                  </Field>
                </div>
                <label className="checkbox-line">
                  <input
                    type="checkbox"
                    checked={edit.is_active}
                    onChange={(e) =>
                      setEdit({ ...edit, is_active: e.target.checked })
                    }
                  />
                  เปิดใช้งานลูกค้า
                </label>
              </>
            )}
            <div className="modal-footer">
              <Button
                type="button"
                disabled={busy}
                onClick={() => setEdit(null)}
              >
                กลับ
              </Button>
              <Button type="submit" className="primary" busy={busy}>
                บันทึกลูกค้า
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
