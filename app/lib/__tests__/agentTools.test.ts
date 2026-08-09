import { describe, expect, it, vi } from "vitest";
import { executeTool, toolDeclarations } from "../agent/tools";
import type { AgentContext } from "../agent/tools";

function makeCtx(): AgentContext {
  return {
    mapRef: { current: null },
    dateRef: { current: new Date("2026-08-08T12:00:00Z") },
    setDate: vi.fn(),
    getUtcOffsetMin: () => 0,
    getUserLocation: () => null,
    setWaypointA: vi.fn(),
    setWaypointB: vi.fn(),
    setAdditionalWaypoints: vi.fn(),
    calculateRoute: vi.fn(),
    setPins: vi.fn(),
  };
}

describe("agent route tools", () => {
  it("exposes ordered via stops on plan_shaded_route", () => {
    const routeTool = toolDeclarations.find((tool) => tool.name === "plan_shaded_route");
    expect(routeTool?.parameters.properties).toHaveProperty("via");
  });

  it("sets additional waypoints before starting a multi-stop shaded route", async () => {
    const ctx = makeCtx();

    const result = await executeTool(
      "plan_shaded_route",
      {
        fromLat: 40.7,
        fromLng: -74.0,
        fromLabel: "Start cafe",
        toLat: 40.73,
        toLng: -73.98,
        toLabel: "Dinner",
        via: [
          { lat: 40.71, lng: -73.99, label: "Park" },
          { lat: 40.72, lng: -73.985, label: "Museum" },
          { lat: "bad", lng: -73.0 },
        ],
      },
      ctx
    );

    expect(result).toMatchObject({ ok: true, viaStops: 2 });
    expect(ctx.setAdditionalWaypoints).toHaveBeenCalledWith([
      [-73.99, 40.71],
      [-73.985, 40.72],
    ]);
    expect(ctx.setWaypointA).toHaveBeenCalledWith([-74.0, 40.7], "Start cafe");
    expect(ctx.setWaypointB).toHaveBeenCalledWith([-73.98, 40.73], "Dinner");
    expect(ctx.calculateRoute).toHaveBeenCalledTimes(1);
  });

  it("clears stale additional waypoints for a two-stop shaded route", async () => {
    const ctx = makeCtx();

    await executeTool(
      "plan_shaded_route",
      { fromLat: 1, fromLng: 2, toLat: 3, toLng: 4 },
      ctx
    );

    expect(ctx.setAdditionalWaypoints).toHaveBeenCalledWith([]);
  });
});
