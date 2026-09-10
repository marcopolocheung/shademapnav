# Does a canopy tile store pay for itself? — measured 2026-09-10

A8a measured **one** read of **one** area (`canopy-raster-feasibility-2026-09-09.md`) and left
a gap it named explicitly: the benchmark reported requested against transferred bytes, and
said the gap between them was A8b's to close. This note is that measurement.

The app does not make one read. The viewport follows the camera and the route corridor does
not, and both want overlapping canopy. So the figure that matters is the cost of a *sequence*
of overlapping reads, with and without `CanopyTileStore` between them.

**Both arms with Chromium's HTTP cache disabled** (CDP `Network.setCacheDisabled`). Without
that the uncached arm is served its repeat ranges out of the browser cache with
`Content-Length` intact, and the comparison measures Chromium rather than the store.

Reproduce with `npm run bench:canopy` (`e2e/bench/canopyStore.bench.spec.ts`). It talks to
`data.source.coop`, so it never runs in CI. Taken on an i7-12700H under WSL2, Chromium via
Playwright, 2026-09-10; a run on another machine or another day will not match these to the
kilobyte.

## Five overlapping 2 km reads along a corridor

600 m apart, so consecutive boxes overlap by 70% of their width — a viewport following a
route, or a corridor being sampled ahead of a walker.

| arm | requests | requested | transferred | vs baseline | total | block hits/misses |
|---|---:|---:|---:|---:|---:|---:|
| a store per read | 365 | 1595.2 KB | 1595.2 KB | 100% | 37063.2 ms | — |
| one shared store | 127 | 646.6 KB | 646.6 KB | 41% | 12792.8 ms | 27/18 |

**41% of the bytes, 35% of the requests, 35% of the wall clock.** "A store per read" is what
A8a's `readCanopyHeights` amounts to when called five times: it re-walks the IFD chain and
re-fetches every overlapping block. 238 requests disappear, and the four repeated IFD walks
are among them — cheap in bytes, expensive in round trips, which is why the request count
falls further than the byte count does.

Requested equals transferred in both arms, as in A8a: `source.coop` honours ranges exactly
and never falls back to serving the whole 84 MB object.

**The two arms return byte-identical pixels, step for step.** The benchmark checksums every
raster and asserts equality across the arms; a cache that changed the answer would be worse
than no cache.

## An area spanning two published COGs

`readCanopyHeights` throws on this by design. The store stitches it:

```
0331110120 + 0331110121 → 1100x1101 @ 1.82 m/px in 11330.5 ms, 57.6% canopy, validity all valid
```

One raster, one resolution, no seam. The unit tests pin the arithmetic — a synthetic source
whose heights are linear in world position, so any block placed at the wrong offset breaks the
linearity, plus an absolute check that the first pixel is the one the reported bbox claims.

## The validity mask says "all valid" over Madrid

A8c argued from a histogram that building interiors in this raster are model output rather
than blanked, and said plainly that was evidence and not proof. A8a never read the 1-bit
validity mask beside the heights, so a nodata stamp and a correct `0` were the same byte.

The store reads it. Over the 2 km box straddling Madrid's tile seam — 1.2 M pixels across two
COGs, 57.6% of them carrying canopy — **not one pixel is masked invalid.** That is the clean
answer A8c asked for, on the AOI it was asked about: those zeros are the model saying "no
canopy", not the raster saying "never populated".

### The negative control, because "all valid" proves nothing on its own

**A mask reader that is silently broken returns all ones.** That is not a hypothetical: it is
the failure A8a documented for overview selection — the mask IFDs decode into a clean array of
ones that looks exactly like a plausible raster — and it is why `selectOverview` exists. So
"not one pixel is masked invalid" is, on its own, equally consistent with a working reader over
fully-covered land and with a reader pointed at the wrong image. The claim needs a place where
the mask *should* be zero.

Reading the coarsest mask level of each A3 corpus tile whole, through `createCogTileSource`
in Node:

| tile | | mask | heights >0 |
|---|---|---|---:|
| `0331110121` | Madrid | all valid | 26.4% |
| `0212300320` | Kent, WA | all valid | 78.6% |
| **`1322322311`** | **Singapore** | **64 of 262,144 invalid** | 28.3% |

Singapore is the control: the reader does return zeros where the dataset has them, so Madrid's
and Kent's "all valid" is an answer about the data and not an artefact of the read. (512 px
over a z10 tile is ~76 m/px, and a downsampled 1-bit mask, so the 64 is a coarse *existence*
proof rather than a measurement of nodata extent.)

It also settles the pairing. The Madrid chain is heights at IFD 0 and 2–7 at `BitsPerSample=8`,
masks at 1 and 8–13 at `BitsPerSample=1` with `NewSubfileType` 4 and 5 — so a mask sits at no
fixed offset from the level it masks, and matching by width is required rather than tidy.

`CanopyPatch.valid` is `null` exactly when every pixel is valid, which is why an all-valid read
allocates nothing for it — and Singapore shows that is a real branch, not a permanent one.
