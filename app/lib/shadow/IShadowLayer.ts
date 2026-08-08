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
}
