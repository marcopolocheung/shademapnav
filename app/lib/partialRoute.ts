export interface PartialRouteInfo {
  completedLegs: number;
  failedLeg: number;
  totalLegs: number;
}

export function partialRouteNotice(partial: PartialRouteInfo): string {
  const completed = partial.completedLegs === 1
    ? "1 completed leg"
    : `${partial.completedLegs} completed legs`;
  return `Could not finish leg ${partial.failedLeg} of ${partial.totalLegs}; showing ${completed}.`;
}
