# Save Routes Feature — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let users save named routes into folders, reload them later, add intermediate waypoints for loops, and export to GPX/GeoJSON.

**Architecture:** All data lives in `localStorage` (no backend). A new `app/lib/savedRoutes.ts` module owns all CRUD. `NavigationPanel.tsx` gains a "Save" button and a saved-routes section. Multi-point waypoints are threaded through `page.tsx` → `MapView.tsx` → route calculation.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, localStorage, existing MapLibre markers, existing Dijkstra pipeline.

---

## Task 1: Storage library (`app/lib/savedRoutes.ts`)

**Files:**
- Create: `app/lib/savedRoutes.ts`

### Step 1: Create the file with types and localStorage helpers

```typescript
// app/lib/savedRoutes.ts
import type { RouteOption } from "./routing";

export interface SavedFolder {
  id: string;
  name: string;
  createdAt: number;
}

export interface SavedRoute {
  id: string;
  name: string;
  folderId: string | null; // null = uncategorised
  routeOption: RouteOption; // full serialised RouteOption (geometry included)
  waypointA: [number, number];
  waypointB: [number, number];
  waypointALabel: string | null;
  waypointBLabel: string | null;
  additionalWaypoints: [number, number][];
  timeOfDayMinutes: number; // 0–1439
  dateIso: string;          // "YYYY-MM-DD"
  createdAt: number;
}

const FOLDERS_KEY = "shademapnav:folders";
const ROUTES_KEY  = "shademapnav:routes";

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function getFolders(): SavedFolder[] {
  return readJSON<SavedFolder[]>(FOLDERS_KEY, []);
}

export function saveFolders(folders: SavedFolder[]): void {
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
}

export function getRoutes(): SavedRoute[] {
  return readJSON<SavedRoute[]>(ROUTES_KEY, []);
}

export function saveRoutes(routes: SavedRoute[]): void {
  localStorage.setItem(ROUTES_KEY, JSON.stringify(routes));
}

export function createFolder(name: string): SavedFolder {
  const folder: SavedFolder = { id: crypto.randomUUID(), name, createdAt: Date.now() };
  saveFolders([...getFolders(), folder]);
  return folder;
}

export function deleteFolder(id: string): void {
  saveFolders(getFolders().filter(f => f.id !== id));
  // orphan routes (set folderId null)
  saveRoutes(getRoutes().map(r => r.folderId === id ? { ...r, folderId: null } : r));
}

export function createRoute(route: Omit<SavedRoute, "id" | "createdAt">): SavedRoute {
  const saved: SavedRoute = { ...route, id: crypto.randomUUID(), createdAt: Date.now() };
  saveRoutes([...getRoutes(), saved]);
  return saved;
}

export function updateRoute(id: string, patch: Partial<SavedRoute>): void {
  saveRoutes(getRoutes().map(r => r.id === id ? { ...r, ...patch } : r));
}

export function deleteRoute(id: string): void {
  saveRoutes(getRoutes().filter(r => r.id !== id));
}
```

### Step 2: Verify TypeScript compiles

```bash
cd /home/unusn/shademapnav && npx tsc --noEmit 2>&1 | head -40
```

Expected: no errors (or only pre-existing errors unrelated to the new file).

### Step 3: Commit

```bash
git add app/lib/savedRoutes.ts
git commit -m "feat: add savedRoutes storage library (localStorage CRUD)"
```

---

## Task 2: Save Route modal component (`app/components/SaveRouteModal.tsx`)

**Files:**
- Create: `app/components/SaveRouteModal.tsx`

### Step 1: Write the modal

```tsx
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
      <div className="bg-[#1a1a1a] border border-white/10 rounded-xl shadow-2xl w-80 p-5 flex flex-col gap-4">
        <h2 className="text-white/90 text-sm font-semibold">Save Route</h2>

        {/* Name */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-white/50">Name</label>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-white/80 focus:outline-none focus:border-white/25"
            placeholder="Route name"
          />
        </div>

        {/* Folder */}
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-white/50">Folder</label>
          <select
            value={folderId ?? ""}
            onChange={e => setFolderId(e.target.value || null)}
            className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-white/80 focus:outline-none focus:border-white/25"
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
            className="flex-1 py-1.5 rounded text-xs font-medium bg-amber-500 text-black hover:bg-amber-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
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
```

### Step 2: TypeScript check

```bash
cd /home/unusn/shademapnav && npx tsc --noEmit 2>&1 | head -40
```

Expected: no new errors.

### Step 3: Commit

```bash
git add app/components/SaveRouteModal.tsx
git commit -m "feat: add SaveRouteModal component (name + folder picker)"
```

---

## Task 3: Save button + modal wiring in NavigationPanel

**Files:**
- Modify: `app/components/NavigationPanel.tsx`

The goal is: add a "Save" button beneath each route card; clicking it opens `SaveRouteModal` via a callback to the parent (`page.tsx` owns the modal so it can access current time/date/waypoint state).

### Step 1: Add `onSaveRoute` prop to `NavigationPanelProps`

In `app/components/NavigationPanel.tsx`, find the `NavigationPanelProps` interface (line ~5) and add:

```typescript
  onSaveRoute?: (routeIndex: number) => void;
```

### Step 2: Destructure `onSaveRoute` in the function signature (line ~253)

Add `onSaveRoute` after `locationSearchSlot`:

```typescript
  locationSearchSlot,
  onSaveRoute,
```

### Step 3: Add Save button inside the route card map loop

Find the route cards section (around line 397–483). Inside the `routes.map((r, i) => { ... })` block, after the closing `</button>` for the route card but still inside the wrapping `<div className="flex flex-col gap-1 ...">`, add a save button per card.

Replace the existing route card `<button>` with a wrapper `<div>` containing the card button + a save icon button:

The route card currently is:
```tsx
<button key={i} onClick={() => onSelectRoute(i)} className="...">
  ...
</button>
```

Change to:
```tsx
<div key={i} className="flex gap-1 items-start">
  <button
    onClick={() => onSelectRoute(i)}
    className={`flex-1 text-left px-2 py-1.5 rounded text-xs transition-all ${
      i === selectedRouteIndex
        ? 'bg-amber-500/20 border border-amber-500 shadow-sm shadow-amber-500/20'
        : 'border border-white/10 hover:border-white/25 hover:bg-white/[0.03]'
    }`}
  >
    {/* ... existing card content unchanged ... */}
  </button>
  {onSaveRoute && (
    <button
      onClick={() => onSaveRoute(i)}
      title="Save this route"
      className="shrink-0 mt-0.5 p-1.5 rounded text-white/25 hover:text-amber-400 hover:bg-amber-400/10 border border-transparent hover:border-amber-400/20 transition-all"
    >
      <svg width="11" height="13" viewBox="0 0 11 13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 1h9v11L5.5 9.5 1 12V1z"/>
      </svg>
    </button>
  )}
</div>
```

Note: the `key={i}` moves from the inner `<button>` to the outer `<div>`.

### Step 4: TypeScript check

```bash
cd /home/unusn/shademapnav && npx tsc --noEmit 2>&1 | head -40
```

### Step 5: Commit

```bash
git add app/components/NavigationPanel.tsx
git commit -m "feat: add save-route button to NavigationPanel route cards"
```

---

## Task 4: Wire Save modal in `page.tsx`

**Files:**
- Modify: `app/page.tsx`

### Step 1: Import new modules at top of `page.tsx`

Add after existing imports:
```typescript
import SaveRouteModal from "./components/SaveRouteModal";
import { createRoute } from "./lib/savedRoutes";
```

### Step 2: Add state for the save modal

Find the state declarations block. Add:
```typescript
const [saveModalRouteIndex, setSaveModalRouteIndex] = useState<number | null>(null);
```

### Step 3: Add `handleSaveRoute` callback

Find `calculateRoute` or the `onClear` handler. Add a new function:
```typescript
function handleOpenSaveModal(routeIndex: number) {
  setSaveModalRouteIndex(routeIndex);
}

function handleConfirmSave(name: string, folderId: string | null) {
  if (saveModalRouteIndex === null) return;
  const route = routes[saveModalRouteIndex];
  if (!route || !waypointA || !waypointB) return;
  createRoute({
    name,
    folderId,
    routeOption: route,
    waypointA,
    waypointB,
    waypointALabel: waypointALabel ?? null,
    waypointBLabel: waypointBLabel ?? null,
    additionalWaypoints: [],
    timeOfDayMinutes: Math.floor((date.getHours() * 60) + date.getMinutes()),
    dateIso: toDateInput(date),
  });
  setSaveModalRouteIndex(null);
}
```

Note: `toDateInput` already exists as a module-level helper in `page.tsx`.

### Step 4: Pass `onSaveRoute` prop to `<NavigationPanel>`

Find where `<NavigationPanel>` is rendered and add:
```tsx
onSaveRoute={handleOpenSaveModal}
```

### Step 5: Render `<SaveRouteModal>` conditionally

Near the bottom of the JSX, just before the closing root `<div>`, add:
```tsx
{saveModalRouteIndex !== null && routes[saveModalRouteIndex] && (
  <SaveRouteModal
    defaultName={routes[saveModalRouteIndex].label}
    onSave={handleConfirmSave}
    onCancel={() => setSaveModalRouteIndex(null)}
  />
)}
```

### Step 6: TypeScript check

```bash
cd /home/unusn/shademapnav && npx tsc --noEmit 2>&1 | head -40
```

### Step 7: Manual test

Run `npm run dev`, generate a route, click the bookmark icon on a route card. Modal should appear. Enter a name, optionally create a folder, click Save. Modal closes. Open browser devtools → Application → localStorage → look for key `shademapnav:routes` — should have an entry.

### Step 8: Commit

```bash
git add app/page.tsx
git commit -m "feat: wire save-route modal in page.tsx — saves to localStorage"
```

---

## Task 5: Saved Routes sidebar section in NavigationPanel

**Files:**
- Modify: `app/components/NavigationPanel.tsx`

This adds a collapsible "Saved Routes" section at the top of the nav panel's scrollable body, showing folders and routes. Clicking a route calls a new `onLoadRoute` prop.

### Step 1: Add new props to `NavigationPanelProps`

```typescript
  savedRoutes?: import("../lib/savedRoutes").SavedRoute[];
  savedFolders?: import("../lib/savedRoutes").SavedFolder[];
  onLoadRoute?: (route: import("../lib/savedRoutes").SavedRoute) => void;
  onDeleteSavedRoute?: (id: string) => void;
  onRenameSavedRoute?: (id: string, name: string) => void;
```

### Step 2: Destructure in the function signature

Add all five after `onSaveRoute`.

### Step 3: Add the saved-routes section before the waypoint rows in the scrollable body

Inside the `<div className="flex-1 overflow-y-auto ...">`, add at the **top** (before the waypoint rows `<div className="flex flex-col gap-1 text-xs">`):

```tsx
{/* Saved Routes section */}
{savedRoutes && savedRoutes.length > 0 && (
  <SavedRoutesSection
    routes={savedRoutes}
    folders={savedFolders ?? []}
    onLoad={onLoadRoute ?? (() => {})}
    onDelete={onDeleteSavedRoute ?? (() => {})}
    onRename={onRenameSavedRoute ?? (() => {})}
  />
)}
```

### Step 4: Implement `SavedRoutesSection` as a local component (add above `NavigationPanel` default export)

```tsx
function SavedRoutesSection({
  routes,
  folders,
  onLoad,
  onDelete,
  onRename,
}: {
  routes: import("../lib/savedRoutes").SavedRoute[];
  folders: import("../lib/savedRoutes").SavedFolder[];
  onLoad: (r: import("../lib/savedRoutes").SavedRoute) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // Group routes: uncategorised first, then by folder
  const uncategorised = routes.filter(r => !r.folderId);
  const byFolder = folders.map(f => ({
    folder: f,
    routes: routes.filter(r => r.folderId === f.id),
  })).filter(g => g.routes.length > 0);

  function commitRename(id: string) {
    if (renameValue.trim()) onRename(id, renameValue.trim());
    setRenamingId(null);
  }

  function renderRoute(r: import("../lib/savedRoutes").SavedRoute) {
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
            className="flex-1 bg-white/5 border border-amber-400/40 rounded px-1.5 py-0.5 text-[11px] text-white/80 focus:outline-none"
          />
        ) : (
          <button
            onClick={() => onLoad(r)}
            className="flex-1 text-left px-1.5 py-1 rounded hover:bg-white/5 transition-colors min-w-0"
          >
            <div className="text-[11px] text-white/70 truncate">{r.name}</div>
            <div className="text-[10px] text-white/30">{distKm} · {shadePct}% shade</div>
          </button>
        )}
        {/* Rename / Delete controls on hover */}
        <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
          <button
            onClick={() => { setRenamingId(r.id); setRenameValue(r.name); }}
            title="Rename"
            className="p-0.5 text-white/20 hover:text-white/60 transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 9h2L8.5 2.5a1.06 1.06 0 0 0-1.5-1.5L1 7.5V9z"/>
            </svg>
          </button>
          <button
            onClick={() => { if (confirm(`Delete "${r.name}"?`)) onDelete(r.id); }}
            title="Delete"
            className="p-0.5 text-white/20 hover:text-red-400 transition-colors"
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="2" y1="2" x2="8" y2="8"/><line x1="8" y1="2" x2="2" y2="8"/>
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="border-b border-white/[0.07] pb-2 mb-1">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 w-full text-left text-[11px] text-white/40 hover:text-white/70 transition-colors py-0.5"
      >
        <svg
          width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor"
          strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
          className={`transition-transform ${open ? 'rotate-90' : ''}`}
        >
          <polyline points="2,1 6,4 2,7"/>
        </svg>
        Saved Routes
        <span className="ml-auto text-white/20">{routes.length}</span>
      </button>

      {open && (
        <div className="flex flex-col mt-1 gap-0">
          {/* Uncategorised */}
          {uncategorised.map(renderRoute)}
          {/* By folder */}
          {byFolder.map(({ folder, routes: fr }) => (
            <div key={folder.id}>
              <div className="text-[10px] text-white/25 px-1.5 pt-1.5 pb-0.5 uppercase tracking-wide">
                {folder.name}
              </div>
              {fr.map(renderRoute)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

### Step 5: TypeScript check

```bash
cd /home/unusn/shademapnav && npx tsc --noEmit 2>&1 | head -40
```

### Step 6: Commit

```bash
git add app/components/NavigationPanel.tsx
git commit -m "feat: add Saved Routes section to NavigationPanel sidebar"
```

---

## Task 6: Wire saved routes state in `page.tsx`

**Files:**
- Modify: `app/page.tsx`

### Step 1: Import storage helpers

Add to existing savedRoutes import:
```typescript
import { createRoute, getRoutes, getFolders, updateRoute, deleteRoute } from "./lib/savedRoutes";
import type { SavedRoute, SavedFolder } from "./lib/savedRoutes";
```

### Step 2: Add state for saved routes/folders

```typescript
const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>(() => getRoutes());
const [savedFolders, setSavedFolders] = useState<SavedFolder[]>(() => getFolders());
```

### Step 3: Update `handleConfirmSave` to refresh state

Replace the existing `handleConfirmSave` (from Task 4):
```typescript
function handleConfirmSave(name: string, folderId: string | null) {
  if (saveModalRouteIndex === null) return;
  const route = routes[saveModalRouteIndex];
  if (!route || !waypointA || !waypointB) return;
  createRoute({
    name,
    folderId,
    routeOption: route,
    waypointA,
    waypointB,
    waypointALabel: waypointALabel ?? null,
    waypointBLabel: waypointBLabel ?? null,
    additionalWaypoints: [],
    timeOfDayMinutes: Math.floor((date.getHours() * 60) + date.getMinutes()),
    dateIso: toDateInput(date),
  });
  setSavedRoutes(getRoutes());
  setSavedFolders(getFolders());
  setSaveModalRouteIndex(null);
}
```

### Step 4: Add `handleLoadRoute`

```typescript
function handleLoadRoute(saved: SavedRoute) {
  // 1. Restore waypoints
  setWaypointA(saved.waypointA);
  setWaypointB(saved.waypointB);
  setWaypointALabel(saved.waypointALabel);
  setWaypointBLabel(saved.waypointBLabel);
  // 2. Show the saved route geometry directly (no recalculation)
  setRoutes([saved.routeOption]);
  setSelectedRouteIndex(0);
  // 3. Restore time/date
  const d = new Date(saved.dateIso + "T00:00:00");
  d.setHours(Math.floor(saved.timeOfDayMinutes / 60), saved.timeOfDayMinutes % 60, 0, 0);
  setDate(d);
}
```

Note: Check what state variables are called in the actual `page.tsx` for `waypointA`, `waypointALabel`, `routes`, etc. — use `grep` before writing if unsure.

### Step 5: Add `handleDeleteSavedRoute` and `handleRenameSavedRoute`

```typescript
function handleDeleteSavedRoute(id: string) {
  deleteRoute(id);
  setSavedRoutes(getRoutes());
}

function handleRenameSavedRoute(id: string, name: string) {
  updateRoute(id, { name });
  setSavedRoutes(getRoutes());
}
```

### Step 6: Pass all new props to `<NavigationPanel>`

```tsx
savedRoutes={savedRoutes}
savedFolders={savedFolders}
onLoadRoute={handleLoadRoute}
onDeleteSavedRoute={handleDeleteSavedRoute}
onRenameSavedRoute={handleRenameSavedRoute}
```

### Step 7: TypeScript check

```bash
cd /home/unusn/shademapnav && npx tsc --noEmit 2>&1 | head -40
```

### Step 8: Manual test

- Save a route
- Reload the page
- Open Navigate — saved route appears in the section
- Click the route — waypoints restore, route line appears on map

### Step 9: Commit

```bash
git add app/page.tsx
git commit -m "feat: wire saved routes load/delete/rename in page.tsx"
```

---

## Task 7: Multi-point waypoints (Alt+click to add intermediate waypoints)

This enables loop routes: A → W1 → W2 → B.

**Files:**
- Modify: `app/page.tsx`
- Modify: `app/components/MapView.tsx`
- Modify: `app/components/NavigationPanel.tsx`

### Step 1: Add state in `page.tsx`

```typescript
const [additionalWaypoints, setAdditionalWaypoints] = useState<[number, number][]>([]);
```

### Step 2: Modify `onMapClick` handler in `page.tsx`

Find where `onMapClick` is defined (it handles placing A/B on map clicks). Add logic:

```typescript
// Inside the existing map click handler, AFTER the existing A/B placement:
// If nav mode is on and A+B are already set, Alt+click adds intermediate waypoint
if (navMode && waypointA && waypointB && event.originalEvent?.altKey) {
  const lngLat: [number, number] = [event.lngLat.lng, event.lngLat.lat];
  setAdditionalWaypoints(prev => [...prev, lngLat]);
  return;
}
```

### Step 3: Thread `additionalWaypoints` into route calculation in `page.tsx`

Find `calculateRoute`. The existing pipeline routes A→B. For multi-point, chain segments:
`A → W[0] → W[1] → ... → B`

Before the existing Dijkstra calls, add:

```typescript
// Build ordered point list: [A, ...additionalWaypoints, B]
const allPoints: [number, number][] = [waypointA, ...additionalWaypoints, waypointB];
```

Then for each adjacent pair `(allPoints[i], allPoints[i+1])`, run `snapToGraph` + `dijkstra`. Merge the resulting route segments by concatenating their `nodeIds` (de-duping the junction node) and summing `distanceM`/`shadeCoverage`.

The exact merge logic — because this is the most complex part — is described in comments within the code. The key insight: run Dijkstra independently for each segment, then stitch results together into a single `RouteOption`.

Add a helper in `page.tsx`:

```typescript
async function routeSegment(
  graph: RoutingGraph,
  imageData: ImageData,
  dpr: number,
  from: [number, number],
  to: [number, number],
  shadeStrength: number,
  map: maplibregl.Map
): Promise<RouteResult | null> {
  const snapFrom = snapToGraph(from, graph);
  const snapTo   = snapToGraph(to, graph);
  if (!snapFrom || !snapTo) return null;
  // Fill shade factors (reuse existing sampleEdgeShade logic)
  for (const [nodeId, edges] of graph.adj) {
    const fromNode = graph.nodes.get(nodeId);
    if (!fromNode) continue;
    for (const edge of edges) {
      const toNode = graph.nodes.get(edge.toId);
      if (!toNode) continue;
      edge.shadeFactor = sampleEdgeShade(map, imageData, dpr,
        [fromNode.lon, fromNode.lat], [toNode.lon, toNode.lat]);
    }
  }
  return dijkstra(graph, snapFrom, snapTo, shadeStrength);
}
```

Then call this per-segment and merge. The merged `geojson` is produced by concatenating coordinate arrays from `graphToGeoJSON(graph, result)`.

### Step 4: Pass `additionalWaypoints` to `MapView`

In `MapView.tsx`, add a prop:
```typescript
additionalWaypoints?: [number, number][];
```

Add a `useEffect` that places numbered grey `Marker` elements for each waypoint (using `markerWpRefs` array):

```typescript
const markerWpRefs = useRef<maplibregl.Marker[]>([]);

useEffect(() => {
  if (!mapRef.current) return;
  // Remove old waypoint markers
  markerWpRefs.current.forEach(m => m.remove());
  markerWpRefs.current = [];
  (additionalWaypoints ?? []).forEach((wp, i) => {
    const el = document.createElement("div");
    el.style.cssText = `
      width:22px;height:22px;border-radius:50%;
      background:#6b7280;border:2px solid white;
      display:flex;align-items:center;justify-content:center;
      font-size:10px;font-weight:700;color:white;cursor:pointer;
    `;
    el.textContent = String(i + 1);
    const marker = new maplibregl.Marker({ element: el })
      .setLngLat(wp)
      .addTo(mapRef.current!);
    markerWpRefs.current.push(marker);
  });
}, [additionalWaypoints]);
```

### Step 5: Show intermediate waypoint list in NavigationPanel

Add a new prop `additionalWaypoints?: [number, number][]` and `onRemoveAdditionalWaypoint?: (index: number) => void`.

Below the Waypoint B row, if `additionalWaypoints.length > 0`, show a small list:

```tsx
{(additionalWaypoints ?? []).length > 0 && (
  <div className="pl-4 flex flex-col gap-0.5 text-[10px] text-white/40">
    <span className="text-[10px] text-white/25 mb-0.5">Waypoints (Alt+click on map)</span>
    {(additionalWaypoints ?? []).map((wp, i) => (
      <div key={i} className="flex items-center gap-1">
        <span className="w-4 h-4 rounded-full bg-slate-600 text-white text-[9px] flex items-center justify-center">{i+1}</span>
        <span className="flex-1 tabular-nums">{wp[1].toFixed(5)}, {wp[0].toFixed(5)}</span>
        <button
          onClick={() => onRemoveAdditionalWaypoint?.(i)}
          className="text-white/20 hover:text-red-400 transition-colors px-0.5"
        >×</button>
      </div>
    ))}
  </div>
)}
```

### Step 6: Wire removal in `page.tsx`

```typescript
function handleRemoveAdditionalWaypoint(index: number) {
  setAdditionalWaypoints(prev => prev.filter((_, i) => i !== index));
}
```

Pass `additionalWaypoints` and `onRemoveAdditionalWaypoint={handleRemoveAdditionalWaypoint}` to `<NavigationPanel>` and `additionalWaypoints` to `<MapView>`.

### Step 7: TypeScript check

```bash
cd /home/unusn/shademapnav && npx tsc --noEmit 2>&1 | head -40
```

### Step 8: Manual test

1. Generate a normal A→B route — works as before
2. With A+B set, Alt+click two points on the map — numbered grey markers appear
3. Click "Find Shaded Route" — route follows A→W1→W2→B path

### Step 9: Commit

```bash
git add app/page.tsx app/components/MapView.tsx app/components/NavigationPanel.tsx
git commit -m "feat: multi-point waypoints for loop routes (Alt+click to add)"
```

---

## Task 8: GPX/GeoJSON Export

**Files:**
- Modify: `app/components/NavigationPanel.tsx`
- Create: `app/lib/exportRoute.ts`

### Step 1: Create export helpers

```typescript
// app/lib/exportRoute.ts
import type { RouteOption } from "./routing";

export function routeToGeoJSON(route: RouteOption): string {
  const fc: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [route.geojson],
  };
  return JSON.stringify(fc, null, 2);
}

export function routeToGPX(route: RouteOption, name: string): string {
  const coords = route.geojson.geometry.coordinates as [number, number][];
  const trkpts = coords
    .map(([lon, lat]) => `    <trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"/>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="ShadeMapNavigator" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

export function downloadBlob(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
```

### Step 2: Add export buttons to route cards in NavigationPanel

Add a new prop:
```typescript
onExportRoute?: (routeIndex: number, format: "gpx" | "geojson") => void;
```

Inside the route card wrapper `<div>` (added in Task 3), add a small export dropdown after the save button:

```tsx
{onExportRoute && (
  <div className="relative group/export shrink-0 mt-0.5">
    <button
      className="p-1.5 rounded text-white/25 hover:text-white/60 transition-colors"
      title="Export route"
    >
      <svg width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M5.5 1v7M2 5l3.5 3.5L9 5"/><line x1="1" y1="10" x2="10" y2="10"/>
      </svg>
    </button>
    <div className="hidden group-hover/export:flex absolute right-0 top-full mt-1 flex-col bg-[#1a1a1a] border border-white/10 rounded shadow-xl z-30 min-w-max">
      <button onClick={() => onExportRoute(i, "gpx")} className="px-3 py-1.5 text-[11px] text-white/70 hover:bg-white/5 text-left transition-colors">GPX</button>
      <button onClick={() => onExportRoute(i, "geojson")} className="px-3 py-1.5 text-[11px] text-white/70 hover:bg-white/5 text-left transition-colors">GeoJSON</button>
    </div>
  </div>
)}
```

### Step 3: Wire export in `page.tsx`

Import helpers and add handler:
```typescript
import { routeToGPX, routeToGeoJSON, downloadBlob } from "./lib/exportRoute";

function handleExportRoute(routeIndex: number, format: "gpx" | "geojson") {
  const route = routes[routeIndex];
  if (!route) return;
  const name = route.label;
  if (format === "gpx") {
    downloadBlob(routeToGPX(route, name), `${name}.gpx`, "application/gpx+xml");
  } else {
    downloadBlob(routeToGeoJSON(route), `${name}.geojson`, "application/geo+json");
  }
}
```

Pass `onExportRoute={handleExportRoute}` to `<NavigationPanel>`.

### Step 4: TypeScript check

```bash
cd /home/unusn/shademapnav && npx tsc --noEmit 2>&1 | head -40
```

### Step 5: Manual test

Generate a route. Hover the card — export icon appears. Click → GPX/GeoJSON dropdown. Click GPX — file downloads. Open in a text editor — valid GPX with `<trkpt>` entries.

### Step 6: Commit

```bash
git add app/lib/exportRoute.ts app/components/NavigationPanel.tsx app/page.tsx
git commit -m "feat: GPX and GeoJSON export for route cards"
```

---

## Task 9: Update savedRoutes to include additionalWaypoints on save

**Files:**
- Modify: `app/page.tsx`

### Step 1: Update `handleConfirmSave` to include `additionalWaypoints`

In the `handleConfirmSave` function (Task 4/6), change:
```typescript
additionalWaypoints: [],
```
to:
```typescript
additionalWaypoints: additionalWaypoints,
```

### Step 2: Update `handleLoadRoute` to restore `additionalWaypoints`

```typescript
setAdditionalWaypoints(saved.additionalWaypoints ?? []);
```

### Step 3: TypeScript check + commit

```bash
cd /home/unusn/shademapnav && npx tsc --noEmit 2>&1 | head -40
git add app/page.tsx
git commit -m "feat: persist additionalWaypoints when saving/loading routes"
```

---

## Task 10: Update CLAUDE.md Known Working State

**Files:**
- Modify: `.claude/CLAUDE.md`

Add to the "Known Working State" checklist:
```
- ✅ Save Route: bookmark routes with names, folders, and sun conditions (localStorage)
- ✅ Multi-point waypoints for loop routes (Alt+click on map)
- ✅ GPX and GeoJSON export for generated routes
```

### Commit

```bash
git add .claude/CLAUDE.md
git commit -m "docs: update CLAUDE.md with save-routes feature status"
```

---

## Summary of new files

| File | Purpose |
|---|---|
| `app/lib/savedRoutes.ts` | CRUD helpers, localStorage schema |
| `app/lib/exportRoute.ts` | GPX/GeoJSON serializers + download helper |
| `app/components/SaveRouteModal.tsx` | Name + folder picker modal |

## Modified files

| File | Changes |
|---|---|
| `app/components/NavigationPanel.tsx` | Save button, saved routes section, export buttons |
| `app/page.tsx` | State, handlers, prop wiring |
| `app/components/MapView.tsx` | Intermediate waypoint markers |
| `.claude/CLAUDE.md` | Known working state update |
