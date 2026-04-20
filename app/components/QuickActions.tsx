interface QuickActionsProps {
  onNavigate: () => void;
  onDrawRoute: () => void;
  drawMode: boolean;
}

export default function QuickActions({ onNavigate, onDrawRoute, drawMode }: QuickActionsProps) {
  return (
    <div className="p-4 rounded-xl" style={{ background: "var(--md-surface-container-low)", border: "1px solid rgba(215,195,172,0.1)" }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full bg-slate-300 animate-pulse" />
        <span className="text-[10px] uppercase tracking-widest font-bold text-slate-400">Device Idle</span>
      </div>
      <h3 className="text-sm font-bold mb-2" style={{ color: "var(--md-on-surface)" }}>Quick Entry</h3>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={onNavigate}
          className="flex flex-col items-center justify-center p-3 bg-white shadow-sm rounded-xl hover:bg-amber-50 transition-colors"
        >
          <span className="material-symbols-outlined text-amber-700 mb-1">route</span>
          <span className="text-[10px] font-bold" style={{ color: "var(--md-on-surface)" }}>Directions</span>
        </button>
        <button
          onClick={onDrawRoute}
          className={`flex flex-col items-center justify-center p-3 shadow-sm rounded-xl transition-colors ${
            drawMode ? "bg-amber-50 ring-1 ring-amber-300" : "bg-white hover:bg-amber-50"
          }`}
        >
          <span className="material-symbols-outlined text-amber-700 mb-1">draw</span>
          <span className="text-[10px] font-bold" style={{ color: "var(--md-on-surface)" }}>Draw Route</span>
        </button>
      </div>
    </div>
  );
}
