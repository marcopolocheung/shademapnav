# Handoff — A8f, paint the canopy the routes are already using

**Written 2026-09-10, after A8d (PR #291) and the geotiff block cache (PR #292) merged.**
Brief: `docs/tracks/TRACK_A.md` → *A8 — Canopy from the raster*. **That section is still
not on `main`** — it lives only on `docs/a8-canopy-raster`. Read it with
`git show docs/a8-canopy-raster:docs/tracks/TRACK_A.md`. The session-start track board
reads `main`'s copy, which is why it still says Track A is on "A7c or A5".

## Why A8f, and why now

**#275 is p0, and A8d plus #292 turned it from a prediction into what every user sees.**
The raster now reaches the first route over an area (0.9–1.9 s cold, inside the 2.5 s
budget), and nearly every route through a treed city reports `"mixed"`. The route card
says *"from building geometry and tree canopy"* and quotes Singapore CBD at 16–53% canopy
shade, over a map that paints no tree at all. `TRACK_A.md` risk #1: when the field and the
renderer disagree, **the user believes the renderer**.

A8e (source fusion, and the imagery-vintage problem #281) is the other open slice. It is
real work, but it changes *which* canopy numbers are right; A8f is what stops the product
contradicting itself. Do A8f first unless you find a reason in the code not to.

## Step 0, optional but recommended: get the brief onto `main`

A small docs-only PR that brings the A8 section and an honest *Current state* onto `main`:
A8a–A8d landed (#282, #286, #285, #291), #290 fixed by #292, A8f active. The previous
session noted it does not cherry-pick cleanly because it sits on A7's edits to the same
file, so resolve it by hand. Keep it separate from the A8f PR.

## Read before touching anything

- `.claude/rules/shadow-renderer.md` and `.claude/rules/components-and-map.md`.
- `docs/notes/canopy-raster-shadow-field-2026-09-10.md`: what A8d computes, and the #290
  numbers.
- #275, whose acceptance criteria are the checkpoint's: *"a canopy shadow colour that
  satisfies `isBlueDominantShadowPixel` after compositing **or** an explicit decision that
  canopy is excluded from the fallback path, with the reasoning written down; A3 agreement
  re-measured; no change to building shadow appearance."*

**`MapView.tsx` is one of the three contested files**: main session, no `builder`
subagent. Touch it for the layer and its lifecycle, nothing else.

## The decision you have to make first: what is A8f painting?

There are two readings, and they are very different amounts of work.

1. **Canopy extent**: an "estimated canopy" fill wherever the raster says vegetation
   stands above a height threshold. This is what the A8 brief specifies (*"A8f can
   honestly paint estimated canopy coverage, which is what the source is"*).
2. **Canopy shadow**: tree shadow drawn by `LocalShadowAdapter`'s WebGL renderer, which
   is closer to how #275 was written. That means the heightfield inside the shader, and
   fractional shadow that has to be coloured against invariant #5.

**Recommendation: (1).** It paints what the source actually is, it explains the number on
the route card, and it keeps the renderer out of scope. Write down why (2) waits: it needs
its own acceptance criteria for fractional shadow against the blue predicate, which #275
already says.

## Invariant #5 is the whole checkpoint

The canvas fallback decides "shadowed" with `isBlueDominantShadowPixel` on the flat
canvas. It still runs whenever `coverage()` is below `LOW_CONFIDENCE`, and A8d made that
*more* frequent near the horizon (4.6°–5.6° of sun for tile-backed answers; see the A8d
note).

- **Nothing may be drawn above the shadow layer while the camera is flat.** `MapView`
  already moves place labels under it for exactly this reason (`setPlaceLabelsAboveBuildings`):
  an untinted label over a shadowed sidewalk scores as open sun. A canopy fill over the
  shadow layer would do the same to every tree-lined street.
- **So the fill goes below the shadow layer, and that is not free either.** Building
  shadow will now composite over the canopy colour instead of the basemap. "Blue-dominant
  after compositing" has to be re-measured over *your* fill colour at *your* opacity, or
  the fallback will read shaded tree-lined streets as sunlit. That is #275's
  "no change to building shadow appearance", made concrete. The `PreToolUse` hook will
  stop you on shadow-colour edits; that is intended.
- Re-measure A3 agreement, as #275 requires.

## The store must be shared, or A8b was for nothing

A8f is the **second consumer** of `CanopyTileStore`, the viewport one A8b was designed
around. Today `createRasterCanopyProvider()` builds its own store lazily inside
`providers.ts`. If the map layer builds another, the viewport and the route corridor fetch
the same bytes twice and A8b's dedupe and refcounted cancellation do nothing.

- One store instance, shared by the provider (`useNavigation.ts`, which already accepts
  `opts.store`) and the layer. Keep `geotiff.js` behind the dynamic import: the build
  currently puts it in its own `canopyTileStore-*.js` chunk, and the main bundle must not
  grow by 63 kB.
- **Cancel viewport reads on pan** with a per-read `AbortController`. The store refcounts,
  so a pan cannot abort the corridor's read. That is the property A8b exists for; do not
  route around it.

## What the viewport will throw at the store

- **`maxPixels` throws rather than degrading.** A zoomed-out camera asks for a continent.
  Gate the layer on zoom (buildings use `MIN_BUILDING_ZOOM` 12 and `COMPLETE_BUILDING_ZOOM`
  15 in `providers.ts`), and pass `targetGroundRes` per read so a wider view reads a
  coarser overview.
- **#289 can bite on day one:** does the dataset publish every z10 quadkey? A viewport
  over a coast or a harbour may span one that isn't published, and the store fails the
  *whole* read. Answer #289 early. It is a cheap probe of neighbouring quadkeys, and the
  answer decides whether the layer reads per quadkey or needs the store to tolerate
  holes.
- **#287**: `clear()` ignores pins. Don't call it from a layer lifecycle.
- The patch is a Web Mercator pixel grid with a lon/lat bbox (`CanopyPatch`), so a
  MapLibre image source with four corner coordinates lines up exactly. Prefer that over a
  custom layer unless measurement says otherwise. Read `valid` before painting a `0`:
  nodata is not bare ground.

## Honesty on the map

- It is **estimated** canopy and must say so. The UI guardrail is that every number and
  every claim states its uncertainty.
- **Madrid's imagery is leaf-off** (#281). The fill will show fewer trees in Madrid than
  exist. Don't correct for it here (A8e), but don't hide it either.
- The brief's optional "distinguish inventoried trees from inferred canopy" depends on
  A8e bringing inventories in. Leave it for A8e unless it turns out to be trivial with
  A7's OSM crowns.
- Pick the height threshold from A8c's measurements (it reported >2, >3 and >5 m), and
  say which one and why.
- This is a map read in bright sun on a phone: run `interface-reviewer` on the diff.

## Verification

- **This changes rendering, so green gates do not finish it.** `npm run e2e`'s `smoke`
  project stubs every request, including `source.coop`, so the fill never paints in CI and
  the smoke test cannot see it. Verify with a real browser against the live host. The
  `playwright.canopy.config.ts` setup and `LD_LIBRARY_PATH=$HOME/miniconda3/lib` work
  here (`docs/notes/browser-verification.md`); screenshot a treed street in Singapore CBD
  and Kent, with and without a route.
- Measure the predicate directly: sample canvas pixels where building shadow falls over
  the canopy fill, and report the share that still passes `isBlueDominantShadowPixel`.
  That number is the acceptance criterion.
- **Gate 3 does not pass on this machine.** `npm test` exits 1 under Node v20.20.1: nine
  jsdom files can't start, it reproduces identically on `main`, and CI pins Node 24.
  Check the exit code rather than the summary line, and don't chase it.
- `npm run bench:canopy` must still pass all four live benches.

## Related

- **#277**: `EdgeShadow` doesn't carry the canopy share, so Track E can't apply the 0.5
  preference weight. Not A8f's, but the route card label is the same seam.
- **#281**: vintage and age, A8e.
- **#288**: `withRetry` backs off on terminal errors. A viewport consumer makes far more
  reads than the corridor did, so this starts to matter.
- Offline measurement code goes in `studies/` under `studies/README.md`'s contract.
