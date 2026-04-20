# Directions Panel — Implementation To-Do

> Ingest order: complete each task top to bottom. Each task is self-contained with clear acceptance criteria.

---

## 1. Create `DirectionsPanel.tsx` (new component)

**File:** `app/components/DirectionsPanel.tsx`

Build a floating panel that mirrors the mockup layout. It is always rendered as an overlay on top of the map (not in a sidebar slot), positioned `top: 12px; left: 12px` with `position: absolute` and a fixed width of `300px`.

### 1a. Panel structure (top to bottom)

```
┌─────────────────────────────┐
│ ← Directions   [Walk|Transit]│  ← header row
├─────────────────────────────┤
│ ● [Starting point input    ] │
│ ─────────────────────────── │
│ ● [Destination input    ] [⇅]│  ← swap button
├─────────────────────────────┤
│ Route input  [Search | Draw] │  ← segmented control
├─────────────────────────────┤
│ Shade preference             │
│ Fastest ───●─────── Shadiest │  ← single slider
├─────────────────────────────┤
│ [route cards — see §1c]      │
└─────────────────────────────┘
```

### 1b. Props interface

```ts
interface DirectionsPanelProps {
  onClose: () => void;
  onSearch: (origin: string, destination: string) => void;
  onSwapWaypoints: () => void;
  originValue: string;
  destinationValue: string;
  onOriginChange: (val: string) => void;
  onDestinationChange: (val: string) => void;
  drawMode: boolean;
  onDrawModeToggle: (active: boolean) => void;
  shadeStrength: number;                   // 0.0 (fastest) → 1.0 (most shaded)
  onShadeStrengthChange: (v: number) => void;
  routeMode: 'walk' | 'transit';
  onRouteModeChange: (mode: 'walk' | 'transit') => void;
  routes: RouteCard[];                     // see §1c
  selectedRouteIndex: number;
  onSelectRoute: (i: number) => void;
}
```

### 1c. Route cards

Show up to 3 cards (Shortest / Balanced / Most shaded) below the shade slider. Each card shows:
- Title (bold, 12px)
- Distance, % shaded, estimated minutes (muted, 11px)
- Optional "Recommended" badge (info color) on the Balanced card

The currently selected card gets a `1.5px solid #1a73e8` border; others get the standard `0.5px` border.

### 1d. Shade preference slider

- Standard `<input type="range" min="0" max="1" step="0.01">` 
- Label row above: left-aligned "Shade preference", right-aligned current label ("Fastest" / "Balanced" / "Most shaded") derived from the value
- Axis labels below: "Fastest" left, "Most shaded" right (10px, muted)
- Changing the slider calls `onShadeStrengthChange` and re-runs routing automatically (debounced 300 ms)

### 1e. Draw mode toggle

Segmented control (`Search | Draw`) in the "Route input" row:
- When **Draw** is active: destination input dims to 40% opacity with placeholder "Tap map to sketch route"; a small "Clear sketch" text button appears to its right
- When switching back to **Search**: clear sketch points and restore destination input
- The toggle calls `onDrawModeToggle`

### 1f. Walk / Transit tabs

Two tabs in the panel header right side. Switching calls `onRouteModeChange` and clears existing route cards. Transit tab is only enabled when straight-line distance between waypoints > 500 m (disable + tooltip otherwise: "Too close for transit").

### 1g. Visual styling rules

- Floating card: `background: var(--color-background-primary)`, `border-radius: var(--border-radius-lg)`, `border: 0.5px solid var(--color-border-tertiary)`, no drop shadow
- All internal dividers: `0.5px solid var(--color-border-tertiary)`
- Origin dot: `#22c55e` (green); Destination dot: `#ef4444` (red); both 10px circles
- Back arrow button: 28px circle, secondary background
- Swap button: 26px circle, secondary background, positioned at right of waypoints block
- Font sizes: header title 13px/500, input fields 13px, section labels 11px/tertiary, axis labels 10px/tertiary

---

## 2. Wire `DirectionsPanel` into `AppShell.tsx`

**File:** `app/components/AppShell.tsx`

### 2a. Trigger

Add a "Directions" button to the existing search bar row (desktop) and to the mobile quick actions bar. Pressing it sets a new boolean state `directionsOpen` to `true`.

### 2b. Rendering

When `directionsOpen === true`:
- Render `<DirectionsPanel>` as an absolutely-positioned overlay (not inside the sidebar flow)
- Hide or collapse the main search bar to avoid overlap
- The panel's `onClose` sets `directionsOpen` back to `false` and clears all routing state

### 2c. Mobile behaviour

On mobile (`width < 768px`), the panel renders as a bottom sheet occupying the top ~65% of the screen height, leaving the timeline bar visible below it. Use `position: absolute; bottom: 64px; left: 0; right: 0` (64px = timeline bar height). Width becomes 100% on mobile; the floating `top/left` positioning only applies on desktop.

---

## 3. Keep the timeline bar always visible

**File:** `app/components/AppShell.tsx` / `app/page.tsx`

The timeline bar must not be covered by the directions panel in any layout:

- Desktop: panel is `300px` wide and positioned top-left; timeline spans the full bottom — no conflict. Verify `z-index` ordering so timeline sits above any map layers but below the panel.
- Mobile: ensure the panel's bottom edge stops at `64px` from the bottom (the timeline height). Add a CSS rule preventing the panel from growing taller than `calc(100vh - 64px)` with `overflow-y: auto` on the panel's card list section.

**Do not** move the timeline into the directions panel or change its position as a global control.

---

## 4. Connect shade slider to existing routing logic

**File:** `app/page.tsx` (or wherever `calculateRoute` lives)

The shade preference slider replaces the current fixed `shadeStrength` values used when generating the three Pareto-front representative routes.

- Currently, three routes are extracted at strengths `[0.0, 0.5, 1.0]`
- With the slider, run routing at the slider value as a single "preferred" route, but still compute all three Pareto representatives and display them as cards so users can compare
- When the slider changes, re-run `calculateRoute` (debounced 300 ms) and update the selected card to the one closest to the slider value

---

## 5. Integrate draw mode with the panel state

**File:** `app/page.tsx`

Draw mode is currently toggled independently. Wire it through the directions panel:

- `drawMode` state in `page.tsx` is set to `true` when the panel's Draw toggle is activated
- When Draw is active, hide the destination input's Nominatim suggestions
- "Clear sketch" in the panel calls the existing sketch-clear logic (currently triggered after route calculation — expose it as a standalone action)
- If the user switches from Draw back to Search while a sketch exists, confirm ("Clear sketch?") before switching

---

## 6. Remove or hide the old `NavigationPanel`

**File:** `app/components/NavigationPanel.tsx`, `app/components/AppShell.tsx`

`NavigationPanel` is noted in the build doc as "not the primary UI in current build." Once `DirectionsPanel` is wired up and routing is confirmed working end-to-end:

- Remove `<NavigationPanel>` from the render tree in `AppShell.tsx`
- Keep the file itself for reference but add a `// @deprecated — replaced by DirectionsPanel` comment at the top
- Confirm all routing state (waypoints, routes, draw mode) is now driven exclusively through `DirectionsPanel` → `page.tsx`

---

## Acceptance checklist

- [ ] Directions panel opens from a single "Directions" button press
- [ ] Panel floats over the map, does not push map content
- [ ] Timeline bar is fully visible at all times on desktop and mobile
- [ ] Origin / destination inputs accept text and trigger geocoding
- [ ] Swap button reverses origin ↔ destination and re-routes
- [ ] Walk / Transit tabs switch routing mode; Transit disabled when < 500 m apart
- [ ] Search / Draw segmented control toggles draw mode; destination input dims when Draw is active
- [ ] "Clear sketch" button appears in Draw mode and works
- [ ] Shade preference slider re-runs routing on change (debounced 300 ms)
- [ ] Up to 3 route cards render; selected card has blue border
- [ ] Recommended badge appears on the Balanced card
- [ ] Panel closes via back arrow, clears all routing state
- [ ] Mobile: panel does not cover the timeline bar
- [ ] Old `NavigationPanel` removed from render tree