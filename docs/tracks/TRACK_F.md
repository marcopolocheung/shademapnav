# Track F — Reach *(parked)*

> **Charter:** make one good route spread — share cards, unfurling links, deep links, offline,
> and the search results that bring a heatwave user in.

**Class:** Growth. **Status: PARKED as of 2026-08-24** by owner decision — documented, not staffed.

---

## Current state

- **Active checkpoint:** none — track is parked
- **Done:** nothing in this track. Note that **share-state URLs (`app/lib/shareState.ts`) and the
  PWA shell (`public/sw.js`, `manifest.webmanifest`) already shipped** outside it
- **Open PRs:** none
- **Blocked on:** deliberately deferred, not blocked
- **Next action on unpark:** F1 (share card) — but only after Track B's B7 gives it a sentence worth sharing
- **Last verified:** 2026-08-24

---

## Why it's parked (and what would unpark it)

Reach multiplies whatever the product already does well. Right now the things worth spreading
aren't built yet: there's no arrival summary (B7), no best-time chart in the UI (D1), no mode
choice (E1). Shipping share cards first would spread a screenshot of a feature set that the
2026 landscape is about to commoditize.

**Unpark when:** B7 and D1 have landed — i.e. when there is a sentence ("you walked 78% in
shade") and a picture (the hour strip) that no other app produces. **Timing matters**: ship
before a northern-hemisphere summer, not during the autumn after one.

## Checkpoints (kept warm, not started)

- **F1 — Share card.** Canvas capture (`preserveDrawingBuffer` is already required by invariant
  #3) + the tradeoff sentence + time and city → a shareable PNG. Closes **#61**.
- **F2 — OG images + meta.** A serverless OG endpoint so a shared state URL unfurls with a
  shadow-map preview. Must stay inside the Vercel free tier.
- **F3 — Share target + deep links.** PWA `share_target` registration plus a documented URL
  scheme, so an address shared from another app opens as a shade route. Closes **#68**.
  Builds directly on `shareState.ts`.
- **F4 — Offline that means something.** Cache the last route, its graph slice, and surrounding
  tiles; the app opens and still shows your commute with no network. Today's service worker
  caches the app shell only (`CACHE_NAME = "shademapnav-shell-v1"`). **Track D's D7 depends on
  this.**
- **F5 — City landing pages.** Pre-rendered pages for the searches people actually make
  ("shaded walking routes in Madrid"), each with a screenshot, a canned deep link, and two
  honest paragraphs. Closes **#62**.
- **F6 — Public shade API / embeddable widget** *(stretch)*. Once Track A is a real engine, a
  read-only shade-at-point endpoint is the thing urbanists screenshot and link.

## Notes for whoever unparks this

- The persona is outdoors, on a phone, on 4G, mid-heatwave — every kilobyte F adds is checked
  by Track G's bundle budget (G3).
- Anything that unfurls or renders server-side must be free-tier and must not leak API keys.
- `app/lib/shareState.ts` already round-trips center/zoom/date/waypoints; **Track E's E1 adds
  mode and E5 adds trips to that URL** — coordinate rather than inventing a second format.
- Owns: `public/**`, `api/**` (non-agent), `app/lib/shareState.ts`, share/export components,
  `app/about/**`.
