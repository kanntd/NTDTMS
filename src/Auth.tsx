import { useState, type FormEvent } from "react";
import {
  ArrowRight,
  ArrowLeft,
  Truck,
  Mail,
  LockKeyhole,
  ShieldCheck,
  Eye,
  EyeOff,
} from "lucide-react";
import { supabase } from "./api";
import { Button, Field, IconButton } from "./ui";

export default function Auth({ onDemo }: { onDemo: () => void }) {
  const [mode, setMode] = useState<"login" | "signup" | "reset">("login");
  const [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [visible, setVisible] = useState(false),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (mode === "login") {
        const r = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (r.error) throw r.error;
      } else if (mode === "signup") {
        const r = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: location.origin },
        });
        if (r.error) throw r.error;
        setMessage("ตรวจสอบอีเมลเพื่อยืนยันบัญชี จากนั้นกลับมาเข้าสู่ระบบ");
      } else {
        const r = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: location.origin + "/?reset=1",
        });
        if (r.error) throw r.error;
        setMessage("ส่งลิงก์ตั้งรหัสผ่านไปยังอีเมลแล้ว");
      }
    } catch (e) {
      const msg = (e as Error).message;
      setError(
        msg === "Invalid login credentials"
          ? "อีเมลหรือรหัสผ่านไม่ถูกต้อง"
          : msg === "Email not confirmed"
            ? "กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ"
            : msg,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <section className="auth-photo">
        <img
          src="https://images.unsplash.com/photo-1519003722824-194d4455a60c?auto=format&fit=crop&w=1600&q=85"
          alt="รถขนส่งสินค้าบนเส้นทาง"
        />
        <div className="auth-photo-shade" />
        <div className="auth-brand">
          <Truck size={32} />
          <strong>
            NTD <span>LOGISTICS</span>
          </strong>
        </div>
        <div className="auth-photo-caption">
          <span>TRANSPORT MANAGEMENT SYSTEM</span>
          <h1>NTD TMS</h1>
          <p>ทุกการขนส่ง เริ่มต้นที่นี่</p>
          <div>
            กรุงเทพฯ <ArrowRight size={18} /> สุโขทัย · กำแพงเพชร · พิษณุโลก
          </div>
        </div>
        <span className="auth-copyright">NTD Logistics · ระบบงานภายใน</span>
      </section>
      <section className="auth-form">
        <div className="auth-top">
          <span className="status-dot" />
          ระบบงานขนส่ง
        </div>
        <div className="auth-form-inner">
          <div className="auth-symbol">
            <Truck size={28} />
          </div>
          <p className="eyebrow">ยินดีต้อนรับสู่ NTD</p>
          <h2>
            {mode === "signup"
              ? "เปิดใช้งานบัญชีพนักงาน"
              : mode === "reset"
                ? "ตั้งรหัสผ่านใหม่"
                : "เข้าสู่ระบบ"}
          </h2>
          <form onSubmit={submit}>
            <Field label="อีเมล" required>
              <div className="input-icon">
                <Mail size={17} />
                <input
                  type="email"
                  autoComplete="username"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
            </Field>
            {mode !== "reset" && (
              <Field label="รหัสผ่าน" required>
                <div className="input-icon">
                  <LockKeyhole size={17} />
                  <input
                    type={visible ? "text" : "password"}
                    autoComplete={
                      mode === "signup" ? "new-password" : "current-password"
                    }
                    placeholder="รหัสผ่านของคุณ"
                    minLength={mode === "signup" ? 12 : undefined}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                  <IconButton
                    label={visible ? "ซ่อนรหัสผ่าน" : "แสดงรหัสผ่าน"}
                    onClick={() => setVisible(!visible)}
                  >
                    {visible ? <EyeOff size={17} /> : <Eye size={17} />}
                  </IconButton>
                </div>
              </Field>
            )}
            {mode === "signup" && (
              <p className="muted small">
                เฉพาะอีเมลที่ผู้ดูแลเพิ่มสิทธิ์แล้ว · รหัสผ่านอย่างน้อย 12
                ตัวอักษร
              </p>
            )}
            {error && (
              <div className="alert error" role="alert">
                {error}
              </div>
            )}
            {message && (
              <div className="alert success" role="status">
                {message}
              </div>
            )}
            <Button busy={busy} className="primary full" type="submit">
              {mode === "login"
                ? "เข้าสู่ระบบ"
                : mode === "signup"
                  ? "เปิดใช้งานบัญชี"
                  : "ส่งลิงก์ตั้งรหัสผ่าน"}
              <ArrowRight size={18} />
            </Button>
          </form>
          <div className="auth-links">
            {mode === "login" ? (
              <>
                <button
                  onClick={() => {
                    setMode("signup");
                    setError("");
                    setMessage("");
                  }}
                >
                  เปิดใช้งานบัญชีครั้งแรก
                </button>
                <button
                  onClick={() => {
                    setMode("reset");
                    setError("");
                    setMessage("");
                  }}
                >
                  ลืมรหัสผ่าน
                </button>
              </>
            ) : (
              <button
                onClick={() => {
                  setMode("login");
                  setError("");
                  setMessage("");
                }}
              >
                <ArrowLeft size={15} />
                กลับไปเข้าสู่ระบบ
              </button>
            )}
          </div>
          <div className="auth-demo">
            <Button onClick={onDemo}>
              ทดลองใช้งานด้วยข้อมูลตัวอย่าง
              <ArrowRight size={17} />
            </Button>
          </div>
          <div className="auth-security">
            <ShieldCheck size={16} />
            เฉพาะพนักงานที่ได้รับอนุญาต
          </div>
        </div>
        <footer>
          NTD TMS <span>เวอร์ชัน 0.1 · Reception</span>
        </footer>
      </section>
    </div>
  );
}
