# Beyond the Shadowed Route
## Consumer market research and product directions for Umbra

**Research date:** September 5, 2026  
**Prepared for:** Marco Cheung, builder of Umbra  
**Decision:** What should a free, consumer-oriented, sun-aware navigation app do next?

> **Recommendation:** Expand from finding a shadowed route to helping someone choose the best **way, place, and time to be outside**. Prioritize departure-time comparisons, short shadowed outings, and destinations that remain suitable during the visit. Treat transit as door-to-door exposure planning, not merely another transport button.

## 1. Executive answer

Your current feature list is not, by itself, evidence that the app is incomplete. A reliable utility that solves one recurring problem can be a complete product. Adding features because navigation, saved routes, and an agent sound like a short list risks making the product harder to use without increasing its value.

The more useful question is: **Which decisions does a person still have to make outside your app before they can confidently enjoy an outdoor trip?** Today your strongest stated capability answers "How do I get there with more shadow?" The adjacent decisions are "When should I leave?", "Where is worth going right now?", "Can I fit this into 30 minutes?", "Will it still be shadowed when I arrive?", and "What is my fallback when conditions change?"

There is real competition. Shadowmap is not exclusively a business product, and several newer products explicitly advertise consumer shadow routing. Generic conversational local planning is also part of Google Maps. Being free, consumer-oriented, or equipped with a chatbot is therefore not sufficient differentiation. [Shadowmap plans][shadowmap] [Shadehopper listing][shadehopper] [Google, August 2026][google]

My proposed product structure has three entry points, rather than a large menu of unrelated capabilities:

| Entry point | User's actual question | First useful result |
| --- | --- | --- |
| **Go somewhere** | How and when should I get to this destination? | A few route/departure choices with explicit time and exposure tradeoffs. |
| **Go outside** | What can I comfortably do with the time I have? | A short loop or small outing, with useful stops and a return plan. |
| **Find a good spot** | Where will the light and shadow suit what I want to do? | Specific destinations ranked for the arrival and dwell window. |

These are proposed directions, not a claim that the market has already validated this exact combination. The research supports important underlying needs, but it does not establish your product's retention, addressable market, or willingness to pay.

## 2. Scope and what was actually inspected

The research covers consumer navigation, direct shadow-routing tools, adjacent outdoor and sunlight-planning products, pedestrian behavior, cycling preferences, and implementation constraints. It takes an international view with English-language sources, including US and Singapore research. It is not a comprehensive census of every app store or every local-language competitor.

Your public repository was identifiable as `marcopolocheung/shademapnav`, and its deployed URL matches the app in your request. I reviewed its public growth and architecture documents. The growth roadmap explicitly describes itself as historical product thinking, not a current engineering task list. Some obvious suggestions already appear there; repeating them as newly discovered requirements would add little. [Project growth roadmap][repo-plan]

The live application did not expose a meaningful interface to the text-based research tools. This is **not a hands-on UX audit, route-quality benchmark, or source-code audit**. The architecture document references transit, while your request describes it as planned. I use your description as the authoritative account of the deployed product rather than treating documentation as proof that a feature has shipped. [Architecture documentation][repo-architecture]

Throughout this report, competitor descriptions mean **advertised or documented capability**, unless explicitly described as a research result. Product pages are evidence of what is being offered, not independent proof that it works well or that consumers regularly use it.

## 3. The current competitive landscape

### 3.1 Shadowmap is consumer-accessible, although professionals are prominent

Shadowmap currently has a free tier, an Explorer tier aimed at uses such as photography and outdoor planning, a Home tier, and a Studio tier for professionals. Its Sunny Seats offering also connects outdoor seating decisions with sun and shadow. Your impression of professional emphasis is understandable, but "they serve businesses, I serve regular people" is too sharp a distinction. [Pricing and audiences][shadowmap] [Sunny Seats][sunny-seats]

The strategic distinction to pursue is not access to a shadow visualization. It is **finishing a useful everyday decision with minimal effort**: the route, departure, exact destination, expected conditions during the visit, and fallback.

### 3.2 Direct and near-direct competitors

| Product | Verified public positioning or capability | Maturity or evidence caveat | Implication for Umbra |
| --- | --- | --- | --- |
| **Shadowmap** | Sunlight and shadow exploration, with consumer and professional plans. | Plans and marketing inspected; not a navigation benchmark. | A consumer-friendly map alone is not a unique proposition. |
| **ShadeMap.app** | Shadow exploration and GPX track replay. It is a separate project from Shadowmap and Umbra. | Replay is documented; the entire feature set was not audited. | Route inspection and solar visualization already have alternatives. [GPX replay][shademap] |
| **Shadehopper** | Direct, balanced and more shadow routes; multiple activities; loops; departure guidance; shadowed-side instructions and other outdoor context. | Google Play listing updated June 25, 2026. Advertised claims were not field-tested. | This is a close consumer comparator, not a professional-only tool. [Listing][shadehopper] |
| **Undercover, Singapore** | Shortest, most shadowed and balanced pedestrian routing. | Official February 3, 2026 project page labels it **Limited Release**. | Strong local data and useful pedestrian connections can matter as much as global coverage. [Official project][undercover] |
| **ASU Cool Routes** | Hourly weather plus surrounding geometry to model thermal exposure. | June 2026 report describes Tempe-campus coverage, research validation and scaling constraints. | A scientifically richer engine is possible, but it is not costless or automatically a scaled consumer service. [ASU report][asu] |
| **Cool Walk / ShadeWalk** | Web-based shadow-route tools; documented concepts include time-aware route progression or loop generation. | No independently established adoption or route-quality benchmark found. | Basic shadow routes and loops are becoming reproducible features. [Cool Walk][cool-walk] [ShadeWalk][shadewalk] |

### 3.3 Adjacent incumbents are important competitors too

Google's August 2026 Ask Maps update reinforces that conversational local discovery is already an incumbent capability. A generic "plan me a fun day" agent is therefore not a defensible category by itself. [Google update][google]

Citymapper explicitly markets its Walk Less option for situations including heat, humidity and rain. Komoot provides surface and elevation context in route planning. AllTrails offers forecast trail conditions, with some capabilities tied to paid tiers. These are precedents for context-sensitive navigation, not proof that any one product solves precise pedestrian shadow exposure. [Citymapper][citymapper] [Komoot][komoot] [AllTrails][alltrails]

PhotoPills already addresses location-and-time planning for sun and photographic opportunities. Your sunset idea is not unprecedented; the potential opportunity is making a useful experience easier for a casual visitor to discover and execute. [PhotoPills][photopills]

### 3.4 What this research can and cannot say about demand

The reviewed sources demonstrate active product development and a plausible consumer problem. They do **not** establish a mature, large standalone shadow-navigation market. Shadehopper's inspected Android listing displayed a **100+ download band**; that is a coarse single-store measure, not total users or active users. Undercover's official release label and ASU's campus scope also caution against equating promising prototypes with scaled adoption. [Shadehopper][shadehopper] [Undercover][undercover] [ASU][asu]

I did not find credible independent figures for this niche's market size, retention, or willingness to install another navigation app. Outdoor participation statistics should not be turned into a shadow-app market estimate. Nor does the presence of competitors prove that consumers need all of their advertised features.

**Strategic interpretation:** there is room to test a focused consumer experience, but the next milestone should be repeated successful use in a well-served area, not feature-count parity or a speculative global market forecast.

## 4. What people appear to want: evidence versus inference

### 4.1 A reasonable tradeoff, not maximum shadow at any cost

A Singapore field experiment analyzed 408 sun-condition choices from 46 participants. Its fitted average perceived cost of walking in sun was about 1.16 times the equivalent shadowed distance. That is evidence that shadow enters route choice, not a universal rule that everyone accepts a 16% detour. The setting, sample, and individual variation matter. [Melnikov et al., Scientific Reports, 2022][shadow-study]

**Product implication:** let people express a detour budget: "at most five extra minutes", "arrive by 2:00", or "reduce my longest exposed stretch". Show the actual compromise instead of treating a shadow percentage as an automatically superior route.

### 4.2 Help within real constraints, not an assumption of unlimited flexibility

An observational study in Pacoima, Los Angeles County, found that high-use pedestrian locations changed little between control and extreme-heat days, particularly on weekdays. The authors discuss constraints on changing routines and emphasize shadow provision where people already travel. This does not contradict a preference for shadow; a preference cannot create a useful alternate street or move a work shift. [Derakhshan et al., npj Natural Hazards, 2025][inflexibility]

**Product implication:** support both "I must go now" and "my time is flexible". A departure optimizer that always tells someone to wait until evening is not useful for a fixed appointment. Sometimes the honest answer is that no substantially better route was found.

### 4.3 Route suitability matters before a secondary optimization

PeopleForBikes' public summary of its 2024 participation study reports a 16,000-adult survey, 53% of riders worried about being hit by a car, and only 50% familiar with local bike lanes, paths and trails. This is cycling evidence, not a ranking of pedestrian priorities. [PeopleForBikes, April 2025][bicycling]

**Product implication:** for cycling, shadow should be optimized among acceptable routes, not purchased with an unacceptable traffic or surface tradeoff. An extra-shady route that sends a casual rider onto an unsuitable road is not a good recommendation.

### 4.4 People do not universally want more turn-by-turn machinery

A March 2026 PLOS ONE study found that 44% of its 222 survey respondents preferred route preview; the figure was 76% for familiar environments. A separate field study within the same paper compared navigation modes. These results support offering choice, not removing guidance for everyone. [Savino et al., PLOS ONE, 2026][preview]

The earlier 2025 Under Cover prototype also reported user-testing lessons around starting orientation and landmark photographs. That is useful qualitative evidence, but its reported satisfaction should not be generalized without a clear sample. [Under Cover 2025][undercover-2025]

**Product implication:** invest in a comprehensible preview, identifiable entrances, landmark confirmation and an easy overview. Not every walker needs a driving-style screen demanding constant attention.

### 4.5 The trip is more than the route line

An age-friendly neighborhood project reported the importance of seating, toilets, crossings and connectivity for older residents. It is localized evidence about a particular population, not a universal consumer feature survey. [Walk Wheel Cycle Trust][age-friendly]

**Product implication:** support practical stopping and recovery needs. A seat in shadow, usable toilet or open public indoor destination can make an outing feasible. The key is verifying availability, not scattering unqualified icons across the map.

### 4.6 How strong is the evidence for the proposed features?

| Proposed need | Evidence strength in this review | What remains unproven |
| --- | --- | --- |
| Shadow-versus-time choice | Direct behavioral evidence, with contextual limitations. | Your users' detour tolerance and repeat usage. |
| Mode-appropriate route suitability | Strong survey signal for cyclists; different evidence needed for other modes. | Which constraints dominate in your launch area. |
| Clear previews and landmarks | Direct navigation research and qualitative prototype testing. | Best interface for your particular app. |
| Useful rest and amenity stops | Population-specific community evidence. | Frequency of use across your intended audience. |
| Departure-window recommendations | A logical response to moving shadow; competitors advertise related features. | Whether it meaningfully changes users' decisions. |
| Timed destinations and short outings | Strong conceptual fit; some adjacent products demonstrate supply. | Incremental demand, retention and willingness to contribute data. |
| Sunset imagery and group rendezvous | Primarily product hypotheses in this report. | Whether users value them enough to justify complexity. |

## 5. The recommended product direction

**Proposed promise: "Find the best way, place, and time to be outside."**

That is broader than avoiding sunlight, but still constrained enough to guide product decisions. A feature belongs when its value materially depends on time, light, outdoor exposure, or completing the outdoor trip. A generic social feed, restaurant review clone, or broad travel concierge does not automatically belong.

I would start with people taking **repeatable short urban walks and casual outings** in a dense, well-mapped pilot area. Visitors are a useful secondary audience for discovery. Cycling and skating can become strong modes, but they should not be presented as equally supported before route suitability is genuinely different for each.

This is a recommended focus, not a demonstrated best market segment. Select a pilot on data quality, usable alternate routes, access to testers and recurring outdoor activity. The hottest location is not necessarily the best test location: extreme heat without safe route alternatives can leave little for software to optimize.

A three-part home screen could express the promise immediately: a destination box, a "30 minutes outside" action, and "Good spots now". The agent should be another way to invoke these capabilities, not a prerequisite for obtaining a useful result.

## 6. Priority one: "When should I leave?"

This is the closest expansion of your existing route engine. A static date/time slider makes the user conduct an experiment manually. A departure comparison turns that experiment into a decision.

**Example request:** "I need to arrive by 3:00. When can I leave with the least direct sun, without adding more than five minutes of walking?"

The response should compare candidate routes and departure windows together. For each viable option, show arrival time, walking time, estimated direct-sun minutes, the longest continuous exposed stretch, and a compact explanation of uncertainty.

**Illustrative interface data, not real route results:**

| Choice | Departure | Walking time | Estimated direct sun | Longest exposed stretch |
| --- | --- | --- | --- | --- |
| Leave now | 1:00 | 18 min | 9 min | 5 min |
| Better window | 1:30 | 19 min | 5 min | 2 min |
| More shadow, longer route | 1:30 | 22 min | 3 min | 1 min |

Do not optimize departures outside the user's allowed window. For a required arrival, show how much timing flexibility actually exists. For recurring trips, re-evaluate the route rather than presenting yesterday's shadow as today's truth.

**First build:** compare a bounded set of departure times over a short horizon on a few valid route candidates. Explain which option is best under the chosen constraints. This is more controlled than launching a global continuous-time route optimizer immediately.

**Important edge cases:** different walking speeds, waiting at crossings, route deviations, time zones, and long trips during which shadow changes. If the engine only re-ranks a few provider-generated alternatives, call the winner "most shadowed of these routes", not the globally most shadowed possible route.

**Success test:** users select a different departure or route because the comparison is understandable, and observed shadow broadly matches the prediction. A frequently opened time slider is not the same outcome.

Departure guidance is already advertised elsewhere. Its value here must come from trustworthy comparison and easy action, not an assertion that it is a novel invention. [Shadehopper][shadehopper]

## 7. Priority two: "I have 30 minutes. Take me somewhere pleasant."

This is a concrete evolution of your "fun day in the shadow" agent. It avoids requiring the person to invent a destination before the app becomes useful.

**Example request:** "Give me a 30-minute walk from here, mostly shadowed, with somewhere to refill water, and get me back before my next meeting."

The result should be a navigable loop or out-and-back with a realistic duration, not a list of attractive places. Offer a few interpretable variants: more shadow, simpler navigation, or a worthwhile stop. Account for dwell time separately from movement time.

A loop should avoid absurd zigzags, repeated road crossings, inaccessible gates, and routes that are technically circular but unpleasant. An out-and-back can be better than a forced loop. The return must be checked at its expected time, not assumed to share the outbound shadow.

**First build:** 20-, 30- and 45-minute options from the current location in the pilot area, plus one optional stop and a "shorten this" action. Use a small number of verified landmarks and amenities rather than a long generated itinerary.

**Mode variations:** a walking break, easy bike spin, stroller-friendly outing, or rolling route should change constraints, not merely speed. Avoid promising an accessibility category when the necessary path attributes are unknown.

**Success test:** users actually start and finish outings, return for another, and require few manual corrections. Test whether an attractive loop without an agent is sufficient; natural language should not hide an overly complicated interaction.

This is a retention hypothesis: recurring modest outings may create more repeat opportunities than an occasional full-day itinerary. It must be tested with your users, not assumed from general outdoor participation.

## 8. Priority three: "Where will it be good when I get there?"

This is the most distinctive expansion I would investigate. It changes the object being recommended from a route to a **place-time window**.

Examples include a bench that stays shadowed through lunch, a playground with usable shadow during a visit, a cafe terrace suited to a stated sun preference, or a viewpoint worth reaching before a particular light window. These are proposed use cases, not claims of verified local coverage.

The key calculation is not "Is the park shady now?" It is "Does the relevant part of the park meet the user's needs from arrival until departure?" A park centroid or business address is often the wrong geometric target for that calculation.

**Illustrative place card:**

> Riverside reading spot  
> Arrive around 4:15; modeled shadow at the mapped seating area through 5:00.  
> Nine-minute walk; approximately three minutes in direct sun.  
> Bench location verified recently. Tree-canopy prediction uncertain.  
> Return route recalculated for 5:00.

Every number above is an interface example, not a real recommendation.

### Minimum viable version

Curate roughly 20-50 specific locations in one area. This is a proposed scoping choice, not a market benchmark. Record the usable area or viewpoint, entrance, permitted access, activity suitability, known amenities, relevant hours, a real photograph where rights permit, and the date of verification.

Then rank only those places whose route and visit fit the user's window. Show a fallback when the best choice depends on uncertain canopy or conditions. Allow "prefer shadow", "prefer some sun", and "no preference" without making medical assumptions about the person.

### Why the time window matters

Your app can connect four things in one plan: the approach route, conditions at arrival, conditions during the stay, and the return. That is a coherent advantage to test even where another app can independently show a shadow map or recommend a cafe.

Shadowmap's Sunny Seats is evidence that time-sensitive outdoor seating is not an untouched idea. Your proposed differentiation is a broader, consumer-led trip experience, not exclusive ownership of sun-aware destination discovery. [Sunny Seats][sunny-seats]

### A useful extension: an exposure-budget search

Instead of "within one mile", offer "reachable with roughly five minutes or less in direct sun" or "a 30-minute outing with no long exposed stretch". This is a product hypothesis grounded in your engine's distinctive input. Label results as estimates and show when data are insufficient.

## 9. Transit: compare the entire exposed journey

Transit is a sensible extension, but it is not automatically the lowest-exposure option. A nearby stop with an uncovered wait and a difficult transfer can perform worse than a short shadowed walk. Treat in-vehicle shelter separately from air conditioning; neither shelter at a stop nor vehicle conditions should be assumed from the existence of a route.

Use this conceptual model:

**Outdoor exposure = access walk + platform/stop waiting + transfers + egress walk.**

The route with the least outdoor walking is not necessarily the route with the least direct-sun exposure. Citymapper's Walk Less demonstrates demand-oriented positioning around walking burden; your opportunity is to represent the particular exposure that remains. [Citymapper][citymapper]

**First build:** support shadow-aware walking to a selected station entrance or stop, useful departure timing, and shadow-aware egress. Handoff to an established transit planner can be appropriate while your app concentrates on the outdoor legs. Do not invent a seamless end-to-end itinerary when the transfer or service data are unavailable.

**Next build:** compare full itineraries in one city with usable static and realtime feeds. GTFS can represent station pathways, entrances and levels, and realtime trip updates can inform expected waits. Those specifications do not guarantee that a particular agency supplies complete data, and they do not automatically provide shelter geometry. [GTFS pathways][gtfs-pathways] [GTFS Realtime][gtfs-realtime]

**Useful details:** which entrance avoids an exposed plaza; whether a waiting area is known to be covered; whether a delayed bus changes the best choice; which transfer avoids an unnecessary outdoor leg; and an alternative that meets the user's step or walking constraints.

A delay should be able to change the recommendation. Otherwise "shadow-aware transit" is little more than a fixed station waypoint added to a pedestrian route.

## 10. Other feature directions, ranked rather than accumulated

| Direction | Why it fits | Smallest useful version | Recommendation |
| --- | --- | --- | --- |
| **Comfort stops and bailout** | Helps finish an outing when someone wants a seat, water, a toilet, an indoor break or a ride home. | A few verified, currently usable options along the route, with detour time. | Build early in the pilot; distinguish known availability from unknown. |
| **Saved trips that update** | Makes saved routes useful as time and season change. | Recalculate shadow and conditions when reopened; remember preferences rather than a stale score. | Build alongside departure comparison. |
| **Low-stress cycling and rollable paths** | Shadow only helps if the route suits the mode. | Conservative profiles, clear unknowns, and explicit surface/traffic constraints. | Foundational for modes you actively support. |
| **Landmark-based orientation** | Makes unusual pedestrian paths understandable. | Entrance and junction photos where licensed, plus an easily inspected route preview. | Build where pilot testing shows confusion. |
| **Meet somewhere fairly** | Combines sun exposure with a genuine group-planning decision. | Two starting locations, a few verified meeting spots, balanced arrival and exposure burdens. | Test after timed destinations work. |
| **Share a timed outing** | Lets a useful plan travel to a friend without requiring a social network. | Share place, date, departure, preferences and a recompute action. | Small adjacent feature; do not create a feed first. |
| **Winter sun preference** | Uses the same time-and-light foundation for a different preference. | Optional "prefer sun" setting, without health promises. | Good seasonality experiment, not a reason to dilute the initial focus. |
| **Rain-sheltered journeys** | Serves a related desire to avoid unpleasant outdoor exposure. | Verified roofed links and covered stops in a limited area. | Later; shadow coverage is not a rain-shelter dataset. |
| **Sunset and golden-hour discovery** | Creates a positive reason to use a sun-aware app, beyond avoiding discomfort. | Curated viewpoint, timing, real photo, route and return plan. | Test as one timed-destination category. |
| **Detailed photorealistic future imagery** | Potentially appealing demonstration. | Clearly labeled simulation, separate from actual place photographs. | Defer until users value the underlying recommendation. |

### The skating and boarding opportunity

OpenSkateMap is a useful product signal: it distinguishes pavement quality, including unknown quality, for skating. That indicates why a cycling route with a new icon is not enough for rolling users. It does not establish how large your reachable skating market would be. [OpenSkateMap][skate]

A deliberate rolling mode could consider surface quality, steps, curb transitions, slope, crossings and an achievable return. The hard part is trustworthy data. I would either make this a focused pilot with local riders or label it as limited support, rather than implying that ordinary bike routing is fully validated for boards.

### Do not turn accessibility into one vague toggle

Model the constraints separately: no steps, a slope limit, a required path width where known, maximum distance between rest opportunities, or a need for verified curb transitions. A stroller route, wheelchair route and skateboard route overlap in some needs but are not interchangeable. Missing attributes should remain visibly unknown.

## 11. Turn the agent into an executor of verified plans

The valuable agent is not the one that writes the most charming itinerary. It is the one that translates an intent into a plan that the app can actually execute, inspect and revise.

For a useful outing, each recommended stop should resolve to a concrete location or entrance, an arrival and dwell window, known access/hours, route legs, an exposure estimate with confidence, and an alternative. If the underlying tool cannot establish an important fact, the agent should say so rather than manufacture a plausible answer.

**High-value proposed commands:** "Make this shorter", "I am leaving 20 minutes late", "Swap the cafe for somewhere free", "Find a shadowed place for the next hour", "Get me home with less walking", and "Keep the sunset stop but remove the steep hill".

The route engine and place database should provide structured results; the model can interpret preferences, choose among allowed operations, and explain tradeoffs. It should not be the authority for path legality, exact shadow, weather, opening hours, or train departures.

If only a probabilistic guess is available, avoid language such as "the bench will definitely be shadowed". Prefer a clear modeled window and the reason for uncertainty. The same facts should be visible whether the user enters through buttons or chat.

### Your sunset-picture idea

The direction is worthwhile, but split three products that can otherwise get conflated:

**A real reference photograph** shows what a place looked like at a known time and viewpoint. **A solar-position visualization** shows a modeled direction or alignment. **A generated preview** imagines a scene. Only the first is a record of reality, and none alone is a guarantee of future clouds, colors or visibility.

Start with a real, appropriately licensed photograph and a simple directional/time overlay. Add the exact viewpoint, arrival lead time, access notes, expected return conditions and a fallback. PhotoPills is an established precedent for precise celestial planning; your goal can be a more casual discovery-and-navigation experience rather than recreating its full toolset. [PhotoPills][photopills]

Photorealistic generation should be labeled as an illustration, not shown as a forecast or as evidence that a particular viewpoint exists. For a beach, verify access and account for relevant local conditions before promising that someone can occupy the depicted spot.

## 12. Accuracy and trust are features

### Show exposure in understandable units

Shadow percentage alone can mislead when route durations differ. A 30-minute route that is 70% shadowed contains nine minutes outside shadow; a 20-minute route that is 60% shadowed contains eight. This is illustrative arithmetic, not field data. Total direct-sun minutes and the longest continuous exposed segment may communicate the decision better than a single percentage.

Treat direct-sun duration as an exposure estimate, not a clinical outcome. Do not call minutes avoided "heat illness prevented" or turn a geometric shadow map into a personalized safe-exposure calculator.

### Advance the sun along the trip

The relevant time for a segment is the estimated time the traveler reaches it. Recompute after a meaningful delay or deviation. For a stop, evaluate the dwell interval. For transit, include the wait. For a loop, include the return. A visually impressive shadow map at departure time is not equivalent to this calculation.

### Keep different kinds of evidence separate

Use distinct labels for modeled building shadow, modeled tree canopy, covered structures, observed conditions and unknown areas. A missing tree dataset does not mean the street is treeless, and an attractive render does not prove sidewalk-level precision.

If opposite-side guidance is offered, it should be tied to a navigable sidewalk and legal crossing. Do not instruct cyclists or pedestrians to switch sides whenever the rendered shadow does. GPS and map uncertainty should limit the precision of instructions.

### Do not equate shadow, coolness, UV protection and shelter

The National Weather Service explains that heat-index values are based on shady, light-wind conditions. Shadow therefore does not make the underlying heat risk disappear. WHO also states that shadow is incomplete UV protection. Roofed shelter, tree shadow and an air-conditioned indoor space are different categories. [NWS][nws] [WHO][who]

A more ambitious thermal model is possible: ASU's work models surrounding radiant conditions and validates predictions with field measurements. Its June 2026 report describes cooler alternatives for more than 70% of tested trips across 12 test days, not a universal reduction for every city or every user. Do not turn those research results into a performance claim for your app. [ASU][asu]

### Make uncertainty actionable

Useful labels include "building data available; canopy uncertain", "this water fountain has not been recently verified", and "no meaningfully alternative with more shadow found among the routes checked". Let people report wrong shadow, a closed gate, missing steps or a broken facility with minimal effort.

Store the time and relevant conditions of a report. "Sunny here" is not a permanent attribute. Community observations should improve a model or trigger verification, not overwrite the physical meaning of time-dependent shadow.

## 13. Free-to-use economics and practical architecture

Remaining free to users does not require every feature to be computed from scratch or handled by an LLM. I recommend a layered architecture: bounded route candidates, reusable sun/geometry calculations, a small verified place dataset, weather context, and an optional agent operating on the same structured services.

Cache geometry and reusable intermediate results where licenses permit. Recompute time-sensitive scores rather than storing an entire supposedly permanent "shady route". Limit the temporal horizon and geographic scope of expensive requests. Meter agent and image-generation costs separately from basic navigation.

Check provider rights before assuming that a public endpoint or free tier can serve a growing app. For example, Open-Meteo's hosted free service has noncommercial and request-limit conditions. An app being free to its users does not by itself determine whether its operator qualifies for that service tier. Service terms and underlying data licenses are different questions. [Open-Meteo terms][openmeteo]

For navigation, offer a reliable lightweight overview before pursuing elaborate rendering. Test battery use, screen visibility and recovery from connection loss on actual devices. Do not promise full offline routing unless the relevant maps, graph and time-dependent inputs really remain available.

Protect location privacy by default. Do not expose a user's home through a public route card, publish individual movement traces as a growth tactic, or require an account just to preview a basic route. These are recommended design choices, not findings from a privacy audit of your app.

If operating cost eventually needs support, grants, institutional sponsorship or optional extras can be investigated without changing the core consumer job. Any sponsored destination should be clearly labeled and should not silently distort a supposedly best route or place ranking.

## 14. A staged roadmap with decision gates

Effort below is a relative planning judgment based on the feature's data and integration needs, not a repository estimate or delivery promise.

| Stage | Build or verify | Relative difficulty | Continue when... |
| --- | --- | --- | --- |
| **A. Trust the core** | Route validity, moving-time scoring, clear tradeoff cards, unknown-data labels and mismatch reports. | Medium; may reveal substantial data work. | People can understand and complete a route with no known serious routing defects in the tested scope. |
| **B. Create a repeat decision** | Departure comparison, short outings and a few verified comfort stops. | Medium, assuming a reusable route engine. | Users choose these tools without coaching and repeat them on relevant days. |
| **C. Test the broader identity** | Curated place-time windows, real reference photos and an agent that edits actual plans. | Medium-high; curation and geometry dominate. | Timed destinations produce useful completed outings beyond what ordinary search already provides. |
| **D. Add transit depth** | Access/egress first, then one-city end-to-end exposure comparison with waiting and transfers. | High; feed quality and pedestrian station data matter. | Observed user journeys show transit integration removes a recurring failure or inconvenience. |
| **E. Expand selectively** | Additional areas, refined rolling/cycling profiles, group rendezvous or seasonal sun preference. | Variable, often data-heavy. | Earlier behavior demonstrates a repeatable value proposition and an affordable cost per successful trip. |

Do not treat this as a requirement to build everything. If departure comparison becomes the clear repeated use case, deepen it. If short outings win, emphasize discovery and return planning. If none wins, adding photographic simulation is unlikely to repair the core problem.

## 15. How to validate the direction before overbuilding

### Start with real recent behavior

Recruit around 15-20 people for exploratory interviews and walk-alongs across your chosen primary audience. This is a proposed qualitative sample, not a representative study. Ask about the last uncomfortable outdoor journey, how they chose the route, what they did when conditions changed, and what information they tried to obtain.

Avoid asking only whether a shady-walk app "sounds useful". Have people choose between real feasible alternatives and explain their time constraints. Observe where they ignore the app or use another tool. Separate people with recurring mandatory trips from those planning leisure time.

### Compare three concrete jobs

Test departure selection, a short outing, and a timed destination as separate experiences. Use a small curated area to reduce data noise. In a later test, vary which of these is prominent on the home screen rather than exposing every option equally and treating any tap as demand.

Record the ordinary alternative the person would otherwise use: their known route, a mainstream navigator, a search for a nearby park, or not going out. Your app needs to improve that actual alternative, not win an artificial contest against a blank screen.

### Validate predictions independently of satisfaction

Field-check sample routes at relevant times. Compare predicted and observed shadowed segments, crossings, access and facility availability. Separate clear-sky geometry errors from cloud differences and canopy uncertainty. Choose an acceptable error tolerance for the pilot before interpreting the results; do not invent a universal accuracy threshold.

Useful guardrails include no known illegal or inaccessible route segments within the supported profile, no fabricated venue or photograph, and no hidden unknowns presented as verified shadow. The absence of a problem in a small test does not prove global correctness.

### Measure useful trips rather than an attractive map

Instrument the funnel from request to computed result, shown alternatives, selected option, navigation started, completion or abandonment, and mismatch report. Collect voluntary feedback about whether the result improved the decision.

Use repeat successful outdoor trips as the central outcome. Analyze returning use among people who had another relevant trip and comparable conditions. Raw daily activity can be misleading for a seasonal or occasional-use product. Track compute and data costs per useful trip alongside behavioral outcomes.

An exposure reduction should be reported as an estimate under the chosen model, with its comparison route defined. It is not an observed health benefit. A high shadow percentage on a trip nobody takes is not success.

### Decision gates worth setting before the pilot

Set explicit product-specific targets for route completion, repeated voluntary use, acceptable prediction error and operating cost. The research does not supply valid universal thresholds for those numbers. Agree on them before looking at outcomes so that a compelling demonstration does not substitute for evidence.

## 16. What I would not prioritize

I would not begin with a social network, a generic restaurant discovery engine, global transit parity, a full fitness dashboard, a medically personalized UV budget, or an AI-generated view for every location. Each expands your obligations more quickly than it clarifies your distinctive benefit.

I would also avoid adding dozens of map layers before establishing which decision they improve. Air quality, precipitation and weather already appear in adjacent outdoor products. A layer becomes useful when it changes a recommendation or helps the person understand a tradeoff, not simply because another checkbox can be displayed. [AllTrails conditions][alltrails]

Finally, do not use feature quantity as a proxy for product quality. A dependable "leave at this time and take this route" may outperform a broad outdoor assistant that cannot be trusted at a single confusing intersection.

## 17. Final recommendation

The strongest direction is not "Google Maps, plus shadow" and not "a shadow viewer with a chatbot". It is a deliberately smaller product that connects **movement, destination and time** around the experience of being outside.

Build the next version around three questions: **When should I leave? What can I do with the time I have? Where will it be good while I am there?** Make the route, the stop and the return a single coherent plan.

Then use the pilot to discover which question earns repeat use. That is a more meaningful indication of what the app should become than either an expanding feature list or the apparent sophistication of a competitor's marketing.

## Research limitations and source handling

This is a multi-pass desk-research synthesis, not original market measurement. Primary product documentation establishes advertised scope; peer-reviewed and survey sources support specific behavioral claims. No representative survey of your users, independent niche market-size estimate, broad app-store review analysis, or hands-on comparative routing benchmark was performed. The full paid PeopleForBikes report was not reviewed; its public summary was.

Public product pages may change after September 5, 2026. A missing documented feature is not proof that a competitor lacks it. Undated adoption claims and unpublished business economics were not treated as verified market facts. The two Nature papers were reviewed through extracted PDF text; the research tool's PDF image rendering was unavailable, so no visual figure inspection is claimed.

The main evidence gaps are willingness to use a separate app, retention, local data quality, acceptable detours, and the incremental value of timed destinations. Those gaps are the purpose of the proposed pilot. Research stopped once the competitive categories, behavioral tradeoffs and feasibility constraints had sufficient support; further repetitive product listings would not resolve those user-specific questions.


[repo-plan]: https://raw.githubusercontent.com/marcopolocheung/shademapnav/main/GROWTH_ROADMAP.md "Marco Cheung / Umbra GitHub. Umbra Growth Roadmap. 2026-07-05; current main retrieved 2026-09-05."
[repo-architecture]: https://raw.githubusercontent.com/marcopolocheung/shademapnav/main/CLAUDE.md "Marco Cheung / Umbra GitHub. Umbra CLAUDE.md. Current main retrieved 2026-09-05."
[shadowmap]: https://shadowmap.org/pricing "Shadowmap. Shadowmap Pricing and Plans. Undated; accessed 2026-09-05."
[sunny-seats]: https://shadowmap.org/sunny-seats "Shadowmap. Sunny Seats. Undated; accessed 2026-09-05."
[shademap]: https://shademap.app/gpxreplay/ "ShadeMap.app. ShadeMap GPX Replay. Undated; accessed 2026-09-05."
[shadehopper]: https://play.google.com/store/apps/details?hl=en-US&id=com.shadehopper.app "Shadehopper LLC / Google Play. Shadehopper - Apps on Google Play. Listing updated 2026-06-25; accessed 2026-09-05."
[cool-walk]: https://walk.cool/ "Cool Walk. Cool Walk. Undated; accessed 2026-09-05."
[shadewalk]: https://shadewalk.fit/ "ShadeWalk. ShadeWalk. Undated; accessed 2026-09-05."
[undercover]: https://www.hack.gov.sg/2026/undercover/ "Singapore Government, Hack for Public Good. Undercover. 2026-02-03; accessed 2026-09-05."
[undercover-2025]: https://www.hack.gov.sg/2025/under-cover/ "Singapore Government, Hack for Public Good. Under Cover. 2025 project; accessed 2026-09-05."
[asu]: https://news.asu.edu/20260610-environment-and-sustainability-new-cool-routes-app-maps-shadiest-routes-your-walk "Arizona State University News. New 'Cool Routes' app maps shadiest routes for your walk. 2026-06-10."
[google]: https://blog.google/products-and-platforms/products/maps/order-food-in-ask-maps/ "Google. Ask Maps gets more helpful with food ordering. 2026-08-06."
[citymapper]: https://www4.citymapper.com/news/2548/routing-power-walk-less "Citymapper. Routing Power - WALK LESS. Undated; accessed 2026-09-05."
[komoot]: https://support.komoot.com/hc/en-us/articles/10194270667034-Plan-routes-on-the-website "Komoot Support. Plan routes on the website. Updated 2026-05-19."
[alltrails]: https://support.alltrails.com/hc/en-us/articles/36933535617300-Trail-Conditions "AllTrails Support. Trail Conditions. Updated 2026-08-04."
[photopills]: https://www.photopills.com/ "PhotoPills. PhotoPills. Undated; accessed 2026-09-05."
[shadow-study]: https://www.nature.com/articles/s41598-022-06383-5 "Melnikov et al., Scientific Reports 12, 2441. Behavioural thermal regulation explains pedestrian path choices in hot urban environments. 2022-02-14."
[inflexibility]: https://www.nature.com/articles/s44304-024-00053-4 "Derakhshan et al., npj Natural Hazards. Space-time dynamics in hazard exposure analysis: smartphone locations show pedestrian routes are inflexible to extreme heat events. 2025-01-10."
[preview]: https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0340711 "Savino et al., PLOS ONE. Evaluating route preview as an alternative to turn-by-turn navigation in pedestrian mobility. 2026-03-23."
[bicycling]: https://www.peopleforbikes.org/news/bicycling-participation-report-2024 "PeopleForBikes. More Americans Rode a Bike Than Ever Before in 2024. 2025-04-11."
[age-friendly]: https://www.walkwheelcycletrust.org.uk/our-blog/news/new-report-shows-how-to-create-a-successful-age-friendly-neighbourhood/ "Walk Wheel Cycle Trust, formerly Sustrans. New report shows how to create a successful age-friendly neighbourhood. 2022-03-02."
[skate]: https://openskatemap.se/ "OpenSkateMap. OpenSkateMap - Find the best outdoor inline skating paths. Undated; accessed 2026-09-05."
[gtfs-pathways]: https://gtfs.org/documentation/schedule/examples/pathways/ "GTFS.org. Pathways examples. Current documentation; accessed 2026-09-05."
[gtfs-realtime]: https://gtfs.org/documentation/realtime/reference/ "GTFS.org. GTFS Realtime Reference. Current documentation; accessed 2026-09-05."
[nws]: https://www.weather.gov/arx/heat_index "US National Weather Service, La Crosse. Heat Index. Undated; accessed 2026-09-05."
[who]: https://www.who.int/news-room/questions-and-answers/item/radiation-protecting-against-skin-cancer "World Health Organization. Radiation: Protecting against skin cancer. Accessed 2026-09-05; exact update not verified."
[openmeteo]: https://open-meteo.com/en/terms "Open-Meteo. Terms and Conditions. Current terms; accessed 2026-09-05."
