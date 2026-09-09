import { describe, it, expect } from "vitest";
import {
  longitudeToUtcOffsetMin,
  toMapLocal,
  fromMapLocal,
  utcOffsetMinAt,
  fromMapLocalInZone,
  TIMEZONE_METHOD,
} from "../timezone";

describe("longitudeToUtcOffsetMin", () => {
  it("returns 0 for Greenwich (0°)", () => {
    expect(longitudeToUtcOffsetMin(0)).toBe(0);
  });

  it("returns +540 for Tokyo (~135.7°)", () => {
    // round(135.7 / 15) = 9, 9 * 60 = 540
    expect(longitudeToUtcOffsetMin(135.7)).toBe(540);
  });

  it("returns -300 for New York (~-74°)", () => {
    // round(-74 / 15) = round(-4.93) = -5, -5 * 60 = -300
    expect(longitudeToUtcOffsetMin(-74)).toBe(-300);
  });

  it("returns +60 for Berlin (~13.4°)", () => {
    // round(13.4 / 15) = round(0.89) = 1, 1 * 60 = 60
    expect(longitudeToUtcOffsetMin(13.4)).toBe(60);
  });

  it("handles antimeridian (180°) without error", () => {
    expect(longitudeToUtcOffsetMin(180)).toBe(720);
    expect(longitudeToUtcOffsetMin(-180)).toBe(-720);
  });
});

describe("toMapLocal", () => {
  it("reads Tokyo noon (UTC+9) from UTC 03:00", () => {
    // 3:00 AM UTC = 12:00 PM JST
    const d = new Date("2026-03-04T03:00:00.000Z");
    const { hours, minutes, year, month, day } = toMapLocal(d, 540);
    expect(hours).toBe(12);
    expect(minutes).toBe(0);
    expect(year).toBe(2026);
    expect(month).toBe(2); // 0-indexed March
    expect(day).toBe(4);
  });

  it("reads New York 6 PM EST from UTC 23:00", () => {
    // 23:00 UTC = 18:00 EST (UTC-5 = -300 min)
    const d = new Date("2026-03-04T23:00:00.000Z");
    const { hours, minutes } = toMapLocal(d, -300);
    expect(hours).toBe(18);
    expect(minutes).toBe(0);
  });

  it("handles day rollover: Tokyo 1 AM is previous UTC date", () => {
    // 1:00 AM JST = 16:00 UTC previous day
    const d = new Date("2026-03-03T16:00:00.000Z");
    const { hours, day } = toMapLocal(d, 540);
    expect(hours).toBe(1);
    expect(day).toBe(4); // JST is already March 4
  });
});

describe("fromMapLocal", () => {
  it("round-trips with toMapLocal (Tokyo noon)", () => {
    const original = new Date("2026-03-04T03:00:00.000Z"); // noon JST
    const { hours, minutes } = toMapLocal(original, 540);
    const result = fromMapLocal(original, 540, hours, minutes);
    expect(result.getTime()).toBe(original.getTime());
  });

  it("changes hours while keeping the map-local date", () => {
    // Start: 2026-03-04T03:00:00Z (noon JST March 4)
    // Set to 6 PM JST March 4 → 09:00 UTC
    const base = new Date("2026-03-04T03:00:00.000Z");
    const result = fromMapLocal(base, 540, 18, 0);
    expect(result.getTime()).toBe(new Date("2026-03-04T09:00:00.000Z").getTime());
  });

  it("round-trips with toMapLocal (New York evening)", () => {
    const original = new Date("2026-03-04T23:00:00.000Z"); // 6 PM EST
    const { hours, minutes } = toMapLocal(original, -300);
    const result = fromMapLocal(original, -300, hours, minutes);
    expect(result.getTime()).toBe(original.getTime());
  });
});

// ---------------------------------------------------------------------------
// D0 — real timezones. See docs/notes/timezone.md.
// These pass IANA zone strings directly, so none of them needs the boundary
// dataset: the rules come from the runtime's own tz database.
// ---------------------------------------------------------------------------

describe("utcOffsetMinAt", () => {
  // Instants are chosen either side of each transition on purpose. A sample that
  // lands on the same side twice looks like a passing test and asserts nothing.
  it("follows US DST across spring forward and fall back", () => {
    const Z = "America/New_York";
    expect(utcOffsetMinAt(Z, new Date("2026-03-08T06:00:00.000Z"))).toBe(-300); // EST
    expect(utcOffsetMinAt(Z, new Date("2026-03-08T08:00:00.000Z"))).toBe(-240); // EDT
    expect(utcOffsetMinAt(Z, new Date("2026-11-01T05:00:00.000Z"))).toBe(-240);
    expect(utcOffsetMinAt(Z, new Date("2026-11-01T07:00:00.000Z"))).toBe(-300);
  });

  it("follows EU DST, which transitions on a different rule to the US", () => {
    const Z = "Europe/Berlin";
    expect(utcOffsetMinAt(Z, new Date("2026-03-29T00:30:00.000Z"))).toBe(60);
    expect(utcOffsetMinAt(Z, new Date("2026-03-29T02:30:00.000Z"))).toBe(120);
    expect(utcOffsetMinAt(Z, new Date("2026-10-25T00:30:00.000Z"))).toBe(120);
    expect(utcOffsetMinAt(Z, new Date("2026-10-25T02:30:00.000Z"))).toBe(60);
  });

  it("follows southern-hemisphere DST, where the seasons are inverted", () => {
    const Z = "Australia/Sydney";
    // April *ends* DST here and October starts it — the reverse of the two above.
    expect(utcOffsetMinAt(Z, new Date("2026-04-04T15:00:00.000Z"))).toBe(660); // AEDT
    expect(utcOffsetMinAt(Z, new Date("2026-04-04T17:00:00.000Z"))).toBe(600); // AEST
    expect(utcOffsetMinAt(Z, new Date("2026-10-03T15:00:00.000Z"))).toBe(600);
    expect(utcOffsetMinAt(Z, new Date("2026-10-03T17:00:00.000Z"))).toBe(660);
  });

  it("handles the three zones the longitude estimate names as its worst cases", () => {
    const jan = new Date("2026-01-15T00:00:00.000Z");
    const jul = new Date("2026-07-15T00:00:00.000Z");
    // India +5:30 — a half-hour offset the old whole-hour rounding could not express.
    expect(utcOffsetMinAt("Asia/Kolkata", jan)).toBe(330);
    expect(utcOffsetMinAt("Asia/Kolkata", jul)).toBe(330);
    // Iran +3:30, and no DST since 2022.
    expect(utcOffsetMinAt("Asia/Tehran", jan)).toBe(210);
    expect(utcOffsetMinAt("Asia/Tehran", jul)).toBe(210);
    // China is +8 nationwide across ~60° of longitude, so longitude cannot imply it.
    expect(utcOffsetMinAt("Asia/Shanghai", jan)).toBe(480);
    expect(utcOffsetMinAt("Asia/Urumqi", jan)).toBe(360);
  });

  it("reads UTC as zero and degrades to zero on a zone the runtime rejects", () => {
    expect(utcOffsetMinAt("UTC", new Date("2026-07-01T00:00:00.000Z"))).toBe(0);
    expect(utcOffsetMinAt("Not/AZone", new Date("2026-07-01T00:00:00.000Z"))).toBe(0);
  });
});

describe("fromMapLocalInZone", () => {
  const NY = "America/New_York";

  it("resolves a time on the far side of a DST transition to the hour asked for", () => {
    // prev is 1 AM EST on spring-forward day; the user asks for 2 PM. A fixed
    // offset taken at prev resolves that to 19:00Z, which reads back as 3 PM.
    const prev = new Date("2026-03-08T06:00:00.000Z");
    const naive = fromMapLocal(prev, utcOffsetMinAt(NY, prev), 14, 0);
    expect(naive.toISOString()).toBe("2026-03-08T19:00:00.000Z");

    const settled = fromMapLocalInZone(prev, NY, 14, 0);
    expect(settled.toISOString()).toBe("2026-03-08T18:00:00.000Z");
    expect(toMapLocal(settled, utcOffsetMinAt(NY, settled)).hours).toBe(14);
  });

  it("is identical to fromMapLocal on a day with no transition", () => {
    const prev = new Date("2026-07-04T16:00:00.000Z");
    expect(fromMapLocalInZone(prev, NY, 14, 0).getTime()).toBe(
      fromMapLocal(prev, utcOffsetMinAt(NY, prev), 14, 0).getTime()
    );
  });

  it("takes the first reading of an ambiguous hour rather than oscillating", () => {
    // 1:30 AM happens twice on fall-back day. One correction pass picks the
    // earlier (EDT) one; iterating to a fixed point would never terminate.
    const prev = new Date("2026-11-01T04:00:00.000Z");
    const settled = fromMapLocalInZone(prev, NY, 1, 30);
    expect(settled.toISOString()).toBe("2026-11-01T05:30:00.000Z");
    expect(utcOffsetMinAt(NY, settled)).toBe(-240);
  });
});

describe("TIMEZONE_METHOD", () => {
  it("names the strategy the method doc describes", () => {
    expect(TIMEZONE_METHOD).toBe("tz-lookup-intl-v1");
  });
});
