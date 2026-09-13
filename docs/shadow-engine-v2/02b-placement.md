# 02b — Placement by stage

Measured **2026-09-12 UTC**, checkout `main` at
`cbefb8a02ef136e83447754ec35acd9bd71f6d28`. Inputs are
[BRIEF, including its September 12 amendment](./BRIEF.md), [00](./00-findings.md),
[01](./01-current-engine-audit.md), [02](./02-architecture.md), and
[02a](./02a-feasibility.md). The amendment removes the synchronous/main-thread
restriction. The shared representation, physics, provenance, acquisition obligations,
and existing gate remain settled, except for the explicitly unresolved receiver decision below.

**Placement decision:** normalize sources in a server job; compose canonical tiles in
that job and publish immutable artifacts; query resident tiles in a **browser Web Worker**;
render in **browser WebGL2**. Use regional precomputation and a CDN, with client worker
composition of *normalized* inputs as a cache-miss fallback. A persistent container is
the preparation host, not a required round trip for each clock change. Do not precompute
time-specific shadows or a worldwide fused mosaic.

This is an architecture decision supported by bounded probes, **not a claim that v2
passes activation or that its complete implementation has been benchmarked**. The
receiver conflict still prevents activation. All production-host CPU accounting, deployed
R2 acquisition latency, full terrain/datum normalization, mobile memory, and full-screen
v2 GPU latency that were not measured are identified below. Only this document is added;
02, application source, branches, and issues are untouched.

Labels: **[CODE]** inspected behavior; **[MEASURED]** this session unless attributed to
01/02a; **[DERIVED]** arithmetic; **[DESIGN]** decision; **[UNMEASURED]** evidence gap.
Prices are dated published rates and scenario arithmetic, not measured invoices.

## 1. Requirements derived from the caller

### 1.1 What dragging actually does

[CODE] `TimelineSlider` updates its CSS translation directly on pointer movement and
inertia frames. Its **executing** gates are **30 ms**, at
[lines 155 and 212](../../app/components/TimelineSlider.tsx#L155), despite the stale
“16 ms / 60 fps” comment at line 103. Pointer-up flushes the final rounded minute
([line 220](../../app/components/TimelineSlider.tsx#L220)); boundary flushing can also
bypass the interval. Thus the ordinary callback ceiling is **33⅓/s**, not 60/s.
Unchanged minutes are discarded by
[`useShadowTime.ts:210–219`](../../app/hooks/useShadowTime.ts#L210).
Playback advances two simulated minutes every **50 ms: 20 updates/s**; day playback
advances one day per tick
([lines 135–171](../../app/hooks/useShadowTime.ts#L135)). The comment's “~24 s/full day”
is also stale: 720 ticks × 50 ms is **36 s**, before scheduling delays.

[CODE] `dateRef.current` is assigned on render
([line 130](../../app/hooks/useShadowTime.ts#L130)). `MapView` schedules
`shadowLayer.setDate(date)` through a cancelling **1 ms timer**, and optionally refreshes
sun-line data ([lines 827–844](../../app/components/MapView.tsx#L827)). The local adapter
updates solar inputs using its sun worker; the 0.15° dirty check decides whether geometry
needs rebuilding ([LocalShadowAdapter.ts:280–338](../../app/lib/shadow/LocalShadowAdapter.ts#L280)).
Rendering and solar work happen; a new source field is not composed on each tick.
Current canopy extent acquisition follows map movement, not the clock. V2's sun-dependent
acquisition will add requests when a changed sun requires missing caster pages.

**[CODE] Same-day dragging queries zero route edges. The route card's percentage stays
at the calculation-time value.** `RouteCard` reads the stored `shadowCoverage`
([line 24](../../app/components/RouteCard.tsx#L24)); `useNavigation` takes a stable
`dateRef`, not a reactive `date` input
([lines 127–133](../../app/hooks/useNavigation.ts#L127)). There is no time-change effect
that resamples/reweights the route. It neither replays the hourly sweep into that card
nor interpolates it.

The **hourly strip** is a separate consumer. `page.tsx` supplies the stable selected route,
field, date, and zone offset ([lines 236–246](../../app/page.tsx#L236)).
[`useHourlyExposure.ts:60–140`](../../app/hooks/useHourlyExposure.ts#L60) keys its effect
on route edges, field, calendar-day anchor, offset, and chosen sides. Within that day,
it retains the computed series. Only the highlighted integer hour changes in
[`HourlyExposureStrip.ts:49–67`](../../app/components/HourlyExposureStrip.tsx#L49).
There is **no interpolation**, no new hourly shadow query, and no route search.

On a route selection/calculation or local-day/offset change, that hook calls readiness
and then `field.sweep(edges, [oneHour])` once per animation frame. The schedule is
**06:00 through 20:00 inclusive: 15 calls**, from
[`bestTime.ts:34–48`](../../app/lib/bestTime.ts#L34). It samples the selected route's
consecutive coordinate pairs, not all street edges. Chosen-side/distance weighting
happens in the hook. A restarted effect cancels remaining frames; the current readiness
call itself has no abort/deadline. The current `sweep` reuses preparation within its
supplied times but still recomputes shadow answers
([ShadowField.ts:1081–1110](../../app/lib/shadowField/ShadowField.ts#L1081)); the UI passes
only one time per call.

[MEASURED] A standalone browser harness mounted the **real** timeline and both time/exposure
hooks with a resident legacy field and the measured 10-edge selected route. One 60-movement
drag produced **58 date commits**, **20.69 commits/s** between first/last commit, and
**zero shadow calls**. A 2.1 s playback observation produced **42 commits**, **20.06/s**,
and zero calls. A day change produced exactly **15 sweeps**, over **220.6 ms** from first
to last call. These are observed script/device rates, not a browser-independent cadence.
The code's 30/50 ms gates, not this input generator's speed, define the requirement.

### 1.2 Route calculation and actual volumes

[CODE] Normal calculation overlaps graph fetch with broad readiness, enumerates unique
canonical edges, awaits exact-cell readiness with the **same absolute deadline**, then
samples the entire batch once
([useNavigation.ts:1119–1162](../../app/hooks/useNavigation.ts#L1119),
[1230](../../app/hooks/useNavigation.ts#L1230)). Readiness has **2500 ms total**, not
2500 ms per source. Per-edge fallback and cache population follow; progress yields every
100 edges occur **after the synchronous field call**. Then the caller creates parallel
sidewalk weights and searches them
([1290–1358](../../app/hooks/useNavigation.ts#L1290)). Pareto/Dijkstra relaxation does
not invoke the shadow engine. Sketch calculation also samples the returned graph once,
then averages the two sides
([722–749](../../app/hooks/useNavigation.ts#L722), [802](../../app/hooks/useNavigation.ts#L802)).
Transit/multiple route alternatives consume graph weights; they do not multiply the
field-query count by the number of search relaxations.

[CODE] Recalculating at another time can reuse the graph/source caches, but reruns shadow
sampling, weights, search, and chosen-path statistics. Merely changing the clock does
none of those. The current caller reads the mutable date ref at several stages; it does
not freeze one timestamp throughout the async calculation. V2 must freeze it explicitly.

[MEASURED] Two volumes must not be conflated:

| Input | Unique edges | Inclusive sidewalk locations | Selected path |
|---|---:|---:|---|
| Current full-app keyless Manhattan fixture, 123 nodes / 440 directed entries | 220 | 1,760, as measured in 01 | 10 coordinate-pair edges in this run |
| 02a's captured Madrid graph, explicitly smaller bbox | 908 | 7,314 | 280.649264 m / 20 nodes |
| **Current production padding for that same Madrid walk**, new live graph capture | **4,039** | **32,612** | Same 280.649264 m / 20 nodes; **19 edges / 152 locations** |

The last request applies
[`useNavigation.ts:1104–1116`](../../app/hooks/useNavigation.ts#L1104): minimum **0.005°**
padding gives `(south,west,north,east) =
(40.410402,-3.7125,40.4223,-3.701459)`. Production `fetchRoutingGraph` returned 3,560 nodes.
The graph was fetched once at about **15:29 UTC**; graph transport + parsing took
**2339.23 ms**, n=1, without field readiness. The sample formula remains
`2 * (max(3, ceil(lengthM/25)) + 1)` per edge, not five probes per sidewalk location.
Neither 908 nor 4,039 is a hard maximum; graph size depends on bbox, road density,
way geometry, and stops. Using 908 as the universal current workload would under-size this
specific route by over fourfold.

### 1.3 Distinct event table — the requirement set

Payloads below are UTF-8 JSON body bytes measured by serialization, **not existing shadow
HTTP traffic**: there is no shadow-query endpoint today. They allow placement comparisons.
Headers/TLS overhead are additional. JSON `Date` values are ISO strings. A compact binary
contract can reduce these sizes without rounding geographic coordinates. The small spot
envelope is explicitly padded to 80/128 bytes for transport testing.

| Event | Frequency / query work | Request → response body | Observed current latency and derived requirement |
|---|---|---|---|
| Timeline drag/inertia within day | Up to 33⅓ ordinary date callbacks/s plus final flush; **0 edges** | A local timestamp/solar inputs; **0 query HTTP bytes** | Harness: 58 commits / 0 queries. Preserve local feedback on the 30 ms update path. No route-query budget is consumed. |
| Time playback within day | 20 date ticks/s; **0 edges** | Same as drag | Harness: 42 commits / 0 queries. A 50 ms cadence is not a 2500 ms allowance. |
| Render of changed date/camera | Map frame scheduling; receiver pixels, not graph edges | Resident field pages + small uniforms; no result image over network | 01: current PR combined 1280×900 SwiftShader GPU **145.086 ms median / 194.297 worst**, 20 samples; CPU submission 4.2/5.7 ms. That misses either clock cadence on that software renderer. Full-screen v2/hardware/mobile latency **[UNMEASURED]**. |
| Normal route calculation/recalculation | Once per user calculation; one graph batch, regardless of route alternatives | Fixture 220: **11,218 → 28,764 B**. Current Madrid 4,039: **248,732 → 531,477 B** | Full-app fixture: first field call **13.9 ms**; 10 retained warm calls **6.4 median / 9.0 worst**. Complete warm pipeline **971.3 median / 990.4 worst ms**, including failed-source readiness waits. Real Madrid legacy kernel in Node: **120.96 median / 178.19 worst ms**, 20 retained calls, sources resident. |
| Sketch calculation | One batch over graph in sketch bbox; variable E | Same per-edge shape/scaling as normal route | Dedicated sketch end-to-end **[UNMEASURED]**; same 2500 ms shared readiness code. No frame-rate requirement. |
| Selected-route/day exposure rebuild | 15 hourly calls, one per rAF, after readiness; 10 fixture / 19 real route edges | Fixture one hour: **534 → 1,433 B** for the observed first hourly result. Real 19-edge **whole day: 1,592 → 36,472 B** | Full-app fixture: 150 warm hourly calls **0.4 median / 0.6 p95 / 0.8 worst ms**. Hook day span 220.6 ms. Separate resident real-route 15-time Node sweep **35.85 ms**, n=1. May stream/progress/cancel; do not make 15 sequential WAN round trips mandatory. |
| Day playback / date scrub | Up to 20 day changes/s in play; each requests a replacement day series | Same selected-route batch, **not 15 × whole graph** | A 15-rAF sweep cannot finish every 50 ms at a 60 Hz display: ≥14 frame intervals before its last sample. Existing cancellation makes those budgets **incompatible** if every intermediate day must complete. Coalesce obsolete day jobs; complete the settled day. |
| Spot query | On-demand, five neighborhood locations; no periodic frequency | Representative **80 → 128 B** | Resident `ShadowField.shadowAt` browser probe: below 0.1 ms median timer resolution, 0.1 ms worst, n=30. **This interface is not the current assistant call path**: `check_shadow` first uses adapter `queryPointShadow`, then offscreen building acquisition ([tools.ts:394–424](../../app/lib/agent/tools.ts#L394)); that path's end-to-end latency is **[UNMEASURED]**. Consolidate onto the shared model in v2. |
| New acquisition domain: route, pan, lower sun, new azimuth/day | Only when necessary pages/bounds are missing; request count follows §7's planner | Current Madrid CHM read: **5 × 65,536 = 327,680 B** response bodies; canonical uncompressed tile **1,572,864 B** | This session real COG fresh stores: **1712.93 / 912.60 / 861.46 ms**, n=3; same-store repeat ≤0.70 ms. New-time coverage may be pending; downloading all missing data cannot inherit a 30 ms promise. |
| Accumulation/export | Explicit cancellable job, grid × selected times | Numeric grid output; size depends on grid/bands | Current local `setSunExposure` is a no-op ([line 355](../../app/lib/shadow/LocalShadowAdapter.ts#L355)); there is no measured current accumulation compute latency. 02's numeric accumulation remains new work, outside the interactive query cadence. |

[CODE] The whole-route **<3000 ms typical / <500 ms cache-hit** figures are *targets* in
[`metrics.ts:55–59`](../../app/lib/metrics.ts#L55), not enforced query ceilings. The
2500 ms readiness deadline does not bound Overpass's independent 30 s timeout or search.
Our fixture's warm 971 ms total exceeds the 500 ms target; its `graphFetch` metric includes
about 917 ms of readiness/failure handling even with a cached/mock graph. The query
itself is not responsible for that entire delay. Do not convert these targets into
claimed observed success.

**[DESIGN] Budget consequence:** local rendering/time feedback and background route jobs
are separate lanes. A backend is admissible for a batched route/day job; the repo does
not require thousands of remote queries per drag or per search. New async work must have
cancellation, a pinned generation/time, and latest-request publication. No numeric
frame guarantee or universal graph maximum is invented here.

## 2. Network measured from this machine

### 2.1 Endpoints, deployment, and method

[MEASURED] Intel Core i7-12700H, 20 logical CPUs, WSL2 Linux
`6.18.33.2-microsoft-standard-WSL2`; Node 20.20.1; Chromium 153.0.8010.12.
Full-app route instrumentation used headed WSLg with
`ANGLE / D3D12 / Intel Iris Xe`; the standalone hooks/worker test used headless Chromium
and does not claim GPU timing. No CPU/network throttling. Network clients used Python
`requests`, HTTP/1.1 keep-alive and default verified TLS, with no application retry.
Warm sessions specified `Accept-Encoding: identity`. Fresh GET sessions retained
Requests' default encoding negotiation; lengths were checked after its body decoding,
so those controls do not establish identical compressed wire bytes. Host IP/precise location are not needed in the reproduction record.

- **Cloudflare edge:** `https://speed.cloudflare.com/__down?bytes=N`, plus a disposable
  **deployed echo Worker through the public Playground**. The echo drains exactly the
  proposed request-body size and returns exactly N bytes. It has no application I/O.
  Its preview path includes the Playground proxy/session Durable Object and preview
  runtime, so it is **not a bare production Worker deployment**. Observed POP headers
  included DFW/IAH. The public Playground is a
  [documented preview facility](https://developers.cloudflare.com/workers/playground/);
  upload/forwarding mechanics were checked against its
  [first-party source](https://github.com/cloudflare/workers-sdk/tree/main/packages/playground-preview-worker).
- **Vercel edge:** the incumbent's immutable deployed asset
  [`maplibre-DSTxhMSf.js`](https://shademapnav.vercel.app/assets/maplibre-DSTxhMSf.js),
  using exact HTTP Range lengths. Responses were `206`, `X-Vercel-Cache: HIT`, with
  `cle1` edge identifiers. The 1.5 MiB case uses **two sequential ranges**, because that
  asset is only 954,465 bytes. It is a measured two-request transaction, not a
  single-object 1.5 MiB CDN measurement. Static assets reject POST with 405; these runs
  match **response** sizes, not request uploads.
- **One origin region:** direct **Amazon S3 `us-west-2`**, a public
  [Sentinel COG B02 object](https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/15/T/WG/2024/6/S2A_15TWG_20240606_0_L2A/B02.tif).
  Exact ranges, `206`, `Server: AmazonS3`, no CDN hostname. This is an origin-object
  service, **not Fly/container application execution**; GETs omit hypothetical query
  uploads and compute. Source imagery is used only as a byte-size transport target.

A stored Vercel CLI token was present, but read-only `/v2/user` and `/v9/projects` checks
returned **403 `invalidToken: true`**. No usable Cloudflare/R2 or Fly credentials were
available. No Vercel or origin container deployment was possible. The Cloudflare Playground
accepted the trivial endpoint without an account, so that endpoint was actually deployed.
The existing Vercel function's invalid-input path was additionally sampled below.
No incumbent deployment or project settings were changed.

[MEASURED] **200 attempts per warm host/payload condition**, one untimed-in-table first
request retained separately; sequential requests within each host, hosts measured in
separate passes. Timing is `perf_counter()` immediately before request through complete
response-body consumption, including upload where supported. “Warm” means connection
reuse and pre-existing/public asset state, not a controlled production cache guarantee.
Fresh-connection measurements have 50 samples, creating a session each time; DNS/TLS
system state is not flushed. Quantiles are nearest rank: `sorted[ceil(p*n)-1]`.

The initial four-host matrix had 4,000 warm attempts; the larger graph/day supplement
had 1,200; a final three-host fixture220 supplement added 600. These are single-machine,
single-day samples. At n=200, p99 is supported by
only the top few observations and is **not** a stable fleet/mobile SLO. Success-conditioned
tails and error counts are both reported; failed replies never count as fast successful
answers. Other probes produced small background traffic during parts of the run; there
was no artificial bandwidth shaping or geographic replication.

### 2.2 Results

[MEASURED] Milliseconds, **p50 / p95 / p99**. Each cell uses 200 successful samples unless
qualified. The echo Worker includes uploads; the Vercel/S3 columns do not. No compute
latency is subtracted or added to these transport measurements.

| Payload | Echo upload → response | Cloudflare echo preview | Vercel cached GET | S3 us-west-2 GET |
|---|---:|---:|---:|---:|
| point | 80 → 128 B | 46.96 / 58.13 / 67.89 | 51.45 / 61.22 / 75.64 | 102.78 / 113.77 / 123.00 |
| hour | 534 → 1,433 B | 48.65 / 57.11 / 64.88 | 51.53 / 60.88 / 69.96 | 104.27 / 117.11 / 139.35 |
| graph220 | 11,218 → 28,764 B | 56.43 / 86.03 / 108.90 | 58.68 / 132.56 / 145.47 | 104.84 / 116.13 / 379.44 |
| graph908 | 55,918 → 113,516 B | 69.59 / 93.59 / 109.87 (199 successes; 1 error) | 57.61 / 69.69 / 74.69 | 110.56 / 120.23 / 153.35 |
| graph4039 | 248,732 → 531,477 B | 170.95 / 332.41 / 340.34 | 81.29 / 107.62 / 128.03 | 129.43 / 206.56 / 245.39 |
| day19 | 1,592 → 36,472 B | 51.62 / 81.04 / 96.90 | 54.03 / 69.98 / 116.12 | 103.56 / 130.76 / 186.89 |
| cog-block | 0 → 65,536 B | 59.99 / 76.35 / 136.09 | 55.92 / 67.67 / 110.98 | 104.88 / 117.77 / 136.63 |
| canonical-tile | 0 → 1,572,864 B | 134.41 / 315.75 / 341.11 | 188.62 / 340.13 / 399.31 | 175.37 / 507.23 / 832.48 |

[MEASURED] The separate Cloudflare speed endpoint gave **52.32/87.82/106.69 ms** for
128 B, **52.13/68.92/100.64** for 1,433 B, **62.28/87.68/103.52** for 113,516 B,
and **58.67/74.75/123.90** for 64 KiB. Each has 200 successes. At 1.5 MiB it returned
**170 HTTP 429s in 200 attempts**, after 30 successes. Those successful transfers had
134.82 ms median / 351.00 ms maximum; **no meaningful p95/p99 for that condition is
claimed**. This disqualifies that public speed endpoint as a large-payload service/SLO
proxy, not Cloudflare's CDN product. The echo graph908 run had one 429 (199 successes),
retained in the error count. The other completed echo conditions succeeded in all
200 attempts. A rerun should stop/back off when a rate limit appears; the recorded
initial script did not, and its failures are not concealed.

[MEASURED] Fresh TCP/TLS sessions, graph908 response size, n=50 per endpoint:

| Endpoint | p50 / p95 / p99 ms | Maximum ms |
|---|---:|---:|
| Cloudflare speed GET | 192.07 / 342.66 / 505.54 | 505.54 |
| Cloudflare echo with 55,918 B upload | 234.30 / 348.69 / 363.76 | 363.76 |
| Vercel cached Range GET | 231.32 / 283.71 / 432.89 | 432.89 |
| S3 us-west-2 Range GET | 463.39 / 506.32 / 549.24 | 549.24 |

These are **connection cold costs**, not measured function cold starts. At n=50 the
reported p99 is the maximum; it does not describe a rare-start distribution.

[MEASURED] A separate **200-request incumbent function** control called
`/api/nominatim?endpoint=umbra-placement-invalid`. The existing
[handler rejects this before any upstream call](../../api/nominatim.js#L40).
Every response was the expected **400 / 38 B**, `X-Vercel-Cache: MISS`, with
`cle1::iad1` identifiers: **84.36 / 111.20 / 117.66 ms**
p50/p95/p99, maximum **146.31 ms**. First connection/request **637.19 ms**, n=1,
is not an isolated function cold-start measurement. This proves a reachable regional
function path; it measures validation, not a matching-size shadow query or field hydration.

[DESIGN] The observed remote small-response medians already exceed the 30 ms drag cadence.
A remote rendered-mask pipeline would additionally compute, encode, transfer pixels,
and track camera state. Browser WebGL is the placement for render. **The same measurements
do not reject remote route queries:** the 4,039-edge batch has a different event budget,
and a warm batched backend remains plausible. Its complete deadline success rate,
especially on a cold field, was not measured by reading static assets.

## 3. Binding constraints, probed by candidate

### 3.1 Cloudflare Workers + R2

**CPU: distinguish one long ray from a whole long-ray batch.** 02a's 3,472 cells are
**one location's maximum**, not the total query. We reused its exact field, layout,
DDA, and 3° sun. A stress condition replaces every one of 7,314 sample locations by
that actual worst receiver: **25,394,208 visited cells**, derived and verified from
3,472 × 7,314. It is deliberately adversarial, not a second observed city route.
It includes only buildings/flat ground and no hierarchy, canopy, or terrain triangles.

[MEASURED] Local Node, 30 retained calls after five warmups; local workerd through
Miniflare 4.20260426.0 has a separate 30-call run. Times are milliseconds:

| Kernel condition | Node process CPU p50 / max | Node wall p50 / max | Local workerd request + response p50 / max |
|---|---:|---:|---:|
| Real 908-edge batch, 3° | 7.237 / 17.905 | 6.474 / 9.435 | 12.109 / 14.995 |
| Real 908-edge batch, 10° | 23.384 / 27.227 | 21.124 / 24.539 | Not rerun |
| All 7,314 locations take the 3,472-cell ray | 365.332 / 388.660 | 332.927 / 354.895 | 340.563 / 359.803 |

Node `process.cpuUsage` includes process threads/JIT/GC; it can exceed elapsed wall time.
It is **not Cloudflare billed CPU**. Local workerd times include Miniflare RPC and result
serialization; its empty handler median was 2.50 ms. Do not subtract that median and call
the remainder production CPU. A separately first-timed single long ray had 0.537 ms wall
median / 1.200 max, with JIT-heavy process CPU; it supplies no per-cell throughput law.

[MEASURED] We also deployed the **actual compact building field and marcher** to a second
Playground preview: 1,253,678-byte saved script/input bundle, gzip building band 394,095 bytes,
expanding to **39.088 MiB**, matching 02a. Twenty retained requests after five warmups:
real batch **62.62 ms median / 83.41 max RTT**; adversarial batch **357.70 / 485.60 ms**.
The first real request took **971.26 ms**, including decompression/initialization and
preview transport, n=1. All 50 requests succeeded and reported the same `initCount=1`.
This directly demonstrates warm field reuse in that preview. Worker `performance.now()`
reported **0** around the synchronous kernel because its clock did not advance there;
those zeros are **not** CPU measurements. No production account logs/billed-CPU telemetry
were available.

[DOCUMENTED] Workers Free allows **10 ms CPU/request**. Paid has **30 s default CPU**,
configurable up to **300 s**; waiting for I/O is not CPU. The **128 MB memory limit is per
isolate**, shared by concurrent requests. These are the applicable
[published limits](https://developers.cloudflare.com/workers/platform/limits/), not old
50 ms “edge function” folklore. **[DESIGN]** Free is unsuitable for the unaccelerated
route kernel without demonstrated smaller batches; Paid is not disqualified by this
measured workload's CPU cost. Terrain/hierarchy production cost and actual Free limit
enforcement remain unmeasured; the Playground does not select the user's plan.

**Memory is the more immediate constraint.** 02 §3.2's 2048² field is 96 MiB for one
six-band copy. That leaves only roughly 32 MiB below the advertised ceiling, before
runtime, hierarchy, decode, response buffers, and concurrent requests. Atomic replacement
by another dense generation needs 192 MiB before overhead. The measured Madrid rectangle
requires **234.529 MiB per six-band copy**, so it cannot be one resident production
Worker field. A local Node allocation/touch probe measured RSS **127.50 → 354.46 MiB**
while adding its 234.529 MiB six-band payload; GC changes the exact delta. RSS is not
identical to Workers accounting, but it exposes omitted process costs.

[MEASURED CONTRADICTION / LIMIT] Both local Miniflare **and a real Playground preview**
accepted single requests allocating/touching 96, 192, and 235 MiB in six arrays. Each
returned its expected byte count. Therefore neither environment reproduced production
128 MB rejection. **The published product contract governs admission**, not this permissive
preview result. Do not cite the preview as proof that a Paid production Worker can hold
a 235 MiB field. Tiled bounded residency can make Workers viable; sharding a ray across
multiple objects introduces distributed traversal/state costs that were not measured.

**R2 COG ranges: yes at the API/reader boundary; deployed latency remains open.** The
[R2 binding](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
accepts `get(key, {range: {offset, length}})` and supplies the returned range metadata.
The existing reader's [64 KiB block/100-block cache](../../app/lib/canopyRaster/cogTileSource.ts#L64)
was exercised against the live 84,604,237-byte Madrid COG and a local R2 binding. We
retained the five fetched blocks at their original offsets in a sparse COG-shaped file,
then had the **unchanged COG source/store** read it through a Worker range response.
Three fresh-store runs per path decoded the same **771×441 canopy bytes**, SHA-256
`234791724ab648c13927f33274ffcceeb2a0d25f22802b95fa19a60a8d238e24`.

| Acquisition path | Fresh-store wall times, ms | Requests / body bytes per read |
|---|---|---|
| Live `data.source.coop`, Node reader | 1712.93; 912.60; 861.46 | 5 × 206 / 327,680 |
| Same reader → local Worker → emulated R2 ranges | 123.35; 110.45; 113.63 | 5 × 206 / 327,680 |

The second row proves range/IFD/mask compatibility for that window; it is **not network R2
performance**. Unrecorded offsets in the sparse file are zero and it must never be treated
as a complete COG. The five ranges start at 0, 65,536, 15,073,280, 15,138,816, and
16,449,536. Metadata precedes dependent data reads; concurrency does not remove those
round trips. §7 may discover many COGs: five requests for one area is not a universal
acquisition count. A source-wide height-bound manifest remains necessary; range support
alone cannot discover certified maxima of unseen terrain/building/canopy data.

**Cross-request field retention is possible; permanent RAM retention is not promised.**
A local Durable Object loaded the 39.088 MiB field from R2 on first access, reused the
same array/generation on the next call, and reloaded persisted bytes into a new generation
after runtime restart. Cache API retained a serialized 1.5 MiB response across the restart.
Those are storage/rehydration witnesses, not deployment hit-rate measurements. Durable
Objects can retain instance state between active requests, but
[hibernation/restarts discard memory](https://developers.cloudflare.com/durable-objects/concepts/durable-object-lifecycle/);
Durable Objects also have their own
[128 MB memory constraint](https://developers.cloudflare.com/durable-objects/platform/limits/).
Persist canonical artifacts and reconstruct indices; do not promise an immortal in-memory
route field or replicate its full bytes into every invocation.

[MEASURED + DOCUMENTED] Cache API rejected `cache.put(...206...)` in workerd. Store a
canonical tile or a versioned range block as its **own 200 response**, with key containing
object revision and byte interval, or cache a whole suitable object and use Range matching.
The [Cache API](https://developers.cloudflare.com/workers/runtime-apis/cache/) is local
to a data center, not globally replicated or durable; Playground cache operations have
no effect. A cache hit avoids recomposition, but still requires deserialization/page
admission. R2 persists the artifact; neither Cache API nor a DO fixes a missing artifact.
For public production tile delivery, use an
[R2 custom domain with caching](https://developers.cloudflare.com/r2/buckets/public-buckets/),
not the rate-limited development `r2.dev` URL. CORS must permit GET/HEAD and single-range
reads and expose necessary range/ETag metadata; validate that configuration on deployment.

**Verdict:** good object/CDN host and optional lightweight tile gateway. Paid Workers can
serve bounded route jobs over admitted pages; Free CPU and one-isolate dense memory are
binding problems. **Do not make Workers + DO sharding the initial normalization/composition
or sole query authority** merely because the network entry point is near the user.

### 3.2 Vercel Functions (incumbent)

[DOCUMENTED] Evaluate Node/Fluid Functions, not an assumed 128 MB V8 edge isolate.
Published [function limits](https://vercel.com/docs/functions/limitations) give **2 GB /
1 vCPU on Hobby**, up to **4 GB / 2 vCPU on Pro**, **4.5 MB request/response bodies**,
and durations much longer than the app budget. Functions run in a configured origin
region, `iad1` by default; a CDN POP identifier does not identify the function's execution
region. The measured 248,732/531,477-byte route payloads and one 1.5 MiB tile fit the body
limit. Returning a dense 96 MiB field as one function body does not.

[MEASURED / LIMIT] Node's six-band allocation and current 4,039-edge query ran locally;
those memory/CPU footprints are plausible within a 2 GB process. The invalid-input
incumbent function measurement establishes reachable execution, not shadow-query cost.
The failed token prevented deploying the real field there. Vercel cold-start distribution,
warm-instance field retention rate, regional COG fetches, concurrency/CPU contention,
and a native GDAL packaging path are **[UNMEASURED]**. Published maxima cannot certify
<500 ms or <2500 ms behavior.

**Binding issue:** memory is materially less restrictive than Workers, but a fresh function
still needs immutable artifacts and bounded decode; CDN warmth is not process-array
warmth. Per-request source composition repeats up to the roughly 918 ms building
rasterization seen in 02a before adding network/datum/canopy work. Persisted tiles avoid
that repetition. A 4.5 MB body ceiling requires tile-level streaming/direct object fetches
instead of field-sized JSON/binary responses.

**Verdict:** feasible remote **batched route/day query** alternative, and a convenient thin
artifact/job proxy if needed. Not selected for source-wide preprocessing or required
interactive queries: no measured latency advantage over local worker queries, and
cold-field recovery/offline behavior would require the same static artifact design.
Vercel can continue hosting the application regardless of where tile artifacts live.

### 3.3 Persistent container — Fly.io Machine, concrete configuration

[DESIGN] A single **Fly `performance-1x`, 2 GB** Machine running a bounded job queue is the
concrete preparation candidate. Region is chosen near the selected source/object origin
when Phase 3 settles those sources; the measured S3 us-west-2 service is not a claim that
Fly `sea` has that RTT. Keep one active preparation process; write artifacts durably to
object storage. Multiple immutable city snapshots can be paged rather than fused into
an unbounded process cache. A restart reopens those artifacts, not a dependency on a
specific user's browser memory.

[MEASURED / LIMIT] No Fly token was available. Local Docker access returned permission
denied on its socket, so the preparation/query probes ran as local Node processes, **not
in a deployed or local Fly-equivalent container**. The 234.529 MiB allocation produced
354.46 MiB RSS including the already loaded compact field/runtime; it demonstrates room
for this finite preparation case below 2 GB, not peak GDAL/concurrent-job memory.
Node current real-route query, COG decode, canonical composition, and compression were
executed; server initialization/restarts/production queuing latency remain unmeasured.

The binding candidate distinction is **sustained CPU**, not the word “persistent.”
Fly documents [CPU quotas/burst credits for shared CPUs](https://fly.io/docs/machines/cpu-performance/).
A cheap `shared-cpu-1x` cannot inherit this laptop's sustained preprocessing throughput.
Use a performance CPU for the initial sizing comparison; bound concurrency and page
residency. A single process eliminates repeated cold composition within its lifetime,
but is a single preparation failure domain. Two replicas add cost and coordination;
they are not needed to keep already published tiles queryable.

**Verdict:** selected for **normalization and tile composition**, outside the clock/route
critical path. Server route queries remain a viable overflow/offline-export hybrid,
not a required initial dependency. Time-critical use would need measured on-host queue,
initialization, and full-query tails before activation.

### 3.4 Precomputed static canonical tiles + CDN + client query

The potential disqualifier is **download/residency**, not server CPU. A z17 tile is
1.5 MiB uncompressed; 64 tiles are 96 MiB per copy. Cheap static serving does not make an
uncached sunward working set fit a 30 ms frame or a 2500 ms readiness interval.
Measured 1.5 MiB echo/Range transactions have substantial tails (§2), and production
compression for terrain/evidence-rich data is unknown.

[MEASURED] A throwaway compositor used the live CHM window plus the captured Madrid
building band, on an explicitly **flat G=0 analytic fixture**. It resampled onto the z17
tile containing `[-3.7038,40.4168]`, applied crown-base/roof clipping, and emitted six
32-bit bands. Twenty retained tile compositions: **1.619 ms median / 8.060 worst**;
1,572,864 bytes. Gzip round-trip was byte-identical: **8,709 bytes** for this particularly
sparse/flat tile, encode **4.538/5.601 ms**, decode **1.474/3.387 ms** median/worst,
n=20. This **does not** measure terrain normalization, prove EGM96, generate a source-wide
bounds hierarchy, or establish a real-world compression ratio. Do not budget every tile
as 8.7 KB. 02a's real-building whole-rectangle rasterization was **917.955 ms**, n=1;
that includes a different and much larger operation than this tile loop.

[DESIGN] Publish versioned **height/material/evidence tiles and conservative bounds**, not
shadows at sampled hours. Time then does not invalidate the tile artifact, and arbitrary
sun/date/canopy transmission can still be evaluated. Precompute supported regions and
newly requested coverage, not the world. A 404 or incomplete source manifest means missing
evidence, not empty space. Store full feature normalization/foundations before clipping,
so both sides of a tile boundary share the same roof and model recipe.

**Verdict:** selected delivery path. It removes raw COG IFD chains, source datum reconciliation,
building deduplication, and main-thread publication of authoritative arrays from the
ordinary browser path. The remaining per-client work is bounds planning, fetch/decompress,
query, and upload. This materially simplifies 02; it does not remove §7's offscreen-caster
proof, source coverage obligations, or the canonical field's memory arithmetic.

### 3.5 Full client path from 02; useful hybrids

[MEASURED] Raw client/source acquisition retains the live COG costs above and 01's browser
872.6–1971.0 ms fresh-store reads. Repeated preparation also retains 02a's ~918 ms
building-only rasterization. Running the 908-edge kernel in a **browser worker** against
resident arrays gave, n=30 after five warmups:

| Operation | Worker round trip p50 / p95 / max ms | Evidence |
|---|---:|---|
| Actual 908-edge 3° batch | **7.6 / 8.3 / 8.7** | Kernel median 6.4 ms; result allocation/serialization included in RTT |
| All 7,314 locations use the 3,472-cell receiver | **345.7 / 361.2 / 362.4** | Main-thread 10 ms heartbeat ran 1,213 times during all 35 calls |
| Construct + transfer one 1.5 MiB tile buffer | **0.9 / 2.4 / 3.8** | Transferable ownership; not a WebGL upload measurement |

Initialization loaded the 39.088 MiB band from localhost and prepared its layout in
**280.6 ms**, n=1; that is not WAN or phone startup. The worker kernel is the same
02a DDA, not a new GPU/CPU model. Its adversarial job still takes hundreds of ms; moving
it off-thread preserves UI scheduling but does not make it fast. Production code needs
bounded chunks/cancellation and must not let old jobs monopolize the worker until every
obsolete day has completed. Normalized precomposed pages avoid rerasterization; exact
result caches include generation, receivers, UTC times, and material/solar model versions.

[DESIGN] Full raw-source client composition remains an explicitly incomplete-capable
fallback, **not the required path**. It duplicates source work on every device and
cannot derive unseen-caster bounds from the loaded neighborhood. Normalized-source worker
composition is the preferred fallback when a canonical tile has not yet been published.
It must reproduce the server recipe; if the required datum/bounds/source metadata is
absent, it cannot certify complete coverage.

| Hybrid | Verdict |
|---|---|
| Persistent preparation → R2/custom-domain CDN → browser worker query → WebGL render | **Adopt**. Shared immutable artifact identity; no backend query for each drag or resident route batch. |
| Vercel/Workers remote route + client render of identical versioned tiles | Feasible; network budget differs from render. Defer as optional large-route overflow pending full deployed measurements. It can remove route-only CPU page residency, but renderer still downloads caster pages. Returned generation and completeness must match the client artifact recipe. |
| Remote whole-day batch → locally retained hourly series | Feasible alternative. One batch amortizes RTT; 15 sequential remote hour requests are unnecessary. No minute interpolation or automatic route-card update is implied. |
| GPU query + async readback, client | Now permitted by the amendment, but not selected as routing authority. 02a hardware query/readback wall was 2.720–5.385 ms median, slower than its GPU interval and coupled to context/renderer contention. Keep CPU-worker query for context-loss/offscreen/offline independence. Optional GPU acceleration must implement the same contract. |
| Precompute a time-specific shadow atlas or opaque horizons for every receiver | Not selected. 02a's one-azimuth horizon does not cover changing azimuth/elevated transmissive canopy; dense horizon memory remains 576 MiB for 72 bins at 2048² before duplication. |

## 4. Stage placements, lifetime, and failure behavior

| Stage | Placement and trigger | Measured evidence that determines the choice | On failure / offline |
|---|---|---|---|
| **Source normalization** | Server job on persistent container, on source/recipe changes. Full-feature foundation, datum/resampling declarations, deduplication, validity, and conservative regional bounds precede tile clipping. | Live dependent COG acquisition 861–1713 ms; 02a building raster preparation ~918 ms; local full-band process footprint 354.46 MiB. Repeating that pipeline is unsuitable for the clock path. Actual vertical transform/source-wide bounds generation **unmeasured** and remains Phase 3 validation. | Existing versioned artifacts keep working. New/changed coverage stays pending/unavailable; unknown datum is not assumed. No need to rerun normalization just to query a cached time. |
| **Tile composition** | Same server job, once per canonical tile recipe/revision, with regional precomputation and demand-driven background fill. Publish through CDN only after data/evidence/bounds validate. Worker composition from normalized inputs on a miss. | 1.5 MiB canonical tile composition/compression round-trip measured; bulk and source costs favor reuse. Exact-size CDN transfer tails measured. | Last valid complete generation remains usable and date-stamped. A recipe mismatch is unavailable, not silently mixed. Offline fallback can compose only already cached normalized inputs with sufficient evidence. |
| **Shadow query** | Dedicated **browser Web Worker**, array-authoritative snapshot resident there. One graph batch per calculation, one selected-route/day job per replacement day; spot queries join this service. Optional exact-result cache. | 7.6 ms median actual 908-edge worker RTT; 345.7 ms stress while UI heartbeat continues. Full current 4,039-edge legacy batch is 121 ms median even resident. WAN is admissible for background batches but adds transport/cold dependence. | Resident pages work without the preparation backend or GPU. Missing sunward pages produce explicit provisional/incomplete results; unsupported receiver terrain produces unsupported evidence. Worker failure rebuilds from cached tiles; no silent “sun” fallback. |
| **Render** | **In-browser WebGL2**, in MapLibre's context, integer mirror of the named field generation. Camera selects receivers; solar uniforms trigger evaluation. | WAN medians exceed clock cadence even before image generation. 01's measured copy/fill cost motivates fewer FBO copies; 02a verifies a fast hardware interval kernel but is not full-screen performance. | GPU context loss loses the mirror; worker routing remains available. Reupload from cached canonical tiles on recovery. Missing visible/caster pages remain pending/incomplete. |

[DESIGN] Keep the two main ownership copies, **worker CPU + GPU**, not main CPU + worker
CPU + GPU. Transfer compressed inputs to the worker; provide transient transferable page
buffers for GPU upload, then release/return the staging buffers. A view may need only a
subset of the worker's pages, but that subset includes its **offscreen casters**. Browser
worker placement therefore **does not halve** 02's basic 192 MiB for an identical dense
CPU/GPU area. It removes main-thread query work and mandatory third copies.

For comparison, remote-only route query can eliminate the **route-only** CPU working set
on the phone. It does not eliminate the render GPU set, tile decoding/staging, or any
CPU fallback retained for offline use. Full-client source composition adds compressed
COG caches, decoded patches, normalized features, and composition buffers to 02's 192 MiB.
The current canopy store alone defaults to **64 MiB**, with up to eight opened source
handles ([canopyTileStore.ts:95–107](../../app/lib/canopyRaster/canopyTileStore.ts#L95));
source byte caches are additional. Static canonical tiles remove those raw-source caches
from the usual path. Gutters, hierarchy, materials, metadata, generation overlap, and
driver overhead still count. Admit/pin a bounded page set and report incomplete coverage
when it cannot fit; finer grids multiply geographic-area memory by four per zoom level.

**Acquisition remains geographic and sun-dependent.** Move 02 §7's bounds generation to
normalization and distribute its versioned index beside tiles. The browser planner uses
receiver corridors, times, and conservative terrain/building/canopy bounds to choose
pages; lowering the sun can fetch more of *all three* components. A complete canonical
tile is not proof that the sunward domain is complete. Keep sparse corridors, per-component
coverage, datum identity, the common deadline, route leases, and cancellation. No fixed
400 m halo, loaded-field maximum, elapsed deadline, or cache hit certifies an unseen ridge.
Missing static coverage may start a background composition job, but the current query
returns provisional evidence within its own budget.

**Offline is conditional, not a blanket feature claim.** A loaded/cached canonical
region plus bound metadata can answer new dates whose complete caster domains fit the
stored coverage. A new location or low-sun expansion cannot. The current
[`public/sw.js`](../../public/sw.js) caches same-origin GET shell/assets, excludes API
calls, and ignores cross-origin sources; it does **not** prepackage R2 tiles or a walking
graph. Route planning offline additionally needs the app, graph, basemap/assets, canonical
tiles, and bounds explicitly persisted. The chosen placement enables that package;
it is not already implemented. Show saved route/calculation timestamps and coverage
rather than presenting a stale percentage as a new-time measurement.

## 5. Cost at a stated usage assumption

[ASSUMPTION / DERIVED] Compare **100,000 sessions/month**, two route calculations and two
whole-day jobs/session, **400,000 batched query requests** if remote. Budget CPU at
**200 ms/route** and **40 ms/day job**, deliberately scenario allowances informed by the
local 121 ms route and 35.85 ms day measurement, **not cloud benchmarks**. This is
**48,000 CPU seconds = 13⅓ CPU hours**. For function memory, assume 2 GB allocated and
**0.5 s lifetime/request**, giving **111.11 GB-hours**, no concurrency-sharing discount.
Queries reuse composed data; request-time source composition is excluded and would add cost.

For artifacts assume **100 GB stored**, **10 GB newly written/month**, **20 MiB delivered
per session**, and **40 canonical object reads/session**. That is **2,097.152 GB/month**
delivered, four million reads; allow one million additional bounds/source/cache reads.
Use 100,000 object writes/month. These byte/storage counts are planning assumptions:
the flat tile's unusually small gzip result is not used to forecast coverage. Compare
marginal shadow infrastructure; the existing app, provider licences, taxes, monitoring,
and operator time are excluded. Dollar arithmetic uses decimal GB, not GiB.

| Candidate/path | Monthly scenario cost, before unrelated usage/credits | Important qualification |
|---|---|---|
| **Selected: static R2/CDN + client queries + Fly preparation** | R2 storage **$1.35** after 10 GB free; five million reads and 100k writes fit stated free allowances. One 2 GB performance Machine **$32.19/30 days** + 10 GB scratch volume **$1.50** + 10 GB public upload at $0.02/GB **$0.20**. **About $35.24/month**. | No request-time query CPU charge. This keeps the preparation Machine running; batch-only scheduled uptime could cost less. Source ingest egress/licensing and a second replica are additional. |
| Workers Paid + R2 remote batches | **$5.36 Workers + $1.35 R2 = $6.71** for query/artifact serving, **plus preparation**. Adding the same $33.89 preparation allowance gives **$40.60/month**. | 48 million CPU-ms less 30m included leaves 18m × $0.02/million. 400k requests fit 10m included. No DO duration/storage charge is included; a DO-dependent design costs more. Page admission still required. |
| Vercel Node/Fluid remote batches + R2 artifacts | CPU **$1.707**, memory **$1.178**, invocations **$0.240** = **$3.125**. Reserve **$9.819** for origin transfer: **$12.944 usage**. With one-seat Pro **$20**, preparation $33.89 and R2 $1.35: **$68.18 before usage credit; $55.24 if the $20 credit is otherwise unused**. | Assumes the included Flat Rate CDN tier for the 400k API calls; R2 serves tiles directly. Query body traffic is 50.065 GB inbound + 113.590 GB outbound. Incumbent plan, remaining credit and team capacity are unknown. Hobby's 4 CPU hours do not cover the compute scenario. |
| Persistent Fly remote queries + static R2 | Same **$35.24 base** if the same Machine can serve query and preparation load, plus **$2.27** for ~113.59 GB of query replies at $0.02/GB: **about $37.51**. | Average CPU demand is small, but bursts/queue contention are unmeasured. Dedicated second query Machine adds $32.19/30 days; no latency guarantee from the average. |
| Full raw client (02's preparation-heavy client path) | **$0 owned query compute**. If normalized sources/bounds are hosted in the assumed R2 footprint, **$1.35 serving**, plus the source-normalization pipeline. | Avoiding canonical storage does not eliminate normalization/bounds work, upstream transfer/licence cost, or user download/battery costs. Its different raw-byte footprint is unmeasured; it cannot honestly inherit the 20 MiB/session assumption as a measured figure. |

Published rate sources, checked this date: [R2 pricing](https://developers.cloudflare.com/r2/pricing/)
($0.015/GB-month; free storage/operation allowances; no internet egress),
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
($5 base, included requests/CPU and overages),
[Vercel Fluid regional pricing](https://vercel.com/docs/functions/usage-and-pricing/)
(Cleveland $0.128/CPU-hour, $0.0106/GB-hour, $0.60/million invocations),
[Vercel plan pricing](https://vercel.com/pricing),
[Vercel origin-transfer pricing](https://vercel.com/docs/manage-cdn-usage#fast-origin-transfer), and
[Fly compute/storage/network pricing](https://fly.io/docs/about/pricing/).
Vercel's **September 8, 2026** [Flat Rate CDN release](https://vercel.com/changelog/flat-rate-cdn-is-now-ga-for-pro-teams)
includes 1M requests / 1 TB on Pro; existing teams opt in. This scenario's API traffic
fits that tier before unrelated app usage. The [covered-resource list](https://vercel.com/docs/pricing/flat-rate-cdn)
does not include Fast Origin Transfer, so the calculation conservatively retains its
published $0.06/GB for request + response bodies (headers add a small amount).
It does not assume a tariff change or credit availability on the incumbent account.
Do not infer that bulk tile hosting qualifies for the same CDN tier; its eligibility
rules distinguish application responses from file distribution. Direct R2 avoids that
uncertainty for the assumed 2.1 TB tile traffic.

Fly's listed month is 30 days; operational budgets should calculate actual billed hours.
Artifact generation cost scales with changed coverage, source recipe revisions, and
precompute concurrency, not clock scrubbing. These are comparable scenarios, not quotes.

**Cold starts/failures:** Workers/Vercel have warm-instance opportunities and cold
rehydration paths; neither measured CDN hit times nor one preview initialization provide
p99 cold-start guarantees. A persistent Machine avoids scale-from-zero while running but
still has deployment/crash/startup and empty-cache cases. Static CDN serving has no shadow
compute cold start; cache misses still reach object storage. Client queries have download,
decode, worker/JIT, and GPU-upload starts. The selected design keeps preparation outages
away from already published coverage and permits cached offline queries; server-only
query placement cannot answer a new uncached query when unreachable.

## 6. Receiver semantics — decision session required, no option selected

[SETTLED EVIDENCE] 02a establishes a **semantic**, not precision, conflict. The unchanged
[reference painter](../../app/lib/shadowField/__tests__/agreement/harness.ts) excludes
receivers inside any building footprint (`onRoof`), producing unshaded roof coverage.
02 §6 instead starts a route receiver at ground + one quantum, inside an opaque solid,
so that receiver is fully shaded. The corpus includes diagonal edges through buildings.
At every z≥17, the interior-only lower bound already forces **mean ≥0.091724** versus
the committed **0.04** ceiling; refining the grid cannot solve it. None of the placement
probes changes this receiver rule or claims a candidate gate pass.

| Option for an explicit decision | Product/model consequence | Consequence for the committed gate |
|---|---|---|
| Retain legacy footprint exclusion for this receiver/query contract | Treat any ground-plan sample inside a footprint as excluded/unshaded, consistently in the relevant CPU/GPU ground-mask consumers. This is a compatibility convention, not a physical roof-light calculation; it can understate obstruction for routes through buildings. | Removes the proven semantic lower-bound mechanism without editing the reference. **Does not prove z17 or any lattice passes**: rerun the unchanged corpus and all ceilings after deciding. Define actual elevated roof/wall receivers separately. |
| Retain literal ground receiver / opaque-solid shade from 02 | An interior location is fully shaded; faithfully follows the specified solid-column model, but may reward invalid street geometry as shade. | The current candidate cannot pass the unchanged reference. Requires an explicit amendment to the reference/receiver contract and new versioned physical expectations; keeping the legacy gate as a separate regression is not the same as passing it with v2. No silent rebaseline or relaxed ceiling. |
| Move building-interior receivers onto their physical roof, `B + bias` | Evaluates a real elevated receiver, which can be shaded by taller structures or canopy. It changes the route receptor and is not equivalent to universally unshaded roofs. | May reduce some disagreement but **does not guarantee compatibility** with a reference that clears every footprint. Requires an explicitly chosen receiver contract and corresponding gates; cannot be sold as a numerical fix. |
| Reject/mark interior receivers as invalid, or constrain the walking graph to valid ground | Prevents bad graph geometry from benefiting from building interiors; requires rules for missing samples, route confidence, and normalization of averages. | Dropping/reweighting those samples changes the committed corpus contract. Current ceilings cannot be claimed satisfied by excluding cases. Preserve the legacy record and approve any additional validity/physical gate explicitly. |

**No option is selected here.** Decide receiver meaning, its CPU/GPU scope, and whether
amending the committed gate/reference is authorized in a decision session. Then rerun S1
before selecting a passing resolution or activating v2. Placement is independent of that
choice; recipe/result cache identities must include the eventual receiver/model version.

## 7. Required changes to 02 — recorded, not applied

1. **Opening, §1, §2, §7.3, §8, §10, §11:** remove the synchronous/main-thread design law,
   the prohibition on worker/future queries, and rejection of backend placement solely
   for being async. Retain camera independence and shared numeric semantics. Solar math
   may remain a synchronous pure kernel inside whichever consumer executes it.
2. **§2 query API:** expose cancellable async batch jobs, e.g.
   `sampleEdges(request): Promise<EdgeBatchResult>` and a cancellable day job with
   progressive results. Freeze `{generation, modelVersion, receiverVersion, edges,
   when/times, deadlineAt, requestId}` at submission; preserve ordered left/right output,
   inclusive counts and provenance. Do not copy/refetch edges on every clock tick.
   Keep pure synchronous trace helpers internal where useful. Caller awaits one result
   before weight construction/search; reject stale publication after cancellation.
3. **§2 / integration callers:** preserve the actual event distinction. Same-day scrub
   does not automatically recalculate route percentages. Day/selection changes rebuild
   the selected route's series; coalesce obsolete day jobs. Showing a current-time route
   percentage would be a new product behavior with its own query event, not an existing
   33 Hz whole-graph requirement. Replace mutable-ref reads with one calculation time.
4. **§3.2 ownership:** worker owns authoritative CPU pages; main thread holds transient
   upload buffers and result objects; WebGL owns the mirror. Account for 192 MiB base
   CPU/GPU duplication, not an unbudgeted third persistent copy. Add explicit resident
   admission, route pins, bounded staging and generation-overlap accounting. The larger
   4,039-edge graph joins device/performance validation; 02a's 908 is not the sole size.
5. **§4, §7.2, §9.1:** make server normalization/bounds plus server-composed static
   canonical tiles the default preparation path. Normalize entire building features
   before clipping. Add recipe/version manifests and background cache fill. Move raw
   COG decoding and source normalization out of the ordinary browser lifecycle; retain
   identical normalized-input worker composition only as a defined fallback.
6. **§7:** retain sunward component bounds and offscreen acquisition proofs. Add artifact
   availability, cache misses and jobs to readiness, sharing its absolute deadline across
   sources. Coalescing requests cannot label missing coverage complete. Put storage/page
   budgets at admission, and make traversal/watchdog exhaustion explicit incomplete
   evidence. No numeric global watchdog is established by a 3,472-cell sample maximum.
7. **§9.2–9.3:** keep WebGL rendering and matching numeric/building-mask outputs. Remove
   main-thread routing dependency; preserve context-loss-independent worker queries.
   Exposure integration is a separate cancellable job, potentially GPU/offline; the
   local no-op is not a validated performance baseline. No required server-rendered image.
8. **§9 alternatives/costs:** replace the global client/server verdict with the stage
   tables here. Paid Workers CPU is viable for bounded jobs; dense isolate memory,
   storage locality/rehydration, network tails, and disconnected operation are the
   relevant trade-offs. Vercel functions are not equivalent to a Vercel CDN hit.
9. **§6 / §10.1:** mark the receiver conflict as awaiting the explicit decision above.
   Keep committed ceilings/reference intact pending that decision. Do not claim a passing
   grid or activation based on placement benchmarks.
10. **§10 validation:** add production-host R2 range/CORS/revision tests, field rehydration,
    async cancellation/stale generation, worker context loss, page residency and offline
    package checks. Scope performance by event, device, source state, and graph volume;
    measure a complete terrain/canopy renderer and normalization pipeline before release.

**Stopping point:** all four stages have a chosen placement and measured, scoped evidence.
Remote route hybrids are evaluated on their actual batch budget, not ruled out by the
superseded constraint. Production capacity/coverage qualification and the receiver decision
remain explicit implementation/activation gates. No edit to 02 is made.

## 8. Reproduction record and embedded throwaway probes

The original probes wrote temporary code/data under `/tmp/umbra-02b`; the **durable
probes are embedded below**, with 02a's existing core/capture probes reused by reference rather than copied
again. No proprietary simulator code is used. Live OSM input is **© OpenStreetMap
contributors**, [ODbL](https://www.openstreetmap.org/copyright); a later capture may change
counts. The new road query, coordinates, date, sample counts, and hashes identify this run.
The real-route timing supplies finite captured buildings with known fixture coverage;
it is not a complete census, a terrain/canopy benchmark, or a real-world accuracy oracle.

Save each named code block below under `/tmp/umbra-02b` first. Setup uses the pinned
repository's installed dependencies; replace the absolute checkout path if needed.
The headed app probe requires a working display/Chromium installation; `LD_LIBRARY_PATH`
is this machine's browser-library fix, not an application dependency. Node scripts load
production TypeScript through Vite without editing it. No app build or test suite is
needed for this documentation-only change.

Run in this order:

```bash
mkdir -p /tmp/umbra-02b
test -e /tmp/umbra-02b/node_modules || ln -s /home/wslunusn/ShadeMapNavigation/node_modules /tmp/umbra-02b/node_modules
npm install --prefix /tmp/umbra-02b/tools miniflare@4.20260426.0 --no-audit --no-fund
# Save/reproduce 02a's core.mjs, capture.py, prepare.mjs if /tmp/umbra-02a is absent.
# Its input.json must match the hash below for the exact 908-edge replay.
node /tmp/umbra-02b/bootstrap.mjs
node /tmp/umbra-02b/prepare.mjs
node /tmp/umbra-02b/cpu.mjs
node /tmp/umbra-02b/runtime.mjs
node /tmp/umbra-02b/cog.mjs
node /tmp/umbra-02b/composition.mjs
# Full-app probe needs roads-fixture.json generated as shown below.
LD_LIBRARY_PATH=/home/wslunusn/miniconda3/lib node /tmp/umbra-02b/app-probe.mjs
LD_LIBRARY_PATH=/home/wslunusn/miniconda3/lib node /tmp/umbra-02b/browser.mjs
node /tmp/umbra-02b/real-route.mjs
node /tmp/umbra-02b/real-route-current.mjs
python3 /tmp/umbra-02b/deploy-preview.py
python3 /tmp/umbra-02b/network.py
python3 /tmp/umbra-02b/network-extra.py
python3 /tmp/umbra-02b/network-fixture.py
python3 /tmp/umbra-02b/vercel-function.py
python3 /tmp/umbra-02b/cloud-cpu.py
python3 /tmp/umbra-02b/cloud-memory.py
python3 /tmp/umbra-02b/summarize.py
```

The reproduction networking script below adds stop-on-429 and runs the primary endpoints
before the optional speed endpoint for future use; this session's
initial speed test continued and reported the failed attempts. A stopped/rate-limited
condition must be reported as incomplete and rescheduled, not silently topped up as though
one uninterrupted successful sample existed. Tokens returned by Playground are temporary
private files and must not be committed. Its previews are disposable and are not relied
on as permanent evidence URLs. Endpoints/asset names can change; verify status and byte
counts before interpreting a rerun. The cloud CPU driver reconstructs the deployed bundle
from the captured band instead of embedding its megabyte of base64. `real-route.mjs`
is retained as the original graph-capture probe; only its graph/fetch facts are used.
Its incomplete prism-set metadata was corrected in `real-route-current.mjs`, which
reuses the capture and supplies **all** reported real-route shadow timings/payloads.
The range utility now counts binary bytes before text decoding; its old text-length
diagnostic is not used as range evidence. The separate COG replay checks actual bytes.

<details>
<summary>bootstrap.mjs</summary>

```javascript
import fs from 'node:fs';
import {build} from '/home/wslunusn/ShadeMapNavigation/node_modules/esbuild/lib/main.js';
const p='/tmp/umbra-02b';
await build({entryPoints:['/home/wslunusn/ShadeMapNavigation/e2e/fixtures/overpassGrid.ts'],bundle:true,platform:'node',format:'esm',outfile:p+'/grid.mjs'});
const {overpassGridResponse}=await import('./grid.mjs');
fs.writeFileSync(p+'/roads-fixture.json',overpassGridResponse);
fs.writeFileSync(p+'/vercel-asset.txt','https://shademapnav.vercel.app/assets/maplibre-DSTxhMSf.js');
fs.writeFileSync(p+'/origin-url.txt','https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/15/T/WG/2024/6/S2A_15TWG_20240606_0_L2A/B02.tif');
```

</details>

<details>
<summary>prepare.mjs</summary>

```javascript
import fs from 'node:fs';import * as core from '/tmp/umbra-02a/core.mjs';
import {createServer} from '/home/wslunusn/ShadeMapNavigation/node_modules/vite/dist/node/index.js';
const root='/home/wslunusn/ShadeMapNavigation',v=await createServer({root,configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom'});
try{
const input=JSON.parse(fs.readFileSync('/tmp/umbra-02a/input.json')),field=await v.ssrLoadModule('/app/lib/shadowField/ShadowField.ts'),geo=await v.ssrLoadModule('/app/lib/shadowField/geometry.ts'),plan=core.layout(input.edges,17,{...field,...geo});
const f=core.rasterize(input.objects,17),sun={azimuth:-Math.PI/4,altitude:3*Math.PI/180},d=core.ray(sun);let worst=plan.points[0];for(const p of plan.points)if(core.trace(f,p,d).cells>core.trace(f,worst,d).cells)worst=p;
fs.writeFileSync('/tmp/umbra-02b/prepared.json',JSON.stringify({plan,worst,sun,meta:{w:f.w,h:f.h,maxQ:f.maxQ,x0:f.x0,y0:f.y0,z:f.z}}));fs.writeFileSync('/tmp/umbra-02b/B.bin',new Uint8Array(f.B.buffer));
const query=JSON.stringify({edges:input.edges,when:'2026-06-21T13:00:00.000Z'}),answer=JSON.stringify(core.sampleEdges(f,plan,sun));
const sizes=[{name:'point',request:80,response:128},{name:'hour',request:534,response:1433},{name:'graph908',request:Buffer.byteLength(query),response:Buffer.byteLength(answer)},{name:'cog-block',request:0,response:65536},{name:'canonical-tile',request:0,response:1572864}];
fs.writeFileSync('/tmp/umbra-02b/payloads.json',JSON.stringify(sizes,null,2));console.log(JSON.stringify({worstCells:core.trace(f,worst,d).cells,sizes}));
}finally{await v.close();}
```

</details>

<details>
<summary>cpu.mjs</summary>

```javascript
import fs from 'node:fs';import * as core from '/tmp/umbra-02a/core.mjs';import zlib from 'node:zlib';
const prepared=JSON.parse(fs.readFileSync('/tmp/umbra-02b/prepared.json')),buf=fs.readFileSync('/tmp/umbra-02b/B.bin'),field={...prepared.meta,B:new Int32Array(buf.buffer,buf.byteOffset,buf.length/4)},out=[];
for(const kind of ['one-worst-ray','real908-at3','all7314-worst','real908-at10']){
 const plan=kind==='all7314-worst'?{...prepared.plan,points:prepared.plan.points.map(()=>prepared.worst)}:prepared.plan;const sun=kind==='real908-at10'?{azimuth:-Math.PI/4,altitude:10*Math.PI/180}:prepared.sun;const times=[];
 for(let i=0;i<35;i++){const c=process.cpuUsage(),t=performance.now();const answer=kind==='one-worst-ray'?core.trace(field,prepared.worst,core.ray(sun)):core.sampleEdges(field,plan,sun);const wall=performance.now()-t,u=process.cpuUsage(c);if(i>=5)times.push({wall,cpu:(u.user+u.system)/1000});}
 out.push({kind,times});
}
const before=process.memoryUsage();let copies=Array.from({length:6},()=>new Int32Array(field.w*field.h).fill(1));const after=process.memoryUsage();out.push({memory:{before,after,bytes:copies.reduce((s,a)=>s+a.byteLength,0)}});copies=null;
const gz=zlib.gzipSync(buf);fs.writeFileSync('/tmp/umbra-02b/B.gz',gz);out.push({gzipBuildingBand:gz.byteLength});fs.writeFileSync('/tmp/umbra-02b/cpu-result.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));
```

</details>

<details>
<summary>runtime-worker.mjs</summary>

```javascript
import * as core from '/tmp/umbra-02a/core.mjs';
let field,prepared,initCount=0;
export class FieldDO{constructor(ctx,env){this.ctx=ctx;this.env=env;this.generation=crypto.randomUUID();this.calls=0;}async fetch(){this.calls++;let from='memory';if(!this.field){const b=await this.env.DATA.get('B.bin');this.field=new Int32Array(await b.arrayBuffer());from='R2';}return Response.json({generation:this.generation,calls:this.calls,from,bytes:this.field.byteLength});}}
export default {async fetch(req,env){const u=new URL(req.url),mode=u.pathname;
 if(mode==='/range'){const start=Number(u.searchParams.get('start')),n=Number(u.searchParams.get('n'));const o=await env.DATA.get(u.searchParams.get('key')||'B.bin',{range:{offset:start,length:n}});return new Response(o.body,{status:206,headers:{'Content-Length':String(o.range.length),'Content-Range':`bytes ${o.range.offset}-${o.range.offset+o.range.length-1}/${o.size}`,'ETag':o.httpEtag}});}
 if(mode==='/do')return env.FIELD.get(env.FIELD.idFromName('madrid')).fetch(req);
 if(mode==='/cache'){const key=new Request('https://cache.test/field-v1'),prior=await caches.default.match(key);if(prior)return Response.json({hit:true,bytes:(await prior.arrayBuffer()).byteLength});await caches.default.put(key,new Response(new Uint8Array(1572864),{headers:{'Content-Length':'1572864','Cache-Control':'public,max-age=3600'}}));return Response.json({hit:false});}
 if(mode==='/cache206'){try{await caches.default.put('https://cache.test/partial',new Response(new Uint8Array(10),{status:206}));return Response.json({accepted:true});}catch(e){return Response.json({accepted:false,error:String(e)});}}
 if(mode==='/memory'){const mib=Number(u.searchParams.get('mib'));const a=Array.from({length:6},()=>new Uint8Array(Math.floor(mib*1048576/6)).fill(3));return Response.json({bytes:a.reduce((s,b)=>s+b.byteLength,0),sum:a.reduce((s,b)=>s+b.at(-1),0)});}
 if(mode==='/init'){prepared=await req.json();const o=await env.DATA.get('B.bin');field={...prepared.meta,B:new Int32Array(await o.arrayBuffer())};initCount++;return Response.json({bytes:field.B.byteLength,initCount});}
 if(mode==='/query'){const worst=u.searchParams.has('worst'),plan=worst?{...prepared.plan,points:prepared.plan.points.map(()=>prepared.worst)}:prepared.plan;const answer=core.sampleEdges(field,plan,prepared.sun);return Response.json({initCount,answer});}
 return new Response('ok');
}};
```

</details>

<details>
<summary>runtime.mjs</summary>

```javascript
import fs from 'node:fs';import {build} from '/home/wslunusn/ShadeMapNavigation/node_modules/esbuild/lib/main.js';import {Miniflare} from './tools/node_modules/miniflare/dist/src/index.js';
await build({entryPoints:['/tmp/umbra-02b/runtime-worker.mjs'],bundle:true,format:'esm',platform:'browser',outfile:'/tmp/umbra-02b/runtime-bundle.mjs'});
const script=fs.readFileSync('/tmp/umbra-02b/runtime-bundle.mjs','utf8'),options={modules:true,script,compatibilityDate:'2026-04-01',r2Buckets:['DATA'],durableObjects:{FIELD:'FieldDO'},r2Persist:'/tmp/umbra-02b/r2',durableObjectsPersist:'/tmp/umbra-02b/do',cachePersist:'/tmp/umbra-02b/cache'};
const out=[];let mf=new Miniflare(options);
try{
const bucket=await mf.getR2Bucket('DATA');await bucket.put('B.bin',new Uint8Array(fs.readFileSync('/tmp/umbra-02b/B.bin')).buffer);
const call=async(path,options)=>{const t=performance.now(),r=await mf.dispatchFetch('https://probe.test'+path,options),body=await r.arrayBuffer();return {path,status:r.status,ms:performance.now()-t,bytes:body.byteLength,body:Buffer.from(body).toString()};};
out.push(await call('/init',{method:'POST',body:fs.readFileSync('/tmp/umbra-02b/prepared.json','utf8')}));
for(const path of ['/','/query','/query?worst=1']){const times=[];for(let i=0;i<35;i++){const r=await call(path);if(r.status!==200)throw Error(r.body);if(i>=5)times.push(r.ms);}out.push({path,times});}
for(const path of ['/do','/do','/cache','/cache','/cache206','/range?start=65536&n=65536']){const r=await call(path);out.push({...r,body:path.startsWith('/range')?{length:r.bytes}:r.body});}
await mf.dispose();mf=new Miniflare(options);out.push(await call('/do'));out.push(await call('/cache'));
for(const mib of [96,192,235]){try{out.push(await call('/memory?mib='+mib));}catch(e){out.push({mib,error:String(e)});}}
}finally{await mf.dispose();fs.writeFileSync('/tmp/umbra-02b/runtime-result.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));}
```

</details>

<details>
<summary>cog.mjs</summary>

```javascript
import fs from 'node:fs';import crypto from 'node:crypto';import {createServer} from '/home/wslunusn/ShadeMapNavigation/node_modules/vite/dist/node/index.js';import {Miniflare} from './tools/node_modules/miniflare/dist/src/index.js';
const root='/home/wslunusn/ShadeMapNavigation',p='/tmp/umbra-02b',v=await createServer({root,configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom'});
let mf;const original=globalThis.fetch;
try{
const {createCogTileSource}=await v.ssrLoadModule('/app/lib/canopyRaster/cogTileSource.ts'),{createCanopyTileStore}=await v.ssrLoadModule('/app/lib/canopyRaster/canopyTileStore.ts');
const lng=-3.7038,lat=40.4168,m=111320*Math.cos(lat*Math.PI/180),bbox=[lng-700/m,lat-400/111320,lng+700/m,lat+400/111320],blocks=[],runs=[];let mode='live',calls=[];
globalThis.fetch=async(input,opts)=>{const u=String(input);if(!u.includes('/meta-chm-v2/chm/'))return original(input,opts);const range=new Headers(opts?.headers).get('range'),t=performance.now();let r;
 if(mode==='live')r=await original(input,opts);else{const [start,end]=range.match(/\d+/g).map(Number);const x=await mf.dispatchFetch('https://probe.test/range?key=cog.tif&start='+start+'&n='+(end-start+1));r=new Response(await x.arrayBuffer(),{status:x.status,headers:x.headers});}
 const bytes=new Uint8Array(await r.arrayBuffer());calls.push({range,status:r.status,bytes:bytes.byteLength,ms:performance.now()-t,contentRange:r.headers.get('content-range')});if(mode==='live')blocks.push({start:Number(range.match(/\d+/)[0]),bytes});return new Response(bytes,{status:r.status,headers:r.headers});};
for(const kind of ['live','r2-emulator']){
 if(kind==='r2-emulator'){
  const size=Number(calls[0].contentRange.split('/')[1]),sparse=new Uint8Array(size);for(const b of blocks)sparse.set(b.bytes,b.start);fs.writeFileSync(p+'/cog-sparse.tif',sparse);
  mf=new Miniflare({modules:true,script:fs.readFileSync(p+'/runtime-bundle.mjs','utf8'),compatibilityDate:'2026-04-01',r2Buckets:['DATA'],durableObjects:{FIELD:'FieldDO'}});const bucket=await mf.getR2Bucket('DATA');await bucket.put('cog.tif',sparse.buffer);mode=kind;
 }
 for(let i=0;i<3;i++){calls=[];const store=createCanopyTileStore({source:createCogTileSource(),maxAttempts:1}),t=performance.now(),patch=await store.read(bbox,{priority:'route',signal:AbortSignal.timeout(45000)}),ms=performance.now()-t;const t1=performance.now();await store.read(bbox,{priority:'route'});const warmMs=performance.now()-t1;
 const data=patch.data??patch.heights;const row={kind,i,ms,warmMs,width:patch.width,height:patch.height,keys:Object.keys(patch),calls,hash:data&&crypto.createHash('sha256').update(data).digest('hex')};runs.push(row);if(kind==='live'&&i===0){fs.writeFileSync(p+'/patch.json',JSON.stringify({...patch,heights:undefined,data:undefined,valid:undefined,validity:undefined}));for(const [k,a] of Object.entries(patch))if(ArrayBuffer.isView(a))fs.writeFileSync(p+'/patch-'+k+'.bin',new Uint8Array(a.buffer,a.byteOffset,a.byteLength));}console.log(JSON.stringify(row));}
}
fs.writeFileSync(p+'/cog-result.json',JSON.stringify({bbox,runs},null,2));
}finally{globalThis.fetch=original;await mf?.dispose();await v.close();}
```

</details>

<details>
<summary>composition.mjs</summary>

```javascript
import fs from 'node:fs';import zlib from 'node:zlib';import * as core from '/tmp/umbra-02a/core.mjs';
const P='/tmp/umbra-02b',patch=JSON.parse(fs.readFileSync(P+'/patch.json')),chm=new Uint8Array(fs.readFileSync(P+'/patch-heights.bin')),valid=fs.existsSync(P+'/patch-valid.bin')?new Uint8Array(fs.readFileSync(P+'/patch-valid.bin')):null,prepared=JSON.parse(fs.readFileSync(P+'/prepared.json')),bb=fs.readFileSync(P+'/B.bin'),B=new Int32Array(bb.buffer,bb.byteOffset,bb.length/4),f=prepared.meta;
const [gx,gy]=core.project(-3.7038,40.4168,17),tx=Math.floor(gx/256)*256,ty=Math.floor(gy/256)*256,N=256*2**17;
// Probe's G=0 is a flat analytic fixture, NOT a claimed Madrid datum/terrain model.
// Real observed CHM samples and captured building AGL are composed on that fixture.
const coords=Array.from({length:65536},(_,i)=>{const x=tx+i%256+.5,y=ty+Math.floor(i/256)+.5;const lng=x/N*360-180,lat=Math.atan(Math.sinh(Math.PI*(1-2*y/N)))*180/Math.PI;const cx=Math.floor((lng-patch.bbox[0])/(patch.bbox[2]-patch.bbox[0])*patch.width),cy=Math.floor((patch.bbox[3]-lat)/(patch.bbox[3]-patch.bbox[1])*patch.height);return {bi:(Math.floor(y)-f.y0)*f.w+Math.floor(x)-f.x0,ci:cy*patch.width+cx};});
const times=[],compressed=[];let data;
for(let j=0;j<25;j++){const t=performance.now();data=new Int32Array(65536*6);for(let i=0;i<65536;i++){const {bi,ci}=coords[i],b=B[bi]??0,h=chm[ci]??0,c1=h*64,c0=Math.round(h*.35*64),o=i*6;data[o]=0;data[o+1]=b;data[o+2]=c1>b?Math.max(b,c0):0;data[o+3]=c1>b?c1:0;data[o+4]=(b>0?1:0)|(c1>b?2:0)|((!valid||valid[ci])?4:0);data[o+5]=1;}const ms=performance.now()-t;if(j>=5)times.push(ms);}
const bytes=Buffer.from(data.buffer);for(let i=0;i<20;i++){const t=performance.now(),packed=zlib.gzipSync(bytes),encodeMs=performance.now()-t,t1=performance.now(),unpacked=zlib.gunzipSync(packed),decodeMs=performance.now()-t1;if(!bytes.equals(unpacked))throw Error('roundtrip');compressed.push({bytes:packed.length,encodeMs,decodeMs});}
const out={grid:{tx,ty,z:17},bytes:data.byteLength,compositionMs:times,compressed,positiveCanopy:coords.filter(c=>chm[c.ci]>0).length};fs.writeFileSync(P+'/composition-result.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out));
```

</details>

<details>
<summary>app-probe.mjs</summary>

```javascript
import fs from 'node:fs';
import {createServer} from '/home/wslunusn/ShadeMapNavigation/node_modules/vite/dist/node/index.js';
import {build} from '/home/wslunusn/ShadeMapNavigation/node_modules/esbuild/lib/main.js';
import {chromium} from '/home/wslunusn/ShadeMapNavigation/node_modules/@playwright/test/index.mjs';
const root='/home/wslunusn/ShadeMapNavigation';
await build({entryPoints:[root+'/e2e/helpers/scenario.ts'],bundle:true,platform:'node',format:'esm',outfile:'/tmp/umbra-02b/scenario.mjs'});
const {stubNetwork,SHARE_URL}=await import('./scenario.mjs');
const server=await createServer({root,server:{host:'127.0.0.1',port:5192,strictPort:true},plugins:[{name:'throwaway-instrumentation',enforce:'pre',transform(code,id){
 if(id.endsWith('/app/lib/shadowField/ShadowField.ts'))return code.replace('export function createGeometryShadowField(', 'function createGeometryShadowFieldInner(')+`
export function createGeometryShadowField(...args:any[]){const f=createGeometryShadowFieldInner(...args);for(const name of ['sampleEdges','sweep','shadowAt','ready','readyEdges']){const fn=f[name].bind(f);f[name]=(...a:any[])=>{const t=performance.now();const out=fn(...a);const r={name,t,ms:performance.now()-t,n:Array.isArray(a[0])?a[0].length:1,times:name==='sweep'?a[1].length:1,requestBytes:new TextEncoder().encode(JSON.stringify(a)).length,responseBytes:out instanceof Promise?null:new TextEncoder().encode(JSON.stringify(out)).length};(window.__probe??=[]).push(r);if(name==='sampleEdges')window.__lastEdges=a[0];if(name==='sweep')window.__lastRouteEdges=a[0];return out;};}return f;}`;
 if(id.endsWith('/app/lib/shadow/LocalShadowAdapter.ts'))return code.replace('setDate(date: Date) {',`setDate(date: Date) { (window.__dates??=[]).push({t:performance.now(),date:date.getTime()});`);
}}]});
await server.listen();
const browser=await chromium.launch({headless:false,args:['--use-gl=angle','--use-angle=gl','--disable-software-rasterizer']});
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});await stubNetwork(page,{basemap:'fixture'});
 // Development proxies have different names from the preview build's routes.
 await page.route('**/__overpass',r=>r.fulfill({status:200,contentType:'application/json',body:fs.readFileSync('/tmp/umbra-02b/roads-fixture.json','utf8')}));
 await page.route('**/__nominatim*',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
 page.on('pageerror',e=>console.log('PAGEERROR',e.message));
 await page.goto('http://127.0.0.1:5192'+SHARE_URL);await page.waitForSelector('canvas.maplibregl-canvas');await page.waitForTimeout(2500);
 const runs=[];
 for(let i=0;i<12;i++){
  await page.evaluate(()=>{window.__probe=[];window.__umbraMetrics?.clearMetrics();});
  await page.getByRole('button',{name:'Find Shadowed Route',exact:true}).click();
  await page.waitForFunction(()=>!!window.__umbraMetrics?.latest,{},{timeout:40000});
  await page.waitForFunction(()=>(window.__probe??[]).filter(x=>x.name==='sweep').length>=15,{},{timeout:20000});
  runs.push(await page.evaluate(()=>({metrics:window.__umbraMetrics.latest,queries:window.__probe})));
 }
 const edges=await page.evaluate(()=>({graph:window.__lastEdges,route:window.__lastRouteEdges}));fs.writeFileSync('/tmp/umbra-02b/app-edges.json',JSON.stringify(edges));
 await page.evaluate(()=>{window.__probe=[];window.__dates=[];});
 const slider=page.getByTestId('timeline-slider').filter({visible:true}),box=await slider.boundingBox(),x=box.x+box.width*.8,y=box.y+box.height/2;
 await page.mouse.move(x,y);await page.mouse.down();for(let i=1;i<=60;i++){await page.mouse.move(x-i*4,y);await page.waitForTimeout(16);}await page.waitForTimeout(170);await page.mouse.up();await page.waitForTimeout(200);
 const drag=await page.evaluate(()=>({queries:window.__probe,dates:window.__dates,metrics:window.__umbraMetrics.latest}));
 const renderer=await page.evaluate(()=>{const g=document.querySelector('canvas.maplibregl-canvas').getContext('webgl2');return g.getParameter(g.getExtension('WEBGL_debug_renderer_info').UNMASKED_RENDERER_WEBGL)});
 const out={browser:browser.version(),renderer,runs,drag};fs.writeFileSync('/tmp/umbra-02b/app-result.json',JSON.stringify(out,null,2));console.log(JSON.stringify({renderer,routeRuns:runs.map(r=>r.metrics.phases),queries:runs[0].queries,drag}));
}finally{await browser.close();await server.close();}
```

</details>

<details>
<summary>browser-entry.tsx</summary>

```tsx
import React,{useEffect} from '/home/wslunusn/ShadeMapNavigation/node_modules/react/index.js';
import {createRoot} from '/home/wslunusn/ShadeMapNavigation/node_modules/react-dom/client.js';
import TimelineSlider from '/home/wslunusn/ShadeMapNavigation/app/components/TimelineSlider.tsx';
import {useShadowTime} from '/home/wslunusn/ShadeMapNavigation/app/hooks/useShadowTime.ts';
import {useHourlyExposure} from '/home/wslunusn/ShadeMapNavigation/app/hooks/useHourlyExposure.ts';
import {createGeometryShadowField,staticPrismProvider} from '/home/wslunusn/ShadeMapNavigation/app/lib/shadowField/ShadowField.ts';
import {prismsFromTileFeatures} from '/home/wslunusn/ShadeMapNavigation/app/lib/shadowField/geometry.ts';
import {fixtureBuildingFeatures} from '/home/wslunusn/ShadeMapNavigation/e2e/fixtures/basemapStyle.ts';
const field=createGeometryShadowField([staticPrismProvider(prismsFromTileFeatures(fixtureBuildingFeatures()),{west:-180,south:-85,east:180,north:85},'tiles')]);
window.events=[];for(const name of ['sweep','sampleEdges','shadowAt']){const original=field[name].bind(field);field[name]=(...a)=>{const t=performance.now(),out=original(...a);window.events.push({name,t,ms:performance.now()-t,n:a[0]?.length??1});return out;};}
const edges=await (await fetch('/app-edges.json')).json(),coords=[edges.route[0].from,...edges.route.map(e=>e.to)],route={geojson:{type:'Feature',geometry:{type:'LineString',coordinates:coords}},sides:coords.slice(1).map(()=>'left')};
function App(){const s=useShadowTime();const exposure=useHourlyExposure(route,field,s.date,0);window.control=s;window.readyCount=exposure.readyCount;
 useEffect(()=>{(window.dates??=[]).push({t:performance.now(),when:s.date.getTime()});},[s.date]);
 return <div style={{width:1000,height:90}}><TimelineSlider minutes={s.date.getUTCHours()*60+s.date.getUTCMinutes()} onChange={s.handleSliderChange} date={s.date} utcOffsetMin={0}/></div>;
}
createRoot(document.getElementById('root')).render(<App/>);
window.measureCurrent=()=>{const rows=[];for(const [name,args] of [['point',[-73.984,40.754,new Date('2026-06-21T13:00:00Z')]],['graph220',[edges.graph,new Date('2026-06-21T13:00:00Z')]]]){const a=[];for(let i=0;i<35;i++){const t=performance.now(),r=field[name==='point'?'shadowAt':'sampleEdges'](...args),ms=performance.now()-t;if(i>=5)a.push(ms);}rows.push({name,a});}return rows;};
```

</details>

<details>
<summary>browser-worker.mjs</summary>

```javascript
import * as core from '/tmp/umbra-02a/core.mjs';let field,prepared;
onmessage=async e=>{const {id,kind}=e.data;if(kind==='init'){prepared=await(await fetch('/prepared.json')).json();field={...prepared.meta,B:new Int32Array(await(await fetch('/B.bin')).arrayBuffer())};postMessage({id,bytes:field.B.byteLength});return;}if(kind==='tile'){const b=new Uint8Array(1572864).fill(1);postMessage({id,b},[b.buffer]);return;}const plan=kind==='worst'?{...prepared.plan,points:prepared.plan.points.map(()=>prepared.worst)}:prepared.plan;const t=performance.now(),answer=core.sampleEdges(field,plan,prepared.sun);postMessage({id,ms:performance.now()-t,answer});};
```

</details>

<details>
<summary>browser.mjs</summary>

```javascript
import fs from 'node:fs';import http from 'node:http';import {build} from '/home/wslunusn/ShadeMapNavigation/node_modules/esbuild/lib/main.js';import {chromium} from '/home/wslunusn/ShadeMapNavigation/node_modules/@playwright/test/index.mjs';
const root='/tmp/umbra-02b';for(const [src,dest] of [['browser-entry.tsx','browser-bundle.js'],['browser-worker.mjs','worker-bundle.js']])await build({entryPoints:[root+'/'+src],bundle:true,platform:'browser',format:'esm',jsx:'automatic',outfile:root+'/'+dest});
const server=http.createServer((req,res)=>{if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end('<div id="root"></div><script type="module" src="/browser-bundle.js"></script>');}const p=root+new URL(req.url,'http://localhost').pathname;if(!fs.existsSync(p)){res.statusCode=404;return res.end();}res.setHeader('Content-Type',p.endsWith('.js')?'application/javascript':'application/octet-stream');fs.createReadStream(p).pipe(res);});await new Promise(r=>server.listen(5193,'127.0.0.1',r));
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1200,height:800}});page.on('pageerror',e=>console.log(e.message));await page.goto('http://127.0.0.1:5193');await page.waitForFunction(()=>window.readyCount===15);const current=await page.evaluate(()=>window.measureCurrent());
 await page.evaluate(()=>{window.control.setDate(new Date('2026-06-21T09:00:00Z'));});await page.waitForTimeout(500);await page.evaluate(()=>{window.events=[];window.dates=[]});
 const b=await page.getByTestId('timeline-slider').boundingBox();await page.mouse.move(b.x+700,b.y+b.height/2);await page.mouse.down();for(let i=1;i<=60;i++){await page.mouse.move(b.x+700-i*4,b.y+b.height/2);await page.waitForTimeout(16);}await page.waitForTimeout(170);await page.mouse.up();await page.waitForTimeout(150);const drag=await page.evaluate(()=>({events:window.events,dates:window.dates}));
 await page.evaluate(()=>{window.events=[];window.dates=[];window.control.setIsPlaying(true)});await page.waitForTimeout(2100);await page.evaluate(()=>window.control.setIsPlaying(false));const play=await page.evaluate(()=>({events:window.events,dates:window.dates}));
 await page.evaluate(()=>{window.events=[];window.dates=[];window.control.setDate(new Date('2026-06-22T09:00:00Z'))});await page.waitForTimeout(500);const day=await page.evaluate(()=>({events:window.events,dates:window.dates}));
 const worker=await page.evaluate(async()=>{const w=new Worker('/worker-bundle.js',{type:'module'});let seq=0;const call=kind=>new Promise(resolve=>{const id=seq++,t=performance.now();w.onmessage=e=>{if(e.data.id===id)resolve({...e.data,rtt:performance.now()-t});};w.postMessage({id,kind});});const first=await call('init'),rows=[];for(const kind of ['query','worst','tile']){const samples=[];let heartbeats=0;const timer=setInterval(()=>heartbeats++,10);for(let i=0;i<35;i++){const r=await call(kind);if(i>=5)samples.push({rtt:r.rtt,ms:r.ms,bytes:r.b?.byteLength});}clearInterval(timer);rows.push({kind,samples,heartbeats});}w.terminate();return {first,rows};});
 const result={browser:browser.version(),current,drag,play,day,worker};fs.writeFileSync(root+'/browser-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();await new Promise(r=>server.close(r));}
```

</details>

<details>
<summary>real-route.mjs</summary>

```javascript
import fs from 'node:fs';import {createServer} from '/home/wslunusn/ShadeMapNavigation/node_modules/vite/dist/node/index.js';import * as core from '/tmp/umbra-02a/core.mjs';
const p='/tmp/umbra-02b',root='/home/wslunusn/ShadeMapNavigation',v=await createServer({root,configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom'}),original=globalThis.fetch;
try{
globalThis.fetch=async(url,opts)=>{if(!String(url).includes('overpass'))return original(url,opts);fs.writeFileSync(p+'/real-route-query.txt',opts.body);const r=await original('https://overpass-api.de/api/interpreter',{...opts,headers:{...opts.headers,'User-Agent':'Umbra/1.0 (+https://shademapnav.vercel.app)'}}),text=await r.text();fs.writeFileSync(p+'/real-roads.json',text);return new Response(text,{status:r.status});};
const {fetchRoutingGraph}=await v.ssrLoadModule('/app/lib/overpass.ts'),{snapToGraph,dijkstra}=await v.ssrLoadModule('/app/lib/routing.ts'),helpers={...await v.ssrLoadModule('/app/lib/shadowField/ShadowField.ts'),...await v.ssrLoadModule('/app/lib/shadowField/geometry.ts')};
const bbox=[40.410402,-3.7125,40.4223,-3.701459],t=performance.now(),graph=await fetchRoutingGraph(...bbox),fetchMs=performance.now()-t,edges=[],seen=new Set();for(const [id,list] of graph.adj)for(const e of list){if(id<0||e.toId<0)continue;const lo=Math.min(id,e.toId),hi=Math.max(id,e.toId),key=lo+','+hi;if(seen.has(key))continue;seen.add(key);const a=graph.nodes.get(lo),b=graph.nodes.get(hi);edges.push({from:[a.lon,a.lat],to:[b.lon,b.lat]});}
const start=snapToGraph([-3.706459,40.415402],graph),end=snapToGraph([-3.7075,40.4173],graph),route=dijkstra(graph,start,end,0),plan=core.layout(edges,17,helpers),base=JSON.parse(fs.readFileSync('/tmp/umbra-02a/input.json')),prisms=base.objects.map(o=>({ring:o.ring,heightM:o.heightM})),set={prisms},field=helpers.createGeometryShadowField([helpers.staticPrismProvider(set,{west:-180,south:-85,east:180,north:85},'overpass')]);
const when=new Date('2026-06-21T13:00:00Z'),times=[];let response;for(let i=0;i<25;i++){const t=performance.now();response=field.sampleEdges(edges,when);if(i>=5)times.push(performance.now()-t);}
const requestBytes=Buffer.byteLength(JSON.stringify({edges,when})),responseBytes=Buffer.byteLength(JSON.stringify(response)),out={capturedAt:new Date().toISOString(),bbox,fetchMs,nodes:graph.nodes.size,edges:edges.length,points:plan.points.length,routeNodes:route.nodeIds.length,routeDistanceM:route.distanceM,requestBytes,responseBytes,times};fs.writeFileSync(p+'/real-route-result.json',JSON.stringify(out,null,2));fs.writeFileSync(p+'/real-route-edges.json',JSON.stringify(edges));console.log(JSON.stringify(out));
}finally{globalThis.fetch=original;await v.close();}
```

</details>

<details>
<summary>real-route-current.mjs</summary>

```javascript
import fs from 'node:fs';import {createServer} from '/home/wslunusn/ShadeMapNavigation/node_modules/vite/dist/node/index.js';import * as core from '/tmp/umbra-02a/core.mjs';
const p='/tmp/umbra-02b',root='/home/wslunusn/ShadeMapNavigation',v=await createServer({root,configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom'}),original=globalThis.fetch;
try{
globalThis.fetch=async(url,opts)=>{if(!String(url).includes('overpass'))return original(url,opts);if(fs.existsSync(p+'/real-roads.json'))return new Response(fs.readFileSync(p+'/real-roads.json','utf8'));fs.writeFileSync(p+'/real-route-query.txt',opts.body);const r=await original('https://overpass-api.de/api/interpreter',{...opts,headers:{...opts.headers,'User-Agent':'Umbra/1.0 (+https://shademapnav.vercel.app)'}}),text=await r.text();fs.writeFileSync(p+'/real-roads.json',text);return new Response(text,{status:r.status});};
const {fetchRoutingGraph}=await v.ssrLoadModule('/app/lib/overpass.ts'),{snapToGraph,dijkstra}=await v.ssrLoadModule('/app/lib/routing.ts'),helpers={...await v.ssrLoadModule('/app/lib/shadowField/ShadowField.ts'),...await v.ssrLoadModule('/app/lib/shadowField/geometry.ts')};
const bbox=[40.410402,-3.7125,40.4223,-3.701459],t=performance.now(),graph=await fetchRoutingGraph(...bbox),fetchMs=performance.now()-t,edges=[],seen=new Set();for(const [id,list] of graph.adj)for(const e of list){if(id<0||e.toId<0)continue;const lo=Math.min(id,e.toId),hi=Math.max(id,e.toId),key=lo+','+hi;if(seen.has(key))continue;seen.add(key);const a=graph.nodes.get(lo),b=graph.nodes.get(hi);edges.push({from:[a.lon,a.lat],to:[b.lon,b.lat]});}
const start=snapToGraph([-3.706459,40.415402],graph),end=snapToGraph([-3.7075,40.4173],graph),route=dijkstra(graph,start,end,0),plan=core.layout(edges,17,helpers),base=JSON.parse(fs.readFileSync('/tmp/umbra-02a/input.json')),prisms=base.objects.map(o=>({ring:o.ring,heightM:o.heightM})),set={prisms,maxHeightM:Math.max(...prisms.map(p=>p.heightM))},field=helpers.createGeometryShadowField([helpers.staticPrismProvider(set,{west:-180,south:-85,east:180,north:85},'overpass')]);
const when=new Date('2026-06-21T13:00:00Z'),times=[];let response;for(let i=0;i<25;i++){const t=performance.now();response=field.sampleEdges(edges,when);if(i>=5)times.push(performance.now()-t);}
const requestBytes=Buffer.byteLength(JSON.stringify({edges,when})),responseBytes=Buffer.byteLength(JSON.stringify(response)),out={capturedAt:new Date().toISOString(),bbox,fetchMs,nodes:graph.nodes.size,edges:edges.length,points:plan.points.length,routeNodes:route.nodeIds.length,routeDistanceM:route.distanceM,requestBytes,responseBytes,times};const re=route.nodeIds.slice(1).map((id,i)=>{const a=graph.nodes.get(route.nodeIds[i]),b=graph.nodes.get(id);return {from:[a.lon,a.lat],to:[b.lon,b.lat]};}), dates=Array.from({length:15},(_,i)=>new Date(Date.UTC(2026,5,21,4+i)));const st=performance.now(),swept=field.sweep(re,dates);out.day={edges:re.length,points:core.layout(re,17,helpers).points.length,requestBytes:Buffer.byteLength(JSON.stringify({edges:re,times:dates})),responseBytes:Buffer.byteLength(JSON.stringify(swept)),ms:performance.now()-st};fs.writeFileSync(p+'/real-route-current.json',JSON.stringify(out,null,2));fs.writeFileSync(p+'/real-route-edges.json',JSON.stringify(edges));console.log(JSON.stringify(out));
}finally{globalThis.fetch=original;await v.close();}
```

</details>

<details>
<summary>deploy-preview.py</summary>

```python
import requests,json,pathlib,uuid
base=pathlib.Path('/tmp/umbra-02b');s=requests.Session();r=s.get('https://workers.cloudflare.com/playground');r.raise_for_status()
code='''let outputs=new Map();export default {async fetch(req){const n=Math.min(2000000,Math.max(0,Number(new URL(req.url).searchParams.get('bytes')||0)));const body=await req.arrayBuffer();if(!outputs.has(n)){const b=new Uint8Array(n);let x=123456789;for(let i=0;i<n;i++){x^=x<<13;x^=x>>>17;x^=x<<5;b[i]=x&255;}outputs.set(n,b);}return new Response(outputs.get(n),{headers:{'content-type':'application/octet-stream','content-length':String(n),'cache-control':'no-store, no-transform','x-input-bytes':String(body.byteLength)}});}}'''
(base/'echo-worker.mjs').write_text(code)
r=s.post('https://workers.cloudflare.com/playground/api/worker',files={'metadata':('metadata',json.dumps({'main_module':'index.js','compatibility_date':'2026-04-01'}),'application/json'),'index.js':('index.js',code,'application/javascript+module')},timeout=60)
print('upload',r.status_code);r.raise_for_status();d=r.json()
if 'preview' not in d:print(d);raise RuntimeError('upload failed')
d['origin']='https://'+str(uuid.uuid4())+'.cloudflarepreviews.com';(base/'preview-private.json').write_text(json.dumps(d))
r=s.post(d['origin']+'/?bytes=1024',data=b'x'*100,headers={'X-CF-Token':d['preview'],'cf-raw-http':'true','X-CF-HTTP-Method':'POST'},timeout=30)
print('invoke',r.status_code,len(r.content),{k:v for k,v in r.headers.items() if k.lower() in ['cf-ray','cf-ew-status','cf-ew-raw-x-input-bytes']})
```

</details>

<details>
<summary>network.py</summary>

```python
import requests,time,json,math,concurrent.futures,pathlib,datetime
P=pathlib.Path('/tmp/umbra-02b');sizes=json.loads((P/'payloads.json').read_text());preview=json.loads((P/'preview-private.json').read_text());vercel=(P/'vercel-asset.txt').read_text();origin=(P/'origin-url.txt').read_text().replace('/AOT.tif','/B02.tif')
N=200

def run(host):
 session=requests.Session();session.headers.update({'Accept-Encoding':'identity','User-Agent':'Umbra-placement-probe/02b'});rows=[]
 def one(size,i,cold=False):
  start=time.perf_counter();codes=[];count=0;meta={};sess=requests.Session() if cold else session
  try:
   if host=='cf-preview':
    r=sess.post(preview['origin']+'/?bytes='+str(size['response']),headers={'X-CF-Token':preview['preview'],'cf-raw-http':'true','X-CF-HTTP-Method':'POST','Accept-Encoding':'identity'},data=b'x'*size['request'],timeout=30);rs=[r]
   elif host=='cf-edge':rs=[sess.get('https://speed.cloudflare.com/__down?bytes='+str(size['response']),timeout=30)]
   elif host=='vercel':
    rs=[];remaining=size['response']
    while remaining:
     n=min(remaining,954465);rs.append(sess.get(vercel,headers={'Range':f'bytes=0-{n-1}'},timeout=30));remaining-=n
   else:rs=[sess.get(origin,headers={'Range':f'bytes=0-{size["response"]-1}'},timeout=30)]
   for r in rs:
    count+=len(r.content);codes.append(r.status_code);meta.update({k.lower():v for k,v in r.headers.items() if k.lower() in ['cf-ray','x-vercel-id','x-vercel-cache','server','content-range','cf-ew-raw-x-input-bytes','cf-ew-status','server-timing']})
   if count!=size['response'] or any(c not in [200,206] for c in codes):raise RuntimeError(str((count,codes)))
   return {'host':host,'size':size['name'],'i':i,'cold':cold,'ms':(time.perf_counter()-start)*1000,'bodyBytes':count,'codes':codes,'headers':meta}
  except Exception as e:return {'host':host,'size':size['name'],'i':i,'cold':cold,'ms':(time.perf_counter()-start)*1000,'error':str(e)}
  finally:
   if cold:sess.close()
 for size in sizes:
  rows.append(one(size,-1)) # first/warmup saved separately
  for i in range(N):
   row=one(size,i);rows.append(row)
   if '429' in row.get('error',''):
    (P/('network-'+host+'.json')).write_text(json.dumps(rows,indent=2))
    session.close();raise RuntimeError('Rate limited; stop and report incomplete')
  print(host,size['name'],'done',flush=True)
 # Fresh connections: 50 independent TCP/TLS connections, not claimed compute cold starts.
 for i in range(50):rows.append(one(sizes[2],i,True))
 (P/('network-'+host+'.json')).write_text(json.dumps(rows,indent=2));session.close();return rows
allrows=[]
# One host at a time avoids bandwidth contention for the transfer-size experiment.
for host in ['cf-preview','vercel','s3-origin','cf-edge']:allrows+=run(host)
(P/'network-all.json').write_text(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'n':N,'origin':origin,'vercel':vercel,'rows':allrows},indent=2))
```

</details>

<details>
<summary>network-extra.py</summary>

```python
import pathlib,json
p=pathlib.Path('/tmp/umbra-02b');scope={};exec((p/'network.py').read_text().split('allrows=[]')[0],scope)
r=json.loads((p/'real-route-current.json').read_text());scope['sizes']=[{'name':'graph4039','request':r['requestBytes'],'response':r['responseBytes']},{'name':'day19','request':r['day']['requestBytes'],'response':r['day']['responseBytes']}]
# Extra run has two sizes: omit the base run's graph908 fresh-connection loop.
import inspect
source=(p/'network.py').read_text().split('def run(host):')[1].split('allrows=[]')[0]
source=source.replace("for i in range(50):rows.append(one(sizes[2],i,True))",'')
source=source.replace("'network-'+host+'.json'", "'network-extra-'+host+'.json'")
exec('def run(host):'+source,scope)
for host in ['cf-preview','vercel','s3-origin']:scope['run'](host)
```

</details>

<details>
<summary>network-fixture.py</summary>

```python
import pathlib,json
p=pathlib.Path('/tmp/umbra-02b');scope={};exec((p/'network.py').read_text().split('allrows=[]')[0],scope)
scope['sizes']=[{'name':'graph220','request':11218,'response':28764}]
# Extra run has two sizes: omit the base run's graph908 fresh-connection loop.
import inspect
source=(p/'network.py').read_text().split('def run(host):')[1].split('allrows=[]')[0]
source=source.replace("for i in range(50):rows.append(one(sizes[2],i,True))",'')
source=source.replace("'network-'+host+'.json'", "'network-fixture-'+host+'.json'")
source=source.replace('for i in range(N):rows.append(one(size,i))', '''for i in range(N):
   row=one(size,i);rows.append(row)
   if 'error' in row:
    (P/('network-fixture-'+host+'.json')).write_text(json.dumps(rows,indent=2));raise RuntimeError('Request failed; stop and report incomplete')''')
exec('def run(host):'+source,scope)
for host in ['cf-preview','vercel','s3-origin']:scope['run'](host)
```

</details>

<details>
<summary>vercel-function.py</summary>

```python
import requests,time,json,pathlib
s=requests.Session();out=[]
for i in range(201):
 t=time.perf_counter();r=s.get('https://shademapnav.vercel.app/api/nominatim?endpoint=umbra-placement-invalid',timeout=20);out.append({'i':i-1,'ms':(time.perf_counter()-t)*1000,'status':r.status_code,'bytes':len(r.content),'body':r.text,'headers':{k:v for k,v in r.headers.items() if k.lower() in ['x-vercel-id','x-vercel-cache','server']}})
 if r.status_code!=400:break
pathlib.Path('/tmp/umbra-02b/vercel-function-result.json').write_text(json.dumps(out,indent=2));print(out[0],out[-1])
```

</details>

<details>
<summary>cloud-cpu.py</summary>

```python
import base64,json,pathlib,requests,time,uuid
p=pathlib.Path('/tmp/umbra-02b')
core=pathlib.Path('/tmp/umbra-02a/core.mjs').read_text()
code=core+'\nconst prepared='+(p/'prepared.json').read_text()+';\nconst packed='+json.dumps(base64.b64encode((p/'B.gz').read_bytes()).decode())+';\n'+"let field,initCount=0;export default {async fetch(req){if(!field){const b=Uint8Array.from(atob(packed),x=>x.charCodeAt(0));field={...prepared.meta,B:new Int32Array(await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer())};initCount++;}const u=new URL(req.url),worst=u.searchParams.has('worst'),plan=worst?{...prepared.plan,points:prepared.plan.points.map(()=>prepared.worst)}:prepared.plan;let t=performance.now();const answer=sampleEdges(field,plan,prepared.sun);return Response.json({initCount,clockMs:performance.now()-t,count:answer.length,shade:answer[0].left});}};"
(p/'cloud-cpu-worker.mjs').write_text(code)
s=requests.Session();s.get('https://workers.cloudflare.com/playground').raise_for_status()
r=s.post('https://workers.cloudflare.com/playground/api/worker',files={'metadata':('metadata',json.dumps({'main_module':'index.js','compatibility_date':'2026-04-01'}),'application/json'),'index.js':('index.js',code,'application/javascript+module')},timeout=60)
r.raise_for_status();d=r.json();origin='https://'+str(uuid.uuid4())+'.cloudflarepreviews.com'
rows=[]
try:
 for kind in ['real','worst']:
  for i in range(25):
   t=time.perf_counter();r=s.post(origin+('/?worst=1' if kind=='worst' else '/'),headers={'X-CF-Token':d['preview'],'cf-raw-http':'true','X-CF-HTTP-Method':'GET'},timeout=30)
   rows.append({'kind':kind,'i':i,'rtt':(time.perf_counter()-t)*1000,'status':r.status_code,'workerStatus':r.headers.get('cf-ew-status'),'body':r.text,'ray':r.headers.get('cf-ray')})
   if r.status_code==429:raise RuntimeError('Rate limited; stop and report incomplete')
finally:
 (p/'cloud-cpu-result.json').write_text(json.dumps(rows,indent=2));s.close()
print('samples',len(rows),'bundleBytes',len(code.encode()))
```

</details>

<details>
<summary>cloud-memory.py</summary>

```python
import requests,json,pathlib,uuid,time
p=pathlib.Path('/tmp/umbra-02b');code='''export default {async fetch(req){const n=Number(new URL(req.url).searchParams.get('mib'));const a=Array.from({length:6},()=>new Uint8Array(Math.floor(n*1048576/6)).fill(3));return Response.json({bytes:a.reduce((s,b)=>s+b.length,0),sum:a.reduce((s,b)=>s+b.at(-1),0)});}}'''
(p/'memory-worker.mjs').write_text(code);s=requests.Session();s.get('https://workers.cloudflare.com/playground');r=s.post('https://workers.cloudflare.com/playground/api/worker',files={'metadata':('metadata',json.dumps({'main_module':'index.js','compatibility_date':'2026-04-01'}),'application/json'),'index.js':('index.js',code,'application/javascript+module')},timeout=60);r.raise_for_status();d=r.json();origin='https://'+str(uuid.uuid4())+'.cloudflarepreviews.com';rows=[]
for mib in [96,192,235]:
 t=time.perf_counter();r=s.post(origin+'/?mib='+str(mib),headers={'X-CF-Token':d['preview'],'cf-raw-http':'true','X-CF-HTTP-Method':'GET'},timeout=30);rows.append({'mib':mib,'ms':(time.perf_counter()-t)*1000,'status':r.status_code,'workerStatus':r.headers.get('cf-ew-status'),'body':r.text[:12000]});print(mib,r.status_code,r.headers.get('cf-ew-status'),r.text[:200])
(p/'cloud-memory-result.json').write_text(json.dumps(rows,indent=2))
```

</details>

<details>
<summary>summarize.py</summary>

```python
import collections,json,math,pathlib
p=pathlib.Path('/tmp/umbra-02b')
def q(xs):
 xs=sorted(xs)
 return {'n':len(xs),**{k:xs[max(0,math.ceil(v*len(xs))-1)] for k,v in [('p50',.5),('p95',.95),('p99',.99),('max',1)]}} if xs else {'n':0}
for file in sorted(p.glob('network-*.json')):
 if file.name=='network-all.json':continue
 rows=json.loads(file.read_text());groups=collections.defaultdict(list)
 for row in rows:
  if row['i']>=0:groups[(row['size'],row.get('cold',False))].append(row)
 for key,group in groups.items():print(file.name,key,q([r['ms'] for r in group if 'error' not in r]),'errors',sum('error' in r for r in group))
for row in json.loads((p/'cpu-result.json').read_text()):
 if 'times' in row:
  for key in ['wall','cpu']:print('Node',row['kind'],key,q([r[key] for r in row['times']]))
for row in json.loads((p/'runtime-result.json').read_text()):
 if 'times' in row:print('workerd',row['path'],q(row['times']))
b=json.loads((p/'browser-result.json').read_text())
for row in b['worker']['rows']:
 for key in ['rtt','ms']:print('browser worker',row['kind'],key,q([r[key] for r in row['samples'] if key in r]))
for kind in ['drag','play','day']:
 rows=b[kind]['dates'];print(kind,'commits',len(rows),'rate',(len(rows)-1)*1000/(rows[-1]['t']-rows[0]['t']) if len(rows)>1 else None,'queries',len(b[kind]['events']))
for row in b['current']:print('resident browser',row['name'],q(row['a']))
a=json.loads((p/'app-result.json').read_text());retained=a['runs'][2:]
for name in ['sampleEdges','sweep']:print('full app',name,q([x['ms'] for r in retained for x in r['queries'] if x['name']==name]))
r=json.loads((p/'real-route-current.json').read_text());print('Madrid current query',q(r['times']),'day',r['day'])
c=json.loads((p/'cloud-cpu-result.json').read_text())
for kind in ['real','worst']:print('cloud kernel RTT',kind,q([r['rtt'] for r in c if r['kind']==kind and r['i']>=5 and r['status']==200 and r['workerStatus']=='200']))
c=json.loads((p/'composition-result.json').read_text());print('compose',q(c['compositionMs']))
for key in ['encodeMs','decodeMs']:print(key,q([r[key] for r in c['compressed']]))
```

</details>

### Evidence retention and fingerprints

The measurements above were completed and their quantiles recalculated from the raw
JSON before the session resumed. The temporary `/tmp/umbra-02a` and `/tmp/umbra-02b`
directories were absent after resumption. **Original per-request rows are therefore not
included or available as durable attachments here**; the tables, counts, failures,
method and executable probes are the retained record. No raw-result hash is invented.
This limits independent forensic inspection of individual tail samples; a rerun creates
new raw files and should preserve them before clearing its temporary directory.

02a's previously recorded `input.json` identity is
`2ec22e135419acbc52539becde88cb9342f20047a1c9be59e550467ca197a4aa`.
A fresh live capture can differ. The following SHA-256 values identify **the embedded
reproduction code**, UTF-8 with one final newline; they do not authenticate the lost
measurement files. The original networking and range-driver revisions are described
above, so these are not falsely presented as byte-identical original drivers.

| Embedded probe | SHA-256 |
|---|---|
| `bootstrap.mjs` | `7984665fc87bc3385ef4f1d74fc173652a1b0f97e8c63b0080cca39dda18b2c9` |
| `prepare.mjs` | `02fd318d9ffc6f3f2fad47cb9f00fdff326707c3d4fd6c879f523155c3eb089f` |
| `cpu.mjs` | `cd23715b14ee4580bf3239dc5f15ed072e0c72975aa42710d3ea67e81ab2225a` |
| `runtime-worker.mjs` | `c206f85fec862a2ba4e880c31cb2629fb17a61e7c7508e099f91724d770e537d` |
| `runtime.mjs` | `9cb022b8812f326e6a03e23c9b250d916886073992231a50a96a35320474e38c` |
| `cog.mjs` | `442e9aef531e4d06973a34d438cc5f17413c2dfc7fbc46b686c3850251b236a9` |
| `composition.mjs` | `f495a1a581596686fe193ec2238d42a8ea3c100ee79617519063702aac9b209a` |
| `app-probe.mjs` | `59390f3e05fc0474e0e1f038a9455a13794780d5d79d66347d9cb4ecf231ab59` |
| `browser-entry.tsx` | `b433a271a0fcb5f234c9440e29f79c6bb1387d9fbfbe07edb003fc3a35332d18` |
| `browser-worker.mjs` | `4cc172b7597d12891f4a3a15cd8d74d33b74a41ad80ddb99e4e7b644a534261c` |
| `browser.mjs` | `914527e76144f03186bfd7c828daf94e9ed842b0b638e456a494261ad849f0b9` |
| `real-route.mjs` | `41fdbc8ca7da166928d36eb2f49752a26aedb88b99daac2c7c2b200569d48e22` |
| `real-route-current.mjs` | `626cb1f78aef28f377111cadca6054b38ae5ecb57c7c69f7466c9165a37a56fd` |
| `deploy-preview.py` | `795f7a93e9c68365f8fbc5e014678d5f558fad2bca5778046935f215198a4280` |
| `network.py` | `2986a2588b39f378090b2c5c772077ee6d26eec3696fae2986f653d1d3057c52` |
| `network-extra.py` | `e7a1156d41546f3b0fcdb05b92251ef66272b82a57a515e2b7c131af1be60d87` |
| `network-fixture.py` | `ce23be9b83737ce0885bd4345f4a136b45e73bc06597f478ff77bbe793e8f11d` |
| `vercel-function.py` | `12298f6cf5d427d13fbb52b49cb14d7c8eb04123b545cc0e52f3f598798c5794` |
| `cloud-cpu.py` | `d73ca7948bab831722a69c1cfd54223830cac9abd6709fe783d52a671acbb66e` |
| `cloud-memory.py` | `5477f2dcdee31fef33a59c32c4e737ef693a61e60ff72a037d0f08fd9f195f8b` |
| `summarize.py` | `f5c9fbe6e7245c97a02561a58c1adb950d1c9e501fa26f06aa24b293a352fa0d` |

