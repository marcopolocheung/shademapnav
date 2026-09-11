---
paths:
  - "app/lib/nominatim.ts"
  - "app/lib/overpass.ts"
  - "app/services/**"
  - "api/**"
---

# External data sources and the serverless proxies

Everything runs client-side except the proxies in `api/` — `fsq.js` (Foursquare),
`overpass.js`, `agent.js` (Gemini, server-only key pool).

## Free tier is a hard constraint

Sanctioned sources: **Open-Meteo, Overpass, Nominatim, MapTiler free tier, Foursquare free
tier**, and Google Gemini's free tier for the LLM. No new paid services and no new keys — that is a settled
project decision, not a tradeoff to re-open. Each source needs caching and a polite request
rate; the deployment target is the Vercel free tier.

## Nominatim and Overpass reject anonymous requests — and only a server can identify us

**Every request needs a `User-Agent` header, and a browser cannot send one.** It is a
[forbidden header name](https://fetch.spec.whatwg.org/#forbidden-header-name): `fetch` drops
it silently, so client code that sets it looks compliant and is not. Both services go through
same-origin proxies that set it server-side — `api/nominatim.js` and `api/overpass.js` in
production, `/__nominatim` and `/__overpass` in the Vite dev server. A `PreToolUse` hook
blocks edits that strip it from any of those *or* add it back to client code, and
`app/components/__tests__/providerPolicy.test.ts` fails if anything under `app/` names
`nominatim.openstreetmap.org` outside a comment.

**The OSMF policy also forbids autocomplete.** `geocodeForward` and friends must never be
called from a keystroke handler; search runs on an explicit submit (Enter or the magnifier).
A per-tab queue cannot enforce an application-wide quota anyway — what actually reduces load
is the CDN `s-maxage` on the proxy's responses.

Both are volunteer-run infrastructure. Rate-limit, cache, and back off on failure. Bound
upstream waits — a proxy that hangs on a slow Overpass mirror hangs the app.

## Writing a proxy

The proxies exist for CORS and to keep server-only keys off the client; they are not a place
for logic. Keep them thin: validate input, forward, bound the wait, return. Do not let one
grow into a service.

`api/agent.js` holds the production Gemini key pool and round-robins across it, failing over
on 429/5xx and 401/403. It must never leak a key into a response or a log line.

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
