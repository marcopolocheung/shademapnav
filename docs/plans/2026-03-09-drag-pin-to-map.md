# Drag Pin to Map Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow the user to drag the A/B pin button from the NavigationPanel sidebar onto the map to place a waypoint.

**Architecture:** All drag orchestration lives in `page.tsx`. `NavigationPanel` gets an `onPinDragStart` prop and calls it on `pointerdown` on the pin buttons. `page.tsx` creates a DOM ghost pin that follows the cursor; on `pointerup` over the map it converts client coords to lngLat via `map.unproject()` and reuses the existing `handleMarkerDragEnd` to place the waypoint. Click-to-place (`pendingSlot`) is unaffected — browsers suppress `click` naturally when the pointer moves >5px.

**Tech Stack:** React refs, Pointer Events API, MapLibre `unproject()`, existing `handleMarkerDragEnd` + `geocodeReverse`.

---

### Task 1: Add `onPinDragStart` prop to NavigationPanel

**Files:**
- Modify: `app/components/NavigationPanel.tsx`

**Step 1: Add prop to interface**

In `NavigationPanelProps` (line 5), add:

```ts
onPinDragStart?: (slot: 'A' | 'B') => void;
```

**Step 2: Destructure the prop**

In the `NavigationPanel` function signature (around line 396), add `onPinDragStart` to the destructured props.

**Step 3: Wire pin button A (around line 516)**

Change the pin button for A from:
```tsx
<button
  onClick={() => onSetPendingSlot(pendingSlot === 'A' ? null : 'A')}
  ...
>
```
to:
```tsx
<button
  onClick={() => onSetPendingSlot(pendingSlot === 'A' ? null : 'A')}
  onPointerDown={(e) => { onPinDragStart?.('A'); }}
  ...
>
```

**Step 4: Wire pin button B (around line 554)**

Same change for B:
```tsx
<button
  onClick={() => onSetPendingSlot(pendingSlot === 'B' ? null : 'B')}
  onPointerDown={(e) => { onPinDragStart?.('B'); }}
  ...
>
```

**Step 5: Verify no TypeScript errors**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors (or only pre-existing errors unrelated to this change).

---

### Task 2: Implement drag orchestration in page.tsx

**Files:**
- Modify: `app/page.tsx`

**Step 1: Add drag refs near the other refs (around line 271)**

Find the block of refs and add:
```ts
const dragSlotRef     = useRef<'A' | 'B' | null>(null);
const dragStartPos    = useRef<{ x: number; y: number } | null>(null);
const dragActiveRef   = useRef(false);
const ghostElRef      = useRef<HTMLDivElement | null>(null);
```

**Step 2: Add the `handlePinDragStart` function**

Add this function after the `handleMarkerDragEnd` block (around line 607):

```ts
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

    const slot = dragSlotRef.current;
    if (!slot) return;

    const map = mapRef.current;
    if (!map) return;

    const mapEl = map.getContainer();
    const rect = mapEl.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const relY = e.clientY - rect.top;

    // Only place if released over the map
    if (relX < 0 || relY < 0 || relX > rect.width || relY > rect.height) return;

    const lngLat = map.unproject([relX, relY]);
    handleMarkerDragEnd(slot, { lng: lngLat.lng, lat: lngLat.lat });
  }

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
}, [handleMarkerDragEnd]);
```

> Note: `handleMarkerDragEnd` already sets the waypoint coord + label and triggers async reverse geocode. No need to duplicate that logic.

**Step 3: Pass `onPinDragStart` to NavigationPanel**

Find the `<NavigationPanel ...>` JSX (around line 1420) and add:
```tsx
onPinDragStart={handlePinDragStart}
```

**Step 4: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```
Expected: no new errors.

**Step 5: Manual smoke test**

1. `npm run dev` → open http://localhost:5173
2. Click **Navigate**
3. Slowly **click** the green pin button → `pendingSlot` mode activates (banner appears, amber pulse on button). Click still works.
4. Press Escape to cancel. Now **click-drag** the green pin button out onto the map and release.
5. Verify: green marker appears at the drop location, label shows coordinates, reverse geocode resolves after ~1s.
6. Repeat for the red pin button (B).
7. Release the pin button outside the map → nothing happens.

**Step 6: Commit**

```bash
git add app/components/NavigationPanel.tsx app/page.tsx
git commit -m "feat: drag pin button from sidebar to place waypoint on map"
```

---

### Edge cases covered

| Scenario | Behaviour |
|---|---|
| Click without drag (<6px) | `click` fires → `pendingSlot` mode as before |
| Drag to map | Ghost follows cursor; drop places marker via `handleMarkerDragEnd` |
| Drag off-map | Ghost disappears, no waypoint set |
| Both A and B | Independent drag handlers; ghost colour matches slot |
| Esc key during drag | Not handled — drag continues (acceptable; user can abort by releasing outside map) |
