export type ViewportComplexityTier = 'S' | 'M' | 'L' | 'XL';

export interface ViewportPerformanceSnapshot {
  sampledAt: number;
  fps: number;
  frameTimeP95Ms: number;
  triangles: number;
  drawCalls: number;
  geometries: number;
  textures: number;
}

export interface ViewportPerformanceVerdict {
  tier: ViewportComplexityTier;
  passed: boolean;
  violations: string[];
}

export const VIEWPORT_PERFORMANCE_BUDGETS: Record<ViewportComplexityTier, {
  maxTriangles: number;
  maxDrawCalls: number;
  minFps: number;
  maxFrameTimeP95Ms: number;
}> = {
  S: { maxTriangles: 50_000, maxDrawCalls: 100, minFps: 50, maxFrameTimeP95Ms: 24 },
  M: { maxTriangles: 250_000, maxDrawCalls: 350, minFps: 45, maxFrameTimeP95Ms: 28 },
  L: { maxTriangles: 1_000_000, maxDrawCalls: 1_000, minFps: 30, maxFrameTimeP95Ms: 33.4 },
  XL: { maxTriangles: Number.POSITIVE_INFINITY, maxDrawCalls: 2_500, minFps: 20, maxFrameTimeP95Ms: 50 },
};

export function classifyViewportComplexity(triangles: number): ViewportComplexityTier {
  if (triangles <= VIEWPORT_PERFORMANCE_BUDGETS.S.maxTriangles) return 'S';
  if (triangles <= VIEWPORT_PERFORMANCE_BUDGETS.M.maxTriangles) return 'M';
  if (triangles <= VIEWPORT_PERFORMANCE_BUDGETS.L.maxTriangles) return 'L';
  return 'XL';
}

export function percentile95(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;
}

export function evaluateViewportPerformance(snapshot: ViewportPerformanceSnapshot): ViewportPerformanceVerdict {
  const tier = classifyViewportComplexity(snapshot.triangles);
  const budget = VIEWPORT_PERFORMANCE_BUDGETS[tier];
  const violations: string[] = [];
  if (snapshot.fps < budget.minFps) violations.push(`FPS_BELOW_BUDGET:${snapshot.fps}<${budget.minFps}`);
  if (snapshot.frameTimeP95Ms > budget.maxFrameTimeP95Ms) violations.push(`FRAME_P95_OVER_BUDGET:${snapshot.frameTimeP95Ms}>${budget.maxFrameTimeP95Ms}`);
  if (snapshot.drawCalls > budget.maxDrawCalls) violations.push(`DRAW_CALLS_OVER_BUDGET:${snapshot.drawCalls}>${budget.maxDrawCalls}`);
  return { tier, passed: violations.length === 0, violations };
}
