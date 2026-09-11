import type { CanopyLegendState } from "../lib/canopyRaster/canopyLayer";
import {
  CANOPY_FILL_OPACITY,
  CANOPY_FILL_RGB,
  CANOPY_PAINT_MIN_HEIGHT_M,
} from "../lib/canopyRaster/canopyPaint";

/** outdoor-v2's street-zoom background, `hsl(120, 4%, 95%)` — what the fill lies over. */
const BASEMAP_RGB = [241, 243, 241];

/** The fill as the map shows it: composited over the basemap, not the raw colour. */
const SWATCH = `rgb(${CANOPY_FILL_RGB.map((c, i) =>
  Math.round(c * CANOPY_FILL_OPACITY + BASEMAP_RGB[i] * (1 - CANOPY_FILL_OPACITY))
).join(",")})`;

const imageryMonth = (date: string) =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString("en", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });

/**
 * Says what the green fill is, whenever there is fill to explain.
 *
 * It is a model's estimate from satellite imagery, and the UI rule is that every
 * claim states its uncertainty. Where the imagery was flown with the trees bare
 * (#281), it says that too — and then shows even over an empty map, because there
 * the absence of green is not evidence of no trees.
 *
 * Kept to one line on a phone: it is permanent and sits over the map being read.
 */
export default function CanopyLegend({ state }: { state: CanopyLegendState | null }) {
  if (!state) return null;
  const { imagery } = state;

  return (
    <div
      // Phone: under the search bar and the shadow legend. Desktop: bottom-left above
      // the timeline, but past the 408 px sidebar (`AppShell.tsx`), which covers the
      // map's left edge whenever it is open — exactly when a route card is quoting
      // canopy. The map container spans the sidebar, so a centred plate slid under it.
      className="pointer-events-none absolute left-4 top-36 z-10 max-w-[calc(100%-2rem)] rounded-lg border px-3 py-1.5 text-xs shadow-lg md:top-auto md:bottom-36 md:left-[calc(408px+1rem)] md:max-w-[15.5rem]"
      style={{
        background: "rgba(255,255,255,0.94)",
        borderColor: "var(--md-outline-variant)",
        color: "var(--md-on-surface)",
        fontFamily: "var(--md-font)",
      }}
      role="note"
      data-testid="canopy-legend"
    >
      <div className="flex items-center gap-2 font-medium">
        <span
          className="h-4 w-4 shrink-0 rounded-sm border"
          style={{ background: SWATCH, borderColor: "rgba(15,23,42,0.28)" }}
          aria-hidden="true"
        />
        Estimated tree canopy (satellite)
      </div>
      <p className="mt-0.5 hidden leading-snug md:block" style={{ color: "var(--md-on-surface-variant)" }}>
        Modelled heights, {CANOPY_PAINT_MIN_HEIGHT_M} m and taller. Not a tree survey.
      </p>
      {imagery?.leafOff && (
        <p className="mt-0.5 leading-snug font-medium" style={{ color: "#92400e" }}>
          {imageryMonth(imagery.date)} imagery, trees bare: undercounts
        </p>
      )}
    </div>
  );
}
