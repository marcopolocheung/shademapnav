---
paths:
  - "app/lib/nominatim.ts"
  - "app/lib/overpass.ts"
  - "app/services/**"
  - "api/**"
---

# External data sources and the serverless proxies

Everything runs client-side except the proxies in `api/` — `fsq.js` (Foursquare),
`overpass.js`, `agent.js` (Cerebras, server-only key).

## Free tier is a hard constraint

Sanctioned sources: **Open-Meteo, Overpass, Nominatim, MapTiler free tier, Foursquare free
tier**, and Cerebras for the LLM. No new paid services and no new keys — that is a settled
project decision, not a tradeoff to re-open. Each source needs caching and a polite request
rate; the deployment target is the Vercel free tier.

## Nominatim and Overpass reject anonymous requests

**Every request needs a `User-Agent` header.** Without one they are refused outright, and the
failure looks like a network error rather than a policy rejection, so it gets misdiagnosed. A
`PreToolUse` hook blocks edits that strip it.

Both are volunteer-run infrastructure. Rate-limit, cache, and back off on failure. Bound
upstream waits — a proxy that hangs on a slow Overpass mirror hangs the app.

## Writing a proxy

The proxies exist for CORS and to keep server-only keys off the client; they are not a place
for logic. Keep them thin: validate input, forward, bound the wait, return. Do not let one
grow into a service.

`api/agent.js` holds the production Cerebras key pool and round-robins across it, failing over
on 429/5xx. It must never leak a key into a response or a log line.

`VITE_MAPTILER_API_KEY` is required; `VITE_FOURSQUARE_API_KEY` powers place popups.
`VITE_SHADEMAP_API_KEY` and `VITE_TRANSITLAND_API_KEY` are vestigial and unused — do not build
on them.

## Tests are hermetic

`app/lib/__tests__/` and `app/services/__tests__/` cover `overpass`, `foursquare`, `weather`
and each proxy, with **no network and no env**. CI needs no secrets and it must stay that way:
the build inlines absent `VITE_*` vars as `undefined`. If a change here needs a live call to
test, the seam is wrong — inject the fetch.

## Failure is normal

These services time out, rate-limit, and return partial data routinely. Handle it explicitly
and surface it honestly: a geocode that quietly returns nothing produces an assistant answer
about a place that was never found. Degrade visibly, not silently.
