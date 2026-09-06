# Track D — Heat & Timing

> **Charter:** turn a blue-pixel fraction into something a body understands — UV dose, burn
> time, a heat score — and answer the question the incumbents aren't answering: **when should
> I go?**

**Class:** Adjacent. **Runs alongside:** B, C, E, G freely; coordinate with A on the sweep API (A6).

---

## Current state

- **Active checkpoint:** D5 — D4 is in review (PR on `feat/d4-heat-score`, closes #194)
- **Done:**
  - D1 — `HourlyExposureStrip` + `useHourlyExposure` render the day's shade for the selected
    route under the tradeoff line, in both route surfaces. Closes #47.
  - D2 — `weather.ts` fetches every hourly variable in one cached call and returns
    `WeatherHour[]`; the cloud badge, the dose and the heat score share that one request.
  - D4 — `app/lib/heat/score.ts` scores the selected route 0–100 on felt temperature and
    renders it beside the tradeoff line, with `docs/notes/heat-score.md` linked from the UI.
- **Open PRs:** #189 (D3), the D4 branch
- **Decisions made:**
  - D1 samples Track A's `ShadeField.sweep`, not the canvas, so the day sweep never moves the
    camera. One hour per animation frame until A6 makes a sweep cheaper than N samples.
  - `bestTime.ts` keeps ownership of the schedule (which hours, labels, timezone); the hook
    only fills in the measurements.
  - The strip is passed into `DirectionsPanel` and `FloatingRouteCards` as a rendered node,
    so the mobile and desktop surfaces share one instance and one sweep.
  - **`WeatherHour`'s measured fields are `number | null`, not `number`** — a deviation from
    this brief's original sketch. Open-Meteo can omit a variable, and a dose computed from a
    fabricated `uvIndex: 0` would read as a safe hour rather than an unknown one.
  - The forecast cache is keyed by location (~1.1 km cells) with a 1-hour TTL, not by target
    hour: one response already spans 8 days, so moving the timeline is a cache hit.
  - **The heat score scales with shortwave radiation, not UV index** — another deviation from
    the contract this brief sketched, and the method id is `shade-radiation-v1` rather than
    `shade-uv-v1` so it does not name a variable the model never reads. The UV share of global
    shortwave runs ~3.1% in January to ~7.8% in June, so a UV-scaled sun penalty would
    under-weight winter sun by more than 2× and mis-rank the same street across seasons. UV
    stays the right input for D3's dose, where erythema is the effect being estimated.
    `WeatherHour` gained `shortwaveWm2` on the same single request.
  - **Open-Meteo's `apparent_temperature` already contains a solar term** —
    `0.70 × 0.1 × max(0, shortwave − 550) / (0.75·wind + 10)`, up to ~2.5 °C — computed from
    grid-cell radiation with no local shading. `score.ts` subtracts it before adding a
    shade-aware penalty, or a fully shaded route would still be charged for sunshine.
  - The score is an **intensity, not a dose**: it says how hot the walk feels, not how much
    heat it accumulates. Duration is already on screen as "+4 min" and "3 min in sun", and
    folding it in would rank a long shaded walk worse than a short scorching one silently.
  - `HeatScore` lives in `score.ts`, not `heat/types.ts`, only to avoid a certain conflict
    with #189 in a file both branches append to. Worth collapsing once #189 lands.
  - **`WeatherHour.windMs` was km/h.** Open-Meteo answers in km/h unless asked, and D4 is the
    first consumer to divide by that number — inside Steadman's own formula, where the unit
    is m/s. `weather.ts` now sends `wind_speed_unit=ms` and a test pins it.
  - **The shade-only score does not borrow the word "Heat".** 70 on the felt-temperature ramp
    is ≈35 °C; 70 in shade-only mode is 70% of the walk in sun. The UI reads "61% of this walk
    is in sun · no weather forecast — heat not scored" instead, and `heatBand()` puts UTCI's
    category name in front of the scored number so a first-time reader gets a word, not an
    index. The category is published; the even 20 points between categories are not.
  - `useWeatherHour` deliberately passes **no `AbortSignal`**. `fetchWeatherForecast` memoizes
    the *promise*, so aborting on cleanup cancelled the fetch for every other consumer and
    stranded the next effect run on the already-rejecting cached entry — the heat line stuck
    on "no forecast" after a pan or an hour-crossing drag. A stale-result flag is the correct
    cancellation for a shared cache, and a signal-aware test pins the regression.
- **Blocked on:** nothing (D6 still wants A6)
- **Next action:** D5 — `SettingsPanel.tsx`, `app/lib/heat/profile.ts`. Both `dose()` and
  `heatScore()` already take their person-dependent inputs as an explicit argument with no
  default, so D5 is the first caller rather than a retrofit.
- **Known limitation to close in D4/D6:** "Shadiest around 7 PM" is true but weakly useful
  near sunset, where everything ties at fully shaded. D4's `sunPenaltyC` is the weighting the
  D1 series needs — it goes to zero after dark, which is exactly the tie-break missing today.
- **Last verified:** 2026-09-06, 440 tests / 37 files green. D4 confirmed in a browser
  (Playwright, fixture basemap) on all four paths: with a stubbed 900 W/m² / 34 °C apparent
  forecast the card reads "EXPERIMENTAL · strong heat stress / Heat 69 · feels about 35 °C
  walking this"; with wind missing it drops to "about 34 °C — air temperature only"; with
  Open-Meteo unreachable it stops saying "Heat" at all and reads "61% of this walk is in sun
  · no weather forecast — heat not scored"; and at 375×667 the mobile sheet scores the row
  rather than degrading it. The method link's hit box measures 108×44 px.

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
