export type TravelModeId = "walk" | "bike";

export interface TravelModePolicy {
  id: TravelModeId;
  label: string;
  speedMps: number;
  stepsPenaltyM: number;
  roughSurfacePenaltyM: number;
  cyclewayPreferenceM: number;
}

export const TRAVEL_MODE_POLICIES: Record<TravelModeId, TravelModePolicy> = {
  walk: {
    id: "walk",
    label: "Walk",
    speedMps: 1.4,
    stepsPenaltyM: 0,
    roughSurfacePenaltyM: 0,
    cyclewayPreferenceM: 0,
  },
  bike: {
    id: "bike",
    label: "Bike",
    speedMps: 4.5,
    stepsPenaltyM: 500,
    roughSurfacePenaltyM: 75,
    cyclewayPreferenceM: -40,
  },
};

export function getTravelModePolicy(mode: TravelModeId): TravelModePolicy {
  return TRAVEL_MODE_POLICIES[mode];
}

export function travelTimeSeconds(distanceM: number, mode: TravelModeId): number {
  return distanceM / getTravelModePolicy(mode).speedMps;
}
