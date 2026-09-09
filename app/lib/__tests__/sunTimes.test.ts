import { describe, it, expect } from "vitest";
import { sunriseSunset } from "../sunTimes";
import { toMapLocal } from "../timezone";

/** Local clock minutes of an instant, for comparing against a published time. */
function localMinutes(d: Date, utcOffsetMin: number): number {
  const { hours, minutes } = toMapLocal(d, utcOffsetMin);
  return hours * 60 + minutes;
}
const hhmm = (m: number) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;

// Instants are given as UTC; the offsets are the real civil offsets on that date.
const NYC = { lat: 40.754, lng: -73.984, offset: -240 };
const SYDNEY = { lat: -33.8688, lng: 151.2093, offset: 600 };
const KOLKATA = { lat: 22.5726, lng: 88.3639, offset: 330 };
const URUMQI = { lat: 43.8256, lng: 87.6168, offset: 480 };

describe("sunriseSunset", () => {
  // Asserting against SunCalc would be circular — it is the implementation. These
  // are published local times for the June solstice, matched to the minute.
  it("matches real published sunrise and sunset times", () => {
    const cases = [
      { name: "New York",  place: NYC,     rise: "5:26", set: "20:31" },
      { name: "Sydney",    place: SYDNEY,  rise: "7:01", set: "16:54" }, // southern winter
      { name: "Kolkata",   place: KOLKATA, rise: "4:53", set: "18:25" },
    ];
    for (const { name, place, rise, set } of cases) {
      const t = sunriseSunset(new Date("2026-06-21T12:00:00.000Z"), place.lat, place.lng);
      expect(t, name).not.toBeNull();
      expect(hhmm(localMinutes(t!.sunrise, place.offset)), name).toBe(rise);
      expect(hhmm(localMinutes(t!.sunset, place.offset)), name).toBe(set);
    }
  });

  it("does not reintroduce the +12 minute constant (#225)", () => {
    // TimelineSlider's hand-rolled formula added a flat +12 to both rise and set,
    // which put the New York solstice marker at 5:40 against a real 5:26. This is
    // the assertion that fails if any such fudge comes back.
    const t = sunriseSunset(new Date("2026-06-21T12:00:00.000Z"), NYC.lat, NYC.lng)!;
    const rise = localMinutes(t.sunrise, NYC.offset);
    expect(Math.abs(rise - (5 * 60 + 26))).toBeLessThanOrEqual(1);
    expect(rise).not.toBe(5 * 60 + 40);
  });

  it("answers for the same solar day at every hour of the local day", () => {
    // The bug this guards: MapView anchored on the *browser's* local noon, so the
    // answer slipped a day whenever the map was far from the viewer.
    const answers = new Set<string>();
    for (let hour = 0; hour < 24; hour++) {
      const instant = new Date(Date.UTC(2026, 5, 21, hour) - NYC.offset * 60000);
      const t = sunriseSunset(instant, NYC.lat, NYC.lng)!;
      answers.add(hhmm(localMinutes(t.sunrise, NYC.offset)));
    }
    // One minute of drift across the day is rounding, not a day slip.
    expect([...answers].sort()).toEqual(["5:25", "5:26"]);
  });

  it("uses the solar day where civil time and longitude disagree by hours", () => {
    // Urumqi keeps Beijing time (+8) at ~87.6°E, whose solar time is ~+5:50. An
    // anchor built from the civil offset would pick the wrong day at the edges.
    const early = new Date(Date.UTC(2026, 5, 21, 0, 30) - URUMQI.offset * 60000);
    const late = new Date(Date.UTC(2026, 5, 21, 23, 30) - URUMQI.offset * 60000);
    const a = sunriseSunset(early, URUMQI.lat, URUMQI.lng)!;
    const b = sunriseSunset(late, URUMQI.lat, URUMQI.lng)!;
    expect(hhmm(localMinutes(a.sunrise, URUMQI.offset))).toBe("6:28");
    expect(hhmm(localMinutes(b.sunrise, URUMQI.offset))).toBe("6:28");
  });

  it("returns null in polar day and polar night alike", () => {
    const lat = 78.2232, lng = 15.6267; // Longyearbyen
    expect(sunriseSunset(new Date("2026-06-21T12:00:00.000Z"), lat, lng)).toBeNull();
    expect(sunriseSunset(new Date("2026-12-21T12:00:00.000Z"), lat, lng)).toBeNull();
  });
});
