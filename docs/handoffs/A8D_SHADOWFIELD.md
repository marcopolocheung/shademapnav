# Handoff — A8d, the canopy height field into `ShadowField`

**Written 2026-09-10, after `CanopyTileStore` landed (PR #286).** Brief:
`docs/tracks/TRACK_A.md` → *A8 — Canopy from the raster*. **That section is not on `main`** —
it lives only on `docs/a8-canopy-raster` and does not cherry-pick cleanly (it sits on A7's
edits to the same file). Read it with `git show docs/a8-canopy-raster:docs/tracks/TRACK_A.md`.

**This is the first A8 checkpoint with a routing effect.** A8a, A8c and A8b committed Umbra to
nothing; this one changes what the app answers. Read `.claude/rules/routing-and-shadow.md`
before touching anything.

## Run this one in the main session

A7 registered its canopy provider at **`app/hooks/useNavigation.ts:156`**
(`[createOverpassCanopyProvider()]`), and A8d's raster provider lands in the same place.
`useNavigation.ts` is one of the three files six tracks contend for, so: **no `builder`
subagent for this checkpoint**, and keep the diff there to the registration itself.

## The two things the brief tells you not to do

**Not prisms.** A7 turns OSM canopy features into `BuildingPrism`s via `prismsFromCanopy`,
because a tagged tree is a point and a prism is what the engine already eats. **Do not do that
with the raster.** A route-sized patch is ~800k pixels; synthesising prisms from it would hand
`buildShadowIndex` a caster set two orders of magnitude past anything it was built for. The
brief says ray-march the height field against `rayHeight(d) = d·tan(alt)` instead — the raster
is a heightfield, and heightfields are marched, not tessellated.

**Not transmissivity.** The raster says *"vegetation this tall"*. It never says *"this blocks
90% of the beam"*. That second number already exists and already has an owner: `crownOpacity`
in `app/lib/shadowField/canopy.ts`, whose header explains at length why a route-choice
preference weight (`CANOPY_PREFERENCE_WEIGHT`, #244) must not be multiplied into
`ShadowField.shadow` — that field is documented as a physical fraction of the direct beam, and
the exposure series, the heat score and the assistant's spot checks all read it. A8d supplies
geometry to that model; it does not invent a second opacity.

## What A8b handed you

`createCanopyTileStore` (`app/lib/canopyRaster/canopyTileStore.ts`). Read through it, not
through `readCanopyHeights` — the store is what dedupes the viewport against the route
corridor, stitches across published quadkeys, retries `source.coop`, and refcounts
cancellation so a camera pan cannot abort the corridor's read. **Do not re-acquire the
coupling it exists to remove:** `useNavigation` already `fitBounds`es a route into view before
sampling, and the corridor consumer must not need the camera.

**Read `CanopyPatch.valid` before believing a `0` height.** `0` means "no canopy detected";
`valid[i] === 0` means the raster was never populated there. `null` is the common case and
means every pixel is valid. This is not theoretical — Singapore's tile carries real nodata
(`docs/notes/canopy-tile-store-2026-09-10.md`, the negative control), and treating unpopulated
as "no canopy" is the failure mode that puts someone in the sun while promising shade.

**`maxPixels` throws rather than degrading.** A zoomed-out viewport asking for a continent gets
an error naming the limit. The caller picks resolution by passing `targetGroundRes` per read;
the store will select a coarser overview for it.

## Footprint subtraction happens here

A8c settled **that** footprints are subtracted — it costs at most 17.4% of apparent canopy
(`docs/notes/canopy-urban-confusion-2026-09-10.md`) — and left **where** open. A8b deferred it
here deliberately, because the footprints live here: `providers.ts` has
`createTilePrismProvider` and `createOverpassPrismProvider`, and a store that fetched buildings
to answer a raster question would have re-acquired the coupling it exists to remove.

The reason it is principled rather than a hack: canopy over a building is not shading walkable
ground, because the building already occupies it.

## Verification

`app/lib/shadowField/__tests__/` and `__benchmarks__/` already exist — a shadow field
regression is exactly the kind that unit tests catch and a screenshot does not.

**This checkpoint changes rendering, so green gates do not finish it.** `npm test` never opens
a browser. Run `npm run dev` and look: shadows still paint, the timeline still retimes them, a
route still calculates. `npm run e2e` covers that path and nothing else. If you cannot look,
say the check is outstanding rather than letting four green gates imply it.

**Gate 3 does not pass on this machine.** `npm test` exits 1 under Node v20.20.1: nine
jsdom-dependent files cannot start, the repo declares `engines: node 24.x`, and it reproduces
identically on `main`. CI pins Node 24. Do not read a green summary line as a pass without
checking the exit code, and do not spend the session chasing it.

## Related

- **#287 / #288 / #289** — A8b follow-ups: `clear()` ignores pins; `withRetry` backs off on
  terminal errors; and whether every z10 quadkey is published, which decides what happens when
  a viewport reaches a coast. **#289 is the one that can bite A8d**, since A8d is what starts
  handing the store whatever the camera is looking at.
- **#281** — Madrid's imagery is leaf-off (2020-02), so its canopy extent is an under-count.
  A8e's problem. Do not correct for season here, and do not multiply `canopy.ts`'s leaf-on
  transmittance onto a winter-derived crown extent.
- **#275** — closed by A8f, not by this checkpoint.
- If you write offline measurement code, it goes in `studies/` under the contract in
  `studies/README.md`, not in `scripts/`.
