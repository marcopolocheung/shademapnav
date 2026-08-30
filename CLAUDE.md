# ShadeMapNav — Agent Guide (canonical entry)

ShadeMapNav is a personal open-source shaded-route navigation project. It is an
independent personal project and is not affiliated with ShadeMap.app.
Browser-based sun-shadow simulation with shade-aware pedestrian + transit routing.
React 19 + Vite 5 + TypeScript + Tailwind v4 + MapLibre GL. Everything runs client-side
except one serverless proxy (`api/fsq.js`). Deployed: https://shademapnav.vercel.app

**Read order (keep context small):** this file → the "Where to edit what" table → the file.
The per-area constraints load themselves: `.claude/rules/` is path-scoped, so opening
`app/lib/routing.ts` pulls in the routing rule and nothing else. Don't go looking for
per-directory `CLAUDE.md` files — that's what the rules replaced. See `.claude/README.md`
for the whole agent setup.

## Commands

```bash
npm install
npm run dev        # Vite dev server → http://localhost:5173
npm test           # vitest run — app/{lib,services,hooks,components}/__tests__/**
npm run typecheck  # tsc --noEmit
npm run lint       # biome lint — blocks on errors, ~180 known findings are "warn"
npm run format     # biome format --write (never yet run repo-wide; see biome.json)
npm run build      # vite build → dist/
```

Lint config is `biome.json` (Biome replaced ESLint, whose config had zero rules and
matched zero `.ts` files). Rules the codebase intentionally violates — `noNonNullAssertion`
(`routing.ts` leans on `!`), `noExplicitAny` (maplibre interop), `noApproximativeNumericConstant`
(solar constants) — are `off`. Large real backlogs (a11y, `useExhaustiveDependencies`)
are `warn` so they surface without blocking. Everything else in Biome's recommended set
is an error and will fail CI.

CI (`.github/workflows/ci.yml`) runs lint → typecheck → test → build on every PR to
`main` and every push to `main`. It needs no secrets: the build inlines missing
`VITE_*` vars as `undefined`, and the test suite is hermetic (no network, no env).

Env (`.env.local`): `VITE_MAPTILER_API_KEY` (required), `VITE_FOURSQUARE_API_KEY`
(place popups). `VITE_SHADEMAP_API_KEY` / `VITE_TRANSITLAND_API_KEY` are vestigial — unused.

AI assistant (Shade Assistant, `app/lib/agent/`): uses a **free** LLM — **Cerebras only**
(OpenAI-compatible, ~1M tokens/day **per account**, but only 5 req/min). Key:
https://cloud.cerebras.ai. dev `VITE_CEREBRAS_API_KEY` (via the Vite `/__cerebras` proxy);
prod `CEREBRAS_API_KEY` (server-only, via `api/agent.js`).
- **One shared key pool.** List every account's key comma-separated in
  `VITE_CEREBRAS_API_KEY` (and/or numbered `_1/_2/_3` dev, `_1.._9` prod) — the client (dev)
  and `api/agent.js` (prod) round-robin across the pool and fail over to the next key on
  429/5xx, so N accounts ≈ N×1M tokens/day. There is **no per-role key split** anymore — all
  roles draw the one pool.
- **Per-role model (not key):** the loop does its tool-use research with the "research" model,
  then writes the final answer with the "response" model. `VITE_CEREBRAS_RESEARCH_MODEL`
  (default `gpt-oss-120b`) / `VITE_CEREBRAS_RESPONSE_MODEL`; base default `VITE_CEREBRAS_MODEL`.
  Current: research=`zai-glm-4.7`, response=`gpt-oss-120b`. If both resolve to the same model,
  `rolesShareConfig()` makes the loop skip the separate write call (the research answer IS the
  answer). Note: both are reasoning models (emit a `reasoning` field; `fromOpenAI` reads
  `content`). gpt-oss-120b is great at the write but its reasoning eats the token budget on
  tool-calls — keep zai-glm-4.7 (or another non-reasoning-heavy model) for research.
The loop is tuned for determinism: temperature 0, fixed `seed`, `parallel_tool_calls: false`,
`MAX_STEPS` 8 (the happy path needs ~5 tool turns through plot_points — a lower cap strands the
loop before pins reach the map), and a tightly-scoped system prompt (shade-day-planning only).
**Determinism by pre-injection:** `get_current_context` is NOT a tool — the map center / local
time / location-known status is plain app state, so `agentLoop.ts` reads it once per turn (via
the still-present `executeTool("get_current_context")` executor) and appends it to the system
prompt, saving a guaranteed LLM round-trip. The final write call uses a separate, tool-free
system prompt so a reasoning response model never narrates uncallable tools into the answer.
The agent loop runs client-side (it orchestrates tools needing the live map canvas:
geocoding, the solar model, on-canvas shade sampling, time/camera, the routing pipeline).
The loop speaks one neutral IR (`LlmContent`/`LlmPart`); `llmClient.ts` translates it to/from
the OpenAI chat-completions shape Cerebras expects.

## Hard invariants (breaking any of these breaks the app)

The mechanical ones are **enforced**, not merely requested: `.claude/hooks/guard-invariants.sh`
runs on every `Edit`/`Write` and denies the edit. #5 escalates to a prompt instead, because it
is a judgment call. A hook denial is not an obstacle to route around with `sed` — it means the
approach needs to change.

1. **`maplibre-gl` stays pinned at exactly `5.9.0`.** v5.10+ changes `Texture.update`
   so `mapbox-gl-shadow-simulator`'s `{width,height}` call crashes WebGL2
   ("Overload resolution failed").
2. **`LocalShadowAdapter.ts` directly imports `suncalc` and `earcut`.** Both arrive
   transitively too (via `mapbox-gl-shadow-simulator` and `maplibre-gl`), but PR #10
   pinned them as direct `dependencies` alongside `@types/suncalc` / `@types/earcut`,
   so the import is typed and survives a provider-package swap. Keep them declared —
   dropping either back to a transitive-only dep re-breaks both the build and `tsc`.
   **`suncalc` also stays on `1.x`.** 2.x is an ESM rewrite exporting only named
   functions, so the `import SunCalc from "suncalc"` in `sunPosition.worker.ts`,
   `LocalShadowAdapter.ts`, and `offscreenShade.ts` fails the Vite/rollup build
   ("default is not exported by node_modules/suncalc/index.js"). Independently,
   `mapbox-gl-shadow-simulator` depends on `suncalc ^1.9.0`, so bumping ours to 2.x
   installs a *second* copy and skews solar math between our sampling and the
   renderer. Both this and the maplibre pin are enforced in `.github/dependabot.yml`.
3. **Map must keep `canvasContextAttributes: { preserveDrawingBuffer: true }`** —
   shade sampling and GeoTIFF export read the canvas back.
4. **`MapView` is only imported via `React.lazy`** in `app/page.tsx` (code-splits MapLibre).
   Never import it statically from app code (type-only imports are fine).
5. **Shade detection couples to shadow color.** Routing and assistant spot checks decide
   "shaded" with the shared `isBlueDominantShadowPixel` predicate:
   `r + g + b < 600 && b - ((r + g) / 2) > 18 && b > ((r + g) / 2) * 1.15`.
   The shadow colors in `LocalShadowAdapter.ts` must stay blue-dominant enough to
   satisfy that predicate after compositing over the basemap.
6. **Nominatim and Overpass requests need a `User-Agent` header** or they get rejected.
7. **Never read or edit `.worktrees/`** — an orphaned, stale checkout (gitignored, not a
   registered worktree). Same for any `oldbuild/` copy you encounter.

## Repo map

| Path | What lives there | Read before editing |
|---|---|---|
| `app/page.tsx` | Root component: composes hooks + layout; owns only small UI state | `.claude/rules/components-and-map.md` |
| `app/main.tsx` | Entry; BrowserRouter (`/`, `/about`) | — |
| `app/hooks/` | All real state: `useShadowTime`, `useNavigation` (routing pipeline), `useAppState` (phase FSM) | `.claude/rules/hooks-and-state.md` |
| `app/components/` | UI components incl. `MapView` (map + layers) | `.claude/rules/components-and-map.md` |
| `app/lib/` | Pure TS: routing, overpass, trainGraph, shade sampling, exports | `.claude/rules/routing-and-shade.md` |
| `app/lib/shadow/` | Local WebGL shadow renderer (CustomLayerInterface) | `.claude/rules/shadow-renderer.md` |
| `app/services/` | Third-party API wrappers (Foursquare) | `.claude/rules/external-apis.md` |
| `app/workers/` | `sunPosition.worker.ts` — sun-position worker used by the shadow renderer (Vite `?worker` import) | `.claude/rules/shadow-renderer.md` |
| `api/` | Vercel serverless Foursquare proxy (prod CORS) | `.claude/rules/external-apis.md` |
| `.claude/` | Agent config: enforced invariants (hooks), path-scoped rules, agents, skills | `.claude/README.md` |
| ~~`tools/tailor/`~~ | Gone. The resume-tailor CLI was spec'd but never built; its leftover `@anthropic-ai/sdk`/`openai`/`commander` deps were dropped. `zod` is still declared but unimported. | — |

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
| Map layers, markers, popups, 3D | `.claude/rules/components-and-map.md` | `app/components/MapView.tsx` |
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

- Run `/gates` — all four, in order, with the real output. It records the result that the
  `Stop` hook and the status line read, so the session cannot end on an unearned "tests pass".
- UI/map changes: also verify in `npm run dev` (shadows render, slider drags, route
  calculates). Nothing in `npm test` runs a browser — it never has. If you can't look, say the
  check is outstanding rather than letting four green gates imply it.
- Before a PR opens: `/checkpoint` walks the definition of done and gets a cold review from
  the `verifier` agent.
