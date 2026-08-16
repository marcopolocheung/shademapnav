import { useState, useRef, memo } from "react";
import { toMapLocal } from "../lib/timezone";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function formatDateDisplay(d: Date, utcOffsetMin: number): string {
  const { year, month, day } = toMapLocal(d, utcOffsetMin);
  return `${MONTHS[month]} ${day}, ${year}`;
}

function parseDateText(s: string, base: Date, utcOffsetMin: number): Date | null {
  s = s.trim();
  const { hours, minutes } = toMapLocal(base, utcOffsetMin);

  const makeDate = (year: number, month: number, day: number): Date | null => {
    const d = new Date(
      Date.UTC(year, month, day) - utcOffsetMin * 60000 + (hours * 60 + minutes) * 60000
    );
    return isNaN(d.getTime()) ? null : d;
  };

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (iso) return makeDate(+iso[1], +iso[2] - 1, +iso[3]);

  const mdy = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(s);
  if (mdy) {
    const { year: baseYear } = toMapLocal(base, utcOffsetMin);
    const rawYear = mdy[3] ? +mdy[3] : baseYear;
    const year = rawYear < 100 ? 2000 + rawYear : rawYear;
    return makeDate(year, +mdy[1] - 1, +mdy[2]);
  }

  const { year: baseYear } = toMapLocal(base, utcOffsetMin);
  const attempt = new Date(`${s} ${baseYear}`);
  if (!isNaN(attempt.getTime())) {
    return makeDate(baseYear, attempt.getMonth(), attempt.getDate());
  }

  return null;
}

interface DateInputProps {
  date: Date;
  onChange: (d: Date) => void;
  utcOffsetMin?: number;
}

const DateInput = memo(function DateInput({ date, onChange, utcOffsetMin: utcOffsetMinProp }: DateInputProps) {
  const utcOffsetMin = utcOffsetMinProp ?? -new Date().getTimezoneOffset();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const shouldCommit = useRef(true);

  function startEdit() {
    shouldCommit.current = true;
    setText(formatDateDisplay(date, utcOffsetMin));
    setEditing(true);
  }

  function commit(val: string) {
    if (!shouldCommit.current) {
      shouldCommit.current = true;
      return;
    }
    setEditing(false);
    const next = parseDateText(val, date, utcOffsetMin);
    if (next) onChange(next);
  }

  if (editing) {
    return (
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit(text)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            shouldCommit.current = false;
            setEditing(false);
          }
        }}
        className="min-h-11 rounded px-2 py-1 text-xs border focus:outline-none w-32 text-center"
        style={{
          background: "var(--md-surface-container-low)",
          color: "var(--md-on-surface)",
          borderColor: "var(--md-outline-variant)",
          fontFamily: "var(--md-font)",
        }}
        autoFocus
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startEdit}
      className="min-h-11 text-xs tabular-nums w-32 text-center rounded px-2 py-1 hover:bg-slate-100 transition-colors"
      style={{
        color: "var(--md-on-surface-variant)",
        fontFamily: "var(--md-font)",
      }}
      title="Click to set date (e.g. Mar 3, 3/3/2026)"
    >
      {formatDateDisplay(date, utcOffsetMin)}
    </button>
  );
});

export default DateInput;
