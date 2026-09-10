# How Umbra decides what time it is where you are looking

**Method version `tz-lookup-intl-v1`.** Implemented in `app/lib/timezone.ts` and
`app/lib/tzLookup.ts`.

> Every clock in this app is the *map's* local time, not your device's. Pan to Tokyo and
> the timeline reads Tokyo time. This page is about how that number is produced and where
> it is still wrong.

The sibling method docs are [`heat-score.md`](./heat-score.md) and
[`heat-model.md`](./heat-model.md). They depend on this one: both are computed for an hour
of the day, and an hour of clock error is about 15° of sun.

## What the app shows

The timeline clock, the date field, the day-of-year slider and the sunrise/sunset markers
are all in the local civil time of the map centre. So are the assistant's answers and the
`time=` parameter in a shared link.

## Where the offset comes from

Two independent pieces, and it matters which is which:

- **Which zone** a point is in comes from a boundary dataset,
  [`@photostructure/tz-lookup`](https://github.com/photostructure/tz-lookup) (CC0-1.0). It
  ships as a separate chunk fetched after first paint, so it costs nothing on load.
- **What the offset is** for that zone on that date comes from the runtime's own IANA time
  zone database, read through `Intl.DateTimeFormat(…, { timeZoneName: "longOffset" })`.
  We ship no rules of our own.

The offset is therefore a function of **place and date together**. That is what makes DST
work: scrubbing the day slider from July to January over New York moves the clock from
UTC−4 to UTC−5 on its own.

## What this replaces

Until this version the offset was `Math.round(lng / 15) * 60` — longitude, rounded to whole
hours, with **no DST at all**. That was wrong by an hour for roughly half the year in every
zone that observes DST, and structurally unable to express India (+5:30), Iran (+3:30) or
China (+8 nationwide across some 60° of longitude).

## What it changed, measured

New York on the June solstice, read off the timeline's sunrise marker in a browser at
1280×900:

| | Sunrise marker |
|---|---|
| `main` at `4180e02` (longitude estimate) | 4:40 AM |
| Timezone fixed (#204) | 5:40 AM |
| Solar model unified (#225) | **5:26 AM** |
| Real sunrise, 2026-06-21 | 5:26 AM EDT |

Two separate defects, and it is worth keeping them apart. The first hour was the timezone:
no DST, so June read as EST. The remaining 14 minutes were never a timezone error at all —
they were a flat `+ 12` constant in a private copy of the solar math inside `TimelineSlider`,
which #225 removed by putting sunrise and sunset on `app/lib/sunTimes.ts`, the same SunCalc
model that draws the shadows.

## The part that is a derivation, not a measurement

**The zone lookup is approximate, and the error is not zero.** Measured by its authors
against [`geo-tz`](https://github.com/evansiroky/node-geo-tz/), which uses full timezone
boundary polygons:

| Sample | Zone name disagrees |
|---|---|
| A random point on earth | ~30% |
| A point likely to be inhabited | ~10% |
| Inhabited, counting zones that share an offset year-round as equal | **~5%** |

The last row is the one that matters here, because the app displays an offset rather than a
zone name: `Europe/Vienna` and `Europe/Berlin` are the same clock, and confusing them costs
the user nothing. **So roughly one inhabited point in twenty gets an offset that is wrong,
and the errors cluster along zone borders away from population.**

**One case worth knowing about, because it looks like a bug and is not.** Over Xinjiang the
lookup returns `Asia/Urumqi` (UTC+6), so the app shows 7:02 AM where Beijing shows 9:02 AM.
Chinese law puts the whole country on UTC+8; the IANA database keeps `Asia/Urumqi` because
the local population widely keeps a clock two hours off Beijing's. The app follows IANA. For
Chengdu, Shanghai and everywhere else in China it reads UTC+8 — including the western
longitudes where the old estimate said UTC+6 or +7.

This is a deliberate trade. `geo-tz` is accurate and about 892 kB — not something to send
to a phone on mobile data for a clock label. The alternative was not "exact"; it was the
±90-minute, no-DST estimate above.

When the boundary dataset has not loaded yet — the first moments after launch, or offline —
the app falls back to the old longitude estimate, and to the device's own zone before the
map is ready. It never blocks on the lookup.

## What this does not include

- **The ambiguous hour.** When clocks go back, a local time such as 1:30 AM happens twice.
  Resolving a typed time runs one correction pass and takes the **first** of the two
  readings. Iterating to a fixed point would never terminate, and a departure time means
  the earlier one.
- **The skipped hour.** When clocks go forward, times such as 2:30 AM do not exist. The app
  resolves them to the adjacent real instant rather than refusing them.
- **Stale rules on old browsers.** Because the offset rules come from the viewer's own
  runtime, a browser or OS that has not been updated since a country last changed its rules
  will show that country's old offset. There is nothing we can ship to fix this that would
  not mean shipping the tz database ourselves.
- **Three surfaces still on device time**, tracked separately and not fixed here: saved
  routes persist a browser-local wall clock; the sun-exposure accumulation window is edited
  in browser time; and the sunrise/sunset azimuth markers are anchored at browser-local
  noon.

## Sources

- IANA Time Zone Database, via the runtime's `Intl` implementation.
- `@photostructure/tz-lookup`, CC0-1.0 — boundary data and the accuracy figures quoted above.
- `geo-tz` — the reference the accuracy figures are measured against.
