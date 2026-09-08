# ShadeMapNav: a distinctive product and a credible engineering portfolio

**Recruiter-focused innovation and implementation roadmap**  
**Prepared for:** Marco Cheung  
**Research date:** September 7, 2026  
**Scope:** Current first-party SWE and AI/ML hiring descriptions, selected source-level inspection of ShadeMapNav, and a proposed product/technical roadmap.

> **Recommendation:** Build a verified, adaptive outdoor planner: a time-dependent routing engine, an agent that creates and repairs executable itineraries, and either a real-world ML calibration layer or a genuinely offline neighborhood experience.

Do not try to make one repository demonstrate every technology in a job description. Make one distinctive promise, implement its difficult parts, and publish evidence that the implementation works.

## 1. Executive decision

I would position ShadeMapNav around this promise:

> **Tell it how you want to spend time outside. It finds a feasible plan around the sun, explains the tradeoffs, and adapts when the day changes.**

An illustrative future request is: "I have 90 minutes. Find coffee and somewhere shaded to read for 20 minutes, keep my estimated direct-sun exposure below eight minutes, and get me back before 5:30."

The interesting engineering is not the chat response. It is the system that must determine whether this request is feasible, represent the resulting plan, propagate time through movement and stops, explain uncertainty, and repair the plan when a cafe closes or the user leaves late.

My preferred combination is **Sun Budget + Living Itinerary + ShadeBench**. It creates one coherent product and gives you algorithmic, full-stack, applied-AI, testing, and operational stories. For a stronger ML-engineering emphasis, add a narrow **Reality Check** model trained and evaluated on independently observed shade. For a systems emphasis, add **City Capsules**, which make a neighborhood usable offline.

These are recommendations, not claims that the ideas are globally unique or guaranteed to improve hiring outcomes. The differentiation is their execution and the evidence behind them. A feature count or a Kubernetes badge is not the goal.

## 2. What the hiring evidence actually supports

### 2.1 Sample and limits

I reviewed retrievable first-party descriptions from large technology companies and product/AI startups. The sample deliberately mixes explicit new-graduate roles with advanced specialties, but **those groups are not interchangeable**. Senior and staff descriptions identify useful technical directions; they do not imply that a portfolio project substitutes for their experience requirements.

This is a purposive requirements sample, not a statistical census of vacancies, hiring growth, competition, salary, or hiring probability. Some Ashby descriptions were available through first-party search-indexed text while their interactive pages returned only a JavaScript shell. Their continuing application availability was not independently established. Most examples are US-oriented; the Google PhD example is London-based.

| Employer and example | Level / access qualification | Relevant evidence | Implication for this project |
|---|---|---|---|
| Amazon, SDE 2026 US | Explicit early-career cohort | Programming and algorithms; distributed/cloud systems, operations, testing, databases, and demonstrated projects. [Source: Amazon SDE posting](https://www.amazon.jobs/en/jobs/3177934/software-development-engineer-2026-us) | Show a correct algorithm, a working product, and measured reliability rather than a technology checklist. |
| Stripe, SWE New Grad | Explicit new graduate | Fundamentals, collaboration, written communication, independent learning, safe production changes, and critical review of AI-generated output. [Source: Stripe posting](https://stripe.com/careers/listing/software-engineer-new-grad/8128744) | Publish decisions, reproducible evidence, and examples of debugging or rejecting an incorrect implementation. |
| Ramp, University Grad Frontend | University graduate; indexed description | JavaScript/visual work, shipped product quality, translating ideas into products, and side-project/portfolio evidence. [Source: Ramp posting](https://jobs.ashbyhq.com/ramp/a1229aec-1105-4c47-8533-b912e732ed89?embed=js) | Finish a distinctive interaction and eliminate dead ends before expanding the stack. |
| Sierra, Agent SWE New Grad 2027 | Explicit new graduate; indexed description | Production agents, end-to-end systems, iteration, ambiguity, customer understanding, and ownership. [Source: Sierra posting](https://jobs.ashbyhq.com/Sierra/149f368c-52d5-408f-ba26-ad888f318a00?embed=js) | Build an agent whose completed actions can be verified and whose failure cases are tested. |
| Decagon, Senior SWE Agent Platform | Senior; indexed description | Agent runtime and orchestration, tool execution, evaluations, experimentation, correctness, latency, and observability. [Source: Decagon posting](https://jobs.ashbyhq.com/decagon/75f544ae-7838-4ffa-9e6b-33d7e2b6ea2b) | A verified planner with an evaluation harness is more aligned than an additional generic chatbot. |
| Anthropic, Research Engineer Model Evaluations | Not labeled new graduate | Python, dependable evaluation infrastructure, experiments, scoring, dashboards, and separating model failures from harness/data failures. [Source: Anthropic evaluation posting](https://job-boards.greenhouse.io/anthropic/jobs/5198255008) | Make evaluation infrastructure a first-class project component. |
| OpenAI, Full-Stack SWE Applied Foundations | Not labeled new graduate | End-to-end product work, resilient and secure systems, architecture, and adversarial defenses. [Source: OpenAI posting](https://openai.com/careers/full-stack-software-engineer-applied-foundations-san-francisco/) | Show that the attractive demo has real security and operational boundaries. |
| Planet, Senior ML Engineer | Senior; role-specific location/clearance requirements | Python, PyTorch/TF, geospatial data, model training, rigorous validation, deployment, monitoring, and failure analysis. [Source: Planet posting](https://job-boards.greenhouse.io/planetlabs/jobs/8142914) | A genuine geospatial learning problem offers a stronger MLE story than only calling an LLM API. |
| Anthropic, Staff+ Kubernetes Platform | Staff+; deep prior experience expected | Scheduler/controllers/control plane, distributed-systems reliability, operational ownership, and systems languages. [Source: Kubernetes platform posting](https://job-boards.greenhouse.io/anthropic/jobs/5211241008) | Deploying a web app to a cluster is not evidence of this level of infrastructure expertise. |
| Google, AI/ML PhD Early Career | Explicit PhD-oriented path | ML/research background and engineering foundations. [Source: Google description](https://www.google.com/about/careers/applications/jobs/results/92286686481785542-software-engineer-aiml-phd-early-career) | Do not confuse applied AI, general MLE, and research-oriented hiring paths. |

### 2.2 The useful interpretation

My synthesis is that there are three different portfolios you could build from this app.

**SWE:** A well-engineered product with an interesting algorithm, clear interfaces, reliable data and state handling, performance measurements, and thoughtful operations.

**Applied AI engineer:** Everything above, plus tool contracts, bounded agent execution, task-based evaluations, recovery, grounded outputs, and latency/cost tradeoffs.

**ML engineer:** Everything relevant above, plus a real dataset, train/validation/test discipline, statistical evaluation, modeling decisions, deployment, and monitoring. A model should be included because it solves a measured problem, not because the role title includes ML.

The portfolios overlap, but adding Kubernetes does not automatically strengthen the ML portion, and fine-tuning a model does not automatically strengthen product correctness. The job descriptions support these capability distinctions; the recommended project mapping is my interpretation.

## 3. What your current repository already demonstrates

This is a source-level review of selected retrievable `main` files. I did not run the application, execute its tests, conduct a penetration test, benchmark performance, or pin all reads to one immutable commit. Some requested raw files were unavailable. Findings below should be confirmed against the exact commit you next work on.

Your project is already more substantial than a thin maps wrapper. The inspected code includes a heap-based shortest-path implementation, Pareto route search, sidewalk-related modeling, geometry-based shade sampling with fallback paths, and a bounded agent/tool loop. [Sources: routing implementation](https://raw.githubusercontent.com/marcopolocheung/shademapnav/main/app/lib/routing.ts); [navigation orchestration](https://raw.githubusercontent.com/marcopolocheung/shademapnav/main/app/hooks/useNavigation.ts); [agent loop](https://raw.githubusercontent.com/marcopolocheung/shademapnav/main/app/lib/agent/agentLoop.ts).

The repository also includes testing/tooling configuration, a CI workflow, and routing instrumentation. The gap is not "add your first test" or "add your first metric"; it is turn those foundations into demonstrated correctness and reproducible results. [Sources: package configuration](https://raw.githubusercontent.com/marcopolocheung/shademapnav/main/package.json); [CI workflow](https://raw.githubusercontent.com/marcopolocheung/shademapnav/main/.github/workflows/ci.yml); [metrics implementation](https://raw.githubusercontent.com/marcopolocheung/shademapnav/main/app/lib/metrics.ts).

The inventory is slightly behind the inspected source: `api/agent.js` and `api/overpass.js` exist, so it is no longer accurate to describe the app as having only the Foursquare proxy. [Sources: agent proxy](https://raw.githubusercontent.com/marcopolocheung/shademapnav/main/api/agent.js); [Overpass proxy](https://raw.githubusercontent.com/marcopolocheung/shademapnav/main/api/overpass.js).

### 3.1 The most consequential gaps

| Observed source behavior | Why it matters | What I would change |
|---|---|---|
| Navigation samples the graph's edges at one selected `dateRef.current`. [Source](https://raw.githubusercontent.com/marcopolocheung/shademapnav/main/app/hooks/useNavigation.ts) | A long trip reaches different edges at different times. | Introduce traversal-time-aware exposure rather than treating the selected timestamp as the whole journey. |
| The Pareto formulation includes shaded distance as a maximized quantity. [Source](https://raw.githubusercontent.com/marcopolocheung/shademapnav/main/app/lib/routing.ts) | Accumulating more shaded meters can also accumulate more exposed meters. | Make exposure duration and explicit user constraints the main product objective. |
| `plan_shaded_route` starts a calculation and returns a "started" response; it does not await the resulting route. [Source](https://raw.githubusercontent.com/marcopolocheung/shademapnav/main/app/lib/agent/tools.ts) | Tool-call success is not plan success. | Return a job/route identifier and completed or failed result with metrics and provenance. |
| Source-confidence values are explicitly described in code as priors, not measurements. [Source](https://raw.githubusercontent.com/marcopolocheung/shademapnav/main/app/hooks/useNavigation.ts) | A plausible number is not empirical calibration. | Build an independent observation corpus and distinguish coverage, agreement, and real-world accuracy. |
| Timezone conversion uses longitude rounded to whole-hour offsets. [Source](https://raw.githubusercontent.com/marcopolocheung/shademapnav/main/app/lib/timezone.ts) | Civil time is not determined by longitude alone. | Resolve a geographic IANA zone and then use date-specific offset rules, including daylight saving. [Background: IANA](https://www.iana.org/time-zones) |
| The public Nominatim endpoint is used behind an in-browser queue. [Source](https://raw.githubusercontent.com/marcopolocheung/shademapnav/main/app/lib/nominatim.ts) | A browser-local queue cannot enforce an application-wide quota; the public service also prohibits client autocomplete. | Use explicit submitted search or a provider/self-hosted service permitting autocomplete; add a shared gateway/cache as appropriate. [Policy](https://operations.osmfoundation.org/policies/nominatim/) |
| The agent proxy already has useful restrictions, but its per-IP limiter is an in-memory map. [Source](https://raw.githubusercontent.com/marcopolocheung/shademapnav/main/api/agent.js) | A process-local limiter does not constitute a cross-instance budget. | Add durable/shared quotas, server-owned generation limits, cancellation, and cost accounting. |

There is an important correction to a first impression from repository guidance: **your current implementation is not exclusively a map-color sampler.** The newer navigation code uses a geometry field and falls back to pixels when needed. Extend and validate that architecture instead of rebuilding it under the assumption it does not exist. [Source: navigation implementation](https://raw.githubusercontent.com/marcopolocheung/shademapnav/main/app/hooks/useNavigation.ts).

The arithmetic behind the objective concern is simple. Route A has 1,000 meters total and 800 shaded: 200 exposed. Route B has 1,500 total and 1,000 shaded: 500 exposed. B contains more shaded distance but also more exposure. This is a constructed example, not a measured failure of your deployed app.

## 4. Flagship feature: Sun Budget

### The user experience

Move from "give me a shadier route" to:

> "Show me everywhere I can go with no more than eight estimated minutes in direct sun, including the trip back."

Let the map show a reachable region under a time and exposure budget. Add an optional stop, dwell time, return deadline, and travel mode. The user can change a budget and see how their feasible options change.

This is more distinctive than another route card because the person does not need to know their destination first. It also reuses your existing departure-time work rather than pretending the app lacks it. [Existing hourly comparison implementation](https://raw.githubusercontent.com/marcopolocheung/shademapnav/main/app/lib/bestTime.ts).

### The engineering problem

For a first approximation, evaluate each small route segment at its expected traversal time:

```text
estimated exposure seconds =
    sum(segment duration * unshaded fraction during traversal)
  + exposed waiting time
  + exposed destination dwell time
```

This formula is a proposed discretized model. It is not a claim to compute physiological heat exposure. Sampling resolution, speed assumptions, geometry, and weather limitations must be explicit.

The routing state now depends on time and accumulated exposure, not just position. A more ambitious version also includes required stops, maximum continuous exposed stretch, slope, surface suitability, or access constraints. Add these deliberately; each expands the state space.

### A bounded implementation

Start with a single neighborhood graph. Retain your TypeScript implementation and run expensive work away from the UI thread. Use a small time-expanded reference model or enumeration on toy graphs as the correctness oracle. For the interactive implementation, investigate bounded label search and time-bucketed shade queries.

Store exposure information against versioned geometry and time. Do not serve a value computed for a different geometry snapshot or time bucket merely because the coordinates match.

Treat waiting as an explicit action and account for its exposure. Do not assume that an earlier arrival always dominates a later arrival: the necessary waiting may itself violate exposure or access constraints. Any pruning rule should be demonstrated valid for the chosen state and waiting model.

Distinguish an exact result on a discretized model, a bounded approximation, and a search that simply ran out of budget. A capped search returning no candidate has not proved that the request is impossible.

### What to demonstrate

Use one reproducible fixture where the currently shadiest path becomes less attractive by the time the walker reaches it. Compare the existing static method with the new method. Publish constraint violations, approximation gap on small exact fixtures, runtime distribution, memory, and cache behavior.

Add property tests: widening an exposure budget must not remove a previously feasible path in an exact fixed model; map zoom and color styling must not change geometry-based exposure; a start time must propagate through every leg and stop.

**Why this helps a portfolio:** it produces a concrete algorithms and performance story with a visible product payoff. The interview discussion can cover state representation, dominance, discretization, numerical error, cache invalidation, and the limits of an optimization claim.

## 5. Flagship feature: Living Itinerary

### The user experience

The agent constructs a real, inspectable plan and keeps it consistent with the application:

> "Make a shady afternoon with coffee and a sunset stop."
>
> "Actually, I am leaving 20 minutes late."
>
> "Keep the sunset, replace the cafe with somewhere free, and avoid the steep hill."

The map and timeline update as one plan. The user can see which parts changed, which were preserved, why a constraint was relaxed, and what is still unknown.

### Treat the agent as a plan compiler

My proposed architecture is:

```text
User request
  -> typed intent and constraints
  -> candidate places and verified facts
  -> deterministic routing/scheduling tools
  -> independent plan validator
  -> versioned plan commit
  -> grounded explanation and navigation
  -> event-triggered revalidation or repair
```

The language model interprets ambiguity and explains tradeoffs. The routing engine handles geometry and connectivity. A deterministic validator checks time ordering, budget, stop accessibility evidence, and map/result agreement.

A plan is a data object, not a paragraph. Include origin, mode, start instant and timezone, stops, arrival/departure windows, dwell durations, selected route legs, predicted exposure, data provenance, uncertainties, expiration conditions, and a version identifier.

Do not call a probabilistic learned shade value "verified truth." Verification means consistency with explicit constraints and available evidence; physical accuracy remains a separate evaluation.

### Fix the tool boundary before adding tools

Your route tool currently returns after triggering calculation. [Source: tool executor](https://raw.githubusercontent.com/marcopolocheung/shademapnav/main/app/lib/agent/tools.ts). Replace that boundary with a request/result contract such as:

```ts
// Illustrative interface, not a patch for the current repository.
type PlanJob = {
  requestId: string;
  inputVersion: number;
  status: 'queued' | 'running' | 'completed' | 'partial'
        | 'no_plan_found' | 'cancelled' | 'error';
  planId?: string;
  validation?: {
    checkedConstraints: string[];
    violations: string[];
    unknowns: string[];
  };
};
```

Add a promise or job-status channel, not a longer arbitrary delay. Ensure an old calculation cannot overwrite a newer plan. Bind mutation requests to an expected plan version and an idempotency key. Show cancellation and provider failures as actual states, not an endlessly spinning tool row.

For dynamic repair, preserve unaffected stops and update only the necessary parts when possible. A useful quality metric is how much the itinerary changes in addition to whether the repaired plan is valid.

### Agent architecture: restraint is a strength

Start with one bounded orchestrator and deterministic tools. Parallelize genuinely independent place lookups when useful. Add multiple agents only after a controlled comparison shows better quality or lower latency at an acceptable cost. Anthropic's guidance distinguishes predictable workflows from more autonomous agents and advocates starting with simpler designs. [Source: Building effective agents](https://www.anthropic.com/engineering/building-effective-agents).

A persistence framework can help with checkpoints and resumability. LangGraph documents those capabilities, but using it does not by itself make your side effects idempotent or your plans correct. [Source: persistence documentation](https://docs.langchain.com/oss/python/langgraph/persistence). A small explicit state machine may be the better initial fit with your existing frontend architecture.

### ShadeBench: the part that makes the AI work credible

Create a public benchmark of **roughly 50-100 initial hand-authored tasks**, then grow it using actual failures. That is a proposed starting size, not a statistical guarantee.

Evaluate the final plan and application state, not whether the transcript sounded helpful. Anthropic's agent-evaluation guidance makes the distinction between a successful claim and a successful outcome especially relevant. [Source: agent evaluations](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents).

Include ordinary tasks and adversarial/error cases: ambiguous location, denied GPS, missing geometry, disconnected streets, deadline impossible in a known toy graph, daylight-saving transition, closed venue, stale hours, tool timeout, duplicate execution, cancellation, malicious place descriptions, and a user who changes requirements mid-plan.

Use code graders for spatial, temporal, budget, and state consistency. Use human review or a carefully validated model rubric for subjective qualities such as pleasantness. Do not let one unvalidated LLM judge grade every property.

Repeat nondeterministic tasks. Separate development scenarios from held-out scenarios and location/time combinations. Record model identifier, prompt and tool-schema versions, data snapshot, token settings, and every failure. Compare the current assistant, a typed planner with validation, and any proposed multi-agent variant.

Report valid completed-plan rate, hard-constraint violations, unsupported factual claims, recovery rate, map/plan agreement, p50/p95 end-to-end latency, and cost per successful task. Include partial outcomes and unknowns instead of hiding them in a headline success number.

**Why this helps a portfolio:** it demonstrates applied AI as dependable software, with a runtime, contracts, testing, failure diagnosis, and measurable iteration. Those capabilities map directly to the sampled agent-platform and evaluation descriptions; it is not necessary to claim frontier-model research.

## 6. ML specialization: Reality Check

### The product hook

> "The map says this sidewalk should be shaded. Reality disagrees. Help it learn."

A user can flag a missing tree canopy, awning, changed building, or incorrectly predicted shade. The app identifies uncertain areas and can explain why a recommendation is less confident.

This is the most convincing direction for a genuine ML component because it creates an independent target: observed outdoor conditions rather than another model's text.

### Define the target carefully

Begin with a narrowly defined label, such as whether a specific pedestrian location is blocked from direct sunlight at a recorded instant under known observation conditions. Do not conflate cloud cover, darker camera exposure, and a building shadow.

Record timestamp, position, reported positional accuracy, viewing direction when relevant, observation method, local conditions, source/version metadata, and annotation confidence. Images near a shadow boundary may not reliably locate the observer. A crowd tap is useful evidence, not unquestionable ground truth.

Use your own collected observations, consented contributions, or appropriately licensed imagery and municipal data. Do not assume that images available to browse can also be scraped or redistributed for training.

### Model ladder

**Baseline:** the current geometry engine, with missing-data and coverage flags.

**Simple learned correction:** logistic regression or gradient-boosted trees predicting observed shade or geometry-error risk from geometry confidence, solar position, street orientation, available canopy features, and observation conditions.

**Vision extension:** when the data justifies it, train or fine-tune a segmentation model for canopy or relevant occluders, then incorporate the extracted geometry into the physical model. Evaluate the added component independently.

**Optional optimization research:** train a fast surrogate of an expensive geometry calculation. Compare speed and decision agreement, but do not confuse agreement with the teacher model with accuracy in the real world.

There is a useful data-source trap: USGS distinguishes point clouds containing structures/vegetation from bare-earth elevation products that remove them. A terrain DEM alone is not a building-and-tree shadow model. [Source: USGS lidar guidance](https://www.usgs.gov/faqs/what-lidar-data-and-where-can-i-download-it).

### Evaluation discipline

Split by geography and time, not random adjacent images from one walk. Keep streets, buildings, or neighborhoods separated where appropriate and hold out different dates. Fit calibration separately from model training and reserve an untouched final test set.

Measure false-shade predictions, observation-level accuracy, exposure-time error over routes, and changes in route decisions. Show results by coverage, geometry source, canopy presence, solar angle, and location type.

For probabilistic outputs, use reliability diagrams and proper scoring rules. A lower Brier score alone does not establish better calibration; it also reflects discrimination and other components. [Source: scikit-learn calibration documentation](https://scikit-learn.org/stable/modules/calibration.html).

Use active learning to ask for observations where uncertainty and expected routing impact are both high. Start with a manually inspected pilot neighborhood; expanding coverage is a separate milestone.

Maintain a dataset card, model card, labeling guide, reproducible training configuration, data/model versions, and a rollback route to the geometry baseline. Report failures and negative results. An honest finding that the learned layer does not improve held-out performance is more informative than a misleading accuracy number.

### Privacy and product boundary

Make contributions opt-in. Minimize raw location history, avoid publishing individual tracks, remove unnecessary identifiers, and handle faces or license plates in retained photographs. Allow deletion and document retention. Do not collect medical information to make this feature work.

**Why this helps a portfolio:** data quality, experimental design, spatial generalization, modeling, calibration, model serving, and monitoring become visible. These are meaningful parallels with the sampled geospatial MLE requirements, not a claim to satisfy a senior role's experience or clearance conditions.

## 7. Systems specialization: City Capsules

### The product hook

> "Download this neighborhood. Keep planning and navigating when the connection disappears."

A capsule contains a versioned local graph, the geometry or exposure representation needed by the planner, selected place/access data, and permitted map assets. Offline availability should be explicit: downloadable graph coverage is not the same thing as having a PWA installation manifest.

### Implementation proposal

Keep the existing React/MapLibre interface. Put the routing/shade computation behind a worker boundary. Use browser storage for local snapshots and an atomic manifest swap so a half-downloaded update cannot replace a working capsule.

Store checksums and version identifiers; validate integrity on install. Support an interrupted download, stale-data warnings, storage eviction, and recovery after restart. Declare which features require network access, including uncached assistant inference and live transit or weather.

PMTiles can be useful for tile archives served through range requests. It is not itself a routing graph or a complete offline caching policy. [Source: PMTiles documentation](https://docs.protomaps.com/pmtiles/). Offline redistribution and provider terms must be checked for the assets you actually package.

Profile the TypeScript worker first. Port a demonstrably expensive geometry or routing kernel to Rust/WASM only when a controlled comparison justifies the complexity. Preserve a reference implementation and test numerical/result parity across runtimes.

### What to demonstrate

On an actual documented device, install a capsule, disable networking, calculate a route, change departure time, restart, and resume. Publish memory, package size, cold and warm latency, route agreement, and limitations. If measuring energy, describe the method and noise rather than presenting a guessed battery-saving percentage.

**Why this helps a portfolio:** it gives a memorable demonstration of fault tolerance, data versioning, storage, performance, and cross-runtime engineering without requiring fake production scale.

## 8. Playful features that reuse the same foundation

These are optional product experiments, not extra systems to build simultaneously.

### Golden-Hour Rendezvous

Two or more people ask to meet somewhere pleasant at a particular time. Choose the place and departure times while balancing each person's exposure and travel burden. An objective that minimizes the worst individual burden may be fairer than minimizing the average, but expose the tradeoff rather than pretending there is one universal definition of fairness.

Show an exact viewpoint, a real appropriately licensed reference photo, expected solar position, access information, and a return route. A generated sunset illustration is not evidence of future weather or a guaranteed view. Group origins should not be revealed to other participants by default.

### Shadow Chase

A short self-guided outing asks the user to remain in shade while visiting a few interesting locations. The time-aware planner changes the recommended order as the sun moves. Keep this within lawful paths and do not reward unsafe crossings, speed, or ignoring real conditions. A playful challenge can sit on top of the same verified plan object.

### The Shadow Lab

Let someone place a hypothetical canopy or tree-sized occluder and see how the model's routes and exposure change. This creates an immediately visible graphics/geometry demonstration and a counterfactual planning tool. Label the geometry assumptions; a simple projected shadow is not a validated vegetation-cooling or urban-climate model.

### Find the Light

Extend preferences from avoiding sun to seeking it at selected stops: sunny breakfast, shaded reading, sunset viewpoint. The advantage is one time-space planning model serving different preferences, rather than an unrelated recommendation engine for each theme.

My ranking for your stated goal is Sun Budget and Living Itinerary first; Reality Check or City Capsules next; one playful interaction after that. Novelty should make the strong engineering legible, not conceal a brittle core.

## 9. A stack with a reason for every component

### Default architecture

```text
React / MapLibre application
  |-- existing visualization and interaction
  |-- worker: routing, geometry queries, local capsule access
  |-- plan timeline and versioned application state
  |
Application API / agent gateway
  |-- typed inputs, quotas, provenance, cancellation
  |-- plan orchestration and deterministic validation
  |-- provider adapters and completed-result contracts
  |
PostgreSQL + PostGIS
  |-- places and access evidence
  |-- graph/geometry snapshot metadata
  |-- plans, plan revisions, jobs, observation metadata
  |
Object storage
  |-- immutable geometry/graph/capsule snapshots
  |-- permitted imagery and versioned model artifacts
  |
Optional workers
  |-- city preprocessing
  |-- model training/inference
  |-- offline agent and routing evaluations
```

Keep one modular application backend initially. Reuse TypeScript domain code rather than rewriting it solely to add a language. Add a Python worker where the ML/data tooling materially benefits you. Avoid splitting every box into a separate deployed service.

PostGIS is a natural candidate for spatial filtering and joins; its indexed operations use spatial bounds followed by appropriate geometric checks. [Source: PostGIS indexing](https://postgis.net/workshops/postgis-intro/indexing.html). Design queries and inspect their plans before introducing another database.

### Technology decisions

| Technology | My recommendation | What would justify it | Evidence worth showing |
|---|---|---|---|
| React / TypeScript / MapLibre | Keep | Already central to the experience. | Responsive controls, accessible workflows, state correctness, profiled rendering. |
| PostgreSQL / PostGIS | Strong next backend choice | Persisted plans, observations, places, geometry metadata, spatial queries. | Schema, indexes, query plans, consistency and migration tests. |
| Python + scikit-learn / PyTorch | Add for Reality Check, not decoration | Baseline modeling and then image/occluder learning when data supports it. | Held-out comparisons, training reproducibility, deployment and rollback. |
| Agent framework | Optional | Checkpointing or graph orchestration that reduces real complexity. | Recovery and evaluation improvement versus the simpler implementation. |
| Redis or a queue | Conditional | Shared quotas, caching, or asynchronous workload contention. | Correct behavior under duplicate delivery, retries, and overload. |
| Rust / WASM | Profile first | A compute kernel limits the actual client experience. | Equivalent results and measured end-to-end improvement on documented hardware. |
| Docker | Useful for reproducibility | Backend/worker dependencies or an evaluation environment. | A clean reproducible startup and test workflow. |
| Kubernetes | Optional infrastructure specialization | Heterogeneous, bursty workers, controlled failure/recovery experiments. | Resource isolation, backpressure, autoscaling, idempotency, rollout/rollback and runbooks. |
| Spark + Apache Sedona | Later, offline data track | A measured multi-city spatial preprocessing workload that strains a simpler approach. | Comparison against single-machine processing; partition skew and join correctness. |
| Vector database / RAG | Only for a defined retrieval problem | Semantic place descriptions after geography, hours, access, and budget constraints. | Retrieval improvement on labeled queries, not merely an embeddings integration. |
| Kafka / service mesh / many microservices | Not the default | A separately demonstrated event-distribution or operational requirement. | A real advantage large enough to offset added failure modes and maintenance. |

### A legitimate Kubernetes project

Have a queue of independently reproducible shade-tile, capsule-build, or evaluation jobs. Containerize workers and test resource limits, interrupted work, duplicate delivery, and safe retry. Expose queue backlog and execution latency, then scale workers under controlled load. Kubernetes documents resource and custom-metric autoscaling, but the metric, stability, and correctness of the surrounding system remain your responsibility. [Source: HPA documentation](https://kubernetes.io/docs/concepts/workloads/autoscaling/horizontal-pod-autoscale/).

A local cluster or small temporary environment is sufficient to demonstrate the mechanism honestly. State that the workload is synthetic. Do not equate a load test with real user adoption or claim to operate infrastructure at the scale of a staff job posting.

### A legitimate Spark project

Build an offline spatial pipeline: regional street/building/canopy inputs, bounded spatial partitions, geometry validation, joins, time-bucket processing, and immutable outputs. Apache Sedona supports distributed spatial-join approaches, making it more suitable than pretending ordinary tabular joins solve every geospatial issue. [Source: Sedona spatial joins](https://sedona.apache.org/latest/tutorial/concepts/spatial-joins/).

Account for partition boundaries: a tall building outside a tile can cast shade into it. Choose a justified halo or query extent and test it at low solar angles. Define polar/night/low-sun behavior and resource limits rather than allowing unbounded extents.

Benchmark a simpler single-machine baseline first. If it wins at your actual workload, use it in the product and retain the distributed experiment as a clearly labeled engineering study. Do not put Spark into the request path simply to list it on a resume.

## 10. Traffic, security, and cost are useful technical depth now

A free consumer app should have a bounded operating cost. I would prefer no-LLM navigation by default, explicit assistant actions, cached/reused deterministic results, and a hard agent budget per task. Run long evaluations or preprocessing separately from interactive traffic.

Your production agent proxy already keeps the provider credential server-side and uses a model allowlist. The next work is shared quota enforcement, server-owned output limits, validated tool inputs, timeouts, cancellation, request sizing, and cost per successful task. [Source: existing proxy](https://raw.githubusercontent.com/marcopolocheung/shademapnav/main/api/agent.js).

Treat external place descriptions, reviews, and future image text as untrusted data. Prompt injection is a documented risk for LLM applications; instructions embedded in retrieved content must not gain tool authority. [Source: OWASP prompt injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/). Enforce destination and action permissions in application code, not merely in the system prompt. Any later server-side URL-fetching tool also needs its own network/access restrictions.

Prefer coarse or redacted location fields in traces, and avoid logging full private itineraries or raw chat by default. Sharing a route should intentionally reveal the selected information; it should not silently publish a user's broader history.

Rate-limit and load-test your own service or fixtures. Do not direct synthetic traffic at public Overpass, Nominatim, or other shared providers. Public Nominatim's limit is application-wide, and switching to a shared proxy alone does not make prohibited autocomplete permitted. [Source: usage policy](https://operations.osmfoundation.org/policies/nominatim/).

## 11. The evidence package: make the hard work inspectable

### Separate the evaluation layers

| Layer | Ground truth or oracle | Recommended measures | Failure to avoid |
|---|---|---|---|
| Geometry | Synthetic analytic fixtures and independent sampled observations | Intersection errors, false shade, uncertainty by source | Testing a renderer against the same geometry and calling agreement physical accuracy. |
| Routing | Tiny exact/discretized fixtures; independently checked constraints | Exposure/time tradeoffs, violation counts, approximation gap | Calling a bounded heuristic globally optimal. |
| Agent | Final application state plus task-specific graders | Valid completed plans, groundedness, recovery, consistency | Counting tool invocation or fluent prose as success. |
| ML | Held-out geographic and temporal observations | Prediction error, reliability, false shade, decision impact | Random-frame leakage and tuning on the test set. |
| Systems | Documented hardware, snapshots, controlled workloads | Latency percentiles, memory, throughput, failures, recovery, spend | Publishing a best-case warm-cache number as typical performance. |
| Product | Consented real task observation | Completed useful outings, repeat use, reasons for rejection | Treating benchmark success or page views as proof of product-market fit. |

Publish the experiment configuration, sample count, missing data, and uncertainty. Group repeat measurements appropriately: many adjacent samples from one walk do not become many independent walks.

A cost/quality comparison might compare the current agent, the typed-and-validated agent, a smaller-model configuration, and a multi-agent experiment. Change one major component at a time where feasible and keep the same held-out tasks and data snapshots. Stop adding complexity when the simpler variant wins.

### Portfolio presentation

The inspected README is brief and primarily describes setup and project identity. [Source: README](https://raw.githubusercontent.com/marcopolocheung/shademapnav/main/README.md). I would turn it into the human-facing entry point while keeping agent instructions in their appropriate files.

Lead with one animated or recorded working example, the product promise, a deployment link, and an honest supported-area statement. Then show architecture, one significant technical decision, reproducible benchmarks, the evaluation dashboard, and limitations. Link to two or three deeper design notes rather than burying the reader in framework names.

A strong demonstration sequence is: enter an exposure-budget request; inspect the proposed itinerary; introduce a late departure or closed stop; show the verified repair; open the corresponding evaluation trace. For the systems track, substitute a real offline transition. Record only implemented capabilities.

Show ownership through decisions: a misleading objective you corrected, a failing test you added, a performance bottleneck you measured, or a model you rejected because it did not generalize. Stripe explicitly asks for judgment when reviewing AI output; this is an opportunity to make that skill visible rather than hiding your use of coding tools. [Source: Stripe requirements](https://stripe.com/careers/listing/software-engineer-new-grad/8128744).

### Resume statements to earn, not fabricate

These are templates to fill only after measurement:

- "Built a time-dependent pedestrian planner with exposure and arrival constraints; reduced [defined error] by [measured result] versus a static baseline on [versioned test set]."
- "Developed a tool-using itinerary agent with deterministic validation and recovery; improved valid-plan rate from [A] to [B] across [N] held-out tasks at [cost] per successful task."
- "Trained and calibrated a geospatial shade-correction model with neighborhood/date holdouts; measured [prediction metric] and [route-level impact], with versioned deployment and rollback."
- "Implemented offline neighborhood routing with atomic snapshot updates; achieved [documented latency and size] and verified online/offline result parity on [devices/fixtures]."

Do not replace missing metrics with optimistic estimates. A smaller, auditable result is preferable.

## 12. Build sequence and stopping rules

**Milestone 0 - Establish a trustworthy baseline.** Pin a commit; run the existing checks; document supported coverage; confirm the source findings; fix time interpretation and provider-policy issues; finish or remove visible placeholder actions. Capture representative route/agent failures. No new framework is required.

**Milestone 1 - Sun Budget in a bounded area.** Implement traversal-time exposure and a constraint-aware planner against a tiny exact oracle. Demonstrate an actual decision improvement over the static baseline. Keep the approximation and unknown-data behavior visible.

**Milestone 2 - Living Itinerary and ShadeBench.** Introduce typed plan/jobs, completed-result tools, plan revisions, validation, cancellation, and a first held-out benchmark. Make one impressive repair scenario work end to end.

**Milestone 3 - Choose one specialization.** For applied AI, deepen recovery/evaluation/cost optimization. For MLE, build Reality Check and its observation dataset. For systems, implement City Capsules and a measured performance or worker-orchestration study. Do not begin all three simultaneously.

**Milestone 4 - Publish the engineering case study.** Make the demo reproducible, document rejected alternatives, publish benchmark versions and limitations, and rewrite the README around the product and evidence.

Stop or redirect an experiment when it adds maintenance without improving an agreed outcome, when the data cannot support the claim, or when a simpler baseline is better. A useful technical report can explain why you chose not to deploy Spark, Rust, a learned model, or multiple agents.

## 13. Final recommendation

For your combined SWE and AI/ML goal, I would choose:

> **Sun Budget + Living Itinerary + a public evaluation suite, followed by a small real-world shade-learning pilot.**

This preserves the distinctive sun/time identity while adding algorithms, typed state, spatial data, agent reliability, experimentation, and genuine ML work. It gives you several interesting interview conversations that are all about the same product.

Kubernetes, Spark, and a more elaborate data platform are valid alternative specializations when backed by a real workload, but they should not delay the central experience. The strongest story is not "I used all the tools." It is "I made an unusual system work, identified where it failed, and can demonstrate why the next version is better."

---

### Research and verification notes

All sources were retrieved for this research on September 7, 2026. Publication dates are identified where available; job pages generally do not provide a dependable publication date. The source links above are primary employer descriptions, project source, or first-party technical documentation. Jobs may close or change after retrieval; the sample is not a recommendation that every listed role matches your experience, location, education, or work authorization.

Repository inspection was selective, source-level, and not pinned to a single commit. Documentation and code had some disagreements; conclusions prioritize the inspected implementation and acknowledge that limitation. I did not execute tests, verify production behavior, measure traffic, assess real-world shade accuracy, or complete a comprehensive security review. Source-access gaps were not filled with invented implementation details.

All proposed features, architectural choices, sample benchmark sizes, acceptance criteria, and illustrative requests are recommendations. No performance improvements, model accuracy, user adoption, hiring outcomes, or global product novelty are claimed as established results.
