import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The client half of the Nominatim change. `nominatimProxy.test.ts` covers the
 * serverless function; this covers what the browser actually asks for — that it
 * asks a same-origin proxy rather than Nominatim, and that it sends no headers
 * of its own (a `User-Agent` here would be dropped and is the bug #205 fixed).
 *
 * Each test re-imports the module so the 1 s FIFO throttle starts empty and the
 * first call goes out immediately.
 */
const PROXY_BASE = /^\/(?:__nominatim|api\/nominatim)\?/;

let fetchMock: ReturnType<typeof vi.fn>;

function requestedUrl(): string {
  return String(fetchMock.mock.calls[0][0]);
}

function paramsOf(url: string): URLSearchParams {
  return new URL(url, "http://localhost").searchParams;
}

beforeEach(() => {
  vi.resetModules();
  fetchMock = vi.fn(async () => new Response("[]", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("nominatim client", () => {
  it("asks a same-origin proxy, never Nominatim, and sends no headers", async () => {
    const { geocodeForward } = await import("../nominatim");
    await geocodeForward("brooklyn bridge");

    const url = requestedUrl();
    expect(url).toMatch(PROXY_BASE);
    expect(url).not.toContain("nominatim.openstreetmap.org");
    // No init argument at all: the User-Agent this used to carry never arrived.
    expect(fetchMock.mock.calls[0]).toHaveLength(1);
  });

  it("names the search endpoint and the app's query parameters", async () => {
    const { geocodeForward } = await import("../nominatim");
    await geocodeForward("brooklyn bridge");

    const params = paramsOf(requestedUrl());
    expect(params.get("endpoint")).toBe("search");
    expect(params.get("q")).toBe("brooklyn bridge");
    expect(params.get("limit")).toBe("5");
    expect(params.get("addressdetails")).toBe("1");
  });

  it("bounds a nearby search to a viewbox around the point", async () => {
    const { geocodeNear } = await import("../nominatim");
    await geocodeNear("parks", 40.7, -74, 0.1);

    const params = paramsOf(requestedUrl());
    expect(params.get("endpoint")).toBe("search");
    expect(params.get("bounded")).toBe("1");
    // left,top,right,bottom — compared numerically, since the corners are plain
    // float arithmetic on the centre and come out with the usual tail digits.
    const [left, top, right, bottom] = params.get("viewbox")!.split(",").map(Number);
    expect([left, top, right, bottom].map((n) => Number(n.toFixed(6)))).toEqual([
      -74.1, 40.8, -73.9, 40.6,
    ]);
  });

  it("names the reverse endpoint with the point it is resolving", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ display_name: "Old Fulton Street, Brooklyn, NY" }), {
        status: 200,
      })
    );
    const { geocodeReverse } = await import("../nominatim");
    const label = await geocodeReverse(40.7061, -73.9969);

    const params = paramsOf(requestedUrl());
    expect(params.get("endpoint")).toBe("reverse");
    expect(params.get("lat")).toBe("40.7061");
    expect(params.get("lon")).toBe("-73.9969");
    expect(params.get("zoom")).toBe("18");
    expect(label).toBe("Old Fulton Street, Brooklyn");
  });

  it("serves a repeat forward geocode from cache without a second request", async () => {
    const { geocodeForward } = await import("../nominatim");
    await geocodeForward("brooklyn bridge");
    await geocodeForward("Brooklyn Bridge");

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
