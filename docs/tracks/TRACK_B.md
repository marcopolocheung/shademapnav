# Track B — Live Navigation

> **Charter:** make the app navigate. Turn a calculated route into guidance a person can
> follow while walking — with the one instruction no competitor can give:
> *"cross to the shaded side."*

**Class:** Flagship. **Runs alongside:** A, C, D, G freely; coordinate with E (`Trip`, `useNavigation`).

---

## Current state

- **Active checkpoint:** B1 (not started). #145 (3D buildings) landed first as prerequisite
  camera work — it is not a numbered checkpoint.
- **Done:** #145 — 3D enabled, shadows ordered below the extrusions, terrain deleted
- **Open PRs:** #145
- **Decisions made:**
  - **No terrain, ever.** It displaces the ground while the shadow layer's triangles stay at
    `z = 0`. Draping them means sampling the DEM in the shadow vertex shader, and elevation
    adds nothing to urban pedestrian shade. Deleted rather than fixed.
  - **Shadow layer sits below `buildings-3d`**, set once at load via `beforeId`.
    `bringNavOverlaysToFront` deliberately does not list either layer, so that order survives
    the call it makes on every shadow recompute. Do not "fix" this with `moveLayer`.
  - **Camera pitch lives in `useShadowTime`**, not in a component: the map arrives via a ref,
    so a component subscribing on mount finds `null` and never re-renders to retry.
  - 3D tilt is **55°**, and the toggle honours `prefers-reduced-motion` with `jumpTo`.
- **Blocked on:** nothing (B6 will need Track A's `ShadeField`; stub it). Two notes for B6,
  both #147: the sidewalk Dijkstra chose **is** retained through the search (`prevEdge`,
  `routing.ts:345`; `paretoRoutes`' `edgePath`, `:644-656`) — it is just not returned on
  `RouteResult`, and `GraphEdge` carries no side label, so exposing it is additive plumbing.
  The real obstacle is that **switching sides costs nothing** in the cost model, so the optimal
  path can zigzag across the street and B6 would chatter. That is a cost-model change, not
  plumbing.
- **Next action:** B1 — maneuver generation from route geometry
- **Last verified:** 2026-09-02, 192 tests / 26 files green on `feat/b-3d-buildings`.
  #145's visual checks are **outstanding** — no browser on the dev machine (#121).

---

## Why this track exists

The app is named for navigation and does not navigate. Verified 2026-08-24:

- `watchPosition` appears **nowhere** in `app/`. The only geolocation calls are one-shot
  `getCurrentPosition` (`useNavigation.ts:292`, `agent/tools.ts:90`).
- The `NAVIGATING` phase (`useAppState.ts`) renders `NavigationStatusPanel.tsx` — 161 lines
  showing destination, distance, ETA, shade %, and a turn *count*. No maneuvers, no street
  names, no progress, no off-route detection, no reroute, no arrival detection, no voice.
- `ARRIVAL` is reached by the user tapping a button.

Meanwhile Google is shipping shade *inside* real turn-by-turn with landmark-based voice cues.
A route you have to hold in your head is a planning tool.

## The asset nobody else has

`shadeSampling.ts:sampleBothSidewalks()` samples **±4 m perpendicular offsets** and returns
`{left, right}` shade independently; `useNavigation.ts:984-991` assigns them to separate parallel
edges so Dijkstra picks a *side of the street*. That means the app already knows which
sidewalk is shaded — it just never tells anyone. Every shade-routing competitor routes on
street centrelines.

**B6 is the point of this track.** B1–B5 are the machinery that makes B6 sayable.

## What already exists

- `RouteOption.geojson` + `legs: RouteLeg[]` (`routing.ts:48-76`) — geometry and per-leg data.
- `RouteResult.turnCount` — turns are already counted, so the bearing math exists in spirit.
- `routeProgress.ts` (33 lines) + `routeBounds.ts` — progress and bounds helpers, used by `DirectionsPanel`.
- `useAppState.ts` — the `IDLE → PLACE_DETAIL → DIRECTIONS → NAVIGATING → ARRIVAL` FSM, with `START_NAVIGATION`/`ARRIVE` actions already wired.
- `MapView.tsx` layer conventions: `nav-route` source/layer (`:660-664`), train layers (`:1214+`), sketch layers (`:624-646`). Add guidance layers the same way.
- `partialRoute.ts` — the "this leg couldn't be routed" state B8 must render.

## Hard invariants that bite this track

- **`MapView` only via `React.lazy`** (invariant #4) — guidance layers go *inside* MapView or a lazily-loaded module, never a static import from app code.
- **`preserveDrawingBuffer`** stays true.
- Reduced-motion: guidance re-centering must respect `prefers-reduced-motion` (a11y is a mission word, and `jumpTo` vs `easeTo` is the difference).
- Nominatim/Overpass need a `User-Agent` (invariant #6) — B2's street names come from the graph, not a geocoder, so don't add lookups here.

## The contract this track publishes

`app/lib/guidance/types.ts`:

```ts
export type ManeuverType =
  | "depart" | "continue" | "turn-left" | "turn-right"
  | "slight-left" | "slight-right" | "sharp-left" | "sharp-right"
  | "cross" | "board" | "alight" | "arrive";

export interface Maneuver {
  type: ManeuverType;
  bearingDelta: number;          // degrees, signed
  distanceFromStartM: number;
  streetName?: string;
  shadeSideHint?: "left" | "right" | null;   // B6
  legIndex: number;
}

export interface GuidanceState {
  maneuvers: Maneuver[];
  activeIndex: number;
  progressM: number;
  distanceToNextM: number;
  etaSec: number;
  offRoute: boolean;
  snapped: [number, number] | null;   // map-matched position
}
```

---

## Checkpoints

### B1 — Maneuver generation (pure)
**Goal.** Route node list → `Maneuver[]`.
**Approach.** `app/lib/guidance/maneuvers.ts`. Bearing per segment; classify the delta at each node (thresholds: <20° continue, 20–50° slight, 50–120° turn, >120° sharp); collapse consecutive `continue`s; emit `depart`/`arrive`. Reuse the bearing helper behind `turnCount` in `routing.ts` rather than writing a second one.
**Acceptance.** Unit tests: a straight line yields depart+arrive only; an L yields one turn with the correct sign; a staircase of small deltas doesn't emit a maneuver per node; a real captured route fixture produces a human-plausible list.
**Files.** `app/lib/guidance/**` (new). **Size.** Medium. **No UI.**

### B2 — Street names in the graph
**Goal.** Instructions that name a street.
**Approach.** Keep `name` on edges in `overpass.ts` (the pattern exists — PR #106 already preserves `surface`/`cycleway`/`bicycle`/`foot` on `GraphEdge`, `routing.ts:12-21`). Thread it into `Maneuver.streetName`.
**Acceptance.** Graph tests assert `name` survives; maneuvers on a named-street fixture carry it; memory impact of the extra string is measured, not guessed (dense-city graphs are big).
**Files.** `app/lib/overpass.ts`, `app/lib/routing.ts` (type only), `app/lib/guidance/**`. **Size.** Small. ⚠️ Coordinate with **Track E** — E1 also edits edge tags.

### B3 — Position tracking + map matching
**Goal.** Know where the user is, on the route.
**Approach.** `app/hooks/useGuidance.ts`: `watchPosition` with `enableHighAccuracy`, drop samples with `accuracy > 30 m`, project onto the nearest route segment within tolerance (start at 25 m), monotonic progress (don't let noise walk you backwards), heading from `coords.heading` with a bearing-of-travel fallback.
**Acceptance.** A **playback harness** — a GPX fixture replayed at 1.4 m/s — drives `progressM`, `activeIndex`, and `distanceToNextM` correctly in tests, including a noisy-sample case and a tunnel/dropout case. No browser needed for the test; that's the point of the harness.
**Files.** `app/hooks/useGuidance.ts` (new), `app/lib/guidance/matcher.ts` (new). **Size.** Large.

### B4 — Guidance UI
**Goal.** Replace the static card with something usable one-handed, outdoors, in sun.
**Approach.** Next maneuver (large), distance to it, remaining distance/ETA, a shade strip for the next ~500 m, a recenter control, screen wake lock (`navigator.wakeLock`, with graceful absence). High contrast — the persona is in direct sunlight.
**Acceptance.** Touch targets meet the audit in `docs/notes/touch-target-audit.md`; keyboard and screen-reader clean (`aria-live="polite"` on the maneuver, not assertive); respects `prefers-reduced-motion`; verified in `npm run dev` at a phone viewport.
**Files.** replacement for `NavigationStatusPanel.tsx`, a guidance layer module in `MapView.tsx` (⚠️ contested), ~15 lines in `page.tsx` (⚠️ contested). **Size.** Large.

### B5 — Off-route + reroute
**Goal.** Recover when the user leaves the line.
**Approach.** Off-route after N consecutive samples beyond tolerance (start N=3) — never on one sample. Recompute from the snapped position to the remaining destination, **preserving the shade preference and the selected Pareto option**. Rate-limit reroutes (Overpass is a shared free resource).
**Acceptance.** The B3 playback harness, with a deviation injected, flags off-route and recovers; no reroute storm when GPS is noisy; a reroute that fails degrades to "follow the map" rather than a dead end.
**Files.** `app/hooks/useGuidance.ts`, `useNavigation.ts` (⚠️ contested — reuse `calculateRoute`, don't fork it). **Size.** Medium.

### B6 — Shade-aware cues ← **the reason for this track**
**Goal.** "Cross now — the north side is shaded for the next 300 m."
**Approach.** Track A's `ShadeField.sampleEdges` gives `{left, right}` for edges ahead. Emit a `cross` maneuver only when: the side delta exceeds a threshold (start 0.25), the shaded run ahead exceeds a minimum length (start 150 m), a legal crossing exists nearby (`highway=crossing` in the graph), and solar intensity × (1 − cloud cover) is high enough to matter (`computeSolarIntensity` + `weather.ts`).
**Acceptance.** No cue chatter on a fixture route (≤1 cue per 400 m); zero cues at night or under heavy cloud; every cue traceable to the field sample that triggered it. **Never suggest crossing where no crossing is mapped** — this is a safety-shaped feature, and the honest failure is to stay quiet.
**Files.** `app/lib/guidance/cues.ts` (new). **Size.** Medium. **Needs A2; stub the field until then.**

### B7 — Voice + arrival summary
**Goal.** Eyes-up guidance, and the sentence Track F will share.
**Approach.** Web Speech API (`speechSynthesis`) — announce at distance thresholds, never repeat, always have a mute. Arrival: "You walked 78% in shade — about 4 minutes of direct sun." Fires `ARRIVE` automatically within a geofence of the destination.
**Acceptance.** Speech degrades silently where unsupported; announcements don't fire twice; the summary's numbers come from the actual tracked path, not the planned route (if the user detoured, say what they actually did).
**Files.** `app/lib/guidance/voice.ts` (new), arrival component. **Size.** Medium.

### B8 — Leg and stop browsing
**Goal.** Step through a multi-stop journey. Closes **#66**.
**Approach.** `RouteLeg[]` already exists and `RouteCard` renders per-leg detail. Add prev/next leg navigation that flies the map to each leg and scopes the maneuver list. This is also where `partialRoute.ts`'s "this leg couldn't be routed" belongs.
**Acceptance.** Works for walk-only and walk+transit journeys; keyboard navigable; a partial route shows which leg failed and why.
**Files.** leg-browser component, `DirectionsPanel.tsx` (⚠️ Track E owns — coordinate). **Size.** Medium. **Wants Track E's `Trip` (E5).**

### B9 — Battery and background *(stretch)*
GPS + WebGL while navigating is the real-world cost. Throttle the shadow layer's refresh while
moving, drop the sun-position worker cadence, measure with the Track G benchmark before claiming a win.

---

## Subagent plan

- **Scout** for prior art questions ("how does `turnCount` compute bearings today?", "what does MapLibre give us in `coords.heading` across browsers?").
- **B1 + B3's playback harness are swarm-able** (disjoint files, both pure) once the `Maneuver` type is committed.
- **B4, B5, B8 are solo** — contested files.
- **Verifier mandatory on B5 and B6.** Off-route logic and crossing cues are where a plausible-looking change is dangerous rather than merely wrong.

## Risks

1. **Testing without a browser.** Everything here is position-driven, and the repo has no browser coverage (#35). Mitigation: the B3 playback harness makes B3/B5/B6 testable in `vitest` with zero browser — build it before the features, not after. Track **G1** covers the rest.
2. **Cue safety.** A "cross here" where no crossing exists is the worst thing this app could say. Mitigation: require a mapped crossing; prefer silence.
3. **GPS in urban canyons** — the exact cities this app targets are the worst for multipath. Mitigation: accuracy filtering, monotonic progress, generous off-route thresholds.
4. **Contested-file collisions with Track E.** Mitigation: the compatibility matrix in `docs/tracks/README.md`; wait for **G6** if both tracks are hot.

## Out of scope / hand-offs

- Route *calculation* → reuse `useNavigation`'s pipeline; never fork it.
- Shade math → **Track A** (`ShadeField`).
- What a "trip" is (stops, modes, dwell) → **Track E** (`Trip`).
- Turning the arrival summary into a shareable image → **Track F** (F1).
