# Painting the canopy the routes already use — A8f

**A8d made the contradiction in #275 live everywhere.** The raster reaches the first route over
an area, nearly every route through a treed city reports `"mixed"`, and the card says *"from
building geometry and tree canopy"* over a map that drew no tree. `TRACK_A.md` risk #1: when
the field and the renderer disagree, the user believes the renderer. A8f paints the raster.

Files: `app/lib/canopyRaster/canopyPaint.ts` (what is painted and how it is read, no map),
`canopyLayer.ts` (the MapLibre shell), `sharedStore.ts`, `app/components/CanopyLegend.tsx`,
and the layer's lifecycle in `MapView.tsx`. Measurement: `studies/canopy-paint-predicate.mjs`.

## What it paints: canopy extent, not canopy shadow

Two readings of #275 were open. **This paints extent** — an "estimated tree canopy" fill
wherever the raster says vegetation stands at least 3 m tall — because that is what the source
is: a height model, "vegetation this tall stands here".

**Canopy *shadow* in the WebGL renderer waits**, for the reason #275 gave when it was filed.
Tree shadow is fractional: a crown stops ~90% of the beam in leaf and ~30% out of it
(`canopy.ts`). Painted fractionally, it either fails `isBlueDominantShadowPixel`, so the canvas
fallback cannot see it, or passes it, so the fallback counts it as full building shadow — the
overstating direction. That needs its own acceptance criteria against the predicate, and it
puts the renderer in scope. This checkpoint does not touch `LocalShadowAdapter.ts`.

So the map now shows *where the trees are*, and the route card's canopy share is *their shadow*
at the selected time — displaced from the crowns by the sun. Those are different things, and
the map only draws the first.

## The threshold: ≥ 3 m

A8c measured `>2`, `>3` and `>5` m. On uint8 whole-metre data `>2` is `≥ 3`, and that is the
one painted:

- It is the **lowest** A8c measured, so it hides the least of what `ShadowField` marches — the
  march casts from 1 m (`MIN_CANOPY_HEIGHT_M`), and every metre of threshold widens the gap
  between what the map shows and what the card counts.
- It was **already clean**: 1.1–3.7% of building footprint reads as canopy at `>2` m
  (`canopy-urban-confusion-2026-09-10.md`, measure 1), and the canopy that does stand on a
  building does so at well below chance (measure 2).
- What it drops is the 1–2 m band — hedges, shrubs and the model's rounding of bare ground,
  none of which a pedestrian stands under.

## Invariant #5 decided the colour and where the layer goes

The canvas fallback still runs whenever `coverage()` is below `LOW_CONFIDENCE`, and A8d made
that *more* frequent near the horizon. It decides "shadowed" from the composited canvas.

**Above the shadow layer is impossible.** A green wash over a shaded street would read as open
sun — the reason `MapView` already moves place labels under the shadow layer while flat.

**Below it, shadow composites over the fill instead of the basemap**, so the fill has to be a
colour shadow stays detectable on. Compositing is linear and each of the predicate's three
tests is a half-space, so for a given sun the set of backgrounds a *fully covered* shadow pixel
stays detectable over is convex. A fill that is inside that set at both ends of the renderer's
shadow colour — the dawn `#01112f` and the noon `#22467f` — keeps every background that was
already inside it inside, at any opacity. What that demands is a small
*warmth*, `(r + g) / 2 − b`: under ~28, or the dawn blue stops reading as blue. The obvious tree
colour is a yellow-green, and it fails that outright, so the fill is **sea green `#2e8b57`**
(warmth 5.5) at **0.55**. Opacity is legibility alone, since the predicate holds at any value;
it went up from 0.45 after the interface review, which put the fill at ~1.5:1 against bare
ground under a rough glare model. Warmth ≥ 0 is the other half: the fill can never *create* a
blue-dominant pixel, so sunlit canopy does not read as shadow.

**The argument stops at a shadow's anti-aliased rim.** The renderer supersamples, so an edge
pixel is only partly covered, and convexity at full coverage says nothing about partial
coverage: over the fill, the coverage at which a rim pixel starts to count as shadow moves. At
0.55 it moves **inward by at most 0.045 of a pixel** (residential landuse, at dawn) and
**outward by at most 0.165** (sand, high sun) — worked over all ten surfaces and the whole sun
range, and held under a fifth of a pixel by a test. That is ~20 cm at z17: the fill nudges a
shadow's detected edge; it never moves a shadow.

**And it goes under the basemap's first water layer**, not merely under the shadow layer.
Water is the one outdoor-v2 surface blue enough to sit at the predicate on its own — and at
street zoom it is past it: sunlit water reads ~(149, 201, 242) on the live canvas, sums under
600, and **passes `isBlueDominantShadowPixel` on `main` already**, a false shadow over every
river and harbour that predates this checkpoint (**#294**). A fill mixed into that is
measured against a surface that is already wrong, and no colour fixes it, so the fill stays out
of it. Under the water layer, water, roads, bridges and buildings all cover the fill; it only
ever mixes with the landcover and landuse greens and greys the colour was checked against. (One
exception, for completeness: outdoor-v2's blue glacier contour lines draw beneath the fill, and
sunlit fill over one passes the predicate. It needs 3 m canopy on a glacier.) Two consequences,
both deliberate:

- **Crowns over a carriageway are hidden by the road line.** A tree-lined street reads as
  green on both sides of a white road rather than green across it.
- **Crowns over roofs are hidden by the building fill**, which is also what `ShadowField` does
  — it subtracts footprints from the raster before marching.

The fill is also off in **Sun Exposure** mode. The local renderer paints nothing different
there, but that panel's GeoTIFF export writes the canvas out as drawn, and the fill stays out of
an export it was never part of.

No shadow colour changed. Building shadow looks the same over the basemap and a different,
bluer teal where it lands on the fill, the way it already looked different over a park.

## Measured

### The colour, exhaustively — `canopyPaint.test.ts`

Against the renderer's own shadow colours (the A3 harness's copy) at five sun fractions from
dawn to noon, ten outdoor-v2 surfaces and four opacities from 0.15 to solid:

- shadow over the solid fill is detected at every sun fraction;
- no shadow the predicate saw over a bare surface is lost over the fill, anywhere;
- no sunlit fill over any surface is detected as shadow;
- at the shipped opacity, a shadow rim pixel's detection threshold moves by under a fifth of a
  pixel, over every surface, across the sun range.

Negative controls: a yellow-green fill `[107, 154, 40]` fails five tests (three here, both A3
re-measures); a teal fill `[20, 120, 110]` fails the sunlit test and the solid A3 re-measure.

One consequence worth pinning, not a goal: outdoor-v2's **wood** is warm enough that the dawn
blue over it already fails the predicate on `main`. The fill is cooler, so treed wood reads as
shadow again at dawn.

### A3, re-measured

The agreement corpus re-run with the synthetic canvas painted over the fill instead of grey:

| basemap | cases | mean | p90 | worst | severe |
|---|---:|---:|---:|---:|---:|
| grey, as A3 shipped | 150 | 2.6 pp | 0.0 pp | 62.5 pp | 3.3% |
| under the fill at 0.55 | 150 | 2.6 pp | 0.0 pp | 62.5 pp | 3.3% |
| under solid fill | 150 | 2.6 pp | 0.0 pp | 62.5 pp | 3.3% |

**Identical, not merely within the ceilings**, and the test asserts equality: if the predicate
round-trips on the fill, the sampler reads exactly what it read before. The harness has no
anti-aliasing, so the edge effect below is invisible to it.

### The predicate on the real canvas — #275's acceptance number

`studies/canopy-paint-predicate.mjs`, 2026-09-10, Chromium 136 on SwiftShader under WSL,
1280×900 at z17, no route, fill at **0.55**. Each scene is rendered twice from the same
`source.coop` bytes — once with the raster blocked, which is exactly `main`'s canvas — and the
frames are compared over the pixels the fill changed.

| scene | sun | fill px | shadowed under fill | **still shadowed** | lost | gained (open ground) |
|---|---|---:|---:|---:|---:|---:|
| Singapore CBD | 07:20, ~4° | 57,290 | 57,088 | **100.00%** | 0 | 200 (0) |
| Singapore CBD | 07:50 | 57,290 | 57,286 | **100.00%** | 0 | 4 (0) |
| Singapore CBD | 13:00 | 59,242 | 4,027 | **100.00%** | 0 | 130 (0) |
| Kent, WA | 06:40 | 149,795 | 60,572 | **100.00%** | 0 | 28 (0) |
| Kent, WA | 13:00 | 152,793 | 5,268 | **100.00%** | 0 | 453 (0) |
| Madrid | 07:45 | 2,312 | 2,164 | **100.00%** | 0 | 0 |
| Madrid | 14:00 | 2,498 | 717 | **100.00%** | 0 | 23 (0) |

**Every run taken, not just this one:** four full sweeps at 0.45, before the interface review
raised the opacity; two at 0.55, one of whose Singapore dawn frames was discarded because a
source edit hot-reloaded the page mid-capture; and three more reruns of the Singapore dawn
scene. Everything else was 100.00%, except:

- Singapore 13:00 at 0.45 lost **3 of 3,997** (99.92%), all at a shadow's edge, on two of its
  four runs.
- Singapore dawn at 0.55 lost **167 of 57,949** (99.71%) on one run — **none of them at an
  edge**, which the rim effect cannot produce. That run's frame also differed from every other
  run of the scene (58,198 fill pixels, against 57,290 in the three identical reruns that are
  the table's row), which a partly drawn frame explains and a fill colour does not. It is
  reported, not explained: the study waits for two identical canvas reads 2 s apart, and that
  is evidently not a guarantee that both frames finished drawing.

So the acceptance number: **at the shipped 0.55, 100.00% in every scene on every run but that
one unreproduced frame (99.71%)**; at 0.45, 99.92% at worst, edge pixels only; and **no open
ground turned into shadow in any run at all**.

**The flips are at shadow edges, and they are not new shadow.** They are the rim effect above:
over the darker fill a half-covered pixel clears the predicate's `b > 1.15 × (r + g) / 2` where
over the light basemap it does not — ~(170, 179, 196) without the fill against ~(99, 145, 146)
with it. This study sees mostly the outward direction for a reason worth stating: at 1280×900
and DPR 1 the renderer supersamples exactly 2×, so a rim pixel is 25, 50 or 75% covered, and the
dawn inward band sits at 69–74%. A phone's canvas breaks the 2× ratio (the shadow buffer is
capped at 4096 px), coverage takes any value, and a few dawn rim pixels will flip inward; the
bound above is the number to hold that to. **Open ground** is a gained pixel that leaned
no more toward blue than a sunlit surface does before the fill (≤ +3; the bluest sunlit surface
the fill can land on leans +2). There are none in any scene. The least blue-leaning gained
pixel sat at +14.5 before the fill.

Madrid's frame paints ~2,300 fill pixels to Kent's ~150,000. That is not a clean read of #281
— the Madrid frame is Puerta del Sol, paved core, and Kent's is low-rise suburb — but it is the
direction A8c's raw figures give (4.1% of the Madrid AOI canopy against Kent's 16.6%), and the
leaf-off imagery is part of why.

## The store is shared — A8b's second consumer

`sharedCanopyTileStore()` is the one instance. `createRasterCanopyProvider()` used to build its
own behind a dynamic import; it now takes the shared one, and the layer reads through the same
one, so the corridor and the viewport dedupe blocks and share open COG handles. `geotiff.js`
stays behind the dynamic import: the build's `canopyTileStore-*.js` chunk is 63.48 kB before
and after, the entry chunk grows 0.10 kB, and MapView's lazy chunk grows 57.64 → 73.70 kB
(+4.34 kB gzipped), 9.8 kB of it the acquisition-date index the legend reads.

Each viewport read carries its own `AbortController` and is aborted on the next `moveend`. The
store refcounts fetches, so that abort cannot cancel a corridor read waiting on the same
blocks — A8b's tests pin that property, and nothing here routes around it. `clear()` is never
called (#287).

A `moveend` that stays inside the painted image at the same resolution reads nothing, and the
legend only re-renders the map component when what it says changes. `sharedStore.test.ts` pins
that the corridor's provider reads through the shared instance; `canopyLayer.test.ts` pins the
layer's lifecycle against a fake map — placement, abort-on-pan with only the newest read
painting, the skip, the zoom floor, Sun Exposure, and what the legend is told.

A zoomed-in viewport reads at the corridor's own 2 m target (`CORRIDOR_GROUND_RES_M`, held
equal to `TARGET_GROUND_RES_M` by a test, because importing it would pull `geotiff.js` into the
map chunk), which is when the two actually share blocks. A wider view reads coarser, keeping
the image under ~2,048 px across; below z14 the layer reads nothing (`MIN_CANOPY_ZOOM`), and a
tilted camera's bounds are clipped to 6 km around the centre.

## #289, answered: open-ocean quadkeys are not published

HEAD against `https://data.source.coop/tge-labs/meta-chm-v2/chm/<quadkey>.tif`, 2026-09-10:

| where | quadkey | status |
|---|---|---|
| mid-Atlantic, mid-Pacific, South China Sea | `0330301230`, `0223210123`, `1322311132` | 404 |
| Pacific off WA, Mediterranean, Balearic Sea, North Sea | `0212211231`, `1220003130`, `1220000113`, `1202001022` | 404 |
| Antarctic interior | `3220002202` | 404 |
| Singapore Strait ×2, Singapore CBD, Puget Sound | `1322322313`, `1322323200`, `1322322311`, `0212300213` | 200 |

So tiles with land are published — the Strait tiles are mostly sea and still there — and tiles
without land are not. The store fails a whole read when one quadkey will not open, which is
right for a corridor. **The viewport therefore reads one quadkey at a time** and paints
whatever arrives, so a harbour view straddling an open-sea tile paints its land. Each read is
inset a centimetre from its quadkey's edge: without it, the store's outward pixel rounding
reaches into the neighbour and opens it — the negative control for that fails two tests.
With #288 unfixed, a missing quadkey costs three attempts and ~900 ms of backoff before it is
skipped, and a failed open is never cached, so **near an open-sea tile every pan pays it again**
— and `readViewport` waits for every quadkey before painting any, so the land beside it waits
too. The viewport pays that where the corridor rarely did; it is #288's to fix, and noted there.

## Saying what it is

`CanopyLegend` is on screen whenever there is fill to explain: *"Estimated tree canopy
(satellite)"*, and on desktop a second line, *"Modelled heights, 3 m and taller. Not a tree
survey."* Where the build knows the imagery date and it was flown out of leaf season — by
`canopy.ts`'s own calendar — it adds *"Feb 2020 imagery, trees bare: undercounts"*, and then it
shows even over a view with no fill, because in Madrid an empty map is not evidence of no
trees. Only the three A3 corpus tiles are indexed (`acqDate.ts`), so elsewhere the legend says
nothing about dates rather than implying they are fine. Madrid's leaf-off extent is not
corrected (A8e); it is stated.

When no quadkey answers — open ocean, or the host unreachable — the fill and the legend both
go, rather than a legend claiming the canopy here was assessed and found absent.

**Where it sits** came out of the interface review. On a phone it is one line (two with the
leaf-off caveat) under the search bar and the shadow legend. On desktop it is bottom-left above
the timeline, *past* the 408 px sidebar: the map container spans the sidebar, so a plate
centred on it slid under the sidebar at any width below ~1,100 px, which is exactly when a
route card is quoting canopy. It fits between the open sidebar and the route cards at 1,024 px;
narrower than ~1,000 px, with both open, the map itself has almost no room — an existing
layout squeeze, not this plate's.

## What this does not do

- **Paint canopy shadow**, or change the renderer. See the top; it is **#295**, with its
  acceptance criteria still to write.
- **Distinguish inventoried trees from inferred canopy.** A7's OSM crowns are too sparse to be
  worth a second style (~1% of Singapore's trees), and the inventories arrive with A8e.
- **Correct for imagery vintage** — #281, A8e.
- **Make the smoke test see it.** The smoke test did *not* stub `source.coop` — the route
  corridor has been reading the live mirror in CI since #291, and the fill would have too. This
  PR stubs it in `e2e/helpers/scenario.ts`, so CI is hermetic again and the fill never paints
  there. The browser evidence is the study above and a look at Singapore CBD and Kent, with and
  without a route.
- **Report canopy's share of a blended number** — #277.
