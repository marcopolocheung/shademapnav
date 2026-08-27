# Running a track — the operating playbook

`docs/notes/AUTONOMOUS_GOAL.md` says *what* to build and in what order. This file says
*how a session is run*: how to start one, when to spawn subagents, when not to, and how one
session hands off to the next.

**Read this once per session, at boot. It is short on purpose.**

---

## The four rules

1. **One session = one track.** The track is the unit of context. A session that hops tracks
   pays full re-derivation cost each hop and starts touching files another track owns.
2. **One checkpoint = one PR.** Checkpoints in the briefs are sized for this. If one isn't,
   split it into issues and take the first slice.
3. **The session implements; subagents scout, parallelize the genuinely independent, and
   verify.** In this repo, implementation edits concentrate in a handful of large files and
   depend on invariants a cold agent doesn't know. Handing the *main* edit to a fresh subagent
   reliably produces plausible, wrong code.
4. **Never merge.** Every PR stays open for the repo owner. That's a hard repo rule, and it's
   also why every branch must come off `main`, not off another open PR.

---

## Starting a session

**In an interactive Claude Code session:**

```
/track b
```

…or to resume a specific checkpoint:

```
/track b B5
```

The command loads root `CLAUDE.md`, the mission and seam sections of `AUTONOMOUS_GOAL.md`,
this playbook, and the track brief — then prints a six-line orientation and starts.

**Anywhere the slash command isn't available** (`claude -p`, a cloud session, a fresh
checkout), paste this instead:

```
You own Track B (Live Navigation) for this session. Read, in order: CLAUDE.md,
docs/tracks/README.md, docs/tracks/TRACK_B.md. Start from the "Current state" block in
the brief, take the next unfinished checkpoint, and work it end to end per
AUTONOMOUS_GOAL.md §5 — branch, implement with tests, run all four gates, push, open a PR
with gh, never merge. Update the brief's Current state block in the same PR. Do not work on
another track's files; file issues against those tracks instead. Don't ask me what to do
next — pick the reasonable default and note the assumption in the PR.
```

That prompt is short *because the brief carries the context*. If a session needs more than
this to get going, the brief is the thing to fix — not the prompt.

---

## Subagents: when to fan out

| Situation | Pattern | Why |
|---|---|---|
| "Where is X handled? What calls Y?" across many files | **Scout** — 1–3 `Explore` agents in parallel, read-only | Keeps large file dumps out of the session's context; returns just the pointers |
| A checkpoint splits into slices that touch **disjoint** files | **Swarm** — one `general-purpose` agent per slice, each with `isolation: "worktree"` | Real parallelism, no branch or file collisions |
| A checkpoint is done and you want it checked cold | **Verifier** — one fresh agent, given only the brief's acceptance criteria + the diff | Cold context is an *advantage* here: it can't inherit your optimism |
| A long research question with a bounded answer ("does Overpass expose crown diameter, and how often is it tagged?") | **Scout** with web access | Cheap, isolatable, doesn't pollute the implementation context |
| Sequential checkpoints (A2 → A3 → A4) | **No subagent.** Do it yourself, in order | Each one's output is the next one's input; a swarm just serializes with extra steps and lost context |
| Anything touching `useNavigation.ts`, `MapView.tsx`, or `page.tsx` | **No subagent** (until G6 lands) | Three contested files; concurrent edits conflict, and they're where the invariants bite |
| "Go do Track B" as a whole | **Never** | A track is weeks of dependent work with an evolving state block. That's a session, not a task |

### The rule of thumb

> Fan out for **reading** and for **provably disjoint writing**. Keep **dependent writing**
> in the session.

### Role prompts (copy-paste)

**Scout** (read-only recon — spawn 2–3 in one message when the questions are independent):

```
Read-only recon for ShadeMapNav Track <X>. Question: <the specific question>.
Search the repo and report: (1) the files and line ranges that answer it, (2) the shape of
the relevant types/functions, (3) anything that contradicts docs/tracks/TRACK_<X>.md.
Do not edit anything. Return under 30 lines — pointers, not file contents.
```

**Builder** (one disjoint slice, isolated worktree — only when files truly don't overlap):

```
You are implementing exactly one slice of ShadeMapNav Track <X>: <checkpoint id + slice>.
Read CLAUDE.md and docs/tracks/TRACK_<X>.md first — the hard invariants there are
non-negotiable. Touch ONLY these files: <explicit list>. Do not touch app/hooks/useNavigation.ts,
app/components/MapView.tsx, or app/page.tsx.
Acceptance criteria: <paste from the brief>.
Run all four gates (npm run lint, npm run typecheck, npm test, npm run build) and report
their real output — if something fails, say so, don't paper over it. Branch from main as
<branch>, commit with a conventional-commit message, push, and open a PR with gh whose body
is at most four sentences and contains "Fixes #<n>". Never merge.
```

Spawn these with `isolation: "worktree"` so each gets its own checkout.

**Verifier** (adversarial check before you open the PR — the highest-value subagent in this repo):

```
Adversarially verify a ShadeMapNav change. Branch: <branch>. Read the diff (git diff main...HEAD).
The claimed acceptance criteria are: <paste from the brief>.
Check, and report only what you can substantiate with file:line evidence:
1. Does the diff actually meet each criterion, or only appear to?
2. Does it violate any hard invariant in CLAUDE.md (maplibre 5.9.0 pin, preserveDrawingBuffer,
   MapView only via React.lazy, shadow-color ↔ isBlueDominantShadowPixel coupling,
   User-Agent on Nominatim/Overpass, suncalc 1.x)?
3. Do the tests test behavior, or do they restate the implementation?
4. Run npm run lint, npm run typecheck, npm test, npm run build and paste the real results.
Do not fix anything. List findings most-severe first, or say "no findings" plainly.
```

**Scribe** (issue filing / doc drift, batched at the end of a checkpoint):

```
For ShadeMapNav Track <X>: file GitHub issues with gh for each of the following findings:
<list>. Each issue needs a clear title, a body explaining the impact and the file:line
evidence, a priority label (p0–p5), a type label (security/chore/docs/test/perf/a11y/
feature/tooling), and the label track-<x>. Do not open PRs or edit code. Report the issue
numbers created.
```

---

## Anti-patterns (each one has burned a session in this repo's shape)

- **Swarming a sequential checkpoint chain.** A3 exists to make A4 safe; running them in
  parallel means A4 lands unverified.
- **Two agents in one worktree.** Concurrent edits to the same checkout produce interleaved,
  unreviewable diffs. One worktree per writer, always.
- **Branching off an open PR** because a checkpoint "depends" on it. Everything stays open for
  review, so stacked branches pile up unmergeable work. Stub the interface and branch from `main`.
- **Letting a subagent "quickly also fix" something it noticed.** Scope creep in a cold context
  is how invariants get broken. Findings become issues, not edits.
- **Trusting a subagent's "all tests pass."** Ask for the pasted output; verify the four gates
  in the session before opening a PR.
- **Re-deriving the repo every session.** If you spent the first 20 minutes rediscovering how
  shade sampling works, the brief was missing a pointer — add it before you finish.

---

## Cross-track parallelism

Real parallelism comes from **multiple sessions, one per track** (separate terminals), not
from subagents inside one session. Which pairs are safe to run at the same time:

| | A | B | C | D | E | G |
|---|---|---|---|---|---|---|
| **A** Shade Engine | — | ✅ | ✅ | ⚠️ A6/D1 share the sweep API | ⚠️ both edit `routing.ts` | ⚠️ G4 owns A's fixtures |
| **B** Navigation | ✅ | — | ✅ | ✅ | ⚠️ both want `Trip` + `useNavigation` | ✅ |
| **C** Copilot | ✅ | ✅ | — | ✅ | ✅ | ✅ |
| **D** Heat & Timing | ⚠️ | ✅ | ✅ | — | ✅ | ✅ |
| **E** Journeys & Modes | ⚠️ | ⚠️ | ✅ | ✅ | — | ⚠️ G6 splits E's files |
| **G** Proving Ground | ⚠️ | ✅ | ✅ | ✅ | ⚠️ | — |

✅ = run simultaneously without coordination. ⚠️ = coordinate: agree in an issue who edits the
shared file first, and let the second session rebase after the first PR opens.

**G6 (the seam splits) runs alone.** It rewrites the three contested files by definition.
Pause other tracks' work on those files while it's in flight — it is the one piece of work
worth blocking on, because it removes the ⚠️s from this table permanently.

**Track C is the friendliest to run alongside anything** — it owns `app/lib/agent/**` outright
and consumes everyone else through tool wrappers.

---

## State and handoff

Each brief carries a `## Current state` block. It is the only thing a new session must trust:

```markdown
## Current state
- **Active checkpoint:** B3 (position tracking) — PR #NNN open
- **Done:** B1, B2
- **Open PRs:** #NNN (B3)
- **Decisions made:** map-matching tolerance 25 m; heading from `coords.heading`, compass fallback deferred
- **Blocked on:** nothing (B6 will need Track A's `ShadeField`; stubbed at `app/lib/shade/stub.ts`)
- **Next action:** B4 — replace the NAVIGATING card
- **Last verified:** 2026-08-24, 156 tests / 23 files green on main
```

Update it **in the same PR as the work it describes**. A state block that drifts is worse than
none, because the next session will believe it.

If you discover the brief is wrong about the code — the code wins. Fix the brief in your PR
and say so in the PR's four sentences.

---

## Definition of done (every checkpoint, no exceptions)

- [ ] The brief's acceptance criteria for that checkpoint are met, demonstrably
- [ ] Tests cover the behavior (logic changes in `app/lib/**`, `app/services/**`, `app/hooks/**` require them)
- [ ] `npm run lint` · `npm run typecheck` · `npm test` · `npm run build` all pass
- [ ] UI/map changes confirmed in `npm run dev` — actually looked at, not assumed
- [ ] No hard invariant touched (root `CLAUDE.md`)
- [ ] PR open, ≤4 sentences, `Fixes #N`, never merged
- [ ] `## Current state` updated in the brief
- [ ] Findings filed as issues with priority + type + `track-x` labels
