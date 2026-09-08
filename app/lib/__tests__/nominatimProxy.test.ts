import { beforeEach, describe, expect, it, vi } from "vitest";

function abortError() {
  const err = new Error("aborted");
  err.name = "AbortError";
  return err;
}

function makeReq(query: Record<string, string> = {}, method = "GET") {
  return { method, query };
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    jsonBody: null as Record<string, unknown> | null,
    sentBody: "",
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    json(body: Record<string, unknown>) {
      this.jsonBody = body;
      return this;
    },
    send(body: string) {
      this.sentBody = body;
      return this;
    },
  };
}

async function loadHandler() {
  const mod = await import("../../../api/nominatim.js");
  return mod.default as (
    req: ReturnType<typeof makeReq>,
    res: ReturnType<typeof makeRes>
  ) => Promise<void>;
}

function upstreamOk(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
  return {
    ok: (init.status ?? 200) < 400,
    status: init.status ?? 200,
    headers: { get: (h: string) => init.headers?.[h.toLowerCase()] ?? init.headers?.[h] ?? null },
    text: async () => body,
  };
}

describe("api/nominatim proxy", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
  });

  it("rejects anything but GET", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler(makeReq({}, "POST"), res);
    expect(res.statusCode).toBe(405);
  });

  it("rejects an endpoint it does not know", async () => {
    const handler = await loadHandler();
    const res = makeRes();
    await handler(makeReq({ endpoint: "status" }), res);
    expect(res.statusCode).toBe(400);
  });

  it("sends a real User-Agent, since the browser could not", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => upstreamOk("[]"));
    vi.stubGlobal("fetch", fetchMock);
    const handler = await loadHandler();

    await handler(makeReq({ endpoint: "search", q: "brooklyn bridge" }), makeRes());

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(/^ShadeMapNav\//);
  });

  it("forwards only allowlisted params and forces JSON", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => upstreamOk("[]"));
    vi.stubGlobal("fetch", fetchMock);
    const handler = await loadHandler();

    await handler(
      makeReq({
        endpoint: "search",
        q: "prospect park",
        limit: "8",
        bounded: "1",
        format: "xml",
        email: "someone@example.com",
      }),
      makeRes()
    );

    const url = new URL(fetchMock.mock.calls[0][0]);
    expect(url.pathname).toBe("/search");
    expect(url.searchParams.get("q")).toBe("prospect park");
    expect(url.searchParams.get("limit")).toBe("8");
    expect(url.searchParams.get("format")).toBe("json");
    expect(url.searchParams.get("email")).toBeNull();
    expect(url.searchParams.get("endpoint")).toBeNull();
  });

  it("routes the reverse endpoint and caches successful answers at the edge", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => upstreamOk('{"display_name":"x"}')));
    const handler = await loadHandler();
    const res = makeRes();

    await handler(makeReq({ endpoint: "reverse", lat: "40.7", lon: "-74", zoom: "18" }), res);

    expect(res.statusCode).toBe(200);
    expect(res.sentBody).toBe('{"display_name":"x"}');
    expect(res.headers["Cache-Control"]).toMatch(/s-maxage=\d+/);
  });

  it("passes a rate-limit response through without caching it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => upstreamOk("Too Many Requests", { status: 429, headers: { "Retry-After": "30" } }))
    );
    const handler = await loadHandler();
    const res = makeRes();

    await handler(makeReq({ endpoint: "search", q: "x" }), res);

    expect(res.statusCode).toBe(429);
    expect(res.headers["Retry-After"]).toBe("30");
    expect(res.headers["Cache-Control"]).toBeUndefined();
  });

  it("reports a timeout as 504 and any other upstream failure as 502", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw abortError(); }));
    let handler = await loadHandler();
    const timedOut = makeRes();
    await handler(makeReq({ endpoint: "search", q: "x" }), timedOut);
    expect(timedOut.statusCode).toBe(504);

    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("ECONNREFUSED"); }));
    handler = await loadHandler();
    const failed = makeRes();
    await handler(makeReq({ endpoint: "search", q: "x" }), failed);
    expect(failed.statusCode).toBe(502);
  });
});
