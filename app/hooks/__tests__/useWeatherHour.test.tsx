/* @vitest-environment jsdom */
import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearWeatherCache } from "../../services/weather";
import { useWeatherHour } from "../useWeatherHour";

const TARGET = new Date("2026-08-08T15:00:00.000Z");

function body() {
  return {
    hourly: {
      time: ["2026-08-08T14:00", "2026-08-08T15:00"],
      cloud_cover: [15, 74],
      uv_index: [7.2, 6.1],
      temperature_2m: [31.4, 30.8],
      relative_humidity_2m: [55, 58],
      wind_speed_10m: [3.2, 2.9],
      apparent_temperature: [35.1, 34.2],
      shortwave_radiation: [812, 640],
    },
  };
}

function stubFetch() {
  const spy = vi.fn().mockResolvedValue({ ok: true, json: async () => body() });
  vi.stubGlobal("fetch", spy);
  return spy;
}

beforeEach(() => clearWeatherCache());
afterEach(() => vi.unstubAllGlobals());

describe("useWeatherHour", () => {
  it("returns the forecast hour nearest the target", async () => {
    stubFetch();
    const { result } = renderHook(() => useWeatherHour([1.3, 103.8], TARGET));

    await waitFor(() => expect(result.current).not.toBeNull());
    expect(result.current?.apparentTempC).toBe(34.2);
    expect(result.current?.shortwaveWm2).toBe(640);
  });

  it("stays null with no map centre, and never asks for a forecast", async () => {
    const spy = stubFetch();
    const { result } = renderHook(() => useWeatherHour(null, TARGET));

    await waitFor(() => expect(spy).not.toHaveBeenCalled());
    expect(result.current).toBeNull();
  });

  it("reuses one request across a pan inside the cache's cell and an hour of drag", async () => {
    const spy = stubFetch();
    const { rerender, result } = renderHook(
      ({ c, d }: { c: [number, number]; d: Date }) => useWeatherHour(c, d),
      { initialProps: { c: [1.3, 103.8] as [number, number], d: TARGET } }
    );

    await waitFor(() => expect(result.current).not.toBeNull());
    // Same ~1.1 km cell, and a target 20 minutes later — neither can change the answer.
    rerender({ c: [1.3004, 103.8004], d: new Date(TARGET.getTime() + 20 * 60_000) });
    await waitFor(() => expect(result.current).not.toBeNull());

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("survives an unmount mid-flight without leaving the forecast poisoned", async () => {
    // The promise this awaits is the shared cache entry. An earlier version aborted
    // it on cleanup, which cancelled the fetch for every other consumer and stranded
    // the next effect run on the already-rejecting cached promise.
    // A signal-aware stub, so an abort actually rejects the shared promise the way
    // the real `fetch` does. Against the old code this test fails on the second hook.
    const spy = vi.fn(
      (_url: string, init?: { signal?: AbortSignal }) =>
        new Promise((resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
          setTimeout(() => resolve({ ok: true, json: async () => body() }), 5);
        })
    );
    vi.stubGlobal("fetch", spy);

    const first = renderHook(() => useWeatherHour([1.3, 103.8], TARGET));
    first.unmount();

    const { result } = renderHook(() => useWeatherHour([1.3, 103.8], TARGET));
    await waitFor(() => expect(result.current).not.toBeNull());
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("reports null rather than throwing when the forecast fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const { result } = renderHook(() => useWeatherHour([1.3, 103.8], TARGET));

    await waitFor(() => expect(result.current).toBeNull());
  });
});
