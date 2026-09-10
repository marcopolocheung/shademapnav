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

## Verdict: **PASS**

**CHM v2 does not read buildings as canopy.** In all four AOIs the model puts *less* canopy on
buildings than chance would, contamination *falls* as you approach a footprint rather than
rising, and interior CHM does not track building height — including over Singapore's towers,
where 79 buildings with a median OSM height of 95 m carry a median interior CHM of 0.00 m.
Answering **#279**: no.

Two things must still be carried forward. Neither is a gate condition; both are A8d/A8e work:

- **Footprint subtraction stays**, for the reason the brief already gave. It costs at most
  17.4% of apparent canopy (Madrid; 0.0–4.5% elsewhere) and at most 20.9% even at +2 m, so it
  cleans up rather than deletes.
- **Season is unresolved and lands on Madrid.** Madrid's tile is 2020-02 imagery — leaf-off, in
  a city of planes — and its measured canopy is 4.1% of the AOI against Kent's 16.6%.
  Multiplying `canopy.ts`'s leaf-on transmittance onto a winter-derived crown extent would be
  wrong twice (#281).

**A8b is unblocked.**

## Results — measured 2026-09-10

Reproduce with `node scripts/canopy-urban-confusion.mjs`. Every read is cached under
`node_modules/.cache/umbra-canopy/`, so the numbers are stable across re-runs and the study
does not re-hit `source.coop`.

### What was read

| | Madrid A3 | Kent, WA A3 | Singapore A3 | Singapore CBD |
|---|---:|---:|---:|---:|
| canopy tile | `0331110121` | `0212300320` | `1322322311` | `1322322311` |
| pixels | 881×881 | 991×990 | 1341×1341 | 1341×1341 |
| ground resolution | 1.82 m/px | 1.62 m/px | 1.19 m/px | 1.19 m/px |
| overview level | 2 | 2 | 0 (native) | 0 (native) |
| compressed read | 119 KB | 341 KB | 763 KB | 192 KB |
| buildings (`way["building"]`) | 2,636 | 1,240 | 45 | 1,367 |
| with a known OSM height | 20.7% | 2.7% | 0.0% | 90.1% |
| footprint share of AOI | 31.1% | 13.5% | 1.8% | 26.3% |
| CHM >2 m share of AOI | 4.1% | 16.6% | 79.8% | 6.7% |
| max CHM | 22 m | 35 m | 43 m | 26 m |

800 m radius around each centre. The building counts and height coverage reproduce the #283
recon table to within one building, which is the first sign the two are looking at the same
place. Both Singapore AOIs read at native resolution because the 1.82 m overview is 2.39 m on
the ground at the equator — coarser than the 2 m target — so they cost ~4× Madrid's pixels for
the same ground area. Expected, not a bug.

### 1. Share of building footprint the model calls canopy

| | Madrid A3 | Kent, WA A3 | Singapore A3 | Singapore CBD |
|---|---:|---:|---:|---:|
| >2 m | 2.3% | 3.7% | 1.2% | 1.1% |
| >3 m | 1.6% | 3.2% | 0.9% | 0.9% |
| >5 m | 0.8% | 2.4% | 0.5% | 0.7% |

### 2. Share of predicted canopy standing on a building

| | Madrid A3 | Kent, WA A3 | Singapore A3 | Singapore CBD |
|---|---:|---:|---:|---:|
| >2 m | 17.4% | 3.0% | 0.0% | 4.5% |
| >3 m | 14.6% | 2.8% | 0.0% | 4.1% |
| >5 m | 10.3% | 2.6% | 0.0% | 3.7% |
| **footprint share of AOI (chance)** | **31.1%** | **13.5%** | **1.8%** | **26.3%** |
| ratio to chance, >2 m | 0.56 | 0.22 | 0.02 | 0.17 |
| ratio to chance, >5 m | 0.33 | 0.19 | 0.01 | 0.14 |

The chance row is what makes the rest interpretable, and it is the single most useful number in
this note. Canopy scattered at random over Madrid — 31.1% of which is roof — would land 31.1%
of itself on a building. It lands 17.4%. **Every AOI is below chance at every threshold, and
falls further as the threshold rises.** A model reproducing buildings would sit above 1.00, not
between 0.01 and 0.56.

Madrid's 17.4% is the largest raw figure in the table and the one most likely to be quoted out
of context. It is *canopy the model believes overhangs a roof*, which is ordinary — and it is
still a factor of two below what indifference to buildings would produce.

### 3. CHM inside footprints, by OSM building height

**Singapore CBD** — the stress case, and the only AOI where OSM's height coverage (90.1%,
n=1,231) can support this measure properly.

| building height | buildings | median height | median of mean CHM | median p90 CHM | area >2 m | area >5 m |
|---|---:|---:|---:|---:|---:|---:|
| 0–5 m | 26 | 1.0 m | 0.00 m | 0.0 m | 3.4% | 2.2% |
| 5–10 m | 40 | 7.5 m | 0.00 m | 0.0 m | 1.4% | 0.5% |
| 10–20 m | 1,028 | 10.0 m | 0.00 m | 0.0 m | 0.7% | 0.3% |
| 20–30 m | 25 | 24.0 m | 0.00 m | 0.0 m | 0.2% | 0.1% |
| 30–50 m | 33 | 36.0 m | 0.00 m | 0.0 m | 1.4% | 0.9% |
| **50+ m** | **79** | **95.0 m** | **0.00 m** | **0.0 m** | **1.0%** | **0.7%** |

**This is the table the gate exists for, and it is flat.** A 95 m tower contains no more CHM
than a 1 m shed; if anything the shortest bin is the dirtiest. Spearman ρ(building height, mean
interior CHM) = **0.090** over n=1,231 — a rank correlation of essentially nothing, on the
largest and tallest-tagged sample available. Case 3 does not occur.

| | Madrid A3 | Kent, WA A3 | Singapore A3 |
|---|---|---|---|
| Spearman ρ | 0.119 | 0.365 | — |
| n | 546 | 33 | 0 |

Madrid and Kent are descriptive only, and for opposite reasons: Kent's ρ=0.365 rests on
**33 buildings**, which is not a sample, and Madrid's 546 are a 20.7% slice biased toward
whatever gets tagged. Madrid's one anomaly is its 30–50 m bin at 25.3% area >2 m — **three
buildings**. Singapore A3 has no tagged heights at all and drops out entirely, which is the
limit #283 predicted.

### 4. Contamination by distance from the nearest footprint

| AOI | inside | 0–2 m out | 2–5 m out | >5 m out |
|---|---:|---:|---:|---:|
| Madrid A3 | 2.3% | 2.1% | 2.1% | 5.7% |
| Kent, WA A3 | 3.7% | 11.9% | 17.3% | 19.2% |
| Singapore A3 | 1.2% | 8.4% | 14.4% | 81.9% |
| Singapore CBD | 1.1% | 3.5% | 4.8% | 9.4% |

Share of each band's cells with CHM >2 m. Distances are exact Euclidean, in ground metres.

**The gradient runs the right way in every AOI.** Canopy density *rises* with distance from the
nearest building — monotonically in three of the four, and in Madrid the interior (2.3%) sits a
fifth of a point above its own two rings (2.1%) and less than half the open-ground band (5.7%).
Registration error or model confusion would produce the opposite: a hot ring hugging the
footprint edge, cooling to the background further out. There is no such ring anywhere. Case 2
does not occur.

### Control — the same mask, slid 50 m off the buildings

Clean interiors are the result this gate was most likely to get wrong, because a mis-projected
footprint mask produces them for free. So the mask was translated 50 m south-east and
re-measured. If the alignment were fictional, the two rows would match.

| | Madrid A3 | Kent, WA A3 | Singapore A3 | Singapore CBD |
|---|---:|---:|---:|---:|
| real mask, >2 m | 2.3% | 3.7% | 1.2% | 1.1% |
| **shifted 50 m, >2 m** | **2.9%** | **14.6%** | **27.5%** | **4.9%** |
| real mask, >5 m | 0.8% | 2.4% | 0.5% | 0.7% |
| shifted 50 m, >5 m | 1.5% | 10.8% | 22.3% | 3.0% |

Kent ×4, Singapore CBD ×4.5, Singapore A3 ×23. The mask is registered, and measure 1's low
interior figures are a fact about the model rather than about the geometry.

**Madrid is the weak case here — ×1.26 — and it is weak for a knowable reason.** Its imagery is
leaf-off, so there is barely any canopy in the AOI to misplace: at 4.1% canopy over 31.1%
footprint there is little dynamic range for the control to exercise. Madrid's PASS rests on the
other measures, not on this one.

### Is a clean interior the model, or is it nodata?

`0` in this raster means "no canopy detected", and A8a does not read the 1-bit validity mask, so
a wall of zeroes stamped over buildings would look identical to a correct answer. Share of cells
in each CHM band:

| AOI | where | 0 m | 1–2 m | 3–5 m | 6–10 m | 11–20 m | 21+ m |
|---|---|---:|---:|---:|---:|---:|---:|
| Madrid A3 | inside | 94.8% | 2.9% | 1.4% | 0.6% | 0.2% | 0.0% |
| Madrid A3 | outside | 92.5% | 2.6% | 1.6% | 1.7% | 1.6% | 0.0% |
| Kent, WA A3 | inside | 94.1% | 2.2% | 1.3% | 1.2% | 1.1% | 0.1% |
| Kent, WA A3 | outside | 76.4% | 4.9% | 4.7% | 5.3% | 6.4% | 2.2% |
| Singapore A3 | inside | 97.7% | 1.1% | 0.7% | 0.4% | 0.1% | 0.0% |
| Singapore A3 | outside | 17.5% | 1.3% | 2.2% | 14.4% | 55.2% | 9.4% |
| Singapore CBD | inside | 98.0% | 0.9% | 0.5% | 0.5% | 0.2% | 0.0% |
| Singapore CBD | outside | 88.7% | 2.5% | 2.7% | 3.8% | 2.2% | 0.0% |

Interiors are 94–98% zero, but the remainder is a graded tail through every band rather than a
cliff — including 0.1% of Kent's roof area above 21 m. That is a model emitting low values over
buildings, not a mask blanking them. It is evidence, not proof; reading the validity mask is the
clean answer and belongs to A8b.

### 5. Canopy retention under masking

| AOI | threshold | canopy cells | survives exact mask | survives +2 m |
|---|---|---:|---:|---:|
| Madrid A3 | >2 m | 31,654 | 82.6% | 79.1% |
| Madrid A3 | >5 m | 19,701 | 89.7% | 87.1% |
| Kent, WA A3 | >2 m | 163,237 | 97.0% | 94.1% |
| Kent, WA A3 | >5 m | 121,836 | 97.4% | 94.8% |
| Singapore A3 | >2 m | 1,435,425 | 100.0% | 99.9% |
| Singapore CBD | >2 m | 121,263 | 95.5% | 93.7% |
| Singapore CBD | >5 m | 83,107 | 96.3% | 94.8% |

**Masking cleans up; it does not delete the dataset.** The worst case is Madrid at >2 m, losing
17.4% to an exact mask and a further 3.5% to a +2 m dilation. There is no second collapse
anywhere, which is what building-edge leakage would look like.

The **+1 m dilation is not reported**, because it cannot exist: one pixel is 1.19–1.82 m on the
ground, so a +1 m dilation selects exactly the cells the exact mask does. Any future note
quoting a +1 m figure over this dataset is quoting the exact mask under another name.

### 6. Imagery vintage

| | Madrid A3 | Kent, WA A3 | Singapore A3 | Singapore CBD |
|---|---|---|---|---|
| date at AOI centre | 2020-02-20 | 2019-08-14 | 2017-10-17 | 2018-06-04 |
| dates in the tile | 2 (2020-02-19 … 2020-02-20) | 2 (2019-07-26 … 2019-08-14) | 26 (2015-01-17 … 2019-10-25) | 26 (2015-01-17 … 2019-10-25) |
| leaf-off risk | **yes** | no | no | no |

Confirms **#281** and the reason `acqDate.ts` is a grid rather than a field on a tile record: the
two Singapore AOIs share one tile and do not share a date — 2017-10-17 and 2018-06-04, sixteen
months apart, eight kilometres apart. A per-tile date would be wrong for one of them by
construction.

## Reading the results against the frozen criteria

| failure signature | found? |
|---|---|
| CHM occupying building interiors, especially at >5 m | **No** — 0.5–2.4% at >5 m, strictly below every exterior band in all four AOIs |
| CHM height increasing with known building height | **No** — ρ=0.090 over the CBD's n=1,231; the 50+ m bin is the second cleanest |
| High-rise bins dramatically dirtier than low-rise | **No** — the CBD's 0–5 m bin is the dirtiest at 3.4% |
| A large fraction of canopy lost to an exact mask | **No** — 82.6–100.0% retained |
| A second collapse at +1 m or +2 m | **No** — ≤3.5 points from exact to +2 m |
| Singapore CBD showing high CHM over dense towers | **No** — 1.0% of 50+ m footprint area above 2 m |

None of the three diagnostic cases occurs. Case 1 requires dirty interiors and there are none;
Case 2 requires a contaminated ring outside the footprint and the gradient runs the other way;
Case 3 requires height tracking and the stratification is flat.

## Limits of this study

Stated so that a later reader does not take the PASS for more than it is.

- **Four AOIs, 800 m radius, one date each.** This is a gate on the A3 corpus plus one stress
  case, not a global validation of CHM v2.
- **`way["building"]` only.** Multipolygon relations are excluded, matching the #283 recon so
  the counts stay comparable. Buildings OSM does not have are counted as open ground, which
  biases *against* the dataset — real canopy over an untagged building reads as contamination
  of the exterior bands, never of the interior.
- **Measure 3 is a Singapore CBD result.** Madrid's 546 tagged buildings are a biased 20.7%
  slice, Kent's 33 are not a sample, and Singapore A3 has none.
- **Zero is ambiguous.** The validity mask is unread (A8a); the histogram argues against a
  nodata stamp, it does not exclude one.
- **Madrid is leaf-off**, so its canopy extent is an under-count and its control is weak.
- **Heights are OSM's.** `render_height` is a MapTiler field and never appears in an Overpass
  response, so the precedence in `heightMForBuilding` degrades to `height` then
  `building:levels` × 3 here. The study parses `"12 m"` where the app's strict `Number()` would
  discard it; **that difference changed nothing** — zero values across all four AOIs needed the
  lenient parse — so it is not a finding about the app.
- **No 10 m default.** The app fills unknown heights with 10 m; a stratification cannot, or it
  would put a spike at 10 m through the middle of the correlation being measured. Only
  buildings OSM actually measured are binned.
