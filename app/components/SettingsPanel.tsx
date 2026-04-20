import { useState } from "react";

interface SettingsPanelProps {
  showSunLines: boolean;
  onShowSunLinesChange: (v: boolean) => void;
}

export default function SettingsPanel({
  showSunLines,
  onShowSunLinesChange,
}: SettingsPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-2 items-start">
      <button
        onClick={() => setOpen((o) => !o)}
        className={`text-xs px-3 py-1.5 rounded-lg transition-colors border ${
          open ? "bg-slate-50" : "bg-white hover:bg-slate-50"
        }`}
        style={{ borderColor: "var(--md-outline-variant)", color: "var(--md-on-surface)" }}
        title="Settings"
      >
        <span className="material-symbols-outlined text-sm align-middle mr-1">settings</span>
        Settings
      </button>

      {open && (
        <div
          className="rounded-lg p-3 flex flex-col gap-3 text-xs min-w-[200px] border"
          style={{
            background: "white",
            color: "var(--md-on-surface)",
            borderColor: "var(--md-outline-variant)",
            boxShadow: "var(--md-shadow)",
          }}
        >
          <div className="uppercase tracking-widest text-[9px] font-bold" style={{ color: "var(--md-on-surface-variant)" }}>
            Display
          </div>

          <label className="flex items-center justify-between gap-4 cursor-pointer select-none">
            <span style={{ color: "var(--md-on-surface)" }}>Sun direction lines</span>
            <input
              type="checkbox"
              checked={showSunLines}
              onChange={(e) => onShowSunLinesChange(e.target.checked)}
              className="accent-amber-500 w-4 h-4"
            />
          </label>

          {showSunLines && (
            <div className="flex flex-col gap-1.5 pl-1 border-l" style={{ borderColor: "var(--md-outline-variant)" }}>
              <div className="flex items-center gap-2">
                <span className="text-yellow-500 text-sm leading-none">☀</span>
                <span style={{ color: "var(--md-on-surface-variant)" }}>Current sun (overlay)</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: "#c2410c" }} />
                <span style={{ color: "var(--md-on-surface-variant)" }}>Sunrise</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: "#1e40af" }} />
                <span style={{ color: "var(--md-on-surface-variant)" }}>Sunset</span>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
