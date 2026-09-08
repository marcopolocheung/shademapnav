# Handoff — P4 + P2: make the existing work visible

**Mission.** Two PRs, **no new engineering.** Every number this project needs already exists;
none of it is visible to anyone outside the repo. This is the highest value-per-hour work on
the board and it is pure transcription and framing.

**Verified 2026-09-08 at `99bb418`.** Brief: `docs/tracks/TRACK_P.md`.

> **Take P4 and P2 together, in that order, as one session.** P4 alone recreates the problem it
> exists to solve one level down: a numbers page nobody navigates to is as invisible as a number
> nobody published. P2 is the door.

---

## Why this is not last

`ROADMAP.md` §2's fourth row is the thesis: *"almost every portfolio project claims; almost none
measures; essentially none publishes its own worst case."* `ShadeField.ts:193` already says in a
source comment that its confidences are **priors, not measurements**. That instinct is the most
hireable thing in the repository and **no recruiter can currently see it.**

**P1 is done** — the mirror at `marcopolocheung/shademapnav` is public and current — so the
dependency P4 was waiting on is discharged.

---

## PR 1 — P4, `docs/notes/evidence.md`

**Goal.** One versioned page carrying every measurement this project has made, worst case
included.

### What already exists to transcribe

| Number | Where it lives | What it does **not** say |
|---|---|---|
| `mean 2.6pp · worst 62.5pp · severe 3.3%`, 150 cases | `app/lib/shade/__tests__/agreement/` (ceilings: mean 0.04, p90 0.05, severe 0.04) | **Method agreement, not physical accuracy.** Two models compared to each other on synthetic geometry. Neither is ground truth. |
| Shadow-index speedup, ~1,000–2,200× (#166) | its benchmark | **A synthetic Node microbenchmark of the index in isolation.** Not end-to-end browser route time. #207 exists to make sure this ships qualified. |
| C1 eval: 18 scenarios + a sabotage suite | `app/lib/agent/__tests__/` | Orchestrator contract under **scripted** model/tool responses. Not live-model judgment, not task completion. |
| Suite size: 497 tests / 40 files, all green | `npm test` on `99bb418` | Nothing about rendering. `npm test` never opens a browser. |
| Browser smoke test green in CI | `npm run e2e` | One path: shadows paint, timeline retimes, one route calculates. Nothing else. |

### Non-negotiable structure

Keep the **evaluation layers separate** — they have different oracles and different failure
modes, and merging them is how a portfolio number becomes a lie. `TRACK_P.md` carries the full
table; reproduce it and fill only the rows that have data. Leave the rest visibly empty. **An
empty row is a stronger signal than a borrowed one.**

For each figure record: what was measured, on what data, on what hardware, what it does not say,
and the commit or fixture version it came from. Record sample counts and missing data. **Many
adjacent samples from one walk are not many independent walks.**

### Land the two corrections here

- **#206** — the novelty claim. `ROADMAP.md` §2 and `TRACK_H.md` are already fixed; P4 is where
  it becomes public. Fujiwara et al. 2024 §6.2 integrates traversal-time irradiance over three
  predefined routes. What is ours is the constrained search, the inversion to reachability, the
  published gap. **Cite it as related work.** A project that publicly corrects its own overclaim
  is doing the exact thing this page exists to prove.
- **#207** — the microbenchmark, qualified as above.
- **#211** — if you mention the maplibre advisory at all, state it precisely: a real critical in
  a shipped dependency, no demonstrated path in this app because the one `setHTML` call
  pre-escapes, unfixable without breaking hard invariant #1. Easy to overstate in both
  directions.

**Acceptance.** Every number the UI shows traces to a row on this page; the page states its own
limitations; each figure names its commit or fixture; linked from the README; **no number
appears without its method.**

---

## PR 2 — P2, the README

**Goal.** The only page a reviewer actually opens. It is currently 19 lines.

**Must land here:**
- A link to `evidence.md`, prominently. The page is the argument.
- The **A4b correction**: this is not "a pixel sampler." It is a geometry-backed `ShadeField`
  with a pixel fallback. An earlier research pass got this wrong and the impression persists.
- What the project is, what it does not do, and what is measured versus assumed.
- **No badge wall.** `ROADMAP.md` §2 anti-goals: every badge is a claim a reviewer can test.

**Check before you write:** #52 (LICENSE) may still be open. A public repo calling itself
open-source with no LICENSE undercuts the README on sight. If it is open, either take it here as
a third small PR or note it as blocking.

---

## Traps

- **Do not wait for completeness.** P4 is written once and *revised* — G2/G3's budgets and H4's
  gap flow back into it when they land. Waiting for a finished page is how it stays unpublished.
- **Do not promote agreement to accuracy.** The single most likely error in this work. The
  agreement harness compares two models; it says nothing about the world. There is currently
  **no physical accuracy number in this project at all**, and the page should say so plainly.
- **Do not fold partials and unknowns into a headline rate.** C1's results break out refusals
  and partials separately, or the conservative behaviour looks falsely perfect.

## Out of scope

P3 (demo recording) wants finished tracks and H3 rendering. P5 (design notes) wants H2's
objective correction. P6 (ledger) cannot be filled before H4 produces a gap. **All three stay in
Wave 3.** Do not start them here.

## Done when

Both PRs green through `/gates`, `TRACK_P.md`'s state block updated in the same PR, and the
evidence page resolving on the public mirror. Then `/checkpoint`.
