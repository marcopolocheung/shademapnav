# Track C — Shade Copilot

> **Charter:** an assistant that only ever says things the map can back up. Narrow, grounded,
> and fast enough to be worth asking — the questions Gemini can't answer because it doesn't
> model shade at 5:40pm on this block.

**Class:** Flagship. **Runs alongside:** everything. This track owns `app/lib/agent/**` outright
and reaches the rest of the app only through tool wrappers — it is the friendliest track to
run in parallel with any other.

---

## Current state

- **Active checkpoint:** C1 (not started)
- **Done:** nothing in this track — but see "What's already true" — the 2026-07 project review's complaints are **partly stale**; re-verify before acting on them
- **Open PRs:** none
- **Decisions made:** none yet
- **Blocked on:** nothing
- **Next action:** C1 — the eval harness. No other checkpoint lands first.
- **Last verified:** 2026-08-24, 156 tests / 23 files green on main

---

## What's already true (verified 2026-08-24 — do not "fix" these)

The archived `PROJECT_REVIEW-2026-07-05.md` lists three agent failures. Two have since been addressed:

1. **"Narrates itineraries it never plots"** — `agentLoop.ts:155-170` now collects
   `pointCandidates` during research and runs `plotFallbackPoints()` before the write phase,
   which calls `plot_points` and injects a *"Map state guarantee: the app already plotted
   these itinerary pins before answering"* line into the write prompt. **It has never been
   confirmed in a browser** (issue **#59**). C1 + C2 are about *locking it down*, not building it.
2. **"`check_shade` hijacks the camera for 10–15s"** — no longer true. `tools.ts:359-390`
   tries `ctx.shadowLayerRef.current.queryPointShade()` (camera-free, geometry cache), falls
   back to `queryOffscreenBuildingShade()` (Overpass, viewport-independent), and errors out
   rather than flying. The only remaining camera moves are `locate_user` (`:282`) and
   `plot_points` (`:422`, `:435`) — both legitimate.
3. **"Two-point routes only"** — still true. `plan_shaded_route` (`tools.ts:195`) takes an
   origin and a destination while `useNavigation` supports `additionalWaypoints`. That's **C4**.

Also already built and worth knowing before you touch anything:

- **8 tools** (`tools.ts`): `locate_user` (115), `geocode_place` (120), `search_places` (131),
  `check_shade` (146), `set_time` (160), `plot_points` (171), `plan_shaded_route` (195);
  `get_current_context` is *not* a tool — it's pre-injected into the system prompt each turn
  (`agentLoop.ts:141-150`) to save a guaranteed round-trip.
- **Two-model roles**: research (`zai-glm-4.7`) then write (`gpt-oss-120b`, tool-free prompt at
  `agentLoop.ts:44`). `rolesShareConfig()` skips the second call when they're the same model.
- **Determinism**: temperature 0, fixed seed, `parallel_tool_calls: false`, `MAX_STEPS = 8`.
- **Resilience**: round-robin key pool with 429/5xx failover (client and `api/agent.js`),
  Retry-After handling, malformed-tool-call retry, and `extractTextToolCalls` salvage for
  models that emit calls as prose.

## Hard invariants that bite this track

- **Free-tier only.** Cerebras, ~1M tokens/day per account, **5 requests/minute**. No new
  providers, no second key pool, no chatty calls. A 5-step turn can take over a minute purely
  on rate limits — that budget is a design constraint, not an inconvenience.
- **The loop runs client-side** because its tools need the live map (canvas, camera, routing
  pipeline). Don't move it server-side; `api/agent.js` is a key-hiding proxy, not a host.
- **One neutral IR.** `LlmContent`/`LlmPart` in, OpenAI chat-completions out via `llmClient.ts`.
  Provider details stay in that one file.
- Both current models emit a `reasoning` field; `fromOpenAI` reads `content`. Reasoning-heavy
  models eat the token budget on tool calls — that's why research ≠ write.

## The contract this track publishes

Tools, and only tools. **Every tool is a thin wrapper that delegates** — to `ShadeField`
(Track A), the routing pipeline (Track E), `HeatModel` (Track D), or a service wrapper.
If a tool contains domain logic, it's in the wrong file.

---

## Checkpoints

### C1 — Eval harness **first**
**Goal.** Make agent behavior testable without a network or a key.
**Approach.** `app/lib/agent/__tests__/scenarios/`: ~15 recorded scenarios, each a scripted
sequence of model responses (the existing `agentLoop.test.ts` / `agentProxy.test.ts` already
stub the client — extend that pattern). Assert **behavior, not prose**:
- did `plot_points` run before the write phase, in the happy path *and* the step-budget-exhausted path?
- does the final answer name only places that were plotted?
- did the loop stay within `MAX_STEPS` and within a tool-call budget?
- does a tool error produce an honest answer rather than a confident invention?
- does an empty `search_places` result stop the loop from inventing a café?
**Acceptance.** Runs in `npm test`, no network, deterministic. A deliberately broken loop
(e.g. `plotFallbackPoints` disabled) makes it fail — prove the harness has teeth by trying it.
**Files.** `app/lib/agent/__tests__/**`. **Size.** Large. **Gate: nothing else in this track ships first.**

### C2 — Ground the write phase
**Goal.** Close the remaining gaps in plot-before-answer, and verify **#59** for real.
**Approach.** With C1 in place, find where the guarantee leaks: candidates collected but not
plotted (dedupe/cap at 8), places named in prose that never became candidates, the
`separateWrite === false` path (research model answers directly — does the guarantee still
hold there?). Tighten the write prompt to forbid naming unplotted places, and enforce in code
what the prompt asks for.
**Acceptance.** Every C1 grounding scenario green, including the shared-model path; #59's two
observations confirmed in `npm run dev` and the issue closed with what was actually observed.
**Files.** `agentLoop.ts`, `tools.ts`. **Size.** Medium.

### C3 — Probes on the `ShadeField`
**Goal.** One shade source for the whole app.
**Approach.** `check_shade` calls Track A's `ShadeField.shadeAt` and reports `source` +
`confidence` in the tool result, so the model can qualify its answer ("shaded, though tree
cover here is estimated"). Keeps the Overpass path as fallback. Adds `check_shade_at_times`
over `sweep` (A6) so "when is this terrace shaded?" costs one tool call, not five.
**Acceptance.** No camera movement during research (already true — keep it that way, and add
a C1 scenario that asserts it); confidence surfaces in the answer; a low-confidence probe never
becomes a confident sentence.
**Files.** `tools.ts`. **Size.** Small–medium. **Needs A2/A6; stub until then.**

### C4 — Multi-stop planning
**Goal.** "Coffee, then the park, then dinner — in the shade" produces one plotted journey.
**Approach.** `plan_shaded_route` accepts ordered stops and drives `additionalWaypoints`
(supported since PR #5/#9/#19/#20). Add `suggest_time` backed by A6's sweep and Track D's
best-time series. Prefer Track E's `Trip` (E5) as the argument shape once it exists.
**Acceptance.** A three-stop request yields one multi-leg route on the map with per-leg shade;
a leg that can't be routed reports honestly (`partialRoute.ts` already models this) instead of
being silently dropped; C1 scenario covers both.
**Files.** `tools.ts`, thin call into `useNavigation`'s pipeline via `AgentContext`. **Size.** Medium.

### C5 — Answers with receipts
**Goal.** Every claim clickable.
**Approach.** Structured output alongside the prose: each claim carries the tool result id that
produced it. `AssistantPanel` renders chips ("Shade 62% at 16:00 — checked") that focus the
matching map object.
**Acceptance.** Every place named in an answer has a chip and a pin; clicking focuses it;
answers with no backing produce no chip — and the UI makes that visible rather than hiding it.
**Files.** `agentLoop.ts`, `AssistantPanel.tsx`, `useAgent.ts`. **Size.** Large.

### C6 — Budget discipline
**Goal.** Fit the free tier and feel alive while doing it.
**Approach.** Per-session caches for geocode/search results (identical queries recur constantly);
collapse redundant probes; stream tool progress to the panel ("checking 3 spots…" — `onToolEvent`
already exists); consider a cheap deterministic pre-pass for obviously-geocodable inputs.
**Acceptance.** Median C1 scenario completes in **≤4 LLM calls**; the panel shows progress
within 2s of submit; no scenario exceeds `MAX_STEPS`.
**Files.** `agentLoop.ts`, `tools.ts`, `useAgent.ts`. **Size.** Medium.

### C7 — Honest degradation
**Goal.** No key, rate-limited, or offline should never look like a broken app.
**Approach.** Distinguish the cases (no key configured / 429 with Retry-After / network down /
map not ready) and say which, plainly, plus offer the deterministic equivalent — search, the
best-time chart (Track D), plain routing.
**Acceptance.** Each case has a C1 scenario and a distinct, non-alarming UI state; a 429 shows
the wait, not a spinner.
**Files.** `useAgent.ts`, `AssistantPanel.tsx`, `api/agent.js`. **Size.** Medium.

### C8 — Ask while walking *(stretch)*
Questions answered against the *active route* and the user's live position (needs Track B):
"is the next stretch shaded?", "where's water on the way?".

### C9 — Exit beta
Published criteria, all of which are measured, not felt: C1 green for three consecutive weeks;
zero ungrounded-claim escapes; p50 turn under 10s; #59 closed by observation. Until then the
assistant stays labelled beta — GROWTH_ROADMAP §1.1 is right that a feature which demos badly
is negative marketing.

---

## Subagent plan

- **C1's scenarios are swarm-able** — each scenario is an independent fixture file. Write the
  harness solo, then fan out 3–4 builders on scenario batches in worktrees.
- **C2, C5, C6 are solo** — they change loop control flow, where interactions bite.
- **Scout** for provider questions ("does Cerebras honor `seed` on both current models?") —
  bounded and answerable from docs.
- **Verifier on C2 and C6.** Both can look correct and quietly regress grounding or blow the
  rate budget.

## Risks

1. **Building on the stale review.** Two of its three complaints are fixed. Read the code, not
   the archive. (This brief's "What's already true" is the correction; if it drifts, fix it.)
2. **The eval harness measuring prose.** Asserting on wording makes the suite brittle and
   meaningless. Assert on *behavior*: which tools ran, in what order, with what arguments.
3. **Rate-limit-shaped design failures.** 5 req/min means an "obviously better" extra
   verification call can double turn latency. Every added call needs a C6 budget justification.
4. **Scope creep toward a general chatbot.** The system prompt is deliberately narrow
   (shade-day-planning only). Keep it that way — breadth is where Gemini wins and we can't.

## Out of scope / hand-offs

- Shade math → **Track A**. Routing → **Track E**'s pipeline. Heat/UV → **Track D**.
- Live position → **Track B** (C8 consumes it).
- Anything that costs money, needs an account, or adds a provider → not this project.
