Yes. **I would adopt this revised A8 shape almost exactly.** The building-confusion point is serious enough that I’d retract my earlier suggestion to make CHMv2 the default routing canopy source before measuring it.

CHMv2 is a canopy-height *prediction* from optical imagery, trained against airborne lidar. Meta reports strong overall performance, but its published headline validation emphasizes forest biomes and lidar/GEDI/ICESat-2 comparisons—not the exact question Umbra cares about: **“does this model mistake dense urban structures for vegetation?”** ([arXiv][1])

And that failure mode would be unusually nasty for your application:

```text
real world:

      40m building
      ██████████
      ██████████
────────street────────

Umbra building model:
      opaque caster
          ↓
       shadow = 1.0

CHM false positive:
      "40m canopy"
          ↓
    canopy caster
          ↓
    shadow ≈ 0.9

Combined system:
same physical object represented twice
```

So A8 should absolutely **prove that CHM is vegetation enough for urban routing before it influences scores**.

One thing I'd change in your proposed A8c wording, though:

> don't just report **correlation**.

Correlation is useful, but what you really need is a **building-confusion audit**.

### What A8c should measure

Rasterize your existing building geometry onto the CHMv2 grid, then calculate at minimum:

```text
CHM-positive pixels (>2 m / >3 m / >5 m)

                     ┌───────────────┐
                     │   building    │
                     │   footprint   │
                     └───────────────┘

A. inside footprint
B. 0–2 m outside footprint
C. 2–5 m outside footprint
D. >5 m from building
```

Then report things like:

```text
% of building-footprint pixels classified as canopy

% of total predicted canopy area lying inside buildings

CHM-height distribution:
    inside buildings
    near buildings
    away from buildings

building height vs CHM height
    Pearson/Spearman correlation

false-positive area by:
    building height
    building area
    urban density
```

That last part matters.

Imagine Madrid gives:

```text
overall building overlap: 3%
```

Looks great.

But then:

```text
buildings >30m:
CHM overlap: 42%
```

That could still badly corrupt downtown routing.

So I'd stratify it.

---

## I'd also test the easy mitigation immediately

Fortunately, this specific problem may have a remarkably simple solution:

```text
CHM
 ↓
building footprint exclusion
 ↓
canopy field
```

You already have building polygons.

So before canopy ever reaches `ShadowField`:

```ts
if (buildingMask[x][y]) {
    canopyHeight[x][y] = 0;
}
```

Conceptually.

That eliminates the most blatant double-counting.

But I wouldn't stop there, because registration errors could produce:

```text
CHM prediction

      ███████████
      ███████████
      ███████████
            ██
building ┌──────────┐
         │          │
         │          │
         └──────────┘
                   ^^
             false canopy
             just outside
```

Hence the **0–2 m / 2–5 m rings**.

Try:

```text
no mask
footprint mask
footprint + 1m dilation
footprint + 2m dilation
```

and see how much predicted canopy disappears.

If a 1–2 m building dilation removes enormous amounts of CHM, that's evidence of serious edge confusion or registration mismatch.

That is far more informative than one global correlation coefficient.

---

## There is another subtle reason footprint exclusion is defensible

You might worry:

> What if a real tree crown overhangs a building?

That's true.

But from the perspective of ground-level pedestrian shade, the overlapping portion is generally irrelevant anyway:

```text
         tree crown
       ██████████
       ██████████
           █████████
        ┌────────────┐
        │ BUILDING   │
        └────────────┘
```

The portion physically projected over the building footprint isn't shading walkable ground there—the building already occupies it.

The remaining canopy outside the footprint survives.

So:

```text
CHM - building footprint
```

is actually a fairly principled operation for your specific use case.

---

# Your uint8 correction is also right

The official Meta exploration notebook shows the distributed CHMv2 GeoTIFF example as:

```text
dtype: uint8
width: 32768
height: 32768
```

with a pixel transform around **1.194 m**, and explicitly says the single band represents canopy height above ground **in meters**. 

So there are two different resolutions that shouldn't be conflated:

```text
SPATIAL resolution
~1.2 m pixels

HEIGHT resolution
integer metres
```

Meaning:

```text
8 m
9 m
10 m
```

not:

```text
8.37 m
9.12 m
10.64 m
```

for the distributed raster.

That doesn't bother me much for shade routing—the model's prediction uncertainty is vastly larger than ±0.5 m anyway—but **“sub-meter canopy height” would indeed be an incorrect description of the product**.

The sub-meter-ish property belongs to the underlying imagery/spatial footprint, not the height precision.

---

# And the vintage situation is better than looking at S3 timestamps

You caught another important distinction.

`LastModified = 2026`

means:

> object written/uploaded to S3 in 2026

not:

> satellite photographed this location in 2026.

Fortunately, Meta actually supplies what we want.

The official dataset structure is:

```text
/chm/
    raster COGs

/metadata/
    GeoJSON observation dates
```

and Meta says each metadata polygon contains the **observation date of the input imagery**. 

So A8a should retrieve **both**:

```ts
CanopyTile {
    heights: Uint8Array,
    observationDate: ...
}
```

or perhaps observation-date regions, since one tile can evidently contain multiple imagery polygons.

That's much better than assigning one date to the whole COG.

The AWS registry's citation currently says source imagery © 2016 Vantor, but I would **not interpret that copyright statement as the per-location capture date**. The associated observation-date GeoJSON is specifically provided for that purpose. ([Registry of Open Data][2])

That date can actually become part of your confidence model later:

```text
2025 imagery → high temporal confidence
2020 imagery → moderate
2016 imagery → low
```

rather than pretending all CHMv2 pixels describe 2026.

---

# So I think your A8 sequence is now correct

I'd formalize it as:

```text
A8a — Transport feasibility
──────────────────────────
api/canopy.js

COG discovery
HTTP byte-range reads
metadata observation dates

ONE AOI

measure:
    requested bytes
    transferred bytes
    decode time
    peak memory
    output raster dimensions

NO routing effect
```

Then:

```text
A8b — CanopyTileStore
─────────────────────

               CanopyTileStore
                /           \
               /             \
        viewport consumer   route consumer
              │                │
          rendering         corridor
                             sampling

dedupe requests
cache decoded tiles
abort stale requests
independent lifecycles
```

Then your new critical gate:

```text
A8c — Urban building-confusion audit
────────────────────────────────────

Madrid
Singapore
third A3 city

CHMv2
  +
existing building geometry
  ↓
common raster grid
  ↓
overlap analysis

report:

CHM >2 / >3 / >5m
    inside buildings
    0–2m from buildings
    2–5m from buildings
    elsewhere

building-height ↔ CHM-height correlation

results by building-height bin

mask sensitivity:
    exact footprint
    +1m
    +2m
```

And I would add one very useful number:

### **Canopy Retention Ratio**

After building masking:

```text
remaining CHM-positive area
───────────────────────────
original CHM-positive area
```

For example:

```text
Singapore
raw CHM                 100%

after building mask      93%
after building +1m       90%
after building +2m       86%
```

That tells you whether you're cleaning a small amount of contamination or basically deleting half the "canopy" dataset.

---

# Then make A8c an actual decision gate

Not:

```text
A8c
 ↓
A8d automatically
```

but:

```text
                 A8c
                  │
          urban confusion?
          /              \
       acceptable      unacceptable
           │                │
           ▼                ▼
         A8d         investigate source
                     / segmentation mask
                     / abandon CHMv2 routing
```

That's a really good scientific/engineering boundary.

You are no longer deciding:

> CHMv2 is cool, therefore trees.

You're deciding:

> CHMv2 demonstrates acceptable error characteristics for the actual domain Umbra operates in.

Much stronger.

---

# A8d is where I'd finally let it affect routing

And yes:

> **height field → ray march, not prisms**

I strongly agree.

Your two systems become intentionally different:

```text
BUILDINGS

vector polygon
+ height
    ↓
analytic projection
    ↓
opaque ShadowField contribution


CANOPY

raster height field
+ sun vector
    ↓
ray traversal
    ↓
transmissive ShadowField contribution
```

That's cleaner than pretending a raster forest is thousands of synthetic cylinders.

Something roughly like:

```text
for sample along route:

    march toward sun

    rayHeight(d)
        vs
    canopyHeight(x,y)

    obstruction
        ↓
    canopy shadow
```

with building-masked canopy input.

---

# One additional thing I'd put into A8d

I'd keep **canopy presence** and **canopy transmissivity** separate.

Right now that `0.9` seems dangerous to interpret physically.

I'd prefer the field to retain:

```ts
{
  canopyObstruction: 0..1,
  canopyConfidence: 0..1,
  source: ...
}
```

and only later translate obstruction into perceived/physical shade.

Because:

```text
CHM tells us:
"There appears to be vegetation this tall."

CHM does NOT tell us:
"This crown blocks exactly 90% of solar radiation."
```

Species, season, leaf density, latitude, deciduous state, etc. all affect that.

So don't accidentally make your CHM integration appear more physically grounded than the source allows.

---

# A8e is also where A7 becomes valuable again

Rather than A7 being wasted:

```text
municipal
    │
    ├── crown dimensions
    ├── species
    ├── tree height
    └── inventory confidence
           ↓
          BEST

OSM detailed
    │
    ├── height
    ├── crown diameter
    └── species
           ↓
      useful enrichment

CHMv2
    │
    ├── broad coverage
    └── inferred integer height
           ↓
         fallback
```

But I'd make the fusion spatial, rather than simply:

```text
municipal > OSM > CHM
```

meaning "choose one entire dataset."

Instead:

```text
CHMv2 baseline

████████████████████████

municipal coverage
       ┌──────────┐
███████│REPLACE   │████████
       └──────────┘

OSM detailed tree
                    ◉
████████████████████◉██████
                    ↑
                  refine
```

That gives you global continuity while letting higher-confidence sources replace local inference.

---

# And yes: A8f, not A7c, should close #275

I now agree strongly with that.

Painting A7's sparse OSM tree sample would create this implication:

> these are the trees Umbra believes exist.

Your own census already disproves that.

A8f can instead paint:

> **estimated canopy coverage**

which accurately describes what the source is.

You could even distinguish:

```text
estimated canopy       soft/desaturated vegetation fill
inventoried tree       optional precise/tree marker
```

So the map visually communicates the uncertainty structure instead of hiding it.

---

## My final A8 would therefore be

```text
A8a  CHMv2 transport prototype
     proxy + range requests + COG decode + observation metadata
     measure network/decode/memory

A8b  CanopyTileStore
     viewport + route corridor independent consumers
     caching/deduplication/cancellation

A8c  URBAN CONFUSION GATE
     CHM × building overlap across all A3 cities
     height correlation
     footprint/ring contamination
     building-height stratification
     mask/dilation sensitivity
     canopy retention ratio

     ───── ROUTING GATE ─────

A8d  canopy heightfield → ShadowField
     building-masked raster
     ray march
     explicit uncertainty/transmissivity separation

A8e  source fusion
     municipal > detailed OSM > inferred CHM
     spatial replacement/enrichment

A8f  raster canopy rendering
     estimated-canopy UI
     closes #275
```

The best part is that **A8a–c cost essentially nothing operationally**. You're not committing Umbra to CHMv2. You're spending three slices determining whether the free dataset is good enough.

If A8c says it isn't, that's not failure—it gives you a defensible result: **free global CHM isn't reliable enough in dense urban morphology**, and then you can decide whether trees stay inventory-only, become UI-only, require another vegetation mask, or eventually justify premium data.

That's a much better position than paying for data now based on the assumption that free data won't work.

[1]: https://arxiv.org/abs/2603.06382?utm_source=chatgpt.com "CHMv2: Improvements in Global Canopy Height Mapping using DINOv3"
[2]: https://registry.opendata.aws/dataforgood-fb-forestsv2/?utm_source=chatgpt.com "Version 2 High Resolution Canopy Height Maps by WRI and Meta - Registry of Open Data on AWS"
