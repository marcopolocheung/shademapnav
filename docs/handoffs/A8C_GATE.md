# Handoff — A8c, the urban confusion gate

**Written 2026-09-10, after A8a landed (PR #282).** Brief: `docs/tracks/TRACK_A.md` → *A8 —
Canopy from the raster*. Measurements A8c builds on:
`docs/notes/canopy-raster-feasibility-2026-09-09.md`.

> **A8c is a gate, not a step.** It does not move canopy closer to routing. It decides whether
> canopy may approach routing at all. Its deliverable is a measurement note and a verdict —
> and **FAIL is a real, publishable outcome**, not a failed session.

---

## The distinction to hold onto

Two questions get run together, and they have different answers:

| | |
|---|---|
| **Can the gate be run?** | **Yes.** Fully, now. Pure Node, no key, no browser, no new dependencies. |
| **Will CHM v2 pass it?** | **Unknown.** That is the entire point of running it. |

A8a proved the data is *reachable*. Nothing so far says it is *correct*. Do not let the
smoothness of A8a's result carry any implication about A8c's.

## Sequence — A8b is deliberately skipped

```
A8a  Can we obtain CHM v2 cheaply and reliably?      ✅ landed, PR #282
A8c  Is CHM v2 safe enough in cities?                ❓ run this
       ├─ PASS / CONDITIONAL → A8b → A8d → A8e → A8f
       └─ FAIL → stop CHM v2 routing work; write it up
```

The slice table lists A8b before A8c. **Take A8c first.** A8b is live-app debt — caching,
dedupe, cancelling stale reads across the viewport and the route corridor. A8c is an offline
measurement study and needs none of it. Building the caching layer for a source that may be
discarded is the wrong order.

**Do not start A8b in the same session because A8c looks promising.** Finish the note, record
the verdict, stop.

---

## Scope

```
AOIs
  Madrid A3            (-3.7038, 40.4168)
  Kent, WA A3          (-122.2348, 47.3809)
  Singapore A3         (103.8198, 1.3521)     ← corpus alignment
  Singapore CBD        (103.8510, 1.2840)     ← dense-urban stress case

Inputs
  CHM v2 uint8 raster          app/lib/canopyRaster/canopyCog.ts
  OSM building footprints      Overpass, as app/lib/overpass.ts already queries
  heightMForBuilding()         app/lib/overpass.ts:288 — reuse, do not reinvent
  acquisition-date index       app/lib/canopyRaster/acqDate.ts — already built

Measures
  1. share of building-footprint pixels classified as canopy at >2 / >3 / >5 m
  2. share of predicted canopy area falling inside footprints
  3. CHM height vs building height, stratified by building height
  4. contamination in 0–2 m and 2–5 m rings outside footprints
  5. canopy retention under exact mask, +1 m dilation, +2 m dilation
  6. imagery vintage and season per AOI

Out of scope
  routing · ShadowField · UI · CanopyTileStore · MapTiler
```

### Why four AOIs and not three

The A3 Singapore coordinate is the **country centroid** and lands in reservoir/green land:
45 buildings in 2 km², none with a height. Eight kilometres south, Raffles Place has 1,366
buildings at 91.8% height coverage. Filed as **#283**.

Do **not** silently swap the pin. Keep the A3 point for comparability with every published A3
number, and add the CBD as the stress case, saying so explicitly:

> The A3 Singapore coordinate was retained for corpus comparability, but because it lies
> outside dense urban morphology, an additional Singapore CBD AOI was included as an
> urban-confusion stress test.

That is a stronger position than either dropping Singapore or letting the centroid stand in
for Singaporean urban form.

### Building heights: measured, and good enough

Measured 2026-09-10, 800 m radius, `way["building"]`:

| AOI | buildings | `height` or `building:levels` | use |
|---|---:|---:|---|
| Madrid A3 | 2,636 | 20.8% | usable, biased sample |
| Kent, WA A3 | 1,240 | 2.7% | descriptive only |
| Singapore A3 | 45 | 0.0% | too thin — report as a limit |
| **Singapore CBD** | **1,366** | **91.8%** | **the real stress test** |

Measures 1, 2, 4 and 5 need **footprints only** and run everywhere. Only measure 3 needs
heights, and Singapore CBD supplies them at 92% — which is precisely the adversarial case:
*does a high-rise tower turn into a high CHM value?*

**Do not add a MapTiler dependency for this.** `render_height` would improve Madrid and Kent's
stratification, but it is OSM-derived, so it adds no footprints where OSM has none, and it is
not needed to answer the central question. File it separately if measure 3's Madrid bias turns
out to matter.

---

## Freeze the decision criteria before running anything

**Write this section of the note first, with no numbers in front of you.** Otherwise there is
every temptation to see the results and then decide what "acceptable" meant.

Avoid arbitrary thresholds ("over 5% fails"). Define **failure signatures** instead. Evidence
that CHM v2 should stop before routing:

- CHM-positive area systematically occupying building **interiors**, especially at `>5 m`.
- CHM height **increasing with known building height** inside footprints.
- High-rise bins showing dramatically more contamination than low-rise bins.
- A large fraction of apparent canopy disappearing under an **exact** building mask.
- A second large collapse from only **+1 m or +2 m** dilation — building-edge leakage rather
  than vegetation.
- Singapore CBD showing substantial high-valued CHM over dense towers.

### Footprint overlap alone does not condemn it

Real crowns overhang roofs. That is ordinary, and the brief already notes footprint
subtraction is principled for a different reason — canopy over a building is not shading
walkable ground, because the building already occupies it.

```
      canopy
   ███████████
       █████████
        ┌───────┐
        │ house │
        └───────┘
```

What is convincing is the **combination**: height correlation + interior overlap + ring
behaviour + dilation sensitivity. One overlap percentage is not a verdict.

### The three diagnostic cases

```
Case 1   interiors dirty, exact mask fixes almost everything
         → potentially usable after building masking

Case 2   interiors dirty, contamination extends 2–5 m outside footprints
         → registration error or model confusion — more dangerous

Case 3   CHM height tracks building height
         → the model is reproducing urban structure height
         → likely reject for routing
```

**Case 3 is the one that matters most.** If a 10 m building tends to contain ~10 m of CHM, a
30 m building ~30 m, a 50 m building ~50 m, that is a smoking gun: no longer tree crowns
overlapping roofs, but the model responding to structures.

### The three verdicts

```
PASS               CHM v2 is sufficiently separable from buildings;
                   proceed to production transport and caching (A8b).

CONDITIONAL PASS   usable only after building masking or another mitigation;
                   document the required preprocessing precisely.

FAIL               urban structural confusion is too severe;
                   do not feed CHM v2 into ShadowField.
```

A FAIL still makes A8a + A8c worthwhile: it empirically kills a tempting but unsafe
architecture **before** anything integrates it, and "free global CHM is not reliable enough in
dense urban morphology" is publishable.

---

## Practical notes

**Cache the decoded raster on first read.** A8c measures the dataset, not `source.coop`'s
patience.

```
first run:  source.coop → readCanopyHeights() → local cache → all later analysis
```

A8a hit 504s, truncated responses ("buffer error") and a 300 s timeout after a few hundred
requests. Transient host failures must not contaminate the science, and re-running the
analysis must not re-hit the network.

**`readCanopyHeights` works in Node.** It was developed and exercised that way throughout A8a
despite being written for the browser — A8c needs no browser and no Playwright harness.

**Reuse the rasterizer.** `scripts/canopy-acq-index.mjs` has a scanline polygon fill that
already rasterizes lon/lat rings onto a Mercator grid with even-odd winding. Footprint
rasterization is the same operation; dilation is a small addition on top.

**Watch the read asymmetry.** Kent's tile is 271.8 MB. Both Singapore AOIs read at *native*
resolution — the 1.82 m overview is 2.39 m at the equator, too coarse for the 2 m target, so
they cost roughly 4× Madrid's pixels for the same ground area. Expected, not a bug.

**Public Overpass 504s under load.** Two of three recon queries failed first try. Use a
fallback endpoint (`overpass.kumi.systems`) and backoff. Note that `scripts/` is outside
`biome.json`'s `files.includes`, so scripts there are not linted — same as
`canopy-acq-index.mjs`.

**The A8 brief is not on `main`.** `TRACK_A.md`'s A8 section and `THREAD_SHADOW.md`'s A8
section live only on `docs/a8-canopy-raster`, and they do not cherry-pick cleanly — they sit
on A7's edits to the same two files. Read them from that branch. A8a carried across only
`docs/notes/canopy-raster-feasibility-2026-09-09.md`, which is standalone.

**Gate 3 does not pass on this machine.** `npm test` exits 1 under Node v20.20.1 — nine
jsdom-dependent files cannot start, and the repo declares `engines: node 24.x`. It reproduces
identically on `main`. CI pins Node 24. Do not read a green local `npm test` summary line as a
pass without checking the exit code.

## Related issues

**#279** — does the model read buildings as canopy? The question A8c exists to answer.
**#281** — Madrid's imagery is leaf-off (2020-02); one tile is not one date. Measure 6.
**#283** — the A3 Singapore corpus centre is the country centroid. Why there are four AOIs.
**#280** — the shelved `api/canopy.js` passthrough. Not a build item; do not build it.
