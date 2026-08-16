import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import type maplibregl from "maplibre-gl";
import { geocodeReverse } from "../lib/nominatim";
import { fetchRoutingGraph, fetchStationEntrances } from "../lib/overpass";
import {
  snapToEdge, dijkstra, snapToGraph, paretoRoutes, graphToGeoJSON,
  haversineMeters, bfsReachable, snapToReachableEdge, SpatialGrid,
  simplifyPolyline, sketchBoundingBox, findSketchGaps, connectRouteEndpoints,
  clearVirtualNodes, snapRouteStopsToReachableEdges,
} from "../lib/routing";
import type { GraphEdge, RoutingGraph, RouteLeg, LatLng, SketchPoint, RouteOption } from "../lib/routing";
import { recordRoutingRun, computeDerivedKpis } from "../lib/metrics";
import { buildingCentroidAt, snapOutsideBuilding } from "../lib/building-snap";
import type { MapBuildingQuery } from "../lib/building-snap";
import { createRoute, getRoutes, getFolders, updateRoute, deleteRoute } from "../lib/savedRoutes";
import type { SavedRoute, SavedFolder } from "../lib/savedRoutes";
import { routeToGPX, routeToGeoJSON, downloadBlob } from "../lib/exportRoute";
import { fetchTrainGraph, findBestTrainRoute, matchEntranceToTrainStation, TRAIN_SUN_EXPOSURE, buildTrainDrawData } from "../lib/trainGraph";
import { sampleBothSidewalks, computeSolarIntensity, pickClosestEntrance } from "../lib/shadeSampling";
import type { RouteCalculationProgress } from "../lib/routeProgress";
import { partialRouteNotice } from "../lib/partialRoute";

interface UseNavigationArgs {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  dateRef: React.MutableRefObject<Date>;
  setDate: React.Dispatch<React.SetStateAction<Date>>;
}

export function useNavigation({ mapRef, dateRef, setDate }: UseNavigationArgs) {
  // Navigation state
  const [navMode, setNavMode] = useState(false);
  const [waypointA, setWaypointA] = useState<[number, number] | null>(null);
  const [waypointB, setWaypointB] = useState<[number, number] | null>(null);
  const [navRoutes, setNavRoutes] = useState<RouteOption[]>([]);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [isCalculating, setIsCalculating] = useState(false);
  const [routeProgress, setRouteProgress] = useState<RouteCalculationProgress | null>(null);
  const [routePreview, setRoutePreview] = useState<GeoJSON.Feature<GeoJSON.LineString> | null>(null);
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

  // Sketch drawing state
  const [sketchPoints, setSketchPoints] = useState<SketchPoint[]>([]);
  const [drawMode, setDrawMode] = useState(false);
  const [navWarning, setNavWarning] = useState<string | null>(null);
  const [simplifiedWaypoints, setSimplifiedWaypoints] = useState<LatLng[] | null>(null);

  // Route mode and shade preference
  const [routeMode, setRouteMode] = useState<'walk' | 'transit'>('walk');
  const [shadePreference, setShadePreference] = useState(0.5);

  // Refs for stale-closure avoidance
  const waypointARef = useRef(waypointA);
  const waypointBRef = useRef(waypointB);
  const calcGenRef = useRef(0);
  const calcAbortRef = useRef<AbortController | null>(null);
  const waypointALabelRef = useRef(waypointALabel);
  const waypointBLabelRef = useRef(waypointBLabel);
  const drawModeRef = useRef(drawMode);
  const sketchPointsRef = useRef(sketchPoints);
  const dragSlotRef = useRef<'A' | 'B' | null>(null);
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const dragActiveRef = useRef(false);
  const ghostElRef = useRef<HTMLDivElement | null>(null);

  waypointARef.current = waypointA;
  waypointBRef.current = waypointB;
  waypointALabelRef.current = waypointALabel;
  waypointBLabelRef.current = waypointBLabel;
  drawModeRef.current = drawMode;
  sketchPointsRef.current = sketchPoints;

  // Escape to cancel pending slot
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPendingSlot(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const cancelInFlightCalculation = useCallback(() => {
    calcGenRef.current++;
    calcAbortRef.current?.abort();
    setIsCalculating(false);
    setRouteProgress(null);
    setRoutePreview(null);
  }, []);

  // Keyboard shortcuts for draw mode
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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

  const handleMapClick = useCallback(
    (coord: { lng: number; lat: number }, originalEvent?: MouseEvent) => {
      if (originalEvent?.altKey && waypointARef.current && waypointBRef.current) {
        const lngLat: [number, number] = [coord.lng, coord.lat];
        cancelInFlightCalculation();
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
      cancelInFlightCalculation();
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
    [cancelInFlightCalculation]
  );

  const handleClear = useCallback(() => {
    cancelInFlightCalculation();
    setWaypointA(null);
    setWaypointB(null);
    setWaypointALabel(null);
    setWaypointBLabel(null);
    setAdditionalWaypoints([]);
    setNavRoutes([]);
    setSelectedRouteIndex(0);
    setNavError(null);
    setRoutePreview(null);
    setRouteSolarIntensity(null);
    setPendingSlot(null);
    setDrawMode(false);
    setSketchPoints([]);
    setNavWarning(null);
    setSimplifiedWaypoints(null);
    setRouteMode('walk');
    setShadePreference(0.5);
  }, [cancelInFlightCalculation]);

  const handleOpenSaveModal = useCallback((routeIndex: number) => {
    if (navRoutes[routeIndex]?.partial) return;
    setSaveModalRouteIndex(routeIndex);
  }, [navRoutes]);

  const handleConfirmSave = useCallback((name: string, folderId: string | null) => {
    if (saveModalRouteIndex === null) return;
    const route = navRoutes[saveModalRouteIndex];
    if (!route || !waypointA || !waypointB) return;
    const d = dateRef.current;
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
  }, [saveModalRouteIndex, navRoutes, waypointA, waypointB, waypointALabel, waypointBLabel, additionalWaypoints, dateRef]);

  const handleLoadRoute = useCallback((saved: SavedRoute) => {
    cancelInFlightCalculation();
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
  }, [cancelInFlightCalculation, setDate]);

  const handleExportRoute = useCallback((routeIndex: number, format: "gpx" | "geojson") => {
    const route = navRoutes[routeIndex];
    if (!route) return;
    if (route.partial) {
      setNavWarning(partialRouteNotice(route.partial));
      return;
    }
    const name = route.label;
    if (format === "gpx") {
      downloadBlob(routeToGPX(route, name), `${name}.gpx`, "application/gpx+xml");
    } else {
      downloadBlob(routeToGeoJSON(route), `${name}.geojson`, "application/geo+json");
    }
  }, [navRoutes]);

  const handleRemoveAdditionalWaypoint = useCallback((index: number) => {
    cancelInFlightCalculation();
    setAdditionalWaypoints(prev => prev.filter((_, i) => i !== index));
    setNavRoutes([]);
    setSelectedRouteIndex(0);
  }, [cancelInFlightCalculation]);

  const handleSetAdditionalWaypoints = useCallback((waypoints: [number, number][]) => {
    cancelInFlightCalculation();
    setAdditionalWaypoints(waypoints);
    setNavRoutes([]);
    setSelectedRouteIndex(0);
  }, [cancelInFlightCalculation]);

  const handleAddAdditionalWaypoint = useCallback((coord: [number, number]) => {
    cancelInFlightCalculation();
    setAdditionalWaypoints(prev => [...prev, coord]);
    setNavRoutes([]);
    setSelectedRouteIndex(0);
  }, [cancelInFlightCalculation]);

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
        mapRef.current?.jumpTo({ center: coords, zoom: 15 });
      },
      () => {
        setNavError("Unable to get your location. Check browser permissions.");
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, [mapRef]);

  const handleToggleNavMode = useCallback(() => {
    if (!navMode) {
      setNavMode(true);
      return;
    }
    cancelInFlightCalculation();
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
    setRouteMode('walk');
    setShadePreference(0.5);
    setNavMode(false);
  }, [cancelInFlightCalculation, navMode]);

  const handleDrawModeToggle = useCallback(() => {
    setDrawMode((prev) => {
      setSketchPoints([]);
      setNavWarning(null);
      setSimplifiedWaypoints(null);
      return !prev;
    });
  }, []);

  const handleClearSketch = useCallback(() => {
    setSketchPoints([]);
    setNavWarning(null);
    setSimplifiedWaypoints(null);
  }, []);

  const handleRouteModeChange = useCallback((mode: 'walk' | 'transit') => {
    cancelInFlightCalculation();
    setRouteMode(mode);
    setNavRoutes([]);
    setSelectedRouteIndex(0);
  }, [cancelInFlightCalculation]);

  const handleShadePreferenceChange = useCallback((v: number) => {
    setShadePreference(v);
    setNavRoutes((routes) => {
      if (routes.length === 0) return routes;
      let bestIdx = 0;
      let bestDiff = Infinity;
      for (let i = 0; i < routes.length; i++) {
        const diff = Math.abs(routes[i].shadeCoverage - v);
        if (diff < bestDiff) { bestDiff = diff; bestIdx = i; }
      }
      setSelectedRouteIndex(bestIdx);
      return routes;
    });
  }, []);

  const handleSketchPointClick = useCallback((coord: LatLng) => {
    setSketchPoints((prev) => [...prev, { coord, address: null }]);

    const map = mapRef.current;
    const centroid = map ? buildingCentroidAt(coord, map as unknown as MapBuildingQuery) : null;
    const target = centroid ?? coord;

    geocodeReverse(target[1], target[0]).then((label) => {
      if (!label) return;
      setSketchPoints((prev) => {
        if (prev.length === 0) return prev;
        const next = [...prev];
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
  }, [mapRef]);

  const handleSketchPointDrag = useCallback((index: number, coord: LatLng) => {
    setSketchPoints((prev) => {
      const next = [...prev];
      if (index < 0 || index >= next.length) return prev;
      next[index] = { coord, address: null };
      return next;
    });

    const map = mapRef.current;
    const centroid = map ? buildingCentroidAt(coord, map as unknown as MapBuildingQuery) : null;
    const target = centroid ?? coord;

    geocodeReverse(target[1], target[0]).then((label) => {
      if (!label) return;
      setSketchPoints((prev) => {
        const next = [...prev];
        if (index >= next.length) return prev;
        const p = next[index];
        if (p.coord[0] === coord[0] && p.coord[1] === coord[1] && p.address == null) {
          next[index] = { coord, address: label };
        }
        return next;
      });
    });
  }, [mapRef]);

  // -------------------------------------------------------------------------
  // Sketch routing helpers
  // -------------------------------------------------------------------------

  const cloneRoutingGraph = useCallback((graph: RoutingGraph): RoutingGraph => {
    const nodes = new Map(graph.nodes);
    const adj = new Map<number, GraphEdge[]>();
    for (const [id, edges] of graph.adj) {
      adj.set(id, edges.map((e) => ({ toId: e.toId, distanceM: e.distanceM, shadeFactor: e.shadeFactor })));
    }
    return { nodes, adj };
  }, []);

  const removeVirtualNode = useCallback((graph: RoutingGraph, vid: number) => {
    const vidEdges = graph.adj.get(vid);
    if (vidEdges) {
      for (const e of vidEdges) {
        const ownerEdges = graph.adj.get(e.toId);
        if (ownerEdges) {
          for (let i = ownerEdges.length - 1; i >= 0; i--) {
            if (ownerEdges[i].toId === vid) ownerEdges.splice(i, 1);
          }
        }
      }
    }
    graph.nodes.delete(vid);
    graph.adj.delete(vid);
  }, []);

  const snapSketchWaypoints = useCallback((
    waypoints: LatLng[],
    graph: RoutingGraph,
    map: maplibregl.Map
  ): { snappedIds: number[]; snappedCoords: LatLng[] } => {
    const coords = waypoints.map((wp) => snapOutsideBuilding(wp, map as unknown as MapBuildingQuery));

    const snappedIds: number[] = [];
    const MAX_RESNAP_DIST_M = 250;

    const firstId = snapToEdge(coords[0], graph, -1000);
    snappedIds.push(firstId);

    for (let i = 1; i < coords.length; i++) {
      const preferredComponent = bfsReachable(graph, snappedIds[i - 1]);

      const primaryVid = -1000 - i;
      let id = snapToEdge(coords[i], graph, primaryVid);

      if (!preferredComponent.has(id)) {
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
    setRouteProgress({ message: "Preparing sketch route" });
    setNavError(null);
    setNavWarning(null);

    await new Promise<void>((r) => setTimeout(r, 0));

    try {
      const simplified = simplifyPolyline(coords, 30);
      setSimplifiedWaypoints(simplified);

      const bbox = sketchBoundingBox(simplified, 0.005);
      setRouteProgress({ message: "Fetching walk network" });

      const currentBounds = map.getBounds();
      const bboxInView =
        currentBounds.getWest() <= bbox.west &&
        currentBounds.getEast() >= bbox.east &&
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

      const gaps = findSketchGaps(simplified, graph);
      if (gaps.length > 0) {
        const pointNums = gaps.map((i) => i + 1).join(", ");
        setNavWarning(
          `Your sketch crosses an area with no walkable roads near point ${pointNums} — the route may deviate there.`
        );
      }

      setRouteProgress({ message: "Reading shadow layer" });
      const canvas = map.getCanvas();
      const tmp = document.createElement("canvas");
      tmp.width = canvas.width;
      tmp.height = canvas.height;
      const ctx2d = tmp.getContext("2d")!;
      ctx2d.drawImage(canvas, 0, 0);
      const imageData = ctx2d.getImageData(0, 0, tmp.width, tmp.height);
      const dpr = window.devicePixelRatio || 1;

      // MapLibre transform — correct under rotation/tilt (see calculateRoute).
      const projectToScreen = (lng: number, lat: number): [number, number] => {
        const p = map.project([lng, lat]);
        return [p.x, p.y];
      };

      setRouteProgress({ message: "Sampling street shade" });
      for (const [fromId, edges] of graph.adj) {
        const fromNode = graph.nodes.get(fromId);
        if (!fromNode) continue;
        for (const edge of edges) {
          const toNode = graph.nodes.get(edge.toId);
          if (!toNode) continue;
          const samples = Math.max(3, Math.ceil(edge.distanceM / 25));
          const shade = sampleBothSidewalks(
            projectToScreen, imageData, dpr,
            [fromNode.lon, fromNode.lat], [toNode.lon, toNode.lat], samples
          );
          edge.shadeFactor = Math.max(shade.left, shade.right);
        }
      }

      setRouteProgress({ message: "Finding route choices" });
      const sketchGraph = cloneRoutingGraph(graph);
      const { snappedIds } = snapSketchWaypoints(simplified, sketchGraph, map);

      const variants = [
        { label: "Shortest", shadeStrength: 0.0 },
        { label: "Balanced", shadeStrength: 0.5 },
        { label: "Most shaded", shadeStrength: 1.0 },
      ] as const;

      const seen = new Set<string>();
      const options: RouteOption[] = [];
      for (const v of variants) {
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

        const geojson = connectRouteEndpoints(
          graphToGeoJSON(fullPath, sketchGraph),
          simplified[0],
          simplified[simplified.length - 1],
        );
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
      setRouteProgress(null);
    }
  }, [sketchPoints, mapRef, cloneRoutingGraph, snapSketchWaypoints]);

  const handleSketchFinish = useCallback(() => {
    setDrawMode(false);
    calculateSketchRoute();
  }, [calculateSketchRoute]);

  const handleSetWaypointA = useCallback((coord: [number, number], label: string) => {
    cancelInFlightCalculation();
    setWaypointA(coord);
    setWaypointALabel(label);
    setNavRoutes([]);
    setSelectedRouteIndex(0);
    const map = mapRef.current;
    if (map) map.jumpTo({ center: coord, zoom: Math.max(map.getZoom(), 15) });
  }, [cancelInFlightCalculation, mapRef]);

  const handleSetWaypointB = useCallback((coord: [number, number], label: string) => {
    cancelInFlightCalculation();
    setWaypointB(coord);
    setWaypointBLabel(label);
    setNavRoutes([]);
    setSelectedRouteIndex(0);
    const map = mapRef.current;
    if (map) map.jumpTo({ center: coord, zoom: Math.max(map.getZoom(), 15) });
  }, [cancelInFlightCalculation, mapRef]);

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
    cancelInFlightCalculation();
    setWaypointA(b);
    setWaypointB(a);
    setWaypointALabel(bLabel);
    setWaypointBLabel(aLabel);
    setNavRoutes([]);
    setSelectedRouteIndex(0);
  }, [cancelInFlightCalculation]);

  const handleClearWaypointA = useCallback(() => {
    cancelInFlightCalculation();
    setWaypointA(null);
    setWaypointALabel(null);
    setNavRoutes([]);
    setSelectedRouteIndex(0);
  }, [cancelInFlightCalculation]);

  const handleClearWaypointB = useCallback(() => {
    cancelInFlightCalculation();
    setWaypointB(null);
    setWaypointBLabel(null);
    setNavRoutes([]);
    setSelectedRouteIndex(0);
  }, [cancelInFlightCalculation]);

  const handleMarkerDragEnd = useCallback(
    (slot: 'A' | 'B', coord: { lng: number; lat: number }) => {
      const lngLat: [number, number] = [coord.lng, coord.lat];
      const coordLabel = `${coord.lat.toFixed(3)}, ${coord.lng.toFixed(3)}`;
      cancelInFlightCalculation();
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
    [cancelInFlightCalculation]
  );

  const handlePinDragStart = useCallback((slot: 'A' | 'B') => {
    dragSlotRef.current = slot;
    dragActiveRef.current = false;
    dragStartPos.current = null;

    const color = slot === 'A' ? '#22c55e' : '#ef4444';

    function onMove(e: PointerEvent) {
      const { clientX: x, clientY: y } = e;

      if (!dragStartPos.current) {
        dragStartPos.current = { x, y };
        return;
      }

      const dx = x - dragStartPos.current.x;
      const dy = y - dragStartPos.current.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (!dragActiveRef.current && dist > 6) {
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

      if (ghostElRef.current) {
        ghostElRef.current.remove();
        ghostElRef.current = null;
      }

      if (!dragActiveRef.current) return;
      dragActiveRef.current = false;

      const currentSlot = dragSlotRef.current;
      if (!currentSlot) return;

      const map = mapRef.current;
      if (!map) return;

      const mapEl = map.getContainer();
      const rect = mapEl.getBoundingClientRect();
      const relX = e.clientX - rect.left;
      const relY = e.clientY - rect.top;

      if (relX < 0 || relY < 0 || relX > rect.width || relY > rect.height) return;

      const lngLat = map.unproject([relX, relY]);
      handleMarkerDragEnd(currentSlot, { lng: lngLat.lng, lat: lngLat.lat });
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }, [handleMarkerDragEnd, mapRef]);

  const calculateRoute = useCallback(async () => {
    const rawA = waypointARef.current;
    const rawB = waypointBRef.current;
    if (!rawA || !rawB) return;
    const map = mapRef.current;
    if (!map) { setNavError("Map not ready"); return; }

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
    const updateProgress = (progress: RouteCalculationProgress) => {
      if (calcGenRef.current === myGen && !calcSignal.aborted) {
        setRouteProgress(progress);
      }
    };
    const updatePreview = (coords: [number, number][]) => {
      if (calcGenRef.current !== myGen || calcSignal.aborted || coords.length < 2) return;
      setRoutePreview({
        type: "Feature",
        properties: { preview: true },
        geometry: { type: "LineString", coordinates: [...coords] },
      });
    };
    const yieldToBrowser = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

    setIsCalculating(true);
    updateProgress({ message: "Preparing route area" });
    setRoutePreview(null);
    setNavError(null);

    await yieldToBrowser();

    const t0 = performance.now();
    let graphFetchMs = 0;
    let canvasReadMs = 0;
    let shadeSampleMs = 0;
    let dijkstraMs = 0;

    try {
      const straightLineDistM = haversineMeters(a, b);
      const basePadding = Math.max(0.005, Math.min(0.008, straightLineDistM / 111000 * 0.3));
      const padding = basePadding;
      const routeStops: [number, number][] = [
        a,
        ...additionalWaypoints.map((wp) => snapOutsideBuilding(wp, map as unknown as MapBuildingQuery)),
        b,
      ];
      const allLats = routeStops.map((w) => w[1]);
      const allLngs = routeStops.map((w) => w[0]);
      const south = Math.min(...allLats) - padding;
      const north = Math.max(...allLats) + padding;
      const west = Math.min(...allLngs) - padding;
      const east = Math.max(...allLngs) + padding;

      const tFetch = performance.now();
      updateProgress({ message: "Fetching walk network" });
      const currentBounds = map.getBounds();
      const bboxInView =
        currentBounds.getWest() <= west &&
        currentBounds.getEast() >= east &&
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

      const tCanvas = performance.now();
      updateProgress({ message: "Reading shadow layer" });
      const canvas = map.getCanvas();
      const tmp = document.createElement("canvas");
      tmp.width = canvas.width;
      tmp.height = canvas.height;
      const ctx2d = tmp.getContext("2d")!;
      ctx2d.drawImage(canvas, 0, 0);
      const imageData = ctx2d.getImageData(0, 0, tmp.width, tmp.height);
      const dpr = window.devicePixelRatio || 1;
      canvasReadMs = performance.now() - tCanvas;

      // Project lng/lat → CSS pixels with MapLibre's transform so shade sampling
      // stays correct under any camera orientation. A hand-rolled web-mercator
      // formula is only valid at bearing 0 / pitch 0; the moment the user rotates
      // or tilts the map it samples the wrong pixels and the shade % is garbage.
      const projectToScreen = (lng: number, lat: number): [number, number] => {
        const p = map.project([lng, lat]);
        return [p.x, p.y];
      };

      clearVirtualNodes(graph);

      if (myGen !== calcGenRef.current) return;
      await yieldToBrowser();
      if (myGen !== calcGenRef.current) return;

      const tShade = performance.now();
      let directedEdgeCount = 0;
      const edgeShadeCache = new Map<string, { left: number; right: number }>();
      const edgeShadeKeys = new Set<string>();

      for (const [fromId, edges] of graph.adj) {
        if (fromId < 0) continue;
        const fromNode = graph.nodes.get(fromId);
        if (!fromNode) continue;
        for (const edge of edges) {
          if (edge.toId < 0) continue;
          if (!graph.nodes.has(edge.toId)) continue;
          const lo = Math.min(fromId, edge.toId);
          const hi = Math.max(fromId, edge.toId);
          edgeShadeKeys.add(`${lo},${hi}`);
        }
      }

      let sampledShadeEdges = 0;
      updateProgress({
        message: "Sampling street shade",
        current: sampledShadeEdges,
        total: edgeShadeKeys.size,
      });
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
          const samples = Math.max(3, Math.ceil(edge.distanceM / 25));
          const canonFrom: [number, number] = fromId < edge.toId
            ? [fromNode.lon, fromNode.lat] : [toNode.lon, toNode.lat];
          const canonTo: [number, number] = fromId < edge.toId
            ? [toNode.lon, toNode.lat] : [fromNode.lon, fromNode.lat];
          edgeShadeCache.set(key, sampleBothSidewalks(projectToScreen, imageData, dpr, canonFrom, canonTo, samples));
          sampledShadeEdges++;
          if (sampledShadeEdges === edgeShadeKeys.size || sampledShadeEdges % 100 === 0) {
            updateProgress({
              message: "Sampling street shade",
              current: sampledShadeEdges,
              total: edgeShadeKeys.size,
            });
            await yieldToBrowser();
            if (myGen !== calcGenRef.current) return;
          }
        }
      }
      shadeSampleMs = performance.now() - tShade;

      const tDijkstra = performance.now();
      updateProgress({ message: "Building shade-aware graph" });
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

      updateProgress({ message: "Snapping stops to walkable streets" });
      const MAX_SNAP_DIST_M = 100;
      const snappedStops = snapRouteStopsToReachableEdges(routeStops, routingGraph, {
        maxSnapDistanceM: MAX_SNAP_DIST_M,
        describeStop: (index, total) => {
          if (index === 0) return "the start point";
          if (index === total - 1) return "the destination";
          return `stop ${index + 1}`;
        },
      });
      const effectiveStartId = snappedStops.ids[0];
      const effectiveEndId = snappedStops.ids[snappedStops.ids.length - 1];
      if (process.env.NODE_ENV !== "production") {
        snappedStops.ids.forEach((id, i) => {
          const sn = routingGraph.nodes.get(id);
          if (!sn) return;
          console.log(
            `[routing] stop ${i + 1} [${routeStops[i]}] snapped to connected road at ` +
            `[${sn.lon},${sn.lat}] (${haversineMeters(routeStops[i], [sn.lon, sn.lat]).toFixed(1)} m)`
          );
        });
      }

      const midLat = (a[1] + b[1]) / 2;
      const midLng = (a[0] + b[0]) / 2;
      const solarIntensity = computeSolarIntensity(dateRef.current, midLat, midLng);
      const CROSSING_PENALTY_M = 15;
      const opts = { crossingPenaltyM: CROSSING_PENALTY_M, solarIntensity, straightLineDistM };

      let options: RouteOption[];

      if (additionalWaypoints.length === 0) {
        updateProgress({ message: "Finding route choices" });
        const paretoResults = paretoRoutes(routingGraph, effectiveStartId, effectiveEndId, opts);
        dijkstraMs = performance.now() - tDijkstra;

        // Results are ordered [shortest, balanced, most shaded] with duplicate
        // paths removed — when only 2 remain, the second is always the shaded
        // end of the Pareto front, not "Balanced".
        const ROUTE_LABELS =
          paretoResults.length === 2
            ? ["Shortest", "Most shaded"]
            : ["Shortest", "Balanced", "Most shaded"];
        options = paretoResults.map((result, i) => ({
          label: ROUTE_LABELS[i] ?? "Route",
          geojson: connectRouteEndpoints(graphToGeoJSON(result.nodeIds, routingGraph), a, b),
          distanceM: result.distanceM,
          shadeCoverage: result.shadeCoverage,
          longestContinuousShadeM: result.longestContinuousShadeM,
          shadeTransitions: result.shadeTransitions,
          detourRatio: result.detourRatio,
          turnCount: result.turnCount,
        }));
      } else {
        const nodeChain = snappedStops.ids;

        const MULTI_LABELS = ["Shortest", "Balanced", "Most shaded"] as const;
        const STRENGTHS = [0, 0.5, 1.0];
        const totalRouteLegs = STRENGTHS.length * (nodeChain.length - 1);
        let completedRouteLegs = 0;
        options = [];
        updateProgress({
          message: "Calculating route legs",
          current: completedRouteLegs,
          total: totalRouteLegs,
        });

        for (let si = 0; si < STRENGTHS.length; si++) {
          const strength = STRENGTHS[si];
          let totalDist = 0;
          let totalShadeDist = 0;
          const allCoords: [number, number][] = [];
          let failed = false;
          let failedLeg: number | null = null;

          for (let seg = 0; seg < nodeChain.length - 1; seg++) {
            const segResult = dijkstra(routingGraph, nodeChain[seg], nodeChain[seg + 1], strength, opts);
            completedRouteLegs++;
            updateProgress({
              message: "Calculating route legs",
              current: completedRouteLegs,
              total: totalRouteLegs,
            });
            await yieldToBrowser();
            if (myGen !== calcGenRef.current) return;
            if (!segResult) {
              failed = true;
              failedLeg = seg + 1;
              break;
            }
            const segGeojson = connectRouteEndpoints(
              graphToGeoJSON(segResult.nodeIds, routingGraph),
              routeStops[seg],
              routeStops[seg + 1],
            );
            const coords = segGeojson.geometry.coordinates as [number, number][];
            if (allCoords.length > 0) coords.shift();
            allCoords.push(...coords);
            totalDist += segResult.distanceM;
            totalShadeDist += segResult.distanceM * segResult.shadeCoverage;
            if (si === 0) updatePreview(allCoords);
          }

          if (failed) {
            if (failedLeg != null && allCoords.length >= 2 && totalDist > 0) {
              const shadeCov = totalShadeDist / totalDist;
              options.push({
                label: `${MULTI_LABELS[si] ?? "Route"} (partial)`,
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
                partial: {
                  completedLegs: failedLeg - 1,
                  failedLeg,
                  totalLegs: nodeChain.length - 1,
                },
              });
            }
            continue;
          }
          if (allCoords.length < 2) continue;

          const shadeCov = totalDist > 0 ? totalShadeDist / totalDist : 0;
          options.push({
            label: MULTI_LABELS[si] ?? "Route",
            geojson: connectRouteEndpoints(
              {
                type: "Feature",
                properties: {},
                geometry: { type: "LineString", coordinates: allCoords },
              },
              a,
              b,
            ),
            distanceM: totalDist,
            shadeCoverage: shadeCov,
            longestContinuousShadeM: 0,
            shadeTransitions: 0,
            detourRatio: 1.0,
            turnCount: 0,
          });
        }

        dijkstraMs = performance.now() - tDijkstra;

        options = options.filter((o, i, arr) =>
          arr.findIndex(x => Math.abs(x.distanceM - o.distanceM) < 1) === i
        );
      }

      if (options.length === 0)
        throw new Error(
          "No walkable path found between the selected points. Try points on connected streets."
        );

      // Train transit routing
      if (straightLineDistM <= 500) {
        if (import.meta.env.DEV) console.log("[transit] Skipped: straight-line distance", straightLineDistM.toFixed(0), "m <= 500 m");
      }
      if (straightLineDistM > 500) {
        try {
          updateProgress({ message: "Checking transit option" });
          const trainPadding = Math.max(padding, 0.015);
          const trainSouth = Math.min(a[1], b[1]) - trainPadding;
          const trainNorth = Math.max(a[1], b[1]) + trainPadding;
          const trainWest = Math.min(a[0], b[0]) - trainPadding;
          const trainEast = Math.max(a[0], b[0]) + trainPadding;

          if (import.meta.env.DEV) console.log("[transit] Fetching train graph for bbox:", { trainSouth, trainWest, trainNorth, trainEast });
          const [trainGraph, entrances] = await Promise.all([
            fetchTrainGraph(trainSouth, trainWest, trainNorth, trainEast, calcSignal),
            fetchStationEntrances(trainSouth, trainWest, trainNorth, trainEast, calcSignal),
          ]);
          if (import.meta.env.DEV) console.log("[transit] trainGraph:", trainGraph ? `${trainGraph.stations.size} stations, ${trainGraph.lineColors.size} lines` : "null");
          if (import.meta.env.DEV) console.log("[transit] entrances:", entrances.length);

          if (trainGraph && trainGraph.stations.size >= 2) {
            const stationEntrances = new Map<number, { lat: number; lon: number; kind?: "entrance" | "station" }[]>();
            for (const entrance of entrances) {
              const stationId = matchEntranceToTrainStation(entrance, trainGraph.stations);
              if (stationId != null) {
                if (!stationEntrances.has(stationId)) stationEntrances.set(stationId, []);
                stationEntrances.get(stationId)!.push({ lat: entrance.lat, lon: entrance.lon, kind: entrance.kind });
              }
            }
            for (const [id, station] of trainGraph.stations) {
              if (!stationEntrances.has(id)) {
                stationEntrances.set(id, [{ lat: station.lat, lon: station.lon, kind: "station" }]);
              }
            }

            const bestTrain = findBestTrainRoute(a, b, trainGraph);
            if (import.meta.env.DEV) console.log("[transit] bestTrain:", bestTrain ? `entry=${bestTrain.entryStation.name}, exit=${bestTrain.exitStation.name}, ${bestTrain.path.stationIds.length} stations, ${bestTrain.path.segments.length} segments` : "null");

            if (bestTrain) {
              const WALK_SHADE_STRENGTH = 0.5;

              const boardCandidates = stationEntrances.get(bestTrain.entryStation.id) ?? [{ ...bestTrain.entryStation, kind: "station" }];
              const boardEntrance = pickClosestEntrance(a, boardCandidates, haversineMeters);

              const alightCandidates = stationEntrances.get(bestTrain.exitStation.id) ?? [{ ...bestTrain.exitStation, kind: "station" }];
              const alightEntrance = pickClosestEntrance(b, alightCandidates, haversineMeters);

              const boardNodeId = snapToGraph([boardEntrance.lon, boardEntrance.lat], routingGraph, spatialGrid);
              const walkA = dijkstra(routingGraph, effectiveStartId, boardNodeId, WALK_SHADE_STRENGTH, opts);
              if (import.meta.env.DEV) console.log("[transit] walkA:", walkA ? `${walkA.distanceM.toFixed(0)}m` : "null", "boardNodeId:", boardNodeId);

              const alightNodeId = snapToGraph([alightEntrance.lon, alightEntrance.lat], routingGraph, spatialGrid);
              const walkB = dijkstra(routingGraph, alightNodeId, effectiveEndId, WALK_SHADE_STRENGTH, opts);
              if (import.meta.env.DEV) console.log("[transit] walkB:", walkB ? `${walkB.distanceM.toFixed(0)}m` : "null", "alightNodeId:", alightNodeId);

              if (!walkA || !walkB) {
                if (import.meta.env.DEV) console.warn("[transit] Walk leg failed:", !walkA ? "walkA=null" : "", !walkB ? "walkB=null" : "");
              }
              if (walkA && walkB) {
                const walkAGeoJSON = graphToGeoJSON(walkA.nodeIds, routingGraph);
                const walkBGeoJSON = graphToGeoJSON(walkB.nodeIds, routingGraph);

                const transitCoords: [number, number][] = bestTrain.path.stationIds.map(id => {
                  const s = trainGraph.stations.get(id)!;
                  return [s.lon, s.lat];
                });
                const transitGeoJSON: GeoJSON.Feature<GeoJSON.LineString> = {
                  type: "Feature",
                  properties: {},
                  geometry: { type: "LineString", coordinates: transitCoords },
                };

                const stopNames = bestTrain.path.stationIds.map(id =>
                  trainGraph.stations.get(id)?.name ?? `Station ${id}`
                );

                const primaryLine = bestTrain.path.lines[0] ?? '';
                const lineColor = trainGraph.lineColors.get(primaryLine) ?? '#0070BD';
                const lineName = trainGraph.lineNames.get(primaryLine) ?? primaryLine;
                const lineMode = trainGraph.lineModes.get(primaryLine) ?? 'subway';
                const sunExposure = TRAIN_SUN_EXPOSURE[lineMode];

                const TRAIN_SPEED_MS = 30 * 1000 / 3600;
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
          console.error("[routing] Train routing failed:", e);
        }
      }

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

      if (calcGenRef.current !== myGen) return;
      updateProgress({ message: "Finalizing route options" });
      const partialWarning = options.find((o) => o.partial)?.partial;
      setNavRoutes(options);
      setSelectedRouteIndex(0);
      setRouteSolarIntensity(solarIntensity);
      setRoutePreview(null);
      setSketchPoints([]);
      setNavWarning(partialWarning ? partialRouteNotice(partialWarning) : null);
      setSimplifiedWaypoints(null);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (calcSignal.aborted) return;
      setNavError(e instanceof Error ? e.message : "Routing failed");
    } finally {
      if (calcGenRef.current === myGen) {
        setIsCalculating(false);
        setRouteProgress(null);
        setRoutePreview(null);
      }
    }
  }, [additionalWaypoints, mapRef, dateRef]);

  const handleCalculateRoute = useCallback(() => {
    const useSketch = drawModeRef.current && sketchPointsRef.current.length >= 2;
    if (useSketch) {
      setDrawMode(false);
      calculateSketchRoute();
    } else {
      calculateRoute();
    }
  }, [calculateRoute, calculateSketchRoute]);

  // Derived values
  const selectedRoute = navRoutes[selectedRouteIndex];
  const selectedNavRoute = routePreview ?? (selectedRoute?.legs
    ? ({
        type: "FeatureCollection",
        features: selectedRoute.legs
          .filter((l: RouteLeg) => l.type === 'walk')
          .map((l: RouteLeg) => l.geojson),
      } as GeoJSON.FeatureCollection)
    : navRoutes[selectedRouteIndex]?.geojson ?? null);
  const navTrainDrawData = selectedRoute?.trainDrawData ?? null;
  const navMrtEntrances = selectedRoute?.mrtEntrances ?? null;

  const filteredRoutes = useMemo(() => {
    if (routeMode === 'walk') {
      return navRoutes.filter(r => !r.legs?.find((l: RouteLeg) => l.type === 'transit'));
    }
    return navRoutes.filter(r => !!r.legs?.find((l: RouteLeg) => l.type === 'transit'));
  }, [navRoutes, routeMode]);

  const canTransit = !!(
    waypointA && waypointB &&
    haversineMeters(waypointA, waypointB) > 500
  );

  return {
    // State
    navMode, waypointA, waypointB, navRoutes, selectedRouteIndex,
    isCalculating, routeProgress, navError, routeSolarIntensity,
    waypointALabel, waypointBLabel, pendingSlot,
    saveModalRouteIndex, additionalWaypoints,
    savedRoutes, savedFolders,
    userLocation, isLocating,
    sketchPoints, drawMode, navWarning, simplifiedWaypoints,
    routeMode, shadePreference,

    // Setters
    setPendingSlot, setSelectedRouteIndex, setSaveModalRouteIndex,

    // Handlers
    handleMapClick, handleClear,
    handleOpenSaveModal, handleConfirmSave,
    handleLoadRoute, handleExportRoute,
    handleRemoveAdditionalWaypoint, handleSetAdditionalWaypoints, handleAddAdditionalWaypoint,
    handleDeleteSavedRoute, handleRenameSavedRoute,
    handleLocateMe, handleToggleNavMode, handleDrawModeToggle,
    handleClearSketch, handleRouteModeChange, handleShadePreferenceChange,
    handleSketchPointClick, handleSketchPointDrag, handleSketchFinish,
    handleSetWaypointA, handleSetWaypointB,
    handleUseLocationAsA, handleUseLocationAsB,
    handleSwapWaypoints,
    handleClearWaypointA, handleClearWaypointB,
    handleMarkerDragEnd, handlePinDragStart,
    handleCalculateRoute,

    // Derived
    selectedNavRoute, navTrainDrawData, navMrtEntrances,
    filteredRoutes, canTransit,
  };
}
