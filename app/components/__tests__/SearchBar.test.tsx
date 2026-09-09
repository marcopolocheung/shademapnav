/* @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SearchBar from "../SearchBar";

/**
 * The claim under test is a provider-policy one, not a rendering one: the OSMF
 * Nominatim usage policy lists autocomplete under unacceptable use, so typing
 * must never produce a geocode. Only an explicit submit may.
 *
 * There is no `setupFiles` in vitest.config.ts, so unmounting is this file's job.
 */
const geocodeForward = vi.fn();
vi.mock("../../lib/nominatim", () => ({
  geocodeForward: (q: string) => geocodeForward(q),
}));

const RESULT = {
  place_id: 1,
  display_name: "Brooklyn Bridge, New York, United States",
  lat: "40.7061",
  lon: "-73.9969",
  boundingbox: ["40.70", "40.71", "-74.00", "-73.99"] as [string, string, string, string],
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  // jsdom has no layout, so the highlight effect's scrollIntoView is absent.
  Element.prototype.scrollIntoView = vi.fn();
  geocodeForward.mockReset();
  geocodeForward.mockResolvedValue([RESULT]);
  localStorage.clear();
});

function renderBar() {
  const onSelect = vi.fn();
  render(<SearchBar onSelect={onSelect} />);
  return { onSelect, input: screen.getByRole("combobox") };
}

describe("SearchBar", () => {
  it("does not geocode while the user types, however long they pause", () => {
    vi.useFakeTimers();
    const { input } = renderBar();

    fireEvent.change(input, { target: { value: "brooklyn bridge" } });
    vi.advanceTimersByTime(10_000);

    expect(geocodeForward).not.toHaveBeenCalled();
  });

  it("geocodes once on Enter and offers the matches", async () => {
    const { input } = renderBar();
    fireEvent.change(input, { target: { value: "brooklyn bridge" } });
    fireEvent.keyDown(input, { key: "Enter" });

    const option = await screen.findByRole("option");
    expect(option.textContent).toContain("Brooklyn Bridge");
    expect(geocodeForward).toHaveBeenCalledTimes(1);
    expect(geocodeForward).toHaveBeenCalledWith("brooklyn bridge");
  });

  it("selects the highlighted match on a second Enter, centred on its bbox", async () => {
    const { input, onSelect } = renderBar();
    fireEvent.change(input, { target: { value: "brooklyn bridge" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByRole("option");

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({
      name: "Brooklyn Bridge",
      center: [-73.995, 40.705],
    });
  });

  it("geocodes when the magnifier is clicked", async () => {
    const { input } = renderBar();
    fireEvent.change(input, { target: { value: "brooklyn bridge" } });

    fireEvent.click(screen.getByLabelText("Search"));

    await waitFor(() => expect(geocodeForward).toHaveBeenCalledTimes(1));
  });

  it("drops a geocode that resolves after the query has moved on", async () => {
    let resolveFirst: (r: unknown[]) => void = () => {};
    geocodeForward.mockImplementationOnce(
      () => new Promise((resolve) => { resolveFirst = resolve; })
    );
    const { input, onSelect } = renderBar();

    fireEvent.change(input, { target: { value: "brooklyn bridge" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // User gives up waiting and retypes before the first geocode comes back.
    fireEvent.change(input, { target: { value: "times square" } });
    resolveFirst([RESULT]);
    await waitFor(() => expect(geocodeForward).toHaveBeenCalledTimes(1));

    expect(screen.queryByRole("option")).toBeNull();
    // The stale top hit must not be armed for the next Enter.
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("centres on the point when Nominatim returns no bounding box", async () => {
    geocodeForward.mockResolvedValue([{ ...RESULT, boundingbox: undefined }]);
    const { input, onSelect } = renderBar();
    fireEvent.change(input, { target: { value: "brooklyn bridge" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await screen.findByRole("option");

    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect.mock.calls[0][0]).toMatchObject({ center: [-73.9969, 40.7061], zoom: 16 });
  });
});
