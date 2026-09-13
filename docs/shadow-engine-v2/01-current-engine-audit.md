# Phase 1 — Current engine audit

Audit date: **2026-09-12 UTC**. Phase 0's verdict in [00-findings.md](./00-findings.md) is settled input. This document audits existing code and records measurements; it does not specify a replacement.

**Stopping condition met for PR #313:** the rectangular canopy shadows and translating near edges have specific code causes, and the rendering and canopy-fetch costs have been measured. The near-edge finding needs a qualification: this is projection of an elevated crown, not translation of the physical tree base. Query-contract and offscreen-caster findings collected during the audit are included below. No branch, production edit, issue, or later-phase deliverable was created.

## Revision boundary

[CONFIRMED] The working checkout was `main` at `cbefb8a02ef136e83447754ec35acd9bd71f6d28`. It does **not** contain `canopyRenderer.ts`: its local renderer casts building shadows, and its canopy presentation is a time-independent raster extent. The user identified **[PR #313](https://github.com/marcopolocheung/umbrapriv/pull/313)** as the build showing the artifacts. The PR was open when inspected; its latest commit was **`db1a73ae738a4d0453ab5071642cf6c4af8203a9`**, following `76e865c6978edc4d14f4011c7e429a4fdf5cbb87`. The findings about rendered canopy below apply to that latest commit. They do not claim that the earlier PR revision or a deployed site was tested.

[CONFIRMED] PR code was read from existing Git objects and exported with `git archive` into `/tmp/umbra-phase1-audit/pr313`. No checkout, branch, worktree, or `app/` edit was needed. Source links below are pinned to the PR commit. The network reader, tile store, `ShadowField.ts`, and `useNavigation.ts` were byte-identical between the working checkout and that commit (`git diff` over those files was empty). This permits the separately measured current-checkout transport to describe the PR's same transport implementation.

## 1. Root causes

### Box-shaped canopy shadows: source contours are discarded before drawing

[CONFIRMED] The decisive chain is in [reduceCanopyFrame](https://github.com/marcopolocheung/umbrapriv/blob/db1a73ae738a4d0453ab5071642cf6c4af8203a9/app/lib/shadow/canopyRenderer.ts#L52):

1. `blockSize = ceil(max(frame.width, frame.height) / 256)`, floored at one. Each block becomes one axis-aligned rectangular cell.
2. Lines 75–93 retain **maximum height** and occupied-pixel **count**. They do not retain occupied pixels' positions inside the block.
3. Lines 96–112 emit the **whole block's** `center` and `halfSize`, plus that maximum height, occupancy, and one Bayer threshold.
4. [The vertex shader, lines 238–244](https://github.com/marcopolocheung/umbrapriv/blob/db1a73ae738a4d0453ab5071642cf6c4af8203a9/app/lib/shadow/canopyRenderer.ts#L238) accepts or rejects the **entire instance** with `a_dither <= a_occupancy`. All vertices in an instance share these values. This is not a per-fragment source-mask lookup.
5. The six fixed vertices at [lines 407–420](https://github.com/marcopolocheung/umbrapriv/blob/db1a73ae738a4d0453ab5071642cf6c4af8203a9/app/lib/shadow/canopyRenderer.ts#L407) form the swept hull of an axis-aligned rectangle. Line 215 submits these as one instanced triangle-fan draw. The fragment shader at lines 246–250 writes a uniform color; it never samples the canopy raster.

The rendered object is therefore a displaced rectangular cell, elongated along the shadow direction. At non-cardinal sun azimuths its swept outline can be hexagonal; “box-shaped” describes its rectangular generating footprint, not a guarantee that every shadow is a screen-aligned square. Raising source resolution does not restore details discarded by the block reduction.

[MEASURED] A deterministic probe supplied two 512×512 frames differing only in which corner of the first 2×2 block contained a 20 m canopy pixel. **Both produced identical LOD output.** The emitted cell had `blockSize=2`, `heightM=20`, `occupancy=0.25`, and `dither=0.03125`. The shader accepts that whole cell. One occupied source pixel is thus represented by the full selected four-pixel block, regardless of its original corner. Method: execute the PR's exported `reduceCanopyFrame` twice in Chromium and compare the complete serialized grids; one paired fixture, both cases shown in the reproducer. This is a direct witness of contour loss, not an inference from the word “prism.”

[CONFIRMED] Even at `blockSize=1`, the generator remains a rectangular raster cell with one height. Larger blocks amplify the artifact; they are not necessary for square cell edges to exist. The flat canopy image is a different consumer and can retain source detail that the shadow generator has already discarded.

### Drifting “bases”: the near edge is projected from 35% of canopy height

[CONFIRMED] [CROWN_BASE_FRACTION](https://github.com/marcopolocheung/umbrapriv/blob/db1a73ae738a4d0453ab5071642cf6c4af8203a9/app/lib/shadowField/canopy.ts#L121) is `0.35`. In the **executing GPU shader**, [lines 238–241](https://github.com/marcopolocheung/umbrapriv/blob/db1a73ae738a4d0453ab5071642cf6c4af8203a9/app/lib/shadow/canopyRenderer.ts#L238) compute:

```text
crownFraction = mix(0.35, 1.0, a_vertex.z)
reachM = min(400, heightM * crownFraction / max(tanAltitude, 0.0001))
pos = center + rectangularCorner + shadowUnit * reachM
```

The fan's near vertices have `a_vertex.z=0`, so **the near edge also receives a nonzero, time-dependent offset**. No vertex anchors that shadow to ground under the source cell. `u_shadowUnit` changes with solar azimuth at lines 202–208. The limit of 400 m is explicit in line 239.

[MEASURED] The PR's CPU counterpart, [canopyShadowOffsetsM](https://github.com/marcopolocheung/umbrapriv/blob/db1a73ae738a4d0453ab5071642cf6c4af8203a9/app/lib/shadow/canopyRenderer.ts#L121), returned the following for one fixed 20 m cell, azimuth zero, at two controlled sun altitudes. The GPU expression above encodes the same displacement.

| Sun altitude | Projected crown-base displacement | Projected crown-top displacement |
|---|---:|---:|
| 45° | 7.000000 m | 20.000000 m |
| 20° | 19.232342 m | 54.949548 m |

Method/sample count: two direct browser calls on the PR revision, using explicit angles rather than wall-clock time; maximum base displacement in this pair was 19.232342 m. These are computed model outputs, not observed distances in a real street. The near edge moves **12.232342 m** between the calls while the source cell stays fixed.

[CONFIRMED] The physical ground coordinates are not being mutated. [Cell centers](https://github.com/marcopolocheung/umbrapriv/blob/db1a73ae738a4d0453ab5071642cf6c4af8203a9/app/lib/shadow/canopyRenderer.ts#L96) depend on the source frame; [instance packing](https://github.com/marcopolocheung/umbrapriv/blob/db1a73ae738a4d0453ab5071642cf6c4af8203a9/app/lib/shadow/canopyRenderer.ts#L297) subtracts a stable render origin. The date path changes sun uniforms. The flat extent's [image coordinates](https://github.com/marcopolocheung/umbrapriv/blob/db1a73ae738a4d0453ab5071642cf6c4af8203a9/app/lib/canopyRaster/canopyLayer.ts#L147) come from the frame bbox, and refresh is triggered by `moveend`, not date changes (line 228).

**Interpretation:** moving the ground shadow of an elevated crown is physically possible for a static tree. What the code explicitly assumes is that every canopy column is empty below `0.35 × height`, and that only the crown casts—there is no trunk in this renderer. The resulting box's nearest projected edge “slides.” Calling that edge the tree's physical base conflates the projected shadow with the caster. The universal 35% underside is a model prior; it is not supplied by the height raster. A claim that the actual flat tree footprint translates at a fixed camera is **[NOT REPRODUCED]** by this audit. A recording showing that additional effect would require a separate diagnosis; it is not established by this shader.

[CONFIRMED] The routing raster marcher shares this elevated-crown assumption: [lines 215–230](https://github.com/marcopolocheung/umbrapriv/blob/db1a73ae738a4d0453ab5071642cf6c4af8203a9/app/lib/shadowField/canopyRasterField.ts#L215) test ray/crown height-interval overlap, including `rayHigh >= canopyM * CROWN_BASE_FRACTION`. OSM crowns likewise carry `baseM`. Thus replacing only the visible geometry would not change this assumption in routing. This is a dependency finding, not a replacement proposal.

## 2. Where time goes

### Method and scope

[MEASURED] Host: Intel Core i7-12700H, 20 logical CPUs exposed to WSL2; Linux `6.18.33.2-microsoft-standard-WSL2`, x86-64; Node `v20.20.1`; Playwright Chromium **153.0.8010.12**. GL renderer: **ANGLE / Vulkan 1.3.0 / SwiftShader Device (Subzero)**. Device scale factor 1; no CPU/network throttling. The package declares Node 24, but these browser probes were actually launched with Node 20; no production build or Node-24 CI result is claimed.

The rendering probe imports the PR's real `LocalShadowAdapter` into a browser and calls its real `render` method with a fixed orthographic Mercator matrix, a small map-interface stub, and controlled sun angles. It executes the production GL calls and shaders. It excludes React, MapLibre's basemap rendering, live MapTiler requests, and worker scheduling. Pitch is **0**; the building wall pass is inactive. This measures the custom layer, not end-to-end app frame intervals or the PR's pitch-55 benchmark.

Data: 267 actual features from `e2e/fixtures/basemapStyle.ts`; the PR's `syntheticCanopyStore`, stitched over a 1200×843.75 m bbox centered at `[-73.984, 40.754]`. Its 64×64 supplier becomes a **64×45 render frame** through the production stitcher. There are 947 canopy instances without buildings and 626 after footprint masking. This is the PR's synthetic source, not a representative live forest or city census.

GPU measurement uses **`EXT_disjoint_timer_query_webgl2`**, waits asynchronously for every query result, and rejects disjoint results. The final GL error was zero. Each condition executes 25 samples; the first five are excluded, leaving **20 measured samples per condition**. “Median” uses the upper middle sorted value (index 10 of 20); “worst” means the maximum observed in that condition. CPU submit time is `performance.now()` around the synchronous render call. Whole-command-stream GPU timers can include time waiting for CPU submission; they are not added to CPU time. Separate, non-nested timers around individual draw/blit/upload calls provide the attribution below.

An exploratory current-checkout probe used only `gl.finish()` and synchronous call timing. That failed to give credible completion attribution under browser command buffering. Its timings were **discarded**, not published as GPU time. Only the timer-query experiment supports the rendering figures here.

### Rendering result: framebuffer copy and raster work dominate this fixture

[MEASURED] All times below are milliseconds. Conditions use the same ground extent; changing canvas resolution changes pixel work, not the source geometry. All steady rows have zero geometry uploads.

| Condition | Canvas | Shadow FBO | CPU submit median / worst | GPU interval median / worst |
|---|---|---|---:|---:|
| Canopy only | 1280×900 | 320×225 | 4.4 / 6.0 | 47.462 / 52.256 |
| Buildings only | 1280×900 | 2560×1800 | 4.5 / 5.9 | 117.369 / 124.134 |
| Buildings + canopy | 1280×900 | 2560×1800 | 4.2 / 5.7 | 145.086 / 194.297 |
| Same combined scene, half dimensions | 640×450 | 1280×900 | 2.8 / 3.9 | 64.695 / 80.999 |
| Same combined scene, quarter dimensions | 320×225 | 640×450 | 2.8 / 3.2 | 42.708 / 48.104 |
| Combined; only draw fragments scissored to 1×1 | 1280×900 | 2560×1800 | 4.2 / 7.3 | 92.096 / 94.902 |
| Combined; sun changes every sample | 1280×900 | 2560×1800 | 5.0 / 8.1 | 150.214 / 171.743 |
| Combined; geometry cache rebuilt every sample | 1280×900 | 2560×1800 | 6.0 / 8.8 | 155.256 / 192.961 |

[MEASURED] A separate 20-sample pass-attribution run of the full-resolution combined scene:

| Timed operation, in execution order | GPU median | GPU worst | Code |
|---|---:|---:|---|
| Building ground-shadow draw A | 18.679 | 31.951 | `LocalShadowAdapter.ts:852` |
| **Building-only mask framebuffer copy** | **83.697** | **86.726** | **`LocalShadowAdapter.ts:859`** |
| Canopy instanced draw | 36.193 | 78.426 | `canopyRenderer.ts:215` |
| Building ceiling draw B | 8.668 | 9.970 | `LocalShadowAdapter.ts:941` |
| Roof exclusion draw C | 4.620 | 5.530 | `LocalShadowAdapter.ts:979` |
| Final composite draw D | 5.496 | 6.434 | `LocalShadowAdapter.ts:998` |

Per-operation medians need not sum to the median of whole frames; the timer boundaries also differ. The separately instrumented run's median sum was 156.077 ms, worst 199.847 ms. Query instrumentation perturbs execution, so use the whole-frame table for the condition comparisons and this table for attribution.

[CONFIRMED + MEASURED] [Lines 854–859](https://github.com/marcopolocheung/umbrapriv/blob/db1a73ae738a4d0453ab5071642cf6c4af8203a9/app/lib/shadow/LocalShadowAdapter.ts#L854) copy the full building result to a second FBO before canopy is drawn. This happens on **every rendered frame with buildings**, including the buildings-only condition. At the measured full size, that is a 2560×1800 copy. It is **GPU-to-GPU framebuffer traffic**, not JS-to-GPU geometry transfer or CPU readback. It is the largest individually timed operation here.

[MEASURED] Steady combined rendering submits **five draws** (four `drawArrays`, one `drawArraysInstanced`) and **one blit**, with **zero `bufferData` calls and zero upload bytes**. Draw-call count stays constant in the resolution sweep, while the GPU interval falls from 145.086 to 42.708 ms. Restricting draw fragments to one pixel leaves clears and the full blit intact and reduces the interval to 92.096 ms. This establishes substantial pixel-dependent cost and a large remaining copy/clear/command cost; it does not justify calling everything “fill rate.” Many trees are instances within one draw, not thousands of draw calls.

[MEASURED] On a sun change, there are four geometry uploads totaling **134,568 bytes**, all building buffers; canopy instances remain cached. CPU extrusion is **1.5 ms median / 4.3 ms worst**. A forced full rebuild additionally costs **1.0 / 2.5 ms** for building-cache construction and **0.3 / 0.8 ms** for canopy reduction; total uploads become **152,096 bytes**. These are measured on the small fixture above. In the separately instrumented scrub run, the four upload calls together had a GPU median of **0.003 ms**, worst **0.665 ms**; CPU time inside `bufferData` was **0.0 / 0.2 ms** (the median rounded to zero at browser timer resolution, not proof of zero cost). Driver-deferred transfer can appear in a later operation, so these are observed call intervals, not a universal bandwidth number. Nevertheless, zero-upload steady frames are already slow: transfer is not required to reproduce this bottleneck.

**Verdict, bounded to the tested renderer and hardware:** completed rendering work dominates CPU geometry. The largest measured operation is the building-mask copy, followed by canopy rasterization; pixel-work controls materially change cost. CPU geometry and JS uploads do not explain the steady-frame delay. **[UNMEASURED]** Hardware-GPU/mobile behavior, pitch-55 wall rendering, live-density canopy, first shader compilation, and full application responsiveness. The PR's pre-existing benchmark numbers were not substituted for measurements here.

### Cold canopy acquisition: network waiting dominates

[MEASURED] The unchanged production `createCanopyTileStore` + `createCogTileSource` read a **1400×800 m** Madrid area centered at `[-3.7038, 40.4168]` from `data.source.coop`, equivalent to the 600 m straight route plus the field's 400 m padding on each side. Three fresh stores, one browser context, HTTP cache explicitly disabled through CDP, service workers blocked, normal connection reuse. Each cold read had **five successful HTTP 206 responses**, **327,680 response-body bytes**, and **zero retries**. Browser/DNS/TLS connection warmth is not reset between samples; the table preserves that ordering. No source was stubbed.

The fetch instrument records start through actual `arrayBuffer()` completion, then computes the **union** of overlapping request intervals. It does not sum concurrent waits. “Outside fetch” includes decoding, bookkeeping, and scheduling; it is not claimed to be pure decode CPU time.

| Fresh-store sample | Total read | Time with fetch/body outstanding | Outside those intervals | Immediate same-store repeat |
|---|---:|---:|---:|---:|
| 1 | 1971.0 ms | 1878.1 ms | 92.9 ms | 4.5 ms |
| 2 | 960.4 ms | 904.7 ms | 55.7 ms | 0.3 ms |
| 3 | 872.6 ms | 824.4 ms | 48.2 ms | 0.2 ms |

The output was **771×441** height pixels, **1.818600 ground m/pixel**, maximum sampled canopy height **19 m**. For 60 timed CPU-only repetitions over these decoded patches (20 after five warmups for each cold sample), constructing `CanopyHeightField` cost **0.5 ms median / 0.7 ms worst**; painting the current-checkout extent cost **3.3 / 4.0 ms**. That paint result describes the old extent painter, not PR #313's added stitch/LOD work. The current and PR transport implementations are identical; the painter changed.

**Verdict:** this cold canopy read spends roughly 94–95% of wall time with network work outstanding, whereas a same-store repeat needs no HTTP requests. Network is a separate cold-data bottleneck; it cannot explain the zero-fetch renderer experiment. **[UNMEASURED]** Live MapTiler vector-tile latency, Overpass latency, HTTP headers/preflight byte totals, pure decompression time isolated from scheduling, and cold reads in other cities. No claim that all app startup time is canopy fetching is supported.

## 3. ShadowField as routing actually calls it

[CONFIRMED] The contract is already synchronous after optional asynchronous readiness. [Types at lines 53–124](https://github.com/marcopolocheung/umbrapriv/blob/db1a73ae738a4d0453ab5071642cf6c4af8203a9/app/lib/shadowField/ShadowField.ts#L53):

```ts
type ShadowSource = "tiles" | "overpass" | "canopy" | "mixed" | "canvas" | "none";
type EdgeRef = { from: [number, number]; to: [number, number] }; // longitude, latitude
interface ShadowSample { shadow: number; source: ShadowSource; confidence: number }
interface EdgeShadow {
  left: number; right: number; source: ShadowSource; confidence: number;
  buildingSource?: "tiles" | "overpass" | null;
  canopySources?: { osm: boolean; raster: boolean };
}
interface BBox { west: number; south: number; east: number; north: number }
interface ShadowReadyOptions { signal?: AbortSignal; deadlineAt?: number }
interface ShadowField {
  shadowAt(lng: number, lat: number, when: Date): ShadowSample;
  sampleEdges(edges: EdgeRef[], when: Date): EdgeShadow[];
  ready(bbox: BBox, options?: ShadowReadyOptions): Promise<void>;
  readyEdges(edges: EdgeRef[], options?: ShadowReadyOptions): Promise<void>;
  coverage(bbox: BBox, when: Date): { source: ShadowSource; confidence: number };
  coverageEdges(edges: EdgeRef[], when: Date): { source: ShadowSource; confidence: number };
  sweep(edges: EdgeRef[], times: Date[]): EdgeShadow[][];
}
```

Fractions and confidence are 0–1. Output edge order matches input order. Coordinates are geographic degrees, time is a `Date`, and canonical edge direction is low node ID to high node ID. `shadowAt` averages a five-point neighborhood; **edge sampling does not**: it directly samples the two sidewalks displaced ±4 m. Night produces full shade with `source:"none", confidence:1`; missing daytime data can have the same source with zero confidence. Do not conflate these cases.

[CONFIRMED] [routingEdgeBatch](https://github.com/marcopolocheung/umbrapriv/blob/db1a73ae738a4d0453ab5071642cf6c4af8203a9/app/hooks/useNavigation.ts#L91) deduplicates graph adjacency into unordered node-pair keys and excludes negative virtual nodes. The normal calculate-route path starts broad `ready` beside graph fetching, then calls `readyEdges` for the exact returned batch under the same deadline ([lines 1133–1161](https://github.com/marcopolocheung/umbrapriv/blob/db1a73ae738a4d0453ab5071642cf6c4af8203a9/app/hooks/useNavigation.ts#L1133)). It calls **`sampleEdges(edgeRefs, dateRef.current)` once**, at line 1230, before search. The results populate `edgeShadowCache` and the parallel sidewalk graph. [Pareto search](https://github.com/marcopolocheung/umbrapriv/blob/db1a73ae738a4d0453ab5071642cf6c4af8203a9/app/hooks/useNavigation.ts#L1358) reads precomputed edge weights; it does not query a GPU or `ShadowField` at every relaxation. The sketch path separately batches at line 802. Recalculation or a sweep is additional work; more Pareto labels do not themselves multiply shadow calls.

For an edge of length `d`, [edgeSampleCount](https://github.com/marcopolocheung/umbrapriv/blob/db1a73ae738a4d0453ab5071642cf6c4af8203a9/app/lib/shadowField/ShadowField.ts#L231) gives `N=max(3,ceil(d/25))`. The inclusive loop at lines 936–947 tests `N+1` points per sidewalk. Thus a daytime batch with usable evidence requires:

```text
2 × Σedges [max(3, ceil(lengthMetres / 25)) + 1]
```

point evaluations, each potentially consulting buildings, OSM canopy, and the raster march. This count is not five times larger: the public point-query neighborhood is not used here. A raster point can take multiple array steps, bounded by its 400 m march and height/sun termination.

[MEASURED] The committed 11×11 street fixture enumerated **121 nodes, 440 directed edges, 220 unique edges**, and **1760 point locations**. One geometry-backed `sampleEdges` call returned all 220 results from `tiles`; its first-call time was **17.0 ms**. Twenty subsequent measured calls after five total warmup calls had **2.0 ms median / 2.8 ms worst** (upper median also 2.0 ms). This is a building-only, preloaded browser fixture, not a measured live route or a bound on graph size. The reproducer asserts the source is `tiles`; an exploratory incorrectly configured provider returned `none`, and those timings were discarded.

[CONFIRMED] Spatial batches use 2 km sun cells; prepared caster arrays are cached by identity, while `sunCellsAt` builds time-specific indexes per cell ([lines 591–640](https://github.com/marcopolocheung/umbrapriv/blob/db1a73ae738a4d0453ab5071642cf6c4af8203a9/app/lib/shadowField/ShadowField.ts#L591)). `sweep` reuses the batch preparation for an array of times. This is the reuse already implemented, not a hypothetical per-point fetch interface.

**Latency tolerance:** the normal caller explicitly grants readiness **2500 ms total** via one absolute deadline (`useNavigation.ts:66,1137`); it does not grant 2500 ms per point, provider, or edge. Readiness runs beside graph fetch, so this is not an overall route-search timeout. Weak evidence below confidence **0.5** can trigger the dedicated building-mask fallback; only that fallback can flatten/fit the map and read pixels. **[UNMEASURED / UNSPECIFIED]** There is no numeric latency SLO enforced for synchronous `sampleEdges`, and no measured live graph-volume distribution in this audit. The interface requires the complete array synchronously on the route's main-thread path; no promise or per-point asynchronous readback is accepted by that caller. A tolerance beyond that cannot honestly be invented from a frame-rate target.

## 4. Does an offscreen caster shadow into view?

[MEASURED] **Yes when its feature is in loaded source tiles; no general guarantee beyond them.** Unlike the rendering microbenchmark, this test used a real MapLibre 5.9.0 map and its actual tile selection. Two fresh maps, 256×256 CSS pixels, DPR 1, zoom 17, pitch/bearing 0, center `[0.001,0.001]`, explicit sun altitude 10°, azimuth −π/2 (shadow westward). Each source contains one 20×20 m footprint with `render_height=400`, no `hide_3d` flag. Its center is placed east of the map center as shown. Both footprints are wholly outside the viewport, whose eastern edge is longitude `0.001686645507732`.

| Caster east of center | `querySourceFeatures` results | Cached prisms | Center of building mask, byte scale 0–255 | Result |
|---|---:|---:|---:|---|
| 100 m | 1 | 1 | 254 | Shadow reaches the visible center |
| 1000 m | 0 | 0 | 0 | Shadow absent because caster is not loaded |

Method: wait for MapLibre idle, add the real PR local layer with controlled sun, wait for its render, and read `readBuildingShadowMask()` at the center. The GL error was zero in both cases. This paired fixture was run twice during query-probe correction with the same mask outcomes; it is not a seam corpus. The model's 400 m tower at 10° projects approximately 2268.5 m, so both locations are within geometric reach. That distance is an analytic model calculation, not a fetched-data radius. Mask sizes were 512×512 with buildings and 64×64 when no buildings were loaded, due to the PR's two FBO resolution policies.

[CONFIRMED] The mechanism is [querySourceFeatures('maptiler_planet', {sourceLayer:'building'})](https://github.com/marcopolocheung/umbrapriv/blob/db1a73ae738a4d0453ab5071642cf6c4af8203a9/app/lib/shadow/LocalShadowAdapter.ts#L1339) with **no sun-dependent fetch expansion**. Drawing clips shadow polygons at the framebuffer boundary; it does not require the footprint itself to be onscreen. But the renderer never obtains the absent far caster. Cache invalidation in `cachePolicy.ts` uses 150 m pan / 0.5 zoom thresholds and source-completion state; these are cache controls, not a shadow-reach guarantee.

[CONFIRMED] Canopy has a related acquisition boundary: [refresh](https://github.com/marcopolocheung/umbrapriv/blob/db1a73ae738a4d0453ab5071642cf6c4af8203a9/app/lib/canopyRaster/canopyLayer.ts#L186) requests the camera bbox, clamped around its center; it does not request a sunward halo. `MAX_VIEW_HALF_M=6000` limits a large view—it is not extra padding. `CANOPY_SHADOW_MAX_REACH_M=400` caps the shader's projection, but does not fetch the area needed to supply those casters. Routing independently requests 400 m padding and stops the raster march at 400 m / patch exit. Those routing patches are not automatically the renderer's frame. **[UNMEASURED]** A browser-rendered canopy-only offscreen fixture, real vector-tile boundary corpus, and distant terrain occlusion. No terrain caster is implemented on this selected local path.

## 5. File-by-file responsibilities and behavior to retain

All entries describe the PR revision unless marked otherwise. “Retain” identifies existing semantics and regression contracts, not a proposed implementation.

| File / group | Current responsibility and audit finding |
|---|---|
| `shadow/createShadowLayer.ts` | Always constructs `LocalShadowAdapter`. `UmbraAdapter.ts` delegates to a supplied third-party instance but is not selected. Phase 0's external simulator behavior is not this runtime's implementation. |
| `shadow/IShadowLayer.ts` | Date, lifecycle, exposure toggle, point queries, dedicated building mask, and PR canopy-frame handoff. Preserve the consumer-facing behaviors that are actually implemented and distinguish unsupported ones. |
| `shadow/LocalShadowAdapter.ts` | Building source query/cache; sun-driven CPU extrusion; ground MAX pass; PR building-mask snapshot and canopy draw; ceiling/depth field; roof exclusion; composite; optional 3D walls/roofs. This height texture stores **projected shadow ceilings**, not a terrain/building/canopy DSM. Ground is flat. The copy at line 859 dominates the measured fixture. Preserve agreement between building meshes and their caster heights and the dedicated mask's isolation from visible canopy. |
| `shadow/heightField.ts` | Ceiling scaling under camera projection, normalized height bias and compensated sample lift for wall self-shadow avoidance. These are existing roof/wall correctness mechanisms; the pitch-0 profile does not validate their full visual behavior. |
| `shadow/canopyRenderer.ts` (PR only) | Owns reduction, instances, swept rectangular crown shadows, seasonal alpha, GL allocation and cleanup. Encodes both reported visual mechanisms. Caches instances across time changes. It casts on ground; it does not add canopy into the building ceiling texture for receiving shadows on walls/roofs. |
| `canopyRaster/canopyPaint.ts` and `canopyLayer.ts` | Stitch CHM patches; retain height, validity and answered coverage separately in the PR frame; paint extent; encode image; update on camera moves; clear superseded/failed/disabled frames. The flat extent and cast shadow are distinct outputs. Survey/imagery caveats belong to the legend. |
| `canopyRaster/cogTileSource.ts`, `canopyCog.ts`, `tiles.ts` | COG range reads and separate validity-mask decode, overview selection, projection, tile indexing. `canopyCog.ts` also contains the earlier transport prototype, not the entire shared-store production path. Correct coordinate/ground-scale and nodata handling must survive. |
| `canopyRaster/canopyTileStore.ts`, `blockGrid.ts`, `sharedStore.ts` | Shared block-aligned decoded cache, stitch, priority scheduling, reference-counted cancellation, retries, memory bounds; route and viewport consumers reuse data. Preserve cancellation that does not let a camera pan abort another consumer's read. |
| `canopyRaster/acqDate.ts` and index | Acquisition-time/leaf-season caveats; query-date opacity cannot recover crown extent absent from imagery. Preserve this distinction. |
| `shadowField/geometry.ts` | Normalizes tile and Overpass buildings; ground-anchored swept shadow triangles preserve concavity, roof/wall mesh generation, latitude scale. **Existing limitation:** every polygon ring becomes a separate solid (`143–174`), so holes/courtyards are not holes. Do not mistake that explicit assumption for verified physical accuracy. Tile and Overpass default heights also differ. |
| `shadowField/shadowIndex.ts` | Prepared casters, regional reach culling, indexed triangle queries, elevated base/top sweeps, fractional opacity. Spatial index bboxes are acceleration bounds; they are not the PR's rendered canopy rectangles. |
| `shadowField/ShadowField.ts` | Camera-independent queries over provider data, independent sidewalks, confidence/provenance, readiness, spatial batching and time sweep. Buildings take precedence; canopy sources combine by maximum rather than compounding the same crown's opacity. Preserve explicit unknown evidence and night semantics. |
| `shadowField/providers.ts` | In-view tile evidence, cached Overpass fallback, OSM crowns and raster fields with bounded readiness. Tile coverage depends on viewport; the **field's API** is camera-independent because providers can supply offscreen data. This is not a guarantee of complete global geometry. |
| `shadowField/canopy.ts` / `canopyRasterField.ts` | OSM crown priors, elevated underside, seasonality/transmittance; raster CPU march and exact footprint subtraction. The rendered LOD silhouette differs from routing's raster march. The 35% underside is a shared assumption, not measured tree anatomy. |
| `shadow/offscreenShadow.ts` | Camera-free building spot checks from fetched footprints, with explicit failure instead of silently moving the camera. Separate from visible caster acquisition. |
| `shadowSampling.ts` | Both-sidewalk pixel helpers and dedicated-mask sampling. Blue dominance still supports agreement/browser checks, but current normal routing uses geometry or the explicit building mask. Keep mask sampling independent of canopy display/color. |
| `shadowProvenance.ts` | Distance-weighted provenance over the **chosen path**, sampled share and confidence; do not summarize the whole explored graph as if the user walked it. |
| `routing.ts` / `hooks/useNavigation.ts` | Pre-sample canonical graph edges, preserve sidewalk asymmetry, construct weighted sidewalk graph, Pareto/waypoint/sketch search, readiness deadlines and per-edge fallback. No shadow lookup per Dijkstra/Pareto relaxation. |
| `workers/sunPosition.worker.ts`, `hooks/useShadowTime.ts`, `components/MapView.tsx` | Time and solar update lifecycle; worker-based sun calculation and 0.15° dirty threshold; camera matrix; `preserveDrawingBuffer`; canopy and route layer order. Stable ground coordinates and appropriate cache invalidation remain required behavior. |
| `shadowField/__tests__/agreement/{fixtures,harness,agreement.test}.ts` | Committed method-agreement harness and ceilings: mean ≤0.04, p90 ≤0.05, share above 0.25 disagreement ≤0.04. These are code thresholds, not new measurements. Preserve the harness and ceiling policy; it compares Umbra models, not independent real-world truth. No new physical-accuracy claim or full-suite pass is made here. |
| `components/AccumulationPanel.tsx` | Exposure controls plus canvas-to-RGB GeoTIFF export. **Correction to the brief:** the selected local adapter's `setSunExposure` is a no-op (`LocalShadowAdapter.ts:363–366`). The export implementation exists, but this runtime does not compute the requested accumulated sun-hours. Preserve the exposed export/controls as product surface; do not label current exported pixels a validated accumulation result. |

[CONFIRMED] Important existing correctness constraints include camera-independent data queries, both sidewalk fractions, consistent source/confidence semantics, dedicated building-only fallback masks, source-data reuse and cancellation, building mesh/shadow consistency, nodata separation, and the agreement harness. The audit also identifies existing limitations—flat terrain, courtyard solids, bounded caster coverage, missing canopy reception on structures, and inactive local accumulation—so they cannot be silently promoted to capabilities during a later phase.

## 6. Reproduction and evidence boundary

The measured scope answers the user's two priority questions for the identified PR. The remaining unmeasured items are stated beside their findings. **No Phase 2 design is included.**

The complete throwaway probes are embedded below so reproducing the evidence does not depend on `/tmp` surviving. They create no production changes. They print/write raw sample arrays; tables above summarize those arrays. No screenshots or timing figures were borrowed from the PR description.

Setup from the repository root, with the existing dependency installation and Playwright Chromium:

```bash
mkdir -p /tmp/umbra-phase1-audit/pr313
git archive db1a73ae738a4d0453ab5071642cf6c4af8203a9 | tar -x -C /tmp/umbra-phase1-audit/pr313
ln -s /home/wslunusn/ShadeMapNavigation/node_modules /tmp/umbra-phase1-audit/pr313/node_modules
# In separate terminals, serve the working checkout and the exported PR:
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5189 --strictPort
node node_modules/vite/bin/vite.js /tmp/umbra-phase1-audit/pr313 --host 127.0.0.1 --port 5190 --strictPort
```

Use the exact working revision above for the current-checkout transport/old-painter measurement. Paths in the probes name this audit's workspace; adjust the Playwright import and symlink if running elsewhere. Vite serves source modules; no build artifact is substituted. Exporting a snapshot does not select or create a branch. The PR commit must already be present in Git's object database, as it was here.

<details>
<summary>PR rendering profile and geometric witnesses — pr-profile.mjs</summary>

Save as `/tmp/umbra-phase1-audit/pr-profile.mjs` and run `node /tmp/umbra-phase1-audit/pr-profile.mjs`.

```js
import { chromium } from '/home/wslunusn/ShadeMapNavigation/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs';
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
 await page.goto('http://127.0.0.1:5190/e2e/bench/a8dHarness.html');
 const result=await page.evaluate(async()=>{
  const {LocalShadowAdapter}=await import('/app/lib/shadow/LocalShadowAdapter.ts');
  const {reduceCanopyFrame,canopyShadowOffsetsM}=await import('/app/lib/shadow/canopyRenderer.ts');
  const {fixtureBuildingFeatures}=await import('/e2e/fixtures/basemapStyle.ts');
  const {syntheticCanopyStore}=await import('/app/lib/canopyRaster/syntheticCanopyHarness.ts');
  const {stitchCanopyFrame}=await import('/app/lib/canopyRaster/canopyPaint.ts');
  const canvas=document.createElement('canvas');document.body.append(canvas);canvas.width=1280;canvas.height=900;
  const gl=canvas.getContext('webgl2',{preserveDrawingBuffer:true,antialias:false});
  const ext=gl.getExtension('EXT_disjoint_timer_query_webgl2');if(!ext)throw Error('GPU timers unavailable');
  const debug=gl.getExtension('WEBGL_debug_renderer_info');
  const features=fixtureBuildingFeatures(),lng=-73.984,lat=40.754,cos=Math.cos(lat*Math.PI/180);
  const mx=(lng+180)/360,my=0.5-Math.log((1+Math.sin(lat*Math.PI/180))/(1-Math.sin(lat*Math.PI/180)))/(4*Math.PI);
  const sx=2/(1200/(40075016.686*cos)),sy=-2/(843.75/(40075016.686*cos));
  const matrix=new Float64Array([sx,0,0,0,0,sy,0,0,0,0,1,0,-sx*mx,-sy*my,0,1]);
  const bbox=[lng-600/(111320*cos),lat-421.875/111320,lng+600/(111320*cos),lat+421.875/111320];
  const frame=stitchCanopyFrame([await syntheticCanopyStore().read(bbox)]);
  let activeFeatures=features,pitch=0;
  const map={getCenter:()=>({lng,lat}),getZoom:()=>17,getPitch:()=>pitch,isSourceLoaded:()=>true,querySourceFeatures:()=>activeFeatures,on:()=>{},off:()=>{},triggerRepaint:()=>{},getBounds:()=>({getWest:()=>bbox[0],getEast:()=>bbox[2],getSouth:()=>bbox[1],getNorth:()=>bbox[3]})};
  const layer=new LocalShadowAdapter({date:new Date('2026-06-21T13:00:00Z')});layer.sunWorker?.terminate();layer.sunWorker=null;layer.onAdd(map,gl);layer.lastSunAzRad=.8;layer.lastSunAltRad=.55;
  const render=()=>{gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.viewport(0,0,canvas.width,canvas.height);layer.render(gl,{defaultProjectionData:{mainMatrix:matrix}});};
  let row=null,tiny=false,queries=[],profileMode='whole';
  const originals={};
  for(const name of ['drawArrays','drawArraysInstanced','blitFramebuffer','bufferData']){
   originals[name]=gl[name].bind(gl);
   gl[name]=function(...args){
    const isDraw=name.startsWith('draw');if(tiny&&isDraw){gl.enable(gl.SCISSOR_TEST);gl.scissor(0,0,1,1);}
    let q;if(row&&profileMode==='passes'){q=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,q);}
    const t=performance.now();originals[name](...args);const ms=performance.now()-t;
    if(q){gl.endQuery(ext.TIME_ELAPSED_EXT);queries.push({q,name});}
    if(row){row.calls[name]=(row.calls[name]||0)+1;row.submit[name]=(row.submit[name]||0)+ms;if(name==='bufferData')row.bytes+=typeof args[1]==='number'?args[1]:args[1]?.byteLength??0;}
    if(tiny&&isDraw)gl.disable(gl.SCISSOR_TEST);
   };
  }
  for(const [obj,name,key]of [[layer,'buildBuildingGeometryCache','build'],[layer,'extrudeShadows','extrude'],[layer.canopyRenderer,'rebuild','canopyReduce'],[layer.canopyRenderer,'ensureInstances','canopyPackUpload']]){
   const fn=obj[name].bind(obj);obj[name]=(...args)=>{const t=performance.now(),r=fn(...args);if(row)row.cpu[key]=(row.cpu[key]||0)+performance.now()-t;return r;};
  }
  async function drain(){gl.flush();const start=performance.now();while(queries.some(({q})=>!gl.getQueryParameter(q,gl.QUERY_RESULT_AVAILABLE))){if(performance.now()-start>10000)throw Error('timer timeout');await new Promise(r=>setTimeout(r,1));}const disjoint=gl.getParameter(ext.GPU_DISJOINT_EXT);const out=queries.map(({q,name})=>{const ms=gl.getQueryParameter(q,gl.QUERY_RESULT)/1e6;gl.deleteQuery(q);return {name,ms};});queries=[];if(disjoint)throw Error('disjoint timer sample');return out;}
  const cases=[];
  for(const [name,buildings,canopy,w,h,small,mode]of [
   ['canopy-only',false,true,1280,900,false,'whole'],
   ['buildings-only',true,false,1280,900,false,'whole'],
   ['combined',true,true,1280,900,false,'whole'],
   ['combined-half',true,true,640,450,false,'whole'],
   ['combined-quarter',true,true,320,225,false,'whole'],
   ['combined-1px-fragments',true,true,1280,900,true,'whole'],
   ['combined-scrub',true,true,1280,900,false,'whole'],
   ['combined-rebuild',true,true,1280,900,false,'whole'],
   ['combined-passes',true,true,1280,900,false,'passes'],
   ['combined-scrub-passes',true,true,1280,900,false,'passes'],
  ]){
   canvas.width=w;canvas.height=h;activeFeatures=buildings?features:[];layer.buildingCache=null;layer.dirty=true;layer.setCanopyFrame(canopy?frame:null);tiny=small;profileMode=mode;
   const rows=[];
   for(let i=0;i<25;i++){
    row={calls:{},submit:{},cpu:{},bytes:0};queries=[];
    if(name.includes('scrub')||name.includes('rebuild')){layer.dirty=true;layer.lastSunAzRad=.8+i*.005;}
    if(name.includes('rebuild'))layer.buildingCache=null;
    let q;if(mode==='whole'){q=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,q);}
    const t=performance.now();render();row.cpuSubmitMs=performance.now()-t;
    if(q){gl.endQuery(ext.TIME_ELAPSED_EXT);queries.push({q,name:'whole'});}
    row.gpu=await drain();row.fbo=[layer.fboWidth,layer.fboHeight];row.instances=layer.canopyRenderer.lod.cells.length;
    if(i>=5)rows.push(row);row=null;
   }
   cases.push({name,rows});
  }
  const sparse={width:512,height:512,heights:new Uint8Array(512*512),validity:new Uint8Array(512*512).fill(1),coverage:new Uint8Array(512*512).fill(255),bbox,groundResolutionM:1200/512};
  sparse.heights[0]=20;const a=reduceCanopyFrame(sparse);sparse.heights[0]=0;sparse.heights[513]=20;const b=reduceCanopyFrame(sparse);
  const bugs={twoDifferentSourcePixelPositionsProduceIdenticalLod:JSON.stringify(a)===JSON.stringify(b),blockSize:a.blockSize,cell:a.cells[0],offsets:[45,20].map(alt=>({altitude:alt,...canopyShadowOffsetsM(20,0,alt*Math.PI/180)}))};
  return {meta:{renderer:gl.getParameter(debug.UNMASKED_RENDERER_WEBGL),timerQuery:true,glError:gl.getError(),features:features.length,canopyFrame:[frame.width,frame.height],bounds:bbox,matrix:Array.from(matrix),pitch},cases,bugs};
 });
 fs.writeFileSync('/tmp/umbra-phase1-audit/pr-profile.json',JSON.stringify(result,null,2));
 console.log(JSON.stringify({meta:result.meta,bugs:result.bugs,summary:result.cases.map(c=>{const stat=fn=>{const a=c.rows.map(fn).sort((a,b)=>a-b);return {median:a[10],max:a.at(-1)};};return {name:c.name,n:c.rows.length,cpuSubmitMs:stat(r=>r.cpuSubmitMs),gpuMs:stat(r=>r.gpu.reduce((s,p)=>s+p.ms,0)),cpu:Object.fromEntries(['build','extrude','canopyReduce','canopyPackUpload'].map(k=>[k,stat(r=>r.cpu[k]||0)])),gpuPasses:c.rows[0].gpu.map((p,i)=>({name:p.name,...stat(r=>r.gpu[i].ms)})),calls:c.rows[0].calls,bytes:c.rows[0].bytes,fbo:c.rows[0].fbo,instances:c.rows[0].instances};})},null,2));
}finally{await browser.close();}
```

</details>

<details>
<summary>Live canopy transport and decoded-patch CPU measurements — network.mjs</summary>

Save as `/tmp/umbra-phase1-audit/network.mjs` and run `node /tmp/umbra-phase1-audit/network.mjs`.

```js
import { chromium } from '/home/wslunusn/ShadeMapNavigation/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs';
const browser=await chromium.launch({headless:true});
try {
 const context=await browser.newContext({serviceWorkers:'block'});const page=await context.newPage();
 await page.goto('http://127.0.0.1:5189/e2e/bench/a8dHarness.html');
 const cdp=await context.newCDPSession(page);await cdp.send('Network.enable');await cdp.send('Network.setCacheDisabled',{cacheDisabled:true});
 const report=await page.evaluate(async()=>{
 const {createCanopyTileStore}=await import('/app/lib/canopyRaster/canopyTileStore.ts');
 const {createCogTileSource}=await import('/app/lib/canopyRaster/cogTileSource.ts');
 const {createCanopyHeightField}=await import('/app/lib/shadowField/canopyRasterField.ts');
 const {paintPatches}=await import('/app/lib/canopyRaster/canopyPaint.ts');
 const original=window.fetch.bind(window);let requests=[];
 window.fetch=async(...args)=>{const url=String(args[0]);if(!url.includes('source.coop'))return original(...args);const row={start:performance.now(),range:args[1]?.headers?.Range??args[1]?.headers?.range};requests.push(row);try{const r=await original(...args);row.headers=performance.now();row.status=r.status;row.bytes=Number(r.headers.get('content-length'));const ab=r.arrayBuffer.bind(r);r.arrayBuffer=async()=>{const b=await ab();row.end=performance.now();row.bytes=b.byteLength;return b;};return r;}catch(e){row.end=performance.now();row.error=String(e);throw e;}};
 const all=[];const lng=-3.7038,lat=40.4168,mp=111320*Math.cos(lat*Math.PI/180),bbox=[lng-700/mp,lat-400/111320,lng+700/mp,lat+400/111320];
 for(let i=0;i<3;i++){
  requests=[];const stages=[];const source=createCogTileSource();const originalOpen=source.open.bind(source);
  source.open=async(...args)=>{const t=performance.now();const h=await originalOpen(...args);stages.push({stage:'open',ms:performance.now()-t});const read=h.read.bind(h);h.read=async(...args)=>{const t=performance.now();const r=await read(...args);stages.push({stage:'read-fetch-decode',ms:performance.now()-t});return r;};return h;};
  const store=createCanopyTileStore({source,maxAttempts:1});const t=performance.now();let patch;
  try{patch=await store.read(bbox,{signal:AbortSignal.timeout(45000),priority:'route'});}catch(e){all.push({i,error:String(e),totalMs:performance.now()-t,requests,stages});continue;}
  const totalMs=performance.now()-t,networkSpans=requests.map(r=>[r.start,r.end??r.headers]).filter(r=>Number.isFinite(r[1])).sort((a,b)=>a[0]-b[0]);let union=0,end=-Infinity;for(const [s,e]of networkSpans){union+=Math.max(0,e-Math.max(s,end));end=Math.max(end,e);}
  const coldRequests=requests.map(r=>({...r,start:r.start-t,headers:r.headers-t,end:r.end-t}));const t2=performance.now();await store.read(bbox,{priority:'route'});const warmMs=performance.now()-t2;
  const cpu=[];for(let j=0;j<25;j++){let t=performance.now();const f=createCanopyHeightField(patch);const buildMs=performance.now()-t;t=performance.now();const image=paintPatches([patch]);const paintMs=performance.now()-t;cpu.push({buildMs,paintMs,painted:image.painted,maxHeightM:f.maxHeightM});}
  all.push({i,totalMs,networkActiveMs:union,nonNetworkWallMs:totalMs-union,warmMs,requests:coldRequests,stages,width:patch.width,height:patch.height,metresPerPixel:patch.metresPerPixel,stats:store.stats(),cpu:cpu.slice(5)});
 }
 return {aoi:{lng,lat,widthM:1400,heightM:800},all};
 });fs.writeFileSync('/tmp/umbra-phase1-audit/network.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
```

</details>

<details>
<summary>Route-batch volume and real-MapLibre offscreen tests — queries-seams.mjs</summary>

Save as `/tmp/umbra-phase1-audit/queries-seams.mjs` and run `node /tmp/umbra-phase1-audit/queries-seams.mjs`.

```js
import {chromium} from '/home/wslunusn/ShadeMapNavigation/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs';
const browser=await chromium.launch({headless:true,args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
const page=await browser.newPage({viewport:{width:640,height:450}});
await page.goto('http://127.0.0.1:5190/e2e/bench/a8dHarness.html');
const result=await page.evaluate(async()=>{
 const {overpassGridGraph}=await import('/e2e/fixtures/overpassGrid.ts');
 const {fixtureBuildingFeatures}=await import('/e2e/fixtures/basemapStyle.ts');
 const {prismsFromTileFeatures}=await import('/app/lib/shadowField/geometry.ts');
 const {createGeometryShadowField,staticPrismProvider,edgeSampleCount}=await import('/app/lib/shadowField/ShadowField.ts');
 const graph=overpassGridGraph(),edges=[],distances=[];
 for(const [id,list]of graph.adj)for(const e of list)if(id<e.toId){const a=graph.nodes.get(id),b=graph.nodes.get(e.toId);edges.push({from:[a.lon,a.lat],to:[b.lon,b.lat]});distances.push(e.distanceM);}
 const set=prismsFromTileFeatures(fixtureBuildingFeatures()),provider=staticPrismProvider(set,{west:-180,south:-85,east:180,north:85},'tiles');
 const field=createGeometryShadowField([provider]);const timing=[];
 for(let i=0;i<25;i++){const t=performance.now();const sampled=field.sampleEdges(edges,new Date('2026-06-21T13:00:00Z'));timing.push({ms:performance.now()-t,results:sampled.length,source:sampled[0].source});if(sampled[0].source!=='tiles')throw Error('missing geometry');}
 const query={nodes:graph.nodes.size,directedEdges:[...graph.adj.values()].reduce((s,e)=>s+e.length,0),uniqueEdges:edges.length,pointTests:distances.reduce((s,d)=>s+2*(edgeSampleCount(d)+1),0),first:timing[0],warm:timing.slice(5)};
 const maplibre=(await import('/node_modules/.vite/deps/maplibre-gl.js')).default;
 const {LocalShadowAdapter}=await import('/app/lib/shadow/LocalShadowAdapter.ts');
 const seams=[];
 for(const eastM of [100,1000]){
  document.body.innerHTML='<div id="map" style="width:256px;height:256px"></div>';
  const lon=.001,lat=.001,m=111320,r=10;
  const ring=[[eastM-r,-r],[eastM+r,-r],[eastM+r,r],[eastM-r,r],[eastM-r,-r]].map(([x,y])=>[lon+x/m,lat+y/m]);
  const map=new maplibre.Map({container:'map',style:{version:8,sources:{maptiler_planet:{type:'geojson',data:{type:'FeatureCollection',features:[{type:'Feature',properties:{render_height:400},geometry:{type:'Polygon',coordinates:[ring]}}]}}},layers:[{id:'bg',type:'background',paint:{'background-color':'#eeeeee'}},{id:'buildings',type:'fill',source:'maptiler_planet',paint:{'fill-color':'#bbbbbb'}}]},center:[lon,lat],zoom:17,pitch:0,bearing:0,canvasContextAttributes:{preserveDrawingBuffer:true},attributionControl:false});
  await new Promise(r=>map.once('idle',r));const bounds=map.getBounds();const loaded=map.querySourceFeatures('maptiler_planet',{sourceLayer:'building'}).length;
  const layer=new LocalShadowAdapter({date:new Date('2026-07-15T12:00:00Z')});layer.sunWorker?.terminate();layer.sunWorker=null;layer.lastSunAzRad=-Math.PI/2;layer.lastSunAltRad=10*Math.PI/180;map.addLayer(layer);
  await new Promise(r=>map.once('idle',r));const mask=layer.readBuildingShadowMask();let center=null;
  if(mask){const x=Math.floor(mask.width/2),y=Math.floor(mask.height/2);center=mask.data[y*mask.width+x];}
  seams.push({eastM,heightM:400,altitudeDeg:10,viewport:{west:bounds.getWest(),east:bounds.getEast(),south:bounds.getSouth(),north:bounds.getNorth()},casterFootprintOutsideViewport:ring.every(([x])=>x>bounds.getEast()),loadedFeatures:loaded,cachedPrisms:layer.buildingCache.buildings.length,maskDimensions:mask&&[mask.width,mask.height],centerMask:center,glError:map.getCanvas().getContext('webgl2').getError()});
  map.remove();
 }
 return {query,seams};
});fs.writeFileSync('/tmp/umbra-phase1-audit/queries-seams.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}finally{await browser.close();}
```

</details>

Raw-result fingerprints from this session (SHA-256):

| Raw output | SHA-256 |
|---|---|
| `pr-profile.json` | `d7c7c102b7c97756ae508a5667984cca3ba69f0df8465da2d7b15777851e2654` |
| `network.json` | `f7edc9fcfa68a3aa8798fc3155ec5fd597b8f177f47bacb29e55e22116f4677c` |
| `queries-seams.json` | `b62f13fd4b2ef232fdef6e977123f74cbe1fe5864856c24ac7e293e9318b6794` |

The raw files remained under `/tmp/umbra-phase1-audit/`; their hashes identify this run, not expected outputs for reruns. Timings vary. The embedded probes, pinned source, input fixtures, method, sample counts and observed worst cases are the durable reproduction record.
