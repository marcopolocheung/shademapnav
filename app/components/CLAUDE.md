# app/components

React UI components. All render client-side only (no SSR).

## Patterns
- Components receive state and callbacks as props from `page.tsx` — no local routing state
- Tailwind CSS v4 for all styling; no CSS modules or styled-components
- Overlays positioned absolute within the full-screen map container

## Key Files
- `MapView.tsx` — MapLibre GL map + ShadeMap shadow layer; lazy-loaded via `React.lazy`; exposes map via `onMapReady` callback; manages nav markers, route GeoJSON layer, and sketch polyline (drawn during waypoint placement, cleared after route is calculated)
- `TimelineSlider.tsx` — Custom 24-h scrollable ruler (2880 px wide, 2 px/min); inertial drag with EMA velocity; fixed red center cursor; no native range input
- `NavigationPanel.tsx` — Routing UI: waypoint list, route cards (Shortest/Balanced/Most Shaded/Via Transit), export buttons, error display; includes draw/sketch mode toggle and user geolocation ("Locate me" button with "Use as start/end" options)
- `AccumulationPanel.tsx` — Sun exposure mode toggle, date range picker, quality slider, GeoTIFF export; contains inline binary TIFF writer (`buildGeoTIFF`)
- `LocationSearch.tsx` — Nominatim geocoding with 400 ms debounce; requires `User-Agent` header
- `SaveRouteModal.tsx` — Modal for naming and saving routes to localStorage folders
- `SettingsPanel.tsx` — App settings (currently minimal)
- `DaySlider.tsx` — Day-of-year slider for accumulation mode
- `DateInput.tsx` — Styled date input wrapper

## Gotchas
- `MapView.tsx` uses `initRef` to guard against double-init under React Strict Mode / HMR
- `onMapClickRef` and `dateRef` mirror props into refs to avoid stale closures in map event handlers
- `shadeUpdateTimerRef` debounces `setDate` calls by 1 ms to prevent GPU thrash on rapid slider drags
- Never import `MapView` directly — always via `React.lazy(() => import(...))` in `page.tsx`
- `AccumulationPanel.tsx` reads the map canvas via `toBlob → createImageBitmap → getImageData`; requires `preserveDrawingBuffer: true`
