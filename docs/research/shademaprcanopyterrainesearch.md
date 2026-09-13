Yes — and the repositories reveal something pretty important that is easy to miss from the README:

**Ted Piotrowski is not treating canopy as part of ordinary terrain. He has a distinct canopy input in the current shadow engine.** At the same time, the engine is designed so terrain, canopy, buildings/structures, and even a full DSM can all participate in the *same shadow calculation*. ([GitHub][1])

That means your instinct that he may be doing “canopy + terrain in one swoop” is **directionally correct at the rendering/calculation level**, but **not because the underlying data necessarily comes as one raster**.

# The important finding

The current `mapbox-gl-shadow-simulator` type definitions expose **four distinct concepts**:

```text
terrainSource
canopySource
dsmSource
getFeatures()
```

Specifically:

* `terrainSource` → DEM/terrain elevation
* `canopySource` → canopy data
* `dsmSource` → a rasterized surface model
* `getFeatures()` → vector polygons such as buildings

There is even an explicit:

```javascript
belowCanopy
setBelowCanopy(...)
setCanopySource(...)
setDSMSource(...)
```

in the current API. ([GitHub][1])

So this is much more explicit than the public README suggests.

---

# 1. What the original example is actually doing

The `shademap-examples` route example makes the architecture unusually clear.

The example says that ShadeMap uses:

> Amazon OpenData terrain tiles

and separately gets:

> buildings data from Mapbox's terrain/vector tiles

The code is essentially:

```javascript
new ShadeMap({
    terrainSource: {
        ...
    },

    getFeatures: async () => {
        const buildingData =
            map.querySourceFeatures('composite', {
                sourceLayer: 'building'
            });

        return buildingData;
    }
})
```

So in that example the inputs are explicitly separate:

```text
                         ┌── Terrain DEM
                         │
                         ▼
                   ┌─────────────┐
                   │   ShadeMap  │
                   │ shadow      │
                   │ simulation  │
                   └─────────────┘
                         ▲
                         │
                  Building polygons
                  + building heights
```

The terrain is coming from raster elevation tiles, while buildings are coming from vector features containing footprints and heights. ([GitHub][2])

And importantly, the route example doesn't show canopy at all. It is basically **terrain + buildings**.

---

# 2. But the current simulator has a dedicated canopy system

This is the part I think you were missing.

The current `.d.ts` for version 0.68.2 defines:

```typescript
interface TerrainSource {
    maxZoom: number;
    tileSize: number;

    getSourceUrl: ({x, y, z}) => string;

    getElevation: ({r, g, b, a}) => number;
}

interface DSMSource {
    data: Uint8ClampedArray;
    bounds: [LngLatLike, LngLatLike];
    width: number;
    height: number;
    maxHeight: number;
}
```

and then:

```typescript
interface ShadeMapOptions {
    terrainSource?: TerrainSource;
    belowCanopy?: boolean;
    dsmSource?: DSMSource;
    getFeatures?: () => Promise<MapboxGeoJSONFeature[]>;
}
```

The class itself exposes:

```typescript
setTerrainSource(...)
setBelowCanopy(...)
setCanopySource(...)
setDSMSource(...)
```

That's extremely significant. ([GitHub][1])

In other words, the current architecture is roughly:

```text
                 Shadow engine
                      │
        ┌─────────────┼─────────────┐
        │             │             │
        ▼             ▼             ▼
     Terrain       Canopy        Structures
      DEM            CHM        / buildings
        │             │             │
        └─────────────┼─────────────┘
                      │
                      ▼
                 Shadow result
```

That's **much closer to what you're trying to build** than I initially would have assumed from the README.

---

# 3. There's actually a second trick: DSM support

This is where it gets even more interesting.

The README describes `terrainSource` as accepting:

> DEM or DSM tiles containing terrain elevation data

and the current API also has a separate `dsmSource`. ([GitHub][3])

A **DEM** is essentially:

```text
bare earth
```

A **DSM** is:

```text
top surface
= ground + objects + vegetation
```

So there are actually *two different architectural approaches* possible with this library.

### Approach A — separate layers

```text
Terrain DEM
   +
Canopy height
   +
Buildings
   ↓
Shadow simulation
```

This is the architecture your CHM + future terrain plan most naturally fits.

### Approach B — pre-combined surface

```text
DSM
= terrain + canopy + buildings/other surface features

        ↓

Shadow simulation
```

And the library has explicit support for DSM-style elevation data. ([GitHub][4])

So yes, **the engineer has built the system such that canopy and terrain can effectively become one surface model**, but that is not necessarily how the ordinary ShadeMap data is being stored.

---

# 4. Your CHMv2 is actually a very good conceptual match

This is where your choice of Canopy Height Maps v2 matters.

CHMv2 is a **canopy height map**, not a terrain elevation model. The dataset is described as providing canopy height, and current documentation describes it as a single-band raster representing canopy height in meters **above ground**. ([Open Data on AWS][5])

That means conceptually:

```text
Terrain DEM:
        z = 182 m

CHMv2:
        canopy height = 24 m

Actual canopy top:
        182 + 24 = 206 m
```

That is exactly the kind of relationship a shadow engine needs.

You **should not think of CHMv2 as replacing your terrain DEM**.

Think:

```text
terrain = "where is the ground?"
canopy  = "how far above that ground does vegetation extend?"
```

Then:

```text
canopy surface ≈ terrain elevation + canopy height
```

That's the key conceptual distinction.

---

# 5. So is Piotrowski doing `terrain + canopy`?

### Yes, conceptually.

But there are three different meanings of "together" here.

### Meaning 1: Same dataset?

**No, not necessarily.**

His current API clearly distinguishes:

```javascript
terrainSource
canopySource
```

so the architecture supports separate raster sources. ([GitHub][1])

### Meaning 2: Same shadow simulation?

**Yes.**

The whole point is that the ray/shadow calculation can account for multiple kinds of obstructions simultaneously.

### Meaning 3: Can they be transformed into one surface?

**Yes.**

That's where `dsmSource` becomes interesting.

You could conceptually generate:

```text
DSM(x,y)
    =
terrain(x,y)
+
canopyHeight(x,y)
```

and feed that as a surface model.

But there is a catch.

---

# 6. Why a simple `terrain + CHM` DSM isn't equivalent to real tree shadows

This is the biggest thing I'd caution you about.

Suppose you have:

```text
terrain = 100 m

CHM = 25 m
```

If you make:

```text
DSM = 125 m
```

you have created a **25-meter-high continuous wall/plateau wherever canopy exists**.

That's not really a tree.

A real forest canopy is more like:

```text
                 ███
              ████████
          ██████████████
             │      │
             │      │
             │      │
─────────────┴──────┴──────── ground
```

whereas a naïve raster DSM can effectively behave more like:

```text
████████████████████████
████████████████████████
──────────────────────── ground
```

depending on the representation/resampling.

That distinction is why Piotrowski has **both canopy-specific logic and DSM support** rather than simply saying "give me one elevation raster."

---

# 7. The `belowCanopy` feature is the smoking gun

This is probably the single most useful discovery for your question.

The current library has:

```typescript
belowCanopy?: boolean
```

plus:

```typescript
setBelowCanopy(...)
```

and the actual ShadeMap application exposes UI modes for:

* top of canopy
* below canopy
* no tree shadows

Bellingcat's documentation of the current ShadeMap interface explicitly describes this behavior. ([GitHub][6])

And Ted himself explained the distinction publicly: "top of canopy" is essentially viewing shadows from above the forest surface, while "below canopy" is an estimate of what happens down on the ground beneath trees. ([Reddit][7])

That tells us something extremely important architecturally:

**His tree model isn't simply "terrain with a larger elevation value."**

There is semantic knowledge that the obstruction is vegetation/canopy.

---

# 8. And this explains why ShadeMap can do something a plain DSM cannot

Imagine sunlight coming from the side.

For an ordinary hill:

```text
             ☀
              \
               \
                \       mountain
                 \    /^^^^^^\
                  \__/        \
```

The terrain blocks the ray.

For a forest:

```text
             ☀
              \
               \      canopy
                \   ███████
                 \ █████████
                   │ │ │
                   │ │ │
───────────────────┴─┴─┴──── ground
```

A "top of canopy" analysis asks:

> Does the sunlight hit the canopy surface?

A "below canopy" analysis asks:

> Does sunlight actually make it through the vegetation to the ground?

Those are not the same calculation.

That's why the application can offer "Top of canopy" versus "below canopy." ([GitHub][6])

---

# 9. Where CHMv2 fits into this

Your CHMv2 gives you:

```text
H_canopy(x,y)
```

You eventually want:

```text
H_ground(x,y)
```

from a terrain DEM.

So your basic combined model becomes:

```text
H_canopy_top(x,y)
    =
H_ground(x,y)
+
H_canopy_height(x,y)
```

For example:

| Layer               | Example |
| ------------------- | ------: |
| Ground elevation    |   312 m |
| CHMv2 canopy height |    18 m |
| Canopy top          |   330 m |

That's exactly the sort of decomposition I would recommend architecturally.

---

# 10. I would **not** wait to implement terrain before designing your canopy system

This is probably the biggest practical takeaway for your project.

Your original thought sounded like:

> "I'll implement CHMv2 canopy first and add terrain later."

That's fine **as a development sequence**, but I'd structure your internal data model from day one as:

```text
GroundSurface
CanopySurface
Structures
```

rather than:

```text
CanopyHeight
```

only.

Why?

Because once you add terrain, you'll want the calculation to become:

```text
ground elevation
        +
canopy height
        +
structures
        ↓
occlusion / shadow ray
```

rather than having to rebuild your entire renderer around a fundamentally different surface model.

---

# 11. The most interesting clue in his API

I'd rank the clues like this:

| Feature             | What it tells us                                     |
| ------------------- | ---------------------------------------------------- |
| `terrainSource`     | Terrain is an independent elevation source           |
| `getFeatures()`     | Buildings/objects can be independent vector geometry |
| `dsmSource`         | Full surface models are also supported               |
| `setCanopySource()` | **Canopy is independently supported**                |
| `belowCanopy`       | Canopy has semantics beyond simple terrain elevation |
| `setBelowCanopy()`  | Renderer explicitly changes canopy behavior          |

The **`setCanopySource()` + `belowCanopy` combination** is the strongest evidence that canopy is a first-class data type in the simulator rather than an accidental side effect of terrain data. ([GitHub][1])

---

# 12. There's also an important difference between the old public examples and the current engine

This is easy to miss because the README is somewhat behind the implementation.

The route example uses:

```javascript
terrainSource
getFeatures
```

and talks about:

```text
terrain + buildings
```

It does **not** demonstrate the newer canopy-specific API. ([GitHub][2])

Yet the current package's TypeScript declarations already contain:

```javascript
belowCanopy
setCanopySource
setDSMSource
```

and the current ShadeMap application clearly exposes tree-shadow behavior. ([GitHub][1])

So I would not use the `shademap-examples` repo as the complete description of the current canopy architecture.

It's more like:

```text
shademap-examples
    =
examples of using the API

mapbox-gl-shadow-simulator
    =
actual shadow engine
```

and the latter currently contains more canopy functionality than the examples repository demonstrates.

---

# 13. What I think Ted's actual architecture looks like

Based on the public API, examples, and current ShadeMap behavior, my best reconstruction is:

```text
                     Sun position
                          │
                          ▼
                  ┌───────────────┐
                  │ Shadow engine │
                  └───────┬───────┘
                          │
          ┌───────────────┼────────────────┐
          │               │                │
          ▼               ▼                ▼
     Terrain DEM      Canopy model     Structures
     ground Z         canopy height    polygons/heights
          │               │                │
          └───────────────┼────────────────┘
                          │
                          ▼
                  surface / occlusion
                          │
                          ▼
                    shadow result
```

And in some cases:

```text
              DSM
     (already combined surface)
                  │
                  ▼
             Shadow engine
```

So he has **both a compositional model and a fused-surface model**.

---

# 14. What this means for *your* CHMv2 implementation

I would architect yours like this:

```text
                    ┌──────────────┐
                    │ Terrain DEM  │
                    │ bare earth   │
                    └──────┬───────┘
                           │
                           ▼
                     Ground Z(x,y)
                           │
                           │
              ┌────────────┴────────────┐
              │                         │
              ▼                         ▼
       Canopy Height               Buildings
          CHMv2                     vectors
              │                         │
              ▼                         ▼
        Canopy Z                    Roof Z
      = Ground + CHM
              │                         │
              └────────────┬────────────┘
                           ▼
                    Shadow solver
```

And **don't actually pre-add the layers unless you have a reason to**.

Keeping:

```javascript
terrain(x,y)
canopyHeight(x,y)
buildingHeight(...)
```

separate gives you substantially more flexibility.

---

# 15. One particularly important implication for CHMv2

CHMv2 is approximately a **1-meter canopy-height product**, which is extremely detailed compared with the terrain tiles commonly used for web shadow simulations. ([AllenAI][8])

That creates an interesting engineering problem:

```text
CHMv2
~1 m resolution

vs.

web DEM
often tens of meters or worse
```

You therefore have:

```text
high-resolution canopy
          +
lower-resolution terrain
```

and you'll need to decide how to combine those grids.

You don't necessarily need equally high-resolution terrain everywhere.

For tree-shadow calculations, you can have:

```text
Terrain:     lower-resolution elevation surface
Canopy:      high-resolution height surface
Buildings:   vector/high-resolution geometry
```

and sample them in one ray calculation.

That is actually another reason **not** to collapse everything into a single raster prematurely.

---

# 16. There is an even more revealing distinction: CHM vs DSM

Think of these three data products as:

### DEM

```text
"Where is the ground?"
```

### CHM

```text
"How tall is the vegetation above the ground?"
```

### DSM

```text
"Where is the topmost physical surface?"
```

So:

```text
DSM ≈ DEM + canopy + buildings + other objects
```

Your CHMv2 is therefore **not terrain**, and it is **not itself a DSM**.

It's one ingredient for making a surface model.

That distinction is exactly consistent with Piotrowski's API design.

---

# 17. My recommendation for your project

I would **not** copy his implementation literally, because your CHMv2 setup gives you a much cleaner data source than trying to reproduce his proprietary/free/premium tree pipeline.

I'd build your renderer around these three inputs:

```typescript
interface ShadowScene {
    terrain: TerrainSource;
    canopy?: CanopySource;
    structures?: StructureSource[];
}
```

where:

```typescript
interface CanopySource {
    height: (lng: number, lat: number) => number;
}
```

and conceptually:

```javascript
groundZ = terrain.getElevation(...)

canopyHeight = canopy.getHeight(...)

canopyTopZ = groundZ + canopyHeight
```

Then the ray solver can determine:

```text
terrain obstruction
        +
canopy obstruction
        +
building obstruction
```

without requiring you to turn them into one raster.

---

# 18. The surprising conclusion

So, to answer your original question very directly:

**No — the engineer is not simply getting canopy "for free" from his terrain data.**

The current library actually exposes canopy separately:

```javascript
setCanopySource(...)
belowCanopy
```

which is strong evidence that canopy is its own data source. ([GitHub][1])

**But yes — he is handling terrain + canopy + structures in one unified shadow simulation.**

And he also supports the alternate approach of providing a **DSM**, which is effectively a pre-combined representation of the physical surface. ([GitHub][4])

For your architecture, I'd therefore think about it as:

```text
                YOUR SYSTEM

       ┌─────────────┐
       │ Terrain DEM │
       └──────┬──────┘
              │
              ├──── ground elevation
              │
       ┌──────▼──────┐
       │   CHMv2     │
       │ canopy ht.  │
       └──────┬──────┘
              │
              ├──── canopy top
              │
       ┌──────▼──────┐
       │  Buildings  │
       └──────┬──────┘
              │
              ▼
        Unified shadow
           solver
```

That's actually a **very similar conceptual architecture to what Piotrowski has exposed in the current API**, just with you supplying your own canopy dataset.

One caveat: the public TypeScript declarations prove that `canopySource` exists, but the repository does **not expose the underlying implementation source in a nice human-readable `src/` tree**, so I would not claim from the public repo alone exactly how every canopy pixel is transformed internally. The API surface and the live ShadeMap behavior strongly establish the architecture, though. ([GitHub][1])

### The part I'd investigate next

The really valuable next step is to reconstruct **exactly what `canopySource` expects** and how Piotrowski's renderer combines:

```text
terrainSource
+
canopySource
+
belowCanopy
+
dsmSource
```

at the shader/ray level, because that would tell you whether you can feed **CHMv2 directly** or whether you should first transform it into a tiled canopy-surface representation. That is the piece that would determine your optimal implementation.

[1]: https://github.com/ted-piotrowski/mapbox-gl-shadow-simulator/blob/main/dist/mapbox-gl-shadow-simulator.d.ts "mapbox-gl-shadow-simulator/dist/mapbox-gl-shadow-simulator.d.ts at main · ted-piotrowski/mapbox-gl-shadow-simulator · GitHub"
[2]: https://raw.githubusercontent.com/ted-piotrowski/shademap-examples/main/docs/route.md "raw.githubusercontent.com"
[3]: https://github.com/ted-piotrowski/mapbox-gl-shadow-simulator?utm_source=chatgpt.com "GitHub - ted-piotrowski/mapbox-gl-shadow-simulator: Simulate terrain and structure shadows in a custom map layer · GitHub"
[4]: https://github.com/ted-piotrowski/mapbox-gl-shadow-simulator "GitHub - ted-piotrowski/mapbox-gl-shadow-simulator: Simulate terrain and structure shadows in a custom map layer · GitHub"
[5]: https://registry.opendata.aws/dataforgood-fb-forestsv2/?utm_source=chatgpt.com "Version 2 High Resolution Canopy Height Maps by WRI and Meta - Registry of Open Data on AWS"
[6]: https://github.com/bellingcat/toolkit/blob/main/gitbook/tools/shademap/README.md?utm_source=chatgpt.com "toolkit/gitbook/tools/shademap/README.md at main · bellingcat/toolkit · GitHub"
[7]: https://www.reddit.com/r/InternetIsBeautiful/comments/rno2d3/simulate_when_sun_and_shadow_hit_your_house/?utm_source=chatgpt.com "Simulate when sun and shadow hit your house"
[8]: https://allenai.github.io/rslearn/reference/data_sources/meta_canopy_height/?utm_source=chatgpt.com "meta_canopy_height - rslearn"
