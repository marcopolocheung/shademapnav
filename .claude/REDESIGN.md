# ShadeMap Navigator — Treasure Map Redesign

Implement a full visual redesign with an antique treasure map aesthetic: frosted parchment glass panels, brass typography, warm cartographic map style, and a compass-needle timeline cursor. **Do not touch any routing, shadow, data, or map logic — visual/style changes only.**

**In app/components/MapView.tsx, ensure ENABLE_3D is set to false. Do not change this value.**

---

## Step 1 — Fonts (`index.html`)

Add inside `<head>`:

```html
<link href="https://fonts.googleapis.com/css2?family=IM+Fell+English:ital@0;1&family=Crimson+Pro:ital,wght@0,400;0,600;1,400&family=Special+Elite&display=swap" rel="stylesheet">
```

---

## Step 2 — CSS Tokens & Utility Classes (`app/globals.css`)

Add to the top of the file (before or replacing existing `:root`):

```css
:root {
  --parchment:      #f4e9d0;
  --parchment-dark: #e8d4a8;
  --ink:            #3d2b1f;
  --ink-muted:      rgba(61, 43, 31, 0.65);
  --brass:          #c8960c;
  --brass-dim:      rgba(200, 175, 110, 0.35);
  --brass-glow:     rgba(200, 150, 12, 0.18);
  --vermillion:     #9b3a2a;
  --sea-teal:       #4a7c7e;
  --map-green:      #7caa6e;

  --glass-bg:       rgba(242, 231, 198, 0.13);
  --glass-border:   rgba(200, 175, 110, 0.32);
  --glass-shadow:   0 2px 16px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,240,180,0.10);
  --glass-blur:     blur(14px) saturate(1.2);

  --font-serif:     'Crimson Pro', Georgia, serif;
  --font-display:   'IM Fell English', serif;
  --font-mono:      'Special Elite', monospace;
}

.glass-panel {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: 10px;
  box-shadow: var(--glass-shadow);
  color: var(--parchment);
  font-family: var(--font-serif);
}

.panel-heading {
  font-family: var(--font-display);
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--brass);
  opacity: 0.9;
  margin-bottom: 10px;
}
```

---

## Step 3 — Apply Glass Panels to UI Components

In each file below, find the **outermost container div** and add `glass-panel` to its `className`. Remove any existing dark background classes (e.g. `bg-gray-900`, `bg-zinc-800`, `bg-black/80`) from that element only.

Also replace any section title/heading elements with `className="panel-heading"` and update their `font-family` if set inline.

| File | What to change |
|---|---|
| `app/components/NavigationPanel.tsx` | Outer wrapper → add `glass-panel`; section titles → `panel-heading` |
| `app/components/AccumulationPanel.tsx` | Outer wrapper → add `glass-panel`; section titles → `panel-heading` |
| `app/components/LocationSearch.tsx` | Outer wrapper → add `glass-panel`; input text color → `var(--parchment)`; placeholder → `rgba(244,237,212,0.45)` |
| `app/components/SettingsPanel.tsx` | Outer wrapper → add `glass-panel`; section titles → `panel-heading` |
| `app/components/SaveRouteModal.tsx` | Modal container → add `glass-panel` |

For any `<input>` or `<button>` inside these panels, set:
```css
background: transparent;
color: var(--parchment);
border-color: var(--brass-dim);
font-family: var(--font-serif);
```

---

## Step 4 — Map Style (`app/components/MapView.tsx`)

Find the MapLibre `Map` constructor (look for the `style:` key — currently `dataviz-dark` or similar). Replace with:

```ts
style: `https://api.maptiler.com/maps/topo-v2/style.json?key=${import.meta.env.VITE_MAPTILER_API_KEY}`,
```

> `topo-v2` gives warm terrain contours, earthy greens, and aged beige landmass — the closest MapTiler free style to a cartographic/treasure map look. If you want a more dramatic hand-painted look, use `stamen_watercolor` from Stadia Maps (no key needed for dev): `https://tiles.stadiamaps.com/styles/stamen_watercolor.json`

---

## Step 5 — Route Line Color (`app/components/MapView.tsx`)

Find the `nav-route-line` layer paint properties and update:

```ts
paint: {
  'line-color': '#c8390a',   // vermillion (was amber #f59e0b)
  'line-width': 3,
  'line-opacity': 0.85,
}
```

---

## Step 6 — Timeline Slider Reskin (`app/components/TimelineSlider.tsx`)

### Tick colors
Find where canvas tick marks are drawn (the `ctx.strokeStyle` / `ctx.fillStyle` assignments) and update:

```ts
// Hour ticks + labels
ctx.strokeStyle = 'rgba(200, 175, 110, 0.75)';
ctx.fillStyle   = 'rgba(200, 175, 110, 0.75)';

// 15-min ticks
ctx.strokeStyle = 'rgba(200, 175, 110, 0.35)';

// 5-min ticks
ctx.strokeStyle = 'rgba(200, 175, 110, 0.18)';

// Canvas/ruler background (if set)
ctx.fillStyle = 'rgba(28, 20, 12, 0.0)'; // transparent — controlled by wrapper
```

### Font for hour labels
Find where tick labels are drawn:
```ts
ctx.font = "9px 'Special Elite', monospace";
```

### Ruler wrapper div
Find the outer container div of the ruler and add/replace classes:
```
bg-[#1c140c]/85 backdrop-blur-md border-t border-[rgba(200,175,110,0.28)]
```

### Compass needle cursor
Find the center red cursor element (likely a thin vertical `div` with a red background). Replace it with:

```tsx
{/* Diamond cap */}
<div className="absolute pointer-events-none"
  style={{
    top: '-4px',
    left: '50%',
    transform: 'translateX(-50%) rotate(45deg)',
    width: '8px',
    height: '8px',
    background: '#c8390a',
    boxShadow: '0 0 8px rgba(200,57,10,0.85)',
  }}
/>
{/* Needle shaft */}
<div className="absolute pointer-events-none"
  style={{
    top: 0,
    left: '50%',
    transform: 'translateX(-50%)',
    width: '2px',
    height: '100%',
    background: 'linear-gradient(to bottom, #c8390a, rgba(200,57,10,0.35))',
    boxShadow: '0 0 6px rgba(200,57,10,0.55)',
  }}
/>
```

### Controls row (time/date display)
In `app/page.tsx`, find the `TimeInput` component and the date/time display elements in the controls row. Update their inline styles:

```tsx
// Time display
style={{ fontFamily: "'Special Elite', monospace", color: '#e8c97a', letterSpacing: '0.08em' }}

// Date display
style={{ fontFamily: "'Crimson Pro', serif", color: 'rgba(200,175,110,0.65)', fontStyle: 'italic' }}

// Play/pause button
style={{ color: 'rgba(200,175,110,0.7)' }}
```

---

## Step 7 — Compass Rose Overlay

Add this component to `app/page.tsx` (define it at the bottom of the file, outside the main component):

```tsx
function CompassRose() {
  return (
    <div
      className="absolute pointer-events-none select-none"
      style={{ top: '16px', right: '16px', width: '56px', height: '56px', opacity: 0.4 }}
    >
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="32" cy="32" r="30" stroke="#c8b06a" strokeWidth="0.8" opacity="0.5"/>
        <circle cx="32" cy="32" r="24" stroke="#c8b06a" strokeWidth="0.4" opacity="0.4"/>
        {/* Cardinal labels */}
        {([['N',32,8],['S',32,58],['E',58,32],['W',6,32]] as [string,number,number][]).map(([d,x,y]) => (
          <text key={d} x={x} y={y} textAnchor="middle" dominantBaseline="central"
            fill="#c8b06a" fontSize="7" fontFamily="IM Fell English, serif">{d}</text>
        ))}
        {/* N pointer (vermillion) */}
        <polygon points="32,10 29,32 32,28 35,32" fill="#9b3a2a" opacity="0.9"/>
        {/* S pointer (brass) */}
        <polygon points="32,54 29,32 32,36 35,32" fill="#c8b06a" opacity="0.6"/>
        {/* Center */}
        <circle cx="32" cy="32" r="2.5" fill="#c8b06a" opacity="0.8"/>
        <circle cx="32" cy="32" r="1" fill="#9b3a2a"/>
      </svg>
    </div>
  );
}
```

Then render it inside the main map container in the JSX, as a sibling to `<MapView>`:

```tsx
<CompassRose />
```

---

## Summary of Files Changed

| File | Change |
|---|---|
| `index.html` | Add Google Fonts link |
| `app/globals.css` | Add CSS variables + `.glass-panel` + `.panel-heading` |
| `app/components/NavigationPanel.tsx` | `glass-panel` class, `panel-heading` titles |
| `app/components/AccumulationPanel.tsx` | `glass-panel` class, `panel-heading` titles |
| `app/components/LocationSearch.tsx` | `glass-panel` class, input colors |
| `app/components/SettingsPanel.tsx` | `glass-panel` class, `panel-heading` titles |
| `app/components/SaveRouteModal.tsx` | `glass-panel` class on modal |
| `app/components/MapView.tsx` | Map style URL → `topo-v2`; route line color → vermillion |
| `app/components/TimelineSlider.tsx` | Tick colors → brass; cursor → compass needle; ruler bg |
| `app/page.tsx` | Time/date display colors; add `<CompassRose />` component |

**No routing, shadow, tile, or data logic is touched.**