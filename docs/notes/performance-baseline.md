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

## Bundle — real timezones (D0)

Cost of replacing the longitude offset estimate with an IANA zone lookup, recorded because
D0's acceptance asks for it and G3 has no automated check yet. Reproduce with `npm run
build` and read the gzip column Vite prints.

Measured 2026-09-08, Node `v20.20.1`. **Before** is `main` at `4180e02`; **after** is
`feat/d0-real-timezones` (#204). Both built from a clean `npm ci` in the same environment.

| Artifact | Before (gzip) | After (gzip) | Change |
|---|---:|---:|---:|
| `index-*.js` | 65.55 kB | 66.22 kB | +0.67 kB |
| `MapView-*.js` | 17.39 kB | 17.41 kB | +0.02 kB |
| `agentLoop-*.js` | 6.63 kB | 6.67 kB | +0.04 kB |
| `tz-*.js` *(new, async)* | — | 29.60 kB | +29.60 kB |
| `maplibre-*.js`, `react-vendor-*.js` | unchanged | unchanged | 0 |

**The entry path grew by 0.67 kB gzip, not 30.** The boundary dataset is behind a dynamic
`import()` in `app/lib/tzLookup.ts`, so Rollup emits it as its own chunk that is fetched
after first paint. Nothing blocks on it: the app renders on a longitude estimate and
upgrades to the real zone when the chunk lands. The 0.67 kB is the loader plus the
`Intl`-based offset helpers in `timezone.ts`.

Method and accuracy trade-off: [`timezone.md`](./timezone.md).

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

## Route Calculation (G2)

The measurement `Missing Measurements` below asked for, and the baseline **A5 must beat and
Track H must compare against**. Reproduce with:

```bash
export PATH="$HOME/.local/node24/bin:$PATH"     # Node 24 is not on the default PATH here
LD_LIBRARY_PATH=$HOME/miniconda3/lib npm run bench:route
```

It prints these tables ready to paste. It is **on demand, never in CI** — `npm run e2e` ignores
`e2e/bench/**`, and the benchmark has its own Playwright config. Regression *gating* is G3;
this checkpoint measures and commits.

**Environment — the baseline names the machine, because a comparison has to happen on one.**
WSL2 `6.18.33.2-microsoft-standard-WSL2`, 20 cores, 15 GiB, Node `v24.21.0`, npm `11.19.0`,
Playwright `1.63.0` driving Chromium headless on ANGLE/SwiftShader, viewport 1280x900,
`America/New_York`. A 2-core GitHub runner on the same software is roughly 3x slower
(`smoke` is ~17 s locally against ~50 s in CI), so **numbers taken there are not comparable
to these.** Take before and after on the same machine.

**Fixed conditions are G1's fixed conditions** (`e2e/helpers/scenario.ts`): midtown Manhattan
at z17, 09:00 on 2026-06-21, the `overpassGrid` 11x11 street stub, the fixture basemap. The
run is **keyless** — the `smoke` basemap, not `smoke-live`. Real MapTiler tiles would put
network variance inside a number meant to be a baseline; the cost is that everything below
is measured against synthetic buildings.

Measured 2026-09-09 on branch `feat/g2-route-benchmark`. Timings come from the app's own
`window.__shadeMapMetrics`, so the benchmark reports the same numbers the product does.

| Scenario | N | p50 total (ms) | p95 total (ms) | spread | graph fetch | canvas read | shade sample | dijkstra |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 2-point cold | 5 | 2685.9 | 2927.9 | ±10.3% | 11.6 | 1265.2 | 47.3 | 16.6 |
| 2-point warm | 10 | 3463.5 | 4087.1 | ±15.9% | 0.3 | 1879.4 | 24.2 | 9.0 |
| 5-point cold | 5 | 2696.9 | 3501.8 | ±24.4% | 15.1 | 1128.3 | 37.4 | 416.9 |
| 5-point warm | 10 | 5895.7 | 7272.6 | ±24.3% | 0.3 | 2063.2 | 53.3 | 1665.2 |

Phase columns are medians in ms. **They do not sum to the total** — the phases are timed
inside one wall-clock span that also covers the camera settle, graph rebuild and route
assembly between them.

**Variance, stated.** `spread` is half the p95−p5 span as a share of the median. Cold repeats
cost a full page load each (the map must paint and the shadow field must settle before a
calculation means anything), so there are 5 of them against 10 warm; the smaller N is why cold
spread should be read as the looser figure. **Flake budget: zero retries.** A benchmark that
silently re-ran a bad sample would publish the luckier of two runs.

**Cold** is the first calculation after a page load and carries the Overpass fetch. **Warm**
reuses the module-level graph cache in `overpass.ts` — one discarded warm-up calculation, then
`clearMetrics()`, then the measured runs on the same page.

**Reproducibility, across three full runs of the whole benchmark on this machine.** The table
above is the second. Medians moved by:

| Scenario | p50 across three runs | span |
|---|---|---:|
| 2-point cold | 2743.1 / 2685.9 / 2777.9 | 3.4% |
| 2-point warm | 3580.5 / 3463.5 / 3508.0 | 3.4% |
| 5-point cold | 3445.7 / 2696.9 / 3083.2 | 24.3% |
| 5-point warm | 6418.5 / 5895.7 / 6259.6 | 8.6% |

So **the 2-point rows are the ones to compare a change against** — they reproduce to a few
percent. 5-point cold, at N=5 over an algorithm whose own per-run spread is already ±25–34%,
does not: treat a 5-point movement under ~25% as noise, or raise its N first. The per-run
series is printed on every run precisely so this is checkable rather than asserted.

### Four things this baseline says

**1. Warm is *slower* than cold, and the graph cache is not the story.** The cache works —
graph fetch falls from ~12 ms to ~0.3 ms — but that saves ~12 ms against a ~600 ms rise in the
canvas read on a page that has already drawn a route. The per-run series shows a level shift,
not a climb, so this is not a leak: 2-point warm reads 4244, 2974, 3560, 3888, 3004, 3152,
3209, 3638, 3894, 3367 ms. Anyone quoting "cached route calculation" as the fast path should
quote this row instead.

**2. The canvas read is 40–55% of route latency, and on this fixture it is spent for nothing.**
`canvasRead` was non-zero on all 30 runs, so `coverage()` returned confidence below
`LOW_CONFIDENCE` every time and `useNavigation` took the `needsCanvas` branch — while
`shadeFallbackShare` was **0.0% on every run**, meaning `sampleEdges` then answered every edge
from geometry and the pixels were used for nothing. The cheap up-front check and the actual
per-edge outcome disagree, and the disagreement is the single largest phase.
Filed as **#259**. Unverified against real MapTiler tiles — the benchmark is keyless by
decision, so this may be a property of the fixture's geojson `maptiler_planet` source rather
than of the app.

**3. Dijkstra is not the bottleneck on 2-point routes.** 9–17 ms against a ~3 s total. A5's
worker offload moves the main-thread block, and the block is the canvas read, not the search.

**4. The 5-point shape is a different algorithm, not a bigger one.** With `via` waypoints
`useNavigation` leaves `paretoRoutes` and runs a plain `dijkstra` per leg at several shade
strengths, which is why its dijkstra phase is 25–100x the 2-point one and why it returns a
single route (`[Shortest]`) with no shade-gain KPI at all. Its variance is correspondingly
worse.

### Detour budget sweep (#243)

`paretoRoutes` prunes any label whose optimistic length exceeds
`shortestDist × maxDetourFactor + 250 m`. `maxDetourFactor` defaults to **2.0** — a route
twice as long as the direct one. Three independent studies
([literature note](../research/shade-thermal-comfort-literature-2026-09-09.md)) find useful
shade detours at +1.3%, under 3%, and plateauing near 110%.

**This publishes the curve; it does not change the constant.** #243 is labelled `track-h`, and
H3 picks a value against the measured cost.

Same fixture grid and instant, 8 fixed O-D pairs, 5 repeats each, 20.7% mean sidewalk shade.
The sweep runs in **Node against `paretoRoutes` directly**, because `maxDetourFactor` is a
`DijkstraOptions` field that `useNavigation` never passes — varying it from the browser would
mean adding a production seam the benchmark has no business adding. So this is the **search
alone**: no fetch, no canvas read, no sampling, and the whole 11x11 grid rather than the bbox
the app fetches. Comparable across rows, **not** against the totals above.

| maxDetourFactor | p50 search (ms) | p95 search (ms) | mean shade gain (pp) | mean length overhead (%) | pairs with an alternative |
|---|---:|---:|---:|---:|---:|
| 1.05 | 0.5 | 1.6 | 4.9 | 13.7 | 7/8 |
| 1.10 | 0.4 | 1.2 | 5.7 | 17.6 | 8/8 |
| 1.25 | 0.5 | 2.1 | 6.0 | 18.8 | 8/8 |
| 1.50 | 0.7 | 2.7 | 8.6 | 42.7 | 8/8 |
| **2.0** (current) | 1.5 | 4.7 | 11.8 | 79.5 | 8/8 |
| 3.00 | 3.6 | 6.3 | 13.8 | 130.0 | 8/8 |

**What the curve costs and buys.** Between 1.10 and 1.25 the budget buys 0.3 pp of shade for
1.2 pp of extra walking — nearly free. Between 1.25 and the current 2.0 it buys **5.8 pp of
shade for 61 pp of extra walking** and triples the search time. At 3.0 the mean shaded route
is 130% longer than the shortest one, which is not a route anybody walks.

**Read this as a shape, not as a recommendation.** The grid is regular by construction and the
buildings are synthetic, which is what isolates the parameter and also why the absolute
percentages are not about real Manhattan. Two further caveats H3 has to carry: `shadeCoverage`
is a blue-pixel-derived fraction with tens of percentage points of worst-case uncertainty, and
**#241** reports that minimising unshaded metres scored worse than the plain shortest route in
24% of 1200 real O-D pairs — so "more shade gain" in this table is not the same claim as
"better route".

**Not measured: TTI.** #37 asks for throttled-4G time-to-interactive *and* route-calc timings.
G2's acceptance names route calculation only, and TTI is still outstanding — see the section
below, which is now accurate about TTI alone.

## Missing Measurements

The backlog (#37) asks for throttled-4G time-to-interactive **and** representative
2-point and 5-point route calculation timings. **The route timings are now recorded
above** — that was G2. **TTI is still missing**, and deliberately: G2's acceptance
names route calculation only, and half-measuring a time-to-interactive number is
worse than saying it is outstanding.

The reason originally given here — no browser automation binary — is stale twice
over. Playwright Chromium runs on this machine (`LD_LIBRARY_PATH=$HOME/miniconda3/lib`),
and since G1 the repo owns a browser setup that runs in CI. What TTI still needs is
a throttling profile and a definition of "interactive" for a map that keeps painting
after first render; neither is inherited from the route benchmark.
