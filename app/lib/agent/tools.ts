/**
 * Agent tool surface.
 *
 * Each tool is a thin, typed wrapper over capabilities the app already has:
 * geocoding (Nominatim), the solar-intensity model, the WebGL shadow simulator
 * (sampled off the live canvas), the time/date state, the map camera, and the
 * shade-aware routing pipeline. The LLM plans; these tools act.
 *
 * Tool executors receive an `AgentContext` of live handles supplied by the
 * React layer (see useAgent.ts) so they can read/write app state without the
 * agent code importing React.
 */
import type maplibregl from "maplibre-gl";
import { geocodeForward, geocodeNear } from "../nominatim";
import { computeSolarIntensity } from "../shadeSampling";
import { fromMapLocal, toMapLocal } from "../timezone";
import { parseTime } from "../../hooks/useShadowTime";
import type { LlmFunctionDeclaration } from "./llmClient";

export interface AssistantPin {
  lng: number;
  lat: number;
  label?: string;
}

export interface AgentContext {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  dateRef: React.MutableRefObject<Date>;
  setDate: (d: Date) => void;
  /** Current map-local UTC offset in minutes (longitude-derived). */
  getUtcOffsetMin: () => number;
  /** The user's known location as [lng, lat], or null if not located yet. */
  getUserLocation: () => [number, number] | null;
  setWaypointA: (coord: [number, number], label: string) => void;
  setWaypointB: (coord: [number, number], label: string) => void;
  calculateRoute: () => void;
  /** Replace the assistant's itinerary pins on the map. */
  setPins: (pins: AssistantPin[]) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtLocalTime(d: Date, offsetMin: number): string {
  const { hours, minutes } = toMapLocal(d, offsetMin);
  const ampm = hours >= 12 ? "PM" : "AM";
  const h = hours % 12 || 12;
  return `${h}:${String(minutes).padStart(2, "0")} ${ampm}`;
}

/** Build a Date at the given local time string on the currently-set calendar day. */
function dateAtLocalTime(
  base: Date,
  offsetMin: number,
  timeStr: string | undefined
): Date {
  if (!timeStr) return base;
  const mins = parseTime(timeStr);
  if (mins == null) return base;
  return fromMapLocal(base, offsetMin, Math.floor(mins / 60), mins % 60);
}

function waitForIdle(map: maplibregl.Map, timeoutMs = 4000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    map.once("idle", finish);
    setTimeout(finish, timeoutMs);
  });
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Ask the browser for the user's GPS position. Resolves [lng, lat] or null. */
function requestBrowserLocation(): Promise<[number, number] | null> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve([pos.coords.longitude, pos.coords.latitude]),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

/**
 * Sample the shadow fraction at a single map point by reading back the rendered
 * canvas. The shadow overlay is a semi-transparent blue wash; a shaded pixel
 * has blue dominating the red/green average. Predicate kept consistent with
 * app/lib/shadeSampling.ts (the routing shade test).
 *
 * Requires the point to be within the current viewport — callers fly the camera
 * so the point is centered before sampling.
 */
function samplePointShade(
  map: maplibregl.Map,
  lng: number,
  lat: number
): number {
  const canvas = map.getCanvas();
  const tmp = document.createElement("canvas");
  tmp.width = canvas.width;
  tmp.height = canvas.height;
  const ctx2d = tmp.getContext("2d");
  if (!ctx2d) return 0;
  ctx2d.drawImage(canvas, 0, 0);
  const { data, width, height } = ctx2d.getImageData(0, 0, tmp.width, tmp.height);
  const dpr = window.devicePixelRatio || 1;

  const p = map.project([lng, lat]);
  const offsets = [-8, -4, 0, 4, 8];
  let shaded = 0;
  let count = 0;
  for (const ox of offsets) {
    for (const oy of offsets) {
      const x = Math.round((p.x + ox) * dpr);
      const y = Math.round((p.y + oy) * dpr);
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const avgRG = (r + g) / 2;
      const isShaded = r + g + b < 600 && b - avgRG > 18 && b > avgRG * 1.15;
      if (isShaded) shaded++;
      count++;
    }
  }
  return count === 0 ? 0 : shaded / count;
}

function shadeStatus(frac: number): "shaded" | "partial sun" | "sunlit" {
  if (frac >= 0.6) return "shaded";
  if (frac >= 0.25) return "partial sun";
  return "sunlit";
}

// ---------------------------------------------------------------------------
// Tool declarations (Gemini function-calling schema)
// ---------------------------------------------------------------------------

// Note: get_current_context is intentionally NOT exposed as a tool. The map
// center / local time / location-known status is deterministic app state, so the
// loop pre-injects it (see agentLoop.ts) instead of spending a round-trip asking
// for it. The executor below stays — agentLoop calls it directly for that
// snapshot — it's just not in this declarations list the model sees.
export const toolDeclarations: LlmFunctionDeclaration[] = [
  {
    name: "locate_user",
    description: "Get the user's GPS location and center the map on it. Returns lat/lng.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "geocode_place",
    description: "Resolve a place name to coordinates.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Place name or address." },
      },
      required: ["query"],
    },
  },
  {
    name: "search_places",
    description:
      "Find stops (e.g. 'parks', 'cafes') within an area. Anchor with lat/lng, or a 'near' name, else uses the user's location.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What to look for." },
        near: { type: "string", description: "Area to search in." },
        lat: { type: "number" },
        lng: { type: "number" },
      },
      required: ["query"],
    },
  },
  {
    name: "check_shade",
    description:
      "Real building-shade at a spot and time from the 3D simulator. Returns shadeFraction 0..1.",
    parameters: {
      type: "object",
      properties: {
        lat: { type: "number" },
        lng: { type: "number" },
        time: { type: "string", description: "Local time, e.g. '2:00 PM'. Defaults to current." },
      },
      required: ["lat", "lng"],
    },
  },
  {
    name: "set_time",
    description: "Set the simulation's local time of day so shadows match that hour.",
    parameters: {
      type: "object",
      properties: {
        time: { type: "string", description: "Local time, e.g. '5:30 PM'." },
      },
      required: ["time"],
    },
  },
  {
    name: "plot_points",
    description:
      "Drop the FULL ordered list of itinerary stops as numbered pins and frame the map (replaces previous pins).",
    parameters: {
      type: "object",
      properties: {
        points: {
          type: "array",
          description: "Ordered stops.",
          items: {
            type: "object",
            properties: {
              lat: { type: "number" },
              lng: { type: "number" },
              label: { type: "string", description: "Short stop name." },
            },
            required: ["lat", "lng"],
          },
        },
      },
      required: ["points"],
    },
  },
  {
    name: "plan_shaded_route",
    description:
      "Draw a shade-aware walking route between two stops (shortest/balanced/most-shaded for the current time).",
    parameters: {
      type: "object",
      properties: {
        fromLat: { type: "number" },
        fromLng: { type: "number" },
        toLat: { type: "number" },
        toLng: { type: "number" },
        fromLabel: { type: "string" },
        toLabel: { type: "string" },
      },
      required: ["fromLat", "fromLng", "toLat", "toLng"],
    },
  },
];

// ---------------------------------------------------------------------------
// Executors
// ---------------------------------------------------------------------------

type Args = Record<string, unknown>;
const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v : undefined;

export async function executeTool(
  name: string,
  args: Args,
  ctx: AgentContext
): Promise<Record<string, unknown>> {
  const offset = ctx.getUtcOffsetMin();
  const map = ctx.mapRef.current;

  switch (name) {
    case "get_current_context": {
      if (!map) return { error: "Map not ready yet." };
      const c = map.getCenter();
      const zoom = map.getZoom();
      const now = ctx.dateRef.current;
      const userLoc = ctx.getUserLocation(); // [lng, lat]
      // Below ~zoom 5 with no GPS fix, the map is still at the default world
      // view — "here" is meaningless. Tell the agent so it locates/asks instead
      // of treating the ocean-center default as the user's location.
      const locationKnown = !!userLoc || zoom >= 5;
      return {
        center: { lat: +c.lat.toFixed(5), lng: +c.lng.toFixed(5) },
        zoom: +zoom.toFixed(1),
        localTime: fmtLocalTime(now, offset),
        sunIntensity: +computeSolarIntensity(now, c.lat, c.lng).toFixed(2),
        locationKnown,
        userLocation: userLoc ? { lat: userLoc[1], lng: userLoc[0] } : null,
        note: locationKnown
          ? undefined
          : "The map is at the default world view — the user's location is " +
            "UNKNOWN. Do NOT invent a city. Call locate_user to use their GPS, " +
            "or ask the user which place/area they mean.",
      };
    }

    case "locate_user": {
      if (!map) return { error: "Map not ready yet." };
      let loc = ctx.getUserLocation(); // [lng, lat]
      if (!loc) loc = await requestBrowserLocation();
      if (!loc) {
        return {
          error:
            "Couldn't get the user's location (permission denied or " +
            "unavailable). Ask the user to type a place or area instead.",
        };
      }
      const [lng, lat] = loc;
      map.flyTo({ center: [lng, lat], zoom: 15, duration: 800 });
      await waitForIdle(map);
      return {
        lat: +lat.toFixed(6),
        lng: +lng.toFixed(6),
        note: "Centered the map on the user's location.",
      };
    }

    case "geocode_place": {
      const q = str(args.query);
      if (!q) return { error: "query is required." };
      const results = await geocodeForward(q);
      if (results.length === 0) return { results: [], note: "No matches found." };
      return {
        results: results.slice(0, 3).map((r) => ({
          name: r.display_name.split(",").slice(0, 2).join(", ").trim(),
          lat: +parseFloat(r.lat).toFixed(6),
          lng: +parseFloat(r.lon).toFixed(6),
        })),
      };
    }

    case "search_places": {
      const q = str(args.query);
      if (!q) return { error: "query is required." };

      // Resolve a center to search around, in priority order:
      // explicit lat/lng → named `near` area → user GPS → current map view.
      let center: [number, number] | null = null; // [lng, lat]
      const argLat = num(args.lat);
      const argLng = num(args.lng);
      const near = str(args.near);
      if (argLat != null && argLng != null) {
        center = [argLng, argLat];
      } else if (near) {
        // The model sometimes passes "lat,lng" as `near` instead of a name.
        const coord = near.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
        if (coord) {
          center = [parseFloat(coord[2]), parseFloat(coord[1])]; // [lng, lat]
        } else {
          const g = await geocodeForward(near);
          if (g[0]) center = [parseFloat(g[0].lon), parseFloat(g[0].lat)];
        }
      } else {
        const userLoc = ctx.getUserLocation();
        if (userLoc) center = userLoc;
        else if (map && map.getZoom() >= 5) {
          const c = map.getCenter();
          center = [c.lng, c.lat];
        }
      }

      if (!center) {
        return {
          results: [],
          note:
            "I don't know where to search. Call locate_user first, or pass a " +
            "`near` place name (or lat/lng) to anchor the search.",
        };
      }

      const results = await geocodeNear(q, center[1], center[0]);
      return {
        searchedNear: { lat: +center[1].toFixed(5), lng: +center[0].toFixed(5) },
        results: results.slice(0, 4).map((r) => ({
          name: r.display_name.split(",").slice(0, 2).join(", ").trim(),
          lat: +parseFloat(r.lat).toFixed(6),
          lng: +parseFloat(r.lon).toFixed(6),
        })),
        note:
          results.length === 0
            ? "No matches in that area. Try a broader query or a different anchor."
            : undefined,
      };
    }

    case "check_shade": {
      const lat = num(args.lat);
      const lng = num(args.lng);
      if (lat == null || lng == null) return { error: "lat and lng are required." };
      if (!map) return { error: "Map not ready yet." };

      const probeDate = dateAtLocalTime(ctx.dateRef.current, offset, str(args.time));

      // Save view + time so probing doesn't hijack the user's screen.
      const orig = map.getCenter();
      const origZoom = map.getZoom();
      const origDate = ctx.dateRef.current;

      ctx.setDate(probeDate);
      map.flyTo({ center: [lng, lat], zoom: Math.max(origZoom, 16), duration: 600 });
      await waitForIdle(map);
      await delay(650); // let the shadow layer recompute for the probe time

      const frac = samplePointShade(map, lng, lat);

      // Restore.
      ctx.setDate(origDate);
      map.flyTo({ center: [orig.lng, orig.lat], zoom: origZoom, duration: 400 });

      return {
        shadeFraction: +frac.toFixed(2),
        status: shadeStatus(frac),
        atLocalTime: fmtLocalTime(probeDate, offset),
      };
    }

    case "set_time": {
      const t = str(args.time);
      if (!t) return { error: "time is required." };
      const mins = parseTime(t);
      if (mins == null) return { error: `Could not parse time '${t}'.` };
      const next = fromMapLocal(
        ctx.dateRef.current,
        offset,
        Math.floor(mins / 60),
        mins % 60
      );
      ctx.setDate(next);
      return { ok: true, newLocalTime: fmtLocalTime(next, offset) };
    }

    case "plot_points": {
      const raw = Array.isArray(args.points) ? args.points : [];
      const pins: AssistantPin[] = [];
      for (const item of raw) {
        const o = (item ?? {}) as Record<string, unknown>;
        const lat = num(o.lat);
        const lng = num(o.lng);
        if (lat == null || lng == null) continue;
        pins.push({ lng, lat, label: str(o.label) });
      }
      ctx.setPins(pins);

      if (map && pins.length === 1) {
        map.flyTo({
          center: [pins[0].lng, pins[0].lat],
          zoom: Math.max(map.getZoom(), 14),
          duration: 800,
        });
      } else if (map && pins.length > 1) {
        let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
        for (const p of pins) {
          w = Math.min(w, p.lng);
          e = Math.max(e, p.lng);
          s = Math.min(s, p.lat);
          n = Math.max(n, p.lat);
        }
        map.fitBounds([[w, s], [e, n]], { padding: 80, maxZoom: 16, duration: 800 });
      }

      return {
        ok: true,
        plotted: pins.length,
        note:
          pins.length > 0
            ? `Plotted ${pins.length} point(s) on the map and framed them.`
            : "Cleared the map pins.",
      };
    }

    case "plan_shaded_route": {
      const fromLat = num(args.fromLat);
      const fromLng = num(args.fromLng);
      const toLat = num(args.toLat);
      const toLng = num(args.toLng);
      if (fromLat == null || fromLng == null || toLat == null || toLng == null) {
        return { error: "fromLat, fromLng, toLat, toLng are all required." };
      }
      ctx.setWaypointA([fromLng, fromLat], str(args.fromLabel) ?? "Start");
      ctx.setWaypointB([toLng, toLat], str(args.toLabel) ?? "Destination");
      // Let the waypoint state settle before kicking off the pipeline.
      await delay(50);
      ctx.calculateRoute();
      return {
        ok: true,
        note:
          "Route calculation started and will draw on the map. It produces " +
          "shortest, balanced, and most-shaded options for the current time.",
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}
