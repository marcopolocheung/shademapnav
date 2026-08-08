import type { RouteOption, RouteLeg } from "../lib/routing";
import { routeTradeoffLine } from "../lib/routeTradeoff";

function formatDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

interface RouteCardProps {
  route: RouteOption;
  selected: boolean;
  onSelect: () => void;
  onSave?: () => void;
  onExport?: (format: "gpx" | "geojson") => void;
  recommended?: boolean;
  baselineRoute?: RouteOption;
}

export default function RouteCard({ route: r, selected, onSelect, onSave, onExport, recommended, baselineRoute }: RouteCardProps) {
  const streak = r.longestContinuousShadeM >= 10 ? `${Math.round(r.longestContinuousShadeM)}m shade` : null;
  const transitions = r.shadeTransitions === 0 ? "continuous" : `${r.shadeTransitions} break${r.shadeTransitions === 1 ? "" : "s"}`;
  const detour = r.detourRatio > 1.05 ? `${r.detourRatio.toFixed(1)}×` : null;
  const shadePct = Math.round(r.shadeCoverage * 100);
  const tradeoffLine = baselineRoute ? routeTradeoffLine(r, baselineRoute) : null;

  return (
    <div className="flex gap-1.5 items-start">
      <button
        onClick={onSelect}
        role="radio"
        aria-checked={selected}
        className={`flex-1 text-left rounded-lg text-xs transition-all ${
          selected
            ? 'bg-white/80 backdrop-blur-xl p-4 shadow-xl border-l-4'
            : 'bg-white/60 backdrop-blur-md p-3 border-l-4 border-slate-200 hover:bg-white/70'
        }`}
        style={selected ? { borderColor: "var(--md-primary)" } : undefined}
      >
        {/* Header */}
        <div className="flex justify-between items-center">
          <span className="flex items-center gap-1.5">
            <span
              className={`font-semibold ${selected ? 'text-sm' : ''}`}
              style={{ color: selected ? "var(--md-on-surface)" : "var(--md-on-surface-variant)" }}
            >
              {r.label}
            </span>
            {recommended && (
              <span
                className="text-[9px] font-medium px-1.5 py-0.5 rounded-full"
                style={{ background: "var(--md-primary-container)", color: "var(--md-on-primary-container)" }}
              >
                Recommended
              </span>
            )}
          </span>
          <span
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
            style={{
              background: selected ? "var(--md-primary-container)" : "rgba(130,85,0,0.08)",
              color: selected ? "var(--md-on-surface)" : "var(--md-on-surface-variant)",
            }}
          >
            {shadePct}% shade
          </span>
        </div>

        {tradeoffLine && (
          <div
            className={`mt-1 font-semibold ${selected ? "text-[12px]" : "text-[11px]"}`}
            style={{ color: selected ? "var(--md-primary)" : "var(--md-on-surface)" }}
          >
            {tradeoffLine}
          </div>
        )}

        {/* Shade bar */}
        <div className="mt-2 flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(130,85,0,0.08)" }}>
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${shadePct}%`, background: "var(--md-primary-container)" }}
            />
          </div>
          <span className="text-[10px] tabular-nums w-12 text-right" style={{ color: "var(--md-on-surface-variant)" }}>
            {formatDist(r.distanceM)}
          </span>
        </div>

        {/* Metrics grid — only on selected */}
        {selected && (
          <div className="grid grid-cols-2 gap-2 mt-3">
            <div className="rounded-lg p-2" style={{ background: "var(--md-surface-container-low)" }}>
              <div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--md-on-surface-variant)" }}>Distance</div>
              <div className="text-xs font-semibold mt-0.5" style={{ color: "var(--md-on-surface)" }}>{formatDist(r.distanceM)}</div>
            </div>
            {streak && (
              <div className="rounded-lg p-2" style={{ background: "var(--md-surface-container-low)" }}>
                <div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--md-on-surface-variant)" }}>Continuous Shade</div>
                <div className="text-xs font-semibold mt-0.5" style={{ color: "var(--md-on-surface)" }}>{streak}</div>
              </div>
            )}
            {detour && (
              <div className="rounded-lg p-2" style={{ background: "var(--md-surface-container-low)" }}>
                <div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--md-on-surface-variant)" }}>Detour Ratio</div>
                <div className="text-xs font-semibold mt-0.5" style={{ color: "var(--md-on-surface)" }}>{detour}</div>
              </div>
            )}
            <div className="rounded-lg p-2" style={{ background: "var(--md-surface-container-low)" }}>
              <div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--md-on-surface-variant)" }}>Shade Breaks</div>
              <div className="text-xs font-semibold mt-0.5" style={{ color: "var(--md-on-surface)" }}>{transitions}</div>
            </div>
          </div>
        )}

        {/* Compact metrics — only on unselected */}
        {!selected && (streak || detour || r.turnCount > 0) && (
          <div className="text-[10px] mt-1 flex flex-wrap gap-x-2" style={{ color: "var(--md-on-surface-variant)" }}>
            {streak && <span>{streak}</span>}
            <span>{transitions}</span>
            {detour && <span>{detour} detour</span>}
            {r.turnCount > 0 && <span>{r.turnCount} turn{r.turnCount === 1 ? '' : 's'}</span>}
          </div>
        )}

        {/* Transit info */}
        {r.legs?.find((l: RouteLeg) => l.type === 'transit') && (() => {
          const tLeg = r.legs!.find((l: RouteLeg) => l.type === 'transit')!;
          const lineColor = tLeg.lineColor ?? '#0070BD';
          const lineName = tLeg.lineName ?? tLeg.line ?? 'Transit';
          const stopCount = (tLeg.stops?.length ?? 2) - 1;
          const totalMin = Math.ceil((r.totalTimeSec ?? 0) / 60);
          const sunExposure = tLeg.sunExposure ?? 0;
          const sunLabel = sunExposure < 0.05
            ? "Underground — no sun"
            : sunExposure < 0.2
            ? "Mostly shaded"
            : "Some sun exposure";
          const sunColor = sunExposure < 0.05
            ? "#0e7490"
            : sunExposure < 0.2
            ? "#15803d"
            : "#a16207";
          return (
            <div className="mt-2 text-[10px] flex flex-col gap-0.5" style={{ color: "var(--md-on-surface-variant)" }}>
              <div className="flex items-center gap-1">
                <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: lineColor }} />
                <span style={{ color: "var(--md-on-surface)" }}>{lineName}</span>
                <span style={{ opacity: 0.4 }}>·</span>
                <span>{stopCount} stop{stopCount !== 1 ? 's' : ''}</span>
              </div>
              <div className="flex gap-x-2 flex-wrap">
                <span>{totalMin} min total</span>
                <span style={{ opacity: 0.4 }}>·</span>
                <span style={{ color: sunColor }}>{sunLabel}</span>
              </div>
            </div>
          );
        })()}
      </button>

      {onSave && (
        <button
          onClick={onSave}
          title="Save this route"
          className="shrink-0 mt-0.5 p-1.5 rounded-lg text-slate-400 hover:text-amber-700 hover:bg-amber-50 transition-all"
        >
          <span className="material-symbols-outlined text-base">bookmark</span>
        </button>
      )}

      {onExport && (
        <div className="relative group/export shrink-0 mt-0.5">
          <button className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 transition-colors" title="Export route">
            <span className="material-symbols-outlined text-base">download</span>
          </button>
          <div
            className="hidden group-hover/export:flex absolute right-0 top-full mt-1 flex-col rounded-lg shadow-xl z-30 min-w-max border"
            style={{ background: "white", borderColor: "var(--md-outline-variant)" }}
          >
            <button onClick={() => onExport("gpx")} className="px-3 py-1.5 text-[11px] hover:bg-amber-50 text-left transition-colors" style={{ color: "var(--md-on-surface)" }}>GPX</button>
            <button onClick={() => onExport("geojson")} className="px-3 py-1.5 text-[11px] hover:bg-amber-50 text-left transition-colors" style={{ color: "var(--md-on-surface)" }}>GeoJSON</button>
          </div>
        </div>
      )}
    </div>
  );
}
