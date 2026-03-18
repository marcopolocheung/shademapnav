# Marker Swing Animation — Implementation Plan

## Goal
Add a pendulum-swing CSS animation to MapLibre waypoint markers (A/B) while the user drags them, with a settle-bounce on drop.

---

## Files to Modify

### 1. `app/globals.css`
Inject the keyframe and utility class here so it loads once globally.

**Append to end of file:**
```css
@keyframes markerSwing {
  0%   { transform: rotate(0deg)   scale(1); }
  20%  { transform: rotate(-18deg) scale(1.08); }
  40%  { transform: rotate(14deg)  scale(1.05); }
  60%  { transform: rotate(-10deg) scale(1.03); }
  80%  { transform: rotate(6deg)   scale(1.01); }
  100% { transform: rotate(0deg)   scale(1); }
}

.marker-swinging {
  animation: markerSwing 0.45s ease-in-out infinite alternate;
  transform-origin: center bottom;
  cursor: grabbing !important;
  filter: drop-shadow(0 6px 12px rgba(0,0,0,0.45));
}
```

---

### 2. `app/components/MapView.tsx`

#### Step A — Add helper function
Add this function at **module scope** (outside the component), near the other helpers:

```ts
function attachSwingBehavior(marker: maplibregl.Marker): void {
  const el = marker.getElement();

  marker.on('dragstart', () => {
    el.classList.add('marker-swinging');
  });

  marker.on('dragend', () => {
    el.classList.remove('marker-swinging');
    el.animate(
      [
        { transform: 'rotate(0deg) scale(1.08)' },
        { transform: 'rotate(-5deg) scale(1.04)' },
        { transform: 'rotate(3deg) scale(1.02)' },
        { transform: 'rotate(0deg) scale(1)' },
      ],
      { duration: 350, easing: 'ease-out', fill: 'forwards' }
    );
  });
}
```

#### Step B — Call helper after each marker is created
Find the `useEffect` that manages `markerARef` and `markerBRef`. Immediately after each `new maplibregl.Marker(...).setLngLat(...).addTo(map)` call, invoke:

```ts
attachSwingBehavior(markerARef.current);
// and
attachSwingBehavior(markerBRef.current);
```

Both markers must have `draggable: true` already set (per existing build state — confirm before skipping).

---

## Acceptance Criteria

- [ ] Dragging marker A or B triggers the swing animation immediately on `dragstart`
- [ ] Animation oscillates continuously (alternate direction) while held
- [ ] Releasing the marker removes the swing class and plays the settle bounce
- [ ] No animation plays when the marker is idle
- [ ] No regressions to routing, waypoint state updates, or marker re-creation on route recalc

---

## Notes / Gotchas

- `transform-origin: center bottom` is critical — pivots from the pin tip, not the element center
- If markers use custom HTML elements instead of the default MapLibre pin, verify the class is applied to the outermost wrapper element returned by `getElement()`
- The `useEffect` that manages markers may recreate them when `navWaypoints` changes — ensure `attachSwingBehavior` is called every time a marker is newly instantiated, not just once
- Do not add the CSS via a JS `<style>` injection — use `globals.css` to keep styling centralised and avoid duplication on HMR reloads