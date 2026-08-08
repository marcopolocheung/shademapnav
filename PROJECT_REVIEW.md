# Project Review — ShadeMap Navigator

*End-to-end review, 2026-07-05, on branch `feat/ai-agent-integration` (uncommitted agent work included). Verification run: **94/94 tests pass**, **build succeeds** (Vite 8/rolldown, 741ms), **lint passes** (but see below), **typecheck has 4 errors** (3 documented, 1 new).*

---

## What's working

### Core product
- **The full pipeline works and is deployed** (https://shademapnav.vercel.app): WebGL building-shadow simulation, timeline scrubbing, shade-aware pedestrian routing with Pareto route options (shortest / balanced / most-shaded), transit routing, sketch mode, sun-exposure accumulation with GeoTIFF export.
- **Test coverage where it matters.** 94 tests across 6 files, concentrated on the pure-logic layer (`routing.ts` alone has a 919-line test file). The layering — pure TS in `app/lib/`, state in hooks, dumb components — is exactly what makes that testability possible.
- **Clean state model.** `page.tsx` composes three hooks (`useShadowTime`, `useNavigation`, `useAppState`) and pushes props down; components hold no app state; the map instance flows up once into a ref. This is easy to reason about and has clearly stayed disciplined as the app grew.
- **Smart routing internals.** The Pareto search in `routing.ts` uses a detour budget with optimistic-bound pruning (`routing.ts:454-616`) — a genuinely good algorithmic design, and the comments explain the invariants.
- **Documentation is unusually good.** The `CLAUDE.md` tree (root + per-directory) with the "hard invariants" list and the task→edit-point table is the kind of documentation most projects never get. `AGENTS.md` correctly points at it as canonical.

### New agent work (this branch)
- **Sound architecture.** The agent is a thin orchestration layer over capabilities the app already had: tools in `app/lib/agent/tools.ts` wrap geocoding, the solar model, canvas shade sampling, time state, and the routing pipeline through an `AgentContext` of live handles — no React imports in agent code, no duplicated logic.
- **Provider isolation done right.** The loop speaks a neutral IR; `llmClient.ts` translates to/from OpenAI chat-completions. Swapping providers later means touching one file.
- **Resilience engineering.** Key pooling with round-robin + failover on 429/5xx (client and `api/agent.js`), Retry-After-aware rate-limit retry, malformed-tool-call retry, and text-embedded tool-call salvage (`extractTextToolCalls`) for models that emit calls as plain text. This is more robustness than most hobby agent integrations ever get.
- **Determinism thinking.** temperature 0 + fixed seed + serial tool calls + pre-injecting map context into the system prompt instead of burning a tool round-trip (`agentLoop.ts:81-94`) — the reasoning is documented in place.
- **Vite 5→8 migration** landed cleanly (function-form `manualChunks`, build output is well-chunked, MapView/MapLibre code-split preserved).

---

## What isn't working

### 1. The headline bug: itineraries are narrated but never plotted (userTODO.md #1)
The wiring is correct end-to-end (`setPins` → `page.tsx` state → `MapView` markers — verified), so the pins path itself is fine. The failure is upstream: **`plot_points` frequently never gets called before the loop runs out of budget.**

- `MAX_STEPS = 8` (`agentLoop.ts:37`) with `parallel_tool_calls: false` means every tool call is its own round-trip. The comment itself admits the happy path needs ~5–6 tool turns; one extra `geocode_place` or a fourth `check_shade` and `plot_points` falls off the end.
- When the step budget is exhausted, the loop silently drops into the write phase, and the response model **writes a confident itinerary that was never placed on the map**. The user sees the camera "teleport" (from `locate_user` / `check_shade` flyTos) and gets an answer, but no pins and no route — exactly the symptom in `userTODO.md`.
- There is no fallback: the loop already *has* the coordinates (they're sitting in the `search_places`/`check_shade` tool results in history) but discards them.

### 2. Agent turns are painfully slow
Each `check_shade` hijacks the camera: flyTo (600ms) → `waitForIdle` (up to 4s) → 650ms shadow-recompute delay → sample → flyTo back (`tools.ts:388-417`). Three probes ≈ 10–15 seconds of camera thrash the user watches. On top of that, Cerebras free tier is **5 requests/minute**, so an 8-step research loop can take multiple minutes even when nothing fails.

### 3. No multi-stop journeys (userTODO.md #2)
`plan_shaded_route` only accepts two points (`tools.ts:237-252`), but `useNavigation` already supports `additionalWaypoints` — the capability exists and simply isn't exposed to the agent. A "10-point journey" can't be calculated regardless of timeouts.

### 4. Lint is a no-op
`eslint.config.*` contains only a `dist/` ignore — **zero rules, zero plugins**. "npm run lint passes" verifies literally nothing. This is worse than no lint script because it manufactures false confidence.

### 5. Typecheck has a *new* error
Beyond the 3 documented suncalc/earcut errors, `app/services/__tests__/foursquare.test.ts:119` now fails with TS2349 (`Type 'never' has no call signatures`) — almost certainly fallout from the vitest 2→4 bump on this branch. It should be fixed before merge, not absorbed into the "known errors" pile.

### 6. Documentation drift (ironic, given how good the docs are)
- `CLAUDE.md:4` says **Vite 5**; the branch is on **Vite 8**.
- Hard invariant #5 says the shade predicate is **`B/R > 1.8`**; the actual predicate in both `shadeSampling.ts:52-56` and `tools.ts:131-132` is `r+g+b < 600 && b−avg(R,G) > 18 && b > avg(R,G)×1.15`. The two call sites are consistent with *each other* (good), but the documented invariant is stale — dangerous for exactly the coupling it exists to protect.
- Env file is `.env`; docs say `.env.local`. (`.env` is confirmed gitignored.)
- Root `CLAUDE.md` still says "everything runs client-side except one serverless proxy (`api/fsq.js`)" — there are now two (`api/agent.js`).

### 7. Dead weight in `dependencies`
`@anthropic-ai/sdk`, `openai`, `commander`, `zod` — **zero imports anywhere** in `app/` or `api/` (grep-verified). They're leftovers from the never-built `tools/tailor` CLI (the dir is empty). Worse, `@anthropic-ai/sdk` was *bumped* (0.81→0.106) in this branch's diff despite being unused. Also `"start": "vite preview"` is misleadingly named.

### 8. `api/agent.js` is an open relay to your token pool
It forwards **any** payload to Cerebras with your server keys: no origin check, no model allowlist, no payload-size cap, no rate limiting. Anyone who finds `POST shademapnav.vercel.app/api/agent` can drain the shared daily token budget (which is the scarce resource this whole key-pool design exists to protect). `role` is accepted in the body and then ignored — dead protocol surface.

### 9. Repo hygiene
- ~1,900-line uncommitted diff spanning a dependency-major-version migration *and* a new feature — these should be separate, reviewable commits.
- Commit messages like `420`, `vfix`, `6697cee shadow fix + init redesign` carry no information.
- The orphaned `.worktrees/` checkout that the docs have to warn agents away from should just be deleted.

---

## What I'd change if I picked this up fresh

**Ranked; the first three fix the actual user-visible failures.**

1. **Make plotting a guarantee, not a hope.** Track candidate stops in the loop as `search_places`/`check_shade` results come back; if the research phase ends (naturally or by step exhaustion) without a `plot_points` call, plot the gathered stops from code before the write phase. Also tell the write prompt what actually got plotted so the narration can't outrun the map. Raising `MAX_STEPS` alone is a band-aid — the invariant "an itinerary in the answer ⇒ pins on the map" should be enforced by code, not by prompt.

2. **Kill the camera hijack in `check_shade`.** The shadow renderer computes shadows analytically (building geometry + sun position) — expose a point-query API from `LocalShadowAdapter` instead of flying the camera and reading pixels back. This makes probes near-instant, removes the teleporting, removes the 650ms magic sleep, and decouples shade *queries* from shade *rendering* (weakening the fragile invariant #5 into a single owned code path). Pixel readback can remain for route sampling until the same API replaces it there.

3. **Expose multi-stop routing.** Extend `plan_shaded_route` (or add `plan_itinerary_route`) to accept an ordered stop list mapped onto `useNavigation`'s existing `additionalWaypoints`. The plumbing already exists; this is a tool-schema change plus one context handle.

4. **Make verification honest.** Real eslint config (typescript-eslint + react-hooks at minimum — the codebase would pass; it's disciplined). Add a `types/` folder with two-line `.d.ts` stubs for `suncalc`/`earcut` and add both as direct deps (they're directly imported — invariant #2 exists only because they aren't), taking documented tsc errors from 3 to 0. Fix the new foursquare.test.ts error. Add a `typecheck` npm script and run test+typecheck in CI (there is no CI).

5. **Harden `api/agent.js`.** Model allowlist, payload-size cap, basic per-IP rate limiting (even in-memory per warm instance), optional origin check. Ten lines that protect the entire token budget.

6. **Prune.** Remove the four unused deps, delete `tools/tailor/` and `.worktrees/`, rename `start` → `preview`.

7. **Re-sync CLAUDE.md** (Vite version, real shade predicate in invariant #5, `.env`, second proxy) — its value comes entirely from being trustworthy.

8. **Split this branch before merging:** (a) Vite 8 migration + lockfile, (b) agent feature, (c) doc updates. Adopt conventional-commit messages going forward.

**Longer-term (only after the above):** the `maplibre-gl@5.9.0` pin is a ticking clock — patch or fork `mapbox-gl-shadow-simulator`'s `Texture.update` call (`patch-package` would do) so the app isn't frozen on an aging major. And `MapView.tsx` (1,373 lines) / `useNavigation.ts` (1,326 lines) are approaching the size where extracting the marker-management and route-pipeline concerns pays for itself — but neither is currently causing bugs, so this is opportunistic, not urgent.

---

## Bottom line

The foundation is strong: disciplined architecture, real tests on the hard algorithms, thoughtful docs, and a deployed product. The new agent layer is architecturally right but functionally unfinished — its one job (put a shade-aware itinerary *on the map*) fails whenever the LLM doesn't volunteer `plot_points` within a tight step budget, and the fix is to enforce that outcome in code. Secondary debt (no-op lint, dead deps, doc drift, open proxy) is all cheap to clear and mostly about keeping the project's excellent self-verification story honest.
