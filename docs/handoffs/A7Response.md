Yes — **sometimes they are paying for better data, but that is not the main reason you’re stuck.** The bigger issue is that you chose **OSM/Overpass individual tree objects as your primary representation**, while several of the impressive-looking systems are using **remote-sensed canopy rasters, municipal tree inventories, proprietary basemap vegetation, or LiDAR**.

Your census is actually doing its job: it demonstrated that **OSM is the wrong completeness layer for tree canopy**.

### There are three totally different things that all look like “trees on the map”

| What you're seeing              | How it's commonly obtained                 | Useful for shade physics?   |
| ------------------------------- | ------------------------------------------ | --------------------------- |
| Pretty 3D trees / green foliage | Map provider's proprietary basemap         | Maybe not                   |
| Painted canopy footprint        | Satellite/aerial imagery + ML segmentation | **Yes**                     |
| Individual modeled trees        | Municipal inventory / OSM / LiDAR          | **Yes, if complete enough** |

For example, Mapbox Standard literally has **3D tree models built into the map style**. You can toggle `show3dTrees`; Mapbox handles their source and visualization internally. So someone using Mapbox can appear to have magically solved trees while having written essentially no tree-data pipeline themselves. ([Mapbox][1])

That does **not** mean they necessarily have a complete dataset of `<lat, lon, crownDiameter, height>` available for their own routing algorithm.

Shadowmap is even more revealing. They explicitly say they use OSM for general worldwide tree coverage, **but supplement it with city tree databases**, and they specifically call out Madrid and Vienna as places where they have stem height, total height, stem diameter, and crown diameter; Paris gets another city-specific treatment. ([Shadowmap][2])

So when you look at Shadowmap in Madrid and think:

> Why the hell do *they* have all these trees when my Overpass request doesn't?

the answer is basically:

**because they are not relying on the same dataset you are.**

Your 23%-of-inventory Madrid result is completely compatible with what Shadowmap describes. Madrid itself publishes a huge municipal tree inventory: its 2026 download is tens of MB and individually inventories municipal trees across streets, parks, gardens, and other managed green spaces. ([Madrid Data][3])

This is the sort of source Shadowmap is talking about.

---

## The particularly important thing I found for *your* project

There is actually a dataset that is almost comically well matched to what you're trying to do:

**Meta + World Resources Institute High Resolution Canopy Height Map.**

It is a **global ~1 m / sub-meter canopy-height raster**, inferred using ML from high-resolution Maxar satellite imagery and trained using LiDAR. Instead of:

```text
TREE
lat = x
lon = y
height = unknown
diameter = unknown
```

you effectively get:

```text
pixel(x, y) -> estimated canopy height in meters
```

across the landscape. ([WRI Datasets][4])

And remarkably, **you do not have to pay for the dataset**. Meta says the canopy data and models are publicly available for commercial use, and the AWS Open Data registry lists the dataset under **CC BY 4.0**, with anonymous S3 access requiring no AWS account. ([Registry of Open Data][5])

The raw global data lives as GeoTIFFs on AWS.

That's why this line from your agent:

> **A8's raster now outranks A7c**

is, in my view, **exactly correct**.

I would go considerably further:

> **A8 should probably become your primary canopy source. A7 should become an enrichment source.**

---

### What I would make Umbra's hierarchy

```text
                CANOPY PRESENCE / GEOMETRY

      Meta/WRI ~1 m canopy-height raster
                     │
               base coverage
                     │
           ┌─────────┴─────────┐
           │                   │
 Municipal tree DB           OSM tree
 height/crown/etc.          height/crown/etc.
           │                   │
      high-confidence        enrichment
        override
```

In other words, **do not ask OSM whether a tree exists**.

Ask the imagery-derived raster whether canopy exists.

Then ask OSM / Madrid / Vienna / whatever:

> "Do I happen to know more about this particular tree?"

That is a dramatically different architecture.

---

## And the raster solves your “tree painting” problem almost for free

Right now A7c is blocked because you're correctly realizing:

> If I paint my OSM crowns, I am implying that these are the trees.

And in Singapore your census found essentially nothing.

With the Meta/WRI raster, the renderer can legitimately draw:

```text
height <= ~2–3 m     don't treat as tree canopy
height >= ~3 m       canopy
```

WRI itself uses this dataset almost exactly this way. Their Cool Cities system derives an **existing tree-cover layer from the global canopy-height dataset**, using trees at least 3 m tall, and uses the resulting information in shade and thermal-comfort modeling. ([Cool Cities Lab][6])

So your UI could finally paint this:

```text
                     street

        ███████
      ███████████
     █████████████               ███████
      ███████████               █████████
         █████                   ████████
────────────────────────────────────────────
              pedestrian route
```

instead of:

```text
          ●

────────────────────────────────────────────
              pedestrian route

                              ●
```

where `●` is whatever handful of trees Overpass happens to know about.

And because the raster contains **height**, it's more useful than a simple vegetation-class raster.

---

## The catch

Meta/WRI isn't magical ground truth.

The source imagery spans roughly **2009–2020**, with most coming from 2018–2020, and Meta reported an approximate **2.8 m mean absolute error for height**. WRI also warns that geography, imagery conditions, slopes, and model generalization can cause errors. ([WRI Datasets][4])

So I would not label it:

> exact tree geometry

I'd label it internally more like:

```ts
{
  source: "meta-wri-canopy-height",
  geometryConfidence: 0.7,
  temporalConfidence: 0.6,
  heightConfidence: 0.6
}
```

or whatever your confidence framework ultimately becomes.

But compare those limitations with:

> Singapore: literally zero OSM canopy features around the corpus center

and the decision becomes pretty easy.

---

### You also shouldn't necessarily turn every raster blob into a fake cylinder

This is another reason I like A8 better than A7.

Your current A7 model effectively says:

```text
tree point
    ↓
assume diameter
    ↓
assume height
    ↓
make crown prism
```

The Meta/WRI data allows:

```text
actual remotely-sensed canopy footprint
               +
        estimated height
               ↓
         canopy heightfield
```

You could shadow-test the heightfield directly.

Conceptually, for a pedestrian ground point `P`, march toward the sun. At horizontal distance `d`, the solar ray is approximately:

```text
rayHeight(d) = d * tan(solarElevation)
```

and compare that with the canopy height along that direction.

If:

```text
canopyHeight(x, y) > rayHeight(d)
```

there is potentially tree obstruction.

You'd then apply your canopy transmission model rather than treating foliage identically to a building.

That is a much more natural representation of something irregular like this:

```text
   █████████████
 ███████████████████
██████████████████████
  ████████████████
       ███████
```

than attempting to reverse-engineer it into:

```text
         ◯
     ◯       ◯
         ◯
   ◯          ◯
```

and inventing five individual trees.

---

## There *is* also a paid-data world

ShadeMap makes this explicit.

Its normal data is based on indirect sources such as crowdsourcing and ML. But ShadeMap sells **premium LiDAR / photogrammetry data by the square kilometer**, including much more precise building and **tree heights**, and claims accuracy down to roughly 30 cm where that premium dataset is available. ([ShadeMap][7])

So yes:

**some of the extremely precise stuff you're seeing really is paid.**

But you absolutely do **not** need to pay just to get convincing global canopy.

The progression is more like:

```text
                 COST             COVERAGE        PRECISION

OSM               $0               global           poor/inconsistent
Municipal DB      $0               local            excellent-ish
Meta/WRI CHM      $0               global           good/modelled
Satellite LULC    $0               global           coarse
Commercial maps   $$               global           varies
LiDAR / photogram $$$              regional         excellent
```

And you can combine them.

---

## Your Madrid result is actually the perfect demonstration

Shadowmap:

> detailed tree data available in **Vienna, Madrid & Paris**. ([Shadowmap][8])

Madrid:

> publishes an enormous per-tree municipal inventory. ([Madrid Data][3])

Your OSM census:

> only captures ~23% of Madrid's inventoried street trees.

There's no mystery anymore.

**They aren't discovering some secret Overpass tag that you're missing.**

They're doing heterogeneous data fusion.

And for the places without nice municipal datasets, they're accepting lower-fidelity/global sources.

That Shadowmap Madrid view above is particularly telling: those rows of modeled vegetation aren't evidence that OSM secretly has perfect tree coverage.

---

## So I would slightly change the direction of the project

Keep **A7a/b**. You did useful engineering work. OSM trees can contribute real information where they exist.

I would *not* spend much more time on A7c right now.

Move directly to something like:

```text
A8a  Meta/WRI dataset feasibility + licensing
A8b  AOI extraction / tiling pipeline
A8c  canopy-height → ShadowField integration
A8d  raster canopy visualization
A8e  source fusion:
     municipal > OSM detailed > WRI/Meta inferred
A8f  corpus evaluation
```

For the browser I also would **not stream the enormous original GeoTIFFs directly**. Preprocess them for your supported areas into COG/tiles/PMTiles or a similar route-sized representation, fetch only the neighborhood surrounding the candidate routes, and cache aggressively.

Then your system becomes much more interesting technically:

**building geometry + solar model + remote sensing + municipal GIS + volunteered geographic information → uncertainty-aware multimodal shade field.**

That's significantly more sophisticated than merely adding some green tree models.

And it resolves the contradiction in `#275`: once you're painting a remotely sensed canopy layer rather than the tiny subset of known OSM tree points, the green UI representation and the route's `"canopy"` provenance can finally describe approximately the **same physical thing**.

So no — you haven't somehow failed to figure out how everyone else is querying OSM.

**You've reached the point where OSM has run out of information.** The next layer is remote sensing, and conveniently, a very good global dataset for precisely this problem is already free.

[1]: https://docs.mapbox.com/map-styles/guides/standard-styles/?utm_source=chatgpt.com "Standard Styles | Mapbox Styles | Mapbox Docs | Mapbox"
[2]: https://shadowmap.org/learn/trees-in-the-city "Trees in the City"
[3]: https://datos.madrid.es/dataset/300761-0-arbolado-especies/downloads?utm_source=chatgpt.com "Arbolado en parques y zonas verdes de Madrid (detalle) - Descargas - Conjunto de datos - Portal de datos abiertos del Ayuntamiento de Madrid"
[4]: https://datasets.wri.org/datasets/meta-tree-canopy-height "High Resolution Canopy Height Map - Datasets - WRI Data Explorer"
[5]: https://registry.opendata.aws/dataforgood-fb-forests/ "High Resolution Canopy Height Maps by WRI and Meta - Registry of Open Data on AWS"
[6]: https://coolcities.wri.org/data-and-methods?utm_source=chatgpt.com "Cool Cities Lab | World Resources Institute"
[7]: https://shademap.app/help/ "Help - ShadeMap"
[8]: https://shadowmap.org/solutions/shadowmap-home "Shadowmap | Solutions for Home Seekers, Owners, Improvers"
