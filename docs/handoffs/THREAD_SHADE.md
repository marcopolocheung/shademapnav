# Handoff — the shade thread: G2 → A6 → A7/A8 → A5 → H1–H5

**Mission.** Build the differentiator. `ROADMAP.md` §2: everything else is table stakes or
catch-up; **this is the part a hiring manager asks a second question about.**

**Verified 2026-09-09 at `f159b25`.** Briefs: `TRACK_G.md`, `TRACK_A.md`, `TRACK_H.md`.

> **One checkpoint per PR.** This is a long thread — do not batch. A change that grows past its
> checkpoint stops being reviewable, and the reviewer is one person reading a four-sentence
> description.

---

## G2 is done — start here: A6

**Landed 2026-09-09 as #260 into #258.** Both halves shipped: the instrument fix (#182, #183 —
`p50TotalMs`, a percentile that does not degenerate, `clearMetrics` on the window, and the first
tests `metrics.ts` ever had) and the benchmark itself (`npm run bench:route`, `e2e/bench/**`,
baseline committed to `docs/notes/performance-baseline.md`, #243's detour sweep folded in). Every
decision this section used to spell out was honoured — keyless, local machine named, no CI gate,
no production code changes, not TTI, variance stated. Full record: `TRACK_G.md` → *Current state*.

### What G2 changed about the rest of this thread

**A5 was aimed at the wrong phase, and is re-scoped in `TRACK_A.md`.** It was written as a worker
offload. The benchmark says Dijkstra is **3–18 ms** of a ~3 s 2-point calculation while the
**canvas read is 1136–2164 ms** — a third to well over half of route latency. Offloading a 15 ms
search to a worker buys nothing a user can perceive.

**A4's acceptance criterion is measured and not met (#259).** A4 says
*"`window.__shadeMapMetrics` shows `canvasRead` at ~0 on the field path"*. It is over a second, on
**90 of 90 runs**, while `shadeFallbackShare` is **0.0% on all 90** — the canvas is read in full
every time and the pixel sampler it feeds then answers no edges. A4 closed on test evidence;
nothing had measured it. `TRACK_A.md`'s Current state already predicted the geometry path was
dormant, so this is that prediction with a number. **A5 already owned the fix**, and is now split:
**A5a** wakes the geometry path (acceptance = A4's criterion finally met and measured), **A5b**
offloads whatever is left and re-measures before assuming #38 is still worth doing.

**H3 has a curve instead of a citation.** The `maxDetourFactor` sweep is published: 1.25 → the
current 2.0 buys **5.8 pp of shade for 61 pp of extra walking** and roughly triples search time.
The constant is unchanged — that is H3's call against the numbers.

**Every before/after on this thread now has a noise floor.** Across-session spread is **~2–25% on
every scenario**, so a claimed win under ~25% needs the repeat counts raised first (**#263**,
which blocks on **#262**). Do not quote a per-row reproducibility figure: two sessions of three
runs produced near-opposite orderings of which scenario is tightest.

### Next: A6 — the time sweep

**It gates Track H entirely**, which is why it is next rather than A5a. H1 prices every edge at its
own traversal time — N time buckets per route — and without the sweep that is N× a full sample and
will not run at interactive speed. `TRACK_A.md` → A6 has the acceptance; #245 (the one-hour
max-shade window) is the design decision to take or decline *in writing* while you are there.

**A5a's two diagnostic steps are small, cheap and optional now.** Pure Node, no browser, no key:
reproduce the `coverage()`/`sampleEdges()` bbox mismatch in a test, and surface `EdgeShade.source`
in `metrics.ts` so it is visible which provider actually answered. They are what makes A5a
writable, and #259 carries the arithmetic. Take them if you want A5 sized properly before A7/A8;
they unblock nothing, so the thread order does not require them yet.

## The dependency chain, and why it is this order

```
G2 ──► A5 ──┐
            ├──► H3 ──► H4 ──► H5
A6 ──► H1 ──► H2 ──┘
A7/A8 ─────────────► (better inputs to all of it)
```

| Step | Why it is here, not later |
|---|---|
| ~~**G2** route benchmark~~ ✅ | A5's acceptance is literally *"no benchmark → no claim"*, and H's central claim is a **comparison**. Building the measurement before claiming the improvement is the senior-shaped decision in this whole thread. **It paid immediately: the first thing it measured was A4 not meeting its own acceptance criterion (#259).** |
| **A6** time sweep | H1 prices every edge at its own traversal time = N time buckets per route. Without the sweep that is N× a full sample and will not run at interactive speed. **A6 gates H entirely.** |
| **A7/A8** canopy | See below — this is the promoted item and it is also an experiment. |
| **A5** worker offload → **A5a/A5b** | H3's budget slider must never block the main thread — and G2 measured *which* thing blocks it. **A5a** wakes the dormant geometry path and deletes the canvas read; **A5b** offloads what remains, if anything still justifies it. Re-scoped in `TRACK_A.md`. |
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
