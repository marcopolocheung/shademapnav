import type { RouteOption } from "../lib/routing";

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.max(1, Math.round(seconds / 60));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder === 0 ? `${hours} hr` : `${hours} hr ${remainder} min`;
}

function coordLabel(coord: [number, number] | null): string {
  if (!coord) return "Not set";
  return `${coord[1].toFixed(5)}, ${coord[0].toFixed(5)}`;
}

interface NavigationStatusPanelProps {
  route: RouteOption | null;
  waypointA: [number, number] | null;
  waypointB: [number, number] | null;
  waypointALabel: string | null;
  waypointBLabel: string | null;
  onBack: () => void;
  onArrive: () => void;
  onExit: () => void;
}

export default function NavigationStatusPanel({
  route,
  waypointA,
  waypointB,
  waypointALabel,
  waypointBLabel,
  onBack,
  onArrive,
  onExit,
}: NavigationStatusPanelProps) {
  const shadePct = route ? Math.round(route.shadeCoverage * 100) : null;
  const duration = route?.totalTimeSec ? formatDuration(route.totalTimeSec) : null;
  const destination = waypointBLabel ?? coordLabel(waypointB);

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-amber-50"
          style={{ background: "var(--md-surface-container-low)", color: "var(--md-on-surface-variant)" }}
          title="Back to route options"
          aria-label="Back to route options"
        >
          <span className="material-symbols-outlined text-base">arrow_back</span>
        </button>
        <h2 className="text-[13px] font-medium" style={{ color: "var(--md-on-surface)" }}>Navigating</h2>
        <button
          type="button"
          onClick={onExit}
          className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-slate-100"
          style={{ background: "var(--md-surface-container-low)", color: "var(--md-on-surface-variant)" }}
          title="End navigation"
          aria-label="End navigation"
        >
          <span className="material-symbols-outlined text-base">close</span>
        </button>
      </div>

      <div
        className="rounded-xl border p-4"
        style={{
          background: "rgba(34,197,94,0.08)",
          borderColor: "rgba(34,197,94,0.22)",
          color: "var(--md-on-surface)",
        }}
      >
        <div className="flex items-start gap-3">
          <span
            className="material-symbols-outlined mt-0.5 rounded-full p-2 text-[20px]"
            style={{ background: "#22c55e", color: "white" }}
          >
            navigation
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#15803d" }}>
              Navigation active
            </div>
            <div className="mt-1 truncate text-sm font-semibold" style={{ color: "var(--md-on-surface)" }}>
              {route?.label ?? "No route selected"}
            </div>
            <div className="mt-1 truncate text-[11px]" style={{ color: "var(--md-on-surface-variant)" }}>
              To {destination}
            </div>
          </div>
        </div>
      </div>

      {route ? (
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg p-3" style={{ background: "var(--md-surface-container-low)" }}>
            <div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--md-on-surface-variant)" }}>Distance</div>
            <div className="mt-1 text-sm font-semibold" style={{ color: "var(--md-on-surface)" }}>{formatDistance(route.distanceM)}</div>
          </div>
          <div className="rounded-lg p-3" style={{ background: "var(--md-surface-container-low)" }}>
            <div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--md-on-surface-variant)" }}>Shade</div>
            <div className="mt-1 text-sm font-semibold" style={{ color: "var(--md-on-surface)" }}>{shadePct}%</div>
          </div>
          <div className="rounded-lg p-3" style={{ background: "var(--md-surface-container-low)" }}>
            <div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--md-on-surface-variant)" }}>Turns</div>
            <div className="mt-1 text-sm font-semibold" style={{ color: "var(--md-on-surface)" }}>{route.turnCount}</div>
          </div>
          <div className="rounded-lg p-3" style={{ background: "var(--md-surface-container-low)" }}>
            <div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--md-on-surface-variant)" }}>
              {duration ? "Time" : "Shade breaks"}
            </div>
            <div className="mt-1 text-sm font-semibold" style={{ color: "var(--md-on-surface)" }}>
              {duration ?? route.shadeTransitions}
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-lg border p-3 text-xs" style={{ borderColor: "var(--md-outline-variant)", color: "var(--md-on-surface-variant)" }}>
          Pick a complete route before starting navigation.
        </div>
      )}

      <div className="rounded-xl p-3" style={{ background: "var(--md-surface-container-low)" }}>
        <div className="flex items-start gap-2">
          <span className="material-symbols-outlined text-[18px]" style={{ color: "var(--md-primary)" }}>trip_origin</span>
          <div className="min-w-0 flex-1">
            <div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--md-on-surface-variant)" }}>Start</div>
            <div className="truncate text-xs font-medium" style={{ color: "var(--md-on-surface)" }}>
              {waypointALabel ?? coordLabel(waypointA)}
            </div>
          </div>
        </div>
        <div className="my-2 ml-2 h-5 border-l" style={{ borderColor: "var(--md-outline-variant)" }} />
        <div className="flex items-start gap-2">
          <span className="material-symbols-outlined text-[18px]" style={{ color: "var(--md-error)" }}>location_on</span>
          <div className="min-w-0 flex-1">
            <div className="text-[9px] uppercase tracking-wider" style={{ color: "var(--md-on-surface-variant)" }}>Destination</div>
            <div className="truncate text-xs font-medium" style={{ color: "var(--md-on-surface)" }}>{destination}</div>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onArrive}
        disabled={!route}
        className="flex w-full items-center justify-center gap-1 rounded-lg px-3 py-2.5 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        style={{ background: "#22c55e", color: "white" }}
      >
        <span className="material-symbols-outlined text-base">flag</span>
        ARRIVED
      </button>
    </div>
  );
}
