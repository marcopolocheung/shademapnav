# Phase 0 — ShadeMap vector-versus-raster findings

[CONFIRMED] Research date: **2026-09-12 UTC**. Scope: the Phase 0 question in
[BRIEF.md](./BRIEF.md), narrowed by the session instruction to this file only.
The stopping condition has been met: published implementation evidence and the author's
explanation establish the raster approach. No Umbra source audit, architecture design,
implementation work, branch, or issue creation was performed. Remaining uncertainties are
recorded here because later-phase deliverables are outside this session.

## Verdict

[CONFIRMED] **ShadeMap's documented method and its published Mapbox simulator use a raster
height field with per-pixel ray marching toward the sun.** In the inspected
`mapbox-gl-shadow-simulator@0.68.2` implementation, building polygons are rasterized into
a height texture incorporating terrain and optional canopy. The shadow fragment shader
then samples that texture along the sun direction. The polygon drawing in this path
creates height data; it does not project vector shadow polygons. Evidence: the linked
package and the traced producer-to-consumer connection below, independently corroborated
by the author's [algorithm article](https://tedpiotrowski.svbtle.com/three-things-i-did-to-speed-up-my-webgl-code)
and [current help page](https://shademap.app/help/).

[CONFIRMED] **“One raster DSM” needs a qualification.** The inspected package's final
height texture is one RGBA unsigned-byte texture containing two encoded heights per
location: a base/reference height in R/G and a surface/obstruction height in B/A.
Terrain and canopy have separate input textures before composition. Buildings can write
both height pairs, so R/G is not universally untouched bare-earth terrain. Shadow
traversal reads the surface pair; below-canopy handling also reads the reference pair.
This is a combined raster representation, not simply one scalar elevation with all
other height information discarded. Evidence: [versioned ESM bundle](https://unpkg.com/mapbox-gl-shadow-simulator@0.68.2/dist/mapbox-gl-shadow-simulator.esm.js),
composition shader and shadow sampler functions identified below.

[INFERRED] The current `shademap.app` deployment uses the same class of combined raster
representation. Its current help explicitly describes sunward per-pixel traversal,
and the author's articles connect that method to elevation textures and raster tree
data. However, this session did **not** establish that the live site's executing shader
is byte-identical to version 0.68.2 or has exactly the same channel layout. The package
implementation is directly confirmed; that deployment-specific equivalence remains
unverified.

## Decisive implementation evidence

[CONFIRMED] The following observations come from static inspection of the downloaded,
version-pinned [npm tarball](https://registry.npmjs.org/mapbox-gl-shadow-simulator/-/mapbox-gl-shadow-simulator-0.68.2.tgz).
The ESM file contains readable shader string literals despite minified JavaScript.
Descriptions below are original prose, not copied shaders or implementation instructions.
Offsets are zero-based JavaScript string positions in the exact ESM artifact fingerprinted
below; they are search aids, not measurements of runtime behavior.

| Status | Observation | Reproducible evidence locator in `dist/mapbox-gl-shadow-simulator.esm.js` |
|---|---|---|
| [CONFIRMED] | The preparation routine accepts terrain, canopy, DSM overrides, and vector features. It merges raster inputs and passes them with the features to a rasterizer. The returned height texture is passed to the shadow kernel. | Near offsets 18500–23000: search `buildingRasterizer`, `canopyMerger`, `heightMapTex`, and `updateHeightMap`. |
| [CONFIRMED] | Terrain/reference heights and canopy contributions are combined in a fragment shader. Building geometry is drawn as triangles into the same framebuffer-backed height texture. | Composition vertex shader at offset 34009; fragment shader at 34939; rasterizer near 37500–42500. Search `height_map`, `canopy_map`, `targetTexture`, `framebufferTexture2D`, and `drawElements`. |
| [CONFIRMED] | The rasterizer allocates the combined target as RGBA with unsigned-byte components. Its width and height come from the merged tile extent, rather than being a universal fixed framebuffer size. | Search `targetTexture` and the following `texImage2D` allocation near offset 37960. |
| [CONFIRMED] | The shadow fragment shader obtains reference and surface heights from the same sampler. It advances horizontal texture coordinates and ray height toward the sun, compares sampled surface heights against the ray, and marks an obstruction as shade. | Fragment shader at offset 54251. Search `getDEMElevationFromSampler2D`, `getDSMElevationFromSampler2D`, `user_a`, and `sun_altitude`. |
| [CONFIRMED] | The marcher has bounds based on texture edges and maximum elevation, plus a fixed loop ceiling. It is an iterative height comparison, not a vector extrusion/projection calculation. | In the same fragment shader, search `xIter`, `yIter`, `zIter`, and `LOOP_MAX`. No iteration count is presented here as a measured cost. |
| [CONFIRMED] | The kernel's date-update method changes solar parameters and schedules rendering while retaining its height-texture reference. | Search `updateHeightMap` and the adjacent `updateDate` near offset 63400. This describes the kernel method, not observed live network behavior. |

[CONFIRMED] The [public TypeScript definitions](https://unpkg.com/mapbox-gl-shadow-simulator@0.68.2/dist/mapbox-gl-shadow-simulator.d.ts)
corroborate the inputs: raster terrain configuration with an elevation decoder, an
in-memory DSM with data/bounds/dimensions, vector feature input, canopy configuration,
and a below-canopy switch. Types alone would not prove the renderer's algorithm; the
shader and texture handoff above supply that missing evidence.

## Independent first-party corroboration

- [CONFIRMED] **Current vendor documentation:** [ShadeMap Help, “How does ShadeMap work?”](https://shademap.app/help/)
  says, “ShadeMap traces a path from each map pixel towards the sun.” It describes
  building, mountain, and tree intersections along that path. This confirms the
  documented method, without establishing its texture encoding or exact deployed version.
- [CONFIRMED] **Historical algorithm description:** Ted Piotrowski's
  [“Three things I did to speed up my WebGL code,” September 23, 2021](https://tedpiotrowski.svbtle.com/three-things-i-did-to-speed-up-my-webgl-code),
  describes elevation PNG tiles stitched into one texture, texture lookups along a
  sunward line for each map pixel, and terminating collision checks above the map's
  highest elevation. This directly supports height-texture ray traversal, but predates
  the current canopy implementation.
- [CONFIRMED] **Raster tree-data path:** Piotrowski's
  [“Using LiDAR to map tree shadows,” July 9, 2023](https://tedpiotrowski.svbtle.com/using-lidar-for-tree-shadows-in-shademap),
  explains converting elevation GeoTIFFs into small image tiles with metric heights
  encoded in RGB for ShadeMap's tree-shadow simulation. It establishes the historical
  LiDAR raster path, not the current free canopy provider or its coverage.
- [CONFIRMED] **Source correction:** the 2021 article explicitly retracts its claim
  that GLSL `break` behaves like `continue`. That claim is not evidence here. The
  relevant texture and ray-traversal description is independently supported by the
  inspected package. No performance figure from either article is adopted as a
  measurement from this session.

## Live inspection: what succeeded and what did not

[CONFIRMED] Plain HTTP retrieval succeeded for [the live app](https://shademap.app/).
Its HTML referenced [`/assets/main-RClLqv_O.js`](https://shademap.app/assets/main-RClLqv_O.js),
which was also downloaded. This establishes public static asset availability only;
it does not establish execution, identify the deployed simulator version, or show tile
requests. No authentication or premium purchase was attempted.

[CONFIRMED] One Playwright Chromium launch attempt failed **before opening the site**.
The selected executable was
`/home/wslunusn/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell`.
It exited with code 127 because `libnspr4.so` was missing. The launch used
`chromium.launch({headless:true,args:['--no-sandbox']})` through the installed Playwright
package. No browser requests, screenshots, or successful map interactions were recorded.
Browser recovery stopped once the independent evidence answered the requested question.

[UNKNOWN] Live tile URL templates, response formats and headers, tile dimensions and
zoom ranges, request ordering during time scrubbing, street-level tree controls, and
pan/zoom behavior are therefore unresolved. There is no HAR from a successfully loaded
page. Resolving these requires a working browser and a recorded interaction session;
static HTML and npm defaults cannot substitute for that observation.

## Seed checks and corrections at the stopping point

| Seed topic | Status and evidence |
|---|---|
| AWS Terrarium terrain | [CONFIRMED] The inspected [0.68.2 README](https://unpkg.com/mapbox-gl-shadow-simulator@0.68.2/README.md) documents `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`, tile size 256, maximum zoom 15, and decoding as `(r * 256 + g + b / 256) - 32768`. These are documented configuration values, not observed live requests. |
| “AWS is the default” | [CONFIRMED] This needs qualification: the README configuration table describes a zero-elevation fallback, and the inspected constructor returns one fixed AWS tile URL, ending `/7/17/45.png`, when no source is supplied. The dynamic AWS template is a documented configuration/example. [UNKNOWN] The live app's selected terrain source was not established. |
| Solar dependency | [CONFIRMED] Versioned npm metadata for [Mapbox 0.68.2](https://registry.npmjs.org/mapbox-gl-shadow-simulator/0.68.2) and [Leaflet 0.67.0](https://registry.npmjs.org/leaflet-shadow-simulator/0.67.0) lists `suncalc: ^1.9.0` as the sole production dependency. [UNKNOWN] Solar accuracy and sufficiency were not evaluated. |
| Buildings exclusively from Overture | [CONFIRMED] The [current help page](https://shademap.app/help/) lists OpenStreetMap, Overture, and Mapbox Streets and says sources can change. It documents a 3.1 m missing-height fallback. [UNKNOWN] The live provider mix is unobserved; the brief's exclusive “not raw OSM” wording is unsupported. The current first-party list takes precedence over that seed. |
| Free Meta canopy, resolution and regional button | [UNKNOWN] The current free provider, nominal resolution, coverage, and conditional control were not independently verified before the stopping condition. Raster canopy support in the package does not identify its production data provider. |
| Premium precision and price | [CONFIRMED] The [help page](https://shademap.app/help/) advertises LiDAR/photogrammetry, accuracy within 30 cm, and purchases by square kilometre. This is a vendor claim, not measured accuracy. [UNKNOWN] The quoted price in the brief was not verified. |
| GPU-bound and time aggregation | [CONFIRMED] The [help page](https://shademap.app/help/) says the app relies heavily on the GPU and supports daily/annual sunlight accumulation. [UNKNOWN] “GPU-bound” as a measured bottleneck is not established by that statement or by this session. |
| Protomaps fallback under load | [UNKNOWN] No live network capture or independently checked source establishes this lead. |

## Evidence provenance and reproduction

[CONFIRMED] Package research used direct npm registry metadata and tarball retrieval
because the npm website returned HTTP 403 through the web reader. The inspected engine
was **Mapbox 0.68.2 ESM**; the Leaflet package was checked for metadata only, not for
equivalent shader behavior. Temporary downloads and the browser probe were kept outside
the repository under `/tmp/shademap-phase0-qdtIKl/`; their persistence is not required
to reproduce the package findings.

[CONFIRMED] SHA-256 fingerprints computed over the downloaded bytes:

| Artifact | SHA-256 |
|---|---|
| `mapbox-gl-shadow-simulator-0.68.2.tgz` | `46b25b754ee13c725b31cd8147dad7880a7a72fd504c8f0b5f1667cbce0c2d18` |
| `dist/mapbox-gl-shadow-simulator.esm.js` | `ee79f19707bfbdbad45e415e0c6e28720904f2e665e6a8a962e69e78af40696b` |
| `dist/mapbox-gl-shadow-simulator.d.ts` | `565aff7b6783c5a3bcf0b5c441d0ce971c85f20c7e6292a4a07f95c4c97a2129` |
| Live `main-RClLqv_O.js` | `0ca48aa60cbde9b90bf43fd9ca7db16174976157d379cd05e565cbca0ec2e0f3` |

[CONFIRMED] To reproduce the static conclusion, retrieve the pinned tarball linked above,
extract it outside the repo, verify the fingerprints, and inspect the ESM at the listed
symbols/offsets. Follow the rasterizer's returned texture into the kernel and read the
composition and shadow shader literals. Package installation and execution are unnecessary.
The live asset is mutable deployment evidence, not a permanent version identifier.

[CONFIRMED] Method/sample scope: one engine bundle inspected, two package metadata
records checked, one unsuccessful browser launch, and the cited first-party pages read.
The local tools ran on Linux x64 with Node v20.20.1. Hardware was not characterized
because no performance experiment ran. [UNKNOWN] [UNMEASURED] Browser latency, GPU time,
memory, throughput, physical shadow accuracy, and their worst cases are all unmeasured;
there is no benchmark sample or representative city corpus in these findings.

## Limits and licence handoff

- [UNKNOWN] Exact deployed composition, canopy encoding and below-canopy semantics:
  these remain deployment-specific questions. A successful live capture plus identification
  of the executing engine would settle them. They do not prevent the architectural
  classification supported above.
- [UNKNOWN] Actual behavior at tile seams, distant offscreen casters, overlapping inputs,
  and tree boundaries was not tested. The vendor [documents viewport-related missing
  casters](https://shademap.app/help/), but this session has no runtime validation of that
  limitation. These details matter for later correctness work.
- [UNKNOWN] The causes of Umbra's box-shaped canopy shadows and moving bases are outside
  this session. ShadeMap's representation is evidence about ShadeMap; it does not
  establish either Umbra bug's mechanism without the explicitly deferred audit.
- [CONFIRMED] Both inspected package metadata records declare **`UNLICENSED`**. The
  [brief](./BRIEF.md) permits reading for understanding and forbids copying code,
  shaders, or verbatim structure into MIT-licensed Umbra. No third-party implementation
  was copied into this repository. Any later implementation must be independently
  derived from published techniques and original reasoning; these findings confer no
  licence to reuse the inspected implementation.

[CONFIRMED] **Phase 0 stops here.** The evidence answers raster versus projected vector
shadows, with the combined texture's two-height qualification and the live-verification
gap preserved. The remaining research and all subsequent phases were not started.
