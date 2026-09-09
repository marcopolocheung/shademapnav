# Handoff — Wave 0: make the repo stop saying false things

**Mission.** Four small fixes and a triage. Every item is something the code or the docs
currently assert that is not true. None is hard; all of them block something.

**Verified 2026-09-08, after #219 merged.** Re-check with
`gh issue list --label p1 --state open`.

**Preconditions are met — this is startable now.** `main` is green, there are **no open PRs on
either repo**, the public mirror has no PRs and no workflow runs, the Dependabot backlog is at
zero, `FSQ_API_KEY` is live in Vercel with the old key rotated, and MapTiler now has allowed HTTP
origins set. Nothing is waiting on the owner.

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

> **G8 has shrunk twice and is now mostly this issue.** Its `#33` bullet (vite/vitest
> advisories) was completed by **#213**. Its `#32` bullet — the only open p0 — is now done on
> both halves: MapTiler allowed HTTP origins were set in the dashboard, and the Foursquare half
> turned out not to be a dashboard setting at all (service keys carry no origin restriction), so
> **#218/#219** moved that key server-side into `api/fsq.js`. **Close #32 and #33 as part of this
> session** rather than re-investigating them.

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

What remains beyond the two defects above is **the dependency-bump policy** — see §5.

---

## 5. Dependabot triage · **done 2026-09-08 — read, do not redo**

Cleared to zero. Recorded so the decisions are not re-derived when Dependabot re-raises them.

| PR | Outcome |
|---|---|
| #81, #82, #139 | **Closed** — superseded by #213 |
| #112 typescript 7.0.2 | **Closed** — a major with no security driver, and TS 7 is the compiler rewrite. Deliberate change, not triage. |
| #140 vitest 5, #141 jsdom 30, #142 `@types/node` 26 | **Closed — all three blocked by one thing: CI pins Node 20.** See **#215**. |

**#215 is the single unlock.** vitest 5 needs Node `^22.12`, jsdom 30 needs `^22.22.2`, and
`@types/node` 26 would describe Node 26 APIs to `tsc` while CI runs Node 20. None carries an
advisory — #213 cleared all five on Node 20 — so this is ordinary currency, deferred on purpose.
**Take #215 after Wave 0 and before G2**, so the benchmark's baseline is measured on the runtime
it will keep.

Still owed here: the **dependency-bump policy** G8 asks for, written into `TRACK_G.md` — which
majors are auto-declined, that the two invariant pins are `ignore`d and why, and that
`npm audit fix --force` must never be run on this repo (it installs maplibre 6.8.0 and breaks
the shadow renderer).

## 5b. Public mirror hygiene · **mitigated 2026-09-08, one part still open — #216**

The mirror was running its own CI and Dependabot, and `Public mirror` was **failing on the
mirror's own `main`** — so the public repo showed red runs and three dependency PRs. Actions and
Dependabot alerts are now disabled there and the PRs are closed.

**Still open:** version-update PRs are driven by `.github/dependabot.yml`, which the mirror still
receives on every push. Toggle *Dependabot version updates* off in the mirror's Settings → Code
security. And decide whether the mirror should carry `.github/workflows/` at all.

**Add to P2/P4's acceptance:** the public repo has no failing runs and no open PRs when a
reviewer arrives. Nothing was checking that.

## 6. G7 — repo hygiene, *only if there is time left*

**#52 LICENSE first** — the repo calls itself open-source, has none, and is now publicly
mirrored. Then **#53 `.env.example`** with the live half of #50 (`CLAUDE.md:57` and the README
say `.env.local`; the tree has `.env`).

**`.env.example` now has a shape worth getting right**, because the Foursquare key changed sides
in #219: `VITE_MAPTILER_API_KEY` and `VITE_FOURSQUARE_API_KEY` are **dev-only client** values,
while `FSQ_API_KEY` and `CEREBRAS_API_KEY` are **server-only** and must never take a `VITE_`
prefix — that prefix is exactly what put the Foursquare key in the bundle. Say so in the file,
not just in the variable names. Note also that this repo's `.env` values are written **quoted**,
and both readers strip one surrounding pair (`normalizeApiKey`, `foursquareApiKey`) because a
quoted key in a `Bearer` header fails as `401` and reads as an expired key.

**⚠️ #50 is mostly stale.** Three of its four bullets are resolved. **Do not create six
per-directory `CLAUDE.md` files** — `.claude/rules/` replaced them. Read G7's re-scope note in
`TRACK_G.md` before touching it.

---

## Done when

All four gates green on each PR (`/gates` — the real output, not a claim), each PR small enough
to read, and **the brief's `## Current state` block updated in the same PR as the work**. Then
`/checkpoint` for a cold read from the `verifier` agent.

**Next session after this one:** `PUBLICATION.md`.
