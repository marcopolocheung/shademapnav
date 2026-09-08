# Session handoffs

Four documents, each sized for **one new session**. They exist because the roadmap says *what*
to do and the briefs say *how*, but neither says *"here is the state of the world today, start
here."* That is what these are.

**They are snapshots and they decay.** Every one carries a `Verified` date and the commands to
re-check its claims. If a handoff disagrees with the code, **the code wins** — fix the handoff
in the same PR as the work, the way `docs/tracks/README.md` requires of the briefs' state
blocks.

| Read this | If you are | Session shape |
|---|---|---|
| [`WAVE_0.md`](WAVE_0.md) | clearing the things that are currently false | ~4 small PRs, cross-track |
| [`PUBLICATION.md`](PUBLICATION.md) | making the existing work visible (P4 + P2) | 2 PRs, no new engineering |
| [`THREAD_SHADE.md`](THREAD_SHADE.md) | building the differentiator (G→A→H) | long; one checkpoint per PR |
| [`THREAD_AGENT.md`](THREAD_AGENT.md) | building the multimodal agent (Track C) | long; one checkpoint per PR |

**Order.** `WAVE_0` first — it unblocks both threads and its items are hours, not days. Then
`PUBLICATION`, which is the cheapest signal on the board. The two threads are **independent and
parallel**: Track C owns `app/lib/agent/**` outright and reaches the rest of the app only
through tool wrappers, so a shade session and an agent session do not collide.

**Every session, regardless:** `/gates` before any PR opens, `/checkpoint` before it is
reviewed, and never merge — that is the owner's call.

## State common to all four *(verified 2026-09-08, commit `99bb418`)*

- `main` is **green**: lint 0 errors (52 warnings / 8 infos are the known backlog), typecheck 0,
  **497 tests / 40 files**, build clean, browser smoke test passing in CI.
- **P1 is done.** The public mirror at `marcopolocheung/shademapnav` is live and current, so
  anything requiring a publicly-resolving link now works.
- The **feature PR queue is empty.** #165, #210, #213 merged; #161 was closed.
- Toolchain is **vite 6.4.3 / vitest 4.1.11 / esbuild 0.25.12** on **Node 20**.
