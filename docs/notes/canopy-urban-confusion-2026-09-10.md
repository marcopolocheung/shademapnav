# Does the canopy model read buildings as canopy? — A8c, the urban confusion gate

**A8c is a gate, not a step.** It moves canopy no closer to routing; it decides whether canopy
may approach routing at all. A8a (PR #282) established that the Meta/WRI v2 canopy height map
is *reachable* — browser-direct, range-read, a few hundred kilobytes for a route-sized box
(`canopy-raster-feasibility-2026-09-09.md`). Nothing in that result says the raster is
*correct*, and the specific way a global canopy-height model can be wrong in a city is that it
reproduces the thing a city is mostly made of. That is **#279**, and this note answers it.

**FAIL is a publishable outcome, not a failed session.** "Free global CHM is not reliable
enough in dense urban morphology" is a real finding, and a far better position than discovering
it after `ShadowField` depends on it.

The criteria below were written and committed **before any measurement was run** — see this
file's first commit. That ordering is the point: with results on screen there is every
temptation to decide afterwards what "acceptable" meant.

## Method

| AOI | centre | why |
|---|---|---|
| Madrid A3 | -3.7038, 40.4168 | A3 corpus |
| Kent, WA A3 | -122.2348, 47.3809 | A3 corpus |
| Singapore A3 | 103.8198, 1.3521 | A3 corpus, kept for comparability |
| Singapore CBD | 103.8510, 1.2840 | dense-urban stress case |

The A3 Singapore coordinate was retained for corpus comparability, but because it lies outside
dense urban morphology — it is the *country centroid*, and lands in reservoir and green land
(**#283**) — an additional Singapore CBD AOI was included as an urban-confusion stress test.

Inputs: the CHM v2 uint8 raster through `app/lib/canopyRaster/canopyCog.ts`; OSM building
footprints from Overpass; the acquisition-date index from `app/lib/canopyRaster/acqDate.ts`.
Footprints are rasterized onto the CHM's own pixel grid, so no resampling of heights occurs.

Measured, per AOI:

1. share of building-footprint pixels classified as canopy at >2 / >3 / >5 m
2. share of predicted canopy area falling inside footprints
3. CHM height vs building height, **stratified by building height**
4. contamination in the 0–2 m and 2–5 m rings outside footprints
5. canopy retention under an exact mask, a +1 m dilation and a +2 m dilation
6. imagery vintage and season per AOI

Out of scope: routing, `ShadowField`, UI, `CanopyTileStore`, MapTiler.

## Decision criteria — frozen before running anything

No arbitrary thresholds. What condemns the dataset is a **failure signature**, and the
signatures are these:

- CHM-positive area systematically occupying building **interiors**, especially at `>5 m`.
- CHM height **increasing with known building height** inside footprints.
- High-rise bins showing dramatically more contamination than low-rise bins.
- A large fraction of apparent canopy disappearing under an **exact** footprint mask.
- A second large collapse from only a **+1 m or +2 m** dilation — that is building-edge
  leakage, not vegetation.
- Singapore CBD showing substantial high-valued CHM over dense towers.

### Footprint overlap alone does not condemn it

Real crowns overhang roofs; that is ordinary. Footprint subtraction is a principled mitigation
for a separate reason — canopy over a building is not shading walkable ground, because the
building already occupies it. What is convincing is the **combination**: height correlation,
plus interior overlap, plus ring behaviour, plus dilation sensitivity. One overlap percentage
is not a verdict.

### The three diagnostic cases

- **Case 1** — interiors dirty, an exact mask fixes almost everything → potentially usable
  after building masking.
- **Case 2** — interiors dirty, and contamination extends 2–5 m *outside* footprints →
  registration error or model confusion. More dangerous, because masking cannot reach it.
- **Case 3** — CHM height tracks building height → the model is reproducing urban structure
  height. **This is the one that matters most.** If a 10 m building tends to contain ~10 m of
  CHM, a 30 m building ~30 m and a 50 m building ~50 m, that is no longer crowns overhanging
  roofs; it is the model responding to structures, and it likely rejects CHM v2 for routing.

### The three verdicts

- **PASS** — CHM v2 is sufficiently separable from buildings; proceed to A8b.
- **CONDITIONAL PASS** — usable only after building masking or another named mitigation, whose
  required preprocessing this note must then specify precisely.
- **FAIL** — urban structural confusion is too severe; do not feed CHM v2 into `ShadowField`.

## Results

*Measured 2026-09-10 by `scripts/canopy-urban-confusion.mjs`; this section is added in the
commit that follows the one freezing the criteria above.*
