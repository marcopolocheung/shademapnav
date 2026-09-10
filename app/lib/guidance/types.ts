export type ManeuverType =
  | "depart" | "continue" | "turn-left" | "turn-right"
  | "slight-left" | "slight-right" | "sharp-left" | "sharp-right"
  | "cross" | "board" | "alight" | "arrive";

export interface Maneuver {
  type: ManeuverType;
  /** Signed degrees: positive is right, negative is left; an exact U-turn is -180. */
  bearingDelta: number;
  distanceFromStartM: number;
  streetName?: string;
  shadowSideHint?: "left" | "right" | null;
  legIndex: number;
}

export interface GuidanceState {
  maneuvers: Maneuver[];
  activeIndex: number;
  progressM: number;
  distanceToNextM: number;
  etaSec: number;
  offRoute: boolean;
  snapped: [number, number] | null;
}
