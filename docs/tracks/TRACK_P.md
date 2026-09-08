# Track P — Publication

> **Charter:** make the work legible to someone who did not write it. This repo already
> measures things almost nobody measures — and publishes none of it. Every number that exists,
> every decision that was hard, every claim the UI makes: reachable from a public URL, worst
> case included.

**Class:** Enabling. **Runs alongside:** everything — it owns no application logic.
**Distinct from Track G:** G proves things work *to us* (tests, benchmarks, CI). P proves it
*to a stranger* (the mirror, the README, the numbers page, the recording).

---

## Current state

- **Active checkpoint:** P4 — publish the numbers. P1 is implemented and in review.
- **Done:** P1 (pending merge) — `.github/workflows/mirror.yml` pushes `main` to the public
  repo on every merge and then fails if a doc the app links to 404s there.
- **Open PRs:** #NNN (P1).
- **Decisions made:**
  - **Action, not a documented step.** The manual `git push public main` had failed three
    times; the last failure is #199.
  - **Push-triggered, not gated on CI.** A faithful mirror of a red `main` is still faithful,
    and a `workflow_run` gate would let one flaky browser run stop mirroring unnoticed — the
    same silent drift the job exists to end.
  - **`main` only, never `--mirror`/`--all`, never `--force`.** Feature and dependabot branches
    stay private, and a non-fast-forward means the public repo has a commit `main` does not —
    which a human should see, not a job should overwrite.
  - **Publishing is checked before it happens.** `scripts/mirror-guard.sh` blocks `.env` files,
    credential-shaped literals and hard-coded keys; a pushed secret is leaked even after a
    force-push. It prints file and line, never the matched text.
  - **The checks also run on the PR, minus the push.** A link added without its doc, or a
    committed key, fails at review instead of turning the mirror red after merge.
- **Blocked on:** P1's acceptance needs one owner action that no PR can perform — a fine-grained
  PAT for `marcopolocheung/shademapnav` stored as the `MIRROR_TOKEN` secret. Until it exists the
  job fails loudly on merge instead of mirroring. P2/P3 still want two finished Wave-1 tracks
  and H3 rendering.
- **Next action:** **P4** — needs no new engineering, only publication.
- **Last verified:** 2026-09-08 — mirror audit run against `origin/main`: nothing private
  crosses (see the P1 PR); `docs/notes/heat-model.md` confirmed 404 on the mirror by the
  workflow's own link check, run locally.

---

## Why this track exists

`docs/ROADMAP.md` §2 names four things a hiring manager must conclude. Three are half-built and
owned by other tracks. The fourth — *"this person is honest about what they measured"* — is
**already true and completely invisible**:

- The A3 agreement harness publishes `150 cases · mean 2.6pp · p90 0.0pp · worst 62.5pp ·
  severe 3.3%` against committed regression ceilings. Nobody outside the repo can see it.
- The shadow index was measured at ~1,000–2,200× on `sampleEdges` (#166). Unpublished.
- `ShadeField.ts:199` labels its own confidence values *"priors, not measured ground truth"* in
  a source comment. That is the rarest sentence in a portfolio project, and it is buried.

Meanwhile the public surface is actively wrong. `origin` is private; `public`
(`github.com/marcopolocheung/shademapnav`) is what the world sees, and it lags — the proof is
that `docs/notes/browser-verification.md`, from an **already-merged** PR, is still absent from
it (#199). The consequence: D3 and D4 render a health-adjacent UV number into the UI whose
"how this was calculated" link **404s in production**, and their acceptance criteria say the
method must be linked. And the README is 19 lines of setup that still advertises per-directory
`CLAUDE.md` files `.claude/rules/` replaced.

**Two of the six resume lines in `ROADMAP.md` §6 are already earned and merely unpublished.**
That is the cheapest value available anywhere on the board, and it is this track's whole point.

---

## Checkpoints

### P1 — Mirror the public repo on merge — **implemented, in review**
**Goal.** The public repo is a faithful copy of `main`, automatically. Closes **#199**.
**Approach.** A GitHub Action on push to `main` that pushes to the `public` remote, or a
documented `git push public main` step added to the merge ritual in `docs/tracks/README.md`.
Prefer the Action — a documented manual step is the thing that already failed.
**Acceptance.** `docs/notes/browser-verification.md` resolves on the public URL (it is the
existing proof of the drift); every `docs/notes/*` path the app links to resolves as soon as its
own PR lands; a check or the merge checklist prevents regression. Confirm no secret, `.env`, or
private-only file is carried across by the mirror step.
**Files.** `.github/workflows/`, `docs/tracks/README.md`. **Size.** Small.
**Blocks:** D3, D4.

### P2 — The README as the human entry point
**Goal.** A stranger understands the promise, sees it work, and reaches the evidence in three
clicks.
**Approach.** Restructure, do not decorate: one recorded working example at the top, the
promise sentence, the live link, an honest coverage statement — then architecture, **one**
significant technical decision, the benchmarks, and the limitations. Two or three deep links,
not a framework list. **No badge wall** — every badge is a claim a reviewer can test.
Agent-facing instructions stay in `CLAUDE.md` and `.claude/`; this file is for people.
**Acceptance.** The promise, a working demo, and the numbers page are each reachable from the
top of the README; nothing in it is a claim without a link; the stale per-directory `CLAUDE.md`
and `.env.example` references are gone (coordinate with **G7**, which owns the same lines).
**Files.** `README.md`. **Size.** Medium. **Wants P3 and P4 to exist first.**

### P3 — The demo, recorded
**Goal.** Forty seconds that no other candidate has.
**Approach.** One sequence, recorded, no narration needed: an exposure-budget request → the
proposed itinerary → introduce a late departure or a closed stop → the verified repair → open
the matching eval trace. For a systems variant, substitute a real offline transition.
**Record only what actually exists** — a staged capability is the one failure that would undo
the entire honesty argument this project rests on.
**Acceptance.** The recording plays from the README and from the public repo; every step in it
is reproducible from a documented URL or fixture; its date and the commit are stamped.
**Files.** `README.md`, `docs/` assets. **Size.** Medium.
**Depends on:** B7 (the arrival sentence), H3 (the budget interaction), **C11** (the repair —
no other checkpoint builds it), C4/C5 (the job contract and the trace). Do not attempt it early with a mock.

### P4 — Publish the numbers ← **start here; needs no new engineering**
**Goal.** One versioned page carrying every measurement this project has made, worst case
included.
**Approach.** `docs/notes/evidence.md`: the A3 agreement table (mean, p90, worst, severe share,
per-city, with the committed ceilings), the shadow-index speedup (#166) with its method, C1's
eval results **with partials and unknowns broken out rather than folded into a headline rate**,
G2/G3 budgets when they exist, and H4's approximation gap when it exists. For each: what was
measured, on what data, on what hardware, and what it does **not** say. Record sample counts and
missing data. Many adjacent samples from one walk are not many independent walks.
**Keep the evaluation layers separate — they have different oracles and different failure
modes, and merging them is how a portfolio number becomes a lie:**

| Layer | Oracle | Measure | The failure to avoid |
|---|---|---|---|
| Geometry | synthetic analytic fixtures; independent observation | intersection error, false shade, uncertainty by source | testing a renderer against the same geometry and calling the agreement *physical accuracy* |
| Routing | tiny exact fixtures; independently checked constraints | exposure/time tradeoff, violations, approximation gap | calling a bounded heuristic globally optimal |
| Agent | final app state + task graders | valid completed plans, groundedness, recovery, revision minimality | counting tool invocation or fluent prose as success |
| Systems | documented hardware, fixed snapshots | p50/p95 latency, memory, throughput, recovery | publishing a warm-cache best case as typical |

**Acceptance.** Every number the UI shows traces to a row on this page; the page states its own
limitations; each figure names the commit or fixture version it came from; it is linked from the
README and resolves publicly (needs **P1**); no number appears without its method.
**Files.** `docs/notes/evidence.md`, `README.md`. **Size.** Medium.
**Why it is first among the publication work:** the measurements already exist. This is
transcription and framing, not engineering, and it moves two resume lines from ⬜ to ✅.

### P5 — Three design notes
**Goal.** Show ownership through decisions, including a wrong one corrected.
**Approach.** One note each, in `docs/notes/`, each naming the alternative that was rejected and
why:
1. **The objective-function correction** (H2) — why maximizing shaded distance was measuring the
   wrong quantity, the Route-A/Route-B fixture that proved it, and what changed.
2. **Why the shade field replaced the pixel sampler** — what coupling to the canvas cost, what
   the agreement harness proved, and what it explicitly does *not* prove (model-vs-model
   agreement is not physical accuracy).
3. **The agent's tool boundary** (C4) — why "started" is not success, and what a job/result
   contract with idempotency and cancellation buys.
**Acceptance.** Each note is readable by someone who has never seen the code, states a decision
and a rejected alternative, and is linked from the README. A note that only describes what was
built without the alternative does not count.
**Files.** `docs/notes/`. **Size.** Medium (one PR each).

### P6 — The resume ledger, filled from measurement
**Goal.** Close the loop: `ROADMAP.md` §6 stops being templates.
**Approach.** For each earned line, fill the brackets from P4's page and tick it. **No estimate
ever substitutes for a missing measurement** — a smaller auditable result beats a larger
unverifiable one, and a reviewer who reproduces one number will try a second.
**Acceptance.** Every ticked line's artifact is live on the public mirror and its number appears
on P4's evidence page. Unearned lines stay unticked.
**Files.** `docs/ROADMAP.md` §6. **Size.** Small, recurring.

---

## Subagent plan

- **P4 and P5 are swarm-able** — each note and each evidence section is an independent file.
  Give each `builder` the exact source of the numbers; **never let one infer a number.**
- **P1, P2, P3 are solo.** P1 touches CI and a remote; P2 and P3 are single-voice artifacts.
- **`grounding-auditor` on P4, mandatory.** A published number that overstates what was measured
  is the one failure this track cannot recover from — it converts the project's best signal into
  its worst.

## Risks

1. **Publishing a number that outruns its method.** The single worst outcome available here.
   Every figure carries what it measured, on what data, and what it does not claim.
2. **Recording a demo of something staged.** If it needs a mock to record, it is not ready.
3. **Leaking through the mirror.** P1 pushes a private repo's content to a public one. Check
   what crosses before automating it, not after.
4. **Writing the README before there is anything to link.** P2 wants P3 and P4 to exist; a
   rewritten README pointing at empty pages is worse than the 19-line one.
5. **Drift.** A published number that a later PR invalidates is a lie with a timestamp. Every
   figure on P4's page names the commit or fixture version it came from.

## Out of scope / hand-offs

- Producing measurements → the track that owns them (**A** agreement, **G** benchmarks and
  budgets, **C** eval results, **H** approximation gap). P **publishes**; it never measures.
- LICENSE, `.env.example`, PR templates, the `#50` doc cluster → **G7**.
- Landing pages, OG images, share cards, deep links → **Track F** (user reach, not reviewer
  legibility — different audience, different track).
- Application security and quotas → **G8** and **C6**.

## Owns

`README.md`, `docs/notes/evidence.md`, the design notes in `docs/notes/`, the mirror workflow,
and `docs/ROADMAP.md` §6.
