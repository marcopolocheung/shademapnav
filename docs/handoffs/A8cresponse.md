Yes — the corrected version is the right way to think about it:

**A8c is fully feasible to run right now. Whether CHMv2 passes A8c is unknown.**

And I agree with the ordering change: **skip A8b for now.** Building `CanopyTileStore` before establishing that CHMv2 is usable urban-canopy data would be engineering infrastructure around an unvalidated source.

The sequence should now be:

```text
A8a — Can we obtain CHMv2 cheaply/reliably?
  ✅ yes

A8c — Is CHMv2 actually safe enough in cities?
  ❓ run now

        ├─ PASS → A8b → A8d → A8e → A8f
        │
        └─ FAIL → stop CHMv2 routing work
                  investigate segmentation / another source
```

The Singapore discovery actually makes A8c **better**, with one caveat. I would not silently replace the A3 Singapore corpus point with Raffles Place. Instead, use both:

```text
Madrid A3 AOI
Kent A3 AOI
Singapore A3 AOI          ← preserves corpus alignment

Singapore CBD stress AOI  ← dense-city validity test
```

The Singapore corpus point being near reservoir/green land is itself useful information: it simply isn't a meaningful test of **dense urban building confusion**. Raffles Place is exactly the adversarial case you need for that question.

So the study can explicitly say:

> The A3 Singapore coordinate was retained for corpus comparability, but because it lies outside dense urban morphology, an additional Singapore CBD AOI was included as an urban-confusion stress test.

That is stronger than either dropping Singapore or pretending the centroid represents Singaporean urban form.

For heights, I'd also take option **(a)** now. You don't need MapTiler to answer the central question. Run footprint/ring/retention metrics everywhere, and run building-height stratification wherever OSM gives enough support:

```text
Madrid          20.8% height/levels → usable, biased sample
Kent             2.7%               → probably descriptive only
Singapore CBD   91.8%               → excellent stress test
```

That combination is actually pretty good. Singapore CBD is likely your strongest test of the exact nightmare scenario: **does a high-rise tower turn into a high CHM value?**

The one thing I would add before executing A8c is to **freeze the decision criteria first**. Otherwise there's a temptation to see the results and retroactively decide what “acceptable” means.

I wouldn't necessarily use arbitrary limits like “anything above 5% fails.” Instead define failure signatures. For example, CHMv2 should stop before routing if you see strong evidence such as:

* CHM-positive area systematically occupying building interiors, especially at `>5 m`.
* CHM height increasing with known building height inside footprints.
* High-rise bins having dramatically more contamination than low-rise bins.
* A large fraction of apparent canopy disappearing after exact building masking.
* Another large collapse from only `+1 m` or `+2 m` dilation, suggesting building-edge leakage rather than vegetation.
* Singapore CBD showing substantial high-valued CHM over dense towers.

That gives you a very useful diagnostic distinction too:

```text
Case 1
building interiors dirty
+ exact mask fixes almost everything

→ CHMv2 potentially usable after building masking


Case 2
building interiors dirty
+ contamination extends 2–5m outside buildings

→ registration / model confusion
→ much more dangerous


Case 3
CHM height tracks building height

→ strongest evidence model is responding to structures
→ likely reject for routing
```

That third case is the one I'd care about most. If a 10 m building tends to contain ~10 m CHM, a 30 m building ~30 m CHM, a 50 m building ~50 m CHM, that's basically a smoking gun. You're no longer observing random tree crowns overlapping roofs; you're observing the model reproduce urban structure height.

Conversely, simple footprint overlap alone **isn't enough to condemn it**, because real tree crowns can overhang roofs:

```text
      canopy
   ███████████
       █████████
        ┌───────┐
        │ house │
        └───────┘
```

That's why the combination of **height correlation + interior overlap + rings + dilation sensitivity** is much more convincing than one overlap percentage.

I also agree with caching the decoded CHM immediately during the study. A8c is supposed to measure the dataset, not repeatedly benchmark `source.coop`'s patience:

```text
first run:

source.coop
    ↓
readCanopyHeights()
    ↓
local fixture/cache
    ↓
all subsequent A8c analysis
```

That keeps transient 504s from contaminating the science.

So I'd now define the scope as:

```text
A8c — CHMv2 urban building-confusion gate

AOIs
  Madrid A3
  Kent A3
  Singapore A3
  Singapore CBD stress case

Inputs
  CHMv2 uint8 raster
  OSM building footprints
  existing Umbra heightMForBuilding()
  committed acquisition-date index

Measures
  1. footprint pixels >2 / >3 / >5m
  2. fraction of predicted canopy inside footprints
  3. CHM height vs building height where available
  4. 0–2m and 2–5m exterior rings
  5. retention after exact / +1m / +2m masks
  6. imagery vintage / season context

No
  routing
  ShadowField
  UI
  CanopyTileStore
  MapTiler dependency
```

And then **stop**.

Don't start A8b in the same session merely because A8c happens to look promising. The deliverable should be the measurement note and a verdict:

```text
PASS
CHMv2 is sufficiently separable from buildings;
proceed to production transport/caching.

CONDITIONAL PASS
usable only after building masking / other mitigation;
document required preprocessing.

FAIL
urban structural confusion is too severe;
do not feed CHMv2 into ShadowField.
```

That last outcome would still make A8a + A8c very worthwhile work. You would have empirically killed a tempting but unsafe architecture **before** spending time integrating it.

So yes: **the gate itself is feasible now. The feature is not yet proven feasible.** That's the clean distinction.
