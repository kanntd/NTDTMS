import { useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { thaiDate } from "./domain";

export function parseDisplayDate(value: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = 2000 + Number(match[3]) - 43;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() + 1 !== month || parsed.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export default function DateInput({ value, onChange, min, max, required, ...props }: {
  value: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  required?: boolean;
  "aria-label"?: string;
}) {
  const [text, setText] = useState(value ? thaiDate(value) : "");
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => { setText(value ? thaiDate(value) : ""); }, [value]);
  const commit = () => {
    if (!text.trim()) { onChange(""); setText(""); return; }
    const parsed = parseDisplayDate(text);
    if (parsed && (!min || parsed >= min) && (!max || parsed <= max)) {
      onChange(parsed);
      setText(thaiDate(parsed));
    } else {
      setText(value ? thaiDate(value) : "");
    }
  };
  return <span className="date-input">
    <input {...props} type="text" inputMode="numeric" placeholder="dd/mm/yy" value={text}
      required={required} pattern="[0-9]{1,2}/[0-9]{1,2}/[0-9]{2}"
      onChange={(event) => setText(event.target.value)} onBlur={commit}
      onKeyDown={(event) => { if (event.key === "Enter") { commit(); event.currentTarget.blur(); } }} />
    <button type="button" className="date-input-picker" aria-label="เลือกวันที่" title="เลือกวันที่"
      onClick={() => picker.current?.showPicker?.()}><CalendarDays size={17} /></button>
    <input ref={picker} className="date-input-native" type="date" tabIndex={-1}
      value={value} min={min} max={max} onChange={(event) => onChange(event.target.value)} />
  </span>;
}
