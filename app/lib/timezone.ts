/**
 * UTC offset in minutes derived from longitude.
 * Convention: positive = ahead of UTC (e.g. Tokyo UTC+9 → +540).
 * Accuracy: ±30 min for ~90% of locations; up to ±90 min for edge cases
 * (India +5:30, Iran +3:30, China uniform +8 nationwide).
 */
export function longitudeToUtcOffsetMin(lng: number): number {
  return Math.round(lng / 15) * 60;
}

/**
 * Read time/date components in the map's local timezone without touching
 * the browser's local timezone. Returns 0-indexed month (like JS Date).
 */
export function toMapLocal(
  d: Date,
  utcOffsetMin: number
): { hours: number; minutes: number; year: number; month: number; day: number } {
  const shifted = new Date(d.getTime() + utcOffsetMin * 60000);
  return {
    hours:   shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
    year:    shifted.getUTCFullYear(),
    month:   shifted.getUTCMonth(),
    day:     shifted.getUTCDate(),
  };
}

/**
 * Build a Date where the map-local time = {hours, mins}, preserving the
 * map-local calendar day derived from `prev`.
 *
 * Example: prev = 2026-03-04T03:00Z (noon JST), utcOffsetMin = 540,
 *          hours = 18, mins = 0  →  2026-03-04T09:00Z (6 PM JST)
 */
export function fromMapLocal(
  prev: Date,
  utcOffsetMin: number,
  hours: number,
  mins: number
): Date {
  // Shift prev into the map-local frame to extract the local calendar date
  const shifted = new Date(prev.getTime() + utcOffsetMin * 60000);
  // UTC timestamp of that local midnight
  const midnightUtc = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate()
  );
  // Local midnight in UTC = midnightUtc - utcOffsetMin, then add the requested local time
  return new Date(midnightUtc - utcOffsetMin * 60000 + (hours * 60 + mins) * 60000);
}

// ---------------------------------------------------------------------------
// Real timezones (D0). See docs/notes/timezone.md.
// ---------------------------------------------------------------------------

/**
 * Method version for the offset the app displays. Bump when the resolution
 * strategy changes, not when the tz database behind it does.
 */
export const TIMEZONE_METHOD = "tz-lookup-intl-v1";

/** Where the offset currently in effect came from. Best first. */
export type TimezoneSource = "zone" | "longitude" | "browser";

/**
 * `Intl.DateTimeFormat` construction is the expensive half of reading an offset,
 * and `utcOffsetMinAt` runs on every play tick (50 ms). One formatter per zone.
 */
const offsetFormatters = new Map<string, Intl.DateTimeFormat | null>();

function offsetFormatter(zone: string): Intl.DateTimeFormat | null {
  const cached = offsetFormatters.get(zone);
  if (cached !== undefined) return cached;
  let made: Intl.DateTimeFormat | null;
  try {
    made = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "longOffset" });
  } catch {
    made = null; // RangeError — not a zone this runtime knows
  }
  offsetFormatters.set(zone, made);
  return made;
}

/**
 * UTC offset in minutes for an IANA zone **at a specific instant** — so it is
 * DST-correct, and correct for half-hour and three-quarter-hour zones.
 *
 * The rules come from the runtime's own tz database rather than anything we
 * ship, which is why this costs no bundle: every browser and Node build already
 * carries them. It also means a very old browser can hold stale rules.
 *
 * Returns 0 for UTC and for a zone this runtime cannot use — callers that have
 * a better fallback should choose their zone before calling.
 */
export function utcOffsetMinAt(zone: string, at: Date): number {
  const formatter = offsetFormatter(zone);
  if (!formatter) return 0;
  const name = formatter.formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
  const parsed = /^GMT([+-])(\d{2}):(\d{2})$/.exec(name);
  if (!parsed) return 0; // bare "GMT" is UTC
  return (parsed[1] === "-" ? -1 : 1) * (Number(parsed[2]) * 60 + Number(parsed[3]));
}

/**
 * `fromMapLocal` for a zone rather than a fixed offset.
 *
 * A scalar offset is stale across a DST boundary: resolving "1:30 PM" using the
 * offset in effect at `prev` lands an hour out when the transition falls between
 * the two. So this resolves once, re-reads the offset actually in effect at the
 * result, and rebuilds if it moved.
 *
 * Deliberately **one** correction pass. In the ambiguous hour a fall-back repeats
 * — 1:30 AM happens twice — and iterating to a fixed point would oscillate between
 * the two readings forever. One pass picks the first, which is what a walker
 * setting a departure time means.
 */
export function fromMapLocalInZone(
  prev: Date,
  zone: string,
  hours: number,
  mins: number
): Date {
  const { year, month, day } = toMapLocal(prev, utcOffsetMinAt(zone, prev));
  return fromZonedParts(zone, year, month, day, hours, mins);
}

/**
 * The instant at which a zone's clock reads these calendar and clock parts.
 *
 * The counterpart to `fromMapLocalInZone` for the controls that rebuild the
 * *date* rather than the time — the day-of-year slider and the year stepper.
 * Those are where a stale offset bites hardest: scrubbing New York from July to
 * January crosses a DST boundary every time, and reusing July's offset to build
 * a January instant moves the clock an hour without the user touching it.
 *
 * `month` is 0-indexed and `day` may overflow its month, both matching
 * `Date.UTC` — so day-of-year `d` is `(zone, year, 0, 1 + d, h, m)`.
 *
 * Same single correction pass, and same reason, as `fromMapLocalInZone`.
 */
export function fromZonedParts(
  zone: string,
  year: number,
  month: number,
  day: number,
  hours: number,
  mins: number
): Date {
  const asIfUtc = Date.UTC(year, month, day, hours, mins);
  const before = utcOffsetMinAt(zone, new Date(asIfUtc));
  const candidate = new Date(asIfUtc - before * 60000);
  const after = utcOffsetMinAt(zone, candidate);
  return after === before ? candidate : new Date(asIfUtc - after * 60000);
}
