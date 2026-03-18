/**
 * Vercel serverless proxy for Foursquare Places API.
 *
 * Routes /api/fsq/* → https://places-api.foursquare.com/*
 * Forwards Authorization and X-Places-Api-Version headers from the client.
 * Forwards rate-limit response headers back so client backoff logic works.
 */
export default async function handler(req, res) {
  // Strip the /api/fsq prefix to get the upstream path.
  // req.url is e.g. "/api/fsq/places/search?query=..."
  const upstream = req.url.replace(/^\/api\/fsq/, "") || "/";
  const target = `https://places-api.foursquare.com${upstream}`;

  const headers = {
    Accept: "application/json",
  };

  if (req.headers["authorization"]) {
    headers["Authorization"] = req.headers["authorization"];
  }
  if (req.headers["x-places-api-version"]) {
    headers["X-Places-Api-Version"] = req.headers["x-places-api-version"];
  }

  try {
    const response = await fetch(target, {
      method: req.method || "GET",
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
