# The canopy raster in `ShadowField` — A8d

**A8d is the first A8 checkpoint that changes what Umbra answers.** A8a proved the
Meta/WRI canopy height map is reachable browser-direct, A8b built the store two
consumers read it through, A8c measured that it does not read buildings as canopy —
and all three deliberately committed Umbra to nothing. This one wires the raster into
the shadow field, so a route through a tree-lined street now reports the trees.

Files: `app/lib/shadowField/canopyRasterField.ts` (the march),
`createRasterCanopyProvider` in `app/lib/shadowField/providers.ts` (the policy above
the store), and the plumbing in `app/lib/shadowField/ShadowField.ts`.

## Marched, not tessellated

A7 turns an OSM tree into a `BuildingPrism`, because a tagged tree is a point and a
prism is what `shadowIndex` already eats. A route-sized patch of raster is ~800k
pixels; doing the same to it would hand `buildShadowIndex` a caster set two orders of
magnitude past what it was built for, in order to tessellate something that was already
a heightfield. So the raster is ray-marched instead:

> a point is shaded if, somewhere along the ray toward the sun, canopy stands higher
> than the ray does — `rayHeight(d) = d · tan(altitude)`.

Three details are not incidental to that.

**The crown starts on a trunk.** `CROWN_BASE_FRACTION` is A7's constant, now exported
and shared rather than re-picked, and the march applies it as an interval test: the ray
is blocked over a step when the heights the ray spans there overlap the heights the
crown spans. That is the same sweep `buildShadowIndex` builds for an elevated prism,
discretised — sunlit ground under the tree, shade displaced from the trunk, and the
band sliding outward as the sun drops. A model that painted the crown solid from the
ground would report shadow across that whole displacement, which overstates in the
direction that puts someone in the sun on a promise of shade.

**Nodata is stepped over, not read.** `CanopyPatch.valid` is `0` where the model
produced no answer, which is a different byte from a `0` height. The march skips those
pixels rather than reading a blank as bare ground, and `validFraction` carries the share
of the patch that was blank into the confidence.

**The march is capped at `MAX_MARCH_M` = 400 m**, the same number as `QUERY_PAD_M`.
Past that the ray is reading a patch that was never fetched to answer the question, and
`confidenceFor` is what docks a near-horizon answer instead.

## Footprint subtraction happens in `ShadowField`, not in the store

A8c settled *that* footprints are subtracted and left *where* open. It is here, because
this is the only place both sources are in hand: `CanopyTileStore` has no map, no
Overpass and no camera, which is exactly what lets its behaviour be tested against a
fake with no network, and a store that fetched buildings to answer a raster question
would have re-acquired the coupling it exists to remove.

`CanopyHeightField.masked(prisms)` rasterises the resolved building rings onto the
patch's own grid and zeroes them, memoised on the prism array's identity — the same
invalidation `PREPARED` already uses, and for the same reason. The exact footprint, no
dilation: A8c measured +1 m and +2 m too, and they cost little more but delete real
crowns at every building edge, and nothing measured says the extra reach buys anything.

Two consequences worth stating rather than leaving to be found. With **no** building
source resolved, nothing is subtracted — which only under-reports, since unmasked
canopy over a building shades ground the building already occupies and the building's
own shadow is not there to win the point. And the mask removes real overhanging crowns
along with any structure the model did read as canopy; A8c priced the whole subtraction
at **at most 17.4% of apparent canopy in Madrid and 0.0–4.5% elsewhere**, so it cleans
up rather than deletes.

## Season: the one deliberate choice (#281)

The raster says *"vegetation this tall"*. It never says *"this stops 90% of the beam"*.
That second number has an owner — `crownOpacity` in `app/lib/shadowField/canopy.ts` —
and A8d calls it rather than inventing a second one, with no tags, at the patch's centre
latitude, **on the query date**. That is exactly the call A7 makes for an untagged tree,
which the 2026-09-09 census says is 99.9% of them.

#281 asks that this not be composed silently, so here it is composed out loud. The
raster's crown *extent* is an observation from whatever date the imagery was flown, and
Madrid's is **2020-02** — leaf-off, in a city of planes. A8d applies **no vintage
correction**: it does not inflate a winter-derived extent, and it does not dock for one.

The direction is why that is acceptable rather than merely simple. A leaf-off extent
under-counts crowns, so the blended answer under-reports canopy shade in exactly those
cities — the safe direction, and the one this repo picks whenever a choice has one. The
table below shows the size of it: **Madrid reports 0.5% canopy shade where Kent reports
6.1% and Singapore 16–53%.** Correcting extent against the acquisition date is fusion
work, `acqDate.ts` already holds the dates for the three corpus tiles, and A8e is where
that lands.

## Two canopy sources, combined by maximum

`pointShadow` takes the darker of A7's crowns and the raster, never their sum. That is
the rule `ShadowIndex.opacityAt` already applies between two overlapping crowns inside
one index — the beam is either through a canopy or it is not — and compounding a tagged
plane tree with the raster pixel that *is* that plane tree would count one tree twice.

This is a placeholder and is labelled as one. A8e's fusion is spatial: CHM as the
baseline everywhere, municipal inventories replacing it where they exist, OSM refining
individual crowns.

## What an answer is worth

`SOURCE_BASE_CONFIDENCE["canopy-raster"]` is **0.45**, against `canopy`'s 0.35 and
`LOW_CONFIDENCE`'s 0.5.

- **Above OSM's crowns**, because the raster is a *presence* layer and OSM is not. The
  census found OSM holding ~23% of Madrid's inventoried street trees and ~1.0% of
  Singapore's; the raster covers every pixel of both, and A8c measured that it is
  separable from buildings rather than reproducing them.
- **Still below `LOW_CONFIDENCE`**, for the same reason `canopy` is: whatever it knows
  about trees, it knows nothing about the tower across the street. Canopy alone remains
  a request to consult another source, not a routing input.

It is multiplied by `validFraction`, and blending it with a building source still costs
`CANOPY_MIX_FACTOR`.

**What decides that an answer is `"mixed"` is the fetched patch, not the query.** The
field counts as canopy evidence when the *masked* patch has anything standing in it —
masked, so a corridor whose trees all stand on roofs reports the building source and is
not docked. But the patch is the whole route corridor plus `QUERY_PAD_M`, and unlike
A7's Overpass fetch, which was often empty, a city-sized patch of raster almost never
is. So **in practice every route through a treed city now reports `"mixed"`** and pays
the 0.9 dock. That is A7's rule applied to a source that is never empty, and it has one
routing consequence worth naming: the dock carries a tile-backed answer below
`LOW_CONFIDENCE` when the sun is between roughly **4.6° and 5.6°** (5.9°–7.1° for
Overpass), so routes calculated in that narrow band near sunrise and sunset, which
answered from geometry on `main`, will now take the canvas fallback.

`coverage()` cannot mask, because it promises to build no geometry, so it reads the
unmasked patch and is an **upper bound** on what sampling reports. The one case they
differ is the rooftop-only corridor, where `coverage()` says `"mixed"` and sampling says
`"tiles"` — the safe direction for a check whose only job is deciding whether a
fallback may be skipped. Like every other number in that block it is a **prior**, not a
measurement, and no corpus in this repo can calibrate it — A3's agreement harness
compares the field against a pixel sampler that cannot see a tree at all.

## What a route waits for, and the mitigation

`ShadowField.ready()` is awaited beside the routing-graph fetch, so a cold read is on
the interactive path. It is slow, and it is slow for a reason A8a already diagnosed: the
cost is ~150 sequential range requests rather than bytes, because `geotiff.js` is opened
with no block cache and no multi-range batching. That is **#290**.

So A8d bounds the wait and not the read. `READY_BUDGET_MS` is 2500 ms; past it `load()`
resolves, the route calculates from whatever else can speak for the area, and the fetch
keeps running so the next query over that area finds it cached. As A8d shipped, **the
raster therefore missed the first calculation over any new area**.

**#290 fixed the read, and with it that caveat.** `cogTileSource.ts` now opens each COG
with a 64 KiB block cache, which folds the tiny offset reads and the IFD walk into a
handful of block-aligned ranges. Measured live on 2026-09-10, cold, with Chromium's HTTP
cache disabled:

| | no block cache | 64 KiB blocks | pixels |
|---|---:|---:|---|
| Madrid, route-sized area | 6.2–7.3 s · 43 requests | 1.6–1.9 s · 5 requests | identical |
| Kent, route-sized area | 6.6–6.9 s · 43 requests | 1.6–1.8 s · 6 requests | identical |
| Singapore CBD, route-sized area | 7.9–8.5 s · 55 requests | 0.9–1.5 s · 5 requests | identical |
| Singapore CBD, the provider's largest area (4738²) | 107.1 s · 679 requests | 10.0 s · 41 requests | identical |
| Madrid, the provider's largest area (3111²) | 21.0 s · 313 requests | 5.9 s · 32 requests | identical |
| two overlapping Kent reads, first aborted | 806 requests | 92 requests | second matches a fresh read |

It costs ~2–3x the bytes on a route-sized read (~320 KB against 100–185 KB), which
does not matter when the cost is round trips. The route-sized reads now land inside the
budget — `ready()` waited 1.2–1.9 s in the bench below — so the raster reaches the first
route over an area. The budget stays for the largest areas and for slower connections
than this one.

## Measured, 2026-09-10

### Live, against `source.coop`

Chromium 136 on SwiftShader under WSL, domestic connection. Reproduce with
`npm run bench:canopy` (`e2e/bench/canopyShadowField.bench.spec.ts`). A 600 m line
through each corpus centre, cut into the 25 m edges a routing graph produces, with **no
building source** — so these are the raster alone.

| AOI | `ready()` waited | read landed after | `ready()` again | valid | tallest |
|---|---:|---:|---:|---:|---:|
| Madrid A3 | 2501.6 ms | 6688.3 ms | 0.1 ms | 100.00% | 19 m |
| Kent, WA A3 | 2501.3 ms | 6352.3 ms | 0.0 ms | 100.00% | 35 m |
| Singapore CBD | 2500.7 ms | 9157.5 ms | 0.1 ms | 100.00% | 19 m |
| *after #290:* Madrid A3 | 1856.0 ms | inside the budget | 0.0 ms | 100.00% | 19 m |
| *after #290:* Kent, WA A3 | 1241.1 ms | inside the budget | 0.0 ms | 100.00% | 35 m |
| *after #290:* Singapore CBD | 1288.0 ms | inside the budget | 0.1 ms | 100.00% | 19 m |

Mean canopy shade over the line, and the confidence reported with it:

| AOI | 2026-07-15 08:00Z | 11:00Z | 17:00Z | 2026-01-15 11:00Z |
|---|---:|---:|---:|---:|
| Madrid A3 | 0.5% · c0.45 | 0.5% · c0.45 | 0.5% · c0.45 | 0.2% · c0.45 |
| Kent, WA A3 | sun down | sun down | 6.1% · c0.45 | sun down |
| Singapore CBD | 16.4% · c0.45 | 43.1% · c0.23 | sun down | 52.5% · c0.22 |

Three things this says.

**The chain works on real data.** Real tiles, stitched by the store, decoded, masked,
marched, and out the other end as an `EdgeShadow` with a source and a confidence.

**Singapore is the inversion the brief predicted.** A7's census found **zero** tagged
canopy of any kind in 2 km² of the A3 Singapore corpus. The raster puts 16–53% of a CBD
street in canopy shade. Absence of an OSM tree is not absence of a tree, and here it is
not even weak evidence.

**Madrid is #281, measured through the routing path.** 0.5%, against Kent's 6.1% on
leaf-on imagery, over a corpus centre that is dense city core. A8c's raw canopy figures
say the same thing (4.1% of the AOI against Kent's 16.6%); this is what that becomes
once it is a number a route quotes.

The July/January pair moves for two reasons at once, and this note does not separate
them. Madrid's 0.5% → 0.2% is in the direction the 0.90/0.30 leaf-on/leaf-off
transmittance predicts, over an extent that does not change — but the January sun is
also lower, which lengthens every shadow, so the ratio is not a clean read of the
transmittance alone. Singapore is inside the tropics, where `canopy.ts` models no
leaf-off season at all, so its January figure is the sun and nothing else.

### Cost of the march itself

Node v20.20.1 under WSL, synthetic patch at 1.82 m/px with ~25% canopy in blobs.

| | |
|---|---:|
| build a field over 2600×2600 (6.8 MP) | 31–34 ms |
| `sampleEdges`, 120 edges (a 3 km route) | 4–8 ms |
| `sweep` over 12 hours, same edges | 9–10 ms |
| mask 2,636 footprints (Madrid's A8c count) over 6.8 MP | 69 ms |
| the same mask again | 0.0 ms (memoised) |

Two of those deserve a sentence. The **69 ms mask** is a real cost on the route path,
paid once per (patch, building set); roughly half of it is the scanline fill and half is
the rescan for `maxHeightM` and `validFraction` that follows it. And the **march is
cheap** — single-digit milliseconds for a whole route — which is the payoff for not
tessellating: there is no earcut, no index build and no caster preparation in this path
at all.

For scale, the pixel sampler this is beside costs **1136–2164 ms** per route calculation
and answers 0% of edges (#259).

## What this does not do

- **Paint anything.** The map still draws no canopy, so a route card can say "from tree
  canopy" over a street the renderer shows in full sun. That is **#275**, and it closes
  at A8f, not here.
- **Say how much of a blended fraction was canopy.** `EdgeShadow` reports one number, so
  Track E still cannot apply the published 0.5 preference weight — **#277**.
- **Correct for imagery vintage or age** — **#281**, A8e.
- **Fuse the two canopy sources spatially** — A8e.
- ~~**Make the first route over a new area see the raster** — **#290**.~~ Fixed by #290
  for route-sized areas; see *What a route waits for*.
