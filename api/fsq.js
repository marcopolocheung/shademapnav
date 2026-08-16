/**
 * Vercel serverless proxy for Foursquare Places API.
 *
 * Routes the app's small allowlist of /api/fsq/* requests to
 * https://places-api.foursquare.com/*, while rejecting unrelated Foursquare
 * endpoints so this function cannot be used as a general-purpose relay.
 * Forwards rate-limit response headers back so client backoff logic works.
 */
const RATE_LIMIT_PER_MIN = Number(process.env.FSQ_RATE_LIMIT_PER_MIN || 60);
const recentRequestsByIp = new Map();

function splitCsv(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function allowedOrigins() {
  const configured = splitCsv(process.env.FSQ_ALLOWED_ORIGINS);
  const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
  return new Set([
    "https://shademapnav.vercel.app",
    ...(vercelUrl ? [vercelUrl] : []),
    ...configured,
  ]);
}

function header(req, name) {
  const headers = req.headers || {};
  const direct = headers[name] ?? headers[name.toLowerCase()];
  if (direct !== undefined) return direct;
  const lowerName = name.toLowerCase();
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === lowerName);
  return entry?.[1];
}

function requestIp(req) {
  const forwarded = header(req, "x-forwarded-for");
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.socket?.remoteAddress || "unknown";
}

function isRateLimited(req) {
  if (!Number.isFinite(RATE_LIMIT_PER_MIN) || RATE_LIMIT_PER_MIN <= 0) return false;
  const now = Date.now();
  const cutoff = now - 60_000;
  const ip = requestIp(req);
  const recent = (recentRequestsByIp.get(ip) || []).filter((t) => t > cutoff);
  if (recent.length >= RATE_LIMIT_PER_MIN) {
    recentRequestsByIp.set(ip, recent);
    return true;
  }
  recent.push(now);
  recentRequestsByIp.set(ip, recent);
  return false;
}

function originFromUrl(value) {
  if (!value || typeof value !== "string") return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function requestSourceAllowed(req) {
  const origin = originFromUrl(header(req, "origin"));
  const referer = originFromUrl(header(req, "referer") ?? header(req, "referrer"));
  const source = origin ?? referer;
  if (!source) return false;
  return allowedOrigins().has(source);
}

function hasOnlySearchParams(url, allowed) {
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key)) return false;
  }
  return true;
}

function allowedUpstreamPath(reqUrl) {
  const url = new URL(reqUrl, "https://shademapnav.vercel.app");
  const upstreamPath = url.pathname.replace(/^\/api\/fsq/, "") || "/";
  const upstream = new URL(upstreamPath + url.search, "https://places-api.foursquare.com");

  if (upstream.pathname === "/places/search") {
    if (!hasOnlySearchParams(upstream, new Set(["query", "ll", "limit"]))) return null;
    if (!upstream.searchParams.get("query") || !upstream.searchParams.get("ll")) return null;
    return upstream;
  }

  if (/^\/places\/[^/]+$/.test(upstream.pathname)) {
    if (!hasOnlySearchParams(upstream, new Set(["fields"]))) return null;
    return upstream;
  }

  return null;
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") {
    if (!requestSourceAllowed(req)) {
      res.status(403).json({ error: "Origin not allowed" });
      return;
    }
    res.setHeader("Access-Control-Allow-Origin", originFromUrl(header(req, "origin")) || "");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, X-Places-Api-Version, Accept");
    res.status(204).send("");
    return;
  }

  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!requestSourceAllowed(req)) {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }
  if (isRateLimited(req)) {
    res.status(429).json({ error: "Too many Foursquare requests. Try again shortly." });
    return;
  }

  const upstream = allowedUpstreamPath(req.url);
  if (!upstream) {
    res.status(404).json({ error: "Foursquare path is not allowed" });
    return;
  }

  const authorization = header(req, "authorization");
  if (!authorization || !String(authorization).startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing Foursquare authorization" });
    return;
  }

  const headers = {
    Accept: "application/json",
    Authorization: authorization,
  };

  const apiVersion = header(req, "x-places-api-version");
  if (apiVersion) {
    headers["X-Places-Api-Version"] = apiVersion;
  }

  try {
    const response = await fetch(upstream.toString(), {
      method: "GET",
      headers,
    });

    // Forward rate-limit headers for client-side backoff.
    const forwardHeaders = [
      "X-RateLimit-Limit",
      "X-RateLimit-Remaining",
      "Retry-After",
      "Content-Type",
    ];
    for (const h of forwardHeaders) {
      const val = response.headers.get(h);
      if (val) res.setHeader(h, val);
    }

    res.status(response.status);
    const body = await response.text();
    res.send(body);
  } catch (err) {
    console.error("Foursquare proxy error:", err);
    res.status(502).json({ error: "Upstream request failed" });
  }
}
