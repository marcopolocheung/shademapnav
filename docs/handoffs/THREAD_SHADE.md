# Handoff — the shade thread: G2 → A6 → A7/A8 → A5 → H1–H5

**Mission.** Build the differentiator. `ROADMAP.md` §2: everything else is table stakes or
catch-up; **this is the part a hiring manager asks a second question about.**

**Verified 2026-09-09 at `f159b25`.** Briefs: `TRACK_G.md`, `TRACK_A.md`, `TRACK_H.md`.

> **One checkpoint per PR.** This is a long thread — do not batch. A change that grows past its
> checkpoint stops being reviewable, and the reviewer is one person reading a four-sentence
> description.

---

## Start here — G2, and the two-PR shape it needs

**Everything in front of G2 is now clear.** Wave 0 landed (#204, #208), and #215 — the Node bump
that was sequenced *before* G2 so the benchmark's baseline is measured on the runtime it will
keep — merged as **#253**, with the dependency follow-up as **#255**. `main` is on **Node 24.21.0**
and green. Nothing blocks the benchmark.

### The finding that shapes the work

**G2 reads `window.__shadeMapMetrics.summary`, and that object cannot currently state variance.**
Two issues were already filed against it, and one is worse than its own description:

| | |
|---|---|
| **#183** | `clearMetrics()` exists at `metrics.ts:161` but was never attached to the window object (`:82-86`). A multi-scenario benchmark cannot reset between cache-cold and cache-warm runs without reloading the page. |
| **#182** | Filed as p95 degenerating *"at small sample counts (≤20, the expected regime)"*. It is worse: `MAX_HISTORY = 20` (`metrics.ts:71`) is the **ceiling**, and `Math.min(Math.floor(N * 0.95), N - 1)` lands on the last element for **every N from 1 to 20**. There is no reachable sample count at which `p95TotalMs` is a 95th percentile — it is an unconditionally mislabeled **maximum**. There is no `p50` field at all, and `metrics.ts` has **no tests**. |

Verify both before trusting this paragraph:

```bash
node -e "for(const n of [1,10,20])console.log(n, Math.min(Math.floor(n*0.95), n-1), n-1)"
grep -n "clearMetrics\|MAX_HISTORY\|p95Idx" app/lib/metrics.ts
```

This is not a detail. G2's acceptance is *"reproducible numbers with variance stated"*, and A5
and H later prove their central comparison against the baseline G2 commits. Publishing a
variance figure that is secretly the worst single run is the exact shape of unearned claim the
checkpoint exists to prevent.

### PR 1 — fix the instrument (#182, #183)

`app/lib/metrics.ts` only. Add `p50TotalMs`, replace the percentile calculation with one that
does not degenerate at small N, expose `clearMetrics` on `window.__shadeMapMetrics`. Ship the
first tests `metrics.ts` has ever had — pure Node, no browser, no secret.

Small, and separate from G2 on purpose: it is production code with its own filed issues, where
G2 is a test harness. **Do not fold it into G2** — a benchmark PR that also changes the thing
being measured is unreviewable, and the reviewer is one person reading four sentences.

### PR 2 — G2 proper

`e2e/bench/**` plus `docs/notes/performance-baseline.md`. Reuse G1's fixed conditions as the
benchmark's fixed conditions — they already exist in `e2e/helpers/scenario.ts` (`CENTER`,
`START_TIME`, the share-link seeding), the `overpassGrid` stub, the fixture basemap, 1280x900,
`America/New_York`.

**Decisions already taken, so they do not need re-deriving:**

- **Keyless only** — the `smoke` project, not `smoke-live`. CI has no MapTiler secret (#173 is
  still open) and real tiles put network variance inside a number meant to be a baseline.
- **Canonical environment is local, not the GitHub runner.** A 2-core runner on SwiftShader runs
  ~3x slower (`smoke` is ~17 s locally against ~50 s in CI). A5's before/after must happen on one
  machine, so the baseline names that machine. The bench is an on-demand command, **not** a
  per-PR CI step.
- **No CI gate.** G2 measures and commits. Failing a build on regression is **G3**. Adding a gate
  here is the scope creep that makes the PR unreviewable.
- **No production code changes.** If a phase turns out to be uninstrumented, file it — do not
  widen the diff.
- **Not TTI.** #37 asks for TTI *and* route-calc; G2's acceptance names route calculation only.
  Say TTI is still outstanding rather than half-measuring it.
- **Variance is part of the deliverable.** N repeats, median and spread, flake budget stated.
- **`npm run bench` is already taken** by `vitest bench --run` (the shade sampling benchmark).
  Pick a different name — and note **#254** owns the collision if the vitest 5 port renames it
  first. Settle both names once, in whichever lands first.

**Fold in #243 (the detour sweep).** `maxDetourFactor = 2.0` at `app/lib/routing.ts:576` feeds
the prune budget at `:581`, and is ~10x the detour three independent studies find useful. G2
sweeps it and publishes what each value costs in compute and buys in shade. **G2 does not change
the constant** — #243 is labelled `track-h`, and H3 changes it later against the measured curve.
Same harness, one parameter varied: this is one PR with G2, not a second checkpoint.

### Also worth knowing

- **#256** — `metrics.ts:88-90` has a `NODE_ENV === "development"` block that destructures three
  fields and uses none of them. Filed, not fixed. Do not clean it up inside either PR.
- **#121 ("no usable browser on the dev machine") is stale** and still open. Playwright Chromium
  runs here: `LD_LIBRARY_PATH=$HOME/miniconda3/lib npx playwright test`, WebGL2 on SwiftShader.
  `smoke-live` passes locally against real MapTiler tiles, so a MapTiler key is present in `.env`.
- Node 24 lives at `~/.local/node24/bin` on this machine and is **not** on the default PATH —
  `/usr/bin/node` is still v20.20.1. Export it before running anything:
  `export PATH="$HOME/.local/node24/bin:$PATH"`.

---

## The dependency chain, and why it is this order

```
G2 ──► A5 ──┐
            ├──► H3 ──► H4 ──► H5
A6 ──► H1 ──► H2 ──┘
A7/A8 ─────────────► (better inputs to all of it)
```

| Step | Why it is here, not later |
|---|---|
| **G2** route benchmark | A5's acceptance is literally *"no benchmark → no claim"*, and H's central claim is a **comparison**. Building the measurement before claiming the improvement is the senior-shaped decision in this whole thread. |
| **A6** time sweep | H1 prices every edge at its own traversal time = N time buckets per route. Without the sweep that is N× a full sample and will not run at interactive speed. **A6 gates H entirely.** |
| **A7/A8** canopy | See below — this is the promoted item and it is also an experiment. |
| **A5** worker offload | H3's budget slider must never block the main thread. Depends on G2 existing. |
| **H1–H5** | The track. |

**Prerequisite from Wave 0: #204 (D0, real timezones) must land before H1.** An hour of clock
error is ~15° of sun. H1 would price every edge against a wrong sky and H4 would publish a gap
measured on a bad input. Also **#208** (access tags), or H2/H3 cannot enforce the access
constraints they declare. ✅ **#204 merged 2026-09-08** (PR #222); **#208 merged** (PR #221).

---

## Addendum 2026-09-09 — five findings from the literature pass

Three frontier papers were read in full and reconciled into `ROADMAP.md` §5c; the detail lives in
`docs/research/shade-thermal-comfort-literature-2026-09-09.md`. **Nothing below changes the order
of this thread.** Four items are context you want *before* writing a checkpoint's note, and one is
a new, optional, high-value piece of work.

| # | Lands on | What it changes |
|---|---|---|
| **#241** | **H2** | Minimising unshaded metres — H2's corrected objective — scored **worse than the plain shortest route in 24%** of 1200 O-D pairs (41% at 08:00). H2 still lands; maximised `shadeM` is a real defect. But the note must say the corrected objective is *better than shade* and *still not comfort*. Read before writing it. |
| **#243** | **G2 → H2/H3** | `maxDetourFactor = 2.0` (+250 m flat) is ~10× the detour three independent studies find useful (+1.3%, <3%, plateau at 110%). **Measure it in G2's sweep**; do not edit the constant on the strength of a citation. Cheapest available win for H3's frontier. |
| **#244** | **A7/A8** | Tree shade is worth **0.5×** building shade — published (Melnikov 2022 via Wen 2025), so A7 need not invent a weight. Same paper shows tree shade dominating at midday when building shade collapses, which is the *data* behind sequencing A7/A8 before H3. |
| **#245** | **A6/A7** | A one-hour **max-shade window** ("a pedestrian will step a few metres to find shade") — adopt deliberately with the A3 effect measured, or decline in writing. Biases *towards* reporting shade, the dangerous direction. |
| **#242** | **H1 + H4** *(new work, optional)* | Wen et al. publish a distance-dependent shade reward that makes edge cost **path-dependent**, then solve it with Dijkstra keeping **one label per node**. A label carrying more distance is *advantaged* downstream, so cost-only pruning can drop the optimum. **This is H1's stated open question, unresolved, in print** — and `paretoRoutes` is already the right machinery. Implementing it and publishing where the two searches diverge is H4's oracle-and-gap against an *external, citable* model. |

**If you take one thing into H2:** #241, because it is a claim you would otherwise have to walk
back after publishing. **If you take one thing into A7:** #244, because it is free.

**Not on this thread:** #246, #247 (Track D), #248, #249 (Track P).

---

## A7/A8 — promoted into Wave 1 on 2026-09-08, and why it matters twice

**The app reports "exposed" on a tree-lined street in July.** `ROADMAP.md` §2 concedes Geuneullo
already models street trees, so this is the gap between us and the *consumer* state of the art —
not a stretch goal.

**Nothing structural was preventing it.** The A2 contract already reserved the slot:

```
ShadeField.ts:36   type ShadeSource = "tiles" | "overpass" | "canopy" | "mixed" | ...
ShadeField.ts:39   /** 0 = full sun, 1 = fully shaded. */
ShadeField.ts:40   shade: number;          ← already a fraction, not a boolean
```

`canopy.ts` does not exist and `overpass.ts:399` fetches `way["building"]` alone. A7/A8 were in
"not yet prioritized" by accident, not by dependency.

**Three things that are fiddly — all are design decisions already in A7's acceptance, none is a
blocker:**
1. **Tag sparsity is the real one.** OSM street-tree coverage is wildly uneven. A canopy provider
   must report its own coverage honestly, the way `PrismProvider`'s doc comment demands —
   *"'no buildings here' and 'I haven't loaded this area' produce the same shade number and very
   different confidence."*
2. **A tree is not a prism.** Modelling a crown as an opaque solid **overstates** shade, which is
   the dangerous direction — you would route someone into sun while promising shade. The
   fractional `shade` field is what saves you.
3. **Seasonality.** ~10% transmittance leaf-on vs ~70% leaf-off. Document the month window per
   hemisphere.

**It is also the experiment that decides Wave 4.** A7+A8 are ~2–3 weeks and zero fieldwork.
**Measure the residual afterwards** — free canopy data may close most of the routing-decision
gap, and what it cannot close (transmittance, eye-level sky view factor, awnings and
scaffolding, physical ground truth) is the entire remaining case for a photo corpus. Decide
Option A against a measured number, not an assumption.

**Sequence it before H3** — "routes around tree shade" is a materially better flagship than
"routes around building shade", and the A2 contract means H never has to know a canopy source
exists.

---

## Track H — the traps, in the order they will bite

Full detail in `TRACK_H.md`. The three that cause silent, hard-to-find bugs:

1. **H2 — re-validate the dominance rule.** A pruning rule that was sound for
   `(distance, shadeM)` is **not automatically sound** once a label carries time *and*
   accumulated exposure. `TRACK_H.md` calls this "the single most likely place for a silent
   correctness bug in the track." State precisely which rule is valid under your waiting model.
2. **H5 — earlier arrival does not dominate later arrival.** Arriving early may require waiting,
   and the wait may itself break the exposure budget or hit a closed venue. Prove the rule; do
   not inherit it from the no-waiting case.
3. **H3 — three outcomes, never conflated.** An exact result on the discretized model; a bounded
   approximation with a stated gap; and *a search that hit its budget*. **A capped search that
   returns nothing has not proved the request is impossible**, and the UI must not say it did.

**H2 is also P5 material** — *"I found my own objective was measuring the wrong thing and proved
it with a fixture"* is a self-caught defect, which reads better than a caught bug. Write the note
properly the first time.

**H4 is what upgrades H from a demo to an algorithm you can defend.** Brute-force oracle on tiny
time-expanded graphs, property tests, then publish the gap, the runtime distribution and the
memory. **If the gap is bad, the number ships anyway — that is the point**, and it flows back
into P4.

---

## Invariants that bite this thread

- **#1** `maplibre-gl` stays at exactly **5.9.0**. Never run `npm audit fix --force` (see #211).
- **#2** `suncalc` stays on **1.x**, imported directly, single copy.
- **#3** `preserveDrawingBuffer: true` — shade sampling reads the canvas back.
- **#5** shade detection couples to shadow colour via `isBlueDominantShadowPixel`. H4 has a
  property test guarding the pixel-fallback path from leaking back in — keep it.
- `useNavigation.ts` and `MapView.tsx` are **contested files**. Keep diffs surgical; coordinate
  with Track E if E1 is in flight.

## Done when

`/gates` green per PR with the real output, `/checkpoint` before each PR is reviewed, and every
brief's `## Current state` block updated in the same PR as the work. **UI/map changes also need
`npm run dev` and a human look** — `npm test` never opens a browser, and `npm run e2e` covers
one path only. If you cannot look, say the check is outstanding rather than letting four green
gates imply it.
