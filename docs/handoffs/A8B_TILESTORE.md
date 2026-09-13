# Handoff — A8b, `CanopyTileStore`

**Written 2026-09-10, after the A8c gate PASSed (PR #285).** Brief: `docs/tracks/TRACK_A.md` →
*A8 — Canopy from the raster*. **That section is not on `main`** — it lives only on
`docs/a8-canopy-raster` and does not cherry-pick cleanly (it sits on A7's edits to the same
file). Read it with `git show docs/a8-canopy-raster:docs/tracks/TRACK_A.md`.

## The gate is cleared

A8c measured whether the model reads buildings as canopy (#279). It does not: every AOI puts
less canopy on a building than chance would, contamination falls as you approach a footprint,
and Singapore CBD's 79 buildings with a median OSM height of 95 m carry a median interior CHM
of 0.00 m. Full method and numbers: `docs/notes/canopy-urban-confusion-2026-09-10.md`.

**So A8b may proceed, and A8b is what the sequence needs next — not A8d.** Do not start the
`ShadowField` integration in this session because the transport looks ready.

## What A8b is

`CanopyTileStore`, in `app/lib/canopyRaster/`. From the brief: *the viewport and the route
corridor are independent consumers with independent lifecycles; dedupe, cache decoded tiles,
cancel stale reads.* It is live debt — `useNavigation` already `fitBounds`es a route into view
before sampling, and canopy must not inherit that coupling.

**Still no routing effect.** Nothing here reaches `ShadowField`, the renderer or a component;
that is A8d. This checkpoint should not touch `useNavigation.ts`, `MapView.tsx` or `page.tsx`.

## What A8a left you, and the traps in it

`readCanopyHeights` (`app/lib/canopyRaster/canopyCog.ts`) reads **one tile only** and throws on
an AOI spanning more than one, by design — stitching was deferred to you precisely because it
has to dedupe and cancel across two consumers. Multi-tile is `quadkeysForBbox` in `tiles.ts`,
which already walks the tile range rather than sampling corners.

Three things that will bite:

- **The mask IFDs.** GDAL writes the 1-bit validity mask overviews as `NewSubfileType = 1|4`,
  so `geotiff`'s own `readRasters({ resX })` will happily hand you a level that decodes to a
  clean array of ones. `selectOverview` exists because of this; do not route around it.
- **Resolution is per-latitude, and Singapore pays 4×.** The 1.82 m overview is 2.39 m on the
  ground at the equator — coarser than `TARGET_GROUND_RES_M` — so both Singapore AOIs fall
  back to native and cost roughly four times Madrid's pixels for the same ground area. A cache
  budget in *tiles* will be wrong by 4× between cities; budget in bytes or pixels.
- **`source.coop` is flaky under load.** A8a hit 504s, truncated responses and a 300 s timeout
  after a few hundred requests. Retry and backoff belong in the store, not in callers.

## Two things A8c explicitly handed to A8b

1. **Read the validity mask.** `0` in this raster means "no canopy detected", and A8a never
   reads the 1-bit mask beside the heights — so a nodata stamp over buildings and a correct
   answer look identical. A8c argued from a histogram that interiors are model output rather
   than blanked (94–98% zero, but a graded tail through every band), and said plainly that is
   evidence, not proof. Reading the mask is the clean answer and it belongs here.
2. **Building masking is a settled decision, not an open question.** A8c confirmed footprint
   subtraction costs at most 17.4% of apparent canopy. Where it happens — store or
   `ShadowField` — is yours to choose; that it happens is not.

## Verification

`npm run bench:canopy` (`playwright.canopy.config.ts` → `e2e/bench/canopyCog.bench.spec.ts`) is
A8a's live-network transport benchmark and the natural place to show a tile store paying for
itself: it already measures requested vs transferred bytes against a counting `fetch`, and the
gap between them is the thing you are closing. It never runs in CI.

`app/lib/canopyRaster/__tests__/` is `environment: "node"`, no fixture, no fetch — keep the
arithmetic there and the network out of it.

**Gate 3 does not pass on this machine.** `npm test` exits 1 under Node v20.20.1: nine
jsdom-dependent files cannot start, the repo declares `engines: node 24.x`, and it reproduces
identically on `main`. CI pins Node 24. Do not read a green summary line as a pass without
checking the exit code, and do not spend the session chasing it.

## Related

- **#280** — the shelved `api/canopy.js` byte-range passthrough against Meta's S3. Insurance if
  `source.coop` stops republishing. **Not a build item.**
- **#284** — sweeping the four remaining studies out of `scripts/`. Not A8b's job. Note the new
  `studies/` folder and its contract in `studies/README.md` if you write any offline
  measurement code.
- **#281** — Madrid's leaf-off imagery. A8e's problem, not yours.
