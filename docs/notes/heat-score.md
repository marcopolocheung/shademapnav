# How ShadeMapNav scores a route for heat

**Method version `shade-radiation-v1`.** Implemented in `app/lib/heat/score.ts`.
**Status: experimental.** The app labels it so, and this page explains why.

This is the companion to [`heat-model.md`](./heat-model.md), which covers UV dose. The
two answer different questions: dose is about *sunburn*, this score is about *how hard
the walk is on you right now*.

## What the app shows

One line under the route tradeoff: *"Heat 75 vs 60 · feels about 36 °C walking this"*.

The first number is the selected route, the second the shortest one. The score is
**ordinal**: it ranks the options you are choosing between, at this hour, at this
place. Comparing it to a score from another day or another city is not a comparison
of anything.

## The score is an intensity, not a dose

It estimates how hot the walk *feels*, not how much heat you accumulate over it. A
90-minute shaded walk can score lower than a 10-minute exposed one, and that is the
intended behaviour: the trip's length and its minutes in sun are on screen directly
above the score, and rolling duration into the number would silently rank a long
comfortable walk worse than a short punishing one.

## The scale

Felt temperature is mapped onto 0–100 through UTCI's published heat-stress category
boundaries:

| Felt temperature | Score | UTCI category |
|---|---|---|
| ≤ 9 °C | 0 | below moderate heat stress |
| 26 °C | 40 | end of *no thermal stress* |
| 32 °C | 60 | end of *moderate heat stress* |
| 38 °C | 80 | end of *strong heat stress* |
| ≥ 46 °C | 100 | *extreme heat stress* |

The **temperatures** are Bröde et al. 2012, as published by Copernicus. The **scores**
attached to them are ours — an even 20 points per category, chosen so the number reads
easily. Nothing says a 60 is twice as bad as a 30.

## The felt temperature

```
feltC = shadeAmbientC + sunFraction × sunPenaltyC
```

### `shadeAmbientC` — what it feels like out of the sun

Open-Meteo's `apparent_temperature`, with its own solar term subtracted.

That subtraction is the non-obvious part. Open-Meteo implements the Steadman/BOM
Australian apparent temperature:

```
AT = T + 0.348·e − 0.70·w2m + 0.70·(Q / (w2m + 10)) − 4.25
Q  = max(0, 0.1 × (shortwave_radiation − 550))
w2m = w10m × 0.75
```

The `Q` term adds **up to about 2.5 °C** of solar warming at 1000 W/m², and exactly
zero below 550 W/m². Critically, it uses the *grid cell's* radiation with no local
shading — it assumes the sun reaches you, which is precisely the assumption this app
exists to question. So `score.ts` removes that term and adds a shade-aware penalty of
its own. Without it, a fully shaded route would still be charged for sunshine.

Removing the term needs the wind speed the formula divides by. When wind is missing,
the model falls back to dry-bulb `temperature_2m` — which never contained a solar term
— and lowers its confidence, because humidity and wind are then not in the number at
all.

### `sunFraction` — how much of the trip is exposed

Sunlit minutes over total minutes, from the route's sampled shade coverage at walking
pace. A route half in sun takes half the penalty.

### `sunPenaltyC` — what direct sun adds

`min(6.5, shortwave_radiation × 0.005)` °C.

Measured street-shade studies put the sun-versus-shade difference at roughly
**3.1–6.3 °C UTCI** on hot summer days, when global shortwave near solar noon is on
the order of 900 W/m². The middle of that band against that irradiance gives about
**0.005 °C per W/m²**, and the cap is the top of the reported range.

**This is a straight line through one anchor point, not a published transfer
function.** We found no study reporting ΔUTCI as a function of measured irradiance;
every published number is a summary statistic over a study period. Linearity is our
assumption. It is the weakest number in this file.

### Why radiation and not UV index

An earlier draft of this model scaled the sun penalty by UV index, because UV was
already in the forecast. It is the wrong variable. The UV share of global shortwave
runs from about **3.1% in January to 7.8% in June**, so a UV-scaled penalty would
under-weight winter and shoulder-season sun by more than a factor of two — it would
mis-rank the same street against itself across the year. UV index is the correct
input for the *dose* model, where erythema is the effect being estimated. It is not a
stand-in for radiant heat load.

`shortwave_radiation` costs nothing extra: it is one more field on the single hourly
request D2 already makes.

## Degraded mode

With no forecast — or a forecast missing radiation or temperature — the score falls
back to `shade-only`: the sunlit share of the trip, times 100, and nothing else. It is
**not comparable** to a felt-temperature score, so the mode travels with the number and
the UI says *"sun exposure only — no weather forecast"* instead of a temperature.

`confidence` reports which rung the estimate is on: 0.6 with apparent temperature,
0.45 with dry-bulb only, 0.3 in shade-only mode.

## What this model does not include

1. **Mean radiant temperature.** The real driver of outdoor thermal comfort, and the
   thing SOLWEIG-class models compute. We approximate its effect with one constant.
2. **Sky view factor.** A narrow street between tall buildings and an open plaza in the
   same shade get the same penalty here. Track A's A9 is what would fix this.
3. **Surface materials and albedo.** Asphalt and grass are the same surface to us.
4. **Building and pavement re-radiation.** Shade next to a hot west-facing wall is
   worse than shade in a park; this model cannot tell them apart.
5. **Wind at street level.** We use the grid's 10 m wind, funnelled and blocked
   differently on every street.
6. **Humidity beyond what apparent temperature already folds in.**
7. **The person.** Age, fitness, acclimatisation, clothing, hydration, pace, and
   whether you are pushing a stroller. Track D's D5 adds a profile; this version has
   none, and does not guess one.
8. **Anything above walking pace.** The exposure minutes come from a walking-speed
   conversion.
9. **Elevation gain**, which changes metabolic heat production substantially.

## This is not a health warning

The score is a comparison aid for choosing between two routes. It is not a safe-exposure
threshold, not a heat-illness risk estimate, and not advice. A low score on a 40 °C day
still means a 40 °C day.

## Sources

- **UTCI heat-stress thresholds** (no stress +9→+26, moderate +26→+32, strong +32→+38,
  very strong +38→+46, extreme >+46 °C), traced to Bröde et al. 2012, *Int J
  Biometeorol* 56:481–494 —
  https://climate.copernicus.eu/heat-stress-what-it-and-how-it-measured
- **UTCI's radiant sensitivity**, ≈ +3 K UTCI per +10 K of Tmrt above air temperature —
  Bröde, Jendritzky, Fiala, Havenith, Windsor conference proceedings, 2010 —
  https://www.utci.org/resources/windsor_vers05.pdf
- **Open-Meteo's apparent temperature formula**, read from source
  (`Sources/App/Helper/Meteorology.swift`) —
  https://github.com/open-meteo/open-meteo/blob/main/Sources/App/Helper/Meteorology.swift
  — and the maintainer's note that the 550 W/m² cutoff was added after "unreasonably
  high values" — https://github.com/open-meteo/open-meteo/discussions/651
- **Sun-vs-shade UTCI, street shade, hot Mediterranean summer**, mean decrease 3.1 °C —
  Aleksandrowicz & Pearlmutter, *Landscape & Urban Planning*, 2022 —
  https://www.sciencedirect.com/science/article/abs/pii/S0169204622002377
- **Sun-vs-shade UTCI, street trees**, 3.19–6.27 °C on a hot summer day —
  *Theor Appl Climatol*, 2025 —
  https://link.springer.com/article/10.1007/s00704-025-05400-7
- **Sun-vs-shade Tmrt, Phoenix summer**, >65 °C in sun against <38 °C in shade —
  ASU/Middel, 2026 — https://www.eurekalert.org/news-releases/1131561
- **UV as a share of global shortwave**, 3.1% (January) to 7.8% (June) —
  https://www.sciencedirect.com/science/article/abs/pii/0038092X9090028B
- **Field validation that radiant load dominates outdoor thermal sensation** — Middel et
  al. 2016, Tempe, n=1284 —
  https://www.ncbi.nlm.nih.gov/pmc/articles/PMC5127889/

**Access caveat.** ScienceDirect and Springer refused our automated requests. The
Aleksandrowicz & Pearlmutter, *Theor Appl Climatol*, and UV-share figures above come
from abstracts and search snippets, not from the full papers. They are the anchor for
`SUN_FELT_C_PER_WM2`, so anyone with library access should check them before this
model is treated as more than experimental.
