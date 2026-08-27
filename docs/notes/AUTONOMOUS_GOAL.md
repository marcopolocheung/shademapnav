# Autonomous Goal — ShadeMapNav

**This file is the standing direction for every agent team working on this repo.**
Re-read it whenever your context is summarized or you lose the thread.

It answers three questions, in order:

1. **What is this product trying to be** (Mission).
2. **Which big features get us there** (Tracks A–G — each one is close to its own product,
   with its own PRD, checkpoints, owned files, and definition of done).
3. **How teams work in parallel without colliding** (Operating rules).

Related documents, and how they differ:

| Document | Role |
|---|---|
| `GROWTH_ROADMAP.md` | The *user/product thesis* — who the users are, why shade matters. Written 2026-07-05. Still true; several of its items have since shipped. |
| **This file** | The *engineering direction* — the big features, decomposed into checkpoints that agent teams can own end to end. |
| **`docs/tracks/TRACK_<X>.md`** | The *deep brief* for one track — code pointers, contracts, per-checkpoint acceptance criteria, and the live `Current state` block. **This is what a working session actually reads.** |
| **`docs/tracks/README.md`** | The *operating playbook* — how to start a track session, when to spawn subagents, how tracks hand off. |
| GitHub Issues (`gh issue list`) | The *unit of work*. Every checkpoint below becomes one or more issues; every issue becomes one PR. |

**Rule of thumb:** GROWTH_ROADMAP says *why*, this file says *what and in what order*, the
track brief says *how, in this code*, and Issues say *the next concrete thing*. If they
disagree, the code wins, then this file for sequencing, then GROWTH_ROADMAP for user rationale.

**To start working:** run `/track a` (…`g`) in a session, or paste the kickoff prompt from
`docs/tracks/README.md`. One session owns one track for its whole life.

Status of this document: written 2026-08-24 after a full repo inspection (156 tests / 23
files passing, 31 open issues, 6 open PRs — all Dependabot), plus a scan of the 2026
shade-and-heat navigation landscape. It replaces "pick the highest-priority open issue"
as the default work-selection rule. **Issues still exist; they are now filed under a track.**

---

## Mission

> **A fast, accessible, shade-first navigation webapp for people moving under their own
> power — walking, biking, scootering, skateboarding, running, wheeling.**

Three words decide every judgment call, in this order:

1. **Trustworthy** — never claim shade the app can't deliver, never narrate a trip it
   didn't plot. A wrong promise ends retention permanently.
2. **Fast** — a heatwave user on 4G, standing outside, one-handed. Time-to-first-route
   under 30s; route calculation that never dead-ends on a cliff timeout.
3. **Accessible** — both senses: real a11y (keyboard, screen reader, contrast, touch
   targets, reduced motion), and plainly usable by someone who has never seen the app
   and doesn't know that dark blue means shade.

---

## 1. Where the product actually stands (verified 2026-08-24)

This section exists so no team re-discovers the same facts. It is an inventory, not a plan.

### Shipped and wired into the UI
- WebGL building-shadow rendering (`app/lib/shadow/LocalShadowAdapter.ts`, 1147 lines) driven
  by MapTiler vector-tile building geometry, with a timeline slider and play animation.
- Shade-aware pedestrian routing with Pareto options (shortest / balanced / most-shaded),
  per-sidewalk shade sampling, detour-budget pruning (`app/lib/routing.ts`, 1173 lines).
- Multi-stop waypoints with per-leg `RouteLeg` data, partial-route reporting, streaming
  progress, route tradeoff summary ("+4 min, −62% sun"), camera fit-to-route.
- Transit/train routing (`app/lib/trainGraph.ts`), sketch/draw mode, saved routes,
  GPX/GeoJSON export, sun-exposure accumulation with GeoTIFF export.
- Shareable state URLs (`app/lib/shareState.ts`), PWA shell (`public/sw.js`,
  `manifest.webmanifest`), cloud-cover honesty badge (`app/services/weather.ts`).
- Shade Assistant — a real tool-using agent loop over Cerebras (`app/lib/agent/`, 8 tools:
  `locate_user`, `geocode_place`, `search_places`, `check_shade`, `set_time`, `plot_points`,
  `plan_shaded_route`, plus pre-injected `get_current_context`).
- Routing instrumentation with three KPIs at `window.__shadeMapMetrics` (`app/lib/metrics.ts`).

### Built but *not* reaching users (highest-leverage cleanup in the repo)
- **`app/lib/bestTime.ts` is orphaned.** `buildHourlyExposureSeries` / `bestExposureSample`
  ship with tests and have **zero importers outside `__tests__`**. The "best time to go"
  engine exists; nothing renders it. (Track D, C1.)
- **`app/lib/travelMode.ts` is half-wired.** `useNavigation.ts` imports only
  `travelTimeSeconds`; the steps penalty, surface penalty, and cycleway preference in the
  policy are never applied to edge cost, and there is **no mode selector anywhere in the UI**.
  Meanwhile `GraphEdge` already carries `highway`, `surface`, `cycleway`, `bicycle`, `foot`
  tags (PR #106) — the data is there, the cost model ignores it. (Track E, C1.)
- **`LocalShadowAdapter` already has a canvas-free geometry probe** (`shadeFraction` from
  `buildingCache`, `LocalShadowAdapter.ts:251-282`) and `app/lib/shadow/offscreenShade.ts`
  has an Overpass-based one. Neither is generalized into a real shade field. (Track A.)

### The structural gaps (what the app is *not*, despite its name)
1. **It does not navigate.** There is no `watchPosition` anywhere except a one-shot
   `getCurrentPosition`. The `NAVIGATING` phase renders a static summary card
   (`NavigationStatusPanel.tsx`, 161 lines): no maneuvers, no street names, no progress,
   no off-route detection, no reroute, no arrival detection, no voice.
2. **Shade is read off the visible canvas.** `useNavigation.ts` draws `map.getCanvas()` into
   a 2D canvas and samples pixels with `isBlueDominantShadowPixel`. That couples routing to
   the current viewport and zoom, blocks Web Worker offload (#38), makes a time sweep cost one
   full re-render per hour, forces the assistant to hijack the camera for shade probes, and
   caps accuracy at "whatever the renderer painted".
3. **Buildings are the only shade source.** No trees (#46), no awnings, no arcades, no
   terrain. On the tree-lined streets where shade-seekers actually walk, the app under-reports.
4. **Shade is binary and unitless.** `shadeCoverage` is a 0–1 fraction. Users experience heat,
   not geometry: UV dose, air temperature, humidity, wind, surface radiance. No UV (#63).
5. **Nothing has ever run this app in a browser automatically** (#35). Shadow rendering,
   timeline drag, end-to-end routing, GeoTIFF export, the PWA — none are covered by any check.
6. **Three files are load-bearing and contested**: `app/hooks/useNavigation.ts` (1445 lines),
   `app/components/MapView.tsx` (1377), `app/page.tsx` (932). Any two teams touching these
   at once will conflict. See §4, "Seam work".
7. **Doc drift**: root `CLAUDE.md` points at per-directory `CLAUDE.md` files
   (`app/hooks/CLAUDE.md`, `app/lib/CLAUDE.md`, `app/components/CLAUDE.md`, …) that **do not
   exist** in the working tree. Issue #50 covers this; every track depends on those guides
   being real.

---

## 2. Landscape scan — 2026

The competitive picture changed materially in 2026 and it reshapes what "high impact" means here.

| Player | What they shipped | What it means for us |
|---|---|---|
| **Google Maps "Prefer shade"** | A shade toggle for walking directions surfaced in APK teardowns (Nov 2025), reportedly using Street View lidar/light data, plus an estimate of time in direct sun. | The *toggle* is being commoditized. A shade checkbox will not be a differentiator in 12 months. Depth (time dimension, heat units, planning) will be. |
| **Google Maps + Gemini "Ask Maps"** | Rolled out 2026-03-12: conversational queries over 250M places, hands-free assistance during navigation, immersive 3D guidance with landmark-based voice cues. | Conversational map Q&A is now table stakes, and users' bar for it is Gemini's. Our assistant must be *grounded and honest* rather than broad — it wins by answering questions Google can't (shade at 5:40pm on this block). |
| **ASU "Cool Routes"** (SHaDE Lab, 2026) | First navigation tool routing on **mean radiant temperature** at 1 m resolution: SOLWEIG model, lidar-derived 2.5D urban form, hourly met forecasts. Found cooler alternatives on 70% of trips, −4.5 °C mean heat load. Covers **one campus**. | This is the academic ceiling for accuracy and it is *not* a product: no global coverage, no navigation, no app. Their metric (MRT) is the right physical target; our advantage is that we run anywhere OSM/vector tiles exist. |
| **CoolPath / CoolPaths (2026 papers)** | UTCI at 2 m grid, street-scale PET mapping from open data, cooler-route planning. | Confirms the direction: heat index, not shade fraction. Also confirms open data is sufficient — no proprietary lidar required. |
| **Shadehopper**, **Geuneullo** (KR) | Consumer shade-routing apps; Geuneullo models building *and street-tree* shadows. | Consumer competitors already model trees. Our buildings-only shadow is behind the consumer state of the art, not just the research one. |
| **AccessMap / OpenSidewalks** (UW) | Sidewalk-level routing on slope, curb ramps, stairs; expanded statewide (OS-CONNECT) in 2025–26. | Proves the "personalized pedestrian cost model" pattern our mission implies ("wheeling"). Their schema is the one to borrow for a wheeling profile. |
| **Meta + WRI canopy height** | Global 1 m tree canopy height, updated 2026, MAE 2.8 m, free on AWS/GEE. | Global tree shade is now *possible without a survey*. Overpass `natural=tree` is the cheap v1; this raster is the credible v2. |
| **Overture Buildings** | 780M+ footprints with height/levels, merged from OSM + AI footprints. | A fallback for cities where OSM building heights are missing — the main cause of "the app says sun and it's shade". |
| **Open-Meteo** | Free, no key, 60+ hourly variables incl. `uv_index`, `apparent_temperature`, wind, humidity. Already used here for cloud cover. | Every input needed for a real heat model is already free and already integrated at the fetch layer. |

**The conclusion that drives §3:** shade-as-a-toggle is being absorbed by the incumbents.
The defensible product is the *time dimension* ("when", not just "which way"), *heat in human
units* (UV dose and thermal comfort, not blue pixels), *actual guidance while you walk*, and
an *assistant that is grounded in the shade model itself*. Everything below is chosen against
that thesis.

---

## 3. The tracks

Seven tracks. Each is scoped so a team can own it for weeks without waiting on another team.
Each has: the problem, the bet, checkpoints (≈1 PR each, in order), the acceptance bar,
the files it owns, and what it must **not** do.

Priority classes:
- **Flagship (A, B, C)** — the product-defining bets. Staff these first.
- **Adjacent (D, E)** — high-value products that ride on the flagships' foundations.
- **Enabling (G)** — the shared platform every other track needs to prove its work.
- **Growth (F)** — acquisition surface; cheap, seasonal, deferrable but not forever.
  **Parked as of 2026-08-24** by owner decision: documented in full, not staffed. It multiplies
  whatever the product does well, and the things worth spreading (B7's arrival summary, D1's
  best-time chart, E1's modes) aren't built yet. Unpark before a northern summer.

---

### Track A — Shade Engine: a headless, time-sweepable, canopy-aware shade field

**Problem.** Shade is currently a screenshot. `useNavigation` renders the map, reads back
pixels, and calls blue "shade". That single decision caps five other tracks: routing can't
move to a worker (#38), a time sweep costs a re-render per hour, the assistant must fly the
camera to probe a location, routes longer than the viewport degrade, and no shade source
other than "what the renderer drew" can ever be counted.

**The bet.** Extract a pure, viewport-independent **shade field**: given a coordinate (or an
edge) and a time, return a shade fraction with a provenance and a confidence — computed from
geometry, not pixels. The renderer stays exactly as it is (it is the *visual*); the engine
becomes the *truth*. This is the foundation the rest of the product stands on, and it is the
piece the incumbents can't trivially copy at our cost basis.

**Checkpoints.**

- **A1 — Geometry extraction, decoupled.** Pull building-geometry assembly out of
  `LocalShadowAdapter` into `app/lib/shade/geometry.ts`: footprints + heights from vector
  tiles *and* from Overpass, one normalized `BuildingPrism[]` type, one cache keyed by tile.
  *Done when:* the adapter consumes the new module with zero visual change and unit tests
  cover prism construction from both sources.
- **A2 — The `ShadeField` interface.** Define and implement
  `shadeAt(lng, lat, when): ShadeSample` and `sampleEdges(edges, when): Float32Array`, where
  `ShadeSample = { shade: 0..1, source: "tiles" | "overpass" | "canopy" | "mixed", confidence: 0..1 }`.
  Backed by A1 geometry + suncalc. *Done when:* published as a stable interface other tracks
  import, with tests over hand-computed shadow cases (single prism, sun at known azimuth).
- **A3 — Agreement harness.** A fixture set of ~200 (edge, time) pairs across 3 cities with
  both the pixel sampler's answer and the field's answer. *Done when:* mean absolute
  disagreement is reported in CI as a number, and a regression threshold is set. This is the
  gate that lets A4 happen safely.
- **A4 — Routing reads the field, not the canvas.** Swap `calculateRoute`'s shade source
  behind a flag; keep the pixel path as fallback where the field's confidence is low.
  *Done when:* routes calculate correctly with the map panned away from the route, and the
  A3 disagreement stays under threshold.
- **A5 — Worker offload.** Move graph build + shade sampling + Dijkstra into a worker
  (`app/workers/routing.worker.ts`, following the `?worker` pattern). Closes #38.
  *Done when:* main-thread blocking time during a 5-point route drops measurably against the
  Track G benchmark, and the UI stays interactive.
- **A6 — Time sweep.** `sweep(edges, times[])` computing N hours in one pass (sun positions
  vectorized, geometry loaded once). *Done when:* a 14-hour sweep over a typical route costs
  less than 2× a single-hour sample. **This is the API Track D's "best time" product needs.**
- **A7 — Canopy v1 (Overpass).** `natural=tree`, `landuse=forest`, `leaf_type`, tree rows;
  a crude crown model (radius from `diameter_crown`/species default, height from `height`);
  contribute to the field as a separate `source: "canopy"` term. Closes #46.
  *Done when:* a tree-lined street in Madrid/Barcelona reports materially more shade, and
  the confidence field reflects the crudeness.
- **A8 — Canopy v2 + height fallback (stretch).** Meta/WRI 1 m canopy height where tiles are
  available; Overture building heights where OSM levels are missing.
- **A9 — Beyond binary (stretch, feeds Track D).** Export not just "shaded/not" but the
  ingredients of a radiant load: sky view factor per sample, sun altitude, surface class.

**Owns.** `app/lib/shade/**` (new), `app/lib/shadow/**`, `app/lib/shadeSampling.ts`,
`app/workers/**`, `app/lib/overpass.ts` (query additions).

**Must not.** Change shadow *colors* (invariant #5 couples them to the shade predicate),
break `preserveDrawingBuffer` (#3), or touch UI beyond a debug overlay.

**Contract published to other tracks.** `ShadeField` (A2) + `sweep` (A6). Nobody else
implements shade math. Ever.

---

### Track B — Live Navigation: turn-by-turn shade guidance

**Problem.** The app is named for navigation and cannot navigate. `NAVIGATING` is a card
with a distance on it. Meanwhile Google is adding shade *inside* real turn-by-turn with
landmark voice cues. A route you must hold in your head is a planning tool, not a navigator.

**The bet.** Guidance is where shade routing becomes visceral: *"in 40 m, cross to the shaded
side of Calle Mayor."* No competitor gives a shade instruction, because none of them models
which **side of the street** is shaded — and we already do (`sampleBothSidewalks` splits every
edge into left/right sidewalk edges).

**Checkpoints.**

- **B1 — Maneuver generation.** Pure module `app/lib/guidance/maneuvers.ts`: route node list →
  `Maneuver[]` (`{ type: "turn-left"|"turn-right"|"continue"|"cross"|"arrive", bearingDelta,
  distanceFromStartM, streetName? }`) using edge bearings and OSM `name` tags.
  *Done when:* unit-tested against synthetic geometries and one real captured route.
- **B2 — Street names in the graph.** `overpass.ts` keeps `name` on edges (it already keeps
  `surface`/`cycleway` since PR #106) so instructions can say a street.
- **B3 — Position tracking.** `useGuidance` hook: `watchPosition` with accuracy filtering,
  a heading source, and a snap-to-route map-match (project onto the nearest route segment
  within a tolerance). *Done when:* a simulated track (a GPX played back at 1.4 m/s) drives
  progress correctly in a test.
- **B4 — Guidance UI.** Replace the static `NAVIGATING` card: next maneuver, distance to it,
  remaining distance/ETA, a shade strip for what's ahead, big touch targets, screen wake lock.
  *Done when:* usable one-handed on a phone, and reduced-motion / screen-reader clean.
- **B5 — Off-route + reroute.** Detect departure beyond tolerance for N samples, recompute
  from current position, preserve the shade preference. *Done when:* the simulated track can
  deviate and recover without a manual re-plan.
- **B6 — Shade-aware cues.** Using Track A's per-sidewalk field: "cross now — the north side
  is shaded for the next 300 m". *Done when:* cues fire only when the shade delta exceeds a
  threshold (no chatter) and are suppressed when solar intensity or cloud cover makes them moot.
- **B7 — Voice (Web Speech API) + arrival summary.** "You walked 78% in shade — about 4
  minutes of direct sun." That sentence is the share hook Track F needs.
- **B8 — Leg/stop browsing.** Step through legs and stops of a multi-stop journey. Closes #66.
- **B9 — Battery and background behavior (stretch).** GPS/WebGL cost while navigating;
  degrade the shadow layer's refresh rate when the screen is on and moving.

**Owns.** `app/lib/guidance/**` (new), `app/hooks/useGuidance.ts` (new),
`NavigationStatusPanel.tsx` → its replacement, the `NAVIGATING`/`ARRIVAL` phases of
`useAppState.ts`.

**Must not.** Reimplement routing (call `useNavigation`'s pipeline) or shade math (Track A).

**Contract published.** `Guidance` model: `{ maneuvers, activeIndex, progressM, offRoute, eta }`.

---

### Track C — Shade Copilot: the assistant that is actually grounded in the map

**Problem.** The assistant is architecturally strong (neutral IR, key pooling, failover,
determinism work) and unproven where it matters. Two of the three failures recorded in the
archived July review have since been addressed and **must not be "re-fixed"**: plot-before-answer
now has a code-level fallback (`agentLoop.ts:155-170`, `plotFallbackPoints()` + a "Map state
guarantee" line injected into the write prompt), and `check_shade` no longer moves the camera
(`tools.ts:359` → `queryPointShade` → Overpass fallback). **Neither has ever been confirmed in
a browser (#59).** What remains genuinely open: two-point-only planning (`plan_shaded_route`,
`tools.ts:195`) while the app supports many waypoints, no eval harness, and no way for a user
to check a claim against the map. In a world where "Ask Maps" exists, a *broad* chatbot is a
losing bet; a *grounded* one is not.

**The bet.** The Copilot's only job is to answer questions that require the shade model:
"where can I sit outside in shade at 4pm near here?", "plan a shaded afternoon: coffee → park
→ dinner", "when should I run this loop?", "is the terrace at X in sun right now?". Every
claim it makes must be traceable to a tool result, and every place it names must be on the map.

**Checkpoints.**

- **C1 — Eval harness first.** `app/lib/agent/__tests__/scenarios/`: ~15 golden scenarios
  with a scripted LLM (recorded transcripts, no network) asserting *behavioral* invariants —
  did `plot_points` run before the answer, did the answer mention only plotted places, did the
  loop stay under budget. *Done when:* the harness runs in `npm test` and fails on a
  regression. **No other C checkpoint lands before this one.**
- **C2 — Close the grounding gaps.** Find where the existing guarantee leaks (candidates never
  collected, the `rolesShareConfig()` shared-model path, places named in prose that were never
  candidates), and confirm #59 by hand in `npm run dev`. *Done when:* every C1 grounding
  scenario is green, including the shared-model path, and #59 closes on observation.
- **C3 — Probes on the `ShadeField`.** `check_shade` calls Track A's field (rather than the
  adapter's viewport-scoped cache) and reports `source` + `confidence` so the model can qualify
  its answer; add a times-sweep probe over A6. *Done when:* a low-confidence probe never
  becomes a confident sentence, and "when is this terrace shaded?" costs one tool call.
- **C4 — Multi-stop planning tool.** `plan_shaded_route` accepts ordered stops and drives the
  existing `additionalWaypoints` path; add `suggest_time` backed by Track A's `sweep`.
  *Done when:* "coffee then park then dinner" produces one plotted multi-leg route.
- **C5 — Answers with receipts.** Structured output: each claim carries the tool result that
  produced it; the UI renders chips ("Shade 62% at 16:00 — checked") that focus the map object.
  *Done when:* every place in an answer is clickable and the map agrees.
- **C6 — Budget discipline.** Cerebras free tier is 5 req/min: cache geocodes/searches per
  session, collapse redundant tool calls, stream partial progress ("checking 3 spots…") so a
  slow turn feels alive. *Done when:* the median scenario in C1 completes in ≤4 LLM calls.
- **C7 — Graceful degradation.** No key / rate-limited / offline → the panel says so plainly
  and offers the deterministic equivalent (search, best-time chart) instead of failing silently.
- **C8 — Voice + guidance integration (stretch).** "Ask while walking", answered against the
  active route (needs Track B).
- **C9 — Exit beta.** Published criteria: C1 green for 3 consecutive weeks, zero
  ungrounded-claim escapes, p50 turn under 10 s.

**Owns.** `app/lib/agent/**`, `app/hooks/useAgent.ts`, `AssistantPanel.tsx`, `api/agent.js`.

**Must not.** Add paid LLM providers or a second key pool (guardrail: free-tier only), or
implement shade/route logic outside a tool wrapper.

---

### Track D — Heat & Timing: shade in human units

**Problem.** The app reports a blue-pixel fraction. Nobody's body has a unit for that. The
research consensus (ASU Cool Routes, CoolPath, CoolPaths) is that the meaningful metric is
radiant/thermal load — MRT, UTCI, PET — and the free inputs for a decent approximation
(UV index, air temp, humidity, wind, cloud) are already one Open-Meteo call away. Also: the
engine that answers *"when should I go?"* is **already written and orphaned** (`bestTime.ts`).

**The bet.** "When" is the question the incumbents aren't answering, and it is the one that
creates a daily habit (runners, dog walkers, stroller parents check it every morning).
Heat units make the shade tradeoff mean something to the sun-sensitive segment — the
highest-retention persona in GROWTH_ROADMAP.

**Checkpoints.**

- **D1 — Ship the orphan.** Wire `buildHourlyExposureSeries` into an exposure-by-hour chart
  for the *current route* ("70% shaded before 10am, 25% at 2pm") with a tap-to-jump on each
  hour. Uses the existing sampler until A6 lands, then switches to `sweep`. Closes #47.
- **D2 — Weather ingestion, generalized.** Extend `app/services/weather.ts` from cloud-cover
  to `uv_index`, `temperature_2m`, `relative_humidity_2m`, `wind_speed_10m`, `apparent_temperature`;
  one cached hourly fetch per location, reused by every consumer.
- **D3 — Exposure → dose.** `app/lib/heat/dose.ts`: minutes in sun × UV index → standard
  erythemal dose and a burn-time estimate by skin type; honest error bars. Closes #63.
- **D4 — A route-level heat score.** Combine sun exposure, UV, air temp, humidity, wind into
  a single comparable number per route option (a documented UTCI-flavored approximation, not
  a claim of physical exactness) and show it beside the tradeoff line. *Done when:* the
  method and its limits are written down in `docs/notes/heat-model.md`.
- **D5 — Personal profile.** Skin sensitivity, heat tolerance, pace, "I overheat"/"I burn"
  toggles → weights in the cost model and in the dose estimate. Local-only, no accounts.
- **D6 — Best-time surfaces.** "Best window today" on the home screen and on any saved route;
  a compact hour strip; cloud-aware ("shade matters less at 14:00 — 90% cloud").
- **D7 — Morning routine (needs F PWA work).** Optional local notification: "today's shadiest
  commute window is 8:10–8:40, UV high after 11." Closes #64.
- **D8 — MRT-grade upgrade (stretch, needs A9).** Sky view factor per sample → a defensible
  MRT approximation; compare against published SOLWEIG outputs for one city block and publish
  the delta honestly.

**Owns.** `app/lib/heat/**` (new), `app/lib/bestTime.ts`, `app/services/weather.ts`, the
exposure chart + profile components.

**Must not.** Invent physiological claims without a written method and stated uncertainty
(guardrail: trustworthy first). No medical framing.

---

### Track E — Journeys & Modes: the app the mission describes

**Problem.** The mission says "walking, biking, scootering, skateboarding, running, wheeling".
The product is walking-only: one hardcoded speed, one cost model, no selector. `travelMode.ts`
exists with penalties nobody applies; `GraphEdge` carries `surface`/`cycleway`/`bicycle`/`foot`
tags nobody reads. AccessMap has shown for years that a per-user pedestrian cost model
(slope, curbs, steps) is the differentiator for people who need it most — and "wheeling" is
in our mission statement already.

**The bet.** Modes multiply the addressable users without new science, and the accessibility
profile is the one feature where being a small open project beats being Google.

**Checkpoints.**

- **E1 — Mode selector + real cost model.** Wire `TRAVEL_MODE_POLICIES` into `dijkstra`'s edge
  cost: steps penalty/exclusion, surface penalty, cycleway preference; a segmented control in
  the directions panel; mode persisted in the share URL. Ship **bike** first (best-tagged in
  OSM). Closes #45.
- **E2 — Mode-aware output.** Speed, ETA, and the tradeoff sentence adapt per mode; shade
  weighting adapts too (a cyclist at 4.5 m/s accumulates less dose per metre — the cost model
  should say so).
- **E3 — Wheeling profile.** OpenSidewalks-style: exclude steps, cap incline, prefer edges
  with `kerb=lowered`/`crossing:kerb`, surface quality; surface *why* a route was chosen.
  Requires elevation (see E7 risk).
- **E4 — Scoot/skate profile.** Surface-dominant cost (`cobblestone`, `gravel`, `sand` are
  disqualifying), steps excluded.
- **E5 — The `Trip` model.** One first-class object: ordered stops, legs, mode per leg,
  dwell time at stops ("30 min for coffee"), computed totals. Replaces the ad-hoc waypoint
  arrays threaded through `useNavigation`. *This is the contract Track C's planner and Track
  B's leg browser both need.*
- **E6 — Mixed-mode journeys.** Walk + transit is already half-built (`trainGraph.ts`);
  generalize to walk↔bike↔transit legs within one `Trip`, with per-leg shade accounting
  (transit `sunExposure` already models underground vs surface).
- **E7 — Elevation (stretch, unblocks E3).** A free terrain source (MapTiler terrain tiles are
  already in the stack) → per-edge grade; also improves walk-speed estimates on hills.
- **E8 — Saved journeys.** Home/Work + a commute `Trip` that reopens with today's shade.
  Pairs with D6/D7 for the habit loop; part of #64.

**Owns.** `app/lib/trip/**` (new), `app/lib/travelMode.ts`, `app/lib/trainGraph.ts`,
`app/lib/routing.ts` cost model, `DirectionsPanel.tsx`, `WaypointInput.tsx`, `savedRoutes.ts`.

**Must not.** Redefine what "shade" means (Track A) or own live position (Track B).

---

### Track F — Reach: make one good route spread *(PARKED — see `docs/tracks/TRACK_F.md`)*

**Problem.** Share URLs and a PWA shell shipped, and the loop stops there: no share image,
no OG unfurl, no share-target registration, no landing pages, no offline route. A heatwave is
a traffic spike with exactly-right intent; the product has to convert it without a marketing
budget.

**The bet.** Cheap, seasonal, and multiplicative — but only *after* there's something worth
sharing (B7's arrival summary, D1's best-time chart, E1's modes). Staff this last among the
"now" tracks, and staff it hard before summer.

**Checkpoints.**

- **F1 — Share card.** Canvas capture (`preserveDrawingBuffer` is already required) + the
  tradeoff sentence + time and city → a PNG the user can save or share. Closes #61.
- **F2 — OG images + meta.** Static-ish OG endpoint so a shared state URL unfurls with a
  shadow map preview. (Vercel serverless; must stay within free tier.)
- **F3 — Share target + deep links.** PWA `share_target` and a documented URL scheme so an
  address shared from another app lands in a shade route. Closes #68.
- **F4 — Offline that means something.** Cache the last route, its graph slice, and the tiles
  around it; the app opens and still shows your commute with no network. Extends the existing
  service worker beyond the app shell.
- **F5 — City landing pages.** A handful of pre-rendered pages ("shaded walking routes in
  Madrid") with a screenshot, a canned deep link, and honest copy. Closes #62.
- **F6 — Public API / embeddable widget (stretch).** Once Track A is a real engine, a
  read-only shade-at-point endpoint is a link magnet for urbanists — the segment that
  publishes screenshots.

**Owns.** `public/**`, `api/**` (non-agent), `app/lib/shareState.ts`, share/export components,
`app/about/**`.

---

### Track G — Proving Ground: the platform that lets six teams move at once

**Problem.** Nothing has ever executed this app in a browser automatically. Route calculation
has instrumentation but no benchmark. The bundle is 1.6 MiB with a 953 kB maplibre chunk and
no budget. A11y has 127 known warnings and no baseline score. With one agent making one PR at
a time this was survivable; with six tracks in parallel it is not — every other track's
"done" claims are unverifiable without this.

**The bet.** G is not overhead, it is the thing that makes parallel work safe. It should be
staffed **first**, alongside A.

**Checkpoints.**

- **G1 — Browser smoke test.** Playwright + a WebGL-capable Chromium in CI (needs
  `VITE_MAPTILER_API_KEY` as a repo secret): load, confirm the shadow layer paints, drag the
  timeline, calculate a two-point route. Closes #35.
- **G2 — Route benchmark.** A repeatable scripted 2-point and 5-point calculation reporting
  `window.__shadeMapMetrics` numbers; commit the baseline. Unblocks #37/#38 (nobody may claim
  a perf win without it).
- **G3 — Bundle budget in CI.** Fail the build on regression beyond a stated ceiling. Closes #57.
- **G4 — Shade accuracy harness.** Own the fixtures for Track A's A3 agreement number so the
  engine's accuracy is a tracked metric, not a vibe.
- **G5 — A11y baseline.** axe run in CI, a recorded score, and a burn-down plan for the 127
  warnings. Closes #39/#40.
- **G6 — Seam work (see §4).** Split `useNavigation.ts`, `MapView.tsx`, and `page.tsx` along
  track boundaries so teams stop colliding. **Highest-priority G item after G1.**
- **G7 — Repo hygiene, batched.** The p4 cluster: LICENSE (#52), per-directory `CLAUDE.md`
  files that root `CLAUDE.md` already claims exist (#50), `.env.example` (#53), PR/issue
  templates (#55), formatter repo-wide (#48), branch cleanup (#51), CHANGELOG (#56).
  One PR each, taken between larger items — never as a substitute for track work.
- **G8 — Security baseline.** Key referrer restrictions (#32, the only open p0), the vite 5→8 /
  vitest 2→4 advisories (#33), and a documented dependency-bump policy that respects the
  maplibre/suncalc pins.

**Owns.** `.github/**`, `vitest.config.ts`, `vite.config.ts`, `biome.json`, `e2e/**` (new),
`docs/notes/**` (baselines), and — by exception — the seam refactors in G6.

---

## 4. Dependencies, sequencing, and seams

### Dependency graph

```
G1 G2 G3 (proving ground)  ─────────────────────────► every other track's "done"
        │
A1 → A2 (ShadeField) ─┬─► A3 → A4 → A5 (worker)
                      ├─► A6 (sweep) ──────────────► D1 D6 D7   (best time)
                      ├─► A7 (canopy) ─────────────► believable routes everywhere
                      └─► C3 (camera-free probes) ─► C4 → C5
B1 → B2 → B3 → B4 → B5 ─► B6 (needs A2) ─► B7 ─► F1 (share card wants B7's sentence)
E1 → E2 ─► E5 (Trip) ─┬─► B8 (leg browsing)
                      └─► C4 (multi-stop planning)
D2 → D3 → D4 ─────────► D5 ─► D7 (needs F4/PWA notifications)
```

**The three things that unblock the most other work, in order:** `G1` (can anyone verify
anything?), `A2` (`ShadeField`), `E5` (`Trip`). If you are choosing what to staff first,
staff those.

### Seam work (G6) — read this before two teams touch the same file

Three files are contested by design and must be split before parallel work is safe:

| File | Lines | Split into | Goes to |
|---|---:|---|---|
| `app/hooks/useNavigation.ts` | 1445 | `useRouting` (pipeline), `useTrip` (waypoints/legs/saved), `useSketch` | E owns `useTrip`/`useSketch`; A owns the shade-source seam inside `useRouting` |
| `app/components/MapView.tsx` | 1377 | layer modules registered by feature (route layers, sketch layers, assistant pins, guidance layer) | each track owns its own layer module |
| `app/page.tsx` | 932 | keep it a composition root; each track adds one hook + one panel | shared, edits stay ≤20 lines per track |

**Until G6 lands:** any PR touching one of these three files says so in its first sentence,
stays as small as possible in that file, and does not reformat surrounding code.

### Track interfaces (the bright lines)

Each track publishes exactly one contract, and no other track reimplements what's behind it:

| Contract | Owner | Shape |
|---|---|---|
| `ShadeField` | A | `shadeAt(lng,lat,when)`, `sampleEdges(edges,when)`, `sweep(edges,times[])` → shade + source + confidence |
| `Guidance` | B | `{ maneuvers[], activeIndex, progressM, offRoute, eta }` |
| Agent tools | C | Tool wrappers only — every tool delegates to another track's module |
| `HeatModel` | D | `dose(minutesInSun, uv, profile)`, `heatScore(route, weather)` |
| `Trip` | E | ordered stops, legs, mode per leg, dwell, totals |
| Test/bench harness | G | `e2e/**`, benchmark scripts, accuracy fixtures |

If your track needs something behind another track's contract, **file an issue against that
track** and build against a stub in the meantime. Do not fork the logic.

---

## 5. How teams work (the loop)

Unchanged from the previous version of this file except for step 1.

1. **Pick the next unfinished checkpoint in your track**, in the order listed. Within a
   checkpoint, take the highest-priority linked issue (`gh issue list --label track-a`, etc.).
   If a checkpoint is bigger than one PR, split it into issues, take the first slice, and
   leave the rest filed. **If your track is blocked on another track's contract, build against
   a stub and say so in the PR.** Never idle, never ask which task to do next.
2. **Branch** from up-to-date `main`: `feat/…`, `fix/…`, `perf/…`, `a11y/…`, `chore/…`.
3. **Read before writing.** Root `CLAUDE.md` → the per-directory `CLAUDE.md` for the area
   (file one if it's missing — #50) → the file. Match the surrounding idiom.
4. **Implement**, with tests when the change is logic (`app/lib/**`, `app/services/**`,
   `app/hooks/**`). Behavior changes to `routing.ts`, `trainGraph.ts`, `shadeSampling.ts`,
   `app/lib/shade/**`, `app/lib/guidance/**`, or `app/lib/agent/**` require test coverage.
5. **Verify — all four gates, every time** (CI runs exactly these):
   - `npm run lint` — Biome; errors block, `warn`-level debt does not
   - `npm run typecheck` — must be clean (baseline: 0 errors)
   - `npm test` — must pass (baseline as of 2026-08-24: **156 tests, 23 files**)
   - `npm run build` — must succeed
   - UI/map changes: run `npm run dev` and confirm the thing actually works
6. **Commit** with a conventional-commit message (`fix: bound overpass proxy upstream waits`).
7. **Push and open a PR** with `gh`. **Never merge** — every PR stays open for the repo owner.
8. **Link the issue** — `Fixes #N` in the PR body. Assumptions go in the description.
9. **File what you found** — `gh issue create` for anything noticed and not fixed, with a
   priority (`p0`…`p5`), a type (`security`, `chore`, `docs`, `test`, `perf`, `a11y`,
   `feature`, `tooling`), **and a track label** (`track-a`…`track-g`).
10. **Go to 1.**

### PR descriptions

**Maximum four sentences. Nothing else** — no headings, no bullets, no test-plan section,
no checklists, no file summaries, no emoji. In order: (1) what this adds or fixes,
(2) why it was worth doing, (3) how it's implemented, (4) why that way. Three good sentences
beat four padded ones. Title stays a conventional-commit line.

### Guardrails

- **Hard invariants in root `CLAUDE.md` are non-negotiable** (maplibre pinned at `5.9.0`;
  `preserveDrawingBuffer`; `MapView` only via `React.lazy`; shadow color ↔ shade predicate
  coupling; `User-Agent` on Nominatim/Overpass; suncalc on 1.x). If a task genuinely requires
  breaking one, don't — file an issue describing the tradeoff and pick something else.
- **Never read or edit `.worktrees/`** or any `oldbuild/` copy.
- **Never** rewrite published history, force-push, commit secrets, or commit `.env`.
- **Free-tier only.** No new paid services or keys. Cerebras is the LLM (5 req/min, shared
  key pool) — respect that budget; don't add chatty LLM calls. Open-Meteo, Overpass,
  Nominatim, MapTiler free tier, Foursquare free tier are the sanctioned data sources; each
  needs caching and a polite request rate.
- **Honesty is a feature.** Any number the UI shows (shade %, dose, ETA, heat score) must be
  traceable to a method someone can read, with its uncertainty stated. When a model is crude,
  say so in the UI, not just in a comment.

---

## 6. How we'll know it worked

North star: **weekly returning users who calculate ≥1 route.** Per-track leading indicators:

| Track | Metric | Where it comes from |
|---|---|---|
| A | Shade-field vs pixel-sampler disagreement (pp); % of edges with `confidence > 0.8`; route calc p50 | G4 fixtures, `window.__shadeMapMetrics` |
| B | % of calculated routes that enter `NAVIGATING`; completion rate to `ARRIVAL`; reroutes per km | client instrumentation |
| C | Ungrounded-claim escapes (target: 0); p50 turn latency; tool calls per turn | C1 eval harness |
| D | Best-time chart opens per session; return-visit rate among users who opened it | client instrumentation |
| E | Share of routes calculated in a non-walking mode; wheeling-profile usage | client instrumentation |
| F | Share-link opens; installs; landing-page → route conversion | Vercel analytics (free tier) |
| G | Time-to-interactive on throttled 4G; bundle size; a11y score; CI wall time | CI |

---

## 7. Deliberately not doing (and why)

- **A second LLM provider or a paid model.** Free-tier guardrail; Cerebras + determinism work
  is enough for a grounded, narrow assistant.
- **Accounts, a backend database, or a sync service.** Local-first keeps the project free,
  private, and deployable from one repo. Saved trips and profiles stay in `localStorage`.
- **Driving navigation.** Out of mission. Under-own-power only.
- **Full CFD/SOLWEIG-grade microclimate simulation in the browser.** ASU needed lidar and a
  campus-sized scope; we need global coverage at interactive speed. Track A/D approximate it
  honestly and say so (D4/D8).
- **A native app.** PWA first; revisit only if a platform capability (background location,
  reliable notifications) becomes the blocker for D7.
- **Chasing Google's feature list.** When they ship "Prefer shade", the answer is not a better
  toggle — it's the time dimension, the heat units, the guidance cues, and the assistant that
  can explain its own map.
