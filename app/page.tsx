import { useState, useRef, useCallback, useEffect, lazy, Suspense } from "react";
import type maplibregl from "maplibre-gl";
import LocationSearch from "./components/LocationSearch";
import TimelineSlider from "./components/TimelineSlider";
import AccumulationPanel from "./components/AccumulationPanel";
import NavigationPanel from "./components/NavigationPanel";
import SaveRouteModal from "./components/SaveRouteModal";
import { createRoute, getRoutes, getFolders, updateRoute, deleteRoute } from "./lib/savedRoutes";
import type { SavedRoute, SavedFolder } from "./lib/savedRoutes";
import { routeToGPX, routeToGeoJSON, downloadBlob } from "./lib/exportRoute";
import SettingsPanel from "./components/SettingsPanel";
import DateInput from "./components/DateInput";
import DaySlider from "./components/DaySlider";
import type { AccumulationOptions } from "./components/MapView";
import { fetchRoutingGraph, fetchStationEntrances } from "./lib/overpass";
import { geocodeReverse } from "./lib/nominatim";
import { snapToEdge, dijkstra, snapToGraph, paretoRoutes, graphToGeoJSON, haversineMeters, bfsReachable, snapToReachableEdge, RouteOption, SpatialGrid, simplifyPolyline, sketchBoundingBox, findSketchGaps } from "./lib/routing";
import type { GraphEdge, RoutingGraph, RouteLeg, LatLng, SketchPoint } from "./lib/routing";
import { recordRoutingRun, computeDerivedKpis } from "./lib/metrics";
import { buildingCentroidAt, snapOutsideBuilding } from "./lib/building-snap";
import type { MapBuildingQuery } from "./lib/building-snap";
import { longitudeToUtcOffsetMin, toMapLocal, fromMapLocal } from "./lib/timezone";
import { fetchTrainGraph, findBestTrainRoute, matchEntranceToTrainStation, TRAIN_SUN_EXPOSURE, buildTrainDrawData } from "./lib/trainGraph";

function pickClosestEntrance(
  from: [number, number], // [lng, lat]
  candidates: Array<{ lat: number; lon: number; kind?: string }>
): { lat: number; lon: number } {
  if (candidates.length === 0) throw new Error("pickClosestEntrance: empty candidates");

  // Prefer actual entrance nodes when present, otherwise fall back to stations.
  const entrances = candidates.filter((c) => c.kind === "entrance");
  const pool = entrances.length > 0 ? entrances : candidates;

  let best = pool[0];
  let bestDist = Infinity;
  for (const c of pool) {
    const d = haversineMeters(from, [c.lon, c.lat]);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return { lat: best.lat, lon: best.lon };
}

// MapView is client-only (uses browser APIs); skip SSR entirely
const MapView = lazy(() => import("./components/MapView"));

function todayAt(hours: number): Date {
  const d = new Date();
  d.setHours(hours, 0, 0, 0);
  return d;
}

function formatTime12h(d: Date, utcOffsetMin: number): string {
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
function parseTime(s: string): number | null {
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

function dateToDayOfYear(d: Date, utcOffsetMin: number): number {
  const { year, month, day } = toMapLocal(d, utcOffsetMin);
  return Math.floor(
    (Date.UTC(year, month, day) - Date.UTC(year, 0, 1)) / 86400000
  );
}

function TimeInput({ date, onChange, utcOffsetMin }: { date: Date; onChange: (d: Date) => void; utcOffsetMin: number }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const shouldCommit = useRef(true);

  function startEdit() {
    shouldCommit.current = true;
    setText(formatTime12h(date, utcOffsetMin));
    setEditing(true);
  }

  function commit(val: string) {
    if (!shouldCommit.current) {
      shouldCommit.current = true;
      return;
    }
    setEditing(false);
    const mins = parseTime(val);
    if (mins !== null) {
      const next = fromMapLocal(date, utcOffsetMin, Math.floor(mins / 60), mins % 60);
      onChange(next);
    }
  }

  if (editing) {
    return (
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit(text)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            shouldCommit.current = false;
            setEditing(false);
          }
        }}
        className="bg-white/10 rounded px-2 py-1 text-white text-xs border border-amber-400/60 focus:outline-none w-20 text-center"
        autoFocus
      />
    );
  }

  return (
    <button
      onClick={startEdit}
      className="text-white/70 hover:text-white/90 text-xs tabular-nums w-20 text-center rounded px-2 py-1 hover:bg-white/10 transition-colors"
      title="Click to type a time (e.g. 6:30 AM, 14:30)"
    >
      {formatTime12h(date, utcOffsetMin)}
    </button>
  );
}

/**
 * Sample shade independently for the left and right sidewalks of an edge.
 * ShadeMap overlay color is #01112f (R:1, G:17, B:47); shaded pixels have
 * heavy blue dominance (B/R > 1.8).
 *
 * `from`/`to` are [lng, lat] in the CANONICAL direction (used to define left/right
 * consistently). The caller is responsible for passing a canonical (low→high nodeId)
 * direction so that left/right are stable across bidirectional edge pairs.
 *
 * Returns { left, right } shade fractions (0–1), sampled at ±4 m perpendicular
 * offsets. These are assigned to separate parallel edges in the routing graph so
 * Dijkstra can pick the shaded sidewalk without any change to the core algorithm.
 */
function sampleBothSidewalks(
  projectFn: (lng: number, lat: number) => [number, number],
  imageData: ImageData,
  dpr: number,
  from: [number, number], // [lng, lat], canonical direction
  to: [number, number],
  samples = 5
): { left: number; right: number } {
  const { data, width, height } = imageData;

  const sampleLine = (oLng: number, oLat: number): number => {
    let shadeSum = 0;
    let count = 0;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const lng = from[0] + t * (to[0] - from[0]) + oLng;
      const lat = from[1] + t * (to[1] - from[1]) + oLat;
      const [px, py] = projectFn(lng, lat);
      const x = Math.round(px * dpr);
      const y = Math.round(py * dpr);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      // ShadeMap overlay #01112f: very dark (r+g+b~65), heavy blue (b/r>>1.8), b>>g.
      // Combined check rejects water, blue labels, and light basemap features.
      const isShaded =
        r + g + b < 200 &&
        (r === 0 ? b > 30 : b / r > 1.8) &&
        b > g * 1.5;
      shadeSum += isShaded ? 1 : 0;
      count++;
    }
    return count === 0 ? 0 : shadeSum / count;
  };

  const SIDEWALK_OFFSET_M = 4.0;
  const latMid = (from[1] + to[1]) / 2;
  const cosLat = Math.max(1e-10, Math.cos(latMid * Math.PI / 180));
  const dx = (to[0] - from[0]) * cosLat;
  const dy = to[1] - from[1];
  const len = Math.sqrt(dx * dx + dy * dy);

  let perpLng = 0, perpLat = 0;
  if (len > 1e-10) {
    perpLng = (-dy / len) * (SIDEWALK_OFFSET_M / (111195 * cosLat));
    perpLat = ( dx / len) * (SIDEWALK_OFFSET_M / 111195);
  }

  return {
    left:  sampleLine( perpLng,  perpLat),   // left  sidewalk of canonical direction
    right: sampleLine(-perpLng, -perpLat),   // right sidewalk of canonical direction
  };
}

/**
 * Computes solar intensity (0–1) proportional to sin(solar elevation angle).
 * Returns 0 at/below the horizon, ~1 at solar noon zenith.
 * Uses low-precision orbital mechanics accurate to ~1° — sufficient for
 * shade-routing weighting purposes.
 */
function computeSolarIntensity(date: Date, latDeg: number, lngDeg: number): number {
  const n = date.getTime() / 86400000 + 2440587.5 - 2451545.0; // days since J2000
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * (Math.PI / 180);
  const lambda = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * (Math.PI / 180);
  const epsilon = (23.439 - 0.0000004 * n) * (Math.PI / 180);
  const declination = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  const GMST = (280.46061837 + 360.98564736629 * n) % 360;
  const HA = ((GMST + lngDeg - Math.atan2(
    Math.cos(epsilon) * Math.sin(lambda), Math.cos(lambda)
  ) * (180 / Math.PI)) % 360) * (Math.PI / 180);
  const latRad = latDeg * (Math.PI / 180);
  const sinElev = Math.sin(latRad) * Math.sin(declination)
                + Math.cos(latRad) * Math.cos(declination) * Math.cos(HA);
  return Math.max(0, sinElev);
}


export default function Home() {
  const [date, setDate] = useState<Date>(() => todayAt(12));
  const [showSunLines, setShowSunLines] = useState(false);
  const [accumulation, setAccumulation] = useState<AccumulationOptions>({
    enabled: false,
    startDate: todayAt(6),
    endDate: todayAt(20),
    iterations: 32,
  });

  // Navigation state
  const [navMode, setNavMode] = useState(false);
  const [waypointA, setWaypointA] = useState<[number, number] | null>(null);
  const [waypointB, setWaypointB] = useState<[number, number] | null>(null);
  const [navRoutes, setNavRoutes] = useState<RouteOption[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [isCalculating, setIsCalculating] = useState(false);
  const [navError, setNavError] = useState<string | null>(null);
  const [routeSolarIntensity, setRouteSolarIntensity] = useState<number | null>(null);
  const [waypointALabel, setWaypointALabel] = useState<string | null>(null);
  const [waypointBLabel, setWaypointBLabel] = useState<string | null>(null);
  const [pendingSlot, setPendingSlot] = useState<'A' | 'B' | null>(null);
  const pendingSlotRef = useRef<'A' | 'B' | null>(null);
  pendingSlotRef.current = pendingSlot;

  const [saveModalRouteIndex, setSaveModalRouteIndex] = useState<number | null>(null);
  const [additionalWaypoints, setAdditionalWaypoints] = useState<[number, number][]>([]);
  const [savedRoutes, setSavedRoutes] = useState<SavedRoute[]>(() => getRoutes());
  const [savedFolders, setSavedFolders] = useState<SavedFolder[]>(() => getFolders());

  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [isLocating, setIsLocating] = useState(false);

  // Sketch drawing state (freehand points; optional address shown on hover)
  const [sketchPoints, setSketchPoints] = useState<SketchPoint[]>([]);
  const [drawMode, setDrawMode] = useState(false);
  const [navWarning, setNavWarning] = useState<string | null>(null);
  const [simplifiedWaypoints, setSimplifiedWaypoints] = useState<LatLng[] | null>(null);

  // Debug / log state
  const [mapZoom, setMapZoom] = useState(2);

  const [isPlaying, setIsPlaying] = useState(false);
  const [sliderMode, setSliderMode] = useState<"time" | "day">("time");
  const animTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Map center for passing to the timeline slider's sunrise/sunset calculation
  const [mapCenter, setMapCenter] = useState<[number, number] | null>(null);

  const [mapUtcOffsetMin, setMapUtcOffsetMin] = useState<number>(
    () => -new Date().getTimezoneOffset()
  );
  const mapUtcOffsetMinRef = useRef(mapUtcOffsetMin);
  mapUtcOffsetMinRef.current = mapUtcOffsetMin;

  // Hold the map instance in a ref so changes don't trigger re-renders
  const mapRef = useRef<maplibregl.Map | null>(null);

  // Refs so imperative callbacks always see current values without re-creating
  const waypointARef = useRef(waypointA);
  const waypointBRef = useRef(waypointB);
  const calcGenRef = useRef(0); // incremented on every waypoint-clear to cancel in-flight calculations
  const calcAbortRef = useRef<AbortController | null>(null);
  const waypointALabelRef = useRef(waypointALabel);
  const waypointBLabelRef = useRef(waypointBLabel);
  const dateRef = useRef(date);
  const sliderModeRef = useRef<"time" | "day">("time");
  const dragSlotRef     = useRef<'A' | 'B' | null>(null);
  const dragStartPos    = useRef<{ x: number; y: number } | null>(null);
  const dragActiveRef   = useRef(false);
  const ghostElRef      = useRef<HTMLDivElement | null>(null);
  waypointARef.current = waypointA;
  waypointBRef.current = waypointB;
  waypointALabelRef.current = waypointALabel;
  waypointBLabelRef.current = waypointBLabel;
  dateRef.current = date;
  sliderModeRef.current = sliderMode;
  const drawModeRef = useRef(drawMode);
  const sketchPointsRef = useRef(sketchPoints);
  drawModeRef.current = drawMode;
  sketchPointsRef.current = sketchPoints;

  // Keyboard shortcuts for draw mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't fire when typing in inputs
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if ((e.target as HTMLElement)?.isContentEditable) return;

      if (e.key === "d" || e.key === "D") {
        if (!e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          setDrawMode((prev) => {
            if (prev) {
              setSketchPoints([]);
              setNavWarning(null);
              setSimplifiedWaypoints(null);
            }
            return !prev;
          });
        }
      } else if (e.key === "Escape" && drawModeRef.current) {
        e.preventDefault();
        setDrawMode(false);
        setSketchPoints([]);
        setNavWarning(null);
        setSimplifiedWaypoints(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingSlot(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
    setMapZoom(map.getZoom()); // seed initial value
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

  const flyTo = useCallback((center: [number, number], zoom: number) => {
    mapRef.current?.flyTo({ center, zoom });
    // center is [lng, lat]
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

  const handleMapClick = useCallback(
    (coord: { lng: number; lat: number }, originalEvent?: MouseEvent) => {
      // Alt+click adds intermediate waypoint when A+B are already set
      if (originalEvent?.altKey && waypointARef.current && waypointBRef.current) {
        const lngLat: [number, number] = [coord.lng, coord.lat];
        setAdditionalWaypoints(prev => [...prev, lngLat]);
        setNavRoutes([]);
        setSelectedRouteIndex(0);
        return;
      }
      const slot = pendingSlotRef.current;
      if (!slot) return;
      setNavError(null);
      const lngLat: [number, number] = [coord.lng, coord.lat];
      const coordLabel = `${coord.lat.toFixed(3)}, ${coord.lng.toFixed(3)}`;
      if (slot === 'A') {
        setWaypointA(lngLat);
        setWaypointALabel(coordLabel);
        geocodeReverse(coord.lat, coord.lng).then((lbl) => { if (lbl) setWaypointALabel(lbl); });
        setPendingSlot(waypointBRef.current ? null : 'B');
      } else {
        setWaypointB(lngLat);
        setWaypointBLabel(coordLabel);
        geocodeReverse(coord.lat, coord.lng).then((lbl) => { if (lbl) setWaypointBLabel(lbl); });
        setPendingSlot(null);
      }
      setNavRoutes([]);
      setSelectedRouteIndex(0);
    },
    []
  );

  const handleClear = useCallback(() => {
    calcGenRef.current++;
    setIsCalculating(false);
    setWaypointA(null);
    setWaypointB(null);
    setWaypointALabel(null);
    setWaypointBLabel(null);
    setAdditionalWaypoints([]);
    setNavRoutes([]);
    setSelectedRouteIndex(0);
    setNavError(null);
    setRouteSolarIntensity(null);
    setPendingSlot(null);
    setDrawMode(false);
    setSketchPoints([]);
    setNavWarning(null);
    setSimplifiedWaypoints(null);
  }, []);

  function handleOpenSaveModal(routeIndex: number) {
    setSaveModalRouteIndex(routeIndex);
  }

  function handleConfirmSave(name: string, folderId: string | null) {
    if (saveModalRouteIndex === null) return;
    const route = navRoutes[saveModalRouteIndex];
    if (!route || !waypointA || !waypointB) return;
    const d = date;
    const dateIso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    createRoute({
      name,
      folderId,
      routeOption: route,
      waypointA,
      waypointB,
      waypointALabel: waypointALabel ?? null,
      waypointBLabel: waypointBLabel ?? null,
      additionalWaypoints: additionalWaypoints,
      timeOfDayMinutes: Math.floor(d.getHours() * 60 + d.getMinutes()),
      dateIso,
    });
    setSavedRoutes(getRoutes());
    setSavedFolders(getFolders());
    setSaveModalRouteIndex(null);
  }

  const handleLoadRoute = useCallback((saved: SavedRoute) => {
    setWaypointA(saved.waypointA);
    setWaypointB(saved.waypointB);
    setWaypointALabel(saved.waypointALabel);
    setWaypointBLabel(saved.waypointBLabel);
    setAdditionalWaypoints(saved.additionalWaypoints ?? []);
    setNavRoutes([saved.routeOption]);
    setSelectedRouteIndex(0);
    const d = new Date(saved.dateIso + "T00:00:00");
    d.setHours(Math.floor(saved.timeOfDayMinutes / 60), saved.timeOfDayMinutes % 60, 0, 0);
    setDate(d);
  }, []);

  const handleExportRoute = useCallback((routeIndex: number, format: "gpx" | "geojson") => {
    const route = navRoutes[routeIndex];
    if (!route) return;
    const name = route.label;
    if (format === "gpx") {
      downloadBlob(routeToGPX(route, name), `${name}.gpx`, "application/gpx+xml");
    } else {
      downloadBlob(routeToGeoJSON(route), `${name}.geojson`, "application/geo+json");
    }
  }, [navRoutes]);

  const handleRemoveAdditionalWaypoint = useCallback((index: number) => {
    setAdditionalWaypoints(prev => prev.filter((_, i) => i !== index));
    setNavRoutes([]);
    setSelectedRouteIndex(0);
  }, []);

  const handleDeleteSavedRoute = useCallback((id: string) => {
    deleteRoute(id);
    setSavedRoutes(getRoutes());
  }, []);

  const handleRenameSavedRoute = useCallback((id: string, name: string) => {
    updateRoute(id, { name });
    setSavedRoutes(getRoutes());
  }, []);

  const handleLocateMe = useCallback(() => {
    if (!navigator.geolocation) {
      setNavError("Geolocation is not supported by your browser.");
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const coords: [number, number] = [pos.coords.longitude, pos.coords.latitude];
        setUserLocation(coords);
        setIsLocating(false);
        mapRef.current?.flyTo({ center: coords, zoom: 15, speed: 1.4 });
      },
      () => {
        setNavError("Unable to get your location. Check browser permissions.");
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  const handleToggleNavMode = useCallback(() => {
    setNavMode((prev) => {
      if (prev) {
        setWaypointA(null);
        setWaypointB(null);
        setWaypointALabel(null);
        setWaypointBLabel(null);
        setAdditionalWaypoints([]);
        setNavRoutes([]);
        setSelectedRouteIndex(0);
        setNavError(null);
        setRouteSolarIntensity(null);
        setPendingSlot(null);
        setDrawMode(false);
        setSketchPoints([]);
        setNavWarning(null);
        setSimplifiedWaypoints(null);
      }
      return !prev;
    });
  }, []);

  const handleDrawModeToggle = useCallback(() => {
    setDrawMode((prev) => {
      // Always start from a clean sketch when entering draw mode, and also
      // clear when cancelling draw mode.
      if (!prev) {
        setSketchPoints([]);
        setNavWarning(null);
        setSimplifiedWaypoints(null);
      } else {
        // Cancel drawing
        setSketchPoints([]);
        setNavWarning(null);
        setSimplifiedWaypoints(null);
      }
      return !prev;
    });
  }, []);

  const handleSketchPointClick = useCallback((coord: LatLng) => {
    // Draw mode points should stay exactly where the user clicked.
    // We optionally reverse-geocode for a hover tooltip, but we DO NOT move
    // the point to a building centroid or Nominatim's representative coords.
    setSketchPoints((prev) => [...prev, { coord, address: null }]);

    // Prefer reverse-geocoding a building centroid when the click is inside a
    // building footprint (A/B-style “snap to building”, but without moving the
    // user’s drawn point). Falls back to the clicked coord.
    const map = mapRef.current;
    const centroid = map ? buildingCentroidAt(coord, map as unknown as MapBuildingQuery) : null;
    const target = centroid ?? coord;

    geocodeReverse(target[1], target[0]).then((label) => {
      if (!label) return;
      setSketchPoints((prev) => {
        if (prev.length === 0) return prev;
        const next = [...prev];
        // Find the most recent matching point that still needs an address.
        // This avoids races if the user clicks multiple points quickly.
        for (let i = next.length - 1; i >= 0; i--) {
          const p = next[i];
          if (
            p.address == null &&
            p.coord[0] === coord[0] &&
            p.coord[1] === coord[1]
          ) {
            next[i] = { coord: p.coord, address: label };
            break;
          }
        }
        return next;
      });
    });
  }, []);

  // -------------------------------------------------------------------------
  // Sketch routing helpers
  // -------------------------------------------------------------------------

  /** Clone a RoutingGraph so sketch routing can insert virtual nodes safely.
   *  (Overpass graphs are cached; we must not mutate cached objects.) */
  const cloneRoutingGraph = useCallback((graph: RoutingGraph): RoutingGraph => {
    const nodes = new Map(graph.nodes);
    const adj = new Map<number, GraphEdge[]>();
    for (const [id, edges] of graph.adj) {
      adj.set(id, edges.map((e) => ({ toId: e.toId, distanceM: e.distanceM, shadeFactor: e.shadeFactor })));
    }
    return { nodes, adj };
  }, []);

  /** Remove a virtual node (negative ID) inserted by snapToEdge/snapToReachableEdge. */
  const removeVirtualNode = useCallback((graph: RoutingGraph, vid: number) => {
    const vidEdges = graph.adj.get(vid);
    if (vidEdges) {
      for (const e of vidEdges) {
        const ownerEdges = graph.adj.get(e.toId);
        if (ownerEdges) {
          // remove all edges pointing at vid (there can be 1+)
          for (let i = ownerEdges.length - 1; i >= 0; i--) {
            if (ownerEdges[i].toId === vid) ownerEdges.splice(i, 1);
          }
        }
      }
    }
    graph.nodes.delete(vid);
    graph.adj.delete(vid);
  }, []);

  /**
   * Snap sketch waypoints to the routing graph in a way that prefers a single
   * connected component (so multi-leg routing doesn't fail on disconnected
   * courtyard/park paths).
   */
  const snapSketchWaypoints = useCallback((
    waypoints: LatLng[],
    graph: RoutingGraph,
    map: maplibregl.Map
  ): { snappedIds: number[]; snappedCoords: LatLng[] } => {
    // Internal snap only for routing; the drawn points remain unchanged in UI.
    const coords = waypoints.map((wp) => snapOutsideBuilding(wp, map as unknown as MapBuildingQuery));

    const snappedIds: number[] = [];
    const MAX_RESNAP_DIST_M = 250;

    // First point: snap normally.
    const firstId = snapToEdge(coords[0], graph, -1000);
    snappedIds.push(firstId);

    for (let i = 1; i < coords.length; i++) {
      const preferredComponent = bfsReachable(graph, snappedIds[i - 1]);

      const primaryVid = -1000 - i;
      let id = snapToEdge(coords[i], graph, primaryVid);

      if (!preferredComponent.has(id)) {
        // If snapToEdge inserted a virtual node, remove it before re-snapping.
        if (id < 0) removeVirtualNode(graph, id);

        const fallbackVid = -2000 - i;
        const fallback = snapToReachableEdge(coords[i], graph, preferredComponent, fallbackVid);
        if (!fallback) {
          throw new Error(
            `No walkable streets connected to your sketch near point ${i + 1}. Try drawing closer to streets.`
          );
        }
        if (fallback.distM > MAX_RESNAP_DIST_M) {
          throw new Error(
            `Point ${i + 1} is about ${Math.round(fallback.distM)} m from the nearest connected street. Try drawing closer to streets.`
          );
        }
        id = fallback.id;
      }

      snappedIds.push(id);
    }

    return { snappedIds, snappedCoords: coords };
  }, [removeVirtualNode]);

  const calculateSketchRoute = useCallback(async () => {
    const coords = sketchPoints.map((p) => p.coord);
    if (coords.length < 2) return;
    const map = mapRef.current;
    if (!map) { setNavError("Map not ready"); return; }

    setIsCalculating(true);
    setNavError(null);
    setNavWarning(null);

    await new Promise<void>((r) => setTimeout(r, 0));

    try {
      // 1. Simplify
      const simplified = simplifyPolyline(coords, 30);
      setSimplifiedWaypoints(simplified);

      // 2. Bounding box
      const bbox = sketchBoundingBox(simplified, 0.005);

      // 3. Fit map viewport to bbox if needed
      const currentBounds = map.getBounds();
      const bboxInView =
        currentBounds.getWest()  <= bbox.west  &&
        currentBounds.getEast()  >= bbox.east  &&
        currentBounds.getSouth() <= bbox.south &&
        currentBounds.getNorth() >= bbox.north;

      const [graph] = await Promise.all([
        fetchRoutingGraph(bbox.south, bbox.west, bbox.north, bbox.east),
        bboxInView
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              map.fitBounds(
                [[bbox.west, bbox.south], [bbox.east, bbox.north]] as [[number, number], [number, number]],
                { padding: 50, duration: 0 }
              );
              map.once("idle", resolve);
            }),
      ]);

      // 4. Gap detection warning
      const gaps = findSketchGaps(simplified, graph);
      if (gaps.length > 0) {
        const pointNums = gaps.map((i) => i + 1).join(", ");
        setNavWarning(
          `Your sketch crosses an area with no walkable roads near point ${pointNums} — the route may deviate there.`
        );
      }

      // 5. Read canvas for shade sampling
      const canvas = map.getCanvas();
      const tmp = document.createElement("canvas");
      tmp.width = canvas.width;
      tmp.height = canvas.height;
      const ctx2d = tmp.getContext("2d")!;
      ctx2d.drawImage(canvas, 0, 0);
      const imageData = ctx2d.getImageData(0, 0, tmp.width, tmp.height);
      const dpr = window.devicePixelRatio || 1;

      // Build fast projection function
      const _mX = (lng: number) => (lng + 180) / 360;
      const _mY = (lat: number) => {
        const s = Math.sin(lat * Math.PI / 180);
        return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
      };
      const _scale = Math.pow(2, map.getZoom()) * 512;
      const _mc = map.getCenter();
      const _cx = _mX(_mc.lng) * _scale;
      const _cy = _mY(_mc.lat) * _scale;
      const _W2 = canvas.width / dpr / 2;
      const _H2 = canvas.height / dpr / 2;
      const projectFast = (lng: number, lat: number): [number, number] => [
        _mX(lng) * _scale - _cx + _W2,
        _mY(lat) * _scale - _cy + _H2,
      ];

      // 6. Sample shade for each edge
      for (const [fromId, edges] of graph.adj) {
        const fromNode = graph.nodes.get(fromId);
        if (!fromNode) continue;
        for (const edge of edges) {
          const toNode = graph.nodes.get(edge.toId);
          if (!toNode) continue;
          const samples = Math.max(3, Math.ceil(edge.distanceM / 25));
          const shade = sampleBothSidewalks(
            projectFast, imageData, dpr,
            [fromNode.lon, fromNode.lat], [toNode.lon, toNode.lat], samples
          );
          edge.shadeFactor = Math.max(shade.left, shade.right);
        }
      }

      // 6b. Clone graph so we can safely insert virtual nodes for edge-snapping.
      //     (Overpass graphs are cached; we must not mutate the cached objects.)
      const sketchGraph = cloneRoutingGraph(graph);

      // 6c. Snap waypoints to edges + enforce a single connected component.
      //     This prevents multi-leg routing from failing when a waypoint snaps
      //     to a disconnected courtyard/park path.
      const { snappedIds } = snapSketchWaypoints(simplified, sketchGraph, map);

      // 7. Run multi-leg Dijkstra x3 variants
      const variants = [
        { label: "Shortest",     shadeStrength: 0.0 },
        { label: "Balanced",     shadeStrength: 0.5 },
        { label: "Most shaded",  shadeStrength: 1.0 },
      ] as const;

      const seen = new Set<string>();
      const options: RouteOption[] = [];
      for (const v of variants) {
        // Multi-leg routing with edge-snapped, connectivity-corrected waypoints.
        const fullPath: number[] = [];
        let totalDist = 0;
        let totalShadeDist = 0;
        let failed = false;

        for (let i = 0; i < snappedIds.length - 1; i++) {
          const leg = dijkstra(sketchGraph, snappedIds[i], snappedIds[i + 1], v.shadeStrength);
          if (!leg) { failed = true; break; }
          if (i === 0) fullPath.push(...leg.nodeIds);
          else fullPath.push(...leg.nodeIds.slice(1));
          totalDist += leg.distanceM;
          totalShadeDist += leg.distanceM * leg.shadeCoverage;
        }

        if (failed || fullPath.length < 2 || totalDist <= 0) continue;
        const key = fullPath.join(",");
        if (seen.has(key)) continue;
        seen.add(key);

        const geojson = graphToGeoJSON(fullPath, sketchGraph);
        const shadeCoverage = totalShadeDist / totalDist;
        options.push({
          label: v.label,
          geojson,
          distanceM: totalDist,
          shadeCoverage,
          longestContinuousShadeM: 0,
          shadeTransitions: 0,
          detourRatio: 1.0,
          turnCount: 0,
        });
      }

      if (options.length === 0) {
        throw new Error("No walkable path found along your sketch. Try drawing closer to streets.");
      }

      setNavRoutes(options);
      setSelectedRouteIndex(0);
    } catch (e) {
      setNavError(e instanceof Error ? e.message : "Route calculation failed");
    } finally {
      setIsCalculating(false);
    }
  }, [sketchPoints]);

  const handleSketchFinish = useCallback(() => {
    setDrawMode(false);
    calculateSketchRoute();
  }, [calculateSketchRoute]);

  const handleSetWaypointA = useCallback((coord: [number, number], label: string) => {
    setWaypointA(coord);
    setWaypointALabel(label);
    setNavRoutes([]);
    setSelectedRouteIndex(0);
    const map = mapRef.current;
    if (map) map.flyTo({ center: coord, zoom: Math.max(map.getZoom(), 15) });
  }, []);

  const handleSetWaypointB = useCallback((coord: [number, number], label: string) => {
    setWaypointB(coord);
    setWaypointBLabel(label);
    setNavRoutes([]);
    setSelectedRouteIndex(0);
    const map = mapRef.current;
    if (map) map.flyTo({ center: coord, zoom: Math.max(map.getZoom(), 15) });
  }, []);

  const handleUseLocationAsA = useCallback((coord: [number, number]) => {
    handleSetWaypointA(coord, "Your location");
  }, [handleSetWaypointA]);

  const handleUseLocationAsB = useCallback((coord: [number, number]) => {
    handleSetWaypointB(coord, "Your location");
  }, [handleSetWaypointB]);

  const handleSwapWaypoints = useCallback(() => {
    const a = waypointARef.current;
    const b = waypointBRef.current;
    const aLabel = waypointALabelRef.current;
    const bLabel = waypointBLabelRef.current;
    setWaypointA(b);
    setWaypointB(a);
    setWaypointALabel(bLabel);
    setWaypointBLabel(aLabel);
    setNavRoutes([]);
    setSelectedRouteIndex(0);
  }, []);

  const handleClearWaypointA = useCallback(() => {
    calcGenRef.current++;
    setIsCalculating(false);
    setWaypointA(null);
    setWaypointALabel(null);
    setNavRoutes([]);
    setSelectedRouteIndex(0);
  }, []);

  const handleMarkerDragEnd = useCallback(
    (slot: 'A' | 'B', coord: { lng: number; lat: number }) => {
      const lngLat: [number, number] = [coord.lng, coord.lat];
      const coordLabel = `${coord.lat.toFixed(3)}, ${coord.lng.toFixed(3)}`;
      setNavRoutes([]);
      setSelectedRouteIndex(0);
      if (slot === 'A') {
        setWaypointA(lngLat);
        setWaypointALabel(coordLabel);
        geocodeReverse(coord.lat, coord.lng).then((lbl) => { if (lbl) setWaypointALabel(lbl); });
      } else {
        setWaypointB(lngLat);
        setWaypointBLabel(coordLabel);
        geocodeReverse(coord.lat, coord.lng).then((lbl) => { if (lbl) setWaypointBLabel(lbl); });
      }
    },
    []
  );

  const handlePinDragStart = useCallback((slot: 'A' | 'B') => {
    dragSlotRef.current = slot;
    dragActiveRef.current = false;
    dragStartPos.current = null;

    const color = slot === 'A' ? '#22c55e' : '#ef4444';

    function onMove(e: PointerEvent) {
      const { clientX: x, clientY: y } = e;

      // Record start position on first move event
      if (!dragStartPos.current) {
        dragStartPos.current = { x, y };
        return;
      }

      const dx = x - dragStartPos.current.x;
      const dy = y - dragStartPos.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (!dragActiveRef.current && dist > 6) {
        // Crossed threshold — create ghost
        dragActiveRef.current = true;
        document.body.style.userSelect = 'none';

        const ghost = document.createElement('div');
        ghost.style.cssText = [
          'position:fixed',
          'pointer-events:none',
          'z-index:9999',
          'transform:translate(-50%, -100%)',
          'transition:none',
        ].join(';');
        ghost.innerHTML = `<svg width="24" height="28" viewBox="0 0 12 14" fill="${color}" xmlns="http://www.w3.org/2000/svg" style="filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))"><path d="M6 0C3.24 0 1 2.24 1 5c0 3.75 5 9 5 9s5-5.25 5-9c0-2.76-2.24-5-5-5zm0 6.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z"/></svg>`;
        ghost.style.left = x + 'px';
        ghost.style.top = y + 'px';
        document.body.appendChild(ghost);
        ghostElRef.current = ghost;
      }

      if (dragActiveRef.current && ghostElRef.current) {
        ghostElRef.current.style.left = x + 'px';
        ghostElRef.current.style.top = y + 'px';
      }
    }

    function onUp(e: PointerEvent) {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      document.body.style.userSelect = '';

      // Remove ghost
      if (ghostElRef.current) {
        ghostElRef.current.remove();
        ghostElRef.current = null;
      }

      if (!dragActiveRef.current) return; // was just a click, not a drag
      dragActiveRef.current = false;

      const currentSlot = dragSlotRef.current;
      if (!currentSlot) return;

      const map = mapRef.current;
      if (!map) return;

      const mapEl = map.getContainer();
      const rect = mapEl.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;

      // Only place if released over the map
      if (relX < 0 || relY < 0 || relX > rect.width || relY > rect.height) return;

      const lngLat = map.unproject([relX, relY]);
      handleMarkerDragEnd(currentSlot, { lng: lngLat.lng, lat: lngLat.lat });
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [handleMarkerDragEnd]);

  const handleClearWaypointB = useCallback(() => {
    calcGenRef.current++;
    setIsCalculating(false);
    setWaypointB(null);
    setWaypointBLabel(null);
    setNavRoutes([]);
    setSelectedRouteIndex(0);
  }, []);

  const calculateRoute = useCallback(async () => {
    const rawA = waypointARef.current;
    const rawB = waypointBRef.current;
    if (!rawA || !rawB) {
      return;
    }
    const map = mapRef.current;
    if (!map) {
      setNavError("Map not ready");
      return;
    }

    // Snap waypoints to outside any building they may be inside, so the routing
    // bbox always covers the streets around the building and snapToEdge finds a
    // nearby road rather than one on the far side of the structure.
    const a = snapOutsideBuilding(rawA, map as unknown as MapBuildingQuery);
    const b = snapOutsideBuilding(rawB, map as unknown as MapBuildingQuery);
    if (process.env.NODE_ENV !== "production") {
      if (a[0] !== rawA[0] || a[1] !== rawA[1])
        console.log(`[routing] waypoint A snapped out of building: [${rawA}] → [${a}]`);
      if (b[0] !== rawB[0] || b[1] !== rawB[1])
        console.log(`[routing] waypoint B snapped out of building: [${rawB}] → [${b}]`);
    }

    const myGen = ++calcGenRef.current;
    calcAbortRef.current?.abort();
    calcAbortRef.current = new AbortController();
    const calcSignal = calcAbortRef.current.signal;
    setIsCalculating(true);
    setNavError(null);

    // Yield to the browser so React can commit the "calculating" UI state and
    // paint before any heavy CPU work starts. This keeps INP < 200 ms — the
    // interaction response (showing the spinner) completes in one frame, and
    // the expensive Overpass fetch + shade sampling happen in subsequent tasks.
    await new Promise<void>((r) => setTimeout(r, 0));

    const t0 = performance.now();
    let graphFetchMs = 0;
    let canvasReadMs = 0;
    let shadeSampleMs = 0;
    let dijkstraMs = 0;

    try {
      // 1. Bounding box with adaptive padding (~0.3× straight-line, clamped 0.002°–0.004°)
      const straightLineDistM = haversineMeters(a, b);
      // Minimum 0.005° (~555 m) ensures streets on all sides of large buildings
      // (e.g. Palazzo Vecchio) are always included even when a waypoint is
      // placed inside the building footprint.
      const basePadding = Math.max(0.005, Math.min(0.008, straightLineDistM / 111000 * 0.3));
      const padding = basePadding;
      const allLats = [a[1], b[1], ...additionalWaypoints.map(w => w[1])];
      const allLngs = [a[0], b[0], ...additionalWaypoints.map(w => w[0])];
      const south = Math.min(...allLats) - padding;
      const north = Math.max(...allLats) + padding;
      const west = Math.min(...allLngs) - padding;
      const east = Math.max(...allLngs) + padding;

      // 2. Fetch road graph; fit viewport only when the route bbox isn't already
      //    fully visible. fitBounds + map.once("idle") waits for all tiles to load
      //    before canvas capture — this is necessary to avoid shadeFactor=0 on
      //    off-screen edges, but is expensive when tiles are already present.
      //    Skipping it when the bbox is already visible saves 5–30 s per call.
      const tFetch = performance.now();
      const currentBounds = map.getBounds();
      const bboxInView =
        currentBounds.getWest()  <= west  &&
        currentBounds.getEast()  >= east  &&
        currentBounds.getSouth() <= south &&
        currentBounds.getNorth() >= north;

      const [graph] = await Promise.all([
        fetchRoutingGraph(south, west, north, east, calcSignal),
        bboxInView
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              map.fitBounds(
                [[west, south], [east, north]] as [[number, number], [number, number]],
                { padding: 50, duration: 0 }
              );
              map.once("idle", resolve);
            }),
      ]);
      graphFetchMs = performance.now() - tFetch;

      // 3. Read canvas once for shade sampling.
      //    With preserveDrawingBuffer:true the WebGL framebuffer is stable;
      //    drawImage transfers it directly to a 2D canvas without the
      //    toBlob → PNG-encode → createImageBitmap → PNG-decode round-trip
      //    that was adding 1–3 s on retina displays.
      const tCanvas = performance.now();
      const canvas = map.getCanvas();
      const tmp = document.createElement("canvas");
      tmp.width = canvas.width;
      tmp.height = canvas.height;
      const ctx2d = tmp.getContext("2d")!;
      ctx2d.drawImage(canvas, 0, 0);
      const imageData = ctx2d.getImageData(0, 0, tmp.width, tmp.height);
      const dpr = window.devicePixelRatio || 1;
      canvasReadMs = performance.now() - tCanvas;

      // Build fast inline Mercator projection (avoids map.project() allocations per sample)
      const _mX = (lng: number) => (lng + 180) / 360;
      const _mY = (lat: number) => {
        const s = Math.sin(lat * Math.PI / 180);
        return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
      };
      const _scale = Math.pow(2, map.getZoom()) * 512;
      const _mc = map.getCenter();
      const _cx = _mX(_mc.lng) * _scale;
      const _cy = _mY(_mc.lat) * _scale;
      const _W2 = canvas.width / dpr / 2;
      const _H2 = canvas.height / dpr / 2;
      const projectFast = (lng: number, lat: number): [number, number] => [
        _mX(lng) * _scale - _cx + _W2,
        _mY(lat) * _scale - _cy + _H2,
      ];

      // 4. Remove virtual nodes from a prior run on this cached graph.
      //    Done before shade sampling so the base graph is clean.
      for (const vid of [-1, -2]) {
        const vidEdges = graph.adj.get(vid);
        if (!vidEdges) continue;
        for (const e of vidEdges) {
          const ownerEdges = graph.adj.get(e.toId);
          if (ownerEdges) {
            const i = ownerEdges.findIndex((oe) => oe.toId === vid);
            if (i !== -1) ownerEdges.splice(i, 1);
          }
        }
        graph.nodes.delete(vid);
        graph.adj.delete(vid);
      }

      // Yield before shade sampling so the browser can paint any pending frames
      // (e.g. ShadeMap rAF renders, animation ticks) before we monopolise the
      // main thread with the per-edge pixel sampling loop.
      if (myGen !== calcGenRef.current) return;
      await new Promise<void>((r) => setTimeout(r, 0));
      if (myGen !== calcGenRef.current) return;

      // 5. Sample shade for each undirected edge (once per unordered pair).
      //    Canonical direction is low-nodeId → high-nodeId so left/right are
      //    consistent across the two directed copies of each undirected edge.
      const tShade = performance.now();
      let directedEdgeCount = 0;
      const edgeShadeCache = new Map<string, { left: number; right: number }>();

      for (const [fromId, edges] of graph.adj) {
        if (fromId < 0) continue;
        const fromNode = graph.nodes.get(fromId)!;
        for (const edge of edges) {
          if (edge.toId < 0) continue;
          const toNode = graph.nodes.get(edge.toId);
          if (!toNode) continue;
          directedEdgeCount++;
          const lo = Math.min(fromId, edge.toId);
          const hi = Math.max(fromId, edge.toId);
          const key = `${lo},${hi}`;
          if (edgeShadeCache.has(key)) continue;
          // Sample density: ~1 sample per 25 m, minimum 3.
          const samples = Math.max(3, Math.ceil(edge.distanceM / 25));
          // Canonical from/to (low→high nodeId) for consistent left/right.
          const canonFrom: [number, number] = fromId < edge.toId
            ? [fromNode.lon, fromNode.lat] : [toNode.lon, toNode.lat];
          const canonTo: [number, number] = fromId < edge.toId
            ? [toNode.lon, toNode.lat] : [fromNode.lon, fromNode.lat];
          edgeShadeCache.set(key, sampleBothSidewalks(projectFast, imageData, dpr, canonFrom, canonTo, samples));
        }
      }
      shadeSampleMs = performance.now() - tShade;

      // 6. Build a sidewalk-level routing graph.
      //    Each undirected edge becomes TWO parallel directed edges per direction
      //    (one per sidewalk), so Dijkstra naturally picks the shadier sidewalk
      //    without any change to the core algorithm. The base graph (graph.adj)
      //    is never mutated here, keeping the cache clean between calls.
      //
      //    Left/right assignment for directed edge fromId→toId:
      //      canonical (fromId < toId): left = canonical-left, right = canonical-right
      //      reverse   (fromId > toId): left = canonical-right (their left when reversed)
      const tDijkstra = performance.now();
      const routingAdj = new Map<number, GraphEdge[]>();
      const ensureRA = (id: number) => { if (!routingAdj.has(id)) routingAdj.set(id, []); };

      for (const [fromId, edges] of graph.adj) {
        if (fromId < 0) continue;
        ensureRA(fromId);
        for (const edge of edges) {
          if (edge.toId < 0) continue;
          if (!graph.nodes.has(edge.toId)) continue;
          const lo = Math.min(fromId, edge.toId);
          const hi = Math.max(fromId, edge.toId);
          const { left, right } = edgeShadeCache.get(`${lo},${hi}`) ?? { left: 0, right: 0 };
          const isCanonical = fromId < edge.toId;
          const shadeA = isCanonical ? left : right;
          const shadeB = isCanonical ? right : left;
          routingAdj.get(fromId)!.push(
            { toId: edge.toId, distanceM: edge.distanceM, shadeFactor: shadeA },
            { toId: edge.toId, distanceM: edge.distanceM, shadeFactor: shadeB },
          );
        }
      }
      const routingGraph: RoutingGraph = { nodes: graph.nodes, adj: routingAdj };
      const spatialGrid = new SpatialGrid(routingGraph.nodes);

      // Snap waypoints to nearest edge in the routing graph.
      // snapToEdge inserts virtual nodes into routingAdj (not graph.adj).
      const startId = snapToEdge(a, routingGraph, -1);
      const endId   = snapToEdge(b, routingGraph, -2);
      if (process.env.NODE_ENV !== "production") {
        const snapA = routingGraph.nodes.get(startId);
        const snapB = routingGraph.nodes.get(endId);
        if (snapA) console.log(`[routing] A [${a}] snapped to road at [${snapA.lon},${snapA.lat}] (${haversineMeters(a, [snapA.lon, snapA.lat]).toFixed(1)} m)`);
        if (snapB) console.log(`[routing] B [${b}] snapped to road at [${snapB.lon},${snapB.lat}] (${haversineMeters(b, [snapB.lon, snapB.lat]).toFixed(1)} m)`);
      }

      // Connectivity fallback: if a waypoint snapped to a dead-end segment
      // (e.g. an OSM path inside a walled courtyard, disconnected from the
      // street network), re-snap to the nearest REACHABLE edge instead.
      const removeVirtual = (vid: number) => {
        // Only visit nodes the virtual node is connected to (O(1) typical)
        const vidEdges = routingGraph.adj.get(vid);
        if (vidEdges) {
          for (const e of vidEdges) {
            const ownerEdges = routingGraph.adj.get(e.toId);
            if (ownerEdges) {
              const i = ownerEdges.findIndex((oe) => oe.toId === vid);
              if (i !== -1) ownerEdges.splice(i, 1);
            }
          }
        }
        routingGraph.nodes.delete(vid);
        routingGraph.adj.delete(vid);
      };

      const MAX_SNAP_DIST_M = 100;
      let effectiveStartId = startId;
      let effectiveEndId   = endId;

      const reachableFromEnd = bfsReachable(routingGraph, endId);
      if (!reachableFromEnd.has(startId)) {
        removeVirtual(-1);
        const fallback = snapToReachableEdge(a, routingGraph, reachableFromEnd, -1);
        if (!fallback) {
          throw new Error(
            "The start point is in an area with no walkable streets nearby. Move it to a street or public footpath."
          );
        }
        if (fallback.distM > MAX_SNAP_DIST_M) {
          throw new Error(
            `The start point is ${Math.round(fallback.distM)} m from the nearest walkable street. Move it closer to a street.`
          );
        }
        effectiveStartId = fallback.id;
        if (process.env.NODE_ENV !== "production") {
          const sn = routingGraph.nodes.get(effectiveStartId);
          if (sn) console.log(`[routing] A re-snapped to connected road at [${sn.lon},${sn.lat}] (${fallback.distM.toFixed(1)} m)`);
        }
      }

      // Check end is also reachable (handles the symmetric case where B is isolated).
      const reachableFromStart = bfsReachable(routingGraph, effectiveStartId);
      if (!reachableFromStart.has(effectiveEndId)) {
        removeVirtual(-2);
        const fallback = snapToReachableEdge(b, routingGraph, reachableFromStart, -2);
        if (!fallback) {
          throw new Error(
            "The destination is in an area with no walkable streets nearby. Move it to a street or public footpath."
          );
        }
        if (fallback.distM > MAX_SNAP_DIST_M) {
          throw new Error(
            `The destination is ${Math.round(fallback.distM)} m from the nearest walkable street. Move it closer to a street.`
          );
        }
        effectiveEndId = fallback.id;
        if (process.env.NODE_ENV !== "production") {
          const sn = routingGraph.nodes.get(effectiveEndId);
          if (sn) console.log(`[routing] B re-snapped to connected road at [${sn.lon},${sn.lat}] (${fallback.distM.toFixed(1)} m)`);
        }
      }

      // 7. Compute solar context and run adaptive Dijkstra.
      const midLat = (a[1] + b[1]) / 2;
      const midLng = (a[0] + b[0]) / 2;
      const solarIntensity = computeSolarIntensity(dateRef.current, midLat, midLng);
      const CROSSING_PENALTY_M = 15; // ~15s wait at exposed intersection
      const opts = { crossingPenaltyM: CROSSING_PENALTY_M, solarIntensity, straightLineDistM };

      let options: RouteOption[];

      if (additionalWaypoints.length === 0) {
        // Standard A→B pareto routing
        const paretoResults = paretoRoutes(routingGraph, effectiveStartId, effectiveEndId, opts);
        dijkstraMs = performance.now() - tDijkstra;

        const ROUTE_LABELS = ["Shortest", "Balanced", "Most shaded"] as const;
        options = paretoResults.map((result, i) => ({
          label: ROUTE_LABELS[i] ?? "Route",
          geojson: graphToGeoJSON(result.nodeIds, routingGraph),
          distanceM: result.distanceM,
          shadeCoverage: result.shadeCoverage,
          longestContinuousShadeM: result.longestContinuousShadeM,
          shadeTransitions: result.shadeTransitions,
          detourRatio: result.detourRatio,
          turnCount: result.turnCount,
        }));
      } else {
        // Multi-point routing: A → W[0] → ... → W[n-1] → B
        // Snap intermediate waypoints to nearest graph nodes
        const midNodeIds = additionalWaypoints.map(wp =>
          snapToGraph(wp, routingGraph, spatialGrid)
        );
        const nodeChain = [effectiveStartId, ...midNodeIds, effectiveEndId];

        const MULTI_LABELS = ["Shortest", "Balanced", "Most shaded"] as const;
        const STRENGTHS = [0, 0.5, 1.0];
        options = [];

        for (let si = 0; si < STRENGTHS.length; si++) {
          const strength = STRENGTHS[si];
          let totalDist = 0;
          let totalShadeDist = 0;
          const allCoords: [number, number][] = [];
          let failed = false;

          for (let seg = 0; seg < nodeChain.length - 1; seg++) {
            const segResult = dijkstra(routingGraph, nodeChain[seg], nodeChain[seg + 1], strength, opts);
            if (!segResult) { failed = true; break; }
            const coords = graphToGeoJSON(segResult.nodeIds, routingGraph).geometry.coordinates as [number, number][];
            if (allCoords.length > 0) coords.shift(); // remove duplicate junction node
            allCoords.push(...coords);
            totalDist += segResult.distanceM;
            totalShadeDist += segResult.distanceM * segResult.shadeCoverage;
          }

          if (failed || allCoords.length < 2) continue;

          const shadeCov = totalDist > 0 ? totalShadeDist / totalDist : 0;
          options.push({
            label: MULTI_LABELS[si] ?? "Route",
            geojson: {
              type: "Feature",
              properties: {},
              geometry: { type: "LineString", coordinates: allCoords },
            },
            distanceM: totalDist,
            shadeCoverage: shadeCov,
            longestContinuousShadeM: 0,
            shadeTransitions: 0,
            detourRatio: 1.0,
            turnCount: 0,
          });
        }

        dijkstraMs = performance.now() - tDijkstra;

        // Deduplicate by distance (same approach as paretoRoutes)
        options = options.filter((o, i, arr) =>
          arr.findIndex(x => Math.abs(x.distanceM - o.distanceM) < 1) === i
        );
      }

      if (options.length === 0)
        throw new Error(
          "No walkable path found between the selected points. Try points on connected streets."
        );

      // Train transit routing (any city with subway/light_rail in OSM)
      if (straightLineDistM <= 500) {
        if (import.meta.env.DEV) console.log("[transit] Skipped: straight-line distance", straightLineDistM.toFixed(0), "m <= 500 m");
      }
      if (straightLineDistM > 500) {
        try {
          // Expanded bbox (~1.5km beyond waypoints) to catch nearby stations
          const trainPadding = Math.max(padding, 0.015);
          const trainSouth = Math.min(a[1], b[1]) - trainPadding;
          const trainNorth = Math.max(a[1], b[1]) + trainPadding;
          const trainWest  = Math.min(a[0], b[0]) - trainPadding;
          const trainEast  = Math.max(a[0], b[0]) + trainPadding;

          if (import.meta.env.DEV) console.log("[transit] Fetching train graph for bbox:", { trainSouth, trainWest, trainNorth, trainEast });
          const [trainGraph, entrances] = await Promise.all([
            fetchTrainGraph(trainSouth, trainWest, trainNorth, trainEast, calcSignal),
            fetchStationEntrances(trainSouth, trainWest, trainNorth, trainEast, calcSignal),
          ]);
          if (import.meta.env.DEV) console.log("[transit] trainGraph:", trainGraph ? `${trainGraph.stations.size} stations, ${trainGraph.lineColors.size} lines` : "null");
          if (import.meta.env.DEV) console.log("[transit] entrances:", entrances.length);

          if (trainGraph && trainGraph.stations.size >= 2) {
            // Match OSM entrances to train stations for accurate walk targets.
            // IMPORTANT: default to OSM *entrance* nodes (railway=subway_entrance)
            // when available; only fall back to station centroids when no entrances
            // can be matched.
            const stationEntrances = new Map<number, { lat: number; lon: number; kind?: "entrance" | "station" }[]>();
            for (const entrance of entrances) {
              const stationId = matchEntranceToTrainStation(entrance, trainGraph.stations);
              if (stationId != null) {
                if (!stationEntrances.has(stationId)) stationEntrances.set(stationId, []);
                stationEntrances.get(stationId)!.push({ lat: entrance.lat, lon: entrance.lon, kind: entrance.kind });
              }
            }
            // Fallback: station centroid when no entrance found
            for (const [id, station] of trainGraph.stations) {
              if (!stationEntrances.has(id)) {
                stationEntrances.set(id, [{ lat: station.lat, lon: station.lon, kind: "station" }]);
              }
            }

            // Find best Walk → Train → Walk route
            const bestTrain = findBestTrainRoute(a, b, trainGraph);
            if (import.meta.env.DEV) console.log("[transit] bestTrain:", bestTrain ? `entry=${bestTrain.entryStation.name}, exit=${bestTrain.exitStation.name}, ${bestTrain.path.stationIds.length} stations, ${bestTrain.path.segments.length} segments` : "null");

            if (bestTrain) {
              // Compute walk legs with shade routing
              const WALK_SHADE_STRENGTH = 0.5;

              // Pick closest *entrance* to A for boarding station (fallback: station node)
              const boardCandidates = stationEntrances.get(bestTrain.entryStation.id) ?? [{ ...bestTrain.entryStation, kind: "station" }];
              const boardEntrance = pickClosestEntrance(a, boardCandidates);

              // Pick closest *entrance* to B for alighting station (fallback: station node)
              const alightCandidates = stationEntrances.get(bestTrain.exitStation.id) ?? [{ ...bestTrain.exitStation, kind: "station" }];
              const alightEntrance = pickClosestEntrance(b, alightCandidates);

              // Walk leg A → boarding entrance
              const boardNodeId = snapToGraph([boardEntrance.lon, boardEntrance.lat], routingGraph, spatialGrid);
              const walkA = dijkstra(routingGraph, effectiveStartId, boardNodeId, WALK_SHADE_STRENGTH, opts);
              if (import.meta.env.DEV) console.log("[transit] walkA:", walkA ? `${walkA.distanceM.toFixed(0)}m` : "null", "boardNodeId:", boardNodeId);

              // Walk leg alighting entrance → B
              const alightNodeId = snapToGraph([alightEntrance.lon, alightEntrance.lat], routingGraph, spatialGrid);
              const walkB = dijkstra(routingGraph, alightNodeId, effectiveEndId, WALK_SHADE_STRENGTH, opts);
              if (import.meta.env.DEV) console.log("[transit] walkB:", walkB ? `${walkB.distanceM.toFixed(0)}m` : "null", "alightNodeId:", alightNodeId);

              if (!walkA || !walkB) {
                if (import.meta.env.DEV) console.warn("[transit] Walk leg failed:", !walkA ? "walkA=null" : "", !walkB ? "walkB=null" : "");
              }
              if (walkA && walkB) {
                const walkAGeoJSON = graphToGeoJSON(walkA.nodeIds, routingGraph);
                const walkBGeoJSON = graphToGeoJSON(walkB.nodeIds, routingGraph);

                // Transit leg GeoJSON (station centroids in path order)
                const transitCoords: [number, number][] = bestTrain.path.stationIds.map(id => {
                  const s = trainGraph.stations.get(id)!;
                  return [s.lon, s.lat];
                });
                const transitGeoJSON: GeoJSON.Feature<GeoJSON.LineString> = {
                  type: "Feature",
                  properties: {},
                  geometry: { type: "LineString", coordinates: transitCoords },
                };

                // Station names for UI
                const stopNames = bestTrain.path.stationIds.map(id =>
                  trainGraph.stations.get(id)?.name ?? `Station ${id}`
                );

                // Line info for rendering
                const primaryLine = bestTrain.path.lines[0] ?? '';
                const lineColor = trainGraph.lineColors.get(primaryLine) ?? '#0070BD';
                const lineName = trainGraph.lineNames.get(primaryLine) ?? primaryLine;
                const lineMode = trainGraph.lineModes.get(primaryLine) ?? 'subway';
                const sunExposure = TRAIN_SUN_EXPOSURE[lineMode];

                // Estimate transit travel time (~30 km/h average for urban rail)
                const TRAIN_SPEED_MS = 30 * 1000 / 3600; // ~8.3 m/s
                const transitTimeSec = bestTrain.path.totalDistM / TRAIN_SPEED_MS;

                const legs: RouteLeg[] = [
                  {
                    type: 'walk',
                    geojson: walkAGeoJSON,
                    distanceM: walkA.distanceM,
                    shadeCoverage: walkA.shadeCoverage,
                  },
                  {
                    type: 'transit',
                    geojson: transitGeoJSON,
                    travelTimeSec: transitTimeSec,
                    line: primaryLine,
                    lineColor,
                    lineName,
                    sunExposure,
                    stops: stopNames,
                  },
                  {
                    type: 'walk',
                    geojson: walkBGeoJSON,
                    distanceM: walkB.distanceM,
                    shadeCoverage: walkB.shadeCoverage,
                  },
                ];

                const WALK_SPEED_MS = 1.4;
                const totalWalkDistM = walkA.distanceM + walkB.distanceM;
                const totalTimeSec = totalWalkDistM / WALK_SPEED_MS + transitTimeSec;
                const shadeCov = totalWalkDistM > 0
                  ? (walkA.distanceM * walkA.shadeCoverage + walkB.distanceM * walkB.shadeCoverage) / totalWalkDistM
                  : 0;

                const combinedGeoJSON: GeoJSON.Feature<GeoJSON.LineString> = {
                  type: "Feature",
                  properties: {},
                  geometry: {
                    type: "LineString",
                    coordinates: [
                      ...walkAGeoJSON.geometry.coordinates,
                      ...walkBGeoJSON.geometry.coordinates,
                    ],
                  },
                };

                // Build multi-colored draw data from route segments
                const drawData = buildTrainDrawData(
                  bestTrain.path.segments,
                  trainGraph.lineColors,
                );

                options.push({
                  label: "Via Transit",
                  geojson: combinedGeoJSON,
                  distanceM: totalWalkDistM,
                  shadeCoverage: shadeCov,
                  longestContinuousShadeM: 0,
                  shadeTransitions: 0,
                  detourRatio: 1.0,
                  turnCount: 0,
                  legs,
                  totalTimeSec,
                  mrtEntrances: [
                    [boardEntrance.lon, boardEntrance.lat] as [number, number],
                    [alightEntrance.lon, alightEntrance.lat] as [number, number],
                  ],
                  trainDrawData: drawData,
                });
              }
            }
          }
        } catch (e) {
          // Train routing failure is non-critical — walk-only routes still available
          console.error("[routing] Train routing failed:", e);
        }
      }

      // 7. Record metrics before updating state
      const routeSnapshots = options.map((o) => ({
        label: o.label,
        distanceM: o.distanceM,
        shadeCoverage: o.shadeCoverage,
      }));
      const { shadeCoverageGainPp, pathLengthDeltaPct } =
        computeDerivedKpis(routeSnapshots);
      recordRoutingRun({
        timestamp: Date.now(),
        phases: {
          graphFetch: graphFetchMs,
          canvasRead: canvasReadMs,
          shadeSample: shadeSampleMs,
          dijkstra: dijkstraMs,
          total: performance.now() - t0,
        },
        graphNodeCount: graph.nodes.size,
        graphDirectedEdges: directedEdgeCount,
        routes: routeSnapshots,
        routeComputeMs: performance.now() - t0,
        shadeCoverageGainPp,
        pathLengthDeltaPct,
      });

      // 8. Update state — bail if a waypoint was removed while we were computing
      if (calcGenRef.current !== myGen) return;
      setNavRoutes(options);
      setSelectedRouteIndex(0);
      setRouteSolarIntensity(solarIntensity);
      setSketchPoints([]);
      setNavWarning(null);
      setSimplifiedWaypoints(null);
    } catch (e) {
      // Silently ignore aborted calculations (user re-clicked "Find Shaded Route")
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (calcSignal.aborted) return;
      setNavError(e instanceof Error ? e.message : "Routing failed");
    } finally {
      // Reset spinner only if no newer calculation has taken over the slot.
      // A newer calculateRoute call increments calcGenRef before its own
      // setIsCalculating(true), so this guard avoids clobbering that call.
      if (calcGenRef.current === myGen) setIsCalculating(false);
    }
  }, [additionalWaypoints]);

  // In draw mode with 2+ points, "Find Shaded Route" runs sketch routing; otherwise A/B routing.
  // Turn off drawing mode when user presses Find Shaded Route after drawing a route.
  const handleCalculateRoute = useCallback(() => {
    const useSketch = drawModeRef.current && sketchPointsRef.current.length >= 2;
    if (useSketch) {
      // Address resolution is optional; it only affects hover tooltips.
      // We intentionally do not block routing when reverse geocoding is pending.
      setDrawMode(false);
      calculateSketchRoute();
    } else {
      calculateRoute();
    }
  }, [calculateRoute, calculateSketchRoute]);

  const selectedRoute = navRoutes[selectedRouteIndex];
  // For MRT routes with legs: render walk legs as amber lines
  // For walk-only / hybrid routes: use the single geojson
  const selectedNavRoute = selectedRoute?.legs
    ? ({
        type: "FeatureCollection",
        features: selectedRoute.legs
          .filter((l: RouteLeg) => l.type === 'walk')
          .map((l: RouteLeg) => l.geojson),
      } as GeoJSON.FeatureCollection)
    : navRoutes[selectedRouteIndex]?.geojson ?? null;
  // Multi-colored train draw data for MapView rendering
  const navTrainDrawData = selectedRoute?.trainDrawData ?? null;

  // Transit entrance pins — shown when selected route has transit legs
  const navMrtEntrances = selectedRoute?.mrtEntrances ?? null;

  const { hours: _localH, minutes: _localM, year: _localYear } = toMapLocal(date, mapUtcOffsetMin);
  const mapLocalMins = _localH * 60 + _localM;

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#0a0a0a]">
      {/* Full-screen map */}
      <Suspense fallback={null}>
        <MapView
          date={date}
          accumulation={accumulation}
          onMapReady={handleMapReady}
          onMapClick={handleMapClick}
          navWaypoints={{ a: waypointA ?? undefined, b: waypointB ?? undefined }}
          navRoute={selectedNavRoute}
          showSunLines={showSunLines}
          mapClickActive={pendingSlot !== null}
          onMarkerDragEnd={handleMarkerDragEnd}
          navTrainDrawData={navTrainDrawData}
          navMrtEntrances={navMrtEntrances}
          additionalWaypoints={additionalWaypoints}
          userLocation={userLocation}
          drawMode={drawMode}
          sketchPoints={sketchPoints}
          onSketchPointClick={handleSketchPointClick}
          onSketchFinish={handleSketchFinish}
          simplifiedWaypoints={simplifiedWaypoints}
        />
      </Suspense>

      {/* Pending waypoint selection banner */}
      {pendingSlot && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 pointer-events-none flex items-center gap-2 bg-black/80 backdrop-blur-md border border-amber-400/40 rounded-full px-4 py-1.5 text-sm text-amber-300 select-none">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0" />
          Click map to place waypoint {pendingSlot}
          <span className="text-white/30 text-xs ml-1">— Esc to cancel</span>
        </div>
      )}

      {/* Top-left overlay: search — hidden when nav sidebar is active (it moves inside sidebar) */}
      {!navMode && (
        <div className="absolute top-3 left-3 z-10 flex flex-col gap-2">
          <LocationSearch onSelect={flyTo} />
        </div>
      )}

      {/* Full-width timeline ruler + controls */}
      {!accumulation.enabled && (
        <div className="absolute bottom-0 left-0 right-0 z-10 bg-black/70 backdrop-blur-sm border-t border-white/10">
          {/* Floating tooltip — shows time in time mode, month name in month mode */}
          <div
            className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none z-20"
            style={{ bottom: "calc(100% + 6px)" }}
          >
            <div className="bg-amber-500 text-black text-[11px] font-bold px-2.5 py-0.5 rounded-md tabular-nums shadow-md whitespace-nowrap">
              {sliderMode === "time"
                ? formatTime12h(date, mapUtcOffsetMin)
                : new Date(date.getTime() + mapUtcOffsetMin * 60000)
                    .toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
            </div>
            <div
              style={{
                width: 0,
                height: 0,
                borderLeft: "5px solid transparent",
                borderRight: "5px solid transparent",
                borderTop: "5px solid #f59e0b",
              }}
            />
          </div>

          {/* Ruler — time or day of year */}
          {sliderMode === "time" ? (
            <TimelineSlider
              minutes={mapLocalMins}
              onChange={handleSliderChange}
              date={date}
              latDeg={mapCenter?.[0]}
              lngDeg={mapCenter?.[1]}
              utcOffsetMin={mapUtcOffsetMin}
            />
          ) : (
            <DaySlider
              dayOfYear={dateToDayOfYear(date, mapUtcOffsetMin)}
              year={_localYear}
              onChange={handleDayOfYearChange}
            />
          )}

          {/* Controls row */}
          <div className="flex items-center justify-center gap-3 px-4 py-2">
            {/* Play/pause */}
            <button
              onClick={() => setIsPlaying((p) => !p)}
              className="text-white/60 hover:text-amber-400 transition-colors flex items-center justify-center w-11 h-11 rounded-lg hover:bg-white/5"
              title={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? (
                <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor" aria-hidden="true">
                  <rect x="0" y="0" width="3.5" height="12" rx="0.75" />
                  <rect x="6.5" y="0" width="3.5" height="12" rx="0.75" />
                </svg>
              ) : (
                <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor" aria-hidden="true">
                  <path d="M0 0L10 6L0 12Z" />
                </svg>
              )}
            </button>

            {/* Slider mode toggle — clock (time) / calendar (day) */}
            <button
              onClick={() => setSliderMode((m) => m === "time" ? "day" : "time")}
              className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg bg-white/[0.05] hover:bg-white/10 border border-white/[0.08] transition-colors"
              title={sliderMode === "time" ? "Switch to day of year" : "Switch to time of day"}
            >
              {/* Clock icon */}
              <svg
                className={sliderMode === "time" ? "text-amber-400" : "text-white/30"}
                width="12" height="12" viewBox="0 0 12 12" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
              >
                <circle cx="6" cy="6" r="5" />
                <polyline points="6,3.5 6,6 7.5,7.5" />
              </svg>
              <span className="text-[9px] text-white/25">/</span>
              {/* Calendar icon */}
              <svg
                className={sliderMode === "day" ? "text-amber-400" : "text-white/30"}
                width="12" height="12" viewBox="0 0 12 12" fill="none"
                stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
              >
                <rect x="1" y="2" width="10" height="9" rx="1" />
                <line x1="1" y1="5" x2="11" y2="5" />
                <line x1="4" y1="1" x2="4" y2="3" />
                <line x1="8" y1="1" x2="8" y2="3" />
              </svg>
            </button>

            {/* Date / time inputs (time mode) or year picker (day mode) */}
            {sliderMode === "time" ? (
              <>
                <DateInput date={date} onChange={setDate} utcOffsetMin={mapUtcOffsetMin} />
                <TimeInput date={date} onChange={setDate} utcOffsetMin={mapUtcOffsetMin} />
              </>
            ) : (
              <div className="flex items-center gap-1">
                <button
                  onClick={() => adjustYear(-1)}
                  className="text-white/50 hover:text-white/90 transition-colors w-9 h-9 flex items-center justify-center rounded-lg hover:bg-white/5"
                  aria-label="Previous year"
                >
                  <svg width="6" height="10" viewBox="0 0 6 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="5,1 1,5 5,9" />
                  </svg>
                </button>
                <span className="text-white/70 text-sm tabular-nums w-12 text-center">
                  {_localYear}
                </span>
                <button
                  onClick={() => adjustYear(+1)}
                  className="text-white/50 hover:text-white/90 transition-colors w-9 h-9 flex items-center justify-center rounded-lg hover:bg-white/5"
                  aria-label="Next year"
                >
                  <svg width="6" height="10" viewBox="0 0 6 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <polyline points="1,1 5,5 1,9" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Bottom-right overlay: view tools */}
      <div className="absolute bottom-20 right-3 z-10">
        <div className="bg-black/60 backdrop-blur-sm rounded-xl border border-white/[0.07] p-1.5 flex flex-col gap-1">
          <AccumulationPanel
            accumulation={accumulation}
            onChange={setAccumulation}
            getCanvas={getCanvas as () => HTMLCanvasElement | undefined}
            getBounds={getBounds as () => { getWest(): number; getEast(): number; getNorth(): number; getSouth(): number } | undefined}
          />
          <SettingsPanel
            showSunLines={showSunLines}
            onShowSunLinesChange={setShowSunLines}
          />
          <a
            href="/about"
            className="text-[10px] text-white/30 hover:text-white/60 transition-colors px-1.5 pt-0.5 pb-0.5"
          >
            About / API
          </a>

          {/* Divider */}
          <div className="h-px bg-white/[0.06] mx-1" />

          {/* Zoom counter */}
          <div className="px-1.5 py-0.5 text-[10px] text-white/25 tabular-nums select-none">
            zoom {mapZoom.toFixed(1)}
          </div>
        </div>
      </div>
      {/* Navigation sidebar — self-positions absolutely (see NavigationPanel) */}
      <NavigationPanel
        navMode={navMode}
        onToggleNavMode={handleToggleNavMode}
        waypointA={waypointA}
        waypointB={waypointB}
        waypointALabel={waypointALabel}
        waypointBLabel={waypointBLabel}
        onSetWaypointA={handleSetWaypointA}
        onSetWaypointB={handleSetWaypointB}
        onSwapWaypoints={handleSwapWaypoints}
        onClearWaypointA={handleClearWaypointA}
        onClearWaypointB={handleClearWaypointB}
        onClear={handleClear}
        onCalculate={handleCalculateRoute}
        isCalculating={isCalculating}
        routes={navRoutes}
        selectedRouteIndex={selectedRouteIndex}
        onSelectRoute={setSelectedRouteIndex}
        error={navError}
        solarIntensity={routeSolarIntensity}
        pendingSlot={pendingSlot}
        onSetPendingSlot={setPendingSlot}
        locationSearchSlot={navMode ? <LocationSearch onSelect={flyTo} /> : undefined}
        onSaveRoute={handleOpenSaveModal}
        savedRoutes={savedRoutes}
        savedFolders={savedFolders}
        onLoadRoute={handleLoadRoute}
        onDeleteSavedRoute={handleDeleteSavedRoute}
        onRenameSavedRoute={handleRenameSavedRoute}
        additionalWaypoints={additionalWaypoints}
        onRemoveAdditionalWaypoint={handleRemoveAdditionalWaypoint}
        onExportRoute={handleExportRoute}
        userLocation={userLocation}
        isLocating={isLocating}
        onLocateMe={handleLocateMe}
        onUseLocationAsA={handleUseLocationAsA}
        onUseLocationAsB={handleUseLocationAsB}
        onPinDragStart={handlePinDragStart}
        drawMode={drawMode}
        onDrawModeToggle={handleDrawModeToggle}
        sketchPointCount={sketchPoints.length}
        warning={navWarning}
      />
      {saveModalRouteIndex !== null && navRoutes[saveModalRouteIndex] && (
        <SaveRouteModal
          defaultName={navRoutes[saveModalRouteIndex].label}
          onSave={handleConfirmSave}
          onCancel={() => setSaveModalRouteIndex(null)}
        />
      )}
    </div>
  );
}
