import type maplibregl from "maplibre-gl";

interface FloatingMapControlsProps {
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  onLocateMe: () => void;
  isLocating: boolean;
  onShare?: () => void;
  shareStatus?: "idle" | "copied" | "error";
}

export default function FloatingMapControls({
  mapRef,
  onLocateMe,
  isLocating,
  onShare,
  shareStatus = "idle",
}: FloatingMapControlsProps) {
  return (
    <div className="flex flex-col gap-3">
      {/* Zoom in */}
      <button
        onClick={() => mapRef.current?.zoomIn()}
        className="w-12 h-12 rounded-2xl bg-white shadow-xl flex items-center justify-center text-slate-600 hover:text-amber-700 transition-colors"
        aria-label="Zoom in"
        title="Zoom in"
      >
        <span className="material-symbols-outlined">add</span>
      </button>

      {/* Zoom out */}
      <button
        onClick={() => mapRef.current?.zoomOut()}
        className="w-12 h-12 rounded-2xl bg-white shadow-xl flex items-center justify-center text-slate-600 hover:text-amber-700 transition-colors"
        aria-label="Zoom out"
        title="Zoom out"
      >
        <span className="material-symbols-outlined">remove</span>
      </button>

      <div className="h-px w-8 bg-slate-200 self-center my-1" />

      {onShare && (
        <button
          onClick={onShare}
          className="w-12 h-12 rounded-2xl bg-white shadow-xl flex items-center justify-center text-slate-600 hover:text-amber-700 transition-colors"
          aria-label={shareStatus === "copied" ? "Share link copied" : "Copy share link"}
          title={shareStatus === "copied" ? "Copied" : shareStatus === "error" ? "Copy failed" : "Copy share link"}
        >
          <span
            className="material-symbols-outlined"
            style={{ fontVariationSettings: shareStatus === "copied" ? "'FILL' 1" : undefined }}
          >
            {shareStatus === "copied" ? "check" : "ios_share"}
          </span>
        </button>
      )}

      {/* My Location */}
      <button
        onClick={onLocateMe}
        className="w-12 h-12 rounded-2xl bg-white shadow-xl flex items-center justify-center text-slate-600 hover:text-amber-700 transition-colors"
        aria-label="My location"
        title="My location"
        disabled={isLocating}
      >
        {isLocating ? (
          <svg width="20" height="20" viewBox="0 0 20 20" className="animate-spin text-amber-700">
            <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="32" strokeDashoffset="8" strokeLinecap="round" />
          </svg>
        ) : (
          <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>my_location</span>
        )}
      </button>

      {/* 3D / Reset bearing */}
      <button
        onClick={() => mapRef.current?.resetNorthPitch()}
        className="w-12 h-12 rounded-2xl bg-white shadow-xl flex items-center justify-center text-slate-600 hover:text-amber-700 transition-colors"
        aria-label="Reset view"
        title="Reset view"
      >
        <span className="material-symbols-outlined">3d_rotation</span>
      </button>
    </div>
  );
}
