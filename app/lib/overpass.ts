import { haversineMeters } from "./routing";
import type { OsmNode, GraphEdge, RoutingGraph } from "./routing";

// Requests go through a same-origin proxy, never directly to overpass-api.de:
// the public instance omits CORS headers on its 429/504 error responses, which
// browsers report as a (misleading) CORS failure. In dev we use Vite's proxy;
// in production a Vercel function at /api/overpass (which also handles the
// mirror fallback server-side). See vite.config.ts and api/overpass.js.
const OVERPASS_BASE = import.meta.env.DEV ? "/__overpass" : "/api/overpass";

const FETCH_TIMEOUT_MS = 30_000;

async function postOverpass(
  body: string,
  signal?: AbortSignal
): Promise<Response> {
  // No User-Agent header: it's a forbidden header in browsers (silently
  // dropped). The proxy sets a real one server-side.
  return fetch(OVERPASS_BASE, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
    signal,
  });
}

// Simple LRU graph cache: reuse a previously fetched graph whose bounding box
// fully contains the new request. Avoids redundant Overpass fetches when the
// user nudges a waypoint slightly (the most common interaction pattern).
interface CacheEntry {
  south: number;
  west: number;
  north: number;
  east: number;
  graph: RoutingGraph;
}
const GRAPH_CACHE_MAX = 5;
const graphCache: CacheEntry[] = []; // newest first

function cacheContains(
  entry: CacheEntry,
  south: number,
  west: number,
  north: number,
  east: number
): boolean {
  return (
    entry.south <= south &&
    entry.west <= west &&
    entry.north >= north &&
    entry.east >= east
  );
}

function cloneRoutingGraph(graph: RoutingGraph): RoutingGraph {
  const nodes = new Map<number, OsmNode>();
  for (const [id, node] of graph.nodes) {
    nodes.set(id, { ...node });
  }

  const adj = new Map<number, GraphEdge[]>();
  for (const [id, edges] of graph.adj) {
    adj.set(id, edges.map((edge) => ({ ...edge })));
  }

  return { nodes, adj };
}

/**
 * Fetches OSM walkable road graph for the given bounding box via Overpass API.
 * All edge shadeFactor values are initialized to 0 — caller fills them in.
 * Results are cached by bbox; a cached graph is returned if it fully covers
 * the new request without re-fetching.
 */
export async function fetchRoutingGraph(
  south: number,
  west: number,
  north: number,
  east: number,
  signal?: AbortSignal
): Promise<RoutingGraph> {
  // Return cached graph if a previously fetched bbox fully covers this request
  for (const entry of graphCache) {
    if (cacheContains(entry, south, west, north, east)) {
      return cloneRoutingGraph(entry.graph);
    }
  }

  const query = `
[out:json][timeout:25];
(
  way["highway"~"^(footway|path|pedestrian|living_street|residential|unclassified|tertiary|secondary|service|cycleway|steps|track|bridleway)$"]["area"!="yes"]
  (${south},${west},${north},${east});
);
out body geom;
`.trim();

  const encodedBody = `data=${encodeURIComponent(query)}`;

  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const combinedSignal = signal
    ? AbortSignal.any([controller.signal, signal])
    : controller.signal;

  let res: Response;
  try {
    // The proxy handles the mirror fallback server-side.
    res = await postOverpass(encodedBody, combinedSignal);
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      if (signal?.aborted) throw e; // caller-initiated abort: rethrow as AbortError
      throw new Error(
        "Route request timed out — try a shorter route or a less busy area."
      );
    }
    throw e;
  } finally {
    clearTimeout(tid);
  }

  if (!res.ok) {
    if (res.status === 504) {
      throw new Error(
        "The map server is busy — try a smaller area or wait a moment and retry."
      );
    }
    throw new Error(`Overpass API error: ${res.status} ${res.statusText}`);
  }

  const text = await res.text();
  if (text.trimStart().startsWith("<")) {
    throw new Error(
      "The map server returned an error — the area may be too complex. Try repositioning your waypoints."
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = JSON.parse(text) as { elements?: any[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const elements: any[] = json.elements ?? [];

  // out body geom returns only way elements — geometry is inline as way.geometry[i].{lat,lon}
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rawWays = elements.filter((e: any) => e.type === "way");

  if (rawWays.length === 0) {
    throw new Error(
      "No walkable roads found in this area. Try a more urban location or zoom closer."
    );
  }

  // Count distinct ways each node appears in — marks intersections
  const nodeWayCount = new Map<number, number>();
  for (const way of rawWays) {
    const seen = new Set<number>();
    for (const nid of way.nodes ?? []) {
      if (!seen.has(nid)) {
        seen.add(nid);
        nodeWayCount.set(nid, (nodeWayCount.get(nid) ?? 0) + 1);
      }
    }
  }

  // Build node map and adjacency list from inline geometry
  const nodes = new Map<number, OsmNode>();
  const adj = new Map<number, GraphEdge[]>();

  const ensureAdj = (id: number) => {
    if (!adj.has(id)) adj.set(id, []);
  };

  for (const way of rawWays) {
    const nodeRefs: number[] = way.nodes ?? [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const geom: Array<{ lat: number; lon: number }> = way.geometry ?? [];

    // Skip closed highway=pedestrian ways — these are plaza/square area polygons,
    // not walkable paths. Their ring geometry would otherwise add spurious edges.
    const isClosed =
      nodeRefs.length >= 2 &&
      nodeRefs[0] === nodeRefs[nodeRefs.length - 1];
    if (isClosed && way.tags?.highway === "pedestrian") continue;

    // Register nodes from inline geometry
    for (let i = 0; i < nodeRefs.length; i++) {
      const nid = nodeRefs[i];
      if (!nodes.has(nid) && geom[i]) {
        nodes.set(nid, {
          id: nid,
          lat: geom[i].lat,
          lon: geom[i].lon,
          isIntersection: (nodeWayCount.get(nid) ?? 0) >= 2,
        });
      }
    }

    for (let i = 0; i < nodeRefs.length - 1; i++) {
      const fromId = nodeRefs[i];
      const toId = nodeRefs[i + 1];
      const fromNode = nodes.get(fromId);
      const toNode = nodes.get(toId);
      if (!fromNode || !toNode) continue;

      const distanceM = haversineMeters(
        [fromNode.lon, fromNode.lat],
        [toNode.lon, toNode.lat]
      );

      ensureAdj(fromId);
      ensureAdj(toId);

      adj.get(fromId)!.push({ toId, distanceM, shadeFactor: 0 });
      adj.get(toId)!.push({ toId: fromId, distanceM, shadeFactor: 0 });
    }
  }

  const graph: RoutingGraph = { nodes, adj };

  // Cache newest-first; evict oldest when full
  graphCache.unshift({ south, west, north, east, graph });
  if (graphCache.length > GRAPH_CACHE_MAX) graphCache.pop();

  return cloneRoutingGraph(graph);
}

// ---------------------------------------------------------------------------
// Station entrance nodes (for MRT routing)
// ---------------------------------------------------------------------------

export interface StationEntranceNode {
  id: number;
  lat: number;
  lon: number;
  name?: string;
  /** "entrance" for railway=subway_entrance, "station" for railway=station */
  kind: "entrance" | "station";
}

export interface BuildingFootprint {
  id: number;
  heightM: number;
  rings: [number, number][][];
}

function heightMForBuilding(tags: Record<string, unknown> | null | undefined): number {
  const renderHeight = Number(tags?.render_height);
  if (Number.isFinite(renderHeight) && renderHeight > 0) return renderHeight;
  const height = Number(tags?.height);
  if (Number.isFinite(height) && height > 0) return height;
  const levels = Number(tags?.["building:levels"]);
  if (Number.isFinite(levels) && levels > 0) return levels * 3;
  return 10;
}

function bboxAround(lng: number, lat: number, radiusM: number): {
  south: number;
  west: number;
  north: number;
  east: number;
} {
  const dLat = radiusM / 111320;
  const dLng = radiusM / Math.max(1e-6, 111320 * Math.cos(lat * Math.PI / 180));
  return {
    south: lat - dLat,
    west: lng - dLng,
    north: lat + dLat,
    east: lng + dLng,
  };
}

/**
 * Fetch building footprints near a point for offscreen shade checks.
 *
 * This intentionally starts with way["building"] footprints only. Multipolygon
 * relations need member assembly to avoid false geometry, so they are left for
 * a later slice instead of returning overconfident shade.
 */
export async function fetchBuildingFootprintsAround(
  lng: number,
  lat: number,
  radiusM = 180,
  signal?: AbortSignal
): Promise<BuildingFootprint[]> {
  const { south, west, north, east } = bboxAround(lng, lat, radiusM);
  const query = `
[out:json][timeout:10];
(
  way["building"](${south},${west},${north},${east});
);
out body geom;
`.trim();

  const encodedBody = `data=${encodeURIComponent(query)}`;
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 12_000);
  const combinedSignal = signal
    ? AbortSignal.any([controller.signal, signal])
    : controller.signal;

  let res: Response;
  try {
    res = await postOverpass(encodedBody, combinedSignal);
  } finally {
    clearTimeout(tid);
  }

  if (!res.ok) {
    throw new Error(`Overpass building API error: ${res.status} ${res.statusText}`);
  }

  const text = await res.text();
  if (text.trimStart().startsWith("<")) {
    throw new Error("The map server returned an error while checking building shade.");
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const json = JSON.parse(text) as { elements?: any[] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const elements: any[] = json.elements ?? [];

  return elements
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((e: any) => e.type === "way" && Array.isArray(e.geometry) && e.geometry.length >= 3)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((e: any): BuildingFootprint => ({
      id: e.id,
      heightM: heightMForBuilding(e.tags),
      rings: [
        e.geometry.map((p: { lat: number; lon: number }) => [p.lon, p.lat] as [number, number]),
      ],
    }));
}

/**
 * Fetches subway station entrance and station nodes from Overpass.
 * Non-critical — returns empty array on failure instead of throwing.
 */
export async function fetchStationEntrances(
  south: number,
  west: number,
  north: number,
  east: number,
  signal?: AbortSignal
): Promise<StationEntranceNode[]> {
  const query = `
[out:json][timeout:10];
(
  node["railway"="subway_entrance"](${south},${west},${north},${east});
  node["railway"="station"]["station"="subway"](${south},${west},${north},${east});
);
out body;`.trim();

  const encodedBody = `data=${encodeURIComponent(query)}`;

  try {
    const res = await postOverpass(encodedBody, signal);
    if (!res.ok) return [];
    const text = await res.text();
    if (text.trimStart().startsWith("<")) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const json = JSON.parse(text) as { elements?: any[] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const elements: any[] = json.elements ?? [];
    return elements
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((e: any) => e.type === "node" && e.lat != null && e.lon != null)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((e: any) => ({
        id: e.id,
        lat: e.lat,
        lon: e.lon,
        name: e.tags?.name ?? e.tags?.["name:en"] ?? undefined,
        kind: e.tags?.railway === "subway_entrance" ? "entrance" : "station",
      }));
  } catch {
    return [];
  }
}
