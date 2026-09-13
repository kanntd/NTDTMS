import {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type ButtonHTMLAttributes,
} from "react";
import {
  X,
  LoaderCircle,
  PackageOpen,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";

export function Button({
  children,
  className = "",
  busy,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean }) {
  return (
    <button
      {...props}
      disabled={props.disabled || busy}
      className={"button " + className}
    >
      {busy && <LoaderCircle size={16} className="spin" />}
      {children}
    </button>
  );
}
export function IconButton({
  label,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      {...props}
      type={props.type || "button"}
      className={"icon-button " + (props.className || "")}
      aria-label={label}
      title={label}
    >
      {children}
    </button>
  );
}
export function Field({
  label,
  children,
  error,
  required,
  className = "",
}: {
  label: string;
  children: ReactNode;
  error?: string;
  required?: boolean;
  className?: string;
}) {
  return (
    <label className={"field " + className}>
      <span>
        {label}
        {required && <b className="required">*</b>}
      </span>
      {children}
      {error && <small className="field-error">{error}</small>}
    </label>
  );
}

export function EditableSelect({
  value,
  options,
  onChange,
  required = false,
  emptyLabel = "ไม่ระบุ",
  customLabel = "เพิ่ม / แก้ไขรายการ",
  ariaLabel,
}: {
  value: string;
  options: string[];
  onChange: (value: string) => void;
  required?: boolean;
  emptyLabel?: string;
  customLabel?: string;
  ariaLabel?: string;
}) {
  const choices = [
    ...new Set(options.map((item) => item.trim()).filter(Boolean)),
  ];
  const [custom, setCustom] = useState(
    Boolean(value && !choices.includes(value)),
  );
  return (
    <div className="editable-select">
      <select
        aria-label={ariaLabel}
        required={required}
        value={custom ? "__custom__" : value}
        onChange={(event) => {
          if (event.target.value === "__custom__") {
            setCustom(true);
            onChange("");
            return;
          }
          setCustom(false);
          onChange(event.target.value);
        }}
      >
        {!required && <option value="">{emptyLabel}</option>}
        {choices.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
        <option value="__custom__">＋ {customLabel}</option>
      </select>
      {custom && (
        <input
          autoFocus
          aria-label={ariaLabel ? `${ariaLabel}ใหม่` : undefined}
          required={required}
          value={value}
          placeholder="พิมพ์รายการใหม่"
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement;
    dialog.showModal();
    return () => {
      dialog.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={id}
      className={"modal " + (wide ? "wide" : "")}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="modal-inner">
        <header>
          <h2 id={id}>{title}</h2>
          <IconButton label="ปิด" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </header>
        {children}
      </div>
    </dialog>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <PackageOpen size={34} strokeWidth={1.3} />
      <strong>{title}</strong>
      {children}
    </div>
  );
}
export function Loading() {
  return (
    <div className="loading">
      <LoaderCircle size={24} className="spin" />
      กำลังโหลดข้อมูล
    </div>
  );
}
export function Pagination({
  count,
  page,
  onChange,
}: {
  count: number;
  page: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="pagination">
      <span>
        {count
          ? `${page * 50 + 1}–${Math.min(page * 50 + 50, count)} จาก ${count} รายการ`
          : "0 รายการ"}
      </span>
      <div>
        <IconButton
          label="หน้าก่อนหน้า"
          disabled={page === 0}
          onClick={() => onChange(page - 1)}
        >
          <ChevronLeft size={17} />
        </IconButton>
        <span>{page + 1}</span>
        <IconButton
          label="หน้าถัดไป"
          disabled={(page + 1) * 50 >= count}
          onClick={() => onChange(page + 1)}
        >
          <ChevronRight size={17} />
        </IconButton>
      </div>
    </div>
  );
}
