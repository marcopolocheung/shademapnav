# Handoff — Wave 0: make the repo stop saying false things

**Mission.** Four small fixes and a triage. Every item is something the code or the docs
currently assert that is not true. None is hard; all of them block something.

**Verified 2026-09-08 at `99bb418`.** Re-check with `gh issue list --label p1 --state open`.

> **On the one-track rule.** `docs/tracks/README.md` says one session owns one track. Wave 0 is
> the deliberate exception — it is a cross-track sweep of small independent defects (D, G, H).
> **Each item is still its own PR.** If you would rather split it, take §1 and §4 as a Track G
> session and §2 as a Track D session; the ordering below still holds.

---

## 1. #208 — OSM access tags are dropped rebuilding sidewalks · **half a day, do this first**

**Track H · `app/lib/routing.ts`**

`GraphEdge` declares nine fields (`routing.ts:21`), `overpass.ts:220` fills five of them from
OSM way tags, and `parallelSidewalkEdges` (`routing.ts:400`) returns four — silently discarding
`highway`, `surface`, `cycleway`, `bicycle`, `foot` on every sidewalk-split edge.

```ts
return [
  { toId, distanceM, shadeFactor: travellerLeft,  side: "left"  },
  { toId, distanceM, shadeFactor: travellerRight, side: "right" },
];
```

**Why first.** H2/H3 declare access exclusions a *hard constraint* and cannot enforce one.
Track E's mode profiles (E1 wheeling, E3/E4) have the same dependency. The failure is silent:
the edge looks fine, it just has no tags, so any predicate reading them returns "no restriction".

**Acceptance.** Thread the source edge's tags through and preserve them on both outputs. A
routing test asserts a tagged input edge yields two sidewalk edges carrying the same tags.

**Do not** infer a legal crossing from the existence of parallel graph edges. That is a
different claim and it is not supported by the data.

---

## 2. #204 — D0, real timezones · **3–5 days**

**Track D · `app/lib/timezone.ts` · brief: `docs/tracks/TRACK_D.md` → D0**

`timezone.ts:8` is `Math.round(lng / 15) * 60`. Its own docstring admits ±90 min for India,
Iran and China, and there is no DST at all.

**This is a Track H prerequisite, not only a Track D one.** An hour of clock error is ~15° of
sun. H1 prices every edge at its traversal time; H4 publishes an approximation gap. Both would
be measured against a wrong sky.

**Approach.** Resolve a geographic IANA zone, then apply date-specific offset rules including
DST. **Keep `toMapLocal` / `fromMapLocal` signatures** — the helpers and their tests are fine,
only the offset source is wrong.

**Acceptance.** DST-transition tests for three zones with different rules (US, EU, southern
hemisphere); India and China correct; existing `timezone.test.ts` still green; **bundle delta
recorded**. If a full tz-boundary dataset blows the budget, ship a coarse lookup *and say so in
the UI or the method doc*. A stated ±15 min is honest; a silent ±90 min is not.

---

## 3. #212 — popup `href`/`src` accept a `javascript:` URL · **half a day**

**Track G · `app/components/MapView.tsx`**

`renderPlacePopupHtml` escapes every interpolation with `escapeHtml` (`:45`), which is a correct
HTML **entity** escape — and no defence at all in URL position. `javascript:alert(1)` contains
no HTML-special characters, so it passes through unchanged into `href="${escapeHtml(website)}"`.
The value comes from Foursquare.

**Fix is a scheme allowlist, not more escaping.** Parse with `new URL()`, accept only `https:`
(and `http:` if wanted), drop the row otherwise; strip `phone` to `[+0-9 ()-]`. Keep
`escapeHtml` on top — the two defences address different attacks.

**Test** `javascript:`, `data:text/html`, and protocol-relative `//evil.example`, asserting no
`href`/`src` is emitted.

**Related, do not conflate:** #211 is a *maplibre* advisory with **no demonstrated path here**,
because the text positions are already escaped. Its only fix is a semver major that hard
invariant #1 forbids. Read #211 before saying anything about it publicly — it is easy to
overstate in both directions, and P4 will have to describe it precisely.

---

## 4. #205 — G8, Nominatim policy and the unreachable `User-Agent` · **2–3 days**

**Track G · brief: `docs/tracks/TRACK_G.md` → G8**

Two defects, both in the search path:

1. `SearchBar.tsx:141-159` fetches Nominatim directly on a 400 ms keystroke debounce. That is
   autocomplete, which the OSMF policy prohibits, and it **bypasses the FIFO queue** in
   `app/lib/nominatim.ts` that exists for exactly this. Honest fix: explicit-submit search, or
   geocoding behind `api/` where a shared budget can actually be held.
2. **Hard invariant #6 is satisfied nowhere on the client.** `User-Agent` is a forbidden header
   name; browsers silently drop it. The header set at `SearchBar.tsx:151` and `nominatim.ts:35`
   has never reached Nominatim or Overpass. Either move those requests server-side, **or amend
   invariant #6 in root `CLAUDE.md`** to say where the header can and cannot be set — as
   written it asks for something the platform does not permit.

**G8's scope shrank on 2026-09-08.** Its `#33` bullet (vite/vitest advisories) was completed by
PR #213. What remains of #33 is **the dependency-bump policy**, which is worth writing down —
see §5.

---

## 5. Dependabot triage · **an hour**

PR #213 cleared the five alerts. Seven PRs remain open and **Dependabot has already reopened
#140 as vitest 4.1.11 → 5.0.0.** Decide each and close what you decline, so the queue stops
looking like a backlog:

| PR | Call |
|---|---|
| **#140** vitest 5.0.0 | **Blocked.** vitest 5 requires Node `^22.12`; CI pins Node 20 (`ci.yml:23,60`). Either close it, or take it *with* a deliberate CI Node bump — but not as a drive-by. |
| **#81, #82, #139** | Stale — superseded by #213. Close. |
| **#112** typescript 7.0.2 | Decline for now. A major with no security driver, and a compiler rewrite behind it. |
| **#141** jsdom 30, **#142** `@types/node` 26 | No advisory. Take or close; either is defensible. |

Then write the **dependency-bump policy** G8 asks for, into `TRACK_G.md`: which majors are
auto-declined, that the two invariant pins are `ignore`d and why, and that `npm audit fix
--force` must never be run on this repo (it installs maplibre 6.8.0 and breaks the shadow
renderer).

---

## 6. G7 — repo hygiene, *only if there is time left*

**#52 LICENSE first** — the repo calls itself open-source, has none, and is now publicly
mirrored. Then **#53 `.env.example`** with the live half of #50 (`CLAUDE.md:57` and the README
say `.env.local`; the tree has `.env`).

**⚠️ #50 is mostly stale.** Three of its four bullets are resolved. **Do not create six
per-directory `CLAUDE.md` files** — `.claude/rules/` replaced them. Read G7's re-scope note in
`TRACK_G.md` before touching it.

---

## Done when

All four gates green on each PR (`/gates` — the real output, not a claim), each PR small enough
to read, and **the brief's `## Current state` block updated in the same PR as the work**. Then
`/checkpoint` for a cold read from the `verifier` agent.

**Next session after this one:** `PUBLICATION.md`.
