import { beforeEach, describe, expect, it, vi } from "vitest";

function abortError() {
  const err = new Error("aborted");
  err.name = "AbortError";
  return err;
}

function makeReq({
  body = "data=%5Bout%3Ajson%5D%3B",
  headers = {},
}: {
  body?: unknown;
  headers?: Record<string, string>;
} = {}) {
  return {
    method: "POST",
    body,
    headers,
    on: vi.fn(),
  };
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
  const mod = await import("../../../api/overpass.js");
  return mod.default as (req: ReturnType<typeof makeReq>, res: ReturnType<typeof makeRes>) => Promise<void>;
}

describe("api/overpass proxy", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    delete process.env.OVERPASS_UPSTREAM_TIMEOUT_MS;
    delete process.env.OVERPASS_MAX_BODY_BYTES;
  });

  it("rejects oversized requests before forwarding", async () => {
    process.env.OVERPASS_MAX_BODY_BYTES = "8";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const handler = await loadHandler();
    const res = makeRes();

    await handler(makeReq({ body: "data=too-large" }), res);

    expect(res.statusCode).toBe(413);
    expect(res.jsonBody?.error).toBe("Overpass request is too large");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to the mirror when the primary times out", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(abortError())
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Headers({ "Content-Type": "application/json" }),
        text: async () => "{\"elements\":[]}",
      });
    vi.stubGlobal("fetch", fetchMock);
    const handler = await loadHandler();
    const res = makeRes();

    await handler(makeReq(), res);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0][0])).toContain("overpass-api.de");
    expect(String(fetchMock.mock.calls[1][0])).toContain("overpass.kumi.systems");
    expect(res.statusCode).toBe(200);
    expect(res.sentBody).toBe("{\"elements\":[]}");
  });

  it("returns 504 when both upstreams time out", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchMock = vi.fn().mockRejectedValue(abortError());
    vi.stubGlobal("fetch", fetchMock);
    const handler = await loadHandler();
    const res = makeRes();

    await handler(makeReq(), res);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.statusCode).toBe(504);
    expect(res.jsonBody?.error).toBe("Upstream Overpass request timed out");
    errorSpy.mockRestore();
  });
});
