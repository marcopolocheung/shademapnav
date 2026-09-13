# Shadow engine v2 — feasibility spike

Measured **2026-09-12**, against checkout `cbefb8a02ef136e83447754ec35acd9bd71f6d28`.
Settled inputs: [BRIEF](./BRIEF.md), [00](./00-findings.md),
[01](./01-current-engine-audit.md), and [02](./02-architecture.md).
This is the requested S1/S2 spike, not Phase 3 or an amendment to 02. Only this document
was added. No branch or production code was changed. Complete throwaway probes appear below.

**S1 fails. No finer lattice can pass the unchanged gate with the literal §6 receiver
semantics.** Refinement cannot resolve the corpus's building-footprint exclusion versus
the specified ground receiver inside an opaque building. The measured z17 disagreement
is **0.149095 mean, 0.636364 p90, 62/300 severe readings**. A conservative subset of
interior receivers alone forces mean disagreement of at least **0.091724** at every
lattice finer than or equal to z17.

## S1 — lattice viability

### Method and unchanged gate

[MEASURED] The original
[`agreement.test.ts`](../../app/lib/shadowField/__tests__/agreement/agreement.test.ts)
was run unchanged against the legacy field: **9/9 tests passed**. A temporary Vitest
setup then substituted only `createGeometryShadowField` with the throwaway raster
candidate. The same committed test file, harness, fixtures, reference painter, pixel
sampler, color checks, and assertion ceilings ran unchanged: **5 passed, 4 failed**.
Failures were mean, p90, severe share, and per-city agreement. Corpus coverage,
nontrivial sun/shadow, reporting, and both canopy-fill checks passed.

All **150 cases / 300 sidewalk readings** were retained, with **50 cases / 100 readings
per city**. No references were regenerated from the candidate. The separate resolution
sweep calls the unchanged `referenceFor` and `reportFor` directly; each resolution has
its own report, with no pooling. `sunFor(fixture)` supplies the fixture sun explicitly:
no refraction, current-time substitution, or 2 km solar-cell change. Night returns full
shade as in the committed harness.

The probe implements cell-center membership on the globally anchored **256-cell,
Web Mercator z17** lattice, then repeats at z18–z20. Roof heights are rounded to
`round(64 * heightM)`. Ground is zero, canopy absent, and each ray starts at **1/64 m**.
Sidewalk locations and inclusive counts use the committed `sidewalkOffsets`,
`edgeSampleCount`, and `metersPerDegree` helpers. Ground spacing uses 02's Mercator
radius and the segment midpoint latitude. Direction and tangent inputs are float-rounded.

The independently written CPU DDA tests positive-length overlap with the opaque column
in every crossed cell, advancing both axes on an exact corner tie. It includes the
receiver's own cell; no source-building exclusion or roof lift was introduced. The
finite fixture's complete object extent and maximum height bound clear-ray termination.
The zero ground plane requires no nontrivial terrain-triangle calculation. The varying
`B` band is Int32; absent canopy, flat ground, and uniform metadata are represented
implicitly, as permitted by 02 §3.1. This is the building-only specialization, not an
implementation of terrain, crown materials, acquisition, or a production tile cache.

Madrid's smaller nested rings remain the **separate solid prisms actually in the corpus**.
They were not reinterpreted as courtyard holes. This preserves the settled test inputs;
it does not validate v2's future hole handling.

### Results

[MEASURED] Fractions below use the harness's 0–1 scale. Severe means **strictly >0.25**;
p90 uses nearest rank over all 300 readings. Worst is not gated.

| Metric | Committed ceiling | z17 | z18 | z19 | z20 |
|---|---:|---:|---:|---:|---:|
| Mean absolute disagreement | ≤0.04 | 0.149095 | 0.148988 | 0.148988 | 0.148631 |
| p90 | ≤0.05 | 0.636364 | 0.636364 | 0.636364 | 0.636364 |
| Share >0.25 | ≤0.04 | 0.206667 (62/300) | 0.213333 (64/300) | 0.223333 (67/300) | 0.216667 (65/300) |
| Madrid mean | ≤0.08 | 0.135341 | 0.116591 | 0.116591 | 0.116591 |
| Singapore mean | ≤0.08 | 0.144444 | 0.135873 | 0.145873 | 0.147302 |
| Kent WA mean | ≤0.08 | 0.167500 | 0.194500 | 0.184500 | 0.182000 |
| Worst reading | — | 0.800000 | 1.000000 | 1.000000 | 1.000000 |
| Verdict | All ceilings | **Fail** | **Fail** | **Fail** | **Fail** |

[MEASURED] **Worst z17 case:** zero-based fixture **144**, Kent WA,
`2026-12-21T22:00:00.000Z`, edge
`[-122.23522453186642, 47.380612540423996]` →
`[-122.23437546813359, 47.381187459576]`.
Fixture sun: azimuth **0.46432218516111284 rad**, altitude
**0.2578427699556416 rad**. Reference `{left:0.4, right:0}`;
candidate `{left:1, right:0.8}`. Right disagreement is **0.8**; left is **0.6**.
Six of this edge's ten sidewalk locations begin in rasterized building cells.
The same case is worst at z18–z20, with candidate right **1** against reference **0**.

### Why there is no passing finer lattice

[CONFIRMED] The reference painter in
[`harness.ts`](../../app/lib/shadowField/__tests__/agreement/harness.ts)
explicitly suppresses ground shadows inside **any** building footprint (`onRoof`).
The legacy field does likewise in
[`shadowIndex.ts`](../../app/lib/shadowField/shadowIndex.ts).
02 §6 instead specifies ground-level route receivers, one-quantum lift, and an opaque
building interval starting at ground. A receiver inside that interval immediately
intersects it. Several retained diagonal fixture edges run through buildings.

[MEASURED + DERIVED] The embedded diagnostic selects only daytime sample points whose
distance from an input footprint boundary exceeds **√(1/2) z17 grid units**. The center
of a containing cell at z17 or any finer lattice is at most that distance from its
receiver. These points therefore remain inside an occupied cell at every refinement;
positive-height buildings force their literal §6 shade to one.

For each sidewalk, let `f` be the fraction of those guaranteed interior points and `r`
the **unchanged pixel reference fraction**. Its disagreement is at least
`max(0, f - r)`, regardless of every other point's answer. Running the committed report
function on these lower bounds gives:

| Unavoidable lower bound, all z≥17 | Value | Ceiling |
|---|---:|---:|
| Mean | 0.091724 | 0.04 |
| p90 | 0.545455 | 0.05 |
| Severe share | 0.150000 (45/300) | 0.04 |
| Madrid mean | 0.062727 | 0.08 |
| Singapore mean | 0.124444 | 0.08 |
| Kent WA mean | 0.088000 | 0.08 |

This is a geometric lower bound over measured fixture locations, not an extrapolated
performance result. It rules out a resolution-only repair under the tested specification.
**Finest passing lattice: none.** z20 is the finest one explicitly rasterized; the
lower bound makes further refinement unnecessary. No roof-exclusion variant was used
to claim a pass. The spike does not decide how 02 should reconcile the two contracts.

### Memory consequence

[DERIVED] Resolution does **not** change the schema's **24 bytes per cell per copy**
(four Int32 heights plus two Uint32 metadata bands), or **48 bytes per cell** for CPU
and GPU copies together. A 256² logical tile remains **1.5 MiB per copy**. Finer zoom
quadruples cells and memory for the same geographic area at each step.

| Grid | Ground spacing: Madrid / Singapore / Kent, metres | One copy over the area of 2048² z17 cells | CPU + GPU |
|---|---|---:|---:|
| z17 | 0.909300 / 1.193996 / 0.808705 | 96 MiB | 192 MiB |
| z18 | 0.454650 / 0.596998 / 0.404353 | 384 MiB | 768 MiB |
| z19 | 0.227325 / 0.298499 / 0.202176 | 1536 MiB | 3072 MiB |
| z20 | 0.113662 / 0.149249 / 0.101088 | 6144 MiB | 12288 MiB |

Method: 02 §6's spacing formula evaluated at the three fixture-center latitudes;
`24 * cellCount`, with `4^(z-17)` area scaling. These are payload calculations,
excluding the same gutters, hierarchy, caches, tables, buffering, and driver overhead
excluded by 02. There is **no passing-grid memory estimate**, because no grid passes.

## S2 — one real route batch, low-sun march and sparse horizons

### Data, hardware, and timing boundaries

[MEASURED] A live Overpass capture supplied the street graph for the recorded Madrid
Plaza Mayor walk: requested endpoints `[-3.706459,40.415402]` and
`[-3.7075,40.4173]`, graph request bbox `(south,west,north,east)`
`(40.414,-3.709,40.418,-3.702)`. The unchanged `fetchRoutingGraph`, `snapToGraph`, and
`dijkstra(...,0)` functions returned the **280.649264 m, 20-node** route. The timed
batch is the **whole returned graph before search**, as the real caller samples it,
not just the chosen path: **260 ways, 820 nodes, 1816 directed adjacency entries,
908 unique canonical edges, 7314 inclusive sidewalk sample locations**. Negative
virtual nodes are excluded and endpoint IDs determine canonical edge direction.
The capture's road subset uses the production highway filter and excludes area ways.

[MEASURED] Buildings were fetched in the surrounding bbox
`(40.405,-3.720,40.427,-3.690)`: **5658 closed building ways**, with **4552 using the
existing Overpass 10 m default**, and maximum normalized height **117 m**. Height
priority is positive `render_height`, positive `height`, positive `building:levels * 3`,
then 10 m. This capture does not resolve relation holes, building parts, missing buildings,
terrain, or canopy. It supplies real OSM footprint geometry for a deliberately finite,
flat, opaque scene; it is not a survey of real shade or a test of source completeness.

Capture: **2026-09-12T14:44:08.864030Z**; source timestamp
**2026-09-12T14:42:20Z**. The embedded capture script records the exact query and endpoint.
Attribution: **© OpenStreetMap contributors**,
[ODbL 1.0](https://www.openstreetmap.org/copyright). The committed route capture used
to select these endpoints is documented in
[`fixtures/README.md`](../../app/lib/guidance/__tests__/fixtures/README.md).

[MEASURED] Hardware: **Intel Core i7-12700H**, 20 logical CPUs exposed to WSL2;
Linux `6.18.33.2-microsoft-standard-WSL2`, x86-64; Node **v20.20.1**;
Playwright Chromium **153.0.8010.12**. S1 executes in Node; all S2 CPU measurements
execute synchronously on Chromium's main thread. No CPU/network throttling was enabled.
A local cross-origin-isolated probe page provides the high-resolution clock; this is
probe configuration, not a new application requirement. No SharedArrayBuffer or worker
participates in sampling.

The hardware WebGL renderer actually used was:

```text
ANGLE (Microsoft Corporation, D3D12 (Intel(R) Iris(R) Xe Graphics), OpenGL 4.1)
```

Headless default Chromium exposed SwiftShader. Headless GL/Vulkan/EGL attempts with
software fallback disabled did not create WebGL2 contexts. **Headed Chromium through
WSLg, ANGLE GL, with software fallback disabled exposed the Intel hardware and GPU
timers.** The machine also reported an NVIDIA RTX 3050 Ti Laptop GPU through
`nvidia-smi`; that was not the renderer measured. No SwiftShader timing is presented
as hardware-GPU performance.

All conditions use **z17**, ground zero, no canopy, and fixed sun azimuth
**135° clockwise from north** (SunCalc **−45°**). Only altitude changes. The CPU
kernel is the same DDA used for S1. It visits all intersected leaf cells until the
first opaque hit, the maximum-height bound, or the finite scene's extent. It does not
apply the old 400 m cap. This probe has a global extent/height bound, **no multilevel
empty-space skipping**, and no acquisition work. It measures the basic interval march;
it neither benchmarks nor rules out the hierarchy acceleration already specified in 02.

The immutable dense bounding rectangle is **3364×3046 cells**. The varying Int32
building band occupies **40,986,976 bytes (39.088 MiB)** per copy; the other bands are
constant/absent. A full six-band payload over that rectangle would be
**245,921,856 bytes (234.529 MiB)** per copy, derived from its dimensions. This is not
measured process/GPU residency. One untimed preparation run measured rasterization at
**917.955 ms** and sidewalk-layout preparation at **2.800 ms**; sample count one each,
so each is also its observed worst. Fetch, preparation, shader compilation, input upload,
and layout are excluded from all warm query tables.

Every timing condition executes **25 calls**, discards five warmups, and retains
**20 measured calls**. Median means sorted index 10; worst means the largest observed
call in that condition. CPU wall time is `performance.now()` around a synchronous
`sampleEdges`-shaped call including fresh output allocation and sidewalk aggregation.
Prepared locations are reused; final shade answers are recomputed on every call.

The independently written GPU fragment kernel evaluates one sample slot per fragment
in a **128×58** integer output target, with padded slots excluded. It consumes the same
Int32 height payload, and float local coordinates. GPU elapsed time uses
`EXT_disjoint_timer_query_webgl2`; each result is awaited, disjoint samples are rejected,
and every measured call checks for GL errors. The run completed without a disjoint
result or GL error. Its **synchronous batch wall** column additionally includes blocking
`readPixels` and CPU sidewalk aggregation. Timer polling is outside that wall interval.
GPU elapsed and wall measurements overlap and must not be added.

This GPU readback wrapper is a diagnostic comparator. It does not implement the
permitted production routing path: **02 still requires CPU arrays and synchronous
queries without GPU readback**. These are route-point kernel timings, not map-frame
or full-screen renderer timings.

### Direct interval march

[MEASURED] CPU milliseconds per complete 908-edge batch. Cell counts are over all
7314 point evaluations at each altitude, count positive-length visited leaf intervals,
and are deterministic for these inputs. They include early termination and exclude
the certified empty exterior of the finite scene.

| Altitude | CPU wall median / worst, ms | Cells/point mean | Cells/point median / worst | Total cells/batch | Mean sidewalk shade |
|---|---:|---:|---:|---:|---:|
| 45° | 9.260 / 15.050 | 113.254 | 183 / 183 | 828340 | 0.398605 |
| 10° | 16.840 / 17.475 | 204.277 | 29 / 1033 | 1494082 | 0.826863 |
| 3° | 4.750 / 5.070 | 57.220 | 29 / 3472 | 418505 | 0.999036 |
| 1° | 4.425 / 4.800 | 54.359 | 29 / 391 | 397582 | 1.000000 |

[MEASURED] Hardware GPU on the identical batch:

| Altitude | GPU elapsed median / worst, ms | Synchronous batch wall median / worst, ms | GPU cells/point mean | GPU cells/point median / worst |
|---|---:|---:|---:|---:|
| 45° | 0.765677 / 0.883073 | 2.720 / 5.255 | 113.241 | 183 / 183 |
| 10° | 2.017969 / 4.001667 | 4.080 / 5.780 | 204.277 | 29 / 1033 |
| 3° | 3.347709 / 3.911771 | 5.385 / 6.240 | 57.218 | 29 / 3472 |
| 1° | 0.738958 / 0.982916 | 2.720 / 5.240 | 54.357 | 29 / 391 |

[MEASURED] Every final GPU edge fraction matched the CPU counterpart at these four
altitudes: maximum difference **0** over **7264 sidewalk comparisons**. CPU/GPU visited
cell counts are slightly different because the GPU uses Float32 local coordinates
and arithmetic. Matching edge fractions on this batch does not establish universal
corner/boundary conformance or replace 02's future numeric agreement corpus.

**Interpretation:** cost is not monotonic in inverse sun altitude on this dense street
scene. At 1°, every sampled sidewalk point hits an opaque caster and stops; clear rays
at 10° do substantially more work. The largest observed per-point traversal is at 3°:
**3472 cells**, despite a batch median of only **29**. The GPU also takes its longest
median interval at 3°, despite lower total cell work than 10°; divergent long rays are
a plausible explanation, not independently profiled attribution. This one batch does
not establish an open-country, distant-ridge, canopy, or worst-case low-sun bound.

### Sparse per-route-point horizon precompute and query

The precompute scans the same finite field for **each of the 7314 sample slots**, storing
the maximum opaque obstruction **slope** `(B - 1/64) / distance` at the **one exact
azimuth used above**. Comparing `tan(altitude)` with the stored slope avoids angle
encoding. An interior receiver has an infinite horizon; no footprint exclusion is added.
The precompute visits the entire intersected scene extent rather than stopping at the
first opaque hit. The query performs one comparison per slot and aggregates the same
908 edge results. No DSM cells are traversed during horizon queries.

This is sparse in receiver locations, not a dense horizon atlas. **It precomputes one
direction, not a 72-bin or 360-bin all-azimuth horizon.** Changing azimuth needs a new
entry/precompute; no interpolation or untested angular approximation is used. The four
altitude queries reuse the same horizon. These costs therefore do not establish the
cost of arbitrary time scrubbing, an annual trajectory, or canopy transmission.

[MEASURED] Precompute cost, 20 retained independent rebuilds of the horizon array/target:

| Precompute | Wall median / worst, ms | GPU elapsed median / worst, ms | Cells/point mean | Cells/point median / worst |
|---|---:|---:|---:|---:|
| CPU | 235.150 / 266.045 | — | 3204.342 | 3181 / 3892 |
| Hardware GPU | 5.965 / 7.790 | 4.301927 / 4.563021 | 3203.881 | 3181 / 3892 |

The GPU wall measurement includes completion/readback of the slope target; its
precomputed texture is then reused by the GPU query. CPU horizon storage is a
**58,512-byte Float64Array** (8 bytes per sample slot). The probe GPU target stores
float slope bits and instrumentation in RGBA32UI: **118,784 bytes** including padding;
the actual slope component is 4 bytes per logical slot. These are array/texture payloads,
not total cache or driver memory. No global deduplication of sample slots was performed.

[MEASURED] Warm horizon queries, milliseconds per complete batch; **zero traversed
DSM cells per point** in every row:

| Altitude | CPU wall median / worst | GPU elapsed median / worst | GPU synchronous batch wall median / worst |
|---|---:|---:|---:|
| 45° | 0.135 / 0.195 | 0.021875 / 0.034375 | 1.795 / 2.335 |
| 10° | 0.060 / 0.080 | 0.044739 / 0.047761 | 2.065 / 2.975 |
| 3° | 0.055 / 0.095 | 0.044323 / 0.643541 | 1.970 / 6.290 |
| 1° | 0.055 / 0.090 | 0.045208 / 0.047083 | 2.045 / 4.280 |

[MEASURED] CPU horizon queries and GPU horizon queries each matched the direct CPU
march's edge fractions exactly: maximum difference **0**, **7264 sidewalk comparisons
per method** across four altitudes. Repeated timing calls reuse the same scene and are
not additional independent agreement cases. The 3° GPU-query outlier is retained in
the worst columns, not removed as an inconvenient sample.

## What these numbers imply for 02

- **§3.1, §6, §10.1:** the unchanged agreement gate cannot be satisfied by choosing a
  finer lattice alone. The specified receiver/opaque-column semantics conflict with
  the retained reference's footprint exclusion. S1 does not isolate a usable grid
  resolution until that conflict is reconciled. This document selects no amendment.
- **§6, §7.3:** the measured basic CPU march is synchronous and costs up to **17.475 ms**
  in this warm, building-only route batch. Low sun does not force a slowdown here,
  because opaque hits terminate traversal. This is no release-wide latency bound,
  no measurement of acquisition within 2500 ms, and no validation of long-range
  terrain/canopy or hierarchy performance. No new SLO or watchdog limit is inferred.
- **§8.2:** sparse exact-direction opaque horizons make warm CPU queries much cheaper,
  with a measurable preparation cost. They remain an optional accelerator whose
  usefulness depends on reuse; one route calculation does not amortize this CPU
  precompute. The measurements do not justify promoting horizons to the authoritative
  field or changing canopy semantics.
- **§3.2:** GPU kernel execution is fast on the available Intel hardware, while synchronous
  readback retains millisecond wall cost. That does not change the CPU routing contract.
  Neither the compact single-band spike nor GPU throughput resolves the full schema's
  memory-residency risk.

**Stop condition met:** both spikes have measured numbers. No Phase 3 work, architecture
redesign, ceiling relaxation, application edit, or branch was undertaken. Amendment of
02 is left to the requested later session.

## Reproduction and evidence

The following complete probes were kept under `/tmp/umbra-02a/`. Save each code block
under its named filename. Paths name this workspace; adjust them together on another
machine. Use the pinned checkout and its existing dependency installation. No external
simulator source or shader was copied. The JavaScript and GLSL DDA were written for
this spike from 02's interval specification.

```bash
mkdir -p /tmp/umbra-02a
ln -s /home/wslunusn/ShadeMapNavigation/node_modules /tmp/umbra-02a/node_modules
# Legacy gate, unchanged:
npx vitest run app/lib/shadowField/__tests__/agreement/agreement.test.ts
# Candidate gate: expected to exit 1 with four failing assertions at z17.
npx vitest run --config /tmp/umbra-02a/vitest.config.mjs
# Four resolutions, worst cases, and the all-finer-grid lower bound:
node /tmp/umbra-02a/s1.mjs
# S2: fetch once, prepare with production graph parsing, then time resident data.
python /tmp/umbra-02a/capture.py
node /tmp/umbra-02a/prepare.mjs
LD_LIBRARY_PATH=/home/wslunusn/miniconda3/lib node /tmp/umbra-02a/gpu.mjs
LD_LIBRARY_PATH=/home/wslunusn/miniconda3/lib node /tmp/umbra-02a/gpu-headed.mjs
LD_LIBRARY_PATH=/home/wslunusn/miniconda3/lib node /tmp/umbra-02a/run-browser.mjs
```

`run-browser.mjs` bundles only the temporary probe, serves it at `127.0.0.1:5191`,
and closes its browser and server. It requires a working headed display/WSLg for this
machine's hardware path. Its hardware check rejects SwiftShader/llvmpipe. S1's gate
setup uses `LATTICE_Z` if supplied; the recorded unchanged-test candidate run used z17.
The core's optional `excludeOrigin` parameter was **false in every reported run**.

The OSM response is live input, unlike S1's committed deterministic corpus. The capture
script below fetches current data; later captures may differ. To reconstruct source-time
geometry, an Overpass server with history can be queried using the recorded OSM timestamp
as a `[date:"2026-09-12T14:42:20Z"]` setting; that historical replay was not performed in
this spike. Raw capture and normalized-input hashes identify this run. The timed source
was the final filtered road batch described above; an exploratory combined-response
parse that admitted a building tagged `highway=elevator` was corrected and its timings
discarded before producing these tables.

The finite capture's exterior is known empty **only by the definition of the probe
scene**. In production it would be unproved coverage, not a certificate based on the
tallest loaded building. No world-completeness claim is made from these truncated inputs.

<details>
<summary>core.mjs</summary>

```js
export const Q=1/64, R=6378137, C=2*Math.PI*R;
export function project(lng,lat,z){const n=256*2**z;return [(lng+180)/360*n,(.5-Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))/(2*Math.PI))*n];}
export function inside(x,y,ring){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
// Compact absent/constant bands are allowed by 02 §3.1. Only B varies in this spike.
export function rasterize(objects,z){
 const polygons=objects.map(p=>({...p,rings:(p.rings??[p.ring]).map(r=>r.map(([x,y])=>project(x,y,z)))}));
 let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
 for(const p of polygons)for(const r of p.rings)for(const [x,y]of r){x0=Math.min(x0,Math.floor(x));x1=Math.max(x1,Math.ceil(x));y0=Math.min(y0,Math.floor(y));y1=Math.max(y1,Math.ceil(y));}
 const w=x1-x0,h=y1-y0,B=new Int32Array(w*h);let maxQ=0;
 for(const p of polygons){const ring=p.rings[0],xs=ring.map(a=>a[0]),ys=ring.map(a=>a[1]),q=Math.round(p.heightM*64);maxQ=Math.max(maxQ,q);
  for(let y=Math.floor(Math.min(...ys));y<Math.ceil(Math.max(...ys));y++)for(let x=Math.floor(Math.min(...xs));x<Math.ceil(Math.max(...xs));x++){
   if(inside(x+.5,y+.5,ring)&&!p.rings.slice(1).some(r=>inside(x+.5,y+.5,r))){const i=(y-y0)*w+x-x0;B[i]=Math.max(B[i],q);}
  }
 }
 return {z,x0,y0,w,h,B,maxQ};
}
export function layout(edges,z,helpers){
 const {sidewalkOffsets,edgeSampleCount,metersPerDegree}=helpers,points=[],groups=[];
 for(const e of edges){const lat=(e.from[1]+e.to[1])/2,m=metersPerDegree(lat),length=Math.hypot((e.to[0]-e.from[0])*m.mPerLng,(e.to[1]-e.from[1])*m.mPerLat),n=edgeSampleCount(length),offsets=sidewalkOffsets(e),start=points.length;
  for(const side of ['left','right'])for(let i=0;i<=n;i++){const lng=e.from[0]+i/n*(e.to[0]-e.from[0])+offsets[side][0],phi=e.from[1]+i/n*(e.to[1]-e.from[1])+offsets[side][1];points.push([...project(lng,phi,z),C*Math.cos(lat*Math.PI/180)/(256*2**z),lng,phi]);}
  groups.push({start,n:n+1});
 }
 return {points,groups};
}
// Direction: fixture SunCalc azimuth -> east=-sin(a), south=cos(a).
export function ray(sun){return {dx:Math.fround(-Math.sin(sun.azimuth)),dy:Math.fround(Math.cos(sun.azimuth)),slope:Math.fround(Math.tan(sun.altitude))};}
// Flat G, no crowns. Global extent/max is a complete bound for this finite snapshot only.
// Positive-length overlap, half-open cells, simultaneous corner advance, origin lift Q.
// Horizon stores max slope at this exact azimuth/receiver; no angular interpolation.
export function trace(f,p,d,horizon=false,excludeOrigin=false){
 const [px,py,m]=p,{dx,dy,slope}=d;
 if(!horizon&&slope<=0)return {value:1,cells:0};
 const ox=px-f.x0,oy=py-f.y0;
 if(excludeOrigin&&ox>=0&&oy>=0&&ox<f.w&&oy<f.h&&f.B[Math.floor(oy)*f.w+Math.floor(ox)]>0)return {value:0,cells:0};
 let lo=0,hi=horizon?Infinity:Math.max(0,(f.maxQ/64-Q)/(m*slope));
 for(const [o,v,size]of [[ox,dx,f.w],[oy,dy,f.h]]){if(v===0){if(o<0||o>=size)return {value:0,cells:0};}else{const a=-o/v,b=(size-o)/v;lo=Math.max(lo,Math.min(a,b));hi=Math.min(hi,Math.max(a,b));}}
 if(!(hi>lo))return {value:0,cells:0};
 const sx=Math.sign(dx),sy=Math.sign(dy),xx=ox+dx*lo,yy=oy+dy*lo;
 let x=Math.floor(xx),y=Math.floor(yy);if(dx<0&&xx===x)x--;if(dy<0&&yy===y)y--;
 // Correct floating error at clipped outer boundary, without stepping over interior cells.
 x=Math.max(0,Math.min(f.w-1,x));y=Math.max(0,Math.min(f.h-1,y));
 const tx=dx===0?Infinity:Math.abs(1/dx),ty=dy===0?Infinity:Math.abs(1/dy);
 let nx=dx===0?Infinity:((sx>0?x+1:x)-ox)/dx,ny=dy===0?Infinity:((sy>0?y+1:y)-oy)/dy,t=lo,cells=0,best=0;
 while(t<hi&&x>=0&&y>=0&&x<f.w&&y<f.h){const end=Math.min(nx,ny,hi);if(end>t){cells++;const height=f.B[y*f.w+x]/64;
  if(height>Q){if(horizon){best=Math.max(best,t===0?Infinity:(height-Q)/(t*m));}else if(Q+t*m*slope<height)return {value:1,cells};}
 }
 if(end>=hi)break;
 const advanceX=nx<=ny,advanceY=ny<=nx;if(advanceX){x+=sx;nx+=tx;}if(advanceY){y+=sy;ny+=ty;}t=end;
 }
 return {value:horizon?best:0,cells};
}
export function aggregate(plan,values){return plan.groups.map(({start,n})=>{let left=0,right=0;for(let i=0;i<n;i++){left+=values[start+i];right+=values[start+n+i];}return {left:left/n,right:right/n,source:'tiles',confidence:.8,buildingSource:'tiles',canopySources:{osm:false,raster:false}};});}
export function sampleEdges(f,plan,sun,horizons){const d=ray(sun),values=new Uint8Array(plan.points.length);for(let i=0;i<values.length;i++)values[i]=horizons?Number(d.slope<horizons[i]):trace(f,plan.points[i],d).value;return aggregate(plan,values);}
export function precompute(f,plan,azimuth){const d=ray({azimuth,altitude:1}),out=new Float64Array(plan.points.length);for(let i=0;i<out.length;i++)out[i]=trace(f,plan.points[i],d,true).value;return out;}
export function stats(a){const s=[...a].sort((a,b)=>a-b);return {n:a.length,mean:a.reduce((a,b)=>a+b,0)/a.length,median:s[Math.floor(s.length/2)],p90:s[Math.ceil(.9*s.length)-1],worst:s.at(-1)};}
```

</details>

<details>
<summary>s1.mjs</summary>

```js
import fs from 'node:fs';
import {createServer} from '/home/wslunusn/ShadeMapNavigation/node_modules/vite/dist/node/index.js';
import * as core from './core.mjs';
const root='/home/wslunusn/ShadeMapNavigation',v=await createServer({root,configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom'});
try{
 const {agreementFixtures,sunFor}=await v.ssrLoadModule('/app/lib/shadowField/__tests__/agreement/fixtures.ts');
 const harness=await v.ssrLoadModule('/app/lib/shadowField/__tests__/agreement/harness.ts');
 const field=await v.ssrLoadModule('/app/lib/shadowField/ShadowField.ts'),geo=await v.ssrLoadModule('/app/lib/shadowField/geometry.ts');
 const helpers={...field,...geo},fixtures=agreementFixtures(),refs=fixtures.map(f=>{const s=sunFor(f);return harness.referenceFor(f,s,s.altitudeFraction);}),results=[];
 for(const z of [17,18,19,20]){
  const fields=new Map(),rows=[];
  for(let i=0;i<fixtures.length;i++){
   const fixture=fixtures[i];if(!fields.has(fixture.city))fields.set(fixture.city,core.rasterize(fixture.prisms.prisms,z));
   const f=fields.get(fixture.city),plan=core.layout([fixture.edge],z,helpers),sun=sunFor(fixture),answer=core.sampleEdges(f,plan,sun)[0];
   rows.push({i,city:fixture.city,when:fixture.when.toISOString(),edge:fixture.edge,sun,answer,reference:refs[i],left:Math.abs(answer.left-refs[i].left),right:Math.abs(answer.right-refs[i].right),originInside:plan.points.filter(p=>{const x=Math.floor(p[0])-f.x0,y=Math.floor(p[1])-f.y0;return x>=0&&y>=0&&x<f.w&&y<f.h&&f.B[y*f.w+x]>0;}).length});
  }
  const report=harness.reportFor(rows),worst=rows.filter(r=>r.left===report.worst||r.right===report.worst),grids=[...fields.entries()].map(([city,f])=>({city,z,w:f.w,h:f.h,bytes:f.B.byteLength}));
  results.push({z,report,worst,grids,rows});console.log(JSON.stringify({z,report,worst,grids}));
 }
 const lower=fixtures.map((fixture,i)=>{
  const plan=core.layout([fixture.edge],17,helpers),sun=sunFor(fixture),values=plan.points.map(p=>Number(sun.altitude>0&&fixture.prisms.prisms.some(prism=>{
   const ring=prism.ring.map(([x,y])=>core.project(x,y,17));
   if(!core.inside(p[0],p[1],ring))return false;
   let min=Infinity;for(let j=1;j<ring.length;j++){const a=ring[j-1],b=ring[j],vx=b[0]-a[0],vy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*vx+(p[1]-a[1])*vy)/(vx*vx+vy*vy)));min=Math.min(min,Math.hypot(p[0]-a[0]-t*vx,p[1]-a[1]-t*vy));}
   return min>Math.SQRT1_2;
  }))),answer=core.aggregate(plan,values)[0];
  return {i,city:fixture.city,left:Math.max(0,answer.left-refs[i].left),right:Math.max(0,answer.right-refs[i].right)};
 });
 fs.writeFileSync('/tmp/umbra-02a/lower-bound.json',JSON.stringify({report:harness.reportFor(lower),rows:lower},null,2));
 fs.writeFileSync('/tmp/umbra-02a/s1.json' ,JSON.stringify(results,null,2));
}finally{await v.close();}
```

</details>

<details>
<summary>vitest.config.mjs</summary>

```js
export default {root:'/home/wslunusn/ShadeMapNavigation',test:{environment:'node',include:['app/lib/shadowField/__tests__/agreement/agreement.test.ts'],setupFiles:['/tmp/umbra-02a/candidate.setup.ts'],silent:false,reporters:['verbose']}};
```

</details>

<details>
<summary>candidate.setup.ts</summary>

```ts
import {vi} from 'vitest';
vi.mock('/home/wslunusn/ShadeMapNavigation/app/lib/shadowField/ShadowField.ts',async importOriginal=>{
 const actual:any=await importOriginal();
 const core=await import('/tmp/umbra-02a/core.mjs');
 const {metersPerDegree}=await import('/home/wslunusn/ShadeMapNavigation/app/lib/shadowField/geometry.ts');
 const {sunFor}=await import('/home/wslunusn/ShadeMapNavigation/app/lib/shadowField/__tests__/agreement/fixtures.ts');
 const cache=new WeakMap();
 return {...actual,createGeometryShadowField:(providers:any[])=>({sampleEdges:(edges:any[],when:Date)=>{
  const bbox=actual.bboxAroundEdges(edges,2000),set=providers[0].prismsFor(bbox);
  if(!set)throw Error('Candidate lacks corpus geometry');
  let f=cache.get(set);if(!f){f=core.rasterize(set.prisms,Number(process.env.LATTICE_Z??17));cache.set(set,f);}
  return edges.map(edge=>core.sampleEdges(f,core.layout([edge],f.z,{...actual,metersPerDegree}),sunFor({edge,when}))[0]);
 }})};
});
```

</details>

<details>
<summary>capture.py</summary>

```python
import urllib.request,urllib.parse,json,hashlib,datetime
query='''[out:json][timeout:45];(way["highway"~"^(footway|path|pedestrian|living_street|residential|unclassified|tertiary|secondary|service|cycleway|steps|track|bridleway)$"]["area"!="yes"](40.414,-3.709,40.418,-3.702);way["building"](40.405,-3.720,40.427,-3.690););out body geom;'''
url='https://overpass-api.de/api/interpreter'
req=urllib.request.Request(url,data=urllib.parse.urlencode({'data':query}).encode(),headers={'User-Agent':'Umbra/1.0 (+https://shademapnav.vercel.app)'})
with urllib.request.urlopen(req,timeout=60) as r: raw=r.read()
data=json.loads(raw)
if 'remark' in data: raise RuntimeError(data['remark'])
open('/tmp/umbra-02a/osm.json','wb').write(raw)
meta={'endpoint':url,'query':query,'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sha256':hashlib.sha256(raw).hexdigest(),'elements':len(data['elements']),'osm3s':data.get('osm3s')}
json.dump(meta,open('/tmp/umbra-02a/capture.json','w'),indent=2)
print(json.dumps(meta,indent=2))
```

</details>

<details>
<summary>prepare.mjs</summary>

```js
import fs from 'node:fs';
import {createServer} from '/home/wslunusn/ShadeMapNavigation/node_modules/vite/dist/node/index.js';
const root='/home/wslunusn/ShadeMapNavigation',v=await createServer({root,configFile:false,optimizeDeps:{noDiscovery:true,include:[]},server:{middlewareMode:true},appType:'custom'});
try{
 const raw=JSON.parse(fs.readFileSync('/tmp/umbra-02a/osm.json','utf8'));
 const roads=raw.elements.filter(e=>/^(footway|path|pedestrian|living_street|residential|unclassified|tertiary|secondary|service|cycleway|steps|track|bridleway)$/.test(e.tags?.highway)&&e.tags?.area!=='yes'),buildings=raw.elements.filter(e=>e.tags?.building&&e.geometry?.length>=4&&e.nodes[0]===e.nodes.at(-1));
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response(JSON.stringify({elements:roads}),{status:200});
 const {fetchRoutingGraph}=await v.ssrLoadModule('/app/lib/overpass.ts');
 const {snapToGraph,dijkstra}=await v.ssrLoadModule('/app/lib/routing.ts');
 const graph=await fetchRoutingGraph(40.414,-3.709,40.418,-3.702);globalThis.fetch=original;
 const edges=[],seen=new Set();let directed=0;
 for(const [id,list]of graph.adj)for(const e of list){if(id<0||e.toId<0)continue;directed++;const lo=Math.min(id,e.toId),hi=Math.max(id,e.toId),key=`${lo},${hi}`;if(seen.has(key))continue;seen.add(key);const a=graph.nodes.get(lo),b=graph.nodes.get(hi);edges.push({from:[a.lon,a.lat],to:[b.lon,b.lat]});}
 const endpoints=[[-3.706459,40.415402],[-3.7075,40.4173]],start=snapToGraph(endpoints[0],graph),end=snapToGraph(endpoints[1],graph);
 const route=dijkstra(graph,start,end,0); if(!route)throw Error("No route");
 let defaults=0;const objects=buildings.map(e=>{const t=e.tags;let heightM=Number(t.render_height);if(!(heightM>0))heightM=Number(t.height);if(!(heightM>0))heightM=Number(t['building:levels'])*3;if(!(heightM>0)){heightM=10;defaults++;}return {id:e.id,ring:e.geometry.map(p=>[p.lon,p.lat]),heightM};});
 const input={edges,objects,meta:{roads:roads.length,buildings:objects.length,defaultHeights:defaults,nodes:graph.nodes.size,directed,edges:edges.length,endpoints,routeDistanceM:route.distanceM,routeNodes:route.nodeIds.length}};
 fs.writeFileSync('/tmp/umbra-02a/input.json',JSON.stringify(input));console.log(JSON.stringify(input.meta));
}finally{await v.close();}
```

</details>

<details>
<summary>gpu.mjs</summary>

```js
import {chromium} from '/home/wslunusn/ShadeMapNavigation/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs';
const out=[];
for(const args of [[],['--use-gl=angle','--use-angle=gl','--disable-software-rasterizer'],['--use-gl=angle','--use-angle=vulkan','--disable-software-rasterizer'],['--use-gl=egl','--disable-software-rasterizer']]){
 let browser;try{browser=await chromium.launch({headless:true,args});const page=await browser.newPage();const r=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2');if(!gl)return {webgl2:false};const d=gl.getExtension('WEBGL_debug_renderer_info');return {webgl2:true,renderer:gl.getParameter(d.UNMASKED_RENDERER_WEBGL),timer:!!gl.getExtension('EXT_disjoint_timer_query_webgl2')};});out.push({args,version:browser.version(),...r});}catch(e){out.push({args,error:String(e).slice(0,1000)});}finally{await browser?.close();}}
fs.writeFileSync('/tmp/umbra-02a/gpu.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
```

</details>

<details>
<summary>gpu-headed.mjs</summary>

```js
import {chromium} from '/home/wslunusn/ShadeMapNavigation/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs';
const out=[];
for(const args of [[],['--use-gl=angle','--use-angle=gl','--disable-software-rasterizer'],['--use-gl=angle','--use-angle=vulkan','--disable-software-rasterizer'],['--use-gl=egl','--disable-software-rasterizer']]){
 let browser;try{browser=await chromium.launch({headless:false,args});const page=await browser.newPage();const r=await page.evaluate(()=>{const gl=document.createElement('canvas').getContext('webgl2');if(!gl)return {webgl2:false};const d=gl.getExtension('WEBGL_debug_renderer_info');return {webgl2:true,renderer:gl.getParameter(d.UNMASKED_RENDERER_WEBGL),timer:!!gl.getExtension('EXT_disjoint_timer_query_webgl2')};});out.push({args,version:browser.version(),...r});}catch(e){out.push({args,error:String(e).slice(0,1000)});}finally{await browser?.close();}}
fs.writeFileSync('/tmp/umbra-02a/gpu-headed.json',JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
```

</details>

<details>
<summary>gpu-kernel.mjs</summary>

```js
export function gpuKernel(f,plan,core){
 const gl=document.createElement('canvas').getContext('webgl2',{antialias:false}),ext=gl?.getExtension('EXT_disjoint_timer_query_webgl2');if(!gl||!ext)throw Error('Hardware WebGL2/timer unavailable');
 const debug=gl.getExtension('WEBGL_debug_renderer_info'),renderer=gl.getParameter(debug.UNMASKED_RENDERER_WEBGL);if(/SwiftShader|llvmpipe/i.test(renderer))throw Error('Software renderer');
 const width=128,height=Math.ceil(plan.points.length/width),count=plan.points.length;
 function texture(unit,internal,w,h,format,type,data){const t=gl.createTexture();gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.NEAREST);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);gl.texImage2D(gl.TEXTURE_2D,0,internal,w,h,0,format,type,data);return t;}
 texture(0,gl.R32I,f.w,f.h,gl.RED_INTEGER,gl.INT,f.B);
 const pts=new Float32Array(width*height*4);plan.points.forEach((p,i)=>pts.set([p[0]-f.x0,p[1]-f.y0,p[2],0],i*4));texture(1,gl.RGBA32F,width,height,gl.RGBA,gl.FLOAT,pts);
 const out=texture(3,gl.RGBA32UI,width,height,gl.RGBA_INTEGER,gl.UNSIGNED_INT,null),horizon=texture(2,gl.RGBA32UI,width,height,gl.RGBA_INTEGER,gl.UNSIGNED_INT,null);
 const fb=gl.createFramebuffer();gl.bindFramebuffer(gl.FRAMEBUFFER,fb);
 const vertex=`#version 300 es
 void main(){vec2 p=vec2(float((gl_VertexID<<1)&2),float(gl_VertexID&2));gl_Position=vec4(p*2.-1.,0,1);}`;
 const fragment=`#version 300 es
 precision highp float;precision highp int;precision highp isampler2D;precision highp usampler2D;
 uniform isampler2D buildings;uniform sampler2D points;uniform usampler2D horizons;
 uniform ivec2 size;uniform int count;uniform int mode;uniform vec3 ray;uniform float maxH;
 layout(location=0)out uvec4 result;
 const float q=1./64.;const float inf=1.e30;
 void main(){ivec2 uv=ivec2(gl_FragCoord.xy);int id=uv.y*128+uv.x;result=uvec4(0);if(id>=count)return;
  if(mode==2){result.x=ray.z<uintBitsToFloat(texelFetch(horizons,uv,0).x)?1u:0u;return;}
  vec3 p=texelFetch(points,uv,0).xyz;float lo=0.,hi=mode==1?inf:max(0.,(maxH-q)/(p.z*ray.z));
  for(int a=0;a<2;a++){float o=p[a],v=ray[a];if(v==0.){if(o<0.||o>=float(size[a]))return;}else{float s=-o/v,t=(float(size[a])-o)/v;lo=max(lo,min(s,t));hi=min(hi,max(s,t));}}
  if(!(hi>lo))return;vec2 entry=p.xy+ray.xy*lo;ivec2 cell=ivec2(floor(entry)),step=ivec2(sign(ray.xy));
  for(int a=0;a<2;a++)if(ray[a]<0.&&entry[a]==float(cell[a]))cell[a]--;
  cell=clamp(cell,ivec2(0),size-1);vec2 delta=vec2(inf),next=vec2(inf);
  for(int a=0;a<2;a++)if(ray[a]!=0.){delta[a]=abs(1./ray[a]);next[a]=(float(cell[a]+(step[a]>0?1:0))-p[a])/ray[a];}
  float t=lo,best=0.;uint cells=0u;
  // A straight ray crosses at most width+height+1 cells in this finite rectangle.
  for(int k=0;k<32768;k++){if(t>=hi||any(lessThan(cell,ivec2(0)))||any(greaterThanEqual(cell,size)))break;
   float end=min(hi,min(next.x,next.y));if(end>t){cells++;float h=float(texelFetch(buildings,cell,0).r)/64.;if(h>q){if(mode==1)best=max(best,t==0.?inf:(h-q)/(t*p.z));else if(q+t*p.z*ray.z<h){result=uvec4(1u,cells,0u,0u);return;}}}
   if(end>=hi)break;bool ax=next.x<=next.y,ay=next.y<=next.x;if(ax){cell.x+=step.x;next.x+=delta.x;}if(ay){cell.y+=step.y;next.y+=delta.y;}t=end;
  }
  result=uvec4(mode==1?floatBitsToUint(best):0u,cells,0u,0u);
 }`;
 function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;}
 const program=gl.createProgram();gl.attachShader(program,shader(gl.VERTEX_SHADER,vertex));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,fragment));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
 const u=n=>gl.getUniformLocation(program,n);gl.uniform1i(u('buildings'),0);gl.uniform1i(u('points'),1);gl.uniform1i(u('horizons'),2);gl.uniform2i(u('size'),f.w,f.h);gl.uniform1i(u('count'),count);gl.uniform1f(u('maxH'),f.maxQ/64);gl.viewport(0,0,width,height);
 const read=new Uint32Array(width*height*4),values=new Uint8Array(count);
 async function measure(mode,sun){
  const d=core.ray(sun);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,mode===1?horizon:out,0);
  // Avoid a sampler/attachment feedback loop even when its branch is inactive.
  gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,mode===1?out:horizon);
  if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw Error('incomplete FBO');
  const query=gl.createQuery();gl.beginQuery(ext.TIME_ELAPSED_EXT,query);const start=performance.now();
  gl.uniform1i(u('mode'),mode);gl.uniform3f(u('ray'),d.dx,d.dy,d.slope);gl.drawArrays(gl.TRIANGLES,0,3);gl.endQuery(ext.TIME_ELAPSED_EXT);
  gl.readPixels(0,0,width,height,gl.RGBA_INTEGER,gl.UNSIGNED_INT,read);
  let answer=null;if(mode!==1){for(let i=0;i<count;i++)values[i]=read[i*4];answer=core.aggregate(plan,values);}const wallMs=performance.now()-start;
  gl.flush();const waitStart=performance.now();while(!gl.getQueryParameter(query,gl.QUERY_RESULT_AVAILABLE)){if(performance.now()-waitStart>10000)throw Error('timer timeout');await new Promise(r=>setTimeout(r,1));}
  if(gl.getParameter(ext.GPU_DISJOINT_EXT))throw Error('disjoint sample');const gpuMs=gl.getQueryParameter(query,gl.QUERY_RESULT)/1e6;gl.deleteQuery(query);
  if(gl.getError()!==gl.NO_ERROR)throw Error('GL error');return {wallMs,gpuMs,answer,cells:Array.from({length:count},(_,i)=>read[4*i+1])};
 }
 return {renderer,width,height,measure};
}
```

</details>

<details>
<summary>browser-entry.ts</summary>

```ts
import * as core from './core.mjs';
import {gpuKernel} from './gpu-kernel.mjs';
import {sidewalkOffsets,edgeSampleCount} from '/home/wslunusn/ShadeMapNavigation/app/lib/shadowField/ShadowField.ts';
import {metersPerDegree} from '/home/wslunusn/ShadeMapNavigation/app/lib/shadowField/geometry.ts';
const helpers={sidewalkOffsets,edgeSampleCount,metersPerDegree};
window.runSpike=async(input,emit)=>{
 const t0=performance.now(),f=core.rasterize(input.objects,17),composeMs=performance.now()-t0,t1=performance.now(),plan=core.layout(input.edges,17,helpers),layoutMs=performance.now()-t1;
 const azimuth=-Math.PI/4,angles=[45,10,3,1],suns=angles.map(a=>({azimuth,altitude:a*Math.PI/180}));
 const n=20,warmup=5,cpu=[],gpu=[];let horizons;
 const compare=(a,b)=>Math.max(...a.flatMap((e,i)=>[Math.abs(e.left-b[i].left),Math.abs(e.right-b[i].right)]));
 for(let j=0;j<4;j++){
  const times=[];let answer;for(let i=0;i<n+warmup;i++){const t=performance.now();answer=core.sampleEdges(f,plan,suns[j]);const ms=performance.now()-t;if(i>=warmup)times.push(ms);}
  const visits=plan.points.map(p=>core.trace(f,p,core.ray(suns[j])).cells);
  cpu.push({altitude:angles[j],times,wallMs:core.stats(times),cells:core.stats(visits),totalCells:visits.reduce((a,b)=>a+b,0),shade:answer.reduce((s,e)=>s+e.left+e.right,0)/(answer.length*2)});await emit({stage:'cpu-direct',...cpu.at(-1)});
 }
 const pt=[];for(let i=0;i<n+warmup;i++){const t=performance.now();horizons=core.precompute(f,plan,azimuth);const ms=performance.now()-t;if(i>=warmup)pt.push(ms);}
 const preVisits=plan.points.map(p=>core.trace(f,p,core.ray(suns[0]),true).cells),pre={times:pt,wallMs:core.stats(pt),cells:core.stats(preVisits),bytes:horizons.byteLength};await emit({stage:'cpu-precompute',...pre});
 for(let j=0;j<4;j++){const direct=core.sampleEdges(f,plan,suns[j]),times=[];let answer;for(let i=0;i<n+warmup;i++){const t=performance.now();answer=core.sampleEdges(f,plan,suns[j],horizons);const ms=performance.now()-t;if(i>=warmup)times.push(ms);}cpu[j].horizon={times,wallMs:core.stats(times),maxDifference:compare(direct,answer),cells:0};if(cpu[j].horizon.maxDifference)throw Error('CPU horizon mismatch');await emit({stage:'cpu-query',altitude:angles[j],...cpu[j].horizon});}
 const kernel=gpuKernel(f,plan,core);await emit({stage:'hardware',renderer:kernel.renderer});
 for(let mode of [0,1,2])for(let j=0;j<(mode===1?1:4);j++){
  const samples=[];let result;for(let i=0;i<n+warmup;i++){result=await kernel.measure(mode,suns[j]);if(i>=warmup)samples.push({wallMs:result.wallMs,gpuMs:result.gpuMs});}
  const row={mode,altitude:mode===1?null:angles[j],samples,wallMs:core.stats(samples.map(s=>s.wallMs)),gpuMs:core.stats(samples.map(s=>s.gpuMs)),cells:core.stats(result.cells),maxDifference:mode===1?null:compare(core.sampleEdges(f,plan,suns[j]),result.answer)};gpu.push(row);await emit({stage:'gpu',...row});
 }
 const meta={...input.meta,points:plan.points.length,z:17,grid:{w:f.w,h:f.h,x0:f.x0,y0:f.y0,compactBytes:f.B.byteLength,canonicalBytes:f.w*f.h*24,maxHeightM:f.maxQ/64},composeMs,layoutMs,azimuthSunCalcDeg:-45,azimuthNorthClockwiseDeg:135,renderer:kernel.renderer,output:[kernel.width,kernel.height],n,warmup,crossOriginIsolated};
 return {meta,cpu,pre,gpu};
};
```

</details>

<details>
<summary>run-browser.mjs</summary>

```js
import {build} from '/home/wslunusn/ShadeMapNavigation/node_modules/esbuild/lib/main.js';
import {chromium} from '/home/wslunusn/ShadeMapNavigation/node_modules/@playwright/test/index.mjs';
import fs from 'node:fs';import http from 'node:http';
await build({entryPoints:['/tmp/umbra-02a/browser-entry.ts'],bundle:true,format:'iife',platform:'browser',outfile:'/tmp/umbra-02a/probe.js'});
const server=http.createServer((req,res)=>{res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');if(req.url==='/probe.js'){res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync('/tmp/umbra-02a/probe.js'));}else res.end('<script src="/probe.js"></script>');});await new Promise(r=>server.listen(5191,'127.0.0.1',r));
const browser=await chromium.launch({headless:false,args:['--use-gl=angle','--use-angle=gl','--disable-software-rasterizer']});
try{const page=await browser.newPage();await page.exposeFunction('emit',r=>console.log(JSON.stringify(r)));await page.goto('http://127.0.0.1:5191/');const result=await page.evaluate(input=>window.runSpike(input,window.emit),JSON.parse(fs.readFileSync('/tmp/umbra-02a/input.json','utf8')));result.meta.browser=browser.version();fs.writeFileSync('/tmp/umbra-02a/s2.json',JSON.stringify(result,null,2));console.log(JSON.stringify({stage:'done',meta:result.meta}));}finally{await browser.close();await new Promise(r=>server.close(r));}
```

</details>

### Raw-result fingerprints

SHA-256 over the exact bytes of this run. Timings are expected to vary on rerun;
these hashes identify the recorded evidence rather than a timing acceptance test.

| Artifact in `/tmp/umbra-02a/` | SHA-256 |
|---|---|
| `osm.json` | `18400e028da693c14a993f34362e11b71c410e4ff99e6eef77645d18aedeee2c` |
| `input.json` | `2ec22e135419acbc52539becde88cb9342f20047a1c9be59e550467ca197a4aa` |
| `s1.json` | `600b2265df764d55aae270a78ecf6aeb497d15aa8050de6b9d261719074d69a3` |
| `lower-bound.json` | `628b69e30f3996b6cd4d83775a3f71c5f1601a2f316994f731be4bb67b372717` |
| `candidate-gate.log` | `0774e872a5bac35ca3c66973b7da66b705d47e43b6507992a9fbd127db091d07` |
| `s2.json` | `6aa0fc966ccc439af484df0c9f019c959cf0159b4c719aa09cb0f75d92e36655` |
| `gpu.json` | `cb17b98713a78665c344f14c45b708de5dd4dc1b655275ac8ad8331ba71d8d92` |
| `gpu-headed.json` | `ee88272c5322936beff4150ecec07c3c61c9071d998805e081f74af656fb9d54` |

The embedded probes retain raw per-call timing arrays in `s2.json` and per-case
answers in `s1.json`. The committed legacy gate remained unchanged and passed; the
candidate gate failed as reported. No full application test-suite or production
render validation is claimed for a documentation-only spike.
