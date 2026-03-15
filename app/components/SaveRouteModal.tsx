// app/components/SaveRouteModal.tsx
import { useState } from "react";
import { getFolders, createFolder } from "../lib/savedRoutes";
import type { SavedFolder } from "../lib/savedRoutes";

interface Props {
  defaultName: string; // e.g. "Shortest route"
  onSave: (name: string, folderId: string | null) => void;
  onCancel: () => void;
}

export default function SaveRouteModal({ defaultName, onSave, onCancel }: Props) {
  const [name, setName]   = useState(defaultName);
  const [folders, setFolders] = useState<SavedFolder[]>(getFolders);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);

  function handleAddFolder() {
    if (!newFolderName.trim()) return;
    const f = createFolder(newFolderName.trim());
    setFolders(prev => [...prev, f]);
    setFolderId(f.id);
    setNewFolderName("");
    setShowNewFolder(false);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="glass-panel border rounded-xl shadow-2xl w-80 p-5 flex flex-col gap-4">
        <h2 className="panel-heading text-sm">Save Route</h2>

        {/* Name */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-white/50">Name</label>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            className="border rounded px-2 py-1.5 text-xs focus:outline-none"
            style={{ background: 'transparent', color: 'var(--parchment)', borderColor: 'var(--brass-dim)', fontFamily: 'var(--font-serif)' }}
            placeholder="Route name"
          />
        </div>

        {/* Folder */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-white/50">Folder</label>
          <select
            value={folderId ?? ""}
            onChange={e => setFolderId(e.target.value || null)}
            className="border rounded px-2 py-1.5 text-xs focus:outline-none"
            style={{ background: 'var(--glass-bg)', color: 'var(--parchment)', borderColor: 'var(--brass-dim)', fontFamily: 'var(--font-serif)' }}
          >
            <option value="">None</option>
            {folders.map(f => (
              <option key={f.id} value={f.id}>{f.name}</option>
            ))}
          </select>
        </div>

        {/* New folder */}
        {showNewFolder ? (
          <div className="flex gap-2">
            <input
              autoFocus
              value={newFolderName}
              onChange={e => setNewFolderName(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") handleAddFolder(); if (e.key === "Escape") setShowNewFolder(false); }}
              className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-white/80 focus:outline-none focus:border-white/25"
              placeholder="Folder name"
            />
            <button onClick={handleAddFolder} className="text-xs px-2 py-1 rounded bg-amber-500 text-black font-medium hover:bg-amber-400 transition-colors">
              Add
            </button>
            <button onClick={() => setShowNewFolder(false)} className="text-xs px-2 py-1 text-white/40 hover:text-white/70 transition-colors">
              ✕
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowNewFolder(true)}
            className="text-[11px] text-amber-400/70 hover:text-amber-300 self-start transition-colors"
          >
            + New folder
          </button>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <button
            onClick={() => onSave(name.trim() || defaultName, folderId)}
            disabled={!name.trim()}
            className="flex-1 py-1.5 rounded text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            style={{ background: 'var(--brass)', color: 'var(--ink)', fontFamily: 'var(--font-display)' }}
          >
            Save
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded text-xs text-white/60 hover:text-white/90 border border-white/10 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
