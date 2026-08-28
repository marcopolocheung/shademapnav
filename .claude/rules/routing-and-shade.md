---
paths:
  - "app/lib/routing.ts"
  - "app/lib/trainGraph.ts"
  - "app/lib/shadeSampling.ts"
  - "app/lib/travelMode.ts"
  - "app/lib/partialRoute.ts"
  - "app/lib/routeTradeoff.ts"
  - "app/lib/bestTime.ts"
---

# Routing, the cost model, and shade sampling

Pure TypeScript, no map instance, no React. That is what makes this code testable, and it is
worth protecting: if you find yourself wanting the live map here, the seam is in the wrong
place — the caller should sample and pass the result in.

## Changes here need tests

Behavior changes to `routing.ts`, `trainGraph.ts` and `shadeSampling.ts` require test
coverage — not as a formality, but because these are the files whose bugs are invisible. A
wrong cost weight produces a route that looks perfectly reasonable and is wrong.

Tests live in `app/lib/__tests__/`. Test **behavior**: given this graph and this sun position,
this path wins. A test that restates the implementation — asserting the exact expression the
function computes, or counting internal calls — passes forever and catches nothing.

## The cost model

`GraphEdge` already carries `highway`, `surface`, `cycleway`, `bicycle`, `foot`, and the
Overpass query already ingests `cycleway`, `steps`, `track`, `bridleway`. `travelMode.ts`
defines `TRAVEL_MODE_POLICIES` with `speedMps`, `stepsPenaltyM`, `roughSurfacePenaltyM` and
`cyclewayPreferenceM` — and `useNavigation.ts` currently imports exactly one thing from it,
`travelTimeSeconds`. **The three penalties are dead code, not missing data.** Before adding a
new input, check whether the one you want is already there and unread.

Shade is one term in a multi-objective cost, not a filter. The product's value is the
*tradeoff* — a route 6% longer and 40% shadier — so keep the Pareto structure intact rather
than collapsing it to a single scalar early.

`routing.ts` leans on non-null assertions and Biome's `noNonNullAssertion` is off for that
reason. Match the surrounding style; do not opportunistically rewrite them.

## Shade sampling

`isBlueDominantShadowPixel` is the shared predicate that defines "shaded" for the whole app,
and it is coupled to the shadow colours in `app/lib/shadow/LocalShadowAdapter.ts` after
compositing. Read `.claude/rules/shadow-renderer.md` before touching either side.

`sampleBothSidewalks()` samples ±4 m perpendicular offsets and returns `{left, right}`
independently. That asymmetry is the product's single most distinctive asset — it is what
makes "cross to the shaded side" possible. Do not average it away for a tidier return type.

## Honesty

`shadeCoverage: 0..1` is a blue-pixel fraction. It is not a measurement, and the agreement
harness reports a worst case in the tens of percentage points. Anything derived from it
inherits that uncertainty. If you surface a new number, it must be traceable to a method
someone can read, and the UI must state its uncertainty — that is a stated project guardrail,
not a nicety.

## Performance

Route calculation is on the interactive path. Prefer precomputation and reuse over
re-deriving per query — there is a known open issue about rebuilding polygons per query. If
you make it faster, measure it; the performance baseline notes exist precisely because timings
were being asserted rather than taken.
