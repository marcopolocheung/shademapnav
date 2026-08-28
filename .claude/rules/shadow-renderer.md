---
paths:
  - "app/lib/shadow/**"
  - "app/workers/**"
  - "app/lib/shade/**"
---

# Shadow rendering and the solar model

You are in the code that decides what "shaded" means. Everything downstream — routing costs,
the assistant's spot checks, the exposure series, the heat score — is a consumer of this
answer. A subtle error here is invisible and contaminates every number the product shows.

## The layout

- `IShadowLayer.ts` — the interface both adapters satisfy
- `LocalShadowAdapter.ts` — the local WebGL renderer, a MapLibre `CustomLayerInterface`
- `ShadeMapAdapter.ts` — the third-party `mapbox-gl-shadow-simulator` path
- `createShadowLayer.ts` — selects between them
- `offscreenShade.ts` — viewport-independent shade queries (no camera move)
- `app/workers/sunPosition.worker.ts` — sun position, imported by Vite `?worker`

## Non-negotiable here

**`import SunCalc from "suncalc"` — the default import.** `suncalc` is pinned to `1.x`
*because* of this line, in this file and in `LocalShadowAdapter.ts` and `offscreenShade.ts`.
2.x is an ESM rewrite exporting only named functions and fails the rollup build with
"default is not exported by node_modules/suncalc/index.js". Independently,
`mapbox-gl-shadow-simulator` depends on `suncalc ^1.9.0`, so bumping ours installs a *second*
copy and skews solar math between our sampling and the renderer.

**`suncalc` and `earcut` stay direct dependencies**, with their `@types` packages, even though
both also arrive transitively. That is what keeps these imports typed and survivable across a
provider-package swap.

**Shadow colours are coupled to shade detection.** Routing and the assistant decide "shaded"
with `isBlueDominantShadowPixel` in `app/lib/shadeSampling.ts`:

```
r + g + b < 600  &&  b - ((r + g) / 2) > 18  &&  b > ((r + g) / 2) * 1.15
```

Colours here must stay blue-dominant enough to satisfy that predicate **after compositing over
the basemap** — not in isolation. Changing a colour without re-checking the predicate silently
re-scores every route in the app. If you touch either side, check both in the same change; a
`PreToolUse` hook will stop and ask you to confirm.

**`maplibre-gl` is pinned at exactly `5.9.0`.** v5.10+ changes `Texture.update` so the
simulator's `{width, height}` call crashes WebGL2 with "Overload resolution failed".

**The canvas keeps `preserveDrawingBuffer: true`.** Shade sampling and GeoTIFF export read it
back; without it they return empty pixels rather than failing loudly.

## Working here

Prefer camera-free queries. The historical bug was `check_shade` flying the camera for 10–15
seconds to sample a pixel; the current path queries the geometry cache
(`queryPointShade()`), falls back to `queryOffscreenBuildingShade()`, and errors rather than
moving the map. Keep it that way — a shade query that moves the user's viewport is a
regression even when the number is right.

Solar constants are exempt from Biome's `noApproximativeNumericConstant`; that is deliberate,
not an oversight to clean up.

This is WebGL running on a phone, outdoors, possibly during navigation. Per-frame allocation
and redundant texture uploads cost battery, not just milliseconds.

**You cannot verify a render change with tests.** `npm test` runs in `environment: "node"` and
has never executed this code in a browser. A shadow change is not done until it has been seen
in `npm run dev`. Say so plainly rather than letting a green suite imply otherwise.
