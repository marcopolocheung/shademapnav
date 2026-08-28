# Change discipline

Always-on, deliberately short. These are the two habits that most often go wrong in this
repo — a codebase where PRs are capped at four sentences, three large files are contested by
six tracks, and every PR stays open for one human to read.

## Surgical changes

**Every changed line traces to the task.** When editing existing code:

- Don't improve adjacent code, comments, or formatting you happened to scroll past.
- Don't refactor what isn't broken and isn't in scope.
- Match the surrounding idiom even where you'd write it differently. `routing.ts` leans on
  non-null assertions; the solar constants trip an approximate-constant rule on purpose. Both
  are settled decisions with lint rules turned off to match.
- If you notice unrelated dead code or a real problem outside your scope, **file it, don't fix
  it.** Findings become issues with a priority, a type and a `track-x` label. Scope creep is
  how invariants get broken.

Clean up the orphans *your* change creates — the import it made unused, the variable it
stranded. Pre-existing dead code is someone else's PR.

## Simplicity

**The minimum that satisfies the acceptance criteria.** No speculative configurability, no
abstraction for a single call site, no error handling for states that cannot occur, no
"flexibility" nobody asked for. If you wrote 200 lines and it could be 50, rewrite it.

This matters more than usual here because the reviewer is one person reading a four-sentence
description, and because a track's checkpoints are sized to be one PR each. A change that
quietly grows past its checkpoint stops being reviewable.

## On asking

Prefer a reasonable default and a stated assumption over a blocking question. A track session
picks the next unfinished checkpoint and works it end to end; assumptions go in the PR
description, and genuine blockers become issues filed against the blocking track while you
build against a stub. Stop and ask only when proceeding either way would be unsafe or would
waste the work if wrong.
