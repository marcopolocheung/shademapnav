/**
 * Vercel serverless proxy for the agent's LLM provider (Cerebras only).
 *
 * Keeps the API key(s) off the client. The browser builds a Cerebras-ready
 * (OpenAI chat-completions) request and POSTs { provider: "cerebras", payload };
 * we inject a key and forward to Cerebras, returning the JSON verbatim. (All
 * wire-format translation happens client-side in app/lib/agent/llmClient.ts;
 * this proxy is a dumb authenticated forwarder.)
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

  const payload = body.payload || {};

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
