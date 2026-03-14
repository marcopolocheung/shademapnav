// app/lib/savedRoutes.ts
import type { RouteOption } from "./routing";

export interface SavedFolder {
  id: string;
  name: string;
  createdAt: number;
}

export interface SavedRoute {
  id: string;
  name: string;
  folderId: string | null; // null = uncategorised
  routeOption: RouteOption; // full serialised RouteOption (geometry included)
  waypointA: [number, number];
  waypointB: [number, number];
  waypointALabel: string | null;
  waypointBLabel: string | null;
  additionalWaypoints: [number, number][];
  timeOfDayMinutes: number; // 0–1439
  dateIso: string;          // "YYYY-MM-DD"
  createdAt: number;
}

const FOLDERS_KEY = "shademapnav:folders";
const ROUTES_KEY  = "shademapnav:routes";

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function getFolders(): SavedFolder[] {
  return readJSON<SavedFolder[]>(FOLDERS_KEY, []);
}

export function saveFolders(folders: SavedFolder[]): void {
  localStorage.setItem(FOLDERS_KEY, JSON.stringify(folders));
}

export function getRoutes(): SavedRoute[] {
  return readJSON<SavedRoute[]>(ROUTES_KEY, []);
}

export function saveRoutes(routes: SavedRoute[]): void {
  localStorage.setItem(ROUTES_KEY, JSON.stringify(routes));
}

export function createFolder(name: string): SavedFolder {
  const folder: SavedFolder = { id: crypto.randomUUID(), name, createdAt: Date.now() };
  saveFolders([...getFolders(), folder]);
  return folder;
}

export function deleteFolder(id: string): void {
  saveFolders(getFolders().filter(f => f.id !== id));
  // orphan routes (set folderId null)
  saveRoutes(getRoutes().map(r => r.folderId === id ? { ...r, folderId: null } : r));
}

export function createRoute(route: Omit<SavedRoute, "id" | "createdAt">): SavedRoute {
  const saved: SavedRoute = { ...route, id: crypto.randomUUID(), createdAt: Date.now() };
  saveRoutes([...getRoutes(), saved]);
  return saved;
}

export function updateRoute(id: string, patch: Partial<SavedRoute>): void {
  saveRoutes(getRoutes().map(r => r.id === id ? { ...r, ...patch } : r));
}

export function deleteRoute(id: string): void {
  saveRoutes(getRoutes().filter(r => r.id !== id));
}
