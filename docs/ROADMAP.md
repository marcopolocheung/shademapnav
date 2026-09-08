# ShadeMapNav — the golden roadmap

**This file owns one thing: what to work on next, and why it is worth doing.** It does not
duplicate state, and it does not explain how to build anything — briefs do that, and a second
copy would drift. If you want implementation detail, every line here points at the brief that
owns it.

Two questions decide whether anything appears on this roadmap at all:

1. **Does it prove a skill a SWE or AI/ML hiring manager is actually looking for?**
2. **Is it interesting — because nobody else ships it, or because how it works is worth asking
   about?**

An item failing both is cut regardless of how sensible it sounds. An item passing both outranks
an item passing one.

| Where to look | For |
|---|---|
| **This file** | **priority, sequencing, and why an item exists** |
| `docs/tracks/TRACK_<X>.md` | current state, checkpoints, contracts, how to build it |
| `docs/notes/AUTONOMOUS_GOAL.md` | mission, landscape, the session loop (§5), guardrails |
| `docs/tracks/README.md` | how a session runs, subagents, handoff |
| `docs/research/*.md` | the outside evidence this roadmap was reconciled against (§5) |
| the code | anything factual. Always. |

Last reconciliation: **2026-09-07**. **Current state lives in the briefs** — the session-start
hook prints every track's active checkpoint, and that is the only state worth trusting.

---

## 1. The promise

> **Tell it how you want to spend time outside. It finds a plan around the sun, shows its work,
> and adapts when the day changes.**

The request the finished product answers:

> *"I have 90 minutes. Find coffee and somewhere shaded to read for 20, keep me under 8 minutes
> of direct sun including the walk back, and get me home before 5:30."*

---

## 2. The portfolio thesis

A hiring manager gives a portfolio project about ninety seconds. In that window they must
conclude four things, and each needs an artifact they can click.

| They must conclude | Proved by | Status |
|---|---|---|
| **Can do real algorithms** | A time-dependent, constraint-aware routing search checked against a brute-force oracle, with a published approximation gap. Not a wrapper around a routing API. | ⚠️ Half — Pareto label-setting with dominance pruning exists (`routing.ts:566`); the time dimension does not → **Track H** |
| **Can ship applied AI that works** | A tool-using agent with typed contracts, a job/result protocol, deterministic validation, and a public eval suite **whose failures are reported**. | ⚠️ Half — loop and 7 tools exist; C1's harness is in review; no published numbers → **C1–C5** |
| **Understands systems and performance** | Measured wins in CI: the ~1,000–2,200× shadow-index speedup, worker offload, a bundle budget, a browser smoke test that runs. | ⚠️ Half — G1 landed, index win measured (#166); A5 and G2/G3 are not → **G2, A5** |
| **Is honest about what they measured** | The agreement harness publishing `mean 2.6pp · worst 62.5pp · severe 3.3%` — worst case included. Confidence values labelled in code as *priors, not measurements*. UI numbers linking to their own method. | ✅ The strongest signal here — and **invisible to anyone outside the repo** → **Track P** |

**That last row is the whole argument.** Almost every portfolio project claims; almost none
measures; essentially none publishes its own worst case. `ShadeField.ts:199` already says
*"Neither is measured ground truth — these are priors"* in a source comment. That instinct is
the most hireable thing in this repository and no recruiter can currently see it. **Track P
exists to fix exactly that, and it is cheaper than any feature on this list.**

### The novelty claim, stated precisely

From `AUTONOMOUS_GOAL.md` §2 — the honest competitive picture. **Google Maps** ships a shade
*toggle*; it is commoditized. **ASU Cool Routes** routes on mean radiant temperature at 1 m —
the academic ceiling — on one campus, with no app. **Shadehopper / Geuneullo** ship consumer
shade routing, and Geuneullo already models street trees, so our buildings-only model is behind
the consumer state of the art, not ahead of it.

So the differentiator is **not** "shade routing". It is this combination, which nobody ships:

> **The sun advances while you walk** — exposure priced at each segment's *traversal* time, not
> one frozen timestamp — **turned into a reachability question** ("everywhere I can reach on ≤8
> minutes of sun, round trip"), **anywhere OSM and vector tiles reach**, **entirely in a
> browser**, **with an assistant that plans and repairs against that same model**, and **with
> the accuracy numbers published, worst case included.**

Each clause carries weight. Drop the time dimension and it is Google's toggle. Drop the browser
and it is ASU's research tool. Drop the published numbers and it is every other portfolio.

### Anti-goals

Impressive to a keyword filter, padding to a good engineer. Named so nobody adds them believing
they help:

- **Kubernetes on a client-side static site.** Deploying a web app to a cluster is not evidence
  of infrastructure skill. Defensible only behind a real bursty workload.
- **Spark/Sedona in the request path.** One machine handles this data. Benchmark the simple
  thing first; the distributed version is a labelled study, never the product.
- **A second LLM provider or a paid model.** Breaks the free-tier guardrail, proves nothing.
- **Multi-agent orchestration** before a controlled comparison shows the bounded loop is the
  bottleneck. "I added more agents" is the opposite of the restraint signal.
- **A vector DB / RAG** with no defined retrieval problem.
- **A badge wall in the README.** Every badge is a claim a reviewer can test.

---

## 3. The order of work

Every item below is a **real checkpoint in a real brief**. There is no separate roadmap ID
namespace — if it is not a checkpoint someone can take with `/track`, it does not belong here.

### NOW — Wave 0: truth · blocks new checkpoints

Unglamorous, small, and currently false in production. These are the difference between
"measured" and "claimed", which is the entire thesis of §2.

| Item | Track | Why it blocks | Issue |
|---|---|---|---|
| **P1** Mirror `public` on every merge | P | `browser-verification.md` came from a merged PR and is still missing from the mirror, so **D3/D4's "method linked from the UI" acceptance cannot be met** — the app renders a health-adjacent UV number whose method link 404s | #199 |
| **D0** Real timezones (IANA + DST) | D | `Math.round(lng / 15)` is off 30 min across India, an hour across half of China. **The time axis is this product's entire differentiator**; every "shadiest at 7 PM" claim inherits the error | *needs filing* |
| **G8** Nominatim policy + the dropped `User-Agent` | G | `SearchBar.tsx:150` does prohibited keystroke autocomplete and bypasses the queue in `nominatim.ts`; `User-Agent` is a **forbidden header name**, silently dropped, so invariant #6 holds nowhere on the client | *needs filing* |
| **G7** LICENSE, `.env` vs `.env.local`, README refs | G | The repo's own map of itself is wrong; a reviewer who finds that stops trusting the rest. **#50 is mostly stale — read G7's re-scope before working it; three of its four bullets are already resolved and one would have you create six files `.claude/rules/` replaced** | #52, #53, part of #50 |

**Standing rule, not a checkpoint:** six substantive PRs are open (#161, #165, #181, #189,
#191, #196). A track that opens a seventh before its first is reviewed is manufacturing queue,
not progress. Merging is the owner's call — sessions never merge — so what a session owes is
making each reviewable: rebased, gates green, ready or closed.

### NOW — Wave 1: finish the flagships

Five tracks sit at roughly 60%. **A hiring manager cannot be impressed by 60% of anything.**
This wave adds almost no new ideas on purpose.

| Order | Checkpoints | Why this, why now |
|---|---|---|
| 1 | **G2** benchmark, then **G6** seams | A5's acceptance is literally *"no benchmark → no claim"*, and Track H's central claim is a *comparison*. G6 permanently removes the ⚠️s from the parallelism table. "Built the measurement before claiming the improvement" is a senior-shaped decision. |
| 2 | **A5** worker, **A6** sweep | A5 gets routing off the main thread (#38). A6 exploits that a prism's shadow is an affine function of sun azimuth/altitude — an exactness criterion, not a vague speedup. **A6 gates Track H.** |
| 3 | **B2 → B7** | The app is called navigation and does not navigate. **B6 is the reason Track B exists**: *"cross to the shaded side"* — an instruction no competitor can generate. B7 unparks F and supplies P3's demo. |
| 4 | **C1 → C5**, then **C11** | Eval harness first, then probes on `ShadeField`, then **C4 — the plan job contract** (re-scoped; see the brief), then receipts. Then **C11 — plan revisions and repair**, the *Living Itinerary*: a plan is a data object with provenance, expiry and a version, and a late departure re-solves only the affected span. This is exactly the shape agent-platform and model-evaluation postings describe, and "I built the eval harness first" separates people who have shipped an agent from people who have prompted one. **C11 is the second-most distinctive capability in the product and P3's demo ends on it.** |
| 5 | **D3, D4** + the mobile strip fix | Turns a unitless fraction into UV dose and a heat score, with ranges, documented assumptions and graceful degradation. **Not done until P1 lands.** #197 — the D1 strip never renders on mobile — is a shipped feature nobody on a phone can see. |
| 6 | **E1**, then **E5** | E1 is the cheapest large win on the board: the policies, the edge tags and the Overpass ingest all exist and nothing is wired to cost. E5 (`Trip`) is the structural half of the Living Itinerary and H5 consumes it. |

### NOW, gated — Wave 2: Track H, the differentiator

**Everything above is table stakes or catch-up. This is the part a hiring manager asks a second
question about.** Gate: **A6 and G2 must land first** — H is unaffordable without A6 and
unprovable without G2. Full brief: `docs/tracks/TRACK_H.md`.

| Checkpoint | Why it earns its place |
|---|---|
| **H1** traversal-time exposure | A genuine time-dependent shortest-path problem with the traps intact: does non-overtaking hold, is waiting an action, what does dominance mean once a label carries time *and* accumulated exposure. Nobody advances the sun *along* a route. |
| **H2** exposure as the objective | The current front is (distance, shaded distance) under a 2.0× detour budget, so "Most Shaded" can carry **more absolute exposed metres** than "Shortest" — a demonstrable defect, not a hypothetical. *"I found my own objective was measuring the wrong thing and proved it with a fixture"* is a self-caught defect, which reads better than a caught bug. |
| **H3** Sun Budget reachability | The flagship interaction, and it **inverts the product**: every other maps app needs your destination first; this answers *"where can I even go?"* Forces the honesty split between an exact result, a bounded approximation, and *a search that ran out of budget* — a capped search returning nothing has not proved impossibility. |
| **H4** oracle + published gap | What upgrades H from a cool feature to an algorithm you can defend. Without it H3 is a demo. |
| **H5** waiting, dwell, return leg | The subtle correctness point: earlier arrival does **not** dominate if the wait it implies breaks the budget. Noticing that before it bites is the difference between a student implementation and an engineered one. |
| **H6** *(stretch)* feasibility for the agent | Where Track C and Track H become one product. Makes §1's request answerable rather than narrated. Needs C4 first — a feasibility query returning "started" is useless. |

### NEXT — Wave 3: Track P, make it legible

**P4 is startable immediately** and is the highest value-per-hour item in this document: two
resume lines in §6 are *already earned and merely unpublished*. Do not save this wave for the
end. P2/P3 want two finished Wave-1 tracks and H3 rendering.

`docs/tracks/TRACK_P.md` — P1 mirror · P2 README · P3 demo recording · P4 publish the numbers ·
P5 design notes · P6 the ledger.

### LATER — Wave 4: pick exactly one specialization

**Decide; do not accumulate.** Both are credible; doing both halfway is worse than one properly.
Record the choice in this file when it is made. Neither has a brief yet — write one when chosen.

**Option A — Reality Check (the ML story).** Users flag where predicted shade disagrees with
what they observe; a learned correction improves on the geometry baseline.
- **Stop at the achievable rung** unless the data justifies more: logistic regression or GBTs
  over geometry confidence, solar altitude, street orientation, canopy features, observation
  conditions. ~90% of the MLE story for ~10% of the cost of a vision model.
- **Non-negotiable:** geographic *and* temporal holdouts (not random frames from one walk),
  calibration fit separately from training, an untouched final test set, reliability diagrams, a
  dataset card, a documented rollback to the geometry baseline.
- **A crowd tap is evidence, not ground truth**, and A3's harness measures model-vs-model
  agreement, not physical accuracy. The code already says so; that distinction must survive into
  any README claim.
- **Honest cost:** the observation corpus is the expensive part. Months, for one person.
- **Trap:** USGS bare-earth DEMs strip buildings and vegetation. A terrain DEM is not a shadow
  model.
- **Prerequisites:** opt-in, minimized location retention, deletion support, no medical data.

**Option B — City Capsules (the systems story).** Download a neighborhood; keep planning with no
network. Versioned local graph + shade representation + permitted assets behind a worker
boundary, with an **atomic manifest swap** so a half-downloaded update cannot replace a working
capsule; checksums validated on install; interrupted downloads, eviction and restart handled.
Demonstrate on a **named device**: install, kill the network, route, retime, restart, resume —
then publish size, cold/warm latency, memory and online/offline parity. PMTiles is a tile
archive, not a routing graph or a caching policy; a PWA manifest is not offline coverage.
Rust/WASM only after profiling proves a kernel is the limit, with a reference implementation
kept for parity. Overlaps Track F's F4.

### LATER — playful, one PR each, after Wave 3

Each reuses Track H's planner rather than adding a system, and each is what makes someone want
to *use* the thing: **Shadow Lab** (drop a hypothetical tree, watch routes change — a
counterfactual tool; label the assumptions), **Find the Light** (invert preference per stop:
sunny breakfast, shaded reading, sunset viewpoint), **Golden-Hour Rendezvous** (two people, one
pleasant meeting point; minimizing the *worst* individual burden is arguably fairer than the
average — expose the tradeoff), **Shadow Chase** (an outing that reorders as the sun moves;
lawful paths only, never reward unsafe crossings).

### NOT DOING — and why

Recorded so no session re-litigates them. Carried from `AUTONOMOUS_GOAL.md` §7 plus the research
proposals that were considered and declined.

| Proposed | Verdict | Reason |
|---|---|---|
| PostGIS + object storage + an agent-gateway backend | **Declined for now** | Contradicts the local-first decision that keeps this free, private and deployable from one repo. Sun Budget does not need it. Revisit only if Wave 4 Option A needs a corpus — and scope it to that, not the app. |
| Kubernetes, Spark/Sedona, Kafka, service mesh, vector DB | **Declined** | §2 anti-goals. A labelled study behind a real workload, never the request path. |
| A second LLM provider or a paid model | **Declined** | Free-tier guardrail. |
| Accounts / sync | **Declined** | Local-first; `localStorage` holds profiles and saved trips. |
| Driving navigation | **Declined** | Out of mission — under own power only. |
| In-browser SOLWEIG/CFD microclimate | **Declined** | ASU needed lidar and a campus. Approximate honestly and say so (D4/D8). |
| A native app | **Deferred** | PWA first; revisit only if background location or notifications block D7. |
| A 50–100 task agent benchmark | **Rescoped** | Cerebras is 5 req/min; 100 tasks with repeats is hours per run. C1's ~15 recorded, network-free scenarios is the right start — **grow from real failures, not to a target number.** |
| Chasing Google's feature list | **Declined** | The answer to "Prefer shade" is not a better toggle. It is §2's five clauses. |

---

## 4. The checklist

Every line is a checkpoint in a brief. Tick only when its acceptance criteria are met and the
gates are green — `docs/tracks/README.md`'s definition of done applies to all of them.

**Wave 0 — truth**
- [ ] **P1** Mirror `public` on merge · #199
- [ ] **D0** Real timezones, IANA + DST
- [ ] **G8** Nominatim policy + reachable `User-Agent` (with #32, #33)
- [ ] **G7** LICENSE · README refs · `.env.example` · #50 cluster
- [ ] Six open PRs rebased, green, ready or closed

**Wave 1 — flagships**
- [ ] **G2** route benchmark  · [ ] **G6** seam work *(runs alone)*
- [ ] **A5** worker offload · [ ] **A6** time sweep *(gates H)*
- [ ] **B2** · [ ] **B3** · [ ] **B4** · [ ] **B5** · [ ] **B6** *(the reason B exists)* · [ ] **B7** *(unparks F)*
- [ ] **C1** *(PR #191)* · [ ] **C2** · [ ] **C3** · [ ] **C4** *(re-scoped: plan job contract)* · [ ] **C5** · [ ] **C11** *(repair — the Living Itinerary)*
- [ ] **D3** *(PR #189)* · [ ] **D4** *(PR #196)* · [ ] #197 mobile strip
- [ ] **E1** mode cost model · [ ] **E5** `Trip`

**Wave 2 — Track H** *(gated on A6 + G2)*
- [ ] **H1** · [ ] **H2** · [ ] **H3** · [ ] **H4** · [ ] **H5** · [ ] **H6** *(stretch)*

**Wave 3 — Track P** *(P4 startable now)*
- [ ] **P2** README · [ ] **P3** demo recording · [ ] **P4** publish the numbers · [ ] **P5** design notes · [ ] **P6** ledger

**Wave 4 — one specialization**
- [ ] Option A Reality Check · [ ] Option B City Capsules · *decision recorded on:* ______

**Conditional** — not on a wave, but required the moment a precondition is met:
- [ ] **C10** untrusted content and tool authority — **required before any tool returns
  third-party prose.** Today the surface is narrow (a truncated OSM place name; Foursquare is
  not imported by the agent at all), so this is a *constraint on future work*, not a live
  vulnerability — but #67 (Foursquare place details) or any server-side fetch tool makes it live.

**Not yet prioritized** — in their briefs; pull one up when it earns its place against §2's two
questions, not because it is next in a list:
A7–A9 · B8–B9 · C6–C9 · D5–D8 · E2–E4, E6–E8 · F1–F6 · G3–G5.

---

## 5. Reconciliation with the research

`docs/research/` holds two independent passes (2026-09-05 market research, 2026-09-07
recruiter-focused roadmap) that converge on the same priorities — real signal. Every
source-level claim in the 2026-09-07 document was **re-verified against the code**; all seven of
its "most consequential gaps" hold. Recorded so no session re-audits them:

| Research claim | Verified | Went to |
|---|---|---|
| Every edge sampled at one `dateRef.current` | ✅ `useNavigation.ts:633`, `:1154` | **H1** |
| Timezone from longitude, whole-hour, no DST | ✅ `timezone.ts:8` | **D0** |
| Pareto maximizes shaded distance → more shade can mean more sun | ✅ `routing.ts:544`, `maxDetourFactor = 2.0` | **H2** |
| `plan_shaded_route` returns "started", never awaits | ✅ `tools.ts:470-478` | **C4** |
| Source confidences are priors, not measurements | ✅ `ShadeField.ts:199` says so in-source | Wave 4 Option A; **P4** publishes the distinction |
| Public Nominatim behind a browser-local queue | ✅ **understated** — `SearchBar.tsx:150` bypasses the queue entirely, and `User-Agent` is silently dropped as a forbidden header | **G8** |
| `api/agent.js` per-IP limiter is a process-local `Map` | ✅ `:39` | **G8**, **C6** |
| Not merely a pixel sampler — geometry field with pixel fallback | ✅ A4b landed | Corrects a stale impression; keep it corrected in **P2** |
| README thin, `api/` inventory stale | ✅ 19 lines | **G7**, **P2** (`CLAUDE.md` half fixed 2026-09-07) |

**Where the research was incomplete:** it called exposure entirely unrepresented, but
`longestContinuousSunM` and `sunExposure` already exist as *outputs* (`routing.ts:481`) — they
just never enter the search, which is precisely H2. It also missed that `plan_shaded_route`
already accepts `via` stops, which is why C4 needed re-scoping rather than building.

**Restored 2026-09-07 after an audit found them dropped.** A first pass at this file was 775
lines; cutting it to an index dropped three things from the research doc that had no other home.
They now live in the briefs that own them: **prompt injection / untrusted provider content →
C10**; **the plan as a versioned data object, its deterministic validator, and repair
minimality → C11**; **the separate-evaluation-layers table → P4's approach.** Recorded here
because a roadmap that silently loses source material is the failure this section exists to
prevent.

**Where its plan was declined:** the backend, Kubernetes and Spark sections — see §3's NOT DOING
table. Its own §13 says those "should not delay the central experience"; this roadmap takes that
sentence over the pages above it.

---

## 6. The resume-line ledger

Fill in **only from measured results**. A number nobody can reproduce is worse than no number,
and a hiring manager who finds one stops reading. Tick only when the artifact is live on the
public mirror.

| | Line | Earned by |
|---|---|---|
| ⬜ | "Built a time-dependent pedestrian planner with exposure and arrival constraints; reduced [error] by [measured] versus a static baseline on [versioned fixtures]." | H1–H4 |
| ⬜ | "Developed a tool-using itinerary agent with deterministic validation and recovery; improved valid-plan rate from [A] to [B] over [N] held-out tasks at [cost] per successful task." | C1, C4, C5, P4 |
| ⬜ | "Cut per-edge shade sampling by [measured]× by precomputing and indexing shadow geometry per sun cell." | **Already measured (#166) — needs only P4** |
| ⬜ | "Published a shade-model agreement harness across [N] cases and 3 cities, reporting mean, p90 and worst-case error against committed regression ceilings." | **Already true (A3) — needs only P4** |
| ⬜ | "Implemented offline neighborhood routing with atomic snapshot updates; [latency and size], verified online/offline parity on [device]." | Wave 4 Option B |
| ⬜ | "Trained and calibrated a geospatial shade-correction model with neighborhood and date holdouts; measured [metric] and [route impact], with versioned deployment and rollback." | Wave 4 Option A |

**Two of six are already earned and merely unpublished.** That is the cheapest value available
anywhere in this document.

---

## 7. Scope notes

**Design is out of scope here** and is never a reason to delay an item above. Two exceptions,
because they are correctness rather than taste and are already filed: **#197** (the hourly strip
never renders on mobile — a feature nobody can see) and **#198 / #158** (9px uppercase
disclaimers; 1.63:1 shaded-vs-lit contrast against a 3:1 floor). An app used one-handed in
bright sun has legibility as a functional requirement. When design gets its own pass, it gets
its own document.

**Stopping rules.** Stop or redirect any item when it adds maintenance without improving an
agreed outcome, when the data cannot support the claim, or when a simpler baseline wins. **A
note explaining why you did not ship Spark, Rust, a learned model or multi-agent is itself a
portfolio artifact** — arguably better than shipping it would have been.

**If you read nothing else:** finish Wave 0. Then finish what is already 60% done. Then build
Track H, the only thing here nobody else has. And publish the numbers you already have — that
one is startable today.
