# How ShadeMapNav estimates UV exposure

**Method version `sed-uvi-v1`.** Implemented in `app/lib/heat/dose.ts`.
**Status: experimental.** The app labels it so, and this page explains why.

> The app shows this number next to a heat score, under one **How these are estimated**
> link that lands here. They answer different questions — this page is the *dose* (how
> much sun the trip costs); [heat-score.md](heat-score.md) is the *intensity* (how hot
> the walk feels while you are in it).

This page exists because the app shows a number connected to sunburn, and such a
number arriving without its assumptions is worse than no number at all.

## What the app actually shows

One sentence: *"About 4–6 min of full sun."*

That is the trip's UV dose restated as an equivalent duration of unbroken direct sun
at the same UV index. It is a **physical** quantity. It says how much sun the trip is
worth; it says nothing about whose skin it lands on.

The app deliberately does **not** show a percentage of a sunburn. Why not is the most
important section on this page.

## The part that is well founded

Two definitions, both standardised and both verifiable:

- **UV Index.** One UVI unit is an erythemally weighted irradiance of **25 mW/m²**.
  The scale comes from early Canadian work where a typical midday summer erythemal
  irradiance of 250 mW/m² became UVI 10. Formulated on the CIE reference action
  spectrum for UV-induced erythema, and standardised by WHO, WMO, UNEP and ICNIRP.
  [WHO/WMO Global Solar UV Index][uvi] [Bentham][bentham]
- **SED.** One standard erythemal dose is an erythemal radiant exposure of
  **100 J/m²**, defined by the CIE and **independent of skin type**. [CIE, via
  Bentham][bentham]

From those, a minute of full sun at UV index *u* delivers:

```
u × 0.025 W/m² × 60 s = u × 1.5 J/m² = u × 0.015 SED
```

That constant is `SED_PER_MINUTE_PER_UVI`. A 30-minute walk in full sun at UV 8
accumulates about 3.6 SED. This arithmetic is not in doubt.

## The part that is a derivation, not a measurement

**Shade is not a UV shield.** Under clear skies the diffuse component is roughly
**50–62%** of global erythemal UV, rising toward 93% under heavy cloud. A building
shadow removes the direct beam and leaves most of the rest. [Parisi, diffuse UV
review][parisi] [Modeling erythemal UV diffuse fraction][diffuse]

Purpose-built shade structures block 97.1–99.9% of *direct* radiation to the head and
neck, and their overall protection factor depends on the sky view still visible from
underneath, the roof transmittance, the diffuse share, and surface albedo. A street
shaded by one building has a far larger sky view than a purpose-built canopy, so it
keeps a correspondingly larger share of the diffuse component. [Shade structure
protection factor model][shade-pf] [Religi et al.][religi]

`SHADE_UV_TRANSMISSION` is set to **0.2–0.6** — the diffuse share multiplied by a
plausible range of street sky-view fractions. **This is our derivation from the cited
values, not a figure any of those papers reports.** It is the least defensible number
in the model, and Track A's sky view factor (A9) is what would replace it with
something computed per location rather than assumed.

The band's width is why every output is an interval.

## Why there is no "percentage of a burn"

A burn percentage requires the **minimal erythemal dose** — the exposure at which an
individual's skin visibly reddens. Unlike SED, MED is a property of a person, and the
only practical way an app could guess it is from a Fitzpatrick phototype.

That link is too weak to build a displayed number on:

- Measured correlation between Fitzpatrick type and MED runs **r ≈ 0.5–0.69** —
  explaining roughly a quarter to a half of the variance. [Sánchez et al.,
  Colombia][med-colombia]
- The Fitzpatrick scale's "reliability and validity have been called into question,
  mainly because it is subjective and prone to recall bias." Some studies find no
  favourable correlation with MED at all. [ibid.][med-colombia]
- Published MED values are measured with solar simulators and reported in
  broadband units — 22 mJ/cm² for types I–II, 33 and 43 mJ/cm² for III and IV in the
  Colombian sample — which do **not** convert cleanly into erythemally weighted SED
  without the source spectrum. [ibid.][med-colombia]
- MED also varies with population, prior sun acclimatisation and measurement method,
  so a single table cannot serve a global user base. [Skin type, MED and
  acclimatisation][acclim]

Asking the user their skin type would not repair this. The weak link is
phototype → MED, not our guess at the phototype. So `MED_SED` exists in the code as a
starting point for a future profile feature, `dose()` refuses to produce a
`burnFraction` unless a caller passes a real profile, and no UI passes one.

An earlier draft of this feature defaulted to type II and rendered "16–29% of a
fair-skin burn". That number was removed. It is recorded here because the failure is
instructive: a range and a disclaimer made a poorly founded figure *look* rigorous.

## Why every figure is an interval

The shade transmission band spans a factor of three, so a single number computed from
its midpoint would imply precision the input does not contain. `dose()` returns
`{ low, high }` throughout, and `uncertainty` is derived from that band's own width
rather than asserted:

| Ratio of high to low | Reported as |
| --- | --- |
| ≤ 1.6 | low |
| ≤ 2.6 | medium |
| above | high |

A mostly shaded trip lands in "high" for a real reason: most of its estimate rests on
the transmission assumption, which is the crudest thing in the model.

## What this model does not include

Each of these would move the answer, and none is modelled:

- **Altitude.** Erythemal UV rises with elevation. A mountain trip is underestimated.
- **Surface albedo.** Fresh snow can nearly double effective exposure; sand and water
  raise it materially. Not counted, though the shade-structure literature treats it
  as a real term.
- **Clothing, sunscreen, hats, a carried parasol.** The estimate is for unprotected
  skin, so anything worn makes it an overestimate.
- **Body geometry.** Horizontal and vertical surfaces of a person receive different
  irradiance; this treats exposure as a single surface.
- **Tree canopy** as distinct from building shade — canopy is not yet a shade source
  in the engine at all (Track A, A7).
- **Sky view factor** per location, which is exactly what would narrow the widest
  band in the model (Track A, A9).
- **Cloud at the moment of the trip**, beyond what the forecast's UV index already
  incorporates. Open-Meteo's `uv_index` is a forecast, not a measurement of the sky
  above you.
- **Ozone, aerosol and pollution variation** beyond what the forecast carries.
- **Reflection off glass façades**, which in a dense downtown is not negligible.

## What this is not

This is **not medical advice and not a safe-exposure budget.**

- The WHO is explicit that shade is *incomplete* UV protection.
- Erythema is the threshold for visible reddening, not for injury. UV damage
  accumulates over a lifetime, and a low dose is not a guarantee of no harm.
- Nothing here models skin cancer risk, photosensitising medication, or any medical
  condition. Anyone with a clinical reason to care about UV should be guided by their
  clinician, not by this app.

"You have 20 minutes left" is a sentence this model cannot support, and the app must
never phrase its output as permission.

## Sources

[uvi]: https://dermnetnz.org/topics/global-solar-ultraviolet-index "Global solar ultraviolet index. DermNet. Accessed 2026-09-06."
[bentham]: https://support.bentham.co.uk/support/solutions/articles/5000619299-erythemal-radiant-exposure-and-uv-index "Bentham Instruments. Erythemal radiant exposure and UV index. Accessed 2026-09-06."
[parisi]: https://onlinelibrary.wiley.com/doi/10.1111/php.70084 "Parisi et al. Measurement and modeling of diffuse ultraviolet radiation: A review. Photochemistry and Photobiology."
[diffuse]: https://acp.copernicus.org/preprints/acp-2017-524/acp-2017-524.pdf "Modeling erythemal ultraviolet diffuse fraction. Atmospheric Chemistry and Physics preprint, 2017."
[shade-pf]: https://www.sciencedirect.com/science/article/abs/pii/S0360132318306280 "Development of a model for calculating the solar ultraviolet protection factor of small to medium sized built shade structures. Building and Environment."
[religi]: https://onlinelibrary.wiley.com/doi/10.1111/php.12949 "Religi et al. Body Anatomical UV Protection Predicted by Shade Structures: A Modeling Study. Photochemistry and Photobiology, 2018."
[med-colombia]: https://www.sciencedirect.com/science/article/pii/S1578219020301505 "Minimal Erythema Dose: Correlation with Fitzpatrick Skin Type and Concordance Between Methods of Erythema Assessment in a Patient Sample in Colombia. Actas Dermo-Sifiliográficas, 2020."
[acclim]: https://pubmed.ncbi.nlm.nih.gov/7287960/ "Skin type, minimal erythema dose (MED), and sunlight acclimatization. J Am Acad Dermatol."

- UV index → irradiance and SED: [WHO/WMO Global Solar UV Index][uvi], [Bentham][bentham]
- Diffuse fraction of erythemal UV: [Parisi review][parisi], [ACP diffuse fraction][diffuse]
- Shade protection factors and sky view: [Shade structure PF model][shade-pf], [Religi et al.][religi]
- Fitzpatrick ↔ MED correlation and its limits: [Colombian MED study][med-colombia], [acclimatisation study][acclim]
- UV index forecast: Open-Meteo hourly `uv_index`, fetched once per location per hour
  (`app/services/weather.ts`).
