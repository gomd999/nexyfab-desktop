/**
 * perfMetrics.ts — Frame-rate / draw-call / vertex-count tracker
 * with budget-exceeded alerts.
 *
 * Goal: keep the user's session smooth (≥ 30 fps) on a 10k-part
 * assembly. When a frame goes over budget we want to know which
 * dimension blew it (vertex count, draw call count, frame time) so
 * the corresponding mitigation (LOD downgrade, instancing kick-in,
 * culling tighten) can fire automatically.
 *
 * This module owns:
 *   - `PerformanceMetrics` sample type — one snapshot per frame.
 *   - `PerfTracker` rolling-window aggregator (EMA + last-N).
 *   - `PerfBudget` thresholds + violation classification.
 *
 * Out of scope: the actual frame instrumentation (renderer ticks the
 * tracker each frame) — this module is pure data + state machine.
 */

export interface PerformanceMetrics {
  /** Milliseconds the frame took (CPU + GPU combined). */
  frameMs: number;
  /** Draw call count for the frame. */
  drawCalls: number;
  /** Total vertex count submitted. */
  vertexCount: number;
  /** Triangle count submitted. */
  triangleCount: number;
  /** ms epoch when the sample was taken. */
  timestamp: number;
}

export interface PerfBudget {
  /** Maximum frame time (ms). Default 33 (= 30 fps). */
  maxFrameMs: number;
  /** Maximum draw calls per frame. Default 2000. */
  maxDrawCalls: number;
  /** Maximum vertex count per frame. Default 5M. */
  maxVertices: number;
}

export const DEFAULT_BUDGET: PerfBudget = {
  maxFrameMs: 33,
  maxDrawCalls: 2000,
  maxVertices: 5_000_000,
};

export type ViolationCode = 'frame-ms' | 'draw-calls' | 'vertices';

export interface BudgetViolation {
  code: ViolationCode;
  budget: number;
  observed: number;
  /** Excess as a fraction of the budget (1.0 = exactly at, 1.5 = 50% over). */
  excess: number;
}

/** Classify a single sample against the budget. Returns empty when
 *  every metric is within bounds. */
export function classifyViolations(
  sample: PerformanceMetrics,
  budget: PerfBudget = DEFAULT_BUDGET,
): BudgetViolation[] {
  const out: BudgetViolation[] = [];
  if (sample.frameMs > budget.maxFrameMs) {
    out.push({ code: 'frame-ms', budget: budget.maxFrameMs, observed: sample.frameMs, excess: sample.frameMs / budget.maxFrameMs });
  }
  if (sample.drawCalls > budget.maxDrawCalls) {
    out.push({ code: 'draw-calls', budget: budget.maxDrawCalls, observed: sample.drawCalls, excess: sample.drawCalls / budget.maxDrawCalls });
  }
  if (sample.vertexCount > budget.maxVertices) {
    out.push({ code: 'vertices', budget: budget.maxVertices, observed: sample.vertexCount, excess: sample.vertexCount / budget.maxVertices });
  }
  return out;
}

export interface RollingStats {
  /** Exponential moving average of frame ms. */
  emaFrameMs: number;
  /** EMA of draw call count. */
  emaDrawCalls: number;
  /** Average vertex count (last N samples). */
  meanVertexCount: number;
  /** Worst frame ms in the recent window. */
  maxFrameMs: number;
  /** Samples processed since last reset. */
  count: number;
}

export class PerfTracker {
  private samples: PerformanceMetrics[] = [];
  private readonly windowSize: number;
  private readonly emaAlpha: number;
  private emaFrame = 0;
  private emaDraw = 0;
  private maxFrame = 0;
  private count = 0;
  /** Latest violation list (refreshed on every push). */
  lastViolations: BudgetViolation[] = [];
  budget: PerfBudget;

  constructor(windowSize = 120, budget: PerfBudget = DEFAULT_BUDGET) {
    this.windowSize = Math.max(1, windowSize);
    this.emaAlpha = 2 / (this.windowSize + 1);
    this.budget = budget;
  }

  /** Push a frame sample. */
  push(sample: PerformanceMetrics): void {
    this.samples.push(sample);
    if (this.samples.length > this.windowSize) this.samples.shift();
    this.count++;
    if (this.count === 1) {
      this.emaFrame = sample.frameMs;
      this.emaDraw = sample.drawCalls;
    } else {
      this.emaFrame = this.emaAlpha * sample.frameMs + (1 - this.emaAlpha) * this.emaFrame;
      this.emaDraw = this.emaAlpha * sample.drawCalls + (1 - this.emaAlpha) * this.emaDraw;
    }
    if (sample.frameMs > this.maxFrame) this.maxFrame = sample.frameMs;
    this.lastViolations = classifyViolations(sample, this.budget);
  }

  /** Aggregated stats for the rolling window. */
  stats(): RollingStats {
    const vSum = this.samples.reduce((s, x) => s + x.vertexCount, 0);
    return {
      emaFrameMs: this.emaFrame,
      emaDrawCalls: this.emaDraw,
      meanVertexCount: this.samples.length > 0 ? vSum / this.samples.length : 0,
      maxFrameMs: this.maxFrame,
      count: this.count,
    };
  }

  /** True when budget was violated on any of the last N samples. */
  isOverBudget(lookback = 5): boolean {
    const slice = this.samples.slice(-lookback);
    for (const s of slice) {
      if (classifyViolations(s, this.budget).length > 0) return true;
    }
    return false;
  }

  reset(): void {
    this.samples = [];
    this.count = 0;
    this.emaFrame = 0;
    this.emaDraw = 0;
    this.maxFrame = 0;
    this.lastViolations = [];
  }
}
