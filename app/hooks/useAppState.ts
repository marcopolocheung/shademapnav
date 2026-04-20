import { useReducer } from "react";

export type AppPhase =
  | "IDLE"
  | "PLACE_DETAIL"
  | "DIRECTIONS"
  | "NAVIGATING"
  | "ARRIVAL";

export interface PlaceInfo {
  name: string;
  address?: string | null;
  category?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  priceLevel?: string | null;
  hours?: string | null;
  phone?: string | null;
  website?: string | null;
  description?: string | null;
  photo?: string | null;
  coord: [number, number]; // [lng, lat]
}

export interface AppState {
  phase: AppPhase;
  selectedPlace: PlaceInfo | null;
}

export type AppAction =
  | { type: "SELECT_PLACE"; place: PlaceInfo }
  | { type: "START_DIRECTIONS"; destination?: PlaceInfo }
  | { type: "START_NAVIGATION" }
  | { type: "ARRIVE" }
  | { type: "DISMISS" }
  | { type: "BACK" };

function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SELECT_PLACE":
      return { phase: "PLACE_DETAIL", selectedPlace: action.place };

    case "START_DIRECTIONS":
      return {
        phase: "DIRECTIONS",
        selectedPlace: action.destination ?? state.selectedPlace,
      };

    case "START_NAVIGATION":
      if (state.phase !== "DIRECTIONS") return state;
      return { ...state, phase: "NAVIGATING" };

    case "ARRIVE":
      if (state.phase !== "NAVIGATING") return state;
      return { ...state, phase: "ARRIVAL" };

    case "BACK":
      switch (state.phase) {
        case "PLACE_DETAIL":
          return { phase: "IDLE", selectedPlace: null };
        case "DIRECTIONS":
          return state.selectedPlace
            ? { phase: "PLACE_DETAIL", selectedPlace: state.selectedPlace }
            : { phase: "IDLE", selectedPlace: null };
        case "NAVIGATING":
          return { ...state, phase: "DIRECTIONS" };
        case "ARRIVAL":
          return { phase: "IDLE", selectedPlace: null };
        default:
          return state;
      }

    case "DISMISS":
      return { phase: "IDLE", selectedPlace: null };

    default:
      return state;
  }
}

const INITIAL_STATE: AppState = { phase: "IDLE", selectedPlace: null };

export function useAppState() {
  const [state, dispatch] = useReducer(appReducer, INITIAL_STATE);
  return { ...state, dispatch };
}
