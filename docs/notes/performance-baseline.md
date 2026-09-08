# Performance Baseline

Each section states its own date and commit — they were taken at different times.

Environment (unchanged across all of them):
- OS: WSL2 Linux `6.18.33.2-microsoft-standard-WSL2`
- Node: `v20.20.1`
- npm: `10.8.2`

## Build Artifacts

Measured on 2026-08-15 from branch `perf/baseline-metrics` at commit `dca020d`
after `npm run build`.

| Artifact | Raw bytes | Gzip bytes |
|---|---:|---:|
| `dist/assets/maplibre-EPPFnYTc.js` | 953234 | 256181 |
| `dist/assets/react-vendor-BE91f6Ds.js` | 229914 | 73158 |
| `dist/assets/index-BuiovaZN.js` | 156946 | 47483 |
| `dist/assets/MapView-BAZp6Pgx.js` | 48378 | 14638 |
| `dist/assets/agentLoop-BvVIQobA.js` | 18033 | 7239 |
| `dist/assets/earcut-Dbb6WtNR.js` | 9492 | 4155 |
| `dist/assets/sunPosition.worker-Cacf_Fkb.js` | 3587 | 1826 |
| `dist/assets/maplibre-B4QYLKPJ.css` | 69367 | 10003 |
| `dist/assets/index-Dl5krxH_.css` | 50098 | 9434 |
| `dist/index.html` | 1119 | 587 |
| `dist/sw.js` | 1772 | 652 |
| `dist/manifest.webmanifest` | 441 | 289 |

Total `dist/`: 1.6 MiB.

## Shade Sampling

`ShadeField.sampleEdges` — the call routing makes once per calculation, and the
hot path behind issue #122. Reproduce with `npm run bench`
(`SHADEMAP_BENCH_FULL=1` adds the city-scale case);
`app/lib/shade/__benchmarks__/shadeField.bench.ts` holds the fixtures.

Measured 2026-09-04 in the environment above, Node `v20.20.1`. **Before** is `main`
at `c2821f7`; **after** is `shade/shadow-index` at `c6b21a1` (PR #164, the shadow
index). Both columns come from the same benchmark file, unmodified.

| Case | Before (mean) | After (mean) | Change |
|---|---:|---:|---:|
| 400 prisms × 200 edges | 691.5 ms ±0.9% | 0.66 ms ±2.3% | ~1,050× |
| 800 prisms × 200 edges | 1282.6 ms ±1.5% | 0.91 ms ±26.9% | ~1,410× |
| 1600 prisms × 200 edges | 2347.4 ms ±0.8% | 1.40 ms ±13.8% | ~1,670× |
| 400 prisms × 400 edges | 1366.8 ms ±1.2% | 1.27 ms ±13.8% | ~1,075× |
| 2000 prisms × 1000 edges | 13899.5 ms ±1.4% | 6.31 ms ±22.0% | ~2,200× |

8 iterations each, 3 for the last. Margins are Tinybench's relative margin of error.

**Read these numbers with four caveats.**

1. **They are warm-JIT, steady-state figures.** Tinybench warms up and then repeats,
   so the first `sampleEdges` call in a real browser session is slower than the table
   suggests on *both* sides. A cold single-shot pass on the same fixtures measured
   773 ms → 16 ms for 400 × 200; that is the same change viewed cold, not a
   contradiction.
2. **The wide margins on the "after" column are timer noise, not instability.** Those
   operations now run in about a millisecond, where GC and clock granularity dominate
   in relative terms. The before column is stable to ~1% and reproduced within 1%
   across two separate runs.
3. **The footprints are squares.** Four-vertex rings make `earcut` nearly free, so this
   understates triangulation cost against real tile or Overpass geometry. It affects
   both columns, so the comparison holds; the absolute numbers are optimistic.
4. **A full route graph is not measured here.** ~5,400 edges takes minutes per
   iteration on the pre-index code, which blocks the event loop past vitest's worker
   heartbeat and reports nothing. The 200-vs-400 edge pair is in the table to show the
   scaling is linear in edges, so a graph-scale estimate is a multiplication away.

## Missing Measurements

The backlog asks for throttled-4G time-to-interactive and representative 2-point
and 5-point route calculation timings. Those are not recorded here because this
workspace has no browser automation binary and no interactive browser available
for route calculation. The existing runtime route instrumentation is exposed at
`window.__shadeMapMetrics`, so the next baseline slice should capture those
numbers from a real browser session or add a repo-owned browser automation setup.
That is Track G's G2, and the numbers above do not substitute for it: this
benchmark covers the sampling algorithm in Node, not end-to-end route calculation
including the canvas read and Dijkstra in a browser.

A browser *is* now runnable locally — the cached Playwright Chromium starts once
`libnss3`, `libnspr4` and `libasound2` are side-loaded without sudo — so the
"no browser binary" reason above is stale even though the measurements are still
missing.
