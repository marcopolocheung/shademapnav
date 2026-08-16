import { describe, expect, it } from "vitest";
import { appReducer, type AppState } from "../useAppState";

const directionsState: AppState = {
  phase: "DIRECTIONS",
  selectedPlace: null,
};

describe("appReducer navigation phases", () => {
  it("moves from directions to navigating, then arrival", () => {
    const navigating = appReducer(directionsState, { type: "START_NAVIGATION" });
    expect(navigating.phase).toBe("NAVIGATING");

    const arrival = appReducer(navigating, { type: "ARRIVE" });
    expect(arrival.phase).toBe("ARRIVAL");
  });

  it("keeps navigation-only actions scoped to their source phase", () => {
    expect(appReducer({ phase: "IDLE", selectedPlace: null }, { type: "START_NAVIGATION" }).phase).toBe("IDLE");
    expect(appReducer(directionsState, { type: "ARRIVE" }).phase).toBe("DIRECTIONS");
  });

  it("backs out of navigating to the route options", () => {
    const navigating = appReducer(directionsState, { type: "START_NAVIGATION" });
    expect(appReducer(navigating, { type: "BACK" }).phase).toBe("DIRECTIONS");
  });
});
