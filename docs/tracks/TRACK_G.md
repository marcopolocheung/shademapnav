# Track G — Proving Ground

> **Charter:** make every other track's "done" verifiable, and remove the file collisions that
> stop them running at once. This is not overhead — it is the precondition for parallel work.

**Class:** Enabling. **Staff first, alongside A.** **Runs alongside:** B, C, D freely; ⚠️ A (owns
A's fixtures), ⚠️ E (G6 rewrites E's biggest file). **G6 runs alone.**

---

## Current state

- **Active checkpoint:** G1 (not started)
- **Done:** nothing
- **Open PRs:** none (6 open Dependabot PRs are unrelated and unreviewed: #119, #117, #112, #82, #81, #80)
- **Decisions made:** none yet
- **Blocked on:** nothing. G1 needs `VITE_MAPTILER_API_KEY` as a repo secret — ask the owner early
- **Next action:** G1 — one browser smoke test
- **Last verified:** 2026-08-24, 156 tests / 23 files green on main

---

## Why this track exists

**Nothing has ever executed this app in a browser automatically.** The vitest suite runs in
`environment: "node"`. Never covered by any check: shadow rendering, timeline drag, end-to-end
route calculation, the streaming route preview, camera-free shade probes, GeoTIFF export, the
PWA shell (#35). The performance baseline (`docs/notes/performance-baseline.md`) says outright
that TTI and route-calc timings are missing because no browser binary was available.

With one agent making one PR at a time, that was survivable. With six tracks in parallel it
isn't: Track A will claim a worker made routing faster, Track B will claim guidance works,
Track D will claim a chart matches the map — and nothing can check any of it.

Second job: **the three contested files**. `useNavigation.ts` (1445 lines),
`MapView.tsx` (1377), `page.tsx` (932) are wanted by every track at once. Until they're split,
the cross-track compatibility matrix in `docs/tracks/README.md` is full of ⚠️.

## What already exists

- **CI** (`.github/workflows/ci.yml`): lint → typecheck → test → build on every PR and push to
  `main`. No secrets required today — the build inlines missing `VITE_*` as `undefined` and the
  test suite is hermetic. **G1 changes that; keep the no-secret path working for forks.**
- **Biome** (`biome.json`) — recommended set as errors, with `noNonNullAssertion`,
  `noExplicitAny`, `noApproximativeNumericConstant` off by design; a11y and
  `useExhaustiveDependencies` at `warn` (~127 + 17 findings).
- **`window.__shadeMapMetrics`** (`app/lib/metrics.ts`) — phase timings (`graphFetch`,
  `canvasRead`, `shadeSample`, `dijkstra`, `total`), p50/p95 history, and three KPIs
  (route compute ms, shade-coverage gain pp, path-length delta %). **The instrumentation for
  G2 already exists; only the harness that drives it is missing.**
- **Dependabot** (`.github/dependabot.yml`) with the maplibre/suncalc pins encoded as `ignore`.
- `docs/notes/performance-baseline.md`, `docs/notes/touch-target-audit.md`.

## Hard invariants that bite this track

- **maplibre-gl pinned at 5.9.0** and **suncalc at 1.x** — Dependabot is configured to stop
  proposing them (#118). Any dependency work must preserve those ignores. #60 (unfreeze
  maplibre via `patch-package`) is a real option but it is a *proposal*, not a licence.
- CI must keep working **without secrets** for anyone without repo access.
- `MapView` only via `React.lazy` (invariant #4) — G6's split must not introduce a static import.

---

## Checkpoints

### G1 — Browser smoke test ← **start here**
**Goal.** One automated run that actually loads the app. Closes **#35**.
**Approach.** Playwright with a WebGL-capable Chromium (`--use-gl=angle --use-angle=swiftshader`
for headless WebGL2), `VITE_MAPTILER_API_KEY` as a repo secret, running against `vite preview`
on the built `dist/`. **One** test: load → shadow layer paints (assert canvas pixels contain
blue-dominant pixels using `isBlueDominantShadowPixel`'s own thresholds — reuse the predicate,
don't restate it) → drag the timeline → shadows change → calculate a two-point route → a route
line renders.
**Acceptance.** Green in CI on a PR; skipped-with-a-clear-message when the secret is absent, so
forks aren't broken; runtime under ~3 minutes; flake budget stated (retry once, then fail).
**Files.** `e2e/**` (new), `.github/workflows/ci.yml`, `playwright.config.ts`. **Size.** Large.

### G2 — Route benchmark
**Goal.** Nobody may claim a perf win without a number. Unblocks **#37**, gates **A5**.
**Approach.** A scripted 2-point and 5-point calculation in the G1 browser, reading
`window.__shadeMapMetrics.summary`. Commit the baseline into
`docs/notes/performance-baseline.md` (it explicitly asks for exactly this). Fixed viewport,
fixed coordinates, fixed date/time, cache-warm and cache-cold variants.
**Acceptance.** Reproducible numbers with variance stated; baseline committed; a documented
command any track can run before/after its change.
**Files.** `e2e/bench/**`, `docs/notes/performance-baseline.md`. **Size.** Medium.

### G3 — Bundle budget
**Goal.** Stop silent regression of a 1.6 MiB `dist/` with a 953 kB maplibre chunk. Closes **#57**.
**Approach.** Per-chunk gzip ceilings checked in CI against the committed table in the perf
baseline; fail on regression beyond a stated tolerance.
**Acceptance.** CI fails on a deliberate regression test; the ceiling is documented with the
reason (4G, one-handed, outdoors).
**Files.** `.github/workflows/ci.yml`, a small check script. **Size.** Small.

### G4 — Shade accuracy harness
**Goal.** Own the infrastructure behind Track A's A3 agreement number.
**Approach.** Fixture format, the runner, and the CI reporting; **Track A owns what's in the
fixtures**, G owns how they run and how regressions are reported.
**Acceptance.** `npm test` prints the disagreement metric; a threshold is enforced; adding a
city is a data change, not a code change.
**Files.** `e2e/fixtures/**`, test infrastructure. **Size.** Medium. **Coordinate with Track A.**

### G5 — A11y baseline
**Goal.** A number where there has never been one. Closes **#39**, plans **#40**.
**Approach.** axe-core in the G1 browser across the main screens; record the score; convert the
~127 Biome a11y warnings into a burn-down list grouped by pattern (five a11y PRs — #90, #92,
#94, #96, #98 — already show the shape a good batch takes).
**Acceptance.** Score recorded in `docs/notes/`; CI reports it; a grouped burn-down issue list
exists. **Size.** Medium.

### G6 — Seam work ← **the unblocker; run it alone**
**Goal.** Stop six tracks from queueing on three files.
**Approach.**

| File | Lines | Split into |
|---|---:|---|
| `app/hooks/useNavigation.ts` | 1445 | `useRouting` (the calculate pipeline), `useTrip` (waypoints/legs/saved), `useSketch` |
| `app/components/MapView.tsx` | 1377 | per-feature layer modules registered by a small registry (route, sketch, transit, assistant pins, guidance) |
| `app/page.tsx` | 932 | stays a composition root; each track contributes one hook + one panel |

Pure refactor, no behavior change, one file per PR, tests green at every step.
**Acceptance.** No behavior change (the routing tests and `useNavigation.test.tsx` pass
unmodified); each track's future edits land in a file it owns; `MapView` still only imported via
`React.lazy`; the compatibility matrix in `docs/tracks/README.md` is updated to drop the ⚠️s
this removes.
**Files.** the three contested files. **Size.** Large ×3. **Announce before starting; other
tracks pause edits to these files while it's in flight.**

### G7 — Repo hygiene, batched
The p4 cluster, one PR each, taken *between* larger items and never instead of them:
**#52** LICENSE (the repo calls itself open-source and has none), **#50** the per-directory
`CLAUDE.md` files root `CLAUDE.md` already claims exist (`app/hooks/`, `app/lib/`,
`app/components/`, `app/services/`, `app/workers/`, `api/` — **verified missing 2026-08-24**;
every track's boot sequence reads these), **#53** `.env.example`, **#55** PR/issue templates +
CODEOWNERS, **#48** formatter repo-wide + `format:check` in CI, **#51** prune 27 stale branches,
**#56** CHANGELOG/tags, **#54** repo cruft, **#58** branch protection decision.
**Priority within the cluster: #50 first** — it's a dependency of every other track's session boot.

### G8 — Security baseline
**#32** (the only open p0) confirm referrer restrictions on the MapTiler and Foursquare keys;
**#33** vite 5→8 and vitest 2→4 advisories — the six open Dependabot PRs need a decision, and
the upgrade must preserve the maplibre/suncalc pins and the `manualChunks` config that keeps
MapView code-split. Document a dependency-bump policy so this doesn't recur every quarter.

---

## Subagent plan

- **G7 is the one place the "fire a swarm" pattern genuinely fits**: LICENSE, `.env.example`,
  PR templates, and the six `CLAUDE.md` files are fully independent files. Four to six builders,
  each in its own worktree, each opening its own small PR. Give each one the explicit file list.
- **G1 and G6 are strictly solo.** G1 is fiddly environment work; G6 rewrites shared files.
- **Scout** for environment questions ("what flags does headless Chromium need for WebGL2 in
  GitHub Actions in 2026?") — bounded, and the answer changes often enough to be worth checking
  rather than remembering.
- **Verifier on G6, mandatory.** A pure refactor that changed behavior is the worst outcome
  available here, and it's invisible in a green test suite that never covered the behavior.

## Risks

1. **Flaky browser tests are worse than none.** They train everyone to ignore CI. Budget for
   determinism: fixed viewport, fixed date, fixed coordinates, network stubbing where possible,
   one retry then fail.
2. **G6 changing behavior while claiming not to.** Mitigation: land G1/G2 *before* G6 so the
   refactor has something to prove itself against.
3. **Secret handling.** `VITE_MAPTILER_API_KEY` in CI must not leak into logs or fork PRs.
4. **Hygiene as procrastination.** G7 is satisfying and low-risk, which makes it the easiest
   way to spend a week without moving the product. One PR at a time, between real work.

## Out of scope / hand-offs

- What accuracy *means* → **Track A** (G runs the harness, A defines the fixtures).
- Feature work of any kind. If a G checkpoint needs a feature to test, stub it or test what exists.
