# How ShadeMapNav estimates UV dose

**Method version `sed-uvi-v1`.** Implemented in `app/lib/heat/dose.ts`.

This page exists because the app shows a number about your skin, and a number about
your skin that arrives without its assumptions is worse than no number. Everything
below is what the estimate assumes, and what it cannot know.

## What is being estimated

**Erythemal UV dose** — the sunburn-weighted ultraviolet energy reaching unprotected
skin over the course of one trip. Not heat, not temperature, not total solar energy.

Two units appear:

- **SED** (standard erythemal dose), where 1 SED = 100 J/m² of erythemally weighted
  UV. A physical quantity, independent of who is exposed.
- **MED** (minimal erythemal dose) — the dose at which skin of a given phototype
  begins to redden. Person-dependent, which is why "40% of a burn" needs a skin type
  attached to mean anything.

## The arithmetic

One UV index unit is defined as 25 mW/m² of erythemally weighted irradiance. So a
minute of full sun at UV index *u* delivers:

```
u × 0.025 W/m² × 60 s = u × 1.5 J/m² = u × 0.015 SED
```

That constant is `SED_PER_MINUTE_PER_UVI`. A 30-minute walk in full sun at UV 8
accumulates about `8 × 0.015 × 30 = 3.6 SED`.

Dose is then compared against the MED band for a Fitzpatrick phototype:

| Phototype | MED (SED) | Roughly |
| --- | --- | --- |
| I | 1.5 – 2.5 | Always burns, never tans |
| II | 2.0 – 3.0 | Usually burns, tans minimally |
| III | 3.0 – 4.0 | Sometimes burns, tans uniformly |
| IV | 4.0 – 5.0 | Rarely burns, tans easily |
| V | 5.0 – 7.0 | Very rarely burns |
| VI | 8.0 – 12.0 | Never burns |

The app defaults to **type II** and says so wherever it shows a figure. Until Track D's
D5 ships a profile, that default is an assumption about you that may well be wrong —
if your skin is darker or more sensitive than type II, the displayed share of a burn
is correspondingly too high or too low.

## Shade is not a UV shield

Roughly half of the erythemal UV reaching the ground is **diffuse** — scattered by the
atmosphere rather than arriving straight from the sun. A building shadow blocks the
direct beam and very little of the rest.

The model therefore charges shaded minutes **20–50%** of the ambient rate
(`SHADE_UV_TRANSMISSION`), never zero. A route this app calls fully shaded still
accumulates dose.

That band is wide because the real answer depends on how much sky the spot can still
see — a narrow street canyon transmits far less than an open plaza with one building
between you and the sun. The app does not model sky view factor yet; Track A's A9
would supply it, and until then the interval stays honest by staying wide.

## Why every figure is an interval

Two inputs are bands, not numbers: the MED for a phototype (a factor of ~1.5 between
published values) and the diffuse share reaching shaded skin (a factor of 2.5). A
single number computed from the midpoints would imply a precision the inputs do not
contain. So `dose()` returns `{ low, high }` throughout, and the reported band is the
widest defensible one — the smallest dose against the most tolerant threshold, and the
largest dose against the least tolerant.

`uncertainty` is derived from that band's own width rather than asserted:

| Ratio of high to low | Reported as |
| --- | --- |
| ≤ 1.6 | low |
| ≤ 2.6 | medium |
| above | high |

A mostly shaded trip lands in "high" for a real reason: most of its estimate rests on
the diffuse-transmission assumption, which is the crudest thing in the model.

## What this model does not include

Each of these would move the answer, and none is modelled:

- **Altitude.** Erythemal UV rises roughly 10% per 1000 m. A mountain trip is
  underestimated.
- **Surface albedo.** Fresh snow can nearly double effective exposure; sand and water
  raise it materially. Not counted.
- **Clothing, sunscreen, a hat, shade you carry.** The estimate is for unprotected
  skin. Anything you wear makes it an overestimate.
- **Which skin is exposed,** and the fact that horizontal and vertical surfaces of a
  body receive different irradiance. Treated as a single exposed surface.
- **Tree canopy,** separately from building shade. Canopy is not yet a shade source
  in the engine at all (Track A, A7).
- **Cloud** at the moment of the trip beyond what the forecast's UV index already
  incorporates. Open-Meteo's `uv_index` is a clear-sky-corrected forecast, not a
  measurement of the sky above you.
- **Ozone, aerosol and pollution variation** beyond what the forecast carries.
- **Reflection off glass façades,** which in a dense downtown is not negligible.

## What this is not

This is **not medical advice, and not a safe-exposure budget.** It is a geometric and
meteorological estimate of one physical quantity, presented with its error bars.

- The WHO is explicit that shade is *incomplete* UV protection.
- A "burn fraction" below 1 is not a guarantee of no harm: UV damage accumulates over
  a lifetime, and erythema is a threshold for visible reddening, not for injury.
- Nothing here models skin cancer risk, photosensitising medication, or any medical
  condition. Someone with a reason to care about UV should be guided by their
  clinician, not by this app.

The app must never phrase the output as permission — "you have 20 minutes left" is a
sentence this model cannot support. What it can say is "this trip is roughly a third
of a fair-skin burn, give or take, and here is why that is uncertain".

## Provenance

- UV index → irradiance: 1 UVI ≡ 25 mW/m² erythemally weighted (WMO/WHO definition,
  as used in the Global Solar UV Index).
- SED: 1 SED ≡ 100 J/m² erythemally weighted (CIE).
- MED by phototype: the commonly published CIE-aligned bands, given here as intervals.
- UV index forecast: Open-Meteo hourly `uv_index`, fetched once per location per hour
  (`app/services/weather.ts`).
