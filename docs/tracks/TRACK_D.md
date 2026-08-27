# Track D — Heat & Timing

> **Charter:** turn a blue-pixel fraction into something a body understands — UV dose, burn
> time, a heat score — and answer the question the incumbents aren't answering: **when should
> I go?**

**Class:** Adjacent. **Runs alongside:** B, C, E, G freely; coordinate with A on the sweep API (A6).

---

## Current state

- **Active checkpoint:** D1 (not started)
- **Done:** nothing — but `app/lib/bestTime.ts` is **already written and tested**; D1 is wiring, not building
- **Open PRs:** none
- **Decisions made:** none yet
- **Blocked on:** nothing (D1 works with today's sampler; D6 wants A6)
- **Next action:** D1 — render the hourly exposure series that already exists
- **Last verified:** 2026-08-24, 156 tests / 23 files green on main

---

## Why this track exists

Two facts, side by side:

1. **The engine for "best time to go" is already in the repo and reaches no user.**
   `app/lib/bestTime.ts` exports `buildHourlyExposureSeries()` (sweeps a day at a configurable
   step, 6:00–20:00 by default, timezone-correct via `fromMapLocal`/`toMapLocal`) and
   `bestExposureSample()`. It has tests (`__tests__/bestTime.test.ts`). It has **zero importers
   outside its test file**. PR #108 landed the library and stopped.
2. **The app's only heat metric is `shadeCoverage: 0..1`.** Nobody's body has a unit for that.
   The 2026 research consensus (ASU Cool Routes on mean radiant temperature; CoolPath on UTCI
   at 2 m; CoolPaths on street-scale PET) is that the meaningful quantity is radiant/thermal
   load — and every free input for a decent approximation is one Open-Meteo call away.

"When" is also the retention question. A route answer is used once; a "best window this
morning" answer is checked daily by runners, dog walkers, and stroller parents.

## What already exists

- **`app/lib/bestTime.ts`** — the sweep, with a `ShadeCoverageSampler = (date) => number`
  injection point. It doesn't care where shade comes from, so it works today with the canvas
  sampler and switches to Track A's `sweep()` for free.
- **`app/services/weather.ts`** — Open-Meteo integration already shipped for cloud cover:
  `fetchCloudCoverForecast()` + `nearestCloudCover()` with a ±90 min match window, `forecast_days: 7`,
  `past_days: 1`, no API key. **Extend this file; don't start a second weather client.**
- **`shadeSampling.ts:computeSolarIntensity()`** — the existing sun-strength scalar, already
  feeding the routing cost model (`dijkstra`'s `solarIntensity` option, `routing.ts:340`).
- **`AccumulationPanel.tsx`** + the GeoTIFF export — sun-exposure accumulation over a window
  already renders; the visual language for "exposure over time" exists.
- **`RouteTradeoffSummary.tsx`** — where "+4 min, −62% sun" lives today; the heat score joins it.

## Hard invariants that bite this track

- **Honesty is a feature** (AUTONOMOUS_GOAL guardrail). Every number this track shows must
  have a written method and a stated uncertainty. A heat score with false precision is worse
  than no heat score.
- **No medical framing.** Burn time is an estimate with error bars for a sun-sensitive person
  to use as *context*, never advice. Say "estimate", show the assumption (skin type, UV,
  altitude ignored), and never phrase it as a safe limit.
- **Free-tier only.** Open-Meteo: no key, ~10k calls/day non-commercial. One cached hourly
  fetch per location, shared by every consumer in the app.

## The contract this track publishes

`app/lib/heat/types.ts`:

```ts
export interface WeatherHour {
  time: Date; uvIndex: number; tempC: number;
  humidityPct: number; windMs: number; cloudPct: number; apparentTempC: number;
}

export interface SunDose { sed: number; burnMinutes: number | null; uncertainty: "low" | "medium" | "high" }

export interface HeatScore {
  score: number;              // 0–100, comparable across route options
  method: "shade-uv-v1";      // versioned — the UI links to docs/notes/heat-model.md
  inputs: Partial<WeatherHour> & { sunMinutes: number };
  confidence: number;
}

export function dose(sunMinutes: number, uv: number, profile: UserProfile): SunDose;
export function heatScore(route: RouteOption, weather: WeatherHour, profile: UserProfile): HeatScore;
```

---

## Checkpoints

### D1 — Ship the orphan
**Goal.** The hourly exposure chart reaches a user. Closes **#47**.
**Approach.** Feed `buildHourlyExposureSeries` with the existing shade sampler for the
*selected route*, render a compact hour strip ("70% shaded before 10am, 25% at 2pm"), tap an
hour to set the timeline to it (`useShadowTime.setDate` / `handleSliderChange` already exist).
Live in `DirectionsPanel` beneath the tradeoff line, collapsed by default on mobile.
**Acceptance.** Chart matches the map: tapping 14:00 sets the timeline to 14:00 and the map's
visible shade agrees with the bar; timezone correct away from the user's own (`timezone.ts`
has the helpers and tests); keyboard navigable; reduced-motion respected. Sampling 14 hours
must not freeze the UI — sample lazily/incrementally until A6 lands.
**Files.** exposure-chart component (new), `DirectionsPanel.tsx` (⚠️ Track E owns — coordinate),
`app/lib/bestTime.ts`. **Size.** Medium.

### D2 — Generalize weather ingestion
**Goal.** One cached hourly weather record for the whole app.
**Approach.** Extend `weather.ts` to request `uv_index`, `temperature_2m`,
`relative_humidity_2m`, `wind_speed_10m`, `apparent_temperature`, `cloud_cover` in one call;
return `WeatherHour[]`; cache by rounded lat/lng + hour; keep the existing ±90 min matching.
**Acceptance.** One network call serves cloud badge + UV + heat score; existing cloud-cover
tests still pass; a failed/absent forecast degrades every consumer gracefully (the app must
work with no weather at all).
**Files.** `app/services/weather.ts`, tests. **Size.** Small–medium.

### D3 — Exposure → dose
**Goal.** Minutes in sun become a number a sun-sensitive person can act on. Closes **#63**.
**Approach.** `app/lib/heat/dose.ts`: standard erythemal dose from UV index × exposed minutes ×
a skin-type factor; burn-time estimate as a range. Document every assumption in
`docs/notes/heat-model.md` (no altitude/albedo/clothing modelling; cloud attenuation via D2;
shade attenuation is not zero — diffuse sky radiation still reaches you, and the model must
say so rather than pretending shade is 100% protection).
**Acceptance.** Pure, unit-tested, with a table of expected values for known UV/skin
combinations; ranges not point values; `docs/notes/heat-model.md` exists and the UI links to it.
**Files.** `app/lib/heat/**`, `docs/notes/heat-model.md`. **Size.** Medium.

### D4 — Route-level heat score
**Goal.** Compare route options on heat, not geometry.
**Approach.** Combine sun-exposure minutes, UV, air temp, humidity, and wind into one 0–100
score per option — a documented UTCI-flavoured approximation, explicitly **not** a claim of
physical exactness. Sits beside the tradeoff sentence: "+4 min, −62% sun, heat 38 vs 61".
**Acceptance.** Method and limits written down and linked from the UI; the score orders route
options the same way a human would on obvious cases (all-shade vs all-sun at noon); degrades
to shade-only when weather is unavailable, and says which mode it's in.
**Files.** `app/lib/heat/score.ts`, `routeTradeoff.ts`, `RouteTradeoffSummary.tsx`. **Size.** Medium.

### D5 — Personal profile
**Goal.** The same route is a different problem for different people.
**Approach.** Local-only settings (no accounts): skin sensitivity, heat tolerance, pace
(overrides the mode speed), "I burn easily" / "I overheat" toggles. Feeds `dose()`, `heatScore()`,
and the routing shade weight. Persist in `localStorage` beside saved routes.
**Acceptance.** Changing the profile visibly changes dose, score, and route ranking; defaults
are neutral; nothing is transmitted anywhere; a11y-clean form (labels are associated — PR #96's
pattern).
**Files.** `SettingsPanel.tsx`, `app/lib/heat/profile.ts`. **Size.** Medium.

### D6 — Best-time surfaces
**Goal.** Make "when" a first-class answer, not a chart buried in a panel.
**Approach.** "Best window today" on the home screen and on every saved route; a compact hour
strip; cloud-aware phrasing ("shade matters less at 14:00 — 90% cloud"); switch the sampler to
Track A's `sweep()` so a 14-hour answer is instant.
**Acceptance.** Home screen answers "when should I go?" without the user calculating a route
first; the answer changes correctly with date, place, and profile.
**Files.** best-time components, `page.tsx` (⚠️ contested, keep it ≤20 lines). **Size.** Medium.
**Wants A6.**

### D7 — Morning routine
**Goal.** The habit loop. Part of **#64**.
**Approach.** With a saved commute (Track E's E8) and the PWA shell (already shipped), an
opt-in local notification: "today: shadiest commute window 8:10–8:40, UV high after 11."
**Acceptance.** Opt-in only, one notification per day maximum, trivially disabled, correct
when the user travels. Verify what a PWA can actually schedule on iOS before promising it —
if it can't, ship the in-app morning card instead and say so in the brief.
**Files.** `public/sw.js`, notification module. **Size.** Large. **Needs Track F's F4 (offline/PWA depth).**

### D8 — MRT-grade upgrade *(stretch)*
With Track A's A9 (sky view factor, surface class), build a defensible MRT approximation and
compare it against published SOLWEIG outputs for one city block. Publish the delta honestly in
`docs/notes/heat-model.md` — including where we're worse. That comparison is also the most
credible thing this project could show an urbanist.

---

## Subagent plan

- **D2 and D3 are swarm-able** (disjoint: one is a service wrapper, one is pure math) once
  `WeatherHour` is committed.
- **Scout** for the science: "what erythemal dose formula do the standard references use, and
  what's the accepted skin-type factor table?" — bounded, high-value, and it keeps citations
  out of the implementation context.
- **D1, D4, D6 are solo** — shared UI surfaces.
- **Verifier on D3 and D4.** Health-adjacent numbers deserve a cold reader checking the
  method against the doc.

## Risks

1. **False precision.** "Burn time: 23 minutes" is a lie dressed as help. Ranges, uncertainty
   labels, and a linked method — or don't ship the number.
2. **Shade ≠ zero exposure.** Diffuse sky radiation is real; a model that zeroes shaded minutes
   overstates the benefit of the app's own routing. Get this right or the whole track loses trust.
3. **Weather call amplification.** Every panel wanting its own fetch will blow the free tier.
   One cache, one owner (D2).
4. **Sampling cost before A6.** A 14-hour sweep on the canvas sampler is 14 renders. Sample
   lazily in D1 and don't let the chart block the UI.

## Out of scope / hand-offs

- Shade geometry and the sweep API → **Track A**.
- Route cost weighting → **Track E** (D supplies the profile weights; E applies them).
- Saved commutes → **Track E** (E8). PWA notification plumbing → **Track F** (F4).
- Medical advice, of any kind, ever.
