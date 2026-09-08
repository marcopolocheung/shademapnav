/**
 * Vercel serverless proxy for the Nominatim geocoder.
 *
 * Routes GET /api/nominatim?endpoint=search|reverse&... →
 * https://nominatim.openstreetmap.org/<endpoint>.
 *
 * This exists for one reason the client cannot work around: the OSMF usage
 * policy requires every request to identify itself with a `User-Agent`, and
 * `User-Agent` is a forbidden header name
 * (https://fetch.spec.whatwg.org/#forbidden-header-name) — browsers drop it
 * from `fetch` silently, so the header the client used to set never once
 * reached Nominatim. Only a server can send it. `api/overpass.js` already
 * does the same for the other OSM service.
 *
 * Responses carry `s-maxage` so the CDN answers repeat geocodes for every
 * visitor instead of forwarding them upstream. That is a real reduction in
 * load on volunteer-run infrastructure; it is not a global quota, and this
 * function does not pretend to hold one — an ephemeral serverless instance
 * cannot. The client-side queue in app/lib/nominatim.ts still paces a single
 * tab, and no request fires from a keystroke (the policy forbids
 * autocomplete).
 */
const UPSTREAM = "https://nominatim.openstreetmap.org";
const UPSTREAM_TIMEOUT_MS = Number(process.env.NOMINATIM_UPSTREAM_TIMEOUT_MS || 10_000);
const CACHE_SECONDS = Number(process.env.NOMINATIM_CACHE_SECONDS || 86_400);

const ENDPOINTS = new Set(["search", "reverse"]);
// Everything the app asks for; anything else is dropped rather than forwarded.
const ALLOWED_PARAMS = [
  "q",
  "limit",
  "addressdetails",
  "viewbox",
  "bounded",
  "lat",
  "lon",
  "zoom",
];

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const query = req.query ?? {};
  const endpoint = String(query.endpoint ?? "");
  if (!ENDPOINTS.has(endpoint)) {
    res.status(400).json({ error: "Unknown Nominatim endpoint" });
    return;
  }

  const params = new URLSearchParams();
  for (const name of ALLOWED_PARAMS) {
    const value = query[name];
    if (value == null || value === "") continue;
    params.set(name, Array.isArray(value) ? value[0] : String(value));
  }
  params.set("format", "json");

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(`${UPSTREAM}/${endpoint}?${params.toString()}`, {
      headers: {
        // The whole point of this proxy. Nominatim rejects requests that do not
        // identify themselves, and a browser is not allowed to send this.
        "User-Agent": "ShadeMapNav/1.0 (+https://shademapnav.vercel.app)",
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } catch (err) {
    const timedOut = !!err && typeof err === "object" && err.name === "AbortError";
    console.error("Nominatim proxy error:", err);
    res.status(timedOut ? 504 : 502).json({
      error: timedOut
        ? "Upstream Nominatim request timed out"
        : "Upstream Nominatim request failed",
    });
    return;
  } finally {
    clearTimeout(tid);
  }

  const text = await response.text();
  res.setHeader("Content-Type", response.headers.get("Content-Type") || "application/json");
  if (response.ok) {
    res.setHeader("Cache-Control", `public, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS}`);
  }
  const retryAfter = response.headers.get("Retry-After");
  if (retryAfter) res.setHeader("Retry-After", retryAfter);
  res.status(response.status);
  res.send(text);
}
