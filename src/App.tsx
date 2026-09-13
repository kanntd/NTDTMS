import { useCallback, useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  Truck,
  FilePlus2,
  ListOrdered,
  UsersRound,
  Wallet,
  Settings as SettingsIcon,
  Search,
  ChevronDown,
  LogOut,
  CheckCircle2,
  X,
  CircleAlert,
  MapPin,
  Menu,
  ShieldCheck,
  Database,
  Tags,
  LayoutDashboard,
  PackageCheck,
} from "lucide-react";
import { supabase, getProfile } from "./api";
import { createService } from "./service";
import { WorkspaceContext } from "./context";
import {
  ROLE_LABELS,
  ROLE_MODULE_DEFAULTS,
  type ModuleKey,
  type Profile,
  type Product,
  type PriceRule,
  type Zone,
} from "./types";
import { thaiDate } from "./domain";
import { Button, Field, IconButton, Loading, Modal } from "./ui";
import Auth from "./Auth";
import Intake from "./Intake";
import IntakePrototype from "./IntakePrototype";
import Shipments from "./Shipments";
import Customers from "./Customers";
import Settings from "./Settings";
import MasterData from "./MasterData";
import Pricing from "./Pricing";
import BangkokDashboard from "./BangkokDashboard";
import LoadingWork from "./LoadingWork";

const demoProfile: Profile = {
  id: "demo",
  display_name: "ผู้ดูแล NTD",
  email: "ntdlogistics@gmail.com",
  role: "owner",
  company_id: "demo",
  branch_id: "demo",
  is_active: true,
  module_permissions: ROLE_MODULE_DEFAULTS.owner,
};
export default function App() {
  const [demo, setDemo] = useState(
      () => new URLSearchParams(location.search).get("demo") === "1",
    ),
    [session, setSession] = useState<Session | null>(null),
    [ready, setReady] = useState(false),
    [profile, setProfile] = useState<Profile | null>(null),
    [authError, setAuthError] = useState(""),
    [recovery, setRecovery] = useState(false),
    [password, setPassword] = useState(""),
    [resetBusy, setResetBusy] = useState(false);
  const [page, setPage] = useState("intake"),
    [globalSearch, setGlobalSearch] = useState(""),
    [query, setQuery] = useState(""),
    [loadBranch, setLoadBranch] = useState(""),
    [revision, setRevision] = useState(0),
    [masters, setMasters] = useState<{
      zones: Zone[];
      products: Product[];
      rules: PriceRule[];
    }>({ zones: [], products: [], rules: [] }),
    [masterError, setMasterError] = useState(""),
    [notice, setNotice] = useState<{ message: string; error: boolean } | null>(
      null,
    ),
    [menu, setMenu] = useState(false),
    [online, setOnline] = useState(navigator.onLine);
  const service = useMemo(() => createService(demo), [demo]);
  const toast = useCallback(
      (message: string, error = false) => setNotice({ message, error }),
      [],
    ),
    refresh = useCallback(() => setRevision((r) => r + 1), []);
  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      setSession(data.session);
      if (error) setAuthError(error.message);
      setReady(true);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setReady(true);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
    });
    return () => subscription.unsubscribe();
  }, []);
  useEffect(() => {
    if (demo) {
      setProfile(demoProfile);
      return;
    }
    if (!session) {
      setProfile(null);
      return;
    }
    let active = true;
    setAuthError("");
    getProfile(session.user.id)
      .then((p) => {
        if (active) {
          setProfile(p);
          if (!p || !p.is_active)
            setAuthError(
              "บัญชีนี้ยังไม่ได้รับสิทธิ์ใช้งาน กรุณาให้ผู้ดูแลเพิ่มอีเมลในรายชื่อพนักงาน",
            );
        }
      })
      .catch((e) => {
        if (active) setAuthError(e.message);
      });
    return () => {
      active = false;
    };
  }, [demo, session?.user.id, revision]);
  useEffect(() => {
    if (!profile?.is_active) return;
    let active = true;
    service
      .masters()
      .then((m) => {
        if (active) {
          setMasters(m);
          setMasterError("");
        }
      })
      .catch((e) => {
        if (active) setMasterError(e.message);
      });
    return () => {
      active = false;
    };
  }, [service, profile?.id, revision]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6500);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    if (
      profile &&
      !["owner", "admin", "clerk"].includes(profile.role) &&
      page === "intake"
    )
      setPage("shipments");
  }, [profile, page]);
  function enterDemo() {
    history.replaceState(null, "", "/?demo=1");
    setDemo(true);
    setAuthError("");
    setPage("intake");
  }
  async function logout() {
    if (demo) {
      setDemo(false);
      history.replaceState(null, "", "/");
    } else {
      const r = await supabase.auth.signOut();
      if (r.error) {
        toast(r.error.message, true);
        return;
      }
    }
    setProfile(null);
    setMasters({ zones: [], products: [], rules: [] });
    setAuthError("");
  }
  if (!ready && !demo) return <Loading />;
  if (!demo && !session) return <Auth onDemo={enterDemo} />;
  if (!profile?.is_active) {
    return (
      <div className="access-page">
        <Truck size={36} />
        <h1>NTD TMS</h1>
        {authError ? (
          <>
            <p>{authError}</p>
            <Button onClick={refresh}>ตรวจสิทธิ์อีกครั้ง</Button>
            <Button onClick={() => void logout()}>ออกจากระบบ</Button>
            <Button onClick={enterDemo}>เปิดโหมดทดลอง</Button>
          </>
        ) : (
          <Loading />
        )}
      </div>
    );
  }
  const manager = ["owner", "admin"].includes(profile.role);
  const canOpen = (module: ModuleKey) =>
    profile.role === "owner" ||
    (profile.module_permissions?.[module] ??
      ROLE_MODULE_DEFAULTS[profile.role][module] ??
      false);
  const nav = [
    ...(canOpen("intake")
      ? [
          {
            id: "dashboard",
            label: "ภาพรวมกรุงเทพฯ",
            Icon: LayoutDashboard,
          },
        ]
      : []),
    ...(canOpen("intake")
      ? [{ id: "intake", label: "รับสินค้าและออกบิล", Icon: FilePlus2 }]
      : []),
    ...(canOpen("shipments")
      ? [{ id: "loading", label: "งานขึ้นรถ", Icon: PackageCheck }]
      : []),
    ...(canOpen("shipments")
      ? [{ id: "shipments", label: "รายการขนส่ง", Icon: ListOrdered }]
      : []),
    ...(canOpen("master_data")
      ? [
          {
            id: "customers",
            label: demo ? "ข้อมูลหลัก" : "ลูกค้าและคู่ค้า",
            Icon: demo ? Database : UsersRound,
          },
        ]
      : []),
    ...(canOpen("pricing") && demo
      ? [{ id: "pricing", label: "ราคาและคำขอราคา", Icon: Tags }]
      : []),
    ...(canOpen("finance")
      ? [{ id: "finance", label: "รับชำระและยอดค้าง", Icon: Wallet }]
      : []),
    ...(manager && canOpen("settings")
      ? [{ id: "settings", label: "ตั้งค่าบริษัท", Icon: SettingsIcon }]
      : []),
  ];
  return (
    <WorkspaceContext.Provider
      value={{ demo, profile, service, ...masters, revision, refresh, toast }}
    >
      <div className={"app-shell " + (menu ? "menu-open" : "")}>
        <aside className="sidebar">
          <a className="brand" href={demo ? "/?demo=1" : "/"}>
            <span className="brand-icon">
              <Truck size={24} />
            </span>
            <div>
              <strong>
                NTD<span>TMS</span>
              </strong>
              <small>TRANSPORT MANAGEMENT</small>
            </div>
          </a>
          <div className="branch-select">
            <span className="branch-icon">
              <MapPin size={17} />
            </span>
            <div>
              <strong>สำนักงานใหญ่</strong>
              <small>กรุงเทพมหานคร</small>
            </div>
            <ChevronDown size={14} />
          </div>
          <p className="nav-label">WORKSPACE</p>
          <nav>
            {nav.map(({ id, label, Icon }) => (
              <button
                key={id}
                className={page === id ? "active" : ""}
                onClick={() => {
                  setPage(id);
                  if (id === "shipments") setQuery("");
                  if (id === "loading") setLoadBranch("");
                  setMenu(false);
                }}
              >
                <Icon size={18} />
                <span>{label}</span>
                {page === id && <i />}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-service">
              <span className="status-dot" />
              {demo
                ? "DEMO WORKSPACE"
                : online
                  ? "เชื่อมต่อระบบแล้ว"
                  : "ไม่ได้เชื่อมต่ออินเทอร์เน็ต"}
            </div>
            <div className="user-profile">
              <span className="avatar">NT</span>
              <div>
                <strong>{profile.display_name}</strong>
                <small>{ROLE_LABELS[profile.role]}</small>
              </div>
              <IconButton
                label={demo ? "เข้าสู่ระบบจริง" : "ออกจากระบบ"}
                onClick={() => void logout()}
              >
                <LogOut size={17} />
              </IconButton>
            </div>
          </div>
        </aside>
        <div className="workspace">
          <header className="topbar">
            <div>
              <IconButton
                label="เปิดเมนู"
                className="mobile-menu"
                onClick={() => setMenu(!menu)}
              >
                <Menu size={20} />
              </IconButton>
              <span className="topbar-section">ศูนย์จัดการขนส่ง</span>
              <span className="topbar-separator">/</span>
              <span>{nav.find((n) => n.id === page)?.label}</span>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setPage("shipments");
                setQuery(globalSearch);
              }}
              className="global-search"
            >
              <Search size={16} />
              <input
                aria-label="ค้นหาทั้งระบบ"
                placeholder="ค้นหาเลขบิล หรือชื่อลูกค้า"
                value={globalSearch}
                onChange={(e) => setGlobalSearch(e.target.value)}
              />
            </form>
            <time>{thaiDate(new Date(), true)}</time>
          </header>
          {demo && (
            <div className="demo-bar">
              <span>
                <FlaskIcon />
                โหมดทดลอง <b>ข้อมูลในเครื่องนี้แยกจากงานจริง</b>
              </span>
              <button onClick={() => void logout()}>
                เข้าสู่ระบบบริษัท <span>→</span>
              </button>
            </div>
          )}
          {!online && (
            <div className="alert error">
              <CircleAlert size={16} />
              ขาดการเชื่อมต่ออินเทอร์เน็ต ร่างยังอยู่ในแท็บนี้
            </div>
          )}
          <main className="main-content">
            {masterError ? (
              <div className="alert error">
                {masterError}
                <Button onClick={refresh}>ลองเชื่อมต่ออีกครั้ง</Button>
              </div>
            ) : masters.zones.length === 0 ? (
              <Loading />
            ) : page === "dashboard" ? (
              <BangkokDashboard
                onOpenBranch={(branchCode) => {
                  setLoadBranch(branchCode);
                  setPage("loading");
                }}
              />
            ) : page === "intake" ? (
              demo ? (
                <IntakePrototype />
              ) : (
                <Intake />
              )
            ) : page === "loading" ? (
              <LoadingWork initialBranch={loadBranch} />
            ) : page === "shipments" ? (
              <Shipments initialSearch={query} />
            ) : page === "customers" ? (
              demo ? (
                <MasterData />
              ) : (
                <Customers />
              )
            ) : page === "pricing" && demo ? (
              <Pricing />
            ) : page === "finance" ? (
              <Shipments key="finance" finance />
            ) : manager ? (
              <Settings />
            ) : null}
          </main>
          <footer className="workspace-footer">
            <span>NTD Logistics</span>
            <span>NTD TMS · v0.1</span>
          </footer>
        </div>
      </div>
      {notice && (
        <div
          className={"toast " + (notice.error ? "error" : "")}
          role={notice.error ? "alert" : "status"}
        >
          {notice.error ? (
            <CircleAlert size={19} />
          ) : (
            <CheckCircle2 size={19} />
          )}
          <span>{notice.message}</span>
          <IconButton label="ปิดข้อความ" onClick={() => setNotice(null)}>
            <X size={16} />
          </IconButton>
        </div>
      )}
      {recovery && (
        <Modal title="ตั้งรหัสผ่านใหม่" onClose={() => setRecovery(false)}>
          <form
            className="modal-form"
            onSubmit={async (e) => {
              e.preventDefault();
              setResetBusy(true);
              const r = await supabase.auth.updateUser({ password });
              setResetBusy(false);
              if (r.error) toast(r.error.message, true);
              else {
                setRecovery(false);
                setPassword("");
                toast("เปลี่ยนรหัสผ่านแล้ว");
                history.replaceState(null, "", "/");
              }
            }}
          >
            <Field label="รหัสผ่านใหม่ (อย่างน้อย 12 ตัวอักษร)">
              <input
                required
                type="password"
                minLength={12}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Button type="submit" className="primary" busy={resetBusy}>
              บันทึกรหัสผ่าน
            </Button>
          </form>
        </Modal>
      )}
    </WorkspaceContext.Provider>
  );
}
function FlaskIcon() {
  return <ShieldCheck size={15} />;
}
