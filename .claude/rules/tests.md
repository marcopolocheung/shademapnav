---
paths:
  - "app/**/__tests__/**"
  - "vitest.config.ts"
---

# Tests

`npm test` is `vitest run`. The suite is configured in `vitest.config.ts`:

- `environment: "node"` — **nothing here has ever run in a browser.** Shadow rendering,
  timeline drag, end-to-end route calculation, the streaming preview, GeoTIFF export and the
  PWA shell are all uncovered by design, not by oversight.
- `include: app/{lib,services,hooks,components}/__tests__/**/*.test.{ts,tsx}`
- Coverage over `app/{lib,services,hooks,components}/**`, excluding `__tests__` and `.d.ts`

CI runs `lint → typecheck → test → coverage → build` and needs **no secrets**. The suite is
hermetic: no network, no env, no clock dependence. Keep it that way — a test that reaches the
network is a test that fails in CI for reasons unrelated to the change.

## Test behavior, not implementation

The failure mode to avoid: a test that would still pass if the function under test were
replaced by the exact expression the test asserts. That test passes forever and catches
nothing. Neither does one that counts internal calls rather than checking results.

Write the test as a claim about behavior — *given this graph and this sun position, the
shadier path wins* — so that a wrong refactor breaks it and a right one does not.

## What requires a test

Logic changes anywhere in `app/lib/**`, `app/services/**` or `app/hooks/**`. Behavior changes
to `routing.ts`, `trainGraph.ts`, `shadeSampling.ts`, `app/lib/shade/**`,
`app/lib/guidance/**` and `app/lib/agent/**` require coverage specifically, because those are
the files whose bugs are invisible in review: a wrong cost weight produces a route that looks
entirely reasonable.

When you fix a bug, write the failing test first and watch it fail. A test written after the
fix, against the fixed code, proves only that you can describe what you just wrote.

## What a green suite does not mean

It does not mean a UI or map change works — run `npm run dev` and look. It does not mean the
shade numbers are right; the agreement harness measures agreement between two models, both of
which can be wrong together. Say which check you actually ran, and name the one you did not.
