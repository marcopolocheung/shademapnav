import { useState, useRef, useCallback, useEffect } from "react";

interface NominatimResult {
  display_name: string;
  lat: string;
  lon: string;
  boundingbox: [string, string, string, string]; // [south, north, west, east]
}

interface SearchBarProps {
  onSelect: (place: {
    name: string;
    category?: string | null;
    address?: string | null;
    center: [number, number];
    zoom: number;
  }) => void;
  /** Map center used to compute distances for dropdown rows. [lng, lat] */
  mapCenter?: [number, number] | null;
  /** Optional: also close the panel when user clears the search */
  onClearPanel?: () => void;
  /** Called when the hamburger button is clicked (desktop sidebar toggle) */
  onMenuToggle?: () => void;
  /** Called when the directions button is clicked */
  onDirections?: () => void;
}

type RecentItem = { label: string; center: [number, number]; zoom: number };
type SavedItem = { label: string; center: [number, number]; zoom: number };

function haversineM(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

function formatDistance(m: number): string {
  if (!Number.isFinite(m)) return "";
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
}

function loadRecent(): RecentItem[] {
  try {
    const raw = localStorage.getItem("shademapnav:recentSearches");
    const arr = raw ? (JSON.parse(raw) as any[]) : [];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.label === "string" && Array.isArray(x.center) && x.center.length === 2)
      .slice(0, 6)
      .map((x) => ({
        label: String(x.label),
        center: [Number(x.center[0]), Number(x.center[1])],
        zoom: typeof x.zoom === "number" ? x.zoom : 14,
      }));
  } catch {
    return [];
  }
}

function saveRecent(item: RecentItem) {
  try {
    const existing = loadRecent();
    const next = [item, ...existing.filter((x) => x.label !== item.label)].slice(0, 8);
    localStorage.setItem("shademapnav:recentSearches", JSON.stringify(next));
  } catch {
    // ignore
  }
}

function loadSaved(): SavedItem[] {
  try {
    const raw = localStorage.getItem("shademapnav:savedPlaces");
    const arr = raw ? (JSON.parse(raw) as any[]) : [];
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((x) => x && typeof x.label === "string" && Array.isArray(x.center) && x.center.length === 2)
      .slice(0, 6)
      .map((x) => ({
        label: String(x.label),
        center: [Number(x.center[0]), Number(x.center[1])],
        zoom: typeof x.zoom === "number" ? x.zoom : 16,
      }));
  } catch {
    return [];
  }
}

function guessCategory(displayName: string): string {
  const parts = (displayName ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return parts[1] ?? "Place";
}

function addressFromDisplayName(displayName: string): string {
  const parts = (displayName ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return parts.slice(1).join(", ");
}

function primaryName(displayName: string): string {
  return (displayName ?? "").split(",")[0]?.trim() || displayName;
}

function computeZoomFromBbox(bb: [string, string, string, string]): number {
  const [south, north] = [Number(bb[0]), Number(bb[1])];
  const latSpan = Math.max(1e-6, north - south);
  return Math.min(16, Math.max(2, Math.round(8 - Math.log2(latSpan))));
}

export default function SearchBar({ onSelect, mapCenter, onClearPanel, onMenuToggle, onDirections }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [isActive, setIsActive] = useState(false);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [saved, setSaved] = useState<SavedItem[]>([]);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listId = useRef(`search-results-${Math.random().toString(36).slice(2, 8)}`).current;

  useEffect(() => {
    setRecent(loadRecent());
    setSaved(loadSaved());
  }, []);

  // Close recent/saved dropdown on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsActive(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const search = useCallback(async (q: string, opts?: { minChars?: number }): Promise<NominatimResult[]> => {
    const minChars = opts?.minChars ?? 3;
    if (q.trim().length < minChars) {
      setResults([]);
      return [];
    }
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=5`,
        { headers: { "User-Agent": "ShadeMapNav/1.0 (+https://shademapnav.vercel.app)" } }
      );
      const data: NominatimResult[] = await res.json();
      setResults(data);
      setHighlightIndex(-1);
      return data;
    } catch {
      setResults([]);
      return [];
    }
  }, []);

  const handleSelect = useCallback(function handleSelect(r: NominatimResult) {
    const name = primaryName(r.display_name);
    setQuery(name);
    setResults([]);
    setIsActive(false);

    const [south, north, west, east] = r.boundingbox.map(Number);
    const center: [number, number] = [(west + east) / 2, (south + north) / 2];
    const zoom = computeZoomFromBbox(r.boundingbox);

    const item: RecentItem = { label: name, center, zoom };
    saveRecent(item);
    setRecent(loadRecent());

    onSelect({
      name,
      category: guessCategory(r.display_name),
      address: addressFromDisplayName(r.display_name) || null,
      center,
      zoom,
    });
  }, [onSelect]);

  const runSearchNow = useCallback(
    async (opts?: { minChars?: number; selectTop?: boolean }) => {
      const q = query.trim();
      if (!q) {
        inputRef.current?.focus();
        return;
      }
      const data = await search(q, { minChars: opts?.minChars });
      if (opts?.selectTop && data[0]) handleSelect(data[0]);
    },
    [query, search, handleSelect]
  );

  const handleMagnifierClick = useCallback(async () => {
    await runSearchNow({ minChars: 1, selectTop: true });
  }, [runSearchNow]);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value;
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => search(value, { minChars: 3 }), 400);
  }


  function handleSelectSaved(item: SavedItem) {
    setQuery(item.label);
    setResults([]);
    setIsActive(false);
    saveRecent(item);
    setRecent(loadRecent());
    onSelect({ name: item.label, center: item.center, zoom: item.zoom });
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      if (results.length === 0) return;
      e.preventDefault();
      setHighlightIndex((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      if (results.length === 0) return;
      e.preventDefault();
      setHighlightIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlightIndex >= 0 && results[highlightIndex]) {
        handleSelect(results[highlightIndex]);
      } else {
        runSearchNow({ minChars: 1, selectTop: true });
      }
    } else if (e.key === "Escape") {
      setResults([]);
      setIsActive(false);
      inputRef.current?.blur();
    }
  }

  function handleFocus() {
    setIsActive(true);
  }

  function handleClear() {
    setQuery("");
    setResults([]);
    onClearPanel?.();
    inputRef.current?.focus();
  }

  useEffect(() => {
    if (highlightIndex < 0) return;
    const el = document.getElementById(`${listId}-opt-${highlightIndex}`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlightIndex, listId]);

  const isOpen = results.length > 0;
  const showSections = isActive && (query.trim().length < 3) && (recent.length > 0 || saved.length > 0);

  return (
    <div ref={containerRef} className="relative">
      {/* MD3 floating pill */}
      <div
        className="w-full flex items-center rounded-full bg-white/80 backdrop-blur-md h-14 px-4 gap-3"
        style={{
          boxShadow: isActive
            ? "0 8px 32px rgba(100,116,139,0.16)"
            : "0 4px 16px rgba(100,116,139,0.10)",
        }}
      >
        {/* Hamburger — toggles desktop sidebar */}
        {onMenuToggle && (
          <button
            onClick={onMenuToggle}
            className="shrink-0 text-amber-700 hover:opacity-80 transition-opacity"
            aria-label="Toggle menu"
          >
            <span className="material-symbols-outlined">menu</span>
          </button>
        )}

        {/* Input */}
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          placeholder="Search destinations..."
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={isOpen ? listId : undefined}
          aria-activedescendant={highlightIndex >= 0 ? `${listId}-opt-${highlightIndex}` : undefined}
          aria-autocomplete="list"
          className="min-w-0 flex-1 bg-transparent text-sm focus:outline-none placeholder-slate-400"
          style={{ color: "var(--md-on-surface)", fontFamily: "var(--md-font)" }}
        />

        {/* Clear button */}
        {query.length > 0 && (
          <button
            onClick={handleClear}
            className="shrink-0 text-slate-400 hover:text-slate-600 transition-colors"
            aria-label="Clear search"
          >
            <svg width="16" height="16" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <line x1="1" y1="1" x2="9" y2="9" />
              <line x1="9" y1="1" x2="1" y2="9" />
            </svg>
          </button>
        )}

        {/* Magnifying glass — triggers search */}
        <button
          onClick={handleMagnifierClick}
          onMouseDown={(e) => e.preventDefault()}
          className="shrink-0 text-amber-700 hover:opacity-80 transition-opacity"
          aria-label="Search"
        >
          <span className="material-symbols-outlined">search</span>
        </button>

        {/* Directions button */}
        {onDirections && (
          <button
            onClick={onDirections}
            className="shrink-0 text-slate-400 hover:opacity-80 transition-opacity"
            aria-label="Directions"
          >
            <span className="material-symbols-outlined">directions</span>
          </button>
        )}
      </div>

      {/* Recent/Saved sections */}
      {showSections && (
        <div
          className="absolute top-full mt-2 w-full bg-white rounded-2xl overflow-hidden border z-20"
          style={{ borderColor: "rgba(215,195,172,0.2)", boxShadow: "var(--md-shadow-lg)" }}
        >
          {recent.length > 0 && (
            <div className="py-1">
              <div className="px-4 pt-2 pb-1 text-[11px] font-semibold tracking-wide" style={{ color: "var(--md-on-surface-variant)" }}>
                RECENT
              </div>
              {recent.map((it, i) => {
                const dist = mapCenter ? formatDistance(haversineM(mapCenter, it.center)) : "";
                return (
                  <button
                    key={`${it.label}-${i}`}
                    onClick={() => handleSelectSaved(it)}
                    className="w-full text-left px-4 py-2 flex items-center gap-3 hover:bg-amber-50/50"
                  >
                    <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "var(--md-surface-container)", color: "var(--md-on-surface-variant)" }}>
                      <span className="material-symbols-outlined text-base">location_on</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium truncate" style={{ color: "var(--md-on-surface)" }}>{it.label}</div>
                      {dist && <div className="text-[11px]" style={{ color: "var(--md-on-surface-variant)" }}>{dist}</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {saved.length > 0 && (
            <div className="border-t py-1" style={{ borderColor: "rgba(215,195,172,0.15)" }}>
              <div className="px-4 pt-2 pb-1 text-[11px] font-semibold tracking-wide" style={{ color: "var(--md-on-surface-variant)" }}>
                SAVED
              </div>
              {saved.map((it, i) => {
                const dist = mapCenter ? formatDistance(haversineM(mapCenter, it.center)) : "";
                return (
                  <button
                    key={`${it.label}-${i}`}
                    onClick={() => handleSelectSaved(it)}
                    className="w-full text-left px-4 py-2 flex items-center gap-3 hover:bg-amber-50/50"
                  >
                    <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "var(--md-surface-container)", color: "var(--md-on-surface-variant)" }}>
                      <span className="material-symbols-outlined text-base">bookmark</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium truncate" style={{ color: "var(--md-on-surface)" }}>{it.label}</div>
                      {dist && <div className="text-[11px]" style={{ color: "var(--md-on-surface-variant)" }}>{dist}</div>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Results dropdown */}
      {isOpen && (
        <ul
          id={listId}
          role="listbox"
          className="absolute top-full mt-2 w-full bg-white rounded-2xl overflow-hidden border z-20 max-h-72 overflow-y-auto md-scrollbar"
          style={{ borderColor: "rgba(215,195,172,0.2)", boxShadow: "var(--md-shadow-lg)" }}
        >
          {results.map((r, i) => (
            <li key={i} id={`${listId}-opt-${i}`} role="option" aria-selected={i === highlightIndex}>
              <button
                onClick={() => handleSelect(r)}
                className={`w-full text-left px-4 py-2 transition-colors flex items-center gap-3 ${
                  i === highlightIndex ? "bg-amber-50" : "hover:bg-amber-50/50"
                }`}
              >
                <div className="w-8 h-8 rounded-full flex items-center justify-center" style={{ background: "var(--md-surface-container)", color: "var(--md-on-surface-variant)" }}>
                  <span className="material-symbols-outlined text-base">location_on</span>
                </div>

                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium truncate" style={{ color: "var(--md-on-surface)" }}>
                    {primaryName(r.display_name)}
                  </div>
                  <div className="text-[11px] truncate" style={{ color: "var(--md-on-surface-variant)" }}>
                    {guessCategory(r.display_name)}
                  </div>
                </div>

                {mapCenter && (
                  <div className="text-[11px] tabular-nums" style={{ color: "var(--md-on-surface-variant)" }}>
                    {formatDistance(haversineM(mapCenter, [Number(r.lon), Number(r.lat)]))}
                  </div>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
