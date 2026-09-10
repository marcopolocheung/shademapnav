# The one-hour max-shade window: declined, 2026-09-09

**Decision: declined for now.** Issue **#245** asked for one of two outcomes — adopt
Wen et al. 2025 §2.3.2's one-hour maximum-shade window with its width, rationale and
measured A3 effect recorded here, or decline in writing with the reason. This is the
decline. Taken during **A6**, because A6's measurement is what changed the arithmetic.

## What was proposed

Wen et al. smooth their shade estimate over a one-hour window and take the maximum:
a point shaded at 08:00 but sunlit at 09:00 counts as shaded for the whole 08:00–09:00
slot. Their justification is behavioural — a pedestrian will step a few metres to stay
in shade, so a sample landing just outside a shadow edge is not evidence the walker
will be in sun. Source: `docs/research/shade-thermal-comfort-literature-2026-09-09.md`
§6, from `docs/research/shadestudy.pdf`.

It is a real idea with a citable rationale, and it addresses something our binary
sampler genuinely does not model. It is declined on three grounds, in this order.

## 1. Its main argument for being cheap is now measured, and it is wrong

#245's case for taking it was: *"A6's time sweep makes it nearly free: sweeping N
hours in one pass is exactly the shape needed to take a max over a window."*

A6 measured what a sweep actually amortises. Everything that does not depend on the
hour is now shared — the provider resolution, the sun-cell partition, each prism's
ring bounds and footprint bucket — and what remains is dominated by the point-in-shadow
queries, which are irreducibly per-instant because the shadow moves. **The sweep is
linear in times:** on a 3 km route, `sweep` at 10-minute steps costs **6.9× the same
sweep at hourly steps**, against a linear floor of 6.0×. At graph scale it beats N
separate `sampleEdges` calls by 0–11%, and that margin is the batch plan — it does not
grow with the number of times. Numbers and method: `performance-baseline.md`
§ Time Sweep (A6).

So a one-hour window is priced at its sub-sample count, on the main thread, for a
feature that biases the answer in the dangerous direction. It is not nearly free.

## 2. A3 cannot measure the bias, and #245 requires that it be measured

#245 is explicit that the window "must not be applied silently, and its effect on the
A3 agreement numbers must be measured, not assumed". A3 compares the field against the
pixel sampler **at an instant** — that is the whole design, and it is what makes the
harness a comparison of shade *models* rather than of sampling densities. A windowed
maximum has no counterpart on the pixel-sampler side, so A3 would score it as pure
disagreement whether the window is a good idea or a bad one. The measurement #245 asks
for does not exist yet and is not a small addition.

The direction matters. `ShadeField.ts` already refuses to call model-vs-model agreement
accuracy; adopting a change that reports **more** shade, unmeasured, is exactly the
overclaim this track exists to avoid.

## 3. It conflicts with the next consumer of the sweep

#245 flags this itself: once **H1** prices exposure at each segment's traversal time, a
one-hour maximum is a much coarser instrument than the model around it. H1 is the sweep's
next consumer, and A6 exists to unblock it. Landing a coarsening into the shared field
immediately before the checkpoint that needs the opposite is the wrong order.

## What would change this

Any one of:

- **A reference that can score it.** A corpus of "I was standing here at this time and
  I was in sun / in shade" observations — Wave 4 Option A's *cheap* calibration set —
  can measure whether the window moves the field toward or away from what a pedestrian
  experienced. That is the only instrument that settles a behavioural claim.
- **A displayed-aggregate home for it.** #245's own strongest framing is that this is a
  property of the *displayed* estimate, not of the field. If it lands anywhere it is in
  a consumer such as the hourly strip, as a labelled softening with its width shown —
  never inside `ShadeField`, where H1 and the routing cost model would inherit it.
- **A sub-hourly sweep that is not linear in times.** See `performance-baseline.md`
  § A6's acceptance criterion for the one design that would do it, and what it trades.

Per `ROADMAP.md` §7, a note explaining what was not shipped is itself the artifact.
