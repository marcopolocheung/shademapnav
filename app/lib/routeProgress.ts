export interface RouteCalculationProgress {
  message: string;
  current?: number;
  total?: number;
}

export function routeProgressPercent(progress: RouteCalculationProgress): number | null {
  const { current, total } = progress;
  if (
    current == null ||
    total == null ||
    !Number.isFinite(current) ||
    !Number.isFinite(total) ||
    total <= 0
  ) {
    return null;
  }
  return Math.max(0, Math.min(100, (current / total) * 100));
}

export function routeProgressCount(progress: RouteCalculationProgress): string | null {
  const { current, total } = progress;
  if (
    current == null ||
    total == null ||
    !Number.isFinite(current) ||
    !Number.isFinite(total) ||
    total <= 0
  ) {
    return null;
  }
  return `${Math.max(0, Math.min(total, current))}/${total}`;
}
