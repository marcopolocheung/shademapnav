# 02c — Receiver validity and lattice gate

Decision and probe date: **2026-09-12**. Settled inputs: [BRIEF](./BRIEF.md),
[00](./00-findings.md), [01](./01-current-engine-audit.md),
[02](./02-architecture.md), [02a](./02a-feasibility.md), and
[02b](./02b-placement.md). Source checkout:
`cbefb8a02ef136e83447754ec35acd9bd71f6d28` (`main`).

**z17 fails the amended receiver corpus under the unchanged agreement ceilings:**
p90 is **0.142857**, exceeding **0.05** by **0.092857 (9.2857 percentage points)**.
**z18 and z19 pass every agreement ceiling and the new invalid-sample ceiling.**
The finest agreement-passing lattice tested is **z19**; z18 is the coarsest passing
lattice tested. Neither is certified as a combined agreement-and-CDN-budget pass:
02b's same-coverage delivery assumptions require new compression/residency evidence.
Keeping the assumed compression per cell would exceed its 20 MiB/session envelope
at both resolutions. The calculations below preserve geographic coverage.

**The current app does not automatically update a calculated route's shadow percentage
when the clock changes within a day.** The code path is traced below.

This document and its [probe/evidence directory](./evidence/02c/) are the deliverable.
No branch, `app/` edit, production activation, or modification of the settled documents
was made. `[MEASURED]` denotes this run; `[CODE]` source inspection; `[DERIVED]`
arithmetic; `[DESIGN]` the specified contract; `[UNMEASURED]` an unresolved limit.

## Receiver decision applied

[DESIGN — user decision] A ground receiver is invalid when its containing, half-open
lattice cell places it inside an opaque building interval. Determine validity using
canonical ground/building occupancy **before numerical bias and before the night
shortcut**. It is neither shade nor sun. The CPU query and GPU render kernels use
this identical rule. A roof or wall receiver keeps its actual fragment height and
surface-specific bias; ground invalidity does not reject it or move it to a roof.
Buildings remain casters, including buildings containing invalid ground locations.

For sidewalk `s`, with `N_s` scheduled samples and valid subset `V_s`:

```text
validSampleFraction_s = |V_s| / N_s
shadow_s = sum(shadow_i for i in V_s) / |V_s|, when |V_s| > 0
shadow_s = null, source_s = "none", confidence_s = 0, when |V_s| = 0
edge.confidence = min(left.confidence, right.confidence)
```

`null` is this specification/probe's explicit serialization of **no shadow value**;
it requires changing the current numeric-only API in implementation. Both sidewalks
carry their own `validSampleFraction`, valid count, total count, source and confidence.
Do not average the two validity fractions into evidence that hides an empty sidewalk.
Invalid locations contribute neither zero nor one to the denominator/numerator.
Valid night locations retain shade one, `source:"none"`, confidence one at the point
level. Known valid daytime zero shade remains a numeric zero with usable evidence.
All three states are distinct.

[PROBE CHOICE] S1's existing constant daytime confidence prior is 0.8. For this probe,
sidewalk confidence is that prior (one at night) times `validSampleFraction`; an empty
sidewalk is zero. This is an explicit evidence attenuation convention, not calibrated
probability or a newly selected routing penalty. For example `[1, invalid]` averages
to **1**, with valid fraction **0.5** and probe confidence **0.4**; `[0,1]` averages
to **0.5**, with confidence **0.8**. The edge confidence is **0.4**. The field contains
no minimum-validity threshold, edge rejection rule, or conversion of missing shade
to a routing cost. Routing's treatment of low confidence remains a separate decision.

The implementation amendment belongs in 02 §2/§6/§9.2/§10.1 and supersedes 02a's
interior-receiver lower bound and 02b §6's undecided status. It does not change the
four-height representation or 02b's server preparation → CDN → browser worker query
→ WebGL2 render placement. Include the receiver revision in result-cache identities.

## Gate method and integrity

[MEASURED] Reconstructed S1 from 02a's embedded code. The retained
[original core](./evidence/02c/original-core.mjs) and
[amended core](./evidence/02c/core.mjs) make the change inspectable. Ground is zero;
only the quantized Int32 building band varies. Cell-center rasterization, global
256-cell Web Mercator lattice, one-quantum ground lift, DDA/tie handling, complete
finite-scene bounds, fixture sun, ±4 m sidewalks, inclusive counts and source prisms
remain S1's. No canopy/terrain physics, refraction change, solar-cell approximation,
source-building skip, or lifted roof substitutes for ground validity.

The original [agreement assertion file](../../app/lib/shadowField/__tests__/agreement/agreement.test.ts)
was executed **unchanged** at each resolution through a temporary Vitest setup.
Its candidate factory is replaced by S1's raster field. The authorized corpus amendment
wraps the reference sampler's projector: invalid locations return an out-of-canvas
sentinel, causing the **existing** `sampleBothSidewalks` loop to exclude them from both
its sum and count. Empty reference sidewalks are explicitly converted to null.
Candidate and reference therefore average the **same valid locations**, determined
from that resolution's canonical occupancy, without changing any painted pixel.
The [generated harness diff](./evidence/02c/harness-amendment.patch) records the adapter.

The reference painter, canvas dimensions, 1.2 m/pixel, DPR 2, pixel rounding,
blue-dominant predicate, fixture geometry/times, nearest-rank p90, and strict `>0.25`
severe definition remain unchanged. The painter function was checked byte-for-byte.
Madrid's nested rings retain their existing separate-solid interpretation. No painter
rebaseline, boundary dilation, extra geometric exclusion, fixture deletion, or ceiling
relaxation occurred. Null readings would be omitted from disagreement statistics and
counted separately, never converted to exact agreement. **There were no null sidewalk
readings in this corpus:** all 150 fixtures / 300 readings remain at every resolution.

[DESIGN — additional corpus ceiling] Before running the amended gate, fixed
**invalid-sample share ≤0.25 overall AND separately in each city** in
[ceilings.json](./evidence/02c/ceilings.json). This requires at least 75% of scheduled
locations to remain valid in every city; pooling cannot conceal one city's exclusions.
It counts all scheduled sample evaluations, including repeated locations at different
times and night. The new executable assertion also requires all **150** fixtures.
This is the new versioned ceiling supplied with the documentation/probe for commitment;
production CI under `app/` has not been edited. It is a corpus guard, not a field or
routing threshold, and was not increased after observing results.

The unchanged legacy gate was also rerun without mocks: **9/9 passed**. Candidate
runs execute those same nine tests plus the additional validity assertion:

| Run | Existing tests | New validity assertion | Process exit |
|---|---:|---:|---:|
| Legacy, original corpus | 9/9 pass | Not applicable | 0 |
| z17, authorized validity adapter | 8/9 pass: p90 fails | Pass | 1 |
| z18, authorized validity adapter | 9/9 pass | Pass | 0 |
| z19, authorized validity adapter | 9/9 pass | Pass | 0 |

Both canopy-fill equality checks pass at every resolution. The retained raw runs include
the base comparison, the canopy suite's baseline, actual fill opacity, and solid fill.
These are separate executions of the same readings, not additional independent cases.
The original nontrivial sun/shadow and three-city coverage assertions also pass.

## Every ceiling and the retained tail

[MEASURED] Fractions on the 0–1 scale; multiply by 100 for percentage points.
Each city retains **50 cases / 100 readings**. Worst reading is published but has
**no committed ceiling**. Exact values and margins are in [summary.json](./evidence/02c/summary.json).

| Metric | Ceiling / requirement | z17 | z18 | z19 |
|---|---:|---:|---:|---:|
| Mean absolute disagreement | ≤0.04 | 0.032916667 | 0.028809524 | 0.026309524 |
| p90 | ≤0.05 | **0.142857143 — fail** | 0 | 0 |
| Severe share, disagreement >0.25 | ≤0.04 | 0.030000000 (9/300) | 0.026666667 (8/300) | 0.030000000 (9/300) |
| Madrid mean | ≤0.08 | 0.048750000 | 0.030000000 | 0.030000000 |
| Singapore mean | ≤0.08 | 0.020000000 | 0.011428571 | 0.021428571 |
| Kent WA mean | ≤0.08 | 0.030000000 | 0.045000000 | 0.027500000 |
| Overall invalid-sample share | ≤0.25 | 0.178217822 | 0.183168317 | 0.183168317 |
| Madrid invalid-sample share | ≤0.25 | 0.162790698 | 0.162790698 | 0.162790698 |
| Singapore invalid-sample share | ≤0.25 | 0.189189189 | 0.189189189 | 0.189189189 |
| Kent WA invalid-sample share | ≤0.25 | 0.190476190 | 0.214285714 | 0.214285714 |
| Cases | Original ≥100; retain all 150 | 150 | 150 | 150 |
| Cities | Madrid, Singapore, Kent WA | All three | All three | All three |
| Worst reading | Ungated | 0.75 | 1 | 1 |

z17's mean margin is **0.007083333** and severe-share margin **0.01**, but its
p90 margin is **−0.092857143**: it is not a pass. z18's mean/p90/severe margins are
**0.011190476 / 0.05 / 0.013333333**; z19's are
**0.013690476 / 0.05 / 0.01**. Per-city mean margins for z19 are
**0.05 / 0.058571429 / 0.0525** (Madrid/Singapore/Kent). The narrowest new validity
margin is Kent at z18/z19: **0.035714286**, or **3.5714 percentage points**.
Refinement is not monotonically better on every reading/city; no result is pooled
across resolutions to conceal that.

### Excluded sample counts, by city

[MEASURED] Counts refer to sample evaluations before sidewalk averaging, not omitted
fixtures or pixels. The mask is time-independent for a fixed geometry/lattice.

| City | Scheduled | z17 excluded / valid | z18 excluded / valid | z19 excluded / valid |
|---|---:|---:|---:|---:|
| Madrid | 860 | 140 / 720 | 140 / 720 | 140 / 720 |
| Singapore | 740 | 140 / 600 | 140 / 600 | 140 / 600 |
| Kent WA | 420 | 80 / 340 | 90 / 330 | 90 / 330 |
| **Total** | **2020** | **360 / 1660** | **370 / 1650** | **370 / 1650** |

Of 1658 daytime evaluations, exclusions are 294 at z17 and 302 at z18/z19. The remaining
66 / 68 exclusions are nighttime evaluations. Excluding night interiors prevents them
from silently acquiring valid night status. Zero-valid sidewalks: **0 in every city
at every resolution**; the separate witness below covers their required behavior.

The worst-case records, including coordinates, UTC dates, sun, valid fractions and
both answers, are preserved in the raw data and summary. The **100-point tail at
z18/z19 remains real** despite the aggregate pass: a remaining valid sample can disagree
completely with the fixed pixel painter. This is model/pixel agreement, not physical
accuracy or proof of safe routing through bad graph geometry.

## CPU/GPU receiver witnesses

[MEASURED] Updated 02a's independently written GLSL probe with the same pre-night
occupied-origin rejection. Invalid output has its own integer sentinel, decoded to
null; it is never put into a binary shade array as zero. Ground, roof and wall receiver
kinds are explicit. Roof inputs retain fragment height plus the existing vertical bias;
wall inputs retain fragment height with their supplied outward coordinate bias.

A separate browser run evaluated all **450 case/resolution combinations**,
**900 sidewalk comparisons**, and **6060 corresponding point evaluations**.
Node S1 answers, browser CPU answers, and GPU answers match exactly on these cases,
including validity and per-side evidence: **0 point/validity mismatches, 0 edge-result
mismatches**. This comparison is separate from the legacy reference gate.

| Additional analytic witness | CPU | GPU |
|---|---|---|
| Ground inside a 10 m opaque column, day | Invalid/null | Invalid/null |
| Same ground receiver, night | Invalid/null | Invalid/null |
| Valid open ground, night | Shade 1 | Shade 1 |
| Roof at its actual 10 m height | Shade 0 | Shade 0 |
| Wall at 5 m, biased outward, ray away from column | Shade 0 | Shade 0 |
| Same wall height, ray toward column | Shade 1 | Shade 1 |

The aggregation witness returns `left:null`, `right:null`, `source:"none"`,
`confidence:0`, and both validity fractions zero for an entirely invalid edge.
A partially valid witness verifies the valid-only average and minimum edge confidence.
These witnesses are additional; they do not replace or dilute any original fixture.

Hardware/method: Node **20.20.1**, Intel **Core i7-12700H**, 20 logical CPUs,
WSL2 Linux **6.18.33.2-microsoft-standard-WSL2**, x86-64. Browser **Chromium
153.0.8010.12**, headless WebGL2 **ANGLE Vulkan SwiftShader**; exact renderer strings
are retained in [gpu-raw.json.gz](./evidence/02c/gpu-raw.json.gz).
All GL/timer-query checks completed without errors. Software rendering is adequate
for this bounded shader correctness witness; **no hardware-GPU speed or full-screen
production rendering performance is claimed**. Terrain/canopy, geographic seams,
production meshes, antialiasing and full numerical conformance still need their
separate activation tests. This run did not rerun S2 performance or CDN networking.

## Memory and tile sizes re-derived

[DERIVED] The receiver decision adds no canonical raster band. Validity comes from
existing ground/building presence and interval data; sample evidence lives with query
results. The canonical payload stays:

```text
4 Int32 heights × 4 B + 2 Uint32 metadata bands × 4 B = 24 B/cell/copy
worker CPU + GPU mirror = 48 B/cell, for identical resident areas
256 × 256 × 24 = 1,572,864 B = 1.5 MiB per logical tile per copy
258 × 258 × 24 = 1,597,536 B = 1.523529 MiB with a full one-cell border
same geographic area: cell count multiplies by 4^(z - 17)
```

A fixed **256² logical tile does not become a 6 or 24 MiB object** when zoom increases;
it covers less ground. Keeping one old z17 tile's geographic footprint instead needs
four z18 tiles or sixteen z19 tiles. These two meanings must not be mixed.

| Quantity | z17 (fails) | z18 (agreement pass) | z19 (finest agreement pass) |
|---|---:|---:|---:|
| Ground m/cell, Madrid | 0.909300 | 0.454650 | 0.227325 |
| Ground m/cell, Singapore | 1.193996 | 0.596998 | 0.298499 |
| Ground m/cell, Kent | 0.808705 | 0.404353 | 0.202176 |
| Bytes/cell, worker / worker+GPU | 24 / 48 | 24 / 48 | 24 / 48 |
| One 256² tile, one copy | 1.5 MiB | 1.5 MiB | 1.5 MiB |
| One old z17 tile footprint, one copy | 1.5 MiB | 6 MiB | 24 MiB |
| Tiles over 02's old 2048² z17 area | 64 | 256 | 1024 |
| Same area, one copy | 96 MiB | 384 MiB | 1536 MiB |
| Same area, worker + GPU | 192 MiB | 768 MiB | **3072 MiB** |
| Same area, worker + GPU, full gutters | 195.011719 MiB | 780.046875 MiB | 3120.187500 MiB |
| 02a's old 3364×3046 z17 rectangle, one full six-band copy | 234.529358 MiB | 938.117432 MiB | 3752.469727 MiB |
| That same rectangle, worker + GPU | 469.058716 MiB | 1876.234863 MiB | 7504.939453 MiB |

Spacing uses `2π × 6378137 × cos(latitude) / (256 × 2^z)` at the fixture centers.
The rectangle rows preserve the exact old cell-aligned geographic rectangle; a new
tight rasterization can round its outer boundaries differently. Neither the compact
single building band nor excluding receiver samples permits omitting those cells'
casters from the full field. These are payload calculations, not measured process RSS.

02 §8.2's dense horizon arithmetic also scales by receiver count:
`receiverCount × bins × 2 B`. Over the old 2048² z17 footprint, 72-bin one-copy
storage is **2304 MiB at z18 / 9216 MiB at z19**; 360 bins need **11,520 / 46,080 MiB**.
A single 256² page with 72 bins still needs 9 MiB; duplication doubles each value.
This does not justify reviving dense horizons or replacing interval/canopy semantics.

Against **02b's placement**, the two persistent copies are **worker CPU + GPU**,
not main CPU + worker CPU + GPU. Bounded upload staging, decompression buffers,
metadata/material tables, hierarchy, source fallback caches, page tables, generation
overlap and driver allocations remain additional. For example, a fully duplicated
old/new 2048-area snapshot would double the 768/3072 MiB base totals again; immutable
page reuse and bounded staging must prevent that general assumption. A dense z19
Madrid copy alone exceeds 02b's selected 2 GB preparation Machine scenario; preparation
must operate on admitted tiles. Browser/device peak residency remains unmeasured.
Changing compute placement does not make these geographic-area bytes disappear.

### CDN budget qualification

[DERIVED / UNMEASURED] 02b §3.4 measures **one 1.5 MiB uncompressed tile-sized
transaction** and one unusually sparse flat tile compressed to **8709 B**. Its §5
planning scenario is **20 MiB delivered/session and 40 canonical reads/session**.
It supplies neither a representative compressed-size ceiling nor a certified device
working-set budget. Here the user's CDN-budget requirement is evaluated against that
20 MiB envelope, with the **same geographic coverage** as those 40 z17 tiles.

| Same-coverage delivery quantity | z17 | z18 | z19 |
|---|---:|---:|---:|
| 256² canonical tiles/reads | 40 | 160 | 640 |
| Six-band uncompressed payload | 60 MiB | 240 MiB | 960 MiB |
| Average compressed tile allowance within 20 MiB | 512 KiB | **128 KiB** | **32 KiB** |
| Required aggregate compression, raw / 20 MiB | 3:1 | **12:1** | **48:1** |
| Wire bytes if 02b's assumed compression per cell held | 20 MiB | **80 MiB** | **320 MiB** |

The last row is a conditional extrapolation, **not a compression measurement**.
Gutters, object metadata and bounds need additional bytes; thus 128/32 KiB are generous
upper allowances if the entire 20 MiB were assigned to tile bodies. Preserving only
40 reads at the finer zoom reduces geographic coverage to one quarter / one sixteenth,
which cannot demonstrate the required original-domain coverage. Packing that old
footprint into larger 512²/1024² objects yields **6/24 MiB per object** before compression;
it does not save bytes or inherit 02b's measured 1.5 MiB transfer tails.

**Budget verdict:** ordinary 256² objects retain 02b's per-object payload size, but
that alone does not establish a session or residency fit. Uncompressed same-coverage
z18/z19 delivery fails the envelope; delivery at the old assumed compression also
fails it. Actual full-schema compressed delivery is **unmeasured**, so neither lattice
receives an overall pass. The 8709-byte flat tile and compressed probe logs cannot
stand in for terrain/evidence-rich canonical tiles. No CDN capacity impossibility is
claimed: caching, compression and sparse acquisition may make a bounded working set
fit, but that must be demonstrated without discarding required receiver/caster coverage.

**Finest passing agreement lattice: z19, 24 B/cell per copy, 48 B/cell for the selected
worker/GPU pair. Finest demonstrated agreement-plus-delivery pass: none.** If proceeding
to delivery qualification, **z18 is the least costly passing candidate tested**, with
fourfold fewer cells than z19. It still needs ≤20 MiB actual same-coverage delivery
(including bounds/evidence), admitted worker/GPU/staging peaks, and deadline measurements.
No selected production resolution or relaxed budget is smuggled in by an accuracy pass.
All arithmetic, including both passing candidates, is in [memory.json](./evidence/02c/memory.json).

## Same-day route percentage: code confirmation

[CODE] **No automatic updater exists for a settled route's `shadowCoverage` on a
same-day clock change.** The relevant executing paths are:

1. [`useShadowTime.ts:210`](../../app/hooks/useShadowTime.ts#L210): slider changes call
   `setDate`. The hook updates its mutable `dateRef.current` on render at line 130.
   [`page.tsx:205`](../../app/page.tsx#L205) passes that ref to `useNavigation`, whose
   [inputs at lines 127–133](../../app/hooks/useNavigation.ts#L127) contain no reactive
   `date` value. Its effects handle keyboard events; none resamples routes on clock changes.
2. [`MapView.tsx:827`](../../app/components/MapView.tsx#L827): the `[date]` effect schedules
   `shadowRef.current?.setDate(date)` and updates solar visualization. It does not write
   route results. This explains why map shadows change while the route number persists.
3. A requested route calculation calls
   [`field.sampleEdges(edgeRefs, dateRef.current)` at line 1230](../../app/hooks/useNavigation.ts#L1230),
   fills the edge cache, builds sidewalk weights and searches. Route statistics compute
   the distance-weighted fraction in
   [`routing.ts:530`](../../app/lib/routing.ts#L530) / the Pareto counterpart at line 803.
   [`useNavigation.ts:1373`](../../app/hooks/useNavigation.ts#L1373) copies
   `result.shadowCoverage` into route options; line 1714 publishes them with `setNavRoutes`.
   Sketch calculation likewise computes/publishes at lines 802, 853 and 872.
4. [`RouteCard.tsx:24`](../../app/components/RouteCard.tsx#L24) renders
   `Math.round(r.shadowCoverage * 100)`. The navigation status panel also reads the
   [stored route field](../../app/components/NavigationStatusPanel.tsx#L41).
   Searching all `shadowCoverage` assignments and `setNavRoutes` calls found calculation,
   saved-route load, clearing, and selection paths; no clock subscription overwrites it.
   The preference handler at [line 518](../../app/hooks/useNavigation.ts#L518) chooses an
   existing option and returns the same routes without resampling.
5. The hourly strip is separate. [`useHourlyExposure.ts:60–74`](../../app/hooks/useHourlyExposure.ts#L60)
   memoizes edges and local-day anchor. Its effect depends on edges, field, day anchor,
   offset and chosen sides at [line 140](../../app/hooks/useHourlyExposure.ts#L140).
   It calls `sweep` for the hourly series and publishes only its own state, never
   `setNavRoutes`. Within a fixed day/offset it does not rebuild that series or interpolate
   a route percentage. [`page.tsx:245`](../../app/page.tsx#L245) only changes `currentHour`
   for the strip's highlight; picking an hour calls `setDate`.

An explicit recalculation at the new time can produce a new stored percentage, and
loading another saved route replaces the stored value. An already-running calculation
can also finish after a clock change; its mutable date reads are not one frozen timestamp.
Those are calculation/load publications, not an automatic same-day refresh mechanism.
The trace confirms 02b §1.1's finding; no new UI behavior is implemented here.
[Numbered code excerpts](./evidence/02c/route-code-path.txt) preserve the inspected path.

## Reproduction and raw evidence

Run from the repository root using the installed dependencies and Playwright browser:

```bash
node docs/shadow-engine-v2/evidence/02c/run.mjs
LD_LIBRARY_PATH=/home/wslunusn/miniconda3/lib node docs/shadow-engine-v2/evidence/02c/run-gpu.mjs
python3 docs/shadow-engine-v2/evidence/02c/summarize.py
```

The library path is this machine's Chromium dependency workaround. `run.mjs` builds
an isolated temporary harness and executes the original gate once plus z17/z18/z19;
z17's child exit 1 is expected and recorded, not hidden. `gate-status.json` records all
four statuses. The GPU runner checks equality and the analytic witnesses and exits
nonzero on mismatch. The summary checks all four reference-background reports agree,
then losslessly gzips raw JSON; it does not replace raw arrays with summaries.

Durable files include:

- [Raw z17](./evidence/02c/raw-z17.json.gz), [raw z18](./evidence/02c/raw-z18.json.gz),
  [raw z19](./evidence/02c/raw-z19.json.gz): every fixture/sidewalk answer, point position,
  validity, reference pixel/RGB, sun, grid, evidence, and all four background runs.
  Separate `raw-z*-validity.json.gz` retain the new assertion's runs.
- [GPU raw](./evidence/02c/gpu-raw.json.gz), [GPU summary](./evidence/02c/gpu-summary.json),
  [legacy log](./evidence/02c/legacy-gate.log), [z17 log](./evidence/02c/gate-z17.log),
  [z18 log](./evidence/02c/gate-z18.log), [z19 log](./evidence/02c/gate-z19.log).
- [Run metadata/input hashes](./evidence/02c/run-metadata.json),
  [SHA-256 manifest](./evidence/02c/SHA256SUMS), full probe sources and the exact adapter diff.

`gzip -dc` restores each raw JSON byte stream. These files live in the deliverable
directory, not only `/tmp`; the old lost 02a/02b raw captures are not invented or
represented as recovered. No production test-suite, full renderer, physical-accuracy,
mobile memory, new CDN latency, or new compression qualification is claimed.
