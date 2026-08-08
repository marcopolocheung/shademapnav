# ShadeMapNav Growth Roadmap — Getting and Keeping Users

*Product-focused companion to `PROJECT_REVIEW.md` (which covers engineering health). This
document answers one question: what would make people **find** ShadeMapNav, **succeed
with it in the first two minutes**, and **come back**? Written 2026-07-05.*

ShadeMapNav is a personal open-source shaded-route navigation project. It is an independent
personal project and is not affiliated with ShadeMap.app.

The core insight driving everything below: this app's value proposition — "walk in the shade
on a hot day" — is **seasonal, local, and urgent**. People search for it mid-heatwave, on
their phone, standing outside. Every feature should be judged against that user.

---

## Who the users actually are

Ranked by likely volume and retention potential:

1. **Hot-city pedestrians & commuters** (Phoenix, Madrid, Seville, Athens, Singapore, Tokyo,
   Tel Aviv) — the daily-use case. They want one thing: "shadiest way to the station at 5pm."
2. **Runners / dog walkers / stroller parents** — recurring, time-flexible ("when should I
   go?" as much as "which way?"). The timeline slider is *made* for them; they don't know it.
3. **Sun-sensitive people** (photosensitizing medications, lupus, melanoma survivors) — small
   segment, extremely high retention, and they evangelize in communities/forums.
4. **Photographers & picnickers** — "where is golden-hour light / afternoon shade in this
   park?" One-off but highly shareable use.
5. **Urbanists, planners, café owners** — the sun-exposure accumulation + GeoTIFF export is a
   niche pro tool. Low volume, but they publish screenshots, which is free acquisition.

---

## Part 1 — Fix the leaky bucket first (retention killers already in the product)

New users churn on broken promises faster than they churn on missing features. These are
ordered by how directly they break the promise the UI makes.

### 1.1 The AI assistant narrates trips it never plots ⚠️ ship-blocker
`userTODO.md` #1 / `PROJECT_REVIEW.md` §1. The assistant confidently describes an itinerary,
teleports the camera around, and leaves the map empty. For a new user this doesn't read as
"buggy feature," it reads as "this app lies." Either enforce plot-before-answer in code (the
loop already holds the coordinates) or **hide the assistant behind a "beta" toggle until it
does**. A feature that demos badly is negative marketing.

### 1.2 Route calculation timeout kills exactly the impressive routes
`userTODO.md` #2. The ~5s budget means long/multi-stop journeys — the screenshots people
would share — fail silently-ish. Fixes, cheapest first: (a) show progress + partial results
instead of a cliff timeout; (b) compute per-leg and stream legs onto the map as they finish
(each leg is an independent Pareto search — this also parallelizes); (c) raise the budget
when the user explicitly asked for a long journey.

### 1.3 Multi-stop journeys
`useNavigation` already supports `additionalWaypoints`; neither the directions UI nor the
agent exposes it. "Errands loop in the shade" (pharmacy → grocery → home) is the everyday
power use-case. This is UI plumbing, not new capability.

### 1.4 Honesty about clouds — a trust feature, not a weather feature
The app renders razor-sharp shadows on a day that may be fully overcast. One experience of
"the app sent me the long way for shade that didn't exist" ends retention permanently. Pull
current + hourly cloud cover from a free API (e.g. Open-Meteo, no key needed) and:
- badge the timeline: "☁️ 90% cloud at this hour — shade routing matters less"
- optionally soften/desaturate shadow rendering under heavy cloud
This is cheap and it converts the app from "geometry demo" to "something I trust with my walk."

### 1.5 Trees
Buildings-only shadows systematically miss the single biggest shade source on many streets.
Full tree modeling is a research project, but a v1 is not: Overpass already serves
`natural=tree` and `landuse=forest`/`leaf_type` polygons, and the routing cost model can take
a flat "tree-lined street" bonus per edge without touching the WebGL renderer. Even a rough
canopy layer visibly improves route believability in exactly the cities (Madrid, Barcelona,
Paris) where the app should win.

---

## Part 2 — Activation: win the first two minutes

A heatwave user arrives on a phone with one question. Today they get a capable but
unexplained map-tool UI.

### 2.1 One-tap first success
On first visit: geolocate (with permission), drop the shadows at *now*, and surface a single
prompt — **"Where are you walking?"** — that goes straight into shade routing. Everything
else (timeline, accumulation mode, sketch, assistant) stays discoverable but out of the
critical path. Measure time-to-first-route; it should be under 30 seconds.

### 2.2 Make the shade legible
New users don't know that dark blue = shadow = the whole point. Add a dismissible one-line
legend ("blue = shade at 3:42pm — drag the timeline") the first time shadows render. The
timeline slider is the app's most magical interaction and currently has to be discovered.

### 2.3 Sell the route choice
The Pareto options (shortest / balanced / most-shaded) are the product's genuinely novel
output. Present them as a human tradeoff, prominently: **"+4 min, −62% sun exposure."**
That one sentence is the entire pitch of the app, and it's currently buried in route cards.
It's also the sentence users will screenshot.

### 2.4 Mobile is the product
The persona is outdoors on a phone. Audit and fix: touch targets on the timeline, bottom-sheet
ergonomics, initial JS payload on 4G (MapView is already code-split — good; keep the agent
code lazy too), and battery cost of the WebGL layer while navigating.

---

## Part 3 — Acquisition: make the app spread itself

Zero marketing budget means the product has to do the marketing.

### 3.1 Shareable state URLs (highest leverage single feature)
Encode `lat/lng/zoom/date/time` (and ideally waypoints) in the URL. Every "look at this
park at 6pm" conversation, Reddit thread, and group chat becomes an acquisition channel.
Without this, every share is a screenshot with no way in. With it, add OG-image meta so the
link unfurls with a shadow-map preview. This is days of work and it multiplies everything
else on this list.

### 3.2 Share cards for routes
After calculating a route: "Share" → image/link with the map, the route, and the tradeoff
line from §2.3 ("Saved 58% sun exposure on my walk to work"). `preserveDrawingBuffer` is
already true (invariant #3) — canvas capture is nearly free.

### 3.3 PWA install + offline shell
`Add to Home Screen` with a manifest and service worker turns a heatwave-week visitor into an
icon on their phone — the cheapest retention mechanism that exists. Cache the app shell and
last-viewed tiles; routing can stay online-only.

### 3.4 SEO landing pages for the searches people actually make
"shaded walking route <city>", "avoid sun walking <city>". A handful of static, pre-rendered
city pages (Madrid, Phoenix, Seville, Singapore…) each with a screenshot, a canned deep link
(§3.1), and two paragraphs. The SPA itself is invisible to these searches today.

### 3.5 Seasonal timing
Ship acquisition features **before** the northern-summer news cycle. Heatwaves are the growth
event; each one is a spike of exactly-right-intent traffic. Being listed in one "apps to
survive the heatwave" article is worth months of trickle.

---

## Part 4 — Retention: reasons to come back tomorrow

### 4.1 "Best time to go" — flip the question
The engine answers "which route at time T?" but can just as cheaply answer **"which T for my
route?"** — sweep the day at 30-min steps and show a mini exposure-by-hour chart: "your walk
is 70% shaded before 10am, 25% at 2pm." Runners and dog walkers will check this *daily*. The
accumulation renderer already does the underlying work; this is a UI over existing capability.

### 4.2 Saved places & routines that do something
Saved routes exist; make them live. "Home" + "Work" + a commute route unlocks: a returning
user lands on *their* answer instantly, and (post-PWA, with permission) a morning
notification — "today: shadiest commute window 8:10–8:40, UV high after 11" — which is the
strongest habit loop available to this product.

### 4.3 UV index + a sun-exposure number that means something
Convert "minutes in sun" to context: UV index (free APIs) and a rough burn-time estimate.
This is the feature the sun-sensitive segment (§ persona 3) needs, and it upgrades the route
tradeoff from geometry to health: "this route: ~12 min direct sun at UV 9."

### 4.4 Assistant, once fixed, as the retention closer
When §1.1–1.3 land, the day-planner assistant ("plan me a shaded afternoon: coffee, park,
dinner") is the feature nothing else on the market has. It should also stop hijacking the
camera during research (`PROJECT_REVIEW.md` §2) — a 10–15s teleporting map reads as broken to
every user who triggers it.

---

## Sequencing (what I would actually do, in order)

| # | Item | Why this order |
|---|------|----------------|
| 1 | Fix agent plotting, or gate agent as beta (§1.1) | Stops active trust damage |
| 2 | Shareable URLs + OG images (§3.1) | Multiplies every later win; small |
| 3 | Route-choice tradeoff line + first-run flow (§2.1–2.3) | Activation; mostly UI |
| 4 | Cloud-cover honesty badge (§1.4) | Trust; ~a day of work |
| 5 | Multi-stop UI + timeout streaming (§1.2–1.3) | Unlocks shareable "wow" routes |
| 6 | PWA + share cards (§3.2–3.3) | Converts the summer spike into installs |
| 7 | "Best time to go" chart (§4.1) | First true daily-habit feature |
| 8 | Tree canopy v1 in cost model (§1.5) | Accuracy moat; larger effort |
| 9 | Saved-route notifications, UV (§4.2–4.3) | Habit loop, needs PWA first |

**North-star metric suggestion:** weekly returning users who calculate ≥1 route. Supporting
metrics: time-to-first-route (activation), share-link opens (acquisition), saved-route
re-use (retention).

The one-sentence strategy: **fix what breaks the promise, make the shade tradeoff visible
and shareable, then give people a reason to check every morning.**
