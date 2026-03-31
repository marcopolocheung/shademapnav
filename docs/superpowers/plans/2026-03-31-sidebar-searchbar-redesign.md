# Sidebar & Search Bar Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the desktop sidebar collapsible (closed by default, slide animation, pull-tab), reposition the search bar to the fixed top-left, replace the search bar buttons (hamburger left, magnifying glass + directions right), and remove the Luminous Navigator brand and Upgrade to Pro button.

**Architecture:** `sidebarOpen` boolean state lives in `page.tsx` and is passed to `AppShell` (controls slide animation and map margin) and to the desktop `SearchBar` instance (hamburger + directions button callbacks). The pull-tab is a child of the `aside` element, absolutely positioned to poke out the right edge via `translate-x-full`, so it remains visible at the screen edge when the panel is closed.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Material Symbols icon font

---

## File Map

| File | Change |
|------|--------|
| `app/components/SideNav.tsx` | Remove brand header block; remove Upgrade to Pro footer block |
| `app/components/AppShell.tsx` | Add `sidebarOpen` + `onSidebarToggle` props; widen panel to 331px; add slide transform; add pull-tab; update map margin transition |
| `app/components/SearchBar.tsx` | Remove filter/sun/GO buttons; add hamburger (left) and search+directions (right); add `onMenuToggle` + `onDirections` optional props |
| `app/page.tsx` | Add `sidebarOpen` state; add `handleSidebarToggle` + `handleOpenDirections`; fix desktop search bar to `fixed top-4 left-4 z-50`; pass new props to `AppShell` and desktop `SearchBar` |

---

## Task 1: Clean up SideNav

**Files:**
- Modify: `app/components/SideNav.tsx`

- [ ] **Step 1: Remove the brand header block and Upgrade to Pro footer**

Replace the entire component body. The brand header (lines 22–43) and the bottom section (lines 76–91) are deleted. The `p-6` container padding, nav tabs, and phase content area remain unchanged.

```tsx
import type { ReactNode } from "react";

export type SideNavTab = "map" | "directions" | "history" | "saved" | "settings";

interface SideNavProps {
  activeTab: SideNavTab;
  onTabChange: (tab: SideNavTab) => void;
  children: ReactNode;
}

const tabs: { id: SideNavTab; icon: string; label: string }[] = [
  { id: "map", icon: "map", label: "Map" },
  { id: "directions", icon: "directions", label: "Directions" },
  { id: "history", icon: "history", label: "Shadow History" },
  { id: "saved", icon: "bookmark", label: "Saved Routes" },
  { id: "settings", icon: "settings", label: "Settings" },
];

export default function SideNav({ activeTab, onTabChange, children }: SideNavProps) {
  return (
    <div className="flex flex-col h-full p-6">
      {/* Navigation tabs */}
      <nav className="space-y-1">
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onTabChange(tab.id)}
              className={`flex items-center gap-4 px-4 py-3 rounded-xl text-sm tracking-tight w-full text-left transition-all duration-150 active:scale-95 ${
                active
                  ? "text-amber-900 font-bold border-r-4 border-amber-600 bg-amber-50/50"
                  : "text-slate-500 font-medium hover:bg-amber-50 hover:text-amber-700"
              }`}
            >
              <span
                className="material-symbols-outlined text-xl"
                style={active ? { fontVariationSettings: "'FILL' 1" } : undefined}
              >
                {tab.icon}
              </span>
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Phase-dependent content */}
      <div className="mt-6 flex-1 overflow-y-auto overflow-x-hidden md-scrollbar min-h-0">
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the app compiles**

```bash
cd /home/unusn/shademapnav && npm run build 2>&1 | tail -20
```

Expected: no TypeScript errors. Warnings about unused variables are OK.

- [ ] **Step 3: Commit**

```bash
git add app/components/SideNav.tsx
git commit -m "feat: remove Luminous Navigator brand header and Upgrade to Pro button"
```

---

## Task 2: AppShell — collapsible panel with pull-tab

**Files:**
- Modify: `app/components/AppShell.tsx`

- [ ] **Step 1: Rewrite AppShell with slide animation and pull-tab**

Replace the full file content:

```tsx
import { useRef, useEffect, useCallback, type ReactNode } from "react";
import type maplibregl from "maplibre-gl";

interface AppShellProps {
  /** Content for the desktop sidebar (SideNav wrapping phase content) */
  sidebar: ReactNode;
  /** The MapView element */
  map: ReactNode;
  /** Overlays rendered on top of the map (search, timeline, controls, route cards) */
  mapOverlays?: ReactNode;
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  /** Whether the desktop sidebar is open */
  sidebarOpen: boolean;
  /** Called to toggle the sidebar open/closed */
  onSidebarToggle: () => void;
}

/**
 * Responsive layout shell.
 *
 * Desktop (>=768px): collapsible 331px frosted-glass sidebar (slides in/out) | map (flex-1)
 * Mobile (<768px):   full-screen map with overlays + BottomSheet (rendered by caller)
 */
export default function AppShell({
  sidebar,
  map,
  mapRef,
  mapOverlays,
  sidebarOpen,
  onSidebarToggle,
}: AppShellProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);

  const resizeMap = useCallback(() => {
    mapRef.current?.resize();
  }, [mapRef]);

  useEffect(() => {
    const el = mapContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(resizeMap);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [resizeMap]);

  return (
    <div className="relative flex h-screen w-screen overflow-hidden" style={{ background: "var(--md-surface)" }}>
      {/* Collapsible sidebar — desktop only */}
      <aside
        className="hidden md:flex flex-col fixed left-0 top-0 h-full z-40 w-[331px] overflow-hidden"
        style={{
          background: "rgba(248,249,250,0.70)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          boxShadow: "4px 0 24px rgba(130,85,0,0.05)",
          transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 300ms ease-in-out",
        }}
      >
        {sidebar}

        {/* Pull-tab — always visible, rides with panel edge */}
        <button
          onClick={onSidebarToggle}
          className="absolute top-1/2 right-0 -translate-y-1/2 translate-x-full w-8 h-16 rounded-r-xl flex items-center justify-center hover:brightness-95 transition-[filter]"
          style={{
            background: "rgba(248,249,250,0.90)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            boxShadow: "4px 0 16px rgba(130,85,0,0.08)",
          }}
          aria-label={sidebarOpen ? "Close panel" : "Open panel"}
        >
          <span
            className="material-symbols-outlined text-base"
            style={{ color: "var(--md-on-surface-variant)" }}
          >
            {sidebarOpen ? "chevron_left" : "chevron_right"}
          </span>
        </button>
      </aside>

      {/* Map area — margin shifts when sidebar opens */}
      <div
        className="relative flex-1 min-h-0"
        style={{
          marginLeft: sidebarOpen ? "331px" : "0",
          transition: "margin-left 300ms ease-in-out",
        }}
      >
        <div ref={mapContainerRef} className="absolute inset-0 overflow-hidden" style={{ zIndex: 0 }}>
          {map}
          {mapOverlays}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compile**

```bash
cd /home/unusn/shademapnav && npm run build 2>&1 | tail -20
```

Expected: TypeScript error in `page.tsx` because `AppShell` now requires `sidebarOpen` and `onSidebarToggle` props (not yet passed). That error is expected and will be fixed in Task 4.

- [ ] **Step 3: Commit**

```bash
git add app/components/AppShell.tsx
git commit -m "feat: make desktop sidebar collapsible with slide animation and pull-tab"
```

---

## Task 3: SearchBar — new button layout

**Files:**
- Modify: `app/components/SearchBar.tsx`

- [ ] **Step 1: Add new optional props to the interface and swap button layout**

The `SearchBarProps` interface gains two optional callbacks. The pill row changes: hamburger replaces the left search icon; search icon + directions icon move to the right in place of filter, sun, and GO.

Replace lines 10–24 (the interface) with:

```tsx
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
  /** Called when the left menu button is clicked (mobile) */
  onMenu?: () => void;
  /** Optional: also close the panel when user clears the search */
  onClearPanel?: () => void;
  /** Called when the hamburger button is clicked (desktop sidebar toggle) */
  onMenuToggle?: () => void;
  /** Called when the directions button is clicked */
  onDirections?: () => void;
}
```

Then replace the function signature line to destructure the new props:

```tsx
export default function SearchBar({ onSelect, mapCenter, onMenu, onClearPanel, onMenuToggle, onDirections }: SearchBarProps) {
```

- [ ] **Step 2: Replace the pill button row (lines 258–313)**

Replace the entire inner pill div (from `{/* Search icon */}` through the closing `</div>` of the pill at line 313) with:

```tsx
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
```

- [ ] **Step 3: Verify compile**

```bash
cd /home/unusn/shademapnav && npm run build 2>&1 | tail -20
```

Expected: same AppShell error from Task 2 still present (fixed in Task 4), no new errors.

- [ ] **Step 4: Commit**

```bash
git add app/components/SearchBar.tsx
git commit -m "feat: restructure search bar buttons — hamburger left, search+directions right, remove GO/sun/filter"
```

---

## Task 4: page.tsx — wire up state and new props

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add `sidebarOpen` state after `menuOpen`**

Find line 87:
```tsx
  const [menuOpen, setMenuOpen] = useState(false);
```

Add immediately after:
```tsx
  const [sidebarOpen, setSidebarOpen] = useState(false);
```

- [ ] **Step 2: Add `handleSidebarToggle` and `handleOpenDirections` after `handleTabChange`**

Find `handleTabChange` (around line 133). Add after it:

```tsx
  const handleSidebarToggle = () => setSidebarOpen((o) => !o);

  const handleOpenDirections = () => {
    setSidebarOpen(true);
    handleTabChange("directions");
  };
```

- [ ] **Step 3: Replace the desktop search bar container (lines 406–415)**

Find:
```tsx
      {/* Centered floating search pill — desktop */}
      <div
        className="hidden md:block absolute z-30"
        style={{ top: 16, left: "50%", transform: "translateX(-50%)", width: "min(560px, calc(100% - 2rem))" }}
      >
        <SearchBar
          onSelect={handleSearchSelect}
          mapCenter={mapCenter}
        />
      </div>
```

Replace with:
```tsx
      {/* Fixed top-left search pill — desktop */}
      <div
        className="hidden md:block fixed top-4 left-4 z-50"
        style={{ width: "min(480px, calc(100vw - 2rem))" }}
      >
        <SearchBar
          onSelect={handleSearchSelect}
          mapCenter={mapCenter}
          onMenuToggle={handleSidebarToggle}
          onDirections={handleOpenDirections}
        />
      </div>
```

- [ ] **Step 4: Pass `sidebarOpen` and `onSidebarToggle` to AppShell**

Find the `<AppShell` JSX at the bottom of the file (around line 559):
```tsx
  return (
    <AppShell
      mapRef={mapRef}
      sidebar={desktopSidebar}
      map={...}
      mapOverlays={mapOverlays}
    />
  );
```

Add the two new props:
```tsx
  return (
    <AppShell
      mapRef={mapRef}
      sidebar={desktopSidebar}
      sidebarOpen={sidebarOpen}
      onSidebarToggle={handleSidebarToggle}
      map={
        <Suspense fallback={null}>
          <MapView
            date={date}
            accumulation={accumulation}
            onMapReady={handleMapReady}
            onMapClick={handleMapClick}
            navWaypoints={{ a: waypointA ?? undefined, b: waypointB ?? undefined }}
            navRoute={selectedNavRoute}
            showSunLines={showSunLines}
            mapClickActive={pendingSlot !== null}
            onMarkerDragEnd={handleMarkerDragEnd}
            navTrainDrawData={navTrainDrawData}
            navMrtEntrances={navMrtEntrances}
            additionalWaypoints={additionalWaypoints}
            userLocation={userLocation}
            drawMode={drawMode}
            sketchPoints={sketchPoints}
            onSketchPointClick={handleSketchPointClick}
            onSketchPointDrag={handleSketchPointDrag}
            onSketchFinish={handleSketchFinish}
            simplifiedWaypoints={simplifiedWaypoints}
          />
        </Suspense>
      }
      mapOverlays={mapOverlays}
    />
  );
```

- [ ] **Step 5: Full compile check**

```bash
cd /home/unusn/shademapnav && npm run build 2>&1 | tail -30
```

Expected: zero TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add app/page.tsx
git commit -m "feat: wire up sidebarOpen state and fixed search bar position in page.tsx"
```

---

## Verification

- [ ] Run `npm run dev` and open `http://localhost:5173`
- [ ] Page loads: panel is closed, pull-tab visible at left screen edge (mid-height), search bar at top-left with hamburger on left and search+directions icons on right
- [ ] Click pull-tab → panel slides open (331px), map shifts right, tab moves to panel's right edge with left-chevron
- [ ] Click pull-tab again → panel slides closed, map shifts back, tab returns to screen edge with right-chevron
- [ ] Click hamburger in search bar → same result as pull-tab (panel opens)
- [ ] Click directions icon in search bar → panel opens to Directions tab
- [ ] Search bar dropdown works (type a query, results appear)
- [ ] Clear button appears when text is typed, clicking it clears input
- [ ] Panel no longer shows "Luminous Navigator" or "Upgrade to Pro"
- [ ] Mobile layout is completely unchanged (bottom sheet still works)
