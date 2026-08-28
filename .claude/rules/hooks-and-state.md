---
paths:
  - "app/hooks/**"
---

# Hooks — where all the state actually lives

Four hooks, three of which are the app's entire state model:

- **`useShadowTime`** — date/time, slider mode, play animation, map centre/zoom/UTC offset,
  and `mapRef`
- **`useNavigation`** — waypoints, routes, sketch mode, saved routes, and the whole
  route-calculation pipeline (~1445 lines)
- **`useAppState`** — the UI phase machine: `IDLE → PLACE_DETAIL → DIRECTIONS → NAVIGATING →
  ARRIVAL`
- **`useAgent`** — the assistant's client-side loop wiring

`page.tsx` composes them and passes props down. Components hold no app state. If a component
needs to *set* something, it gets a callback from here — it does not grow its own copy.

## The map ref is a ref

The map instance arrives once via `onMapReady(map)` and lives in a ref, never in state.
Putting it in state re-renders the whole tree on every map event.

## useNavigation is contested

Every track wants this file. Keep changes narrow, and never delegate an edit to it to a
subagent — concurrent edits do not merge, and the routing pipeline it owns is where a plausible
wrong change does the most damage.

Its phase transitions and the `useAppState` machine must stay consistent: a route that
calculates but leaves the phase in `DIRECTIONS`, or an `ARRIVAL` reachable only by a button
tap, are the kind of gap that looks fine in a diff and is obvious in use.

## Tests

Logic changes here need tests — `app/hooks/__tests__/` already covers `useAppState` and
`useNavigation`. The suite runs in `environment: "node"`, so hook tests exercise logic, not
rendering. Test the state transitions and the pipeline's decisions, not React internals.

`useExhaustiveDependencies` is `warn`-level, deliberately: the backlog is real and surfaces
without blocking CI. That is not permission to add new violations — a missing dependency in a
hook that drives the map produces a stale closure holding a dead map instance.

## Async and lifecycle

Route calculation, geocoding and shade sampling are all async and all cancellable in practice
— the user moves the map, changes the time, or picks a different destination mid-flight. Make
sure an in-flight result that arrives late cannot overwrite newer state. Geolocation is
one-shot `getCurrentPosition` today; `watchPosition` appears nowhere in `app/` yet.
