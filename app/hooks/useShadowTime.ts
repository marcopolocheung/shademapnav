import { useState, useRef, useCallback, useEffect } from "react";
import type maplibregl from "maplibre-gl";
import type { AccumulationOptions } from "../components/MapView";
import { longitudeToUtcOffsetMin, toMapLocal, fromMapLocal } from "../lib/timezone";

function todayAt(hours: number): Date {
  const d = new Date();
  d.setHours(hours, 0, 0, 0);
  return d;
}

export function formatTime12h(d: Date, utcOffsetMin: number): string {
  const { hours: h24, minutes: m } = toMapLocal(d, utcOffsetMin);
  const ampm = h24 >= 12 ? "PM" : "AM";
  const h = h24 % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}

/**
 * Parse a user-typed time string. Accepts:
 *   "6:30 AM" | "6:30AM" | "6:30 PM" | "14:30" | "6:30" | "6 AM" | "14" | "6"
 * Returns total minutes from midnight, or null if unparseable.
 */
export function parseTime(s: string): number | null {
  s = s.trim();
  const pm = /pm$/i.test(s);
  const am = /am$/i.test(s);
  const hasMeridiem = am || pm;
  const core = s.replace(/\s*[ap]m\s*$/i, "").trim();
  const parts = core.split(":").map((p) => parseInt(p.trim(), 10));
  if (parts.some(isNaN)) return null;
  let h = parts[0];
  const m = parts.length > 1 ? parts[1] : 0;
  if (m < 0 || m > 59) return null;
  if (hasMeridiem) {
    if (h < 1 || h > 12) return null;
    if (am && h === 12) h = 0;
    if (pm && h !== 12) h += 12;
  } else {
    if (h < 0 || h > 23) return null;
  }
  return h * 60 + m;
}

export function dateToDayOfYear(d: Date, utcOffsetMin: number): number {
  const { year, month, day } = toMapLocal(d, utcOffsetMin);
  return Math.floor(
    (Date.UTC(year, month, day) - Date.UTC(year, 0, 1)) / 86400000
  );
}

export interface ShadowTimeState {
  date: Date;
  setDate: React.Dispatch<React.SetStateAction<Date>>;
  showSunLines: boolean;
  setShowSunLines: React.Dispatch<React.SetStateAction<boolean>>;
  accumulation: AccumulationOptions;
  setAccumulation: React.Dispatch<React.SetStateAction<AccumulationOptions>>;
  isPlaying: boolean;
  setIsPlaying: React.Dispatch<React.SetStateAction<boolean>>;
  sliderMode: "time" | "day";
  setSliderMode: React.Dispatch<React.SetStateAction<"time" | "day">>;
  mapCenter: [number, number] | null;
  mapZoom: number;
  /** Camera pitch in degrees. 0 is top-down; > 0 means the 3D view is active. */
  mapPitch: number;
  mapUtcOffsetMin: number;
  dateRef: React.MutableRefObject<Date>;
  mapUtcOffsetMinRef: React.MutableRefObject<number>;
  sliderModeRef: React.MutableRefObject<"time" | "day">;
  handleMapReady: (map: maplibregl.Map) => void;
  handleSliderChange: (m: number) => void;
  handleDayOfYearChange: (day: number) => void;
  adjustYear: (delta: number) => void;
  jumpTo: (center: [number, number], zoom: number) => void;
  getCanvas: () => HTMLCanvasElement | undefined;
  getBounds: () => maplibregl.LngLatBounds | undefined;
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
}

export function useShadowTime(): ShadowTimeState {
  const [date, setDate] = useState<Date>(() => todayAt(12));
  const [showSunLines, setShowSunLines] = useState(false);
  const [accumulation, setAccumulation] = useState<AccumulationOptions>({
    enabled: false,
    startDate: todayAt(6),
    endDate: todayAt(20),
    iterations: 32,
  });
  const [isPlaying, setIsPlaying] = useState(false);
  const [sliderMode, setSliderMode] = useState<"time" | "day">("time");
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);
  const [mapZoom, setMapZoom] = useState(2);
  const [mapPitch, setMapPitch] = useState(0);
  const [mapUtcOffsetMin, setMapUtcOffsetMin] = useState<number>(
    () => -new Date().getTimezoneOffset()
  );

  const mapRef = useRef<maplibregl.Map | null>(null);
  const dateRef = useRef(date);
  const mapUtcOffsetMinRef = useRef(mapUtcOffsetMin);
  const sliderModeRef = useRef<"time" | "day">("time");
  const animTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  dateRef.current = date;
  mapUtcOffsetMinRef.current = mapUtcOffsetMin;
  sliderModeRef.current = sliderMode;

  // Advance 2 minutes per tick at 50ms → ~24s per full day
  useEffect(() => {
    if (isPlaying) {
      animTimerRef.current = setInterval(() => {
        setDate((prev) => {
          const offsetMin = mapUtcOffsetMinRef.current;
          if (sliderModeRef.current === "day") {
            const { year: yr, hours, minutes } = toMapLocal(prev, offsetMin);
            const doy = dateToDayOfYear(prev, offsetMin);
            const isLeap = (yr % 4 === 0 && yr % 100 !== 0) || yr % 400 === 0;
            const nextDoy = (doy + 1) % (isLeap ? 366 : 365);
            return new Date(
              Date.UTC(yr, 0, 1) + nextDoy * 86400000 - offsetMin * 60000 + (hours * 60 + minutes) * 60000
            );
          } else {
            const { hours, minutes } = toMapLocal(prev, offsetMin);
            const totalMins = (hours * 60 + minutes + 2) % 1440;
            return fromMapLocal(prev, offsetMin, Math.floor(totalMins / 60), totalMins % 60);
          }
        });
      }, 50);
    } else {
      if (animTimerRef.current) {
        clearInterval(animTimerRef.current);
        animTimerRef.current = null;
      }
    }
    return () => {
      if (animTimerRef.current) clearInterval(animTimerRef.current);
    };
  }, [isPlaying]);

  const handleMapReady = useCallback((map: maplibregl.Map) => {
    mapRef.current = map;
    const { lat, lng } = map.getCenter();
    setMapCenter([lat, lng]);
    const initialOffset = longitudeToUtcOffsetMin(lng);
    setMapUtcOffsetMin(initialOffset);
    setDate(new Date());
    map.on("moveend", () => {
      const c = map.getCenter();
      setMapCenter([c.lat, c.lng]);
      setMapUtcOffsetMin(longitudeToUtcOffsetMin(c.lng));
    });
    map.on("zoom", () => setMapZoom(map.getZoom()));
    setMapZoom(map.getZoom());
    // Pitch lives here rather than in FloatingMapControls because the map arrives via a
    // ref: a component subscribing on mount would find `mapRef.current` still null and
    // never re-render to retry.
    map.on("pitchend", () => setMapPitch(map.getPitch()));
    setMapPitch(map.getPitch());
  }, []);

  const handleSliderChange = useCallback((m: number) => {
    setDate((prev) => {
      const offsetMin = mapUtcOffsetMinRef.current;
      const { hours, minutes } = toMapLocal(prev, offsetMin);
      if (hours * 60 + minutes === m) return prev;
      return fromMapLocal(prev, offsetMin, Math.floor(m / 60), m % 60);
    });
  }, []);

  const handleDayOfYearChange = useCallback((day: number) => {
    setDate((prev) => {
      const offsetMin = mapUtcOffsetMinRef.current;
      const { year, hours, minutes } = toMapLocal(prev, offsetMin);
      return new Date(
        Date.UTC(year, 0, 1) + day * 86400000 - offsetMin * 60000 + (hours * 60 + minutes) * 60000
      );
    });
  }, []);

  const adjustYear = useCallback((delta: number) => {
    setDate((prev) => {
      const offsetMin = mapUtcOffsetMinRef.current;
      const { year, month, day, hours, minutes } = toMapLocal(prev, offsetMin);
      return new Date(
        Date.UTC(year + delta, month, day) - offsetMin * 60000 + (hours * 60 + minutes) * 60000
      );
    });
  }, []);

  const jumpTo = useCallback((center: [number, number], zoom: number) => {
    mapRef.current?.jumpTo({ center, zoom });
    const newOffset = longitudeToUtcOffsetMin(center[0]);
    setMapUtcOffsetMin(newOffset);
    setDate(new Date());
  }, []);

  const getCanvas = useCallback(
    () => mapRef.current?.getCanvas(),
    []
  );

  const getBounds = useCallback(
    () => mapRef.current?.getBounds(),
    []
  );

  return {
    date, setDate,
    showSunLines, setShowSunLines,
    accumulation, setAccumulation,
    isPlaying, setIsPlaying,
    sliderMode, setSliderMode,
    mapCenter, mapZoom, mapPitch,
    mapUtcOffsetMin,
    dateRef, mapUtcOffsetMinRef, sliderModeRef,
    handleMapReady, handleSliderChange, handleDayOfYearChange,
    adjustYear, jumpTo, getCanvas, getBounds,
    mapRef,
  };
}
