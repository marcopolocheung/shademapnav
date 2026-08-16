export interface ShadowPointQueryResult {
  shadeFraction: number;
  source: "geometry-cache";
}

export interface IShadowLayer {
  /** Called whenever the date/time changes (slider drag, play animation, TimeInput commit) */
  setDate(date: Date): void;
  /** Called on map resize — rebuild textures/framebuffer to new viewport dimensions */
  resize(): void;
  /** Clean up all WebGL resources and map layers on component unmount */
  remove(): void;
  /** Toggle sun-exposure accumulation mode (no-op in the local renderer) */
  setSunExposure(enabled: boolean, opts?: { startDate: Date; endDate: Date; iterations: number }): void;
  /** Register an event listener (e.g. 'idle' after render completes) */
  on(event: string, callback: () => void): void;
  /**
   * Query shade from currently loaded shadow geometry without moving the map.
   * Returns null when the layer cannot answer confidently and callers should
   * fall back to rendered-canvas sampling.
   */
  queryPointShade?(lng: number, lat: number, opts?: { date?: Date }): ShadowPointQueryResult | null;
}
