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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div
        className="rounded-2xl shadow-2xl w-80 p-5 flex flex-col gap-4 border"
        style={{
          background: "white",
          borderColor: "var(--md-outline-variant)",
          fontFamily: "var(--md-font)",
        }}
      >
        <h2 className="text-sm font-bold" style={{ color: "var(--md-on-surface)" }}>Save Route</h2>

        {/* Name */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px]" style={{ color: "var(--md-on-surface-variant)" }}>Name</label>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            className="border rounded px-2 py-1.5 text-xs focus:outline-none"
            style={{
              background: "var(--md-surface-container-low)",
              color: "var(--md-on-surface)",
              borderColor: "var(--md-outline-variant)",
              fontFamily: "var(--md-font)",
            }}
            placeholder="Route name"
          />
        </div>

        {/* Folder */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px]" style={{ color: "var(--md-on-surface-variant)" }}>Folder</label>
          <select
            value={folderId ?? ""}
            onChange={e => setFolderId(e.target.value || null)}
            className="border rounded px-2 py-1.5 text-xs focus:outline-none"
            style={{
              background: "white",
              color: "var(--md-on-surface)",
              borderColor: "var(--md-outline-variant)",
              fontFamily: "var(--md-font)",
            }}
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
              className="flex-1 border rounded px-2 py-1 text-xs focus:outline-none"
              style={{
                background: "var(--md-surface-container-low)",
                color: "var(--md-on-surface)",
                borderColor: "var(--md-outline-variant)",
              }}
              placeholder="Folder name"
            />
            <button
              onClick={handleAddFolder}
              className="text-xs px-2 py-1 rounded font-medium transition-colors"
              style={{ background: "var(--md-primary-container)", color: "var(--md-on-surface)" }}
            >
              Add
            </button>
            <button onClick={() => setShowNewFolder(false)} className="text-xs px-2 py-1 text-slate-400 hover:text-slate-700 transition-colors">
              <span className="material-symbols-outlined text-sm">close</span>
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowNewFolder(true)}
            className="text-[11px] hover:text-amber-700 self-start transition-colors"
            style={{ color: "var(--md-primary)" }}
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
            style={{ background: "var(--md-primary)", color: "var(--md-on-primary)" }}
          >
            Save
          </button>
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded text-xs text-slate-600 hover:text-slate-900 border transition-colors"
            style={{ borderColor: "var(--md-outline-variant)" }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
