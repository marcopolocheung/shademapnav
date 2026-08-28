# AGENTS.md

Entry point for coding agents that follow the `AGENTS.md` convention. **Claude Code does not
read this file** — it reads `CLAUDE.md` — so keep this a thin pointer, not a second guide.
Anything written here twice will drift.

Canonical agent guide: **`CLAUDE.md`** at the repo root — read it first. It has the commands,
the seven hard invariants, the repo map, and a task→edit-point routing table.

Then, depending on what you're doing:

| You want | Read |
|---|---|
| Why this product exists, who the users are | `GROWTH_ROADMAP.md` |
| What to build and in what order | `docs/notes/AUTONOMOUS_GOAL.md` |
| How a work session is actually run | `docs/tracks/README.md` |
| The deep brief for one track, with live state | `docs/tracks/TRACK_<A–G>.md` |
| Per-area constraints (shadow, routing, hooks, agent loop, APIs, tests) | `.claude/rules/*.md` |

If those disagree with each other, **the code wins**, then `AUTONOMOUS_GOAL.md` for
sequencing, then `GROWTH_ROADMAP.md` for user rationale.

## Two things that will bite you

**Do not read or edit `.worktrees/`** or any `oldbuild/` copy — orphaned stale checkouts.

**Never merge a PR.** Every PR stays open for the repo owner.

## If you are Claude Code

Ignore this file; `CLAUDE.md` and `.claude/` are yours. The invariants are enforced by a
`PreToolUse` hook rather than requested in prose — see `.claude/README.md`.
