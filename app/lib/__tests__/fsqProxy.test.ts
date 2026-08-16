import { beforeEach, describe, expect, it, vi } from "vitest";

type JsonBody = Record<string, unknown>;

function makeReq({
  method = "GET",
  url = "/api/fsq/places/search?query=park&ll=40,-74&limit=1",
  headers = {},
  ip = "203.0.113.50",
}: {
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  ip?: string;
} = {}) {
  return {
    method,
    url,
    headers: {
      referer: "https://shademapnav.vercel.app/",
      authorization: "Bearer fsq_key",
      "x-places-api-version": "2025-06-17",
      "x-forwarded-for": ip,
      ...headers,
    },
    socket: { remoteAddress: ip },
  };
}

function makeRes() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    jsonBody: null as JsonBody | null,
    sentBody: "",
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    json(body: JsonBody) {
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
  const mod = await import("../../../api/fsq.js");
  return mod.default as (req: ReturnType<typeof makeReq>, res: ReturnType<typeof makeRes>) => Promise<void>;
}

describe("api/fsq proxy hardening", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    delete process.env.FSQ_ALLOWED_ORIGINS;
    delete process.env.FSQ_RATE_LIMIT_PER_MIN;
    delete process.env.VERCEL_URL;
  });

  it("rejects browser sources outside the allowlist", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const handler = await loadHandler();
    const res = makeRes();

    await handler(makeReq({ headers: { referer: "https://example.invalid/" } }), res);

    expect(res.statusCode).toBe(403);
    expect(res.jsonBody?.error).toBe("Origin not allowed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects requests without an origin or referer", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const handler = await loadHandler();
    const res = makeRes();

    await handler(makeReq({ headers: { referer: undefined as unknown as string } }), res);

    expect(res.statusCode).toBe(403);
    expect(res.jsonBody?.error).toBe("Origin not allowed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects Foursquare paths outside the app allowlist", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const handler = await loadHandler();
    const res = makeRes();

    await handler(makeReq({ url: "/api/fsq/users/self" }), res);

    expect(res.statusCode).toBe(404);
    expect(res.jsonBody?.error).toBe("Foursquare path is not allowed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rate limits repeated requests from one IP", async () => {
    process.env.FSQ_RATE_LIMIT_PER_MIN = "1";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ "Content-Type": "application/json" }),
      text: async () => "{\"ok\":true}",
    }));
    const handler = await loadHandler();

    const first = makeRes();
    await handler(makeReq({ ip: "203.0.113.60" }), first);
    expect(first.statusCode).toBe(200);

    const second = makeRes();
    await handler(makeReq({ ip: "203.0.113.60" }), second);
    expect(second.statusCode).toBe(429);
    expect(second.jsonBody?.error).toMatch(/Too many Foursquare requests/);
  });

  it("forwards allowed place search requests and rate-limit headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({
        "Content-Type": "application/json",
        "X-RateLimit-Remaining": "12",
      }),
      text: async () => "{\"results\":[]}",
    });
    vi.stubGlobal("fetch", fetchMock);
    const handler = await loadHandler();
    const res = makeRes();

    await handler(makeReq(), res);

    expect(res.statusCode).toBe(200);
    expect(res.headers["Content-Type"]).toBe("application/json");
    expect(res.headers["X-RateLimit-Remaining"]).toBe("12");
    expect(res.sentBody).toBe("{\"results\":[]}");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://places-api.foursquare.com/places/search?query=park&ll=40,-74&limit=1",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Accept: "application/json",
          Authorization: "Bearer fsq_key",
          "X-Places-Api-Version": "2025-06-17",
        }),
      })
    );
  });

  it("forwards allowed place detail requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      headers: new Headers({ "Content-Type": "application/json" }),
      text: async () => "{\"name\":\"Park\"}",
    });
    vi.stubGlobal("fetch", fetchMock);
    const handler = await loadHandler();
    const res = makeRes();

    await handler(makeReq({ url: "/api/fsq/places/abc123?fields=name%2Clocation" }), res);

    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://places-api.foursquare.com/places/abc123?fields=name%2Clocation",
      expect.any(Object)
    );
  });
});
