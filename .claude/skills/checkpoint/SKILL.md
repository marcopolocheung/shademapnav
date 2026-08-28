---
name: checkpoint
description: Close out a ShadeMapNav checkpoint — verify the definition of done, get a cold adversarial review, open the PR, update the brief's Current state block, and file what you found. Invoke when a checkpoint's implementation is finished.
argument-hint: "[checkpoint id, e.g. B3]"
arguments: [checkpoint]
disable-model-invocation: true
---

Closing a checkpoint. The definition of done has eight items and **no exceptions** — work
through them in order rather than asserting them.

## 1. Criteria, demonstrably

Re-read the acceptance criteria for `$checkpoint` in your track brief. For each one, name the
`file:line` that satisfies it and trace the path from user action to the new code. A criterion
met in shape but never reached is not met.

## 2. Tests

Logic under `app/lib/**`, `app/services/**`, `app/hooks/**` needs them. Behavior changes to
`routing.ts`, `trainGraph.ts`, `shadeSampling.ts`, `app/lib/shade/**`, `app/lib/guidance/**`
or `app/lib/agent/**` require coverage. They must test behavior, not restate the
implementation.

## 3. The four gates

Run `/gates`. All four, real output. If one fails, stop here — the checkpoint is not closing.

## 4. The browser check

If anything touched UI or the map, run `npm run dev` and actually look: shadows render, the
slider drags, a route calculates. If you cannot run a browser, **say the check is
outstanding** — do not let four green gates stand in for it.

## 5. Invariants

Root `CLAUDE.md` lists seven. The `PreToolUse` hook blocks the mechanical ones during editing,
so a violation reaching this point arrived some other way — a `sed`, a script, a path the hook
does not match. Check the diff against the list once, directly.

## 6. The cold review

Spawn `verifier` with the branch name and the acceptance criteria pasted from the brief. Fresh
context is the point: it cannot inherit your view of your own work.

Fix what it substantiates. Do **not** chase every finding — a reviewer asked to find gaps will
usually produce some, and over-correcting here yields exactly the speculative abstraction the
change-discipline rule forbids. Findings that are real but out of scope become issues.

If the change touched `app/lib/agent/**` or added any user-facing number, also run
`grounding-auditor`. If it touched `app/components/**` or `page.tsx`, also run
`interface-reviewer`.

## 7. The PR

Branch off `main`, never off another open PR — everything stays open, so stacked branches pile
up unmergeable. Conventional-commit title. Body: **at most four sentences**, no headings, no
bullets, no test-plan section, no emoji. In order: what this adds or fixes, why it was worth
doing, how it's implemented, why that way. Include `Fixes #N`. Assumptions go in the
description.

Push and open it with `gh`. **Never merge** — settings deny `gh pr merge` outright.

## 8. State and findings

Update the `## Current state` block in `docs/tracks/TRACK_<X>.md` **in this same PR**:

```markdown
## Current state
- **Active checkpoint:** <id> — PR #NNN open
- **Done:** <ids>
- **Open PRs:** #NNN
- **Decisions made:** <the ones a future session would otherwise re-litigate>
- **Blocked on:** <or nothing>
- **Next action:** <the next checkpoint, one line>
- **Last verified:** <date>, <N> tests / <M> files green on main
```

A state block that drifts is worse than none, because the next session will believe it. If you
found the brief wrong about the code, **the code wins** — fix the brief here and say so in the
PR's four sentences.

Then spawn `scribe` with everything you found and deliberately did not fix, for batch filing
with a priority (`p0`–`p5`), a type, and the `track-x` label.

Finally: if the first 20 minutes of this session went on rediscovering how something works,
the brief was missing a pointer. Add it before you finish — that is the one piece of scope
creep this repo wants.
