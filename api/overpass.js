/**
 * Vercel serverless proxy for the Overpass API.
 *
 * Routes POST /api/overpass → https://overpass-api.de/api/interpreter, with a
 * server-side fallback to a mirror. This exists because overpass-api.de, when
 * overloaded, returns 429/504 error responses that OMIT the
 * `Access-Control-Allow-Origin` header — which browsers surface as a misleading
 * CORS error ("No 'Access-Control-Allow-Origin' header is present"). Proxying
 * server-side removes CORS from the equation entirely and lets us fall back to
 * a mirror even when the primary fails outright (a thrown fetch, which the
 * browser could never recover from).
 *
 * The client posts an `application/x-www-form-urlencoded` body of the form
 * `data=<urlencoded OQL query>` — identical to what it used to send directly.
 */
const PRIMARY = "https://overpass-api.de/api/interpreter";
const MIRROR = "https://overpass.kumi.systems/api/interpreter";
const UPSTREAM_TIMEOUT_MS = Number(process.env.OVERPASS_UPSTREAM_TIMEOUT_MS || 25_000);
const MAX_BODY_BYTES = Number(process.env.OVERPASS_MAX_BODY_BYTES || 100_000);

async function callOverpass(target, body) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    return await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        // A real server-side User-Agent (browsers forbid setting this header, so
        // the old client-side attempt was silently dropped). Overpass asks clients
        // to identify themselves.
        "User-Agent": "ShadeMapNav/1.0 (+https://shademapnav.vercel.app)",
      },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(tid);
  }
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function isAbortError(err) {
  return !!err && typeof err === "object" && err.name === "AbortError";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const contentLength = Number(req.headers?.["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    res.status(413).json({ error: "Overpass request is too large" });
    return;
  }

  // Reconstruct the urlencoded body. Vercel parses an urlencoded request into
  // req.body (an object); reconstruct it so the upstream receives the exact
  // `data=...` payload. Fall back to a string body or the raw stream.
  let body;
  if (Buffer.isBuffer(req.body)) {
    body = req.body.toString("utf8");
  } else if (typeof req.body === "string") {
    body = req.body;
  } else if (req.body && typeof req.body === "object") {
    body = new URLSearchParams(req.body).toString();
  } else {
    body = await readRawBody(req);
  }
  if (Buffer.byteLength(body, "utf8") > MAX_BODY_BYTES) {
    res.status(413).json({ error: "Overpass request is too large" });
    return;
  }

  let response;
  try {
    response = await callOverpass(PRIMARY, body);
    if (!response.ok && response.status >= 500) {
      response = await callOverpass(MIRROR, body);
    }
  } catch {
    // Primary threw (DNS/connection/timeout) — try the mirror before giving up.
    try {
      response = await callOverpass(MIRROR, body);
    } catch (err) {
      console.error("Overpass proxy error:", err);
      res.status(isAbortError(err) ? 504 : 502).json({
        error: isAbortError(err)
          ? "Upstream Overpass request timed out"
          : "Upstream Overpass request failed",
      });
      return;
    }
  }

  // Pass the upstream status + body through so the client's existing error
  // handling (504 message, XML-error detection) keeps working.
  const forward = ["Content-Type", "Retry-After"];
  for (const h of forward) {
    const val = response.headers.get(h);
    if (val) res.setHeader(h, val);
  }
  res.status(response.status);
  const text = await response.text();
  res.send(text);
}
