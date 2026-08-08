import { useState, useRef, useEffect, memo } from "react";
import { geocodeForward, type NominatimResult } from "../lib/nominatim";

interface WaypointInputProps {
  label: string | null;
  placeholder: string;
  dotColor: "green" | "red" | "amber";
  onSet: (coord: [number, number], label: string) => void;
  onClear: () => void;
}

const WaypointInput = memo(function WaypointInput({
  label,
  placeholder,
  dotColor,
  onSet,
  onClear,
}: WaypointInputProps) {
  const [query, setQuery] = useState(label ?? "");
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [highlight, setHighlight] = useState(-1);
  const [inlineError, setInlineError] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchGenRef = useRef(0);
  const focusedRef = useRef(false);
  const labelRef = useRef(label);
  labelRef.current = label;

  useEffect(() => {
    if (!focusedRef.current) {
      setQuery(label ?? "");
    }
  }, [label]);

  function closeDropdown() {
    setResults([]);
    setHighlight(-1);
    setInlineError(null);
  }

  function search(q: string) {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (q.length < 2) { closeDropdown(); return; }
    const gen = ++searchGenRef.current;
    timerRef.current = setTimeout(async () => {
      try {
        const res = await geocodeForward(q);
        if (gen !== searchGenRef.current) return;
        if (res.length === 0) {
          setResults([]);
          setInlineError(`No results found for "${q}". Try a different address.`);
        } else {
          setResults(res);
          setInlineError(null);
        }
      } catch {
        if (gen !== searchGenRef.current) return;
        setResults([]);
        setInlineError("Address search failed. Check your connection.");
      }
    }, 400);
  }

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setQuery(val);
    if (labelRef.current !== null) onClear();
    setHighlight(-1);
    search(val);
  }

  function handleSelect(r: NominatimResult) {
    const coord: [number, number] = [parseFloat(r.lon), parseFloat(r.lat)];
    setQuery(r.display_name);
    closeDropdown();
    onSet(coord, r.display_name);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, -1));
    } else if (e.key === "Enter" && highlight >= 0) {
      e.preventDefault();
      handleSelect(results[highlight]);
    } else if (e.key === "Escape") {
      closeDropdown();
    }
  }

  return (
    <div className="relative flex flex-col gap-0.5">
      <div className="flex items-center gap-3 relative z-10">
        {dotColor === "green" ? (
          <span className="material-symbols-outlined text-green-600 bg-green-50 rounded-full p-0.5 text-sm shrink-0">
            radio_button_checked
          </span>
        ) : dotColor === "red" ? (
          <span className="material-symbols-outlined text-red-600 bg-red-50 rounded-full p-0.5 text-sm shrink-0">
            location_on
          </span>
        ) : (
          <span className="material-symbols-outlined text-amber-700 bg-amber-50 rounded-full p-0.5 text-sm shrink-0">
            add_location
          </span>
        )}
        <input
          type="text"
          value={query}
          placeholder={placeholder}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={(e) => {
            focusedRef.current = true;
            setTimeout(() => e.target.select(), 0);
          }}
          onBlur={() => {
            focusedRef.current = false;
            setQuery(labelRef.current ?? "");
            closeDropdown();
          }}
          className="flex-1 min-w-0 rounded px-2 py-1 text-xs placeholder-slate-400 border-none focus:outline-none transition-colors bg-transparent"
          style={{ color: "var(--md-on-surface)", fontFamily: "var(--md-font)" }}
        />
        {label && (
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onClear(); setQuery(""); closeDropdown(); }}
            className="shrink-0 text-slate-400 hover:text-slate-700 transition-colors leading-none px-0.5"
            title="Clear waypoint"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        )}
      </div>
      {inlineError && (
        <p className="text-[10px] text-red-600 pl-8">{inlineError}</p>
      )}
      {results.length > 0 && (
        <div
          className="absolute top-full left-8 right-0 mt-0.5 z-50 bg-white border rounded-xl overflow-hidden"
          style={{ borderColor: "rgba(215,195,172,0.2)", boxShadow: "var(--md-shadow-lg)" }}
        >
          {results.map((r, i) => {
            const comma = r.display_name.indexOf(",");
            const primary = comma >= 0 ? r.display_name.slice(0, comma) : r.display_name;
            const secondary = comma >= 0 ? r.display_name.slice(comma + 1).trim() : "";
            return (
              <button
                key={r.place_id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(r)}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full text-left px-3 py-2 transition-colors ${
                  i === highlight ? "bg-amber-50" : "hover:bg-amber-50/50"
                }`}
              >
                <div className="text-xs truncate" style={{ color: i === highlight ? "var(--md-primary)" : "var(--md-on-surface)" }}>
                  {primary}
                </div>
                {secondary && (
                  <div className="text-[10px] truncate" style={{ color: "var(--md-on-surface-variant)" }}>{secondary}</div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});

export default WaypointInput;
