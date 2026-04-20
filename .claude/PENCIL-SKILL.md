# Pencil to Code

Export Pencil `.pen` designs to production React/Tailwind code.

## Interface

**Input:**
- Frame ID to export (or entire document)
- Target framework: React (default), Vue, HTML
- Optional: Component name, output path

**Output:**
- React component(s) with Tailwind classes
- Tailwind theme configuration (from .pen variables)
- Optional: Screenshot comparison for validation

## Workflow

### 1. Read Design Structure

```js
// Get full frame tree
mcp__pencil__batch_get({
  filePath: "<path>.pen",
  nodeIds: ["frameId"],
  readDepth: 10,
  resolveInstances: true,
  resolveVariables: true
})

// Get design variables/theme
mcp__pencil__get_variables({ filePath: "<path>.pen" })
```

### 2. Extract Design Tokens

Transform .pen variables → Tailwind theme. Reference: `references/token-extraction.md`

```css
@theme {
  --color-primary: [from variables.colors.primary];
  --color-background: [from variables.colors.background];
  --font-sans: [from variables.fonts.body];
}
```

### 3. Map Nodes to Components

| .pen Node Type | React Output |
|---|---|
| `frame` with layout | `<div className="flex ...">` |
| `frame` with children | Component with children |
| `text` | `<p>`, `<h1-6>`, or `<span>` |
| `ref` (instance) | Reusable component |
| `rectangle` | `<div>` with fill |
| `ellipse` | `<div className="rounded-full">` |
| `image` | `<img>` or `fill: url()` |

Reference: `references/node-mapping.md`

### 4. Generate Code

```tsx
// components/[ComponentName].tsx
import { cn } from "@/lib/utils"

interface [ComponentName]Props {
  className?: string
  // Extracted props from design
}

export function [ComponentName]({ className, ...props }: [ComponentName]Props) {
  return (
    <div className={cn("[tailwind classes]", className)}>
      {/* Nested structure */}
    </div>
  )
}
```

### 5. Validate (Optional)

```js
// Screenshot the .pen frame
mcp__pencil__get_screenshot({ nodeId: "frameId" })

// Compare visually with rendered React
// (Manual step or browser automation)
```

### 6. Output

```
## Generated Components

### [ComponentName]
- File: `components/[ComponentName].tsx`
- Props: [list extracted props]

### Theme Configuration
- File: `app/globals.css` (additions)

## Verification
Screenshot comparison: [attached]
```

## Translation Rules

### Layout

```
layout: "vertical"       → flex flex-col
layout: "horizontal"     → flex flex-row
layout: "grid"           → grid
alignItems: "center"     → items-center
justifyContent: "center" → justify-center
gap: 8                   → gap-2
gap: 16                  → gap-4
gap: 24                  → gap-6
width: "fill_container"  → w-full
height: "fill_container" → h-full
```

### Spacing (8-point grid)

```
[8,8,8,8]              → p-2
[16,16,16,16]          → p-4
[16,24,16,24]          → py-4 px-6
[24,32,24,32]          → py-6 px-8
```

### Typography

```
fontSize: 12           → text-xs
fontSize: 14           → text-sm
fontSize: 16           → text-base
fontSize: 20           → text-xl
fontSize: 24           → text-2xl
fontSize: 32           → text-3xl
fontSize: 48           → text-5xl
fontWeight: 400        → font-normal
fontWeight: 500        → font-medium
fontWeight: 600        → font-semibold
fontWeight: 700        → font-bold
```

### Colors

```
fill: "#FFFFFF"        → bg-white
fill: "#000000"        → bg-black
fill: variable         → bg-[var(--color-name)]
textColor: "#6B7280"   → text-gray-500
stroke: "#E5E5E5"      → border-gray-200
```

### Border Radius

```
[0,0,0,0]              → rounded-none
[4,4,4,4]              → rounded
[8,8,8,8]              → rounded-lg
[16,16,16,16]          → rounded-2xl
[9999,9999,9999,9999]  → rounded-full
```

## Constraints

- **Single concern**: Export → code. No design modifications.
- **Tailwind 4 @theme**: CSS-first token system
- **React + TypeScript**: Default output target
- **Semantic HTML**: Choose appropriate elements
- **Accessibility**: Include aria attributes where detectable

## References

- `references/node-mapping.md` — Complete node → component mapping
- `references/token-extraction.md` — Variable → theme extraction
- `design-tokens/` — Token system conventions

## Integration

**Called by:** `design-exploration` orchestrator (after direction selection), or direct user invocation.

**Composes:** `design-tokens` (for theme structure)