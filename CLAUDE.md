# ShadeMap Navigator — Agent Guide (canonical entry)

Browser-based sun-shadow simulation with shade-aware pedestrian + transit routing.
React 19 + Vite 5 + TypeScript + Tailwind v4 + MapLibre GL. Everything runs client-side
except one serverless proxy (`api/fsq.js`). Deployed: https://shademapnav.vercel.app

**Read order (keep context small):** this file → "Where to edit what" table → ONE

## Commands

```bash
npm install
npm run dev        # Vite dev server → http://localhost:5173
npm test           # vitest run — app/{lib,services}/__tests__/**
npx tsc --noEmit   # typecheck (no dedicated script)
npm run lint       # eslint (flat config, minimal rules)
npm run build      # vite build → dist/
```

Env (`.env.local`): `VITE_MAPTILER_API_KEY` (required), `VITE_FOURSQUARE_API_KEY`
(place popups). `VITE_SHADEMAP_API_KEY` / `VITE_TRANSITLAND_API_KEY` are vestigial — unused.

## Hard invariants (breaking any of these breaks the app)

1. **`maplibre-gl` stays pinned at exactly `5.9.0`.** v5.10+ changes `Texture.update`
   so `mapbox-gl-shadow-simulator`'s `{width,height}` call crashes WebGL2
   ("Overload resolution failed").
2. **`LocalShadowAdapter.ts` directly imports two transitive deps**: `suncalc` (provided
   via `mapbox-gl-shadow-simulator`) and `earcut` (via `maplibre-gl`). Removing/replacing
   either provider package without adding the lib to `package.json` breaks the build.
   Neither has type declarations — source of 3 known pre-existing `tsc` errors.
3. **Map must keep `canvasContextAttributes: { preserveDrawingBuffer: true }`** —
   shade sampling and GeoTIFF export read the canvas back.
4. **`MapView` is only imported via `React.lazy`** in `app/page.tsx` (code-splits MapLibre).
   Never import it statically from app code (type-only imports are fine).
5. **Shade detection couples to shadow color.** Routing decides "shaded" by canvas pixel
   test `B/R > 1.8`; the shadow color `#01112f` guarantees it. Change one → change both
   (`LocalShadowAdapter.ts` ↔ `app/lib/shadeSampling.ts`).
6. **Nominatim and Overpass requests need a `User-Agent` header** or they get rejected.
7. **Never read or edit `.worktrees/`** — an orphaned, stale checkout (gitignored, not a
   registered worktree). Same for any `oldbuild/` copy you encounter.

## Repo map

| Path | What lives there |
|---|---|
| `app/page.tsx` | Root component: composes hooks + layout; owns only small UI state 
| `app/main.tsx` | Entry; BrowserRouter (`/`, `/about`) | — |
| `app/hooks/` | All real state: `useShadowTime`, `useNavigation` (routing pipeline), `useAppState` (phase FSM) | `app/hooks/CLAUDE.md` |
| `app/components/` | UI components incl. `MapView` (map + layers) | `app/components/CLAUDE.md` |
| `app/lib/` | Pure TS: routing, overpass, trainGraph, shade sampling, exports | `app/lib/CLAUDE.md` |
| `app/lib/shadow/` | Local WebGL shadow renderer (CustomLayerInterface) |
| `app/services/` | Third-party API wrappers (Foursquare) | `app/services/CLAUDE.md` |
| `app/workers/` | `sunPosition.worker.ts` — sun-position worker used by the shadow renderer (Vite `?worker` import) | `app/workers/CLAUDE.md` |
| `api/` | Vercel serverless Foursquare proxy (prod CORS) | `api/CLAUDE.md` |
| `.claude/` | This guide's history: deep-dive working notes |
| `tools/tailor/` | Empty placeholder (resume-tailor CLI spec'd, never built — explains unused `@anthropic-ai/sdk`/`openai`/`commander`/`zod` deps) | — |

## Where to edit what

| Task domain | Read | Edit points |
|---|---|---|
| Shadow rendering (look, correctness, perf) | `app/lib/shadow/LocalShadowAdapter.ts` |
| Timeline slider, play/pause, date/time input | `app/components/TimelineSlider.tsx`, `app/hooks/useShadowTime.ts` |
| Walking-route algorithm, cost model, Pareto | `app/lib/routing.ts` (+ `__tests__/routing.test.ts`) |
| Route UX: waypoints, calc flow, cards, save/export | `app/hooks/useNavigation.ts`, `app/components/DirectionsPanel.tsx` |
| Sketch / draw-route mode | `useNavigation.ts` (`calculateSketchRoute`), `MapView.tsx` (sketch layers) |
| Train/transit routing | `app/lib/trainGraph.ts`, `useNavigation.ts` (`calculateRoute`) |
| Search, geocoding, place details | `app/components/SearchBar.tsx`, `app/services/foursquare.ts` |
| Map layers, markers, popups, 3D | `app/components/CLAUDE.md` | `app/components/MapView.tsx` |
| Sun-exposure mode, GeoTIFF export | `app/components/AccumulationPanel.tsx` |
| Screen flow / app phases |  `app/hooks/useAppState.ts`, `app/page.tsx` |
| Layout, sidebar, bottom sheet, responsive |  `app/components/AppShell.tsx`, `app/page.tsx` |
| Build, deploy, env, proxies | `vite.config.ts`, `vercel.json`, `api/fsq.js` |

## State model (30 seconds)

`page.tsx` composes three hooks and passes props down — components hold no app state:
- `useShadowTime` — date/time, slider mode, play animation, map center/zoom/UTC offset, `mapRef`
- `useNavigation` — waypoints, routes, sketch mode, saved routes, the entire route-calculation pipeline
- `useAppState` — UI phase FSM: `IDLE → PLACE_DETAIL → DIRECTIONS → NAVIGATING → ARRIVAL`

Map instance flows up once via `onMapReady(map)` into a ref (never state).

## Verification

- Logic changes: `npm test` + `npx tsc --noEmit` before claiming done.
- UI/map changes: also verify in `npm run dev` (shadows render, slider drags, route calculates).