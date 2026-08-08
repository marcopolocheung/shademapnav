import { useState, useRef, useEffect, lazy, Suspense } from "react";
import TimelineSlider from "./components/TimelineSlider";
import AccumulationPanel from "./components/AccumulationPanel";
import SaveRouteModal from "./components/SaveRouteModal";
import SettingsPanel from "./components/SettingsPanel";
import DateInput from "./components/DateInput";
import DaySlider from "./components/DaySlider";
import AppShell from "./components/AppShell";
import SideNav, { type SideNavTab } from "./components/SideNav";
import BottomSheet, { type SnapPoint } from "./components/BottomSheet";
import SearchBar from "./components/SearchBar";
import FloatingMapControls from "./components/FloatingMapControls";
import FloatingRouteCards from "./components/FloatingRouteCards";
import QuickActions from "./components/QuickActions";
import DirectionsPanel from "./components/DirectionsPanel";
import PlaceDetail from "./components/PlaceDetail";
import AssistantPanel from "./components/AssistantPanel";

import { toMapLocal, fromMapLocal } from "./lib/timezone";
import { useShadowTime, formatTime12h, parseTime, dateToDayOfYear } from "./hooks/useShadowTime";
import { useNavigation } from "./hooks/useNavigation";
import { useAppState } from "./hooks/useAppState";
import { useAgent } from "./hooks/useAgent";

const MapView = lazy(() => import("./components/MapView"));

function TimeInput({ date, onChange, utcOffsetMin }: { date: Date; onChange: (d: Date) => void; utcOffsetMin: number }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const shouldCommitRef = useRef(true);

  function startEdit() {
    shouldCommitRef.current = true;
    setText(formatTime12h(date, utcOffsetMin));
    setEditing(true);
  }

  function commit(val: string) {
    if (!shouldCommitRef.current) {
      shouldCommitRef.current = true;
      return;
    }
    setEditing(false);
    const mins = parseTime(val);
    if (mins !== null) {
      const next = fromMapLocal(date, utcOffsetMin, Math.floor(mins / 60), mins % 60);
      onChange(next);
    }
  }

  if (editing) {
    return (
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit(text)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            shouldCommitRef.current = false;
            setEditing(false);
          }
        }}
        className="rounded px-2 py-1 text-xs border focus:outline-none w-20 text-center"
        style={{
          background: "var(--md-surface-container-low)",
          color: "var(--md-on-surface)",
          borderColor: "var(--md-outline-variant)",
          fontFamily: "var(--md-font)",
        }}
        autoFocus
      />
    );
  }

  return (
    <button
      onClick={startEdit}
      className="text-xs tabular-nums w-20 text-center rounded px-2 py-1 hover:bg-slate-100 transition-colors"
      style={{ color: "var(--md-on-surface-variant)", fontFamily: "var(--md-font)" }}
      title="Click to type a time (e.g. 6:30 AM, 14:30)"
    >
      {formatTime12h(date, utcOffsetMin)}
    </button>
  );
}

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const shadow = useShadowTime();
  const {
    date, setDate,
    showSunLines, setShowSunLines,
    accumulation, setAccumulation,
    isPlaying, setIsPlaying,
    sliderMode, setSliderMode,
    mapCenter, mapZoom, mapUtcOffsetMin,
    handleMapReady, handleSliderChange, handleDayOfYearChange,
    adjustYear, jumpTo, getCanvas, getBounds,
    mapRef, dateRef,
  } = shadow;

  const nav = useNavigation({ mapRef, dateRef, setDate });
  const {
    navMode, waypointA, waypointB, navRoutes, selectedRouteIndex,
    isCalculating, navError, routeSolarIntensity,
    waypointALabel, waypointBLabel, pendingSlot,
    saveModalRouteIndex, additionalWaypoints,
    savedRoutes, savedFolders,
    userLocation, isLocating,
    sketchPoints, drawMode, navWarning, simplifiedWaypoints,
    routeMode, shadePreference,
    setPendingSlot, setSelectedRouteIndex, setSaveModalRouteIndex,
    handleMapClick, handleClear,
    handleOpenSaveModal, handleConfirmSave,
    handleLoadRoute, handleExportRoute,
    handleRemoveAdditionalWaypoint,
    handleDeleteSavedRoute, handleRenameSavedRoute,
    handleLocateMe, handleToggleNavMode, handleDrawModeToggle,
    handleClearSketch, handleRouteModeChange, handleShadePreferenceChange,
    handleSketchPointClick, handleSketchPointDrag, handleSketchFinish,
    handleSetWaypointA, handleSetWaypointB,
    handleSwapWaypoints,
    handleClearWaypointA, handleClearWaypointB,
    handleMarkerDragEnd, handlePinDragStart,
    handleCalculateRoute,
    selectedNavRoute, navTrainDrawData, navMrtEntrances,
    filteredRoutes, canTransit,
  } = nav;

  const { phase, selectedPlace, dispatch } = useAppState();
  const [bottomSheetSnap, setBottomSheetSnap] = useState<SnapPoint>("collapsed");

  // AI assistant (shade-aware day-trip planner)
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantPins, setAssistantPins] = useState<{ lng: number; lat: number; label?: string }[]>([]);
  const agent = useAgent({
    mapRef,
    dateRef,
    setDate,
    mapUtcOffsetMin,
    userLocation,
    setWaypointA: handleSetWaypointA,
    setWaypointB: handleSetWaypointB,
    calculateRoute: handleCalculateRoute,
    setPins: setAssistantPins,
  });

  // Sync activeTab with phase
  const [activeTab, setActiveTab] = useState<SideNavTab>("map");

  const handleTabChange = (tab: SideNavTab) => {
    setActiveTab(tab);
    if (tab === "directions") {
      dispatch({ type: "START_DIRECTIONS" });
    } else if (tab === "map") {
      if (phase === "DIRECTIONS" || phase === "NAVIGATING") {
        dispatch({ type: "BACK" });
      }
    }
  };

  const handleSidebarToggle = () => setSidebarOpen((o) => !o);

  const handleOpenDirections = () => {
    setSidebarOpen(true);
    handleTabChange("directions");
  };

  // Keep tab synced with phase changes
  useEffect(() => {
    if (phase === "DIRECTIONS" || phase === "NAVIGATING") {
      setActiveTab("directions");
    } else if (phase === "IDLE" || phase === "PLACE_DETAIL" || phase === "ARRIVAL") {
      setActiveTab("map");
    }
  }, [phase]);

  const handleSearchSelect = (p: { name: string; category?: string | null; address?: string | null; center: [number, number]; zoom: number }) => {
    jumpTo(p.center, p.zoom);
    setMenuOpen(true);
    dispatch({
      type: "SELECT_PLACE",
      place: {
        name: p.name,
        category: p.category ?? null,
        address: p.address ?? null,
        coord: p.center,
      },
    });
  };

  // Sync phase transitions with navigation hook
  useEffect(() => {
    if (phase === "DIRECTIONS" && !navMode) {
      handleToggleNavMode();
    } else if (phase !== "DIRECTIONS" && phase !== "NAVIGATING" && navMode) {
      handleToggleNavMode();
    }
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drive bottom sheet snap from phase on mobile
  useEffect(() => {
    if (!menuOpen) return;
    if (phase === "DIRECTIONS") {
      setBottomSheetSnap("mid");
    } else if (phase === "PLACE_DETAIL") {
      setBottomSheetSnap("mid");
    } else if (phase === "IDLE") {
      setBottomSheetSnap("collapsed");
    }
  }, [phase, menuOpen]);

  const { hours: _localH, minutes: _localM, year: _localYear } = toMapLocal(date, mapUtcOffsetMin);
  const mapLocalMins = _localH * 60 + _localM;

  // -- Timeline controls (floating card style) --
  const timelineControls = !accumulation.enabled ? (
    <div
      className="rounded-t-2xl md:rounded-2xl overflow-hidden"
      style={{
        background: "rgba(255,255,255,0.85)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        boxShadow: "0 -4px 32px rgba(0,0,0,0.08), 0 8px 32px rgba(100,116,139,0.12)",
      }}
    >
      {/* Floating tooltip */}
      <div
        className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none z-20"
        style={{ bottom: "calc(100% + 6px)" }}
      >
        <div
          className="text-[11px] font-bold px-2.5 py-0.5 rounded-md tabular-nums shadow-md whitespace-nowrap"
          style={{ background: "var(--md-error)", color: "white", fontFamily: "var(--md-font)" }}
        >
          {sliderMode === "time"
            ? formatTime12h(date, mapUtcOffsetMin)
            : new Date(date.getTime() + mapUtcOffsetMin * 60000)
                .toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
        </div>
        <div style={{ width: 0, height: 0, borderLeft: "5px solid transparent", borderRight: "5px solid transparent", borderTop: "5px solid var(--md-error)" }} />
      </div>

      {/* Ruler */}
      {sliderMode === "time" ? (
        <TimelineSlider
          minutes={mapLocalMins}
          onChange={handleSliderChange}
          date={date}
          latDeg={mapCenter?.[0]}
          lngDeg={mapCenter?.[1]}
          utcOffsetMin={mapUtcOffsetMin}
        />
      ) : (
        <DaySlider
          dayOfYear={dateToDayOfYear(date, mapUtcOffsetMin)}
          year={_localYear}
          onChange={handleDayOfYearChange}
        />
      )}

      {/* Controls row */}
      <div className="flex items-center justify-center gap-3 px-4 py-2">
        <button
          onClick={() => setIsPlaying((p) => !p)}
          className="flex items-center justify-center w-10 h-10 rounded-lg hover:bg-slate-100 transition-colors"
          style={{ color: "var(--md-on-surface-variant)" }}
          title={isPlaying ? "Pause" : "Play"}
        >
          <span className="material-symbols-outlined text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>
            {isPlaying ? "pause" : "play_arrow"}
          </span>
        </button>

        <button
          onClick={() => setSliderMode((m) => m === "time" ? "day" : "time")}
          className="flex items-center gap-1.5 h-8 px-2.5 rounded-lg hover:bg-slate-100 transition-colors border"
          style={{ borderColor: "var(--md-outline-variant)" }}
          title={sliderMode === "time" ? "Switch to day of year" : "Switch to time of day"}
        >
          <span
            className="material-symbols-outlined text-base"
            style={{ color: sliderMode === "time" ? "var(--md-primary)" : "var(--md-on-surface-variant)", fontVariationSettings: "'FILL' 1" }}
          >
            schedule
          </span>
          <span className="text-[9px]" style={{ color: "var(--md-outline-variant)" }}>/</span>
          <span
            className="material-symbols-outlined text-base"
            style={{ color: sliderMode === "day" ? "var(--md-primary)" : "var(--md-on-surface-variant)", fontVariationSettings: "'FILL' 1" }}
          >
            calendar_month
          </span>
        </button>

        {sliderMode === "time" ? (
          <>
            <DateInput date={date} onChange={setDate} utcOffsetMin={mapUtcOffsetMin} />
            <TimeInput date={date} onChange={setDate} utcOffsetMin={mapUtcOffsetMin} />
          </>
        ) : (
          <div className="flex items-center gap-1">
            <button
              onClick={() => adjustYear(-1)}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors"
              style={{ color: "var(--md-on-surface-variant)" }}
              aria-label="Previous year"
            >
              <span className="material-symbols-outlined text-base">chevron_left</span>
            </button>
            <span className="text-sm tabular-nums w-12 text-center font-medium" style={{ color: "var(--md-on-surface)", fontFamily: "var(--md-font)" }}>{_localYear}</span>
            <button
              onClick={() => adjustYear(+1)}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 transition-colors"
              style={{ color: "var(--md-on-surface-variant)" }}
              aria-label="Next year"
            >
              <span className="material-symbols-outlined text-base">chevron_right</span>
            </button>
          </div>
        )}
      </div>
    </div>
  ) : null;

  // -- Bottom-of-panel controls --
  const bottomPanelControls = (
    <div className="flex flex-col gap-2">
      <div className="rounded-xl border p-2 flex flex-col gap-2" style={{ background: "white", borderColor: "var(--md-outline-variant)" }}>
        <AccumulationPanel
          accumulation={accumulation}
          onChange={setAccumulation}
          getCanvas={getCanvas as () => HTMLCanvasElement | undefined}
          getBounds={getBounds as () => { getWest(): number; getEast(): number; getNorth(): number; getSouth(): number } | undefined}
        />
        <SettingsPanel showSunLines={showSunLines} onShowSunLinesChange={setShowSunLines} />
        <a href="/about" className="text-[11px] hover:underline" style={{ color: "var(--md-on-surface-variant)" }}>About / API</a>
        <div className="h-px" style={{ background: "var(--md-outline-variant)" }} />
        <div className="text-[10px] tabular-nums select-none" style={{ color: "var(--md-on-surface-variant)", opacity: 0.6 }}>zoom {mapZoom.toFixed(1)}</div>
      </div>
    </div>
  );

  // -- Phase-aware sidebar content --
  const sidebarContent = (() => {
    switch (phase) {
      case "PLACE_DETAIL":
        return selectedPlace ? (
          <PlaceDetail
            place={selectedPlace}
            onDirections={() => dispatch({ type: "START_DIRECTIONS" })}
            onBack={() => dispatch({ type: "BACK" })}
          />
        ) : (
          <QuickActions
            onNavigate={() => dispatch({ type: "START_DIRECTIONS" })}
            onDrawRoute={handleDrawModeToggle}
            drawMode={drawMode}
          />
        );

      case "DIRECTIONS":
      case "NAVIGATING":
        return (
          <DirectionsPanel
            waypointA={waypointA}
            waypointB={waypointB}
            waypointALabel={waypointALabel}
            waypointBLabel={waypointBLabel}
            onSetWaypointA={handleSetWaypointA}
            onSetWaypointB={handleSetWaypointB}
            onSwapWaypoints={handleSwapWaypoints}
            onClearWaypointA={handleClearWaypointA}
            onClearWaypointB={handleClearWaypointB}
            onClear={handleClear}
            onCalculate={handleCalculateRoute}
            isCalculating={isCalculating}
            routes={filteredRoutes}
            selectedRouteIndex={selectedRouteIndex}
            onSelectRoute={setSelectedRouteIndex}
            error={navError}
            solarIntensity={routeSolarIntensity}
            pendingSlot={pendingSlot}
            onSetPendingSlot={setPendingSlot}
            onSaveRoute={handleOpenSaveModal}
            savedRoutes={savedRoutes}
            savedFolders={savedFolders}
            onLoadRoute={handleLoadRoute}
            onDeleteSavedRoute={handleDeleteSavedRoute}
            onRenameSavedRoute={handleRenameSavedRoute}
            additionalWaypoints={additionalWaypoints}
            onRemoveAdditionalWaypoint={handleRemoveAdditionalWaypoint}
            onExportRoute={handleExportRoute}
            onPinDragStart={handlePinDragStart}
            drawMode={drawMode}
            onDrawModeToggle={handleDrawModeToggle}
            onClearSketch={handleClearSketch}
            sketchPointCount={sketchPoints.length}
            warning={navWarning}
            onBack={() => dispatch({ type: "BACK" })}
            onStartNavigation={() => dispatch({ type: "START_NAVIGATION" })}
            hideRouteCards
            routeMode={routeMode}
            onRouteModeChange={handleRouteModeChange}
            canTransit={canTransit}
            shadePreference={shadePreference}
            onShadePreferenceChange={handleShadePreferenceChange}
          />
        );

      default: // IDLE, ARRIVAL
        return (
          <QuickActions
            onNavigate={() => dispatch({ type: "START_DIRECTIONS" })}
            onDrawRoute={handleDrawModeToggle}
            drawMode={drawMode}
          />
        );
    }
  })();

  // Desktop sidebar: SideNav wrapping phase content + footer
  const desktopSidebar = (
    <SideNav activeTab={activeTab} onTabChange={handleTabChange}>
      <div className="flex flex-col min-h-full">
        <div className="flex-1">{sidebarContent}</div>
        <div className="mt-auto pt-3 border-t" style={{ borderColor: "var(--md-outline-variant)" }}>
          {bottomPanelControls}
        </div>
      </div>
    </SideNav>
  );

  // -- Map overlays --
  const mapOverlays = (
    <>
      {/* Mobile floating search */}
      <div
        className="absolute top-4 left-4 z-30 md:hidden"
        style={{ width: "min(560px, calc(100vw - 2rem))" }}
      >
        <SearchBar
          onSelect={handleSearchSelect}
          mapCenter={mapCenter}
        />
      </div>

      {/* Pending waypoint banner */}
      {pendingSlot && (
        <div
          className="absolute top-20 left-1/2 -translate-x-1/2 z-30 pointer-events-none flex items-center gap-2 backdrop-blur-md rounded-full px-4 py-1.5 text-sm select-none border"
          style={{
            background: "rgba(255,255,255,0.9)",
            borderColor: "var(--md-primary-container)",
            color: "var(--md-on-surface)",
          }}
        >
          <span className="w-2 h-2 rounded-full animate-pulse shrink-0" style={{ background: "var(--md-primary-container)" }} />
          Click map to place waypoint {pendingSlot}
          <span className="text-xs ml-1" style={{ color: "var(--md-on-surface-variant)" }}>— Esc to cancel</span>
        </div>
      )}

      {/* Floating route cards — desktop only, during DIRECTIONS phase */}
      {(phase === "DIRECTIONS" || phase === "NAVIGATING") && filteredRoutes.length > 0 && (
        <FloatingRouteCards
          routes={filteredRoutes}
          selectedRouteIndex={selectedRouteIndex}
          onSelectRoute={setSelectedRouteIndex}
          onSaveRoute={handleOpenSaveModal}
          onExportRoute={handleExportRoute}
          solarIntensity={routeSolarIntensity}
          onStartNavigation={() => dispatch({ type: "START_NAVIGATION" })}
        />
      )}

      {/* Floating map controls — right side */}
      <div className="absolute bottom-20 md:top-24 md:bottom-auto right-3 z-10">
        <FloatingMapControls mapRef={mapRef} onLocateMe={handleLocateMe} isLocating={isLocating} />
      </div>

      {/* Desktop timeline — floating card at bottom */}
      {!accumulation.enabled && (
        <div className="hidden md:block absolute bottom-6 z-10" style={{ left: 24, right: 24 }}>
          <div className="relative">
            {timelineControls}
          </div>
        </div>
      )}

      {/* Mobile timeline — full width at bottom */}
      {!accumulation.enabled && (
        <div className="absolute bottom-0 left-0 right-0 z-10 md:hidden relative">
          {timelineControls}
        </div>
      )}

      {/* Mobile bottom sheet */}
      {menuOpen && (
        <BottomSheet snap={bottomSheetSnap} onSnapChange={setBottomSheetSnap}>
          {phase === "PLACE_DETAIL" && selectedPlace ? (
            <PlaceDetail
              place={selectedPlace}
              onDirections={() => dispatch({ type: "START_DIRECTIONS" })}
              onBack={() => dispatch({ type: "BACK" })}
            />
          ) : phase === "DIRECTIONS" || phase === "NAVIGATING" ? (
            <DirectionsPanel
              waypointA={waypointA}
              waypointB={waypointB}
              waypointALabel={waypointALabel}
              waypointBLabel={waypointBLabel}
              onSetWaypointA={handleSetWaypointA}
              onSetWaypointB={handleSetWaypointB}
              onSwapWaypoints={handleSwapWaypoints}
              onClearWaypointA={handleClearWaypointA}
              onClearWaypointB={handleClearWaypointB}
              onClear={handleClear}
              onCalculate={handleCalculateRoute}
              isCalculating={isCalculating}
              routes={filteredRoutes}
              selectedRouteIndex={selectedRouteIndex}
              onSelectRoute={setSelectedRouteIndex}
              error={navError}
              solarIntensity={routeSolarIntensity}
              pendingSlot={pendingSlot}
              onSetPendingSlot={setPendingSlot}
              onSaveRoute={handleOpenSaveModal}
              savedRoutes={savedRoutes}
              savedFolders={savedFolders}
              onLoadRoute={handleLoadRoute}
              onDeleteSavedRoute={handleDeleteSavedRoute}
              onRenameSavedRoute={handleRenameSavedRoute}
              additionalWaypoints={additionalWaypoints}
              onRemoveAdditionalWaypoint={handleRemoveAdditionalWaypoint}
              onExportRoute={handleExportRoute}
              onPinDragStart={handlePinDragStart}
              drawMode={drawMode}
              onDrawModeToggle={handleDrawModeToggle}
              onClearSketch={handleClearSketch}
              sketchPointCount={sketchPoints.length}
              warning={navWarning}
              onBack={() => dispatch({ type: "BACK" })}
              onStartNavigation={() => dispatch({ type: "START_NAVIGATION" })}
              routeMode={routeMode}
              onRouteModeChange={handleRouteModeChange}
              canTransit={canTransit}
              shadePreference={shadePreference}
              onShadePreferenceChange={handleShadePreferenceChange}
            />
          ) : (
            <div className="flex flex-col gap-3">
              <QuickActions
                onNavigate={() => dispatch({ type: "START_DIRECTIONS" })}
                onDrawRoute={handleDrawModeToggle}
                drawMode={drawMode}
              />
              <div className="mt-2 rounded-xl border p-1.5 flex flex-col gap-1" style={{ background: "white", borderColor: "var(--md-outline-variant)" }}>
                <AccumulationPanel
                  accumulation={accumulation}
                  onChange={setAccumulation}
                  getCanvas={getCanvas as () => HTMLCanvasElement | undefined}
                  getBounds={getBounds as () => { getWest(): number; getEast(): number; getNorth(): number; getSouth(): number } | undefined}
                />
                <SettingsPanel showSunLines={showSunLines} onShowSunLinesChange={setShowSunLines} />
                <a href="/about" className="text-[10px] px-1.5 pt-0.5 pb-0.5 transition-colors hover:underline" style={{ color: "var(--md-on-surface-variant)" }}>About / API</a>
              </div>
            </div>
          )}
        </BottomSheet>
      )}

      {/* Save route modal */}
      {saveModalRouteIndex !== null && navRoutes[saveModalRouteIndex] && (
        <SaveRouteModal
          defaultName={navRoutes[saveModalRouteIndex].label}
          onSave={handleConfirmSave}
          onCancel={() => setSaveModalRouteIndex(null)}
        />
      )}
    </>
  );

  return (
    <>
      <AppShell
        mapRef={mapRef}
        sidebar={desktopSidebar}
        sidebarOpen={sidebarOpen}
        onSidebarToggle={handleSidebarToggle}
        map={
          <Suspense fallback={null}>
            <MapView
              date={date}
              accumulation={accumulation}
              onMapReady={handleMapReady}
              onMapClick={handleMapClick}
              navWaypoints={{ a: waypointA ?? undefined, b: waypointB ?? undefined }}
              navRoute={selectedNavRoute}
              showSunLines={showSunLines}
              mapClickActive={pendingSlot !== null}
              onMarkerDragEnd={handleMarkerDragEnd}
              navTrainDrawData={navTrainDrawData}
              navMrtEntrances={navMrtEntrances}
              additionalWaypoints={additionalWaypoints}
              userLocation={userLocation}
              assistantPins={assistantPins}
              drawMode={drawMode}
              sketchPoints={sketchPoints}
              onSketchPointClick={handleSketchPointClick}
              onSketchPointDrag={handleSketchPointDrag}
              onSketchFinish={handleSketchFinish}
              simplifiedWaypoints={simplifiedWaypoints}
            />
          </Suspense>
        }
        mapOverlays={mapOverlays}
      />

      {/* Desktop search bar — rendered outside AppShell so it layers above the sidebar */}
      <div
        className="hidden md:block fixed top-4 left-4 z-50"
        style={{ width: "376px" }}
      >
        <SearchBar
          onSelect={handleSearchSelect}
          mapCenter={mapCenter}
          onMenuToggle={handleSidebarToggle}
          onDirections={handleOpenDirections}
        />
      </div>

      {/* AI assistant: launcher FAB + chat panel */}
      {!assistantOpen && (
        <button
          onClick={() => setAssistantOpen(true)}
          className="fixed z-40 flex items-center justify-center rounded-full shadow-xl transition-transform hover:scale-105"
          style={{
            bottom: "6rem",
            right: "1rem",
            width: 52,
            height: 52,
            background: "var(--md-primary, #b45309)",
            color: "white",
          }}
          title="Ask the Shade Assistant"
          aria-label="Open Shade Assistant"
        >
          <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
            assistant
          </span>
        </button>
      )}
      <AssistantPanel
        open={assistantOpen}
        onClose={() => setAssistantOpen(false)}
        messages={agent.messages}
        isThinking={agent.isThinking}
        onSend={agent.sendMessage}
        onReset={agent.reset}
      />
    </>
  );
}
