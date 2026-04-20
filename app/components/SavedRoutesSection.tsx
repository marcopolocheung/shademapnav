import { useState, memo } from "react";
import type { SavedRoute, SavedFolder } from "../lib/savedRoutes";

interface SavedRoutesSectionProps {
  routes: SavedRoute[];
  folders: SavedFolder[];
  onLoad: (r: SavedRoute) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
}

const SavedRoutesSection = memo(function SavedRoutesSection({
  routes,
  folders,
  onLoad,
  onDelete,
  onRename,
}: SavedRoutesSectionProps) {
  const [open, setOpen] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const uncategorised = routes.filter(r => !r.folderId);
  const byFolder = folders.map(f => ({
    folder: f,
    routes: routes.filter(r => r.folderId === f.id),
  })).filter(g => g.routes.length > 0);

  function commitRename(id: string) {
    if (renameValue.trim()) onRename(id, renameValue.trim());
    setRenamingId(null);
  }

  function renderRoute(r: SavedRoute) {
    const shadePct = Math.round(r.routeOption.shadeCoverage * 100);
    const distKm = r.routeOption.distanceM >= 1000
      ? `${(r.routeOption.distanceM / 1000).toFixed(1)} km`
      : `${Math.round(r.routeOption.distanceM)} m`;
    return (
      <div key={r.id} className="flex items-center gap-1 group">
        {renamingId === r.id ? (
          <input
            autoFocus
            value={renameValue}
            onChange={e => setRenameValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") commitRename(r.id);
              if (e.key === "Escape") setRenamingId(null);
            }}
            onBlur={() => commitRename(r.id)}
            className="flex-1 border rounded px-1.5 py-0.5 text-[11px] focus:outline-none"
            style={{
              background: "var(--md-surface-container-low)",
              color: "var(--md-on-surface)",
              borderColor: "var(--md-primary-container)",
            }}
          />
        ) : (
          <button
            onClick={() => onLoad(r)}
            className="flex-1 text-left px-1.5 py-1 rounded hover:bg-amber-50 transition-colors min-w-0"
          >
            <div className="text-[11px] truncate" style={{ color: "var(--md-on-surface)" }}>{r.name}</div>
            <div className="text-[10px]" style={{ color: "var(--md-on-surface-variant)" }}>{distKm} · {shadePct}% shade</div>
          </button>
        )}
        <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => { setRenamingId(r.id); setRenameValue(r.name); }}
            title="Rename"
            className="p-0.5 text-slate-300 hover:text-slate-600 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">edit</span>
          </button>
          <button
            onClick={() => { if (confirm(`Delete "${r.name}"?`)) onDelete(r.id); }}
            title="Delete"
            className="p-0.5 text-slate-300 hover:text-red-500 transition-colors"
          >
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b pb-2 mb-1" style={{ borderColor: "var(--md-outline-variant)" }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 w-full text-left text-[11px] hover:text-slate-700 transition-colors py-0.5"
        style={{ color: "var(--md-on-surface-variant)" }}
      >
        <span
          className={`material-symbols-outlined text-xs transition-transform ${open ? 'rotate-90' : ''}`}
          style={{ fontSize: 12 }}
        >
          chevron_right
        </span>
        Saved Routes
        <span className="ml-auto" style={{ color: "var(--md-on-surface-variant)", opacity: 0.5 }}>{routes.length}</span>
      </button>

      {open && (
        <div className="flex flex-col mt-1 gap-0">
          {uncategorised.map(renderRoute)}
          {byFolder.map(({ folder, routes: fr }) => (
            <div key={folder.id}>
              <div
                className="text-[10px] px-1.5 pt-1.5 pb-0.5 uppercase tracking-wide"
                style={{ color: "var(--md-on-surface-variant)", opacity: 0.6 }}
              >
                {folder.name}
              </div>
              {fr.map(renderRoute)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export default SavedRoutesSection;
