# Autonomous Goal — ShadeMapNav

**This file is your standing instruction set. Re-read it whenever your context is
summarized or you lose the thread.** It holds the mission, the loop, and the
guardrails — the things that do not change per task.

**The backlog is not here.** It lives in GitHub Issues (`gh issue list`); see the
bottom of this file. Close issues by merging PRs that say `Fixes #N`, and file new
issues for anything you discover.

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
write the assumption in the PR description, and keep moving. Repeat this cycle:

1. **Pick one item from GitHub Issues** — `gh issue list --state open --label p0`,
   falling back to `p1`, `p2`, … in order. Take the highest-priority issue that is
   actionable. One issue ≈ one PR. If an issue turns out to be bigger than one PR,
   split it (`gh issue create`), close nothing, and take the first slice.
   **Issues are the only backlog.** This file no longer carries one.
2. **Branch** from up-to-date `main`: `feat/…`, `fix/…`, `perf/…`, `a11y/…`, `chore/…`.
3. **Read before writing.** Root `CLAUDE.md` → the per-directory `CLAUDE.md` for the
   area you're touching → the file. Match the surrounding code's idiom.
4. **Implement**, with tests when the change is logic (`app/lib/**`, `app/services/**`,
   `app/hooks/**`). Behavior changes to `routing.ts`, `trainGraph.ts`, `shadeSampling.ts`,
   or `app/lib/agent/**` require test coverage, not just a green existing suite.
5. **Verify — all four gates, every time** (CI runs exactly these on every PR):
   - `npm run lint` — Biome; must pass (errors block, `warn`-level debt does not)
   - `npm run typecheck` — must be **clean** (baseline: 0 errors; do not regress this)
   - `npm test` — must pass (baseline: 133 passing, 16 files)
   - `npm run build` — must succeed
   - UI/map changes: run `npm run dev` and actually confirm the thing works
     (shadows render, timeline drags, a route calculates end to end)
6. **Commit** with a conventional-commit message (`fix: bound overpass proxy upstream
   waits` is the house style — imperative, specific, no ticket noise).
7. **Push and open a PR** with `gh`. **Never merge it — every PR stays open for the
   repo owner to review.** Never merge, squash, or land anything onto `main` yourself.
   See "PR descriptions" below for the required format.
8. **Link the issue** — put `Fixes #N` in the PR body so the issue closes when the PR
   merges. The PR description is the record; there is no separate worklog to append to.
   Any assumption you had to make goes in that description.
9. **File what you found** — `gh issue create` for anything you noticed and did not fix,
   labelled with a priority (`p0`…`p5`) and a type (`security`, `chore`, `docs`, `test`,
   `perf`, `a11y`, `feature`, `tooling`). Never leave a discovery only in a commit message.
10. **Go to 1.** Do not report "done" and wait; there is always a next item.

Because nothing merges while you work, **always branch from `main`** and prefer issues
that are independent of your open PRs. If an issue genuinely depends on unmerged work,
branch from that PR's branch and say so in the PR description's first sentence.

Prefer independent issues over stacking. PRs #17–#26 all had to be stacked purely
because each one edited the same shared backlog file — that file is now gone, and two
PRs touching unrelated code should no longer conflict.

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
  requires breaking one, don't — file an issue describing the tradeoff and pick something else.
- **Never read or edit `.worktrees/`** or any `oldbuild/` copy.
- **Never** rewrite published history, force-push, commit secrets, or commit `.env`.
- **Free-tier only.** No new paid services or keys. Cerebras is the LLM (5 req/min,
  shared key pool) — respect that budget; don't add chatty LLM calls.
- **No speculative rewrites.** `MapView.tsx` (1377 lines) and `useNavigation.ts` (1425)
  are large but working — extract from them only as a side effect of a change you were
  making anyway, never as a standalone "cleanup" PR.
- **Don't widen scope.** A PR that fixes a timeout does not also restyle a panel.
- If a change makes the app slower or heavier on mobile, it is a regression, whatever
  else it does.

## Prioritization rubric

When choosing between two open issues, prefer the one that:
1. removes a way the app currently misleads a user, over one that adds capability;
2. helps the phone-outdoors user, over the desktop user;
3. is verifiable by test or by a measurable number (bundle size, ms, Lighthouse a11y),
   over one that is only judgeable by taste;
4. is small enough to finish and merge this session.

---

# Backlog

This file used to carry the backlog inline. It no longer does — **open issues are the
single source of open work**, seeded from what was previously spread across this file,
`GROWTH_ROADMAP.md`, `PROJECT_REVIEW.md`, `userTODO.md`, and ad-hoc audits.

```bash
gh issue list --state open --label p0     # then p1, p2, … in order
gh issue list --state open --label a11y   # or by type
```

**Priority labels** carry the same meaning the old sections did:

| Label | Meaning |
|---|---|
| `p0` | Trust, correctness, security — do first |
| `p1` | Speed and verification |
| `p2` | Accessibility, both senses |
| `p3` | Product scope vs mission |
| `p4` | Tooling and hygiene |
| `p5` | Bigger bets — only when p0–p2 are quiet |

**Type labels:** `security`, `chore`, `docs`, `test`, `perf`, `a11y`, `feature`, `tooling`.

The prioritization rubric above still decides ordering *within* a label.

`GROWTH_ROADMAP.md` stays as the product thesis — the reasoning behind why these items
matter and who the users are. It is not a task list; anything actionable in it has been
filed as an issue. Historical records live in `docs/notes/archive/`.
