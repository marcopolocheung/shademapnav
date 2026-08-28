---
paths:
  - "app/components/**"
  - "app/page.tsx"
  - "app/main.tsx"
---

# Components, the map, and layout

**Components hold no app state.** All real state lives in three hooks that `page.tsx`
composes — `useShadowTime`, `useNavigation`, `useAppState` — and flows down as props. A
`useState` here for anything another component or a hook needs to read is a bug, not a
shortcut. Small, genuinely local UI state (an open/closed disclosure, a hover) is fine.

## The contested three

`app/components/MapView.tsx` (~1377 lines), `app/hooks/useNavigation.ts` (~1445) and
`app/page.tsx` (~932) are wanted by every track at once. Until the seam work lands, **assume
another session may be editing the one you are in.** Keep changes narrow and localized, and
never hand one of these files to a subagent — concurrent edits to them do not merge, and they
are where the invariants bite hardest.

## MapView

**`MapView` is imported only via `React.lazy`** in `app/page.tsx`:
`lazy(() => import("./components/MapView"))`. That is what code-splits MapLibre out of the
initial bundle. A static import from app code silently doubles the entry bundle; type-only
imports are fine. A `PreToolUse` hook blocks the static form.

**The map keeps `canvasContextAttributes: { preserveDrawingBuffer: true }`.** Shade sampling
and GeoTIFF export read the canvas back.

The map instance flows up **once** through `onMapReady(map)` into a ref — never into state.
Putting it in state re-renders the tree on every map event.

## Interface constraints

This app is used outdoors, in bright sun, one-handed, while walking. That is the review
standard, not desktop aesthetics:

- Touch targets ~44px minimum. The bottom sheet, timeline handle, floating controls and route
  cards are all thumb-operated. `docs/notes/touch-target-audit.md` records a prior pass.
- Text over the map canvas needs a scrim or plate — and remember the shade overlay darkens the
  basemap in exactly the places the user is looking.
- Panels occlude the thing being decided about. When one opens, know what it covers.
- `AppShell.tsx` + `page.tsx` drive the responsive split: sidebar wide, bottom sheet narrow.
  Check both. Wide content scrolls inside its own container; the page body never scrolls
  sideways.
- Nine Biome a11y rules are **errors** and fail CI. Prefer semantic elements over click-handled
  `div`s, label every control, keep panels keyboard-reachable. The remaining a11y backlog is
  `warn`-level and does not block — do not treat a warning here as your change's regression
  without checking whether it predates you.

## Verification

Tests run in `environment: "node"` and nothing has ever driven this app in a browser
automatically. A component or map change is **not done** until it has been confirmed in
`npm run dev` — shadows render, the slider drags, a route calculates. If you cannot run a
browser, say the check is outstanding rather than letting the test suite imply it passed.
