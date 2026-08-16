# Autonomous Goal — ShadeMapNav

**This file is your standing instruction set. Re-read it whenever your context is
summarized or you lose the thread. It is also yours to edit:** the backlog at the
bottom is a living list — strike items you finish, add problems you discover,
delete items that stop being true.

---

## Mission

Keep improving this repo, continuously and unattended, toward one product:

> **A fast, accessible, shade-first navigation webapp for people moving under their
> own power — walking, biking, scootering, skateboarding, running, wheeling.**

Three words decide every judgment call, in this order:

1. **Trustworthy** — the app must never claim shade it can't deliver, or narrate a
   trip it didn't plot. A wrong promise ends retention permanently.
2. **Fast** — a heatwave user on 4G, standing outside, one-handed. Time-to-first-route
   under 30s; route calculation that never dead-ends on a cliff timeout.
3. **Accessible** — two senses: (a) real a11y — keyboard, screen reader, contrast,
   touch targets, reduced motion; and (b) plainly usable by someone who has never
   seen the app and doesn't know that dark blue means shade.

Everything else (new features, refactors, cleverness) is subordinate to those three.

## How to work (the loop)

You are running unattended until session limits are reached. **Never stop to ask a
question and never idle.** When something is ambiguous, pick the reasonable default,
write the assumption in the worklog, and keep moving. Repeat this cycle:

1. **Pick one item** from the backlog below (highest priority that is actionable).
   One item ≈ one PR. If an item turns out to be bigger than one PR, split it in the
   backlog and take the first slice.
2. **Branch** from up-to-date `main`: `feat/…`, `fix/…`, `perf/…`, `a11y/…`, `chore/…`.
3. **Read before writing.** Root `CLAUDE.md` → the per-directory `CLAUDE.md` for the
   area you're touching → the file. Match the surrounding code's idiom.
4. **Implement**, with tests when the change is logic (`app/lib/**`, `app/services/**`,
   `app/hooks/**`). Behavior changes to `routing.ts`, `trainGraph.ts`, `shadeSampling.ts`,
   or `app/lib/agent/**` require test coverage, not just a green existing suite.
5. **Verify — all four gates, every time:**
   - `npm test` — must pass (baseline: 119 passing, 13 files)
   - `npx tsc --noEmit` — must be **clean** (baseline: 0 errors; do not regress this)
   - `npm run build` — must succeed
   - UI/map changes: run `npm run dev` and actually confirm the thing works
     (shadows render, timeline drags, a route calculates end to end)
6. **Commit** with a conventional-commit message (`fix: bound overpass proxy upstream
   waits` is the house style — imperative, specific, no ticket noise).
7. **Push and open a PR** with `gh`. **Never merge it — every PR stays open for the
   repo owner to review.** Never merge, squash, or land anything onto `main` yourself.
   See "PR descriptions" below for the required format.
8. **Record it** — append one line to `docs/notes/worklog.md`:
   `YYYY-MM-DD — <branch> — PR #N — what changed, why, verification result`.
9. **Update this file's backlog** — remove what you finished, add what you found.
10. **Go to 1.** Do not report "done" and wait; there is always a next item.

Because nothing merges while you work, **always branch from `main`** and prefer items
that are independent of your open PRs. If an item genuinely depends on unmerged work,
branch from that PR's branch, say so in the PR description's first sentence, and note
the dependency in the worklog.

## PR descriptions

**Maximum four sentences. Nothing else** — no headings, no bullet lists, no test-plan
section, no checklists, no summary of files touched, no emoji, no closing pleasantries.
The four sentences answer, in order:

1. What does this fix or add that's new?
2. Why was this a problem worth fixing, or a feature worth adding?
3. How is it implemented?
4. Why that way?

If a sentence would be filler, cut it — three good sentences beat four padded ones.
The PR title stays a conventional-commit line (`fix: bound overpass proxy upstream waits`).

## Guardrails

- **Hard invariants in root `CLAUDE.md` are non-negotiable** (maplibre pinned at
  `5.9.0`; `preserveDrawingBuffer`; `MapView` only via `React.lazy`; shadow color ↔
  shade predicate coupling; `User-Agent` on Nominatim/Overpass). If a task genuinely
  requires breaking one, don't — write the tradeoff in the backlog and pick something else.
- **Never read or edit `.worktrees/`** or any `oldbuild/` copy.
- **Never** rewrite published history, force-push, commit secrets, or commit `.env`.
- **Free-tier only.** No new paid services or keys. Cerebras is the LLM (5 req/min,
  shared key pool) — respect that budget; don't add chatty LLM calls.
- **No speculative rewrites.** `MapView.tsx` (1373 lines) and `useNavigation.ts` (1301)
  are large but working — extract from them only as a side effect of a change you were
  making anyway, never as a standalone "cleanup" PR.
- **Don't widen scope.** A PR that fixes a timeout does not also restyle a panel.
- If a change makes the app slower or heavier on mobile, it is a regression, whatever
  else it does.

## Prioritization rubric

When choosing between two backlog items, prefer the one that:
1. removes a way the app currently misleads a user, over one that adds capability;
2. helps the phone-outdoors user, over the desktop user;
3. is verifiable by test or by a measurable number (bundle size, ms, Lighthouse a11y),
   over one that is only judgeable by taste;
4. is small enough to finish and merge this session.

---

# BACKLOG (living — edit freely)

*Status verified 2026-08-15: tests 133/133 pass, `tsc --noEmit` clean, PR #17 open
for shared shade predicate, PR #18 open for route progress status, PR #19 open for
partial route results, PR #20 open for route preview streaming, PR #21 open for visible
shade point queries, PR #22 open for offscreen shade point queries, PR #23 open for
offscreen building relation parsing, PR #24 open for partial performance baseline,
PR #25 open for cached offscreen building Overpass queries, PR #26 open for cached
station-entrance Overpass queries, no CI. Recent merged work already covered:
shareable URLs, cloud-cover badge, route tradeoff summary, multi-stop UI + agent
multi-stop, PWA offline shell, agent fallback plotting, lazy agent loop,
agent-proxy hardening, stale-route-calc cancellation, waypoint snapping.*

## P0 — Trust and correctness

_No open P0 items after PR #23; keep watching for anything that can mislead users._

## P1 — Speed

- **Performance baseline is only partial.** PR #24 records cold build artifact sizes
  in `docs/notes/performance-baseline.md`, but this workspace has no Chromium,
  Playwright, or Lighthouse binary, so throttled-4G TTI and representative 2-point /
  5-point route calculation timings are still missing. Capture those from a real
  browser session via `window.__shadeMapMetrics` or add repo-owned browser automation.
- **Route calc is single-threaded on the main thread.** Independent Pareto searches
  per leg are parallelizable, and the graph build/Dijkstra work is a natural fit for a
  worker (`app/workers/` already has the pattern). Only pursue after the baseline exists.

## P2 — Accessibility (both senses)

- **No a11y baseline.** ~13 `aria-label`s across 22 components and 6 `role=`/
  `prefers-reduced-motion` hits total. Run an audit (Lighthouse a11y or axe on the
  dev server), record the score in the worklog, then fix in priority order:
  keyboard operability of the timeline slider and map controls → focus states and
  focus trapping in panels/sheets → screen-reader labeling of routes and stops →
  contrast → `prefers-reduced-motion` for camera flights and the play animation.
- **Touch targets and one-handed use.** The persona is outdoors on a phone. Audit the
  timeline slider, bottom sheet, and floating controls for 44px minimum targets and
  thumb reach.
- **The shade metaphor is unexplained.** A first-time user doesn't know dark blue =
  shade at the current time, or that the timeline is the magic. One dismissible
  one-line legend on first shadow render; nothing modal, nothing that blocks the map.
- **The tradeoff sentence is buried.** "+4 min, −62% sun" is the entire product pitch
  and it lives inside route cards. It belongs where it's read first.

## P3 — The product is walking-only; the mission is not

- **No travel-mode concept anywhere.** Speed is hardcoded (`WALK_SPEED_MS = 1.4` in
  `useNavigation.ts:1143`) and the cost model is pedestrian. For bikes / scooters /
  skateboards the graph already ingests `cycleway`, `steps`, `track`, `bridleway`
  (`overpass.ts:94`) but treats them alike. A credible v1: a mode selector that sets
  (a) speed, (b) a hard penalty or exclusion for `highway=steps`, (c) surface
  awareness (`surface=cobblestone|gravel|sand` is punishing on skate/scooter wheels),
  (d) a preference weight for `cycleway`/`bicycle=designated`. Ship it as one mode
  beyond walking first (bike is the best-tagged in OSM), then generalize.
  This is the largest gap between what the app is and what the mission says it is —
  size it into slices before starting.
- **Trees are the missing shade source.** Buildings-only shadow systematically
  under-reports shade on tree-lined streets. Not a renderer change: Overpass serves
  `natural=tree` and `landuse=forest`/`leaf_type`, and the routing cost model can take
  a flat canopy bonus per edge. Rough is fine and visibly improves believability.
- **"Best time to go."** The engine answers "which route at time T"; the same machinery
  answers "which T for my route" by sweeping the day. A mini exposure-by-hour chart is
  the first true daily-habit feature and is UI over existing capability.

## P4 — Honest tooling and hygiene

- **`npm run lint` verifies nothing.** `eslint.config.mjs` is a `dist/` ignore and zero
  rules. Add typescript-eslint + react-hooks at minimum; the codebase is disciplined
  enough to pass. A lint that manufactures false confidence is worse than none.
- **No CI.** There is no `.github/`. Add a workflow running test + typecheck + build on
  push and PR, so the gates above are enforced when a human isn't watching either.
- **No `typecheck` script**, and `start` is a misleading name for `vite preview`.
- **Four unused dependencies** ship in `dependencies`: `@anthropic-ai/sdk`, `openai`,
  `commander`, `zod` — zero imports in `app/` or `api/`, leftovers from a `tools/tailor`
  CLI that no longer exists in the tree. Remove them (verify with a grep first).
- **Doc drift in the canonical guide.** Root `CLAUDE.md` says "one serverless proxy
  (`api/fsq.js`)" — there are three (`agent.js`, `fsq.js`, `overpass.js`); it points at
  `tools/tailor/` which doesn't exist; it says env lives in `.env.local` while the repo
  uses `.env`; and it points at `app/lib/CLAUDE.md`, `app/hooks/CLAUDE.md`, and
  `app/components/CLAUDE.md`, which don't exist. `AGENTS.md` points at
  `docs/kb/INDEX.md`, which doesn't exist either. The docs' whole value is being
  trustworthy — keep them true as you change things.
- **15 merged local branches** still sit on the repo; prune the ones whose PRs merged.
- **`maplibre-gl` is frozen at 5.9.0** by a single upstream call in
  `mapbox-gl-shadow-simulator` (`Texture.update`). A `patch-package` patch would unfreeze
  a whole major version's worth of upgrades. Not urgent, high leverage, self-contained.

## P5 — Bigger bets (only when P0–P2 are quiet)

- Share cards for a calculated route (canvas capture is nearly free —
  `preserveDrawingBuffer` is already on) with the tradeoff sentence baked into the image.
- Static pre-rendered city landing pages for "shaded walking route <city>" searches.
- UV index and a burn-time estimate, turning "minutes in sun" into something a
  sun-sensitive user can act on.
- Saved places/routines that do something on return (needs the PWA shell, which shipped).

---

## Worklog

Append every iteration to `docs/notes/worklog.md` (create it on first run). One line
per merged or attempted change. That file plus this backlog is how a future you, or
the repo's owner, reconstructs what happened while nobody was watching.
