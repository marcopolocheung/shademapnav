import type { RouteOption } from "../lib/routing";

function formatDistance(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(2)} km` : `${Math.round(meters)} m`;
}

interface ArrivalPanelProps {
  route: RouteOption | null;
  waypointBLabel: string | null;
  waypointB: [number, number] | null;
  onPlanAnother: () => void;
  onDone: () => void;
}

export default function ArrivalPanel({
  route,
  waypointBLabel,
  waypointB,
  onPlanAnother,
  onDone,
}: ArrivalPanelProps) {
  const destination = waypointBLabel ?? (waypointB ? `${waypointB[1].toFixed(5)}, ${waypointB[0].toFixed(5)}` : "Destination");

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center justify-between">
        <div className="w-7" />
        <h2 className="text-[13px] font-medium" style={{ color: "var(--md-on-surface)" }}>Arrived</h2>
        <button
          type="button"
          onClick={onDone}
          className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-slate-100"
          style={{ background: "var(--md-surface-container-low)", color: "var(--md-on-surface-variant)" }}
          title="Close"
          aria-label="Close"
        >
          <span className="material-symbols-outlined text-base">close</span>
        </button>
      </div>

      <div
        className="rounded-xl border p-4 text-center"
        style={{
          background: "rgba(34,197,94,0.08)",
          borderColor: "rgba(34,197,94,0.22)",
          color: "var(--md-on-surface)",
        }}
      >
        <span
          className="material-symbols-outlined rounded-full p-3 text-[28px]"
          style={{ background: "#22c55e", color: "white" }}
        >
          flag
        </span>
        <div className="mt-3 text-sm font-semibold">Arrived at {destination}</div>
        {route && (
          <div className="mt-1 text-[11px]" style={{ color: "var(--md-on-surface-variant)" }}>
            {formatDistance(route.distanceM)} route with {Math.round(route.shadeCoverage * 100)}% shade
          </div>
        )}
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onPlanAnother}
          className="flex-1 rounded-lg px-3 py-2 text-xs font-medium transition-colors"
          style={{ background: "var(--md-primary)", color: "var(--md-on-primary)" }}
        >
          Plan another
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-lg px-3 py-2 text-xs font-medium transition-colors"
          style={{ background: "var(--md-surface-container-low)", color: "var(--md-on-surface-variant)" }}
        >
          Done
        </button>
      </div>
    </div>
  );
}
