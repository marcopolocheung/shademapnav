# Sidebar & Search Bar Redesign

**Date:** 2026-03-31
**Scope:** Desktop only (mobile unchanged)

---

## Context

The current desktop layout has a fixed 288px sidebar always visible, branded "Luminous Navigator" with an "Upgrade to Pro" footer button. The search bar floats centered at the top of the map. The search bar has a search icon on the left, and GO / sun / filter buttons on the right. The goal is to make the sidebar collapsible (closed by default), reposition the search bar to the top-left, reorganize the search bar buttons, and remove the branding and upgrade button.

---

## 1. Panel / AppShell

### State
- Add `sidebarOpen: boolean` (default `false`) to `page.tsx`
- Pass `sidebarOpen` and `setSidebarOpen` down to `AppShell` and `SearchBar`

### Width
- Panel width changes from `w-72` (288px) to `w-[331px]` (288 × 1.15)

### Slide animation
- Panel uses CSS transform: `translate-x-0` when open, `-translate-x-full` when closed
- `transition-transform duration-300 ease-in-out`
- Map area: `md:ml-[331px]` when `sidebarOpen`, `md:ml-0` when closed — both with matching transition

### Pull-tab
- Child element of the panel, positioned `absolute right-0 top-1/2 -translate-y-1/2 translate-x-full`
- Size: ~32px wide × 64px tall, `rounded-r-xl`
- Same frosted glass styling as panel (`bg-white/70 backdrop-blur-xl`)
- Contains a chevron icon: `chevron_right` when closed, `chevron_left` when open
- `onClick`: toggles `sidebarOpen`
- Always visible — rides with panel so it peeks 32px from screen edge when closed

---

## 2. SideNav

### Removals
- Entire brand header block: icon, "Luminous Navigator" h1, "Shade-Aware Explorer" subtitle (`mb-8` header section)
- "Upgrade to Pro" button and its container in the bottom section (`mt-auto pt-4` footer block)

### Result
- Panel content begins directly with the 5 nav tabs
- No top padding change needed; existing `p-6` on the flex container remains

---

## 3. SearchBar

### Positioning
- Desktop: `fixed top-4 left-4` (was centered at top of map)
- `z-50` — floats above panel and all other overlays
- Width: `min(480px, calc(100% - 2rem))` — slightly narrower than current to fit top-left
- Mobile: unchanged

### Button layout (left → right)
| Slot | Element | Change |
|------|---------|--------|
| Left | `menu` icon (hamburger) | New — replaces search icon on left |
| Center | Text input (flex-1) | Unchanged |
| Conditional | X clear button | Unchanged |
| Right-1 | `search` icon (magnifying glass) | Moved from left; triggers `handleMagnifierClick` |
| Right-2 | `directions` icon button | New — sets `sidebarOpen=true` + `activeTab="directions"` |

### Removals
- GO button (text "Go", primary background)
- Sun button (`wb_sunny` icon)
- Filter button (`filter_list` icon)

### New props on SearchBar
- `onMenuToggle: () => void` — called when hamburger clicked
- `onDirections: () => void` — called when directions button clicked

---

## 4. Files to Modify

| File | Changes |
|------|---------|
| `app/page.tsx` | Add `sidebarOpen` state; pass `onMenuToggle`, `onDirections` to SearchBar; pass `sidebarOpen` to AppShell |
| `app/components/AppShell.tsx` | Accept `sidebarOpen` prop; change panel width to 331px; add slide transition; add pull-tab; update map margin transition |
| `app/components/SideNav.tsx` | Remove brand header block; remove Upgrade to Pro footer block |
| `app/components/SearchBar.tsx` | Reorder/replace buttons; fix positioning to `fixed top-4 left-4`; accept new props |

---

## 5. Verification

1. `npm run dev` — open in browser
2. Page loads with panel closed; search bar visible top-left; pull-tab visible at left edge
3. Click pull-tab → panel slides open (331px); tab moves to panel's right edge; map shifts right
4. Click pull-tab again → panel slides closed; map shifts back; tab returns to left edge
5. Click hamburger in search bar → same result as pull-tab
6. Click directions icon in search bar → panel opens to Directions tab
7. Search bar floats above open panel (z-index)
8. Panel no longer shows "Luminous Navigator" or "Upgrade to Pro"
9. Mobile layout is completely unchanged
