import { useRef, useEffect, useCallback, type ReactNode } from "react";
import type maplibregl from "maplibre-gl";

interface AppShellProps {
  /** Content for the desktop sidebar (SideNav wrapping phase content) */
  sidebar: ReactNode;
  /** The MapView element */
  map: ReactNode;
  /** Overlays rendered on top of the map (search, timeline, controls, route cards) */
  mapOverlays?: ReactNode;
  mapRef: React.MutableRefObject<maplibregl.Map | null>;
  /** Whether the desktop sidebar is open */
  sidebarOpen: boolean;
  /** Called to toggle the sidebar open/closed */
  onSidebarToggle: () => void;
}

/**
 * Responsive layout shell.
 *
 * Desktop (>=768px): collapsible 331px frosted-glass sidebar (slides in/out) | map (flex-1)
 * Mobile (<768px):   full-screen map with overlays + BottomSheet (rendered by caller)
 */
export default function AppShell({
  sidebar,
  map,
  mapRef,
  mapOverlays,
  sidebarOpen,
  onSidebarToggle,
}: AppShellProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);

  const resizeMap = useCallback(() => {
    mapRef.current?.resize();
  }, [mapRef]);

  useEffect(() => {
    const el = mapContainerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      requestAnimationFrame(resizeMap);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [resizeMap]);

  return (
    <div className="relative flex h-screen w-screen overflow-hidden" style={{ background: "var(--md-surface)" }}>
      {/* Collapsible sidebar — desktop only */}
      <aside
        className="hidden md:flex flex-col fixed left-0 top-0 h-full z-40 w-[331px] overflow-hidden"
        style={{
          background: "rgba(248,249,250,0.70)",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
          boxShadow: "4px 0 24px rgba(130,85,0,0.05)",
          transform: sidebarOpen ? "translateX(0)" : "translateX(-100%)",
          transition: "transform 300ms ease-in-out",
        }}
      >
        {sidebar}

        {/* Pull-tab — always visible, rides with panel edge */}
        <button
          onClick={onSidebarToggle}
          className="absolute top-1/2 right-0 -translate-y-1/2 translate-x-full w-8 h-16 rounded-r-xl flex items-center justify-center hover:brightness-95 transition-[filter]"
          style={{
            background: "rgba(248,249,250,0.90)",
            backdropFilter: "blur(24px)",
            WebkitBackdropFilter: "blur(24px)",
            boxShadow: "4px 0 16px rgba(130,85,0,0.08)",
          }}
          aria-label={sidebarOpen ? "Close panel" : "Open panel"}
        >
          <span
            className="material-symbols-outlined text-base"
            style={{ color: "var(--md-on-surface-variant)" }}
          >
            {sidebarOpen ? "chevron_left" : "chevron_right"}
          </span>
        </button>
      </aside>

      {/* Map area — margin shifts when sidebar opens */}
      <div
        className="relative flex-1 min-h-0"
        style={{
          marginLeft: sidebarOpen ? "331px" : "0",
          transition: "margin-left 300ms ease-in-out",
        }}
      >
        <div ref={mapContainerRef} className="absolute inset-0 overflow-hidden" style={{ zIndex: 0 }}>
          {map}
          {mapOverlays}
        </div>
      </div>
    </div>
  );
}
