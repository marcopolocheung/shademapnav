# Navigation Web App — UIUX Redesign Checklist
> **For ClaudeCode:** This document is self-contained. Each task is atomic and implementation-ready. No prior codebase context is assumed. All items describe UI structure and behavior, not visual styling. Implement in order within each section; sections are independent.

---

## 0. Conventions & Shared Definitions

- **Sidebar** = fixed left panel (desktop only), min-width 360px, max-width 420px, full viewport height.
- **Bottom Sheet** = mobile-only overlay panel anchored to bottom of screen, three named heights: `collapsed` (~90px), `mid` (~45vh), `full` (~90vh). Drag handle always visible at top-center.
- **Top Banner** = full-width fixed strip at top of screen (mobile nav only), z-index above map.
- **Bottom Bar** = full-width fixed strip at bottom of screen (mobile nav only), z-index above map.
- **Map Container** = the area rendered by the mapping library (Leaflet, Mapbox, Google Maps JS API, etc.). It must always fill its assigned region; never give it a fixed pixel height.
- **Floating Controls** = icon buttons that sit on top of the Map Container, positioned absolute/fixed relative to the map region.
- **`[desktop]`** = implement only when viewport width ≥ 768px.
- **`[mobile]`** = implement only when viewport width < 768px.
- **`[both]`** = implement on all viewport widths.

---

## 1. App Shell Layout

### 1.1 Desktop shell `[desktop]`
- [ ] Create a two-column root layout: Sidebar (left, fixed width) + Map Container (right, fills remaining width).
- [ ] Sidebar must not collapse or overlap the map at any desktop breakpoint.
- [ ] Map Container height = 100vh; it must never scroll.
- [ ] Sidebar is independently scrollable (overflow-y: auto) when its content exceeds viewport height.

### 1.2 Mobile shell `[mobile]`
- [ ] Map Container fills 100vw × 100vh as the base layer.
- [ ] Bottom Sheet renders above the map as an absolutely positioned overlay.
- [ ] Top Banner renders above the map as an absolutely positioned overlay (hidden by default; shown only during active navigation — see Section 5).
- [ ] Bottom Bar renders above the map as an absolutely positioned overlay (hidden by default; shown only during active navigation — see Section 5).
- [ ] No layout shift on the Map Container when Bottom Sheet changes height state.

### 1.3 Responsive breakpoint `[both]`
- [ ] At exactly 768px, switch between mobile and desktop shells without page reload.
- [ ] All UI state (search text, selected route, nav status) must survive the breakpoint transition.

---

## 2. Idle / Start State

### 2.1 Search bar `[desktop]`
- [ ] Place a single text input at the top of the Sidebar.
- [ ] Input has a clear (×) button that appears only when the field is non-empty.
- [ ] On focus, show an autocomplete dropdown directly below the input, within the sidebar width.
- [ ] Each autocomplete row: icon (place type) + primary name (bold) + secondary address line (muted). Rows are full sidebar width.
- [ ] Keyboard navigation (↑ ↓ Enter Escape) must work on the autocomplete list.
- [ ] Selecting a row: dismiss autocomplete, populate input with place name, trigger place detail view (Section 3.1).

### 2.2 Search bar `[mobile]`
- [ ] Place a pill-shaped search bar fixed at the top of the screen, inset 12px from all sides.
- [ ] Left side of pill: hamburger or profile icon button.
- [ ] Right side of pill: microphone icon button.
- [ ] Tapping anywhere on the pill (not just the icon buttons) opens the Search Active state (Section 2.3).

### 2.3 Search active state `[mobile]`
- [ ] On search open: pill transforms into a full-width top input bar with a back-arrow button on the left.
- [ ] Keyboard rises from bottom.
- [ ] Bottom Sheet transitions to `mid` height and fills with a scrollable list of recent searches and suggested destinations.
- [ ] Each row in the list: category icon + primary text + secondary muted text.
- [ ] As user types, list updates with autocomplete results (same row structure).
- [ ] Tapping a row triggers place detail view via Bottom Sheet (Section 3.2).
- [ ] Tapping back-arrow or pressing Escape returns to idle state; Bottom Sheet returns to `collapsed`.

### 2.4 Collapsed bottom sheet content `[mobile]`
- [ ] Bottom Sheet in `collapsed` state shows a single horizontal scrollable row of quick-action pill buttons (e.g., "Restaurants", "Gas", "Groceries", "Pharmacies", "Coffee").
- [ ] Each pill: icon + label, fixed height ~36px.
- [ ] Drag handle sits 8px above the pill row, centered horizontally, 40px wide × 4px tall, rounded.

### 2.5 Floating map controls `[both]`
- [ ] Position a vertical stack of icon buttons in the bottom-right of the Map Container, above the Bottom Sheet / Bottom Bar.
- [ ] Buttons (top to bottom): Compass (resets bearing), My Location (centers map on user), Layers toggle.
- [ ] Each button is a square (~44px × 44px), with a surface background, separated by 8px gaps.
- [ ] Compass button rotates its icon to match current map bearing; tapping snaps bearing back to north.

---

## 3. Place Detail View

### 3.1 Place detail — sidebar `[desktop]`
- [ ] When a place is selected, replace the search bar content area with a detail panel inside the Sidebar.
- [ ] Panel structure (top to bottom):
  1. Back arrow button (returns to search/idle).
  2. Place name — large heading.
  3. Rating value + star indicator + review count (inline row).
  4. Category label (muted text).
  5. Address line.
  6. Horizontal action button row: "Directions", "Save", "Share". Buttons are equal width, fill the sidebar.
- [ ] Map pans and drops a pin at the selected place. Do not change zoom unless the place is off-screen.

### 3.2 Place detail — bottom sheet `[mobile]`
- [ ] Bottom Sheet transitions to `mid` height.
- [ ] Panel structure (top to bottom inside sheet):
  1. Drag handle.
  2. Place name — large heading.
  3. Rating + review count row.
  4. Category label.
  5. Address.
  6. Horizontal action button row: "Directions", "Start", "Save", "Share" — equal width, full sheet width.
- [ ] Dragging sheet to `full` reveals additional content (photo strip, hours, reviews, etc.) below the action row.
- [ ] Tapping anywhere on the map outside the sheet collapses it back to `collapsed` and clears the selected place.

---

## 4. Directions Mode (Route Selection)

### 4.1 Input panel `[desktop]`
- [ ] Replace sidebar content with the route-planning panel.
- [ ] Two stacked text inputs:
  - Top: origin ("Your location" placeholder, auto-populated from device location).
  - Bottom: destination (pre-filled from selected place, if any).
- [ ] Between the two inputs on the right edge: a swap icon button that swaps origin and destination values.
- [ ] Below inputs: a horizontal icon strip of transport mode buttons (walk, drive, transit, cycle). Each is a toggle; only one active at a time. Walking mode is default for pedestrian apps — set it active on mount.
- [ ] Below transport strip: a scrollable list of route option cards (see 4.3).
- [ ] Below route cards: a full-width "Start" button pinned to the bottom of the sidebar.

### 4.2 Input panel `[mobile]`
- [ ] Map shrinks to fill the top ~55% of the screen (not an overlay; the layout changes).
- [ ] A non-dismissible bottom panel occupies the bottom ~45% of the screen.
- [ ] Inside the bottom panel (top to bottom):
  1. Two stacked input fields (same structure as desktop, with swap button).
  2. Transport mode icon strip (full width).
  3. Route option cards (scrollable if multiple).
  4. Full-width "Start" button pinned to bottom of panel.

### 4.3 Route option cards `[both]`
- [ ] Each card: estimated time (large, bold) + distance + short route description (e.g., "Mostly flat", "Fastest route").
- [ ] Cards are visually differentiated: selected card has a distinct background or border; unselected cards are muted.
- [ ] Selecting a card updates the highlighted route polyline on the map. Selected = thick/saturated polyline; unselected = thin/muted polyline.
- [ ] Only one card can be selected at a time.

### 4.4 Back navigation `[both]`
- [ ] A back/close button in the directions panel returns the user to place detail view (if a place was selected) or to idle state.

---

## 5. Active Navigation State

### 5.1 Top Banner `[mobile]`
- [ ] Show Top Banner when navigation starts; hide it in all other states.
- [ ] Banner is full viewport width, fixed at top, minimum height 64px.
- [ ] Banner internal layout (left to right):
  - Left block (~20% width): large maneuver icon/arrow (the specific turn direction — left, right, straight, u-turn, etc.).
  - Right block (~80% width, two lines):
    - Line 1: instruction text (bold, e.g., "Turn left onto Oak St") — truncate with ellipsis if too long.
    - Line 2: distance to next maneuver (e.g., "in 80 m").
- [ ] When a maneuver is within a configurable threshold distance (~50–100m by default), apply a high-contrast background to the entire banner and increase the maneuver arrow size.

### 5.2 Lane guidance strip `[mobile]`
- [ ] Immediately below the Top Banner, conditionally render a lane guidance strip.
- [ ] Show this strip only when the current step's data includes lane information.
- [ ] Strip contains a horizontal row of lane arrow icons; the recommended lane(s) are highlighted; non-recommended lanes are muted.
- [ ] When no lane data is present, this strip must take zero height (do not leave a gap).

### 5.3 Map during navigation `[mobile]`
- [ ] Switch map to heading-up orientation (rotates map so the user's travel direction is always "up").
- [ ] Apply a tilted/perspective camera angle (3D) if the mapping library supports it.
- [ ] Map continuously re-centers on the user's current location as it updates.

### 5.4 Bottom Bar `[mobile]`
- [ ] Show Bottom Bar when navigation starts; hide it in all other states.
- [ ] Bar is full viewport width, fixed at bottom, minimum height 56px.
- [ ] Bar internal layout (left to right):
  - Left ~70%: three data points inline — remaining time (large/bold), remaining distance, estimated arrival time.
  - Right ~30%: two icon buttons — overflow/options ("…") and exit navigation ("×").
- [ ] "×" button ends navigation, hides Top Banner and Bottom Bar, resets map orientation to north-up, transitions back to idle or place detail state.

### 5.5 Overview pill `[mobile]`
- [ ] Render a small pill button ("Overview") floating above the Bottom Bar, vertically centered between Bottom Bar top and ~80px above it, horizontally centered or left-aligned.
- [ ] Tapping it zooms the map out to show the entire remaining route, temporarily disabling heading-up/auto-center.
- [ ] A second "Resume" pill replaces it while in overview mode; tapping "Resume" re-engages heading-up and auto-center.

### 5.6 Navigation sidebar `[desktop]`
- [ ] Sidebar switches to navigation mode: remove route-selection panel, show turn-by-turn panel.
- [ ] Panel structure (top to bottom):
  1. Current maneuver block: maneuver icon (left, ~50px wide) + instruction text + distance to next turn (right). This block is always visible at the top, does not scroll away.
  2. Scrollable step list below: each row = small maneuver icon + step instruction text + leg distance (right-aligned). Rows are separated by a thin divider.
  3. Summary bar pinned to the bottom of the sidebar: remaining time + remaining distance + ETA, all on one line.
- [ ] An "×" close/exit button is positioned in the top-right corner of the current maneuver block.
- [ ] As the user progresses, completed steps are either removed from the list or visually marked as done (opacity reduced).

### 5.7 Step list auto-scroll `[desktop]`
- [ ] The step list in the sidebar automatically scrolls to keep the current (next upcoming) step visible.
- [ ] The current step row is visually differentiated from future steps (e.g., different background or left accent border).

---

## 6. State Machine — Required Transitions

Implement a central navigation state with these named states. All UI sections above read from this state.

```
IDLE
  → (user selects place)           → PLACE_DETAIL
  → (user taps Directions)         → DIRECTIONS

PLACE_DETAIL
  → (back/close)                   → IDLE
  → (Directions button)            → DIRECTIONS

DIRECTIONS
  → (back/close)                   → PLACE_DETAIL (if place set) | IDLE
  → (Start button)                 → NAVIGATING

NAVIGATING
  → (× exit button)                → IDLE
  → (destination reached)          → ARRIVAL
  → (reroute triggered)            → NAVIGATING (step list updates; banner updates)

ARRIVAL
  → (dismiss)                      → IDLE
```

- [ ] On every state transition, update the UI regions described above (show/hide sidebar panels, bottom sheet height, banners, bars).
- [ ] No UI region should ever display stale data from a previous state.

---

## 7. Rerouting Behavior

- [ ] When the user's position deviates from the current route beyond a configurable threshold, trigger a reroute.
- [ ] During rerouting: Top Banner (mobile) or maneuver block (desktop) shows a "Rerouting…" indicator in place of the instruction text.
- [ ] Step list and route polyline update atomically when the new route is received — no partial update states visible to the user.
- [ ] Do not exit NAVIGATING state during a reroute; remain in NAVIGATING throughout.

---

## 8. Arrival State

- [ ] When the user reaches the destination (within configurable radius), transition to ARRIVAL state.
- [ ] `[mobile]`: Top Banner shows "You have arrived" with the destination name. Bottom Bar remains visible with only the "×" dismiss button.
- [ ] `[desktop]`: Maneuver block shows "You have arrived" + destination name. Step list clears. Summary bar clears.
- [ ] Map drops a pin or highlights the destination marker.
- [ ] Tapping dismiss/× transitions to IDLE.

---

## 9. Accessibility Requirements `[both]`

- [ ] All icon buttons must have an `aria-label` describing their action.
- [ ] The autocomplete dropdown must use `role="listbox"` and `role="option"` on rows; active row is `aria-selected="true"`.
- [ ] Top Banner instruction text must be announced via `aria-live="assertive"` on maneuver changes.
- [ ] Bottom Sheet drag handle must be keyboard operable (Space/Enter cycles between `collapsed`, `mid`, `full`).
- [ ] Route option cards must be selectable via keyboard (Tab to focus, Enter to select).
- [ ] Transport mode buttons must use `role="radio"` within a `role="radiogroup"`.
- [ ] All interactive targets must be ≥ 44px × 44px in touch surface.

---

## 10. Implementation Notes for ClaudeCode

- **Do not hard-code any place names, route data, or coordinates.** All data flows from the mapping/routing API in use.
- **State management:** Use whatever state management pattern is already established in the codebase (Redux, Zustand, React Context, Svelte stores, etc.). If none exists, create a single `navigationStore` with the states in Section 6.
- **Mapping library agnostic:** All map interactions (pan, zoom, bearing, tilt, polyline rendering, marker placement, location tracking) must go through a thin adapter layer so the underlying library can be swapped. Do not call Leaflet/Mapbox/Google Maps APIs directly in UI components.
- **No pixel values in UI components** except where specified in this document. Use spacing tokens or relative units (rem, %, vh, vw).
- **Every task in this document is additive.** Do not remove existing app functionality unless explicitly directed. If a section conflicts with existing code, flag the conflict before making changes.
- **Test each section in isolation** before moving to the next. Each numbered section (2, 3, 4, 5…) can be shipped independently.