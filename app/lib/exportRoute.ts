// app/lib/exportRoute.ts
import type { RouteOption } from "./routing";

export function routeToGeoJSON(route: RouteOption): string {
  const fc: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [route.geojson],
  };
  return JSON.stringify(fc, null, 2);
}

export function routeToGPX(route: RouteOption, name: string): string {
  const coords = route.geojson.geometry.coordinates as [number, number][];
  const trkpts = coords
    .map(([lon, lat]) => `    <trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"/>`)
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="ShadeMapNavigator" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${escapeXml(name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function downloadBlob(content: string, filename: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
