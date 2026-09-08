# Handoff — the shade thread: G2 → A6 → A7/A8 → A5 → H1–H5

**Mission.** Build the differentiator. `ROADMAP.md` §2: everything else is table stakes or
catch-up; **this is the part a hiring manager asks a second question about.**

**Verified 2026-09-08 at `99bb418`.** Briefs: `TRACK_G.md`, `TRACK_A.md`, `TRACK_H.md`.

> **One checkpoint per PR.** This is a long thread — do not batch. A change that grows past its
> checkpoint stops being reviewable, and the reviewer is one person reading a four-sentence
> description.

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
constraints they declare.

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
