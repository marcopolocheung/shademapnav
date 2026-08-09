/**
 * Vercel serverless proxy for the agent's LLM provider (Cerebras only).
 *
 * Keeps the API key(s) off the client. The browser builds a Cerebras-ready
 * (OpenAI chat-completions) request and POSTs { provider: "cerebras", payload };
 * we inject a key and forward to Cerebras, returning the JSON verbatim. (All
 * wire-format translation happens client-side in app/lib/agent/llmClient.ts;
 * this proxy validates the request, injects a key, and forwards upstream.)
 *
 * Multiple keys: set CEREBRAS_API_KEY to a comma-separated list, and/or add
 * CEREBRAS_API_KEY_1..9 — one per account pools the ~1M-tokens/day budget.
 * Requests round-robin across the pool and fail over to the next key on 429/5xx.
 *
 * In dev there's no serverless runtime: the client calls Cerebras through the
 * Vite `/__cerebras` proxy instead. Free key (no card): https://cloud.cerebras.ai
 */

/** Collect a deduped key pool from `CEREBRAS_API_KEY` (may be comma-separated) + `_1..9`. */
function collectKeys() {
  const out = [];
  const push = (v) => {
    if (!v) return;
    for (const part of String(v).split(",")) {
      const t = part.trim();
      if (t) out.push(t);
    }
  };
  push(process.env.CEREBRAS_API_KEY);
  for (let i = 1; i <= 9; i++) push(process.env[`CEREBRAS_API_KEY_${i}`]);
  return [...new Set(out)];
}

// Round-robin cursor (persists within a warm serverless instance).
let rr = 0;

const DEFAULT_ALLOWED_MODELS = ["gpt-oss-120b", "zai-glm-4.7"];
const MAX_PAYLOAD_BYTES = Number(process.env.AGENT_MAX_PAYLOAD_BYTES || 250_000);
const RATE_LIMIT_PER_MIN = Number(process.env.AGENT_RATE_LIMIT_PER_MIN || 20);
const recentRequestsByIp = new Map();

function splitCsv(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);
}

function allowedModels() {
  return new Set([
    ...DEFAULT_ALLOWED_MODELS,
    ...splitCsv(process.env.CEREBRAS_ALLOWED_MODELS),
  ]);
}

function allowedOrigins() {
  const configured = splitCsv(process.env.AGENT_ALLOWED_ORIGINS);
  const vercelUrl = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
  return new Set([
    "https://shademapnav.vercel.app",
    ...(vercelUrl ? [vercelUrl] : []),
    ...configured,
  ]);
}

function requestIp(req) {
  const forwarded = req.headers?.["x-forwarded-for"];
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

function originAllowed(req) {
  const origin = req.headers?.origin;
  if (!origin) return true;
  return allowedOrigins().has(origin);
}

function payloadByteLength(payload) {
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return "payload must be an object";
  }
  if (!allowedModels().has(payload.model)) {
    return "model is not allowed";
  }
  if (!Array.isArray(payload.messages) || payload.messages.length === 0) {
    return "payload.messages must be a non-empty array";
  }
  if (payloadByteLength(payload) > MAX_PAYLOAD_BYTES) {
    return "payload is too large";
  }
  return null;
}

/**
 * Try `makeReq(key)` across the pool: round-robin start, fail over on 429 / 5xx.
 * Returns the first acceptable Response, or the last one if all keys failed.
 */
async function forwardWithRotation(keys, makeReq) {
  const start = rr++ % keys.length;
  let last = null;
  for (let i = 0; i < keys.length; i++) {
    const res = await makeReq(keys[(start + i) % keys.length]);
    if (res.status !== 429 && res.status < 500) return res;
    last = res;
  }
  return last;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  if (!originAllowed(req)) {
    res.status(403).json({ error: "Origin not allowed" });
    return;
  }
  if (isRateLimited(req)) {
    res.status(429).json({ error: "Too many agent requests. Try again shortly." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      res.status(400).json({ error: "Invalid JSON body" });
      return;
    }
  }
  body = body || {};

  if (body.provider && body.provider !== "cerebras") {
    res.status(400).json({ error: "Unsupported provider" });
    return;
  }

  const payload = body.payload || {};
  const validationError = validatePayload(payload);
  if (validationError) {
    res.status(400).json({ error: validationError });
    return;
  }

  try {
    const keys = collectKeys();
    if (keys.length === 0) {
      res.status(500).json({ error: "CEREBRAS_API_KEY is not configured on the server." });
      return;
    }

    const makeReq = (key) =>
      fetch("https://api.cerebras.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify(payload),
      });

    const upstream = await forwardWithRotation(keys, makeReq);
    res.status(upstream.status);
    res.setHeader("Content-Type", "application/json");
    const text = await upstream.text();
    res.send(text);
  } catch (err) {
    console.error("Agent proxy error:", err);
    res.status(502).json({ error: "Upstream LLM request failed" });
  }
}
