/**
 * scribePassGenerator.ts — Generate a "scribe pass" on a workpiece:
 * a shallow tool-path that marks layout lines, datum points, or
 * inspection-reference features.
 *
 * Common use cases:
 *
 *   - Engrave drawing number / serial / matchmark on a finished
 *     surface (Z plunge ~ 0.05-0.2 mm).
 *   - Scribe a layout for hand-finish: outline a pocket before milling
 *     it so the operator can verify origin.
 *   - Mark datum points (cross) at A/B/C reference frame origins for
 *     inspection CMM pickup.
 *
 * Module:
 *   - Accepts text strings or geometric line lists.
 *   - Emits engraving tool-path (G-code style) with controlled depth.
 *   - Times the pass + warns on tiny features unsuitable for the tool.
 */

export interface Vec2 { x: number; y: number }

export type ScribeKind = 'engrave-text' | 'layout-line' | 'datum-cross' | 'matchmark';

export interface ScribeFeature {
  id: string;
  kind: ScribeKind;
  /** Position (centre for text/cross, start for layout-line). */
  position: Vec2;
  /** End point for layout-line. */
  end?: Vec2;
  /** Text content for engrave-text. */
  text?: string;
  /** Character height (mm) for text. */
  textHeightMm?: number;
}

export interface ScribeOptions {
  /** Tool diameter (mm). */
  toolDiameterMm: number;
  /** Engrave depth (mm). */
  depthMm: number;
  /** Feed rate (mm/min). */
  feedMmMin: number;
  /** Rapid feed (mm/min). */
  rapidMmMin: number;
  /** Clearance plane Z (mm above stock top). */
  clearancePlaneMm: number;
}

export const DEFAULT_OPTIONS: ScribeOptions = {
  toolDiameterMm: 0.5,
  depthMm: 0.1,
  feedMmMin: 600,
  rapidMmMin: 5000,
  clearancePlaneMm: 2,
};

export interface ScribeStep {
  command: 'rapid' | 'feed';
  position: { x: number; y: number; z: number };
}

export interface ScribeResult {
  steps: ScribeStep[];
  estimatedTimeSec: number;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function generateScribePass(features: ScribeFeature[], options: Partial<ScribeOptions> = {}): ScribeResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const steps: ScribeStep[] = [];
  const warnings: string[] = [];
  for (const f of features) {
    appendFeature(f, opts, steps, warnings);
  }
  const time = estimateTime(steps, opts);
  return { steps, estimatedTimeSec: time, warnings };
}

function appendFeature(f: ScribeFeature, opts: ScribeOptions, steps: ScribeStep[], warnings: string[]): void {
  switch (f.kind) {
    case 'engrave-text': {
      const text = f.text ?? '';
      const height = f.textHeightMm ?? 3;
      if (text.length === 0) {
        warnings.push(`Feature ${f.id} has empty text.`);
        return;
      }
      if (height < opts.toolDiameterMm * 1.5) {
        warnings.push(`Text height ${height} < 1.5·toolDia for ${f.id}; characters may blur.`);
      }
      // Greatly simplified: each character produces a small box of strokes.
      let cursorX = f.position.x;
      for (let i = 0; i < text.length; i++) {
        const corner: Vec2 = { x: cursorX, y: f.position.y };
        appendBox(corner, height * 0.6, height, opts, steps);
        cursorX += height * 0.7;
      }
      break;
    }
    case 'layout-line': {
      if (!f.end) {
        warnings.push(`Layout-line ${f.id} missing end point.`);
        return;
      }
      steps.push({ command: 'rapid', position: { x: f.position.x, y: f.position.y, z: opts.clearancePlaneMm } });
      steps.push({ command: 'feed', position: { x: f.position.x, y: f.position.y, z: -opts.depthMm } });
      steps.push({ command: 'feed', position: { x: f.end.x, y: f.end.y, z: -opts.depthMm } });
      steps.push({ command: 'rapid', position: { x: f.end.x, y: f.end.y, z: opts.clearancePlaneMm } });
      break;
    }
    case 'datum-cross': {
      const size = 5;
      const c = f.position;
      const armSteps: Vec2[][] = [
        [{ x: c.x - size, y: c.y }, { x: c.x + size, y: c.y }],
        [{ x: c.x, y: c.y - size }, { x: c.x, y: c.y + size }],
      ];
      for (const arm of armSteps) {
        steps.push({ command: 'rapid', position: { x: arm[0]!.x, y: arm[0]!.y, z: opts.clearancePlaneMm } });
        steps.push({ command: 'feed', position: { x: arm[0]!.x, y: arm[0]!.y, z: -opts.depthMm } });
        steps.push({ command: 'feed', position: { x: arm[1]!.x, y: arm[1]!.y, z: -opts.depthMm } });
        steps.push({ command: 'rapid', position: { x: arm[1]!.x, y: arm[1]!.y, z: opts.clearancePlaneMm } });
      }
      break;
    }
    case 'matchmark': {
      const size = 3;
      const c = f.position;
      steps.push({ command: 'rapid', position: { x: c.x, y: c.y - size / 2, z: opts.clearancePlaneMm } });
      steps.push({ command: 'feed', position: { x: c.x, y: c.y - size / 2, z: -opts.depthMm } });
      steps.push({ command: 'feed', position: { x: c.x, y: c.y + size / 2, z: -opts.depthMm } });
      steps.push({ command: 'rapid', position: { x: c.x, y: c.y + size / 2, z: opts.clearancePlaneMm } });
      break;
    }
  }
}

function appendBox(corner: Vec2, w: number, h: number, opts: ScribeOptions, steps: ScribeStep[]): void {
  const points: Vec2[] = [
    { x: corner.x, y: corner.y },
    { x: corner.x + w, y: corner.y },
    { x: corner.x + w, y: corner.y + h },
    { x: corner.x, y: corner.y + h },
    { x: corner.x, y: corner.y },
  ];
  steps.push({ command: 'rapid', position: { x: points[0]!.x, y: points[0]!.y, z: opts.clearancePlaneMm } });
  steps.push({ command: 'feed', position: { x: points[0]!.x, y: points[0]!.y, z: -opts.depthMm } });
  for (let i = 1; i < points.length; i++) {
    steps.push({ command: 'feed', position: { x: points[i]!.x, y: points[i]!.y, z: -opts.depthMm } });
  }
  steps.push({ command: 'rapid', position: { x: points[points.length - 1]!.x, y: points[points.length - 1]!.y, z: opts.clearancePlaneMm } });
}

function estimateTime(steps: ScribeStep[], opts: ScribeOptions): number {
  let total = 0;
  for (let i = 1; i < steps.length; i++) {
    const prev = steps[i - 1]!.position;
    const cur = steps[i]!.position;
    const dist = Math.hypot(cur.x - prev.x, cur.y - prev.y, cur.z - prev.z);
    const feed = steps[i]!.command === 'rapid' ? opts.rapidMmMin : opts.feedMmMin;
    total += (dist / Math.max(0.001, feed)) * 60;
  }
  return total;
}

// ── Emit Fanuc G-code ─────────────────────────────────────────

export function emitGcode(result: ScribeResult, opts: ScribeOptions = DEFAULT_OPTIONS): string[] {
  const lines: string[] = [];
  for (const step of result.steps) {
    const cmd = step.command === 'rapid' ? 'G0' : 'G1';
    const pos = step.position;
    const f = step.command === 'feed' ? ` F${opts.feedMmMin}` : '';
    lines.push(`${cmd} X${pos.x.toFixed(3)} Y${pos.y.toFixed(3)} Z${pos.z.toFixed(3)}${f}`);
  }
  return lines;
}

// ── Summary ────────────────────────────────────────────────────

export interface ScribeSummary {
  featureCount: number;
  stepCount: number;
  estimatedTimeSec: number;
  warningCount: number;
}

export function summarize(features: ScribeFeature[], result: ScribeResult): ScribeSummary {
  return {
    featureCount: features.length,
    stepCount: result.steps.length,
    estimatedTimeSec: result.estimatedTimeSec,
    warningCount: result.warnings.length,
  };
}
