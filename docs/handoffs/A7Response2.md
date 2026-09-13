I think the best choice for **your app specifically** is:

> **Include tree shade, but do not pay for tree data right now.**
>
> Use the free global canopy raster as your baseline, keep OSM/municipal trees as enrichment, and design the system so paid LiDAR can be plugged in later without changing the routing architecture.

And importantly: **no, you would not download the world or send every tree's `(x,y)` to the browser.**

There is actually already a proof that the architecture you're imagining can work completely serverlessly.

### What the data actually looks like

CHMv2 isn't fundamentally:

```text
tree #4382
x: -98.49
y: 29.42
height: 8.3m

tree #4383
x: ...
```

It's much closer to an image:

```text
        x →
    0  0  0  4  7  9  8  3  0
    0  0  3  7 11 12 10  6  1
y   0  2  6 10 13 14 12  8  3
↓   0  0  4  8 11 12  9  5  0
    0  0  0  2  5  6  3  0  0
```

where each number is approximately:

> **canopy height at this location**

Meta currently publishes CHMv2 as **213,109 Web-Mercator Cloud-Optimized GeoTIFF tiles**, accessible anonymously from AWS. You don't need an AWS account to access them. ([Registry of Open Data][1])

And the full source dataset is apparently on the order of **~24 TB**, according to the Taylor Geospatial cloud-native repackaging project.

So you definitely do **not** download this:

```text
Umbra repo
└── trees/
    └── earth/
        └── 24TB 💀
```

Instead:

```text
                  Meta AWS
                 CHMv2 COGs
                      │
               HTTP byte ranges
                      │
                      ▼
              ┌──────────────┐
              │ spatial tile │
              │    cache     │
              └──────┬───────┘
                     │
             ┌───────┴────────┐
             ▼                ▼
       Map rendering     ShadowField
       canopy layer      tree shadows
```

Only the chunks intersecting where you are working get transferred.

There's even a third-party CHMv2 project demonstrating **a completely static/serverless MapLibre viewer** that streams canopy height into the browser through PMTiles — no application server at all. ([GitHub][2])

That's almost exactly the architecture you're interested in.

---

# One correction to your idea

You said:

> stream to client when its tile lights up for rendering??

**Close, but don't couple it directly to rendering.**

Make something like:

```ts
CanopyTileStore
```

or:

```ts
SpatialRasterCache
```

that both the renderer and routing engine use.

Then:

```text
                 CanopyTileStore
                /               \
               /                 \
        MapLibre renderer     route evaluator
           asks for            asks for
          viewport            route corridor
```

Because imagine:

```text
                  viewport
              ┌────────────┐
              │ START      │
              │    \       │
              └─────\──────┘
                     \
                      \
                       \
                        \ DEST
```

Your alternative routes might leave the viewport.

You **don't** want:

> tree shade calculations only work after the user has physically panned the map over there.

The route engine should simply say:

```ts
await canopy.getRegion(routeBufferedBBox)
```

and the cache figures out which raster tiles are necessary.

---

# And I would intentionally downsample it

This is probably the biggest performance insight.

You don't need sub-meter canopy data for pedestrian route scoring.

Suppose the native raster is approximately ~1m or finer.

I'd probably initially test something around:

> **2–2.5 meters / pixel**

Conveniently, the existing CHMv2 cloud-native project exposes one of its overview levels at roughly **2.4 m/pixel**. ([GitHub][2])

A typical urban tree crown might span several meters.

So this:

```text
native

██████████████
████████████████
█████████████████
████████████████
   █████████
```

becoming:

```text
2.4m grid

 ████
█████
 ████
```

doesn't destroy the information you need for:

> "Is this sidewalk substantially shaded by a tree?"

You aren't doing forestry.

---

## The amount of data becomes surprisingly small

Say you have a ridiculous example:

**5 km walking route**

and you care about everything within:

**100 m around the route.**

Very roughly:

```text
5000 m × 100 m
= 500,000 m²
= 0.5 km²
```

At **2 m resolution**:

```text
500,000 / 4
≈ 125,000 raster cells
```

If you quantize canopy height to one byte:

```text
125,000 bytes
≈ 122 KB
```

Even float32 would only be:

```text
~500 KB
```

for the decoded values themselves.

Real network traffic won't exactly equal those numbers because COG blocks, compression and tile boundaries come into play, but they demonstrate the scale.

You're **not talking about sending millions of JavaScript tree objects** around.

You're talking about something more like:

```ts
Uint8Array(125000)
```

representing an entire route corridor.

That's perfectly reasonable.

---

# More importantly, don't convert the raster into 10,000 trees

This:

```text
CHMv2

█████████████████
████████████████████
█████████████████
```

should **not necessarily become**:

```text
tree
tree
tree
tree
tree
tree
tree
tree
tree
tree
```

That puts you straight back into expensive geometry-land.

You already have a good representation.

Treat canopy as a **height field**.

Your buildings are:

```text
vector geometry
      +
    height
      ↓
geometric shadow caster
```

while trees become:

```text
raster height field
      +
solar direction
      ↓
canopy obstruction field
```

Then both contribute to:

```text
ShadowField

building = 0.84
canopy   = 0.53

→ combined shade estimate
```

That separation is actually quite elegant.

---

# Rendering the trees is even cheaper than calculating them

This is another important distinction.

You have three concerns:

```text
1. Where is canopy?

2. How much shade does that canopy produce?

3. What should the canopy look like on the map?
```

They don't have to use identical representations.

For rendering, MapLibre can essentially paint the raster:

```text
height > threshold
      ↓
canopy fill
```

so the map might show:

```text
        🌳🌳🌳🌳
      🌳🌳🌳🌳🌳🌳

──────── sidewalk ────────

        🌳🌳🌳
```

without having 847 `<Tree />` entities in React.

You could make it beautiful with a shader:

```text
0–2m      transparent
2–5m      sparse vegetation
5–10m     canopy
10m+      tall canopy
```

or just use height to modulate opacity/texture.

If later you want little decorative 3D trees:

```text
canopy raster
     ↓
connected components / local maxima
     ↓
decorative tree positions
```

But those would be **visual approximations**, not your source of physical truth.

That's perfectly acceptable.

---

# Would this kill performance alongside your buildings?

I actually think **no**, provided you resist turning trees into building-like geometry.

Your current building pipeline sounds like the substantially more computationally expensive operation.

You're already:

```text
building polygons
      ↓
height extrusion
      ↓
solar projection
      ↓
shadow polygons / field
      ↓
route edge sampling
```

The tree system can be much simpler:

```text
small raster
      ↓
sample / ray march
      ↓
shade probability
```

And it is extremely parallelizable.

I would put raster processing in a Web Worker:

```text
MAIN THREAD

MapLibre
routing UI
interaction
   │
   │ ArrayBuffer
   ▼
WEB WORKER

decode canopy
sample canopy
solar projection
ShadowField
```

Transfer typed arrays rather than copying JS objects.

---

# You also don't need tree shadows for the whole map

This matters a lot.

There are two different resolutions of computation I'd use.

### Visualization

Calculate/display enough to make the screen look good:

```text
viewport raster tiles
```

### Routing

Only calculate accurately around:

```text
candidate routes
```

For example:

```text
                canopy loaded

        ┌─────────────────────────┐
        │     ╔══════════╗        │
────────│─────║ route A  ║────────│──────
        │     ╚══════════╝        │
        └─────────────────────────┘
```

You don't need to compute high-quality tree shadows 1.5 km away from every candidate route.

That makes the problem much easier.

---

# I would also load buildings and canopy simultaneously

Your current flow might effectively be:

```text
request route
    ↓
download buildings
    ↓
calculate shadows
    ↓
score route
```

I'd change it to:

```text
                   route geometry
                         │
                ┌────────┴────────┐
                ▼                 ▼
          fetch buildings     fetch canopy
                │                 │
          building field      canopy field
                │                 │
                └────────┬────────┘
                         ▼
                   ShadowField
                         ↓
                    route score
```

So the canopy network request doesn't necessarily add its entire latency on top.

---

# Which brings me to your bigger question: should you even do this?

**Yes.**

I actually think omitting trees permanently would hurt the conceptual completeness of ShadeMapNav/Umbra.

Consider:

```text
█████████
BUILDING

        sidewalk
────────────────────────────

🌳 🌳 🌳 🌳 🌳 🌳 🌳 🌳
```

Your current model might say:

```text
☀️☀️☀️☀️☀️
100% sun
```

when a person walking there experiences:

```text
🌳🌳🌳🌳🌳
mostly shaded
```

That's not a minor corner case.

In residential neighborhoods, parks, campuses, suburban streets, boulevards, etc., **tree shade can be the dominant form of pedestrian shade**.

So I'd consider tree support something that eventually belongs in the product.

---

# But I would absolutely **not pay for it right now**

This is where I think your instincts about keeping the project free are good.

You're not operating:

> a commercial urban heat analytics company with paying cities.

You're building what has turned into a pretty technically ambitious portfolio/open-source application.

If you buy proprietary LiDAR now, you acquire three problems:

```text
💵 recurring cost

🌍 geographic coverage restrictions

🔒 your coolest feature now depends on proprietary data
```

That last one is especially unfortunate for **this project**.

If I were evaluating this as an engineering portfolio, I'd actually find this architecture considerably more interesting:

```text
                   Umbra canopy provider

                          │
             ┌────────────┼─────────────┐
             │            │             │
             ▼            ▼             ▼
          CHMv2       Municipal        OSM
          global        trees          trees
          inferred      precise        metadata
             │            │             │
             └────────────┼─────────────┘
                          ↓
                     fused canopy
                          │
                          ▼
                     ShadowField
```

than:

```text
$CommercialTreesAPI.getTrees()
```

You've demonstrated:

* geospatial raster processing
* remote sensing
* WebGL/MapLibre
* vector/raster fusion
* uncertainty modeling
* spatial caching
* async loading
* Web Workers
* solar geometry
* route optimization
* graceful degradation

That's **excellent SWE/geospatial/ML systems material**.

---

# And there is a very practical $0 hosting route

Here's the amusing part.

You may not even need to host the canopy dataset yourself.

Meta's data is already anonymously accessible on AWS. ([Registry of Open Data][1])

And this current open-source project has already built cloud-native indexes around it so the actual Meta raster pixels stay where they are. Its PMTiles/GeoZarr infrastructure references the source dataset rather than duplicating ~24 TB of raster data. ([GitHub][2])

So your architecture could initially be:

```text
Vercel / static Umbra
           │
           │ HTTPS
           ▼
 public canopy infrastructure
           │
           ▼
      Meta CHMv2
```

**Your canopy storage bill: effectively $0.**

I'd be cautious about making your production app permanently depend on an unrelated researcher's public PMTiles endpoint, but it's fantastic for prototyping.

Longer term, you can use Meta's underlying COGs directly or produce your own thin indexing layer.

---

# Even if you eventually need your own storage, it's cheap at your scale

For example, Cloudflare R2 currently gives:

* **10 GB storage/month free**
* **10 million Class B reads/month free**
* **no egress charges**

on its Standard free tier. ([Cloudflare Docs][3])

That doesn't mean you mirror 24 TB into R2.

Instead you might host something tiny like:

```text
index
metadata
custom low-res overview
popular demo-city tiles
```

while the underlying global source stays on AWS.

Or cache:

```text
San Antonio
Madrid
Singapore
NYC
```

because those are the cities you're actually testing.

You'd have to get **very substantially more traffic than your current personal-project usage** before I'd make cloud costs the deciding factor.

---

# The architecture I would choose for Umbra

I'd formalize this now.

```ts
interface CanopyProvider {
  getCanopy(
    bbox: BBox,
    resolution: number
  ): Promise<CanopyRaster>;
}
```

Then:

```text
CanopyProvider

├── MetaCHMv2Provider        ← DEFAULT
│
├── OsmCanopyProvider        ← metadata/enrichment
│
├── MadridTreesProvider      ← high confidence
│
├── SingaporeTreesProvider   ← if available
│
└── LidarCanopyProvider      ← FUTURE
```

The routing engine knows **none of those details**.

It receives:

```ts
CanopyRaster {
    bounds
    resolution
    heights
    confidence
    source
}
```

Then one day, if someone hands you incredible LiDAR:

```ts
provider = new LidarCanopyProvider(...)
```

and nothing downstream changes.

That's the important design decision.

---

# I would make your source hierarchy slightly different from A7

Something like:

```text
              CANOPY COVERAGE

Level 0
CHMv2
global availability
ML inferred

             ↓ enrich

Level 1
OSM individual trees
use species / dimensions when available

             ↓ replace where trusted

Level 2
Municipal inventories
Madrid / NYC / etc.

             ↓ optional future

Level 3
LiDAR / photogrammetry
highest fidelity
```

And critically:

> **absence of OSM tree ≠ absence of tree**

which is what your census taught you.

---

# There is also an elegant fallback

If canopy can't load:

```text
CANOPY AVAILABLE
building + tree shade
confidence = 0.87
```

If it can't:

```text
CANOPY UNAVAILABLE
building-only shade
confidence = 0.69
```

You could even tell the user:

> Building and canopy shade

versus:

> Building shade only

That's exactly the sort of behavior your provenance work seems built for.

Your app doesn't break.

It **degrades intelligently**.

---

## What I would build next

I wouldn't go into A7c and start drawing thousands of OSM circles.

I'd make the next slice something like:

```text
A8a — CHMv2 proof of concept

Pick ONE ~2 km² AOI.

Download/stream CHMv2.
         ↓
Display raw canopy raster in MapLibre.
         ↓
Threshold vegetation.
         ↓
Sample heights at arbitrary x/y.
         ↓
Measure:
  transfer bytes
  decode time
  memory
  FPS
```

Then:

```text
A8b — route corridor

route
  ↓
bbox/buffer
  ↓
fetch appropriate CHMv2 blocks
  ↓
2.4m canopy grid
```

Then:

```text
A8c — physical model

canopy grid
+ sun vector
    ↓
canopy shadow field
    ↓
existing ShadowField
```

**Only after that:**

```text
A8d — pretty canopy rendering
```

Because then you'll know what representation your UI actually has available.

---

# So my answer to the larger product decision is pretty decisive

I would not choose:

```text
❌ Don't support trees
```

and I would not choose:

```text
❌ Pay for premium trees
```

I'd choose:

```text
              UMBRA

Buildings
OSM + your existing geometry system
                   │
                   │
                   ▼
              ShadowField
                   ▲
                   │
                   │
Trees
FREE CHMv2 global raster
     +
OSM enrichment
     +
municipal datasets when available

─────────────────────────────

Paid LiDAR:
supported eventually,
required never.
```

That maintains your original **essentially-zero-hosting-cost goal**, while preventing the app from having a gigantic physical blind spot.

And there's a nice side effect: **the free/open-data constraint forces you into what I think is actually the more technically impressive architecture.**

Rather than being "a map that also draws some OSM trees," Umbra starts becoming a **multi-source spatial inference engine** that reconciles buildings, satellite-derived canopy, municipal GIS, OSM and solar geometry into one uncertainty-aware shade model.

That is a much stronger project.

[1]: https://registry.opendata.aws/dataforgood-fb-forestsv2/ "Version 2 High Resolution Canopy Height Maps by WRI and Meta - Registry of Open Data on AWS"
[2]: https://github.com/taylor-geospatial/meta-chm-v2 "GitHub - taylor-geospatial/meta-chm-v2 · GitHub"
[3]: https://developers.cloudflare.com/r2/pricing/?utm_source=chatgpt.com "Pricing · Cloudflare R2 docs"
