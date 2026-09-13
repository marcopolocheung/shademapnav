This is a strong PASS. More precisely:

> **Within the four tested AOIs, CHMv2 shows no evidence of systematically interpreting buildings as canopy, including in the dense/high-rise Singapore CBD stress case.**

That is stronger than merely “overlap is low.”

The most convincing evidence is the combination, not any single metric. Singapore CBD is the killer result: median building height ~95 m, median interior CHM 0 m, only 1.0% of roof area above 2 m, and essentially no relationship between building height and CHM height (`ρ = 0.090`, `n = 1,231`). If CHMv2 were reading towers as vegetation, that is exactly where the signal should have exploded.

Your ring result is also excellent:

```text
inside footprint → 0–2 m → 2–5 m → farther away
      1.1%          3.5%      4.8%        9.4%
```

That's almost the opposite fingerprint of building-edge leakage. The raster becomes *more* canopy-like as you move away from buildings.

And I especially like the two controls you added. The 50 m shifted-footprint test answers a subtle objection that would otherwise hang over the whole study:

> “Maybe CHMv2 just happens to have zeros wherever the building dataset is.”

Moving the mask and seeing overlap jump ×4, ×4.5, ×23 is strong evidence that the original spatial relationship is real rather than an artifact. Likewise, the interior histogram addresses the “zero = nodata?” concern much better than just reporting a median of zero.

Madrid being only ×1.26 on the shifted control is worth carrying forward exactly as you did, but I wouldn't reinterpret the overall result around it. Madrid already has the highest apparent building overlap, and its raw number is still **below its 31.1% chance baseline**:

```text
Madrid

building footprint share:       31.1%
CHM >2 m on buildings:          17.4%

relative to random expectation: 0.56×
```

So even the least-clean AOI still points in the safe direction.

The retention numbers make the mitigation cheap enough that I agree with keeping footprint subtraction regardless:

```text
building-mask retention:
82.6% – 100%
```

Worst case, you're discarding about 17% of inferred canopy to enforce a very useful invariant:

> **A pixel occupied by a known building cannot simultaneously become a canopy caster.**

That's a reasonable conservative bias for a pedestrian-shade model.

I would also keep the wording around the conclusion scoped. I wouldn't write:

> CHMv2 does not mistake buildings for canopy.

I'd write:

> **A8c found no material building-as-canopy confusion in the tested A3 AOIs and Singapore CBD stress case.**

Because you've established enough to permit Umbra to use it, not proven a global theorem about every urban morphology.

The branch discipline sounds right too. Freezing criteria in `cfd99cb` before seeing numbers materially improves the credibility of the study. And you were right not to write a green test marker under Node 20 when the repo contract is Node 24. If the PR's Node-24 CI passes, then the full gate can be considered green; the local `jsdom` failures are very well isolated given that even `require('jsdom')` fails independently.

So the state of A8 is now substantially different:

```text
A8a — transport feasibility
PASS
Direct CHMv2 access is viable.

        ↓

A8c — urban confusion gate
PASS
No material building→canopy confusion detected.

        ↓

A8b — NOW justified
Production transport/cache lifecycle.

        ↓

A8d
Height field → ShadowField.

        ↓

A8e
Source fusion + vintage/confidence work.
#281 remains important.

        ↓

A8f
Canopy rendering.
```

And I agree with **not starting A8b in this branch**. A8c should remain a clean measurement PR.

For A8b, I would now keep the scope brutally infrastructural: turn the proven A8a reader into a reusable `CanopyTileStore` with caching, request deduplication, stale-request cancellation, explicit overview selection, and independent route/viewport consumers. **Still no ShadowField behavior change.**

Then A8d becomes the first slice where trees are allowed to affect the route score.

The bigger takeaway is that the scary failure mode that could have killed the entire free-data strategy appears not to exist, at least in the environments you deliberately tested. That means your earlier decision not to spend money on premium tree data is looking much more defensible now.
