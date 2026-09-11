# The agent's live eval — first measurements (2026-09-11)

`npm run eval:agent` replays the C1 scenarios against a real model. Each scenario keeps its
world (stubbed tools, pre-injected map context) and drops its script: every model turn comes
from the real `callModel`, through the real OpenAI translation, tool-call salvage and retry
code. It is **not** part of `npm test` — it needs a key and spends requests.

```bash
npm run eval:agent                                   # Cerebras, the app's own .env pool
AGENT_EVAL_PROVIDER=fireworks npm run eval:agent     # FIREWORKS_KEY, one pinned model, $1 cap
AGENT_EVAL_ONLY=via-stops-become-pins,one-place-one-pin npm run eval:agent
AGENT_EVAL_RESEARCH_MODEL=… AGENT_EVAL_RESPONSE_MODEL=… npm run eval:agent   # compare models
AGENT_EVAL_OUT=/tmp/run npm run eval:agent           # also writes /tmp/run.md and /tmp/run.json
```

A grounding violation fails the scenario. The tool path, LLM-call budget and default-world
calls are measured and reported, because a real model may reach a grounded answer by another
route.

## Why Fireworks, not Cerebras

Every Cerebras key in the pool returns 402 `payment_required` on `gpt-oss-120b` and
`qwen-3.8-27b`; `zai-glm-4.7`, the configured research model, is archived (#301). Every number
below is **Fireworks `accounts/fireworks/models/deepseek-v4-flash-0731` in both roles**. The
loop is provider-independent; the absolute rates are this model's, not Cerebras's.

## Results

Same instrument, same model, 19 scenarios per run (23 once C2's review added four).

| loop | runs | grounded turns | LLM calls / turn | over scripted budget | followed script |
|---|---|---|---|---|---|
| `main` (7bc0a17) | 2 | **22 / 38** | 6.58 | 30 / 38 | 4 / 38 |
| C2 (9e910eb) | 2 | **38 / 38** | 6.87 | 28 / 38 | 6 / 38 |
| C2 after review (c05192b) | 1 | **23 / 23** | 6.43 | 16 / 23 | 4 / 23 |

What `main` got wrong, by scenario: world-knowledge landmarks the tools never returned (the
New York Public Library in 10 of 38 turns, the Empire State Building, Times Square, Grand
Central); an empty café search answered with "head to Bryant Park" (both runs); an off-topic
question answered with Midtown landmarks (both runs); a route's via stops named and never
pinned. C2's write prompt, `reconcilePins` and via-stop collection close all four in these runs.

What neither loop fixes: **cost**. A real model spends 6–7 LLM calls a turn, and 3 in 4 turns
exceed the budget their script assumes (#302).

## What the first runs taught the instrument

The first live run had the instrument wrong in three ways, each now fixed:

1. **A plot is required only when a place was gathered.** A scenario's `plotsBeforeWrite` is
   true of its scripted path; a live model that gathers nothing and names nothing is honest,
   not a violation.
2. **Unstubbed tools answer from a neutral default world.** A script never calls a tool its
   scenario didn't stub; a real model does, in 15 of 19 scenarios. An error there sent it into
   retries that measured the fixture, not the model. The default world never invents a place:
   searches and geocodes come back empty.
3. **The name check watches the landmarks near the default map centre.** It searches only
   names a scenario declares, so a model naming Bryant Park from memory after an empty search
   passed. It is the most common failure on `main`, and was invisible until the list existed.

Scenarios whose user names a place can now geocode it (`gazetteer()` in `harness.ts`) — the
scripts had passed coordinates the model supposedly knew.

## Blind spots

- **The check is name-only.** Directions ("the sun is in the southwest"), shade claims and
  times in the prose are not checked against any tool result — that is C5.
- **A place no tool returned has no coordinates**, so nothing in code stops the model naming
  it; only the write prompt does. C2's reconciliation pins what tools returned, nothing else.
- **Stubbed tools hide tool quality.** `search_places` searched a 33 × 25 km box in the real
  app and returned Queens for "near Bryant Park"; no stub could show that. Only `npm run dev`
  did (#59 re-check).

## Cost

About $0.15 per 19-scenario run at the guard's conservative price (4× the listed $0.14 / $0.28
per 1M tokens); ~130 requests and ~200k input tokens a run.
